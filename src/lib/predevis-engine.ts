// src/lib/predevis-engine.ts
//
// Moteur du pré-devis électrique : calcule les besoins en consommables à partir du plan
// de circuits (maison_config) et du tableau électrique (tableau_config), puis les fait
// correspondre au catalogue (Prestation.sous_categorie / .gamme) pour proposer jusqu'à
// 3 prix par besoin. Séparé en deux passes :
//   1. calculerBesoinsBruts() — pure géométrie/électricité, ne connaît pas le catalogue.
//   2. apparierCatalogue() — associe chaque besoin brut à 0-3 articles du catalogue.
//
// Hypothèses de modélisation posées explicitement (à ajuster si besoin) :
//  - LONGUEURS RÉELLES : chaque liaison est mesurée sur le tracé 3D (lib/longueurs-circuits.ts) — course horizontale
//    ET montées / descentes (tableau → gaine → 1re prise, appareillage posé haut ou bas, retour lampe vers un
//    interrupteur à 1,10 m…), avec les mêmes hauteurs que la vue 3D. Une montée encastrée compte en câble ET en
//    gaine, une montée apparente en câble ET en moulure. Le décrochement dans l'épaisseur du mur (quelques cm par
//    extrémité) n'est pas compté.
//  - Chaque tronçon géométrique (segment ou sous-segment entre deux coudes) est compté
//    comme UN câble (pratique du câble multiconducteur en une passe), jamais comme
//    plusieurs conducteurs séparés — cohérent avec un devis d'achat de câble en mètres.
//  - Un tronçon reliant une commande (interrupteur/va-et-vient/télérupteur) à sa lampe (retour),
//    ou une liaison "navette" entre deux va-et-vient, est toujours en 1.5mm² (retour/
//    navette), quelle que soit la section du reste du circuit.
//  - Un tronçon "domotique" (AppareillagePlace.domotique) ne consomme aucun câble.
//  - La pose (encastré/apparent) d'une section suit le LiaisonWaypoint.poseType du coude où elle
//    aboutit, ou Niveau.poseFinLiaison pour la dernière section (voir pose-circuits.ts) ; par
//    défaut : encastré. Un même circuit peut mélanger sections encastrées et apparentes.
//  - Un mètre de câblage ENCASTRÉ nécessite un mètre de gaine ICTA (gaine_icta<diamètre>, calibrée via gaineRecommandee sur le
//    NOMBRE RÉEL de conducteurs de la liaison) ; au choix du pré-devis (PoseEncastre), la gaine ICTA PRÉCÂBLÉE
//    (gaine_precablee_<n>g<section>) remplace gaine + fils. Un mètre de câblage APPARENT nécessite TOUJOURS un mètre de gaine IRL
//    (gaine_irl<diamètre>) + fils. Des fils séparés se comptent à raison du nombre de conducteurs de chaque liaison
//    (3 pour une prise : phase + neutre + terre ; 4 à 7 pour navettes / commandes) : quantiteFils = Σ longueur × conducteurs.
//  - La distance "point d'arrivée des gaines → tableau" (Niveau.distanceArriveeGainesTableau)
//    est ajoutée UNE FOIS par circuit du niveau concerné, à la section propre du circuit,
//    en pose encastrée (choix confirmé).
//  - La section/le calibre d'un circuit sont ceux du TABLEAU (tableau_config), qui fait
//    foi (Ben peut l'avoir corrigé à la main) — le calcul de longueur, lui, vient
//    toujours de la géométrie du PLAN. Le rapprochement entre les deux se fait par le
//    libellé du circuit (résolu comme au moment du "Pousser vers le tableau" — voir
//    resoudreLabelCircuit ci-dessous). Si aucun disjoncteur du tableau ne correspond au
//    libellé résolu (ex : renommé ensuite directement dans le tableau), on retombe sur la
//    section par défaut du type de circuit et on le signale en alerte.
//  - Boîte d'encastrement : posée uniquement pour les appareillages muraux usuels (prise,
//    prise commandée, interrupteur, va-et-vient, télérupteur) — pas pour point lumineux/
//    applique (rosette DCL, produit différent). Regroupées par pièce si à moins de 20cm
//    les unes des autres, jusqu'à 4 postes par boîte.
//  - SPOTS (sous_categorie "spot" / "spot_etanche") : un spot = UN point lumineux, chiffré à l'unité, sans boîte
//    DCL ni boîte d'encastrement murale (il s'encastre dans le plafond). Il se raccorde comme tout luminaire :
//    circuit lumière (8 points maxi), boîte de dérivation, retour lampe 1,5 mm². Un spot non étanche en salle de
//    bains / extérieur déclenche une alerte (spot étanche IP44 mini à prévoir hors zone sèche).
//  - Appareillages MULTIPLES (plaque double/triple/quadruple, AppareillagePlace.groupeId) : UNE
//    boîte d'encastrement de la taille de la plaque (jusqu'à 4 postes) et UNE plaque de finition
//    (sous_categorie plaque_Npostes), jamais regroupées par proximité avec d'autres postes ; chaque
//    poste reste chiffré à part (mécanisme). Les postes isolés gardent le regroupement par proximité.
//    TOUTE boîte d'encastrement (simple à quadruple) induit la plaque de finition de même taille :
//    une prise = 1 prise + 1 boîte simple + 1 plaque simple (plaque_1poste), etc.
//  - Prise RJ45 (sous_categorie "rj45") : courant faible, aucun circuit de puissance. Le câble de
//    communication (sous_categorie "cable_rj45", cat. 6 STP) est compté EN ÉTOILE depuis le tableau/
//    coffret de communication du niveau jusqu'à chaque prise : distance « Manhattan » sur le plan
//    (le câble suit les murs et les gaines, pas la ligne droite) PLUS les montées / descentes (coffret → gaine → prise).
//  - TABLEAU (poste « Tableau électrique ») : TOUS les appareils des rangées (principal + annexes) sont chiffrés — chaque
//    disjoncteur par calibre (disjoncteur_XA), chaque différentiel par calibre et type (differentiel_XA_T), classés
//    d'après leur TYPE et non leur position — plus UNE goulotte de montage (sous_categorie "goulotte_tableau") par
//    rangée équipée. La page du pré-devis demande si ce poste doit entrer dans le devis (voir estPieceTableau).
//  - Les appareils "dédiés" (four, plaque, lave-linge…, y compris chauffage) ne sont
//    jamais chiffrés en tant qu'appareil — uniquement leur prise/sortie de câble
//    spécialisée (sous_categorie "prise_specialisee").

import {
  Maison, Niveau, Piece, AppareillagePlace, AppareillageType,
  distance, SegmentCircuit, origineCircuits} from "./maison-types";

import { nbConducteurs } from "./couleurs-fils";
import {
  genererCircuits, segmentsPourCircuit, breakersDuNiveau, ResultatGeneration, cleCircuitDedie,
} from "./maison-engine";
import { MAX_POSTES_PLAQUE, estCommande, estLumiere, estSaillie, TYPES_SAILLIE_POSSIBLE } from "./maison-types";
import { appareillagesParPieceReelle } from "./piece-reelle";
import {
  Breaker as TableauBreaker, BreakerRow, BREAKER_TYPES, effectiveSection, gaineRecommandee, estCircuitSansDisjoncteur, estAccessoireTableau} from "./electrical-constants";


import {
  creerContexteLongueurs, hauteurAncreFn, tracerLiaison, longueurJambe, pieceDeJambe, indexPiecesAppareils,
} from "./longueurs-circuits";
import { Prestation, Gamme, DevisLigne, PrestationFournisseur } from "@/types";
import { nomAvecConditionnement } from "@/lib/utils";
import { PREFIXE_A_COMPLETER } from "@/lib/devis-lignes";
import { designationProduit, imageOffre, libelleOffre, offrePrincipale, offrePourFournisseur, prixVenteOffre } from "@/lib/fournisseurs";
import { sousCategoriesDe, aSousCategorie } from "@/lib/sous-categories";

// ─── TYPES DE BESOIN ────────────────────────────────────────────────────────

export type UniteBesoin = "m" | "u" | "heure";

export interface LigneBesoin {
  cle: string;            // identifiant stable (ex: "cable_2.5@RDC")
  sousCategorie: string;  // sous_categorie catalogue recherchée
  label: string;          // libellé humain (ex: "Câble 2.5mm²")
  piece: string;          // pièce (nom réel) ou pseudo-pièce ("Tableau électrique", "Commun — RDC")
  quantite: number;       // en unite
  unite: UniteBesoin;
  note?: string;          // information d'affichage (ex. boîte + plaque multiple comptées dans un autre circuit)
  appareils?: { piece: string; nom?: string }[]; // appareillages du plan couverts par cette ligne : pièce réelle + nom donné sur le plan (affichage)
  // Besoins de câblage ("cablage_X") : métrage de FILS SÉPARÉS nécessaire = Σ (longueur de la liaison × nombre de conducteurs qu'elle porte).
  // quantiteFils / quantite = nombre moyen de fils à tirer (3 pour un circuit de prises, plus avec navettes / commandes).
  quantiteFils?: number;
}

export interface OptionArticle {
  prestation_id: string;
  nom: string;
  prix_unitaire: number;
  unite: string;
  type_branche: "service" | "materiau";
  gamme: Gamme | null;
  longueur_unitaire: number | null;
  // Pour un besoin de câblage principal ("cablage_X" — voir optionsPourBesoin) : 1 si
  // l'option vient du catalogue en "cable_X" (câble tout-en-un, 1 unité couvre toute la
  // longueur), 3 si elle vient de "fil_X" (fils séparés — phase/neutre/terre comptés
  // individuellement). Absent (traité comme 1) pour tout autre type de besoin.
  quantiteMultiplicateur?: number;
  // sous_categorie RÉELLE de l'article catalogue dont vient cette option — peut différer
  // de BesoinApparie.sousCategorie pour un besoin "cablage_X" (qui n'existe pas tel quel
  // au catalogue, seuls cable_X et fil_X y figurent). Sert à retrouver le bon article "au
  // mètre" pour le reliquat lors de la décomposition en bobines (genererLignesDevis).
  sousCategorieArticle?: string;
  // Fournisseur retenu pour cette option (offre de prestation_fournisseurs) — le prix_unitaire
  // ci-dessus est DÉJÀ celui de ce fournisseur. Absent/null = produit sans offre fournisseur.
  fournisseur_id?: string | null;
  fournisseur_nom?: string | null;
  prix_achat?: number | null;
  // Image du produit (reprise sur la ligne de devis).
  image_url?: string | null;
}

