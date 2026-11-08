// Lecture des achats réels (table devis_achats) avec repli : sans la migration 019 la colonne `article` n'existe pas, sans la 018 la table non plus.
// Les pages s'affichent dans tous les cas (rien de saisi) et indiquent le SQL à lancer.
import { supabase } from "@/lib/supabase";
import { lireAchat, type AchatLigne } from "@/lib/depenses-materiel";

export interface AchatsCharges { achats: AchatLigne[]; tableAbsente: boolean; colonneArticleAbsente: boolean; erreur: string | null }

const BASE = "id,devis_id,montant,date_achat,fournisseur";

/** Achats d'un devis (`devisId`) ou de tous les devis. */
export async function chargerAchats(devisId?: string): Promise<AchatsCharges> {
  const lire = (avecArticle: boolean) => {
    const q = supabase.from("devis_achats").select(avecArticle ? `${BASE},article` : BASE);
    return devisId ? q.eq("devis_id", devisId) : q;
  };
  let r = await lire(true);
  let colonneArticleAbsente = false;
  if (r.error && /article/i.test(r.error.message)) { colonneArticleAbsente = true; r = await lire(false); }
  if (r.error) {
    const tableAbsente = /devis_achats/i.test(r.error.message);
    return { achats: [], tableAbsente, colonneArticleAbsente, erreur: tableAbsente ? null : r.error.message };
  }
  const achats = ((r.data ?? []) as unknown[]).map(lireAchat).filter((a): a is AchatLigne => a != null);
  return { achats, tableAbsente: false, colonneArticleAbsente, erreur: null };
}
