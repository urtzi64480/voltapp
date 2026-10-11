// src/lib/pose-circuits.ts
//
// Pose d'un circuit, SECTION PAR SECTION. Un circuit part d'un point (tableau, boîte, appareillage), passe par
// des points ajoutés à la main (coudes) et arrive à un autre point : chaque section entre deux points
// consécutifs est soit ENCASTRÉE (défaut — câble sous gaine dans le doublage ou la structure), soit
// APPARENTE (le câble sort du mur : moulure). Un même circuit peut donc être encastré sur une partie de
// son tracé et apparent sur une autre.
//
// Stockage : la pose d'une section est portée par le coude où elle ABOUTIT (LiaisonWaypoint.poseType) ;
// la dernière section (après le dernier coude) par Niveau.poseFinLiaison[cle]. Pré-devis, plan 2D,
// impression et vue 3D lisent tous ici : une section apparente = de la moulure partout.

import {
  AppareillagePlace, LiaisonWaypoint, Niveau, Point, PoseTroncon, SegmentCircuit, cleSegmentLiaison, origineCircuits, uidMaison,
} from "@/lib/maison-types";
import { ResultatGeneration, segmentsPourCircuit } from "@/lib/maison-engine";
import { coudesSegment } from "@/lib/routage-circuits";
import { portesSurTrace } from "@/lib/routage-murs";
import { hauteurCourseSection } from "@/lib/chemin-3d";
import { hauteurAppareilM } from "@/lib/murs";
import type { Breaker } from "@/lib/electrical-constants";

// ─── HAUTEUR DE COURSE PAR DÉFAUT D'UNE LIAISON ────────────────────────────────────────────
// Un circuit de prises (comme tout circuit autre que l'éclairage) est une CHAÎNE : tableau → 1re prise → 2e prise…
// Le câble arrive du tableau à la hauteur de gaine, descend à la 1re prise, puis les prises se relient ENTRE ELLES
// à plat, à la hauteur de la 1re prise — il ne remonte pas à la hauteur de gaine à chaque prise. Un éclairage reste
// en étoile à la hauteur de gaine (boîte de dérivation au plafond). Les hauteurs réglées à la main (section,
// coude) priment toujours (voir hauteurCourseSection, chemin-3d.ts). Source unique, partagée par la vue 3D
// (tracé du câble) et la pose apparente (hauteur de goulotte) pour que câble et goulotte coïncident.
// N'influe PAS sur les longueurs : toutes les longueurs (pré-devis, plan, impression) sont mesurées sur le plan 2D.
const estAncreAppareillage = (id: string): boolean => id !== "tableau" && id !== "boite" && !id.startsWith("boite-");

// Première ancre appareillage du tracé : celle qui suit le tableau, ou (circuit non relié au tableau) la 1re du tracé.
export function premierAppareillageChaine(segments: SegmentCircuit[]): string | null {
  const depuisTableau = segments.find(s => s.aId === "tableau" && estAncreAppareillage(s.bId));
  if (depuisTableau) return depuisTableau.bId;
  const premier = segments.find(s => estAncreAppareillage(s.aId));
  return premier ? premier.aId : null;
}

// Renvoie, pour un circuit, la hauteur de course par défaut (m) de chacune de ses liaisons.
// hauteurAncre : hauteur (m) de raccordement d'une ancre (appareillage), telle que dessinée.
export function hauteurDefautLiaison(
  breaker: Pick<Breaker, "circuit">, segments: SegmentCircuit[], hauteurAncre: (id: string) => number, hauteurGaine: number,
): (seg: SegmentCircuit) => number {
  if (breaker.circuit === "lumiere") return () => hauteurGaine;
  const premier = premierAppareillageChaine(segments);
  if (premier == null) return () => hauteurGaine;
  // Entre deux appareillages, le câble court à plat à la hauteur du plus BAS des deux : une seule montée / descente (égale à l'écart
  // de hauteur), et aucune quand ils sont à la même hauteur — ex. deux prises à 20 cm se relient à 20 cm, sans remonter au plafond
  // ni à la hauteur d'une autre prise du circuit.
  return seg => (estAncreAppareillage(seg.aId) && estAncreAppareillage(seg.bId)) ? Math.min(hauteurAncre(seg.aId), hauteurAncre(seg.bId)) : hauteurGaine;
}

// Pose de chacune des (coudes + 1) sections d'une liaison, dans l'ordre du tracé.
export function posesTroncons(niveau: Niveau, cle: string, coudes: LiaisonWaypoint[]): PoseTroncon[] {
  const poses: PoseTroncon[] = coudes.map(c => c.poseType ?? "encastre");
  poses.push(niveau.poseFinLiaison?.[cle] ?? "encastre");
  return poses;
}