export interface BesoinApparie extends LigneBesoin {
  options: OptionArticle[]; // 0 à 3, triées entrée → haut (ou 1 option sans gamme si legacy)
}

export interface ResultatPreDevis {
  parPiece: Record<string, BesoinApparie[]>;
  nonIdentifies: BesoinApparie[]; // sous-ensemble de parPiece dont options.length === 0
  alertes: string[];
}

// ─── LIBELLÉS ───────────────────────────────────────────────────────────────

// LABEL_CABLAGE : libellé du besoin "cablage_X" (tronçon d'alimentation principale) — un
// besoin générique, dont les options mélangent câble tout-en-un ET fils séparés (voir
// optionsPourBesoin) ; le nom réel de l'article choisi s'affiche par option, ce libellé
// n'est qu'un en-tête.
const LABEL_CABLAGE: Record<string, string> = {
  "1.5": "Câblage 1.5mm² (câble ou fil, au choix)", "2.5": "Câblage 2.5mm² (câble ou fil, au choix)",
  "4.0": "Câblage 4mm² (câble ou fil, au choix)", "6.0": "Câblage 6mm² (câble ou fil, au choix)",
  "10.0": "Câblage 10mm² (câble ou fil, au choix)",
};
const LABEL_APPAREILLAGE: Record<string, string> = {
  prise: "Prise de courant", prise_commandee: "Prise commandée",
  interrupteur: "Interrupteur simple", va_et_vient: "Va-et-vient", telerupteur: "Bouton télérupteur",
  interrupteur_double: "Double interrupteur", va_et_vient_double: "Double va-et-vient", telerupteur_double: "Double bouton télérupteur",
  point_lumineux: "Plafonnier DCL (boîtier d'encastrement compris)", applique: "Sortie applique DCL (boîtier d'encastrement compris)",
  spot: "Spot encastré", spot_etanche: "Spot encastré étanche (IP65)",
  rj45: "Prise RJ45 (communication)",
  prise_tv: "Prise TV / antenne (coaxiale)",
  prise_exterieure: "Prise extérieure (étanche IP44)",
  prise_irve: "Prise renforcée IRVE",
  applique_exterieure: "Applique extérieure (étanche IP44)",
  point_lumineux_exterieur: "Point lumineux extérieur (étanche IP44)",
  interrupteur_exterieur: "Interrupteur extérieur (étanche IP55)",
  detecteur_mouvement: "Détecteur de mouvement",
  detecteur_mouvement_exterieur: "Détecteur de mouvement extérieur (IP55)",
};
// Une commande (interrupteur/va-et-vient/télérupteur) posée en domotique (AppareillagePlace.
// domotique) est un produit différent d'un mécanisme filaire classique — module radio/wifi
// au lieu d'un mécanisme + câblage retour/navette — donc une sous_categorie dédiée, pour
// pouvoir lui associer un prix catalogue propre.
const LABEL_APPAREILLAGE_DOMOTIQUE: Record<string, string> = {
  interrupteur: "Interrupteur domotique", va_et_vient: "Va-et-vient domotique", telerupteur: "Bouton télérupteur domotique",
  interrupteur_double: "Double interrupteur domotique", va_et_vient_double: "Double va-et-vient domotique", telerupteur_double: "Double bouton télérupteur domotique",
};

// Nomenclature des appareillages telle que le pré-devis la RÉCLAME au catalogue : source unique, reprise par
// la page Catalogue (SOUS_CATEGORIES_CONNUES) pour que la liste d'autocomplétion ne puisse plus dériver du
// moteur. Tout nouveau type d'appareillage ajouté à LABEL_APPAREILLAGE (ou à sa variante domotique) y
// apparaît automatiquement. "prise_specialisee" = sortie dédiée d'un appareil (four, lave-linge…).
// Besoin d'APPAREILLAGE (prise, interrupteur, commande, variantes domotiques, plaques de finition) — par opposition aux boîtes,
// câbles, disjoncteurs… Sert au choix « même marque partout » du pré-devis.
export function estSousCategorieAppareillage(sousCategorie: string): boolean {
  return sousCategorie in LABEL_APPAREILLAGE || sousCategorie.endsWith("_domotique") || sousCategorie === "prise_specialisee" || sousCategorie.startsWith("plaque_") || sousCategorie.endsWith("_saillie");
}

export const NOMENCLATURE_APPAREILLAGE: { code: string; label: string }[] = [
  ...Object.entries(LABEL_APPAREILLAGE).map(([code, label]) => ({ code, label })),
  ...Object.entries(LABEL_APPAREILLAGE_DOMOTIQUE).map(([type, label]) => ({ code: `${type}_domotique`, label })),
  { code: "prise_specialisee", label: "Prise / sortie de câble spécialisée" },
  // Versions EN SAILLIE (boîtier apparent compris dans l'article — ni boîte d'encastrement ni plaque au pré-devis).
  ...TYPES_SAILLIE_POSSIBLE.filter(t => t in LABEL_APPAREILLAGE && t !== "point_lumineux" && t !== "applique")
    .map(t => ({ code: `${t}_saillie`, label: `${LABEL_APPAREILLAGE[t]} en saillie` })),
  { code: "prise_specialisee_saillie", label: "Prise / sortie de câble spécialisée en saillie" },
  { code: "point_lumineux_saillie", label: "Plafonnier DCL en saillie" },
  { code: "applique_saillie", label: "Applique DCL en saillie" },
];

// Points lumineux dont le luminaire peut être « à définir avec le client » (hors boîte d'encastrement DCL, qui reste chiffrée).
const POINTS_LUMINEUX_A_DEFINIR = ["point_lumineux", "applique", "point_lumineux_saillie", "applique_saillie", "spot", "spot_etanche", "applique_exterieure", "point_lumineux_exterieur"];
export const estPointLumineuxADefinir = (sousCategorie: string): boolean => POINTS_LUMINEUX_A_DEFINIR.includes(sousCategorie);

export const PSEUDO_TABLEAU = "Tableau électrique";
// Besoin appartenant au poste « Tableau électrique » (disjoncteurs, différentiels, goulottes de montage) — la page du
// pré-devis le retire ou le garde selon la réponse à l'alerte « intégrer le tableau au devis ? ».
export const estPieceTableau = (piece: string): boolean => piece === PSEUDO_TABLEAU;
const pseudoCommun = (niveauNom: string) => `Commun — ${niveauNom}`;
// Pseudo-pièce séparée pour la distance verticale configurée (point d'arrivée des gaines
// -> tableau) — jamais mélangée avec pseudoCommun (boîtes de dérivation, tronçons de
// câble tombant hors de toute pièce dessinée), qui elle EST sensible à la position du
// tableau. Les deux changeant pour des raisons différentes, les garder séparées évite
// qu'un total combiné donne l'impression que la distance configurée elle-même varie
// quand on déplace le tableau sur le plan.
const pseudoLiaisonVerticale = (niveauNom: string) => `Liaison verticale (configurée) — ${niveauNom}`;

// ─── OUTILS GÉOMÉTRIQUES ────────────────────────────────────────────────────

function estCommandeType(t?: AppareillageType): boolean {
  return estCommande(t); // simples ET doubles
}

// Le détecteur de mouvement intérieur (type interrupteur à détection) s'encastre comme un mécanisme : boîte + plaque.
// L'appareillage extérieur (prise, interrupteur, détecteur, applique) est étanche et posé EN SAILLIE : ni boîte ni plaque.
const TYPES_ENCASTRABLES: AppareillageType[] = ["prise", "prise_commandee", "interrupteur", "va_et_vient", "telerupteur", "interrupteur_double", "va_et_vient_double", "telerupteur_double", "detecteur_mouvement", "rj45", "prise_tv", "prise_dediee", "prise_irve",
  // Sorties dédiées d'un appareil (four, plaque de cuisson, lave-linge…) : encastrées comme un mécanisme → boîte + plaque
  // (sortie de câble / prise 20 A). Exclus : borne IRVE (wallbox fixée au mur), VMC, alarme, piscine, chauffage, volet roulant.
  "four", "plaque", "lave_linge", "lave_vaisselle", "seche_linge", "chauffe_eau", "congelateur", "clim", "seche_serviette"];

const LABEL_POSTES = (n: number) => n === 1 ? "simple" : n === 2 ? "double" : n === 3 ? "triple" : "quadruple";

// Regroupe des points en clusters d'au plus `maxParGroupe`, glouton, à `seuilM` près.
function grouperParProximite(points: { id: number; x: number; y: number }[], seuilM: number, maxParGroupe: number): number[][] {
  const restants = [...points];
  const groupes: number[][] = [];
  while (restants.length > 0) {
    const base = restants.shift()!;
    const groupe = [base.id];
    for (let i = restants.length - 1; i >= 0 && groupe.length < maxParGroupe; i--) {
      if (distance(base, restants[i]) <= seuilM) { groupe.push(restants[i].id); restants.splice(i, 1); }
    }
    groupes.push(groupe);
  }
  return groupes;
}

// Libellé du circuit tel qu'il apparaît dans le tableau_config après un "Pousser vers le
// tableau" — reproduit exactement la résolution faite à cet endroit (page.tsx du plan) :
// un circuit manuel garde le nom de son CircuitManuel, un circuit automatique est
// éventuellement renommé via Niveau.nomsCircuits.
function resoudreLabelCircuit(b: { label: string; manuelId?: number }, niveau: Niveau): string {
  if (b.manuelId != null) return b.label;
  return niveau.nomsCircuits?.[b.label] ?? b.label;
}

interface IndexTableau {
  parLabel: Map<string, TableauBreaker>;
  disjoncteurs: TableauBreaker[]; // tout appareil qui n'est PAS un différentiel, où qu'il soit dans la rangée
  differentiels: TableauBreaker[]; // tout interrupteur différentiel (BREAKER_TYPES[type].isDiff), où qu'il soit
  nbRangees: number;               // rangées portant au moins un appareil (une goulotte de montage chacune)
  sectionneurs: TableauBreaker[];  // coupures générales (interrupteurs-sectionneurs)
  prisesModulaires: number;        // prises 16 A modulaires posées sur le rail
  coffretCommunication: boolean;   // un coffret de communication (case annexe multimédia) existe dans le tableau
  emplacementsLibres: number;      // emplacements de disjoncteurs vides dans les rangées équipées (à garnir d'obturateurs)
  parafoudres: number;             // parafoudres posés (circuit « parafoudre »)
}

