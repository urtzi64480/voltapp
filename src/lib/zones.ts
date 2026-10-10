// src/lib/zones.ts
//
// ZONES : polygone nommé posé sur le plan (dressing ouvert, coin bureau, retour de mur…), avec sa surface.
// Ce n'est pas une pièce : aucun appareillage, aucun circuit, aucun pré-devis. Chaque côté est une cloison
// (dessinée en épaisseur, percée de portes éventuelles) ou « ouvert » (limite virtuelle / mur déjà existant).
// Une zone NON fermée est une cloison libre : polyligne qui s'arrête dans la pièce, sans surface.
// Toutes les fonctions sont pures (rien n'est écrit sur le plan ici). Mètres pour les points, cm pour les épaisseurs.

import {
  Zone, TypeCoteZone, Point, Piece, Ouverture, OuvertureEffective, EPAISSEUR_CLOISON_ZONE_CM,
  aireDuPolygone, pointDansPolygone, distance, distanceAuSegment, positionSurSegment, uidMaison,
} from "@/lib/maison-types";
import { decalerContour, aimanterSurFaceMur, contourUtile, faceInterieureM } from "@/lib/murs";
import { AncrageMur, ancrageMurLePlusProche, aimanterEnFacade, pieceLaPlusProche, estEnFacade, estMural, TOLERANCE_MUR_M } from "@/lib/appareillage-mur";
import { AppareillageType } from "@/lib/maison-types";

// ─── Côtés ───────────────────────────────────────────────────────────────────────────────────
export function nbCotes(contour: Point[], ferme: boolean): number {
  return ferme ? contour.length : Math.max(0, contour.length - 1);
}
export function segmentsZone(z: Pick<Zone, "contour" | "ferme">): { i: number; a: Point; b: Point }[] {
  const n = z.contour.length;
  return Array.from({ length: nbCotes(z.contour, z.ferme) }, (_, i) => ({ i, a: z.contour[i], b: z.contour[(i + 1) % n] }));
}
export function longueurCote(z: Pick<Zone, "contour" | "ferme">, i: number): number {
  const n = z.contour.length;
  return distance(z.contour[i], z.contour[(i + 1) % n]);
}

// Un côté posé sur un mur déjà existant (les deux extrémités sur un même côté d'une pièce) est « ouvert » par
// défaut : le mur est déjà là. Tout autre côté est une cloison à monter. Cloison libre : tout en cloison.
export function cotesParDefaut(contour: Point[], ferme: boolean, pieces: Piece[]): TypeCoteZone[] {
  const n = contour.length;
  return Array.from({ length: nbCotes(contour, ferme) }, (_, i): TypeCoteZone => {
    if (!ferme) return "cloison";
    const a = contour[i], b = contour[(i + 1) % n];
    const surMur = pieces.some(p => p.contour.some((c, k) => {
      const d = p.contour[(k + 1) % p.contour.length];
      return distanceAuSegment(a, c, d) < 0.06 && distanceAuSegment(b, c, d) < 0.06;
    }));
    return surMur ? "ouvert" : "cloison";
  });
}

export function nouvelleZone(nom: string, contour: Point[], ferme: boolean, cotes: TypeCoteZone[], epaisseurCm = EPAISSEUR_CLOISON_ZONE_CM): Zone {
  return { id: uidMaison(), nom, contour, ferme, cotes, epaisseurCm };
}

// ─── Validation du tracé ──────────────────────────────────────────────────────────────────────
function orient(a: Point, b: Point, c: Point): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(v) < 1e-9 ? 0 : v > 0 ? 1 : -1;
}
// Croisement STRICT de deux segments (se toucher en une extrémité commune ne compte pas).
function secroisent(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

// null si le tracé est valide, sinon le message d'erreur à afficher.
export function validerTraceZone(contour: Point[], ferme: boolean): string | null {
  const n = contour.length;
  if (ferme ? n < 3 : n < 2) return ferme ? "Un polygone demande au moins 3 points." : "Une cloison libre demande au moins 2 points.";
  const segs = segmentsZone({ contour, ferme });
  for (const s of segs) if (distance(s.a, s.b) < 0.1) return "Un côté est trop court (10 cm minimum).";
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const voisins = j === i + 1 || (ferme && i === 0 && j === segs.length - 1);
      if (voisins) continue;
      if (secroisent(segs[i].a, segs[i].b, segs[j].a, segs[j].b)) return "Le tracé se croise lui-même.";
    }
  }
  if (ferme && aireDuPolygone(contour) < 0.05) return "Le polygone est trop petit (ou plat).";
  return null;
}

