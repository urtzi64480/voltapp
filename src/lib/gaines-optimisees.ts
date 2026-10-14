// src/lib/gaines-optimisees.ts
//
// GAINES OPTIMISÉES AU DÉPART DU TABLEAU : au lieu d'une gaine par circuit (40 circuits = 40 gaines), les circuits qui partent dans la même direction
// partagent un TRONC de gaine qui se sépare en BRANCHES. Chaque gaine reste remplie à 33 % au plus (gaineRecommandee : règle des 33 % de remplissage des conduits), avec un nombre maximal de circuits par gaine (avertissement, jamais un blocage). Les courants faibles ont leur propre gaine VERTE.
//
// Fonctions pures (points et sorties en mètres, comme le plan). Le module ne modifie rien : il propose un arbre de gaines, l'interface décide de l'appliquer.
//
// Algorithme : regroupement hiérarchique glouton. Chaque circuit est une feuille (son point d'entrée = premier appareillage atteint depuis l'origine).
// On fusionne à chaque pas les deux nœuds dont la fusion fait gagner le plus de gaine (longueur + pénalité par départ), tant que le tronc obtenu respecte
// le remplissage et le nombre de circuits maxi. Le point de séparation d'un tronc est le point de Fermat (point qui minimise la somme des 3 longueurs).

import type { Point } from "./maison-types";
import { GAINES_IRL, cablesPrises, gaineRecommandee } from "./electrical-constants";

export interface CircuitGaine {
  /** Clé stable : libellé du disjoncteur. */
  cle: string;
  breakerId: number;
  label: string;
  circuit: string;
  amperes: number;
  /** Section de câble (mm², texte « 1.5 »). */
  section: string;
  /** Premier point atteint depuis l'origine (m, repère du plan). */
  entree: Point;
  courantFaible: boolean;
}

export interface ParamsGainesOptimisees {
  actif: boolean;
  maxCircuitsParGaine: number;
  tauxMaxPct: number;
  /** Plaque, recharge VE, chauffe-eau et circuits ≥ 32 A gardent leur propre gaine au départ. */
  grandsCircuitsSeuls: boolean;
  /** Pénalité (m de gaine équivalents) par départ au tableau : favorise les regroupements même légèrement plus longs. */
  penaliteDepartM: number;
  poseApparente: boolean;
}

export const PARAMS_GAINES_DEFAUT: ParamsGainesOptimisees = {
  actif: false, maxCircuitsParGaine: 8, tauxMaxPct: 33, grandsCircuitsSeuls: true, penaliteDepartM: 3, poseApparente: false,
};

export interface ForcagesGaines {
  /** Circuits (clés) qui gardent leur propre départ. */
  departsSeuls: string[];
  /** Ensembles de circuits (clés) imposés dans une même gaine. */
  ensembles: string[][];
}
export const FORCAGES_VIDES: ForcagesGaines = { departsSeuls: [], ensembles: [] };

export interface TronconArbre {
  id: string;
  parent: string | null;
  de: Point;
  vers: Point;
  longueurM: number;
  circuits: string[];
  nbCables: number;
  gaine: string;
  tauxPct: number;
  ok: boolean;
  /** Boîte de dérivation à l'arrivée de ce tronçon (là où la gaine se sépare en plusieurs) ; absent si le tronçon aboutit à un circuit. */
  boiteVers?: string;
  /** Tronçon très court dont l'extrémité est fusionnée dans la boîte d'amont (pas de seconde boîte à moins de DISTANCE_MINI_BOITES_M) : id de cette boîte. */
  dansBoite?: string;
  /** Tracé réel du tronçon (de → vers, coudes compris) : dans l'épaisseur des murs, ou au plafond si c'est beaucoup plus court. Absent = ligne droite. */
  chemin?: Point[];
  passage?: "murs" | "plafond" | "direct";
}

/** Deux séparations de gaine plus proches que ça (m) partagent une seule boîte de dérivation. */
export const DISTANCE_MINI_BOITES_M = 1;