// Le tableau est lu SANS rien perdre : un appareil est un différentiel d'après son TYPE (diff-AC / diff-A / diff-F),
// jamais d'après sa position — un différentiel posé hors du slot 0 ou un disjoncteur glissé dans le slot 0 ne doivent
// ni disparaître du devis ni être chiffrés sous le mauvais article.
function indexerTableau(rows: BreakerRow[]): IndexTableau {
  const parLabel = new Map<string, TableauBreaker>();
  const disjoncteurs: TableauBreaker[] = [];
  const differentiels: TableauBreaker[] = [];
  const sectionneurs: TableauBreaker[] = [];
  let prisesModulaires = 0, coffretCommunication = false, nbRangees = 0, emplacementsLibres = 0, parafoudres = 0;
  rows.forEach(row => {
    let rangeeUtilisee = false;
    if (row.kind === "multimedia") coffretCommunication = true;
    row.slots.forEach(b => {
      if (!b || typeof b.type !== "string") return;
      rangeeUtilisee = true;
      // Appareils modulaires qui ne sont pas des disjoncteurs : chiffrés à part (jamais comme « disjoncteur 16A »). Les ports RJ45 du coffret
      // ne s'ajoutent à rien : la prise RJ45 et son câble sont déjà chiffrés avec l'appareillage du plan.
      if (estAccessoireTableau(b)) { if (b.type === "sect") sectionneurs.push(b); else if (b.type === "prise-mod") prisesModulaires++; return; }
      if (BREAKER_TYPES[b.type]?.isDiff) { differentiels.push(b); return; }
      if (b.circuit === "parafoudre") parafoudres++;
      disjoncteurs.push(b);
      if (b.label) parLabel.set(b.label, b);
    });
    if (rangeeUtilisee) nbRangees++;
    if (rangeeUtilisee && row.kind !== "multimedia") emplacementsLibres += row.slots.slice(1).filter(c => !c).length;
  });
  return { parLabel, disjoncteurs, differentiels, nbRangees, sectionneurs, prisesModulaires, coffretCommunication, emplacementsLibres, parafoudres };
}

// ─── PASSE 1 — BESOINS BRUTS (géométrie + tableau, sans catalogue) ─────────

// Métrage d'UN circuit (information : ne s'ajoute à rien, les mêmes mètres sont déjà dans les besoins ci-dessus).
export interface LigneRecapCircuit { sousCategorie: string; label: string; quantite: number; unite: UniteBesoin }
export interface RecapCircuit {
  cle: string; nom: string; niveau: string;
  groupe: string;               // nom du poste en mode « par circuit » (sert à filtrer selon la sélection)
  nbAppareils: number;          // appareillages présents sur le circuit (affichage du pré-devis uniquement)
  lignes: LigneRecapCircuit[];
}
export type ModePreDevis = "piece" | "circuit";
// Pose ENCASTRÉE au choix du pré-devis : gaine ICTA + fils (défaut) ou gaine ICTA précâblée. La pose apparente reste toujours IRL + fils.
export type PoseEncastre = "icta_fils" | "precablee";
export const PREFIXE_CIRCUIT = "Circuit · ";
export const PREFIXE_HORS_CIRCUIT = "Hors circuit · ";

