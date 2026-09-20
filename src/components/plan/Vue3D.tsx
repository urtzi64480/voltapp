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

import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import { Niveau, PIECE_TYPES, centroide, AppareillageType, OuvertureEffective, ouverturesEffectivesMur, cleSegmentLiaison } from "@/lib/maison-types";
import { ResultatGeneration, construireColorMap, segmentsPourCircuit } from "@/lib/maison-engine";
import { initialesAppareillage } from "@/components/plan/AppareillageSymbols";

const EPAISSEUR_MUR = 0.1; // mètres

// Hauteur d'installation par défaut (mètres) quand l'appareillage n'a pas de hauteur saisie.
const HAUTEUR_DEFAUT: Partial<Record<AppareillageType, number>> = {
  prise: 0.3, prise_commandee: 0.3,
  interrupteur: 1.1, va_et_vient: 1.1, telerupteur: 1.1,
  applique: 1.8,
  four: 0.6, plaque: 0.9, lave_linge: 0.85, lave_vaisselle: 0.85, seche_linge: 0.85,
  chauffe_eau: 1.8, chauffage: 0.3, clim: 2.0, seche_serviette: 1.2, congelateur: 0.85,
  irve: 1.0, piscine: 0.3, vmc: 2.2, alarme: 2.0,
};

// Hauteur d'installation par défaut du tableau électrique (mètres) quand non précisée.
const HAUTEUR_TABLEAU_DEFAUT = 1.5;

// ─── IDENTITÉ VISUELLE 3D DES APPAREILLAGES ────────────────────────────────────
// Chaque appareillage a, en plus de sa position/hauteur réelles, une forme et une
// couleur propres à son type (au lieu d'un simple point noir) + une étiquette
// (initiales) toujours face caméra pour l'identifier sans ambiguïté.

type FormeMarqueur = "plaque" | "ampoule" | "boite" | "cylindre";

const FORME_PAR_TYPE: Record<AppareillageType, FormeMarqueur> = {
  prise: "plaque", prise_commandee: "plaque",
  interrupteur: "plaque", va_et_vient: "plaque", telerupteur: "plaque",
  point_lumineux: "ampoule", applique: "ampoule",
  four: "boite", plaque: "boite", lave_linge: "boite", lave_vaisselle: "boite", seche_linge: "boite",
  chauffe_eau: "boite", chauffage: "boite", clim: "boite", seche_serviette: "boite", congelateur: "boite",
  irve: "cylindre", piscine: "cylindre", vmc: "cylindre", alarme: "cylindre",
};

const COULEUR_PAR_TYPE: Record<AppareillageType, string> = {
  prise: "#F59E0B", prise_commandee: "#D97706",
  point_lumineux: "#FDE68A", applique: "#FCD34D",
  interrupteur: "#3B82F6", va_et_vient: "#2563EB", telerupteur: "#1D4ED8",
  four: "#DC2626", plaque: "#EA580C", lave_linge: "#0EA5E9", lave_vaisselle: "#0284C7",
  seche_linge: "#0369A1", chauffe_eau: "#F97316", chauffage: "#EF4444", clim: "#06B6D4",
  seche_serviette: "#F472B6", congelateur: "#818CF8",
  irve: "#22C55E", piscine: "#14B8A6", vmc: "#A78BFA", alarme: "#EF4444",
};

function creerGeometrieMarqueur(forme: FormeMarqueur): THREE.BufferGeometry {
  switch (forme) {
    case "plaque": return new THREE.BoxGeometry(0.09, 0.09, 0.018);
    case "ampoule": return new THREE.SphereGeometry(0.055, 16, 16);
    case "cylindre": return new THREE.CylinderGeometry(0.05, 0.05, 0.14, 14);
    case "boite": default: return new THREE.BoxGeometry(0.13, 0.13, 0.13);
  }
}

// Étiquette ronde (initiales) toujours orientée face caméra — c'est elle qui rend
// chaque appareillage identifiable au premier coup d'œil dans la vue 3D.
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
  const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.22, 0.22, 1);
  sprite.renderOrder = 999;
  return sprite;
}

