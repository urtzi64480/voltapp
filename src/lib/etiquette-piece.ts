// src/lib/etiquette-piece.ts
//
// Placement automatique de l'étiquette d'une pièce (nom + surface) sur le plan : au centre si
// l'endroit est libre, sinon au point de la pièce le plus proche du centre qui n'est recouvert
// par aucun obstacle (appareillage, meuble, tableau, débattement de porte). Fonction pure,
// dans n'importe quel repère (pixels écran pour le plan, pixels d'impression pour l'export).

import { Point, pointDansPolygone } from "@/lib/maison-types";

export interface RectPx { x: number; y: number; w: number; h: number; }

export function carreAutour(c: Point, demi: number): RectPx {
  return { x: c.x - demi, y: c.y - demi, w: demi * 2, h: demi * 2 };
}

function aireIntersection(a: RectPx, b: RectPx): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// poly : contour de la pièce dans le même repère que centre/obstacles ; taille : encombrement
// de l'étiquette (nom + surface). Renvoie le CENTRE de l'étiquette.
export function placerEtiquettePiece(
  poly: Point[], centre: Point, taille: { w: number; h: number }, obstacles: RectPx[],
): Point {
  const { w, h } = taille;
  const rect = (c: Point): RectPx => ({ x: c.x - w / 2, y: c.y - h / 2, w, h });
  // L'étiquette doit tenir entièrement dans la pièce : 4 coins + 4 milieux de côtés testés.
  const dansPiece = (c: Point) => [
    [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0],
  ].every(([sx, sy]) => pointDansPolygone({ x: c.x + sx * w / 2, y: c.y + sy * h / 2 }, poly));
  const cout = (c: Point) => { const r = rect(c); return obstacles.reduce((s, o) => s + aireIntersection(r, o), 0); };

  if (dansPiece(centre) && cout(centre) === 0) return centre;

  const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const N = 18;
  let meilleur: { c: Point; cout: number; d: number } | null = null;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const c = { x: x0 + (x1 - x0) * i / N, y: y0 + (y1 - y0) * j / N };
      if (!dansPiece(c)) continue;
      const k = cout(c), d = Math.hypot(c.x - centre.x, c.y - centre.y);
      // Tolérance : deux recouvrements égaux au flottant près sont à égalité → on prend le plus proche du centre.
      if (!meilleur || k < meilleur.cout - 1e-6 || (Math.abs(k - meilleur.cout) <= 1e-6 && d < meilleur.d)) meilleur = { c, cout: k, d };
    }
  }
  // Rien ne tient dans la pièce (trop petite pour l'étiquette à ce zoom) → centre, comme avant.
  return meilleur ? meilleur.c : centre;
}