// mode "piece" : les besoins sont regroupés par pièce (câbles = répartis selon les pièces traversées).
// mode "circuit" : regroupés par CIRCUIT (un circuit de prises peut courir sur plusieurs pièces) — appareillage, boîtes et
// câbles d'un circuit forment un seul poste. Les longueurs de câble sont strictement les mêmes dans les deux modes.
export function calculerBesoinsBruts(niveaux: Niveau[], tableauRows: BreakerRow[], mode: ModePreDevis = "piece", poseEncastre: PoseEncastre = "icta_fils"): { besoins: LigneBesoin[]; alertes: string[]; recap: RecapCircuit[] } {
  const alertes: string[] = [];
  const recapParCircuit = new Map<string, RecapCircuit>();
  const noterCircuit = (niveau: Niveau, b: { id: number; label: string; manuelId?: number }, groupe: string, sousCategorie: string, label: string, quantite: number, unite: UniteBesoin) => {
    if (quantite <= 0) return;
    const cle = `${niveau.id}:${b.id}`;
    let r = recapParCircuit.get(cle);
    if (!r) { r = { cle, nom: resoudreLabelCircuit(b, niveau), niveau: niveau.nom || niveau.type, groupe, nbAppareils: niveau.pieces.reduce((n, pc) => n + pc.appareillages.filter(x => x.circuitId === b.id).length, 0), lignes: [] }; recapParCircuit.set(cle, r); }
    const l = r.lignes.find(x => x.sousCategorie === sousCategorie);
    if (l) l.quantite += quantite; else r.lignes.push({ sousCategorie, label, quantite, unite });
  };
  const cumul = new Map<string, LigneBesoin>(); // clé -> besoin (cumule les quantités)
  const ajouter = (cle: string, sousCategorie: string, label: string, piece: string, quantite: number, unite: UniteBesoin, quantiteFils?: number) => {
    if (quantite <= 0) return;
    const existant = cumul.get(cle);
    if (existant) {
      existant.quantite += quantite;
      if (quantiteFils != null) existant.quantiteFils = (existant.quantiteFils ?? 0) + quantiteFils;
      return;
    }
    cumul.set(cle, { cle, sousCategorie, label, piece, quantite, unite, ...(quantiteFils != null ? { quantiteFils } : {}) });
  };

  const maison: Maison = { niveaux };
  const resultat: ResultatGeneration = genererCircuits(maison);
  const indexTableau = indexerTableau(tableauRows);

  resultat.alertes.forEach(a => alertes.push(a)); // remonte aussi les alertes du plan (non raccordé, etc.)

  resultat.maison.niveaux.forEach(niveau => {
    // ─── Appareillages (mécanismes) et sorties dédiées, par pièce ──────────
    // Par pièce RÉELLE (voir piece-reelle.ts) : une prise posée dehors contre le mur des WC se compte à l'extérieur, pas aux WC.
    const reelles = appareillagesParPieceReelle(niveau);
    const breakersDuNiveauPd = breakersDuNiveau(resultat.breakers, niveau);
    const nomCircuit = (b: { label: string; manuelId?: number }) => `${PREFIXE_CIRCUIT}${resoudreLabelCircuit(b, niveau)} (${niveau.nom || niveau.type})`;
    const nomHorsCircuit = `${PREFIXE_HORS_CIRCUIT}${niveau.nom || niveau.type}`;
    const destDe = (a: AppareillagePlace, piece: Piece): { id: string; nom: string } => {
      if (mode === "circuit") {
        const b = a.circuitId != null ? breakersDuNiveauPd.find(x => x.id === a.circuitId) : undefined;
        const nom = b ? nomCircuit(b) : nomHorsCircuit;
        return { id: `c${niveau.id}:${b ? b.id : "hors"}`, nom };
      }
      return { id: String(piece.id), nom: piece.nom || "Pièce" };
    };
    reelles.pieces.forEach(({ piece, apps }) => {
      if (apps.length === 0) return;
      const clustersEncastrement: { id: number; x: number; y: number; groupeId?: number }[] = [];
      const destParId = new Map<number, { id: string; nom: string }>();
      const cleParApp = new Map<number, string>(); // clé du besoin « appareil » de chaque appareillage (pour les notes de plaque multiple)
      apps.forEach(a => destParId.set(a.id, destDe(a, piece)));
      // Pièce réelle + nom donné sur le plan, rattachés à N'IMPORTE QUEL besoin (appareil, boîte, plaque, boîtier DCL, câble) : affichage seul.
      const localiser = (cleBesoin: string, ...ids: number[]) => {
        const besoin = cumul.get(cleBesoin);
        if (!besoin) return;
        ids.forEach(id => { const x = apps.find(ap => ap.id === id); if (x) (besoin.appareils ??= []).push({ piece: piece.nom || "Pièce", nom: x.nom?.trim() || undefined }); });
      };
      apps.forEach(a => {
        const dest = destParId.get(a.id)!;
        if (a.dejaExistant) return; // déjà installé chez le client — jamais facturé, ni lui ni sa boîte
        const estCmd = estCommande(a.type);
        // Pose EN SAILLIE (boîtier apparent) : article « _saillie » propre au catalogue, ni boîte d'encastrement ni plaque (le boîtier est
        // dans l'article). Luminaires : le point lumineux / l'applique gardent leur luminaire mais prennent un boîtier DCL en saillie ; le
        // spot est remplacé par un spot en saillie.
        const sail = estSaillie(a);
        const suffixeSail = sail ? " en saillie" : "";
        const poserBesoin = (codeBase: string, label: string) => {
          const code = sail ? `${codeBase}_saillie` : codeBase;
          ajouter(`${code}@${dest.id}`, code, `${label}${suffixeSail}`, dest.nom, 1, "u"); cleParApp.set(a.id, `${code}@${dest.id}`);
        };
        if (estCmd && a.domotique && LABEL_APPAREILLAGE_DOMOTIQUE[a.type]) {
          const sousCat = `${a.type}_domotique`;
          ajouter(`${sousCat}@${dest.id}`, sousCat, LABEL_APPAREILLAGE_DOMOTIQUE[a.type], dest.nom, 1, "u"); cleParApp.set(a.id, `${sousCat}@${dest.id}`);
        } else if (cleCircuitDedie(a) === "irve") {
          // Tout point de recharge (prise renforcée IRVE, borne IRVE, prise dédiée « IRVE ») = « Prise renforcée IRVE »,
          // jamais une sortie de câble spécialisée générique.
          poserBesoin("prise_irve", LABEL_APPAREILLAGE.prise_irve);
        } else if (LABEL_APPAREILLAGE[a.type]) {
          if (sail && (a.type === "point_lumineux" || a.type === "applique")) {
            // Plafonnier / applique DCL EN SAILLIE : UN seul article (boîtier apparent compris), jamais luminaire + boîtier séparés.
            const code = `${a.type}_saillie`;
            ajouter(`${code}@${dest.id}`, code, a.type === "point_lumineux" ? "Plafonnier DCL en saillie" : "Applique DCL en saillie", dest.nom, 1, "u"); cleParApp.set(a.id, `${code}@${dest.id}`);
          } else poserBesoin(a.type, LABEL_APPAREILLAGE[a.type]);
        } else if (cleCircuitDedie(a) || a.type === "chauffage" || a.type === "volet_roulant") {
          poserBesoin("prise_specialisee", "Prise / sortie de câble spécialisée");
        }
        // Plafonnier DCL et applique DCL (encastrés ou en saillie) sont TOUJOURS des articles complets (boîtier compris) : aucune
        // ligne « boîte DCL » séparée.
        { // pièce et nom (donné sur le plan) de l'appareillage, pour s'y retrouver dans le pré-devis
          const cleApp = cleParApp.get(a.id);
          const besoinApp = cleApp ? cumul.get(cleApp) : undefined;
          if (besoinApp) (besoinApp.appareils ??= []).push({ piece: piece.nom || "Pièce", nom: a.nom?.trim() || undefined });
        }
        // Un spot s'encastre directement dans le plafond : aucune boîte DCL (contrairement au plafonnier / à l'applique).
        if (TYPES_ENCASTRABLES.includes(a.type) && !sail) clustersEncastrement.push({ id: a.id, x: a.x, y: a.y, groupeId: a.groupeId });
      });
      // Spot non étanche en pièce humide ou à l'extérieur : à vérifier (volumes 1 et 2 d'une salle de bains =
      // IPX4 mini, NF C 15-100). Une seule alerte par pièce, avec le nombre de spots concernés.
      if (piece.type === "sdb" || piece.type === "exterieur") {
        const nbSpotsNonEtanches = apps.filter(a => a.type === "spot" && !a.dejaExistant).length;
        if (nbSpotsNonEtanches > 0) {
          alertes.push(`Pré-devis : ${nbSpotsNonEtanches} spot${nbSpotsNonEtanches > 1 ? "s" : ""} non étanche${nbSpotsNonEtanches > 1 ? "s" : ""} dans « ${piece.nom || "Pièce"} » — admis seulement hors volumes de protection ; sinon choisir des spots étanches (IP44 mini). Correction : remplace-les par des spots étanches dans le plan (type « Spot étanche »).`);
        }
      }
      if (clustersEncastrement.length > 0) {
        // Postes d'une même plaque multiple : une boîte + une plaque pour tout le groupe, sinon
        // regroupement par proximité (≤ 20 cm, 4 postes max) comme avant. Le regroupement se fait toujours
        // par pièce réelle (une plaque est physique) ; en mode circuit, la boîte + plaque est rattachée au
        // circuit de son premier poste.
        // Un poste multiple (plaque double / triple / quadruple) peut mêler puissance, RJ45 et TV : une seule boîte + une seule
        // plaque pour le groupe, comptées dans le circuit du premier poste. Les autres circuits du groupe reçoivent une NOTE
        // sur la ligne de leur appareil (« boîte + plaque N postes comptées dans … ») pour que rien ne paraisse oublié.
        const parPlaque = new Map<number, { ids: number[]; dest: { id: string; nom: string } }>();
        const libres: { id: number; x: number; y: number }[] = [];
        clustersEncastrement.forEach(c => {
          if (c.groupeId != null) {
            const e = parPlaque.get(c.groupeId);
            if (e) e.ids.push(c.id); else parPlaque.set(c.groupeId, { ids: [c.id], dest: destParId.get(c.id)! });
          } else libres.push(c);
        });
        // Chaque boîte d'encastrement reçoit sa plaque de finition de même taille : un poste isolé
        // = 1 mécanisme + 1 boîte simple + 1 plaque simple ; double/triple/quadruple = idem à N postes.
        const parDestTaille = new Map<string, { dest: { id: string; nom: string }; taille: number; nb: number; ids: number[] }>();
        const compter = (t: number, dest: { id: string; nom: string }, ids: number[]) => {
          const k = `${dest.id}|${t}`;
          const e = parDestTaille.get(k);
          if (e) { e.nb++; e.ids.push(...ids); } else parDestTaille.set(k, { dest, taille: t, nb: 1, ids: [...ids] });
        };
        const noterGroupe = (ids: number[], taille: number, dest: { id: string; nom: string }) => {
          if (ids.length < 2) return;
          const suffixe = taille === 1 ? "poste" : "postes";
          ids.forEach(id => {
            const d = destParId.get(id);
            const cle = cleParApp.get(id);
            if (!d || !cle || d.id === dest.id) return;
            const besoin = cumul.get(cle);
            const note = `Boîte d'encastrement + plaque ${taille} ${suffixe} comptées dans « ${dest.nom} »`;
            if (besoin && !(besoin.note ?? "").includes(note)) besoin.note = besoin.note ? `${besoin.note} · ${note}` : note;
          });
        };
        parPlaque.forEach(({ ids, dest }) => { const t = Math.min(ids.length, MAX_POSTES_PLAQUE); compter(t, dest, ids); noterGroupe(ids, t, dest); });
        grouperParProximite(libres, 0.20, 4).forEach(g => { const dest = destParId.get(g[0])!; compter(g.length, dest, g); noterGroupe(g, g.length, dest); });
        parDestTaille.forEach(({ dest, taille, nb, ids }) => {
          const suffixe = taille === 1 ? "poste" : "postes";
          ajouter(`boite_encastrement_${taille}${suffixe}@${dest.id}`, `boite_encastrement_${taille}${suffixe}`,
            `Boîte d'encastrement ${LABEL_POSTES(taille)}`, dest.nom, nb, "u");
          const codePlaque = `plaque_${taille}${suffixe}`;
          ajouter(`${codePlaque}@${dest.id}`, codePlaque, `Plaque de finition ${LABEL_POSTES(taille)}`, dest.nom, nb, "u");
          localiser(`boite_encastrement_${taille}${suffixe}@${dest.id}`, ...ids);
          localiser(`${codePlaque}@${dest.id}`, ...ids);
        });
      }
    });

    // Ni tableau ni point d'arrivée des gaines sur ce niveau : pas de tracé, donc pas de
    // câbles/gaines/boîtes de dérivation calculables — seuls les appareillages ci-dessus
    // restent chiffrés. (Un niveau de la maison qui ne porte pas le tableau part de son
    // point d'arrivée des gaines ; une annexe part de son propre tableau.)
    const origineTrace = origineCircuits(niveau);
    if (!origineTrace) {
      if (niveau.pieces.some(p => p.appareillages.length > 0)) {
        alertes.push(niveau.type === "annexe"
          ? `Annexe "${niveau.nom}" : tableau non positionné sur le plan — câbles/gaines non calculés pour cette annexe. Correction : pose le tableau de l'annexe sur le plan (outil Tableau, niveau de l'annexe).`
          : `Niveau "${niveau.nom}" : point d'arrivée des gaines non positionné sur le plan (le tableau de la maison est sur un autre niveau) — câbles/gaines non calculés pour ce niveau. Correction : pose le point d'arrivée des gaines sur ce niveau (outil Tableau / gaine) ou indique la liaison verticale depuis le niveau du tableau.`);
      }
      return;
    }
    // ─── Câble de communication RJ45 : étoile depuis le tableau / coffret de communication ──────
    // Un câble par prise RJ45 (non « déjà existante »). Longueur RÉELLE : course horizontale « Manhattan » (le câble
    // suit les murs et les gaines, pas la ligne droite) + montée du coffret (à la hauteur du tableau) jusqu'à la
    // hauteur de gaine + descente jusqu'à la prise — même convention de course que les circuits de puissance.
    const origineVDI = niveau.tableauPos ?? origineTrace;
    const ctxVDI = creerContexteLongueurs(niveau);
    const hauteurPriseVDI = hauteurAncreFn(ctxVDI);
    reelles.pieces.forEach(({ piece, apps }) => {
      apps.forEach(a => {
        const dest = destDe(a, piece);
        if ((a.type !== "rj45" && a.type !== "prise_tv") || a.dejaExistant) return;
        const tv = a.type === "prise_tv";
        const horizontale = Math.abs(a.x - origineVDI.x) + Math.abs(a.y - origineVDI.y);
        const verticale = Math.abs(ctxVDI.hauteurGaine - ctxVDI.hauteurTableau) + Math.abs(ctxVDI.hauteurGaine - hauteurPriseVDI(String(a.id)));
        const bCF = a.circuitId != null ? breakersDuNiveauPd.find(x => x.id === a.circuitId) : undefined;
        if (bCF) noterCircuit(niveau, bCF, nomCircuit(bCF), tv ? "cable_coax" : "cable_rj45", tv ? "Câble coaxial TV" : "Câble RJ45 cat. 6", horizontale + verticale, "m");
        if (tv) ajouter(`cable_coax@${dest.id}`, "cable_coax", "Câble coaxial TV / antenne (étoile vers le coffret de communication)",
          dest.nom, horizontale + verticale, "m");
        else ajouter(`cable_rj45@${dest.id}`, "cable_rj45", "Câble RJ45 cat. 6 STP (étoile vers le coffret de communication)",
          dest.nom, horizontale + verticale, "m");
        { const b = cumul.get(`${tv ? "cable_coax" : "cable_rj45"}@${dest.id}`); if (b) (b.appareils ??= []).push({ piece: piece.nom || "Pièce", nom: a.nom?.trim() || undefined }); }
      });
    });

    // Origine utilisée pour MESURER les câbles visibles sur ce niveau (jamais pour le
    // tracé sur le plan, qui reste inchangé et part toujours du tableau réel) : si un
    // point d'arrivée des gaines est configuré, la distance géométrique visible (ex. point
    // d'arrivée -> première prise d'une pièce) commence là plutôt qu'au tableau. C'est un
    // tronçon DISTINCT de distanceArriveeGainesTableau (portion invisible tableau -> point
    // d'arrivée, voir plus bas) : les deux s'additionnent, aucun des deux ne remplace
    // l'autre. Sans point d'arrivée configuré : comportement inchangé, mesuré depuis le
    // tableau directement.
    const origineCalcul = origineTrace;
    const idToAppareillage = new Map<string, AppareillagePlace>();
    niveau.pieces.forEach(p => p.appareillages.forEach(a => idToAppareillage.set(String(a.id), a)));
    // Longueurs RÉELLES (horizontales + verticales) : mêmes hauteurs et même tracé que la vue 3D.
    const ctxLongueurs = creerContexteLongueurs(niveau);
    const hauteurAncre = hauteurAncreFn(ctxLongueurs);
    const pieceDeAppareil = indexPiecesAppareils(niveau);

    // ─── Boîtes de dérivation (une par circuit lumière qui en utilise) ─────
    const breakersNiveau = breakersDuNiveauPd;

    breakersNiveau.forEach(b => {
      // Circuit de communication (RJ45) : son câble est déjà chiffré plus haut (étoile vers le coffret) — le
      // recompter ici doublerait la ligne, et il n'a ni section de puissance ni disjoncteur au tableau.
      if (estCircuitSansDisjoncteur(b)) return;
      const points = niveau.pieces.flatMap(p => p.appareillages).filter(a => a.circuitId === b.id);
      {
        // Éclairage : boîte implicite si plusieurs lampes sans boîte posée ; tous circuits : les boîtes posées à la main.
        const lumieres = b.circuit === "lumiere" ? points.filter(a => estLumiere(a.type)) : [];
        const boitesExistantes = niveau.boitesDerivation?.[b.label] ?? [];
        const nbEtoile = boitesExistantes.filter(x => !x.surSegment).length;
        const nbBoites = (nbEtoile > 0 ? nbEtoile : (lumieres.length > 1 ? 1 : 0)) + (boitesExistantes.length - nbEtoile);
        if (nbBoites > 0) {
          noterCircuit(niveau, b, nomCircuit(b), "boite_derivation", "Boîte de dérivation", nbBoites, "u");
          if (mode === "circuit") ajouter(`boite_derivation@c${niveau.id}:${b.id}`, "boite_derivation", "Boîte de dérivation", nomCircuit(b), nbBoites, "u");
          else ajouter(`boite_derivation@${niveau.id}`, "boite_derivation", "Boîte de dérivation",
            pseudoCommun(niveau.nom || niveau.type), nbBoites, "u");
          // Toute dérivation (un câble qui se sépare en plusieurs) se fait dans une boîte, sur bornes à levier WAGO 221 : une pour la phase, une pour
          // le neutre, une pour la terre, dans chaque boîte — de 2, 3 ou 5 entrées selon le nombre de câbles qui arrivent dans la boîte
          // (221-412 / 221-413 / 221-415 ; au-delà de 5 câbles, on chaîne des 221-415).
          const segsBoites = segmentsPourCircuit(b, points, niveau, origineCalcul);
          const idsBoites = [
            ...boitesExistantes.map(x => `boite-${x.id}`),
            ...(nbEtoile === 0 && lumieres.length > 1 ? ["boite"] : []),
          ];
          const wagos: Record<"2" | "3" | "5", number> = { "2": 0, "3": 0, "5": 0 };
          idsBoites.forEach(idB => {
            const k = Math.max(2, segsBoites.filter(sg => sg.aId === idB || sg.bId === idB).length);
            if (k <= 2) wagos["2"] += 3; else if (k === 3) wagos["3"] += 3; else wagos["5"] += 3 * Math.ceil((k - 1) / 4);
          });
          const LIB_WAGO = { "2": "Borne WAGO 221-412 (2 conducteurs)", "3": "Borne WAGO 221-413 (3 conducteurs)", "5": "Borne WAGO 221-415 (5 conducteurs)" } as const;
          (["2", "3", "5"] as const).forEach(t => {
            if (wagos[t] <= 0) return;
            const code = `wago_221_${t}`;
            noterCircuit(niveau, b, nomCircuit(b), code, LIB_WAGO[t], wagos[t], "u");
            if (mode === "circuit") ajouter(`${code}@c${niveau.id}:${b.id}`, code, LIB_WAGO[t], nomCircuit(b), wagos[t], "u");
            else ajouter(`${code}@${niveau.id}`, code, LIB_WAGO[t], pseudoCommun(niveau.nom || niveau.type), wagos[t], "u");
          });
        }
      }

      // ─── Câbles / gaines / moulures pour ce circuit ──────────────────────
      // Circuit manuel "déjà existant" (CircuitManuel.nonRelieTableau) : jamais poussé
      // au tableau sur ce plan (protégé par l'installation en place) — on ne cherche donc
      // pas de correspondance côté tableau_config (ce serait une fausse alerte), et la
      // distance verticale vers le tableau ne s'applique pas non plus à lui.
      const manuelDuCircuit = b.manuelId != null ? (niveau.circuitsManuels ?? []).find(m => m.id === b.manuelId) : undefined;
      const nonRelie = !!manuelDuCircuit?.nonRelieTableau;
      let sectionCircuit = effectiveSection(b);
      if (!nonRelie) {
        const labelResolu = resoudreLabelCircuit(b, niveau);
        const breakerTableau = indexTableau.parLabel.get(labelResolu);
        if (!breakerTableau) {
          alertes.push(`Pré-devis : circuit "${labelResolu}" (${niveau.nom}) introuvable dans le tableau électrique — section par défaut (${effectiveSection(b)}mm²) utilisée, à vérifier. Correction : dans le plan, clique « Pousser vers le tableau » pour ajouter ce circuit au tableau, puis relance le pré-devis.`);
        }
        sectionCircuit = breakerTableau ? effectiveSection(breakerTableau) : effectiveSection(b);
      }

      const segments: SegmentCircuit[] = segmentsPourCircuit(b, points, niveau, origineCalcul);
      segments.forEach(seg => {
        if (seg.type === "domotique") return; // sans fil — aucun câble
        // Liaison de commande = navette, ou retour commande <-> lampe (1,5 mm²). L'alimentation boîte/tableau -> commande,
        // elle, est du câblage normal du circuit (même section que le reste), pas un « retour lampe ».
        const typeA = idToAppareillage.get(seg.aId)?.type, typeB = idToAppareillage.get(seg.bId)?.type;
        const estLampeType = (t?: AppareillageType) => estLumiere(t);
        const estLiaisonCommande = seg.type === "navette" || seg.type === "commande"
          || (estCommandeType(typeA) && (estLampeType(typeB) || estCommandeType(typeB)))
          || (estCommandeType(typeB) && estLampeType(typeA));
        const section = estLiaisonCommande ? "1.5" : sectionCircuit;
        // LONGUEUR RÉELLE : chaque jambe du tracé 3D (course horizontale ET montées / descentes), avec sa pose —
        // exactement ce que dessine la vue 3D (voir longueurs-circuits.ts).
        const { jambes } = tracerLiaison(ctxLongueurs, b, segments, seg, hauteurAncre);
        jambes.forEach(jambe => {
          const legLength = longueurJambe(jambe);
          if (legLength <= 0) return;
          const pose = jambe.pose;
          // Attribution à la pièce : point médian d'une course horizontale, pièce de l'appareillage pour une montée
          // à son extrémité — la longueur d'un même circuit se répartit ainsi entre les pièces qu'il traverse.
          const pieceTraversee = pieceDeJambe(jambe, seg, pieceDeAppareil, niveau.pieces);
          const nomPiece = mode === "circuit" ? nomCircuit(b) : (pieceTraversee?.nom || pseudoCommun(niveau.nom || niveau.type));

          // Métrage par circuit (information)
          const estAller = !estLiaisonCommande && estCommandeType(typeB) && !estCommandeType(typeA);
          noterCircuit(niveau, b, nomCircuit(b),
            estLiaisonCommande ? (seg.type === "navette" ? "navette" : seg.type === "commande" ? "aller_commande" : "retour_lampe") : estAller ? "aller_commande" : `cablage_${section}`,
            estLiaisonCommande ? (seg.type === "navette" ? `Navettes (câble ${nbConducteurs(seg)}G1.5)` : seg.type === "commande" ? `Commande boutons-poussoirs (câble ${nbConducteurs(seg)}G1.5)` : `Retour lampe (câble ${nbConducteurs(seg)}G1.5)`) : estAller ? `Aller vers commande (câble ${section} mm²)` : `Câble ${section} mm²`, legLength, "m");
          // Conducteurs réellement tirés dans la gaine : 3 (phase, neutre, terre) ; liaisons de commande / navette : leur composition exacte.
          const nbCond = estLiaisonCommande ? nbConducteurs(seg) : 3;
          const gaineLiaison = gaineRecommandee(Array(nbCond).fill(section), pose === "apparent" ? "IRL" : "ICTA");
          const diamGaine = gaineLiaison.gaine.replace(/\D/g, "");
          // STRICTEMENT 3 fils communs (phase, neutre, terre) = tout sauf navette / commande / retour lampe : seuls ces tronçons existent en
          // gaine précâblée. Dès que la liaison porte autre chose (navette, retour, commande), gaine ICTA + fils à câbler soi-même.
          const strict3 = !estLiaisonCommande;
          const precablee = pose !== "apparent" && poseEncastre === "precablee" && strict3;
          const aCabler = pose !== "apparent" && poseEncastre === "precablee" && !strict3;
          const sousCatGaine = pose === "apparent" ? `gaine_irl${diamGaine}` : precablee ? `gaine_precablee_3g${section}` : `gaine_icta${diamGaine}`;
          const labelGaine = pose === "apparent" ? `Gaine ${gaineLiaison.gaine} (pose apparente)` : precablee ? `Gaine ICTA précâblée 3G${section} (3 fils : phase, neutre, terre)` : aCabler ? `Gaine ${gaineLiaison.gaine} — à câbler (navettes / retours / commandes)` : `Gaine ${gaineLiaison.gaine}`;
          noterCircuit(niveau, b, nomCircuit(b), sousCatGaine, labelGaine, legLength, "m");

          // Câblage d'une liaison d'éclairage (composition exacte : couleurs-fils.ts → conducteursSegment) :
          //  · alimentation → commande : l'ALLER (phase), + neutre + terre qui poursuivent vers la lampe ;
          //  · navette entre deux va-et-vient : 2 fils navette par voie + neutre (ou retour) + terre — 4 conducteurs, 6 à 7 pour des doubles ;
          //  · commande → lampe : le RETOUR (phase commutée) + neutre + terre qui alimentent la lampe.
          // Le métrage reste chiffré au prix du câble de la section (la différence de nombre de conducteurs n'est pas valorisée).
          // Compter le retour et la navette comme un simple fil sous-estimait le métrage (neutre/terre d'une lampe alimentée
          // par sa commande, 2 navettes par liaison) : chaque tronçon est donc chiffré comme le câble d'alimentation.
          // Gaine précâblée : le câblage est DANS la gaine (un seul article) — ni fils ni câble à part.
          if (!precablee) {
            // Liaisons de commande (navette / commande / retour) : besoin de fils SÉPARÉS à part (jamais mélangé aux 3 fils communs).
            if (strict3) ajouter(`cablage_${section}@${nomPiece}`, `cablage_${section}`, LABEL_CABLAGE[section] ?? `Câblage ${section}mm²`, nomPiece, legLength, "m", legLength * nbCond);
            else ajouter(`cablagecmd_${section}@${nomPiece}`, `cablagecmd_${section}`, `Fils de liaison ${section}mm² — navettes / retours / commandes (à câbler dans la gaine)`, nomPiece, legLength, "m", legLength * nbCond);
          }
          ajouter(`${sousCatGaine}@${nomPiece}`, sousCatGaine, labelGaine, nomPiece, legLength, "m");
          if (aCabler) { const bg = cumul.get(`${sousCatGaine}@${nomPiece}`); if (bg) bg.note = "Tronçons de navette / retour / commande : pas de gaine précâblée, tu câbles toi-même (gaine + fils ci-dessous)."; }
        });
      });

      // Distance verticale "point d'arrivée des gaines → tableau" — ajoutée une fois PAR
      // CIRCUIT relié au tableau de ce niveau (jamais pour un circuit "déjà existant") :
      // chaque circuit qui emprunte cette liaison verticale a besoin de SES PROPRES
      // conducteurs sur toute cette distance, à sa section propre — ce n'est pas un tronçon
      // partagé qu'on ne compte qu'une fois pour tout le niveau. Elle reste indépendante et
      // s'ajoute TOUJOURS, même quand un point d'arrivée géométrique existe sur ce niveau :
      // origineCalcul (voir plus haut) mesure le trajet visible à partir du point d'arrivée
      // (ex. jusqu'à la première prise d'une pièce) ; cette distance verticale couvre la
      // portion, elle, invisible sur le plan (tableau → point d'arrivée) — les deux sont
      // deux tronçons réels et distincts du même circuit, jamais le même trajet compté deux
      // fois.
      // Une annexe a son propre tableau sur son niveau : pas de liaison verticale à ajouter.
      if (!nonRelie && niveau.type !== "annexe" && niveau.distanceArriveeGainesTableau != null && niveau.distanceArriveeGainesTableau > 0) {
        const d = niveau.distanceArriveeGainesTableau;
        const nomPiece = mode === "circuit" ? nomCircuit(b) : pseudoLiaisonVerticale(niveau.nom || niveau.type);
        // Liaison verticale tableau → point d'arrivée : toujours encastrée (gaine ICTA, ou ICTA précâblée au choix).
        const gaineInfo = gaineRecommandee([sectionCircuit, sectionCircuit, sectionCircuit], "ICTA");
        const chiffres = gaineInfo.gaine.replace(/\D/g, "");
        const precabV = poseEncastre === "precablee";
        const sousCatGaine = precabV ? `gaine_precablee_3g${sectionCircuit}` : `gaine_icta${chiffres}`;
        const labelGaineV = precabV ? `Gaine ICTA précâblée 3G${sectionCircuit}` : `Gaine ${gaineInfo.gaine}`;
        if (!precabV) {
          ajouter(`cablage_${sectionCircuit}@${nomPiece}`, `cablage_${sectionCircuit}`,
            LABEL_CABLAGE[sectionCircuit] ?? `Câblage ${sectionCircuit}mm²`, nomPiece, d, "m", d * 3);
        }
        ajouter(`${sousCatGaine}@${nomPiece}`, sousCatGaine, labelGaineV, nomPiece, d, "m");
        noterCircuit(niveau, b, nomCircuit(b), `cablage_${sectionCircuit}`, `Câble ${sectionCircuit} mm²`, d, "m");
        noterCircuit(niveau, b, nomCircuit(b), sousCatGaine, labelGaineV, d, "m");
      }
    });
  });

  // ─── Disjoncteurs et différentiels (tableau — une seule fois, pas par niveau) ─────
  const parCalibreDisjoncteur = new Map<number, number>();
  indexTableau.disjoncteurs.forEach(b => {
    parCalibreDisjoncteur.set(b.amperes, (parCalibreDisjoncteur.get(b.amperes) ?? 0) + 1);
  });
  parCalibreDisjoncteur.forEach((nb, amperes) => {
    ajouter(`disjoncteur_${amperes}A`, `disjoncteur_${amperes}A`, `Disjoncteur ${amperes}A`, PSEUDO_TABLEAU, nb, "u");
  });

  const parDifferentiel = new Map<string, number>();
  indexTableau.differentiels.forEach(b => {
    const dt = BREAKER_TYPES[b.type]?.diffType ?? "AC";
    const cle = `${b.amperes}A_${dt}`;
    parDifferentiel.set(cle, (parDifferentiel.get(cle) ?? 0) + 1);
  });
  parDifferentiel.forEach((nb, cle) => {
    ajouter(`differentiel_${cle}`, `differentiel_${cle}`, `Différentiel ${cle.replace("_", " ")}`, PSEUDO_TABLEAU, nb, "u");
  });

  // Coupure générale (par calibre), prises 16 A modulaires et coffret de communication (case annexe multimédia).
  const parSectionneur = new Map<number, number>();
  indexTableau.sectionneurs.forEach(b => parSectionneur.set(b.amperes, (parSectionneur.get(b.amperes) ?? 0) + 1));
  parSectionneur.forEach((nb, amperes) => ajouter(`interrupteur_sectionneur_${amperes}A`, `interrupteur_sectionneur_${amperes}A`, `Interrupteur-sectionneur ${amperes}A (coupure générale)`, PSEUDO_TABLEAU, nb, "u"));
  // ─── GTL : gaine technique du logement (poste « Tableau électrique », retiré si le tableau n'entre pas dans le devis) ──────────
  // NF C 15-100 : la GTL (60 cm × 25 cm mini, sol-plafond) réunit le disjoncteur d'abonné, le tableau de répartition et le coffret de
  // communication. Tout ce qui l'équipe est compté ici d'après le tableau enregistré et les prises RJ45 / TV du plan. Les quantités marquées
  // « forfait » (moulure, liaison d'abonné, liaison équipotentielle, visserie) sont des estimations à ajuster sur place.
  const nbRj45 = resultat.maison.niveaux.reduce((n, nv) => n + nv.pieces.reduce((m, pc) => m + pc.appareillages.filter(a => a.type === "rj45" && !a.dejaExistant).length, 0), 0);
  const nbTv = resultat.maison.niveaux.reduce((n, nv) => n + nv.pieces.reduce((m, pc) => m + pc.appareillages.filter(a => a.type === "prise_tv" && !a.dejaExistant).length, 0), 0);
  const nbR = indexTableau.nbRangees;
  const avecCommunication = indexTableau.coffretCommunication || nbRj45 > 0 || nbTv > 0;
  if (nbR > 0 || avecCommunication) {
    const g = (code: string, label: string, quantite: number, unite: UniteBesoin = "u") => ajouter(code, code, label, PSEUDO_TABLEAU, quantite, unite);
    g("kit_gtl", "Gaine technique logement GTL 60 × 25 cm (cloisons de séparation courants forts / faibles, panneau de fond)", 1);
    g("panneau_controle_gtl", "Panneau de contrôle GTL (support compteur et disjoncteur d'abonné)", 1);
    g("moulure_gtl", "Moulure GTL 2,5 m (passage des câbles : arrivée, départs, courants faibles) — forfait", 2 + (avecCommunication ? 1 : 0));
    g("boitier_derivation_gtl", "Boîtier de raccordement / dérivation de la GTL", 1);
    if (nbR > 0) {
      const quatre = Math.floor(nbR / 4), reste = nbR % 4;
      if (quatre > 0) g("coffret_tableau_4r", "Coffret de tableau 4 rangées de 13 modules (avec porte)", quatre);
      if (reste > 0) g(`coffret_tableau_${reste}r`, `Coffret de tableau ${reste} rangée${reste > 1 ? "s" : ""} de 13 modules (avec porte)`, 1);
      g("plastron_tableau", "Plastron de finition (1 par rangée)", nbR);
      g("peigne_tableau", "Peigne de distribution (1 par rangée)", nbR);
      g("bornier_terre_tableau", "Répartiteur / barrette de terre (1 par rangée)", nbR);
      g("bornier_neutre_tableau", "Répartiteur de neutre (1 par rangée)", nbR);
      if (indexTableau.emplacementsLibres > 0) g("obturateur_module", "Obturateur de module vide (réserve du tableau)", indexTableau.emplacementsLibres);
      g("liaison_abonne_10mm", "Câble 10 mm² liaison disjoncteur d'abonné → tableau (phase + neutre) — forfait", 6, "m");
      g("etiquettes_tableau", "Lot d'étiquettes de repérage des circuits", 1);
      if (indexTableau.parafoudres > 0) g("parafoudre_type2", "Parafoudre type 2 (cartouche débrochable)", indexTableau.parafoudres);
    }
    g("barrette_terre_principale", "Barrette de terre principale (coupure / mesure) et borne de terre de la GTL", 1);
    g("liaison_equipotentielle_6mm", "Conducteur vert/jaune 6 mm² de liaison équipotentielle principale — forfait", 10, "m");
    g("visserie_gtl", "Visserie, colliers, chevilles et gaine de liaison de la GTL (lot)", 1);
    if (avecCommunication) {
      g("coffret_communication", "Coffret de communication grade 3 (avec répartiteur RJ45 et alimentation)", 1);
      g("dti_rj45", "DTI — dispositif de terminaison intérieur RJ45", 1);
      g("repartiteur_tv", "Répartiteur TV (arrivée antenne / satellite)", 1);
      if (nbRj45 > 0) {
        g("bandeau_brassage_rj45", "Bandeau de brassage RJ45 cat. 6 STP 4 ports", Math.ceil(nbRj45 / 4));
        g("cordon_brassage_rj45", "Cordon de brassage RJ45 cat. 6 0,3 m", nbRj45);
      }
      g("support_box_gtl", "Support / tablette pour box et switch (espace attenant du coffret)", 1);
    }
    // Prise 16 A modulaire : celles posées sur le tableau ; le coffret de communication en exige au moins une (alimentation box / switch).
    g("prise_modulaire_16A", "Prise de courant modulaire 16A 2P+T (rail DIN)", Math.max(indexTableau.prisesModulaires, avecCommunication ? 1 : 0));
    alertes.push("Pré-devis : poste GTL — moulure, liaison d'abonné (6 m), liaison équipotentielle (10 m) et visserie sont des forfaits à ajuster selon la hauteur et la configuration réelles de la GTL.");
  }

  // Goulottes de montage du tableau : une par rangée équipée (principal + annexes), chiffrées avec les appareils.
  ajouter("goulotte_tableau", "goulotte_tableau", "Goulotte de montage du tableau (1 par rangée)", PSEUDO_TABLEAU, indexTableau.nbRangees, "u");

  return { besoins: Array.from(cumul.values()), alertes, recap: Array.from(recapParCircuit.values()) };
}

