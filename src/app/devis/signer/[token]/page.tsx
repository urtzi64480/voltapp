import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";
import SignerClient from "./SignerClient";

// Aperçu du lien (SMS, WhatsApp, iMessage…) : logo et nom de l'artisan, pas ceux de VoltApp.
// Même principe que la liste de courses partagée.
export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const defaut: Metadata = { title: "Devis à signer" };
  try {
    const [{ data: devis }, { data: profil }] = await Promise.all([
      supabase.from("devis").select("numero").eq("signature_token", params.token).maybeSingle(),
      supabase.rpc("get_public_profil_by_devis_token", { p_token: params.token }).maybeSingle(),
    ]);
    if (!devis) return defaut;

    const p = (profil ?? {}) as any;
    const entreprise: string = p.nom_entreprise || [p.prenom, p.nom].filter(Boolean).join(" ");
    const title = `Devis ${(devis as any).numero}${entreprise ? ` — ${entreprise}` : ""}`;
    const description = "Consultez votre devis et signez-le en ligne.";
    const logoUrl: string | undefined = p.logo_url || undefined;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        images: logoUrl ? [{ url: logoUrl, width: 512, height: 512 }] : undefined,
      },
      twitter: {
        card: "summary",
        title,
        description,
        images: logoUrl ? [logoUrl] : undefined,
      },
    };
  } catch {
    return defaut;
  }
}

export default function Page({ params }: { params: { token: string } }) {
  return <SignerClient params={params} />;
}
