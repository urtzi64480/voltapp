// Construction et modification des lignes de devis (partagé entre « Nouveau devis », l'édition
// d'un devis existant et le pré-devis) : ajout d'un produit avec son fournisseur, changement de
// fournisseur, remplacement de produit.

import { supabase } from "@/lib/supabase";
import { nomAvecConditionnement } from "@/lib/utils";
import { posteDe } from "@/lib/postes";
import { designationProduit, imageOffre, libelleOffre, offrePrincipale, prixVenteOffre } from "@/lib/fournisseurs";
import type { DevisLigne, Prestation, PrestationFournisseur } from "@/types";

export type LigneEdition = DevisLigne & { kit_description?: string | null; kit_ratio_service?: number | null };

function champsFournisseur(o?: PrestationFournisseur | null): Pick<DevisLigne, "fournisseur_id" | "fournisseur_nom" | "prix_achat"> {
  if (!o) return { fournisseur_id: null, fournisseur_nom: null, prix_achat: null };
  return { fournisseur_id: o.id, fournisseur_nom: libelleOffre(o), prix_achat: o.prix_achat ?? null };
}

// Offre à utiliser quand l'appelant n'en désigne pas : l'offre principale du produit (s'il en a).
function offreEffective(p: Prestation, offre?: PrestationFournisseur | null): PrestationFournisseur | null {
  return offre ?? offrePrincipale(p.fournisseurs) ?? null;
}

// Désignation de la ligne pour un produit et l'offre retenue : nom du produit (+ marque quand le
// produit existe en plusieurs marques — voir designationProduit) + conditionnement.
function nomLigneProduit(p: Prestation, o?: PrestationFournisseur | null): string {
  return nomAvecConditionnement(designationProduit(p, o), p.longueur_unitaire, p.sous_categorie);
}

// Ligne pour un article (non-kit). Le nom précise le conditionnement (bobine/rouleau) et sert
// de clé de regroupement : deux ajouts du même article s'additionnent (voir fusionnerLigne).
export function ligneDepuisArticle(p: Prestation, offre: PrestationFournisseur | null | undefined, poste: string | null): LigneEdition {
  const o = offreEffective(p, offre);
  return {
    nom: nomLigneProduit(p, o),
    kit_description: p.description ?? null,
    prix_unitaire: prixVenteOffre(p, o),
    quantite: 1,
    unite: p.unite,
    type_branche: p.type_branche,
    prestation_id: p.id,
    poste,
    image_url: imageOffre(p, o),
    ...champsFournisseur(o),
  };
}

// Ligne pour un kit : prix = somme des composants, ventilé service/matériau par ratio.
export async function ligneDepuisKit(p: Prestation & { kit_description?: string | null }, poste: string | null): Promise<LigneEdition> {
  const { data: composants } = await supabase
    .from("kit_composants")
    .select("*, prestation:composant_id(*)")
    .eq("kit_id", p.id)
    .order("ordre");
  const comps = composants ?? [];
  const totalComposants = comps.reduce((s: number, c: any) => s + (c.prestation?.prix_unitaire ?? 0) * c.quantite, 0);
  const totalService = comps.filter((c: any) => c.prestation?.type_branche === "service")
    .reduce((s: number, c: any) => s + (c.prestation?.prix_unitaire ?? 0) * c.quantite, 0);
  const ratioService = totalComposants > 0 ? totalService / totalComposants : 0;
  return {
    nom: p.nom,
    prix_unitaire: totalComposants,
    quantite: 1,
    unite: "forfait",
    type_branche: ratioService >= 0.5 ? "service" : "materiau",
    prestation_id: p.id,
    kit_description: p.kit_description ?? null,
    kit_ratio_service: ratioService,
    poste,
  };
}

