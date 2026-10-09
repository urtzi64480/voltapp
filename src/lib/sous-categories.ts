// src/lib/sous-categories.ts
//
// Un article du catalogue peut porter PLUSIEURS sous-catégories (« nomenclatures » du pré-devis) : un même
// interrupteur peut servir de simple ET de va-et-vient. Stockage sans changer la base : le champ texte
// `sous_categorie` contient les codes séparés par « | » (ex. « interrupteur|va_et_vient »). Un article à une seule
// sous-catégorie reste une chaîne simple, donc tout l'existant continue de fonctionner. La première est la principale.

export const SEPARATEUR_SOUS_CAT = "|";

// Codes d'une valeur (chaîne stockée, ou article). Tolère aussi « , » et « ; » (saisie / CSV) ; sans doublon, ordre conservé.
export function sousCategoriesDe(v: string | { sous_categorie?: string | null } | null | undefined): string[] {
  const brut = typeof v === "string" ? v : v?.sous_categorie ?? "";
  const codes = brut.split(/[|,;]/).map(c => c.trim()).filter(Boolean);
  return Array.from(new Set(codes));
}

// Valeur à stocker pour une liste de codes ("" si vide).
export function joindreSousCategories(codes: string[]): string {
  return Array.from(new Set(codes.map(c => c.trim()).filter(Boolean))).join(SEPARATEUR_SOUS_CAT);
}

// Normalise une saisie libre (« a, b ; c ») en valeur stockée.
export function normaliserSousCategories(v: string | null | undefined): string {
  return joindreSousCategories(sousCategoriesDe(v));
}

// L'article porte-t-il cette sous-catégorie (parmi d'éventuelles autres) ?
export function aSousCategorie(p: string | { sous_categorie?: string | null } | null | undefined, code: string): boolean {
  return sousCategoriesDe(p).includes(code);
}

// Sous-catégorie principale (la première), undefined si aucune.
export function sousCategoriePrincipale(p: string | { sous_categorie?: string | null } | null | undefined): string | undefined {
  return sousCategoriesDe(p)[0];
}

// Libellé lisible pour l'affichage (« interrupteur + va_et_vient »).
export function libelleSousCategories(p: string | { sous_categorie?: string | null } | null | undefined): string {
  return sousCategoriesDe(p).join(" + ");
}
