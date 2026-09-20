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
  gaineRecommandee, cablesGroupe, cablesPrises, effectiveSection, uid,
} from "./electrical-constants";
import {
  Maison, Niveau, Piece, AppareillagePlace, aireDuPolygone,
} from "./maison-types";

// Appareillages dédiés → 1 circuit par instance (correspondance directe avec CIRCUITS)
const CIRCUIT_DEDIE: Record<string, string> = {
  four: "four", plaque: "plaque", lave_linge: "lave_linge", lave_vaisselle: "lave_vaisselle",
  seche_linge: "seche_linge", chauffe_eau: "chauffe_eau", chauffage: "chauffage", clim: "clim",
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

/**
 * Génère les circuits (Breaker[]) d'un logement complet à partir des positions
 * réelles des appareillages placés sur le plan. Règles :
 *  - Un circuit ne mélange jamais deux niveaux (frontière naturelle de
 *    regroupement — hypothèse de conception, pas une règle NFC).
 *  - Chaque appareil dédié reçoit son propre circuit (CIRCUITS[...].dedié).
 *  - Prises et éclairage sont regroupés par clustering spatial jusqu'aux
 *    seuils MAX_PAR_CIRCUIT (mêmes seuils que le compliance checker du
 *    module Tableau, pour un score NFC cohérent une fois généré).
 *  - La commande d'un point lumineux (simple/va-et-vient/télérupteur) est
 *    déduite des interrupteurs/va-et-vient/télérupteurs placés et liés via
 *    commandePourId.
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

    const prisesStandard = tousItems.filter(a =>
      (a.base.type === "prise" || a.base.type === "prise_commandee") &&
      !["cuisine", "exterieur", "garage"].includes(a.piece.type));
    const prisesCuisine = tousItems.filter(a =>
      (a.base.type === "prise" || a.base.type === "prise_commandee") && a.piece.type === "cuisine");
    const prisesExtGarage = tousItems.filter(a =>
      (a.base.type === "prise" || a.base.type === "prise_commandee") && (a.piece.type === "exterieur" || a.piece.type === "garage"));
    const pointsLumineux = tousItems.filter(a => a.base.type === "point_lumineux" || a.base.type === "applique");
    const dedies = tousItems.filter(a => !!CIRCUIT_DEDIE[a.base.type]);

    let idx = 1;
    for (const cluster of clusteriser(prisesStandard, MAX_PAR_CIRCUIT.prise_16 ?? 8)) {
      const b = breakerFromClusterPrises(cluster, "prise_16", niveau.nom, idx++);
      breakers.push(b);
      cluster.forEach(item => { item.base.circuitId = b.id; });
    }
    idx = 1;
    for (const cluster of clusteriser(prisesCuisine, MAX_PAR_CIRCUIT.cuisine_prises ?? 6)) {
      const b = breakerFromClusterPrises(cluster, "cuisine_prises", niveau.nom, idx++);
      breakers.push(b);
      cluster.forEach(item => { item.base.circuitId = b.id; });
    }
    idx = 1;
    for (const cluster of clusteriser(prisesExtGarage, MAX_PAR_CIRCUIT.exterieur ?? 8)) {
      const b = breakerFromClusterPrises(cluster, "exterieur", niveau.nom, idx++);
      breakers.push(b);
      cluster.forEach(item => { item.base.circuitId = b.id; });
    }

    // Éclairage : déduction de la commande depuis les interrupteurs/va-et-vient/télérupteurs liés
    const lumItems = pointsLumineux.map(pl => {
      const commandes = tousItems.filter(a => a.base.commandePourIds?.includes(pl.base.id));
      let typeCommande: CommandeType = "simple";
      let nbCommandes = 1;
      if (commandes.some(c => c.base.type === "telerupteur")) {
        typeCommande = "telerupteur";
        nbCommandes = commandes.filter(c => c.base.type === "telerupteur").length || 1;
      } else if (commandes.some(c => c.base.type === "va_et_vient")) {
        typeCommande = "vav";
        nbCommandes = 2;
      }
      return { ...pl, typeCommande, nbCommandes };
    });
    idx = 1;
    for (const cluster of clusteriser(lumItems, MAX_PAR_CIRCUIT.lumiere ?? 8)) {
      const b = breakerFromClusterLumiere(cluster, niveau.nom, idx++);
      breakers.push(b);
      cluster.forEach(item => { item.base.circuitId = b.id; });
    }

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

// ─── ASSEMBLAGE EN RANGÉES DE TABLEAU (BreakerRow[]) ───────────────────────────

/**
 * Répartit les circuits générés sur des rangées de 8 + 1 différentiel.
 *
 * Règles appliquées :
 *  - Regroupement STRICT par type de différentiel exact requis (AC/A/F) —
 *    un circuit "Type A" (lave-linge, IRVE, plaque...) n'est jamais placé sous
 *    un différentiel plus faible, et partage un différentiel A avec le moins
 *    de rangées possible (minimise le nombre de différentiels A/F, plus chers).
 *  - Entrelacement par catégorie (éclairage / prises / appareils dédiés) au
 *    sein de chaque groupe de différentiel — évite qu'une rangée entière soit
 *    "tout éclairage" ou "toutes les prises".
 *  - Chaque rangée générée est taguée origine:"plan" (voir BreakerRow).
 *  - Garantit au moins 2 différentiels dès que plus d'un circuit existe (Art. 531.2).
 */
function categorieCircuit(b: Breaker): "lumiere" | "prises" | "dedies" {
  const cat = CIRCUITS[b.circuit]?.category;
  if (cat === "lumiere") return "lumiere";
  if (cat === "prises") return "prises";
  return "dedies";
}

function entrelacerParCategorie(breakers: Breaker[]): Breaker[] {
  const groupes: Record<string, Breaker[]> = { lumiere: [], prises: [], dedies: [] };
  breakers.forEach(b => groupes[categorieCircuit(b)].push(b));
  const result: Breaker[] = [];
  let reste = true;
  while (reste) {
    reste = false;
    for (const c of ["lumiere", "prises", "dedies"]) {
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
