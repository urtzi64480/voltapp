// src/lib/regroupement-circuits.ts
//
// REGROUPEMENT PAR ZONES des appareillages en circuits (génération automatique).
//
// Objectif : le MOINS de disjoncteurs possible, sans jamais dépasser les maxima NF C 15-100 d'une famille (8 points
// lumineux, 8 ou 12 socles, 6 socles de cuisine, 4500 W de chauffage…), et avec des circuits COMPACTS dans l'espace —
// ceux qu'un électricien tirerait réellement : pièces voisines (mur mitoyen), une seule zone, jamais deux zones éloignées.
//
// Principe (aucun aléatoire : même plan = même résultat) :
//  1. Distance « de chantier » entre deux points : Manhattan (un câble encastré court à l'orthogonale, dans les murs), plus
//     une pénalité quand il faut changer de pièce sans cloison mitoyenne (détour par un couloir), plus une pénalité de
//     changement de zone (habitable / garage / extérieur).
//  2. Plusieurs constructions candidates (fusion hiérarchique, chaîne coupée, germes de zones), chacune améliorée par
//     recherche locale (déplacements + échanges d'appareillages, dissolution du plus petit circuit).
//  3. On garde la solution qui a le MOINS de circuits, puis le câblage estimé le plus court (arbre couvrant minimal depuis le
//     tableau) et le moins de pièces coupées entre deux circuits.
// Les niveaux ne sont jamais mélangés : l'appelant regroupe niveau par niveau.

import type { Point, Piece } from "./maison-types";

export type ClasseZone = 0 | 1 | 2; // 0 = pièces de vie, 1 = garage / annexe couverte, 2 = extérieur

export interface PointZone { x: number; y: number; pieceId: number; classe: ClasseZone; }
/** Unité indivisible du regroupement : un appareillage, ou plusieurs qui doivent rester ensemble (lampes d'une même commande). */
export interface Atome { points: PointZone[]; poids: number; }

export interface ContexteZones {
  /** Nombre de pièces à franchir de a à b (0 = même pièce, 1 = mur mitoyen) ; -1 = pas de lien connu (extérieur, pièce isolée). */
  sauts(a: number, b: number): number;
  /** La pièce figure-t-elle dans le plan du niveau ? (faux pour la pièce virtuelle « Extérieur »). */
  connue(id: number): boolean;
}

/** Plus long maillon admis entre deux appareillages d'un même circuit (m, distance de chantier). Au-delà, JAMAIS ensemble : un circuit
 *  reste d'un seul tenant, on n'envoie pas un câble à l'autre bout du terrain pour économiser un disjoncteur. 20 m : assez large pour qu'un
 *  logement (même sur un étage entier) ne soit pas éclaté en petits circuits de 4 prises juste parce que deux groupes sont à 10 m l'un de l'autre. */
export const LIEN_MAX_M = 20;

export interface ParamsRegroupement {
  capacite: number;
  tableau?: Point | null;
  /** Nombre minimal de circuits à produire (ex. 2 circuits d'éclairage dans un logement de plus de 35 m²). */
  minCircuits?: number;
  /** Pénalité (m équivalents) par pièce coupée entre deux circuits : plus elle est haute, plus les pièces restent entières. */
  penaliteScission: number;
  /** Équilibrer : à nombre de circuits égal (le minimum), répartir les points aussi équitablement que possible (7 + 7 plutôt que 12 + 2). */
  equilibrer?: boolean;
}

export function classeZoneDe(type: Piece["type"] | string | undefined): ClasseZone {
  if (type === "exterieur") return 2;
  if (type === "garage") return 1;
  return 0;
}

