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
import { Niveau, PIECE_TYPES, hauteurOuvertureDefautCm, centroide, AppareillageType, OuvertureEffective, Ouverture, UsagePorte, LABEL_USAGE_PORTE, ouverturesEffectivesMur, cleSegmentLiaison, assombrirCouleur, pointsOndulesEntre, MeubleSimple, origineCircuits, AppareillagePlace, estCommande, estCommandeDouble, baseCommande, HAUTEUR_PERSONNE_M, VOITURE_LONGUEUR_M, VOITURE_LARGEUR_M, VOITURE_HAUTEUR_M } from "@/lib/maison-types";
import { ResultatGeneration, construireColorMap, segmentsPourCircuit } from "@/lib/maison-engine";
import { creerModeleAppareillage, creerVoletRoulant, ModeleVolet, habillerEnSaillie, TYPES_POSE_APPARENTE } from "@/components/plan/Modeles3D";
import { PorteRegistre, appliquerOuverturePorte, creerPorteBattante, creerPorteCoulissante, creerBaieVitree, creerPorteGarage } from "@/components/plan/PortesOuvrables";
import { ancrageMurLePlusProche, baieDuVolet } from "@/lib/appareillage-mur";
import { cloisonsDeZone, ouverturesEffectivesZone } from "@/lib/zones";
import { SaisonSoleil, LABEL_SAISON_SOLEIL, LATITUDE_DEFAUT, elevationMidi, directionSoleilMidi } from "@/lib/soleil";
import { parametresMur3D, geometrieMurs, surfaceUtile, faceInterieureM, epaisseurTotaleM, HAUTEUR_DEFAUT, preparerMurs, pointDansCouche2 } from "@/lib/murs";
import { appareillagesEnPoseApparente, posesTroncons, hauteursTroncons, hauteurDefautLiaison } from "@/lib/pose-circuits";
import { construireChemin3D, hauteurGaineNiveau } from "@/lib/chemin-3d";
import { HAUTEUR_TABLEAU_DEFAUT, creerContexteLongueurs } from "@/lib/longueurs-circuits";

