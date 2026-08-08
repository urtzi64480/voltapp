import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";
import PublicListeClient from "./PublicListeClient";

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const { data } = await supabase
    .rpc("get_devis_public_liste", { p_token: params.token })
    .single();

  if (!data) {
    return { title: "Liste de courses" };
  }

  const row = data as any;
  const title = `Liste de courses — Devis ${row.numero}`;
  const description = "Consultez et cochez les articles à acheter pour ce chantier.";
  const logoUrl = row.logo_url || undefined;

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
}

export default function Page({ params }: { params: { token: string } }) {
  return <PublicListeClient token={params.token} />;
}
