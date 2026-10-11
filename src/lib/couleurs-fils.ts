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

// Famille d'une liaison (couleur dominante, étiquettes, atténuation) — la composition EXACTE des fils vient de conducteursSegment().
export type NatureLiaison = "alimentation" | "retour" | "navette" | "commande";
export type RoleConducteur = "phase" | "neutre" | "terre" | "retour" | "navette";

export interface Conducteur { role: RoleConducteur; libelle: string }

type ChampsFils = Pick<SegmentCircuit, "type" | "neutre" | "phase" | "retourTraversant" | "avecRetour" | "voies">;

/** Famille d'un segment de tracé (les segments domotiques n'ont pas de fil : à traiter avant). */
export const natureLiaison = (seg: Pick<SegmentCircuit, "type">): NatureLiaison =>
  seg.type === "navette" ? "navette" : seg.type === "retour" ? "retour" : seg.type === "commande" ? "commande" : "alimentation";

const LETTRES = ["A", "B", "C", "D"];
const N: Conducteur = { role: "neutre", libelle: "Neutre" };
const P: Conducteur = { role: "phase", libelle: "Phase" };
const T: Conducteur = { role: "terre", libelle: "Terre" };
const nomVoie = (i: number, voies: number) => (voies > 1 ? ` (voie ${LETTRES[i] ?? i + 1})` : "");

/**
 * Conducteurs EXACTS d'un câble d'éclairage, dans l'ordre d'affichage (de gauche à droite, vu dans le sens du tracé).
 *  · alimentation               : neutre, phase, terre (+ retour si des commandes sont en parallèle sur la même lampe)
 *  · retour (commande → lampe)  : neutre, retour, terre — le neutre de la lampe traverse la boîte de la commande
 *  · retour (lampe → commande)  : lampe alimentée en bout de chaîne : phase, retour, terre ; un détecteur a en plus besoin du neutre
 *  · navette (amont → aval)     : neutre + 2 fils de navette PAR VOIE + terre (le neutre de la lampe traverse les va-et-vient)
 *  · navette (lampe alimentée)  : 2 fils de navette PAR VOIE + le retour de chaque voie (il repasse par les boîtes) + terre
 *  · commande (boutons-poussoirs d'un télérupteur, en parallèle) : phase + un fil de retour par télérupteur + terre
 * « voies » = nombre de mécanismes distincts qui traversent le câble (un va-et-vient double = 2 voies, de lampes indépendantes).
 */
export function conducteursSegment(seg: ChampsFils): Conducteur[] {
  const voies = Math.max(1, seg.voies ?? 1);
  const parVoie = (fn: (i: number) => Conducteur[]) => Array.from({ length: voies }, (_, i) => fn(i)).flat();
  const nav = parVoie(i => [
    { role: "navette" as const, libelle: `Navette 1${nomVoie(i, voies)}` },
    { role: "navette" as const, libelle: `Navette 2${nomVoie(i, voies)}` },
  ]);
  const ret = (i: number): Conducteur => ({ role: "retour", libelle: `Retour${nomVoie(i, voies)}` });
  if (seg.type === "navette") {
    return [...(seg.neutre ? [N] : []), ...nav, ...(seg.retourTraversant ? parVoie(i => [ret(i)]) : []), T];
  }
  if (seg.type === "commande") return [P, ...parVoie(i => [ret(i)]), T];
  if (seg.type === "retour") {
    if (seg.phase) return seg.neutre ? [N, P, ret(0), T] : [P, ret(0), T];
    return [N, ret(0), T];
  }
  return seg.avecRetour ? [N, P, ret(0), T] : [N, P, T];
}

export const nbConducteurs = (seg: ChampsFils): number => conducteursSegment(seg).length;

export const couleurConducteur = (role: RoleConducteur): string =>
  role === "terre" ? COULEUR_FIL.terreVert : COULEUR_FIL[role];

export const LIBELLE_NATURE: Record<NatureLiaison, string> = {
  alimentation: "Alimentation / circuit", retour: "Retour (commande ↔ lampe)", navette: "Navette (entre va-et-vient)", commande: "Commande (boutons-poussoirs)",
};

/** Libellé précis d'une liaison (schéma technique). */
export function libelleLiaison(seg: ChampsFils): string {
  const voies = seg.voies ?? 1;
  if (seg.type === "navette") return seg.neutre ? `${voies > 1 ? "Navettes doubles" : "Navettes"} + neutre` : `${voies > 1 ? "Navettes doubles" : "Navettes"} + retour`;
  if (seg.type === "commande") return voies > 1 ? "Commande boutons-poussoirs (2 télérupteurs)" : "Commande boutons-poussoirs";
  if (seg.type === "retour") return seg.phase ? (seg.neutre ? "Alimentation détecteur + retour" : "Phase + retour (lampe → commande)") : "Retour commande → lampe";
  return seg.avecRetour ? "Alimentation + retour (commandes en parallèle)" : "Alimentation";
}

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
export function traitsCable(conducteurs: Conducteur[], ecart: number): TraitFil[] {
  const c = conducteurs;
  return c.map((cond, i) => ({
    decalage: (i - (c.length - 1) / 2) * ecart,
    couleur: couleurConducteur(cond.role),
    ...(cond.role === "terre" ? { couleur2: COULEUR_FIL.terreJaune } : {}),
  }));
}

export interface TraitGeo { x1: number; y1: number; x2: number; y2: number; couleur: string; couleur2?: string }

/** Géométrie (en pixels) des traits parallèles d'un câble entre deux points — partagée par l'écran et l'impression. */
export function geometrieCable(a: { x: number; y: number }, b: { x: number; y: number }, conducteurs: Conducteur[], ecart: number): TraitGeo[] {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  return traitsCable(conducteurs, ecart).map(t => ({
    x1: a.x + nx * t.decalage, y1: a.y + ny * t.decalage, x2: b.x + nx * t.decalage, y2: b.y + ny * t.decalage,
    couleur: t.couleur, ...(t.couleur2 ? { couleur2: t.couleur2 } : {}),
  }));
}

/** Couleur dominante d'un câble (pastilles d'extrémité, étiquettes) : phase, retour ou navette. */
export const couleurDominante = (nature: NatureLiaison): string =>
  nature === "navette" ? COULEUR_FIL.navette : nature === "retour" || nature === "commande" ? COULEUR_FIL.retour : COULEUR_FIL.phase;
