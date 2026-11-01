// src/lib/puissance.ts — bilan de puissance INDICATIF pour choisir la puissance de l'abonnement (kVA).
// Ce n'est pas le calcul réglementaire (NF C 14-100 / NF C 15-100) : les coefficients sont modifiables et à vérifier.
import { contexteDevis } from "./checklist-fin-chantier";

export interface Appareil { id: string; libelle: string; watts: number; coef: number; motsCles?: string[] }
export interface LignePuissance { id: string; libelle: string; watts: number; quantite: number; coef: number }

/** coef = part de la puissance supposée appelée en même temps (0 à 1). */
export const APPAREILS: Appareil[] = [
  { id: "chauffage", libelle: "Radiateur / convecteur électrique", watts: 1500, coef: 0.8, motsCles: ["radiateur", "convecteur", "chauffage"] },
  { id: "chauffe-eau", libelle: "Chauffe-eau (cumulus)", watts: 2000, coef: 1, motsCles: ["chauffe eau", "cumulus", "ballon"] },
  { id: "plaque", libelle: "Plaque de cuisson", watts: 7000, coef: 0.5, motsCles: ["plaque", "cuisiniere"] },
  { id: "four", libelle: "Four", watts: 3000, coef: 0.5, motsCles: ["four"] },
  { id: "lave-linge", libelle: "Lave-linge / sèche-linge / lave-vaisselle", watts: 2500, coef: 0.4, motsCles: ["lave"] },
  { id: "borne", libelle: "Borne de recharge véhicule", watts: 7400, coef: 1, motsCles: ["borne", "irve", "recharge", "wallbox"] },
  { id: "clim", libelle: "Climatisation / pompe à chaleur", watts: 2500, coef: 0.9, motsCles: ["clim", "pompe a chaleur"] },
  { id: "vmc", libelle: "VMC", watts: 100, coef: 1, motsCles: ["vmc", "ventilation"] },
  { id: "prises", libelle: "Circuit prises 16 A", watts: 3000, coef: 0.25, motsCles: ["prise"] },
  { id: "eclairage", libelle: "Point lumineux", watts: 100, coef: 0.6, motsCles: ["luminaire", "eclairage", "spot", "applique"] },
  { id: "volet", libelle: "Volet roulant motorisé", watts: 150, coef: 0.1, motsCles: ["volet"] },
];

export const PALIERS_MONO_KVA = [3, 6, 9, 12, 15, 18, 24, 30, 36];
export const PALIERS_TRI_KVA = [9, 12, 15, 18, 24, 30, 36, 40, 48, 60];

export const wattsAppeles = (l: LignePuissance[]): number =>
  Math.round(l.reduce((a, x) => a + Math.max(0, x.watts) * Math.max(0, x.quantite) * Math.min(1, Math.max(0, x.coef)), 0));

export const totalInstalle = (l: LignePuissance[]): number =>
  Math.round(l.reduce((a, x) => a + Math.max(0, x.watts) * Math.max(0, x.quantite), 0));

/** Plus petit palier ≥ puissance appelée (cos φ = 1) ; null si au-delà du dernier palier. */
export function palierRecommande(watts: number, triphase: boolean): number | null {
  const kva = watts / 1000;
  return (triphase ? PALIERS_TRI_KVA : PALIERS_MONO_KVA).find(p => p >= kva) ?? null;
}

/** Appareils dont un mot clé figure dans le texte du devis → lignes pré-remplies (quantité 1). */
export function lignesDepuisDevis(textes: (string | null | undefined)[]): LignePuissance[] {
  const ctx = contexteDevis(textes);
  return APPAREILS.filter(a => a.motsCles?.some(m => ctx.includes(` ${m}`)))
    .map(a => ({ id: a.id, libelle: a.libelle, watts: a.watts, quantite: 1, coef: a.coef }));
}
