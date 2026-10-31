// src/lib/export-comptable.ts
//
// Livre des recettes (micro-entrepreneur) : une ligne par facture ENCAISSÉE, classée par date d'encaissement, avec un
// récapitulatif mensuel par nature d'activité (vente de marchandises / prestations de services) pour la déclaration URSSAF.
// Module pur : aucune requête, testable.
//
// Hypothèses assumées (affichées dans le CSV) :
//   · seules les factures au statut « payee » comptent, à la date paye_le (jour local) ;
//   · en franchise en base de TVA, TTC = HT : le montant encaissé est total_ttc ;
//   · une remise globale (total_service + total_materiau − total_ttc) est répartie au prorata sur les deux natures ;
//   · le mode de règlement n'est pas enregistré sur les factures : colonne laissée vide à compléter.
import { arrondi2, dateLocale } from "./utils";

export interface FactureExport {
  numero: string;
  objet?: string | null;
  paye_le?: string | null;
  total_service?: number | null;
  total_materiau?: number | null;
  total_ttc?: number | null;
  client?: { nom: string; prenom?: string | null } | null;
}

export type Periode =
  | { type: "annee"; annee: number }
  | { type: "trimestre"; annee: number; trimestre: 1 | 2 | 3 | 4 }
  | { type: "mois"; annee: number; mois: number }; // mois 1-12

export const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

/** Bornes [debut, fin[ en instants ISO (minuit local), pour filtrer paye_le (timestamptz). */
export function bornesPeriode(p: Periode): { debut: string; fin: string } {
  if (p.type === "annee") return { debut: new Date(p.annee, 0, 1).toISOString(), fin: new Date(p.annee + 1, 0, 1).toISOString() };
  if (p.type === "trimestre") {
    const m = (p.trimestre - 1) * 3;
    return { debut: new Date(p.annee, m, 1).toISOString(), fin: new Date(p.annee, m + 3, 1).toISOString() };
  }
  return { debut: new Date(p.annee, p.mois - 1, 1).toISOString(), fin: new Date(p.annee, p.mois, 1).toISOString() };
}

export function libellePeriode(p: Periode): string {
  if (p.type === "annee") return `Année ${p.annee}`;
  if (p.type === "trimestre") return `T${p.trimestre} ${p.annee}`;
  return `${MOIS[p.mois - 1]} ${p.annee}`;
}

export function nomFichier(p: Periode): string {
  if (p.type === "annee") return `livre-des-recettes-${p.annee}.csv`;
  if (p.type === "trimestre") return `livre-des-recettes-${p.annee}-T${p.trimestre}.csv`;
  return `livre-des-recettes-${p.annee}-${String(p.mois).padStart(2, "0")}.csv`;
}

export interface LigneLivre {
  date: string;        // AAAA-MM-JJ (jour d'encaissement, local)
  cle: string;         // AAAA-MM
  numero: string;
  client: string;
  nature: "Services" | "Marchandises" | "Mixte";
  designation: string;
  service: number;     // part services encaissée (remise répartie)
  materiau: number;    // part marchandises encaissée
  total: number;
}

const nombre = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Répartit le montant encaissé entre services et marchandises (remise au prorata, arrondi au centime, somme = total). */
export function repartir(f: Pick<FactureExport, "total_service" | "total_materiau" | "total_ttc">): { service: number; materiau: number; total: number } {
  const s = Math.max(0, nombre(f.total_service)), m = Math.max(0, nombre(f.total_materiau));
  const ttcStocke = nombre(f.total_ttc);
  const brut = s + m;
  const total = arrondi2(ttcStocke > 0 || brut === 0 ? ttcStocke : brut);
  if (brut <= 0) return { service: total, materiau: 0, total }; // aucune ventilation connue : prestation de services par défaut
  const service = arrondi2(total * s / brut);
  return { service, materiau: arrondi2(total - service), total };
}

