// src/lib/remise-facture.ts
//
// Remise accordée sur une facture générée, avant son envoi. Une facture reprend les lignes BRUTES du devis ; total_service / total_materiau sont
// les totaux nets du devis (remises du devis et fidélité déjà déduites). La remise de facture se déduit de leur somme :
//   total_ttc = total_service + total_materiau − remise_facture_montant
// Le Factur-X (facturx.ts) la déclare tout seul en « Remise commerciale » (écart entre la somme des lignes et total_ttc).

import type { Facture } from "@/types";

export type TypeRemiseFacture = "pct" | "eur";

const arrondi2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Total de la facture AVANT remise de facture (sans acomptes). */
export function totalAvantRemiseFacture(f: Pick<Facture, "total_service" | "total_materiau">): number {
  return arrondi2((Number(f.total_service) || 0) + (Number(f.total_materiau) || 0));
}

/** Montant de la remise et nouveau total. % borné à 0–100, € borné à 0–total ; valeur vide / invalide = pas de remise. */
export function calculerRemiseFacture(base: number, type: TypeRemiseFacture, valeur: number): { montant: number; valeurRetenue: number; totalTtc: number } {
  const v = Number.isFinite(valeur) && valeur > 0 ? valeur : 0;
  const valeurRetenue = type === "pct" ? Math.min(v, 100) : Math.min(v, Math.max(0, base));
  const montant = Math.min(Math.max(0, base), type === "pct" ? arrondi2(base * valeurRetenue / 100) : arrondi2(valeurRetenue));
  return { montant, valeurRetenue: arrondi2(valeurRetenue), totalTtc: arrondi2(base - montant) };
}

/** Remise de facture enregistrée (€), 0 si aucune. */
export function montantRemiseFacture(f: Pick<Facture, "remise_facture_montant">): number {
  const m = Number(f.remise_facture_montant) || 0;
  return m > 0.004 ? arrondi2(m) : 0;
}

/** Libellé affiché sur la facture : « Remise exceptionnelle (10 %) » ou « Remise exceptionnelle ». */
export function libelleRemiseFacture(f: Pick<Facture, "remise_facture_type" | "remise_facture_valeur">): string {
  if (f.remise_facture_type === "pct" && (Number(f.remise_facture_valeur) || 0) > 0) {
    return `Remise exceptionnelle (${String(arrondi2(Number(f.remise_facture_valeur))).replace(".", ",")} %)`;
  }
  return "Remise exceptionnelle";
}
