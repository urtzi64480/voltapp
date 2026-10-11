// src/lib/suivi-persistance.ts
//
// Persistance du suivi de réalisation (projets.suivi_realisation, voir migration 008) :
//   - coches        clé de coche → date ISO de réalisation
//   - chantier      date de validation finale + devis lié (le NOM du chantier est le nom du projet : projets.nom)
//   - temps         clé de circuit → minutes passées
//   - tempsPostes   nom de poste du devis → minutes passées (postes qui ne sont pas un circuit : pièces, câblage…)
// Colonne SÉPARÉE de maison_config : la sauvegarde automatique de l'éditeur de plan réécrit maison_config en entier,
// elle ne doit jamais pouvoir effacer ce qui a été coché ou chronométré sur le chantier.
//
// Chaque écriture relit la valeur en base puis applique SEULEMENT la modification demandée (lecture-modification-écriture) :
// deux appareils (téléphone sur le chantier, ordinateur au bureau) ne s'écrasent donc pas mutuellement.
import { supabase } from "@/lib/supabase";

export type Coches = Record<string, string>; // clé de coche → date ISO de réalisation
export type Minutes = Record<string, number>; // clé → minutes passées

export interface InfosChantier {
  valide_le?: string;   // AAAA-MM-JJ — validation finale du chantier
  devis_id?: string;    // devis qui va avec (comparaison temps facturé / temps passé)
}

export interface SuiviStocke {
  coches: Coches;
  chantier: InfosChantier;
  temps: Minutes;
  tempsPostes: Minutes;
}

interface Brut { v: 1; coches?: Coches; chantier?: InfosChantier; temps?: Minutes; tempsPostes?: Minutes }

const minutesPropres = (brut: unknown): Minutes => {
  const propre: Minutes = {};
  if (brut && typeof brut === "object") {
    Object.entries(brut as Record<string, unknown>).forEach(([k, v]) => {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) propre[k] = Math.round(v);
    });
  }
  return propre;
};

export function lireSuivi(raw: string | null | undefined): SuiviStocke {
  const vide: SuiviStocke = { coches: {}, chantier: {}, temps: {}, tempsPostes: {} };
  if (!raw) return vide;
  try {
    const parsed = JSON.parse(raw) as Partial<Brut> | null;
    if (!parsed || typeof parsed !== "object") return vide;
    const coches: Coches = {};
    if (parsed.coches && typeof parsed.coches === "object") {
      Object.entries(parsed.coches).forEach(([k, v]) => { if (typeof v === "string") coches[k] = v; });
    }
    const chantier: InfosChantier = {};
    const c = parsed.chantier;
    if (c && typeof c === "object") {
      if (typeof c.valide_le === "string" && c.valide_le) chantier.valide_le = c.valide_le;
      if (typeof c.devis_id === "string" && c.devis_id) chantier.devis_id = c.devis_id;
    }
    return { coches, chantier, temps: minutesPropres(parsed.temps), tempsPostes: minutesPropres(parsed.tempsPostes) };
  } catch { return vide; }
}

export const lireCoches = (raw: string | null | undefined): Coches => lireSuivi(raw).coches;

const serialiser = (s: SuiviStocke): string | null => {
  const brut: Brut = { v: 1 };
  if (Object.keys(s.coches).length > 0) brut.coches = s.coches;
  if (s.chantier.valide_le || s.chantier.devis_id) brut.chantier = s.chantier;
  if (Object.keys(s.temps).length > 0) brut.temps = s.temps;
  if (Object.keys(s.tempsPostes).length > 0) brut.tempsPostes = s.tempsPostes;
  return Object.keys(brut).length === 1 ? null : JSON.stringify(brut);
};

export type ResultatSuivi = { ok: true; suivi: SuiviStocke } | { ok: false; message: string; colonneAbsente: boolean };
export type ResultatEcriture = { ok: true; coches: Coches } | { ok: false; message: string; colonneAbsente: boolean };

