// Texte de la notification du matin : interventions du jour, factures payées depuis hier, factures en retard.
export interface ResumeEntree {
  interventions: { titre: string; date_debut: string }[];
  payees: { numero: string; total_ttc?: number | null }[];
  enRetard: number;
  /** Premier jour du mois : rappel de sauvegarde. */
  rappelSauvegarde?: boolean;
}
const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

export function composerResume(e: ResumeEntree): { titre: string; corps: string; url: string } | null {
  const lignes: string[] = [];
  if (e.interventions.length > 0)
    lignes.push(`${e.interventions.length} intervention${e.interventions.length > 1 ? "s" : ""} aujourd'hui : ${e.interventions.slice(0, 3).map(i => `${heure(i.date_debut)} ${i.titre}`).join(", ")}${e.interventions.length > 3 ? "…" : ""}`);
  if (e.payees.length > 0) {
    const total = e.payees.reduce((a, f) => a + (Number(f.total_ttc) || 0), 0);
    lignes.push(`${e.payees.length} facture${e.payees.length > 1 ? "s" : ""} payée${e.payees.length > 1 ? "s" : ""}${total > 0 ? ` (${eur(total)})` : ""}`);
  }
  if (e.enRetard > 0) lignes.push(`${e.enRetard} facture${e.enRetard > 1 ? "s" : ""} en retard de paiement`);
  if (e.rappelSauvegarde) lignes.push("Début de mois : pense à sauvegarder tes données (menu Sauvegarde)");
  if (lignes.length === 0) return null;
  return { titre: "VoltApp — votre journée", corps: lignes.join("\n"), url: e.interventions.length > 0 ? "/planning" : e.payees.length > 0 || e.enRetard > 0 ? "/factures" : "/sauvegarde" };
}
