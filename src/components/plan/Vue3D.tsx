"use client";

// Vue 3D d'un niveau du plan — murs extrudés depuis le contour des pièces, sol,
// appareillages positionnés à leur hauteur d'installation réelle. Caméra orbitale
// écrite à la main (glisser = tourner, molette = zoom) pour n'avoir aucune
// dépendance sur les sous-chemins d'import de three (examples/jsm, addons…) qui
// posent problème selon les versions/bundlers. Nécessite uniquement le paquet
// npm "three" lui-même (voir note de livraison — à ajouter dans package.json).
//
// Ce composant remplace le canvas 2D quand la vue 3D est activée dans la page plan ;
// il ne gère ni le dessin des pièces ni le placement des appareillages (lecture seule).

import { useEffect, useRef, useState, useMemo, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import { Niveau, PIECE_TYPES, centroide, AppareillageType, OuvertureEffective, ouverturesEffectivesMur, cleSegmentLiaison, assombrirCouleur, pointsOndulesEntre, MeubleSimple, origineCircuits, AppareillagePlace } from "@/lib/maison-types";
import { ResultatGeneration, construireColorMap, segmentsPourCircuit } from "@/lib/maison-engine";
import { creerModeleAppareillage, creerVoletRoulant, ModeleVolet, habillerEnSaillie, TYPES_POSE_APPARENTE } from "@/components/plan/Modeles3D";
import { ancrageMurLePlusProche, baieDuVolet } from "@/lib/appareillage-mur";
import { parametresMur3D, faceInterieureM, epaisseurTotaleM, HAUTEUR_DEFAUT } from "@/lib/murs";
import { appareillagesEnPoseApparente, posesTroncons } from "@/lib/pose-circuits";


// Hauteur d'installation par défaut du tableau électrique (mètres) quand non précisée.
const HAUTEUR_TABLEAU_DEFAUT = 1.5;

// ─── SIMULATION D'ÉCLAIRAGE (VUE 3D) ───────────────────────────────────────────
// Chaque interrupteur/va-et-vient/télérupteur ayant des points lumineux commandés
// (commandePourIds, maison-types.ts) peut être allumé/éteint indépendamment depuis
// le panneau superposé à la vue 3D. Simplification volontaire pour un va-et-vient
// (deux commandes sur les mêmes lampes) : logique "OU" — la lampe s'allume si AU
// MOINS une de ses commandes est active, plutôt qu'une bascule XOR fidèle au
// câblage réel, qui n'apporterait rien à une simulation visuelle.
const LABEL_TYPE_INTERRUPTEUR: Record<"interrupteur" | "va_et_vient" | "telerupteur", string> = {
  interrupteur: "Interrupteur",
  va_et_vient: "Va-et-vient",
  telerupteur: "Télérupteur",
};

interface InterrupteurUI {
  id: number;
  label: string;
  pieceNom: string;
  lumiereIds: number[];
}

// Hauteur d'installation (mètres) d'un appareillage : valeur saisie, sinon valeur par défaut
// du type ; un point lumineux de plafond est, par défaut, AU plafond de sa pièce.
function hauteurInstallation(type: AppareillageType, hauteurCm: number | undefined, plafond: number): number {
  if (hauteurCm != null) return hauteurCm / 100;
  if (type === "point_lumineux") return plafond;
  return HAUTEUR_DEFAUT[type] ?? 1.0;
}

// Étiquette ronde (initiales) toujours orientée face caméra — c'est elle qui rend
// chaque appareillage identifiable au premier coup d'œil dans la vue 3D. Le depth test
// reste ACTIVÉ (contrairement à une version précédente) : sans lui, l'étiquette se
// dessinait par-dessus tout le reste de la scène, murs compris, et restait visible même
// depuis l'extérieur d'une pièce fermée — exactement ce qu'on veut éviter. depthWrite
// reste désactivé (l'étiquette n'a pas besoin d'occulter ce qui est derrière ELLE).
function creerEtiquetteSprite(texte: string, couleurFond: string): THREE.Sprite {
  const taille = 64;
  const canvas = document.createElement("canvas");
  canvas.width = taille; canvas.height = taille;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(taille / 2, taille / 2, taille / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = couleurFond;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#1c1917";
  ctx.stroke();
  ctx.fillStyle = "#1c1917";
  ctx.font = "bold 24px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(texte, taille / 2, taille / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: texture, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.22, 0.22, 1);
  return sprite;
}

// ─── MURS AVEC OUVERTURES (portes/fenêtres) ────────────────────────────────────
// Un mur plein = une seule boîte par arête du contour (comportement historique).
// Un mur avec ouverture(s) = plusieurs boîtes disposées pour laisser un trou :
// un linteau plein au-dessus de l'ouverture jusqu'au plafond, une allège pleine
// en dessous pour une fenêtre (une porte va jusqu'au sol, pas d'allège), et les
// pans de mur pleins entre deux ouvertures ou jusqu'aux extrémités du segment.
export function construireMurAvecOuvertures(
  a: { x: number; y: number }, b: { x: number; y: number }, hauteurMur: number,
  ouvertures: OuvertureEffective[], epaisseur: number, murMat: THREE.Material, scene: THREE.Scene,
  // Une COUCHE de mur (structure ou doublage) : decalage = écart du centre de la couche à l'axe,
  // le long de la normale gauche ; extDebut/extFin = prolongement aux extrémités (comble le coin
  // avec le mur voisin) ; avecContenu = dessiner aussi vitrage / panneau coulissant (une seule
  // couche par mur). Toutes les couches reçoivent les MÊMES trous : une ouverture perce tout.
  opts: { decalage?: number; extDebut?: number; extFin?: number; avecContenu?: boolean } = {},
): void {
  const { decalage = 0, extDebut = 0, extFin = 0, avecContenu = true } = opts;
  const dx = b.x - a.x, dy = b.y - a.y;
  const longueur = Math.hypot(dx, dy);
  if (longueur < 0.01) return;
  const angle = Math.atan2(dy, dx);
  const ux = dx / longueur, uy = dy / longueur;
  const nx = -uy, ny = ux; // perpendiculaire au mur, pour décaler légèrement un panneau coulissant

  const ajouterPan = (centreLong: number, largeur: number, centreHauteur: number, hauteur: number) => {
    if (largeur < 0.005 || hauteur < 0.005) return;
    const geo = new THREE.BoxGeometry(largeur, hauteur, epaisseur);
    const mesh = new THREE.Mesh(geo, murMat);
    mesh.position.set(a.x + ux * centreLong + nx * decalage, centreHauteur, a.y + uy * centreLong + ny * decalage);
    mesh.rotation.y = -angle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };

  const segs = ouvertures
    .map(o => ({ o, centre: Math.min(longueur, Math.max(0, o.position * longueur)), larg: o.largeur / 100 }))
    .sort((s1, s2) => s1.centre - s2.centre);

  if (segs.length === 0) {
    ajouterPan((longueur + extFin - extDebut) / 2, longueur + extDebut + extFin, hauteurMur / 2, hauteurMur);
    return;
  }

  let curseur = 0;
  segs.forEach(({ o, centre, larg }) => {
    const debut = Math.max(curseur, centre - larg / 2);
    const fin = Math.min(longueur, centre + larg / 2);
    if (fin <= debut) return; // ouvertures qui se chevauchent — on ignore le chevauchement
    if (debut > curseur) {
      const depart = curseur === 0 ? -extDebut : curseur; // premier pan : prolongé jusqu'au coin
      ajouterPan((depart + debut) / 2, debut - depart, hauteurMur / 2, hauteurMur);
    }

    const hAllege = (o.allege ?? 0) / 100;
    const hOuverture = (o.hauteur ?? (o.type === "porte" || o.type === "porte_coulissante" ? 204 : 120)) / 100;
    const hLinteauBas = Math.min(hauteurMur, hAllege + hOuverture);
    // Le trou lui-même (linteau + allège) est percé des DEUX côtés d'un mur mitoyen —
    // sinon on verrait un mur plein depuis l'autre pièce. Le contenu (vitrage, panneau
    // coulissant) n'est en revanche dessiné qu'une fois, côté propriétaire de l'ouverture.
    if (hLinteauBas < hauteurMur - 0.01) ajouterPan((debut + fin) / 2, fin - debut, (hLinteauBas + hauteurMur) / 2, hauteurMur - hLinteauBas);
    if (hAllege > 0.01) ajouterPan((debut + fin) / 2, fin - debut, hAllege / 2, hAllege);

    if (avecContenu && o.proprietaire && o.type === "fenetre") {
      const vitreGeo = new THREE.BoxGeometry(fin - debut, hOuverture, 0.01);
      const vitreMat = new THREE.MeshStandardMaterial({ color: 0xBAE6FD, transparent: true, opacity: 0.35 });
      const vitre = new THREE.Mesh(vitreGeo, vitreMat);
      vitre.position.set(a.x + ux * ((debut + fin) / 2), hAllege + hOuverture / 2, a.y + uy * ((debut + fin) / 2));
      vitre.rotation.y = -angle;
      scene.add(vitre);
    }

    if (avecContenu && o.proprietaire && o.type === "porte_coulissante") {
      // Panneau "garé" contre le mur adjacent, du côté choisi — pas de vantail qui bat.
      const cote = o.coulisseVers === "gauche" ? -1 : 1;
      const centrePanneau = cote > 0 ? fin + larg / 2 : debut - larg / 2;
      const decalage = epaisseur * 0.3;
      const panneauGeo = new THREE.BoxGeometry(larg, hOuverture, epaisseur * 0.4);
      const panneauMat = new THREE.MeshStandardMaterial({ color: 0xD6C7A1 });
      const panneau = new THREE.Mesh(panneauGeo, panneauMat);
      panneau.position.set(
        a.x + ux * centrePanneau + nx * decalage, hOuverture / 2, a.y + uy * centrePanneau + ny * decalage,
      );
      panneau.rotation.y = -angle;
      scene.add(panneau);
    }
    curseur = fin;
  });
  if (curseur < longueur) ajouterPan((curseur + longueur + extFin) / 2, longueur + extFin - curseur, hauteurMur / 2, hauteurMur);
}

export interface Vue3DHandle {
  capturerImage: () => string | null;
}

const Vue3D = forwardRef<Vue3DHandle, {
  niveau: Niveau; resultat: ResultatGeneration | null; showCircuits: boolean;
}>(function Vue3D({ niveau, resultat, showCircuits }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);
  // id d'appareillage (point_lumineux/applique) -> sa lumière 3D + le matériau de son
  // marqueur (pour faire "briller" l'ampoule elle-même, pas seulement éclairer la pièce).
  const lumiereLightsRef = useRef<Map<number, { light: THREE.PointLight | THREE.SpotLight; mat: THREE.MeshStandardMaterial }>>(new Map());

  const [nightMode, setNightMode] = useState(false);
  // « Coupe » : rend le doublage translucide pour voir passer les câbles encastrés qu'il contient.
  const [coupeDoublage, setCoupeDoublage] = useState(false);
  const doublageMatsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const [interrupteursOn, setInterrupteursOn] = useState<Record<number, boolean>>({});
  // Ouverture des volets roulants (0 fermé … 100 ouvert) forcée depuis le panneau 3D — simple
  // état de VUE, jamais écrit dans le plan ; sans entrée, c'est la valeur enregistrée
  // (AppareillagePlace.voletOuvertPct, réglée depuis le plan 2D) qui s'applique.
  const [voletsOverride, setVoletsOverride] = useState<Record<number, number>>({});
  const voletsRef = useRef<Map<number, { modele: ModeleVolet; defaut: number }>>(new Map());

  useImperativeHandle(ref, () => ({
    capturerImage: () => rendererRef.current?.domElement.toDataURL("image/png") ?? null,
  }));

  // ── Repère : x du plan → x 3D, y du plan → z 3D (profondeur), hauteur → y 3D (vertical) ──
  const niveauResultat = useMemo(
    () => resultat?.maison.niveaux.find(n => n.id === niveau.id) ?? niveau,
    [niveau, resultat],
  );

  // Panneau de simulation : un interrupteur/va-et-vient/télérupteur n'apparaît que s'il
  // commande au moins un point lumineux (commandePourIds) — recalculé à chaque changement
  // de niveau/génération, indépendamment de la reconstruction de la scène 3D elle-même.
  const interrupteurs: InterrupteurUI[] = useMemo(() => {
    const liste: InterrupteurUI[] = [];
    niveauResultat.pieces.forEach(piece => {
      piece.appareillages.forEach(app => {
        if (app.type !== "interrupteur" && app.type !== "va_et_vient" && app.type !== "telerupteur") return;
        const lumiereIds = app.commandePourIds ?? [];
        if (lumiereIds.length === 0) return;
        liste.push({
          id: app.id,
          label: app.nom || `${LABEL_TYPE_INTERRUPTEUR[app.type]}${lumiereIds.length > 1 ? ` (${lumiereIds.length} pts)` : ""}`,
          pieceNom: piece.nom,
          lumiereIds,
        });
      });
    });
    return liste;
  }, [niveauResultat]);

  // Changer de niveau réinitialise la simulation (les ids d'interrupteurs d'un autre
  // niveau n'ont aucun sens ici) — le mode nuit, lui, est une préférence de vue et reste.
  useEffect(() => { setInterrupteursOn({}); setVoletsOverride({}); }, [niveau.id]);

  // Ids des points lumineux actuellement allumés, dérivés des interrupteurs actifs.
  const lumieresAllumeesIds = useMemo(() => {
    const set = new Set<number>();
    interrupteurs.forEach(i => { if (interrupteursOn[i.id]) i.lumiereIds.forEach(id => set.add(id)); });
    return set;
  }, [interrupteurs, interrupteursOn]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const hauteurPlafond = niveau.hauteurPlafond ?? 2.5;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e7e5e4");
    sceneRef.current = scene;
    lumiereLightsRef.current.clear();
    voletsRef.current.clear();
    doublageMatsRef.current = [];

    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.05, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Ombres portées — condition sine qua non pour qu'un meuble (voir MeubleSimple plus bas)
    // bloque réellement la lumière d'un point lumineux au lieu de simplement décorer la
    // pièce. Coût mesuré nécessaire : chaque point lumineux allumé projette une ombre
    // cube-map ; acceptable ici (module desktop, pas d'optimisation mobile prévue).
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);
    dirLightRef.current = dirLight;

    const colorMap = resultat ? construireColorMap(resultat, [niveau]) : new Map<number, string>();

    // Position 3D réelle (sur la face du mur / au plafond) de chaque appareillage, par id —
    // utilisée pour que les câbles aboutissent AU appareillage et non à son point 2D brut.
    const posApp = new Map<string, THREE.Vector3>();

    // Les réglages d'un volet (caisson, ouverture) et la fenêtre qui lui donne ses dimensions
    // sont lus sur l'état VIVANT du niveau (niveau), pas sur le résultat de génération figé :
    // une modification se voit tout de suite, sans régénérer les circuits.
    const liveParId = new Map<number, AppareillagePlace>();
    niveau.pieces.forEach(p => p.appareillages.forEach(a => liveParId.set(a.id, a)));
    // Appareillages dont la liaison de circuit est réglée « Apparent » (coudes) : montés en saillie
    // avec goulotte — les mêmes dont les tronçons donnent de la moulure au pré-devis.
    const appareilsApparents = appareillagesEnPoseApparente(niveau, niveauResultat.pieces.flatMap(p => p.appareillages), resultat);

    // Sol + murs par pièce
    niveauResultat.pieces.forEach(piece => {
      if (piece.contour.length < 3) return;
      const spec = PIECE_TYPES[piece.type];

      // Sol
      const shape = new THREE.Shape(piece.contour.map(p => new THREE.Vector2(p.x, p.y)));
      const solGeo = new THREE.ShapeGeometry(shape);
      const solMat = new THREE.MeshStandardMaterial({ color: spec.color, side: THREE.DoubleSide });
      const sol = new THREE.Mesh(solGeo, solMat);
      sol.rotation.x = -Math.PI / 2;
      sol.receiveShadow = true;
      scene.add(sol);

      // Murs (un ou plusieurs pans de boîte par arête du contour, troués aux ouvertures) —
      // hauteur propre à la pièce si définie
      const hauteurMurs = piece.hauteurPlafond ?? hauteurPlafond;
      // Murs en teintes beige (et non blanc) pour que l'appareillage, blanc, ressorte dessus :
      // cloisons beige clair, murs extérieurs plus soutenus (enduit), doublage plus clair.
      const murMat = new THREE.MeshStandardMaterial({ color: 0xe3dccf });
      const murExtMat = new THREE.MeshStandardMaterial({ color: 0xcdc4b3 });
      const doublageMat = new THREE.MeshStandardMaterial({ color: 0xece8de });
      doublageMatsRef.current.push(doublageMat);
      piece.contour.forEach((a, i) => {
        const b = piece.contour[(i + 1) % piece.contour.length];
        const ouverturesSegment = ouverturesEffectivesMur(niveauResultat.pieces, piece, i);
        const m = parametresMur3D(piece, i);
        // Structure centrée sur l'axe, puis doublage côté intérieur : mêmes ouvertures sur les deux.
        construireMurAvecOuvertures(a, b, hauteurMurs, ouverturesSegment, m.e, m.type === "exterieur" ? murExtMat : murMat, scene,
          { extDebut: m.extDebut, extFin: m.extFin });
        if (m.d > 0) {
          construireMurAvecOuvertures(a, b, hauteurMurs - 0.003, ouverturesSegment, m.d, doublageMat, scene,
            { decalage: m.signeInterieur * (m.e / 2 + m.d / 2), avecContenu: false });
        }
      });

      // Appareillages — modèles 3D ressemblants (voir Modeles3D.ts), posés sur la FACE
      // INTÉRIEURE du mur le plus proche de leur pièce (orientés vers l'intérieur de la
      // pièce), ou au plafond pour un point lumineux. Un électroménager est posé au sol,
      // dos au mur.
      piece.appareillages.forEach(app => {
        const hCable = hauteurInstallation(app.type, app.hauteur, hauteurMurs);
        const couleurCircuitApp = showCircuits && app.circuitId != null ? colorMap.get(app.circuitId) : undefined;
        // Volet roulant : dimensions = celles de la fenêtre du mur (baieDuVolet), centré dessus,
        // coffre à l'intérieur ou à l'extérieur, tablier ouvert/fermé (setOuverture).
        if (app.type === "volet_roulant") {
          const live = liveParId.get(app.id) ?? app;
          const pieceLive = niveau.pieces.find(p => p.id === piece.id) ?? piece;
          const baie = baieDuVolet({ x: live.x, y: live.y }, pieceLive, niveau.pieces);
          const nxv = baie.ancrage?.normale.x ?? 0, nzv = baie.ancrage?.normale.y ?? 1;
          const segV = baie.ancrage?.segIndex ?? 0;
          const recul = faceInterieureM(pieceLive, segV) + 0.002;   // face intérieure FINIE (après doublage)
          const vol = creerVoletRoulant({
            largeur: baie.largeur, hauteur: baie.hauteur, allege: baie.allege,
            caisson: live.caisson ?? "interieur", epaisseurMur: epaisseurTotaleM(pieceLive, segV) + 0.004, plafond: hauteurMurs,
            ouvertPct: live.voletOuvertPct ?? 0, couleur: live.voletCouleur, couleurCircuit: couleurCircuitApp,
          });
          const pxv = baie.centre.x + nxv * recul, pzv = baie.centre.y + nzv * recul;
          vol.groupe.position.set(pxv, 0, pzv);
          vol.groupe.rotation.y = Math.atan2(nxv, nzv);
          scene.add(vol.groupe);
          voletsRef.current.set(app.id, { modele: vol, defaut: live.voletOuvertPct ?? 0 });
          posApp.set(String(app.id), new THREE.Vector3(pxv, vol.hautMoteur, pzv)); // câble → moteur
          return;
        }
        const modele = creerModeleAppareillage(app.type, couleurCircuitApp, liveParId.get(app.id)?.couleur);
        let px = app.x, pz = app.y, py = hCable, rotY = 0;
        let nx = 0, nz = 0; // direction "vers l'intérieur" (monde), pour décaler les lumières
        let murPose: ReturnType<typeof parametresMur3D> | null = null; // mur d'accueil (pose des câbles, doublage)
        if (modele.montage === "plafond") {
          py = hCable;
        } else {
          const anc = ancrageMurLePlusProche({ x: app.x, y: app.y }, piece.contour);
          if (anc) {
            const recul = faceInterieureM(piece, anc.segIndex) + 0.002; // face intérieure FINIE du mur (après doublage)
            px = anc.pied.x + anc.normale.x * recul;
            pz = anc.pied.y + anc.normale.y * recul;
            nx = anc.normale.x; nz = anc.normale.y;
            rotY = Math.atan2(anc.normale.x, anc.normale.y); // +z local → normale intérieure
            murPose = parametresMur3D(piece, anc.segIndex);
          }
          py = modele.montage === "sol_mur" ? 0 : Math.max(hCable, modele.demiHauteur);
        }
        // Pose du CIRCUIT : "apparent" → boîtier en saillie + goulotte jusqu'au plafond ;
        // "encastre" (défaut) → appareil à fleur, et (circuit affiché) câble dessiné DANS le doublage
        // (ou la structure sans doublage) — masqué par le mur, visible en mode « Coupe ».
        const apparent = appareilsApparents.has(app.id) && TYPES_POSE_APPARENTE.includes(app.type);
        const racine = apparent && murPose ? habillerEnSaillie(modele, py, hauteurMurs) : modele.groupe;
        if (murPose && !apparent && TYPES_POSE_APPARENTE.includes(app.type) && couleurCircuitApp) {
          const profondeur = murPose.d > 0 ? murPose.d / 2 : 0.025;        // milieu du doublage, sinon saignée de 2,5 cm
          const longueurCable = Math.max(0, hauteurMurs - 0.05 - (py + 0.04));
          if (longueurCable > 0.02) {
            const cable = new THREE.Mesh(
              new THREE.CylinderGeometry(0.005, 0.005, longueurCable, 8),
              new THREE.MeshStandardMaterial({ color: couleurCircuitApp, emissive: couleurCircuitApp, emissiveIntensity: 0.35 }));
            cable.position.set(0, 0.04 + longueurCable / 2, -profondeur - 0.002);
            racine.add(cable);
          }
        }
        racine.position.set(px, py, pz);
        racine.rotation.y = rotY;
        scene.add(racine);
        // Extrémité des câbles : au point de raccordement (hauteur d'installation), sur le mur.
        posApp.set(String(app.id), new THREE.Vector3(px, hCable, pz));

        // Point lumineux/applique : lumière réelle en plus du modèle, éteinte par défaut —
        // allumée/éteinte via le panneau de simulation (voir lumiereLightsRef, syncEclairage).
        // Un plafonnier éclaire vers le bas en cône (SpotLight, cible au sol) ; une applique
        // rayonne autour d'elle (PointLight), décalée de 12 cm devant le mur.
        if (app.type === "point_lumineux" && modele.ampoule) {
          const light = new THREE.SpotLight(0xffe0ab, 0, 6, Math.PI / 2.6, 0.5, 1.5);
          light.position.set(app.x, hCable - 0.12, app.y);
          light.target.position.set(app.x, 0, app.y);
          scene.add(light.target);
          light.castShadow = true;
          light.shadow.mapSize.set(512, 512);
          light.shadow.camera.near = 0.1;
          light.shadow.camera.far = light.distance;
          scene.add(light);
          lumiereLightsRef.current.set(app.id, { light, mat: modele.ampoule });
        } else if (app.type === "applique" && modele.ampoule) {
          const light = new THREE.PointLight(0xffe0ab, 0, 3, 2);
          light.position.set(px + nx * 0.12, py, pz + nz * 0.12);
          light.castShadow = true;
          light.shadow.mapSize.set(512, 512);
          light.shadow.camera.near = 0.1;
          light.shadow.camera.far = light.distance;
          scene.add(light);
          lumiereLightsRef.current.set(app.id, { light, mat: modele.ampoule });
        }
      });

      // Mobilier simple — bloque/façonne réellement la lumière des points lumineux
      // (voir renderer.shadowMap plus haut) : purement visuel, aucune portée électrique.
      (piece.meubles ?? []).forEach((m: MeubleSimple) => {
        const geo = new THREE.BoxGeometry(m.largeur, m.hauteur, m.profondeur);
        const mat = new THREE.MeshStandardMaterial({ color: m.couleur || "#A8A29E", roughness: 0.85 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(m.x, m.hauteur / 2, m.y);
        mesh.rotation.y = -((m.rotation ?? 0) * Math.PI) / 180;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
      });
    });

    // Tableau électrique — armoire repérable (couleur, liseré et étiquette "TGBT"),
    // positionné à sa hauteur d'installation réelle.
    if (niveau.tableauPos) {
      const hTableau = niveau.tableauHauteur != null ? niveau.tableauHauteur / 100 : HAUTEUR_TABLEAU_DEFAUT;
      const groupeTableau = new THREE.Group();
      const corpsGeo = new THREE.BoxGeometry(0.4, 0.5, 0.1);
      const corpsMat = new THREE.MeshStandardMaterial({ color: 0x292524 });
      groupeTableau.add(new THREE.Mesh(corpsGeo, corpsMat));
      const liseretGeo = new THREE.BoxGeometry(0.42, 0.06, 0.11);
      const liseretMat = new THREE.MeshStandardMaterial({ color: 0xFBBF24, emissive: 0xFBBF24, emissiveIntensity: 0.4 });
      const liseret = new THREE.Mesh(liseretGeo, liseretMat);
      liseret.position.set(0, 0.22, 0);
      groupeTableau.add(liseret);
      const etiquetteTableau = creerEtiquetteSprite("TGBT", "#FBBF24");
      etiquetteTableau.position.set(0, 0.42, 0.08);
      groupeTableau.add(etiquetteTableau);
      groupeTableau.position.set(niveau.tableauPos.x, hTableau, niveau.tableauPos.y);
      groupeTableau.rotation.y = -((niveau.tableauRotation ?? 0) * Math.PI) / 180;
      scene.add(groupeTableau);
    }

    // Circuits — tracé 3D en tenant compte des coudes manuels et de leur hauteur. Topologie
    // en étoile pour l'éclairage (une seule boîte de dérivation, jamais de chaîne en série).
    if (showCircuits && resultat && origineCircuits(niveau)) {
      // Origine du tracé : le point d'arrivée des gaines quand il est configuré sur ce
      // niveau (cohérent avec le plan 2D et le calcul de facturation, predevis-engine.ts —
      // origineCalcul), sinon le tableau directement.
      const tableauPos = origineCircuits(niveau)!;
      const hauteurTableau = niveau.tableauHauteur != null ? niveau.tableauHauteur / 100 : HAUTEUR_TABLEAU_DEFAUT;
      const hauteurCoudeParDefaut = hauteurPlafond - 0.1;
      const tousAppareils = niveauResultat.pieces.flatMap(p => p.appareillages);
      const parCircuit = new Map<number, typeof tousAppareils>();
      tousAppareils.forEach(a => {
        if (a.circuitId == null) return;
        const arr = parCircuit.get(a.circuitId) ?? [];
        arr.push(a);
        parCircuit.set(a.circuitId, arr);
      });
      const hauteurAncre = (id: string): number => {
        if (id === "tableau") return hauteurTableau;
        if (id === "boite" || id.startsWith("boite-")) return hauteurCoudeParDefaut;
        const pa = posApp.get(id);
        return pa ? pa.y : 1.0;
      };
      // Point 3D d'une ancre : l'appareillage lui-même (sur son mur) s'il existe, sinon le
      // point plan brut (tableau, boîtes de dérivation).
      const ancre3D = (id: string, pt: { x: number; y: number }): THREE.Vector3 => {
        const pa = posApp.get(id);
        return pa ? pa.clone() : new THREE.Vector3(pt.x, hauteurAncre(id), pt.y);
      };
      parCircuit.forEach((points, circuitId) => {
        const breaker = resultat.breakers.find(b => b.id === circuitId);
        if (!breaker) return;
        const color = colorMap.get(circuitId) ?? "#666666";
        const segments = segmentsPourCircuit(breaker, points, niveau, tableauPos);
        segments.forEach(seg => {
          if (seg.type === "domotique") {
            // Liaison sans fil (domotique) — pas de coudes de gaine à représenter (aucun
            // câble physique à faire cheminer) : tracé en onde entre les deux ancres,
            // pointillé, pour se distinguer visuellement du reste du câblage.
            const hA = hauteurAncre(seg.aId), hB = hauteurAncre(seg.bId);
            const waveXZ = pointsOndulesEntre(seg.aPoint, seg.bPoint);
            const pts3D = waveXZ.map((p, i) => new THREE.Vector3(p.x, hA + (hB - hA) * (i / Math.max(1, waveXZ.length - 1)), p.y));
            const geo = new THREE.BufferGeometry().setFromPoints(pts3D);
            const mat = new THREE.LineDashedMaterial({ color, dashSize: 0.05, gapSize: 0.04 });
            const ligne = new THREE.Line(geo, mat);
            ligne.computeLineDistances();
            scene.add(ligne);
            return;
          }
          const cle = cleSegmentLiaison(seg.aId, seg.bId);
          const coudes = niveau.liaisonWaypoints?.[cle] ?? [];
          const pts3D: THREE.Vector3[] = [ancre3D(seg.aId, seg.aPoint)];
          coudes.forEach(c => {
            const h = c.hauteur != null ? c.hauteur / 100 : hauteurCoudeParDefaut;
            pts3D.push(new THREE.Vector3(c.point.x, h, c.point.y));
          });
          pts3D.push(ancre3D(seg.bId, seg.bPoint));
          const geo = new THREE.BufferGeometry().setFromPoints(pts3D);
          // Liaison (navette) entre deux va-et-vient : couleur du circuit assombrie, comme
          // en 2D — reste rattachée au circuit tout en se distinguant du reste du tracé.
          const mat = new THREE.LineBasicMaterial({ color: seg.type === "navette" ? assombrirCouleur(color) : color });
          scene.add(new THREE.Line(geo, mat));
          // Sections APPARENTES (le câble sort du mur) : moulure PVC 20 × 14 mm le long de la section,
          // translucide pour laisser voir le câble coloré à l'intérieur. Encastré = rien de plus.
          const poses = posesTroncons(niveau, cle, coudes);
          for (let j = 0; j < pts3D.length - 1; j++) {
            if (poses[j] !== "apparent") continue;
            const p0 = pts3D[j], p1 = pts3D[j + 1];
            const longueur = p0.distanceTo(p1);
            if (longueur < 0.02) continue;
            const moulure = new THREE.Mesh(
              new THREE.BoxGeometry(0.02, 0.014, longueur),
              new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
            moulure.position.copy(p0).add(p1).multiplyScalar(0.5);
            moulure.lookAt(p1);   // l'axe long de la boîte (z) suit la section
            scene.add(moulure);
          }
        });

        // Boîte(s) de dérivation — un petit repère cubique par boîte nommée, à la hauteur
        // par défaut des coudes (sous plafond) ; sans boîte nommée, une seule implicite au
        // centroïde des lampes (comportement historique).
        if (breaker.circuit === "lumiere") {
          const lumieres = points.filter(a => a.type === "point_lumineux" || a.type === "applique");
          const boitesExistantes = niveau.boitesDerivation?.[breaker.label] ?? [];
          const dessinerBoite3D = (pt: { x: number; y: number }, ancreId: string) => {
            const geo = new THREE.BoxGeometry(0.08, 0.05, 0.08);
            const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(pt.x, hauteurAncre(ancreId), pt.y);
            scene.add(mesh);
          };
          if (boitesExistantes.length > 0) {
            boitesExistantes.forEach(b => dessinerBoite3D(b.point, `boite-${b.id}`));
          } else if (lumieres.length > 1) {
            const centre = { x: lumieres.reduce((s, l) => s + l.x, 0) / lumieres.length, y: lumieres.reduce((s, l) => s + l.y, 0) / lumieres.length };
            dessinerBoite3D(centre, "boite");
          }
        }
      });
    }

    // Cadrage caméra sur l'ensemble du niveau
    const tousPts = niveauResultat.pieces.flatMap(p => p.contour);
    let cx = 0, cy = 0;
    if (tousPts.length > 0) {
      const c = centroide(tousPts);
      cx = c.x; cy = c.y;
    }
    const xs = tousPts.map(p => p.x), ys = tousPts.map(p => p.y);
    const etendue = tousPts.length > 0
      ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 4)
      : 8;

    // ── Caméra orbitale manuelle (coordonnées sphériques autour de la cible) ──
    // La cible ("cible") n'est plus figée sur le centre du niveau : le glisser-déplacer
    // (clic droit, ou Maj + clic gauche) la déplace dans le plan de l'écran, ce qui permet
    // de cadrer n'importe quel angle de vue pour l'impression — pas seulement tourner
    // autour d'un point fixe.
    const cible = new THREE.Vector3(cx, hauteurPlafond / 2, cy);
    let rayon = etendue * 1.1;
    let azimut = Math.PI / 4;
    let polaire = Math.PI / 3; // 0 = vue du dessus, PI/2 = vue de côté

    const appliquerCamera = () => {
      const x = cible.x + rayon * Math.sin(polaire) * Math.sin(azimut);
      const y = cible.y + rayon * Math.cos(polaire);
      const z = cible.z + rayon * Math.sin(polaire) * Math.cos(azimut);
      camera.position.set(x, y, z);
      camera.lookAt(cible);
    };
    appliquerCamera();

    type Interaction = "rotation" | "deplacement" | null;
    let interaction: Interaction = null;
    let dernierX = 0, dernierY = 0;
    // Vecteurs de travail réutilisés à chaque déplacement (évite une allocation par frame).
    const axeDroite = new THREE.Vector3();
    const axeHaut = new THREE.Vector3();

    const onPointerDown = (e: PointerEvent) => {
      interaction = (e.button === 2 || e.shiftKey) ? "deplacement" : "rotation";
      dernierX = e.clientX; dernierY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!interaction) return;
      const dx = e.clientX - dernierX, dy = e.clientY - dernierY;
      dernierX = e.clientX; dernierY = e.clientY;
      if (interaction === "rotation") {
        azimut -= dx * 0.006;
        polaire = Math.min(Math.PI - 0.05, Math.max(0.05, polaire - dy * 0.006));
      } else {
        // Translation dans le plan écran (droite/haut de la caméra courante), à une vitesse
        // proportionnelle à la distance à la cible — pour que le déplacement "suive" la
        // souris pareil, qu'on soit zoomé de près ou vu de loin.
        camera.updateMatrixWorld();
        axeDroite.setFromMatrixColumn(camera.matrixWorld, 0);
        axeHaut.setFromMatrixColumn(camera.matrixWorld, 1);
        const facteur = rayon * 0.0016;
        cible.addScaledVector(axeDroite, -dx * facteur);
        cible.addScaledVector(axeHaut, dy * facteur);
      }
      appliquerCamera();
    };
    const onPointerUp = () => { interaction = null; };
    const onContextMenu = (e: MouseEvent) => e.preventDefault(); // clic droit = déplacer, pas de menu navigateur
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      rayon = Math.min(etendue * 6, Math.max(etendue * 0.15, rayon * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
      appliquerCamera();
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.dispose();
      scene.traverse(obj => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        } else if (obj instanceof THREE.Sprite) {
          obj.material.map?.dispose();
          obj.material.dispose();
        }
      });
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      rendererRef.current = null;
      sceneRef.current = null;
      ambientLightRef.current = null;
      dirLightRef.current = null;
      lumiereLightsRef.current.clear();
      voletsRef.current.clear();
    };
  }, [niveau, resultat, showCircuits, niveauResultat]);

  // Applique l'état courant (interrupteurs allumés + mode nuit) aux objets three.js déjà
  // construits, sans reconstruire la scène. Dépend aussi de [niveauResultat, showCircuits]
  // pour se réappliquer juste après une reconstruction de la scène (effet ci-dessus), qui
  // recrée l'éclairage ambiant et les lumières à leur état par défaut (éteint / plein jour).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (nightMode) {
      scene.background = new THREE.Color("#0b1220");
      if (ambientLightRef.current) ambientLightRef.current.intensity = 0.12;
      if (dirLightRef.current) dirLightRef.current.intensity = 0.15;
    } else {
      scene.background = new THREE.Color("#e7e5e4");
      if (ambientLightRef.current) ambientLightRef.current.intensity = 0.7;
      if (dirLightRef.current) dirLightRef.current.intensity = 0.8;
    }

    lumiereLightsRef.current.forEach((entry, id) => {
      const allumee = lumieresAllumeesIds.has(id);
      entry.light.intensity = allumee ? (nightMode ? 2.4 : 1.4) : 0;
      entry.mat.emissiveIntensity = allumee ? (nightMode ? 1.4 : 0.9) : 0.15;
    });
  }, [nightMode, lumieresAllumeesIds, niveauResultat, showCircuits]);

  // Mode « Coupe » : doublage translucide, pour voir les câbles encastrés qu'il abrite.
  useEffect(() => {
    doublageMatsRef.current.forEach(mat => {
      mat.transparent = coupeDoublage;
      mat.opacity = coupeDoublage ? 0.18 : 1;
      mat.depthWrite = !coupeDoublage;
      mat.needsUpdate = true;
    });
  }, [coupeDoublage, niveau, resultat, showCircuits, niveauResultat]);

  // Volets roulants du niveau (état vivant) — alimente le panneau 3D.
  const volets = useMemo(
    () => niveau.pieces.flatMap(p => p.appareillages
      .filter(a => a.type === "volet_roulant")
      .map(a => ({ id: a.id, label: a.nom || "Volet", pieceNom: p.nom, defaut: a.voletOuvertPct ?? 0 }))),
    [niveau],
  );

  // Applique l'ouverture courante à chaque volet déjà construit (sans reconstruire la scène) ;
  // mêmes dépendances que l'effet de construction pour se réappliquer après chaque reconstruction.
  useEffect(() => {
    voletsRef.current.forEach((entry, id) => entry.modele.setOuverture(voletsOverride[id] ?? entry.defaut));
  }, [voletsOverride, niveau, resultat, showCircuits, niveauResultat]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" style={{ touchAction: "none", cursor: "grab" }} />

      {/* Coupe : doublage translucide → câbles encastrés visibles dans l'épaisseur du mur */}
      <button onClick={() => setCoupeDoublage(c => !c)}
        className={`absolute top-3 right-3 btn-ghost !text-xs backdrop-blur ${coupeDoublage ? "!bg-ink-900 !text-volt-400" : "!bg-white/90"}`}
        title="Rend le doublage translucide pour voir passer les câbles encastrés (circuits affichés)">
        {coupeDoublage ? "Doublage opaque" : "Coupe du doublage"}
      </button>

      {(interrupteurs.length > 0 || volets.length > 0) && (
        <div className="absolute inset-x-0 bottom-0 p-3 flex flex-col gap-2 pointer-events-none">
          {interrupteurs.length > 0 && (
            <>
              <div className="flex items-center gap-2 pointer-events-auto">
                <button
                  onClick={() => setInterrupteursOn(Object.fromEntries(interrupteurs.map(i => [i.id, true])))}
                  className="btn-ghost !text-xs !bg-white/90 backdrop-blur">
                  Tout allumer
                </button>
                <button
                  onClick={() => setInterrupteursOn({})}
                  className="btn-ghost !text-xs !bg-white/90 backdrop-blur">
                  Tout éteindre
                </button>
                <button
                  onClick={() => setNightMode(m => !m)}
                  className={`btn-ghost !text-xs !ml-auto backdrop-blur ${nightMode ? "!bg-ink-900 !text-volt-400" : "!bg-white/90"}`}>
                  {nightMode ? "☀️ Mode jour" : "🌙 Mode nuit"}
                </button>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto pointer-events-auto pb-1">
                {interrupteurs.map(i => {
                  const actif = !!interrupteursOn[i.id];
                  return (
                    <button
                      key={i.id}
                      onClick={() => setInterrupteursOn(s => ({ ...s, [i.id]: !s[i.id] }))}
                      className={`shrink-0 card !py-1.5 !px-3 text-left transition-colors ${actif ? "!border-volt-500 !bg-volt-50" : "!bg-white/90"}`}>
                      <div className="text-[10px] uppercase tracking-wide text-ink-400">{i.pieceNom}</div>
                      <div className="text-xs font-semibold text-ink-900 flex items-center gap-1.5">
                        <span className={`inline-block w-2 h-2 rounded-full ${actif ? "bg-volt-500" : "bg-ink-300"}`} />
                        {i.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {volets.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pointer-events-auto pb-1">
              <button
                onClick={() => setVoletsOverride(Object.fromEntries(volets.map(v => [v.id, 100])))}
                className="shrink-0 btn-ghost !text-xs !bg-white/90 backdrop-blur">
                Ouvrir les volets
              </button>
              <button
                onClick={() => setVoletsOverride(Object.fromEntries(volets.map(v => [v.id, 0])))}
                className="shrink-0 btn-ghost !text-xs !bg-white/90 backdrop-blur">
                Fermer les volets
              </button>
              {volets.map(v => {
                const pct = voletsOverride[v.id] ?? v.defaut;
                return (
                  <div key={v.id} className="shrink-0 card !py-1.5 !px-3 !bg-white/90 backdrop-blur">
                    <div className="text-[10px] uppercase tracking-wide text-ink-400">{v.pieceNom}</div>
                    <div className="text-xs font-semibold text-ink-900">{v.label} — {pct >= 100 ? "ouvert" : pct <= 0 ? "fermé" : `ouvert à ${pct} %`}</div>
                    <input type="range" min={0} max={100} step={5} value={pct} className="w-32"
                      onChange={e => setVoletsOverride(s => ({ ...s, [v.id]: Number(e.target.value) }))} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default Vue3D;
