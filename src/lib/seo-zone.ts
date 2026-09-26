// src/lib/seo-zone.ts
//
// Source unique de vérité pour la zone d'intervention géographique d'Elektron.
// Utilisé à la fois pour le contenu affiché (page /a-propos, carte de zone)
// et pour les métadonnées structurées (JSON-LD LocalBusiness) afin d'éviter
// toute duplication entre le contenu visible et les données pour les moteurs
// de recherche.
//
// ⚠️ Liste indicative : les distances routières réelles peuvent différer
// du rayon à vol d'oiseau. Ben peut ajuster VILLE_PRINCIPALE, COORDONNEES
// et les groupes ci-dessous si certaines communes sont trop/pas assez loin.

export const VILLE_PRINCIPALE = "Jatxou";
export const RAYON_KM = 40;

// Coordonnées approximatives de Jatxou (centre du rayon d'intervention)
export const COORDONNEES = {
  lat: 43.3858,
  lng: -1.4169,
};

export interface ZoneGroupe {
  label: string;
  villes: string[];
}

// Groupes géographiques, du plus proche au plus périphérique.
// Chaque ville n'apparaît qu'une seule fois, dans son groupe le plus pertinent.
// Jatxou n'apparaît pas dans les listes ci-dessous : c'est la base (voir
// VILLE_PRINCIPALE), pas une "ville desservie" au même titre que les autres.
export const ZONES: ZoneGroupe[] = [
  {
    label: "Agglomération Bayonne – Anglet – Biarritz et littoral",
    villes: [
      "Bayonne",
      "Anglet",
      "Biarritz",
      "Boucau",
      "Tarnos",
      "Ondres",
      "Bidart",
      "Guéthary",
    ],
  },
  {
    label: "Sud Pays Basque",
    villes: [
      "Saint-Jean-de-Luz",
      "Ciboure",
      "Urrugne",
      "Hendaye",
      "Ascain",
      "Sare",
      "Ainhoa",
      "Biriatou",
    ],
  },
  {
    label: "Vallée de la Nive (autour de Jatxou)",
    villes: [
      "Ustaritz",
      "Villefranque",
      "Halsou",
      "Larressore",
      "Cambo-les-Bains",
      "Itxassou",
      "Louhossoa",
      "Bidarray",
      "Espelette",
      "Souraïde",
      "Saint-Pée-sur-Nivelle",
      "Ahetze",
      "Arcangues",
      "Arbonne",
      "Bassussarry",
    ],
  },
  {
    label: "Pays Basque intérieur nord",
    villes: [
      "Hasparren",
      "Briscous",
      "Mouguerre",
      "Urcuit",
      "Urt",
      "Guiche",
      "Bardos",
      "Came",
      "Bidache",
      "Isturits",
      "Bonloc",
      "Hélette",
      "Macaye",
      "Mendionde",
      "Ayherre",
    ],
  },
  {
    label: "Basse-Navarre et limite du rayon",
    villes: [
      "Saint-Jean-Pied-de-Port",
      "Iholdy",
      "Ossès",
      "Saint-Martin-d'Arberoue",
      "Saint-Palais",
      "Salies-de-Béarn",
    ],
  },
];

export const TOUTES_VILLES: string[] = ZONES.flatMap((z) => z.villes);
