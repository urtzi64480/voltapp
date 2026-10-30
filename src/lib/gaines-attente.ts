// src/lib/gaines-attente.ts
//
// Gaines EN ATTENTE : une gaine (pré-câblée ou non) part du tableau (ou du point d'arrivée des gaines du niveau) et aboutit à un obturateur
// posé au mur, pour un circuit futur. Elle n'est pas raccordée au tableau. Tracé : celui d'un circuit (routage dans les murs, coudes posés à la main, poses encastrée / apparente par
// section). Longueurs : le calcul d'un circuit (tracerLiaison : course horizontale + montées / descentes).

import { gaineRecommandee } from "./electrical-constants";
import { creerContexteLongueurs, hauteurAncreFn, tracerLiaison, type ContexteLongueurs } from "./longueurs-circuits";
import { coudesSegment } from "./routage-circuits";
import { cleSegmentLiaison, distanceAuSegment, origineCircuits, trouverPiece, type GaineAttente, type Niveau, type Point, type SegmentCircuit } from "./maison-types";

export const SECTIONS_ATTENTE = ["1.5", "2.5", "4.0", "6.0", "10.0"];
export const HAUTEUR_ATTENTE_DEFAUT_CM = 30;
export const libelleSection = (s: string): string => s.replace(".", ",").replace(/,0$/, "");

/** Valeurs par défaut d'une nouvelle gaine en attente. */
/** Un point est « à l'extérieur » s'il n'est dans aucune pièce ET à plus de 0,5 m de tout mur (un point sur la face d'un mur reste « au mur »). */
export function estPointExterieur(niveau: Niveau, point: Point): boolean {
  if (niveau.pieces.length === 0) return false;
  if (trouverPiece(point, niveau.pieces)) return false;
  return niveau.pieces.every(p => p.contour.every((a, i) => distanceAuSegment(point, a, p.contour[(i + 1) % p.contour.length]) > 0.5));
}

export function nouvelleGaineAttente(niveau: Niveau, id: string, point: Point, precable: boolean, section: string): GaineAttente {
  const n = (niveau.gainesAttente ?? []).length + 1;
  return { id, nom: `Attente ${n}`, point, precable, section, ...(estPointExterieur(niveau, point) ? { exterieur: true } : {}) };
}

/** Clé de liaison de la gaine en attente (coudes posés à la main, poses et hauteurs des sections : même stockage que les circuits). */
export const cleGaineAttente = (g: Pick<GaineAttente, "id">): string => cleSegmentLiaison("tableau", `attente-${g.id}`);

/** Liaison « tableau → obturateur », au même format qu'un segment de circuit. null sans origine (ni tableau ni point d'arrivée des gaines). */
export function segmentGaineAttente(niveau: Niveau, g: GaineAttente): SegmentCircuit | null {
  const origine = origineCircuits(niveau);
  if (!origine) return null;
  return { aId: "tableau", aPoint: origine, bId: `attente-${g.id}`, bPoint: g.point };
}

export const hauteurObturateurM = (g: GaineAttente): number => (g.hauteurCm ?? HAUTEUR_ATTENTE_DEFAUT_CM) / 100;

/** Hauteur (m) de chaque ancre de la liaison : le tableau (ou la gaine si un point d'arrivée est configuré) au départ, l'obturateur à l'arrivée. */
export function hauteurAncreAttente(ctx: ContexteLongueurs, g: GaineAttente): (id: string) => number {
  const base = hauteurAncreFn(ctx);
  return id => (id === `attente-${g.id}` ? hauteurObturateurM(g) : base(id));
}

/** Chemin tracé sur le plan : origine, coudes éventuels (posés à la main, sinon routage dans les murs comme un circuit), extrémité. */
export function cheminGaineAttente(niveau: Niveau, g: GaineAttente): Point[] | null {
  const seg = segmentGaineAttente(niveau, g);
  if (!seg) return null;
  return [seg.aPoint, ...coudesSegment(niveau, seg).map(c => c.point), seg.bPoint];
}

export interface LongueursAttente {
  horizontaleM: number; verticaleM: number; totaleM: number;
  /** Part posée en APPARENT (moulure / gaine IRL) et part ENCASTRÉE, en m (somme = totaleM). */
  apparentM: number; encastreM: number;
  /** Longueur 3D de chaque section du tracé (coudes + 1), comme les étiquettes d'un circuit. */
  sections: number[];
}

/**
 * Longueur réelle : EXACTEMENT le calcul d'un circuit (longueurs-circuits.ts → tracerLiaison) — course horizontale de chaque section,
 * montées / descentes entre les hauteurs de course, poses encastrée / apparente par section, hauteurs réglées à la main.
 */
export function longueursGaineAttente(niveau: Niveau, g: GaineAttente): LongueursAttente | null {
  const seg = segmentGaineAttente(niveau, g);
  if (!seg) return null;
  const ctx = creerContexteLongueurs(niveau);
  // Éclairage : hauteur de course par défaut = hauteur de gaine (pas de règle « prises en chaîne » pour une gaine en attente).
  const { jambes, sections } = tracerLiaison(ctx, { circuit: "lumiere" }, [seg], seg, hauteurAncreAttente(ctx, g));
  let horizontaleM = 0, verticaleM = 0, apparentM = 0;
  jambes.forEach(j => {
    const h = Math.hypot(j.b.x - j.a.x, j.b.z - j.a.z), v = Math.abs(j.b.y - j.a.y);
    horizontaleM += h; verticaleM += v;
    if (j.pose === "apparent") apparentM += h + v;
  });
  const totaleM = horizontaleM + verticaleM;
  return { horizontaleM, verticaleM, totaleM, apparentM, encastreM: totaleM - apparentM, sections };
}

export interface GaineDeAttente {
  /** Code catalogue (sous-catégorie du pré-devis) : gaine ICTA seule, ou gaine précâblée. */
  code: string;
  libelle: string;
  /** Gaine ICTA retenue pour cette section (3 conducteurs), ex. « ICTA 20 ». */
  gaine: string;
}

export function gaineDeAttente(g: GaineAttente): GaineDeAttente {
  const s = SECTIONS_ATTENTE.includes(g.section) ? g.section : "2.5";
  const gr = gaineRecommandee([s, s, s]);
  const diam = gr.gaine.replace(/\D/g, "");
  return g.precable
    ? { code: `gaine_precablee_3g${s}`, libelle: `Gaine ICTA précâblée 3G${libelleSection(s)} (attente)`, gaine: gr.gaine }
    : { code: `gaine_icta${diam}`, libelle: `Gaine ${gr.gaine} (attente, câble 3G${libelleSection(s)} à tirer)`, gaine: gr.gaine };
}
