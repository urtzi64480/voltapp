// src/lib/gaines-attente.ts
//
// Gaines EN ATTENTE : une gaine (pré-câblée ou non) part du tableau (ou du point d'arrivée des gaines du niveau) et aboutit à un obturateur
// posé au mur, pour un circuit futur. Elle n'est pas raccordée au tableau. Tracé : le même routage que les circuits (dans les murs, parallèle
// aux murs…). Longueurs : course horizontale + montée / descente (hauteur de gaine du niveau).

import { gaineRecommandee } from "./electrical-constants";
import { creerContexteLongueurs } from "./longueurs-circuits";
import { coudesSegment } from "./routage-circuits";
import { origineCircuits, type GaineAttente, type Niveau, type Point } from "./maison-types";

export const SECTIONS_ATTENTE = ["1.5", "2.5", "4.0", "6.0", "10.0"];
export const HAUTEUR_ATTENTE_DEFAUT_CM = 30;
export const libelleSection = (s: string): string => s.replace(".", ",").replace(/,0$/, "");

/** Valeurs par défaut d'une nouvelle gaine en attente. */
export function nouvelleGaineAttente(niveau: Niveau, id: string, point: Point, precable: boolean, section: string): GaineAttente {
  const n = (niveau.gainesAttente ?? []).length + 1;
  return { id, nom: `Attente ${n}`, point, precable, section };
}

/** Chemin tracé sur le plan : origine, coudes éventuels, extrémité. null sans origine (ni tableau ni point d'arrivée des gaines). */
export function cheminGaineAttente(niveau: Niveau, g: GaineAttente): Point[] | null {
  const origine = origineCircuits(niveau);
  if (!origine) return null;
  const coudes = coudesSegment(niveau, { aId: "tableau", aPoint: origine, bId: `attente-${g.id}`, bPoint: g.point }).map(c => c.point);
  return [origine, ...coudes, g.point];
}

export interface LongueursAttente { horizontaleM: number; verticaleM: number; totaleM: number }

/** Longueur réelle : course horizontale + montée du tableau à la hauteur de gaine + descente jusqu'à l'obturateur. */
export function longueursGaineAttente(niveau: Niveau, g: GaineAttente): LongueursAttente | null {
  const chemin = cheminGaineAttente(niveau, g);
  if (!chemin) return null;
  let h = 0;
  for (let i = 1; i < chemin.length; i++) h += Math.hypot(chemin[i].x - chemin[i - 1].x, chemin[i].y - chemin[i - 1].y);
  const ctx = creerContexteLongueurs(niveau);
  const hObt = (g.hauteurCm ?? HAUTEUR_ATTENTE_DEFAUT_CM) / 100;
  const v = Math.abs(ctx.hauteurGaine - ctx.hauteurOrigine) + Math.abs(ctx.hauteurGaine - hObt);
  return { horizontaleM: h, verticaleM: v, totaleM: h + v };
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
