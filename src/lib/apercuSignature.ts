// Données pour l'aperçu du lien de signature (SMS, WhatsApp, iMessage…).
// Plusieurs sources pour le logo, essayées dans l'ordre, pour ne jamais retomber sur le logo VoltApp :
//   0. la fonction dédiée get_devis_signature_apercu (migration 004) — source principale
//   1. la fonction Supabase get_public_profil_by_devis_token (celle de la page de signature)
//   2. la lecture directe de profil (nom_entreprise, logo_url) — même accès public que la page /demande
//   3. le dossier du bucket public « logos » de l'artisan (logos/<user_id>/logo-….png)

export interface ApercuSignature {
  numero: string;
  entreprise: string;
  logoUrl?: string;
}

function nomAffiche(p: any): string {
  if (!p) return "";
  return (p.nom_entreprise || [p.prenom, p.nom].filter(Boolean).join(" ") || "").trim();
}

export async function chargerApercuSignature(client: any, token: string): Promise<ApercuSignature | null> {
  // 0) Fonction dédiée à l'aperçu (migration 004) : une seule requête, sans dépendre des règles d'accès
  //    de la table devis — comme get_devis_public_liste pour la liste de courses.
  try {
    const { data } = await client.rpc("get_devis_signature_apercu", { p_token: token }).maybeSingle();
    if (data && data.numero) {
      let logoUrl: string | undefined = data.logo_url || undefined;
      const entreprise = nomAffiche(data);
      if (!logoUrl) logoUrl = await logoDepuisBucket(client, data.user_id);
      return { numero: String(data.numero), entreprise, logoUrl };
    }
  } catch { /* fonction absente : on essaie les lectures directes ci-dessous */ }

  const { data: devis } = await client
    .from("devis").select("numero, user_id").eq("signature_token", token).maybeSingle();
  if (!devis) return null;

  let logoUrl: string | undefined;
  let entreprise = "";

  // 1) Fonction publique utilisée par la page de signature
  try {
    const { data: p } = await client.rpc("get_public_profil_by_devis_token", { p_token: token }).maybeSingle();
    if (p) { logoUrl = p.logo_url || undefined; entreprise = nomAffiche(p); }
  } catch { /* on passe à la source suivante */ }

  // 2) Lecture directe de profil
  if ((!logoUrl || !entreprise) && devis.user_id) {
    try {
      const { data: p } = await client
        .from("profil").select("nom_entreprise, logo_url").eq("id", devis.user_id).maybeSingle();
      if (p) { logoUrl = logoUrl || p.logo_url || undefined; entreprise = entreprise || nomAffiche(p); }
    } catch { /* idem */ }
  }

  // 3) Fichier du bucket public « logos »
  if (!logoUrl) logoUrl = await logoDepuisBucket(client, devis.user_id);

  return { numero: String(devis.numero ?? ""), entreprise, logoUrl };
}

async function logoDepuisBucket(client: any, userId?: string | null): Promise<string | undefined> {
  if (!userId) return undefined;
  try {
    const { data: files } = await client.storage.from("logos").list(userId, { limit: 20 });
    const f = (files ?? [])
      .filter((x: any) => x?.name && /\.(png|jpe?g|webp|gif)$/i.test(x.name))
      .sort((a: any, b: any) => String(b.name).localeCompare(String(a.name)))[0];
    if (f) return client.storage.from("logos").getPublicUrl(`${userId}/${f.name}`).data.publicUrl || undefined;
  } catch { /* pas de logo trouvé */ }
  return undefined;
}
