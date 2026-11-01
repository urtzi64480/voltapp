// src/lib/entretien.ts — rappel d'entretien annuel : un an après la fin d'un chantier, on propose au client un passage de contrôle.
import { ajouterAnnees } from "./garanties";

export type EtatEntretien = "a_contacter" | "a_venir" | "fait" | "trop_tot";

/** Mois entiers écoulés entre deux dates AAAA-MM-JJ (plancher). */
export function moisEcoules(depuis: string, jusqua: string): number {
  const [y1, m1, d1] = depuis.split("-").map(Number), [y2, m2, d2] = jusqua.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}

/** Date de référence du chantier : réception signée > validation du chantier > dernier paiement d'une facture du devis. */
export function dateReference(o: { reception?: string | null; valideLe?: string | null; paiements?: (string | null | undefined)[] }): string | null {
  const jour = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  const paie = (o.paiements ?? []).map(jour).filter((x): x is string => !!x).sort().pop() ?? null;
  return jour(o.reception) ?? jour(o.valideLe) ?? paie;
}

export function etatEntretien(ref: string, envoyeLe: string | null | undefined, aujourdhui: string): EtatEntretien {
  const m = moisEcoules(ref, aujourdhui);
  if (envoyeLe && moisEcoules(ref, envoyeLe.slice(0, 10)) >= 10) return "fait";
  if (m >= 11) return "a_contacter";
  if (m >= 9) return "a_venir";
  return "trop_tot";
}

export const echeanceEntretien = (ref: string): string => ajouterAnnees(ref, 1);
