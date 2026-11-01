// src/lib/carte-visites.ts
// Position des visiteurs sur la carte des statistiques. Une visite est placée :
//   1. d'après ses coordonnées enregistrées (migration 014, ville arrondie à ~1 km) ;
//   2. sinon d'après la ville, si elle fait partie des communes connues de la zone (VILLES_COORDS) ;
//   3. sinon d'après la ville géocodée à la demande (`extra`, voir /api/visites/geocoder).
// Module pur, testable.
import { VILLES_COORDS } from "./seo-zone";

export interface VisiteCarte { ville?: unknown; pays?: unknown; latitude?: unknown; longitude?: unknown }
export interface Coord { lat: number; lng: number }
export interface PointVisiteur extends Coord { libelle: string }
export interface LieuAGeocoder { cle: string; ville: string; pays: string }

export const normaliser = (t: string): string =>
  t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const INDEX_VILLES: Record<string, Coord> = Object.fromEntries(
  Object.entries(VILLES_COORDS).map(([nom, c]) => [normaliser(nom), c]),
);

const nombre = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const texte = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Clé d'un lieu (ville + pays) pour le cache de géocodage ; vide si la ville est inconnue. */
export const cleLieu = (v: VisiteCarte): string => {
  const ville = normaliser(texte(v.ville));
  return ville ? `${ville}|${normaliser(texte(v.pays))}` : "";
};

export function positionVisite(v: VisiteCarte, extra: Record<string, Coord> = {}): Coord | null {
  const lat = nombre(v.latitude), lng = nombre(v.longitude);
  if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) return { lat, lng };
  const ville = texte(v.ville);
  if (!ville) return null;
  return INDEX_VILLES[normaliser(ville)] ?? extra[cleLieu(v)] ?? null;
}

/**
 * Un point PAR visiteur. Les visiteurs d'une même ville sont légèrement écartés (spirale d'environ 100 m par pas)
 * pour ne pas se superposer ; `sansPosition` = visites impossibles à placer.
 */
export function pointsVisiteurs(visites: VisiteCarte[], extra: Record<string, Coord> = {}): { points: PointVisiteur[]; sansPosition: number } {
  const points: PointVisiteur[] = [];
  const vusParLieu = new Map<string, number>();
  let sansPosition = 0;
  visites.forEach(v => {
    const pos = positionVisite(v, extra);
    if (!pos) { sansPosition++; return; }
    const lieu = `${pos.lat.toFixed(2)},${pos.lng.toFixed(2)}`;
    const k = vusParLieu.get(lieu) ?? 0;
    vusParLieu.set(lieu, k + 1);
    const r = k === 0 ? 0 : 0.0009 * Math.sqrt(k);
    const a = k * 2.4;
    points.push({
      lat: pos.lat + r * Math.sin(a),
      lng: pos.lng + (r * Math.cos(a)) / Math.max(0.2, Math.cos((pos.lat * Math.PI) / 180)),
      libelle: texte(v.ville) || "Position approximative",
    });
  });
  return { points, sansPosition };
}

/** Villes (une fois chacune) à géocoder : ville connue du visiteur mais position introuvable. */
export function lieuxAGeocoder(visites: VisiteCarte[], extra: Record<string, Coord> = {}): LieuAGeocoder[] {
  const m = new Map<string, LieuAGeocoder>();
  visites.forEach(v => {
    const cle = cleLieu(v);
    if (!cle || m.has(cle) || positionVisite(v, extra)) return;
    m.set(cle, { cle, ville: texte(v.ville), pays: texte(v.pays) });
  });
  return [...m.values()];
}
