// src/lib/routage-circuits.ts
//
// ROUTAGE AUTOMATIQUE DES CÂBLES À L'INTÉRIEUR DU BÂTI. Un segment de circuit est une droite entre deux ancres ; sur un plan
// complexe (pièces en L, plusieurs ailes, cour intérieure…), cette droite sort du bâti et traverse du vide. Ici, quand la droite
// n'est pas entièrement dans l'emprise des pièces, on la remplace par le plus court chemin qui reste dans les pièces
// (graphe de visibilité entre les sommets des pièces, décalés vers l'intérieur). Les coudes posés à la main restent prioritaires.
import type { LiaisonWaypoint, Niveau, Piece, Point, SegmentCircuit } from "@/lib/maison-types";
import { routeDansMurs } from "@/lib/routage-murs";
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

// ───────────────────────── Tracé « propre » : des tronçons parallèles aux murs, toujours dans les pièces ─────────────────────────
// Un câble réel court le long des murs (horizontal / vertical, jamais en diagonale à travers la pièce). On travaille dans le repère des murs
// de la pièce de départ (angle de son plus long mur), on essaie d'abord 1 coude (« L »), puis 2 coudes (« Z »), puis une recherche sur grille
// (A*, pénalité par coude) pour les plans en L / à plusieurs ailes. Chaque tronçon est vérifié : jamais hors de l'emprise des pièces.
const PAS_GRILLE = 0.15;     // m
const PENALITE_COUDE = 0.6;  // m équivalents par coude : à longueur proche, on préfère moins de coudes

function angleMurs(piece: Piece | undefined): number {
  const c = piece?.contour ?? [];
  let best = 0, L = -1;
  for (let i = 0; i < c.length; i++) {
    const p = c[i], q = c[(i + 1) % c.length], l = Math.hypot(q.x - p.x, q.y - p.y);
    if (l > L) { L = l; best = Math.atan2(q.y - p.y, q.x - p.x); }
  }
  return best;
}
const versRepere = (p: Point, ang: number): Point => ({ x: p.x * Math.cos(ang) + p.y * Math.sin(ang), y: -p.x * Math.sin(ang) + p.y * Math.cos(ang) });
const depuisRepere = (p: Point, ang: number): Point => ({ x: p.x * Math.cos(ang) - p.y * Math.sin(ang), y: p.x * Math.sin(ang) + p.y * Math.cos(ang) });

const cachesOrtho = new WeakMap<Piece[], Map<string, Point[] | null>>();
interface GrilleOrtho { ang: number; u0: number; v0: number; nu: number; nv: number; libre: Uint8Array }
const cachesGrille = new WeakMap<Piece[], Map<number, GrilleOrtho>>();

function grillePour(g: Graphe, ang: number): GrilleOrtho {
  let m = cachesGrille.get(g.pieces);
  if (!m) { m = new Map(); cachesGrille.set(g.pieces, m); }
  const k = Math.round(ang * 1e6);
  const dej = m.get(k);
  if (dej) return dej;
  const tous = g.pieces.flatMap(pc => pc.contour.map(q => versRepere(q, ang)));
  const u0 = Math.min(...tous.map(q => q.x)) - PAS_GRILLE, v0 = Math.min(...tous.map(q => q.y)) - PAS_GRILLE;
  const nu = Math.ceil((Math.max(...tous.map(q => q.x)) + PAS_GRILLE - u0) / PAS_GRILLE) + 1;
  const nv = Math.ceil((Math.max(...tous.map(q => q.y)) + PAS_GRILLE - v0) / PAS_GRILLE) + 1;
  const libre = new Uint8Array(nu * nv);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++)
    libre[i * nv + j] = dansEmprise(g, depuisRepere({ x: u0 + i * PAS_GRILLE, y: v0 + j * PAS_GRILLE }, ang)) ? 1 : 0;
  const res = { ang, u0, v0, nu, nv, libre };
  if (m.size > 6) m.clear();
  m.set(k, res);
  return res;
}

function jambesLibres(g: Graphe, pts: Point[], ang: number): boolean {
  for (let i = 0; i + 1 < pts.length; i++) if (!degage(g, depuisRepere(pts[i], ang), depuisRepere(pts[i + 1], ang))) return false;
  return true;
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
const longueurPoly = (pts: Point[]) => pts.reduce((t, q, i) => (i ? t + Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y) : 0), 0);

