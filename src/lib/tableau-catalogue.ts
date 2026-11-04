// src/lib/tableau-catalogue.ts
// Chargement du catalogue (articles actifs, avec fournisseurs) et du taux horaire du profil, pour les pré-devis de tableau.
import { supabase } from "@/lib/supabase";
import { attacherFournisseurs } from "@/lib/fournisseurs";
import type { Prestation, Profil } from "@/types";

export interface CatalogueEtTaux { prestations: Prestation[]; profil: Pick<Profil, "taux_horaire"> | null }

/** Lève une Error (message lisible) si le catalogue est indisponible. */
export async function chargerCatalogueEtTaux(): Promise<CatalogueEtTaux> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  const [{ data, error }, { data: prof }] = await Promise.all([
    supabase.from("prestations").select("*").eq("actif", true),
    uid ? supabase.from("profil").select("taux_horaire").eq("id", uid).single() : Promise.resolve({ data: null }),
  ]);
  if (error) throw new Error(error.message);
  const prestations = await attacherFournisseurs((data ?? []) as Prestation[]);
  return { prestations, profil: (prof as Pick<Profil, "taux_horaire"> | null) ?? null };
}