// ─── FOURNISSEURS ───────────────────────────────────────────────────────────

function champsFournisseurOption(o?: PrestationFournisseur | null): Pick<OptionArticle, "fournisseur_id" | "fournisseur_nom" | "prix_achat"> {
  if (!o) return { fournisseur_id: null, fournisseur_nom: null, prix_achat: null };
  return { fournisseur_id: o.id, fournisseur_nom: libelleOffre(o), prix_achat: o.prix_achat ?? null };
}

// Option re-tarifée chez un fournisseur donné (offre === null : retour à l'offre principale du
// produit). Tout le reste de l'option (quantités, bobines, gamme…) est conservé.
export function optionAvecOffre(opt: OptionArticle, p: Prestation, offre: PrestationFournisseur | null): OptionArticle {
  const o = offre ?? offrePrincipale(p.fournisseurs) ?? null;
  // La désignation suit la marque de l'offre quand le produit existe en plusieurs marques.
  // L'image suit aussi l'offre : chaque marque peut avoir la sienne.
  return { ...opt, nom: designationProduit(p, o), prix_unitaire: prixVenteOffre(p, o), image_url: imageOffre(p, o), ...champsFournisseurOption(o) };
}

// Article « au mètre » qui complète un reliquat de bobine : on cherche d'abord SON offre chez le
// même fournisseur que la bobine (même magasin = un seul passage), sinon son offre principale.
function offreCompagnon(auMetre: Prestation, fournisseurNom?: string | null): PrestationFournisseur | null {
  return offrePourFournisseur(auMetre, fournisseurNom) ?? offrePrincipale(auMetre.fournisseurs) ?? null;
}