// Hauteur du tableau par défaut (HAUTEUR_TABLEAU_DEFAUT) : définie dans lib/longueurs-circuits.ts, partagée avec le calcul des longueurs.

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
// Un mécanisme DOUBLE (2 voies) donne deux lignes de simulation indépendantes. Les ids de simulation
// sont des nombres : la voie 2 utilise l'opposé de l'id de l'appareillage (jamais en collision, les id sont > 0).
const ID_VOIE_2 = (id: number): number => -id;

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
// ─── PRISME D'UNE COUCHE DE MUR ────────────────────────────────────────────────────────────────────────────
// Une couche de mur (structure, doublage, finition) est un quadrilatère du plan, dont les extrémités sont les ONGLETS
// exacts des angles (voir geometrieMurs, murs.ts). On l'extrude tel quel, découpé en tranches le long du mur (autour des
// ouvertures) : les couches de deux murs voisins se rejoignent exactement, sur un angle sortant comme sur un angle
// rentrant — aucun débordement, donc aucun « retour » visible à l'intérieur de la pièce.
// s0..s1 : tranche, en mètres le long du mur depuis a, dans le sens a → (ux, uy) ; y0..y1 : hauteurs.
function ajouterPrismeCouche(
  quad: { x: number; y: number }[], a: { x: number; y: number }, ux: number, uy: number,
  s0: number, s1: number, y0: number, y1: number, mat: THREE.Material, scene: THREE.Scene,
): void {
  if (y1 - y0 < 0.002 || s1 - s0 < 0.002) return;
  type Pt = { x: number; z: number; s: number };
  let poly: Pt[] = quad.map(p => ({ x: p.x, z: p.y, s: (p.x - a.x) * ux + (p.y - a.y) * uy }));
  // Découpe de Sutherland–Hodgman contre s >= s0 puis s <= s1 (polygone convexe : le résultat l'est aussi).
  const couper = (pts: Pt[], garde: (p: Pt) => boolean, limite: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const gp = garde(p), gq = garde(q);
      if (gp) out.push(p);
      if (gp !== gq && Math.abs(q.s - p.s) > 1e-12) {
        const t = (limite - p.s) / (q.s - p.s);
        out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, s: limite });
      }
    }
    return out;
  };
  poly = couper(poly, p => p.s >= s0, s0);
  poly = couper(poly, p => p.s <= s1, s1);
  if (poly.length < 3) return;
  let aire2 = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; aire2 += p.x * q.z - q.x * p.z; }
  if (Math.abs(aire2) < 1e-6) return;
  if (aire2 > 0) poly = poly.slice().reverse();          // sens tel que la face du dessus regarde vers +y
  const cx = poly.reduce((t, p) => t + p.x, 0) / poly.length, cz = poly.reduce((t, p) => t + p.z, 0) / poly.length;
  const pos: number[] = [];
  const tri = (A: number[], B: number[], C: number[]) => { pos.push(...A, ...B, ...C); };
  for (let k = 1; k < poly.length - 1; k++) {
    tri([poly[0].x, y1, poly[0].z], [poly[k].x, y1, poly[k].z], [poly[k + 1].x, y1, poly[k + 1].z]);   // dessus
    tri([poly[0].x, y0, poly[0].z], [poly[k + 1].x, y0, poly[k + 1].z], [poly[k].x, y0, poly[k].z]);   // dessous
  }
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dx = q.x - p.x, dz = q.z - p.z;
    if (Math.hypot(dx, dz) < 1e-6) continue;
    // face latérale tournée vers l'extérieur de la tranche : on teste le sens avec le centre
    const sortant = (dz * ((p.x + q.x) / 2 - cx) - dx * ((p.z + q.z) / 2 - cz)) > 0;
    const b0 = [p.x, y0, p.z], b1 = [q.x, y0, q.z], t0 = [p.x, y1, p.z], t1 = [q.x, y1, q.z];
    if (sortant) { tri(b0, t1, b1); tri(b0, t0, t1); } else { tri(b0, b1, t1); tri(b0, t1, t0); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

export function construireMurAvecOuvertures(
  a: { x: number; y: number }, b: { x: number; y: number }, hauteurMur: number,
  ouvertures: OuvertureEffective[], epaisseur: number, murMat: THREE.Material, scene: THREE.Scene,
  // Une COUCHE de mur (structure ou doublage) : decalage = écart du centre de la couche à l'axe,
  // le long de la normale gauche ; extDebut/extFin = prolongement aux extrémités (comble le coin
  // avec le mur voisin) ; avecContenu = dessiner aussi vitrage / panneau coulissant (une seule
  // couche par mur). Toutes les couches reçoivent les MÊMES trous : une ouverture perce tout.
  // sensInterieur : signe de la normale du mur (repère du plan) qui regarde l'INTÉRIEUR de la pièce porteuse
  // (+1 par défaut) — sert au sens de battement des portes ; enregistrerPorte : reçoit chaque porte ouvrable
  // construite (pour piloter son ouverture sans reconstruire la scène).
  // quad : quadrilatère exact de la couche (angles en onglet, voir ajouterPrismeCouche) — quand il est fourni, c'est lui qui
  // dessine la couche (decalage / epaisseur ne servent alors qu'au contenu : vitrage, vantail, encadrement).
  opts: { decalage?: number; extDebut?: number; extFin?: number; avecContenu?: boolean; sensInterieur?: 1 | -1; enregistrerPorte?: (p: PorteRegistre) => void; quad?: { x: number; y: number }[] } = {},
): void {
  const { decalage = 0, avecContenu = true, sensInterieur = 1, enregistrerPorte, quad } = opts;
  // Avec un quadrilatère, les tranches de mur s'étendent « à l'infini » : c'est le quadrilatère qui les borne aux onglets.
  const extDebut = quad ? 1000 : (opts.extDebut ?? 0), extFin = quad ? 1000 : (opts.extFin ?? 0);
  const dx = b.x - a.x, dy = b.y - a.y;
  const longueur = Math.hypot(dx, dy);
  if (longueur < 0.01) return;
  const angle = Math.atan2(dy, dx);
  const ux = dx / longueur, uy = dy / longueur;
  const nx = -uy, ny = ux; // perpendiculaire au mur, pour décaler légèrement un panneau coulissant

  const ajouterPan = (centreLong: number, largeur: number, centreHauteur: number, hauteur: number) => {
    if (largeur < 0.005 || hauteur < 0.005) return;
    if (quad) {
      ajouterPrismeCouche(quad, a, ux, uy, centreLong - largeur / 2, centreLong + largeur / 2, centreHauteur - hauteur / 2, centreHauteur + hauteur / 2, murMat, scene);
      return;
    }
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
    const hOuverture = (o.hauteur ?? hauteurOuvertureDefautCm(o.type)) / 100;
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
      vitre.position.set(a.x + ux * ((debut + fin) / 2) + nx * decalage, hAllege + hOuverture / 2, a.y + uy * ((debut + fin) / 2) + ny * decalage);
      vitre.rotation.y = -angle;
      scene.add(vitre);
    }

    // Porte battante : encadrement + vantail pivotant (intérieure, d'entrée ou de service). Fermée par défaut ;
    // l'ouverture se pilote ensuite via le registre (voir PortesOuvrables.ts). Le sens de battement suit le plan 2D :
    // « vers l'intérieur » = côté du centre de la pièce porteuse (sensInterieur).
    if (avecContenu && o.proprietaire && o.type === "porte") {
      const usage: UsagePorte = o.usage ?? "interieure";
      const hP = Math.max(0.5, Math.min(hOuverture, hauteurMur - 0.01));
      const hs = o.charniere === "droite" ? 1 : -1;
      const sensBattement = (o.ouvreVersInterieur === false ? -1 : 1) * sensInterieur;
      const centreOuv = (debut + fin) / 2;
      const pivot = new THREE.Group();
      pivot.position.set(a.x + ux * centreOuv + nx * decalage, hAllege, a.y + uy * centreOuv + ny * decalage);
      pivot.rotation.y = -angle;
      const { cadre, swing } = creerPorteBattante({ larg: fin - debut, haut: hP, epMur: epaisseur, usage, hs, faceInt: sensInterieur });
      pivot.add(cadre, swing);
      scene.add(pivot);
      if (o.id != null) {
        const reg: PorteRegistre = { id: o.id, genre: "battante", mobile: swing, signe: sensBattement * hs, course: 0, defaut: 0 };
        swing.traverse(obj => { obj.userData.porteId = o.id; });
        appliquerOuverturePorte(reg, reg.defaut);
        enregistrerPorte?.(reg);
      }
    }

    // Porte coulissante : panneau qui remplit l'ouverture fermé et se gare contre le mur voisin ouvert
    // (ouverte par défaut, comme avant : le panneau était toujours dessiné « garé »).
    if (avecContenu && o.proprietaire && o.type === "porte_coulissante") {
      const cote = o.coulisseVers === "gauche" ? -1 : 1;
      const centreOuv = (debut + fin) / 2;
      const decalagePanneau = epaisseur * 0.3;
      const pivot = new THREE.Group();
      pivot.position.set(a.x + ux * centreOuv + nx * (decalage + decalagePanneau), hAllege, a.y + uy * centreOuv + ny * (decalage + decalagePanneau));
      pivot.rotation.y = -angle;
      const mobile = creerPorteCoulissante({ larg: fin - debut, haut: hOuverture, epMur: epaisseur });
      pivot.add(mobile);
      scene.add(pivot);
      const reg: PorteRegistre = { id: o.id ?? -1, genre: "coulissante", mobile, signe: cote, course: fin - debut, defaut: 100 };
      if (o.id != null) {
        mobile.traverse(obj => { obj.userData.porteId = o.id; });
        enregistrerPorte?.(reg);
      }
      appliquerOuverturePorte(reg, reg.defaut);
    }
    // Baie vitrée coulissante (2 vantaux) : fermée par défaut ; le vantail mobile glisse devant le fixe.
    if (avecContenu && o.proprietaire && o.type === "baie_vitree") {
      const cote = o.coulisseVers === "gauche" ? -1 : 1;
      const centreOuv = (debut + fin) / 2;
      const hB = Math.max(0.5, Math.min(hOuverture, hauteurMur - 0.01));
      const pivot = new THREE.Group();
      pivot.position.set(a.x + ux * centreOuv + nx * decalage, hAllege, a.y + uy * centreOuv + ny * decalage);
      pivot.rotation.y = -angle;
      const { cadre, mobile } = creerBaieVitree({ larg: fin - debut, haut: hB, epMur: epaisseur, cote });
      pivot.add(cadre, mobile);
      scene.add(pivot);
      const reg: PorteRegistre = { id: o.id ?? -1, genre: "coulissante", mobile, signe: cote, course: (fin - debut) / 2, defaut: 0 };
      if (o.id != null) {
        pivot.traverse(obj => { obj.userData.porteId = o.id; });
        enregistrerPorte?.(reg);
      }
      appliquerOuverturePorte(reg, reg.defaut);
    }

    // Porte de garage basculante : tablier plein suspendu à son bord haut ; fermée par défaut, elle bascule vers
    // l'intérieur (sous le plafond) en cliquant dessus ou depuis le panneau 3D.
    if (avecContenu && o.proprietaire && o.type === "porte_garage") {
      const centreOuv = (debut + fin) / 2;
      const hG = Math.max(0.5, Math.min(hOuverture, hauteurMur - 0.01));
      const sens = (o.ouvreVersInterieur === false ? -1 : 1) * sensInterieur;
      const pivot = new THREE.Group();
      pivot.position.set(a.x + ux * centreOuv + nx * decalage, hAllege, a.y + uy * centreOuv + ny * decalage);
      pivot.rotation.y = -angle;
      const { cadre, mobile } = creerPorteGarage({ larg: fin - debut, haut: hG, epMur: epaisseur });
      mobile.position.set(0, hG - 0.04, 0);   // axe de bascule = bas du profilé haut
      pivot.add(cadre, mobile);
      scene.add(pivot);
      // rotation.x = −sens × angle : le bas du tablier part du côté « sens » de la normale du mur.
      const reg: PorteRegistre = { id: o.id ?? -1, genre: "basculante", mobile, signe: -sens, course: 0, defaut: 0 };
      if (o.id != null) {
        pivot.traverse(obj => { obj.userData.porteId = o.id; });
        enregistrerPorte?.(reg);
      }
      appliquerOuverturePorte(reg, reg.defaut);
    }
    curseur = fin;
  });
  if (curseur < longueur) ajouterPan((curseur + longueur + extFin) / 2, longueur + extFin - curseur, hauteurMur / 2, hauteurMur);
}

// Personne témoin de 1,80 m (silhouette simple, pieds au sol à l'origine) — pour juger les échelles en 3D.
// Elle projette et reçoit les ombres comme le mobilier.
function creerPersonne(): THREE.Group {
  const groupe = new THREE.Group();
  const peau = new THREE.MeshStandardMaterial({ color: 0xf1c9a5, roughness: 0.8 });
  const haut = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.85 });
  const bas = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 });
  const ajouter = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    groupe.add(m);
  };
  const H = HAUTEUR_PERSONNE_M;
  const rTete = 0.11;
  const hJambes = 0.85, hTorse = 0.6, hCou = 0.13;
  ajouter(new THREE.CylinderGeometry(0.07, 0.065, hJambes, 12), bas, -0.1, hJambes / 2);
  ajouter(new THREE.CylinderGeometry(0.07, 0.065, hJambes, 12), bas, 0.1, hJambes / 2);
  ajouter(new THREE.BoxGeometry(0.42, hTorse, 0.22), haut, 0, hJambes + hTorse / 2);
  ajouter(new THREE.CylinderGeometry(0.045, 0.04, 0.6, 10), haut, -0.265, hJambes + hTorse - 0.3);
  ajouter(new THREE.CylinderGeometry(0.045, 0.04, 0.6, 10), haut, 0.265, hJambes + hTorse - 0.3);
  ajouter(new THREE.CylinderGeometry(0.05, 0.05, hCou, 10), peau, 0, hJambes + hTorse + hCou / 2);
  ajouter(new THREE.SphereGeometry(rTete, 16, 12), peau, 0, H - rTete); // sommet de la tête = 1,80 m
  return groupe;
}

