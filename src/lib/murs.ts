// src/lib/murs.ts
//
// Murs d'une pièce : épaisseurs des couches (structure + doublage + finition) et géométrie (plan 2D, impression, 3D).
//
// MODÈLE (version 2) : LE CONTOUR D'UNE PIÈCE EST SON TRACÉ HORS-TOUT, c'est-à-dire la face EXTÉRIEURE de ses murs.
// Les 3 couches s'ajoutent À L'INTÉRIEUR du tracé, vers la pièce : structure (contre le tracé), puis doublage, puis
// finition (côté pièce). Conséquences :
//  - les dimensions intérieures (face finie à face finie) = tracé − épaisseurs ; elles sont calculées ici et affichées ;
//  - deux pièces dessinées côte à côte sur la même ligne gardent chacune leurs propres épaisseurs : leurs tracés
//    coïncident toujours, il n'y a jamais de décalage visuel, quelles que soient les épaisseurs choisies ;
//  - les angles (sortants comme rentrants) sont tous des onglets exacts : les 4 faces d'un mur se raccordent à celles
//    du mur voisin sans trou ni retour visible (voir geometrieMurs, utilisé par le plan 2D, l'impression et la 3D).
// Tout est en mètres sur des Point du plan ; les épaisseurs des MurSpec sont en cm.

import { AppareillagePlace, AppareillageType, MurSpec, MurType, MUR_DEFAUT, Niveau, Piece, Point, aireDuPolygone, centroide, pointDansPolygone } from "@/lib/maison-types";
import { ancrageMurLePlusProche, estMural, TOLERANCE_MUR_M, DECALAGE_FACADE_M } from "@/lib/appareillage-mur";

export function murDe(piece: Piece, i: number): MurSpec {
  const m = piece.murs?.[i];
  return m ? { ...MUR_DEFAUT, epaisseur: m.epaisseur, doublage: m.doublage, finition: m.finition ?? 0 } : { ...MUR_DEFAUT };
}
export function mursDe(piece: Piece): MurSpec[] {
  return piece.contour.map((_, i) => murDe(piece, i));
}

// ─── Mur extérieur ou mitoyen ? ───────────────────────────────────────────────────
// Déduit de la géométrie : un côté dont le tracé coïncide avec celui d'une AUTRE pièce est mitoyen. N'influe plus
// sur l'épaisseur (chaque pièce garde la sienne) : sert à la couleur du mur, aux cotes extérieures et à la projection
// des ouvertures sur la pièce voisine. Calculé pour l'ensemble des pièces d'un niveau (preparerMurs, à appeler une
// fois par rendu avant de dessiner) et mémorisé par objet pièce ; une pièce non préparée est entièrement extérieure.
const MITOYENS = new WeakMap<object, boolean[]>();
export function preparerMurs(pieces: Piece[]): void {
  pieces.forEach(p => MITOYENS.set(p, p.contour.map((_, i) => cotesMitoyens(pieces, p.id, i).length > 0)));
}
export function definirMitoyens(piece: Piece, flags: boolean[]): void { MITOYENS.set(piece, flags); }
export function mitoyensDe(piece: Piece): boolean[] {
  return MITOYENS.get(piece) ?? piece.contour.map(() => false);
}
export function typeMur(piece: Piece, i: number): MurType {
  return mitoyensDe(piece)[i] ? "interieur" : "exterieur";
}

