// src/lib/cotes-archi.ts
//
// Cotes d'architecte sur demande : chaîne de cotes des OUVERTURES (coin → baie → baie → coin, le long
// de la face intérieure), cotes EXTÉRIEURES des murs et cote HORS-TOUT du bâtiment. Géométrie pure en
// mètres ; l'affichage est le même que les autres cotes (CoteSvg / coteSvgString).

import { Piece, Point, ouverturesEffectivesMur } from "@/lib/maison-types";
import { geometrieMurs, typeMur, normaleInterieure } from "@/lib/murs";
import { Cote } from "@/lib/appareillage-mur";

const RANG_OUVERTURES = 2;   // couloir intérieur le plus éloigné (au-delà des cotes de pièce)
const RANG_EXTERIEUR = 1;
const RANG_HORS_TOUT = 3;

// Chaîne de cotes de chaque mur percé : distance du coin à la 1re baie, largeur de chaque baie, entre-baies, dernière baie → coin.
// Mesurée sur la face intérieure FINIE (ce que l'on relève sur place).
export function cotesOuvertures(piece: Piece, pieces: Piece[]): Cote[] {
  const c = piece.contour, n = c.length;
  const { utile, utileFin } = geometrieMurs(piece);
  const out: Cote[] = [];
  c.forEach((a, i) => {
    const ops = ouverturesEffectivesMur(pieces, piece, i);
    if (ops.length === 0) return;
    const b = c[(i + 1) % n];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-6) return;
    const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    const Au = utile[i], Bu = utileFin[i];
    const Lu = Math.hypot(Bu.x - Au.x, Bu.y - Au.y);
    if (Lu < 1e-6) return;
    const uu = { x: (Bu.x - Au.x) / Lu, y: (Bu.y - Au.y) / Lu };
    const t0 = (Au.x - a.x) * u.x + (Au.y - a.y) * u.y;               // décalage axe → coin intérieur
    const clamp = (v: number) => Math.max(0, Math.min(Lu, v));
    const bornes = ops
      .map(o => ({ s0: clamp(o.position * L - o.largeur / 200 - t0), s1: clamp(o.position * L + o.largeur / 200 - t0) }))
      .sort((p, q) => p.s0 - q.s0);
    const pts = [0];
    bornes.forEach(v => { pts.push(v.s0, v.s1); });
    pts.push(Lu);
    for (let k = 0; k < pts.length - 1; k++) {
      const d = pts[k + 1] - pts[k];
      if (d * 100 < 1) continue;
      out.push({
        kind: "mur", valeurCm: Math.round(d * 100),
        a: { x: Au.x + uu.x * pts[k], y: Au.y + uu.y * pts[k] },
        b: { x: Au.x + uu.x * pts[k + 1], y: Au.y + uu.y * pts[k + 1] },
        normale: normaleInterieure(c, i), interieur: true, decalageM: 0, rang: RANG_OUVERTURES,
      });
    }
  });
  return out;
}

// Longueur de chaque mur EXTÉRIEUR mesurée sur sa face extérieure, ligne de cote hors du bâtiment.
export function cotesExterieures(pieces: Piece[]): Cote[] {
  const out: Cote[] = [];
  pieces.forEach(p => {
    const { exterieur } = geometrieMurs(p);
    p.contour.forEach((_, i) => {
      if (typeMur(p, i) !== "exterieur") return;
      const a = exterieur[i], b = exterieur[(i + 1) % exterieur.length];
      out.push({
        kind: "mur", a, b, valeurCm: Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 100),
        normale: normaleInterieure(p.contour, i), decalageM: 0, rang: RANG_EXTERIEUR,
      });
    });
  });
  return out;
}

// Dimensions hors-tout du bâtiment (largeur en bas, hauteur à droite) : emprise de toutes les faces extérieures.
export function coteHorsTout(pieces: Piece[]): Cote[] {
  const pts: Point[] = pieces.flatMap(p => geometrieMurs(p).exterieur);
  if (pts.length === 0) return [];
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
  return [
    { kind: "mur", a: { x: minX, y: maxY }, b: { x: maxX, y: maxY }, valeurCm: Math.round((maxX - minX) * 100), normale: { x: 0, y: -1 }, decalageM: 0, rang: RANG_HORS_TOUT },
    { kind: "mur", a: { x: maxX, y: minY }, b: { x: maxX, y: maxY }, valeurCm: Math.round((maxY - minY) * 100), normale: { x: -1, y: 0 }, decalageM: 0, rang: RANG_HORS_TOUT },
  ];
}
