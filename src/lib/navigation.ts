// src/lib/navigation.ts — rubriques du menu latéral et page active (pur, testé).
export interface ItemMenu { href: string; label: string }
export interface RubriqueMenu { nom: string; items: ItemMenu[] }

export const RUBRIQUES: RubriqueMenu[] = [
  { nom: "Ventes", items: [
    { href: "/clients", label: "Clients" }, { href: "/leads", label: "Leads web" }, { href: "/demandes", label: "Demandes" },
    { href: "/rdv", label: "RDV" }, { href: "/devis", label: "Devis" }, { href: "/factures", label: "Factures" },
  ] },
  { nom: "Chantier", items: [
    { href: "/planning", label: "Planning" }, { href: "/plan", label: "Plans interventions" }, { href: "/tableau", label: "Tableaux" },
    { href: "/realisations", label: "Réalisations" }, { href: "/entretiens", label: "Rappels d'entretien" },
  ] },
  { nom: "Pilotage", items: [
    { href: "/crm", label: "CRM" }, { href: "/rentabilite", label: "Rentabilité" }, { href: "/export-comptable", label: "Livre des recettes" },
  ] },
  { nom: "Outils", items: [
    { href: "/catalogue", label: "Catalogue" }, { href: "/sauvegarde", label: "Sauvegarde" }, { href: "/parametres", label: "Paramètres" },
  ] },
];

/** « /plan » ne doit pas s'allumer sur « /planning » : correspondance exacte ou sous-chemin. */
export const estActif = (path: string, href: string): boolean => path === href || path.startsWith(href + "/");

export const rubriqueDe = (path: string, rubriques: RubriqueMenu[] = RUBRIQUES): string | null =>
  rubriques.find(r => r.items.some(i => estActif(path, i.href)))?.nom ?? null;

/** Lecture tolérante de la liste des rubriques ouvertes mémorisée. */
export function lireOuvertes(brut: string | null, rubriques: RubriqueMenu[] = RUBRIQUES): string[] | null {
  if (!brut) return null;
  try {
    const v = JSON.parse(brut);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && rubriques.some(r => r.nom === x)) : null;
  } catch { return null; }
}
