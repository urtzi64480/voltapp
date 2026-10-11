// src/lib/couleurs-fils.ts
//
// COULEURS DES FILS — source unique pour le plan, l'impression et la vue 3D. Elles ne dépendent JAMAIS de la couleur du circuit
// (celle-ci ne sert qu'à teinter les appareillages et à repérer un circuit) :
//   terre jaune / vert · phase rouge · neutre bleu · retour violet · navette orange
import type { SegmentCircuit } from "@/lib/maison-types";

export const COULEUR_FIL = {
  phase: "#dc2626",
  neutre: "#0ea5e9",
  terreVert: "#16a34a",
  terreJaune: "#facc15",
  retour: "#7e22ce",
  navette: "#f97316",
} as const;

export type NatureLiaison = "alimentation" | "retour" | "navette" | "navette_neutre";
export type RoleConducteur = "phase" | "neutre" | "terre" | "retour" | "navette";

export interface Conducteur { role: RoleConducteur; libelle: string }

/** Nature d'un segment de tracé (les segments domotiques n'ont pas de fil : à traiter avant). */
export const natureLiaison = (seg: Pick<SegmentCircuit, "type" | "neutre">): NatureLiaison =>
  seg.type === "navette" ? (seg.neutre ? "navette_neutre" : "navette") : seg.type === "retour" ? "retour" : "alimentation";

/** Conducteurs d'un câble 3 G, dans l'ordre d'affichage (de gauche à droite, vu dans le sens du tracé). */
export const CONDUCTEURS: Record<NatureLiaison, Conducteur[]> = {
  alimentation: [{ role: "neutre", libelle: "Neutre" }, { role: "phase", libelle: "Phase" }, { role: "terre", libelle: "Terre" }],
  retour: [{ role: "neutre", libelle: "Neutre" }, { role: "retour", libelle: "Retour" }, { role: "terre", libelle: "Terre" }],
  navette: [{ role: "navette", libelle: "Navette 1" }, { role: "navette", libelle: "Navette 2" }, { role: "terre", libelle: "Terre" }],
  // Le neutre de la lampe traverse les commandes : il suit donc aussi le câble de navette.
  navette_neutre: [{ role: "neutre", libelle: "Neutre" }, { role: "navette", libelle: "Navette 1" }, { role: "navette", libelle: "Navette 2" }, { role: "terre", libelle: "Terre" }],
};

export const couleurConducteur = (role: RoleConducteur): string =>
  role === "terre" ? COULEUR_FIL.terreVert : COULEUR_FIL[role];

export const LIBELLE_NATURE: Record<NatureLiaison, string> = {
  alimentation: "Alimentation / circuit", retour: "Retour (commande → lampe)", navette: "Navette (entre va-et-vient)", navette_neutre: "Navette + neutre (entre va-et-vient)",
};

/** Légende : couleur de chaque fil. */
export const LEGENDE_FILS: { libelle: string; couleur: string; terre?: boolean }[] = [
  { libelle: "Phase", couleur: COULEUR_FIL.phase },
  { libelle: "Neutre", couleur: COULEUR_FIL.neutre },
  { libelle: "Terre", couleur: COULEUR_FIL.terreVert, terre: true },
  { libelle: "Retour", couleur: COULEUR_FIL.retour },
  { libelle: "Navette", couleur: COULEUR_FIL.navette },
];

export interface TraitFil { decalage: number; couleur: string; couleur2?: string }

/**
 * Traits parallèles représentant un câble : un trait par conducteur, décalés perpendiculairement au tracé (en pixels).
 * `ecart` = distance entre les axes de deux traits voisins. La terre porte deux couleurs (vert + jaune en pointillés par-dessus).
 */
export function traitsCable(nature: NatureLiaison, ecart: number): TraitFil[] {
  const c = CONDUCTEURS[nature];
  return c.map((cond, i) => ({
    decalage: (i - (c.length - 1) / 2) * ecart,
    couleur: couleurConducteur(cond.role),
    ...(cond.role === "terre" ? { couleur2: COULEUR_FIL.terreJaune } : {}),
  }));
}

export interface TraitGeo { x1: number; y1: number; x2: number; y2: number; couleur: string; couleur2?: string }

/** Géométrie (en pixels) des traits parallèles d'un câble entre deux points — partagée par l'écran et l'impression. */
export function geometrieCable(a: { x: number; y: number }, b: { x: number; y: number }, nature: NatureLiaison, ecart: number): TraitGeo[] {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  return traitsCable(nature, ecart).map(t => ({
    x1: a.x + nx * t.decalage, y1: a.y + ny * t.decalage, x2: b.x + nx * t.decalage, y2: b.y + ny * t.decalage,
    couleur: t.couleur, ...(t.couleur2 ? { couleur2: t.couleur2 } : {}),
  }));
}

/** Couleur dominante d'un câble (pastilles d'extrémité, étiquettes) : phase, retour ou navette. */
export const couleurDominante = (nature: NatureLiaison): string =>
  nature === "navette" || nature === "navette_neutre" ? COULEUR_FIL.navette : nature === "retour" ? COULEUR_FIL.retour : COULEUR_FIL.phase;
