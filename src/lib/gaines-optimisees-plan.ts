// src/lib/gaines-optimisees-plan.ts
//
// Pont entre le plan (niveaux, circuits générés) et le moteur pur gaines-optimisees.ts : extrait pour chaque circuit son point d'entrée (premier
// appareillage atteint depuis le tableau ou le point d'arrivée des gaines) puis lance l'optimisation, niveau par niveau.

import type { Niveau, Point } from "./maison-types";
import { estAnnexe, origineCircuits } from "./maison-types";
import { breakersDuNiveau, genererGainesNiveaux, segmentsPourCircuit, type ResultatGeneration } from "./maison-engine";
import { effectiveSection, estCircuitSansDisjoncteur } from "./electrical-constants";
import { accrocherAuMur, routeDansMurs } from "./routage-murs";
import { routeDansPieces } from "./routage-circuits";
import { optimiserGaines, type CircuitGaine, type ForcagesGaines, type ParamsGainesOptimisees, type ResultatGainesOptimisees, type TronconArbre } from "./gaines-optimisees";

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

const longueurLigne = (pts: Point[]): number => pts.reduce((t, q, i) => (i ? t + Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y) : 0), 0);
const memePoint = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 0.02;

/**
 * Fait passer l'arbre de gaines là où passent vraiment les câbles : les boîtes de dérivation sont posées DANS un mur (au plus près du point
 * optimal), chaque tronçon suit l'épaisseur des murs, et ne passe au plafond (plus court) que si les murs imposent un gros détour.
 * Met à jour tracés, longueurs de tronçons / gaines et bilan « après ».
 */
export function acheminerGaines(g: ResultatGainesOptimisees, niveau: Niveau, origine: Point, circuits: CircuitGaine[]): void {
  const pieces = niveau.pieces;
  if (pieces.length === 0) return;
  // 1) boîtes dans un mur : tous les nœuds intermédiaires (point d'arrivée d'un tronçon qui a des enfants)
  const cle = (q: Point) => `${q.x.toFixed(4)},${q.y.toFixed(4)}`;
  const accroche = new Map<string, Point>();
  g.groupes.forEach(gr => gr.troncons.forEach(t => {
    if (!gr.troncons.some(x => x.parent === t.id) || accroche.has(cle(t.vers))) return;
    const a = accrocherAuMur(t.vers, pieces, 3);
    if (a) accroche.set(cle(t.vers), a);
  }));
  const pt = (q: Point): Point => accroche.get(cle(q)) ?? q;
  g.boites.forEach(b => { b.point = { ...pt(b.point) }; });
  g.groupes.forEach(gr => gr.troncons.forEach(t => { t.vers = { ...pt(t.vers) }; if (t.parent) t.de = { ...pt(t.de) }; }));
  // 2) tracé de chaque tronçon
  g.groupes.forEach(gr => {
    gr.troncons.forEach(t => {
      const aMur = t.parent ? t.de : (accrocherAuMur(t.de, pieces, 3) ?? t.de);
      const feuille = !gr.troncons.some(x => x.parent === t.id);
      const bMur = feuille ? (accrocherAuMur(t.vers, pieces, 3) ?? t.vers) : t.vers;
      let murs: Point[] | null = null;
      try { const r = routeDansMurs(aMur, bMur, pieces); murs = r ? [aMur, ...r.map(w => w.point), bMur] : null; } catch { murs = null; }
      if (murs && !memePoint(murs[murs.length - 1], t.vers)) murs.push(t.vers);
      if (murs && !memePoint(murs[0], t.de)) murs.unshift(t.de);
      let plafond: Point[] = [t.de, t.vers];
      try { plafond = [t.de, ...routeDansPieces(t.de, t.vers, pieces), t.vers]; } catch { /* ligne droite */ }
      const lm = murs ? longueurLigne(murs) : Infinity, lp = longueurLigne(plafond);
      if (murs && lm <= lp * 1.5 + 1) { t.chemin = murs; t.passage = "murs"; t.longueurM = lm; }
      else { t.chemin = plafond; t.passage = lp > 0 && plafond.length > 2 ? "plafond" : "direct"; t.longueurM = lp; }
    });
    gr.longueurM = gr.troncons.reduce((s, t) => s + t.longueurM, 0);
  });
  // 3) bilan : câble (chaque circuit suit sa chaîne de tronçons) et gaine
  let cable = 0;
  g.groupes.forEach(gr => gr.circuits.forEach(c => {
    let t: TronconArbre | undefined = gr.troncons.find(x => x.circuits.length === 1 && x.circuits[0] === c.cle);
    while (t) { cable += t.longueurM; const par: string | null = t.parent; t = par ? gr.troncons.find(x => x.id === par) : undefined; }
  }));
  g.apres = { departs: g.groupes.length, gaineM: g.groupes.reduce((s, x) => s + x.longueurM, 0), cableM: cable };
  // « avant » : départs individuels tracés de la même façon (murs / plafond) pour une comparaison honnête
  let avant = 0;
  circuits.forEach(c => {
    const aMur = accrocherAuMur(origine, pieces, 3) ?? origine, bMur = accrocherAuMur(c.entree, pieces, 3) ?? c.entree;
    let lm = Infinity;
    try { const r = routeDansMurs(aMur, bMur, pieces); if (r) lm = longueurLigne([origine, aMur, ...r.map(w => w.point), bMur, c.entree]); } catch { /* */ }
    let lp = Math.hypot(origine.x - c.entree.x, origine.y - c.entree.y);
    try { lp = longueurLigne([origine, ...routeDansPieces(origine, c.entree, pieces), c.entree]); } catch { /* */ }
    avant += lm <= lp * 1.5 + 1 ? lm : lp;
  });
  g.avant = { departs: circuits.length, gaineM: avant, cableM: avant };
}

