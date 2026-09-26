// src/app/sitemap.ts
//
// Next.js génère automatiquement /sitemap.xml à partir de ce fichier.
// Il n'existait pas jusqu'ici. On y liste uniquement les URLs publiques
// destinées à être indexées : la racine "/" (URL canonique de la page
// de demande, voir alternates.canonical dans demande/[userId]/layout.tsx)
// et /a-propos. Les liens tokenisés (/devis/signer/[token], /liste/[token])
// sont volontairement exclus : ce sont des liens privés envoyés à un client
// précis, sans valeur SEO, et déjà bloqués dans robots.ts.
import type { MetadataRoute } from "next";

const BASE_URL = "https://elektron-electricite.fr";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: `${BASE_URL}/`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/a-propos`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];
}
