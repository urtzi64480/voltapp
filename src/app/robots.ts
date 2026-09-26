// src/app/robots.ts
//
// Next.js génère automatiquement /robots.txt à partir de ce fichier.
// Il n'existait pas jusqu'ici — sans lui, aucune règle explicite n'indique
// aux moteurs de recherche quelles pages indexer, ni où trouver le sitemap.
import type { MetadataRoute } from "next";

const BASE_URL = "https://elektron-electricite.fr";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/a-propos", "/images/"],
        disallow: [
          "/login",
          "/dashboard",
          "/clients",
          "/devis",
          "/factures",
          "/catalogue",
          "/crm",
          "/planning",
          "/leads",
          "/leads/", // route interne, distincte de /demande public
          "/parametres",
          "/tableau",
          "/predevis",
          "/rdv",
          "/realisations",
          "/liste",
          "/api",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
