// Jeux de données minimaux et typés pour les tests (les champs non pertinents sont des valeurs neutres).
import type { Client, Facture, FactureLigne, Prestation, PrestationFournisseur, Profil } from "@/types";

export const profilComplet = (o: Partial<Profil> = {}): Profil => ({
  id: "p1", nom_entreprise: "Elektron", prenom: "Ben", nom: "Test", siret: "123 456 789 00012", numero_tva: "FR12 345678901",
  telephone: "0600000000", email: "ben@test.fr", adresse: "1 rue des Lilas", code_postal: "64100", ville: "Bayonne",
  prefixe_devis: "DEV", prefixe_facture: "FAC", compteur_devis: 0, compteur_facture: 0,
  mention_tva: "TVA non applicable, art. 293 B du CGI", conditions_paiement: "Paiement à réception", taux_horaire: 55,
  iban: "FR76 3000 6000 0112 3456 7890 189", bic: "agrifrpp", ...o,
});

export const clientComplet = (o: Partial<Client> = {}): Client => ({
  id: "c1", user_id: "u1", nom: "Dupont", prenom: "Jean", email: "jean@test.fr", adresse: "2 rue Haute", code_postal: "64200",
  ville: "Biarritz", type_client: "particulier", created_at: "2026-01-01", updated_at: "2026-01-01", ...o,
});

export const ligneFacture = (o: Partial<FactureLigne> = {}): FactureLigne => ({
  nom: "Prise 2P+T", quantite: 1, prix_unitaire: 10, unite: "u", type_branche: "materiau", ordre: 0, ...o,
});

export const facture = (o: Partial<Facture> = {}): Facture => ({
  id: "f1", user_id: "u1", numero: "FAC-2026-001", date_emission: "2026-10-31", date_echeance: "2026-11-30", statut: "envoyee",
  total_service: 0, total_materiau: 0, total_ttc: 0, created_at: "2026-10-31", updated_at: "2026-10-31",
  client: clientComplet(), lignes: [], ...o,
});

export const prestation = (o: Partial<Prestation> = {}): Prestation => ({
  id: "pr1", user_id: "u1", nom: "Prise 2P+T", prix_unitaire: 10, unite: "u", type_branche: "materiau", categorie: "Appareillage",
  actif: true, created_at: "2026-01-01", ...o,
});

export const offre = (o: Partial<PrestationFournisseur> = {}): PrestationFournisseur => ({
  id: "o1", prestation_id: "pr1", fournisseur: "Rexel", principal: false, ...o,
});
