// src/lib/devis-creation.ts
//
// Création d'un devis « brouillon » à partir de lignes déjà calculées — même logique que le pré-devis du plan :
// retente sans la colonne `poste` si elle manque, supprime le devis orphelin si les lignes échouent, incrémente le compteur du profil.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DevisLigne } from "@/types";
import { colonnesFournisseur, colonnesImage } from "./devis-lignes";
import { arrondi2, echecSupabase } from "./utils";

export type LigneNouveauDevis = Omit<DevisLigne, "devis_id" | "ordre">;

export async function creerDevisBrouillon(
  supabase: SupabaseClient, userId: string, clientId: string, objet: string, lignes: LigneNouveauDevis[],
): Promise<{ id?: string; numero?: string; erreur?: string }> {
  if (lignes.length === 0) return { erreur: "Aucune ligne à enregistrer." };
  const somme = (t: "service" | "materiau") => lignes.filter(l => l.type_branche === t).reduce((s, l) => s + arrondi2(l.quantite * l.prix_unitaire), 0);
  const totalService = arrondi2(somme("service")), totalMateriau = arrondi2(somme("materiau"));

  const { data: prof } = await supabase.from("profil").select("prefixe_devis, compteur_devis").eq("id", userId).single();
  const numero = `${prof?.prefixe_devis ?? "DEV"}-${new Date().getFullYear()}-${String((prof?.compteur_devis ?? 0) + 1).padStart(3, "0")}`;

  const { data: devis, error } = await supabase.from("devis").insert({
    user_id: userId, client_id: clientId, numero, objet, statut: "brouillon",
    total_service: totalService, total_materiau: totalMateriau, total_ttc: arrondi2(totalService + totalMateriau),
  }).select().single();
  if (error || !devis) return { erreur: `Création du devis impossible : ${error?.message ?? "erreur inconnue"}` };

  const colFournisseur = colonnesFournisseur(lignes as DevisLigne[]);
  const colImage = colonnesImage(lignes);
  const construire = (avecPoste: boolean) => lignes.map((l, i) => {
    const { fournisseur_id, fournisseur_nom, prix_achat, image_url, poste, ...reste } = l;
    void fournisseur_id; void fournisseur_nom; void prix_achat; void image_url;
    return { ...reste, devis_id: devis.id, ordre: i, ...(avecPoste ? { poste: poste ?? null } : {}), ...colFournisseur(l as DevisLigne), ...colImage(l) };
  });
  let { error: errLignes } = await supabase.from("devis_lignes").insert(construire(true));
  if (errLignes && /poste/i.test(errLignes.message)) ({ error: errLignes } = await supabase.from("devis_lignes").insert(construire(false)));
  if (errLignes) {
    await supabase.from("devis").delete().eq("id", devis.id);
    return { erreur: `Lignes du devis non enregistrées (rien n'a été créé) : ${errLignes.message}` };
  }
  const { error: errCompteur } = await supabase.from("profil").update({ compteur_devis: (prof?.compteur_devis ?? 0) + 1 }).eq("id", userId);
  echecSupabase(errCompteur, "Mise à jour du compteur de devis");
  return { id: devis.id, numero };
}
