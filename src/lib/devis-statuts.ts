// src/lib/devis-statuts.ts — réponse du client à un devis et taux de conversion.
// « Accepté » = signé : il n'existe pas de statut séparé, un devis signé est un devis accepté.

export type ReponseClient = "attente" | "refuse" | "a_refaire";
export const REPONSES_CLIENT: { id: ReponseClient; label: string }[] = [
  { id: "attente", label: "Pas de réponse" },
  { id: "refuse", label: "Refusé" },
  { id: "a_refaire", label: "À refaire" },
];

/** Statuts dont la réponse du client peut encore être saisie à la main (jamais un devis signé). */
export const STATUTS_MODIFIABLES = ["brouillon", "envoye", "refuse", "a_refaire", "expire"] as const;
export const statutModifiable = (statut?: string | null): boolean => (STATUTS_MODIFIABLES as readonly string[]).includes(statut ?? "");

export const reponseDuStatut = (statut?: string | null): ReponseClient => (statut === "refuse" ? "refuse" : statut === "a_refaire" ? "a_refaire" : "attente");

/** Statut après choix d'une réponse : « pas de réponse » retombe sur envoyé (s'il a été refusé / à refaire, il avait forcément été envoyé) ou reste tel quel. */
export function statutApresReponse(actuel: string | undefined | null, reponse: ReponseClient): string | null {
  if (!statutModifiable(actuel)) return null;
  if (reponse === "refuse") return "refuse";
  if (reponse === "a_refaire") return "a_refaire";
  return actuel === "refuse" || actuel === "a_refaire" ? "envoye" : (actuel as string);
}

export interface CompteursDevis { envoye: number; signe: number; refuse: number; a_refaire: number }

/**
 * Taux de conversion : devis acceptés (signés) / devis parvenus au client (envoyés par mail, signés, refusés, à refaire).
 * Les brouillons et les devis expirés ne comptent pas. null s'il n'y a encore aucun devis sorti (pas de 0 % trompeur).
 */
export function tauxConversion(c: CompteursDevis): { pourcent: number | null; acceptes: number; sortis: number } {
  const sortis = c.envoye + c.signe + c.refuse + c.a_refaire;
  return { pourcent: sortis > 0 ? Math.round((c.signe / sortis) * 100) : null, acceptes: c.signe, sortis };
}
