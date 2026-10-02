// src/lib/murs.ts
//
// Murs d'une pièce : épaisseurs, doublage, géométrie des couches (plan 2D, impression, vue 3D).
// Convention : le CONTOUR de la pièce est l'AXE de la structure du mur. De l'extérieur vers
// l'intérieur : structure (centrée sur l'axe, épaisseur e) puis doublage (épaisseur d), dont la
// face est la face intérieure FINIE de la pièce. Tout est en mètres sur des Point du plan ;
// les épaisseurs des MurSpec sont en cm.

import { AppareillagePlace, AppareillageType, MurSpec, MUR_DEFAUT, Piece, Point, aireDuPolygone } from "@/lib/maison-types";

export function murDe(piece: Piece, i: number): MurSpec {
  const m = piece.murs?.[i];
  return m ? { ...MUR_DEFAUT, ...m } : { ...MUR_DEFAUT };
}
export function mursDe(piece: Piece): MurSpec[] {
  return piece.contour.map((_, i) => murDe(piece, i));
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

export interface QuadMur {
  i: number; type: MurSpec["type"];
  structure: Point[];            // 4 points : de la face extérieure à la face intérieure de la structure
  doublage: Point[] | null;      // 4 points, ou null s'il n'y a pas de doublage
}
export interface GeometrieMurs {
  quads: QuadMur[];
  utile: Point[];                // contour de la face intérieure finie (surface utile)
  exterieur: Point[];            // contour de la face extérieure de la structure (hors-tout)
}

export function geometrieMurs(piece: Piece): GeometrieMurs {
  const c = piece.contour, n = c.length;
  const specs = mursDe(piece);
  const demi = specs.map(s => s.epaisseur / 200), dbl = specs.map(s => s.doublage / 100);
  const ext = decalerContour(c, demi.map(h => -h));
  const int = decalerContour(c, demi);
  const utile = decalerContour(c, demi.map((h, i) => h + dbl[i]));
  const quads: QuadMur[] = c.map((_, i) => {
    const k = (i + 1) % n;
    return {
      i, type: specs[i].type,
      structure: [ext[i], ext[k], int[k], int[i]],
      doublage: dbl[i] > 0 ? [int[i], int[k], utile[k], utile[i]] : null,
    };
  });
  return { quads, utile, exterieur: ext };
}

// Surface utile (m²) = aire de la face intérieure finie. null si les épaisseurs sont
// incompatibles avec la taille de la pièce (le contour décalé se retourne ou se coupe).
export function surfaceUtile(piece: Piece): number | null {
  const { utile } = geometrieMurs(piece);
  const brute = aireDuPolygone(piece.contour);
  const u = aireDuPolygone(utile);
  if (utile.length < 3 || u <= 0 || u > brute + 1e-9) return null;
  return orientation(utile) === orientation(piece.contour) ? u : null;
}
export function longueurUtileCm(piece: Piece, i: number): number {
  const { utile } = geometrieMurs(piece);
  const a = utile[i], b = utile[(i + 1) % utile.length];
  return Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 100);
}

// Distance (m) de l'axe à la face intérieure FINIE du mur i : là où se posent prises et interrupteurs.
export function faceInterieureM(piece: Piece, i: number): number {
  const s = murDe(piece, i);
  return (s.epaisseur / 2 + s.doublage) / 100;
}
// Épaisseur totale (m) du mur i : structure + doublage.
export function epaisseurTotaleM(piece: Piece, i: number): number {
  const s = murDe(piece, i);
  return (s.epaisseur + s.doublage) / 100;
}

// Découpe d'une ouverture dans TOUTES les épaisseurs du mur i : quadrilatère (monde, mètres) de
// la largeur de l'ouverture, de la face extérieure à la face intérieure finie.
export function decoupeOuverture(piece: Piece, i: number, position: number, largeurCm: number): Point[] {
  const c = piece.contour, n = c.length;
  const a = c[i], b = c[(i + 1) % n];
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const nIn = normaleInterieure(c, i);
  const s = murDe(piece, i);
  const t0 = -s.epaisseur / 200 - 0.005, t1 = (s.epaisseur / 2 + s.doublage) / 100 + 0.005;
  const s0 = position * L - largeurCm / 200, s1 = position * L + largeurCm / 200;
  const P = (ss: number, tt: number): Point => ({ x: a.x + u.x * ss + nIn.x * tt, y: a.y + u.y * ss + nIn.y * tt });
  return [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)];
}

// Paramètres 3D du mur i : sens du côté intérieur par rapport à la normale gauche, épaisseurs en
// mètres, prolongements aux extrémités (moitié de l'épaisseur du mur voisin : comble le coin).
export function parametresMur3D(piece: Piece, i: number) {
  const n = piece.contour.length;
  const s = murDe(piece, i);
  const prec = murDe(piece, (i - 1 + n) % n), suiv = murDe(piece, (i + 1) % n);
  return {
    type: s.type,
    signeInterieur: orientation(piece.contour),   // +1 : l'intérieur est du côté de la normale gauche (-uy, ux)
    e: s.epaisseur / 100, d: s.doublage / 100,
    extDebut: prec.epaisseur / 200, extFin: suiv.epaisseur / 200,
  };
}

// Murs mitoyens : côtés des AUTRES pièces dont les deux extrémités coïncident (au cm près) avec
// le côté i de cette pièce. Une modification d'épaisseur / de type s'y reporte (le doublage, lui,
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

// Applique une nouvelle liste de murs à une pièce et reporte type + épaisseur sur les côtés mitoyens.
export function appliquerMurs(pieces: Piece[], pieceId: number, nouveaux: MurSpec[]): Piece[] {
  const src = pieces.find(p => p.id === pieceId);
  if (!src) return pieces;
  const anciens = mursDe(src);
  let res = pieces.map(p => p.id === pieceId ? { ...p, murs: nouveaux } : p);
  nouveaux.forEach((m, i) => {
    const a = anciens[i];
    if (a && a.type === m.type && a.epaisseur === m.epaisseur) return;
    cotesMitoyens(pieces, pieceId, i).forEach(v => {
      res = res.map(p => {
        if (p.id !== v.pieceId) return p;
        const ms = mursDe(p);
        ms[v.i] = { ...ms[v.i], type: m.type, epaisseur: m.epaisseur };
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
