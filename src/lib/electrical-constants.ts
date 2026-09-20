// src/lib/electrical-constants.ts
//
// Constantes et helpers NF C 15-100 partagés entre le module Tableau électrique
// et le module Plan de circuits (maison). Source de vérité unique — ne pas
// redéfinir ces dictionnaires localement dans une page.
//
// Extrait à l'identique de /tableau/[clientId]/page.tsx (version la plus
// complète des deux pages existantes — /tableau/page.tsx utilisait une copie
// partielle et désynchronisée du même dictionnaire CIRCUITS).

export type CommandeType = "simple" | "vav" | "telerupteur";
export type CircuitCategory = "lumiere" | "prises";

export interface GroupeLumineux {
  nbPoints: number;
  typeCommande: CommandeType;
  nbCommandes: number;
}

export interface PieceConfig {
  nom: string;
  groupes: GroupeLumineux[];
  nbPrises: number;
}

export interface Breaker {
  id: number;
  label: string;
  circuit: string;
  amperes: number;
  type: string;
  customSection?: string;
  pieces: PieceConfig[];
  // Rempli par le module Plan quand ce circuit provient d'un CircuitManuel (voir
  // maison-types.ts / maison-engine.ts) — id stable, permet de retrouver sa couleur/son
  // nom d'un niveau même après régénération. Ignoré ailleurs (module Tableau).
  manuelId?: number;
}

export interface BreakerRow {
  id: number;
  name: string;
  slots: (Breaker | null)[];
  // Tag posé par le module Plan sur les rangées qu'il génère — permet à un nouveau
  // "pousser vers le tableau" de remplacer proprement ce lot au lieu de le dupliquer,
  // sans jamais toucher aux rangées créées à la main dans l'éditeur de tableau.
  origine?: "plan";
}

export const BREAKER_TYPES: Record<string, { label: string; width: number; desc: string; isDiff?: boolean; diffType?: string }> = {
  "1P":      { label: "1P",    width: 1, desc: "Unipolaire" },
  "2P":      { label: "2P",    width: 2, desc: "Bipolaire" },
  "diff-AC": { label: "ID AC", width: 2, desc: "Différentiel Type AC", isDiff: true, diffType: "AC" },
  "diff-A":  { label: "ID A",  width: 2, desc: "Différentiel Type A",  isDiff: true, diffType: "A"  },
  "diff-F":  { label: "ID F",  width: 2, desc: "Différentiel Type F",  isDiff: true, diffType: "F"  },
};

