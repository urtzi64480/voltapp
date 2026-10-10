// src/lib/maison-engine.ts
//
// Moteur de génération des circuits d'un logement complet, à partir des
// positions RÉELLES des appareillages placés sur le plan (voir maison-types.ts).
// Regroupement par clustering spatial (plus-proche-voisin) plutôt que par
// simple liste — approxime une optimisation du cheminement réel des câbles.
// Produit des Breaker[] au format exact du module Tableau électrique existant.

import {
  Breaker, BreakerRow, PieceConfig, GroupeLumineux, CommandeType,
  CIRCUITS, MAX_PAR_CIRCUIT, MIN_PRISES_PIECE,
  PMAX_CHAUFFAGE_16A_W, PMAX_CHAUFFAGE_20A_W, PUISSANCE_CHAUFFAGE_DEFAUT_W,
  AMPERES_DIFFERENTIEL,
  gaineRecommandee, cablesGroupe, cablesPrises, effectiveSection, uid,
  CIRCUIT_COMMUNICATION, estCircuitSansDisjoncteur,
} from "./electrical-constants";
import {
  Maison, Niveau, Piece, Point, AppareillagePlace, aireDuPolygone,
  CircuitManuel, familleCircuitManuelAppareillage, couleurCircuit, USAGE_DEDIE_DEFAUT,
  estCommande, baseCommande, commandeCetteLumiere, estLumiere, lumieresCommandees,
  SegmentCircuit, sequenceAncresCircuit, sequenceAncresCircuitOrdonnee, construireBranchesCircuitEclairage,
} from "./maison-types";
import { appareillagesParPieceReelle } from "./piece-reelle";

// Appareillages dédiés → 1 circuit par instance (correspondance directe avec CIRCUITS).
// Le chauffage n'en fait PAS partie : plusieurs radiateurs peuvent partager un circuit
// tant que leur puissance cumulée reste dans le calibre du disjoncteur (NF C 15-100,
// amendement A5) — voir genererBreakersChauffage, regroupement spatial + puissance.
// Exporté pour le module pré-devis (predevis-engine.ts) — sert à identifier les
// appareillages "appareil dédié" (four, chauffe-eau…) pour lesquels on chiffre une prise/
// sortie de câble spécialisée, jamais l'appareil lui-même.
export const CIRCUIT_DEDIE: Record<string, string> = {
  four: "four", plaque: "plaque", lave_linge: "lave_linge", lave_vaisselle: "lave_vaisselle",
  seche_linge: "seche_linge", chauffe_eau: "chauffe_eau", clim: "clim",
  seche_serviette: "seche_serviette", congelateur: "congelateur", irve: "irve",
  piscine: "piscine", vmc: "vmc", alarme: "alarme",
};

// Clé CIRCUITS du circuit dédié d'un appareillage, ou undefined s'il n'en a pas. Une PRISE DÉDIÉE
// (type "prise_dediee") suit l'appareil qu'elle alimente (AppareillagePlace.usageDedie : four,
// lave-linge…) ; tout autre appareil dédié suit son propre type.
export function cleCircuitDedie(a: Pick<AppareillagePlace, "type" | "usageDedie">): string | undefined {
  if (a.type === "prise_dediee") return CIRCUIT_DEDIE[a.usageDedie ?? USAGE_DEDIE_DEFAUT];
  return CIRCUIT_DEDIE[a.type];
}

// Types sans circuit de PUISSANCE : une prise RJ45 est un courant faible (câblage de communication
// en étoile vers le coffret VDI) — jamais rattachée à un disjoncteur, donc jamais « non raccordée ».
export const TYPES_SANS_CIRCUIT: string[] = ["rj45", "prise_tv"];

// Libellés pour le message d'alerte "non raccordé" — soit une commande (interrupteur/
// va-et-vient/télérupteur) qui ne pointe vers aucun point lumineux raccordé, soit un
// appareillage explicitement exclu de la génération automatique (voir
// Niveau.appareillagesExclus et terminerDessinCheminement, page.tsx). Fallback sur le
// type brut au besoin.
const LABEL_NON_RACCORDE: Record<string, string> = {
  interrupteur: "Interrupteur", va_et_vient: "Va-et-vient", telerupteur: "Télérupteur",
  interrupteur_double: "Double interrupteur", va_et_vient_double: "Double va-et-vient", telerupteur_double: "Double bouton poussoir",
  prise: "Prise", prise_commandee: "Prise commandée", volet_roulant: "Volet roulant",
  prise_dediee: "Prise dédiée", prise_exterieure: "Prise extérieure", prise_tv: "Prise TV / antenne",
  point_lumineux: "Point lumineux", applique: "Applique", spot: "Spot", spot_etanche: "Spot étanche",
  applique_exterieure: "Applique extérieure", point_lumineux_exterieur: "Point lumineux extérieur",
  interrupteur_exterieur: "Interrupteur extérieur",
  detecteur_mouvement: "Détecteur de mouvement", detecteur_mouvement_exterieur: "Détecteur de mouvement extérieur",
};

// Circuits d'un niveau. Se base sur Breaker.niveauId (posé à la génération) et non sur les NOMS de pièces : un circuit dont
// l'appareil est rattaché à « Extérieur » (façade hors de toute pièce) ou deux niveaux aux pièces homonymes
// ne doivent ni disparaître, ni se dupliquer. Repli sur les noms pour un Breaker sans niveauId (ancien format).
export function breakersDuNiveau(breakers: Breaker[], niveau: Pick<Niveau, "id" | "pieces">): Breaker[] {
  const noms = new Set(niveau.pieces.map(p => p.nom));
  return breakers.filter(b => b.niveauId != null ? b.niveauId === niveau.id : b.pieces.some(pc => noms.has(pc.nom)));
}

export interface ResultatGeneration {
  maison: Maison; // copie de la maison d'entrée, avec circuitId renseigné sur chaque appareillage concerné
  breakers: Breaker[];
  alertes: string[];
}

// ─── CLUSTERING SPATIAL (plus-proche-voisin, chaîne gloutonne) ─────────────────
// Approxime un regroupement par proximité réelle sans résoudre un TSP complet :
// suffisant pour rapprocher les circuits des cheminements de câblage réels.