// Prix de vente unitaire de l'article « au mètre » compagnon, pour les estimations de la page.
export function prixCompagnonAuMetre(auMetre: Prestation, fournisseurNom?: string | null): number {
  return prixVenteOffre(auMetre, offreCompagnon(auMetre, fournisseurNom));
}

// ─── PASSE 2 — APPARIEMENT CATALOGUE ────────────────────────────────────────

// Exporté — réutilisé tel quel par la page pour la main d'œuvre (sous_categorie
// "main_oeuvre"), qui suit exactement la même logique de gammes que les consommables.
export function optionsPourSousCategorie(sousCategorie: string, prestations: Prestation[]): OptionArticle[] {
  return optionsPourBesoin(sousCategorie, prestations);
}

function optionsPour(sousCategorie: string, prestations: Prestation[]): OptionArticle[] {
  const items = prestations.filter(p => p.actif !== false && aSousCategorie(p, sousCategorie));
  const gammes: Gamme[] = ["entree", "moyenne", "haut"];
  const versOption = (p: Prestation): OptionArticle => {
    // Par défaut : l'offre principale du produit (celle recopiée dans prestations.prix_unitaire).
    const o = offrePrincipale(p.fournisseurs);
    return {
      prestation_id: p.id, nom: designationProduit(p, o), prix_unitaire: prixVenteOffre(p, o), unite: p.unite,
      type_branche: p.type_branche, gamme: p.gamme ?? null, longueur_unitaire: p.longueur_unitaire && p.longueur_unitaire > 0 ? p.longueur_unitaire : null,
      quantiteMultiplicateur: 1, sousCategorieArticle: sousCategorie,
      image_url: imageOffre(p, o),
      ...champsFournisseurOption(o),
    };
  };
  const gammees = gammes.map(g => items.find(p => p.gamme === g)).filter((p): p is Prestation => !!p).map(versOption);
  if (gammees.length > 0) return gammees;
  // Compatibilité : aucun article "gammé" pour cette sous-catégorie — on propose le
  // premier article existant (sans gamme) comme option unique plutôt que de le signaler
  // à tort comme non identifié.
  const sansGamme = items.find(p => !p.gamme);
  return sansGamme ? [versOption(sansGamme)] : [];
}