/** Boîte de dérivation : créée à chaque endroit où une gaine commune se sépare en plusieurs gaines. */
export interface BoiteGaine {
  id: string;
  /** « BD1 », « BD2 »… (« BDF1 » pour les courants faibles), numérotées sur tout le niveau. */
  nom: string;
  groupeId: string;
  point: Point;
  courantFaible: boolean;
  /** Tronçon qui arrive dans la boîte. */
  entrant: { tronconId: string; gaine: string };
  /** Tronçons qui en repartent. */
  sorties: { tronconId: string; gaine: string; nbCircuits: number }[];
  /** Circuits (clés) qui traversent la boîte. */
  circuits: string[];
}

export interface GroupeGaines {
  id: string;
  nom: string;
  courantFaible: boolean;
  /** Circuit unique laissé seul (départ individuel). */
  seul: boolean;
  circuits: CircuitGaine[];
  troncons: TronconArbre[];
  /** Tronc qui part de l'origine. */
  tronc: TronconArbre;
  longueurM: number;
  avertissements: string[];
}

export interface BilanGaines { departs: number; gaineM: number; cableM: number }
export interface ResultatGainesOptimisees {
  groupes: GroupeGaines[];
  /** clé de circuit → id du groupe (gaine au départ). */
  groupeDeCircuit: Record<string, string>;
  /** Boîtes de dérivation créées aux séparations de gaines. */
  boites: BoiteGaine[];
  avant: BilanGaines;
  apres: BilanGaines;
  avertissements: string[];
}

// ─── Géométrie ────────────────────────────────────────────────────────────────────────────────────────────────────
const d2 = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

function fermat(a: Point, b: Point, c: Point): Point {
  let p: Point = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
  for (let i = 0; i < 40; i++) {
    let sx = 0, sy = 0, sw = 0;
    for (const q of [a, b, c]) {
      const d = d2(p, q);
      if (d < 1e-9) return q;
      sx += q.x / d; sy += q.y / d; sw += 1 / d;
    }
    const n = { x: sx / sw, y: sy / sw };
    if (d2(n, p) < 1e-4) { p = n; break; }
    p = n;
  }
  return p;
}

// ─── Remplissage d'une gaine ─────────────────────────────────────────────────────────────────────────────────────
const DIAM_CABLE_COMMUNICATION_MM = 7;
function remplissage(circuits: CircuitGaine[], p: ParamsGainesOptimisees): { gaine: string; tauxPct: number; ok: boolean; nbCables: number } {
  const type = p.poseApparente ? "IRL" : "ICTA";
  if (circuits.length > 0 && circuits.every(c => c.courantFaible)) {
    const aire = circuits.length * Math.PI * (DIAM_CABLE_COMMUNICATION_MM / 2) ** 2;
    for (const g of GAINES_IRL) {
      const taux = Math.round((aire / (Math.PI * (g.diamInt / 2) ** 2)) * 100);
      if (taux <= p.tauxMaxPct) return { gaine: `${g.label.replace("IRL", type)} verte`, tauxPct: taux, ok: true, nbCables: circuits.length };
    }
    const dernier = GAINES_IRL[GAINES_IRL.length - 1];
    return { gaine: `${dernier.label.replace("IRL", type)} verte`, tauxPct: Math.round((aire / (Math.PI * (dernier.diamInt / 2) ** 2)) * 100), ok: false, nbCables: circuits.length };
  }
  const cables = circuits.flatMap(c => cablesPrises(c.section));
  const r = gaineRecommandee(cables, type);
  return { gaine: r.gaine, tauxPct: r.tauxPct, ok: r.ok && r.tauxPct <= p.tauxMaxPct, nbCables: cables.length };
}

// ─── Arbre ────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Noeud { circuits: CircuitGaine[]; point: Point; enfants: Noeud[]; sub: number; fige: boolean }

const feuille = (c: CircuitGaine): Noeud => ({ circuits: [c], point: c.entree, enfants: [], sub: 0, fige: false });
const total = (n: Noeud, o: Point): number => d2(o, n.point) + n.sub;

