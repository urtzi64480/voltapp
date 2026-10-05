// Fusion de deux pièces adjacentes en une seule.
//
// Principe : les deux contours (tracé hors-tout, voir Piece.contour) sont orientés dans le même sens, leurs côtés sont
// découpés aux sommets de l'autre pièce, puis les côtés COMMUNS (parcourus en sens inverse) sont supprimés : il reste
// le contour extérieur de l'union. La fusion est refusée si elle ne donne pas UN SEUL contour simple (pièces qui ne se
// touchent pas, ou qui se touchent en deux endroits et enferment une cour).
//
// Ce qui est conservé : murs (un par côté, chaque sous-côté garde le mur de la pièce d'origine), appareillages, meubles,
// ouvertures (recalées sur le nouveau côté qui les porte). Ce qui disparaît : les ouvertures posées sur le mur commun
// (la porte entre les deux pièces n'a plus lieu d'être) — leur nombre est renvoyé pour prévenir l'utilisateur.

import { Piece, Point, Ouverture, MurSpec, distance, positionSurSegment } from "@/lib/maison-types";
import { mursDe } from "@/lib/murs";

const TOL = 0.08;            // m — sommets / côtés considérés confondus
const LONGUEUR_COMMUNE_MIN = 0.1;   // m — longueur de mur commun minimale pour parler d'adjacence

export type ResultatFusion =
  | { ok: true; piece: Piece; ouverturesSupprimees: number }
  | { ok: false; erreur: string };

interface Arete { de: number; vers: number; mur: MurSpec; src: "A" | "B"; }

function aireSignee(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p.x * q.y - q.x * p.y; }
  return s / 2;
}

// Distance d'un point à un segment et paramètre (0..1) de sa projection.
function projeter(p: Point, a: Point, b: Point): { d: number; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return { d: distance(p, a), t: 0 };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { d: Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)), t };
}

const memeMur = (m1: MurSpec, m2: MurSpec) => m1.epaisseur === m2.epaisseur && m1.doublage === m2.doublage && (m1.finition ?? 0) === (m2.finition ?? 0);

