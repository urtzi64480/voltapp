import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";
import { chargerApercuSignature } from "@/lib/apercuSignature";
import SignerClient from "./SignerClient";

// Jamais de cache : l'aperçu doit refléter le logo actuel de l'artisan pour chaque lien.
export const dynamic = "force-dynamic";

// Aperçu du lien (SMS, WhatsApp, iMessage…) : logo et nom de l'artisan, pas ceux de VoltApp.
// Même principe que la liste de courses partagée (balises Open Graph).
export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const defaut: Metadata = { title: "Devis à signer" };
  try {
    const apercu = await chargerApercuSignature(supabase, params.token);
    if (!apercu) return defaut;

    const title = `Devis ${apercu.numero}${apercu.entreprise ? ` — ${apercu.entreprise}` : ""}`;
    const description = "Consultez votre devis et signez-le en ligne.";
    const logoUrl = apercu.logoUrl;

    return {
      title,
      description,
      // L'icône du site (favicon / apple-touch) est aussi remplacée par le logo de l'artisan.
      ...(logoUrl ? { icons: { icon: logoUrl, apple: logoUrl } } : {}),
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
