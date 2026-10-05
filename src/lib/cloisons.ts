// src/lib/cloisons.ts
//
// CLOISONS : découpe d'une pièce existante en DEUX sous-pièces (dressing, placard, bureau…) par une
// cloison tracée en polyligne, de mur à mur : premier point sur un mur de la pièce, points
// intermédiaires à l'intérieur, dernier point sur un mur (le même ou un autre).
//
// Le modèle ne connaît pas de « mur » indépendant d'une pièce : une cloison EST le côté commun de deux
// pièces dessinées côte à côte (même extrémités → mur mitoyen, voir murs.ts / cotesMitoyens). Découper
// revient donc à produire deux pièces qui partagent exactement les côtés du tracé. Tout le reste
// (épaisseurs, doublage, surface utile, 3D, portes projetées sur les deux faces) fonctionne alors sans
// code spécifique. Rien n'est jamais écrit ici sur le plan : les fonctions sont pures.

import {
  Piece, Point, Ouverture, MurSpec, PieceType, AppareillagePlace, MeubleSimple,
  pointDansPolygone, aireDuPolygone, distance, distanceAuSegment, nouvellePiece, uidMaison,
} from "@/lib/maison-types";
import { mursDe } from "@/lib/murs";

// Tolérances (mètres)
const EPS_SOMMET = 0.03;      // un point à moins de 3 cm d'un sommet est CE sommet (même seuil que cotesMitoyens)
const EPS_MUR = 0.02;         // un point à moins de 2 cm d'un côté est SUR ce côté
const MARGE_INTERIEURE = 0.03; // un point intermédiaire doit être à plus de 3 cm de tout mur
const LONGUEUR_MIN = 0.1;     // longueur minimale d'un tronçon de cloison

export interface PointAccroche { point: Point; segIndex: number; surSommet: boolean }

// Accroche un point du curseur sur le contour d'une pièce : point le plus proche d'un côté, calé sur la
// grille de 10 cm le long de ce côté (côtés horizontaux / verticaux) et attiré par les sommets.
// null si le curseur est à plus de seuilM de tout mur.
export function accrocherSurContour(contour: Point[], p: Point, seuilM: number): PointAccroche | null {
  const n = contour.length;
  let meilleur: { i: number; d: number } | null = null;
  for (let i = 0; i < n; i++) {
    const d = distanceAuSegment(p, contour[i], contour[(i + 1) % n]);
    if (!meilleur || d < meilleur.d) meilleur = { i, d };
  }
  if (!meilleur || meilleur.d > seuilM) return null;
  // Sommet proche : on prend le sommet (le côté qui en part sert de référence).
  for (let i = 0; i < n; i++) {
    if (distance(p, contour[i]) <= seuilM) return { point: { ...contour[i] }, segIndex: i, surSommet: true };
  }
  const i = meilleur.i;
  const a = contour[i], b = contour[(i + 1) % n];
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-6) return null;
  let s = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L;               // abscisse le long du côté (m)
  const horizontal = Math.abs(dy) < 1e-6, vertical = Math.abs(dx) < 1e-6;
  if (horizontal) {
    const x = Math.round(p.x / 0.1) * 0.1;
    s = (x - a.x) / (dx / L);
  } else if (vertical) {
    const y = Math.round(p.y / 0.1) * 0.1;
    s = (y - a.y) / (dy / L);
  } else {
    s = Math.round(s / 0.05) * 0.05;
  }
  s = Math.max(0, Math.min(L, s));
  const pt = { x: a.x + (dx / L) * s, y: a.y + (dy / L) * s };
  for (let k = 0; k < n; k++) {
    if (distance(pt, contour[k]) < EPS_SOMMET) return { point: { ...contour[k] }, segIndex: k, surSommet: true };
  }
  return { point: pt, segIndex: i, surSommet: false };
}