function memeLigne(a: LigneEdition, b: LigneEdition): boolean {
  return a.prestation_id != null && a.prestation_id === b.prestation_id
    && a.nom === b.nom
    && (a.fournisseur_id ?? null) === (b.fournisseur_id ?? null)
    && posteDe(a) === posteDe(b)
    && (a.kit_ratio_service == null) === (b.kit_ratio_service == null);
}

// Ajoute la ligne, ou incrémente la quantité si la même est déjà présente dans le même poste.
export function fusionnerLigne<T extends LigneEdition>(prev: T[], nouvelle: T): T[] {
  const ex = prev.findIndex(l => memeLigne(l, nouvelle));
  if (ex >= 0) {
    const n = [...prev];
    n[ex] = { ...n[ex], quantite: n[ex].quantite + nouvelle.quantite };
    return n;
  }
  return [...prev, nouvelle];
}

// Change seulement l'offre d'une ligne : prix de vente + prix d'achat suivent l'offre ; quantité et
// poste ne bougent pas. La désignation ne change que si l'offre change de MARQUE sur un produit
// décliné en plusieurs marques (et seulement si elle n'a pas été retouchée à la main : on la compare
// à celle que l'offre actuelle aurait donnée). offre = null → « fournisseur non précisé ».
export function changerFournisseurLigne<T extends LigneEdition>(l: T, p: Prestation, offre: PrestationFournisseur | null): T {
  const actuelle = (p.fournisseurs ?? []).find(x => x.id === l.fournisseur_id) ?? null;
  const nom = l.nom === nomLigneProduit(p, actuelle) ? nomLigneProduit(p, offre) : l.nom;
  // L'image suit l'offre (chaque marque peut avoir la sienne ; sans image d'offre, celle du produit).
  return { ...l, nom, prix_unitaire: prixVenteOffre(p, offre), image_url: imageOffre(p, offre), ...champsFournisseur(offre) };
}

// Remplace le produit d'une ligne par un autre (même quantité, même poste, même description
// de pièce). Un kit n'est pas remplaçable ici (voir EditeurLignes).
export function remplacerProduitLigne<T extends LigneEdition>(l: T, p: Prestation, offre: PrestationFournisseur | null | undefined): T {
  const o = offreEffective(p, offre);
  return {
    ...l,
    nom: nomLigneProduit(p, o),
    kit_description: p.description ?? null,
    kit_ratio_service: null,
    prix_unitaire: prixVenteOffre(p, o),
    unite: p.unite,
    type_branche: p.type_branche,
    prestation_id: p.id,
    image_url: imageOffre(p, o),
    ...champsFournisseur(o),
  };
}

// Colonnes fournisseur à écrire dans devis_lignes. N'envoie les colonnes que si au moins une
// ligne en porte une (même principe que `poste`) : un devis sans fournisseur s'enregistre
// exactement comme avant, même si la migration 003 n'a pas été exécutée. Quand c'est utilisé,
// les 3 colonnes sont envoyées sur TOUTES les lignes (insertion groupée homogène).
export function colonnesFournisseur(lignes: DevisLigne[]): (l: DevisLigne) => Record<string, unknown> {
  const utilise = lignes.some(l => l.fournisseur_id || l.fournisseur_nom || l.prix_achat != null);
  return l => utilise
    ? { fournisseur_id: l.fournisseur_id ?? null, fournisseur_nom: l.fournisseur_nom ?? null, prix_achat: l.prix_achat ?? null }
    : {};
}

// Colonne image à écrire dans devis_lignes / facture_lignes. Comme pour les fournisseurs : envoyée
// seulement si au moins une ligne a une image, et alors sur TOUTES les lignes (insertion homogène).
// Un devis sans image s'enregistre exactement comme avant, même sans la migration 005.
export function colonnesImage(lignes: { image_url?: string | null }[]): (l: { image_url?: string | null }) => Record<string, unknown> {
  const utilise = lignes.some(l => !!l.image_url);
  return l => utilise ? { image_url: l.image_url ?? null } : {};
}
