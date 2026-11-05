// src/lib/disposition-tableau.ts
//
// DISPOSITION DU TABLEAU : largeur des rails (13, 18 ou 24 modules) et nombre de différentiels par rail.
// Partagé par « Pousser vers le tableau » (plan), l'aperçu du tableau réaliste et le mode IA. Fonctions pures, déterministes.
//
// Un « groupe » = un différentiel + ses départs (une rangée de assemblerTableau : 8 circuits maxi, règle NF C 15-100).
// - Un différentiel par rail : chaque groupe a son rail (comportement historique si aucune largeur n'est choisie).
// - Plusieurs différentiels par rail : les groupes sont rangés côte à côte tant que le rail a la place (emballerEnRails).
// La proposition AUTOMATIQUE essaie toutes les dispositions et garde la plus conforme (réserve de 20 %, 2 ID 30 mA minimum dont un type A,
// 8 circuits par ID, aucun rail trop court), puis la plus compacte. L'électricien peut toujours en choisir une autre : la norme alerte, elle ne bloque pas.

import type { Breaker, BreakerRow } from "./electrical-constants";
import { emplacementsPourModules, largeurAppareil, redimensionnerRangee } from "./electrical-constants";
import { assemblerTableau } from "./maison-engine";
import { checkNFC } from "./nfc-check";
import { calculerTableauReel, fusionnerParamsTableau } from "./tableau-reel";

export const LARGEURS_RAIL = [13, 18, 24] as const;
export type LargeurRail = (typeof LARGEURS_RAIL)[number];
/** « historique » : rangées de 8 emplacements, sans largeur (comportement d'avant). */
export type ChoixLargeur = "auto" | "historique" | LargeurRail;
export interface ChoixDisposition { largeur: ChoixLargeur; plusieursId: "auto" | boolean }
export const CHOIX_DISPOSITION_DEFAUT: ChoixDisposition = { largeur: "auto", plusieursId: "auto" };

export interface Disposition { modules: LargeurRail | null; plusieursId: boolean }
export interface PropositionDisposition extends Disposition { nbRails: number; nbAlertes: number; raison: string }

/**
 * Range des groupes « un différentiel + ses départs » sur des rails de `modules` modules : un rail reçoit plusieurs groupes tant qu'il y a la place
 * (2 modules par différentiel + les départs), dans l'ordre ; le suivant ouvre un nouveau rail. Le différentiel de tête est en case 0, les suivants dans
 * les emplacements (2 modules) et protègent les départs à leur droite. Rien n'est jamais perdu.
 */
export function emballerEnRails(rows: BreakerRow[], modules: number): BreakerRow[] {
  const nbEmpl = emplacementsPourModules(modules);
  const rails: BreakerRow[] = [];
  let courant: { row: BreakerRow; slots: (Breaker | null)[]; idx: number } | null = null;
  const ouvrir = (base: BreakerRow) => {
    courant = { row: base, slots: Array(nbEmpl + 1).fill(null), idx: 1 };
    rails.push(base);   // remplacé par la version remplie à la fermeture
  };
  const fermer = () => {
    if (!courant) return;
    rails[rails.indexOf(courant.row)] = { ...courant.row, modules, slots: courant.slots };
  };
  rows.forEach(r => {
    const id = r.slots[0] ?? null;
    const departs = r.slots.slice(1).filter((b): b is Breaker => !!b);
    const w = departs.reduce((n, b) => n + largeurAppareil(b), 0);
    const tient = courant != null && id != null && courant.idx + 1 + w <= nbEmpl;
    if (!tient) { fermer(); ouvrir(r); courant!.slots[0] = id; }
    else { courant!.slots[courant!.idx] = id; courant!.idx += 2; }
    const c = courant!;
    // garde-fou : un groupe plus large que le rail (inatteignable avec 8 départs) agrandit les cases plutôt que de perdre un appareil
    while (c.slots.length < c.idx + w) c.slots.push(null);
    departs.forEach(b => { c.slots[c.idx] = b; c.idx += largeurAppareil(b); });
  });
  fermer();
  return rails;
}

/** Applique une disposition aux groupes (rangées de assemblerTableau). Sans largeur ni multi-ID, les groupes sont rendus tels quels. */
export function disposerGroupes(groupes: BreakerRow[], d: Disposition): BreakerRow[] {
  if (d.plusieursId && d.modules != null) return emballerEnRails(groupes, d.modules);
  if (d.modules != null) return groupes.map(r => redimensionnerRangee(r, d.modules!) ?? r);
  return groupes;
}