// ─── Géométrie élémentaire ───────────────────────────────────────────────────────────────────
function intersection(p1: Point, p2: Point, p3: Point, p4: Point): { x: number; y: number } | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y, d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null; // parallèles ou colinéaires (traités par la marge intérieure)
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: p1.x + d1x * t, y: p1.y + d1y * t };
}
function distanceAuContour(p: Point, contour: Point[]): number {
  let min = Infinity;
  for (let i = 0; i < contour.length; i++) min = Math.min(min, distanceAuSegment(p, contour[i], contour[(i + 1) % contour.length]));
  return min;
}
const proche = (p: Point, q: Point, eps: number) => Math.hypot(p.x - q.x, p.y - q.y) < eps;

// Position d'un point sur le contour : sommet existant, ou intérieur d'un côté (segIndex + abscisse s en m).
type Pos = { sommet: number } | { cote: number; s: number };
function positionSurContour(contour: Point[], p: Point): Pos | null {
  const n = contour.length;
  for (let i = 0; i < n; i++) if (proche(p, contour[i], EPS_SOMMET)) return { sommet: i };
  for (let i = 0; i < n; i++) {
    const a = contour[i], b = contour[(i + 1) % n];
    if (distanceAuSegment(p, a, b) < EPS_MUR) return { cote: i, s: distance(a, p) };
  }
  return null;
}

// ─── Découpe du contour ───────────────────────────────────────────────────────────────────────
interface Noeud { pt: Point; orig: number }   // orig : côté d'origine dont part l'arête sortante de ce nœud
type Arete = { kind: "orig"; orig: number; de: Point; vers: Point } | { kind: "cloison"; indice: number; de: Point; vers: Point };

export interface DecoupeContours {
  contour1: Point[]; aretes1: Arete[];   // de P à Q le long du contour, puis retour par la cloison
  contour2: Point[]; aretes2: Arete[];   // de Q à P le long du contour, puis aller par la cloison
  inseres: { cote: number; s: number }[]; // points insérés au milieu d'un côté d'origine
}