export const CIRCUITS: Record<string, {
  label: string; icon: string; ampMax: number; dedié: boolean;
  diffType: string | null; section: string | null; category: CircuitCategory | null;
}> = {
  lumiere:         { label: "Lumière",          icon: "💡", ampMax: 10, dedié: false, diffType: "AC", section: "1.5", category: "lumiere" },
  prise_16:        { label: "Prises 16A",       icon: "🔌", ampMax: 16, dedié: false, diffType: "AC", section: "1.5", category: "prises" },
  prise_20:        { label: "Prises 20A",       icon: "🔌", ampMax: 20, dedié: false, diffType: "AC", section: "2.5", category: "prises" },
  cuisine_prises:  { label: "Prises cuisine",   icon: "🍳", ampMax: 20, dedié: false, diffType: "AC", section: "2.5", category: "prises" },
  plaque:          { label: "Plaque cuisson",   icon: "🔥", ampMax: 32, dedié: true,  diffType: "A",  section: "6.0", category: null },
  four:            { label: "Four",             icon: "🥘", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5", category: null },
  lave_linge:      { label: "Lave-linge",       icon: "🧺", ampMax: 20, dedié: true,  diffType: "A",  section: "2.5", category: null },
  lave_vaisselle:  { label: "Lave-vaisselle",   icon: "🍽️", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5", category: null },
  seche_linge:     { label: "Sèche-linge",      icon: "👕", ampMax: 20, dedié: true,  diffType: "A",  section: "2.5", category: null },
  chauffe_eau:     { label: "Chauffe-eau",      icon: "🚿", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5", category: null },
  chauffage:       { label: "Chauffage élec.",  icon: "🌡️", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5", category: null },
  clim:            { label: "Climatisation",    icon: "❄️", ampMax: 20, dedié: true,  diffType: "F",  section: "2.5", category: null },
  seche_serviette: { label: "Sèche-serviette",  icon: "🛁", ampMax: 16, dedié: true,  diffType: "AC", section: "1.5", category: null },
  congelateur:     { label: "Congélateur",      icon: "🧊", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5", category: null },
  irve:            { label: "IRVE (recharge)",  icon: "🔋", ampMax: 32, dedié: true,  diffType: "A",  section: "6.0", category: null },
  piscine:         { label: "Piscine/PAC",      icon: "🏊", ampMax: 20, dedié: true,  diffType: "F",  section: "2.5", category: null },
  vmc:             { label: "VMC",              icon: "💨", ampMax: 10, dedié: true,  diffType: "AC", section: "1.5", category: null },
  alarme:          { label: "Alarme",           icon: "🔔", ampMax: 6,  dedié: true,  diffType: "AC", section: "1.5", category: null },
  exterieur:       { label: "Extérieur",        icon: "🌿", ampMax: 16, dedié: false, diffType: "AC", section: "1.5", category: "prises" },
  garage:          { label: "Garage",           icon: "🏠", ampMax: 16, dedié: false, diffType: "AC", section: "1.5", category: "prises" },
  general:         { label: "Général / Arrivée",icon: "⚡", ampMax: 63, dedié: true,  diffType: null, section: "10.0", category: null },
  parafoudre:      { label: "Parafoudre",       icon: "⛈️", ampMax: 0,  dedié: true,  diffType: null, section: null,  category: null },
  autre:           { label: "Autre",            icon: "⚙️", ampMax: 32, dedié: false, diffType: "AC", section: "2.5", category: null },
};

export const SECTIONS_CABLE = ["1.5", "2.5", "4.0", "6.0", "10.0"];

export const CABLE_DIAM_MM: Record<string, number> = {
  "1.5": 6.8, "2.5": 7.8, "4.0": 9.0, "6.0": 10.5, "10.0": 13.0,
};

export const GAINES_IRL = [
  { label: "IRL 16", diamInt: 12.2 },
  { label: "IRL 20", diamInt: 15.8 },
  { label: "IRL 25", diamInt: 20.0 },
  { label: "IRL 32", diamInt: 26.0 },
  { label: "IRL 40", diamInt: 33.0 },
];

export const DIFF_HIERARCHY: Record<string, number> = { AC: 0, A: 1, F: 2 };
export const AMPERES = [2, 6, 10, 16, 20, 25, 32, 40, 63];

// Seuils de regroupement par circuit — alignés sur le compliance checker (checkNFC)
// déjà en place dans /tableau/[clientId]/page.tsx (règles socles16 / socles20).
export const MAX_PAR_CIRCUIT: Record<string, number> = {
  lumiere: 8,          // points lumineux — Art. 771.312
  prise_16: 8,         // socles — Art. 771.314
  exterieur: 8,
  garage: 8,
  cuisine_prises: 6,   // socles cuisine — Art. 771.314.2
  prise_20: 6,
};

// Minimums réglementaires de socles par pièce — NF C 15-100, quantitatif socles de prise.
export const MIN_PRISES_PIECE: Record<string, (surface?: number) => number> = {
  sejour:  (s) => (s && s > 28 ? Math.max(7, Math.ceil(s / 4)) : 5),
  chambre: () => 3,
  cuisine: () => 6,
  autre:   (s) => (s && s >= 4 ? 1 : 0),
};

export function gaineRecommandee(sections: string[]): { gaine: string; tauxPct: number; ok: boolean } {
  const totalSection = sections.reduce((sum, s) => {
    const d = CABLE_DIAM_MM[s] ?? 8;
    return sum + Math.PI * (d / 2) ** 2;
  }, 0);
  for (const g of GAINES_IRL) {
    const sectionInt = Math.PI * (g.diamInt / 2) ** 2;
    const taux = Math.round((totalSection / sectionInt) * 100);
    if (taux <= 33) return { gaine: g.label, tauxPct: taux, ok: true };
  }
  const last = GAINES_IRL[GAINES_IRL.length - 1];
  const sectionInt = Math.PI * (last.diamInt / 2) ** 2;
  return { gaine: last.label + " (insuffisant)", tauxPct: Math.round((totalSection / sectionInt) * 100), ok: false };
}

export function cablesGroupe(groupe: GroupeLumineux, section: string): string[] {
  const cables: string[] = [section, section, section];
  if (groupe.typeCommande === "simple") {
    cables.push("1.5");
  } else if (groupe.typeCommande === "vav") {
    cables.push("1.5", "1.5");
  } else {
    for (let i = 0; i < groupe.nbCommandes; i++) cables.push("1.5");
    cables.push("1.5");
  }
  return cables;
}

export function cablesPrises(section: string): string[] {
  return [section, section, section];
}

export function labelCommande(g: GroupeLumineux): string {
  if (g.typeCommande === "simple") return "Simple allumage";
  if (g.typeCommande === "vav") return `Va-et-vient (${g.nbCommandes} inter.)`;
  return `Télérupteur (${g.nbCommandes} BP)`;
}

export function getCategory(circuit: string): CircuitCategory | null {
  return CIRCUITS[circuit]?.category ?? null;
}

export function effectiveSection(b: Breaker): string {
  return b.customSection ?? CIRCUITS[b.circuit]?.section ?? "2.5";
}

let _uidCounter = 0;
export const uid = (): number => ++_uidCounter;
