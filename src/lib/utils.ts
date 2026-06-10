import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fmt = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);

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

export const UNITES = ["forfait", "heure", "u", "ml", "m2"] as const;
export const BRANCHES = ["service", "materiau"] as const;
export const STATUTS_DEVIS = ["brouillon", "envoye", "signe", "refuse", "expire"] as const;
export const STATUTS_FACTURE = ["envoyee", "payee", "relance", "impayee"] as const;
export const PLAFOND_SERVICE = 77700;
export const PLAFOND_MATERIAU = 188700;

export const STATUT_LABELS: Record<string, string> = {
  brouillon: "Brouillon", envoye: "Envoyé", signe: "Signé",
  refuse: "Refusé", expire: "Expiré",
  envoyee: "Envoyée", payee: "Payée", relance: "Relancée", impayee: "Impayée",
  actif: "Actif", inactif: "Inactif", vip: "VIP",
};

export const STATUT_COLORS: Record<string, string> = {
  brouillon: "bg-ink-100 text-ink-600",
  envoye:    "bg-volt-100 text-volt-700",
  signe:     "bg-emerald-100 text-emerald-700",
  refuse:    "bg-red-100 text-red-700",
  expire:    "bg-ink-100 text-ink-500",
  envoyee:   "bg-volt-100 text-volt-700",
  payee:     "bg-emerald-100 text-emerald-700",
  relance:   "bg-orange-100 text-orange-700",
  impayee:   "bg-red-100 text-red-700",
  actif:     "bg-emerald-100 text-emerald-700",
  inactif:   "bg-ink-100 text-ink-500",
  vip:       "bg-volt-100 text-volt-700",
};
