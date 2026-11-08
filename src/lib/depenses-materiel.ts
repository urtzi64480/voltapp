// src/lib/depenses-materiel.ts
//
// DÉPENSES DE MATÉRIEL PAR MOIS : pour chaque devis signé, le matériel à acheter (coût d'achat estimé d'après le devis) et ce qui a
// RÉELLEMENT été dépensé (saisi à la main sur le devis : devis.achat_materiel_reel, migration 017). Les dépenses sont classées par mois
// d'achat ; un mois terminé se replie. Pur (sans réseau, sans horloge) : la page charge les données et appelle ces fonctions.

export interface EntreeAchat {
  devisId: string;
  numero: string;
  objet: string;
  client: string;
  statut: string;
  /** Coût d'achat estimé d'après les lignes du devis (0 = aucun prix d'achat connu). */
  prevu: number;
  /** Montant réellement dépensé, saisi à la main ; null = pas encore saisi. */
  reel: number | null;
  /** Date d'achat saisie (AAAA-MM-JJ) ; null = on utilise `dateRef`. */
  date: string | null;
  /** Date de repli : signature du devis, sinon émission. */
  dateRef: string;
}

import { TVA_ACHAT_PCT } from "./courses-prix";

/** Base d'un montant saisi : toutes les dépenses sont STOCKÉES en TTC (TVA fournisseur non récupérable en franchise en base de TVA). */
export type BaseMontant = "ttc" | "ht";
const COEF_TVA = 1 + TVA_ACHAT_PCT / 100;
export const ttcDepuisHt = (ht: number): number => Math.round((ht * COEF_TVA + Number.EPSILON) * 100) / 100;
export const htDepuisTtc = (ttc: number): number => Math.round((ttc / COEF_TVA + Number.EPSILON) * 100) / 100;
/** Montant saisi dans la base choisie → TTC stocké ; null si la saisie est vide ou invalide. */
export function lireMontantTtc(saisie: unknown, base: BaseMontant): number | null {
  const m = lireMontant(saisie);
  return m == null ? null : base === "ht" ? ttcDepuisHt(m) : m;
}
export { TVA_ACHAT_PCT };

const arrondi = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** « 1 234,50 », « 12.5 », « 12,5 € » → nombre ≥ 0 arrondi au centime ; vide ou invalide → null. */
export function lireMontant(saisie: unknown): number | null {
  if (typeof saisie === "number") return Number.isFinite(saisie) && saisie >= 0 ? arrondi(saisie) : null;
  if (typeof saisie !== "string") return null;
  const t = saisie.replace(/[€\s  ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? arrondi(n) : null;
}

/** Date AAAA-MM-JJ valide (début de chaîne d'un horodatage accepté), sinon null. */
export function lireDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const test = new Date(Date.UTC(y, mo - 1, d));
  return test.getUTCFullYear() === y && test.getUTCMonth() === mo - 1 && test.getUTCDate() === d ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Mois de la dépense (AAAA-MM) : date d'achat saisie, sinon date de repli du devis. « inconnu » si aucune date lisible. */
export function moisDe(e: Pick<EntreeAchat, "date" | "dateRef">): string {
  const d = lireDate(e.date) ?? lireDate(e.dateRef);
  return d ? d.slice(0, 7) : "inconnu";
}

const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export function libelleMois(cle: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(cle);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return "Date inconnue";
  return `${NOMS_MOIS[Number(m[2]) - 1]} ${m[1]}`;
}

export interface GroupeMois {
  cle: string;
  libelle: string;
  entrees: EntreeAchat[];
  /** Somme des montants réels saisis. */
  totalReel: number;
  /** Coût d'achat estimé des devis du mois dont le réel est saisi (comparable au réel). */
  prevuSaisis: number;
  /** Coût d'achat estimé de tous les devis du mois. */
  totalPrevu: number;
  nbDevis: number;
  nbASaisir: number;
  /** Mois strictement avant le mois courant : replié par défaut. */
  termine: boolean;
}

/** Regroupe par mois, du plus récent au plus ancien (« date inconnue » en dernier) ; devis triés par date puis numéro. `moisCourant` = AAAA-MM d'aujourd'hui. */
export function grouperParMois(entrees: EntreeAchat[], moisCourant: string): GroupeMois[] {
  const map = new Map<string, EntreeAchat[]>();
  entrees.forEach(e => { const k = moisDe(e); map.set(k, [...(map.get(k) ?? []), e]); });
  const groupes: GroupeMois[] = [];
  map.forEach((liste, cle) => {
    const tri = [...liste].sort((a, b) => (lireDate(a.date) ?? lireDate(a.dateRef) ?? "").localeCompare(lireDate(b.date) ?? lireDate(b.dateRef) ?? "") || a.numero.localeCompare(b.numero, "fr", { numeric: true }));
    const saisis = tri.filter(e => e.reel != null);
    groupes.push({
      cle, libelle: libelleMois(cle), entrees: tri,
      totalReel: arrondi(saisis.reduce((a, e) => a + (e.reel ?? 0), 0)),
      prevuSaisis: arrondi(saisis.reduce((a, e) => a + e.prevu, 0)),
      totalPrevu: arrondi(tri.reduce((a, e) => a + e.prevu, 0)),
      nbDevis: tri.length, nbASaisir: tri.length - saisis.length,
      termine: cle !== "inconnu" && cle < moisCourant,
    });
  });
  return groupes.sort((a, b) => (a.cle === "inconnu" ? 1 : b.cle === "inconnu" ? -1 : b.cle.localeCompare(a.cle)));
}

/** Écart réel − estimé en % (sur les devis saisis) ; null si non comparable. */
export function ecartPct(reel: number, prevu: number): number | null {
  return prevu > 0 ? Math.round(((reel - prevu) / prevu) * 1000) / 10 : null;
}

/** Un devis entre dans la liste s'il est signé et vend du matériel, ou si un montant réel y a déjà été saisi (rien ne disparaît). */
export function estAAcheter(d: { statut: string; total_materiau?: number | null; reel?: number | null; aLigneMateriau?: boolean }): boolean {
  if (d.reel != null) return true;
  return d.statut === "signe" && (Number(d.total_materiau) > 0 || d.aLigneMateriau === true);
}

export const SQL_MIGRATION_ACHATS = "alter table devis add column if not exists achat_materiel_reel numeric(12,2);\nalter table devis add column if not exists achat_materiel_date date;";
