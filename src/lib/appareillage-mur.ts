// src/lib/appareillage-mur.ts
//
// Géométrie "appareillage ↔ mur" partagée entre le plan 2D (aimantation, rendu à plat
// contre le mur) et la vue 3D (projection sur la face intérieure du mur). Aucun état,
// aucune dépendance React/three : uniquement des fonctions pures sur des Point en mètres.

import { AppareillageType, AppareillagePlace, Piece, Point, pointDansPolygone, ouverturesEffectivesMur, ENTRAXE_POSTE_M, hauteurOuvertureDefautCm, estLumierePlafond } from "@/lib/maison-types";

export interface AncrageMur {
  segIndex: number;   // index du mur dans piece.contour (segment i → i+1)
  pied: Point;        // projection du point sur la ligne du mur
  distance: number;   // mètres, point → mur
  normale: Point;     // vecteur unitaire du mur vers l'INTÉRIEUR de la pièce
}

// Les luminaires de plafond (point lumineux, spots, spots étanches) ne sont jamais posés sur un mur ;
// tout le reste (prises, commandes, appliques, appareils dédiés) l'est.
export function estMural(type: AppareillageType): boolean {
  return !estLumierePlafond(type);
}

function projeterSurSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// Mur le plus proche d'un point dans un contour, avec sa normale orientée vers l'intérieur
// (testée par pointDansPolygone, donc fiable aussi pour une pièce concave en L).
export function ancrageMurLePlusProche(pt: Point, contour: Point[]): AncrageMur | null {
  if (contour.length < 3) return null;
  let meilleur: AncrageMur | null = null;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length];
    const pied = projeterSurSegment(pt, a, b);
    const d = Math.hypot(pt.x - pied.x, pt.y - pied.y);
    if (meilleur && d >= meilleur.distance) continue;
    const sx = b.x - a.x, sy = b.y - a.y;
    const len = Math.hypot(sx, sy);
    if (len < 1e-6) continue;
    let nx = -sy / len, ny = sx / len;
    const test = { x: pied.x + nx * 0.05, y: pied.y + ny * 0.05 };
    if (!pointDansPolygone(test, contour)) { nx = -nx; ny = -ny; }
    meilleur = { segIndex: i, pied, distance: d, normale: { x: nx, y: ny } };
  }
  return meilleur;
}

// Aimantation : si le point est à moins de seuilM d'un mur, retourne son pied sur ce
// mur ; sinon retourne le point inchangé. Les types non muraux ne sont jamais aimantés.
export function aimanterSurMur(pt: Point, contour: Point[], type: AppareillageType, seuilM: number): Point {
  if (!estMural(type)) return pt;
  const anc = ancrageMurLePlusProche(pt, contour);
  if (!anc || anc.distance > seuilM) return pt;
  return anc.pied;
}

// Un appareillage est "posé contre le mur" (rendu à plat, symbole tourné) quand sa
// position est à moins de TOLERANCE_MUR_M de la ligne du mur.
export const TOLERANCE_MUR_M = 0.1;

// ─── VOLET ROULANT : DIMENSIONS LUES SUR LA FENÊTRE ─────────────────────────────
// Un volet roulant n'a pas de dimensions propres : il prend celles de l'ouverture du mur
// où il est posé. baieDuVolet cherche, sur le mur le plus proche du point, l'ouverture
// (fenêtre, porte-fenêtre…) dont l'emprise le long du mur est la plus proche — à moins de
// TOL_BAIE_M — et en renvoie largeur / hauteur / allège / centre. Sans ouverture à
// proximité, retombe sur une fenêtre standard (BAIE_DEFAUT) centrée sur le point.
export const BAIE_DEFAUT = { largeur: 1.0, hauteur: 1.2, allege: 0.9 }; // mètres
const TOL_BAIE_M = 0.4;