// Contrôles qui dépendent de la disposition (les autres sont identiques d'une disposition à l'autre).
const CONTROLES_DISPOSITION = /^(reserve|depasse-|max-id|id-mini|id-type-a|sans-id|type-)/;

function alertesDisposition(rows: BreakerRow[], modules: number): number {
  const params = fusionnerParamsTableau({ modulesParRail: modules });
  const reel = calculerTableauReel(rows, { params }).controles.filter(c => c.niveau !== "info" && CONTROLES_DISPOSITION.test(c.id)).length;
  const nfc = checkNFC(rows);
  const nfcRetenues = [...nfc.errors, ...nfc.warnings].filter(m => /^(reserve|max8-|one-diff|no-diff|rangee-vide)/.test(m.id)).length;
  return reel + nfcRetenues;
}

/**
 * Meilleure disposition pour ces groupes : la moins d'alertes NF C 15-100 (réserve 20 %, 8 circuits par ID, 2 ID dont un type A, rail assez long),
 * puis le coffret le plus compact (rails × modules), puis le rail le plus étroit, puis un différentiel par rail. Déterministe.
 */
export function proposerDisposition(groupes: BreakerRow[]): PropositionDisposition {
  if (groupes.length === 0) return { modules: 13, plusieursId: false, nbRails: 0, nbAlertes: 0, raison: "Aucun circuit." };
  let meilleur: (PropositionDisposition & { cout: number; rang: number }) | null = null;
  let rang = 0;
  for (const m of LARGEURS_RAIL) {
    for (const plusieursId of [false, true]) {
      rang++;
      const rows = disposerGroupes(groupes, { modules: m, plusieursId });
      const nbAlertes = alertesDisposition(rows, m);
      const cout = rows.length * m;
      const c = { modules: m as LargeurRail, plusieursId, nbRails: rows.length, nbAlertes, raison: "", cout, rang };
      if (!meilleur || nbAlertes < meilleur.nbAlertes || (nbAlertes === meilleur.nbAlertes && (cout < meilleur.cout || (cout === meilleur.cout && rang < meilleur.rang)))) meilleur = c;
    }
  }
  const b = meilleur!;
  const nbId = groupes.length;
  const raison = `${b.nbRails} rail${b.nbRails > 1 ? "s" : ""} de ${b.modules} modules, ${nbId} différentiel${nbId > 1 ? "s" : ""}${b.plusieursId && b.nbRails < nbId ? " (plusieurs par rail)" : ""}`
    + (b.nbAlertes === 0 ? " — réserve de 20 % et 8 circuits maxi par différentiel respectés." : ` — ${b.nbAlertes} point(s) à revoir (réserve ou répartition).`);
  return { modules: b.modules, plusieursId: b.plusieursId, nbRails: b.nbRails, nbAlertes: b.nbAlertes, raison };
}

/** Disposition effective d'un choix : « auto » prend la proposition, « historique » ne change rien, une largeur imposée garde l'autre réglage en auto. */
export function resoudreChoix(groupes: BreakerRow[], choix: ChoixDisposition): { disposition: Disposition; proposition: PropositionDisposition } {
  const proposition = proposerDisposition(groupes);
  if (choix.largeur === "historique") return { disposition: { modules: null, plusieursId: false }, proposition };
  const modules = choix.largeur === "auto" ? proposition.modules : choix.largeur;
  let plusieursId: boolean;
  if (choix.plusieursId !== "auto") plusieursId = choix.plusieursId;
  else if (choix.largeur === "auto") plusieursId = proposition.plusieursId;
  else {
    // largeur imposée, rangement en auto : celui qui donne le moins d'alertes (à égalité : le plus compact)
    const seul = disposerGroupes(groupes, { modules, plusieursId: false });
    const multi = disposerGroupes(groupes, { modules, plusieursId: true });
    const a1 = alertesDisposition(seul, modules!), a2 = alertesDisposition(multi, modules!);
    plusieursId = a2 < a1 || (a2 === a1 && multi.length < seul.length);
  }
  return { disposition: { modules, plusieursId }, proposition };
}

/** Rangées du tableau (origine « plan ») pour ces disjoncteurs, selon le choix de l'électricien (par défaut : proposition automatique). */
export function assemblerTableauDispose(breakers: Breaker[], choix: ChoixDisposition = CHOIX_DISPOSITION_DEFAUT): { rows: BreakerRow[]; disposition: Disposition; proposition: PropositionDisposition } {
  const groupes = breakers.length > 0 ? assemblerTableau(breakers) : [];
  const { disposition, proposition } = resoudreChoix(groupes, choix);
  return { rows: disposerGroupes(groupes, disposition), disposition, proposition };
}