function fusion(a: Noeud, b: Noeud, o: Point): Noeud {
  const s = fermat(o, a.point, b.point);
  return { circuits: [...a.circuits, ...b.circuits], point: s, enfants: [a, b], sub: d2(s, a.point) + a.sub + d2(s, b.point) + b.sub, fige: false };
}

const estGrandCircuit = (c: CircuitGaine): boolean => c.circuit === "plaque" || c.circuit === "irve" || c.circuit === "chauffe_eau" || c.amperes >= 32;

/** Fusionne pas à pas la paire la plus rentable ; `seuil` = gain minimal pour fusionner. */
function agglomerer(noeuds: Noeud[], o: Point, p: ParamsGainesOptimisees): Noeud[] {
  const pen = p.penaliteDepartM;
  const faisable = (n: Noeud): boolean => n.circuits.length <= p.maxCircuitsParGaine && remplissage(n.circuits, p).ok;
  const actifs = [...noeuds];
  for (;;) {
    let meilleur: { i: number; j: number; gain: number; n: Noeud } | null = null;
    for (let i = 0; i < actifs.length; i++) {
      if (actifs[i].fige) continue;
      for (let j = i + 1; j < actifs.length; j++) {
        if (actifs[j].fige) continue;
        if (actifs[i].circuits.length + actifs[j].circuits.length > p.maxCircuitsParGaine) continue;
        const n = fusion(actifs[i], actifs[j], o);
        if (!faisable(n)) continue;
        const gain = total(actifs[i], o) + total(actifs[j], o) + pen - total(n, o);
        if (gain > 1e-6 && (!meilleur || gain > meilleur.gain)) meilleur = { i, j, gain, n };
      }
    }
    if (!meilleur) break;
    actifs.splice(meilleur.j, 1);
    actifs.splice(meilleur.i, 1, meilleur.n);
  }
  return actifs;
}

const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5", "#0d9488", "#b45309"];
export const COULEUR_COURANT_FAIBLE = "#22c55e";
export const couleurGroupe = (indexGroupe: number, courantFaible: boolean): string => courantFaible ? COULEUR_COURANT_FAIBLE : PALETTE[indexGroupe % PALETTE.length];