export interface BaieVolet {
  largeur: number; hauteur: number; allege: number; // mètres (hauteur = au-dessus de l'allège)
  centre: Point;            // centre de la baie, SUR la ligne du mur
  detectee: boolean;        // false = dimensions par défaut (aucune ouverture trouvée)
  ancrage: AncrageMur | null;
  ouvertureType?: string;
}

export function baieDuVolet(pt: Point, piece: Piece, pieces: Piece[]): BaieVolet {
  const anc = ancrageMurLePlusProche(pt, piece.contour);
  const defaut: BaieVolet = { ...BAIE_DEFAUT, centre: anc ? anc.pied : pt, detectee: false, ancrage: anc };
  if (!anc || anc.distance > 0.6) return defaut;
  const n = piece.contour.length;
  const a = piece.contour[anc.segIndex], b = piece.contour[(anc.segIndex + 1) % n];
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 0.01) return defaut;
  const s = Math.hypot(anc.pied.x - a.x, anc.pied.y - a.y); // abscisse du point le long du mur (m)
  let meilleure: ReturnType<typeof ouverturesEffectivesMur>[number] | null = null;
  let meilleureD = Infinity;
  for (const o of ouverturesEffectivesMur(pieces, piece, anc.segIndex)) {
    const d = Math.max(0, Math.abs(s - o.position * L) - o.largeur / 200); // écart à l'emprise de l'ouverture
    if (d < meilleureD) { meilleureD = d; meilleure = o; }
  }
  if (!meilleure || meilleureD > TOL_BAIE_M) return defaut;
  return {
    largeur: meilleure.largeur / 100,
    hauteur: (meilleure.hauteur ?? hauteurOuvertureDefautCm(meilleure.type)) / 100, // mêmes défauts que le mur 3D
    allege: (meilleure.allege ?? 0) / 100,
    centre: { x: a.x + (b.x - a.x) * meilleure.position, y: a.y + (b.y - a.y) * meilleure.position },
    detectee: true, ancrage: anc, ouvertureType: meilleure.type,
  };
}

// Pose d'un volet : si une fenêtre est à portée, le volet se centre dessus (sur la ligne du mur).
export function recentrerVolet(pt: Point, piece: Piece, pieces: Piece[]): Point {
  const baie = baieDuVolet(pt, piece, pieces);
  return baie.detectee ? baie.centre : pt;
}

// ─── COTES D'IMPLANTATION ──────────────────────────────────────────────────────
// Une cote = une distance entre deux points du plan, en cm, affichée sur le plan 2D et à
// l'impression. Deux familles :
//  - "mur"  : appareillage posé contre un mur → distance LE LONG du mur, du coin au pied de
//             l'appareillage (cote d'implantation classique) ;
//  - "perp" : appareillage libre (ex. plafonnier) → distance perpendiculaire aux deux murs
//             (non parallèles) les plus proches.
export interface Cote {
  kind: "mur" | "perp";
  a: Point; b: Point;      // mur : coin → pied sur le mur · perp : appareillage → pied sur le mur
  valeurCm: number;
  normale?: Point;         // kind "mur" : normale intérieure (sert à décaler la cote hors de la pièce)
  decalageM?: number;      // kind "mur" : épaisseur de mur à franchir avant de poser la ligne de cote (m)
  interieur?: boolean;     // true : la ligne de cote se pose À L'INTÉRIEUR de la pièce (cote de pièce)
  rang?: number;           // « couloir » de la ligne de cote : 0 = le plus proche du mur, 1, 2… = plus loin (cotes en chaîne)
}
// Repère « faces finies » : les cotes se lisent d'un angle intérieur à l'autre (ce que l'on mesure
// avec un mètre sur place), pas d'axe à axe. utile = contour de la face intérieure finie.
export interface RepereCotes { utile: Point[]; utileFin?: Point[]; epaisseurTotaleM: (segIndex: number) => number; }