// Sens de rotation du contour (>0 : l'intérieur est à GAUCHE de chaque côté, en repère x,y).
function orientation(contour: Point[]): number {
  let a = 0;
  for (let i = 0; i < contour.length; i++) {
    const p = contour[i], q = contour[(i + 1) % contour.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a >= 0 ? 1 : -1;
}

// Normale unitaire du côté i, orientée vers l'INTÉRIEUR de la pièce (fiable aussi en L / concave).
export function normaleInterieure(contour: Point[], i: number): Point {
  const a = contour[i], b = contour[(i + 1) % contour.length];
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const s = orientation(contour);
  return { x: -(b.y - a.y) / l * s, y: (b.x - a.x) / l * s };
}

// Contour décalé : le côté i est déplacé de offsets[i] (m) vers l'intérieur (négatif = vers
// l'extérieur). Les sommets sont les intersections des côtés décalés (angles « d'onglet »), donc
// des murs d'épaisseurs différentes se raccordent proprement. Onglet limité sur les angles très aigus.
export function decalerContour(contour: Point[], offsets: number[]): Point[] {
  const n = contour.length;
  const normales = contour.map((_, i) => normaleInterieure(contour, i));
  const dirs = contour.map((a, i) => {
    const b = contour[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  });
  return contour.map((v, i) => {
    const j = (i - 1 + n) % n;
    const p1 = { x: contour[j].x + normales[j].x * offsets[j], y: contour[j].y + normales[j].y * offsets[j] };
    const p2 = { x: v.x + normales[i].x * offsets[i], y: v.y + normales[i].y * offsets[i] };
    const d1 = dirs[j], d2 = dirs[i];
    const den = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(den) < 1e-6) return p2; // côtés alignés : simple décalage
    const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
    const P = { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
    const maxOff = Math.max(Math.abs(offsets[j]), Math.abs(offsets[i]), 1e-6);
    const dist = Math.hypot(P.x - v.x, P.y - v.y);
    if (dist > maxOff * 4) { const k = (maxOff * 4) / dist; return { x: v.x + (P.x - v.x) * k, y: v.y + (P.y - v.y) * k }; }
    return P;
  });
}


// Comme decalerContour, mais avec UN POINT DE DÉPART ET UN POINT D'ARRIVÉE PAR CÔTÉ : debut[i] = début du côté i décalé,
// fin[i] = fin du côté i décalé. Aux angles, les deux sont confondus (onglet). Seule différence : quand deux côtés
// consécutifs sont ALIGNÉS (même direction) mais d'épaisseurs différentes, chacun garde son épaisseur jusqu'au sommet et
// le raccord est un DÉCROCHEMENT DROIT (perpendiculaire au mur) — pas un biais qui « compense » les deux épaisseurs.
export function decalerContourAretes(contour: Point[], offsets: number[]): { debut: Point[]; fin: Point[] } {
  const n = contour.length;
  const unique = decalerContour(contour, offsets);
  const debut = unique.map(p => ({ ...p })), fin = unique.map((_, i) => ({ ...unique[(i + 1) % n] }));   // fin[i] = point du sommet SUIVANT
  const normales = contour.map((_, i) => normaleInterieure(contour, i));
  const dirs = contour.map((a, i) => {
    const b = contour[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  });
  for (let i = 0; i < n; i++) {
    const j = (i - 1 + n) % n, v = contour[i];
    const den = dirs[j].x * dirs[i].y - dirs[j].y * dirs[i].x, dot = dirs[j].x * dirs[i].x + dirs[j].y * dirs[i].y;
    if (Math.abs(den) < 1e-6 && dot > 0 && Math.abs(offsets[j] - offsets[i]) > 1e-9) {
      debut[i] = { x: v.x + normales[i].x * offsets[i], y: v.y + normales[i].y * offsets[i] };
      fin[j] = { x: v.x + normales[j].x * offsets[j], y: v.y + normales[j].y * offsets[j] };
    }
  }
  return { debut, fin };
}

// Positions (m, vers l'INTÉRIEUR de la pièce, depuis la ligne du contour) des faces du mur i, de l'extérieur à
// l'intérieur : exterieure (face externe de la structure = le tracé lui-même, donc 0) · structureInt · doublageInt
// (face interne du doublage = face externe de la finition) · utile (face intérieure FINIE, après les 3 couches).
function plansMur(piece: Piece, i: number): { exterieure: number; structureInt: number; doublageInt: number; utile: number } {
  const m = murDe(piece, i), e = m.epaisseur / 100, d = m.doublage / 100, f = (m.finition ?? 0) / 100;
  return { exterieure: 0, structureInt: e, doublageInt: e + d, utile: e + d + f };
}

export interface QuadMur {
  i: number; type: MurType;
  structure: Point[];            // couche 3 : 4 points, de la face extérieure à la face intérieure de la structure
  doublage: Point[] | null;      // couche 2 : 4 points, ou null si l'épaisseur est nulle
  finition: Point[] | null;      // couche 1 : 4 points, ou null si l'épaisseur est nulle
  structureNulle: boolean;       // structure d'épaisseur 0 : pas de mur (cloison commune réglée à 0 d'un côté)
}
export interface GeometrieMurs {
  quads: QuadMur[];
  utile: Point[];                // face intérieure finie : DÉBUT de chaque mur (utile[i] → utileFin[i] = face du mur i)
  utileFin: Point[];             // face intérieure finie : FIN de chaque mur (= utile[i + 1] sauf décrochement entre deux murs alignés)
  utileComplet: Point[];         // polygone de la face intérieure finie AVEC les décrochements (pour surface / aplat) — = utile sans décrochement
  exterieur: Point[];            // contour de la face extérieure de la structure (hors-tout)
}

export function geometrieMurs(piece: Piece): GeometrieMurs {
  const c = piece.contour, n = c.length;
  const plans = c.map((_, i) => plansMur(piece, i));
  const ext = decalerContourAretes(c, plans.map(p => p.exterieure));
  const int = decalerContourAretes(c, plans.map(p => p.structureInt));
  const dbl = decalerContourAretes(c, plans.map(p => p.doublageInt));
  const utile = decalerContourAretes(c, plans.map(p => p.utile));
  const quads: QuadMur[] = c.map((_, i) => {
    const m = murDe(piece, i);
    return {
      i, type: typeMur(piece, i),
      structure: [ext.debut[i], ext.fin[i], int.fin[i], int.debut[i]],
      structureNulle: !(m.epaisseur > 0),
      doublage: m.doublage > 0 ? [int.debut[i], int.fin[i], dbl.fin[i], dbl.debut[i]] : null,
      finition: (m.finition ?? 0) > 0 ? [dbl.debut[i], dbl.fin[i], utile.fin[i], utile.debut[i]] : null,
    };
  });
  const meme = (p: Point, q: Point) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
  const complet: Point[] = [];
  c.forEach((_, i) => {
    complet.push(utile.debut[i]);
    if (!meme(utile.fin[i], utile.debut[(i + 1) % n])) complet.push(utile.fin[i]);   // décrochement : on garde les deux points
  });
  return { quads, utile: utile.debut, utileFin: utile.fin, utileComplet: complet, exterieur: ext.debut };
}

// Surface utile (m²) = aire de la face intérieure finie. null si les épaisseurs sont incompatibles avec
// la taille de la pièce (le contour décalé se retourne ou se coupe).
export function surfaceUtile(piece: Piece): number | null {
  const { utileComplet: utile } = geometrieMurs(piece);
  const brute = aireDuPolygone(piece.contour);
  const u = aireDuPolygone(utile);
  if (utile.length < 3 || u <= 0 || u > brute + 1e-9) return null;
  return orientation(utile) === orientation(piece.contour) ? u : null;
}
export function longueurUtileCm(piece: Piece, i: number): number {
  const { utile, utileFin } = geometrieMurs(piece);
  const a = utile[i], b = utileFin[i];
  return Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 100);
}
export function longueursUtilesCm(piece: Piece): number[] {
  return piece.contour.map((_, i) => longueurUtileCm(piece, i));
}

// Distance (m) du contour (tracé hors-tout) à la face intérieure FINIE du mur i : là où se posent prises et
// interrupteurs. Égale à l'épaisseur totale du mur.
export function faceInterieureM(piece: Piece, i: number): number {
  return plansMur(piece, i).utile;
}
// Épaisseur totale (m) du mur i : structure + doublage.
export function epaisseurTotaleM(piece: Piece, i: number): number {
  const m = murDe(piece, i);
  return (m.epaisseur + m.doublage + (m.finition ?? 0)) / 100;
}

// Découpe d'une ouverture dans TOUTES les épaisseurs du mur i : quadrilatère (monde, mètres) de la
// largeur de l'ouverture, de la face extérieure à la face intérieure finie.
export function decoupeOuverture(piece: Piece, i: number, position: number, largeurCm: number): Point[] {
  const c = piece.contour, n = c.length;
  const a = c[i], b = c[(i + 1) % n];
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const nIn = normaleInterieure(c, i);
  const pl = plansMur(piece, i);
  const t0 = pl.exterieure - 0.005, t1 = pl.utile + 0.005;
  const s0 = position * L - largeurCm / 200, s1 = position * L + largeurCm / 200;
  const P = (ss: number, tt: number): Point => ({ x: a.x + u.x * ss + nIn.x * tt, y: a.y + u.y * ss + nIn.y * tt });
  return [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)];
}

// Paramètres 3D du mur i : une entrée par COUCHE non nulle (structure, doublage, finition). decalage = position du
// centre de la couche, le long de la normale GAUCHE du côté (-uy, ux), celle des boîtes de mur de la vue 3D.
// La géométrie exacte des couches (onglets d'angle, sans trou ni retour) est celle de geometrieMurs : la vue 3D bâtit
// chaque couche à partir de son quadrilatère. extDebut / extFin sont donc toujours nuls (conservés pour compatibilité).
// reduction = hauteur retranchée aux couches intérieures (0 : elles se juxtaposent sans se recouvrir).
// profondeurCables = distance de la face finie au milieu de la couche 2 : c'est là que passent par défaut les
// circuits encastrés.
export type CoucheMur3D = { nom: "structure" | "doublage" | "finition"; epaisseur: number; decalage: number; extDebut: number; extFin: number; reduction: number };
export function parametresMur3D(piece: Piece, i: number) {
  const m = murDe(piece, i), e = m.epaisseur / 100, d = m.doublage / 100, f = (m.finition ?? 0) / 100;
  const pl = plansMur(piece, i);
  const sg = orientation(piece.contour);
  const couches: CoucheMur3D[] = [];
  couches.push({ nom: "structure", epaisseur: e, decalage: sg * (pl.exterieure + pl.structureInt) / 2, reduction: 0, extDebut: 0, extFin: 0 });
  if (d > 0) couches.push({ nom: "doublage", epaisseur: d, decalage: sg * (pl.structureInt + pl.doublageInt) / 2, reduction: 0, extDebut: 0, extFin: 0 });
  if (f > 0) couches.push({ nom: "finition", epaisseur: f, decalage: sg * (pl.doublageInt + pl.utile) / 2, reduction: 0, extDebut: 0, extFin: 0 });
  return {
    type: typeMur(piece, i),
    signeInterieur: sg,
    e, d, f,
    couches,
    profondeurCables: d > 0 ? f + d / 2 : f + 0.02,   // m, de la face finie vers l'intérieur du mur
  };
}

// Murs mitoyens : côtés des AUTRES pièces dont les deux extrémités coïncident (au cm près) avec
// le côté i de cette pièce. Une modification d'épaisseur de structure s'y reporte (le doublage, lui,
// reste propre à chaque pièce : il est du côté intérieur de chacune).
export function cotesMitoyens(pieces: Piece[], pieceId: number, i: number): { pieceId: number; i: number }[] {
  const src = pieces.find(p => p.id === pieceId);
  if (!src) return [];
  const a = src.contour[i], b = src.contour[(i + 1) % src.contour.length];
  const proche = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < 0.03;
  const res: { pieceId: number; i: number }[] = [];
  pieces.forEach(p => {
    if (p.id === pieceId) return;
    p.contour.forEach((c, j) => {
      const d = p.contour[(j + 1) % p.contour.length];
      if ((proche(a, c) && proche(b, d)) || (proche(a, d) && proche(b, c))) res.push({ pieceId: p.id, i: j });
    });
  });
  return res;
}

// Applique une nouvelle liste de murs à une pièce. Chaque pièce garde ses propres épaisseurs : rien n'est reporté
// sur les pièces voisines (leurs murs sont dans leur propre tracé, voir l'en-tête du fichier).
export function appliquerMurs(pieces: Piece[], pieceId: number, nouveaux: MurSpec[]): Piece[] {
  if (!pieces.some(p => p.id === pieceId)) return pieces;
  return pieces.map(p => p.id === pieceId ? { ...p, murs: nouveaux } : p);
}

// Suppression du sommet `index` : le côté `index` disparaît, celui d'avant s'étend jusqu'au sommet suivant.
export function murAfterSuppressionSommet(murs: MurSpec[] | undefined, index: number): MurSpec[] | undefined {
  return murs ? murs.filter((_, i) => i !== index) : undefined;
}

// Hauteur d'installation par défaut (mètres) quand l'appareillage n'a pas de hauteur saisie.
export const HAUTEUR_DEFAUT: Partial<Record<AppareillageType, number>> = {
  prise: 0.3, prise_commandee: 0.3, rj45: 0.3, prise_tv: 0.3, prise_dediee: 0.3, prise_exterieure: 0.5,
  interrupteur: 1.1, va_et_vient: 1.1, telerupteur: 1.1, interrupteur_double: 1.1, va_et_vient_double: 1.1, telerupteur_double: 1.1,
  applique: 1.8,
  // Extérieur : applique à 2,20 m, interrupteur étanche à 1,10 m. Détecteurs de mouvement muraux : 2,20 m (intérieur),
  // 2,40 m (extérieur, hors de portée) — réglables comme tout appareillage (champ « hauteur »).
  applique_exterieure: 2.2, interrupteur_exterieur: 1.1, detecteur_mouvement: 2.2, detecteur_mouvement_exterieur: 2.4,
  four: 0.6, plaque: 0.9, lave_linge: 0.85, lave_vaisselle: 0.85, seche_linge: 0.85,
  chauffe_eau: 1.8, chauffage: 0.3, clim: 2.0, seche_serviette: 1.2, congelateur: 0.85,
  irve: 1.0, piscine: 0.3, vmc: 2.2, alarme: 2.0,
  volet_roulant: 2.15, // centre du coffre, juste sous le plafond (le tablier descend en dessous)
};

// Hauteur d'installation (m) d'un appareillage : valeur saisie, sinon valeur par défaut de son type.
export function hauteurAppareilM(a: AppareillagePlace): number {
  return a.hauteur != null ? a.hauteur / 100 : (HAUTEUR_DEFAUT[a.type] ?? 1.0);
}

// ─── Câbles encastrés : par défaut dans la COUCHE 2 du mur qu'ils longent ──────────────────────────
// Si un point est proche d'un mur (à moins de `tol` m de sa face finie côté pièce, ou dans son épaisseur),
// renvoie ce mur et le point ramené au MILIEU DE LA COUCHE 2 (le doublage), là où passent les circuits
// encastrés. Deux extrémités d'une section qui renvoient le MÊME mur = la section longe ce mur.
export function pointDansCouche2(pieces: Piece[], pt: Point, tol = 0.35): { pieceId: number; i: number; point: Point } | null {
  let meilleur: { pieceId: number; i: number; point: Point; d: number } | null = null;
  for (const p of pieces) {
    const { utile, utileFin } = geometrieMurs(p);
    const n = p.contour.length;
    for (let i = 0; i < n; i++) {
      const A = utile[i], B = utileFin[i];
      const L = Math.hypot(B.x - A.x, B.y - A.y);
      if (L < 1e-6) continue;
      const u = { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
      const t = (pt.x - A.x) * u.x + (pt.y - A.y) * u.y;
      if (t < -0.05 || t > L + 0.05) continue;
      const nIn = normaleInterieure(p.contour, i);
      const dIn = (pt.x - A.x) * nIn.x + (pt.y - A.y) * nIn.y;        // > 0 : côté pièce
      if (dIn > tol || dIn < -epaisseurTotaleM(p, i)) continue;
      if (!meilleur || Math.abs(dIn) < meilleur.d) {
        const prof = parametresMur3D(p, i).profondeurCables;
        const tt = Math.max(0, Math.min(L, t));
        meilleur = { pieceId: p.id, i, d: Math.abs(dIn), point: { x: A.x + u.x * tt - nIn.x * prof, y: A.y + u.y * tt - nIn.y * prof } };
      }
    }
  }
  return meilleur ? { pieceId: meilleur.pieceId, i: meilleur.i, point: meilleur.point } : null;
}


// ─── Contour « utile » (faces intérieures finies) ────────────────────────────────────────────────────────────
// Le contour utile si les épaisseurs tiennent dans la pièce, sinon le tracé lui-même (cas dégénéré : murs plus épais
// que la pièce). Sert aux mesures prises « de face finie à face finie ».
export function contourUtile(piece: Piece): Point[] {
  return surfaceUtile(piece) != null ? geometrieMurs(piece).utile : piece.contour;
}

// Aimantation d'un appareillage sur la FACE FINIE du mur le plus proche (là où l'on le voit et où on le clique) ;
// renvoie la position stockée, c'est-à-dire sur le tracé du mur (la vue 2D et la 3D décalent ensuite l'appareillage de
// faceInterieureM vers la pièce). Les types non muraux, et les points hors de portée, ne bougent pas.
export function aimanterSurFaceMur(pt: Point, piece: Piece, type: AppareillageType, seuilM: number): Point {
  if (!estMural(type)) return pt;
  const base = contourUtile(piece);
  const surUtile = base !== piece.contour;
  const anc = ancrageMurLePlusProche(pt, base);
  if (!anc || anc.distance > seuilM) return pt;
  const d = surUtile ? faceInterieureM(piece, anc.segIndex) : 0;
  return { x: anc.pied.x - anc.normale.x * d, y: anc.pied.y - anc.normale.y * d };
}

// Tableau électrique : s'aimante tout seul au mur le plus proche (toutes pièces) et s'oriente face à la pièce.
// Dans une pièce → sur sa face intérieure finie ; hors de toute pièce → sur la façade extérieure (coffret extérieur).
// null = aucun mur à portée (le tableau reste là où on le pose). rotationDeg suit la convention de tableauRotation
// (la face avant du tableau regarde vers la normale gauche de la direction).
export function aimanterTableauSurMur(pt: Point, pieces: Piece[], seuilExterieurM: number): { pos: Point; rotationDeg: number } | null {
  let meilleur: { piece: Piece; anc: NonNullable<ReturnType<typeof ancrageMurLePlusProche>>; dedans: boolean } | null = null;
  // Un mur de pièce NE CONTENANT PAS le point (voisine, petite pièce dans une grande) est candidat par sa façade, s'il est à portée :
  // il l'emporte alors sur un mur lointain de la pièce qui contient le point.
  for (const p of pieces) {
    if (p.contour.length < 3) continue;
    const anc = ancrageMurLePlusProche(pt, p.contour);
    if (!anc) continue;
    const dedans = pointDansPolygone(pt, p.contour);
    if (!dedans && anc.distance > seuilExterieurM) continue;
    if (!meilleur || anc.distance < meilleur.anc.distance - 0.001 || (Math.abs(anc.distance - meilleur.anc.distance) <= 0.001 && dedans && !meilleur.dedans)) meilleur = { piece: p, anc, dedans };
  }
  if (!meilleur) return null;
  const { piece, anc, dedans } = meilleur;
  const n = dedans ? anc.normale : { x: -anc.normale.x, y: -anc.normale.y };   // normale vers le côté où se tient le tableau
  const recul = (dedans ? faceInterieureM(piece, anc.segIndex) : DECALAGE_FACADE_M) + 0.05;   // demi-profondeur du coffret (10 cm)
  const pos = { x: anc.pied.x + n.x * recul, y: anc.pied.y + n.y * recul };
  return { pos, rotationDeg: ((Math.atan2(-n.x, n.y) * 180) / Math.PI + 360) % 360 };
}

// ─── MIGRATION des plans enregistrés avant le modèle « tracé hors-tout » ────────────────────────────────────────
// Ancien modèle : contour = face intérieure FINIE d'un mur extérieur (les couches s'ajoutaient vers l'extérieur) ou AXE
// d'un mur mitoyen (structure centrée sur l'axe). Conversion, une seule fois, sans changer d'un millimètre l'intérieur
// des pièces ni la position des murs :
//  - mur extérieur : le contour recule jusqu'à la face extérieure ; mêmes épaisseurs ;
//  - mur mitoyen   : le contour reste sur l'axe, chaque pièce garde la moitié de la structure (e / 2) de son côté.
// Les appareillages posés contre un mur extérieur reculent avec lui ; les ouvertures et les étiquettes gardent leur
// position réelle sur le plan.
function convertirPiece(p: Piece, mitoyens: boolean[]): Piece {
  const c = p.contour;
  const murs = c.map((_, i) => murDe(p, i));
  const offsets = murs.map((m, i) => (mitoyens[i] ? 0 : -(((m.finition ?? 0) + m.doublage + m.epaisseur) / 100)));
  const contour = decalerContour(c, offsets);
  const mursNouveaux: MurSpec[] = murs.map((m, i) => (mitoyens[i] ? { ...m, epaisseur: Math.round((m.epaisseur / 2) * 10) / 10 } : { ...m }));

  const ouvertures = p.ouvertures?.map(o => {
    const a = c[o.segIndex], b = c[(o.segIndex + 1) % c.length];
    const a2 = contour[o.segIndex], b2 = contour[(o.segIndex + 1) % contour.length];
    if (!a || !b || !a2 || !b2) return o;
    const centre = { x: a.x + (b.x - a.x) * o.position, y: a.y + (b.y - a.y) * o.position };
    const L2 = Math.hypot(b2.x - a2.x, b2.y - a2.y);
    if (L2 < 1e-6) return o;
    const t = ((centre.x - a2.x) * (b2.x - a2.x) + (centre.y - a2.y) * (b2.y - a2.y)) / (L2 * L2);
    return { ...o, position: Math.max(0, Math.min(1, t)) };
  });

  const appareillages = p.appareillages.map(a => {
    if (!estMural(a.type)) return a;
    const anc = ancrageMurLePlusProche({ x: a.x, y: a.y }, c);
    if (!anc || anc.distance > TOLERANCE_MUR_M || mitoyens[anc.segIndex]) return a;   // mitoyen : la face finie ne bouge pas
    const m = murs[anc.segIndex];
    const recul = ((m.finition ?? 0) + m.doublage + m.epaisseur) / 100;               // l'ancienne face finie → le nouveau tracé
    return { ...a, x: a.x - anc.normale.x * recul, y: a.y - anc.normale.y * recul };
  });

  let nomDecalage = p.nomDecalage;
  if (nomDecalage) {
    const c0 = centroide(c), c1 = centroide(contour);
    nomDecalage = { x: c0.x + nomDecalage.x - c1.x, y: c0.y + nomDecalage.y - c1.y };
  }
  return { ...p, contour, murs: mursNouveaux, ouvertures, appareillages, ...(nomDecalage ? { nomDecalage } : {}), modeleMurs: 2 };
}

export function migrerModeleMurs(niveaux: Niveau[]): { niveaux: Niveau[]; migrees: number } {
  let migrees = 0;
  const res = niveaux.map(n => {
    if (n.pieces.every(p => p.modeleMurs === 2)) return n;
    // Mitoyens déterminés sur les contours d'origine, comme le faisait le rendu de l'ancien modèle.
    const mit = new Map<number, boolean[]>();
    n.pieces.forEach(p => mit.set(p.id, p.contour.map((_, i) => cotesMitoyens(n.pieces, p.id, i).length > 0)));
    return { ...n, pieces: n.pieces.map(p => { if (p.modeleMurs === 2) return p; migrees++; return convertirPiece(p, mit.get(p.id) ?? []); }) };
  });
  return { niveaux: migrees > 0 ? res : niveaux, migrees };
}