export function construireLivre(factures: FactureExport[]): LigneLivre[] {
  const lignes: LigneLivre[] = [];
  factures.forEach(f => {
    if (!f.paye_le) return;
    const d = new Date(f.paye_le);
    if (Number.isNaN(d.getTime())) return;
    const date = dateLocale(d);
    const r = repartir(f);
    const nature: LigneLivre["nature"] = r.materiau > 0 && r.service > 0 ? "Mixte" : r.materiau > 0 ? "Marchandises" : "Services";
    lignes.push({
      date, cle: date.slice(0, 7), numero: f.numero,
      client: f.client ? `${f.client.prenom ?? ""} ${f.client.nom}`.trim() : "",
      nature, designation: f.objet ?? "", service: r.service, materiau: r.materiau, total: r.total,
    });
  });
  return lignes.sort((a, b) => a.date.localeCompare(b.date) || a.numero.localeCompare(b.numero));
}

export interface RecapMois { cle: string; nb: number; service: number; materiau: number; total: number }

export function recapMensuel(lignes: LigneLivre[]): RecapMois[] {
  const m = new Map<string, RecapMois>();
  lignes.forEach(l => {
    const r = m.get(l.cle) ?? { cle: l.cle, nb: 0, service: 0, materiau: 0, total: 0 };
    r.nb += 1; r.service = arrondi2(r.service + l.service); r.materiau = arrondi2(r.materiau + l.materiau); r.total = arrondi2(r.total + l.total);
    m.set(l.cle, r);
  });
  return [...m.values()].sort((a, b) => a.cle.localeCompare(b.cle));
}

export const totaux = (lignes: LigneLivre[]) => lignes.reduce(
  (t, l) => ({ nb: t.nb + 1, service: arrondi2(t.service + l.service), materiau: arrondi2(t.materiau + l.materiau), total: arrondi2(t.total + l.total) }),
  { nb: 0, service: 0, materiau: 0, total: 0 },
);

/** Neutralise l'injection de formule (=, +, -, @, tabulation, retour chariot en tête). */
export const texteCsv = (v: unknown): string => { const t = String(v ?? ""); return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t; };
export const euros = (n: number): string => nombre(n).toFixed(2).replace(".", ",");
const cellule = (v: unknown): string => `"${String(v ?? "").replace(/"/g, '""')}"`;
const ligneCsv = (cells: unknown[]) => cells.map(cellule).join(";");
const dateFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function genererCsv(lignes: LigneLivre[], p: Periode): string {
  const t = totaux(lignes);
  const sortie: string[] = [
    ligneCsv([`Livre des recettes — ${libellePeriode(p)}`]),
    ligneCsv(["Factures encaissées, classées par date d'encaissement. Montants en euros ; franchise en base de TVA : TTC = HT."]),
    ligneCsv(["Mode de règlement non enregistré par l'application : à compléter si votre comptabilité l'exige."]),
    "",
    ligneCsv(["Date d'encaissement", "N° facture", "Client", "Nature", "Désignation", "Services (€)", "Marchandises (€)", "Montant encaissé (€)", "Mode de règlement"]),
    ...lignes.map(l => ligneCsv([dateFr(l.date), texteCsv(l.numero), texteCsv(l.client), l.nature, texteCsv(l.designation), euros(l.service), euros(l.materiau), euros(l.total), ""])),
    ligneCsv(["TOTAL", "", `${t.nb} facture${t.nb > 1 ? "s" : ""}`, "", "", euros(t.service), euros(t.materiau), euros(t.total), ""]),
    "",
    ligneCsv(["Récapitulatif mensuel (déclaration de chiffre d'affaires)"]),
    ligneCsv(["Mois", "Nb factures", "Services (€)", "Marchandises (€)", "Total (€)"]),
    ...recapMensuel(lignes).map(r => ligneCsv([`${MOIS[Number(r.cle.slice(5)) - 1]} ${r.cle.slice(0, 4)}`, r.nb, euros(r.service), euros(r.materiau), euros(r.total)])),
    ligneCsv(["TOTAL", t.nb, euros(t.service), euros(t.materiau), euros(t.total)]),
  ];
  return sortie.join("\r\n");
}
