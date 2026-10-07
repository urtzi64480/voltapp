export type TypeBranche = "service" | "materiau";
export type StatutDevis = "brouillon" | "envoye" | "signe" | "refuse" | "expire";
export type StatutFacture = "a_envoyer" | "envoyee" | "payee" | "relance" | "impayee";
export type StatutTransmission = "en_attente" | "transmise" | "acceptee" | "rejetee";
export type StatutIntervention = "planifie" | "en_cours" | "termine" | "annule";
export type StatutDemande = "nouveau" | "vu" | "converti";
export type TypeClient = "particulier" | "professionnel";
// Niveau de gamme d'un article catalogue — permet de proposer jusqu'à 3 prix différents
// (entrée/moyenne/haut de gamme) pour un même besoin identifié sur le plan (voir
// predevis-engine.ts). Optionnel : un article sans gamme reste utilisable comme option
// unique si aucun article "gammé" n'existe pour sa sous_categorie.
export type Gamme = "entree" | "moyenne" | "haut";

export interface Profil {
  id: string;
  nom_entreprise?: string;
  prenom?: string;
  nom?: string;
  siret?: string;
  // N° de TVA intracommunautaire (FRxx + SIREN) — requis par les plateformes pour
  // une facture électronique B2B en franchise en base (règle EN 16931 BR-E-02)
  numero_tva?: string;
  telephone?: string;
  email?: string;
  adresse?: string;
  code_postal?: string;
  ville?: string;
  prefixe_devis: string;
  prefixe_facture: string;
  compteur_devis: number;
  compteur_facture: number;
  mention_tva: string;
  conditions_paiement: string;
  taux_horaire: number;
  taux_cotisations_service?: number;
  taux_cotisations_materiau?: number;
  taux_ir_service?: number;
  taux_ir_materiau?: number;
  iban?: string;
  bic?: string;
  banque_nom?: string;
  banque_titulaire?: string;
}

export interface Client {
  id: string;
  user_id: string;
  nom: string;
  prenom?: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  code_postal?: string;
  ville?: string;
  type_client: TypeClient;
  siret_client?: string;
  type_logement?: string;
  annee_construction?: number;
  surface_m2?: number;
  tableau_marque?: string;
  tableau_config?: string;
  code_acces?: string;
  contact_prefere?: string;
  disponibilites?: string;
  notes?: string;
  tags?: string[];
  statut?: string;
  source?: string;
  photos?: string[];
  // Contient un JSON { niveaux: Niveau[] } — le plan de circuits (maison-types.ts). Utilisé
  // par le module pré-devis pour retrouver la géométrie (câbles, boîtes, appareillages).
  maison_config?: string;
  // Brouillon du pré-devis en cours (choix de gamme/article/champ libre par besoin, heures
  // de main d'œuvre, frais généraux, déplacement) — JSON, voir predevis/[clientId]/page.tsx.
  // Écrasé à chaque sauvegarde du brouillon ; sans lien avec un devis déjà validé.
  predevis_config?: string;
  created_at: string;
  updated_at: string;
}

export interface Prestation {
  id: string;
  user_id: string;
  nom: string;
  description?: string;
  prix_unitaire: number;
  unite: string;
  type_branche: TypeBranche;
  categorie: string;
  sous_categorie?: string;
  marque?: string;
  image_url?: string;
  liens_fournisseurs?: string[];
  prix_achat?: number | null;
  actif: boolean;
  // Niveau de gamme (voir type Gamme ci-dessus) — pour le pré-devis, non requis ailleurs.
  gamme?: Gamme | null;
  // Longueur (mètres) d'une bobine/barre de longueur fixe (câble, gaine, moulure) —
  // absent/null = article vendu au mètre linéaire (utilisé pour compléter un reliquat).
  longueur_unitaire?: number | null;
  // Rempli côté client uniquement pour les kits (voir catalogue/page.tsx PrestationExt) —
  // n'existe pas réellement dans la table `prestations` mais évite de dupliquer le type
  // localement dans le module pré-devis.
  est_kit?: boolean;
  // Offres fournisseurs (table prestation_fournisseurs) — rempli côté client uniquement par
  // attacherFournisseurs() (src/lib/fournisseurs.ts). Absent = pas encore chargé / aucun.
  fournisseurs?: PrestationFournisseur[];
  created_at: string;
}

// Une offre fournisseur pour un même produit : un fournisseur, un prix d'achat (TTC, comme
// prestations.prix_achat) et un prix de vente HT. prix_vente null = on garde le prix de vente
// de la prestation. Une seule offre est « principale » : elle est recopiée dans
// prestations.prix_achat / prix_unitaire / liens_fournisseurs, pour que tout le code qui lit
// ces colonnes (CRM, rentabilité, moteur pré-devis) continue de fonctionner tel quel.
// Une pièce à acheter chez un fournisseur pour constituer l'article fini d'une offre (ex. mécanisme +
// enjoliveur). Prix d'achat TTC UNITAIRE ; quantité = nombre de pièces pour UN article fini.
export interface PieceOffre {
  nom: string;
  reference?: string | null;
  quantite: number;
  prix_achat?: number | null;
}