// ─── Calcul principal ─────────────────────────────────────────────────────────────────────────────────────────────
export function optimiserGaines(
  circuits: CircuitGaine[], origine: Point, params: ParamsGainesOptimisees, forcages: ForcagesGaines = FORCAGES_VIDES,
): ResultatGainesOptimisees {
  const avertissements: string[] = [];
  const parCle = new Map(circuits.map(c => [c.cle, c]));
  const dejaPris = new Set<string>();
  const seuls = new Set(forcages.departsSeuls);

  const construire = (liste: CircuitGaine[], faible: boolean): Noeud[] => {
    const noeuds: Noeud[] = [];
    // Ensembles imposés (union des ensembles qui se recoupent)
    const ens: string[][] = [];
    forcages.ensembles.forEach(e => {
      const valides = e.filter(k => parCle.has(k) && parCle.get(k)!.courantFaible === faible && !seuls.has(k));
      if (valides.length < 2) return;
      const touche = ens.filter(x => x.some(k => valides.includes(k)));
      const fusionne = [...new Set([...touche.flat(), ...valides])];
      touche.forEach(t => ens.splice(ens.indexOf(t), 1));
      ens.push(fusionne);
    });
    ens.forEach(e => {
      let n: Noeud | null = null;
      e.forEach(k => {
        if (dejaPris.has(k)) return;
        dejaPris.add(k);
        const f = feuille(parCle.get(k)!);
        n = n ? fusion(n, f, origine) : f;
      });
      if (n) {
        const nn = n as Noeud;
        if (nn.circuits.length > params.maxCircuitsParGaine) avertissements.push(`Gaine imposée de ${nn.circuits.length} circuits (maximum conseillé ${params.maxCircuitsParGaine}).`);
        if (!remplissage(nn.circuits, params).ok) avertissements.push(`Gaine imposée (${nn.circuits.map(c => c.label).join(", ")}) : remplissage > ${params.tauxMaxPct} %.`);
        noeuds.push(nn);
      }
    });
    const libres: Noeud[] = [];
    liste.forEach(c => {
      if (dejaPris.has(c.cle)) return;
      dejaPris.add(c.cle);
      const f = feuille(c);
      if (seuls.has(c.cle) || (!faible && params.grandsCircuitsSeuls && estGrandCircuit(c))) { f.fige = true; noeuds.push(f); } else libres.push(f);
    });
    return [...noeuds.map(n => ({ ...n, fige: true })), ...agglomerer(libres, origine, params)];
  };

  const puissance = circuits.filter(c => !c.courantFaible);
  const faibles = circuits.filter(c => c.courantFaible);
  const racines: { n: Noeud; faible: boolean }[] = [
    ...construire(puissance, false).map(n => ({ n, faible: false })),
    ...construire(faibles, true).map(n => ({ n, faible: true })),
  ];
  // Ordre stable : puissance puis courants faibles ; à l'intérieur, par angle autour de l'origine (lecture horaire)
  const angle = (n: Noeud) => Math.atan2(n.point.y - origine.y, n.point.x - origine.x);
  racines.sort((a, b) => (a.faible === b.faible ? angle(a.n) - angle(b.n) : a.faible ? 1 : -1));

  const groupes: GroupeGaines[] = [];
  const boites: BoiteGaine[] = [];
  const groupeDeCircuit: Record<string, string> = {};
  let compteurP = 0, compteurF = 0;
  racines.forEach(({ n, faible }) => {
    const id = faible ? `GF${++compteurF}` : `G${++compteurP}`;
    const troncons: TronconArbre[] = [];
    let k = 0;
    const parcourir = (nd: Noeud, de: Point, parent: string | null, boiteAmont: BoiteGaine | null): TronconArbre => {
      const r = remplissage(nd.circuits, params);
      const t: TronconArbre = {
        id: `${id}.${++k}`, parent, de, vers: nd.point, longueurM: d2(de, nd.point), circuits: nd.circuits.map(c => c.cle),
        nbCables: r.nbCables, gaine: r.gaine, tauxPct: r.tauxPct, ok: r.ok,
      };
      troncons.push(t);
      if (nd.enfants.length > 0) {
        let boite: BoiteGaine;
        if (boiteAmont && t.longueurM < DISTANCE_MINI_BOITES_M) {
          // séparation très proche de la précédente : une seule boîte, qui récupère les départs de ce nœud
          boite = boiteAmont;
          t.dansBoite = boite.id;
          boite.sorties = boite.sorties.filter(x => x.tronconId !== t.id);
          boite.circuits = [...new Set([...boite.circuits, ...nd.circuits.map(c => c.cle)])];
        } else {
          t.boiteVers = `${id}.B${boites.filter(b => b.groupeId === id).length + 1}`;
          boite = { id: t.boiteVers, nom: "", groupeId: id, point: { x: nd.point.x, y: nd.point.y }, courantFaible: faible, entrant: { tronconId: t.id, gaine: t.gaine }, sorties: [], circuits: nd.circuits.map(c => c.cle) };
          boites.push(boite);
        }
        nd.enfants.forEach(e => { const f = parcourir(e, nd.point, t.id, boite); if (!f.dansBoite) boite.sorties.push({ tronconId: f.id, gaine: f.gaine, nbCircuits: f.circuits.length }); });
      }
      return t;
    };
    const tronc = parcourir(n, origine, null, null);
    const warn: string[] = [];
    if (n.circuits.length > params.maxCircuitsParGaine) warn.push(`${n.circuits.length} circuits dans la gaine (maximum conseillé ${params.maxCircuitsParGaine}).`);
    troncons.forEach(t => { if (!t.ok) warn.push(`Tronçon ${t.id} : remplissage ${t.tauxPct} % > ${params.tauxMaxPct} %.`); });
    n.circuits.forEach(c => { groupeDeCircuit[c.cle] = id; });
    const seul = n.circuits.length === 1;
    groupes.push({
      id, nom: faible ? `Gaine verte ${compteurF}` : `Gaine ${compteurP}`, courantFaible: faible, seul, circuits: n.circuits, troncons, tronc,
      longueurM: troncons.reduce((s, t) => s + t.longueurM, 0), avertissements: warn,
    });
    warn.forEach(w => avertissements.push(`${groupes[groupes.length - 1].nom} : ${w}`));
  });

  // Noms des boîtes : BD1, BD2… (puissance) puis BDF1… (courants faibles), dans l'ordre des gaines
  let nb = 0, nbF = 0;
  boites.forEach(b => { b.nom = b.courantFaible ? `BDF${++nbF}` : `BD${++nb}`; });

  // Bilan avant / après
  const directM = circuits.map(c => d2(origine, c.entree));
  const avant: BilanGaines = { departs: circuits.length, gaineM: directM.reduce((s, x) => s + x, 0), cableM: directM.reduce((s, x) => s + x, 0) };
  let cableApres = 0;
  groupes.forEach(g => g.circuits.forEach(c => {
    let t: TronconArbre | undefined = g.troncons.find(x => x.circuits.length === 1 && x.circuits[0] === c.cle);
    while (t) { cableApres += t.longueurM; const par: string | null = t.parent; t = par ? g.troncons.find(x => x.id === par) : undefined; }
  }));
  const apres: BilanGaines = { departs: groupes.length, gaineM: groupes.reduce((s, g) => s + g.longueurM, 0), cableM: cableApres };
  return { groupes, groupeDeCircuit, boites, avant, apres, avertissements };
}