function routeOrthoGrille(g: Graphe, a: Point, b: Point, ang: number): Point[] | null {
  const G = grillePour(g, ang);
  const ci = (p: Point) => Math.max(0, Math.min(G.nu - 1, Math.round((p.x - G.u0) / PAS_GRILLE)));
  const cj = (p: Point) => Math.max(0, Math.min(G.nv - 1, Math.round((p.y - G.v0) / PAS_GRILLE)));
  // cellule libre la plus proche d'une ancre (l'ancre peut être contre un mur)
  const proche = (p: Point): [number, number] | null => {
    const i0 = ci(p), j0 = cj(p);
    for (let r = 0; r <= 4; r++) for (let i = i0 - r; i <= i0 + r; i++) for (let j = j0 - r; j <= j0 + r; j++)
      if (i >= 0 && j >= 0 && i < G.nu && j < G.nv && G.libre[i * G.nv + j]) return [i, j];
    return null;
  };
  const dA = proche(a), dB = proche(b);
  if (!dA || !dB) return null;
  const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const etat = (i: number, j: number, d: number) => (i * G.nv + j) * 4 + d;
  const cout = new Float64Array(G.nu * G.nv * 4).fill(Infinity);
  const prec = new Int32Array(G.nu * G.nv * 4).fill(-1);
  const tas: { e: number; f: number }[] = [];
  const pousser = (e: number, f: number) => { tas.push({ e, f }); let k = tas.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (tas[p].f <= tas[k].f) break; [tas[p], tas[k]] = [tas[k], tas[p]]; k = p; } };
  const tirer = () => { const top = tas[0], dern = tas.pop()!; if (tas.length) { tas[0] = dern; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < tas.length && tas[l].f < tas[m].f) m = l; if (r < tas.length && tas[r].f < tas[m].f) m = r; if (m === k) break; [tas[m], tas[k]] = [tas[k], tas[m]]; k = m; } } return top; };
  const h = (i: number, j: number) => (Math.abs(i - dB[0]) + Math.abs(j - dB[1])) * PAS_GRILLE;
  for (let d = 0; d < 4; d++) { const e = etat(dA[0], dA[1], d); cout[e] = 0; pousser(e, h(dA[0], dA[1])); }
  let fin = -1;
  while (tas.length) {
    const { e } = tirer();
    const d = e % 4, cell = (e - d) / 4, j = cell % G.nv, i = (cell - j) / G.nv;
    if (i === dB[0] && j === dB[1]) { fin = e; break; }
    for (let nd = 0; nd < 4; nd++) {
      const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
      if (ni < 0 || nj < 0 || ni >= G.nu || nj >= G.nv || !G.libre[ni * G.nv + nj]) continue;
      const c = cout[e] + PAS_GRILLE + (nd !== d && cout[e] > 0 ? PENALITE_COUDE : 0);
      const ne = etat(ni, nj, nd);
      if (c < cout[ne]) { cout[ne] = c; prec[ne] = e; pousser(ne, c + h(ni, nj)); }
    }
  }
  if (fin < 0) return null;
  const cells: Point[] = [];
  for (let e = fin; e >= 0; e = prec[e]) { const d = e % 4, cell = (e - d) / 4, j = cell % G.nv, i = (cell - j) / G.nv; cells.unshift({ x: G.u0 + i * PAS_GRILLE, y: G.v0 + j * PAS_GRILLE }); }
  const coins = nettoyer(cells);
  if (coins.length < 2) return null;
  // raccord exact avec les ancres : le premier / dernier tronçon est ramené sur la ligne de l'ancre pour rester parallèle aux murs
  const horizPremier = Math.abs(coins[1].y - coins[0].y) < 1e-6, horizDernier = Math.abs(coins[coins.length - 1].y - coins[coins.length - 2].y) < 1e-6;
  const m = coins.map(q => ({ ...q }));
  if (horizPremier) m[1].y = a.y; else m[1].x = a.x;
  const n = m.length;
  if (horizDernier) m[n - 2].y = b.y; else m[n - 2].x = b.x;
  return nettoyer([a, ...m.slice(1, n - 1), b]);
}

/** Points de passage INTERMÉDIAIRES d'un tracé parallèle aux murs (1 ou 2 coudes de préférence), toujours dans les pièces ; null = pas possible. */
export function routeOrthogonale(a: Point, b: Point, pieces: Piece[]): Point[] | null {
  if (pieces.length === 0 || distance(a, b) < 0.05) return [];
  let memo = cachesOrtho.get(pieces);
  if (!memo) { memo = new Map(); cachesOrtho.set(pieces, memo); }
  const cle = `${a.x.toFixed(3)},${a.y.toFixed(3)}>${b.x.toFixed(3)},${b.y.toFixed(3)}`;
  if (memo.has(cle)) return memo.get(cle)!;
  const g = { pieces, noeuds: [], voisins: [], routes: new Map() } as Graphe;
  const res = calculerOrtho(g, a, b);
  if (memo.size > 2000) memo.clear();
  memo.set(cle, res);
  return res;
}

