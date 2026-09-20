"use client";
import { AppareillageType } from "@/lib/maison-types";

export const PALETTE: { type: AppareillageType; label: string; categorie: string }[] = [
  { type: "prise",           label: "Prise de courant",              categorie: "Prises" },
  { type: "prise_commandee", label: "Prise commandée",               categorie: "Prises" },
  { type: "point_lumineux",  label: "Point lumineux (plafond)",      categorie: "Éclairage" },
  { type: "applique",        label: "Applique murale",                categorie: "Éclairage" },
  { type: "interrupteur",    label: "Interrupteur simple",           categorie: "Commandes" },
  { type: "va_et_vient",     label: "Va-et-vient",                    categorie: "Commandes" },
  { type: "telerupteur",     label: "Bouton poussoir (télérupteur)", categorie: "Commandes" },
  { type: "four",            label: "Four",                           categorie: "Appareils dédiés" },
  { type: "plaque",          label: "Plaque de cuisson",              categorie: "Appareils dédiés" },
  { type: "lave_linge",      label: "Lave-linge",                     categorie: "Appareils dédiés" },
  { type: "lave_vaisselle",  label: "Lave-vaisselle",                 categorie: "Appareils dédiés" },
  { type: "seche_linge",     label: "Sèche-linge",                    categorie: "Appareils dédiés" },
  { type: "chauffe_eau",     label: "Chauffe-eau",                    categorie: "Appareils dédiés" },
  { type: "chauffage",       label: "Chauffage électrique",           categorie: "Appareils dédiés" },
  { type: "clim",            label: "Climatisation",                  categorie: "Appareils dédiés" },
  { type: "seche_serviette", label: "Sèche-serviette",                categorie: "Appareils dédiés" },
  { type: "congelateur",     label: "Congélateur",                    categorie: "Appareils dédiés" },
  { type: "irve",            label: "Borne IRVE",                     categorie: "Appareils dédiés" },
  { type: "piscine",         label: "Piscine / PAC",                  categorie: "Appareils dédiés" },
  { type: "vmc",             label: "VMC",                            categorie: "Appareils dédiés" },
  { type: "alarme",          label: "Alarme",                         categorie: "Appareils dédiés" },
];

export function labelAppareillage(type: AppareillageType): string {
  return PALETTE.find(p => p.type === type)?.label ?? type;
}

const DEDIE_INITIALES: Record<string, string> = {
  four: "F", plaque: "PC", lave_linge: "LL", lave_vaisselle: "LV", seche_linge: "SL",
  chauffe_eau: "CE", chauffage: "CH", clim: "CL", seche_serviette: "SS",
  congelateur: "CG", irve: "EV", piscine: "PI", vmc: "VMC", alarme: "AL",
};

// Symboles normalisés d'implantation (base CEI/NF EN 60617, convention UTE/Promotelec),
// dessinés en SVG — même logique que le BreakerSVG existant du module Tableau.
export function AppareillageSymbol({ type, size = 20, color = "#1c1917" }: {
  type: AppareillageType; size?: number; color?: string;
}) {
  const stroke = { stroke: color, strokeWidth: 1.4, fill: "none" as const };

  switch (type) {
    case "prise":
      return (
        <svg width={size} height={size} viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="7" {...stroke} />
          <circle cx="7.5" cy="10" r="1" fill={color} />
          <circle cx="12.5" cy="10" r="1" fill={color} />
        </svg>
      );
    case "prise_commandee":
      return (
        <svg width={size} height={size} viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="7" {...stroke} />
          <circle cx="7.5" cy="10" r="1" fill={color} />
          <circle cx="12.5" cy="10" r="1" fill={color} />
          <line x1="4.5" y1="15.5" x2="15.5" y2="4.5" stroke={color} strokeWidth={1.4} />
        </svg>
      );
    case "point_lumineux":
      return (
        <svg width={size} height={size} viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="7" {...stroke} />
        </svg>
      );
    case "applique":
      return (
        <svg width={size} height={size} viewBox="0 0 20 20">
          <path d="M 3 3 A 7 7 0 0 1 3 17" {...stroke} />
          <line x1="3" y1="3" x2="3" y2="17" stroke={color} strokeWidth={1.4} />
        </svg>
      );
    case "interrupteur":
      return (
        <svg width={size} height={size} viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="6" {...stroke} />
          <line x1="6" y1="13" x2="13" y2="7" stroke={color} strokeWidth={1.4} />
        </svg>
      );
    case "va_et_vient":
      return (
        <svg width={size} height={size} viewBox="0 0 20 20">
          <circle cx="10" cy="9" r="6" {...stroke} />
          <line x1="6" y1="12" x2="13" y2="6" stroke={color} strokeWidth={1.4} />
          <text x="10" y="19" fontSize="6" textAnchor="middle" fill={color} fontFamily="monospace">VV</text>
        </svg>
      );
    case "telerupteur":
      return (
        <svg width={size} height={size} viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="6" {...stroke} />
          <text x="10" y="12.5" fontSize="6" textAnchor="middle" fill={color} fontFamily="monospace">BP</text>
        </svg>
      );
    default: {
      const txt = DEDIE_INITIALES[type] ?? "?";
      return (
        <svg width={size} height={size} viewBox="0 0 20 20">
          <rect x="3" y="3" width="14" height="14" rx="2" {...stroke} />
          <text x="10" y="13" fontSize="6" textAnchor="middle" fill={color} fontFamily="monospace" fontWeight="bold">{txt}</text>
        </svg>
      );
    }
  }
}