/** Texte d'une gaine de départ : « 3 × circuits · ICTA 25 (31 %) ». */
export const libelleGroupe = (g: GroupeGaines): string => `${g.nom} — ${g.circuits.length} circuit${g.circuits.length > 1 ? "s" : ""} · ${g.tronc.gaine} (${g.tronc.tauxPct} %)`;

/** Fusionne les réglages enregistrés avec les défauts (réglages anciens ou corrompus tolérés). */
export function fusionnerParamsGaines(p?: Partial<ParamsGainesOptimisees> | null): ParamsGainesOptimisees {
  const d = PARAMS_GAINES_DEFAUT;
  const num = (v: unknown, def: number, min: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(min, v) : def);
  return {
    actif: typeof p?.actif === "boolean" ? p.actif : d.actif,
    maxCircuitsParGaine: Math.round(num(p?.maxCircuitsParGaine, d.maxCircuitsParGaine, 1)),
    tauxMaxPct: Math.min(100, num(p?.tauxMaxPct, d.tauxMaxPct, 5)),
    grandsCircuitsSeuls: typeof p?.grandsCircuitsSeuls === "boolean" ? p.grandsCircuitsSeuls : d.grandsCircuitsSeuls,
    penaliteDepartM: num(p?.penaliteDepartM, d.penaliteDepartM, 0),
    poseApparente: typeof p?.poseApparente === "boolean" ? p.poseApparente : d.poseApparente,
  };
}

export function fusionnerForcages(f?: Partial<ForcagesGaines> | null): ForcagesGaines {
  const tab = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    departsSeuls: tab(f?.departsSeuls),
    ensembles: Array.isArray(f?.ensembles) ? (f!.ensembles as unknown[]).map(tab).filter(e => e.length > 0) : [],
  };
}

/** Déplace un circuit : `vers` = clé d'un autre circuit dont il rejoint la gaine, ou null pour un départ individuel. */
export function deplacerCircuitGaine(f: ForcagesGaines, cle: string, vers: string | null, groupeCibleCles?: string[]): ForcagesGaines {
  const ensembles = f.ensembles.map(e => e.filter(k => k !== cle)).filter(e => e.length > 1);
  const seuls = f.departsSeuls.filter(k => k !== cle);
  if (vers == null) return { departsSeuls: [...seuls, cle], ensembles };
  const membres = [...new Set([vers, ...(groupeCibleCles ?? [])])].filter(k => k !== cle);
  const touche = ensembles.filter(e => e.some(k => membres.includes(k)));
  const reste = ensembles.filter(e => !touche.includes(e));
  return { departsSeuls: seuls.filter(k => k !== vers), ensembles: [...reste, [...new Set([...touche.flat(), ...membres, cle])]] };
}