function calculerOrtho(g: Graphe, a: Point, b: Point): Point[] | null {
  if (!dansEmprise(g, a) || !dansEmprise(g, b)) return null;
  const pa = g.pieces.find(pc => pointDansPolygone(a, pc.contour)) ?? g.pieces.find(pc => dansPiece(a, pc));
  const ang = angleMurs(pa);
  const A = versRepere(a, ang), B = versRepere(b, ang);
  const du = Math.abs(B.x - A.x), dv = Math.abs(B.y - A.y);
  const interieurs = (pts: Point[]) => nettoyer([A, ...pts, B]).slice(1, -1);
  if (du < 0.03 || dv < 0.03) { // déjà aligné sur un mur
    if (degage(g, a, b)) return [];
  }
  const essais: Point[][] = [];
  // 1 coude : le premier tronçon suit d'abord l'axe du plus long mur (u), ou l'autre
  essais.push([{ x: B.x, y: A.y }], [{ x: A.x, y: B.y }]);
  // 2 coudes : tronçon intermédiaire à 50 %, 25 %, 75 % de la course
  [0.5, 0.25, 0.75, 0.1, 0.9].forEach(t => {
    essais.push([{ x: A.x + (B.x - A.x) * t, y: A.y }, { x: A.x + (B.x - A.x) * t, y: B.y }]);
    essais.push([{ x: A.x, y: A.y + (B.y - A.y) * t }, { x: B.x, y: A.y + (B.y - A.y) * t }]);
  });
  const valides = essais.map(interieurs).filter(pts => jambesLibres(g, [A, ...pts, B], ang));
  if (valides.length > 0) {
    // moins de coudes d'abord ; à nombre égal, le plus court (les L ont la même longueur : le premier essai gagne)
    const note = (pts: Point[]) => pts.length * PENALITE_COUDE + longueurPoly([A, ...pts, B]);
    const meilleur = valides.reduce((m, pts) => (note(pts) < note(m) - 1e-9 ? pts : m));
    return meilleur.map(q => depuisRepere(q, ang));
  }
  const grille = routeOrthoGrille(g, A, B, ang);
  if (grille && jambesLibres(g, grille, ang)) return grille.slice(1, -1).map(q => depuisRepere(q, ang));
  return null;
}

/** Coudes effectifs d'un segment : ceux posés à la main s'il y en a, sinon un tracé parallèle aux murs (dans les pièces), sinon le routage direct. */
export function coudesSegment(niveau: Niveau, seg: SegmentCircuit): LiaisonWaypoint[] {
  const manuels = niveau.liaisonWaypoints?.[cleSegmentLiaison(seg.aId, seg.bId)];
  if (manuels && manuels.length > 0) return manuels;
  if (seg.type === "domotique") return [];
  // Éclairage : par le plafond, au PLUS COURT (droite, ou plus court chemin qui reste dans le bâti) — pas de détour par les murs.
  if (seg.plafond) {
    // Juste milieu : on suit les murs (parallèle, angles droits) tant que ça ne rallonge presque pas ; sinon plafond, au plus court.
    const longueur = (pts: Point[]) => pts.reduce((t, q, i) => (i ? t + Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y) : 0), 0);
    const plafond = routeDansPieces(seg.aPoint, seg.bPoint, niveau.pieces);
    const lPlafond = longueur([seg.aPoint, ...plafond, seg.bPoint]);
    const murs = routeDansMurs(seg.aPoint, seg.bPoint, niveau.pieces);
    if (murs && murs.length > 0 && longueur([seg.aPoint, ...murs.map(w => w.point), seg.bPoint]) <= lPlafond * 1.3 + 0.5)
      return murs.map((w, i) => ({ id: -(i + 1), point: w.point, ...(w.hauteurMini != null ? { hauteurMini: w.hauteurMini } : {}) }));
    return plafond.map((point, i) => ({ id: -(i + 1), point }));
  }
  // 1) dans l'épaisseur des murs (câbles encastrés) ; 2) à défaut, parallèle aux murs dans les pièces ; 3) à défaut, tracé direct.
  const murs = routeDansMurs(seg.aPoint, seg.bPoint, niveau.pieces);
  if (murs) return murs.map((w, i) => ({ id: -(i + 1), point: w.point, ...(w.hauteurMini != null ? { hauteurMini: w.hauteurMini } : {}) }));
  const pts = routeOrthogonale(seg.aPoint, seg.bPoint, niveau.pieces) ?? routeDansPieces(seg.aPoint, seg.bPoint, niveau.pieces);
  return pts.map((point, i) => ({ id: -(i + 1), point }));
}
