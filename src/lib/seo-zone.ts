// src/lib/seo-zone.ts
//
// Source unique de vérité pour la zone d'intervention géographique d'Elektron.
// Utilisé à la fois pour le contenu affiché (page /a-propos, carte de zone)
// et pour les métadonnées structurées (JSON-LD LocalBusiness) afin d'éviter
// toute duplication entre le contenu visible et les données pour les moteurs
// de recherche.
//
// ⚠️ Liste indicative : les distances routières réelles peuvent différer
// du rayon à vol d'oiseau, et les coordonnées de VILLES_COORDS sont des
// estimations approximatives (centre-bourg), pas des relevés GPS précis.
// Ben peut ajuster VILLE_PRINCIPALE, COORDONNEES et les groupes ci-dessous
// si certaines communes sont trop/pas assez loin, ou mal placées sur la carte.

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

// Coordonnées approximatives (centre-bourg) de chaque commune listée ci-dessus,
// utilisées uniquement pour placer les repères sur la carte (ZoneCarte.tsx).
// N'affecte ni ZONES, ni TOUTES_VILLES, ni le JSON-LD.
export interface Coord {
  lat: number;
  lng: number;
}

export const VILLES_COORDS: Record<string, Coord> = {
  // Agglomération Bayonne – Anglet – Biarritz et littoral
  "Bayonne": { lat: 43.4933, lng: -1.4748 },
  "Anglet": { lat: 43.4832, lng: -1.5192 },
  "Biarritz": { lat: 43.4832, lng: -1.5586 },
  "Boucau": { lat: 43.5225, lng: -1.4839 },
  "Tarnos": { lat: 43.5386, lng: -1.4453 },
  "Ondres": { lat: 43.5661, lng: -1.4453 },
  "Bidart": { lat: 43.4356, lng: -1.5842 },
  "Guéthary": { lat: 43.4225, lng: -1.6069 },

  // Sud Pays Basque
  "Saint-Jean-de-Luz": { lat: 43.3897, lng: -1.6608 },
  "Ciboure": { lat: 43.3833, lng: -1.6672 },
  "Urrugne": { lat: 43.3672, lng: -1.6167 },
  "Hendaye": { lat: 43.3625, lng: -1.7739 },
  "Ascain": { lat: 43.3389, lng: -1.6167 },
  "Sare": { lat: 43.3097, lng: -1.5833 },
  "Ainhoa": { lat: 43.3167, lng: -1.5006 },
  "Biriatou": { lat: 43.3339, lng: -1.7331 },

  // Vallée de la Nive (autour de Jatxou)
  "Ustaritz": { lat: 43.3833, lng: -1.4500 },
  "Villefranque": { lat: 43.4392, lng: -1.4419 },
  "Halsou": { lat: 43.3833, lng: -1.4333 },
  "Larressore": { lat: 43.3667, lng: -1.4500 },
  "Cambo-les-Bains": { lat: 43.3667, lng: -1.4000 },
  "Itxassou": { lat: 43.3167, lng: -1.4000 },
  "Louhossoa": { lat: 43.2833, lng: -1.3667 },
  "Bidarray": { lat: 43.2667, lng: -1.3667 },
  "Espelette": { lat: 43.3333, lng: -1.4500 },
  "Souraïde": { lat: 43.3167, lng: -1.4667 },
  "Saint-Pée-sur-Nivelle": { lat: 43.3333, lng: -1.5333 },
  "Ahetze": { lat: 43.4167, lng: -1.5667 },
  "Arcangues": { lat: 43.4333, lng: -1.5333 },
  "Arbonne": { lat: 43.4500, lng: -1.5333 },
  "Bassussarry": { lat: 43.4500, lng: -1.4833 },

  // Pays Basque intérieur nord
  "Hasparren": { lat: 43.3167, lng: -1.2833 },
  "Briscous": { lat: 43.4667, lng: -1.3667 },
  "Mouguerre": { lat: 43.4833, lng: -1.4167 },
  "Urcuit": { lat: 43.4667, lng: -1.3833 },
  "Urt": { lat: 43.5167, lng: -1.3000 },
  "Guiche": { lat: 43.5167, lng: -1.2333 },
  "Bardos": { lat: 43.4833, lng: -1.2333 },
  "Came": { lat: 43.5333, lng: -1.1667 },
  "Bidache": { lat: 43.4667, lng: -1.1167 },
  "Isturits": { lat: 43.3667, lng: -1.1833 },
  "Bonloc": { lat: 43.3667, lng: -1.2333 },
  "Hélette": { lat: 43.3333, lng: -1.2333 },
  "Macaye": { lat: 43.3167, lng: -1.3333 },
  "Mendionde": { lat: 43.3333, lng: -1.2833 },
  "Ayherre": { lat: 43.3500, lng: -1.3167 },

  // Basse-Navarre et limite du rayon
  "Saint-Jean-Pied-de-Port": { lat: 43.1667, lng: -1.2333 },
  "Iholdy": { lat: 43.2500, lng: -1.1500 },
  "Ossès": { lat: 43.2333, lng: -1.3167 },
  "Saint-Martin-d'Arberoue": { lat: 43.3000, lng: -1.1833 },
  "Saint-Palais": { lat: 43.3167, lng: -1.0333 },
  "Salies-de-Béarn": { lat: 43.4667, lng: -0.9167 },
};

// Villes affichées avec une étiquette permanente sur la carte (les autres
// restent visibles comme simples points, avec le nom au survol/clic) —
// pour garder la carte lisible malgré la cinquantaine de communes listées.
// Une par secteur environ, en priorisant les villes les plus reconnaissables.
export const VILLES_PHARES: string[] = [
  "Bayonne",
  "Biarritz",
  "Saint-Jean-de-Luz",
  "Hendaye",
  "Ainhoa",
  "Ustaritz",
  "Cambo-les-Bains",
  "Espelette",
  "Hasparren",
  "Bidache",
  "Saint-Jean-Pied-de-Port",
  "Salies-de-Béarn",
];