/** Diamètre extérieur (mm) lu dans un libellé de gaine (« ICTA 25 », « IRL 20 verte »…) ; 20 mm si illisible. */
export function diametreGaineDepuisLibelle(libelle: string | undefined, def = 20): number {
  const m = libelle?.match(/(\d{2})/);
  return m ? parseInt(m[1], 10) : def;
}

/** Jonctions de l'arbre (du tronc vers la feuille, point d'entrée exclu) que traverse le câble d'un circuit regroupé ; null si le circuit n'est pas dans l'arbre. */
export function jonctionsVersCircuit(res: ResultatGainesOptimisees, cleCircuit: string): Point[] | null {
  const gr = res.groupes.find(g => g.circuits.some(c => c.cle === cleCircuit));
  if (!gr) return null;
  const chaine: TronconArbre[] = [];
  let t = gr.troncons.find(x => x.circuits.length === 1 && x.circuits[0] === cleCircuit);
  while (t) { chaine.unshift(t); const par: string | null = t.parent; t = par ? gr.troncons.find(x => x.id === par) : undefined; }
  // jonctions + coudes de chaque tronçon (le câble suit la gaine dans les murs), point d'entrée exclu
  const pts: Point[] = [];
  chaine.forEach((x, i) => {
    (x.chemin ?? []).slice(1, -1).forEach(q => pts.push({ x: q.x, y: q.y }));
    if (i < chaine.length - 1) pts.push({ x: x.vers.x, y: x.vers.y });
  });
  return pts;
}

/** Une étape du trajet d'un circuit regroupé : un tronçon de gaine du tronc vers sa feuille. */
export interface EtapeChemin {
  tronconId: string;
  de: Point;
  vers: Point;
  gaine: string;
  /** Clés des circuits qui passent dans ce tronçon (faisceau). */
  circuits: string[];
  /** Place de ce circuit dans le faisceau (0..circuits.length-1), identique d'un tronçon à l'autre. */
  rang: number;
  groupeIndex: number;
  courantFaible: boolean;
  longueurM: number;
  chemin?: Point[];
  passage?: "murs" | "plafond" | "direct";
  /** Boîte de dérivation à l'arrivée de l'étape (absent sur la dernière). */
  boiteVers?: string;
}

/**
 * Trajet complet d'un circuit regroupé : tableau → tronc → boîtes → dernier tronçon (qui aboutit à son point d'entrée).
 * null si le circuit n'est pas dans une gaine commune (départ individuel : son tracé ordinaire est conservé).
 */
export function cheminCircuitGaine(res: ResultatGainesOptimisees, cleCircuit: string): EtapeChemin[] | null {
  const groupeIndex = res.groupes.findIndex(g => g.circuits.some(c => c.cle === cleCircuit));
  if (groupeIndex < 0) return null;
  const gr = res.groupes[groupeIndex];
  if (gr.circuits.length < 2) return null;
  const chaine: TronconArbre[] = [];
  let t = gr.troncons.find(x => x.circuits.length === 1 && x.circuits[0] === cleCircuit);
  while (t) { chaine.unshift(t); const par: string | null = t.parent; t = par ? gr.troncons.find(x => x.id === par) : undefined; }
  if (chaine.length < 2) return null;
  return chaine.map(x => ({
    tronconId: x.id, de: x.de, vers: x.vers, gaine: x.gaine, circuits: x.circuits,
    rang: Math.max(0, gr.circuits.filter(c => x.circuits.includes(c.cle)).findIndex(c => c.cle === cleCircuit)),
    groupeIndex, courantFaible: gr.courantFaible, longueurM: x.longueurM, boiteVers: x.dansBoite ?? x.boiteVers,
    chemin: x.chemin, passage: x.passage,
  }));
}