/** Optimise les gaines de chaque niveau qui a une origine. */
export function optimiserGainesMaison(
  resultat: ResultatGeneration, niveaux: Niveau[], params: ParamsGainesOptimisees, forcages: ForcagesGaines,
): Record<number, GainesNiveau> {
  const res: Record<number, GainesNiveau> = {};
  niveaux.forEach(n => {
    const c = circuitsGainesNiveau(resultat, n);
    if (!c || c.circuits.length === 0) return;
    const opt = optimiserGaines(c.circuits, c.origine, params, forcages);
    try { acheminerGaines(opt, n, c.origine, c.circuits); } catch { /* tracé en ligne droite en repli */ }
    res[n.id] = { ...opt, niveauId: n.id, origine: c.origine, ignores: c.ignores, porteTableau: !!n.tableauPos };
  });
  return res;
}

export interface SyntheseGaines {
  /** Départs au niveau du tableau (avant / après), montées vers les autres niveaux comprises. */
  departsAvant: number;
  departsApres: number;
  gaineAvantM: number;
  gaineApresM: number;
  /** Boîtes de dérivation créées (avant : aucune). */
  boites: number;
  cableAvantM: number;
  cableApresM: number;
  /** Montées tableau → autre niveau (inchangées par l'optimisation). */
  montees: { niveauId: number; niveau: string; nbGaines: number; gaine: string }[];
}

/** Bilan global : les gaines qui partent du tableau (niveaux qui portent un tableau) + les montées vers les autres niveaux de la maison. */
export function syntheseGaines(resultat: ResultatGeneration, gaines: Record<number, GainesNiveau>): SyntheseGaines {
  const s: SyntheseGaines = { departsAvant: 0, departsApres: 0, gaineAvantM: 0, gaineApresM: 0, boites: 0, cableAvantM: 0, cableApresM: 0, montees: [] };
  Object.values(gaines).forEach(g => {
    s.boites += g.boites.length;
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
