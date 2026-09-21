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
  gaineRecommandee, cablesGroupe, cablesPrises, effectiveSection, uid,
} from "./electrical-constants";
import {
  Maison, Niveau, Piece, Point, AppareillagePlace, aireDuPolygone,
  CircuitManuel, familleCircuitManuelAppareillage, couleurCircuit,
  SegmentCircuit, sequenceAncresCircuit, construireBranchesCircuitEclairage, centroidePoints,
} from "./maison-types";

// Appareillages dédiés → 1 circuit par instance (correspondance directe avec CIRCUITS).
// Le chauffage n'en fait PAS partie : plusieurs radiateurs peuvent partager un circuit
// tant que leur puissance cumulée reste dans le calibre du disjoncteur (NF C 15-100,
// amendement A5) — voir genererBreakersChauffage, regroupement spatial + puissance.
const CIRCUIT_DEDIE: Record<string, string> = {
  four: "four", plaque: "plaque", lave_linge: "lave_linge", lave_vaisselle: "lave_vaisselle",
  seche_linge: "seche_linge", chauffe_eau: "chauffe_eau", clim: "clim",
  seche_serviette: "seche_serviette", congelateur: "congelateur", irve: "irve",
  piscine: "piscine", vmc: "vmc", alarme: "alarme",
};

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
      .filter(cmd => cmd.base.commandePourIds?.includes(item.base.id) && cmd.base.circuitManuelId == null)
      .forEach(cmd => { cmd.base.circuitId = circuitId; });
  });
}

// Déduit le type de commande (simple allumage / va-et-vient / télérupteur) d'un point
// lumineux à partir des interrupteurs/va-et-vient/télérupteurs placés et liés via
// commandePourIds — partagé par la génération automatique et par un circuit manuel de
// type "lumiere" (voir genererCircuits et breakerFromClusterManuel).
function deduireCommandeLumiere(tousItems: Item[], pointLumineuxId: number): { typeCommande: CommandeType; nbCommandes: number } {
  const commandes = tousItems.filter(a => a.base.commandePourIds?.includes(pointLumineuxId));
  if (commandes.some(c => c.base.type === "telerupteur")) {
    return { typeCommande: "telerupteur", nbCommandes: commandes.filter(c => c.base.type === "telerupteur").length || 1 };
  }
  if (commandes.some(c => c.base.type === "va_et_vient")) {
    return { typeCommande: "vav", nbCommandes: 2 };
  }
  return { typeCommande: "simple", nbCommandes: 1 };
}

