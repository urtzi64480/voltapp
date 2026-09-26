// src/components/LocalBusinessJsonLd.tsx
//
// Données structurées schema.org (type "Electrician", sous-type de
// LocalBusiness) injectées en JSON-LD. Ça ne change rien à l'affichage :
// c'est lu uniquement par les moteurs de recherche pour comprendre
// "qui", "où" et "dans quel rayon" — c'est ce bloc qui porte la liste
// complète des villes, sans avoir besoin de les afficher toutes en
// texte visible (qui resterait lisible pour un humain).
//
// Placement : dans le JSX de /a-propos (ou du layout /demande), peu importe
// head/body — les crawlers lisent le <script type="application/ld+json">
// où qu'il soit dans le HTML rendu.

import { VILLE_PRINCIPALE, RAYON_KM, COORDONNEES, TOUTES_VILLES } from "@/lib/seo-zone";

const TELEPHONE = "+33769995222";
const SITE_URL = "https://elektron-electricite.fr";

export default function LocalBusinessJsonLd() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Electrician",
    name: "Elektron",
    image: `${SITE_URL}/images/ben-elektron-bw.jpg`,
    url: SITE_URL,
    telephone: TELEPHONE,
    priceRange: "€€",
    address: {
      "@type": "PostalAddress",
      addressLocality: VILLE_PRINCIPALE,
      addressRegion: "Pyrénées-Atlantiques",
      addressCountry: "FR",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: COORDONNEES.lat,
      longitude: COORDONNEES.lng,
    },
    // Rayon d'intervention "à vol d'oiseau" pour les moteurs qui exploitent GeoCircle
    areaServed: [
      {
        "@type": "GeoCircle",
        geoMidpoint: {
          "@type": "GeoPoint",
          latitude: COORDONNEES.lat,
          longitude: COORDONNEES.lng,
        },
        geoRadius: RAYON_KM * 1000,
      },
      // Liste explicite des communes — aide les moteurs à associer
      // chaque nom de ville à cette fiche, même sans calcul de rayon.
      ...TOUTES_VILLES.map((ville) => ({
        "@type": "City",
        name: ville,
      })),
    ],
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