// Pour un besoin "cablage_X" (tronçon d'alimentation principale — voir calculerBesoinsBruts) :
// combine les articles catalogue "cable_X" (câble tout-en-un, 1 unité = toute la longueur,
// multiplicateur ×1) ET "fil_X" (fils séparés, phase+neutre+terre comptés individuellement,
// ×3) en UNE seule liste d'options — Ben choisit librement l'un ou l'autre, jamais les deux
// à la fois. Pour tout autre type de besoin, comportement inchangé (options normales,
// multiplicateur ×1).
function optionsPourBesoin(sousCategorie: string, prestations: Prestation[], ratioFils = 3): OptionArticle[] {
  if (sousCategorie.startsWith("cablagecmd_")) {
    // Navettes / retours / commandes : fils séparés uniquement (tirés à la main dans la gaine).
    return optionsPour(`fil_${sousCategorie.slice("cablagecmd_".length)}`, prestations).map(o => ({ ...o, quantiteMultiplicateur: ratioFils }));
  }
  if (sousCategorie.startsWith("cablage_")) {
    const section = sousCategorie.slice("cablage_".length);
    const optsCable = optionsPour(`cable_${section}`, prestations).map(o => ({ ...o, quantiteMultiplicateur: 1 }));
    // Fils séparés : autant de mètres que de conducteurs à tirer (ratioFils = quantiteFils / quantite du besoin, 3 pour un circuit de prises).
    const optsFil = optionsPour(`fil_${section}`, prestations).map(o => ({ ...o, quantiteMultiplicateur: ratioFils }));
    return [...optsCable, ...optsFil];
  }
  const directes = optionsPour(sousCategorie, prestations);
  if (directes.length > 0 || sousCategorie !== "prise_irve") return directes;
  return optionsPriseIrveRepli(prestations);
}

