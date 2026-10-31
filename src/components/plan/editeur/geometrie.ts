// Extrait mécaniquement de src/app/plan/[clientId]/page.tsx (aucun changement de comportement).
import { Point, Piece, Niveau, positionSurSegment, distanceAuSegment } from "@/lib/maison-types";
import { reglageAimant } from "./constantes";

// ─── Alignement automatique des segments sur les murs adjacents ──────────────────────────────────────
// Un sommet qu'on crée ou qu'on déplace s'aligne sur : l'horizontale / la verticale, la parallèle ou la perpendiculaire
// d'un mur voisin (pour chacun des segments qui l'entourent), ou le prolongement d'un mur voisin. Deux contraintes
// compatibles se combinent (le sommet tombe alors à l'intersection exacte).
export type SegRef = { a: Point; b: Point };
export type ResultatAlignMurs = { point: Point; lignes: { q: Point; d: Point }[]; labels: string[] };
export type ContrainteAlign = { q: Point; d: Point; dist: number; label: string };

export function segmentsReferenceNiveau(niveau: Niveau | null, pieceId?: number, sommetIndex?: number): SegRef[] {
  if (!niveau) return [];
  const res: SegRef[] = [];
  niveau.pieces.forEach(pc => {
    const n = pc.contour.length;
    pc.contour.forEach((a, i) => {
      if (pc.id === pieceId && sommetIndex !== undefined && (i === sommetIndex || (i + 1) % n === sommetIndex)) return;
      res.push({ a, b: pc.contour[(i + 1) % n] });
    });
  });
  return res;
}

export function alignerSurMurs(pt: Point, voisins: Point[], refs: SegRef[], seuilM: number): ResultatAlignMurs | null {
  const unite = (a: Point, b: Point) => { const L = Math.hypot(b.x - a.x, b.y - a.y); return L < 0.01 ? null : { x: (b.x - a.x) / L, y: (b.y - a.y) / L }; };
  const proches = refs.filter(r => distanceAuSegment(pt, r.a, r.b) <= 3);
  const dirs: { d: Point; label: string }[] = [
    { d: { x: 1, y: 0 }, label: "Segment horizontal" },
    { d: { x: 0, y: 1 }, label: "Segment vertical" },
  ];
  for (const r of proches) {
    const u = unite(r.a, r.b);
    if (!u) continue;
    dirs.push({ d: u, label: "Segment parallèle au mur adjacent" });
    dirs.push({ d: { x: -u.y, y: u.x }, label: "Segment perpendiculaire au mur adjacent" });
  }
  const contraintes: ContrainteAlign[] = [];
  for (const q of voisins) {
    if (Math.hypot(pt.x - q.x, pt.y - q.y) < 0.05) continue;
    let best: ContrainteAlign | null = null;
    for (const { d, label } of dirs) {
      const dist = Math.abs(d.x * (pt.y - q.y) - d.y * (pt.x - q.x));
      if (dist <= seuilM && (!best || dist < best.dist)) best = { q, d, dist, label };
    }
    if (best) contraintes.push(best);
  }
  let colin: ContrainteAlign | null = null;
  for (const r of proches) {
    const u = unite(r.a, r.b);
    if (!u) continue;
    const dist = Math.abs(u.x * (pt.y - r.a.y) - u.y * (pt.x - r.a.x));
    if (dist <= seuilM && (!colin || dist < colin.dist)) colin = { q: r.a, d: u, dist, label: "Point sur le prolongement du mur adjacent" };
  }
  if (colin) contraintes.push(colin);
  if (contraintes.length === 0) return null;
  contraintes.sort((a, b) => a.dist - b.dist);
  const c1 = contraintes[0], c2 = contraintes[1];
  const t1 = (pt.x - c1.q.x) * c1.d.x + (pt.y - c1.q.y) * c1.d.y;
  let point: Point = { x: c1.q.x + c1.d.x * t1, y: c1.q.y + c1.d.y * t1 };
  const lignes = [{ q: c1.q, d: c1.d }];
  const labels = [c1.label];
  if (c2) {
    const cross = c1.d.x * c2.d.y - c1.d.y * c2.d.x;
    if (Math.abs(cross) > 0.05) {
      const t = ((c2.q.x - c1.q.x) * c2.d.y - (c2.q.y - c1.q.y) * c2.d.x) / cross;
      const inter = { x: c1.q.x + c1.d.x * t, y: c1.q.y + c1.d.y * t };
      if (Math.hypot(inter.x - pt.x, inter.y - pt.y) <= seuilM * 2.5) { point = inter; lignes.push({ q: c2.q, d: c2.d }); labels.push(c2.label); }
    }
  }
  return { point: { x: Number(point.x.toFixed(3)), y: Number(point.y.toFixed(3)) }, lignes, labels };
}