// Hauteur (cm) de chacune des (coudes + 1) sections, ou undefined = non réglée (le câble court alors à la hauteur du coude, sinon à la hauteur de gaine par défaut).
export function hauteursTroncons(niveau: Niveau, cle: string, coudes: LiaisonWaypoint[]): (number | undefined)[] {
  const h: (number | undefined)[] = coudes.map(c => c.hauteurSection);
  h.push(niveau.hauteurFinLiaison?.[cle]);
  return h;
}

// Appareillages dont la section de circuit qui les touche est apparente : ils sont alors montés en saillie, avec
// goulotte (vue 3D). Renvoie, pour chacun, la hauteur (m) jusqu'où monte la goulotte = hauteur de course de cette
// section (la même que celle du câble tracé), pour que boîtier, goulotte et câble coïncident.
export function appareillagesEnPoseApparente(
  niveau: Niveau, appareils: AppareillagePlace[], resultat: ResultatGeneration | null, hauteurGaine: number,
): Map<number, number> {
  const res = new Map<number, number>();
  const origine = origineCircuits(niveau);
  if (!resultat || !origine) return res;
  const parCircuit = new Map<number, AppareillagePlace[]>();
  appareils.forEach(a => {
    if (a.circuitId == null) return;
    parCircuit.set(a.circuitId, [...(parCircuit.get(a.circuitId) ?? []), a]);
  });
  const ids = new Set(appareils.map(a => String(a.id)));
  const parId = new Map(appareils.map(a => [String(a.id), a] as const));
  const hauteurAncre = (id: string): number => { const a = parId.get(id); return a ? hauteurAppareilM(a) : hauteurGaine; };
  parCircuit.forEach((points, circuitId) => {
    const breaker = resultat.breakers.find(b => b.id === circuitId);
    if (!breaker) return;
    const segmentsCircuit = segmentsPourCircuit(breaker, points, niveau, origine);
    const hauteurDefaut = hauteurDefautLiaison(breaker, segmentsCircuit, hauteurAncre, hauteurGaine);
    segmentsCircuit.forEach(seg => {
      if (seg.type === "domotique") return; // liaison sans fil : aucune goulotte
      const cle = cleSegmentLiaison(seg.aId, seg.bId);
      const coudes = coudesSegment(niveau, seg);
      const poses = posesTroncons(niveau, cle, coudes);
      const hauteurs = hauteursTroncons(niveau, cle, coudes);
      const entrees = coudes.map(c => ({ point: c.point, hauteurCm: c.hauteur, hauteurMiniCm: c.hauteurMini }));
      if (poses[0] === "apparent" && ids.has(seg.aId)) {
        res.set(Number(seg.aId), Math.max(res.get(Number(seg.aId)) ?? 0, hauteurCourseSection(0, entrees, hauteurs, hauteurDefaut(seg))));
      }
      const dernier = poses.length - 1;
      if (poses[dernier] === "apparent" && ids.has(seg.bId)) {
        res.set(Number(seg.bId), Math.max(res.get(Number(seg.bId)) ?? 0, hauteurCourseSection(dernier, entrees, hauteurs, hauteurDefaut(seg))));
      }
    });
  });
  return res;
}

// ─── POSE PAR PARTIES DU CIRCUIT ─────────────────────────────────────────────────────────────────────
// Choisir librement une partie du circuit (de A à B, sur une ou plusieurs liaisons, avec ou sans coude) et dire si elle est
// apparente ou encastrée : les points A et B coupent le tracé à l'endroit cliqué (un coude est ajouté, qui garde la pose et la
// hauteur de la section coupée), puis toutes les sections entre A et B prennent la pose choisie.

interface PolyLiaison { seg: SegmentCircuit; cle: string; pts: Point[]; poses: PoseTroncon[]; hauts: (number | undefined)[]; meta: ({ id: number; hauteur?: number; hauteurMini?: number } | null)[] }

const dPtSeg = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return { d: Math.hypot(p.x - proj.x, p.y - proj.y), t, proj };
};

