// src/lib/suivi-persistance.ts
//
// Persistance des coches du suivi de réalisation (projets.suivi_realisation, voir migration 008).
// Colonne SÉPARÉE de maison_config : la sauvegarde automatique de l'éditeur de plan réécrit maison_config en entier,
// elle ne doit jamais pouvoir effacer ce qui a été coché sur le chantier.
//
// Chaque écriture relit la valeur en base puis applique SEULEMENT les coches modifiées (lecture-modification-écriture) :
// deux appareils (téléphone sur le chantier, ordinateur au bureau) ne s'écrasent donc pas mutuellement.
import { supabase } from "@/lib/supabase";

export type Coches = Record<string, string>; // clé de coche → date ISO de réalisation

interface Stocke { v: 1; coches: Coches }

export function lireCoches(raw: string | null | undefined): Coches {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<Stocke> | null;
    const brut = parsed && typeof parsed === "object" ? parsed.coches : null;
    if (!brut || typeof brut !== "object") return {};
    const propre: Coches = {};
    Object.entries(brut).forEach(([k, v]) => { if (typeof v === "string") propre[k] = v; });
    return propre;
  } catch { return {}; }
}

const serialiser = (coches: Coches): string | null =>
  Object.keys(coches).length === 0 ? null : JSON.stringify({ v: 1, coches } satisfies Stocke);

export type ResultatEcriture = { ok: true; coches: Coches } | { ok: false; message: string; colonneAbsente: boolean };

/** Coche (fait = true) ou décoche (fait = false) un ensemble de clés. */
export async function appliquerCoches(projetId: string, cles: string[], fait: boolean, dateIso: string): Promise<ResultatEcriture> {
  const { data, error } = await supabase.from("projets").select("suivi_realisation").eq("id", projetId).single();
  if (error) return { ok: false, message: error.message, colonneAbsente: /suivi_realisation/i.test(error.message) };
  const coches = lireCoches((data as { suivi_realisation?: string | null } | null)?.suivi_realisation);
  cles.forEach(k => { if (fait) { if (!coches[k]) coches[k] = dateIso; } else delete coches[k]; });
  const { error: errEcriture } = await supabase.from("projets").update({ suivi_realisation: serialiser(coches) } as never).eq("id", projetId);
  if (errEcriture) return { ok: false, message: errEcriture.message, colonneAbsente: /suivi_realisation/i.test(errEcriture.message) };
  return { ok: true, coches };
}

/** Supprime des clés précises (coches orphelines, remise à zéro d'un circuit). */
export const retirerCoches = (projetId: string, cles: string[]): Promise<ResultatEcriture> =>
  appliquerCoches(projetId, cles, false, "");

/** Relit les coches en base (synchronisation entre appareils). */
export async function relireCoches(projetId: string): Promise<Coches | null> {
  const { data, error } = await supabase.from("projets").select("suivi_realisation").eq("id", projetId).single();
  if (error) return null;
  return lireCoches((data as { suivi_realisation?: string | null } | null)?.suivi_realisation);
}