function decouperContour(contour: Point[], chemin: Point[]): DecoupeContours | string {
  const n = contour.length;
  if (chemin.length < 2) return "Une cloison demande au moins un point de départ et un point d'arrivée.";
  const P = chemin[0], Q = chemin[chemin.length - 1];
  const posP = positionSurContour(contour, P), posQ = positionSurContour(contour, Q);
  if (!posP) return "Le départ de la cloison doit être sur un mur de la pièce.";
  if (!posQ) return "L'arrivée de la cloison doit être sur un mur de la pièce.";
  const interieur = chemin.slice(1, -1);

  // 1 · tronçons : longueur mini, et jamais le long d'un mur
  for (let m = 0; m < chemin.length - 1; m++) {
    if (distance(chemin[m], chemin[m + 1]) < LONGUEUR_MIN) return "Un tronçon de cloison est trop court (10 cm minimum).";
  }
  // 2 · points intermédiaires strictement à l'intérieur
  for (const c of interieur) {
    if (!pointDansPolygone(c, contour) || distanceAuContour(c, contour) < MARGE_INTERIEURE) {
      return "Les points intermédiaires de la cloison doivent être à l'intérieur de la pièce, à distance des murs.";
    }
  }
  // 3 · chaque tronçon reste dans la pièce (milieu intérieur) et ne croise aucun mur sauf à ses extrémités P / Q
  for (let m = 0; m < chemin.length - 1; m++) {
    const a = chemin[m], b = chemin[m + 1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (!pointDansPolygone(mid, contour) || distanceAuContour(mid, contour) < MARGE_INTERIEURE) {
      return "La cloison doit traverser l'intérieur de la pièce (pas le long d'un mur, pas à l'extérieur).";
    }
    for (let i = 0; i < n; i++) {
      const X = intersection(a, b, contour[i], contour[(i + 1) % n]);
      if (!X) continue;
      const surDepart = m === 0 && proche(X, P, EPS_SOMMET);
      const surArrivee = m === chemin.length - 2 && proche(X, Q, EPS_SOMMET);
      if (!surDepart && !surArrivee) return "La cloison traverse un mur de la pièce : elle doit rester à l'intérieur.";
    }
  }
  // 4 · pas d'auto-croisement (tronçons non consécutifs) ni de retour sur soi (tronçons consécutifs)
  for (let m = 0; m < chemin.length - 1; m++) {
    for (let k = m + 1; k < chemin.length - 1; k++) {
      const X = intersection(chemin[m], chemin[m + 1], chemin[k], chemin[k + 1]);
      if (!X) continue;
      const consecutifs = k === m + 1;
      if (!(consecutifs && proche(X, chemin[m + 1], EPS_SOMMET))) return "La cloison se croise elle-même.";
      const u = { x: chemin[m + 1].x - chemin[m].x, y: chemin[m + 1].y - chemin[m].y };
      const v = { x: chemin[k + 1].x - chemin[k].x, y: chemin[k + 1].y - chemin[k].y };
      const cos = (u.x * v.x + u.y * v.y) / ((Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)) || 1);
      if (cos < -0.9995) return "La cloison revient exactement sur elle-même.";
    }
  }

  // 5 · construction de la liste de nœuds (contour + P et Q insérés s'ils tombent au milieu d'un côté)
  const noeuds: Noeud[] = [];
  const inseres: { cote: number; s: number }[] = [];
  let ip = -1, iq = -1;
  for (let i = 0; i < n; i++) {
    if ("sommet" in posP && posP.sommet === i) ip = noeuds.length;
    if ("sommet" in posQ && posQ.sommet === i) iq = noeuds.length;
    noeuds.push({ pt: contour[i], orig: i });
    const sur: { s: number; qui: "P" | "Q" }[] = [];
    if ("cote" in posP && posP.cote === i) sur.push({ s: posP.s, qui: "P" });
    if ("cote" in posQ && posQ.cote === i) sur.push({ s: posQ.s, qui: "Q" });
    sur.sort((x, y) => x.s - y.s);
    for (const e of sur) {
      if (e.qui === "P") ip = noeuds.length; else iq = noeuds.length;
      noeuds.push({ pt: e.qui === "P" ? P : Q, orig: i });
      inseres.push({ cote: i, s: e.s });
    }
  }
  if (ip < 0 || iq < 0) return "Départ ou arrivée introuvable sur le contour.";
  if (ip === iq) return "Le départ et l'arrivée de la cloison sont au même endroit.";
  if (interieur.length === 0) {
    // Cloison droite : elle ne doit pas longer un mur (départ et arrivée sur le même côté).
    const mm = noeuds.length;
    const adjacents = (ip + 1) % mm === iq || (iq + 1) % mm === ip;
    if (adjacents) return "Départ et arrivée sont sur le même mur : ajoute un point intermédiaire à l'intérieur de la pièce.";
  }

  const N = noeuds.length;
  const arc = (de: number, a: number): Noeud[] => {
    const res: Noeud[] = [];
    for (let k = de; ; k = (k + 1) % N) { res.push(noeuds[k]); if (k === a) break; }
    return res;
  };
  const sousCote = (nds: Noeud[]): Arete[] => nds.slice(0, -1).map((nd, k) => ({ kind: "orig", orig: nd.orig, de: nd.pt, vers: nds[k + 1].pt }));
  const m = chemin.length - 1; // nombre de tronçons

  // Polygone 1 : P → … → Q le long du contour, puis retour Q → ck … c1 → P par la cloison.
  const arc1 = arc(ip, iq);
  const contour1 = [...arc1.map(x => x.pt), ...[...interieur].reverse()];
  const aretes1: Arete[] = sousCote(arc1);
  for (let k = m - 1; k >= 0; k--) aretes1.push({ kind: "cloison", indice: k, de: chemin[k + 1], vers: chemin[k] });
  // Polygone 2 : Q → … → P le long du contour, puis aller P → c1 … ck → Q par la cloison.
  const arc2 = arc(iq, ip);
  const contour2 = [...arc2.map(x => x.pt), ...interieur];
  const aretes2: Arete[] = sousCote(arc2);
  for (let k = 0; k < m; k++) aretes2.push({ kind: "cloison", indice: k, de: chemin[k], vers: chemin[k + 1] });

  if (aireDuPolygone(contour1) < 0.05 || aireDuPolygone(contour2) < 0.05) return "L'une des deux pièces obtenues serait trop petite.";
  return { contour1, aretes1, contour2, aretes2, inseres };
}

