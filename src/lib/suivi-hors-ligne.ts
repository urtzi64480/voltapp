// src/lib/suivi-hors-ligne.ts
//
// MODE HORS-LIGNE du suivi de chantier (cave, sous-sol, zone sans réseau) :
//   · chaque modification (coche, temps, validation) est une OPÉRATION sérialisable ;
//   · si l'écriture échoue faute de réseau, l'opération est gardée dans une file locale (localStorage, par projet) ;
//   · à la reconnexion, TOUTES les opérations en attente sont rejouées en une seule écriture lecture-modification-écriture
//     (modifierSuivi) : ce qui a été coché entre-temps depuis un autre appareil n'est pas écrasé ;
//   · la file n'est vidée qu'après une écriture réussie : en cas d'échec, rien n'est perdu et on réessaiera.
// Rejouer deux fois la même opération donne le même résultat (dates de coche conservées, temps = valeur absolue).
// Seules les erreurs RÉSEAU mettent en file : une vraie erreur serveur (colonne absente, droit refusé…) est remontée telle quelle.
import { lireStockage, ecrireStockage } from "@/lib/safe-storage";
import { CibleSuivi, Coches, InfosChantier, modifierSuiviCible, ResultatSuivi, SuiviStocke } from "@/lib/suivi-persistance";
import type { Projet } from "@/types";

export type OperationSuivi =
  | { type: "coches"; cles: string[]; fait: boolean; dateIso: string }
  | { type: "temps"; cible: "temps" | "tempsPostes"; cle: string; minutes: number }
  | { type: "chantier"; patch: InfosChantier };

/** Applique une opération sur un suivi (même logique que suivi-persistance : coches, temps, chantier). */
export function appliquerOperation(s: SuiviStocke, op: OperationSuivi): void {
  if (op.type === "coches") {
    op.cles.forEach(k => { if (op.fait) { if (!s.coches[k]) s.coches[k] = op.dateIso; } else delete s.coches[k]; });
  } else if (op.type === "temps") {
    if (op.minutes > 0) s[op.cible][op.cle] = Math.round(op.minutes); else delete s[op.cible][op.cle];
  } else {
    s.chantier = { ...s.chantier, ...op.patch };
    if (!s.chantier.valide_le) delete s.chantier.valide_le;
    if (!s.chantier.devis_id) delete s.chantier.devis_id;
  }
}

/**
 * Clé d'un suivi : l'identifiant du projet (plan) tel quel, ou « devis:<id> » pour le suivi d'un devis (chantier sans plan).
 * Les identifiants de projet sont des UUID : aucune collision possible avec le préfixe.
 */
export const cleSuiviDevis = (devisId: string) => `devis:${devisId}`;
export function cibleDepuisCle(cle: string): CibleSuivi {
  return cle.startsWith("devis:") ? { table: "devis", id: cle.slice(6) } : { table: "projets", id: cle };
}
const modifierSuivi = (cle: string, modif: (s: SuiviStocke) => void) => modifierSuiviCible(cibleDepuisCle(cle), modif);

// ─── File d'attente (localStorage) ───────────────────────────────────────────────────────────────────────────
const cleFile = (projetId: string) => `voltapp:suivi-file:${projetId}`;

function operationValide(o: unknown): o is OperationSuivi {
  if (!o || typeof o !== "object") return false;
  const x = o as Record<string, unknown>;
  if (x.type === "coches") return Array.isArray(x.cles) && x.cles.every(c => typeof c === "string") && typeof x.fait === "boolean" && typeof x.dateIso === "string";
  if (x.type === "temps") return (x.cible === "temps" || x.cible === "tempsPostes") && typeof x.cle === "string" && typeof x.minutes === "number" && Number.isFinite(x.minutes);
  if (x.type === "chantier") return !!x.patch && typeof x.patch === "object";
  return false;
}

export function lireFile(projetId: string): OperationSuivi[] {
  try {
    const brut = lireStockage("local", cleFile(projetId));
    if (!brut) return [];
    const parsed = JSON.parse(brut);
    return Array.isArray(parsed) ? parsed.filter(operationValide) : [];
  } catch { return []; }
}

function ecrireFile(projetId: string, file: OperationSuivi[]): void {
  ecrireStockage("local", cleFile(projetId), JSON.stringify(file));
}

export const nbEnAttente = (projetId: string): number => lireFile(projetId).length;

/** Ajoute une opération à la file ; true si elle est bien enregistrée sur l'appareil. */
export function mettreEnFile(projetId: string, op: OperationSuivi): boolean {
  ecrireFile(projetId, [...lireFile(projetId), op]);
  return lireFile(projetId).length > 0;
}

// ─── Détection réseau ────────────────────────────────────────────────────────────────────────────────────────
const RESEAU = /failed to fetch|fetch failed|networkerror|network request failed|load failed|network error|err_internet|timed? ?out|econnreset|enotfound/i;

