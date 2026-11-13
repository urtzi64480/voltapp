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
// Lignes « à compléter » : un besoin du pré-devis sans produit ni prix devient une ligne à 0 € portant ce
// préfixe, pour que le manque reste visible dans le devis (et empêche de l'envoyer par erreur).
export const PREFIXE_A_COMPLETER = "À compléter — ";
// Une ligne n'est « à compléter » (bloquante) que tant qu'elle n'a pas de prix : dès qu'un prix unitaire est saisi, elle ne bloque plus
// l'envoi ni la signature (son libellé peut rester tel quel ou être renommé).
export function estLigneACompleter(l: { nom?: string | null; prix_unitaire?: number | string | null }): boolean {
  return (l.nom ?? "").startsWith(PREFIXE_A_COMPLETER) && !(Number(l.prix_unitaire) > 0);
}
// Libellé à afficher / enregistrer : dès qu'un prix est saisi, le préfixe « À compléter — » (et la mention « à définir avec le client »)
// disparaît ; tant qu'il n'y a pas de prix, le libellé reste inchangé.
export function nomLigneSansACompleter(l: { nom?: string | null; prix_unitaire?: number | string | null }): string {
  const nom = l.nom ?? "";
  if (!nom.startsWith(PREFIXE_A_COMPLETER) || !(Number(l.prix_unitaire) > 0)) return nom;
  const propre = nom.slice(PREFIXE_A_COMPLETER.length).replace(/\s*\(à définir avec le client\)\s*$/i, "").trim();
  return propre || nom;
}
export function nbLignesACompleter(lignes: { nom?: string | null; prix_unitaire?: number | string | null }[]): number {
  return lignes.filter(estLigneACompleter).length;
}

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
  const { data: composants, error } = await supabase
    .from("kit_composants")
    .select("*, prestation:composant_id(*)")
    .eq("kit_id", p.id)
    .order("ordre");
  // Une lecture en échec ne doit pas produire un kit à 0 € ajouté en silence au devis.
  if (error) throw new Error(`Lecture des composants du kit impossible : ${error.message}`);
  const comps = composants ?? [];
  const totalComposants = comps.reduce((s: number, c: any) => s + (c.prestation?.prix_unitaire ?? 0) * c.quantite, 0);
  const totalService = comps.filter((c: any) => c.prestation?.type_branche === "service")
    .reduce((s: number, c: any) => s + (c.prestation?.prix_unitaire ?? 0) * c.quantite, 0);
  const ratioService = totalComposants > 0 ? totalService / totalComposants : 0;
  return {
    nom: p.nom,
    prix_unitaire: Math.round(totalComposants * 100) / 100,
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

// Photos des produits visibles sur ce devis ? (colonne devis.afficher_photos, migration 016 ; absente ou null = oui)
export const photosAffichees = (d?: { afficher_photos?: boolean | null } | null) => d?.afficher_photos !== false;

// ─── Synchronisation avec le catalogue ─────────────────────────────────────────────────────────────────
// Une ligne de devis est une COPIE du produit au moment de l'ajout. Quand le catalogue change (nom, description, photo, nom du fournisseur,
// prix d'achat), les devis qui ne sont pas encore signés suivent. Ne suivent PAS le catalogue :
//   · le prix de vente : une ligne peut avoir été négociée à la main, et le prix d'un devis envoyé est celui que le client a vu — le nouveau
//     prix est seulement PROPOSÉ (appliquerPrixCatalogue, à la demande) ;
//   · l'unité et le type (service / matériau) : ils donnent son sens à la quantité et au prix de la ligne (40 « m » ne deviennent pas 40 « bobines »).
//   · un devis signé, refusé ou expiré : c'est un document figé.
// Le nom et la description ne sont repris que si le produit a été modifié APRÈS le dernier enregistrement du devis : un libellé retouché
// ou ancien n'est donc pas écrasé tant que le catalogue n'a pas bougé.
export type ChampLigne = "nom" | "kit_description" | "image_url" | "fournisseur_nom" | "prix_achat";
export interface ChangementLigne { index: number; nom: string; champs: ChampLigne[] }
export interface PrixCatalogueDiff { index: number; nom: string; actuel: number; catalogue: number }
export interface ResultatSync<T> { lignes: T[]; changements: ChangementLigne[]; prix: PrixCatalogueDiff[] }

const CHAMPS_SYNC: ChampLigne[] = ["nom", "kit_description", "image_url", "fournisseur_nom", "prix_achat"];
/** Champs qu'un statut de devis autorise à suivre le catalogue. */
export const champsSynchronisables = (statut?: string | null): ChampLigne[] => (statut === "brouillon" || statut === "envoye" || statut === "a_refaire" ? CHAMPS_SYNC : []);
/** Le nouveau prix du catalogue se propose tant que le devis n'est ni signé, ni refusé, ni expiré. */
export const prixProposable = (statut?: string | null): boolean => statut === "brouillon" || statut === "envoye" || statut === "a_refaire";
/** Appliquer le prix du catalogue modifie le devis envoyé : réservé au brouillon et au devis à refaire. */
export const prixApplicable = (statut?: string | null): boolean => statut === "brouillon" || statut === "a_refaire";

const egal = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null);
const plusRecent = (a?: string | null, b?: string | null): boolean => {
  const ta = a ? Date.parse(a) : NaN, tb = b ? Date.parse(b) : NaN;
  return Number.isNaN(ta) || Number.isNaN(tb) ? true : ta > tb; // date inconnue : on suppose le produit modifié (le plus sûr pour suivre le catalogue)
};

