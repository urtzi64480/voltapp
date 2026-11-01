// src/lib/deplacement.ts — forfait déplacement ajouté au devis selon la distance entre l'atelier et le chantier.
import { arrondi2 } from "./utils";

export interface ReglageDeplacement { tarifKm: number; kmOfferts: number; allerRetour: boolean; minimum: number }
export const REGLAGE_DEPLACEMENT_DEFAUT: ReglageDeplacement = { tarifKm: 0.6, kmOfferts: 10, allerRetour: true, minimum: 0 };

export const lireReglage = (brut: unknown): ReglageDeplacement => {
  const b = (brut && typeof brut === "object" ? brut : {}) as Record<string, unknown>;
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  return {
    tarifKm: n(b.tarifKm, REGLAGE_DEPLACEMENT_DEFAUT.tarifKm), kmOfferts: n(b.kmOfferts, REGLAGE_DEPLACEMENT_DEFAUT.kmOfferts),
    allerRetour: typeof b.allerRetour === "boolean" ? b.allerRetour : REGLAGE_DEPLACEMENT_DEFAUT.allerRetour, minimum: n(b.minimum, 0),
  };
};

/** Distance à vol d'oiseau en km (formule de haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Les routes sont plus longues que la ligne droite : coefficient courant de 1,3. */
export const COEF_ROUTE = 1.3;
export const kmRoute = (kmVolOiseau: number): number => Math.round(kmVolOiseau * COEF_ROUTE * 10) / 10;

export interface FraisDeplacement { kmSimple: number; kmFactures: number; montant: number; libelle: string }

export function fraisDeplacement(kmSimple: number, r: ReglageDeplacement): FraisDeplacement {
  const aller = Math.max(0, kmSimple);
  const total = r.allerRetour ? aller * 2 : aller;
  const kmFactures = Math.max(0, total - r.kmOfferts);
  const montant = arrondi2(Math.max(r.minimum, kmFactures * r.tarifKm));
  const km = Math.round(total);
  return {
    kmSimple: aller, kmFactures: Math.round(kmFactures * 10) / 10, montant,
    libelle: `Déplacement (${km} km${r.allerRetour ? " aller-retour" : ""}${r.kmOfferts > 0 ? `, ${r.kmOfferts} km offerts` : ""})`,
  };
}
