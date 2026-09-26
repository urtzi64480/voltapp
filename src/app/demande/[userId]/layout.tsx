// src/app/demande/[userId]/layout.tsx
import type { Metadata } from "next";
import { VILLE_PRINCIPALE, RAYON_KM } from "@/lib/seo-zone";

const title = `Elektron — Devis, RDV et urgence électricien à ${VILLE_PRINCIPALE} et alentours`;
const description = `Demande de devis gratuit, prise de rendez-vous ou urgence électrique avec Elektron, électricien indépendant à ${VILLE_PRINCIPALE}. Intervention dans un rayon de ${RAYON_KM} km : Bayonne, Anglet, Biarritz, Cambo-les-Bains, Hasparren, Saint-Jean-de-Luz et tout le Pays Basque.`;

export const metadata: Metadata = {
  title,
  description,
  alternates: {
    canonical: "https://elektron-electricite.fr/",
  },
  openGraph: {
    title,
    description,
    url: "https://elektron-electricite.fr/",
    siteName: "Elektron",
    locale: "fr_FR",
    type: "website",
  },
};

export default function DemandeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
