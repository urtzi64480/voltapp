// src/lib/murs.ts
//
// Murs d'une pièce : épaisseurs des couches (structure + doublage) et géométrie (plan 2D, impression, 3D).
//
// RÉFÉRENCE DES DIMENSIONS = LES EXTRÉMITÉS DE LA PIÈCE (faces intérieures finies), jamais le milieu du mur :
//  - mur EXTÉRIEUR (aucune pièce de l'autre côté) : le contour de la pièce EST la face intérieure finie ;
//    les couches s'ajoutent vers l'extérieur : doublage (contre la pièce), puis structure.
//  - mur MITOYEN (une autre pièce de l'autre côté, dessinée contre celle-ci) : le contour est l'axe de la
//    cloison partagée, la structure est centrée dessus et chaque pièce a son doublage de son côté.
// Toutes les dimensions affichées ou saisies (longueur d'un mur, largeur / longueur, surface) sont des
// dimensions UTILES, face finie à face finie ; la conversion vers le contour est faite ici.
// Tout est en mètres sur des Point du plan ; les épaisseurs des MurSpec sont en cm.

import { AppareillagePlace, AppareillageType, MurSpec, MurType, MUR_DEFAUT, Piece, Point, aireDuPolygone } from "@/lib/maison-types";

export function murDe(piece: Piece, i: number): MurSpec {
  const m = piece.murs?.[i];
  return m ? { ...MUR_DEFAUT, epaisseur: m.epaisseur, doublage: m.doublage, finition: m.finition ?? 0 } : { ...MUR_DEFAUT };
}
export function mursDe(piece: Piece): MurSpec[] {
  return piece.contour.map((_, i) => murDe(piece, i));
}

// ─── Mur extérieur ou mitoyen ? ───────────────────────────────────────────────────
// Déduit de la géométrie : un côté dont l'autre face touche une AUTRE pièce est mitoyen. Calculé pour
// l'ensemble des pièces d'un niveau (preparerMurs, à appeler une fois par rendu avant de dessiner) et
// mémorisé par objet pièce ; une pièce non préparée est considérée comme entièrement extérieure.
const MITOYENS = new WeakMap<object, boolean[]>();
export function preparerMurs(pieces: Piece[]): void {
  pieces.forEach(p => MITOYENS.set(p, p.contour.map((_, i) => cotesMitoyens(pieces, p.id, i).length > 0)));
}
export function definirMitoyens(piece: Piece, flags: boolean[]): void { MITOYENS.set(piece, flags); }
export function mitoyensDe(piece: Piece): boolean[] {
  return MITOYENS.get(piece) ?? piece.contour.map(() => false);
}
export function typeMur(piece: Piece, i: number): MurType {
  return mitoyensDe(piece)[i] ? "interieur" : "exterieur";
}

