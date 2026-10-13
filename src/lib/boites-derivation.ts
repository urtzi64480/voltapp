// src/lib/boites-derivation.ts
//
// BOÎTES DE DÉRIVATION POSÉES SUR UN TRONÇON : n'importe quel tronçon d'un circuit, celui que l'on désigne — jamais « le premier ».
//
// Le tronçon visé est le plus proche du clic mesuré sur le CHEMIN RÉEL du câble (coudes compris, voir coudesSegment), pas sur la corde
// droite entre ses deux extrémités : un câble qui contourne une pièce passe loin de sa corde, et le clic sur le tracé visible désignait
// un autre tronçon (le plus souvent le premier de la liste). La boîte est ensuite posée SUR le tracé (projection du clic), et les coudes
// déjà posés à la main sur le tronçon sont répartis de part et d'autre : le câble A → boîte → B suit exactement le chemin d'origine.

import type { BoiteDerivation, LiaisonWaypoint, Niveau, Point, PoseTroncon, SegmentCircuit } from "./maison-types";
import { cleSegmentLiaison } from "./maison-types";
import { coudesSegment } from "./routage-circuits";

export type TypeTroncon = NonNullable<NonNullable<BoiteDerivation["surSegment"]>["type"]>;

/** Genre d'un tronçon : alimentation / circuit (SegmentCircuit.type absent), navette, retour ou ligne de commande. */
export function typeTroncon(sg: Pick<SegmentCircuit, "type">): TypeTroncon {
  return sg.type === "navette" || sg.type === "retour" || sg.type === "commande" ? sg.type : "alim";
}
const PRIORITE: Record<TypeTroncon, number> = { alim: 0, navette: 1, retour: 2, commande: 3 };

/** Chemin réel d'un tronçon : extrémité A, coudes (manuels, sinon tracé automatique), extrémité B. */
export function cheminReel(niveau: Niveau, sg: SegmentCircuit): Point[] {
  return [sg.aPoint, ...coudesSegment(niveau, sg).map(w => w.point), sg.bPoint];
}

export interface TronconVise {
  segment: SegmentCircuit;
  /** Point du chemin le plus proche du clic (la boîte se pose ici, SUR le câble). */
  point: Point;
  distance: number;
  /** Indice, dans le chemin réel, de la section qui porte le point (0 = entre A et le 1er coude). */
  section: number;
}

/** Tronçon le plus proche de `clic`, mesuré sur son chemin réel. Les liaisons sans fil et les tronçons de longueur nulle sont ignorés. */
export function tronconLePlusProche(clic: Point, segments: SegmentCircuit[], niveau: Niveau): TronconVise | null {
  let res: TronconVise | null = null;
  segments.forEach(sg => {
    if (sg.type === "domotique") return;
    const chemin = cheminReel(niveau, sg);
    let longueur = 0;
    for (let i = 0; i + 1 < chemin.length; i++) longueur += Math.hypot(chemin[i + 1].x - chemin[i].x, chemin[i + 1].y - chemin[i].y);
    if (longueur < 1e-6) return;
    for (let i = 0; i + 1 < chemin.length; i++) {
      const a = chemin[i], b = chemin[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      if (l2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((clic.x - a.x) * dx + (clic.y - a.y) * dy) / l2));
      const q = { x: a.x + t * dx, y: a.y + t * dy };
      const d = Math.hypot(clic.x - q.x, clic.y - q.y);
      // À égalité de distance (câbles superposés), l'alimentation passe avant la navette, le retour, puis la ligne de commande.
      const meilleur = !res || d < res.distance - 1e-6 || (Math.abs(d - res.distance) <= 1e-6 && PRIORITE[typeTroncon(sg)] < PRIORITE[typeTroncon(res.segment)]);
      if (meilleur) res = { segment: sg, point: q, distance: d, section: i };
    }
  });
  return res;
}

/**
 * Pose une boîte sur le tronçon désigné par `clic` : renvoie le niveau mis à jour (boîte ajoutée au circuit `label`, coudes / poses /
 * hauteurs du tronçon répartis entre les deux moitiés) et la boîte créée. Sans tronçon (circuit sans tracé), la boîte est posée au clic,
 * « en étoile ».
 */