export function fusionnerPieces(A: Piece, B: Piece): ResultatFusion {
  if (A.id === B.id) return { ok: false, erreur: "Choisis deux pièces différentes." };
  if (A.verrouillee || B.verrouillee) return { ok: false, erreur: "Une des deux pièces est verrouillée : déverrouille-la avant de fusionner." };
  if (A.contour.length < 3 || B.contour.length < 3) return { ok: false, erreur: "Contour de pièce incomplet." };
  if (!!A.modeleMurs !== !!B.modeleMurs) return { ok: false, erreur: "Les deux pièces n'utilisent pas le même modèle de murs : enregistre puis recharge le plan avant de fusionner." };

  // 1. Points canoniques (sommets confondus à TOL près → un seul point).
  const pts: Point[] = [];
  const canon = (p: Point): number => {
    const i = pts.findIndex(q => distance(p, q) <= TOL);
    if (i >= 0) return i;
    pts.push({ x: p.x, y: p.y });
    return pts.length - 1;
  };

  // 2. Arêtes orientées dans le même sens (anti-horaire) : un côté commun apparaît alors dans les deux sens opposés.
  const sA = Math.sign(aireSignee(A.contour)) || 1;
  const aretesDe = (piece: Piece, src: "A" | "B"): Arete[] => {
    const murs = mursDe(piece);
    const sens = Math.sign(aireSignee(piece.contour)) || 1;
    const ids = piece.contour.map(canon);
    return piece.contour.map((_, i) => {
      const j = (i + 1) % piece.contour.length;
      return sens > 0 ? { de: ids[i], vers: ids[j], mur: murs[i], src } : { de: ids[j], vers: ids[i], mur: murs[i], src };
    });
  };
  let aretes: Arete[] = [...aretesDe(A, "A"), ...aretesDe(B, "B")].filter(e => e.de !== e.vers);

  // 3. Découpe des côtés aux points canoniques qui tombent à l'intérieur (sommet d'une pièce posé sur le mur de l'autre).
  const decoupees: Arete[] = [];
  aretes.forEach(e => {
    const a = pts[e.de], b = pts[e.vers];
    const coupes = pts
      .map((p, idx) => ({ idx, ...projeter(p, a, b) }))
      .filter(c => c.idx !== e.de && c.idx !== e.vers && c.d <= TOL && c.t > 1e-6 && c.t < 1 - 1e-6)
      .sort((u, v) => u.t - v.t);
    const chaine = [e.de, ...coupes.map(c => c.idx), e.vers];
    for (let k = 0; k < chaine.length - 1; k++) if (chaine[k] !== chaine[k + 1]) decoupees.push({ de: chaine[k], vers: chaine[k + 1], mur: e.mur, src: e.src });
  });
  aretes = decoupees;

  // 4. Suppression des côtés communs (même segment, sens opposé, pièces différentes).
  const supprimees = new Set<number>();
  const communs: { a: Point; b: Point }[] = [];
  let longueurCommune = 0;
  aretes.forEach((e, i) => {
    if (supprimees.has(i)) return;
    const j = aretes.findIndex((f, k) => k !== i && !supprimees.has(k) && f.src !== e.src && f.de === e.vers && f.vers === e.de);
    if (j < 0) return;
    supprimees.add(i); supprimees.add(j);
    communs.push({ a: pts[e.de], b: pts[e.vers] });
    longueurCommune += distance(pts[e.de], pts[e.vers]);
  });
  if (longueurCommune < LONGUEUR_COMMUNE_MIN) return { ok: false, erreur: "Ces deux pièces ne partagent aucun mur : elles ne sont pas adjacentes." };
  const restantes = aretes.filter((_, i) => !supprimees.has(i));

  // 5. Chaînage du contour : chaque point doit avoir exactement une arête sortante.
  const sortantes = new Map<number, Arete[]>();
  restantes.forEach(e => sortantes.set(e.de, [...(sortantes.get(e.de) ?? []), e]));
  if ([...sortantes.values()].some(l => l.length !== 1)) return { ok: false, erreur: "La fusion donnerait un contour qui se touche lui-même : les pièces ne forment pas une seule forme simple." };
  const boucle: Arete[] = [];
  let courant = restantes[0];
  while (courant && boucle.length <= restantes.length) {
    boucle.push(courant);
    courant = sortantes.get(courant.vers)![0];
    if (courant === boucle[0]) break;
  }
  if (boucle.length !== restantes.length) return { ok: false, erreur: "La fusion donnerait plusieurs contours (cour intérieure ou contact en deux endroits) : impossible de fusionner ces deux pièces." };

  // 6. Simplification : on retire un sommet quand les deux côtés qui s'y rejoignent sont alignés ET ont le même mur.
  let sommets = boucle.map(e => pts[e.de]);
  let murs = boucle.map(e => e.mur);
  let change = true;
  while (change && sommets.length > 3) {
    change = false;
    for (let i = 0; i < sommets.length; i++) {
      const prec = (i - 1 + sommets.length) % sommets.length;
      const p0 = sommets[prec], p1 = sommets[i], p2 = sommets[(i + 1) % sommets.length];
      const l1 = distance(p0, p1), l2 = distance(p1, p2);
      if (l1 < 1e-6 || l2 < 1e-6) continue;
      const cross = ((p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x)) / (l1 * l2);
      const dot = ((p1.x - p0.x) * (p2.x - p1.x) + (p1.y - p0.y) * (p2.y - p1.y)) / (l1 * l2);
      if (Math.abs(cross) < 1e-3 && dot > 0 && memeMur(murs[prec], murs[i])) {
        sommets = sommets.filter((_, k) => k !== i);
        murs = murs.filter((_, k) => k !== i);   // le mur du côté précédent couvre le côté fusionné
        change = true;
        break;
      }
    }
  }
  if (sommets.length < 3) return { ok: false, erreur: "Contour fusionné invalide." };

  // 7. Orientation du résultat = celle de la pièce principale (les charnières / sens de coulissement en dépendent).
  let contour = sommets.map(p => ({ x: Number(p.x.toFixed(3)), y: Number(p.y.toFixed(3)) }));
  if (sA < 0) {
    const n = contour.length;
    const mursAvant = murs;
    contour = [...contour].reverse();
    murs = contour.map((_, k) => mursAvant[(n - 2 - k + 2 * n) % n]);
  }

  // 8. Ouvertures : recalées sur le côté du nouveau contour qui les porte ; celles du mur commun disparaissent.
  const ouvertures: Ouverture[] = [];
  let ouverturesSupprimees = 0;
  const reporter = (piece: Piece) => (piece.ouvertures ?? []).forEach(o => {
    const a = piece.contour[o.segIndex], b = piece.contour[(o.segIndex + 1) % piece.contour.length];
    if (!a || !b) return;
    const c = { x: a.x + (b.x - a.x) * o.position, y: a.y + (b.y - a.y) * o.position };
    if (communs.some(m => projeter(c, m.a, m.b).d <= TOL)) { ouverturesSupprimees++; return; }
    let meilleur = -1, dMin = Infinity;
    contour.forEach((p, i) => {
      const d = projeter(c, p, contour[(i + 1) % contour.length]).d;
      if (d < dMin) { dMin = d; meilleur = i; }
    });
    if (meilleur < 0 || dMin > TOL * 2) { ouverturesSupprimees++; return; }
    const p = contour[meilleur], q = contour[(meilleur + 1) % contour.length];
    const t = Math.max(0, Math.min(1, positionSurSegment(c, p, q)));
    // Nouveau côté parcouru dans le sens inverse de l'ancien : la position (déjà mesurée sur le nouveau côté) reste bonne,
    // mais la charnière et le sens de coulissement (relatifs au sens du côté) se retournent.
    const inverse = (q.x - p.x) * (b.x - a.x) + (q.y - p.y) * (b.y - a.y) < 0;
    const flip = (v?: "gauche" | "droite") => v === undefined ? undefined : v === "gauche" ? "droite" : "gauche";
    ouvertures.push({
      ...o, segIndex: meilleur, position: t,
      ...(inverse ? { charniere: flip(o.charniere), coulisseVers: flip(o.coulisseVers) } : {}),
    });
  });
  reporter(A); reporter(B);

  // 9. Pièce fusionnée : identité et réglages de la pièce principale (A).
  const { nomDecalage: _nd, personne, voiture, ...resteA } = A;
  void _nd;
  const piece: Piece = {
    ...resteA,
    contour,
    murs,
    appareillages: [...A.appareillages, ...B.appareillages],
    ouvertures,
    meubles: [...(A.meubles ?? []), ...(B.meubles ?? [])],
    hauteurPlafond: A.hauteurPlafond ?? B.hauteurPlafond,
    personne: personne ?? B.personne,
    voiture: voiture ?? B.voiture,
  };
  if (!piece.meubles?.length) delete piece.meubles;
  if (piece.personne === undefined) delete piece.personne;
  if (piece.voiture === undefined) delete piece.voiture;
  if (piece.hauteurPlafond === undefined) delete piece.hauteurPlafond;
  return { ok: true, piece, ouverturesSupprimees };
}

// Pièces du niveau avec lesquelles « piece » peut être fusionnée (mur commun + contour résultant simple).
export function voisinesFusionnables(pieces: Piece[], piece: Piece): Piece[] {
  return pieces.filter(p => p.id !== piece.id && fusionnerPieces(piece, p).ok);
}
