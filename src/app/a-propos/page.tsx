// src/app/a-propos/page.tsx
import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";
import ActionsAndGallery from "@/components/ActionsAndGallery";
import { ChevronLeft } from "lucide-react";

// Empêche Next.js de figer cette page au build : sans ça, les photos
// ajoutées/supprimées côté CRM après le déploiement ne remontent jamais
// (page statique servie depuis le cache généré au build).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

// Page statique dédiée à Elektron — plus de partage multi-tenant sur cette route,
// UUID hardcodé volontairement (même exception que demande/page.tsx LeadsPage).
const USER_ID = "d506c94e-40c7-4bcd-a48c-97e86f4ea7c0";

interface Realisation {
  id: string;
  photo_url: string;
}

export async function generateMetadata(): Promise<Metadata> {
  const { data } = await supabase
    .from("profil")
    .select("logo_url")
    .eq("id", USER_ID)
    .single();

  const icon = data?.logo_url || undefined;

  return {
    title: "Elektron - Électricité",
    icons: icon ? { icon } : undefined,
  };
}

export default async function AProposPage() {
  const { data: realisations } = await supabase
    .from("realisations")
    .select("id, photo_url")
    .eq("user_id", USER_ID)
    .order("position", { ascending: true })
    .order("created_at", { ascending: false });

  const photos: Realisation[] = realisations ?? [];

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Header sombre — /a-propos est le point d'entrée, donc lien "en avant" vers la demande */}
      <div className="bg-ink-900 px-4 py-4">
        <div className="max-w-4xl mx-auto">
          <a
            href={`/demande/${USER_ID}`}
            className="inline-flex items-center gap-1.5 text-ink-300 text-sm font-medium hover:text-white transition-colors"
          >
            Faire une demande de devis / RDV / urgence <ChevronLeft size={16} className="rotate-180" />
          </a>
        </div>
      </div>

      {/* Hero */}
      <div className="max-w-4xl mx-auto px-4 pt-10 pb-14">
        <div className="grid md:grid-cols-[minmax(0,320px)_1fr] gap-10 items-start">
          {/* Photo N&B avec cadre décalé volt-500, léger effet "carte" */}
          <div className="relative mx-auto md:mx-0 w-full max-w-[320px]">
            <div className="absolute -top-3 -left-3 w-full h-full rounded-2xl bg-volt-500" />
            <img
              src="/images/ben-elektron-bw.jpg"
              alt="Benoît, électricien Elektron"
              className="relative w-full rounded-2xl object-cover shadow-sm border border-ink-200"
            />
          </div>

          {/* Texte de présentation */}
          <div>
            <p className="text-volt-600 text-xs font-semibold uppercase tracking-wider mb-2">
              Elektron · Électricien
            </p>
            <h1 className="font-display text-3xl sm:text-4xl text-ink-900 leading-tight mb-4">
              Benoît, votre futur électricien
            </h1>
            <div className="text-ink-600 text-sm leading-relaxed space-y-3">
              <p>
                Fort de plusieurs années d'expérience dans la réalisation de
                projets techniques, et de plusieurs années dans le commerce, je
                réunis avec mon activité d'électricien les meilleurs côtés de
                ces deux branches : une réalisation technique de qualité, et un
                projet 100&nbsp;% orienté vers mes clients.
              </p>
              <p>
                Vos demandes seront ma seule préoccupation. N'hésitez pas à
                utiliser les pages de demande de devis (gratuit, évidemment) ou
                de prise de rendez-vous pour que je me déplace — toujours
                gratuitement — chez vous pour discuter de votre projet. Je suis
                également joignable pour toute urgence électrique.
              </p>
            </div>

            <ActionsAndGallery userId={USER_ID} photos={photos} />
          </div>
        </div>
      </div>
    </div>
  );
}