export function synchroniserAvecCatalogue<T extends LigneEdition>(
  lignes: T[], parId: Map<string, Prestation>, statut?: string | null, devisMajLe?: string | null,
): ResultatSync<T> {
  const autorises = new Set(champsSynchronisables(statut));
  const changements: ChangementLigne[] = [];
  const prix: PrixCatalogueDiff[] = [];
  const sortie = lignes.map((l, index) => {
    const p = l.prestation_id ? parId.get(l.prestation_id) : undefined;
    if (!p || estLigneACompleter(l)) return l;
    const kit = l.kit_ratio_service != null;
    // Offre de la ligne : retrouvée par son identifiant ; « non précisé » = aucune ; offre disparue du catalogue = on n'y touche pas.
    const offre = l.fournisseur_id ? (p.fournisseurs ?? []).find(o => o.id === l.fournisseur_id) ?? "disparue" : null;
    const produitModifie = plusRecent((p as Prestation & { updated_at?: string | null }).updated_at, devisMajLe);
    const voulu: Partial<Record<ChampLigne, unknown>> = {};
    if (kit) {
      if (produitModifie) {
        voulu.nom = p.nom;
        voulu.kit_description = (p as Prestation & { kit_description?: string | null }).kit_description ?? p.description ?? null;
      }
    } else if (offre !== "disparue") {
      if (produitModifie) { voulu.nom = nomLigneProduit(p, offre); voulu.kit_description = p.description ?? null; }
      voulu.image_url = imageOffre(p, offre);
      if (offre) { voulu.fournisseur_nom = libelleOffre(offre); voulu.prix_achat = offre.prix_achat ?? null; } // sans offre choisie : on ne touche pas au fournisseur saisi
      const cat = prixVenteOffre(p, offre);
      if (prixProposable(statut) && Math.abs(cat - l.prix_unitaire) > 0.005) prix.push({ index, nom: l.nom, actuel: l.prix_unitaire, catalogue: cat });
    } else if (produitModifie) {
      voulu.kit_description = p.description ?? null; // l'offre n'existe plus : la description du produit suit, le reste (nom, fournisseur, prix) reste tel quel
    }
    const patch: Partial<Record<ChampLigne, unknown>> = {};
    for (const c of Object.keys(voulu) as ChampLigne[]) {
      if (autorises.has(c) && !egal(l[c as keyof T], voulu[c])) patch[c] = voulu[c];
    }
    const champs = Object.keys(patch) as ChampLigne[];
    if (champs.length === 0) return l;
    changements.push({ index, nom: (patch.nom as string | undefined) ?? l.nom, champs });
    return { ...l, ...patch } as T;
  });
  return { lignes: sortie, changements, prix };
}

/** Applique les prix du catalogue relevés par synchroniserAvecCatalogue (à la demande de l'utilisateur seulement). */
export function appliquerPrixCatalogue<T extends LigneEdition>(lignes: T[], prix: PrixCatalogueDiff[]): T[] {
  const parIndex = new Map(prix.map(p => [p.index, p.catalogue]));
  return lignes.map((l, i) => (parIndex.has(i) ? { ...l, prix_unitaire: parIndex.get(i) as number } : l));
}