function clusteriser<T extends { x: number; y: number }>(items: T[], maxParCluster: number): T[][] {
  if (items.length === 0) return [];
  const remaining = [...items];
  const clusters: T[][] = [];
  let current: T[] = [];
  let last = remaining.shift()!;
  current.push(last);
  while (remaining.length > 0) {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = (remaining[i].x - last.x) ** 2 + (remaining[i].y - last.y) ** 2;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    if (current.length >= maxParCluster) {
      clusters.push(current);
      current = [];
    }
    current.push(next);
    last = next;
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

interface Item { base: AppareillagePlace; pieceNom: string; piece: Piece; x: number; y: number; }

function breakerFromClusterPrises(cluster: Item[], circuitKey: string, niveauNom: string, idx: number): Breaker {
  const spec = CIRCUITS[circuitKey];
  const parPiece = new Map<string, number>();
  cluster.forEach(item => parPiece.set(item.pieceNom, (parPiece.get(item.pieceNom) ?? 0) + 1));
  const pieces: PieceConfig[] = Array.from(parPiece.entries()).map(([nom, n]) => ({
    nom, nbPrises: n, groupes: [{ nbPoints: 1, typeCommande: "simple", nbCommandes: 1 }],
  }));
  return {
    id: uid(), label: `${spec.label} — ${niveauNom} ${idx}`, circuit: circuitKey,
    amperes: spec.ampMax, type: "1P", customSection: spec.section ?? "1.5", pieces,
  };
}

function breakerFromClusterLumiere(cluster: (Item & { typeCommande: CommandeType; nbCommandes: number })[], niveauNom: string, idx: number): Breaker {
  const spec = CIRCUITS.lumiere;
  const parPiece = new Map<string, GroupeLumineux[]>();
  cluster.forEach(item => {
    const arr = parPiece.get(item.pieceNom) ?? [];
    arr.push({ nbPoints: 1, typeCommande: item.typeCommande, nbCommandes: item.nbCommandes });
    parPiece.set(item.pieceNom, arr);
  });
  const pieces: PieceConfig[] = Array.from(parPiece.entries()).map(([nom, groupes]) => ({ nom, nbPrises: 0, groupes }));
  return {
    id: uid(), label: `${spec.label} — ${niveauNom} ${idx}`, circuit: "lumiere",
    amperes: spec.ampMax, type: "1P", customSection: spec.section ?? "1.5", pieces,
  };
}

// ─── CHAUFFAGE ÉLECTRIQUE — REGROUPEMENT PAR PUISSANCE (NF C 15-100, amdt A5) ──
// Contrairement aux autres appareils "dédiés" (four, chauffe-eau…), un circuit de
// chauffage peut desservir plusieurs radiateurs tant que leur puissance cumulée reste
// dans le calibre du disjoncteur : 3500 W max en 16A/1,5mm², 4500 W max en 20A/2,5mm²
// (différentiel 30mA type AC). Un radiateur sans puissance renseignée compte pour
// PUISSANCE_CHAUFFAGE_DEFAUT_W (valeur de secours, modifiable depuis son panneau).

function puissanceChauffage(item: Item): number {
  return item.base.puissanceW ?? PUISSANCE_CHAUFFAGE_DEFAUT_W;
}

// Même chaîne gloutonne plus-proche-voisin que clusteriser(), mais la coupure d'un
// cluster se décide sur la puissance cumulée (maxW) plutôt que sur un nombre d'items —
// un radiateur qui dépasserait seul ce plafond (cas extrême) reste isolé dans son
// propre cluster plutôt que de bloquer le regroupement des autres.
function clusteriserParPuissance(items: Item[], maxW: number): Item[][] {
  if (items.length === 0) return [];
  const remaining = [...items];
  const clusters: Item[][] = [];
  let current: Item[] = [];
  let currentW = 0;
  let last = remaining.shift()!;
  current.push(last);
  currentW += puissanceChauffage(last);
  while (remaining.length > 0) {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = (remaining[i].x - last.x) ** 2 + (remaining[i].y - last.y) ** 2;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    const pNext = puissanceChauffage(next);
    if (current.length > 0 && currentW + pNext > maxW) {
      clusters.push(current);
      current = [];
      currentW = 0;
    }
    current.push(next);
    currentW += pNext;
    last = next;
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

// Choisit le calibre le plus léger (16A/1,5mm²) qui suffit à la puissance cumulée du
// cluster, et ne passe en 20A/2,5mm² que si elle dépasse 3500W — jamais l'inverse.
function breakerFromClusterChauffage(cluster: Item[], niveauNom: string, idx: number): Breaker {
  const totalW = cluster.reduce((s, item) => s + puissanceChauffage(item), 0);
  const circuitKey = totalW <= PMAX_CHAUFFAGE_16A_W ? "chauffage_16" : "chauffage_20";
  const spec = CIRCUITS[circuitKey];
  const parPiece = new Map<string, number>();
  cluster.forEach(item => parPiece.set(item.pieceNom, (parPiece.get(item.pieceNom) ?? 0) + 1));
  const pieces: PieceConfig[] = Array.from(parPiece.entries()).map(([nom, n]) => ({
    nom, nbPrises: n, groupes: [{ nbPoints: 1, typeCommande: "simple", nbCommandes: 1 }],
  }));
  const totalKw = (totalW / 1000).toFixed(2).replace(/\.?0+$/, "");
  return {
    id: uid(), label: `${spec.label} — ${niveauNom} ${idx} (${totalKw} kW)`, circuit: circuitKey,
    amperes: spec.ampMax, type: "1P", customSection: spec.section ?? "1.5", pieces,
  };
}

function genererBreakersChauffage(items: Item[], niveauNom: string, breakers: Breaker[]): void {
  let idx = 1;
  for (const cluster of clusteriserParPuissance(items, PMAX_CHAUFFAGE_20A_W)) {
    const b = breakerFromClusterChauffage(cluster, niveauNom, idx++);
    breakers.push(b);
    cluster.forEach(item => { item.base.circuitId = b.id; });
  }
}

// ─── RÉPARTITION MANUEL / AUTOMATIQUE ──────────────────────────────────────────
// Sépare un pool d'items (prises d'une famille donnée, ou points lumineux) entre
// ceux explicitement rattachés par l'utilisateur à un CircuitManuel de la bonne
// famille (circuitManuelId) et le reste, qui repart dans le clustering spatial
// automatique habituel. Un circuitManuelId pointant vers un circuit manuel
// supprimé ou d'une autre famille retombe silencieusement dans l'automatique.
function genererBreakersPrises(items: Item[], circuitKey: string, niveauNom: string, breakers: Breaker[]): void {
  const max = MAX_PAR_CIRCUIT[circuitKey] ?? 8;
  let idx = 1;
  for (const cluster of clusteriser(items, max)) {
    const b = breakerFromClusterPrises(cluster, circuitKey, niveauNom, idx++);
    breakers.push(b);
    cluster.forEach(item => { item.base.circuitId = b.id; });
  }
}

// Rattache au même circuit que le(s) point(s) lumineux le(s) interrupteur / va-et-vient /
// télérupteur qui le(s) commande(nt) ("retour lampe") — sans quoi ces commandes restent
// hors de tout circuit et n'apparaissent jamais dans le tracé (2D et 3D). Une commande déjà
// rattachée à un circuit MANUEL (circuitManuelId défini) n'est jamais réécrite ici : son
// circuit vient de sa propre appartenance manuelle, jamais d'une lampe qu'elle commande par
// ailleurs — sinon la génération d'un autre circuit (manuel ou automatique) pourrait écraser
// silencieusement un choix explicite de l'utilisateur.
function rattacherRetoursLampe(tousItems: Item[], cluster: { base: AppareillagePlace }[], circuitId: number): void {
  cluster.forEach(item => {
    tousItems
      .filter(cmd => commandeCetteLumiere(cmd.base, item.base.id) && cmd.base.circuitManuelId == null) // voie 1 ou 2 d'un double
      .forEach(cmd => { cmd.base.circuitId = circuitId; });
  });
}

// Déduit le type de commande (simple allumage / va-et-vient / télérupteur) d'un point
// lumineux à partir des interrupteurs/va-et-vient/télérupteurs placés et liés via
// commandePourIds — partagé par la génération automatique et par un circuit manuel de
// type "lumiere" (voir genererCircuits et breakerFromClusterManuel).
function deduireCommandeLumiere(tousItems: Item[], pointLumineuxId: number): { typeCommande: CommandeType; nbCommandes: number } {
  // Voie 1 OU voie 2 d'un double : un double va-et-vient compte comme un va-et-vient pour chaque lampe qu'il
  // commande (câblage identique, voie par voie) ; baseCommande() ramène chaque type à son genre de câblage.
  const commandes = tousItems.filter(a => commandeCetteLumiere(a.base, pointLumineuxId));
  if (commandes.some(c => baseCommande(c.base.type) === "telerupteur")) {
    return { typeCommande: "telerupteur", nbCommandes: commandes.filter(c => baseCommande(c.base.type) === "telerupteur").length || 1 };
  }
  if (commandes.some(c => baseCommande(c.base.type) === "va_et_vient")) {
    // Nombre réel de va-et-vient posés pour cette lampe plutôt qu'une valeur fixe à 2 — une
    // configuration à 3 commandes ou plus (permutateurs) reste rare mais n'est pas empêchée
    // par le plan, autant que ce chiffre (repris tel quel dans le module Tableau) reflète
    // ce qui est réellement dessiné.
    return { typeCommande: "vav", nbCommandes: commandes.filter(c => baseCommande(c.base.type) === "va_et_vient").length };
  }
  return { typeCommande: "simple", nbCommandes: 1 };
}

// ─── RÉPARTITION LOGIQUE DE L'ÉCLAIRAGE ────────────────────────────────────────────────────────────────────
// NF C 15-100 : 8 points d'utilisation maximum par circuit d'éclairage (16 A / 1,5 mm²). La répartition suit la LOGIQUE du
// logement, pas seulement la proximité :
//  1. les lampes pilotées par une même commande (interrupteur à plusieurs lampes, va-et-vient en chaîne) restent dans le MÊME
//     circuit — une commande ne peut pas basculer deux circuits ;
//  2. une pièce n'est jamais coupée entre deux circuits tant qu'elle tient dans un circuit ;
//  3. les pièces sont ensuite empilées de proche en proche (chaîne plus-proche-voisin) jusqu'à 8 points.
function repartirLumieres<T extends Item>(lumItems: T[], tousItems: Item[], max: number): T[][] {
  if (lumItems.length === 0) return [];
  // 1. composantes « même commande »
  const parent = new Map<number, number>();
  const trouver = (i: number): number => { let r = i; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(i, r); return r; };
  lumItems.forEach(l => parent.set(l.base.id, l.base.id));
  const idsLum = new Set(lumItems.map(l => l.base.id));
  tousItems.forEach(c => {
    const cibles = lumieresCommandees(c.base).filter(id => idsLum.has(id));
    for (let k = 1; k < cibles.length; k++) parent.set(trouver(cibles[k]), trouver(cibles[0]));
  });
  const compParRacine = new Map<number, T[]>();
  lumItems.forEach(l => { const r = trouver(l.base.id); (compParRacine.get(r) ?? compParRacine.set(r, []).get(r)!).push(l); });
  // 2. regroupement par pièce (pièce majoritaire de la composante)
  type Bloc = { items: T[]; x: number; y: number };
  const parPiece = new Map<string, Bloc[]>();
  compParRacine.forEach(items => {
    const compte = new Map<string, number>();
    items.forEach(i => compte.set(i.pieceNom, (compte.get(i.pieceNom) ?? 0) + 1));
    const piece = [...compte.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const x = items.reduce((s, i) => s + i.x, 0) / items.length, y = items.reduce((s, i) => s + i.y, 0) / items.length;
    (parPiece.get(piece) ?? parPiece.set(piece, []).get(piece)!).push({ items, x, y });
  });
  const pieces = [...parPiece.values()].map(blocs => ({
    blocs, n: blocs.reduce((s, b) => s + b.items.length, 0),
    x: blocs.reduce((s, b) => s + b.x, 0) / blocs.length, y: blocs.reduce((s, b) => s + b.y, 0) / blocs.length,
  }));
  // 3. chaîne de proche en proche, puis empilement
  const restantes = [...pieces];
  const ordre: typeof pieces = [];
  let cur = restantes.shift()!; ordre.push(cur);
  while (restantes.length > 0) {
    let bi = 0, bd = Infinity;
    restantes.forEach((r, i) => { const d = (r.x - cur.x) ** 2 + (r.y - cur.y) ** 2; if (d < bd) { bd = d; bi = i; } });
    cur = restantes.splice(bi, 1)[0]; ordre.push(cur);
  }
  const circuits: T[][] = [];
  let courant: T[] = [];
  const fermer = () => { if (courant.length > 0) { circuits.push(courant); courant = []; } };
  ordre.forEach(pc => {
    if (courant.length + pc.n <= max) { pc.blocs.forEach(b => courant.push(...b.items)); return; }
    if (pc.n <= max) { fermer(); pc.blocs.forEach(b => courant.push(...b.items)); return; }
    // pièce de plus de `max` points : on coupe entre composantes (jamais au milieu d'une commande commune)
    pc.blocs.sort((a, b) => b.items.length - a.items.length).forEach(b => {
      if (courant.length + b.items.length > max) fermer();
      if (b.items.length > max) {
        for (let i = 0; i < b.items.length; i += max) { fermer(); courant.push(...b.items.slice(i, i + max)); fermer(); }
      } else courant.push(...b.items);
    });
  });
  fermer();
  return circuits;
}

function genererBreakersLumiere(
  lumItems: (Item & { typeCommande: CommandeType; nbCommandes: number })[],
  niveauNom: string, breakers: Breaker[], tousItems: Item[],
): void {
  const max = MAX_PAR_CIRCUIT.lumiere ?? 8;
  let idx = 1;
  for (const cluster of repartirLumieres(lumItems, tousItems, max)) {
    const b = breakerFromClusterLumiere(cluster, niveauNom, idx++);
    breakers.push(b);
    cluster.forEach(item => { item.base.circuitId = b.id; });
    rattacherRetoursLampe(tousItems, cluster, b.id);
  }
}

// ─── CIRCUITS MANUELS — N'IMPORTE QUEL TYPE, COMPOSITION LIBRE ─────────────────
// Un circuit manuel (CircuitManuel, maison-types.ts) porte lui-même son type électrique
// (`famille`, une clé CIRCUITS quelconque — pas seulement prises/éclairage) et sa liste de
// membres est celle que l'utilisateur a explicitement cochée dans CircuitManuelForm
// (page.tsx), via AppareillagePlace.circuitManuelId. Contrairement aux pools automatiques,
// un circuit manuel n'est JAMAIS scindé ni recomposé ici : un circuit manuel = un Breaker,
// tel quel — l'utilisateur a la main libre, y compris pour dépasser volontairement les
// seuils NF C 15-100 habituels si c'est un choix assumé.
function breakerFromClusterManuel(cluster: Item[], manuel: CircuitManuel, niveauNom: string, tousItems: Item[]): Breaker {
  const spec = CIRCUITS[manuel.famille] ?? CIRCUITS.autre;
  let pieces: PieceConfig[];
  if (spec.category === "lumiere") {
    const parPiece = new Map<string, GroupeLumineux[]>();
    // Seules les LUMIÈRES comptent comme points d'utilisation : un interrupteur coché dans le circuit n'est pas un point lumineux.
    cluster.filter(item => estLumiere(item.base.type)).forEach(item => {
      const { typeCommande, nbCommandes } = deduireCommandeLumiere(tousItems, item.base.id);
      const arr = parPiece.get(item.pieceNom) ?? [];
      arr.push({ nbPoints: 1, typeCommande, nbCommandes });
      parPiece.set(item.pieceNom, arr);
    });
    pieces = Array.from(parPiece.entries()).map(([nom, groupes]) => ({ nom, nbPrises: 0, groupes }));
  } else {
    const parPiece = new Map<string, number>();
    cluster.forEach(item => parPiece.set(item.pieceNom, (parPiece.get(item.pieceNom) ?? 0) + 1));
    pieces = Array.from(parPiece.entries()).map(([nom, n]) => ({
      nom, nbPrises: n, groupes: [{ nbPoints: 1, typeCommande: "simple", nbCommandes: 1 }],
    }));
  }
  let label = manuel.nom;
  if (spec.category === "chauffage") {
    const totalW = cluster.reduce((s, item) => s + (item.base.puissanceW ?? PUISSANCE_CHAUFFAGE_DEFAUT_W), 0);
    label += ` (${(totalW / 1000).toFixed(2).replace(/\.?0+$/, "")} kW)`;
  }
  return {
    id: uid(), label, circuit: manuel.famille,
    amperes: spec.ampMax, type: "1P", customSection: spec.section ?? "2.5", pieces, manuelId: manuel.id,
  };
}

function genererBreakersManuels(itemsParManuel: Map<number, Item[]>, manuels: CircuitManuel[], niveauNom: string, breakers: Breaker[], tousItems: Item[]): void {
  itemsParManuel.forEach((cluster, manuelId) => {
    const manuel = manuels.find(m => m.id === manuelId);
    if (!manuel || cluster.length === 0) return;
    const b = breakerFromClusterManuel(cluster, manuel, niveauNom, tousItems);
    breakers.push(b);
    cluster.forEach(item => { item.base.circuitId = b.id; });
    rattacherRetoursLampe(tousItems, cluster, b.id);
  });
}

/**
 * Génère les circuits (Breaker[]) d'un logement complet à partir des positions
 * réelles des appareillages placés sur le plan. Règles :
 *  - Un circuit ne mélange jamais deux niveaux (frontière naturelle de
 *    regroupement — hypothèse de conception, pas une règle NFC).
 *  - Les circuits MANUELS sont traités en premier : un appareillage rattaché à un
 *    circuit manuel (n'importe quel type — voir CircuitManuelForm, page.tsx) forme
 *    UN breaker avec exactement ses membres choisis, jamais scindé ni recomposé, et
 *    n'entre dans AUCUNE classification automatique ci-dessous (voir breakerFromClusterManuel).
 *  - Parmi le reste (non assigné manuellement) : chaque appareil dédié (four,
 *    chauffe-eau…) reçoit son propre circuit (CIRCUITS[...].dedié) ; le chauffage
 *    fait exception et se regroupe par puissance cumulée (voir genererBreakersChauffage).
 *  - Prises et éclairage sont regroupés par clustering spatial jusqu'aux
 *    seuils MAX_PAR_CIRCUIT (mêmes seuils que le compliance checker du
 *    module Tableau, pour un score NFC cohérent une fois généré).
 *  - La commande d'un point lumineux (simple/va-et-vient/télérupteur) est
 *    déduite des interrupteurs/va-et-vient/télérupteurs placés et liés via
 *    commandePourId, qu'il s'agisse d'un circuit manuel ou automatique.
 */
export function genererCircuits(maisonIn: Maison): ResultatGeneration {
  const breakers: Breaker[] = [];
  const alertes: string[] = [];

  // circuitId est remis à zéro ici pour TOUS les appareillages avant recalcul — sinon un
  // appareillage explicitement exclu de cette génération (voir appareillagesExclus
  // ci-dessous) conserverait le circuitId d'une génération précédente au lieu de redevenir
  // effectivement non raccordé : sans ce reset, seuls les appareillages RETRAITÉS à chaque
  // passe voyaient leur circuitId se mettre à jour, ceux qu'on choisit de ne plus traiter
  // gardaient l'ancien par simple copie.
  const niveaux: Niveau[] = maisonIn.niveaux.map(n => ({
    ...n,
    pieces: n.pieces.map(p => ({ ...p, appareillages: p.appareillages.map(a => ({ ...a, circuitId: undefined })) })),
  }));

  // Tous les appareillages de la maison (tous niveaux) : une commande peut piloter un point lumineux d'un autre
  // étage (va-et-vient entre rez-de-chaussée et étage) — la déduction du type de commande doit donc la voir.
  // Pièce RÉELLE de chaque appareillage (voir piece-reelle.ts) : une prise posée dehors contre le mur des WC n'est pas « aux WC ».
  const reellesParNiveau = new Map(niveaux.map(n => [n.id, appareillagesParPieceReelle(n)] as const));
  const itemsMaison: Item[] = niveaux.flatMap(n => n.pieces.flatMap(piece =>
    piece.appareillages.map(a => { const r = reellesParNiveau.get(n.id)!.vers.get(a.id) ?? piece; return { base: a, pieceNom: r.nom, piece: r, x: a.x, y: a.y } as Item; })));

  for (const niveau of niveaux) {
    const debutBreakersNiveau = breakers.length;
    const tousItems: Item[] = [];
    const reelles = reellesParNiveau.get(niveau.id)!;
    niveau.pieces.forEach(piece => {
      piece.appareillages.forEach(a => { const r = reelles.vers.get(a.id) ?? piece; tousItems.push({ base: a, pieceNom: r.nom, piece: r, x: a.x, y: a.y }); });
    });
    // Contrôles par pièce (minimum de prises, chauffage) : sur les appareillages RÉELLEMENT dans la pièce.
    [...reelles.pieces.values()].forEach(({ piece, apps }) => {
      const nbPrises = apps.filter(a => a.type === "prise" || a.type === "prise_commandee").length;
      const minFn = MIN_PRISES_PIECE[piece.type] ?? MIN_PRISES_PIECE.autre;
      const minReq = minFn(aireDuPolygone(piece.contour));
      if (minReq > 0 && nbPrises < minReq) {
        alertes.push(`"${piece.nom || piece.type}" (${niveau.nom}) : ${nbPrises} prise(s) placée(s), minimum NF C 15-100 recommandé ${minReq}.`);
      }

      // Un chauffage sans puissance renseignée est regroupé sur la base d'une valeur par
      // défaut (PUISSANCE_CHAUFFAGE_DEFAUT_W) — le calibre retenu (16A/3500W max ou
      // 20A/4500W max, NF C 15-100 amdt A5) peut donc ne pas correspondre à la réalité une
      // fois la puissance réelle connue. Prévient plutôt que de laisser un circuit
      // silencieusement mal dimensionné.
      apps.filter(a => a.type === "chauffage" && a.puissanceW == null).forEach(() => {
        alertes.push(`"${piece.nom || piece.type}" (${niveau.nom}) : chauffage sans puissance renseignée — regroupement basé sur ${PUISSANCE_CHAUFFAGE_DEFAUT_W} W par défaut, à vérifier (calibre limité à 3500 W en 16A ou 4500 W en 20A, NF C 15-100 amdt A5).`);
      });
    });

    // ─── Circuits manuels d'abord : ils retirent leurs membres du pool automatique ────
    // Un appareillage rattaché à un circuit manuel EXISTANT (circuitManuelId valide sur ce
    // niveau) n'entre dans AUCUNE classification automatique ci-dessous, quel que soit son
    // type — c'est tout le sens de "la main libre" : l'utilisateur décide, la génération
    // automatique ne revient jamais dessus. Un circuitManuelId pointant vers un circuit
    // supprimé retombe silencieusement dans l'automatique (comportement inchangé).
    const manuels = niveau.circuitsManuels ?? [];
    const idsManuelsValides = new Set(manuels.map(m => m.id));
    const itemsParManuel = new Map<number, Item[]>();
    const reste: Item[] = [];
    tousItems.forEach(item => {
      const mid = item.base.circuitManuelId;
      if (mid != null && idsManuelsValides.has(mid)) {
        const arr = itemsParManuel.get(mid) ?? [];
        arr.push(item);
        itemsParManuel.set(mid, arr);
      } else {
        reste.push(item);
      }
    });
    genererBreakersManuels(itemsParManuel, manuels, niveau.nom, breakers, itemsMaison);

    // ─── Exclusions explicites (Niveau.appareillagesExclus) ────────────────────────
    // Un appareillage exclu (voir terminerDessinCheminement, page.tsx — un membre non
    // recliqué en redessinant le cheminement d'un circuit AUTOMATIQUE) ne rejoint plus
    // AUCUN pool automatique : il reste sans circuitId (non raccordé, voir le garde-fou
    // plus bas) tant qu'il n'est pas explicitement réinclus ou assigné à un circuit manuel.
    const idsExclus = new Set(niveau.appareillagesExclus ?? []);
    const resteApresExclusion = reste.filter(a => !idsExclus.has(a.base.id));

    // ─── Reste : classification automatique habituelle (prises/cuisine/extérieur/────
    // éclairage/chauffage/dédiés), inchangée à ceci près qu'elle ne porte plus que sur les
    // appareillages qu'aucun circuit manuel n'a déjà pris en charge, ET qui ne sont pas
    // explicitement exclus.
    const prisesStandard = resteApresExclusion.filter(a => familleCircuitManuelAppareillage(a.base.type, a.piece.type) === "prise_16");
    const prisesCuisine = resteApresExclusion.filter(a => familleCircuitManuelAppareillage(a.base.type, a.piece.type) === "cuisine_prises");
    const prisesExtGarage = resteApresExclusion.filter(a => familleCircuitManuelAppareillage(a.base.type, a.piece.type) === "exterieur");
    const pointsLumineux = resteApresExclusion.filter(a => familleCircuitManuelAppareillage(a.base.type, a.piece.type) === "lumiere");
    const chauffages = resteApresExclusion.filter(a => a.base.type === "chauffage");
    const volets = resteApresExclusion.filter(a => familleCircuitManuelAppareillage(a.base.type, a.piece.type) === "volets_roulants");
    const dedies = resteApresExclusion.filter(a => !!cleCircuitDedie(a.base));

    genererBreakersPrises(prisesStandard, "prise_16", niveau.nom, breakers);
    genererBreakersPrises(prisesCuisine, "cuisine_prises", niveau.nom, breakers);
    genererBreakersPrises(prisesExtGarage, "exterieur", niveau.nom, breakers);
    genererBreakersChauffage(chauffages, niveau.nom, breakers);
    genererBreakersPrises(volets, "volets_roulants", niveau.nom, breakers);

    // Éclairage : déduction de la commande depuis les interrupteurs/va-et-vient/télérupteurs liés
    const lumItems = pointsLumineux.map(pl => ({ ...pl, ...deduireCommandeLumiere(itemsMaison, pl.base.id) }));
    genererBreakersLumiere(lumItems, niveau.nom, breakers, itemsMaison);

    // Appareils dédiés : un circuit par instance
    dedies.forEach(item => {
      const circuitKey = cleCircuitDedie(item.base)!;
      const spec = CIRCUITS[circuitKey];
      const b: Breaker = {
        id: uid(), label: `${spec.label} — ${item.pieceNom || niveau.nom}`, circuit: circuitKey,
        amperes: spec.ampMax, type: "1P", customSection: spec.section ?? "2.5",
        pieces: [{ nom: item.pieceNom, nbPrises: 1, groupes: [{ nbPoints: 1, typeCommande: "simple", nbCommandes: 1 }] }],
      };
      breakers.push(b);
      item.base.circuitId = b.id;
    });

    // Prises RJ45 : UN circuit (de communication) par prise — une plaque « prise + RJ45 » donne donc deux circuits :
    // le circuit de puissance de la prise et le câble RJ45. Sans disjoncteur (voir CIRCUIT_COMMUNICATION).
    let nRj45 = 0;
    const courantsFaibles = resteApresExclusion.filter(a => a.base.type === "rj45" || a.base.type === "prise_tv");
    const nbRj45Niveau = courantsFaibles.length;
    courantsFaibles.forEach(item => {
      nRj45++;
      const spec = CIRCUITS[CIRCUIT_COMMUNICATION];
      const nomCircuit = item.base.type === "prise_tv" ? "Antenne TV (coaxial)" : spec.label;
      const b: Breaker = {
        id: uid(), label: `${nomCircuit} ${nbRj45Niveau > 1 ? `n°${nRj45} ` : ""}— ${item.pieceNom || niveau.nom}`, circuit: CIRCUIT_COMMUNICATION,
        amperes: 0, type: "1P",
        pieces: [{ nom: item.pieceNom, nbPrises: 1, groupes: [] }],
      };
      breakers.push(b);
      item.base.circuitId = b.id;
    });

    // ─── Garde-fou : tout appareillage encore sans circuit après tout ce qui précède ──
    // (typiquement un interrupteur/va-et-vient/télérupteur dont la commande ne pointe vers
    // aucun point lumineux raccordé, ou un appareillage explicitement exclu — voir
    // Niveau.appareillagesExclus) reste invisible sur le tracé — sans alerte, l'absence
    // passe facilement inaperçue.
    niveau.pieces.forEach(piece => {
      piece.appareillages.forEach(a => {
        if (a.circuitId == null && !TYPES_SANS_CIRCUIT.includes(a.type)) {
          const label = LABEL_NON_RACCORDE[a.type] ?? a.type;
          alertes.push(`"${piece.nom || piece.type}" (${niveau.nom}) : ${label} sans circuit assigné.`);
        }
      });
    });

    // ─── Garde-fou : cheminement dessiné à la main incomplet SUR UN CIRCUIT MANUEL ──
    // Un circuit AUTOMATIQUE oublié au clic exclut désormais explicitement l'appareillage
    // (voir Niveau.appareillagesExclus et le garde-fou "non raccordé" ci-dessus) — cette
    // alerte-ci ne concerne donc que les circuits MANUELS, où un membre non recliqué en
    // redessinant reste rattaché au même circuit (voir sequenceAncresCircuitOrdonnee,
    // maison-types.ts) : sans elle, on pourrait croire avoir redessiné tout le câblage à la
    // main alors qu'un membre suit en réalité un placement automatique par proximité.
    Object.entries(niveau.ordresCircuits ?? {}).forEach(([label, ordre]) => {
      const breaker = breakers.find(b => b.label === label);
      if (!breaker || breaker.manuelId == null) return; // pas de circuit manuel à ce label — rien à signaler ici
      const membres = niveau.pieces.flatMap(p => p.appareillages).filter(a => a.circuitId === breaker.id);
      const oublies = membres.filter(a => !ordre.includes(a.id));
      if (oublies.length > 0) {
        alertes.push(`"${label}" (${niveau.nom}) : cheminement redessiné incomplet — ${oublies.length} appareillage(s) non cliqué(s), resté(s) sur ce circuit en fin de tracé par proximité.`);
      }
    });

    // Marque chaque circuit créé pour ce niveau : sert à le router vers le bon tableau
    // (principal ou annexe) au moment du "Pousser" — voir Niveau.tableauId.
    for (let i = debutBreakersNiveau; i < breakers.length; i++) breakers[i].niveauId = niveau.id;
  }

  return { maison: { niveaux }, breakers, alertes };
}

// ─── COULEUR RÉSOLUE PAR CIRCUIT (manuelle si définie, sinon procédurale) ──────
// Un Breaker généré automatiquement n'a pas d'id stable d'une génération à l'autre —
// sa couleur manuelle est donc indexée par son label (déterministe tant que la
// composition du plan ne change pas) sur Niveau.couleursCircuits. Un circuit manuel
// (Breaker.manuelId défini) prend directement la couleur de son CircuitManuel.
// niveauxVivants (optionnel) : passe les niveaux "vivants" (état React actuel, édité en
// direct par l'utilisateur — pas le résultat figé au moment du clic sur "Générer") pour
// que les couleurs choisies dans le sélecteur s'appliquent immédiatement, sans attendre
// une régénération. Sans ce paramètre, retombe sur les couleurs telles qu'elles étaient
// au moment de la génération (utile pour un contexte qui n'a accès qu'au résultat figé).
export function construireColorMap(resultat: ResultatGeneration, niveauxVivants?: Niveau[]): Map<number, string> {
  const map = new Map<number, string>();
  let compteur = 0;
  resultat.maison.niveaux.forEach(niveauResultat => {
    const niveau = niveauxVivants?.find(n => n.id === niveauResultat.id) ?? niveauResultat;
    const breakersNiveau = breakersDuNiveau(resultat.breakers, niveauResultat);
    breakersNiveau.forEach(b => {
      const manuel = b.manuelId != null ? (niveau.circuitsManuels ?? []).find(m => m.id === b.manuelId) : undefined;
      const couleur = niveau.couleursCircuits?.[b.label] ?? manuel?.couleur ?? couleurCircuit(compteur);
      map.set(b.id, couleur);
      compteur++;
    });
  });
  // Filet de sécurité — un breaker qu'aucun niveau n'a matché (ne devrait pas arriver).
  resultat.breakers.forEach((b, i) => { if (!map.has(b.id)) map.set(b.id, couleurCircuit(i)); });
  return map;
}

// Segments à tracer pour un circuit donné — étoile depuis une boîte de dérivation pour
// l'éclairage (un seul câble tableau -> boîte, puis chaque point lumineux en étoile, et
// chaque interrupteur relié uniquement au(x) point(s) lumineux qu'il commande, jamais en
// série avec le reste du circuit — plus, désormais, les liaisons directes lampe-à-lampe
// posées à la main, voir Niveau.liaisonsDirectesLumiere), chaîne (plus-proche-voisin
// automatique, ou ordre choisi à la main via Niveau.ordresCircuits — voir
// sequenceAncresCircuitOrdonnee) pour tout le reste (prises, chauffage, appareils dédiés,
// manuels non-éclairage). Partagé par le rendu 2D et la vue 3D.
export function segmentsPourCircuit(breaker: Breaker, points: AppareillagePlace[], niveau: Niveau, tableauPos: Point): SegmentCircuit[] {
  // Circuit manuel marqué "déjà existant" (CircuitManuel.nonRelieTableau) : aucun segment
  // n'est tracé vers le tableau, quel que soit le type de circuit — voir
  // relieAuTableau dans sequenceAncresCircuit(Ordonnee) / construireBranchesCircuitEclairage.
  const manuel = breaker.manuelId != null ? (niveau.circuitsManuels ?? []).find(m => m.id === breaker.manuelId) : undefined;
  const relieAuTableau = !manuel?.nonRelieTableau;
  if (breaker.circuit === "lumiere") {
    const lumieres = points.filter(a => estLumiere(a.type));
    const commandes = points.filter(a => estCommande(a.type));
    const boites = niveau.boitesDerivation?.[breaker.label] ?? [];
    const liaisonsDirectes = niveau.liaisonsDirectesLumiere?.[breaker.label] ?? [];
    return construireBranchesCircuitEclairage(tableauPos, boites, lumieres, commandes, liaisonsDirectes, relieAuTableau);
  }
  const ordre = niveau.ordresCircuits?.[breaker.label];
  const sequence = ordre
    ? sequenceAncresCircuitOrdonnee(tableauPos, points, ordre, relieAuTableau)
    : sequenceAncresCircuit(tableauPos, points, relieAuTableau);
  const segments: SegmentCircuit[] = [];
  for (let i = 0; i < sequence.length - 1; i++) {
    segments.push({ aId: sequence[i].id, aPoint: sequence[i].point, bId: sequence[i + 1].id, bPoint: sequence[i + 1].point });
  }
  return segments;
}

// ─── ASSEMBLAGE EN RANGÉES DE TABLEAU (BreakerRow[]) ───────────────────────────

/**
 * Répartit les circuits générés sur des rangées de 8 + 1 différentiel.
 *
 * Règles appliquées :
 *  - Regroupement STRICT par type de différentiel exact requis (AC/A/F) —
 *    un circuit "Type A" (lave-linge, IRVE, plaque...) n'est jamais placé sous
 *    un différentiel plus faible, et partage un différentiel A avec le moins
 *    de rangées possible (minimise le nombre de différentiels A/F, plus chers).
 *  - Entrelacement par catégorie (éclairage / prises / chauffage / appareils
 *    dédiés) au sein de chaque groupe de différentiel — évite qu'une rangée
 *    entière soit "tout éclairage" ou "toutes les prises".
 *  - Chaque rangée générée est taguée origine:"plan" (voir BreakerRow).
 *  - Garantit au moins 2 différentiels dès que plus d'un circuit existe (Art. 531.2).
 */
function categorieCircuit(b: Breaker): "lumiere" | "prises" | "chauffage" | "dedies" {
  const cat = CIRCUITS[b.circuit]?.category;
  if (cat === "lumiere") return "lumiere";
  if (cat === "prises") return "prises";
  if (cat === "chauffage") return "chauffage";
  return "dedies";
}

function entrelacerParCategorie(breakers: Breaker[]): Breaker[] {
  const groupes: Record<string, Breaker[]> = { lumiere: [], prises: [], chauffage: [], dedies: [] };
  breakers.forEach(b => groupes[categorieCircuit(b)].push(b));
  const result: Breaker[] = [];
  let reste = true;
  while (reste) {
    reste = false;
    for (const c of ["lumiere", "prises", "chauffage", "dedies"]) {
      const b = groupes[c].shift();
      if (b) { result.push(b); reste = true; }
    }
  }
  return result;
}

// Calibre de l'ID (interrupteur différentiel) en tête de rangée — jusqu'ici fixé à 25A
// quelle que soit la charge réelle, ce qui pouvait sous-dimensionner le différentiel par
// rapport aux circuits qu'il protège (un ID doit couvrir la charge de sa rangée, pas une
// valeur arbitraire). Règle appliquée, alignée sur la pratique professionnelle courante :
//  - la toute première rangée du tableau est TOUJOURS en 63A, tête de tableau, avant même
//    tout calcul de charge (pratique standard, indépendante du contenu de cette rangée) ;
//  - pour les autres rangées, on somme les calibres des disjoncteurs protégés avec un
//    coefficient de foisonnement de 0,5 (usage rarement simultané), SAUF le chauffage
//    électrique qui compte à 100% (peu diversifié — usage quasi simultané en saison de
//    chauffe) ; le résultat est arrondi au calibre standard immédiatement supérieur parmi
//    40A/63A (25A n'est en pratique quasiment jamais utilisé pour une rangée de tableau
//    principal — réservé aux tableaux divisionnaires légers).
function calibreDifferentiel(list: Breaker[], premiereRangee: boolean): number {
  if (premiereRangee) return 63;
  const charge = list.reduce((somme, b) => {
    const estChauffage = CIRCUITS[b.circuit]?.category === "chauffage";
    return somme + (estChauffage ? b.amperes : b.amperes * 0.5);
  }, 0);
  // Le plus petit calibre standard (AMPERES_DIFFERENTIEL, electrical-constants.ts) qui
  // couvre la charge calculée, jamais en dessous de 40A pour une rangée de tableau
  // principal (25A n'est en pratique quasiment jamais utilisé ici) — reste modifiable à la
  // main ensuite dans le module Tableau si ce choix automatique ne convient pas.
  return AMPERES_DIFFERENTIEL.find(a => a >= 40 && a >= charge) ?? AMPERES_DIFFERENTIEL[AMPERES_DIFFERENTIEL.length - 1];
}

export function assemblerTableau(breakers: Breaker[]): BreakerRow[] {
  const mkRow = (name: string, list: Breaker[], diffType: string, premiereRangee: boolean): BreakerRow => {
    const slots: (Breaker | null)[] = Array(9).fill(null);
    const amperesId = calibreDifferentiel(list, premiereRangee);
    slots[0] = { id: uid(), label: "", circuit: "general", amperes: amperesId, type: `diff-${diffType}`, customSection: "10.0", pieces: [] };
    list.forEach((b, i) => { slots[i + 1] = b; });
    return { id: uid(), name, slots, origine: "plan" };
  };

  const parType: Record<string, Breaker[]> = { F: [], A: [], AC: [] };
  breakers.forEach(b => {
    const dt = CIRCUITS[b.circuit]?.diffType ?? "AC";
    (parType[dt] ?? parType.AC).push(b);
  });

  const rows: BreakerRow[] = [];
  (["F", "A", "AC"] as const).forEach(dt => {
    const entrelaces = entrelacerParCategorie(parType[dt]);
    for (let i = 0; i < entrelaces.length; i += 8) {
      rows.push(mkRow(`Rangée ${rows.length + 1}`, entrelaces.slice(i, i + 8), dt, rows.length === 0));
    }
  });

  if (rows.length === 1) {
    const nonDiff = rows[0].slots.slice(1).filter((b): b is Breaker => b != null);
    if (nonDiff.length > 1) {
      const half = Math.ceil(nonDiff.length / 2);
      const dt = CIRCUITS[nonDiff[0].circuit]?.diffType ?? "AC";
      rows.length = 0;
      rows.push(mkRow("Rangée 1", nonDiff.slice(0, half), dt, true), mkRow("Rangée 2", nonDiff.slice(half), dt, false));
    }
  }

  return rows;
}

// ─── UTILITAIRE — remappe les ids d'un lot de rangées pour éviter toute ────────
// collision avec des ids déjà présents dans un tableau_config existant (chaque
// page/session repart d'un compteur d'ids à zéro : une fusion sans remap
// pourrait faire coexister deux breakers différents portant le même id).

export function remapperIdsRows(rows: BreakerRow[], offset: number): BreakerRow[] {
  return rows.map(r => ({
    ...r,
    id: r.id + offset,
    slots: r.slots.map(b => (b ? { ...b, id: b.id + offset } : null)),
  }));
}

export function maxIdRows(rows: BreakerRow[]): number {
  let max = 0;
  rows.forEach(r => {
    max = Math.max(max, r.id);
    r.slots.forEach(b => { if (b) max = Math.max(max, b.id); });
  });
  return max;
}

// ─── CHEMINEMENT DES GAINES — VUE GLOBALE PAR NIVEAU ────────────────────────────

export interface TronconGaine {
  nom: string;
  niveau: string;
  circuits: string[];
  cables: string[];
  gaine: string;
  tauxPct: number;
}

export function genererGainesNiveaux(resultat: ResultatGeneration): TronconGaine[] {
  const niveauxTries = [...resultat.maison.niveaux].sort((a, b) => a.ordre - b.ordre);
  const troncons: TronconGaine[] = [];

  for (const niveau of niveauxTries) {
    // Un circuit manuel "déjà existant" (CircuitManuel.nonRelieTableau) ne remonte jamais
    // au tableau — il ne consomme donc aucune place dans la gaine principale tableau→niveau.
    const circuitsNiveau = breakersDuNiveau(resultat.breakers, niveau).filter(b => {
      if (estCircuitSansDisjoncteur(b)) return false;   // courant faible : pas dans la gaine de puissance
      const manuel = b.manuelId != null ? (niveau.circuitsManuels ?? []).find(m => m.id === b.manuelId) : undefined;
      return !manuel?.nonRelieTableau;
    });
    if (circuitsNiveau.length === 0) continue;

    const cables: string[] = [];
    circuitsNiveau.forEach(b => {
      const section = effectiveSection(b);
      const spec = CIRCUITS[b.circuit];
      if (spec?.category === "lumiere") {
        b.pieces.forEach(p => p.groupes.forEach(g => cables.push(...cablesGroupe(g, section))));
      } else {
        cables.push(...cablesPrises(section));
      }
    });

    const info = gaineRecommandee(cables);
    troncons.push({
      nom: niveau.type === "annexe" ? `Tableau annexe → ${niveau.nom || "Annexe"}` : `Tableau → ${niveau.nom || niveau.type}`,
      niveau: niveau.nom || niveau.type,
      circuits: circuitsNiveau.map(b => b.label || CIRCUITS[b.circuit]?.label || b.circuit),
      cables,
      gaine: info.gaine,
      tauxPct: info.tauxPct,
    });
  }

  return troncons;
}

// ─── CONTRÔLE « RIEN OUBLIÉ » ────────────────────────────────────────────────────────────────────────────────
// Passe en revue TOUS les appareillages et circuits (générés ou saisis à la main) et remonte ce qui cloche, avec les ids
// à surligner sur le plan. Ne modifie rien.
export type CodeProbleme = "non_raccorde" | "commande_sans_lampe" | "lampe_sans_commande" | "va_et_vient_seul" | "commande_multi_circuits" | "depassement";
export interface ProblemeCircuit { code: CodeProbleme; gravite: "erreur" | "avertissement"; message: string; niveauId: number; appareilIds: number[] }
export interface BilanControle { problemes: ProblemeCircuit[]; total: number; raccordes: number }

export function controlerCircuits(resultat: ResultatGeneration): BilanControle {
  const problemes: ProblemeCircuit[] = [];
  const tous: { a: AppareillagePlace; piece: Piece; niveau: Niveau }[] = resultat.maison.niveaux.flatMap(niveau =>
    niveau.pieces.flatMap(piece => piece.appareillages.map(a => ({ a, piece, niveau }))));
  const parId = new Map(tous.map(t => [t.a.id, t]));
  const nom = (t: { a: AppareillagePlace; piece: Piece }) => `${LABEL_NON_RACCORDE[t.a.type] ?? t.a.type} (${t.piece.nom || t.piece.type})`;
  const commandes = tous.filter(t => estCommande(t.a.type));
  let total = 0, raccordes = 0;

  tous.forEach(t => {
    const { a, niveau } = t;
    if (a.dejaExistant && a.circuitId == null) return;
    if (TYPES_SANS_CIRCUIT.includes(a.type)) return; // courants faibles : câble en étoile, pas de disjoncteur
    total++;
    if (a.circuitId != null) raccordes++;
    else problemes.push({ code: "non_raccorde", gravite: "erreur", niveauId: niveau.id, appareilIds: [a.id],
      message: `${nom(t)} — ${niveau.nom} : aucun circuit (oublié ou exclu).` });
  });

  commandes.forEach(t => {
    const cibles = lumieresCommandees(t.a).filter(id => parId.has(id) && estLumiere(parId.get(id)!.a.type));
    if (cibles.length === 0) {
      problemes.push({ code: "commande_sans_lampe", gravite: "erreur", niveauId: t.niveau.id, appareilIds: [t.a.id],
        message: `${nom(t)} — ${t.niveau.nom} : ne commande aucun point lumineux.` });
      return;
    }
    const circuits = new Set(cibles.map(id => parId.get(id)!.a.circuitId).filter(c => c != null));
    if (circuits.size > 1) {
      problemes.push({ code: "commande_multi_circuits", gravite: "erreur", niveauId: t.niveau.id, appareilIds: [t.a.id, ...cibles],
        message: `${nom(t)} — ${t.niveau.nom} : commande des lampes de ${circuits.size} circuits différents (impossible à câbler : mets-les dans le même circuit).` });
    }
  });

  tous.filter(t => estLumiere(t.a.type) && !t.a.dejaExistant).forEach(t => {
    const cmds = commandes.filter(c => commandeCetteLumiere(c.a, t.a.id));
    if (cmds.length === 0) {
      problemes.push({ code: "lampe_sans_commande", gravite: "avertissement", niveauId: t.niveau.id, appareilIds: [t.a.id],
        message: `${nom(t)} — ${t.niveau.nom} : aucune commande (interrupteur, va-et-vient, télérupteur ou détecteur) ne l'allume.` });
      return;
    }
    const nbVaV = cmds.filter(c => baseCommande(c.a.type) === "va_et_vient").length;
    if (nbVaV === 1) {
      problemes.push({ code: "va_et_vient_seul", gravite: "erreur", niveauId: t.niveau.id, appareilIds: [t.a.id, ...cmds.map(c => c.a.id)],
        message: `${nom(t)} — ${t.niveau.nom} : un seul va-et-vient (il en faut au moins 2, sinon un interrupteur simple).` });
    }
  });

  resultat.breakers.forEach(b => {
    const membres = tous.filter(t => t.a.circuitId === b.id);
    if (membres.length === 0) return;
    const niveauId = b.niveauId ?? membres[0].niveau.id;
    if (CIRCUITS[b.circuit]?.category === "lumiere") {
      const lampes = membres.filter(t => estLumiere(t.a.type));
      const max = MAX_PAR_CIRCUIT.lumiere ?? 8;
      if (lampes.length > max) problemes.push({ code: "depassement", gravite: "erreur", niveauId, appareilIds: lampes.map(t => t.a.id),
        message: `« ${b.label} » : ${lampes.length} points lumineux, maximum ${max} par circuit (NF C 15-100).` });
    } else if (MAX_PAR_CIRCUIT[b.circuit] != null) {
      const max = MAX_PAR_CIRCUIT[b.circuit];
      const prises = membres.filter(t => !estCommande(t.a.type));
      if (prises.length > max) problemes.push({ code: "depassement", gravite: "erreur", niveauId, appareilIds: prises.map(t => t.a.id),
        message: `« ${b.label} » : ${prises.length} socles, maximum ${max} par circuit (NF C 15-100).` });
    }
  });

  return { problemes, total, raccordes };
}

// Dépassement NF C 15-100 pour un jeu d'appareillages destiné à UN circuit de la famille donnée (clé CIRCUITS) : message ou null.
export function messageDepassement(famille: string, appareils: Pick<AppareillagePlace, "type">[], nomCircuit?: string): string | null {
  const nom = nomCircuit ? `« ${nomCircuit} » : ` : "";
  const spec = CIRCUITS[famille];
  if (!spec) return null;
  if (spec.category === "lumiere") {
    const n = appareils.filter(a => estLumiere(a.type)).length, max = MAX_PAR_CIRCUIT.lumiere ?? 8;
    return n > max ? `${nom}${n} points lumineux — maximum ${max} par circuit d'éclairage (NF C 15-100). Crée un second circuit.` : null;
  }
  const membres = appareils.filter(a => !estCommande(a.type));
  if (spec.dedié && membres.length > 1) return `${nom}${membres.length} appareils sur un circuit spécialisé « ${spec.label} » — un seul appareil par circuit (NF C 15-100).`;
  const max = MAX_PAR_CIRCUIT[famille];
  if (max != null && membres.length > max) return `${nom}${membres.length} socles — maximum ${max} par circuit (NF C 15-100). Crée un second circuit.`;
  return null;
}

/**
 * Génère UNIQUEMENT les circuits manuels (aucun circuit automatique) : sert à voir tout de suite un circuit qu'on vient de
 * composer à la main, sans lancer la génération automatique du reste. Les autres appareillages restent sans circuit ; la
 * génération complète (genererCircuits) reprendra ensuite les circuits manuels tels quels.
 */
export function genererCircuitsManuelsSeuls(maison: Maison): ResultatGeneration {
  const exclusionsOrigine = new Map(maison.niveaux.map(n => [n.id, n.appareillagesExclus] as const));
  const niveaux: Niveau[] = maison.niveaux.map(n => {
    const manuelsValides = new Set((n.circuitsManuels ?? []).map(m => m.id));
    const horsManuel = n.pieces.flatMap(p => p.appareillages).filter(a => a.circuitManuelId == null || !manuelsValides.has(a.circuitManuelId)).map(a => a.id);
    return { ...n, appareillagesExclus: Array.from(new Set([...(n.appareillagesExclus ?? []), ...horsManuel])) };
  });
  const res = genererCircuits({ niveaux });
  return {
    ...res,
    alertes: [], // pas de génération automatique : « sans circuit » n'a pas de sens ici
    maison: { niveaux: res.maison.niveaux.map(n => ({ ...n, appareillagesExclus: exclusionsOrigine.get(n.id) })) },
  };
}