export function enLigne(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Vrai pour une panne de connexion ; faux pour une erreur du serveur (qui, elle, ne se corrige pas en réessayant). */
export function estErreurReseau(message: string): boolean {
  return RESEAU.test(message) || !enLigne();
}

// ─── Écriture avec file ──────────────────────────────────────────────────────────────────────────────────────
export type ResultatEcritureSuivi =
  | ResultatSuivi
  | { ok: true; enAttente: true; nbEnAttente: number };

const enCoursDeSync = new Set<string>();

/**
 * Rejoue toute la file d'un projet en UNE écriture. Renvoie null s'il n'y a rien à faire ou si une synchronisation
 * est déjà en cours pour ce projet. En cas d'échec la file est conservée intacte.
 */
export async function synchroniser(projetId: string): Promise<ResultatSuivi | null> {
  if (enCoursDeSync.has(projetId)) return null;
  const aRejouer = lireFile(projetId);
  if (aRejouer.length === 0) return null;
  enCoursDeSync.add(projetId);
  try {
    const res = await modifierSuivi(projetId, s => { aRejouer.forEach(op => appliquerOperation(s, op)); });
    if (res.ok) {
      // On retire seulement ce qui vient d'être rejoué : une opération ajoutée pendant l'écriture reste en file.
      ecrireFile(projetId, lireFile(projetId).slice(aRejouer.length));
    }
    return res;
  } finally {
    enCoursDeSync.delete(projetId);
  }
}

/**
 * Écrit une opération. File vide → écriture directe ; si le réseau est coupé, l'opération est mise en file.
 * File non vide → l'opération passe derrière celles déjà en attente (l'ordre est respecté), puis on tente la synchronisation.
 */
export async function ecrireOuMettreEnFile(projetId: string, op: OperationSuivi): Promise<ResultatEcritureSuivi> {
  if (lireFile(projetId).length > 0) {
    if (!mettreEnFile(projetId, op)) return { ok: false, message: "Stockage de l'appareil indisponible : modification non enregistrée.", colonneAbsente: false };
    const res = await synchroniser(projetId);
    if (res?.ok) return res;
    if (res && !res.ok && !estErreurReseau(res.message)) return res;
    return { ok: true, enAttente: true, nbEnAttente: nbEnAttente(projetId) };
  }
  const res = await modifierSuivi(projetId, s => appliquerOperation(s, op));
  if (res.ok || !estErreurReseau(res.message)) return res;
  if (!mettreEnFile(projetId, op)) return res; // impossible de garder la modification : on remonte l'erreur réseau
  return { ok: true, enAttente: true, nbEnAttente: nbEnAttente(projetId) };
}

export const ecrireCoches = (projetId: string, cles: string[], fait: boolean, dateIso: string) =>
  ecrireOuMettreEnFile(projetId, { type: "coches", cles, fait, dateIso });
export const ecrireTemps = (projetId: string, cible: "temps" | "tempsPostes", cle: string, minutes: number) =>
  ecrireOuMettreEnFile(projetId, { type: "temps", cible, cle, minutes });
export const ecrireChantier = (projetId: string, patch: InfosChantier) =>
  ecrireOuMettreEnFile(projetId, { type: "chantier", patch });

/** Coches telles qu'elles seront après la file (pour l'affichage à partir d'un état relu avant la coupure). */
export function appliquerFile(s: SuiviStocke, projetId: string): SuiviStocke {
  const copie: SuiviStocke = { coches: { ...s.coches } as Coches, chantier: { ...s.chantier }, temps: { ...s.temps }, tempsPostes: { ...s.tempsPostes } };
  lireFile(projetId).forEach(op => appliquerOperation(copie, op));
  return copie;
}

// ─── Copie locale des projets d'un client (ouverture du suivi sans réseau) ───────────────────────────────────
// Lecture seule : sert uniquement à AFFICHER le suivi quand les projets ne peuvent pas être chargés. Les écritures du
// suivi passent toujours par la file ci-dessus (lecture-modification-écriture sur la seule colonne suivi_realisation) :
// une copie périmée ne peut donc jamais écraser le plan.
const cleProjets = (clientId: string) => `voltapp:suivi-projets:${clientId}`;

export function memoriserProjets(clientId: string, projets: Projet[]): void {
  if (projets.length === 0) return;
  ecrireStockage("local", cleProjets(clientId), JSON.stringify({ le: new Date().toISOString(), projets }));
}

export function lireProjetsMemorises(clientId: string): { le: string; projets: Projet[] } | null {
  try {
    const brut = lireStockage("local", cleProjets(clientId));
    if (!brut) return null;
    const p = JSON.parse(brut) as { le?: unknown; projets?: unknown };
    if (typeof p.le !== "string" || !Array.isArray(p.projets) || p.projets.length === 0) return null;
    const projets = p.projets.filter((x): x is Projet => !!x && typeof x === "object" && typeof (x as Projet).id === "string");
    return projets.length > 0 ? { le: p.le, projets } : null;
  } catch { return null; }
}

// ─── Copie locale d'un devis (ouverture de son suivi sans réseau) ────────────────────────────────────────────
// Lecture seule, comme la copie des projets : les écritures passent toujours par la file.
const cleDevis = (devisId: string) => `voltapp:suivi-devis:${devisId}`;

export function memoriserDevis<T extends { id: string }>(devis: T): void {
  ecrireStockage("local", cleDevis(devis.id), JSON.stringify({ le: new Date().toISOString(), devis }));
}

export function lireDevisMemorise<T extends { id: string }>(devisId: string): { le: string; devis: T } | null {
  try {
    const brut = lireStockage("local", cleDevis(devisId));
    if (!brut) return null;
    const p = JSON.parse(brut) as { le?: unknown; devis?: { id?: unknown } };
    return typeof p.le === "string" && p.devis && p.devis.id === devisId ? { le: p.le, devis: p.devis as T } : null;
  } catch { return null; }
}
