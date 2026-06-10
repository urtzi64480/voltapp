export type TypeBranche = "service" | "materiau";
export type StatutDevis = "brouillon" | "envoye" | "signe" | "refuse" | "expire";
export type StatutFacture = "envoyee" | "payee" | "relance" | "impayee";
export type StatutTransmission = "en_attente" | "transmise" | "acceptee" | "rejetee";
export type StatutIntervention = "planifie" | "en_cours" | "termine" | "annule";

export interface Profil {
  id: string;
  nom_entreprise?: string;
  prenom?: string;
  nom?: string;
  siret?: string;
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
  actif: boolean;
  created_at: string;
}

export interface DevisLigne {
  id?: string;
  devis_id?: string;
  prestation_id?: string;
  nom: string;
  description?: string;
  quantite: number;
  prix_unitaire: number;
  unite: string;
  type_branche: TypeBranche;
  ordre?: number;
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
  quantite: number;
  prix_unitaire: number;
  unite: string;
  type_branche: TypeBranche;
  ordre?: number;
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
  // Relations joinées
  client?: Client;
  devis?: Devis & { factures?: Facture[] };
}
