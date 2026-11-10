// src/lib/assurance.ts — assurance décennale : état de validité, mention imprimée sur devis / factures. Pur, testé.
export interface InfosAssurance {
  assurance_assureur?: string | null; assurance_adresse?: string | null; assurance_contrat?: string | null; assurance_zone?: string | null;
  assurance_debut?: string | null; assurance_fin?: string | null; assurance_fichier?: string | null; assurance_fichier_nom?: string | null;
}
export type EtatAssurance = "absente" | "valide" | "bientot" | "expiree" | "non_commencee";
export const DELAI_ALERTE_JOURS = 30;

const jour = (iso?: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.floor(t / 86_400_000);
};
const aujourdhuiJour = (d: Date): number => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

/** État de l'attestation : sans date de fin on ne peut pas affirmer qu'elle est valide (« absente »). La fin est INCLUSE (valable le jour même). */
export function etatAssurance(a: InfosAssurance | null | undefined, maintenant: Date = new Date()): { etat: EtatAssurance; joursRestants: number | null } {
  const fin = jour(a?.assurance_fin), debut = jour(a?.assurance_debut);
  if (fin == null) return { etat: "absente", joursRestants: null };
  const auj = aujourdhuiJour(maintenant);
  const reste = fin - auj;
  if (reste < 0) return { etat: "expiree", joursRestants: reste };
  if (debut != null && auj < debut) return { etat: "non_commencee", joursRestants: reste };
  return { etat: reste <= DELAI_ALERTE_JOURS ? "bientot" : "valide", joursRestants: reste };
}
/** Une attestation peut être jointe / citée à un client seulement si elle est en cours de validité. */
export const attestationUtilisable = (a: InfosAssurance | null | undefined, maintenant?: Date): boolean => {
  const e = etatAssurance(a, maintenant).etat;
  return e === "valide" || e === "bientot";
};

const net = (s?: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
const dateFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Mention légale imprimée sur les devis et factures : assureur, coordonnées, n° de contrat, couverture géographique.
 * null si les informations ne sont pas renseignées ou si l'attestation est expirée (on n'affirme pas une couverture qui n'existe plus).
 */
export function mentionDecennale(a: InfosAssurance | null | undefined, maintenant?: Date): string | null {
  const assureur = net(a?.assurance_assureur);
  if (!assureur || !attestationUtilisable(a, maintenant)) return null;
  const morceaux = [
    `Assurance responsabilité civile décennale : ${assureur}${net(a?.assurance_adresse) ? ` (${net(a?.assurance_adresse)})` : ""}`,
    net(a?.assurance_contrat) ? `contrat n° ${net(a?.assurance_contrat)}` : "",
    `couverture géographique : ${net(a?.assurance_zone) || "France métropolitaine"}`,
    a?.assurance_fin ? `valable jusqu'au ${dateFr(a.assurance_fin.slice(0, 10))}` : "",
  ].filter(Boolean);
  return `${morceaux.join(" — ")}.`;
}

/** Phrase d'alerte pour le tableau de bord / les paramètres ; null si tout va bien. */
export function alerteAssurance(a: InfosAssurance | null | undefined, maintenant?: Date): string | null {
  const { etat, joursRestants } = etatAssurance(a, maintenant);
  if (etat === "absente") return a?.assurance_assureur || a?.assurance_fichier ? "Assurance décennale : date de fin de validité à renseigner." : null;
  if (etat === "expiree") return "Assurance décennale expirée : elle n'est plus jointe aux dossiers ni citée sur les devis et factures. Dépose la nouvelle attestation.";
  if (etat === "non_commencee") return "Assurance décennale : la période de validité saisie n'a pas encore commencé.";
  if (etat === "bientot") return joursRestants === 0 ? "Assurance décennale : l'attestation expire aujourd'hui." : `Assurance décennale : l'attestation expire dans ${joursRestants} jour${(joursRestants ?? 0) > 1 ? "s" : ""}.`;
  return null;
}
