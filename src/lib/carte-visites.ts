// src/lib/carte-visites.ts
// Position des visites sur la carte des statistiques : coordonnées enregistrées (migration 014) si présentes,
// sinon la ville est cherchée parmi les communes connues de la zone (VILLES_COORDS). Module pur, testable.
import { VILLES_COORDS } from "./seo-zone";

export interface VisiteCarte { ville?: unknown; pays?: unknown; latitude?: unknown; longitude?: unknown }
export interface PointCarte { lat: number; lng: number; nb: number; libelle: string }

export const normaliser = (t: string): string =>
  t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const INDEX_VILLES: Record<string, { lat: number; lng: number }> = Object.fromEntries(
  Object.entries(VILLES_COORDS).map(([nom, c]) => [normaliser(nom), c]),
);

const nombre = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function positionVisite(v: VisiteCarte): { lat: number; lng: number } | null {
  const lat = nombre(v.latitude), lng = nombre(v.longitude);
  if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) return { lat, lng };
  if (typeof v.ville === "string" && v.ville) return INDEX_VILLES[normaliser(v.ville)] ?? null;
  return null;
}

/** Regroupe les visites par lieu (ville si connue, sinon coordonnées arrondies) ; `sansPosition` = visites non localisables. */
export function grouperVisites(visites: VisiteCarte[]): { points: PointCarte[]; sansPosition: number } {
  const m = new Map<string, PointCarte>();
  let sansPosition = 0;
  visites.forEach(v => {
    const pos = positionVisite(v);
    if (!pos) { sansPosition++; return; }
    const ville = typeof v.ville === "string" && v.ville ? v.ville : "";
    const cle = ville ? normaliser(ville) : `${pos.lat.toFixed(2)},${pos.lng.toFixed(2)}`;
    const p = m.get(cle);
    if (p) p.nb++;
    else m.set(cle, { lat: pos.lat, lng: pos.lng, nb: 1, libelle: ville || "Position approximative" });
  });
  return { points: [...m.values()].sort((a, b) => b.nb - a.nb), sansPosition };
}

/** Rayon (px) d'un cercle selon le nombre de visites : croissance douce, borné. */
export const rayonPoint = (nb: number, max: number): number =>
  Math.round(6 + 14 * Math.sqrt(Math.max(0, nb) / Math.max(1, max)));