// ─── Surface ──────────────────────────────────────────────────────────────────────────────────
function aireSignee(c: Point[]): number {
  let a = 0;
  for (let i = 0; i < c.length; i++) { const p = c[i], q = c[(i + 1) % c.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}
// brute = aire du tracé (à l'axe des cloisons) · utile = aire à l'intérieur des cloisons (face finie).
// null pour une cloison libre. utile retombe sur brute si l'épaisseur ne tient pas dans la zone.
export function surfaceZone(z: Zone): { brute: number; utile: number } | null {
  if (!z.ferme || z.contour.length < 3) return null;
  const brute = aireDuPolygone(z.contour);
  const offsets = z.contour.map((_, i) => (z.cotes[i] === "cloison" ? z.epaisseurCm / 200 : 0));
  if (offsets.every(o => o === 0)) return { brute, utile: brute };
  const u = decalerContour(z.contour, offsets);
  const aU = aireSignee(u), aB = aireSignee(z.contour);
  const bon = Math.sign(aU) === Math.sign(aB) && Math.abs(aU) > 1e-6 && Math.abs(aU) <= brute + 1e-9;
  return { brute, utile: bon ? Math.abs(aU) : brute };
}

// ─── Position de l'étiquette ─────────────────────────────────────────────────────────────────
// Polygone : centre de gravité s'il est dedans, sinon milieu de la plus large corde horizontale à sa hauteur
// (L, U… concaves). Cloison libre : milieu du plus long côté.
export function centreEtiquetteZone(z: Pick<Zone, "contour" | "ferme">): Point {
  const c = z.contour;
  if (!z.ferme || c.length < 3) {
    const segs = segmentsZone(z).sort((s1, s2) => distance(s2.a, s2.b) - distance(s1.a, s1.b));
    const s = segs[0];
    return s ? { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 } : (c[0] ?? { x: 0, y: 0 });
  }
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < c.length; i++) {
    const p = c[i], q = c[(i + 1) % c.length], f = p.x * q.y - q.x * p.y;
    a2 += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (Math.abs(a2) < 1e-9) return c[0];
  const g = { x: cx / (3 * a2), y: cy / (3 * a2) };
  if (pointDansPolygone(g, c)) return g;
  const xs: number[] = [];
  for (let i = 0; i < c.length; i++) {
    const p = c[i], q = c[(i + 1) % c.length];
    if ((p.y > g.y) !== (q.y > g.y)) xs.push(p.x + ((g.y - p.y) / (q.y - p.y)) * (q.x - p.x));
  }
  xs.sort((u, v) => u - v);
  let best = { w: -1, x: g.x };
  for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > best.w) best = { w: xs[k + 1] - xs[k], x: (xs[k] + xs[k + 1]) / 2 };
  return { x: best.x, y: g.y };
}

// ─── Cloisons en épaisseur ───────────────────────────────────────────────────────────────────
// Un côté « cloison » prolongé de la demi-épaisseur à une extrémité quand le côté voisin est aussi une
// cloison : l'angle extérieur est comblé (sans cela les rectangles centrés sur l'axe laissent un coin vide).
export interface CloisonZone { i: number; a: Point; b: Point; epaisseurM: number; extA: number; extB: number }
export function cloisonsDeZone(z: Zone): CloisonZone[] {
  if (z.escalierVisibleId != null) return [];     // zone « escalier visible » : simple emprise, jamais de cloison
  const n = z.contour.length, m = nbCotes(z.contour, z.ferme);
  const e = z.epaisseurCm / 100;
  const res: CloisonZone[] = [];
  for (let i = 0; i < m; i++) {
    if (z.cotes[i] !== "cloison") continue;
    const prec = z.ferme ? (i - 1 + m) % m : i - 1, suiv = z.ferme ? (i + 1) % m : i + 1;
    const voisinePrec = prec >= 0 && prec < m && z.cotes[prec] === "cloison";
    const voisineSuiv = suiv >= 0 && suiv < m && z.cotes[suiv] === "cloison";
    res.push({ i, a: z.contour[i], b: z.contour[(i + 1) % n], epaisseurM: e, extA: voisinePrec ? e / 2 : 0, extB: voisineSuiv ? e / 2 : 0 });
  }
  return res;
}
// Quadrilatère (mètres) de la cloison, extrémités prolongées comprises.
export function quadCloison(c: CloisonZone): Point[] {
  const L = distance(c.a, c.b) || 1;
  const ux = (c.b.x - c.a.x) / L, uy = (c.b.y - c.a.y) / L, nx = -uy, ny = ux, h = c.epaisseurM / 2;
  const a = { x: c.a.x - ux * c.extA, y: c.a.y - uy * c.extA }, b = { x: c.b.x + ux * c.extB, y: c.b.y + uy * c.extB };
  return [
    { x: a.x + nx * h, y: a.y + ny * h }, { x: b.x + nx * h, y: b.y + ny * h },
    { x: b.x - nx * h, y: b.y - ny * h }, { x: a.x - nx * h, y: a.y - ny * h },
  ];
}
// Découpe d'une ouverture dans l'épaisseur de la cloison (quadrilatère un peu plus épais que le mur).
export function decoupeOuvertureZone(c: CloisonZone, position: number, largeurCm: number): Point[] {
  const L = distance(c.a, c.b) || 1;
  const ux = (c.b.x - c.a.x) / L, uy = (c.b.y - c.a.y) / L, nx = -uy, ny = ux, h = c.epaisseurM / 2 + 0.004;
  const s0 = position * L - largeurCm / 200, s1 = position * L + largeurCm / 200;
  const P = (s: number, t: number): Point => ({ x: c.a.x + ux * s + nx * t, y: c.a.y + uy * s + ny * t });
  return [P(s0, -h), P(s1, -h), P(s1, h), P(s0, h)];
}

// ─── Ouvertures (portes dans une cloison de zone) ────────────────────────────────────────────
export function ouverturesEffectivesZone(z: Zone, i: number): OuvertureEffective[] {
  return (z.ouvertures ?? []).filter(o => o.segIndex === i)
    .map(o => ({ type: o.type, position: o.position, largeur: o.largeur, hauteur: o.hauteur, allege: o.allege, coulisseVers: o.coulisseVers, proprietaire: true, id: o.id, usage: o.usage, charniere: o.charniere, ouvreVersInterieur: o.ouvreVersInterieur, battants: o.battants, montage: o.montage, nbVantaux: o.nbVantaux }));
}

// Position (0..1) valide pour une ouverture de largeur donnée sur un côté de longueur L (m) : l'ouverture reste
// entièrement dans le côté. null si le côté est trop court.
export function positionOuvertureValide(t: number, largeurCm: number, L: number): number | null {
  const demi = largeurCm / 200;
  if (L < largeurCm / 100 + 0.02) return null;
  return Math.max(demi / L, Math.min(1 - demi / L, t));
}

// Cloison de zone la plus proche d'un point (pour poser une porte avec l'outil « Porte / fenêtre »).
export function trouverCloisonZone(zones: Zone[], p: Point, seuilM: number): { zone: Zone; segIndex: number; t: number; d: number } | null {
  let best: { zone: Zone; segIndex: number; t: number; d: number } | null = null;
  for (const z of zones) {
    const n = z.contour.length;
    for (const s of segmentsZone(z)) {
      if (z.cotes[s.i] !== "cloison") continue;
      const d = distanceAuSegment(p, s.a, s.b);
      if (d <= seuilM && (!best || d < best.d)) best = { zone: z, segIndex: s.i, t: positionSurSegment(p, z.contour[s.i], z.contour[(s.i + 1) % n]), d };
    }
  }
  return best;
}

// Modifie le type d'un côté. Passer en « ouvert » retire les portes de ce côté (plus de cloison pour les porter).
export function definirTypeCote(z: Zone, i: number, type: TypeCoteZone): Zone {
  if (z.cotes[i] === type) return z;
  const cotes = z.cotes.map((c, k) => (k === i ? type : c));
  const ouvertures = type === "ouvert" ? (z.ouvertures ?? []).filter(o => o.segIndex !== i) : z.ouvertures;
  return { ...z, cotes, ouvertures };
}

// ─── APPAREILLAGE MURAL SUR UNE CLOISON DE ZONE ────────────────────────────────────────────────────────────
// Une applique, une prise… se pose sur la FACE d'une cloison (le côté où l'on clique), comme sur un mur de pièce.
// Position stockée = sur la face (axe de la cloison + demi-épaisseur + 2 mm) ; c'est ce décalage qui indique le côté.
const JEU_FACE_M = 0.002;

export interface AncrageCloison { pied: Point; normale: Point; distanceAxe: number; demiEpaisseur: number }
// Cloison la plus proche de pt (distance mesurée à la FACE, pas à l'axe) ; null si au-delà de seuilM.
export function ancrageCloisonLePlusProche(pt: Point, zones: Zone[], seuilM: number): AncrageCloison | null {
  let best: (AncrageCloison & { dFace: number }) | null = null;
  for (const z of zones) {
    for (const c of cloisonsDeZone(z)) {
      const L = distance(c.a, c.b);
      if (L < 1e-6) continue;
      const ux = (c.b.x - c.a.x) / L, uy = (c.b.y - c.a.y) / L;
      const t = Math.max(0, Math.min(L, (pt.x - c.a.x) * ux + (pt.y - c.a.y) * uy));
      const pied = { x: c.a.x + ux * t, y: c.a.y + uy * t };
      const dAxe = distance(pt, pied);
      const demi = c.epaisseurM / 2;
      const dFace = Math.max(0, dAxe - demi);
      if (dFace > seuilM || (best && dFace >= best.dFace)) continue;
      const side = ((pt.x - pied.x) * -uy + (pt.y - pied.y) * ux) >= 0 ? 1 : -1;
      best = { pied, normale: { x: -uy * side, y: ux * side }, distanceAxe: dAxe, demiEpaisseur: demi, dFace };
    }
  }
  return best;
}

// Cloison dont la FACE passe par pt (affichage d'un appareillage déjà posé) : |distance à l'axe − demi-épaisseur| ≤ tolM, la plus
// juste d'abord. Distincte d'ancrageCloisonLePlusProche : dans un angle de cloisons, le point posé sur la face d'une cloison peut
// se trouver à 0 de l'AXE d'une autre — la « plus proche » serait alors celle-là, et l'appareillage perdrait son mur.
export function ancrageCloisonSurFace(pt: Point, zones: Zone[], tolM: number): AncrageCloison | null {
  let best: (AncrageCloison & { ecart: number }) | null = null;
  for (const z of zones) {
    for (const c of cloisonsDeZone(z)) {
      const L = distance(c.a, c.b);
      if (L < 1e-6) continue;
      const ux = (c.b.x - c.a.x) / L, uy = (c.b.y - c.a.y) / L;
      const t = Math.max(0, Math.min(L, (pt.x - c.a.x) * ux + (pt.y - c.a.y) * uy));
      const pied = { x: c.a.x + ux * t, y: c.a.y + uy * t };
      const dAxe = distance(pt, pied), demi = c.epaisseurM / 2;
      const ecart = Math.abs(dAxe - demi);
      if (ecart > tolM || (best && ecart >= best.ecart)) continue;
      const side = ((pt.x - pied.x) * -uy + (pt.y - pied.y) * ux) >= 0 ? 1 : -1;
      best = { pied, normale: { x: -uy * side, y: ux * side }, distanceAxe: dAxe, demiEpaisseur: demi, ecart };
    }
  }
  return best;
}

// Aimantation d'un appareillage mural posé DANS une pièce : mur de la pièce ou cloison de zone, le plus proche des deux.
export function aimanterMural(pt: Point, piece: Piece, zones: Zone[], type: AppareillageType, seuilM: number): Point {
  if (!estMural(type)) return pt;
  const mur = aimanterSurFaceMur(pt, piece, type, seuilM);
  const dMur = distance(mur, pt);
  const murSnappe = dMur > 1e-9;
  const cl = ancrageCloisonLePlusProche(pt, zones, seuilM);
  if (!cl) return mur;
  const surCloison = { x: cl.pied.x + cl.normale.x * (cl.demiEpaisseur + JEU_FACE_M), y: cl.pied.y + cl.normale.y * (cl.demiEpaisseur + JEU_FACE_M) };
  return !murSnappe || distance(surCloison, pt) < dMur ? surCloison : mur;
}

// Ancrage mural complet d'un appareillage déjà posé (affichage 2D, impression, 3D) : cloison de zone d'abord (si le
// point est sur sa face), sinon mur de la pièce (face intérieure finie, ou façade extérieure). null = pas contre un mur.
//  normale : du mur vers le côté où l'appareillage est posé · faceM : épaisseur à franchir entre l'axe/tracé et la face
//  · segIndex : mur de la pièce (-1 pour une cloison de zone).
export interface AncrageMural { pied: Point; normale: Point; faceM: number; segIndex: number; facade: boolean; cloison: boolean }
export function ancrageMural(pt: Point, piece: Piece, zones: Zone[]): AncrageMural | null {
  const cl = ancrageCloisonSurFace(pt, zones, 0.02);
  if (cl) {
    return { pied: cl.pied, normale: cl.normale, faceM: cl.demiEpaisseur, segIndex: -1, facade: false, cloison: true };
  }
  const anc: AncrageMur | null = ancrageMurLePlusProche(pt, piece.contour);
  if (!anc || anc.distance > TOLERANCE_MUR_M) return null;
  const facade = estEnFacade(pt, piece.contour, anc);
  return {
    pied: anc.pied, segIndex: anc.segIndex, facade, cloison: false,
    normale: facade ? { x: -anc.normale.x, y: -anc.normale.y } : anc.normale,
    faceM: facade ? 0 : faceInterieureM(piece, anc.segIndex),
  };
}

// ─── MEUBLE : AIMANTATION AU MUR / À LA CLOISON LA PLUS PROCHE ──────────────────────────────────────────────
// Le dos du meuble (côté -y local) vient contre la face du mur (intérieure finie, ou façade extérieure si le point est
// hors de la pièce) ou de la cloison de zone, la face avant (+y local) regarde la pièce. Le centre garde sa position le
// long du mur. Rotation en degrés, sens horaire vu de dessus (rotate SVG) : rotate(θ) envoie (0,1) sur la normale.
// null = aucun mur / cloison à portée (le meuble reste là où on le pose, orientation inchangée).
export function aimanterMeuble(pt: Point, pieces: Piece[], zones: Zone[], profondeurM: number): { x: number; y: number; rotation: number } | null {
  const portee = profondeurM / 2 + 0.3;
  let cand: { pied: Point; n: Point; faceM: number; dFace: number } | null = null;
  // TOUTES les pièces : face intérieure de celles qui contiennent le point, façade extérieure des autres (le mur d'une pièce
  // voisine, ou d'une petite pièce dans une grande, se vise depuis l'extérieur) ; le plus proche gagne.
  for (const piece of pieces.filter(p => p.contour.length >= 3)) {
    const anc = ancrageMurLePlusProche(pt, piece.contour);
    if (!anc) continue;
    const dedans = pointDansPolygone(pt, piece.contour);
    const faceM = dedans ? faceInterieureM(piece, anc.segIndex) : 0;
    const dFace = dedans ? Math.max(0, anc.distance - faceM) : anc.distance;
    const n = dedans ? anc.normale : { x: -anc.normale.x, y: -anc.normale.y };
    if (dFace <= portee && (!cand || dFace < cand.dFace)) cand = { pied: anc.pied, n, faceM, dFace };
  }
  const cl = ancrageCloisonLePlusProche(pt, zones, portee);
  if (cl) {
    const dFace = Math.max(0, cl.distanceAxe - cl.demiEpaisseur);
    if (!cand || dFace < cand.dFace) cand = { pied: cl.pied, n: cl.normale, faceM: cl.demiEpaisseur, dFace };
  }
  if (!cand) return null;
  const recul = cand.faceM + profondeurM / 2 + 0.005;
  return {
    x: cand.pied.x + cand.n.x * recul, y: cand.pied.y + cand.n.y * recul,
    rotation: ((Math.atan2(-cand.n.x, cand.n.y) * 180) / Math.PI + 360) % 360,
  };
}

// Appareillage mural : choisit LA pièce (et le mur / la cloison) contre laquelle il se pose. TOUS les murs sont candidats :
//  - pour une pièce qui CONTIENT le point : sa face intérieure finie ;
//  - pour toute autre pièce : sa façade extérieure (le mur d'une pièce voisine, ou d'une petite pièce posée dans une plus grande,
//    se vise depuis l'extérieur même quand le clic tombe dans une autre pièce) ;
//  - toutes les cloisons de zone, dans ou hors d'une pièce.
// Le plus proche gagne (à égalité, l'intérieur). pieceDefaut = pièce utilisée quand rien n'est aimanté (la plus petite qui
// contient le point, sinon la plus proche).
export function resoudreMural(pt: Point, pieces: Piece[], zones: Zone[], type: AppareillageType, seuilM: number):
  { piece: Piece | null; pieceDefaut: Piece | null; point: Point; aimante: boolean; horsPiece: boolean } {
  const valides = pieces.filter(p => p.contour.length >= 3);
  const dedans = valides.filter(p => pointDansPolygone(pt, p.contour))
    .sort((a, b) => aireDuPolygone(a.contour) - aireDuPolygone(b.contour));
  const defaut = dedans[0] ?? pieceLaPlusProche(pt, valides);
  const horsDefaut = dedans.length === 0;
  if (!estMural(type)) return { piece: defaut, pieceDefaut: defaut, point: pt, aimante: false, horsPiece: horsDefaut };
  let best: { d: number; piece: Piece | null; point: Point; horsPiece: boolean } | null = null;
  const proposer = (d: number, piece: Piece | null, point: Point, horsPiece: boolean) => {
    if (!best || d < best.d - 0.001 || (Math.abs(d - best.d) <= 0.001 && !horsPiece && best.horsPiece)) best = { d, piece, point, horsPiece };
  };
  for (const p of valides) {
    if (dedans.includes(p)) {
      const anc = ancrageMurLePlusProche(pt, contourUtile(p));
      if (anc && anc.distance <= seuilM) proposer(anc.distance, p, aimanterSurFaceMur(pt, p, type, seuilM), false);
    } else {
      const anc = ancrageMurLePlusProche(pt, p.contour);
      if (anc && anc.distance <= seuilM * 2) proposer(anc.distance, p, aimanterEnFacade(pt, p.contour, type, seuilM * 2), true);
    }
  }
  const cl = ancrageCloisonLePlusProche(pt, zones, seuilM);
  if (cl) {
    const dFace = Math.max(0, cl.distanceAxe - cl.demiEpaisseur);
    const e = cl.demiEpaisseur + JEU_FACE_M;
    proposer(dFace, defaut, { x: cl.pied.x + cl.normale.x * e, y: cl.pied.y + cl.normale.y * e }, horsDefaut);
  }
  const r = best as { d: number; piece: Piece | null; point: Point; horsPiece: boolean } | null;
  return r ? { piece: r.piece, pieceDefaut: defaut, point: r.point, aimante: true, horsPiece: r.horsPiece }
    : { piece: defaut, pieceDefaut: defaut, point: pt, aimante: false, horsPiece: horsDefaut };
}
