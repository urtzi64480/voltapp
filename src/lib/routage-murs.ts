// src/lib/routage-murs.ts
//
// TRACÉ DES CÂBLES DANS LES MURS. Un câble encastré ne traverse pas la pièce : il court DANS l'épaisseur des murs, à la profondeur
// où l'on place les câbles (parametresMur3D().profondeurCables, depuis la face finie). Pour chaque pièce on construit donc la
// « ligne des câbles » de chacun de ses murs (contour décalé vers l'intérieur du mur), on relie les murs entre eux (angles, murs
// mitoyens, départs de cloisons) et on cherche le plus court chemin dans ce réseau. Les points de départ et d'arrivée sont ramenés
// sur le mur le plus proche par un tronçon perpendiculaire (la sortie vers la prise, ou la descente vers un point lumineux).
import type { Niveau, Piece, Point } from "@/lib/maison-types";
import { distance, pointDansPolygone } from "@/lib/maison-types";
import { decalerContour, epaisseurTotaleM, parametresMur3D } from "@/lib/murs";

const RAYON_LIAISON = 0.45;  // m — deux lignes de câbles de murs voisins (mitoyens, angles, cloisons) à moins de cela sont reliées
const PORTEE_ANCRE = 1.2;    // m — un point plus loin que cela d'un mur n'est pas rattaché (le tracé direct prend le relais)
const EPS = 1e-6;

interface Mur { p: Point; q: Point; piece: number }
interface Reseau { murs: Mur[]; noeuds: Point[]; voisins: { j: number; d: number }[][]; ligneDe: number[][]; }

const caches = new WeakMap<Piece[], Reseau | null>();

function projeter(pt: Point, a: Point, b: Point): { pt: Point; t: number; d: number } {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / l2));
  const p = { x: a.x + t * dx, y: a.y + t * dy };
  return { pt: p, t, d: Math.hypot(pt.x - p.x, pt.y - p.y) };
}

function intersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < EPS) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den, u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/** Ligne des câbles de chaque mur d'une pièce (contour décalé vers l'intérieur du mur, à la profondeur des câbles). */
function lignesCables(piece: Piece): Point[] {
  const n = piece.contour.length;
  if (n < 3) return [];
  const offsets = piece.contour.map((_, i) => Math.max(0.01, epaisseurTotaleM(piece, i) - parametresMur3D(piece, i).profondeurCables));
  return decalerContour(piece.contour, offsets);
}

function construire(pieces: Piece[]): Reseau | null {
  const murs: Mur[] = [];
  pieces.forEach((pc, k) => {
    const L = lignesCables(pc);
    L.forEach((p, i) => { const q = L[(i + 1) % L.length]; if (distance(p, q) > 0.02) murs.push({ p, q, piece: k }); });
  });
  if (murs.length === 0) return null;
  // points de coupe sur chaque mur : extrémités, croisements, et projection des extrémités des murs voisins
  const coupes: { t: number; pt: Point }[][] = murs.map(m => [{ t: 0, pt: m.p }, { t: 1, pt: m.q }]);
  const liens: [Point, Point][] = [];
  murs.forEach((m, i) => murs.forEach((o, j) => {
    if (i >= j) return;
    const x = intersection(m.p, m.q, o.p, o.q);
    if (x) {
      coupes[i].push({ t: projeter(x, m.p, m.q).t, pt: x });
      coupes[j].push({ t: projeter(x, o.p, o.q).t, pt: x });
    }
    // extrémités proches d'un autre mur (murs mitoyens, cloison qui s'arrête contre un mur) : on y accroche une coupe + un lien
    ([[m, o, i, j], [o, m, j, i]] as const).forEach(([A, B, ia, ib]) => {
      if (A.piece === B.piece && Math.abs(ia - ib) <= 1) return;
      [A.p, A.q].forEach(e => {
        const pr = projeter(e, B.p, B.q);
        if (pr.d > 0.005 && pr.d <= RAYON_LIAISON) { coupes[ib].push({ t: pr.t, pt: pr.pt }); liens.push([e, pr.pt]); }
      });
    });
  }));
  const noeuds: Point[] = [];
  const idx = (p: Point): number => {
    const k = noeuds.findIndex(n => Math.hypot(n.x - p.x, n.y - p.y) < 0.012);
    if (k >= 0) return k;
    noeuds.push(p); return noeuds.length - 1;
  };
  const aretes: [number, number][] = [];
  const ligneDe: number[][] = [];
  murs.forEach((_, i) => {
    const tri = coupes[i].sort((a, b) => a.t - b.t);
    const ids: number[] = [];
    tri.forEach(c => { const k = idx(c.pt); if (ids[ids.length - 1] !== k) ids.push(k); });
    ligneDe.push(ids);
    for (let k = 0; k + 1 < ids.length; k++) aretes.push([ids[k], ids[k + 1]]);
  });
  liens.forEach(([a, b]) => { const u = idx(a), v = idx(b); if (u !== v) aretes.push([u, v]); });
  const voisins = noeuds.map(() => [] as { j: number; d: number }[]);
  aretes.forEach(([u, v]) => { const d = distance(noeuds[u], noeuds[v]); voisins[u].push({ j: v, d }); voisins[v].push({ j: u, d }); });
  return { murs, noeuds, voisins, ligneDe };
}