// Voiture familiale standard (break compact, 4,60 × 1,85 × 1,50 m). Repère local : x = longueur (capot vers +x),
// y = vertical (roues au sol), z = largeur, centrée sur l'origine. Elle projette et reçoit les ombres comme le mobilier.
//
// Construction : une CAISSE basse (pleine largeur) + un HABITACLE plus étroit posé dessus. Les vitres sont calculées
// à partir du profil de l'habitacle (réduit de quelques centimètres vers l'intérieur) : elles ne peuvent donc jamais
// dépasser de la carrosserie. Un 2D convexe suffit ici (profil de l'habitacle = polygone convexe).
const CAISSE: [number, number][] = [
  [-2.30, 0.25], [2.30, 0.25], [2.30, 0.58], [2.18, 0.72], [1.45, 0.86], [-2.12, 0.92], [-2.30, 0.84],
];
const HABITACLE: [number, number][] = [
  [1.20, 0.85], [0.58, 1.44], [-1.72, 1.50], [-2.14, 0.88],
];
const HABITACLE_DEMI_LARGEUR = 0.74;
const LIGNE_CEINTURE = 0.99;   // les vitres latérales commencent au-dessus de cette hauteur

// Polygone convexe : ne garde que la partie au-dessus de y = yMin.
export function couperAuDessus(poly: [number, number][], yMin: number): [number, number][] {
  const out: [number, number][] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const ina = a[1] >= yMin, inb = b[1] >= yMin;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (yMin - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, yMin]);
    }
  });
  return out;
}

// Polygone convexe (sens quelconque) rétréci de d vers l'intérieur : chaque arête recule de d (intersection des arêtes décalées).
export function reduirePolygone(poly: [number, number][], d: number): [number, number][] {
  const n = poly.length;
  let aire = 0;
  poly.forEach((p, i) => { const q = poly[(i + 1) % n]; aire += p[0] * q[1] - q[0] * p[1]; });
  const sens = aire >= 0 ? 1 : -1;            // +1 = antihoraire
  const droites = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L * sens, ny = dx / L * sens;   // normale intérieure
    return { px: p[0] + nx * d, py: p[1] + ny * d, dx: dx / L, dy: dy / L };
  });
  return droites.map((D, i) => {
    const P = droites[(i + n - 1) % n];             // arête précédente
    const det = P.dx * D.dy - P.dy * D.dx;
    if (Math.abs(det) < 1e-9) return [D.px, D.py] as [number, number];
    const t = ((D.px - P.px) * D.dy - (D.py - P.py) * D.dx) / det;
    return [P.px + P.dx * t, P.py + P.dy * t] as [number, number];
  });
}

function creerVoiture(): THREE.Group {
  const groupe = new THREE.Group();
  const L = VOITURE_LONGUEUR_M, l = VOITURE_LARGEUR_M, H = VOITURE_HAUTEUR_M;
  const carrosserie = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.35, metalness: 0.45 });
  const plastique = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8 });
  const vitrage = new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.08, metalness: 0.3, side: THREE.DoubleSide });
  const caoutchouc = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });
  const jante = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.7, roughness: 0.3 });
  const marquer = <T extends THREE.Object3D>(o: T): T => { o.traverse(x => { if (x instanceof THREE.Mesh) { x.castShadow = true; x.receiveShadow = true; } }); return o; };
  const demiL = l / 2;

  // Caisse : profil latéral extrudé sur toute la largeur.
  const caisseGeo = new THREE.ExtrudeGeometry(new THREE.Shape(CAISSE.map(([x, y]) => new THREE.Vector2(x, y))), { depth: l, bevelEnabled: false });
  const caisse = marquer(new THREE.Mesh(caisseGeo, carrosserie));
  caisse.position.z = -demiL;
  groupe.add(caisse);

  // Habitacle : profil extrudé, plus étroit que la caisse.
  const dH = HABITACLE_DEMI_LARGEUR * 2;
  const habGeo = new THREE.ExtrudeGeometry(new THREE.Shape(HABITACLE.map(([x, y]) => new THREE.Vector2(x, y))), { depth: dH, bevelEnabled: false });
  const habitacle = marquer(new THREE.Mesh(habGeo, carrosserie));
  habitacle.position.z = -HABITACLE_DEMI_LARGEUR;
  groupe.add(habitacle);

  // Vitres latérales : profil de l'habitacle coupé à la ligne de ceinture puis réduit de 6 cm — toujours à l'intérieur.
  const vitreLat = reduirePolygone(couperAuDessus(HABITACLE, LIGNE_CEINTURE), 0.06);
  const geoVitreLat = new THREE.ShapeGeometry(new THREE.Shape(vitreLat.map(([x, y]) => new THREE.Vector2(x, y))));
  [1, -1].forEach(cote => {
    const v = new THREE.Mesh(geoVitreLat, vitrage);
    v.position.z = cote * (HABITACLE_DEMI_LARGEUR + 0.004);
    groupe.add(v);
  });
  // Montant central (B) pour casser la grande vitre.
  [1, -1].forEach(cote => {
    const montant = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.42, 0.012), carrosserie);
    montant.position.set(-0.28, 1.2, cote * (HABITACLE_DEMI_LARGEUR + 0.006));
    groupe.add(montant);
  });

  // Pare-brise et lunette arrière : posés SUR les faces inclinées de l'habitacle, en retrait de 6 cm aux extrémités et de 9 cm
  // sur les côtés (donc inclus dans la face), à 3 mm au-dessus.
  const vitreInclinee = (a: [number, number], b: [number, number], sortant: 1 | -1) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], longueur = Math.hypot(dx, dy);
    const ux = dx / longueur, uy = dy / longueur;
    const nx = -uy * sortant, ny = ux * sortant;                  // normale : (−uy, ux) est tournée vers l'intérieur pour ce sens de parcours, d'où sortant = −1
    const lu = longueur - 0.12;
    const mx = (a[0] + b[0]) / 2 + nx * 0.003, my = (a[1] + b[1]) / 2 + ny * 0.003;
    const g = new THREE.Mesh(new THREE.BoxGeometry(lu, 0.004, dH - 0.18), vitrage);
    g.position.set(mx, my, 0);
    g.rotation.z = Math.atan2(uy, ux);
    groupe.add(g);
  };
  vitreInclinee(HABITACLE[0], HABITACLE[1], -1);   // pare-brise (normale sortante : vers l'avant et le haut)
  vitreInclinee(HABITACLE[2], HABITACLE[3], -1);   // lunette arrière (normale sortante : vers l'arrière et le haut)

  // Pare-chocs, calandre, rétroviseurs.
  [1, -1].forEach(bout => {
    const pc = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, l * 0.94), plastique);
    pc.position.set(bout * 2.25, 0.38, 0);
    groupe.add(marquer(pc));
  });
  const calandre = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.9), plastique);
  calandre.position.set(2.31, 0.55, 0);
  groupe.add(calandre);
  [1, -1].forEach(cote => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.14), carrosserie);
    r.position.set(0.72, 1.08, cote * (HABITACLE_DEMI_LARGEUR + 0.09));
    groupe.add(marquer(r));
  });

  // Roues : empattement 2,80 m. Un cache d'aile sombre sur le flanc, puis le pneu qui dépasse de 4 cm.
  const rayon = 0.33;
  [[1.4, 1], [1.4, -1], [-1.4, 1], [-1.4, -1]].forEach(([x, cote]) => {
    const aile = new THREE.Mesh(new THREE.CylinderGeometry(rayon + 0.04, rayon + 0.04, 0.02, 24), plastique);
    aile.rotation.x = Math.PI / 2;
    aile.position.set(x, rayon + 0.04, cote * (demiL + 0.002));   // bas de l'arche = sol, jamais en dessous
    groupe.add(aile);
    const pneu = marquer(new THREE.Mesh(new THREE.CylinderGeometry(rayon, rayon, 0.24, 24), caoutchouc));
    pneu.rotation.x = Math.PI / 2;
    pneu.position.set(x, rayon, cote * (demiL - 0.105));          // le pneu dépasse du flanc d'1,5 cm seulement
    groupe.add(pneu);
    const moyeu = new THREE.Mesh(new THREE.CylinderGeometry(rayon * 0.6, rayon * 0.6, 0.245, 18), jante);
    moyeu.rotation.x = Math.PI / 2;
    moyeu.position.copy(pneu.position);
    groupe.add(moyeu);
  });

  // Feux : phares (blanc chaud) à l'avant, feux rouges à l'arrière — posés sur la face, jamais au-delà du pare-chocs.
  const phare = new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xfef3c7, emissiveIntensity: 0.25 });
  const feuAr = new THREE.MeshStandardMaterial({ color: 0xdc2626, emissive: 0xdc2626, emissiveIntensity: 0.25 });
  [1, -1].forEach(cote => {
    const ph = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.3), phare);
    ph.position.set(2.29, 0.66, cote * 0.68);
    groupe.add(ph);
    const fa = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.22), feuAr);
    fa.position.set(-2.285, 0.78, cote * 0.74);
    groupe.add(fa);
  });

  // Les constantes partagées (maison-types) pilotent l'échelle : 4,60 × 1,85 × 1,50 m par défaut → échelle 1.
  groupe.scale.set(L / 4.6, H / 1.5, l / 1.85);
  return groupe;
}

