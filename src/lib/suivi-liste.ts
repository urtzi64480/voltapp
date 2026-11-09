// src/lib/suivi-liste.ts — liste des chantiers à suivre (page « Suivi de chantier »). Pur, testé.
import type { Progression } from "@/lib/suivi-realisation";

export interface ChantierListe {
  key: string; type: "plan" | "devis"; href: string; titre: string; sousTitre: string;
  progression: Progression | null; valideLe: string | null; date: string;
}

/** Terminé = validé par l'utilisateur, ou toutes les étapes cochées (et au moins une étape). */
export const estTermine = (c: Pick<ChantierListe, "progression" | "valideLe">): boolean =>
  !!c.valideLe || (!!c.progression && c.progression.total > 0 && c.progression.fait >= c.progression.total);

/** En cours d'abord (le plus avancé en premier : c'est celui qu'on est en train de finir), terminés ensuite (le plus récent d'abord). */
export function separerChantiers(liste: ChantierListe[]): { enCours: ChantierListe[]; termines: ChantierListe[] } {
  const enCours = liste.filter(c => !estTermine(c)).sort((a, b) => (b.progression?.pct ?? -1) - (a.progression?.pct ?? -1) || b.date.localeCompare(a.date));
  const termines = liste.filter(estTermine).sort((a, b) => b.date.localeCompare(a.date));
  return { enCours, termines };
}