// detail = true : les deux cotes le long du mur (coin gauche et coin droit) — utile pour
// caler un appareillage sélectionné ; false : une seule cote, vers le coin le plus proche.
export function cotesAppareillage(pt: Point, contour: Point[], type: AppareillageType, detail: boolean, repere?: RepereCotes): Cote[] {
  const out: Cote[] = [];
  const n = contour.length;
  if (n < 3) return out;
  const anc = estMural(type) ? ancrageMurLePlusProche(pt, contour) : null;
  if (anc && anc.distance <= TOLERANCE_MUR_M) {
    // Avec un repère : coins et pied pris sur la face intérieure finie du mur ; sinon, sur l'axe.
    const A = repere ? repere.utile[anc.segIndex] : contour[anc.segIndex];
    const B = repere ? (repere.utileFin?.[anc.segIndex] ?? repere.utile[(anc.segIndex + 1) % n]) : contour[(anc.segIndex + 1) % n];
    const pied = repere ? projeterSurSegment(pt, A, B) : anc.pied;
    const dA = Math.hypot(pied.x - A.x, pied.y - A.y), dB = Math.hypot(pied.x - B.x, pied.y - B.y);
    const decalageM = repere ? repere.epaisseurTotaleM(anc.segIndex) : 0;
    const mk = (coin: Point, d: number): Cote => ({ kind: "mur", a: coin, b: pied, valeurCm: Math.round(d * 100), normale: anc.normale, decalageM });
    if (detail) { out.push(mk(A, dA), mk(B, dB)); } else { out.push(dA <= dB ? mk(A, dA) : mk(B, dB)); }
    return out;
  }
  const base = repere ? repere.utile : contour;
  const murs = base.map((a, i) => {
    const b = repere?.utileFin?.[i] ?? base[(i + 1) % n];
    const pied = projeterSurSegment(pt, a, b);
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { pied, d: Math.hypot(pt.x - pied.x, pt.y - pied.y), ux: (b.x - a.x) / l, uy: (b.y - a.y) / l };
  }).sort((p, q) => p.d - q.d);
  const premier = murs[0];
  const second = murs.find(m => m !== premier && Math.abs(m.ux * premier.ux + m.uy * premier.uy) < 0.7);
  [premier, second].forEach(m => {
    if (m && m.d > 0.02) out.push({ kind: "perp", a: pt, b: m.pied, valeurCm: Math.round(m.d * 100) });
  });
  return out;
}

// Garde les cotes lisibles : écarte celles trop courtes à l'écran et celles dont le texte
// chevaucherait une cote déjà retenue. Les `prioritaires` (cotes de l'appareillage
// sélectionné) sont toujours gardées, en tête de liste.
export function filtrerCotesLisibles(
  cotes: Cote[], toS: (p: Point) => Point, prioritaires: Cote[] = [], longueurMinPx = 14, espacementPx = 26,
): Cote[] {
  const milieu = (c: Cote) => { const A = toS(c.a), B = toS(c.b); return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }; };
  const centres = prioritaires.map(milieu);
  const gardees: Cote[] = [];
  for (const c of cotes) {
    const A = toS(c.a), B = toS(c.b);
    if (Math.hypot(B.x - A.x, B.y - A.y) < longueurMinPx) continue;
    const mid = milieu(c);
    if (centres.some(p => Math.hypot(p.x - mid.x, p.y - mid.y) < espacementPx)) continue;
    gardees.push(c); centres.push(mid);
  }
  return [...prioritaires, ...gardees];
}

