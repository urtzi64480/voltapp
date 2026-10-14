// src/lib/gaines-optimisees-plan.ts
//
// Pont entre le plan (niveaux, circuits générés) et le moteur pur gaines-optimisees.ts : extrait pour chaque circuit son point d'entrée (premier
// appareillage atteint depuis le tableau ou le point d'arrivée des gaines) puis lance l'optimisation, niveau par niveau.

import type { Niveau, Point } from "./maison-types";
import { estAnnexe, origineCircuits } from "./maison-types";
import { breakersDuNiveau, genererGainesNiveaux, segmentsPourCircuit, type ResultatGeneration } from "./maison-engine";
import { effectiveSection, estCircuitSansDisjoncteur } from "./electrical-constants";
import { optimiserGaines, type CircuitGaine, type ForcagesGaines, type ParamsGainesOptimisees, type ResultatGainesOptimisees } from "./gaines-optimisees";

export interface GainesNiveau extends ResultatGainesOptimisees {
  niveauId: number;
  origine: Point;
  /** Circuits du niveau sans point d'entrée (non raccordés) : ignorés par l'optimisation. */
  ignores: string[];
  /** Ce niveau porte le tableau de sa propre installation (maison principale ou annexe) : ses gaines partent du tableau. */
  porteTableau: boolean;
}

/** Circuits d'un niveau avec leur point d'entrée ; null si le niveau n'a ni tableau ni point d'arrivée des gaines. */
export function circuitsGainesNiveau(resultat: ResultatGeneration, niveau: Niveau): { origine: Point; circuits: CircuitGaine[]; ignores: string[] } | null {
  const origine = origineCircuits(niveau);
  if (!origine) return null;
  const circuits: CircuitGaine[] = [];
  const ignores: string[] = [];
  const points = (id: number) => niveau.pieces.flatMap(p => p.appareillages).filter(a => a.circuitId === id);
  breakersDuNiveau(resultat.breakers, niveau).forEach(b => {
    const manuel = b.manuelId != null ? (niveau.circuitsManuels ?? []).find(m => m.id === b.manuelId) : undefined;
    if (manuel?.nonRelieTableau) return;
    try {
      const segs = segmentsPourCircuit(b, points(b.id), niveau, origine);
      const premier = segs.find(sg => sg.aId === "tableau" && sg.type !== "domotique");
      if (!premier) { ignores.push(b.label); return; }
      circuits.push({
        cle: b.label, breakerId: b.id, label: b.label || b.circuit, circuit: b.circuit, amperes: b.amperes, section: effectiveSection(b),
        entree: premier.bPoint, courantFaible: estCircuitSansDisjoncteur(b),
      });
    } catch { ignores.push(b.label); }
  });
  return { origine, circuits, ignores };
}

/** Optimise les gaines de chaque niveau qui a une origine. */
export function optimiserGainesMaison(
  resultat: ResultatGeneration, niveaux: Niveau[], params: ParamsGainesOptimisees, forcages: ForcagesGaines,
): Record<number, GainesNiveau> {
  const res: Record<number, GainesNiveau> = {};
  niveaux.forEach(n => {
    const c = circuitsGainesNiveau(resultat, n);
    if (!c || c.circuits.length === 0) return;
    res[n.id] = { ...optimiserGaines(c.circuits, c.origine, params, forcages), niveauId: n.id, origine: c.origine, ignores: c.ignores, porteTableau: !!n.tableauPos };
  });
  return res;
}

export interface SyntheseGaines {
  /** Départs au niveau du tableau (avant / après), montées vers les autres niveaux comprises. */
  departsAvant: number;
  departsApres: number;
  gaineAvantM: number;
  gaineApresM: number;
  cableAvantM: number;
  cableApresM: number;
  /** Montées tableau → autre niveau (inchangées par l'optimisation). */
  montees: { niveauId: number; niveau: string; nbGaines: number; gaine: string }[];
}

/** Bilan global : les gaines qui partent du tableau (niveaux qui portent un tableau) + les montées vers les autres niveaux de la maison. */
export function syntheseGaines(resultat: ResultatGeneration, gaines: Record<number, GainesNiveau>): SyntheseGaines {
  const s: SyntheseGaines = { departsAvant: 0, departsApres: 0, gaineAvantM: 0, gaineApresM: 0, cableAvantM: 0, cableApresM: 0, montees: [] };
  Object.values(gaines).forEach(g => {
    s.gaineAvantM += g.avant.gaineM; s.gaineApresM += g.apres.gaineM; s.cableAvantM += g.avant.cableM; s.cableApresM += g.apres.cableM;
    if (g.porteTableau) { s.departsAvant += g.avant.departs; s.departsApres += g.apres.departs; }
  });
  const niveauxTableau = new Set(Object.values(gaines).filter(g => g.porteTableau).map(g => g.niveauId));
  genererGainesNiveaux(resultat).forEach(t => {
    const niv = resultat.maison.niveaux.find(n => (n.nom || n.type) === t.niveau);
    if (niv && (niveauxTableau.has(niv.id) || estAnnexe(niv))) return;
    s.montees.push({ niveauId: niv?.id ?? -1, niveau: t.niveau, nbGaines: t.nbGaines, gaine: t.gaine });
    s.departsAvant += t.nbGaines; s.departsApres += t.nbGaines;
  });
  return s;
}