function genererBreakersLumiere(
  lumItems: (Item & { typeCommande: CommandeType; nbCommandes: number })[],
  niveauNom: string, breakers: Breaker[], tousItems: Item[],
): void {
  const max = MAX_PAR_CIRCUIT.lumiere ?? 8;
  let idx = 1;
  for (const cluster of clusteriser(lumItems, max)) {
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
    cluster.forEach(item => {
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

  const niveaux: Niveau[] = maisonIn.niveaux.map(n => ({
    ...n,
    pieces: n.pieces.map(p => ({ ...p, appareillages: p.appareillages.map(a => ({ ...a })) })),
  }));

  for (const niveau of niveaux) {
    const tousItems: Item[] = [];
    niveau.pieces.forEach(piece => {
      piece.appareillages.forEach(a => tousItems.push({ base: a, pieceNom: piece.nom, piece, x: a.x, y: a.y }));

      const nbPrises = piece.appareillages.filter(a => a.type === "prise" || a.type === "prise_commandee").length;
      const minFn = MIN_PRISES_PIECE[piece.type] ?? MIN_PRISES_PIECE.autre;
      const minReq = minFn(aireDuPolygone(piece.contour));
      if (minReq > 0 && nbPrises < minReq) {
        alertes.push(`"${piece.nom || piece.type}" (${niveau.nom}) : ${nbPrises} prise(s) placée(s), minimum NF C 15-100 recommandé ${minReq}.`);
      }
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
    genererBreakersManuels(itemsParManuel, manuels, niveau.nom, breakers, tousItems);

    // ─── Reste : classification automatique habituelle (prises/cuisine/extérieur/────
    // éclairage/chauffage/dédiés), inchangée à ceci près qu'elle ne porte plus que sur les
    // appareillages qu'aucun circuit manuel n'a déjà pris en charge.
    const prisesStandard = reste.filter(a => familleCircuitManuelAppareillage(a.base.type, a.piece.type) === "prise_16");
    const prisesCuisine = reste.filter(a => familleCircuitManuelAppareillage(a.base.type, a.piece.type) === "cuisine_prises");
    const prisesExtGarage = reste.filter(a => familleCircuitManuelAppareillage(a.base.type, a.piece.type) === "exterieur");
    const pointsLumineux = reste.filter(a => familleCircuitManuelAppareillage(a.base.type, a.piece.type) === "lumiere");
    const chauffages = reste.filter(a => a.base.type === "chauffage");
    const dedies = reste.filter(a => !!CIRCUIT_DEDIE[a.base.type]);

    genererBreakersPrises(prisesStandard, "prise_16", niveau.nom, breakers);
    genererBreakersPrises(prisesCuisine, "cuisine_prises", niveau.nom, breakers);
    genererBreakersPrises(prisesExtGarage, "exterieur", niveau.nom, breakers);
    genererBreakersChauffage(chauffages, niveau.nom, breakers);

    // Éclairage : déduction de la commande depuis les interrupteurs/va-et-vient/télérupteurs liés
    const lumItems = pointsLumineux.map(pl => ({ ...pl, ...deduireCommandeLumiere(tousItems, pl.base.id) }));
    genererBreakersLumiere(lumItems, niveau.nom, breakers, tousItems);

    // Appareils dédiés : un circuit par instance
    dedies.forEach(item => {
      const circuitKey = CIRCUIT_DEDIE[item.base.type];
      const spec = CIRCUITS[circuitKey];
      const b: Breaker = {
        id: uid(), label: `${spec.label} — ${item.pieceNom || niveau.nom}`, circuit: circuitKey,
        amperes: spec.ampMax, type: "1P", customSection: spec.section ?? "2.5",
        pieces: [{ nom: item.pieceNom, nbPrises: 1, groupes: [{ nbPoints: 1, typeCommande: "simple", nbCommandes: 1 }] }],
      };
      breakers.push(b);
      item.base.circuitId = b.id;
    });
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
    const nomsPieces = new Set(niveauResultat.pieces.map(p => p.nom));
    const breakersNiveau = resultat.breakers.filter(b => b.pieces.some(pc => nomsPieces.has(pc.nom)));
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
// série avec le reste du circuit), simple chaîne par plus-proche-voisin pour tout le reste
// (prises, chauffage, appareils dédiés) comme précédemment. Partagé par le rendu 2D et la
// vue 3D.
export function segmentsPourCircuit(breaker: Breaker, points: AppareillagePlace[], niveau: Niveau, tableauPos: Point): SegmentCircuit[] {
  if (breaker.circuit === "lumiere") {
    const lumieres = points.filter(a => a.type === "point_lumineux" || a.type === "applique");
    const commandes = points.filter(a => a.type === "interrupteur" || a.type === "va_et_vient" || a.type === "telerupteur");
    const boitePos = niveau.boitesDerivation?.[breaker.label] ?? centroidePoints(lumieres.map(l => ({ x: l.x, y: l.y })));
    return construireBranchesCircuitEclairage(tableauPos, boitePos, lumieres, commandes);
  }
  const sequence = sequenceAncresCircuit(tableauPos, points);
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

export function assemblerTableau(breakers: Breaker[]): BreakerRow[] {
  const mkRow = (name: string, list: Breaker[], diffType: string): BreakerRow => {
    const slots: (Breaker | null)[] = Array(9).fill(null);
    slots[0] = { id: uid(), label: "", circuit: "general", amperes: 25, type: `diff-${diffType}`, customSection: "10.0", pieces: [] };
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
      rows.push(mkRow(`Rangée ${rows.length + 1}`, entrelaces.slice(i, i + 8), dt));
    }
  });

  if (rows.length === 1) {
    const nonDiff = rows[0].slots.slice(1).filter((b): b is Breaker => b != null);
    if (nonDiff.length > 1) {
      const half = Math.ceil(nonDiff.length / 2);
      const dt = CIRCUITS[nonDiff[0].circuit]?.diffType ?? "AC";
      rows.length = 0;
      rows.push(mkRow("Rangée 1", nonDiff.slice(0, half), dt), mkRow("Rangée 2", nonDiff.slice(half), dt));
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
    const nomsPieces = new Set(niveau.pieces.map(p => p.nom));
    const circuitsNiveau = resultat.breakers.filter(b => b.pieces.some(p => nomsPieces.has(p.nom)));
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
      nom: `Tableau → ${niveau.nom || niveau.type}`,
      niveau: niveau.nom || niveau.type,
      circuits: circuitsNiveau.map(b => b.label || CIRCUITS[b.circuit]?.label || b.circuit),
      cables,
      gaine: info.gaine,
      tauxPct: info.tauxPct,
    });
  }

  return troncons;
}
