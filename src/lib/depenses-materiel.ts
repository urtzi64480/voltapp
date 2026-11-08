// src/lib/depenses-materiel.ts
//
// ACHATS DE MATÉRIEL PAR MOIS : un devis peut donner lieu à PLUSIEURS achats réels (table devis_achats, migration 018), chacun avec son
// montant TTC, son jour de paiement et son fournisseur. Le mois d'un achat est celui du jour où il a été payé : le total d'un mois est ce
// qu'il faut virer en fin de mois. Le « prévu » (coût d'achat estimé d'après le devis) sert à comparer au total réel du devis.
// Pur (sans réseau, sans horloge) : la page charge les données et appelle ces fonctions.

/** Un achat réel (une ligne de devis_achats). `montant` est TTC. */
export interface AchatLigne {
  id: string;
  devisId: string;
  montant: number;
  /** Jour du paiement, AAAA-MM-JJ. */
  date: string;
  fournisseur: string;
  /** Article de la liste de courses payé (migration 019) ; "" = achat global du devis. */
  article: string;
}

/** Un achat avec le devis auquel il appartient (pour l'affichage mensuel). */
export interface AchatDuMois extends AchatLigne {
  numero: string;
  client: string;
  objet: string;
}

/** Ligne brute de devis_achats (Supabase) → achat ; null si la ligne est inutilisable. */
export function lireAchat(row: unknown): AchatLigne | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const montant = lireMontant(r.montant ?? null);
  const date = lireDate(r.date_achat ?? null);
  if (typeof r.id !== "string" || typeof r.devis_id !== "string" || montant == null) return null;
  return { id: r.id, devisId: r.devis_id, montant, date: date ?? "", fournisseur: typeof r.fournisseur === "string" ? r.fournisseur.trim() : "", article: typeof r.article === "string" ? r.article.trim() : "" };
}

/** Somme des achats par devis (au centime). */
export function totalParDevis(achats: Pick<AchatLigne, "devisId" | "montant">[]): Map<string, number> {
  const m = new Map<string, number>();
  achats.forEach(a => m.set(a.devisId, arrondi((m.get(a.devisId) ?? 0) + a.montant)));
  return m;
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

/** Mois d'un achat (AAAA-MM) d'après son jour de paiement ; « inconnu » si la date n'est pas lisible. */
export function moisDe(date: unknown): string {
  const d = lireDate(date);
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
  /** Achats du mois, du plus ancien au plus récent (puis par numéro de devis). */
  achats: AchatDuMois[];
  /** Somme des achats du mois : ce qu'il faut virer. */
  total: number;
  nbAchats: number;
  nbDevis: number;
  /** Mois strictement avant le mois courant : replié par défaut. */
  termine: boolean;
}

/** Regroupe par mois de paiement, du plus récent au plus ancien (« date inconnue » en dernier). `moisCourant` = AAAA-MM d'aujourd'hui. */
export function grouperAchatsParMois(achats: AchatDuMois[], moisCourant: string): GroupeMois[] {
  const map = new Map<string, AchatDuMois[]>();
  achats.forEach(a => { const k = moisDe(a.date); map.set(k, [...(map.get(k) ?? []), a]); });
  const groupes: GroupeMois[] = [];
  map.forEach((liste, cle) => {
    const tri = [...liste].sort((x, y) => x.date.localeCompare(y.date) || x.numero.localeCompare(y.numero, "fr", { numeric: true }) || x.id.localeCompare(y.id));
    groupes.push({
      cle, libelle: libelleMois(cle), achats: tri,
      total: arrondi(tri.reduce((t, a) => t + a.montant, 0)),
      nbAchats: tri.length, nbDevis: new Set(tri.map(a => a.devisId)).size,
      termine: cle !== "inconnu" && cle < moisCourant,
    });
  });
  return groupes.sort((a, b) => (a.cle === "inconnu" ? 1 : b.cle === "inconnu" ? -1 : b.cle.localeCompare(a.cle)));
}

/** Un devis entre dans la liste s'il est signé et vend du matériel, ou si un achat y est déjà saisi (rien ne disparaît). */
export function estAAcheter(d: { statut: string; total_materiau?: number | null; nbAchats?: number; aLigneMateriau?: boolean }): boolean {
  if ((d.nbAchats ?? 0) > 0) return true;
  return d.statut === "signe" && (Number(d.total_materiau) > 0 || d.aLigneMateriau === true);
}

export const SQL_MIGRATION_ARTICLE = "alter table devis_achats add column if not exists article text;";

export const SQL_MIGRATION_ACHATS = `create table if not exists devis_achats (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  devis_id uuid not null references devis(id) on delete cascade,
  montant numeric(12,2) not null check (montant >= 0),
  date_achat date not null default current_date,
  fournisseur text,
  created_at timestamptz default now()
);
alter table devis_achats enable row level security;
drop policy if exists "own_devis_achats" on devis_achats;
create policy "own_devis_achats" on devis_achats for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`;