export interface PrestationFournisseur {
  id: string;
  user_id?: string;
  prestation_id: string;
  fournisseur: string;
  reference?: string | null;
  url?: string | null;
  prix_achat?: number | null;
  prix_vente?: number | null;
  principal: boolean;
  ordre?: number | null;
  // Pièces à acheter pour constituer l'article fini chez ce fournisseur (colonne jsonb, migration 004).
  // Si présentes, prix_achat = somme(quantite × prix_achat des pièces).
  pieces?: PieceOffre[] | null;
  created_at?: string;
}

export interface DevisLigne {
  id?: string;
  devis_id?: string;
  prestation_id?: string;
  nom: string;
  description?: string;
  kit_description?: string | null;
  kit_groupe?: string;
  kit_ratio_service?: number | null;
  quantite: number;
  prix_unitaire: number;
  unite: string;
  type_branche: TypeBranche;
  ordre?: number;
  // Nom du poste (regroupement libre dans le devis) — null/absent = ligne hors poste.
  poste?: string | null;
  // Fournisseur retenu pour cette ligne (photo au moment du choix) : le prix d'achat est
  // celui de CE fournisseur, utilisé par la rentabilité à la place du prix_achat catalogue.
  fournisseur_id?: string | null;
  fournisseur_nom?: string | null;
  prix_achat?: number | null;
  // Image du produit au moment de l'ajout (photo, reprise sur la facture).
  image_url?: string | null;
}

export interface Devis {
  id: string;
  user_id: string;
  client_id?: string;
  numero: string;
  objet?: string;
  date_emission: string;
  date_validite?: string;
  statut: StatutDevis;
  total_service: number;
  total_materiau: number;
  total_ttc: number;
  remise_type?: "pct" | "euro";
  remise_valeur?: number;
  remise_fidelite_pct?: number;
  signe_le?: string;
  signature_data?: string;
  acompte_pct?: number;
  acompte_paye?: boolean;
  notes_internes?: string;
  created_at: string;
  updated_at: string;
  client?: Client;
  lignes?: DevisLigne[];
}

export interface FactureLigne {
  id?: string;
  facture_id?: string;
  nom: string;
  description?: string;
  kit_description?: string;
  quantite: number;
  prix_unitaire: number;
  unite: string;
  type_branche: TypeBranche;
  ordre?: number;
  // Nom du poste (regroupement d'affichage, repris du devis) — absent = ligne hors poste.
  poste?: string | null;
  image_url?: string | null;
}

export interface Facture {
  id: string;
  user_id: string;
  devis_id?: string;
  client_id?: string;
  numero: string;
  objet?: string;
  date_emission: string;
  date_echeance?: string;
  statut: StatutFacture;
  total_service: number;
  total_materiau: number;
  total_ttc: number;
  remise_fidelite_pct?: number;
  paye_le?: string;
  moyen_paiement?: string;
  notes_internes?: string;
  statut_transmission?: StatutTransmission;
  id_transmission?: string;
  date_transmission?: string;
  created_at: string;
  updated_at: string;
  client?: Client;
  lignes?: FactureLigne[];
}

export interface PalierFidelite {
  id: string;
  label: string;
  seuil_min: number;
  seuil_max?: number;
  remise_pct: number;
  couleur: string;
}

export interface Intervention {
  id: string;
  user_id: string;
  client_id?: string;
  devis_id?: string;
  titre: string;
  description?: string;
  adresse_chantier?: string;
  date_debut: string;
  date_fin: string;
  statut: StatutIntervention;
  photos?: string[];
  notes?: string;
  created_at: string;
  updated_at: string;
  client?: Client;
  devis?: Devis & { factures?: Facture[] };
}

export interface DemandeClient {
  id: string;
  created_at: string;
  statut: StatutDemande;
  nom: string;
  telephone: string;
  email?: string;
  adresse_chantier: string;
  type_travaux: string[];
  description?: string;
  photos: string[];
  disponibilites?: string;
  client_id?: string;
  user_id: string;
}

// Un projet = un logement / chantier d'un client. Porte son propre plan de circuits
// (maison_config), son tableau (tableau_config) et son brouillon de pré-devis.
export interface Projet {
  id: string;
  user_id: string;
  client_id: string;
  nom: string;
  adresse?: string | null;
  maison_config?: string | null;
  tableau_config?: string | null;
  predevis_config?: string | null;
  // JSON [{ id, nom, rows }] — tableaux annexes (pool house, garage…) ; le principal reste
  // dans tableau_config. Voir lireAnnexes / sauverAnnexes (src/lib/projets.ts).
  tableaux_annexes?: string | null;
  created_at: string;
  updated_at: string;
}
