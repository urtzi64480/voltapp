// src/lib/restauration.ts — restauration depuis un fichier de sauvegarde (voir sauvegarde.ts).
// Mode « fusion » : chaque ligne du fichier est réécrite par son identifiant (upsert). Rien n'est supprimé : les données créées
// depuis la sauvegarde restent. Les compteurs de numérotation du profil ne sont jamais ramenés en arrière (pas de numéros en double).
import { TABLES_SAUVEGARDE, type FichierSauvegarde } from "./sauvegarde";

export type LectureSauvegarde = { ok: true; fichier: FichierSauvegarde } | { ok: false; message: string };

export function lireSauvegarde(texte: string): LectureSauvegarde {
  let brut: unknown;
  try { brut = JSON.parse(texte); } catch { return { ok: false, message: "Ce fichier n'est pas une sauvegarde VoltApp (JSON illisible)." }; }
  const f = brut as Partial<FichierSauvegarde> | null;
  if (!f || typeof f !== "object" || f.version !== 1 || !f.tables || typeof f.tables !== "object" || Array.isArray(f.tables))
    return { ok: false, message: "Ce fichier n'est pas une sauvegarde VoltApp (format inconnu)." };
  const tables: Record<string, unknown[]> = {};
  const comptes: Record<string, number> = {};
  for (const t of TABLES_SAUVEGARDE) {
    const lignes = (f.tables as Record<string, unknown>)[t];
    if (Array.isArray(lignes)) {
      const propres = lignes.filter((l): l is Record<string, unknown> => !!l && typeof l === "object" && !Array.isArray(l));
      tables[t] = propres; comptes[t] = propres.length;
    }
  }
  if (Object.keys(tables).length === 0) return { ok: false, message: "La sauvegarde ne contient aucune table connue." };
  return { ok: true, fichier: { version: 1, genere_le: typeof f.genere_le === "string" ? f.genere_le : "", tables, erreurs: {}, comptes } };
}

const COMPTEURS_PROFIL = ["compteur_devis", "compteur_facture"];
export function preparerLignes(table: string, lignes: unknown[]): Record<string, unknown>[] {
  return lignes.map(l => {
    const copie = { ...(l as Record<string, unknown>) };
    if (table === "profil") COMPTEURS_PROFIL.forEach(c => delete copie[c]);
    return copie;
  });
}

export interface RapportRestauration { restaurees: Record<string, number>; erreurs: Record<string, string>; ignorees: Record<string, number> }
export interface OptionsRestauration {
  /** true : les lignes du fichier remplacent celles qui existent (retour à l'état de la sauvegarde). false (défaut) : on n'ajoute que ce qui manque. */
  ecraser?: boolean;
  /** Identifiants actuellement en base des tables parentes (devis, factures, prestations) : sert à ne pas toucher aux lignes d'un document qui existe encore. */
  parentsExistants?: Record<string, Set<string>>;
}
type Ecrire = (table: string, lignes: Record<string, unknown>[], ignorerDoublons: boolean) => PromiseLike<{ error: { message: string } | null }>;
const TAILLE = 200;

/** Lignes enfants : (table, colonne parente, table parente). Si le parent existe déjà en base, ses lignes ne sont pas recréées. */
export const ENFANTS: { table: string; colonne: string; parent: string }[] = [
  { table: "devis_lignes", colonne: "devis_id", parent: "devis" },
  { table: "facture_lignes", colonne: "facture_id", parent: "factures" },
  { table: "kit_composants", colonne: "kit_id", parent: "prestations" },
  { table: "prestation_fournisseurs", colonne: "prestation_id", parent: "prestations" },
];
export const TABLES_PARENTES = ["devis", "factures", "prestations"] as const;

/**
 * Restaure les tables dans l'ordre (parents avant enfants). Mode par défaut « ce qui manque » : une ligne déjà présente n'est jamais
 * modifiée, et les lignes d'un devis / d'une facture / d'un kit qui existe encore ne sont pas recréées (pas de doublons après une
 * modification). Une table en erreur est consignée, les autres continuent.
 */
export async function restaurer(f: FichierSauvegarde, ecrire: Ecrire, options: OptionsRestauration = {}, tables: readonly string[] = TABLES_SAUVEGARDE): Promise<RapportRestauration> {
  const r: RapportRestauration = { restaurees: {}, erreurs: {}, ignorees: {} };
  const ecraser = !!options.ecraser;
  for (const t of tables) {
    const brutes = f.tables[t];
    if (!brutes || brutes.length === 0) continue;
    if (t === "profil" && !ecraser) { r.ignorees[t] = brutes.length; continue; } // le profil existe toujours : on ne le modifie pas
    let lignes = brutes;
    const enfant = ENFANTS.find(e => e.table === t);
    if (enfant && !ecraser) {
      const existants = options.parentsExistants?.[enfant.parent];
      if (existants) {
        lignes = brutes.filter(l => !existants.has(String((l as Record<string, unknown>)[enfant.colonne])));
        if (lignes.length < brutes.length) r.ignorees[t] = brutes.length - lignes.length;
      }
    }
    if (lignes.length === 0) continue;
    const pretes = preparerLignes(t, lignes);
    let ok = 0;
    for (let i = 0; i < pretes.length; i += TAILLE) {
      const { error } = await ecrire(t, pretes.slice(i, i + TAILLE), !ecraser);
      if (error) { r.erreurs[t] = `${error.message} (${ok}/${pretes.length} lignes écrites)`; break; }
      ok += Math.min(TAILLE, pretes.length - i);
    }
    if (!r.erreurs[t]) r.restaurees[t] = ok;
  }
  return r;
}

export const CLE_DERNIERE_SAUVEGARDE = "voltapp:derniere-sauvegarde";
/** Jours depuis la dernière sauvegarde faite sur cet appareil ; null = jamais. */
export function joursDepuis(iso: string | null | undefined, maintenant = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((maintenant.getTime() - t) / 86400000));
}
