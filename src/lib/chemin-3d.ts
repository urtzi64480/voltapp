// src/lib/chemin-3d.ts
//
// Tracé 3D d'UNE liaison de circuit (entre deux ancres : tableau, boîte, appareillage), module PUR (aucune
// dépendance à three) pour pouvoir être testé seul. Repère : x et z = plan (z = y du plan 2D), y = hauteur (m).
//
// Règles de tracé (un câble réel est horizontal entre deux montées verticales, jamais en pente) :
//  - chaque SECTION (entre deux points consécutifs : départ, coudes, arrivée) court À PLAT à UNE hauteur :
//      1. la hauteur réglée de la section (hauteurSection / hauteurFinLiaison) si elle existe ;
//      2. sinon la hauteur saisie sur le coude où elle aboutit, puis sur celui d'où elle part ;
//      3. sinon la hauteur de gaine par défaut (sous plafond) — la MÊME pour tout le niveau ;
//  - la liaison est UNE seule polyligne continue : une montée / descente verticale n'apparaît que là où la
//    hauteur change réellement (aux deux extrémités, ou à un coude entre deux sections de hauteurs différentes) ;
//    entre deux sections de même hauteur il n'y a aucun trait vertical ;
//  - une section ENCASTRÉE s'enfonce dans la couche 2 (doublage) du mur qu'elle longe ou auquel elle se raccorde,
//    au lieu de flotter devant la face du mur ; une section APPARENTE reste à la surface (moulure).

import type { PoseTroncon } from "@/lib/maison-types";

export interface Pt3 { x: number; y: number; z: number }
export interface PtPlan { x: number; y: number }

// Une jambe = un tube rectiligne. extremite : montée/descente verticale qui touche l'ancre de départ ou d'arrivée.
export interface Jambe3D { a: Pt3; b: Pt3; pose: PoseTroncon; extremite?: "depart" | "arrivee" }

export interface CoudeEntree { point: PtPlan; hauteurCm?: number }

export interface EntreeChemin3D {
  depart: Pt3;
  arrivee: Pt3;
  coudes: CoudeEntree[];
  poses: PoseTroncon[];                          // coudes.length + 1
  hauteursSection: (number | undefined)[];       // cm, coudes.length + 1
  hauteurGaine: number;                          // m — hauteur de course par défaut
  // Ramène un point plan dans la couche 2 du mur le plus proche, ou null s'il n'est près d'aucun mur.
  couche2?: (p: PtPlan) => { pieceId: number; i: number; point: PtPlan } | null;
}

// Hauteur de gaine par défaut d'un niveau : 10 cm sous le plafond le plus BAS du niveau, pour qu'aucun câble
// ne dépasse du plafond d'une pièce plus basse.
export function hauteurGaineNiveau(hauteurPlafondNiveau: number, hauteursPieces: (number | undefined)[]): number {
  const plafonds = [hauteurPlafondNiveau, ...hauteursPieces.filter((h): h is number => h != null && h > 0)];
  return Math.max(0.3, Math.min(...plafonds) - 0.1);
}

// Hauteur (m) à laquelle COURT la section j (voir règles ci-dessus).
export function hauteurCourseSection(
  j: number, coudes: CoudeEntree[], hauteursSection: (number | undefined)[], hauteurGaine: number,
): number {
  const hs = hauteursSection[j];
  if (hs != null && isFinite(hs)) return hs / 100;
  const fin = j < coudes.length ? coudes[j].hauteurCm : undefined;     // coude où la section aboutit
  if (fin != null && isFinite(fin)) return fin / 100;
  const debut = j > 0 ? coudes[j - 1].hauteurCm : undefined;           // coude d'où elle part
  if (debut != null && isFinite(debut)) return debut / 100;
  return hauteurGaine;
}

const EPS = 0.003; // m — en dessous, une jambe est un point (pas de tube)

export function construireChemin3D(e: EntreeChemin3D): Jambe3D[] {
  const nSections = e.coudes.length + 1;
  const plan: PtPlan[] = [
    { x: e.depart.x, y: e.depart.z },
    ...e.coudes.map(c => c.point),
    { x: e.arrivee.x, y: e.arrivee.z },
  ];
  const jambes: Jambe3D[] = [];
  let cur: Pt3 = { ...e.depart };
  let started = false;

  const aller = (vers: Pt3, pose: PoseTroncon, extremite?: "depart" | "arrivee") => {
    const d = Math.hypot(vers.x - cur.x, vers.y - cur.y, vers.z - cur.z);
    if (d >= EPS) jambes.push({ a: cur, b: vers, pose, ...(extremite ? { extremite } : {}) });
    cur = vers;
  };

  for (let j = 0; j < nSections; j++) {
    const pose: PoseTroncon = e.poses[j] ?? "encastre";
    let s = plan[j], f = plan[j + 1];
    if (pose !== "apparent" && e.couche2) {
      const ms = e.couche2(s), mf = e.couche2(f);
      if (ms && mf && ms.pieceId === mf.pieceId && ms.i === mf.i) { s = ms.point; f = mf.point; }       // la section longe ce mur
      else {
        if (ms && j === 0) s = ms.point;                                                                   // l'ancre de départ est dans un mur
        if (mf && j === nSections - 1) f = mf.point;                                                       // l'ancre d'arrivée est dans un mur
      }
    }
    const H = hauteurCourseSection(j, e.coudes, e.hauteursSection, e.hauteurGaine);

    if (!started) { cur = { x: s.x, y: e.depart.y, z: s.y }; started = true; }                             // départ : on part de l'ancre
    else aller({ x: s.x, y: cur.y, z: s.y }, pose);                                                        // recalage à plat (aimantation)
    aller({ x: s.x, y: H, z: s.y }, pose, j === 0 ? "depart" : undefined);                                 // montée / descente
    aller({ x: f.x, y: H, z: f.y }, pose);                                                                 // course à plat
  }

  const poseFin: PoseTroncon = e.poses[nSections - 1] ?? "encastre";
  aller({ x: cur.x, y: e.arrivee.y, z: cur.z }, poseFin, "arrivee");                                       // descente jusqu'à l'ancre d'arrivée
  return jambes;
}