// Géométrie d'affichage d'une cote (repère écran) — partagée par le rendu React du plan et
// la chaîne SVG de l'impression. decalagePx : écart de la ligne de cote au mur, vers l'EXTÉRIEUR
// de la pièce (kind "mur" uniquement).
export interface GeoCote {
  kind: "mur" | "perp";
  A: Point; B: Point;     // extrémités réelles (écran)
  a2: Point; b2: Point;   // extrémités de la ligne de cote (décalée pour "mur", = A/B pour "perp")
  mid: Point; angle: number; txt: string;
}
export function geometrieCote(c: Cote, toS: (p: Point) => Point, decalagePx: number): GeoCote | null {
  const A = toS(c.a), B = toS(c.b);
  if (Math.hypot(B.x - A.x, B.y - A.y) < 3) return null;
  let ox = 0, oy = 0;
  if (c.kind === "mur" && c.normale) {
    const pb = toS(c.b), pn = toS({ x: c.b.x + c.normale.x * 0.1, y: c.b.y + c.normale.y * 0.1 });
    const l = Math.hypot(pn.x - pb.x, pn.y - pb.y) || 1;
    const o0 = toS({ x: 0, y: 0 }), o1 = toS({ x: 1, y: 0 });
    const pxParM = Math.hypot(o1.x - o0.x, o1.y - o0.y);
    // Cote de mur : hors de la pièce, au-delà de l'épaisseur du mur ; cote de pièce (interieur) : dedans.
    const dist = (c.interieur ? decalagePx : decalagePx + (c.decalageM ?? 0) * pxParM) * (1 + (c.rang ?? 0));
    const sens = c.interieur ? 1 : -1;
    ox = sens * (pn.x - pb.x) / l * dist; oy = sens * (pn.y - pb.y) / l * dist;
  }
  const a2 = { x: A.x + ox, y: A.y + oy }, b2 = { x: B.x + ox, y: B.y + oy };
  let angle = Math.atan2(b2.y - a2.y, b2.x - a2.x) * 180 / Math.PI;
  if (angle > 90 || angle < -90) angle += 180; // texte toujours lisible (jamais à l'envers)
  return { kind: c.kind, A, B, a2, b2, mid: { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 }, angle, txt: String(c.valeurCm) };
}

// ─── APPAREILLAGES MULTIPLES (plaques double / triple / quadruple) ─────────────────────────
// Un poste de plaque est un AppareillagePlace ordinaire portant groupeId + rangPlaque (voir
// maison-types.ts). Ces fonctions pures posent / entretiennent la disposition des postes.

// Vecteur unitaire « vers la DROITE » d'une personne qui regarde le mur (de la pièce) :
// rotation de +90° de la direction du regard (-normale) dans un repère écran (y vers le bas).
export function droiteFaceAuMur(normale: Point): Point {
  return { x: normale.y, y: -normale.x };
}

// Positions (sur l'axe du mur) des n postes d'une plaque centrée sur `centre` : alignés le long
// du mur le plus proche, entraxe ENTRAXE_POSTE_M, rang 0 à gauche (vu de la pièce).
export function disposerPlaque(centre: Point, contour: Point[], n: number): Point[] {
  const anc = ancrageMurLePlusProche(centre, contour);
  // Posée contre le mur (à TOLERANCE_MUR_M près) → collée dessus ; au-delà (placement libre, Alt) → là où elle est,
  // mais toujours alignée parallèlement au mur le plus proche.
  const base = anc && anc.distance <= TOLERANCE_MUR_M ? anc.pied : centre;
  const droite = anc ? droiteFaceAuMur(anc.normale) : { x: 1, y: 0 };
  return Array.from({ length: n }, (_, k) => {
    const d = (k - (n - 1) / 2) * ENTRAXE_POSTE_M;
    return { x: base.x + droite.x * d, y: base.y + droite.y * d };
  });
}

export interface InfoPlaque { n: number; gx: number; gy: number; }

// Postes regroupés par groupeId, triés par rang : { n, centre } pour le dessin 2D / l'impression.
export function infosPlaques(appareillages: AppareillagePlace[]): Map<number, InfoPlaque> {
  const parGroupe = new Map<number, AppareillagePlace[]>();
  appareillages.forEach(a => {
    if (a.groupeId == null) return;
    const l = parGroupe.get(a.groupeId) ?? [];
    l.push(a); parGroupe.set(a.groupeId, l);
  });
  const out = new Map<number, InfoPlaque>();
  parGroupe.forEach((l, id) => {
    if (l.length < 2) return;
    out.set(id, {
      n: l.length,
      gx: l.reduce((s, a) => s + a.x, 0) / l.length,
      gy: l.reduce((s, a) => s + a.y, 0) / l.length,
    });
  });
  return out;
}

