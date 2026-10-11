// src/lib/routage-circuits.ts
//
// ROUTAGE AUTOMATIQUE DES CÂBLES À L'INTÉRIEUR DU BÂTI. Un segment de circuit est une droite entre deux ancres ; sur un plan
// complexe (pièces en L, plusieurs ailes, cour intérieure…), cette droite sort du bâti et traverse du vide. Ici, quand la droite
// n'est pas entièrement dans l'emprise des pièces, on la remplace par le plus court chemin qui reste dans les pièces
// (graphe de visibilité entre les sommets des pièces, décalés vers l'intérieur). Les coudes posés à la main restent prioritaires.
import type { LiaisonWaypoint, Niveau, Piece, Point, SegmentCircuit } from "@/lib/maison-types";
import { cleSegmentLiaison, distance, pointDansPolygone } from "@/lib/maison-types";

const TOLERANCE_MUR = 0.2;   // m — l'épaisseur de mur entre deux pièces voisines compte comme « dedans »
const DECALAGE_SOMMET = 0.15; // m — les sommets de routage sont rentrés dans la pièce
const PAS_ECHANTILLON = 0.1;  // m

function distanceAuSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function dansPiece(p: Point, piece: Piece): boolean {
  if (pointDansPolygone(p, piece.contour)) return true;
  const c = piece.contour;
  for (let i = 0; i < c.length; i++) if (distanceAuSegment(p, c[i], c[(i + 1) % c.length]) <= TOLERANCE_MUR) return true;
  return false;
}

interface Graphe {
  pieces: Piece[];
  noeuds: Point[];
  voisins: { j: number; d: number }[][];
  routes: Map<string, Point[]>;
}

const caches = new WeakMap<Piece[], Graphe>();

function dansEmprise(g: Graphe, p: Point): boolean { return g.pieces.some(pc => dansPiece(p, pc)); }

function degage(g: Graphe, a: Point, b: Point): boolean {
  const L = distance(a, b);
  const n = Math.max(1, Math.ceil(L / PAS_ECHANTILLON));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (!dansEmprise(g, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
  }
  return true;
}

function construireGraphe(pieces: Piece[]): Graphe {
  const g: Graphe = { pieces, noeuds: [], voisins: [], routes: new Map() };
  pieces.forEach(pc => {
    const c = pc.contour, n = c.length;
    for (let i = 0; i < n; i++) {
      const p = c[i], prev = c[(i + n - 1) % n], next = c[(i + 1) % n];
      const u1 = { x: p.x - prev.x, y: p.y - prev.y }, u2 = { x: next.x - p.x, y: next.y - p.y };
      const l1 = Math.hypot(u1.x, u1.y) || 1, l2 = Math.hypot(u2.x, u2.y) || 1;
      // normales (gauche) de chaque arête, somme = bissectrice ; on garde le signe qui rentre dans la pièce
      const bx = -u1.y / l1 + -u2.y / l2, by = u1.x / l1 + u2.x / l2, lb = Math.hypot(bx, by);
      if (lb < 1e-6) continue;
      const cand = [1, -1].map(s => ({ x: p.x + (s * bx / lb) * DECALAGE_SOMMET, y: p.y + (s * by / lb) * DECALAGE_SOMMET }));
      const dedans = cand.find(q => pointDansPolygone(q, c));
      if (dedans) g.noeuds.push(dedans);
    }
  });
  g.voisins = g.noeuds.map(() => []);
  for (let i = 0; i < g.noeuds.length; i++) {
    for (let j = i + 1; j < g.noeuds.length; j++) {
      if (degage(g, g.noeuds[i], g.noeuds[j])) {
        const d = distance(g.noeuds[i], g.noeuds[j]);
        g.voisins[i].push({ j, d }); g.voisins[j].push({ j: i, d });
      }
    }
  }
  return g;
}

/** Points de passage INTERMÉDIAIRES (hors départ et arrivée) pour aller de a à b sans quitter les pièces ; [] = ligne droite. */
export function routeDansPieces(a: Point, b: Point, pieces: Piece[]): Point[] {
  if (pieces.length === 0 || distance(a, b) < 0.05) return [];
  let g = caches.get(pieces);
  if (!g) { g = construireGraphe(pieces); caches.set(pieces, g); }
  const cle = `${a.x.toFixed(3)},${a.y.toFixed(3)}>${b.x.toFixed(3)},${b.y.toFixed(3)}`;
  const memo = g.routes.get(cle);
  if (memo) return memo;
  const res = calculerRoute(g, a, b);
  if (g.routes.size > 2000) g.routes.clear();
  g.routes.set(cle, res);
  return res;
}

function calculerRoute(g: Graphe, a: Point, b: Point): Point[] {
  // Extrémité hors de toute pièce (boîte implicite, tableau extérieur…) : on ne sait pas router, ligne droite.
  if (!dansEmprise(g, a) || !dansEmprise(g, b)) return [];
  if (degage(g, a, b)) return [];
  const N = g.noeuds.length, iA = N, iB = N + 1;
  const pts = [...g.noeuds, a, b];
  const adj = (i: number): { j: number; d: number }[] => {
    if (i < N) {
      const l = [...g.voisins[i]];
      if (degage(g, pts[i], a)) l.push({ j: iA, d: distance(pts[i], a) });
      if (degage(g, pts[i], b)) l.push({ j: iB, d: distance(pts[i], b) });
      return l;
    }
    const l: { j: number; d: number }[] = [];
    for (let k = 0; k < N; k++) if (degage(g, pts[i], pts[k])) l.push({ j: k, d: distance(pts[i], pts[k]) });
    return l;
  };
  const dist = new Array(N + 2).fill(Infinity), prev = new Array(N + 2).fill(-1), vu = new Array(N + 2).fill(false);
  dist[iA] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < N + 2; i++) if (!vu[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === iB) break;
    vu[u] = true;
    adj(u).forEach(({ j, d }) => { if (dist[u] + d < dist[j]) { dist[j] = dist[u] + d; prev[j] = u; } });
  }
  if (dist[iB] === Infinity) return []; // aucun chemin intérieur : on garde la droite
  const chemin: Point[] = [];
  for (let k = prev[iB]; k >= 0 && k !== iA; k = prev[k]) chemin.unshift(pts[k]);
  return chemin;
}

/** Coudes effectifs d'un segment : ceux posés à la main s'il y en a, sinon le routage automatique dans les pièces. */
export function coudesSegment(niveau: Niveau, seg: SegmentCircuit): LiaisonWaypoint[] {
  const manuels = niveau.liaisonWaypoints?.[cleSegmentLiaison(seg.aId, seg.bId)];
  if (manuels && manuels.length > 0) return manuels;
  if (seg.type === "domotique") return [];
  return routeDansPieces(seg.aPoint, seg.bPoint, niveau.pieces).map((point, i) => ({ id: -(i + 1), point }));
}