// ─── Pièces voisines (murs mitoyens) ────────────────────────────────────────────────────────────────────────────
function voisines(A: Point[], B: Point[]): boolean {
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i], a2 = A[(i + 1) % A.length];
    const ux = a2.x - a1.x, uy = a2.y - a1.y, la = Math.hypot(ux, uy);
    if (la < 0.1) continue;
    for (let j = 0; j < B.length; j++) {
      const b1 = B[j], b2 = B[(j + 1) % B.length];
      const vx = b2.x - b1.x, vy = b2.y - b1.y, lb = Math.hypot(vx, vy);
      if (lb < 0.1) continue;
      if (Math.abs(ux * vy - uy * vx) / (la * lb) > 0.05) continue;                 // pas parallèles (> ~3°)
      const nx = -uy / la, ny = ux / la;
      if (Math.abs((b1.x - a1.x) * nx + (b1.y - a1.y) * ny) > 0.6) continue;       // plus loin qu'une épaisseur de mur
      const t1 = ((b1.x - a1.x) * ux + (b1.y - a1.y) * uy) / la, t2 = ((b2.x - a1.x) * ux + (b2.y - a1.y) * uy) / la;
      if (Math.min(la, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2)) >= 0.3) return true; // ≥ 30 cm de mur commun
    }
  }
  return false;
}

/** Graphe des pièces d'un niveau (arête = mur mitoyen) et distances en nombre de pièces à franchir. */
export function construireContexteZones(pieces: Pick<Piece, "id" | "contour">[]): ContexteZones {
  const vraies = pieces.filter(p => p.contour.length >= 3);
  const adj = new Map<number, number[]>();
  vraies.forEach(p => adj.set(p.id, []));
  for (let i = 0; i < vraies.length; i++) for (let j = i + 1; j < vraies.length; j++) {
    if (voisines(vraies[i].contour, vraies[j].contour)) { adj.get(vraies[i].id)!.push(vraies[j].id); adj.get(vraies[j].id)!.push(vraies[i].id); }
  }
  const memo = new Map<number, Map<number, number>>();
  const depuis = (s: number): Map<number, number> => {
    let m = memo.get(s);
    if (m) return m;
    m = new Map([[s, 0]]);
    const file = [s];
    for (let k = 0; k < file.length; k++) for (const v of adj.get(file[k]) ?? []) if (!m.has(v)) { m.set(v, m.get(file[k])! + 1); file.push(v); }
    memo.set(s, m);
    return m;
  };
  return { sauts: (a, b) => (a === b ? 0 : adj.has(a) ? (depuis(a).get(b) ?? -1) : -1), connue: id => adj.has(id) };
}

const PEN_CLASSE: number[][] = [[0, 4, 4], [4, 0, 1.5], [4, 1.5, 0]];

function distPoints(a: PointZone, b: PointZone, ctx: ContexteZones): number {
  let d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  if (a.pieceId !== b.pieceId) {
    if (ctx.connue(a.pieceId) && ctx.connue(b.pieceId)) {
      const s = ctx.sauts(a.pieceId, b.pieceId);
      d += s < 0 ? 8 : s <= 1 ? 0 : 1.5 * (s - 1);
    }   // mur mitoyen : on traverse la cloison ; sinon détour par les pièces intermédiaires
  }
  if (a.classe !== b.classe) d += PEN_CLASSE[a.classe][b.classe];
  return d;
}