const echec = (message: string): { ok: false; message: string; colonneAbsente: boolean } =>
  ({ ok: false, message, colonneAbsente: /suivi_realisation/i.test(message) });

/** Relit la base, applique `modif` sur le contenu relu, réécrit. */
export async function modifierSuivi(projetId: string, modif: (s: SuiviStocke) => void): Promise<ResultatSuivi> {
  const { data, error } = await supabase.from("projets").select("suivi_realisation").eq("id", projetId).single();
  if (error) return echec(error.message);
  const suivi = lireSuivi((data as { suivi_realisation?: string | null } | null)?.suivi_realisation);
  modif(suivi);
  const { error: errEcriture } = await supabase.from("projets").update({ suivi_realisation: serialiser(suivi) } as never).eq("id", projetId);
  if (errEcriture) return echec(errEcriture.message);
  return { ok: true, suivi };
}

/** Relit le suivi complet en base (synchronisation entre appareils). */
export async function relireSuivi(projetId: string): Promise<SuiviStocke | null> {
  const { data, error } = await supabase.from("projets").select("suivi_realisation").eq("id", projetId).single();
  if (error) return null;
  return lireSuivi((data as { suivi_realisation?: string | null } | null)?.suivi_realisation);
}

/** Coche (fait = true) ou décoche (fait = false) un ensemble de clés. */
export async function appliquerCoches(projetId: string, cles: string[], fait: boolean, dateIso: string): Promise<ResultatEcriture> {
  const res = await modifierSuivi(projetId, s => {
    cles.forEach(k => { if (fait) { if (!s.coches[k]) s.coches[k] = dateIso; } else delete s.coches[k]; });
  });
  return res.ok ? { ok: true, coches: res.suivi.coches } : res;
}

/** Supprime des clés précises (coches orphelines, remise à zéro d'un circuit). */
export const retirerCoches = (projetId: string, cles: string[]): Promise<ResultatEcriture> =>
  appliquerCoches(projetId, cles, false, "");

/** Relit les coches en base. */
export async function relireCoches(projetId: string): Promise<Coches | null> {
  return (await relireSuivi(projetId))?.coches ?? null;
}

// ─── Temps ───────────────────────────────────────────────────────────────────────────────────────────────────

/** "2,5" / "2.5" / "2h30" / "2:30" / "45min" → minutes ; null si illisible ; 0 si vide. */
export function minutesDepuisTexte(texte: string): number | null {
  const t = texte.trim().toLowerCase().replace(",", ".");
  if (t === "") return 0;
  let m = t.match(/^(\d+)\s*(?:h|:)\s*(\d{1,2})?\s*(?:min|m)?$/);
  if (m) return Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
  m = t.match(/^(\d+(?:\.\d+)?)\s*min$/);
  if (m) return Math.round(Number(m[1]));
  m = t.match(/^(\d+(?:\.\d+)?)\s*h?$/);
  if (m) return Math.round(Number(m[1]) * 60);
  return null;
}

/** 150 → "2 h 30" ; 45 → "45 min" ; 0 → "—". */
export function formaterMinutes(min: number): string {
  if (!min || min <= 0) return "—";
  const h = Math.floor(min / 60), r = min % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, "0")}`;
}

/** Définit (minutes > 0) ou efface (0) le temps passé sur un circuit ou un poste. */
export const definirTemps = (projetId: string, cible: "temps" | "tempsPostes", cle: string, minutes: number): Promise<ResultatSuivi> =>
  modifierSuivi(projetId, s => { if (minutes > 0) s[cible][cle] = Math.round(minutes); else delete s[cible][cle]; });

export const definirChantier = (projetId: string, patch: InfosChantier): Promise<ResultatSuivi> =>
  modifierSuivi(projetId, s => {
    s.chantier = { ...s.chantier, ...patch };
    if (!s.chantier.valide_le) delete s.chantier.valide_le;
    if (!s.chantier.devis_id) delete s.chantier.devis_id;
  });