function polyDe(niveau: Niveau, seg: SegmentCircuit): PolyLiaison {
  const cle = cleSegmentLiaison(seg.aId, seg.bId);
  const coudes = coudesSegment(niveau, seg);
  const poses = posesTroncons(niveau, cle, coudes);
  const hauts = hauteursTroncons(niveau, cle, coudes);
  return {
    seg, cle, pts: [seg.aPoint, ...coudes.map(c => c.point), seg.bPoint], poses: [...poses], hauts: [...hauts],
    meta: [null, ...coudes.map(c => ({ id: c.id, hauteur: c.hauteur, hauteurMini: c.hauteurMini })), null],
  };
}

/** Coupe la liaison au point (déjà sur son tracé) situé dans la section k. Renvoie l'indice du point inséré. */
function couperPoly(pl: PolyLiaison, k: number, p: Point, nouvelId: () => number): number {
  pl.pts.splice(k + 1, 0, p);
  pl.meta.splice(k + 1, 0, { id: nouvelId(), ...(pl.meta[k + 1]?.hauteurMini != null ? { hauteurMini: pl.meta[k + 1]!.hauteurMini } : {}) });
  pl.poses.splice(k, 0, pl.poses[k]);
  pl.hauts.splice(k, 0, pl.hauts[k]);
  return k + 1;
}

/** Point de la liaison le plus proche de `m` : section, projection, distance. */
function plusProchePoly(pl: PolyLiaison, m: Point) {
  let best = { k: 0, proj: pl.pts[0], d: Infinity };
  for (let k = 0; k < pl.pts.length - 1; k++) {
    const r = dPtSeg(m, pl.pts[k], pl.pts[k + 1]);
    if (r.d < best.d) best = { k, proj: r.proj, d: r.d };
  }
  return best;
}

const memePt = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.02;

/** Indice du point de coupure pour `proj` dans la section k (réutilise un point existant s'il est tout proche). */
function pointDeCoupure(pl: PolyLiaison, k: number, proj: Point, nouvelId: () => number): number {
  if (memePt(proj, pl.pts[k])) return k;
  if (memePt(proj, pl.pts[k + 1])) return k + 1;
  return couperPoly(pl, k, proj, nouvelId);
}

function ecrirePoly(n: Niveau, pl: PolyLiaison): Niveau {
  const interieurs = pl.pts.slice(1, -1).map((point, i) => {
    const m = pl.meta[i + 1];
    const pose = pl.poses[i];
    return {
      id: m?.id ?? 0, point,
      ...(m?.hauteur != null ? { hauteur: m.hauteur } : {}),
      ...(m?.hauteurMini != null ? { hauteurMini: m.hauteurMini } : {}),
      ...(pose === "apparent" ? { poseType: "apparent" as const } : {}),
      ...(pl.hauts[i] != null ? { hauteurSection: pl.hauts[i] } : {}),
    };
  });
  const fin = { ...(n.poseFinLiaison ?? {}) };
  const dernier = pl.poses[pl.poses.length - 1];
  if (dernier === "apparent") fin[pl.cle] = "apparent"; else delete fin[pl.cle];
  const hFin = { ...(n.hauteurFinLiaison ?? {}) };
  const hd = pl.hauts[pl.hauts.length - 1];
  if (hd != null) hFin[pl.cle] = hd; else delete hFin[pl.cle];
  return {
    ...n,
    liaisonWaypoints: { ...(n.liaisonWaypoints ?? {}), [pl.cle]: interieurs },
    poseFinLiaison: fin, hauteurFinLiaison: hFin,
  };
}

/**
 * Applique `pose` à la partie du circuit comprise entre les points cliqués A et B (n'importe où sur le tracé).
 * segments = tracé du circuit (segmentsPourCircuit). Renvoie le niveau mis à jour (ou tel quel si le tracé est vide).
 */
