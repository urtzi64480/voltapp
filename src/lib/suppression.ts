// Suppression d'un enregistrement parent et de ses dépendances SANS risque de perte partielle.
//
// L'ancien enchaînement « supprimer les lignes, puis le parent » (sans vérifier les erreurs) laissait
// un document vide si la suppression du parent échouait. Ici on tente d'abord de supprimer le PARENT
// (les lignes partent avec lui si la clé étrangère est en ON DELETE CASCADE) ; seulement si la base
// refuse pour contrainte de clé étrangère (code 23503) on supprime les dépendances puis on réessaie.
// Dans tous les cas, un échec renvoie l'erreur et s'arrête immédiatement.
import { supabase } from "@/lib/supabase";

export type Dependance = { table: string; colonne: string };

export async function supprimerAvecDependances(
  table: string,
  id: string,
  dependances: Dependance[]
): Promise<{ message: string } | null> {
  const premiere = await supabase.from(table).delete().eq("id", id);
  if (!premiere.error) return null;
  if (premiere.error.code !== "23503") return premiere.error;

  for (const d of dependances) {
    const r = await supabase.from(d.table).delete().eq(d.colonne, id);
    if (r.error) return r.error;
  }
  const seconde = await supabase.from(table).delete().eq("id", id);
  return seconde.error ?? null;
}