// Remet d'aplomb les plaques d'une pièce après une suppression / un déplacement de poste :
//  - un groupe réduit à un seul poste redevient un appareillage simple (groupeId retiré) ;
//  - les rangs sont renumérotés 0..n-1 (ordre conservé) ;
//  - les postes sont re-disposés autour du centre du groupe (le long du mur le plus proche).
// Un seul groupe de la pièce peut être ciblé via `seulementGroupeId`.
export function normaliserPlaques(piece: Piece, seulementGroupeId?: number): Piece {
  const groupes = new Map<number, AppareillagePlace[]>();
  piece.appareillages.forEach(a => {
    if (a.groupeId == null) return;
    if (seulementGroupeId != null && a.groupeId !== seulementGroupeId) return;
    const l = groupes.get(a.groupeId) ?? [];
    l.push(a); groupes.set(a.groupeId, l);
  });
  if (groupes.size === 0) return piece;
  const maj = new Map<number, AppareillagePlace>();
  groupes.forEach(membres => {
    if (membres.length < 2) {
      membres.forEach(a => { const { groupeId, rangPlaque, ...reste } = a; void groupeId; void rangPlaque; maj.set(a.id, reste); });
      return;
    }
    const tries = [...membres].sort((a, b) => (a.rangPlaque ?? 0) - (b.rangPlaque ?? 0));
    const centre = { x: tries.reduce((s, a) => s + a.x, 0) / tries.length, y: tries.reduce((s, a) => s + a.y, 0) / tries.length };
    const pts = disposerPlaque(centre, piece.contour, tries.length);
    tries.forEach((a, k) => maj.set(a.id, { ...a, x: pts[k].x, y: pts[k].y, rangPlaque: k }));
  });
  return { ...piece, appareillages: piece.appareillages.map(a => maj.get(a.id) ?? a) };
}

// ─── POSE EN FAÇADE (appareillage à l'EXTÉRIEUR d'une pièce) ────────────────────────────────────────────────
// Un appareillage extérieur est rattaché à la pièce dont le mur est le plus proche, mais posé HORS de son tracé :
// à DECALAGE_FACADE_M devant la face extérieure du mur (le tracé hors-tout). Le décalage sert à le distinguer
// d'un appareillage intérieur (sans lui, les deux seraient sur la même ligne).
export const DECALAGE_FACADE_M = 0.01;

// true = l'appareillage en `pt` est posé sur la façade extérieure du mur `anc` (il est hors du tracé de sa pièce).
export function estEnFacade(pt: Point, contour: Point[], anc: AncrageMur): boolean {
  return anc.distance > DECALAGE_FACADE_M * 0.7 && !pointDansPolygone(pt, contour);
}

// Aimantation d'un appareillage HORS de sa pièce : colle sur la façade du mur le plus proche si l'écart est < seuilM,
// sinon laisse le point libre. Les luminaires de plafond restent là où on les pose.
export function aimanterEnFacade(pt: Point, contour: Point[], type: AppareillageType, seuilM: number): Point {
  if (!estMural(type)) return pt;
  const anc = ancrageMurLePlusProche(pt, contour);
  if (!anc || anc.distance > seuilM) return pt;
  return { x: anc.pied.x - anc.normale.x * DECALAGE_FACADE_M, y: anc.pied.y - anc.normale.y * DECALAGE_FACADE_M };
}

// Pièce dont le tracé est le plus proche de `pt` (pour rattacher un appareillage posé hors de toute pièce).
export function pieceLaPlusProche(pt: Point, pieces: Piece[]): Piece | null {
  let best: Piece | null = null, bd = Infinity;
  for (const p of pieces) {
    if (p.contour.length < 3) continue;
    const a = ancrageMurLePlusProche(pt, p.contour);
    if (a && a.distance < bd) { bd = a.distance; best = p; }
  }
  return best;
}