// Aperçu léger pour le formulaire : surfaces brutes (à l'axe de la cloison) des deux parties, ou erreur.
export function apercuCloison(piece: Piece, chemin: Point[]): { aire1: number; aire2: number } | { erreur: string } {
  const d = decouperContour(piece.contour, chemin);
  if (typeof d === "string") return { erreur: d };
  return { aire1: aireDuPolygone(d.contour1), aire2: aireDuPolygone(d.contour2) };
}

// ─── Report des murs / ouvertures / appareillages / meubles ────────────────────────────────────

// Insère un sommet au milieu du côté i d'UNE pièce (la voisine qui partage le mur coupé par la cloison) :
// sans cela le côté mitoyen ne coïnciderait plus avec le côté de la sous-pièce et ne serait plus vu comme mitoyen.
// Murs dupliqués, ouvertures du côté recalées sur le bon demi-côté. Erreur si une ouverture est à cheval.
function insererSommet(piece: Piece, i: number, pt: Point): Piece | string {
  const n = piece.contour.length;
  const a = piece.contour[i], b = piece.contour[(i + 1) % n];
  const L = distance(a, b), s = distance(a, pt);
  if (L < 1e-6 || s < EPS_SOMMET || L - s < EPS_SOMMET) return piece;
  const ouv: Ouverture[] = [];
  for (const o of piece.ouvertures ?? []) {
    if (o.segIndex < i) { ouv.push(o); continue; }
    if (o.segIndex > i) { ouv.push({ ...o, segIndex: o.segIndex + 1 }); continue; }
    const c = o.position * L, demi = o.largeur / 200;
    if (s > c - demi - 0.02 && s < c + demi + 0.02) return `La cloison tombe sur une ${libelleOuverture(o)} de « ${piece.nom || "pièce voisine"} » : déplace-la d'abord.`;
    if (c < s) ouv.push({ ...o, position: c / s });
    else ouv.push({ ...o, segIndex: i + 1, position: (c - s) / (L - s) });
  }
  const contour = [...piece.contour.slice(0, i + 1), pt, ...piece.contour.slice(i + 1)];
  const res: Piece = { ...piece, contour, ouvertures: piece.ouvertures ? ouv : piece.ouvertures };
  if (piece.murs) {
    const murs = mursDe(piece);
    res.murs = [...murs.slice(0, i + 1), { ...murs[i] }, ...murs.slice(i + 1)];
  }
  return res;
}
function libelleOuverture(o: Ouverture): string {
  return o.type === "fenetre" ? "fenêtre" : o.type === "baie_vitree" ? "baie vitrée" : o.type === "porte_garage" ? "porte de garage" : o.type === "ouverture" ? "ouverture" : "porte";
}

export interface OptionsCloison {
  nomOrigine: string; typeOrigine: PieceType;       // pièce qui garde l'id d'origine
  nomNouvelle: string; typeNouvelle: PieceType;     // nouvelle pièce
  epaisseurCm: number;                              // structure de la cloison (identique des deux côtés)
  // Porte posée au milieu du plus long tronçon de la cloison (null = aucune). Elle appartient à la
  // NOUVELLE pièce et s'ouvre vers la pièce d'origine ; les deux faces sont percées (mur mitoyen).
  porte: "porte" | "porte_coulissante" | "porte_galandage" | "ouverture" | null;
}

export interface ResultatCloison {
  pieces: Piece[];                 // toutes les pièces du niveau, mises à jour
  idOrigine: number; idNouvelle: number;
  aireOrigine: number; aireNouvelle: number;   // surfaces brutes (à l'axe)
  avertissement?: string;
}

// Plus grande des deux parties : elle garde l'id, le nom et le type de la pièce d'origine.
function estPremierePrincipale(c: DecoupeContours): boolean {
  return aireDuPolygone(c.contour1) >= aireDuPolygone(c.contour2);
}

