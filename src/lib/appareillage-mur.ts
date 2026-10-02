// src/lib/appareillage-mur.ts
//
// Géométrie "appareillage ↔ mur" partagée entre le plan 2D (aimantation, rendu à plat
// contre le mur) et la vue 3D (projection sur la face intérieure du mur). Aucun état,
// aucune dépendance React/three : uniquement des fonctions pures sur des Point en mètres.

import { AppareillageType, Piece, Point, pointDansPolygone, ouverturesEffectivesMur } from "@/lib/maison-types";

export interface AncrageMur {
  segIndex: number;   // index du mur dans piece.contour (segment i → i+1)
  pied: Point;        // projection du point sur la ligne du mur
  distance: number;   // mètres, point → mur
  normale: Point;     // vecteur unitaire du mur vers l'INTÉRIEUR de la pièce
}

// Seul le point lumineux de plafond n'est jamais posé sur un mur ; tout le reste
// (prises, commandes, appliques, appareils dédiés) l'est.
export function estMural(type: AppareillageType): boolean {
  return type !== "point_lumineux";
}

function projeterSurSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// Mur le plus proche d'un point dans un contour, avec sa normale orientée vers l'intérieur
// (testée par pointDansPolygone, donc fiable aussi pour une pièce concave en L).
export function ancrageMurLePlusProche(pt: Point, contour: Point[]): AncrageMur | null {
  if (contour.length < 3) return null;
  let meilleur: AncrageMur | null = null;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length];
    const pied = projeterSurSegment(pt, a, b);
    const d = Math.hypot(pt.x - pied.x, pt.y - pied.y);
    if (meilleur && d >= meilleur.distance) continue;
    const sx = b.x - a.x, sy = b.y - a.y;
    const len = Math.hypot(sx, sy);
    if (len < 1e-6) continue;
    let nx = -sy / len, ny = sx / len;
    const test = { x: pied.x + nx * 0.05, y: pied.y + ny * 0.05 };
    if (!pointDansPolygone(test, contour)) { nx = -nx; ny = -ny; }
    meilleur = { segIndex: i, pied, distance: d, normale: { x: nx, y: ny } };
  }
  return meilleur;
}

// Aimantation : si le point est à moins de seuilM d'un mur, retourne son pied sur ce
// mur ; sinon retourne le point inchangé. Les types non muraux ne sont jamais aimantés.
export function aimanterSurMur(pt: Point, contour: Point[], type: AppareillageType, seuilM: number): Point {
  if (!estMural(type)) return pt;
  const anc = ancrageMurLePlusProche(pt, contour);
  if (!anc || anc.distance > seuilM) return pt;
  return anc.pied;
}

// Un appareillage est "posé contre le mur" (rendu à plat, symbole tourné) quand sa
// position est à moins de TOLERANCE_MUR_M de la ligne du mur.
export const TOLERANCE_MUR_M = 0.1;

// ─── VOLET ROULANT : DIMENSIONS LUES SUR LA FENÊTRE ─────────────────────────────
// Un volet roulant n'a pas de dimensions propres : il prend celles de l'ouverture du mur
// où il est posé. baieDuVolet cherche, sur le mur le plus proche du point, l'ouverture
// (fenêtre, porte-fenêtre…) dont l'emprise le long du mur est la plus proche — à moins de
// TOL_BAIE_M — et en renvoie largeur / hauteur / allège / centre. Sans ouverture à
// proximité, retombe sur une fenêtre standard (BAIE_DEFAUT) centrée sur le point.
export const BAIE_DEFAUT = { largeur: 1.0, hauteur: 1.2, allege: 0.9 }; // mètres
const TOL_BAIE_M = 0.4;

export interface BaieVolet {
  largeur: number; hauteur: number; allege: number; // mètres (hauteur = au-dessus de l'allège)
  centre: Point;            // centre de la baie, SUR la ligne du mur
  detectee: boolean;        // false = dimensions par défaut (aucune ouverture trouvée)
  ancrage: AncrageMur | null;
  ouvertureType?: string;
}

export function baieDuVolet(pt: Point, piece: Piece, pieces: Piece[]): BaieVolet {
  const anc = ancrageMurLePlusProche(pt, piece.contour);
  const defaut: BaieVolet = { ...BAIE_DEFAUT, centre: anc ? anc.pied : pt, detectee: false, ancrage: anc };
  if (!anc || anc.distance > 0.6) return defaut;
  const n = piece.contour.length;
  const a = piece.contour[anc.segIndex], b = piece.contour[(anc.segIndex + 1) % n];
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 0.01) return defaut;
  const s = Math.hypot(anc.pied.x - a.x, anc.pied.y - a.y); // abscisse du point le long du mur (m)
  let meilleure: ReturnType<typeof ouverturesEffectivesMur>[number] | null = null;
  let meilleureD = Infinity;
  for (const o of ouverturesEffectivesMur(pieces, piece, anc.segIndex)) {
    const d = Math.max(0, Math.abs(s - o.position * L) - o.largeur / 200); // écart à l'emprise de l'ouverture
    if (d < meilleureD) { meilleureD = d; meilleure = o; }
  }
  if (!meilleure || meilleureD > TOL_BAIE_M) return defaut;
  const estPorte = meilleure.type === "porte" || meilleure.type === "porte_coulissante";
  return {
    largeur: meilleure.largeur / 100,
    hauteur: (meilleure.hauteur ?? (estPorte ? 204 : 120)) / 100, // mêmes défauts que le mur 3D
    allege: (meilleure.allege ?? 0) / 100,
    centre: { x: a.x + (b.x - a.x) * meilleure.position, y: a.y + (b.y - a.y) * meilleure.position },
    detectee: true, ancrage: anc, ouvertureType: meilleure.type,
  };
}

// Pose d'un volet : si une fenêtre est à portée, le volet se centre dessus (sur la ligne du mur).
export function recentrerVolet(pt: Point, piece: Piece, pieces: Piece[]): Point {
  const baie = baieDuVolet(pt, piece, pieces);
  return baie.detectee ? baie.centre : pt;
}
