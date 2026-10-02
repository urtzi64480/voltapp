// src/lib/dimensions-piece.ts
//
// Dimensions d'une pièce au centimètre près. Le dessin à la main reste accroché à la grille
// de 10 cm ; ces fonctions servent à AFFINER ensuite, mur par mur, depuis les paramètres de
// la pièce. Fonctions pures sur des contours en mètres.

import { AppareillagePlace, Piece, Point } from "@/lib/maison-types";
import { longueurUtileCm, definirMitoyens, mitoyensDe } from "@/lib/murs";
import { ancrageMurLePlusProche, estMural, TOLERANCE_MUR_M } from "@/lib/appareillage-mur";

export const enCm = (m: number) => Math.round(m * 100);

export function longueursMursCm(contour: Point[]): number[] {
  return contour.map((a, i) => {
    const b = contour[(i + 1) % contour.length];
    return enCm(Math.hypot(b.x - a.x, b.y - a.y));
  });
}

// Rectangle = 4 sommets à angles droits (à ±1° près), orienté comme on veut.
export function estRectangle(contour: Point[]): boolean {
  if (contour.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const p = contour[i], q = contour[(i + 1) % 4], r = contour[(i + 2) % 4];
    const v1 = { x: q.x - p.x, y: q.y - p.y }, v2 = { x: r.x - q.x, y: r.y - q.y };
    const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 1e-6 || l2 < 1e-6) return false;
    if (Math.abs((v1.x * v2.x + v1.y * v2.y) / (l1 * l2)) > 0.02) return false;
  }
  return true;
}

// Fixe la longueur du mur segIndex (mètres). Le sommet de départ du mur reste fixe ; le sommet
// d'arrivée avance ou recule le long du mur. Si le mur SUIVANT lui est perpendiculaire (cas des
// pièces droites : rectangle, L, T…), on pousse aussi son autre extrémité du même décalage :
// les angles droits sont conservés, la pièce reste « d'équerre ». Sinon (mur oblique, pan
// coupé…), seul le sommet d'arrivée bouge, comme avant.
export function redimensionnerMur(contour: Point[], segIndex: number, nouvelleLongueurM: number): Point[] {
  const n = contour.length;
  const a = contour[segIndex], b = contour[(segIndex + 1) % n], c = contour[(segIndex + 2) % n];
  if (!a || !b || !(nouvelleLongueurM > 0)) return contour;
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 1e-6) return contour;
  const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
  const delta = nouvelleLongueurM - L;
  const dx = ux * delta, dy = uy * delta;
  const Lc = Math.hypot(c.x - b.x, c.y - b.y);
  const suivantPerpendiculaire = n > 3 && Lc > 1e-6 && Math.abs(((c.x - b.x) * ux + (c.y - b.y) * uy) / Lc) < 0.02;
  return contour.map((p, k) =>
    k === (segIndex + 1) % n || (suivantPerpendiculaire && k === (segIndex + 2) % n)
      ? { x: p.x + dx, y: p.y + dy }
      : p);
}

// Quand le contour change, les appareillages posés AU MUR suivent leur mur en gardant leur
// position relative le long de ce mur (ils restent collés au mur déplacé). Les autres
// (plafonniers, éléments libres) ne bougent pas. Les portes/fenêtres, repérées par une
// fraction de la longueur du mur, suivent d'elles-mêmes.
export function reporterAppareillages(ancien: Point[], nouveau: Point[], apps: AppareillagePlace[]): AppareillagePlace[] {
  const n = ancien.length;
  if (nouveau.length !== n) return apps;
  return apps.map(a => {
    if (!estMural(a.type)) return a;
    const anc = ancrageMurLePlusProche({ x: a.x, y: a.y }, ancien);
    if (!anc || anc.distance > TOLERANCE_MUR_M) return a;
    const A0 = ancien[anc.segIndex], B0 = ancien[(anc.segIndex + 1) % n];
    const A1 = nouveau[anc.segIndex], B1 = nouveau[(anc.segIndex + 1) % n];
    const L0 = Math.hypot(B0.x - A0.x, B0.y - A0.y);
    const t = L0 > 1e-6 ? Math.hypot(anc.pied.x - A0.x, anc.pied.y - A0.y) / L0 : 0;
    const nouveauPied = { x: A1.x + t * (B1.x - A1.x), y: A1.y + t * (B1.y - A1.y) };
    const mx = nouveauPied.x - anc.pied.x, my = nouveauPied.y - anc.pied.y;
    return Math.abs(mx) < 1e-9 && Math.abs(my) < 1e-9 ? a : { ...a, x: a.x + mx, y: a.y + my };
  });
}

// Fixe la longueur UTILE (face intérieure finie à face intérieure finie, cm) du mur segIndex : c'est la
// dimension que l'on mesure sur place. Le contour est ajusté en conséquence (sur un mur mitoyen, il est à
// l'axe de la cloison, donc plus long que l'intérieur ; sur un mur extérieur il coïncide avec lui). Deux
// passes pour rester exact quand les angles ne sont pas droits.
export function redimensionnerMurUtile(piece: Piece, segIndex: number, utileCm: number): Point[] {
  let courant = piece;
  for (let k = 0; k < 2; k++) {
    const a = courant.contour[segIndex], b = courant.contour[(segIndex + 1) % courant.contour.length];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const ecartCm = utileCm - longueurUtileCm(courant, segIndex);
    if (ecartCm === 0) break;
    const mitoyens = mitoyensDe(courant);   // le caractère mitoyen ne change pas pendant l'ajustement
    courant = { ...courant, contour: redimensionnerMur(courant.contour, segIndex, L + ecartCm / 100) };
    definirMitoyens(courant, mitoyens);
  }
  return courant.contour;
}

// Les sommets que la pièce partage avec une AUTRE pièce (cloison mitoyenne) suivent quand on les déplace :
// la cloison reste une seule et même cloison, l'enveloppe extérieure du bâtiment ne bouge pas ailleurs.
// (Les appareillages posés sur les murs de la pièce voisine suivent aussi leur mur.)
export function propagerSommetsPartages(pieces: Piece[], pieceId: number, ancien: Point[], nouveau: Point[]): Piece[] {
  const proche = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < 0.03;
  const deplaces = ancien
    .map((o, i) => ({ o, n: nouveau[i] }))
    .filter(d => d.n && Math.hypot(d.n.x - d.o.x, d.n.y - d.o.y) > 1e-6);
  if (deplaces.length === 0) return pieces;
  return pieces.map(p => {
    if (p.id === pieceId) return p;
    let change = false;
    const contour = p.contour.map(pt => {
      const d = deplaces.find(dd => proche(pt, dd.o));
      if (!d) return pt;
      change = true;
      return { x: d.n.x, y: d.n.y };
    });
    return change ? { ...p, contour, appareillages: reporterAppareillages(p.contour, contour, p.appareillages) } : p;
  });
}
