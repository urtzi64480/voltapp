// src/lib/suivi-bilan.ts
//
// BILAN DE FIN DE CHANTIER : compare le temps de main d'œuvre CHIFFRÉ dans le devis (lignes en heures, par poste — voir
// predevis-engine : un poste = un circuit ou une pièce selon le mode choisi) au temps réellement PASSÉ, saisi dans le suivi
// de réalisation (par circuit, ou directement par poste pour les postes qui ne sont pas un circuit).
//
// Module PUR. Jamais bloquant : sans devis, sans heures chiffrées ou sans temps saisi, le bilan se contente d'être vide.
import { POSTE_MAIN_OEUVRE } from "@/lib/predevis-engine";
import type { CircuitSuivi } from "@/lib/suivi-realisation";
import type { Minutes } from "@/lib/suivi-persistance";

/** Une ligne de devis en heures (unité « heure »), avec son poste (null = hors poste). */
export interface HeuresDevis { poste: string | null; heures: number; montant: number }

export interface LigneBilan {
  poste: string;
  circuitCle?: string;      // le poste est un circuit du plan : le temps passé se saisit sur le circuit
  chiffreMin: number;       // temps chiffré (0 = aucune heure chiffrée pour ce poste)
  passeMin: number;         // temps passé (0 = rien saisi)
}

export interface Bilan {
  lignes: LigneBilan[];             // postes chiffrés, puis temps passés sur des postes non chiffrés
  generalChiffreMin: number;        // heures non rattachées à un poste (« Main d'œuvre et frais » / hors poste)
  totalChiffreMin: number;
  totalPasseMin: number;
  montantMO: number;                // € facturés en main d'œuvre (lignes en heures)
  chiffreParCircuit: Record<string, number>; // clé de circuit → minutes chiffrées sur son poste
  aDesHeuresChiffrees: boolean;
  aDuTempsPasse: boolean;
}

const arrondi = (h: number) => Math.round(h * 60);

export function calculerBilan(circuits: CircuitSuivi[], devis: HeuresDevis[] | null, temps: Minutes, tempsPostes: Minutes): Bilan {
  const chiffreParPoste = new Map<string, number>();
  let general = 0, montant = 0;
  (devis ?? []).forEach(l => {
    if (!(l.heures > 0)) return;
    montant += l.montant;
    if (!l.poste || l.poste === POSTE_MAIN_OEUVRE) { general += arrondi(l.heures); return; }
    chiffreParPoste.set(l.poste, (chiffreParPoste.get(l.poste) ?? 0) + arrondi(l.heures));
  });

  const circuitDuPoste = new Map<string, CircuitSuivi>();
  circuits.forEach(c => { if (!circuitDuPoste.has(c.poste)) circuitDuPoste.set(c.poste, c); });

  const lignes: LigneBilan[] = [];
  const postesVus = new Set<string>();
  chiffreParPoste.forEach((chiffreMin, poste) => {
    const c = circuitDuPoste.get(poste);
    postesVus.add(poste);
    lignes.push({ poste, circuitCle: c?.cle, chiffreMin, passeMin: c ? (temps[c.cle] ?? 0) : (tempsPostes[poste] ?? 0) });
  });
  // Temps passé sur un circuit dont le poste n'a aucune heure chiffrée (mode « pièce », ou poste sans main d'œuvre saisie).
  circuits.forEach(c => {
    if (postesVus.has(c.poste) || !(temps[c.cle] > 0)) return;
    postesVus.add(c.poste);
    lignes.push({ poste: c.poste, circuitCle: c.cle, chiffreMin: 0, passeMin: temps[c.cle] });
  });
  Object.entries(tempsPostes).forEach(([poste, passeMin]) => {
    if (postesVus.has(poste) || !(passeMin > 0)) return;
    postesVus.add(poste);
    lignes.push({ poste, chiffreMin: 0, passeMin });
  });
  lignes.sort((a, b) => a.poste.localeCompare(b.poste, "fr"));

  const chiffreParCircuit: Record<string, number> = {};
  circuits.forEach(c => { const m = chiffreParPoste.get(c.poste); if (m) chiffreParCircuit[c.cle] = m; });

  const cles = new Set(circuits.map(c => c.cle));
  const passeCircuits = Object.entries(temps).reduce((s, [k, m]) => s + (cles.has(k) ? m : 0), 0);
  const passePostes = Object.values(tempsPostes).reduce((s, m) => s + m, 0);
  const totalChiffreMin = general + [...chiffreParPoste.values()].reduce((s, m) => s + m, 0);
  const totalPasseMin = passeCircuits + passePostes;
  return {
    lignes, generalChiffreMin: general, totalChiffreMin, totalPasseMin, montantMO: montant, chiffreParCircuit,
    aDesHeuresChiffrees: totalChiffreMin > 0, aDuTempsPasse: totalPasseMin > 0,
  };
}

/** Écart passé / chiffré en % (null si l'un des deux manque). Positif = plus long que prévu. */
export const ecartPourcent = (chiffreMin: number, passeMin: number): number | null =>
  chiffreMin > 0 && passeMin > 0 ? Math.round(((passeMin - chiffreMin) / chiffreMin) * 100) : null;