// ─── Regroupement ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Retourne les circuits sous forme de listes d'indices d'atomes. Chaque circuit pèse au plus `capacite` (un atome plus lourd est seul). */
export function regrouper(atomes: Atome[], ctx: ContexteZones, p: ParamsRegroupement): number[][] {
  const nA = atomes.length;
  if (nA === 0) return [];
  const cap = p.capacite;
  const poids = atomes.map(a => Math.min(a.poids, cap));
  const total = poids.reduce((s, x) => s + x, 0);
  const minC = Math.max(1, Math.min(p.minCircuits ?? 1, nA));
  if (nA === 1) return [[0]];
  if (total <= cap && minC <= 1) return [atomes.map((_, i) => i)];

  // matrice des distances entre tous les points
  const pts: PointZone[] = [], ptsDe: number[][] = [];
  atomes.forEach(a => { ptsDe.push(a.points.map(q => pts.push(q) - 1)); });
  const nP = pts.length;
  const D = new Float64Array(nP * nP);
  for (let i = 0; i < nP; i++) for (let j = i + 1; j < nP; j++) { const d = distPoints(pts[i], pts[j], ctx); D[i * nP + j] = d; D[j * nP + i] = d; }
  const dTab = pts.map(q => (p.tableau ? Math.abs(q.x - p.tableau.x) + Math.abs(q.y - p.tableau.y) : 0));

  // distance entre atomes = moyenne des distances entre leurs points
  const dA = new Float64Array(nA * nA);
  for (let i = 0; i < nA; i++) for (let j = i + 1; j < nA; j++) {
    let s = 0;
    for (const u of ptsDe[i]) for (const v of ptsDe[j]) s += D[u * nP + v];
    const d = s / (ptsDe[i].length * ptsDe[j].length);
    dA[i * nA + j] = d; dA[j * nA + i] = d;
  }
  const dMin = new Float64Array(nA * nA);
  for (let i = 0; i < nA; i++) for (let j = i + 1; j < nA; j++) {
    let m = Infinity;
    for (const u of ptsDe[i]) for (const v of ptsDe[j]) if (D[u * nP + v] < m) m = D[u * nP + v];
    dMin[i * nA + j] = m; dMin[j * nA + i] = m;
  }
  const dTabA = atomes.map((_, i) => ptsDe[i].reduce((s, u) => s + dTab[u], 0) / ptsDe[i].length);

  // coût d'un circuit : arbre couvrant minimal de ses points (câble réel approché) + liaison au tableau
  const coutCache = new Map<string, { cout: number; lien: number }>();
  const analyse = (ids: number[]): { cout: number; lien: number } => {
    if (ids.length === 0) return { cout: 0, lien: 0 };
    const cle = [...ids].sort((a, b) => a - b).join(",");
    const c = coutCache.get(cle);
    if (c != null) return c;
    const idx: number[] = [];
    ids.forEach(a => idx.push(...ptsDe[a]));
    const m = idx.length;
    const dist = new Array<number>(m).fill(Infinity), dans = new Array<boolean>(m).fill(false);
    dist[0] = 0;
    let mst = 0, lien = 0;
    for (let k = 0; k < m; k++) {
      let u = -1;
      for (let i = 0; i < m; i++) if (!dans[i] && (u < 0 || dist[i] < dist[u])) u = i;
      dans[u] = true; mst += dist[u]; if (dist[u] > lien) lien = dist[u];
      for (let i = 0; i < m; i++) if (!dans[i]) { const d = D[idx[u] * nP + idx[i]]; if (d < dist[i]) dist[i] = d; }
    }
    const res = { cout: mst + (p.tableau ? Math.min(...idx.map(i => dTab[i])) : 0), lien };
    coutCache.set(cle, res);
    return res;
  };
  const cout = (ids: number[]): number => analyse(ids).cout;
  const connexe = (ids: number[]): boolean => analyse(ids).lien <= LIEN_MAX_M + 1e-9;

  const pieceDeAtome = atomes.map(a => a.points.map(q => q.pieceId));
  const scission = (clusterDe: number[]): number => {
    const par = new Map<number, Set<number>>();
    pieceDeAtome.forEach((ps, a) => ps.forEach(pid => { (par.get(pid) ?? par.set(pid, new Set()).get(pid)!).add(clusterDe[a]); }));
    let s = 0;
    par.forEach(set => { s += set.size - 1; });
    return s * p.penaliteScission;
  };
  const clusterDeDepuis = (cl: number[][]): number[] => { const r = new Array<number>(nA).fill(-1); cl.forEach((c, k) => c.forEach(a => { r[a] = k; })); return r; };
  const objectif = (cl: number[][]): number => cl.reduce((s, c) => s + cout(c), 0) + scission(clusterDeDepuis(cl));
  const poidsDe = (c: number[]): number => c.reduce((s, a) => s + poids[a], 0);

  // ── recherche locale ──
  const ameliorer = (init: number[][]): number[][] => {
    let C = init.map(c => [...c]).filter(c => c.length > 0);
    let W = C.map(poidsDe);
    let K = C.map(cout);
    let cd = clusterDeDepuis(C);
    let sc = scission(cd);
    for (let passe = 0; passe < 40; passe++) {
      let mieux = false;
      // déplacements
      for (let a = 0; a < nA; a++) {
        const u = cd[a];
        let meilleur = { v: -1, gain: 1e-9, cu: 0, cv: 0, sc: 0 };
        const reste = C[u].filter(x => x !== a);
        if (!connexe(reste)) continue;                         // retirer cet appareillage couperait le circuit en deux morceaux
        const cu = cout(reste);
        for (let v = 0; v < C.length; v++) {
          if (v === u || W[v] + poids[a] > cap + 1e-9) continue;
          const nv = [...C[v], a];
          if (!connexe(nv)) continue;                          // trop loin du circuit visé
          const cv = cout(nv);
          // borne : le terme « pièces coupées » ne peut pas rattraper une perte de câblage plus grande que ce plafond
          if ((K[u] + K[v]) - (cu + cv) + p.penaliteScission * pieceDeAtome[a].length <= meilleur.gain) continue;
          cd[a] = v; const sc2 = scission(cd); cd[a] = u;
          const gain = (K[u] + K[v] + sc) - (cu + cv + sc2);
          if (gain > meilleur.gain) meilleur = { v, gain, cu, cv, sc: sc2 };
        }
        if (meilleur.v >= 0) {
          const v = meilleur.v;
          C[u] = C[u].filter(x => x !== a); C[v].push(a);
          W[u] -= poids[a]; W[v] += poids[a]; K[u] = meilleur.cu; K[v] = meilleur.cv; cd[a] = v; sc = meilleur.sc;
          mieux = true;
          if (C[u].length === 0) { C.splice(u, 1); W.splice(u, 1); K.splice(u, 1); cd = clusterDeDepuis(C); }
        }
      }
      // échanges
      for (let a = 0; a < nA; a++) for (let b = a + 1; b < nA; b++) {
        const u = cd[a], v = cd[b];
        if (u === v) continue;
        if (W[u] - poids[a] + poids[b] > cap + 1e-9 || W[v] - poids[b] + poids[a] > cap + 1e-9) continue;
        const nu = [...C[u].filter(x => x !== a), b], nv = [...C[v].filter(x => x !== b), a];
        if (!connexe(nu) || !connexe(nv)) continue;
        const cu = cout(nu), cv = cout(nv);
        if ((K[u] + K[v]) - (cu + cv) + p.penaliteScission * (pieceDeAtome[a].length + pieceDeAtome[b].length) <= 1e-9) continue;
        cd[a] = v; cd[b] = u; const sc2 = scission(cd);
        const gain = (K[u] + K[v] + sc) - (cu + cv + sc2);
        if (gain > 1e-9) {
          C[u] = nu; C[v] = nv; W[u] += poids[b] - poids[a]; W[v] += poids[a] - poids[b]; K[u] = cu; K[v] = cv; sc = sc2; mieux = true;
        } else { cd[a] = u; cd[b] = v; }
      }
      if (!mieux) break;
    }
    return C;
  };

  // dissolution : vide le plus petit circuit dans les autres si la capacité le permet
  const dissoudre = (C: number[][]): number[][] | null => {
    if (C.length <= minC) return null;
    const ordre = C.map((_, i) => i).sort((i, j) => poidsDe(C[i]) - poidsDe(C[j]));
    for (const i of ordre) {
      const reste = C.filter((_, k) => k !== i).map(c => [...c]);
      const W = reste.map(poidsDe);
      let ok = true;
      for (const a of [...C[i]].sort((x, y) => poids[y] - poids[x])) {
        let bv = -1, bc = Infinity;
        for (let v = 0; v < reste.length; v++) {
          if (W[v] + poids[a] > cap + 1e-9 || !connexe([...reste[v], a])) continue;
          const dc = cout([...reste[v], a]) - cout(reste[v]);
          if (dc < bc) { bc = dc; bv = v; }
        }
        if (bv < 0) { ok = false; break; }
        reste[bv].push(a); W[bv] += poids[a];
      }
      if (ok) return reste;
    }
    return null;
  };

  const scinder = (C: number[][]): number[][] | null => {
    const i = C.map((c, k) => k).filter(k => C[k].length >= 2).sort((x, y) => poidsDe(C[y]) - poidsDe(C[x]))[0];
    if (i == null) return null;
    const c = C[i];
    // deux germes les plus éloignés, puis affectation au plus proche
    let ga = c[0], gb = c[1], dm = -1;
    for (const x of c) for (const y of c) if (x < y && dA[x * nA + y] > dm) { dm = dA[x * nA + y]; ga = x; gb = y; }
    const A = [ga], B = [gb];
    [...c].filter(x => x !== ga && x !== gb).sort((x, y) => Math.abs(dA[x * nA + ga] - dA[x * nA + gb]) - Math.abs(dA[y * nA + ga] - dA[y * nA + gb]))
      .reverse().forEach(x => { (dA[x * nA + ga] <= dA[x * nA + gb] ? A : B).push(x); });
    return C.map((k, j) => (j === i ? A : k)).concat([B]);
  };

  // ── constructions candidates ──
  // A. fusion hiérarchique (liaison moyenne) sous contrainte de capacité
  const candidatFusion = (): number[][] => {
    let cl: number[][] = atomes.map((_, i) => [i]);
    let w = cl.map(poidsDe);
    const L: number[][] = cl.map((_, i) => cl.map((__, j) => dA[i * nA + j]));
    const S: number[][] = cl.map((_, i) => cl.map((__, j) => dMin[i * nA + j]));   // lien le plus court entre deux circuits (liaison simple)
    let actifs = cl.map((_, i) => i);
    for (;;) {
      let bi = -1, bj = -1, bd = Infinity;
      for (let x = 0; x < actifs.length; x++) for (let y = x + 1; y < actifs.length; y++) {
        const i = actifs[x], j = actifs[y];
        if (w[i] + w[j] > cap + 1e-9 || S[i][j] > LIEN_MAX_M) continue;
        // à distance égale, on préfère remplir un circuit déjà bien rempli
        const d = L[i][j] - 0.01 * (w[i] + w[j]);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
      if (bi < 0) break;
      const ni = cl[bi].length, nj = cl[bj].length;
      actifs.forEach(k => { if (k !== bi && k !== bj) { const m = Math.min(S[bi][k], S[bj][k]); S[bi][k] = m; S[k][bi] = m; }});
      actifs.forEach(k => { if (k !== bi && k !== bj) { const v = (L[bi][k] * ni + L[bj][k] * nj) / (ni + nj); L[bi][k] = v; L[k][bi] = v; } });
      cl[bi] = [...cl[bi], ...cl[bj]]; w[bi] += w[bj];
      actifs = actifs.filter(k => k !== bj);
    }
    return actifs.map(k => cl[k]);
  };
  // B. chaîne de proche en proche depuis le point le plus éloigné du tableau, coupée à la capacité
  const candidatChaine = (): number[][] => {
    const reste = atomes.map((_, i) => i);
    let courant = reste.reduce((best, i) => (dTabA[i] > dTabA[best] || (dTabA[i] === dTabA[best] && i < best) ? i : best), reste[0]);
    const ordre: number[] = [];
    for (;;) {
      ordre.push(courant); reste.splice(reste.indexOf(courant), 1);
      if (reste.length === 0) break;
      courant = reste.reduce((best, i) => (dA[courant * nA + i] < dA[courant * nA + best] ? i : best), reste[0]);
    }
    const cl: number[][] = [];
    let cur: number[] = [], wc = 0;
    ordre.forEach(a => { if (cur.length > 0 && (wc + poids[a] > cap + 1e-9 || dMin[cur[cur.length - 1] * nA + a] > LIEN_MAX_M)) { cl.push(cur); cur = []; wc = 0; } cur.push(a); wc += poids[a]; });
    if (cur.length > 0) cl.push(cur);
    return cl;
  };
  // C. k germes éloignés (k = minimum théorique), affectation par regret sous capacité, puis recentrage
  const candidatGermes = (k: number): number[][] | null => {
    if (k > nA) return null;
    const seeds: number[] = [];
    seeds.push(atomes.map((_, i) => i).reduce((b, i) => (dTabA[i] > dTabA[b] ? i : b), 0));
    while (seeds.length < k) {
      let bi = -1, bd = -1;
      for (let i = 0; i < nA; i++) {
        if (seeds.includes(i)) continue;
        const d = Math.min(...seeds.map(s => dA[i * nA + s]));
        if (d > bd) { bd = d; bi = i; }
      }
      seeds.push(bi);
    }
    let res: number[][] | null = null;
    for (let tour = 0; tour < 6; tour++) {
      const cl: number[][] = seeds.map(() => []);
      const w = seeds.map(() => 0);
      const reste = new Set(atomes.map((_, i) => i));
      while (reste.size > 0) {
        let ba = -1, bregret = -Infinity, bv = -1;
        reste.forEach(a => {
          const cand = seeds.map((s, v) => ({ v, d: dA[a * nA + s] }))
            .filter(x => w[x.v] + poids[a] <= cap + 1e-9 && (cl[x.v].length === 0 || cl[x.v].some(m => dMin[a * nA + m] <= LIEN_MAX_M))).sort((x, y) => x.d - y.d);
          if (cand.length === 0) { ba = a; bregret = Infinity; bv = -1; return; }
          const regret = cand.length > 1 ? cand[1].d - cand[0].d : 1e6;
          if (bregret !== Infinity && regret > bregret) { bregret = regret; ba = a; bv = cand[0].v; }
        });
        if (bv < 0) return null;
        cl[bv].push(ba); w[bv] += poids[ba]; reste.delete(ba);
      }
      res = cl.filter(c => c.length > 0);
      // recentrage : le germe devient le médoïde de son circuit
      const nouveaux = cl.map((c, v) => {
        if (c.length === 0) return seeds[v];
        return c.reduce((b, x) => (c.reduce((s, y) => s + dA[x * nA + y], 0) < c.reduce((s, y) => s + dA[b * nA + y], 0) ? x : b), c[0]);
      });
      if (nouveaux.every((s, i) => s === seeds[i])) break;
      nouveaux.forEach((s, i) => { seeds[i] = s; });
    }
    return res;
  };

  const lb = Math.max(Math.ceil(total / cap - 1e-9), minC);
  const bruts: (number[][] | null)[] = [candidatFusion(), candidatChaine(), candidatGermes(lb)];
  let meilleur: { cl: number[][]; n: number; obj: number } | null = null;
  for (const brut of bruts) {
    if (!brut) continue;
    let cl = ameliorer(brut);
    for (let g = 0; g < 50; g++) { const d = dissoudre(cl); if (!d) break; cl = ameliorer(d); }
    for (let g = 0; g < 20 && cl.length < minC; g++) { const s = scinder(cl); if (!s) break; cl = ameliorer(s); }
    const cand = { cl, n: cl.length, obj: objectif(cl) };
    if (!meilleur || cand.n < meilleur.n || (cand.n === meilleur.n && cand.obj < meilleur.obj - 1e-9)) meilleur = cand;
  }
  let res = meilleur!.cl;
  if (p.equilibrer) res = equilibrerCircuits(res);
  return res;

  // Équilibrage : on déplace un point d'un circuit plus chargé vers un circuit moins chargé tant que cela réduit l'écart (somme des carrés des
  // charges), que le circuit reste d'un seul tenant (maillon ≤ LIEN_MAX_M) et qu'aucune pièce n'est coupée en plus. Le nombre de circuits
  // ne change pas. On prend à chaque fois le point le plus proche du circuit receveur (câble le plus court).
  function equilibrerCircuits(cl0: number[][]): number[][] {
    let C = cl0.map(c => [...c]);
    for (let passe = 0; passe < 300; passe++) {
      const W = C.map(poidsDe);
      const scAvant = scission(clusterDeDepuis(C));
      let meilleurGain: { a: number; de: number; vers: number; d: number } | null = null;
      for (let j = 0; j < C.length; j++) for (let i = 0; i < C.length; i++) {
        if (i === j) continue;
        for (const a of C[j]) {
          if (W[j] - W[i] < 2 * poids[a] - 1e-9 || W[i] + poids[a] > cap + 1e-9) continue;
          const dist = Math.min(...C[i].map(m => dMin[a * nA + m]));
          if (dist > LIEN_MAX_M || !connexe([...C[i], a])) continue;
          const reste = C[j].filter(x => x !== a);
          if (reste.length === 0 || !connexe(reste)) continue;
          const nouveau = C.map((c, k) => (k === i ? [...c, a] : k === j ? reste : c));
          if (scission(clusterDeDepuis(nouveau)) > scAvant + 1e-9) continue;
          if (!meilleurGain || dist < meilleurGain.d) meilleurGain = { a, de: j, vers: i, d: dist };
        }
      }
      if (!meilleurGain) break;
      const { a, de, vers } = meilleurGain;
      C = C.map((c, k) => (k === vers ? [...c, a] : k === de ? c.filter(x => x !== a) : c));
    }
    return C;
  }
}