// Repli « prise renforcée IRVE » : aucun article taggé prise_irve au catalogue. On propose alors, dans l'ordre,
// les articles existants qui SONT visiblement une prise de recharge (nom/description : IRVE, Green'Up, renforcée,
// recharge véhicule…) puis les sorties spécialisées (prise_specialisee). Le tag exact reste prioritaire ; ce repli
// évite un « non identifié » alors que l'article existe sous une autre sous-catégorie.
const RE_PRISE_IRVE = /\birve\b|green[\s'’-]?up|renforc|recharge|v[ée]hicule|\bev\b/i;
const RE_EXCLU_IRVE = /^(disjoncteur|diff|cable|fil|gaine|moulure|borne|boite|plaque|cablage|tableau|goulotte)/;
function optionsPriseIrveRepli(prestations: Prestation[]): OptionArticle[] {
  const actifs = prestations.filter(p => p.actif !== false && p.type_branche !== "service");
  const parNom = actifs.filter(p =>
    RE_PRISE_IRVE.test(`${p.nom ?? ""} ${p.description ?? ""}`)
    && !sousCategoriesDe(p).some(c => RE_EXCLU_IRVE.test(c))
    && /prise|socle|irve|green/i.test(`${p.nom ?? ""} ${sousCategoriesDe(p).join(" ")}`));
  if (parNom.length > 0) {
    const opts = optionsPour("prise_irve", parNom.map(p => ({ ...p, sous_categorie: "prise_irve" })));
    if (opts.length > 0) return opts;
  }
  return optionsPour("prise_specialisee", prestations);
}

export function apparierCatalogue(besoins: LigneBesoin[], prestations: Prestation[]): ResultatPreDevis {
  const parPiece: Record<string, BesoinApparie[]> = {};
  const nonIdentifies: BesoinApparie[] = [];

  besoins.forEach(besoin => {
    const options = optionsPourBesoin(besoin.sousCategorie, prestations, ratioFilsDe(besoin));
    const apparie: BesoinApparie = { ...besoin, options };
    (parPiece[besoin.piece] ??= []).push(apparie);
    if (options.length === 0) nonIdentifies.push(apparie);
  });

  return { parPiece, nonIdentifies, alertes: [] };
}

// ─── GÉNÉRATION DES LIGNES DE DEVIS (avec décomposition en bobines) ────────

export interface ChoixLigne {
  besoin: BesoinApparie;
  // Une seule des deux options ci-dessous, selon le choix de l'utilisateur pour ce besoin :
  optionCatalogue?: OptionArticle;         // une des besoin.options, ou un article cherché ailleurs au catalogue
  libre?: { nom: string; prixUnitaire: number; unite: string; typeBranche: "service" | "materiau" };
  // Besoin ni exclu ni résolu (aucun produit, aucun prix) : une ligne « à compléter » à 0 € est générée.
  aCompleter?: boolean;
  // Luminaire à choisir avec le client : ligne « À compléter — … (à définir avec le client) » à 0 € (bloque l'envoi du devis comme toute ligne à compléter).
  aDefinir?: boolean;
}

// Fournisseur de l'option → colonnes de la ligne de devis (photo du fournisseur retenu).
function champsLigneDepuisOption(o: Pick<OptionArticle, "fournisseur_id" | "fournisseur_nom" | "prix_achat"> & { image_url?: string | null }): Pick<DevisLigne, "fournisseur_id" | "fournisseur_nom" | "prix_achat" | "image_url"> {
  return { fournisseur_id: o.fournisseur_id ?? null, fournisseur_nom: o.fournisseur_nom ?? null, prix_achat: o.prix_achat ?? null, image_url: o.image_url ?? null };
}

// Un câble/gaine/moulure choisi en bobine (longueur_unitaire défini) est décomposé en
// bobines entières + un éventuel reliquat au mètre linéaire (autre article catalogue,
// même sous_categorie, sans longueur_unitaire) — sinon arrondi à une bobine de plus. La
// quantité RÉELLE à commander est besoin.quantite × option.quantiteMultiplicateur (1 pour
// un câble tout-en-un ou tout besoin non-"cablage_X", 3 pour des fils séparés) — jamais
// besoin.quantite brut, qui n'est que la longueur géométrique de base.
function genererLignesQuantiteBobinable(besoin: BesoinApparie, option: OptionArticle, prestations: Prestation[]): Omit<DevisLigne, "devis_id" | "ordre">[] {
  const quantiteReelle = besoin.quantite * (option.quantiteMultiplicateur ?? 1);
  if (!option.longueur_unitaire || option.longueur_unitaire <= 0) {
    return [{
      nom: option.nom, description: besoin.piece, quantite: Math.ceil(quantiteReelle),
      prix_unitaire: option.prix_unitaire, unite: option.unite, type_branche: option.type_branche,
      prestation_id: option.prestation_id, ...champsLigneDepuisOption(option),
    }];
  }
  const L = option.longueur_unitaire;
  // Le nom de la ligne précise désormais le conditionnement ET la longueur unitaire (voir
  // nomAvecConditionnement, src/lib/utils.ts, partagée avec le devis manuel) — sans ça, la
  // liste de courses n'affichait qu'une quantité en unités ("2×") sans dire si c'était 2
  // bobines de 25m, de 50m... impossible à utiliser pour l'achat en magasin.
  const sousCatArticle = option.sousCategorieArticle ?? besoin.sousCategorie;
  const nomLigne = nomAvecConditionnement(option.nom, L, sousCatArticle);
  const nbBobines = Math.floor(quantiteReelle / L + 1e-6);
  const reliquat = Math.round((quantiteReelle - nbBobines * L) * 100) / 100;
  const lignes: Omit<DevisLigne, "devis_id" | "ordre">[] = [];
  if (nbBobines > 0) {
    lignes.push({
      nom: nomLigne, description: besoin.piece, quantite: nbBobines,
      prix_unitaire: option.prix_unitaire, unite: option.unite, type_branche: option.type_branche,
      prestation_id: option.prestation_id, ...champsLigneDepuisOption(option),
    });
  }
  if (reliquat > 0.01) {
    const auMetre = prestations.find(p => aSousCategorie(p, sousCatArticle)
      && (p.gamme ?? null) === (option.gamme ?? null) && !p.longueur_unitaire);
    if (auMetre) {
      const offreAuMetre = offreCompagnon(auMetre, option.fournisseur_nom);
      lignes.push({
        nom: designationProduit(auMetre, offreAuMetre), description: besoin.piece, quantite: Math.ceil(reliquat),
        prix_unitaire: prixVenteOffre(auMetre, offreAuMetre), unite: auMetre.unite, type_branche: auMetre.type_branche,
        prestation_id: auMetre.id, ...champsLigneDepuisOption({ ...champsFournisseurOption(offreAuMetre), image_url: imageOffre(auMetre, offreAuMetre) }),
      });
    } else if (lignes.length > 0) {
      lignes[0].quantite += 1; // pas d'article "au mètre" pour ce reliquat — une bobine/rouleau de plus
    } else {
      lignes.push({
        nom: nomLigne, description: besoin.piece, quantite: 1,
        prix_unitaire: option.prix_unitaire, unite: option.unite, type_branche: option.type_branche,
        prestation_id: option.prestation_id, ...champsLigneDepuisOption(option),
      });
    }
  }
  return lignes;
}

// ─── Signatures de validation « OK devis » ──────────────────────────────────────────────────────────
// Quand un poste (circuit / pièce) est validé « devis OK », on mémorise la signature de ses besoins (clés, sous-catégories, quantités
// arrondies au dixième — longueurs de câble comprises). Si le plan change ensuite, la signature diffère : la validation tombe d'elle-même.
function hacher(texte: string): string {
  let h = 5381;
  for (let i = 0; i < texte.length; i++) h = ((h << 5) + h + texte.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
export function signaturePoste(besoins: { cle: string; sousCategorie: string; quantite: number }[]): string {
  return hacher(besoins.map(b => `${b.sousCategorie}|${(Math.round(b.quantite * 10) / 10).toFixed(1)}`).sort().join(";"));
}
export const CLE_OK_CABLES = "__cables__";
export const CLE_OK_GAINES = "__gaines__";
// Câblage chiffré toutes pièces confondues : signature des totaux par sous-catégorie, par famille (fils / câbles ; gaines / moulures).
export function signatureCablage(parPiece: Record<string, { cle: string; sousCategorie: string; quantite: number }[]>, famille: "cables" | "gaines"): string {
  const estGaine = (c: string) => c.startsWith("gaine_") || c === "moulure";
  const totaux = new Map<string, number>();
  Object.values(parPiece).flat().forEach(b => {
    if (!estBobinable(b.sousCategorie) || estGaine(b.sousCategorie) !== (famille === "gaines")) return;
    totaux.set(b.sousCategorie, (totaux.get(b.sousCategorie) ?? 0) + b.quantite);
  });
  return signaturePoste([...totaux.entries()].map(([sousCategorie, quantite]) => ({ cle: `AGREGE_${sousCategorie}`, sousCategorie, quantite })));
}
// Signatures actuelles de tous les postes + du câblage, à comparer à celles enregistrées avec la validation.
export function signaturesActuelles(parPiece: Record<string, { cle: string; sousCategorie: string; quantite: number }[]>): Record<string, string> {
  const sig: Record<string, string> = {};
  Object.entries(parPiece).forEach(([poste, besoins]) => { sig[poste] = signaturePoste(besoins); });
  sig[CLE_OK_CABLES] = signatureCablage(parPiece, "cables");
  sig[CLE_OK_GAINES] = signatureCablage(parPiece, "gaines");
  return sig;
}
// Postes validés dont le contenu a changé depuis la validation (signature enregistrée différente). Une validation sans signature
// (faite avant cette fonction) n'est pas touchée : sa signature est simplement enregistrée.
export function postesInvalides(actuelles: Record<string, string>, postesOk: Record<string, boolean>, postesSig: Record<string, string>): string[] {
  return Object.keys(postesOk).filter(k => postesOk[k] && postesSig[k] != null && actuelles[k] !== postesSig[k]);
}

export function estBobinable(sousCategorie: string): boolean {
  return sousCategorie.startsWith("cablage_") || sousCategorie.startsWith("cablagecmd_") || sousCategorie.startsWith("fil_")
    || sousCategorie.startsWith("gaine_") || sousCategorie === "moulure" || sousCategorie === "cable_rj45" || sousCategorie === "cable_coax";
}

// Poste du devis (devis_lignes.poste) porté par un besoin du pré-devis : chaque PIÈCE du plan devient un poste du
// devis (même nom), ainsi que les pseudo-pièces (« Tableau électrique », « Commun — RDC », liaison verticale).
// Les câbles / gaines / moulures, chiffrés une seule fois sur le métrage de toutes les pièces, forment un poste à part
// (le détail par pièce reste dans la description de la ligne).
export const POSTE_CABLAGE = "Câbles, gaines et moulures (toutes pièces)";
export const POSTE_MAIN_OEUVRE = "Main d'œuvre et frais";
export function posteDuBesoin(besoin: Pick<BesoinApparie, "cle" | "piece">): string {
  return besoin.cle.startsWith("AGREGE_") ? POSTE_CABLAGE : besoin.piece;
}

export function genererLignesDevis(choix: ChoixLigne[], prestations: Prestation[]): Omit<DevisLigne, "devis_id" | "ordre">[] {
  const lignes: Omit<DevisLigne, "devis_id" | "ordre">[] = [];
  choix.forEach(({ besoin, optionCatalogue, libre, aCompleter, aDefinir }) => {
    const debut = lignes.length;
    try {
      ajouterLignesBesoin(lignes, { besoin, optionCatalogue, libre, aCompleter, aDefinir }, prestations);
    } finally {
      const poste = posteDuBesoin(besoin);
      for (let k = debut; k < lignes.length; k++) lignes[k].poste = poste;
    }
  });
  return lignes;
}

function ajouterLignesBesoin(
  lignes: Omit<DevisLigne, "devis_id" | "ordre">[], { besoin, optionCatalogue, libre, aCompleter, aDefinir }: ChoixLigne, prestations: Prestation[],
): void {
  {
    if (aCompleter && !libre && !optionCatalogue) {
      lignes.push({
        nom: `${PREFIXE_A_COMPLETER}${besoin.label}${aDefinir ? " (à définir avec le client)" : ""}`, description: besoin.piece,
        quantite: besoin.unite === "m" ? Math.ceil(besoin.quantite) : besoin.quantite,
        prix_unitaire: 0, unite: besoin.unite === "m" ? "ml" : besoin.unite === "heure" ? "heure" : "u", type_branche: "materiau",
      });
      return;
    }
    if (libre) {
      lignes.push({
        nom: libre.nom, description: besoin.piece,
        quantite: besoin.unite === "m" ? Math.ceil(besoin.quantite) : besoin.quantite,
        prix_unitaire: libre.prixUnitaire, unite: libre.unite, type_branche: libre.typeBranche,
      });
      return;
    }
    if (!optionCatalogue) return; // besoin non résolu, ignoré (reste signalé côté UI)
    if (besoin.unite === "m" && estBobinable(besoin.sousCategorie)) {
      lignes.push(...genererLignesQuantiteBobinable(besoin, optionCatalogue, prestations));
    } else {
      lignes.push({
        nom: optionCatalogue.nom, description: besoin.piece,
        quantite: besoin.quantite * (optionCatalogue.quantiteMultiplicateur ?? 1),
        prix_unitaire: optionCatalogue.prix_unitaire, unite: optionCatalogue.unite,
        type_branche: optionCatalogue.type_branche, prestation_id: optionCatalogue.prestation_id,
        ...champsLigneDepuisOption(optionCatalogue),
      });
    }
  }
}

// Multiplicateur à appliquer à besoin.quantite pour un article choisi "manuellement"
// (recherche libre au catalogue, mode "autre" du pré-devis) — déduit de la sous_categorie
// réelle de l'article choisi : ×3 si Ben cherche et sélectionne un article "fil_X" pour un
// besoin "cablage_X", ×1 dans tous les autres cas.
export function multiplicateurPourArticle(besoinSousCategorie: string, articleSousCategorie: string | null | undefined, ratioFils = 3): number {
  if ((besoinSousCategorie.startsWith("cablage_") || besoinSousCategorie.startsWith("cablagecmd_")) && sousCategoriesDe(articleSousCategorie).some(c => c.startsWith("fil_"))) return ratioFils;
  return 1;
}

// Nombre moyen de fils à tirer pour un besoin de câblage (Σ longueur × conducteurs ÷ Σ longueur) ; 3 par défaut (phase + neutre + terre).
export function ratioFilsDe(besoin: { quantite: number; quantiteFils?: number }): number {
  return besoin.quantiteFils != null && besoin.quantite > 0 ? Math.round((besoin.quantiteFils / besoin.quantite) * 1000) / 1000 : 3;
}
// Même liste d'options, avec le multiplicateur des FILS séparés recalculé (besoins agrégés : ratio pondéré de tous les besoins réunis).
export function optionsAvecRatioFils(options: OptionArticle[], ratio: number): OptionArticle[] {
  return options.map(o => (sousCategoriesDe(o.sousCategorieArticle).some(c => c.startsWith("fil_")) ? { ...o, quantiteMultiplicateur: ratio } : o));
}

// Un besoin est réel (attribuable à une pièce du plan) si sa "piece" n'est pas une des
// pseudo-pièces PSEUDO_TABLEAU / pseudoCommun(niveau) — utilisé côté page pour la sélection
// pièce par pièce du pré-devis : ces pseudo-pièces (tableau, distance verticale, boîtes de
// dérivation communes à un niveau) doivent toujours rester incluses quelle que soit la
// sélection, car elles ne sont pas rattachables à une seule pièce réelle sans fausser le
// calcul des longueurs.
export function estPieceReelle(piece: string): boolean {
  return piece !== PSEUDO_TABLEAU && !piece.startsWith("Commun — ") && !piece.startsWith("Liaison verticale (configurée) — ");
}