export interface Vue3DHandle {
  capturerImage: () => string | null;
}

const Vue3D = forwardRef<Vue3DHandle, {
  niveau: Niveau; resultat: ResultatGeneration | null; showCircuits: boolean;
  // Angle (degrés, sens horaire) entre le haut du plan et le Nord — voir Niveau.orientationNord / lib/soleil.ts.
  orientationNord?: number;
  // Actions « circuits » du plan (générer / afficher les circuits) : affichées dans l'onglet « Vue » du bandeau.
  circuitsAction?: React.ReactNode;
}>(function Vue3D({ niveau, resultat, showCircuits, orientationNord = 0, circuitsAction }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);
  // id d'appareillage (point_lumineux/applique) -> sa lumière 3D + le matériau de son
  // marqueur (pour faire "briller" l'ampoule elle-même, pas seulement éclairer la pièce).
  const lumiereLightsRef = useRef<Map<number, { light: THREE.PointLight | THREE.SpotLight; mat: THREE.MeshStandardMaterial }>>(new Map());

  const [nightMode, setNightMode] = useState(false);
  // Soleil de midi (ombres portées réelles selon l'orientation du bâtiment) — simple état de VUE.
  const [soleilActif, setSoleilActif] = useState(true);
  const [saison, setSaison] = useState<SaisonSoleil>("aujourdhui");
  // Personnes témoins (1,80 m) : affichage global ; chaque personne se place / se masque depuis le plan 2D.
  const [personnesVisibles, setPersonnesVisibles] = useState(true);
  const [voituresVisibles, setVoituresVisibles] = useState(true);
  // Bandeau de commandes escamotable : fermé par défaut (vue dégagée), un onglet par famille de réglages.
  const [bandeauOuvert, setBandeauOuvert] = useState(false);
  const [onglet, setOnglet] = useState<"eclairage" | "ouvrants" | "soleil" | "temoins" | "vue">("eclairage");
  // Emprise de la scène (centre + rayon, mètres) — sert à cadrer la caméra d'ombre du soleil.
  const empriseRef = useRef<{ cx: number; cz: number; rayon: number; hauteur: number }>({ cx: 0, cz: 0, rayon: 8, hauteur: 2.5 });
  // « Coupe » : rend le doublage translucide pour voir passer les câbles encastrés qu'il contient.
  const [coupeDoublage, setCoupeDoublage] = useState(false);
  const doublageMatsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const [interrupteursOn, setInterrupteursOn] = useState<Record<number, boolean>>({});
  // Ouverture des volets roulants (0 fermé … 100 ouvert) forcée depuis le panneau 3D — simple
  // état de VUE, jamais écrit dans le plan ; sans entrée, c'est la valeur enregistrée
  // (AppareillagePlace.voletOuvertPct, réglée depuis le plan 2D) qui s'applique.
  const [voletsOverride, setVoletsOverride] = useState<Record<number, number>>({});
  const voletsRef = useRef<Map<number, { modele: ModeleVolet; defaut: number }>>(new Map());
  // Portes ouvrables : ouverture 0 (fermée) … 100 (ouverte) forcée depuis le panneau 3D ou par un clic sur la
  // porte — simple état de VUE (jamais écrit dans le plan). L'animation glisse « courant » vers « cible » à
  // chaque image, sans reconstruire la scène.
  const [portesOverride, setPortesOverride] = useState<Record<number, number>>({});
  const portesOverrideRef = useRef<Record<number, number>>({});
  portesOverrideRef.current = portesOverride;
  const portesRef = useRef<Map<number, { reg: PorteRegistre; courant: number; cible: number }>>(new Map());

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
        if (!estCommande(app.type)) return;
        const base = baseCommande(app.type)!;
        const double = estCommandeDouble(app.type);
        const voies: { id: number; ids: number[]; suffixe: string }[] = double
          ? [{ id: app.id, ids: app.commandePourIds ?? [], suffixe: " — voie 1" }, { id: ID_VOIE_2(app.id), ids: app.commandePourIds2 ?? [], suffixe: " — voie 2" }]
          : [{ id: app.id, ids: app.commandePourIds ?? [], suffixe: "" }];
        voies.forEach(v => {
          if (v.ids.length === 0) return;
          const prefixe = double ? "Double " : "";
          liste.push({
            id: v.id,
            label: (app.nom ? app.nom : `${prefixe}${double ? LABEL_TYPE_INTERRUPTEUR[base].toLowerCase() : LABEL_TYPE_INTERRUPTEUR[base]}${v.ids.length > 1 ? ` (${v.ids.length} pts)` : ""}`) + v.suffixe,
            pieceNom: piece.nom,
            lumiereIds: v.ids,
          });
        });
      });
    });
    return liste;
  }, [niveauResultat]);

  // Changer de niveau réinitialise la simulation (les ids d'interrupteurs d'un autre
  // niveau n'ont aucun sens ici) — le mode nuit, lui, est une préférence de vue et reste.
  useEffect(() => { setInterrupteursOn({}); setVoletsOverride({}); setPortesOverride({}); }, [niveau.id]);

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
    // Hauteur de gaine par défaut (sous le plafond le plus bas du niveau) : celle à laquelle courent les câbles non réglés.
    const hauteurGaine = hauteurGaineNiveau(hauteurPlafond, niveauResultat.pieces.map(p => p.hauteurPlafond));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e7e5e4");
    sceneRef.current = scene;
    lumiereLightsRef.current.clear();
    voletsRef.current.clear();
    portesRef.current.clear();
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
    // Soleil : ombres portées (position / cadrage réglés par l'effet « soleil » plus bas, orientation incluse).
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.bias = -0.0004;
    dirLight.shadow.normalBias = 0.03;
    scene.add(dirLight);
    scene.add(dirLight.target);
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
    const appareilsApparents = appareillagesEnPoseApparente(niveau, niveauResultat.pieces.flatMap(p => p.appareillages), resultat, hauteurGaine);
    // Appareillages effectivement habillés d'un boîtier en saillie + goulotte : leur montée est déjà dessinée par le modèle.
    const habilles = new Set<number>();

    // Portes : l'usage (intérieure / entrée / service), la charnière et le sens de battement sont lus sur l'état
    // VIVANT du niveau (comme les volets) — une modification se voit sans régénérer les circuits.
    const liveOuvParId = new Map<number, Ouverture>();
    niveau.pieces.forEach(p => (p.ouvertures ?? []).forEach(o => liveOuvParId.set(o.id, o)));
    (niveau.zones ?? []).forEach(z => (z.ouvertures ?? []).forEach(o => liveOuvParId.set(o.id, o)));
    const ouverturesVivantes = (ouvs: OuvertureEffective[]): OuvertureEffective[] => ouvs.map(o => {
      const l = o.id != null ? liveOuvParId.get(o.id) : undefined;
      return l ? { ...o, usage: l.usage, charniere: l.charniere, ouvreVersInterieur: l.ouvreVersInterieur, coulisseVers: l.coulisseVers } : o;
    });
    // Chaque porte construite s'inscrit ici : son ouverture initiale = celle déjà forcée par la vue, sinon sa valeur par défaut.
    const enregistrerPorte = (reg: PorteRegistre) => {
      const ouverture = portesOverrideRef.current[reg.id] ?? reg.defaut;
      portesRef.current.set(reg.id, { reg, courant: ouverture, cible: ouverture });
      appliquerOuverturePorte(reg, ouverture);
    };

    // Murs extérieurs / mitoyens : à déduire de TOUTES les pièces du niveau, avant de bâtir les murs.
    preparerMurs(niveauResultat.pieces);
    preparerMurs(niveau.pieces);

    // Zones (dressing, cloisons libres) : seules leurs cloisons sont bâties — une zone n'est pas une pièce
    // (pas de sol propre, pas d'appareillage). Lues sur le plan VIVANT : elles ne font pas partie du résultat des circuits.
    (niveau.zones ?? []).forEach(z => {
      const zMat = new THREE.MeshStandardMaterial({ color: 0xe3dccf });
      cloisonsDeZone(z).forEach(c => {
        construireMurAvecOuvertures(c.a, c.b, hauteurPlafond, ouverturesVivantes(ouverturesEffectivesZone(z, c.i)), c.epaisseurM, zMat, scene,
          { decalage: 0, extDebut: c.extA, extFin: c.extB, avecContenu: true, enregistrerPorte });
      });
    });

    // Sol + murs par pièce
    niveauResultat.pieces.forEach(piece => {
      if (piece.contour.length < 3) return;
      const spec = PIECE_TYPES[piece.type];

      // Sol
      // Rotation -90° autour de x : (x, y) de la forme → (x, 0, -y). On passe donc -y pour retomber sur z = y du plan
      // (comme les murs et les appareillages) — sans cela le sol était en MIROIR par rapport aux murs.
      const shape = new THREE.Shape(piece.contour.map(p => new THREE.Vector2(p.x, -p.y)));
      const solGeo = new THREE.ShapeGeometry(shape);
      const solMat = new THREE.MeshStandardMaterial({ color: spec.color, side: THREE.DoubleSide });
      const sol = new THREE.Mesh(solGeo, solMat);
      sol.rotation.x = -Math.PI / 2;
      sol.receiveShadow = true;
      scene.add(sol);

      // Plafond « fantôme » : invisible (aucune couleur, aucun masquage, jamais cliquable) mais il BLOQUE le soleil.
      // Sans lui la 3D n'a pas de toit : le soleil tombait du ciel au milieu des pièces, et meubles / personnes y
      // projetaient leur ombre alors que la pièce est couverte. Avec lui, le soleil n'entre que par les ouvertures
      // (fenêtres, portes) — une pièce sans ouverture au soleil n'a aucune ombre portée. Pas de plafond sur une
      // pièce « Extérieur » (terrasse). Découpé sur la surface utile : le dessus des murs reste éclairé.
      if (piece.type !== "exterieur" && surfaceUtile(piece) != null) {
        const { utile } = geometrieMurs(piece);
        const hPlafond = piece.hauteurPlafond ?? hauteurPlafond;
        const plafGeo = new THREE.ShapeGeometry(new THREE.Shape(utile.map(p => new THREE.Vector2(p.x, -p.y))));
        const plafMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false });
        const plafond = new THREE.Mesh(plafGeo, plafMat);
        plafond.rotation.x = -Math.PI / 2;
        plafond.position.y = hPlafond - 0.003;
        plafond.castShadow = true;
        plafond.raycast = () => {};   // ne gêne ni le clic sur les portes ni aucun pointage
        scene.add(plafond);
      }

      // Murs (un ou plusieurs pans de boîte par arête du contour, troués aux ouvertures) —
      // hauteur propre à la pièce si définie
      const hauteurMurs = piece.hauteurPlafond ?? hauteurPlafond;
      // Murs en teintes beige (et non blanc) pour que l'appareillage, blanc, ressorte dessus :
      // cloisons beige clair, murs extérieurs plus soutenus (enduit), doublage plus clair.
      const murMat = new THREE.MeshStandardMaterial({ color: 0xe3dccf });
      const murExtMat = new THREE.MeshStandardMaterial({ color: 0xcdc4b3 });
      const doublageMat = new THREE.MeshStandardMaterial({ color: 0xe4e0d5 });
      const finitionMat = new THREE.MeshStandardMaterial({ color: 0xf1eee6 });
      // Doublage ET finition deviennent translucides en mode « Coupe » (pour voir les câbles de la couche 2).
      doublageMatsRef.current.push(doublageMat, finitionMat);
      const centrePiece = centroide(piece.contour);
      piece.contour.forEach((a, i) => {
        const b = piece.contour[(i + 1) % piece.contour.length];
        const ouverturesSegment = ouverturesVivantes(ouverturesEffectivesMur(niveauResultat.pieces, piece, i));
        // Côté de la normale (-uy, ux) qui regarde le centre de la pièce : même convention que le symbole 2D des portes.
        const lSeg = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const sensInterieur: 1 | -1 = (-(b.y - a.y) / lSeg * (centrePiece.x - a.x) + (b.x - a.x) / lSeg * (centrePiece.y - a.y)) >= 0 ? 1 : -1;
        const m = parametresMur3D(piece, i);
        // Les 3 couches (structure, doublage, finition) : chacune bâtie à partir de son quadrilatère exact (onglets
        // d'angle, voir geometrieMurs) ; les MÊMES ouvertures traversent toutes les couches. Le contenu (encadrement,
        // vantail, vitrage) est posé avec la structure, sur l'épaisseur TOTALE du mur.
        const quadsMur = geometrieMurs(piece).quads[i];
        const epTotale = m.e + m.d + m.f;
        m.couches.forEach(c => {
          const mat = c.nom === "structure" ? (m.type === "exterieur" ? murExtMat : murMat) : c.nom === "doublage" ? doublageMat : finitionMat;
          const quad = c.nom === "structure" ? quadsMur.structure : c.nom === "doublage" ? quadsMur.doublage : quadsMur.finition;
          if (!quad) return;
          const contenu = c.nom === "structure";
          construireMurAvecOuvertures(a, b, hauteurMurs - c.reduction, ouverturesSegment, contenu ? Math.max(epTotale, 0.02) : c.epaisseur, mat, scene,
            { decalage: contenu ? m.signeInterieur * (epTotale / 2) : c.decalage, avecContenu: contenu, sensInterieur, enregistrerPorte, quad });
        });
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
        const modele = creerModeleAppareillage(app.type, couleurCircuitApp, liveParId.get(app.id)?.couleur, (liveParId.get(app.id) ?? app).groupeId != null); // poste d'une plaque multiple : tronçon de plaque de 71 mm
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
        const racine = apparent && murPose ? habillerEnSaillie(modele, py, appareilsApparents.get(app.id) ?? hauteurGaine) : modele.groupe;
        if (apparent && murPose) habilles.add(app.id);
        racine.position.set(px, py, pz);
        racine.rotation.y = rotY;
        scene.add(racine);
        // Extrémité des câbles : au point de raccordement (hauteur d'installation), sur le mur.
        // Un luminaire de plafond se raccorde dans le plafond, à la hauteur de gaine : pas de petite montée parasite à chaque lampe.
        posApp.set(String(app.id), new THREE.Vector3(px, modele.montage === "plafond" ? Math.min(hCable, hauteurGaine) : hCable, pz));

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
      // Hauteur de l'ancre « tableau » du tracé : celle du tableau, ou la hauteur de gaine quand le tracé visible part
      // du point d'arrivée des gaines — la MÊME règle que le calcul des longueurs (longueurs-circuits.ts).
      const hauteurTableau = creerContexteLongueurs(niveau).hauteurOrigine;
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
        if (id === "boite" || id.startsWith("boite-")) return hauteurGaine;
        const pa = posApp.get(id);
        return pa ? pa.y : 1.0;
      };
      // Plusieurs circuits partent du MÊME tableau : on écarte légèrement leurs montées (≈ 1 cm) pour qu'elles ne
      // se superposent pas (deux tubes confondus de couleurs différentes scintillent).
      const nbCircuits = Array.from(parCircuit.keys()).filter(id => resultat.breakers.some(b => b.id === id)).length;
      let rang = 0;
      // Point 3D d'une ancre : l'appareillage lui-même (sur son mur) s'il existe, sinon le
      // point plan brut (tableau, boîtes de dérivation).
      const ancre3D = (id: string, pt: { x: number; y: number }, decalageTableau: number): THREE.Vector3 => {
        const pa = posApp.get(id);
        if (pa) return pa.clone();
        return new THREE.Vector3(pt.x + (id === "tableau" ? decalageTableau : 0), hauteurAncre(id), pt.y);
      };
      const couche2 = (p: { x: number; y: number }) => pointDansCouche2(niveau.pieces, p);
      parCircuit.forEach((points, circuitId) => {
        const breaker = resultat.breakers.find(b => b.id === circuitId);
        if (!breaker) return;
        const decalageTableau = Math.max(-0.18, Math.min(0.18, (rang - (nbCircuits - 1) / 2) * 0.011));
        rang++;
        const color = colorMap.get(circuitId) ?? "#666666";
        const segments = segmentsPourCircuit(breaker, points, niveau, tableauPos);
        // Circuit de prises (ou tout circuit non éclairage) : les appareillages se relient entre eux à la hauteur de la
        // 1re prise du circuit, au lieu de remonter à la hauteur de gaine à chaque prise (voir hauteurDefautLiaison).
        const hauteurDefaut = hauteurDefautLiaison(breaker, segments, hauteurAncre, hauteurGaine);
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
          const depart = ancre3D(seg.aId, seg.aPoint, decalageTableau);
          const arrivee = ancre3D(seg.bId, seg.bPoint, decalageTableau);
          // Tracé : chaque section court à plat à UNE hauteur (réglée, sinon celle du coude, sinon la gaine par défaut),
          // reliée par des montées verticales — jamais de pente, jamais de trait en double (voir lib/chemin-3d.ts).
          const jambes = construireChemin3D({
            depart: { x: depart.x, y: depart.y, z: depart.z },
            arrivee: { x: arrivee.x, y: arrivee.y, z: arrivee.z },
            coudes: coudes.map(c => ({ point: c.point, hauteurCm: c.hauteur })),
            poses: posesTroncons(niveau, cle, coudes),
            hauteursSection: hauteursTroncons(niveau, cle, coudes),
            hauteurGaine: hauteurDefaut(seg),
            couche2,
          });
          const teinte = seg.type === "navette" ? assombrirCouleur(color) : color;   // navette : couleur du circuit assombrie
          const matCable = new THREE.MeshStandardMaterial({ color: teinte, emissive: teinte, emissiveIntensity: 0.45 });
          // Moulure PVC 20 × 14 mm autour d'une section APPARENTE, translucide pour laisser voir le câble.
          const matMoulure = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
          jambes.forEach(jb => {
            const p0 = new THREE.Vector3(jb.a.x, jb.a.y, jb.a.z), p1 = new THREE.Vector3(jb.b.x, jb.b.y, jb.b.z);
            // Montée d'un appareillage déjà habillé (boîtier en saillie + goulotte) : la goulotte du modèle la
            // dessine déjà, la redessiner la doublerait.
            if (jb.extremite && jb.pose === "apparent") {
              const idAncre = jb.extremite === "depart" ? seg.aId : seg.bId;
              if (habilles.has(Number(idAncre))) return;
            }
            const longueur = p0.distanceTo(p1);
            if (longueur < 0.005) return;
            const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, longueur, 8), matCable);
            tube.position.copy(p0).add(p1).multiplyScalar(0.5);
            tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
            scene.add(tube);
            if (jb.pose === "apparent" && longueur >= 0.02) {
              const moulure = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.014, longueur), matMoulure);
              moulure.position.copy(tube.position);
              moulure.lookAt(p1);   // l'axe long de la boîte (z) suit la section
              scene.add(moulure);
            }
          });
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

    empriseRef.current = tousPts.length > 0
      ? { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cz: (Math.min(...ys) + Math.max(...ys)) / 2,
          rayon: Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 3, hauteur: hauteurPlafond }
      : { cx: 0, cz: 0, rayon: 8, hauteur: hauteurPlafond };

    // Sol extérieur « receveur d'ombre » : transparent, il ne montre que les ombres — celle du bâtiment au sol,
    // dehors (le plan n'a de sol que dans les pièces, l'ombre tombait donc dans le vide).
    {
      const cote = empriseRef.current.rayon * 2 + 30;
      const terrain = new THREE.Mesh(new THREE.PlaneGeometry(cote, cote), new THREE.ShadowMaterial({ opacity: 0.3 }));
      terrain.rotation.x = -Math.PI / 2;
      terrain.position.set(empriseRef.current.cx, -0.01, empriseRef.current.cz);
      terrain.receiveShadow = true;
      terrain.raycast = () => {};
      scene.add(terrain);
    }

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

    let departX = 0, departY = 0;   // position du bouton à l'appui : distingue un clic (ouvrir/fermer une porte) d'un glisser
    const onPointerDown = (e: PointerEvent) => {
      interaction = (e.button === 2 || e.shiftKey) ? "deplacement" : "rotation";
      dernierX = e.clientX; dernierY = e.clientY;
      departX = e.clientX; departY = e.clientY;
    };
    // Clic sur une porte = l'ouvrir / la fermer. Seul l'objet le plus proche sous le curseur compte : un mur
    // devant la porte la masque, donc ne la déclenche pas.
    const raycaster = new THREE.Raycaster();
    const pointeur = new THREE.Vector2();
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.shiftKey || portesRef.current.size === 0) return;
      if (Math.hypot(e.clientX - departX, e.clientY - departY) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointeur.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointeur, camera);
      const premiere = raycaster.intersectObjects(scene.children, true).find(h => h.object instanceof THREE.Mesh);
      const id = premiere?.object.userData.porteId;
      if (typeof id !== "number") return;
      const entree = portesRef.current.get(id);
      if (!entree) return;
      setPortesOverride(s => ({ ...s, [id]: (s[id] ?? entree.reg.defaut) > 50 ? 0 : 100 }));
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
    renderer.domElement.addEventListener("click", onClick);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      // Portes : l'ouverture glisse vers sa cible (animation douce, sans reconstruire la scène).
      portesRef.current.forEach(e => {
        if (e.courant === e.cible) return;
        const ecart = e.cible - e.courant;
        e.courant = Math.abs(ecart) < 0.5 ? e.cible : e.courant + ecart * 0.16;
        appliquerOuverturePorte(e.reg, e.courant);
      });
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
      renderer.domElement.removeEventListener("click", onClick);
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
      portesRef.current.clear();
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
      if (dirLightRef.current) { dirLightRef.current.intensity = 0; dirLightRef.current.castShadow = false; }
    } else {
      scene.background = new THREE.Color("#e7e5e4");
      // Soleil actif : moins d'ambiance, plus de lumière directe, pour que les ombres se voient franchement.
      if (ambientLightRef.current) ambientLightRef.current.intensity = soleilActif ? 0.42 : 0.7;
      if (dirLightRef.current) { dirLightRef.current.intensity = soleilActif ? 1.15 : 0.8; dirLightRef.current.castShadow = soleilActif; }
    }

    lumiereLightsRef.current.forEach((entry, id) => {
      const allumee = lumieresAllumeesIds.has(id);
      entry.light.intensity = allumee ? (nightMode ? 2.4 : 1.4) : 0;
      entry.mat.emissiveIntensity = allumee ? (nightMode ? 1.4 : 0.9) : 0.15;
    });
  }, [nightMode, soleilActif, lumieresAllumeesIds, niveau, resultat, niveauResultat, showCircuits]);

  // Hauteur du soleil à midi (degrés) pour la saison choisie — affichée dans le panneau.
  const elevationSoleil = useMemo(() => elevationMidi(saison, LATITUDE_DEFAUT), [saison]);

  // Soleil de midi : plein Sud (d'après l'orientation du bâtiment), à la hauteur propre à la date.
  // Ne reconstruit rien : déplace la lumière directionnelle et recadre sa caméra d'ombre sur l'emprise du niveau.
  useEffect(() => {
    const lumiere = dirLightRef.current;
    if (!lumiere) return;
    const { cx, cz, rayon, hauteur } = empriseRef.current;
    const dir = directionSoleilMidi(orientationNord, elevationSoleil);
    const distance = rayon * 2 + 30;
    lumiere.target.position.set(cx, hauteur / 2, cz);
    lumiere.target.updateMatrixWorld();
    lumiere.position.set(cx + dir.x * distance, hauteur / 2 + dir.y * distance, cz + dir.z * distance);
    const cam = lumiere.shadow.camera;
    const demi = rayon + hauteur;
    cam.left = -demi; cam.right = demi; cam.top = demi; cam.bottom = -demi;
    cam.near = 1; cam.far = distance + rayon * 2 + 10;
    cam.updateProjectionMatrix();
    lumiere.shadow.needsUpdate = true;
  }, [orientationNord, elevationSoleil, niveau, resultat, niveauResultat, showCircuits]);

  // Personnes témoins (1,80 m) : lues sur le plan VIVANT, dans leur propre groupe — retiré/recréé ici sans toucher au reste.
  const nbPersonnes = useMemo(() => niveau.pieces.filter(p => p.personne).length, [niveau]);
  const nbVoitures = useMemo(() => niveau.pieces.filter(p => p.voiture).length, [niveau]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const groupe = new THREE.Group();
    if (personnesVisibles) {
      niveau.pieces.forEach(p => {
        const pe = p.personne;
        if (!pe || pe.masquee) return;
        const modele = creerPersonne();
        modele.position.set(pe.x, 0, pe.y);
        groupe.add(modele);
      });
    }
    if (voituresVisibles) {
      niveau.pieces.forEach(p => {
        const v = p.voiture;
        if (!v || v.masquee) return;
        const modele = creerVoiture();
        modele.position.set(v.x, 0, v.y);
        modele.rotation.y = -((v.rotation ?? 0) * Math.PI) / 180;   // même convention qu'un meuble
        groupe.add(modele);
      });
    }
    scene.add(groupe);
    return () => {
      scene.remove(groupe);
      groupe.traverse(obj => {
        if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); (obj.material as THREE.Material).dispose(); }
      });
    };
  }, [niveau, resultat, showCircuits, niveauResultat, personnesVisibles, voituresVisibles]);

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

  // Portes (battantes et coulissantes) du niveau, murs de pièces et cloisons de zone — alimente le panneau 3D.
  const portes = useMemo(() => {
    const liste: { id: number; label: string; lieu: string; defaut: number }[] = [];
    const ajouter = (o: Ouverture, lieu: string) => {
      if (o.type === "porte") liste.push({ id: o.id, label: LABEL_USAGE_PORTE[o.usage ?? "interieure"], lieu, defaut: 0 });
      else if (o.type === "porte_coulissante") liste.push({ id: o.id, label: "Porte coulissante", lieu, defaut: 100 });
      else if (o.type === "porte_garage") liste.push({ id: o.id, label: "Porte de garage", lieu, defaut: 0 });
      else if (o.type === "baie_vitree") liste.push({ id: o.id, label: "Baie vitrée", lieu, defaut: 0 });
    };
    niveau.pieces.forEach(p => (p.ouvertures ?? []).forEach(o => ajouter(o, p.nom)));
    (niveau.zones ?? []).forEach(z => (z.ouvertures ?? []).forEach(o => ajouter(o, z.nom || "Zone")));
    return liste;
  }, [niveau]);

  // Fixe la cible d'ouverture de chaque porte déjà construite ; l'animation (boucle de rendu) fait le reste.
  useEffect(() => {
    portesRef.current.forEach((e, id) => { e.cible = portesOverride[id] ?? e.reg.defaut; });
  }, [portesOverride, niveau, resultat, showCircuits, niveauResultat]);

  // Applique l'ouverture courante à chaque volet déjà construit (sans reconstruire la scène) ;
  // mêmes dépendances que l'effet de construction pour se réappliquer après chaque reconstruction.
  useEffect(() => {
    voletsRef.current.forEach((entry, id) => entry.modele.setOuverture(voletsOverride[id] ?? entry.defaut));
  }, [voletsOverride, niveau, resultat, showCircuits, niveauResultat]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" style={{ touchAction: "none", cursor: "grab" }} />

      {/* ── Bandeau de commandes escamotable ──────────────────────────────────────────────────────────────
          Une seule barre en haut à gauche : la poignée (toujours visible) + 2 raccourcis (nuit, soleil). Le détail
          — éclairage, ouvrants, soleil, témoins, vue — se déplie dessous, un onglet par famille. */}
      {(() => {
        const puce = (actif: boolean) => `btn-ghost !text-xs backdrop-blur !py-1 ${actif ? "!bg-ink-900 !text-volt-400" : "!bg-white/90"}`;
        const nbOuvrants = portes.length + volets.length;
        const onglets: { id: typeof onglet; label: string; badge?: string }[] = [
          { id: "eclairage", label: "💡 Éclairage", badge: interrupteurs.length > 0 ? String(interrupteurs.length) : undefined },
          { id: "ouvrants", label: "🚪 Ouvrants", badge: nbOuvrants > 0 ? String(nbOuvrants) : undefined },
          { id: "soleil", label: "☀ Soleil" },
          { id: "temoins", label: "🧍 Témoins", badge: nbPersonnes + nbVoitures > 0 ? String(nbPersonnes + nbVoitures) : undefined },
          { id: "vue", label: "👁 Vue" },
        ];
        const ligneBtn = "btn-ghost !text-xs !bg-white/90 backdrop-blur shrink-0";
        return (
          <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 w-[min(calc(100%-1.5rem),46rem)] pointer-events-none">
            <div className="flex items-center gap-1.5 pointer-events-auto flex-wrap">
              <button onClick={() => setBandeauOuvert(o => !o)} className={puce(bandeauOuvert)}
                title={bandeauOuvert ? "Replier le bandeau de commandes" : "Déplier les commandes de la vue 3D"}>
                {bandeauOuvert ? "▴" : "▾"} Commandes 3D
              </button>
              <button onClick={() => setNightMode(m => !m)} className={puce(nightMode)}
                title="Bascule entre jour et nuit : la nuit, seules les lampes allumées éclairent">
                {nightMode ? "☀️ Jour" : "🌙 Nuit"}
              </button>
              <button onClick={() => setSoleilActif(v => !v)} className={puce(soleilActif && !nightMode)}
                title="Soleil de midi plein Sud : ombres portées d'après l'orientation du bâtiment">
                ☀ Soleil {soleilActif ? "oui" : "non"}
              </button>
            </div>

            {bandeauOuvert && (
              <div className="pointer-events-auto rounded-xl bg-white/95 backdrop-blur border border-ink-200 shadow-lg overflow-hidden">
                <div className="flex items-center gap-1 px-2 pt-2 overflow-x-auto border-b border-ink-100">
                  {onglets.map(o => (
                    <button key={o.id} onClick={() => setOnglet(o.id)}
                      className={`shrink-0 text-xs px-2.5 py-1.5 rounded-t-lg border-b-2 transition-colors ${onglet === o.id ? "border-volt-500 text-ink-900 font-semibold" : "border-transparent text-ink-500 hover:text-ink-800"}`}>
                      {o.label}{o.badge && <span className="ml-1 text-[10px] bg-ink-100 text-ink-600 rounded-full px-1.5 py-0.5">{o.badge}</span>}
                    </button>
                  ))}
                  <button onClick={() => setBandeauOuvert(false)} className="ml-auto shrink-0 text-xs text-ink-400 hover:text-ink-700 px-2 py-1" title="Replier">✕</button>
                </div>

                <div className="p-3 max-h-[38vh] overflow-y-auto flex flex-col gap-2">
                  {onglet === "eclairage" && (
                    <>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => setNightMode(m => !m)} className={puce(nightMode)}>{nightMode ? "☀️ Mode jour" : "🌙 Mode nuit"}</button>
                        <button onClick={() => setInterrupteursOn(Object.fromEntries(interrupteurs.map(i => [i.id, true])))} disabled={interrupteurs.length === 0}
                          className={`${ligneBtn} disabled:opacity-40`}>Tout allumer</button>
                        <button onClick={() => setInterrupteursOn({})} disabled={interrupteurs.length === 0} className={`${ligneBtn} disabled:opacity-40`}>Tout éteindre</button>
                      </div>
                      {interrupteurs.length === 0 ? (
                        <p className="text-xs text-ink-400">Aucun interrupteur ne commande de point lumineux sur ce niveau : rien à allumer. Relie un interrupteur à une lampe depuis le plan 2D.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {interrupteurs.map(i => {
                            const actif = !!interrupteursOn[i.id];
                            return (
                              <button key={i.id} onClick={() => setInterrupteursOn(s => ({ ...s, [i.id]: !s[i.id] }))}
                                className={`card !py-1.5 !px-3 text-left transition-colors ${actif ? "!border-volt-500 !bg-volt-50" : "!bg-white"}`}>
                                <div className="text-[10px] uppercase tracking-wide text-ink-400">{i.pieceNom}</div>
                                <div className="text-xs font-semibold text-ink-900 flex items-center gap-1.5">
                                  <span className={`inline-block w-2 h-2 rounded-full ${actif ? "bg-volt-500" : "bg-ink-300"}`} />
                                  {i.label}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}

                  {onglet === "ouvrants" && (
                    nbOuvrants === 0 ? (
                      <p className="text-xs text-ink-400">Aucune porte ni aucun volet roulant sur ce niveau.</p>
                    ) : (
                      <>
                        {portes.length > 0 && (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Portes, baies, garage</span>
                              <button onClick={() => setPortesOverride(Object.fromEntries(portes.map(d => [d.id, 100])))} className={ligneBtn}>Tout ouvrir</button>
                              <button onClick={() => setPortesOverride(Object.fromEntries(portes.map(d => [d.id, 0])))} className={ligneBtn}>Tout fermer</button>
                              <span className="text-[10px] text-ink-400">Astuce : clique sur une porte dans la vue pour l&apos;ouvrir / la fermer</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {portes.map(d => {
                                const pct = portesOverride[d.id] ?? d.defaut;
                                return (
                                  <div key={d.id} className="card !py-1.5 !px-3 !bg-white">
                                    <div className="text-[10px] uppercase tracking-wide text-ink-400">{d.lieu}</div>
                                    <div className="text-xs font-semibold text-ink-900">{d.label} — {pct >= 100 ? "ouverte" : pct <= 0 ? "fermée" : `ouverte à ${pct} %`}</div>
                                    <input type="range" min={0} max={100} step={5} value={pct} className="w-32"
                                      onChange={e => setPortesOverride(s => ({ ...s, [d.id]: Number(e.target.value) }))} />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {volets.length > 0 && (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Volets roulants</span>
                              <button onClick={() => setVoletsOverride(Object.fromEntries(volets.map(v => [v.id, 100])))} className={ligneBtn}>Tout ouvrir</button>
                              <button onClick={() => setVoletsOverride(Object.fromEntries(volets.map(v => [v.id, 0])))} className={ligneBtn}>Tout fermer</button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {volets.map(v => {
                                const pct = voletsOverride[v.id] ?? v.defaut;
                                return (
                                  <div key={v.id} className="card !py-1.5 !px-3 !bg-white">
                                    <div className="text-[10px] uppercase tracking-wide text-ink-400">{v.pieceNom}</div>
                                    <div className="text-xs font-semibold text-ink-900">{v.label} — {pct >= 100 ? "ouvert" : pct <= 0 ? "fermé" : `ouvert à ${pct} %`}</div>
                                    <input type="range" min={0} max={100} step={5} value={pct} className="w-32"
                                      onChange={e => setVoletsOverride(s => ({ ...s, [v.id]: Number(e.target.value) }))} />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )
                  )}

                  {onglet === "soleil" && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => setSoleilActif(v => !v)} className={puce(soleilActif)}>☀ Soleil de midi : {soleilActif ? "oui" : "non"}</button>
                        <select className="input !py-1 !text-xs !w-auto" value={saison} disabled={!soleilActif}
                          onChange={e => setSaison(e.target.value as SaisonSoleil)}>
                          {(Object.keys(LABEL_SAISON_SOLEIL) as SaisonSoleil[]).map(k => <option key={k} value={k}>{LABEL_SAISON_SOLEIL[k]}</option>)}
                        </select>
                      </div>
                      <p className="text-xs text-ink-500">
                        Plein Sud à midi, hauteur du soleil {Math.round(elevationSoleil)}° · Nord à {Math.round(orientationNord)}° du haut du plan (réglé depuis le plan 2D).
                        {nightMode && <span className="text-amber-600"> Mode nuit : le soleil est éteint.</span>}
                      </p>
                    </div>
                  )}

                  {onglet === "temoins" && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => setPersonnesVisibles(v => !v)} disabled={nbPersonnes === 0}
                          className={`${puce(personnesVisibles && nbPersonnes > 0)} disabled:opacity-40`}>
                          🧍 Personnes 1,80 m ({nbPersonnes}) : {personnesVisibles ? "visibles" : "masquées"}
                        </button>
                        <button onClick={() => setVoituresVisibles(v => !v)} disabled={nbVoitures === 0}
                          className={`${puce(voituresVisibles && nbVoitures > 0)} disabled:opacity-40`}>
                          🚗 Voitures ({nbVoitures}) : {voituresVisibles ? "visibles" : "masquées"}
                        </button>
                      </div>
                      {(nbPersonnes === 0 || nbVoitures === 0) && (
                        <p className="text-[11px] text-ink-400">
                          À placer depuis le plan 2D : clic sur une pièce → « + Personne 1,80 m » / « + Voiture ».
                        </p>
                      )}
                    </div>
                  )}

                  {onglet === "vue" && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => setCoupeDoublage(c => !c)} className={puce(coupeDoublage)}
                          title="Rend le doublage translucide pour voir passer les câbles encastrés (circuits affichés)">
                          {coupeDoublage ? "Doublage opaque" : "Coupe du doublage"}
                        </button>
                      </div>
                      {circuitsAction && <div className="flex flex-col gap-1.5 items-start">{circuitsAction}</div>}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
});

export default Vue3D;