/** Mur le plus proche d'un point : on privilégie les murs de la pièce qui contient le point. */
function murProche(r: Reseau, pieces: Piece[], pt: Point): { mur: number; pt: Point; t: number } | null {
  const dans = pieces.map(pc => pointDansPolygone(pt, pc.contour));
  let best = -1, note = Infinity, bp: Point = pt, bt = 0;
  for (let i = 0; i < r.murs.length; i++) {
    const m = r.murs[i], pr = projeter(pt, m.p, m.q);
    if (pr.d > PORTEE_ANCRE && !dans[m.piece]) continue;
    const n = pr.d + (dans[m.piece] ? 0 : 0.6);
    if (n < note) { note = n; best = i; bp = pr.pt; bt = pr.t; }
  }
  return best >= 0 ? { mur: best, pt: bp, t: bt } : null;
}

const nettoyer = (pts: Point[]): Point[] => {
  const r: Point[] = [];
  pts.forEach(q => { const d = r[r.length - 1]; if (!d || Math.hypot(q.x - d.x, q.y - d.y) > 0.02) r.push(q); });
  for (let i = r.length - 2; i >= 1; i--) {
    const p = r[i - 1], q = r[i], n = r[i + 1];
    if (Math.abs((q.x - p.x) * (n.y - q.y) - (q.y - p.y) * (n.x - q.x)) < 1e-6) r.splice(i, 1);
  }
  return r;
};

const memo = new WeakMap<Piece[], Map<string, Point[] | null>>();

/** Points de passage INTERMÉDIAIRES d'un câble de a à b en restant dans l'épaisseur des murs ; null = impossible (tracé direct en repli). */
export function routeDansMurs(a: Point, b: Point, pieces: Piece[]): Point[] | null {
  if (pieces.length === 0 || distance(a, b) < 0.05) return [];
  let m = memo.get(pieces);
  if (!m) { m = new Map(); memo.set(pieces, m); }
  const cle = `${a.x.toFixed(3)},${a.y.toFixed(3)}>${b.x.toFixed(3)},${b.y.toFixed(3)}`;
  if (m.has(cle)) return m.get(cle)!;
  let r = caches.get(pieces);
  if (r === undefined) { try { r = construire(pieces); } catch { r = null; } caches.set(pieces, r); }
  const res = r ? calculer(r, pieces, a, b) : null;
  if (m.size > 2000) m.clear();
  m.set(cle, res);
  return res;
}

function calculer(r: Reseau, pieces: Piece[], a: Point, b: Point): Point[] | null {
  const pa = murProche(r, pieces, a), pb = murProche(r, pieces, b);
  if (!pa || !pb) return null;
  const N = r.noeuds.length, iA = N, iB = N + 1;
  const pts = [...r.noeuds, pa.pt, pb.pt];
  // accroche d'un point projeté sur un mur : lien vers les deux nœuds voisins du mur de part et d'autre
  const extra = new Map<number, { j: number; d: number }[]>([[iA, []], [iB, []]]);
  const accrocher = (iP: number, mu: { mur: number; pt: Point; t: number }) => {
    const ids = r.ligneDe[mu.mur];
    const m = r.murs[mu.mur];
    const tOf = (k: number) => projeter(r.noeuds[k], m.p, m.q).t;
    let avant = -1, apres = -1;
    ids.forEach(k => { const t = tOf(k); if (t <= mu.t + 1e-9 && (avant < 0 || t > tOf(avant))) avant = k; if (t >= mu.t - 1e-9 && (apres < 0 || t < tOf(apres))) apres = k; });
    [avant, apres].filter(k => k >= 0).forEach(k => {
      const d = distance(pts[iP], r.noeuds[k]);
      extra.get(iP)!.push({ j: k, d });
      (extra.get(k) ?? extra.set(k, []).get(k)!).push({ j: iP, d });
    });
  };
  accrocher(iA, pa); accrocher(iB, pb);
  if (pa.mur === pb.mur) { const d = distance(pa.pt, pb.pt); extra.get(iA)!.push({ j: iB, d }); extra.get(iB)!.push({ j: iA, d }); }
  const adj = (i: number) => [...(i < N ? r.voisins[i] : []), ...(extra.get(i) ?? [])];
  const dist = new Array(N + 2).fill(Infinity), prev = new Array(N + 2).fill(-1), vu = new Array(N + 2).fill(false);
  dist[iA] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < N + 2; i++) if (!vu[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === iB) break;
    vu[u] = true;
    adj(u).forEach(({ j, d }) => { if (dist[u] + d < dist[j]) { dist[j] = dist[u] + d; prev[j] = u; } });
  }
  if (dist[iB] === Infinity) return null;
  const chemin: Point[] = [];
  for (let k = iB; k >= 0; k = prev[k]) chemin.unshift(pts[k]);
  return nettoyer([a, ...chemin, b]).slice(1, -1);
}

/** Le réseau de murs existe-t-il pour ces pièces ? (sert aux tests) */
export const reseauMurs = (n: Niveau): boolean => !!(caches.get(n.pieces) ?? construire(n.pieces));