export function appliquerPoseEntre(
  niveau: Niveau, segments: SegmentCircuit[], A: Point, B: Point, pose: PoseTroncon, nouvelId: () => number,
): Niveau {
  const utiles = segments.filter(s => s.type !== "domotique");
  if (utiles.length === 0) return niveau;
  const polys = utiles.map(s => polyDe(niveau, s));
  const proche = (m: Point) => {
    let bi = 0, bd = Infinity, br = plusProchePoly(polys[0], m);
    polys.forEach((pl, i) => { const r = plusProchePoly(pl, m); if (r.d < bd) { bd = r.d; bi = i; br = r; } });
    return { i: bi, ...br };
  };
  const pa = proche(A), pb = proche(B);
  const longueur = (pl: PolyLiaison, de: number, a: number) => { let l = 0; for (let k = de; k < a; k++) l += Math.hypot(pl.pts[k + 1].x - pl.pts[k].x, pl.pts[k + 1].y - pl.pts[k].y); return l; };
  const poser = (pl: PolyLiaison, i0: number, i1: number) => { for (let k = Math.min(i0, i1); k < Math.max(i0, i1); k++) pl.poses[k] = pose; };

  if (pa.i === pb.i) {
    const pl = polys[pa.i];
    // Couper d'abord le point le plus loin sur le tracé, pour ne pas décaler l'indice de l'autre.
    const ordre = pa.k < pb.k || (pa.k === pb.k && memeOrdre(pl.pts[pa.k], pa.proj, pb.proj));
    const [premier, second] = ordre ? [pa, pb] : [pb, pa];
    // On coupe d'abord le point le plus loin sur le tracé, pour ne pas décaler l'indice de l'autre.
    pointDeCoupure(pl, second.k, second.proj, nouvelId);
    pointDeCoupure(pl, premier.k, premier.proj, nouvelId);
    const idx = (pt: Point) => pl.pts.findIndex(q => memePt(q, pt));
    poser(pl, idx(premier.proj), idx(second.proj));
    return ecrirePoly(niveau, pl);
  }

  // Liaisons différentes : plus court chemin (par la longueur) entre une extrémité de A et une extrémité de B.
  const ext = (i: number) => [utiles[i].aId, utiles[i].bId];
  const dijkstra = (depart: string) => {
    const dist = new Map<string, number>([[depart, 0]]), prev = new Map<string, number>(), vu = new Set<string>();
    for (;;) {
      let u: string | null = null;
      dist.forEach((d, k) => { if (!vu.has(k) && (u == null || d < dist.get(u)!)) u = k; });
      if (u == null) break;
      vu.add(u);
      utiles.forEach((s, i) => {
        const l = longueur(polys[i], 0, polys[i].pts.length - 1);
        const [x, y] = s.aId === u ? [s.aId, s.bId] : s.bId === u ? [s.bId, s.aId] : [null, null];
        if (x == null || y == null) return;
        if (dist.get(u!)! + l < (dist.get(y) ?? Infinity)) { dist.set(y, dist.get(u!)! + l); prev.set(y, i); }
      });
    }
    return { dist, prev };
  };
  let meilleur: { xa: string; xb: string; cout: number; dj: ReturnType<typeof dijkstra> } | null = null;
  ext(pa.i).forEach(xa => {
    const dj = dijkstra(xa);
    ext(pb.i).forEach(xb => {
      const cout = dj.dist.get(xb);
      if (cout != null && (!meilleur || cout < meilleur.cout)) meilleur = { xa, xb, cout, dj };
    });
  });
  const m = meilleur as { xa: string; xb: string; cout: number; dj: ReturnType<typeof dijkstra> } | null;
  const plA = polys[pa.i], plB = polys[pb.i];
  const iA = pointDeCoupure(plA, pa.k, pa.proj, nouvelId), iB = pointDeCoupure(plB, pb.k, pb.proj, nouvelId);
  if (!m) { // liaisons non connectées : chaque morceau, jusqu'à l'extrémité la plus proche
    poser(plA, iA, plA.pts.length - 1); poser(plB, 0, iB);
  } else {
    if (m.xa === plA.seg.aId) poser(plA, 0, iA); else poser(plA, iA, plA.pts.length - 1);
    if (m.xb === plB.seg.aId) poser(plB, 0, iB); else poser(plB, iB, plB.pts.length - 1);
    // Liaisons intermédiaires, entières.
    for (let cur = m.xb; cur !== m.xa;) {
      const i = m.dj.prev.get(cur);
      if (i == null) break;
      if (i !== pa.i && i !== pb.i) poser(polys[i], 0, polys[i].pts.length - 1);
      cur = utiles[i].aId === cur ? utiles[i].bId : utiles[i].aId;
    }
  }
  let res = niveau;
  polys.forEach((pl, i) => { if (i === pa.i || i === pb.i || pl.poses.some((p, k) => p !== posesTroncons(niveau, pl.cle, coudesSegment(niveau, pl.seg))[k])) res = ecrirePoly(res, pl); });
  return res;
}

// A est-il avant B sur la même section orientée (depuis son départ) ?
const memeOrdre = (depart: Point, a: Point, b: Point) => Math.hypot(a.x - depart.x, a.y - depart.y) <= Math.hypot(b.x - depart.x, b.y - depart.y);