// Version chaîne SVG (pour la fenêtre d'impression, hors React — même approche que
// printLabels()/rendreSVGImprimable() déjà utilisés ailleurs dans VoltApp).
export function appareillageSymbolSvgString(type: AppareillageType, x: number, y: number, size = 14, color = "#1c1917"): string {
  const r = size / 2;
  switch (type) {
    case "prise":
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="1.2"/>
        <circle cx="${x - r * 0.35}" cy="${y}" r="1" fill="${color}"/>
        <circle cx="${x + r * 0.35}" cy="${y}" r="1" fill="${color}"/>`;
    case "prise_commandee":
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="1.2"/>
        <circle cx="${x - r * 0.35}" cy="${y}" r="1" fill="${color}"/>
        <circle cx="${x + r * 0.35}" cy="${y}" r="1" fill="${color}"/>
        <line x1="${x - r * 0.7}" y1="${y + r * 0.7}" x2="${x + r * 0.7}" y2="${y - r * 0.7}" stroke="${color}" stroke-width="1.2"/>`;
    case "point_lumineux":
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="1.2"/>`;
    case "applique":
      return `<path d="M ${x - r} ${y - r} A ${r} ${r} 0 0 0 ${x - r} ${y + r}" fill="none" stroke="${color}" stroke-width="1.2"/>
        <line x1="${x - r}" y1="${y - r}" x2="${x - r}" y2="${y + r}" stroke="${color}" stroke-width="1.2"/>`;
    case "interrupteur":
      return `<circle cx="${x}" cy="${y}" r="${r * 0.85}" fill="none" stroke="${color}" stroke-width="1.2"/>
        <line x1="${x - r * 0.5}" y1="${y + r * 0.5}" x2="${x + r * 0.5}" y2="${y - r * 0.5}" stroke="${color}" stroke-width="1.2"/>`;
    case "va_et_vient":
      return `<circle cx="${x}" cy="${y}" r="${r * 0.85}" fill="none" stroke="${color}" stroke-width="1.2"/>
        <line x1="${x - r * 0.5}" y1="${y + r * 0.5}" x2="${x + r * 0.5}" y2="${y - r * 0.5}" stroke="${color}" stroke-width="1.2"/>
        <text x="${x}" y="${y + r + 6}" font-size="5" text-anchor="middle" fill="${color}" font-family="monospace">VV</text>`;
    case "telerupteur":
      return `<circle cx="${x}" cy="${y}" r="${r * 0.85}" fill="none" stroke="${color}" stroke-width="1.2"/>
        <text x="${x}" y="${y + 2}" font-size="5" text-anchor="middle" fill="${color}" font-family="monospace">BP</text>`;
    default: {
      const txt = DEDIE_INITIALES[type] ?? "?";
      return `<rect x="${x - r}" y="${y - r}" width="${size}" height="${size}" rx="2" fill="none" stroke="${color}" stroke-width="1.2"/>
        <text x="${x}" y="${y + 2}" font-size="5" text-anchor="middle" fill="${color}" font-family="monospace" font-weight="bold">${txt}</text>`;
    }
  }
}
