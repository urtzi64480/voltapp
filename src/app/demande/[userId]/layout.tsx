import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Elektron - Électricité",
  description: "Demande de devis, prise de rendez-vous ou urgence électrique",
};

export default function DemandeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
