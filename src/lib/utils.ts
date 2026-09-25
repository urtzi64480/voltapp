import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export const fmt = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", useGrouping: false }).format(n);
export const fmtDate = (d: string | Date) =>
  new Intl.DateTimeFormat("fr-FR").format(typeof d === "string" ? new Date(d) : d);
export const fmtDatetime = (d: string | Date) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(typeof d === "string" ? new Date(d) : d);
export const genNumero = (prefixe: string, compteur: number) =>
  `${prefixe}-${new Date().getFullYear()}-${String(compteur + 1).padStart(3, "0")}`;
export const initiales = (nom: string, prenom?: string | null) => {
  const n = nom.trim()[0]?.toUpperCase() ?? "";
  const p = prenom?.trim()[0]?.toUpperCase() ?? "";
  return p ? `${p}${n}` : n.slice(0, 2);
};
// Nom d'un article de devis pour un article catalogue vendu en longueur fixe (câble, fil,
// gaine, moulure — sous_categorie de la forme "cablage_X"/"fil_X"/"gaine_irlXX"/"moulure").
// Précise le conditionnement ET la longueur unitaire directement dans le nom persisté sur
// la ligne (devis_lignes.nom) — sans ça, la liste de courses n'affiche qu'une quantité en
// unités ("2×") sans dire si c'est 2 bobines de 25m, de 50m... impossible à utiliser pour
// l'achat en magasin. Utilisé partout où une ligne de devis matériau est créée à partir du
// catalogue : pré-devis (predevis-engine.ts), nouveau devis manuel et édition d'un devis
// (devis/[id]/page.tsx, devis/nouveau/page.tsx) — pas seulement le module pré-devis.
// Gaine/moulure → "rouleau" (usage courant du métier) ; câble/fil → "bobine". Article vendu
// au mètre linéaire (longueur_unitaire absent/null) : nom inchangé.
export function nomAvecConditionnement(nom: string, longueurUnitaire: number | null | undefined, sousCategorie: string | null | undefined): string {
  if (!longueurUnitaire || longueurUnitaire <= 0) return nom;
  const mot = sousCategorie && (sousCategorie.startsWith("gaine_") || sousCategorie === "moulure") ? "rouleau" : "bobine";
  return `${nom} (${mot} ${longueurUnitaire}m)`;
}
export const UNITES = ["forfait", "heure", "u", "ml", "m2"] as const;export const BRANCHES = ["service", "materiau"] as const;
export const STATUTS_DEVIS = ["brouillon", "envoye", "signe", "refuse", "expire"] as const;
export const STATUTS_FACTURE = ["a_envoyer", "envoyee", "payee", "relance", "impayee"] as const;
export const PLAFOND_SERVICE = 83600;
export const PLAFOND_MATERIAU = 203100;
export const STATUT_LABELS: Record<string, string> = {
  brouillon: "Brouillon", envoye: "Envoyé", signe: "Signé",
  refuse: "Refusé", expire: "Expiré",
  a_envoyer: "À envoyer",
  envoyee: "Envoyée", payee: "Payée", relance: "Relancée", impayee: "Impayée",
  actif: "Actif", inactif: "Inactif", vip: "VIP",
};
export const STATUT_COLORS: Record<string, string> = {
  brouillon: "bg-ink-100 text-ink-600",
  envoye:    "bg-volt-100 text-volt-700",
  signe:     "bg-emerald-100 text-emerald-700",
  refuse:    "bg-red-100 text-red-700",
  expire:    "bg-ink-100 text-ink-500",
  a_envoyer: "bg-blue-100 text-blue-700",
  envoyee:   "bg-volt-100 text-volt-700",
  payee:     "bg-emerald-100 text-emerald-700",
  relance:   "bg-orange-100 text-orange-700",
  impayee:   "bg-red-100 text-red-700",
  actif:     "bg-emerald-100 text-emerald-700",
  inactif:   "bg-ink-100 text-ink-500",
  vip:       "bg-volt-100 text-volt-700",
};
