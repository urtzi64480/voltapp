// src/lib/stockage-chemin.ts
//
// CHEMINS DES FICHIERS DANS LE STOCKAGE SUPABASE. Plusieurs comptes (électriciens) partagent les mêmes buckets : sans dossier par utilisateur, deux
// comptes pouvaient écrire au même chemin (ex. « devis/DEV-001.pdf ») et les policies ne pouvaient pas dire à qui appartient un fichier.
// Règle : TOUT fichier déposé par un utilisateur connecté commence par « <son user_id>/ » (c'est ce que vérifient les policies de stockage),
// et les PDF / photos des buckets publics portent un suffixe aléatoire, sinon leur lien public se devine à partir du numéro de devis.
import { supabase } from "@/lib/supabase";

/** user_id de la session en cours = premier dossier de tout fichier envoyé. Lève une erreur claire si la session a expiré. */
export async function idUtilisateurStockage(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user.id;
  if (!uid) throw new Error("Session expirée : reconnecte-toi pour envoyer un fichier.");
  return uid;
}

/** Suffixe aléatoire non devinable (16 caractères hexadécimaux) pour les noms de fichiers des buckets publics. */
export function suffixeAleatoire(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
