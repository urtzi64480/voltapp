// src/lib/sauvegarde.ts — sauvegarde complète des données de l'électricien dans un fichier JSON.
// Les tables sont lues avec la session de l'utilisateur (RLS) par pages de 1000 lignes. Les secrets (mot de passe d'application
// Apple, abonnements push) et les journaux techniques (limites de débit) ne sont pas exportés.
export const TABLES_SAUVEGARDE = [
  "profil", "clients", "prestations", "kit_composants", "prestation_fournisseurs", "devis", "devis_lignes", "factures", "facture_lignes",
  "acomptes", "interventions", "projets", "rdv", "demandes", "demandes_client", "realisations", "apporteurs",
  "paliers_apporteur", "paliers_fidelite", "demande_visites", "demande_clics",
] as const;

export interface FichierSauvegarde {
  version: 1;
  genere_le: string;
  tables: Record<string, unknown[]>;
  erreurs: Record<string, string>;
  comptes: Record<string, number>;
}

type Page = (table: string, de: number, a: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
const TAILLE = 1000;

/** Lit toutes les tables ; une table illisible est consignée dans `erreurs` sans interrompre la sauvegarde. */
export async function collecter(lirePage: Page, tables: readonly string[] = TABLES_SAUVEGARDE, maintenant = new Date()): Promise<FichierSauvegarde> {
  const f: FichierSauvegarde = { version: 1, genere_le: maintenant.toISOString(), tables: {}, erreurs: {}, comptes: {} };
  for (const t of tables) {
    const lignes: unknown[] = [];
    for (let de = 0; ; de += TAILLE) {
      const { data, error } = await lirePage(t, de, de + TAILLE - 1);
      if (error) { f.erreurs[t] = error.message; break; }
      lignes.push(...(data ?? []));
      if (!data || data.length < TAILLE) break;
    }
    if (!f.erreurs[t]) { f.tables[t] = lignes; f.comptes[t] = lignes.length; }
  }
  return f;
}

export const nomFichierSauvegarde = (d = new Date()) =>
  `voltapp-sauvegarde-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