export function rectangleDepuis(a: Point, b: Point): Point[] {
  return [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
}

export function arrondiGrille(v: number, pas: number = reglageAimant.pasM): number {
  return Number((Math.round(v / pas) * pas).toFixed(4));
}

export function pointsReferenceNiveau(niveau: Niveau | null, excludePieceId?: number, excludeIndex?: number): Point[] {
  if (!niveau) return [];
  const pts: Point[] = [];
  niveau.pieces.forEach(p => {
    p.contour.forEach((pt, i) => {
      if (p.id === excludePieceId && i === excludeIndex) return;
      pts.push(pt);
    });
  });
  return pts;
}

// Trouve, sur tout le niveau, le mur (segment de contour d'une pièce) le plus proche
// d'un point cliqué — pour placer une porte/fenêtre dessus. `seuilM` en mètres, sinon null.
export type MeilleurMur = { piece: Piece; segIndex: number; t: number; d: number };
export function trouverMurLePlusProche(pieces: Piece[], pointMonde: Point, seuilM: number): { piece: Piece; segIndex: number; t: number } | null {
  let meilleur: MeilleurMur | null = null;
  pieces.forEach(piece => {
    piece.contour.forEach((a, i) => {
      const b = piece.contour[(i + 1) % piece.contour.length];
      const d = distanceAuSegment(pointMonde, a, b);
      if (!meilleur || d < meilleur.d) meilleur = { piece, segIndex: i, t: positionSurSegment(pointMonde, a, b), d };
    });
  });
  if (!meilleur) return null;
  const m: MeilleurMur = meilleur;
  if (m.d > seuilM) return null;
  return { piece: m.piece, segIndex: m.segIndex, t: m.t };
}

// Recalcule le segIndex d'une ouverture après suppression du sommet `k` (index dans le
// contour AVANT suppression, qui comptait `n` sommets/segments). Le sommet supprimé
// fusionne les deux murs qui s'y rejoignaient (segment k-1, qui se termine sur k, et
// segment k, qui en part) en un seul nouveau mur — toute ouverture posée sur l'un de
// ces deux murs perd son support géométrique d'origine et doit être retirée (null).
// Les autres murs gardent leur géométrie inchangée ; seuls ceux situés après le sommet
// supprimé voient leur index décalé d'un cran vers le bas.
export function remapperSegIndexApresSuppressionSommet(segIndex: number, k: number, n: number): number | null {
  const segAvant = (k - 1 + n) % n;
  if (segIndex === segAvant || segIndex === k) return null;
  return segIndex > k ? segIndex - 1 : segIndex;
}

export interface ResultatSnap { point: Point; guideX?: number; guideY?: number; }

export function snapAvecAlignement(m: Point, candidats: Point[], seuilM: number): ResultatSnap {
  let x = arrondiGrille(m.x);
  let y = arrondiGrille(m.y);
  let guideX: number | undefined;
  let guideY: number | undefined;
  if (!reglageAimant.aimant || reglageAimant.alt) return { point: { x, y } };
  let meilleurDX = seuilM, meilleurDY = seuilM;
  candidats.forEach(c => {
    const dx = Math.abs(c.x - m.x);
    if (dx < meilleurDX) { meilleurDX = dx; x = c.x; guideX = c.x; }
    const dy = Math.abs(c.y - m.y);
    if (dy < meilleurDY) { meilleurDY = dy; y = c.y; guideY = c.y; }
  });
  return { point: { x, y }, guideX, guideY };
}