// ─── MURS AVEC OUVERTURES (portes/fenêtres) ────────────────────────────────────
// Un mur plein = une seule boîte par arête du contour (comportement historique).
// Un mur avec ouverture(s) = plusieurs boîtes disposées pour laisser un trou :
// un linteau plein au-dessus de l'ouverture jusqu'au plafond, une allège pleine
// en dessous pour une fenêtre (une porte va jusqu'au sol, pas d'allège), et les
// pans de mur pleins entre deux ouvertures ou jusqu'aux extrémités du segment.
function construireMurAvecOuvertures(
  a: { x: number; y: number }, b: { x: number; y: number }, hauteurMur: number,
  ouvertures: OuvertureEffective[], epaisseur: number, murMat: THREE.Material, scene: THREE.Scene,
): void {
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
    mesh.position.set(a.x + ux * centreLong, centreHauteur, a.y + uy * centreLong);
    mesh.rotation.y = -angle;
    scene.add(mesh);
  };

  const segs = ouvertures
    .map(o => ({ o, centre: Math.min(longueur, Math.max(0, o.position * longueur)), larg: o.largeur / 100 }))
    .sort((s1, s2) => s1.centre - s2.centre);

  if (segs.length === 0) {
    ajouterPan(longueur / 2, longueur, hauteurMur / 2, hauteurMur);
    return;
  }

  let curseur = 0;
  segs.forEach(({ o, centre, larg }) => {
    const debut = Math.max(curseur, centre - larg / 2);
    const fin = Math.min(longueur, centre + larg / 2);
    if (fin <= debut) return; // ouvertures qui se chevauchent — on ignore le chevauchement
    if (debut > curseur) ajouterPan((curseur + debut) / 2, debut - curseur, hauteurMur / 2, hauteurMur);

    const hAllege = (o.allege ?? 0) / 100;
    const hOuverture = (o.hauteur ?? (o.type === "porte" || o.type === "porte_coulissante" ? 204 : 120)) / 100;
    const hLinteauBas = Math.min(hauteurMur, hAllege + hOuverture);
    // Le trou lui-même (linteau + allège) est percé des DEUX côtés d'un mur mitoyen —
    // sinon on verrait un mur plein depuis l'autre pièce. Le contenu (vitrage, panneau
    // coulissant) n'est en revanche dessiné qu'une fois, côté propriétaire de l'ouverture.
    if (hLinteauBas < hauteurMur - 0.01) ajouterPan((debut + fin) / 2, fin - debut, (hLinteauBas + hauteurMur) / 2, hauteurMur - hLinteauBas);
    if (hAllege > 0.01) ajouterPan((debut + fin) / 2, fin - debut, hAllege / 2, hAllege);

    if (o.proprietaire && o.type === "fenetre") {
      const vitreGeo = new THREE.BoxGeometry(fin - debut, hOuverture, 0.01);
      const vitreMat = new THREE.MeshStandardMaterial({ color: 0xBAE6FD, transparent: true, opacity: 0.35 });
      const vitre = new THREE.Mesh(vitreGeo, vitreMat);
      vitre.position.set(a.x + ux * ((debut + fin) / 2), hAllege + hOuverture / 2, a.y + uy * ((debut + fin) / 2));
      vitre.rotation.y = -angle;
      scene.add(vitre);
    }

    if (o.proprietaire && o.type === "porte_coulissante") {
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
  if (curseur < longueur) ajouterPan((curseur + longueur) / 2, longueur - curseur, hauteurMur / 2, hauteurMur);
}

function creerMarqueurAppareillage(type: AppareillageType, couleur: string): THREE.Group {
  const groupe = new THREE.Group();
  const forme = FORME_PAR_TYPE[type];
  const geo = creerGeometrieMarqueur(forme);
  const estAmpoule = forme === "ampoule";
  const mat = new THREE.MeshStandardMaterial({
    color: couleur,
    emissive: estAmpoule ? couleur : 0x000000,
    emissiveIntensity: estAmpoule ? 0.7 : 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  groupe.add(mesh);
  const etiquette = creerEtiquetteSprite(initialesAppareillage(type), couleur);
  etiquette.position.set(0, 0.13, 0);
  groupe.add(etiquette);
  return groupe;
}

export interface Vue3DHandle {
  capturerImage: () => string | null;
}

const Vue3D = forwardRef<Vue3DHandle, {
  niveau: Niveau; resultat: ResultatGeneration | null; showCircuits: boolean;
}>(function Vue3D({ niveau, resultat, showCircuits }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  useImperativeHandle(ref, () => ({
    capturerImage: () => rendererRef.current?.domElement.toDataURL("image/png") ?? null,
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const hauteurPlafond = niveau.hauteurPlafond ?? 2.5;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e7e5e4");

    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.05, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);

    // ── Repère : x du plan → x 3D, y du plan → z 3D (profondeur), hauteur → y 3D (vertical) ──

    const niveauResultat = resultat?.maison.niveaux.find(n => n.id === niveau.id) ?? niveau;
    const colorMap = resultat ? construireColorMap(resultat) : new Map<number, string>();

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
      scene.add(sol);

      // Murs (un ou plusieurs pans de boîte par arête du contour, troués aux ouvertures) —
      // hauteur propre à la pièce si définie
      const hauteurMurs = piece.hauteurPlafond ?? hauteurPlafond;
      const murMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f4 });
      piece.contour.forEach((a, i) => {
        const b = piece.contour[(i + 1) % piece.contour.length];
        const ouverturesSegment = ouverturesEffectivesMur(niveauResultat.pieces, piece, i);
        construireMurAvecOuvertures(a, b, hauteurMurs, ouverturesSegment, EPAISSEUR_MUR, murMat, scene);
      });

      // Appareillages — forme + couleur propres au type + étiquette d'initiales face
      // caméra, pour être identifiables d'un coup d'œil (jamais un simple point noir).
      piece.appareillages.forEach(app => {
        const h = app.hauteur != null ? app.hauteur / 100 : (HAUTEUR_DEFAUT[app.type] ?? 1.0);
        const couleurCircuitApp = showCircuits && app.circuitId != null ? colorMap.get(app.circuitId) : undefined;
        const couleur = couleurCircuitApp ?? COULEUR_PAR_TYPE[app.type] ?? "#78716c";
        const marker = creerMarqueurAppareillage(app.type, couleur);
        marker.position.set(app.x, h, app.y);
        scene.add(marker);
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
    if (showCircuits && resultat && niveau.tableauPos) {
      const tableauPos = niveau.tableauPos;
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
        if (id === "boite") return hauteurCoudeParDefaut;
        const app = tousAppareils.find(a => String(a.id) === id);
        if (!app) return 1.0;
        return app.hauteur != null ? app.hauteur / 100 : (HAUTEUR_DEFAUT[app.type] ?? 1.0);
      };
      parCircuit.forEach((points, circuitId) => {
        const breaker = resultat.breakers.find(b => b.id === circuitId);
        if (!breaker) return;
        const color = colorMap.get(circuitId) ?? "#666666";
        const segments = segmentsPourCircuit(breaker, points, niveau, tableauPos);
        segments.forEach(seg => {
          const cle = cleSegmentLiaison(seg.aId, seg.bId);
          const coudes = niveau.liaisonWaypoints?.[cle] ?? [];
          const pts3D: THREE.Vector3[] = [new THREE.Vector3(seg.aPoint.x, hauteurAncre(seg.aId), seg.aPoint.y)];
          coudes.forEach(c => {
            const h = c.hauteur != null ? c.hauteur / 100 : hauteurCoudeParDefaut;
            pts3D.push(new THREE.Vector3(c.point.x, h, c.point.y));
          });
          pts3D.push(new THREE.Vector3(seg.bPoint.x, hauteurAncre(seg.bId), seg.bPoint.y));
          const geo = new THREE.BufferGeometry().setFromPoints(pts3D);
          const mat = new THREE.LineBasicMaterial({ color });
          scene.add(new THREE.Line(geo, mat));
        });

        // Boîte de dérivation — petit repère cubique identifiable, à la hauteur par défaut
        // des coudes (sous plafond), là où convergent les branches en étoile.
        if (breaker.circuit === "lumiere") {
          const lumieres = points.filter(a => a.type === "point_lumineux" || a.type === "applique");
          if (lumieres.length > 1) {
            const boitePos = niveau.boitesDerivation?.[breaker.label]
              ?? { x: lumieres.reduce((s, l) => s + l.x, 0) / lumieres.length, y: lumieres.reduce((s, l) => s + l.y, 0) / lumieres.length };
            const geo = new THREE.BoxGeometry(0.08, 0.05, 0.08);
            const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
            const boite = new THREE.Mesh(geo, mat);
            boite.position.set(boitePos.x, hauteurAncre("boite"), boitePos.y);
            scene.add(boite);
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

    let enRotation = false;
    let dernierX = 0, dernierY = 0;
    const onPointerDown = (e: PointerEvent) => { enRotation = true; dernierX = e.clientX; dernierY = e.clientY; };
    const onPointerMove = (e: PointerEvent) => {
      if (!enRotation) return;
      const dx = e.clientX - dernierX, dy = e.clientY - dernierY;
      dernierX = e.clientX; dernierY = e.clientY;
      azimut -= dx * 0.006;
      polaire = Math.min(Math.PI - 0.05, Math.max(0.05, polaire - dy * 0.006));
      appliquerCamera();
    };
    const onPointerUp = () => { enRotation = false; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      rayon = Math.min(etendue * 6, Math.max(etendue * 0.15, rayon * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
      appliquerCamera();
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
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
    };
  }, [niveau, resultat, showCircuits]);

  return <div ref={containerRef} className="w-full h-full" style={{ touchAction: "none", cursor: "grab" }} />;
});

export default Vue3D;
