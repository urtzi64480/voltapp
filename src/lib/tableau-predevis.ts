// src/lib/tableau-predevis.ts
//
// Pré-devis d'un tableau refait (outil IA) : mêmes besoins, même appariement catalogue et même génération de lignes que le pré-devis du plan
// (predevis-engine), mais sans plan. Fonctions pures. Rien n'est inventé : un besoin sans article au catalogue devient une ligne « À compléter » à 0 €.

import type { BreakerRow } from "./electrical-constants";
import type { DevisLigne, Prestation } from "@/types";
import { apparierCatalogue, calculerBesoinsTableau, genererLignesDevis, POSTE_MAIN_OEUVRE, type BesoinApparie, type ChoixLigne, type OptionArticle } from "./predevis-engine";
import { arrondi2 } from "./utils";

export interface LignePredevisTableau {
  besoin: BesoinApparie;
  inclus: boolean;
  /** Option catalogue retenue (index dans besoin.options) ; ignoré si le besoin n'a aucune option. */
  indexOption: number;
}

export interface PredevisTableau {
  lignes: LignePredevisTableau[];
  alertes: string[];
  nbSansArticle: number;
}

/** Option par défaut : la gamme « moyenne » si elle existe, sinon la première (la moins chère par construction du moteur). */
export function indexOptionParDefaut(options: OptionArticle[]): number {
  const i = options.findIndex(o => o.gamme === "moyenne");
  return i >= 0 ? i : 0;
}

export function preparerPredevisTableau(rows: BreakerRow[], prestations: Prestation[]): PredevisTableau {
  const { besoins, alertes } = calculerBesoinsTableau(rows);
  const { parPiece } = apparierCatalogue(besoins, prestations);
  const lignes: LignePredevisTableau[] = Object.values(parPiece).flat().map(b => ({ besoin: b, inclus: true, indexOption: indexOptionParDefaut(b.options) }));
  return { lignes, alertes, nbSansArticle: lignes.filter(l => l.besoin.options.length === 0).length };
}

export interface MainOeuvreTableau {
  heures: number;
  tauxHoraire: number;
  /** Article « main d'œuvre » du catalogue, s'il y en a un (reprend son nom et son id). */
  option?: { nom: string; prestation_id?: string } | null;
}

export function lignesDevisTableau(lignes: LignePredevisTableau[], prestations: Prestation[], mo?: MainOeuvreTableau): Omit<DevisLigne, "devis_id" | "ordre">[] {
  const choix: ChoixLigne[] = lignes.filter(l => l.inclus).map(l => {
    const opt = l.besoin.options[l.indexOption] ?? l.besoin.options[0];
    return opt ? { besoin: l.besoin, optionCatalogue: opt } : { besoin: l.besoin, aCompleter: true };
  });
  const out = genererLignesDevis(choix, prestations);
  if (mo && mo.heures > 0 && mo.tauxHoraire >= 0) {
    out.push({
      nom: mo.option?.nom ?? "Main d'œuvre — tableau électrique", quantite: mo.heures, prix_unitaire: mo.tauxHoraire, unite: "heure",
      type_branche: "service", prestation_id: mo.option?.prestation_id, poste: POSTE_MAIN_OEUVRE,
    });
  }
  return out;
}

export function totauxLignesDevis(lignes: Pick<DevisLigne, "quantite" | "prix_unitaire" | "type_branche">[]): { service: number; materiau: number; total: number } {
  const somme = (t: "service" | "materiau") => lignes.filter(l => l.type_branche === t).reduce((s, l) => s + arrondi2(l.quantite * l.prix_unitaire), 0);
  const service = arrondi2(somme("service")), materiau = arrondi2(somme("materiau"));
  return { service, materiau, total: arrondi2(service + materiau) };
}