// ─── REMISE AU PROPRE DES TRACÉS DÉJÀ ENREGISTRÉS ────────────────────────────────────────────────────────────
// Les circuits créés avant le tracé « dans les murs » ont des coudes figés (obliques, petits décrochements). Une seule fois par niveau
// (Niveau.tracesMurs), tout tracé dont une portion n'est PARALLÈLE (ou perpendiculaire) À AUCUN MUR est refait dans les murs ; la pose
// (apparent / encastré) et les hauteurs de chaque partie sont reportées sur les nouvelles sections. Les circuits verrouillés ne bougent pas.
function anglesMurs(niveau: Niveau): number[] {
  const res: number[] = [];
  niveau.pieces.forEach(pc => pc.contour.forEach((p, i) => { const q = pc.contour[(i + 1) % pc.contour.length]; if (Math.hypot(q.x - p.x, q.y - p.y) > 0.05) res.push(Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI); }));
  return res;
}
function tracePropre(pts: Point[], murs: number[]): boolean {
  for (let k = 0; k + 1 < pts.length; k++) {
    const p = pts[k], q = pts[k + 1], l = Math.hypot(q.x - p.x, q.y - p.y);
    if (l < 1e-6) continue;
    if (l < 0.03 && k > 0 && k + 2 < pts.length) return false;    // petit décrochement (les raccords courts aux appareils sont normaux)
    const ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
    const ok = murs.some(w => { const d = ((((ang - w) % 90) + 90) % 90); return Math.min(d, 90 - d) < 0.5; });
    if (!ok) return false;                                         // oblique alors qu'aucun mur ne l'est
  }
  return true;
}

export function reconformerTracesNiveau(niveau: Niveau, resultat: ResultatGeneration | null): Niveau {
  if (niveau.tracesMurs === 3) return niveau;
  let n: Niveau = { ...niveau, tracesMurs: 3 };
  const origine = origineCircuits(niveau);
  if (!resultat || !origine) return n;
  const murs = anglesMurs(niveau);
  const verrous = new Set(niveau.circuitsVerrouilles ?? []);
  const parCircuit = new Map<number, AppareillagePlace[]>();
  niveau.pieces.flatMap(p => p.appareillages).forEach(a => { if (a.circuitId != null) parCircuit.set(a.circuitId, [...(parCircuit.get(a.circuitId) ?? []), a]); });
  parCircuit.forEach((points, circuitId) => {
    const breaker = resultat.breakers.find(b => b.id === circuitId);
    if (!breaker || verrous.has(breaker.label)) return;
    segmentsPourCircuit(breaker, points, niveau, origine).forEach(seg => {
      if (seg.type === "domotique") return;
      const cle = cleSegmentLiaison(seg.aId, seg.bId);
      if ((n.liaisonWaypoints?.[cle] ?? []).length === 0) return;
      const ancien = polyDe(n, seg);
      let coudes: LiaisonWaypoint[];
      if (tracePropre(ancien.pts, murs)) {
        // géométrie correcte : on ne change que les passages de portes / fenêtres (hauteur mini), s'il y en a
        if (ancien.meta.some(m => m?.hauteurMini != null)) return;
        const avecPortes = portesSurTrace(ancien.pts, n.pieces);
        if (!avecPortes) return;
        coudes = avecPortes.map((w, i) => ({ id: -(i + 1), point: w.point, ...(w.hauteurMini != null ? { hauteurMini: w.hauteurMini } : {}) }));
      } else {
        // nouveau tracé : le routage automatique (sans coudes figés)
        const { [cle]: _retire, ...reste } = n.liaisonWaypoints ?? {};
        coudes = coudesSegment({ ...n, liaisonWaypoints: reste }, seg);
      }
      const pts = [seg.aPoint, ...coudes.map(c => c.point), seg.bPoint];
      const sectionAncienne = (m: Point) => plusProchePoly(ancien, m).k;
      const poses: PoseTroncon[] = [], hauts: (number | undefined)[] = [];
      for (let k = 0; k + 1 < pts.length; k++) {
        const kk = sectionAncienne({ x: (pts[k].x + pts[k + 1].x) / 2, y: (pts[k].y + pts[k + 1].y) / 2 });
        poses.push(ancien.poses[kk] ?? "encastre");
        hauts.push(ancien.hauts[kk] ?? ancien.meta[kk + 1]?.hauteur ?? ancien.meta[kk]?.hauteur);
      }
      const nouveau: PolyLiaison = { seg, cle, pts, poses, hauts, meta: [null, ...coudes.map(c => ({ id: uidMaison(), ...(c.hauteurMini != null ? { hauteurMini: c.hauteurMini } : {}) })), null] };
      n = ecrirePoly(n, nouveau);
    });
  });
  return n;
}