export function poserBoiteSurTroncon(
  niveau: Niveau, segments: SegmentCircuit[], label: string, clic: Point, idBoite: number,
): { niveau: Niveau; boite: BoiteDerivation } {
  const existantes = niveau.boitesDerivation?.[label] ?? [];
  const vise = tronconLePlusProche(clic, segments, niveau);
  const nom = `Boîte ${existantes.length + 1}`;
  if (!vise) {
    const boite: BoiteDerivation = { id: idBoite, nom, point: clic };
    return { niveau: { ...niveau, boitesDerivation: { ...(niveau.boitesDerivation ?? {}), [label]: [...existantes, boite] } }, boite };
  }
  const sg = vise.segment, idB = `boite-${idBoite}`;
  const boite: BoiteDerivation = { id: idBoite, nom, point: vise.point, surSegment: { a: sg.aId, b: sg.bId, type: typeTroncon(sg) } };

  // Répartition des réglages du tronçon A → B entre A → boîte et boîte → B.
  const cleAB = cleSegmentLiaison(sg.aId, sg.bId);
  const wps: LiaisonWaypoint[] = niveau.liaisonWaypoints?.[cleAB] ?? [];
  let liaisonWaypoints = niveau.liaisonWaypoints, poseFinLiaison = niveau.poseFinLiaison, hauteurFinLiaison = niveau.hauteurFinLiaison;
  const cleAboite = cleSegmentLiaison(sg.aId, idB), cleBoiteB = cleSegmentLiaison(idB, sg.bId);
  if (wps.length > 0 || poseFinLiaison?.[cleAB] != null || hauteurFinLiaison?.[cleAB] != null) {
    // Avec des coudes manuels, la section visée est celle d'indice `section` (elle aboutit au coude `section`, ou à B s'il n'y en a plus).
    const i = Math.min(vise.section, wps.length);
    const avant = wps.slice(0, i), apres = wps.slice(i);
    const aboutit: LiaisonWaypoint | undefined = wps[i];
    const poseFinOrig: PoseTroncon | undefined = poseFinLiaison?.[cleAB];
    const hautFinOrig: number | undefined = hauteurFinLiaison?.[cleAB];
    const omit = <T,>(r: Record<string, T> | undefined, cle: string): Record<string, T> | undefined => {
      if (!r || !(cle in r)) return r;
      const { [cle]: _supprime, ...reste } = r; void _supprime;
      return reste;
    };
    liaisonWaypoints = omit(niveau.liaisonWaypoints, cleAB) ?? {};
    liaisonWaypoints = { ...liaisonWaypoints, ...(avant.length > 0 ? { [cleAboite]: avant } : {}), ...(apres.length > 0 ? { [cleBoiteB]: apres } : {}) };
    // Dernière section de A → boîte : celle qui porte le point, donc la pose / hauteur du coude où elle aboutissait (sinon celles de B).
    const poseAvant = aboutit ? aboutit.poseType : poseFinOrig;
    const hautAvant = aboutit ? aboutit.hauteurSection : hautFinOrig;
    poseFinLiaison = omit(niveau.poseFinLiaison, cleAB);
    hauteurFinLiaison = omit(niveau.hauteurFinLiaison, cleAB);
    if (poseAvant != null) poseFinLiaison = { ...(poseFinLiaison ?? {}), [cleAboite]: poseAvant };
    if (poseFinOrig != null) poseFinLiaison = { ...(poseFinLiaison ?? {}), [cleBoiteB]: poseFinOrig };
    if (hautAvant != null) hauteurFinLiaison = { ...(hauteurFinLiaison ?? {}), [cleAboite]: hautAvant };
    if (hautFinOrig != null) hauteurFinLiaison = { ...(hauteurFinLiaison ?? {}), [cleBoiteB]: hautFinOrig };
  }
  return {
    niveau: {
      ...niveau,
      boitesDerivation: { ...(niveau.boitesDerivation ?? {}), [label]: [...existantes, boite] },
      ...(liaisonWaypoints !== niveau.liaisonWaypoints ? { liaisonWaypoints } : {}),
      ...(poseFinLiaison !== niveau.poseFinLiaison ? { poseFinLiaison } : {}),
      ...(hauteurFinLiaison !== niveau.hauteurFinLiaison ? { hauteurFinLiaison } : {}),
    },
    boite,
  };
}