// Sens de rotation du contour (>0 : l'intérieur est à GAUCHE de chaque côté, en repère x,y).
function orientation(contour: Point[]): number {
  let a = 0;
  for (let i = 0; i < contour.length; i++) {
    const p = contour[i], q = contour[(i + 1) % contour.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a >= 0 ? 1 : -1;
}

// Normale unitaire du côté i, orientée vers l'INTÉRIEUR de la pièce (fiable aussi en L / concave).
export function normaleInterieure(contour: Point[], i: number): Point {
  const a = contour[i], b = contour[(i + 1) % contour.length];
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const s = orientation(contour);
  return { x: -(b.y - a.y) / l * s, y: (b.x - a.x) / l * s };
}

// Contour décalé : le côté i est déplacé de offsets[i] (m) vers l'intérieur (négatif = vers
// l'extérieur). Les sommets sont les intersections des côtés décalés (angles « d'onglet »), donc
// des murs d'épaisseurs différentes se raccordent proprement. Onglet limité sur les angles très aigus.
export function decalerContour(contour: Point[], offsets: number[]): Point[] {
  const n = contour.length;
  const normales = contour.map((_, i) => normaleInterieure(contour, i));
  const dirs = contour.map((a, i) => {
    const b = contour[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  });
  return contour.map((v, i) => {
    const j = (i - 1 + n) % n;
    const p1 = { x: contour[j].x + normales[j].x * offsets[j], y: contour[j].y + normales[j].y * offsets[j] };
    const p2 = { x: v.x + normales[i].x * offsets[i], y: v.y + normales[i].y * offsets[i] };
    const d1 = dirs[j], d2 = dirs[i];
    const den = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(den) < 1e-6) return p2; // côtés alignés : simple décalage
    const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
    const P = { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
    const maxOff = Math.max(Math.abs(offsets[j]), Math.abs(offsets[i]), 1e-6);
    const dist = Math.hypot(P.x - v.x, P.y - v.y);
    if (dist > maxOff * 4) { const k = (maxOff * 4) / dist; return { x: v.x + (P.x - v.x) * k, y: v.y + (P.y - v.y) * k }; }
    return P;
  });
}


// Positions (m, vers l'INTÉRIEUR de la pièce, depuis la ligne du contour) des faces du mur i, de l'extérieur à
// l'intérieur : exterieure (face externe de la structure) · structureInt · doublageInt (face interne du
// doublage = face externe de la finition) · utile (face intérieure FINIE, après les 3 couches).
function plansMur(piece: Piece, i: number): { exterieure: number; structureInt: number; doublageInt: number; utile: number } {
  const m = murDe(piece, i), e = m.epaisseur / 100, d = m.doublage / 100, f = (m.finition ?? 0) / 100;
  return mitoyensDe(piece)[i]
    ? { exterieure: -e / 2, structureInt: e / 2, doublageInt: e / 2 + d, utile: e / 2 + d + f }
    : { exterieure: -(f + d + e), structureInt: -(f + d), doublageInt: -f, utile: 0 };
}

export interface QuadMur {
  i: number; type: MurType;
  structure: Point[];            // couche 3 : 4 points, de la face extérieure à la face intérieure de la structure
  doublage: Point[] | null;      // couche 2 : 4 points, ou null si l'épaisseur est nulle
  finition: Point[] | null;      // couche 1 : 4 points, ou null si l'épaisseur est nulle
}
export interface GeometrieMurs {
  quads: QuadMur[];
  utile: Point[];                // contour de la face intérieure finie (surface utile)
  exterieur: Point[];            // contour de la face extérieure de la structure (hors-tout)
}

export function geometrieMurs(piece: Piece): GeometrieMurs {
  const c = piece.contour, n = c.length;
  const plans = c.map((_, i) => plansMur(piece, i));
  const ext = decalerContour(c, plans.map(p => p.exterieure));
  const int = decalerContour(c, plans.map(p => p.structureInt));
  const dbl = decalerContour(c, plans.map(p => p.doublageInt));
  const utile = decalerContour(c, plans.map(p => p.utile));
  const quads: QuadMur[] = c.map((_, i) => {
    const k = (i + 1) % n;
    const m = murDe(piece, i);
    return {
      i, type: typeMur(piece, i),
      structure: [ext[i], ext[k], int[k], int[i]],
      doublage: m.doublage > 0 ? [int[i], int[k], dbl[k], dbl[i]] : null,
      finition: (m.finition ?? 0) > 0 ? [dbl[i], dbl[k], utile[k], utile[i]] : null,
    };
  });
  return { quads, utile, exterieur: ext };
}

// Surface utile (m²) = aire de la face intérieure finie. null si les épaisseurs sont incompatibles avec
// la taille de la pièce (le contour décalé se retourne ou se coupe).
export function surfaceUtile(piece: Piece): number | null {
  const { utile } = geometrieMurs(piece);
  const brute = aireDuPolygone(piece.contour);
  const u = aireDuPolygone(utile);
  if (utile.length < 3 || u <= 0 || u > brute + 1e-9 + 4 * Math.max(...piece.contour.map((_, i) => Math.abs(plansMur(piece, i).exterieure)))) return null;
  return orientation(utile) === orientation(piece.contour) ? u : null;
}
export function longueurUtileCm(piece: Piece, i: number): number {
  const { utile } = geometrieMurs(piece);
  const a = utile[i], b = utile[(i + 1) % utile.length];
  return Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 100);
}
export function longueursUtilesCm(piece: Piece): number[] {
  return piece.contour.map((_, i) => longueurUtileCm(piece, i));
}

// Distance (m) du contour à la face intérieure FINIE du mur i : là où se posent prises et interrupteurs
// (0 sur un mur extérieur, puisque le contour est déjà la face finie).
export function faceInterieureM(piece: Piece, i: number): number {
  return plansMur(piece, i).utile;
}
// Épaisseur totale (m) du mur i : structure + doublage.
export function epaisseurTotaleM(piece: Piece, i: number): number {
  const m = murDe(piece, i);
  return (m.epaisseur + m.doublage + (m.finition ?? 0)) / 100;
}

// Découpe d'une ouverture dans TOUTES les épaisseurs du mur i : quadrilatère (monde, mètres) de la
// largeur de l'ouverture, de la face extérieure à la face intérieure finie.
export function decoupeOuverture(piece: Piece, i: number, position: number, largeurCm: number): Point[] {
  const c = piece.contour, n = c.length;
  const a = c[i], b = c[(i + 1) % n];
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const nIn = normaleInterieure(c, i);
  const pl = plansMur(piece, i);
  const t0 = pl.exterieure - 0.005, t1 = pl.utile + 0.005;
  const s0 = position * L - largeurCm / 200, s1 = position * L + largeurCm / 200;
  const P = (ss: number, tt: number): Point => ({ x: a.x + u.x * ss + nIn.x * tt, y: a.y + u.y * ss + nIn.y * tt });
  return [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)];
}

// Paramètres 3D du mur i : une entrée par COUCHE non nulle (structure, doublage, finition). decalage = position du
// centre de la couche, le long de la normale GAUCHE du côté (-uy, ux), celle des boîtes de mur de la vue 3D.
// extDebut / extFin = prolongement aux extrémités pour combler le coin avec un mur voisin extérieur (la couche
// déborde jusqu'à la face de la MÊME couche du voisin). reduction = hauteur retranchée aux couches intérieures
// pour éviter les scintillements là où elles se recouvrent. profondeurCables = distance de la face finie au
// milieu de la couche 2 : c'est là que passent par défaut les circuits encastrés.
export type CoucheMur3D = { nom: "structure" | "doublage" | "finition"; epaisseur: number; decalage: number; extDebut: number; extFin: number; reduction: number };
export function parametresMur3D(piece: Piece, i: number) {
  const n = piece.contour.length;
  const m = murDe(piece, i), e = m.epaisseur / 100, d = m.doublage / 100, f = (m.finition ?? 0) / 100;
  const pl = plansMur(piece, i);
  const sg = orientation(piece.contour);
  const prec = (i - 1 + n) % n, suiv = (i + 1) % n;
  const mit = mitoyensDe(piece);
  const coin = (j: number) => !mit[i] && !mit[j];
  // distance (m, vers l'extérieur) de la face externe d'une couche, pour le mur j
  const extStructure = (j: number) => -plansMur(piece, j).exterieure;
  const extDoublage = (j: number) => -plansMur(piece, j).structureInt;    // face externe du doublage = f + d
  const extFinition = (j: number) => -plansMur(piece, j).doublageInt;      // face externe de la finition = f
  const couches: CoucheMur3D[] = [];
  couches.push({
    nom: "structure", epaisseur: e, decalage: sg * (pl.exterieure + pl.structureInt) / 2, reduction: 0,
    extDebut: coin(prec) ? extStructure(prec) : (mit[prec] && !mit[i] ? murDe(piece, prec).epaisseur / 200 : 0),
    extFin: coin(suiv) ? extStructure(suiv) : (mit[suiv] && !mit[i] ? murDe(piece, suiv).epaisseur / 200 : 0),
  });
  if (d > 0) couches.push({
    nom: "doublage", epaisseur: d, decalage: sg * (pl.structureInt + pl.doublageInt) / 2, reduction: 0.003,
    extDebut: coin(prec) ? Math.max(0, extDoublage(prec)) : 0, extFin: coin(suiv) ? Math.max(0, extDoublage(suiv)) : 0,
  });
  if (f > 0) couches.push({
    nom: "finition", epaisseur: f, decalage: sg * (pl.doublageInt + pl.utile) / 2, reduction: 0.006,
    extDebut: coin(prec) ? Math.max(0, extFinition(prec)) : 0, extFin: coin(suiv) ? Math.max(0, extFinition(suiv)) : 0,
  });
  return {
    type: typeMur(piece, i),
    signeInterieur: sg,
    e, d, f,
    couches,
    profondeurCables: d > 0 ? f + d / 2 : f + 0.02,   // m, de la face finie vers l'intérieur du mur
  };
}

// Murs mitoyens : côtés des AUTRES pièces dont les deux extrémités coïncident (au cm près) avec
// le côté i de cette pièce. Une modification d'épaisseur de structure s'y reporte (le doublage, lui,
// reste propre à chaque pièce : il est du côté intérieur de chacune).
export function cotesMitoyens(pieces: Piece[], pieceId: number, i: number): { pieceId: number; i: number }[] {
  const src = pieces.find(p => p.id === pieceId);
  if (!src) return [];
  const a = src.contour[i], b = src.contour[(i + 1) % src.contour.length];
  const proche = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < 0.03;
  const res: { pieceId: number; i: number }[] = [];
  pieces.forEach(p => {
    if (p.id === pieceId) return;
    p.contour.forEach((c, j) => {
      const d = p.contour[(j + 1) % p.contour.length];
      if ((proche(a, c) && proche(b, d)) || (proche(a, d) && proche(b, c))) res.push({ pieceId: p.id, i: j });
    });
  });
  return res;
}

// Applique une nouvelle liste de murs à une pièce et reporte l'épaisseur de structure sur les côtés mitoyens.
export function appliquerMurs(pieces: Piece[], pieceId: number, nouveaux: MurSpec[]): Piece[] {
  const src = pieces.find(p => p.id === pieceId);
  if (!src) return pieces;
  const anciens = mursDe(src);
  let res = pieces.map(p => p.id === pieceId ? { ...p, murs: nouveaux } : p);
  nouveaux.forEach((m, i) => {
    const a = anciens[i];
    if (a && a.epaisseur === m.epaisseur) return;
    cotesMitoyens(pieces, pieceId, i).forEach(v => {
      res = res.map(p => {
        if (p.id !== v.pieceId) return p;
        const ms = mursDe(p);
        ms[v.i] = { ...ms[v.i], epaisseur: m.epaisseur };
        return { ...p, murs: ms };
      });
    });
  });
  return res;
}

// Suppression du sommet `index` : le côté `index` disparaît, celui d'avant s'étend jusqu'au sommet suivant.
export function murAfterSuppressionSommet(murs: MurSpec[] | undefined, index: number): MurSpec[] | undefined {
  return murs ? murs.filter((_, i) => i !== index) : undefined;
}

// Hauteur d'installation par défaut (mètres) quand l'appareillage n'a pas de hauteur saisie.
export const HAUTEUR_DEFAUT: Partial<Record<AppareillageType, number>> = {
  prise: 0.3, prise_commandee: 0.3,
  interrupteur: 1.1, va_et_vient: 1.1, telerupteur: 1.1,
  applique: 1.8,
  four: 0.6, plaque: 0.9, lave_linge: 0.85, lave_vaisselle: 0.85, seche_linge: 0.85,
  chauffe_eau: 1.8, chauffage: 0.3, clim: 2.0, seche_serviette: 1.2, congelateur: 0.85,
  irve: 1.0, piscine: 0.3, vmc: 2.2, alarme: 2.0,
  volet_roulant: 2.15, // centre du coffre, juste sous le plafond (le tablier descend en dessous)
};

// Hauteur d'installation (m) d'un appareillage : valeur saisie, sinon valeur par défaut de son type.
export function hauteurAppareilM(a: AppareillagePlace): number {
  return a.hauteur != null ? a.hauteur / 100 : (HAUTEUR_DEFAUT[a.type] ?? 1.0);
}

// ─── Câbles encastrés : par défaut dans la COUCHE 2 du mur qu'ils longent ──────────────────────────
// Si un point est proche d'un mur (à moins de `tol` m de sa face finie côté pièce, ou dans son épaisseur),
// renvoie ce mur et le point ramené au MILIEU DE LA COUCHE 2 (le doublage), là où passent les circuits
// encastrés. Deux extrémités d'une section qui renvoient le MÊME mur = la section longe ce mur.
export function pointDansCouche2(pieces: Piece[], pt: Point, tol = 0.35): { pieceId: number; i: number; point: Point } | null {
  let meilleur: { pieceId: number; i: number; point: Point; d: number } | null = null;
  for (const p of pieces) {
    const { utile } = geometrieMurs(p);
    const n = p.contour.length;
    for (let i = 0; i < n; i++) {
      const A = utile[i], B = utile[(i + 1) % n];
      const L = Math.hypot(B.x - A.x, B.y - A.y);
      if (L < 1e-6) continue;
      const u = { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
      const t = (pt.x - A.x) * u.x + (pt.y - A.y) * u.y;
      if (t < -0.05 || t > L + 0.05) continue;
      const nIn = normaleInterieure(p.contour, i);
      const dIn = (pt.x - A.x) * nIn.x + (pt.y - A.y) * nIn.y;        // > 0 : côté pièce
      if (dIn > tol || dIn < -epaisseurTotaleM(p, i)) continue;
      if (!meilleur || Math.abs(dIn) < meilleur.d) {
        const prof = parametresMur3D(p, i).profondeurCables;
        const tt = Math.max(0, Math.min(L, t));
        meilleur = { pieceId: p.id, i, d: Math.abs(dIn), point: { x: A.x + u.x * tt - nIn.x * prof, y: A.y + u.y * tt - nIn.y * prof } };
      }
    }
  }
  return meilleur ? { pieceId: meilleur.pieceId, i: meilleur.i, point: meilleur.point } : null;
}
