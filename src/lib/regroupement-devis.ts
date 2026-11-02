// Présentation du devis généré depuis le pré-devis, choisie à la validation :
//  - « poste »   : comme chiffré dans le pré-devis — un poste par pièce ou par circuit (selon le mode déjà choisi) ;
//  - « produit » : une seule ligne par produit, quantités additionnées sur tout le projet, sans postes ni pièces.
//
// Module PUR (aucun accès réseau). Le regroupement se fait APRÈS l'assemblage des lignes (consommables, main d'œuvre,
// frais généraux, déplacement) : les frais généraux et les totaux sont donc calculés exactement comme avant.

import type { DevisLigne } from "@/types";

export type RegroupementDevis = "poste" | "produit";
export type LigneGeneree = Omit<DevisLigne, "devis_id" | "ordre">;

// Les quantités fractionnaires (heures) s'additionnent sans résidu de virgule flottante (0,1 + 0,2).
const arrondiQuantite = (q: number) => Math.round(q * 10000) / 10000;

// Deux lignes sont « le même produit » seulement si tout ce qui détermine ce qui est facturé et acheté est identique :
// produit du catalogue, désignation, unité, branche, prix de vente, fournisseur retenu, prix d'achat, image.
// Deux lignes qui diffèrent sur l'un de ces points ne sont jamais fusionnées (aucun prix n'est écrasé).
// Le poste, la quantité et la description (pièce d'origine) n'entrent pas dans la clé.
export function cleProduit(l: LigneGeneree): string {
  return JSON.stringify([
    l.prestation_id ?? null, l.nom, l.unite, l.type_branche, l.prix_unitaire,
    l.fournisseur_id ?? null, l.fournisseur_nom ?? null, l.prix_achat ?? null, l.image_url ?? null,
    l.kit_ratio_service ?? null, l.kit_description ?? null,
  ]);
}

// Fusionne les lignes qui sont le même produit : quantités additionnées, ordre de première apparition conservé, poste retiré.
// Les pièces / circuits d'origine ne sont PAS repris : la ligne ne porte aucune description (le devis reste lisible).
// Les lignes « À compléter » restent des lignes « À compléter » (même désignation, 0 €). Ne modifie pas l'entrée.
export function regrouperParProduit(lignes: LigneGeneree[]): LigneGeneree[] {
  const sortie: LigneGeneree[] = [];
  const indexParCle = new Map<string, number>();
  lignes.forEach(l => {
    const cle = cleProduit(l);
    const i = indexParCle.get(cle);
    if (i === undefined) {
      indexParCle.set(cle, sortie.length);
      const { description: _origine, ...reste } = l;
      void _origine;
      sortie.push({ ...reste, poste: null });
      return;
    }
    sortie[i] = { ...sortie[i], quantite: arrondiQuantite(sortie[i].quantite + l.quantite) };
  });
  return sortie;
}

// Point d'entrée de la page : « poste » rend les lignes telles quelles (comportement historique, inchangé).
export function appliquerRegroupement(lignes: LigneGeneree[], regroupement: RegroupementDevis): LigneGeneree[] {
  return regroupement === "produit" ? regrouperParProduit(lignes) : lignes;
}

// Libellé de la présentation (pour l'affichage), selon le mode de chiffrage du pré-devis.
export function libellePresentation(regroupement: RegroupementDevis, mode: "piece" | "circuit" | null): string {
  if (regroupement === "produit") return "regroupé par produits";
  return mode === "circuit" ? "un poste par circuit" : "un poste par pièce";
}