export function appliquerCloison(pieces: Piece[], pieceId: number, chemin: Point[], opts: OptionsCloison): ResultatCloison | { erreur: string } {
  const orig = pieces.find(p => p.id === pieceId);
  if (!orig) return { erreur: "Pièce introuvable." };
  if (orig.verrouillee) return { erreur: "Cette pièce est verrouillée : déverrouille-la avant de la cloisonner." };
  const d = decouperContour(orig.contour, chemin);
  if (typeof d === "string") return { erreur: d };

  const principale1 = estPremierePrincipale(d);
  const ctPrinc = principale1 ? d.contour1 : d.contour2, arPrinc = principale1 ? d.aretes1 : d.aretes2;
  const ctNouv = principale1 ? d.contour2 : d.contour1, arNouv = principale1 ? d.aretes2 : d.aretes1;

  // Ouvertures de la pièce d'origine : aucune ne doit être coupée par la cloison.
  const L = (i: number) => distance(orig.contour[i], orig.contour[(i + 1) % orig.contour.length]);
  for (const o of orig.ouvertures ?? []) {
    for (const ins of d.inseres) {
      if (ins.cote !== o.segIndex) continue;
      const c = o.position * L(o.segIndex), demi = o.largeur / 200;
      if (ins.s > c - demi - 0.02 && ins.s < c + demi + 0.02) {
        return { erreur: `La cloison tombe sur une ${libelleOuverture(o)} : déplace-la ou change l'emplacement de la cloison.` };
      }
    }
  }

  // Murs : chaque sous-côté garde le mur de son côté d'origine ; la cloison reçoit l'épaisseur choisie des deux côtés.
  const mursOrig = mursDe(orig);
  const murCloison: MurSpec = { epaisseur: Math.max(5, opts.epaisseurCm), doublage: 0, finition: 0 };
  const mursDe_ = (ar: Arete[]): MurSpec[] => ar.map(a => a.kind === "orig" ? { ...mursOrig[a.orig] } : { ...murCloison });

  // Ouvertures : position absolue le long du côté d'origine → sous-côté qui la contient.
  const ouvertures = (ar: Arete[]): Ouverture[] => {
    const res: Ouverture[] = [];
    ar.forEach((a, idx) => {
      if (a.kind !== "orig") return;
      const aO = orig.contour[a.orig];
      const s0 = distance(aO, a.de), s1 = distance(aO, a.vers), Lo = L(a.orig);
      if (s1 - s0 < 1e-6) return;
      (orig.ouvertures ?? []).filter(o => o.segIndex === a.orig).forEach(o => {
        const c = o.position * Lo;
        if (c < s0 - 1e-6 || c > s1 + 1e-6) return;
        res.push({ ...o, segIndex: idx, position: Math.max(0, Math.min(1, (c - s0) / (s1 - s0))) });
      });
    });
    return res;
  };

  // Appareillages / meubles : chacun va dans la partie qui le contient (à défaut, la plus proche).
  const partie = (pt: Point): 0 | 1 => {
    const dansP = pointDansPolygone(pt, ctPrinc), dansN = pointDansPolygone(pt, ctNouv);
    if (dansP && !dansN) return 0;
    if (dansN && !dansP) return 1;
    return distanceAuContour(pt, ctNouv) < distanceAuContour(pt, ctPrinc) ? 1 : 0;
  };
  const choixApp = new Map<number, 0 | 1>();
  orig.appareillages.forEach(a => choixApp.set(a.id, partie({ x: a.x, y: a.y })));
  // Une plaque multiple reste d'un seul tenant : tous ses postes suivent le premier.
  const groupes = new Map<number, AppareillagePlace>();
  orig.appareillages.forEach(a => {
    if (a.groupeId == null) return;
    const g = groupes.get(a.groupeId);
    if (!g || (a.rangPlaque ?? 0) < (g.rangPlaque ?? 0)) groupes.set(a.groupeId, a);
  });
  orig.appareillages.forEach(a => { if (a.groupeId != null) choixApp.set(a.id, choixApp.get(groupes.get(a.groupeId)!.id)!); });
  const appsDe = (k: 0 | 1) => orig.appareillages.filter(a => choixApp.get(a.id) === k);
  const meublesDe = (k: 0 | 1): MeubleSimple[] => (orig.meubles ?? []).filter(m => partie({ x: m.x, y: m.y }) === k);

  const { nomDecalage: _nd, ...origineSansEtiquette } = orig;
  void _nd;
  const principale: Piece = {
    ...origineSansEtiquette, nom: opts.nomOrigine, type: opts.typeOrigine,
    contour: ctPrinc, murs: mursDe_(arPrinc), ouvertures: ouvertures(arPrinc),
    appareillages: appsDe(0), meubles: orig.meubles ? meublesDe(0) : orig.meubles,
  };
  const nouvelle: Piece = {
    ...nouvellePiece(ctNouv, opts.nomNouvelle, opts.typeNouvelle),
    hauteurPlafond: orig.hauteurPlafond,
    murs: mursDe_(arNouv), ouvertures: ouvertures(arNouv),
    appareillages: appsDe(1), ...(orig.meubles ? { meubles: meublesDe(1) } : {}),
  };

  // Porte dans la cloison : au milieu du plus long tronçon, côté nouvelle pièce, battant vers la pièce d'origine.
  let avertissement: string | undefined;
  if (opts.porte) {
    let meilleur = -1, lmax = 0;
    arNouv.forEach((a, idx) => { if (a.kind === "cloison") { const l = distance(a.de, a.vers); if (l > lmax) { lmax = l; meilleur = idx; } } });
    const largeurCm = 90;
    // Galandage : il faut loger le vantail dans la cloison, à côté de l'ouverture (au centre : longueur ≥ 3 × la largeur).
    const longueurMin = opts.porte === "porte_galandage" ? 3 * largeurCm : largeurCm + 20;
    if (meilleur >= 0 && lmax * 100 >= longueurMin) {
      const base = nouvelle.ouvertures ?? [];
      const o: Ouverture = opts.porte === "porte"
        ? { id: 0, type: "porte", segIndex: meilleur, position: 0.5, largeur: largeurCm, hauteur: 204, allege: 0, charniere: "gauche", ouvreVersInterieur: false }
        : opts.porte === "porte_coulissante" || opts.porte === "porte_galandage"
          ? { id: 0, type: "porte_coulissante", segIndex: meilleur, position: 0.5, largeur: largeurCm, hauteur: 204, allege: 0, coulisseVers: "droite", montage: opts.porte === "porte_galandage" ? "galandage" : "applique" }
          : { id: 0, type: "ouverture", segIndex: meilleur, position: 0.5, largeur: largeurCm, hauteur: 204, allege: 0 };
      nouvelle.ouvertures = [...base, { ...o, id: uidMaison() }];
    } else {
      avertissement = opts.porte === "porte_galandage"
        ? "Tronçon de cloison trop court pour une porte à galandage de 90 cm (il faut au moins 2,70 m pour loger le vantail) : pose-la ensuite avec l'outil « Porte / fenêtre »."
        : "Tronçon de cloison trop court pour une porte de 90 cm : pose-la ensuite avec l'outil « Porte / fenêtre ».";
    }
  }

  // Voisines : le point de départ / d'arrivée qui tombe au milieu d'un de leurs côtés y est inséré.
  let autres: Piece[] = pieces.filter(p => p.id !== pieceId);
  for (const pt of [chemin[0], chemin[chemin.length - 1]]) {
    const maj: Piece[] = [];
    for (const p of autres) {
      let courante: Piece = p;
      const pos = positionSurContour(p.contour, pt);
      if (pos && "cote" in pos) {
        const r = insererSommet(p, pos.cote, pt);
        if (typeof r === "string") return { erreur: r };
        courante = r;
      }
      maj.push(courante);
    }
    autres = maj;
  }

  const res: Piece[] = [];
  pieces.forEach(p => {
    if (p.id === pieceId) { res.push(principale, nouvelle); return; }
    res.push(autres.find(a => a.id === p.id) ?? p);
  });
  return {
    pieces: res, idOrigine: principale.id, idNouvelle: nouvelle.id,
    aireOrigine: aireDuPolygone(principale.contour), aireNouvelle: aireDuPolygone(nouvelle.contour), avertissement,
  };
}
