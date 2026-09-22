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
//  - Chaque tronçon géométrique (segment ou sous-segment entre deux coudes) est compté
//    comme UN câble (pratique du câble multiconducteur en une passe), jamais comme
//    plusieurs conducteurs séparés — cohérent avec un devis d'achat de câble en mètres.
//  - Un tronçon reliant une lampe à sa commande (interrupteur/va-et-vient/télérupteur),
//    ou une liaison "navette" entre deux va-et-vient, est toujours en 1.5mm² (retour/
//    navette), quelle que soit la section du reste du circuit.
//  - Un tronçon "domotique" (AppareillagePlace.domotique) ne consomme aucun câble.
//  - La pose (encastré/apparent) d'un tronçon suit le LiaisonWaypoint.poseType du coude
//    qui le termine ; par défaut (aucun coude) : encastré.
//  - Un mètre de câble encastré nécessite un mètre de gaine assortie (calibrée via
//    gaineRecommandee, comme le fait déjà le module Tableau) ; un mètre de câble apparent
//    nécessite un mètre de moulure (article générique, non calibré).
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
//    les unes des autres, jusqu'à 3 postes par boîte.
//  - Les appareils "dédiés" (four, plaque, lave-linge…, y compris chauffage) ne sont
//    jamais chiffrés en tant qu'appareil — uniquement leur prise/sortie de câble
//    spécialisée (sous_categorie "prise_specialisee").

import {
  Maison, Niveau, Piece, Point, AppareillagePlace, AppareillageType,
  distance, trouverPiece, cleSegmentLiaison, cheminSegment, SegmentCircuit,
} from "./maison-types";
import {
  genererCircuits, segmentsPourCircuit, ResultatGeneration, CIRCUIT_DEDIE,
} from "./maison-engine";
import {
  Breaker as TableauBreaker, BreakerRow, BREAKER_TYPES, CIRCUITS,
  effectiveSection, gaineRecommandee, uid,
} from "./electrical-constants";
import { Prestation, Gamme, DevisLigne } from "@/types";

// ─── TYPES DE BESOIN ────────────────────────────────────────────────────────

export type UniteBesoin = "m" | "u" | "heure";

export interface LigneBesoin {
  cle: string;            // identifiant stable (ex: "cable_2.5@RDC")
  sousCategorie: string;  // sous_categorie catalogue recherchée
  label: string;          // libellé humain (ex: "Câble 2.5mm²")
  piece: string;          // pièce (nom réel) ou pseudo-pièce ("Tableau électrique", "Commun — RDC")
  quantite: number;       // en unite
  unite: UniteBesoin;
}

export interface OptionArticle {
  prestation_id: string;
  nom: string;
  prix_unitaire: number;
  unite: string;
  type_branche: "service" | "materiau";
  gamme: Gamme | null;
  longueur_unitaire: number | null;
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

const LABEL_SECTION: Record<string, string> = {
  "1.5": "Câble 1.5mm²", "2.5": "Câble 2.5mm²", "4.0": "Câble 4mm²",
  "6.0": "Câble 6mm²", "10.0": "Câble 10mm²",
};
const LABEL_APPAREILLAGE: Record<string, string> = {
  prise: "Prise de courant", prise_commandee: "Prise commandée",
  interrupteur: "Interrupteur simple", va_et_vient: "Va-et-vient", telerupteur: "Bouton télérupteur",
  point_lumineux: "Point lumineux (DCL)", applique: "Sortie applique",
};

const PSEUDO_TABLEAU = "Tableau électrique";
const pseudoCommun = (niveauNom: string) => `Commun — ${niveauNom}`;

// ─── OUTILS GÉOMÉTRIQUES ────────────────────────────────────────────────────

function estCommandeType(t?: AppareillageType): boolean {
  return t === "interrupteur" || t === "va_et_vient" || t === "telerupteur";
}

const TYPES_ENCASTRABLES: AppareillageType[] = ["prise", "prise_commandee", "interrupteur", "va_et_vient", "telerupteur"];

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
  disjoncteurs: TableauBreaker[]; // hors différentiels (slot 0 de chaque rangée)
  differentiels: TableauBreaker[]; // slot 0 de chaque rangée
}

function indexerTableau(rows: BreakerRow[]): IndexTableau {
  const parLabel = new Map<string, TableauBreaker>();
  const disjoncteurs: TableauBreaker[] = [];
  const differentiels: TableauBreaker[] = [];
  rows.forEach(row => {
    row.slots.forEach((b, i) => {
      if (!b || typeof b.type !== "string") return;
      if (i === 0) { differentiels.push(b); return; }
      disjoncteurs.push(b);
      if (b.label) parLabel.set(b.label, b);
    });
  });
  return { parLabel, disjoncteurs, differentiels };
}

// ─── PASSE 1 — BESOINS BRUTS (géométrie + tableau, sans catalogue) ─────────

export function calculerBesoinsBruts(niveaux: Niveau[], tableauRows: BreakerRow[]): { besoins: LigneBesoin[]; alertes: string[] } {
  const alertes: string[] = [];
  const cumul = new Map<string, LigneBesoin>(); // clé -> besoin (cumule les quantités)
  const ajouter = (cle: string, sousCategorie: string, label: string, piece: string, quantite: number, unite: UniteBesoin) => {
    if (quantite <= 0) return;
    const existant = cumul.get(cle);
    if (existant) { existant.quantite += quantite; return; }
    cumul.set(cle, { cle, sousCategorie, label, piece, quantite, unite });
  };

  const maison: Maison = { niveaux };
  const resultat: ResultatGeneration = genererCircuits(maison);
  const indexTableau = indexerTableau(tableauRows);

  resultat.alertes.forEach(a => alertes.push(a)); // remonte aussi les alertes du plan (non raccordé, etc.)

  resultat.maison.niveaux.forEach(niveau => {
    // ─── Appareillages (mécanismes) et sorties dédiées, par pièce ──────────
    niveau.pieces.forEach(piece => {
      const clustersEncastrement: { id: number; x: number; y: number }[] = [];
      piece.appareillages.forEach(a => {
        if (LABEL_APPAREILLAGE[a.type]) {
          ajouter(`${a.type}@${piece.id}`, a.type, LABEL_APPAREILLAGE[a.type], piece.nom || "Pièce", 1, "u");
        } else if (CIRCUIT_DEDIE[a.type] || a.type === "chauffage") {
          ajouter(`prise_specialisee@${piece.id}`, "prise_specialisee", "Prise / sortie de câble spécialisée",
            piece.nom || "Pièce", 1, "u");
        }
        if (TYPES_ENCASTRABLES.includes(a.type)) clustersEncastrement.push({ id: a.id, x: a.x, y: a.y });
      });
      if (clustersEncastrement.length > 0) {
        const groupes = grouperParProximite(clustersEncastrement, 0.20, 3);
        const parTaille = new Map<number, number>();
        groupes.forEach(g => parTaille.set(g.length, (parTaille.get(g.length) ?? 0) + 1));
        parTaille.forEach((nb, taille) => {
          const suffixe = taille === 1 ? "1poste" : taille === 2 ? "2postes" : "3postes";
          ajouter(`boite_encastrement_${suffixe}@${piece.id}`, `boite_encastrement_${suffixe}`,
            `Boîte d'encastrement ${taille === 1 ? "simple" : taille === 2 ? "double" : "triple"}`,
            piece.nom || "Pièce", nb, "u");
        });
      }
    });

    // Pas de tableau positionné sur ce niveau : pas de tracé, donc pas de câbles/gaines/
    // boîtes de dérivation calculables — seuls les appareillages ci-dessus restent chiffrés.
    if (!niveau.tableauPos) {
      if (niveau.pieces.some(p => p.appareillages.length > 0)) {
        alertes.push(`Niveau "${niveau.nom}" : tableau non positionné sur le plan — câbles/gaines non calculés pour ce niveau.`);
      }
      return;
    }
    const tableauPos = niveau.tableauPos;
    const idToAppareillage = new Map<string, AppareillagePlace>();
    niveau.pieces.forEach(p => p.appareillages.forEach(a => idToAppareillage.set(String(a.id), a)));

    // ─── Boîtes de dérivation (une par circuit lumière qui en utilise) ─────
    const nomsPiecesNiveau = new Set(niveau.pieces.map(p => p.nom));
    const breakersNiveau = resultat.breakers.filter(b => b.pieces.some(pc => nomsPiecesNiveau.has(pc.nom)));

    breakersNiveau.forEach(b => {
      const points = niveau.pieces.flatMap(p => p.appareillages).filter(a => a.circuitId === b.id);
      if (b.circuit === "lumiere") {
        const lumieres = points.filter(a => a.type === "point_lumineux" || a.type === "applique");
        const boitesExistantes = niveau.boitesDerivation?.[b.label] ?? [];
        const nbBoites = boitesExistantes.length > 0 ? boitesExistantes.length : (lumieres.length > 1 ? 1 : 0);
        if (nbBoites > 0) ajouter(`boite_derivation@${niveau.id}`, "boite_derivation", "Boîte de dérivation",
          pseudoCommun(niveau.nom || niveau.type), nbBoites, "u");
      }

      // ─── Câbles / gaines / moulures pour ce circuit ──────────────────────
      const labelResolu = resoudreLabelCircuit(b, niveau);
      const breakerTableau = indexTableau.parLabel.get(labelResolu);
      if (!breakerTableau) {
        alertes.push(`Pré-devis : circuit "${labelResolu}" (${niveau.nom}) introuvable dans le tableau électrique — section par défaut (${effectiveSection(b)}mm²) utilisée, à vérifier.`);
      }
      const sectionCircuit = breakerTableau ? effectiveSection(breakerTableau) : effectiveSection(b);

      const segments: SegmentCircuit[] = segmentsPourCircuit(b, points, niveau, tableauPos);
      segments.forEach(seg => {
        if (seg.type === "domotique") return; // sans fil — aucun câble
        const estLiaisonCommande = seg.type === "navette"
          || estCommandeType(idToAppareillage.get(seg.aId)?.type)
          || estCommandeType(idToAppareillage.get(seg.bId)?.type);
        const section = estLiaisonCommande ? "1.5" : sectionCircuit;
        const cle = cleSegmentLiaison(seg.aId, seg.bId);
        const coudes = niveau.liaisonWaypoints?.[cle] ?? [];
        const chemin = cheminSegment(seg, niveau.liaisonWaypoints);
        for (let j = 0; j < chemin.length - 1; j++) {
          const legLength = distance(chemin[j], chemin[j + 1]);
          if (legLength <= 0) continue;
          const pose = coudes[j]?.poseType ?? "encastre";
          // Attribution à la pièce : point médian du tronçon testé contre les polygones
          // des pièces du niveau — la longueur d'un même circuit se répartit ainsi
          // naturellement entre les pièces qu'il traverse.
          const milieu: Point = { x: (chemin[j].x + chemin[j + 1].x) / 2, y: (chemin[j].y + chemin[j + 1].y) / 2 };
          const pieceTraversee = trouverPiece(milieu, niveau.pieces);
          const nomPiece = pieceTraversee?.nom || pseudoCommun(niveau.nom || niveau.type);

          ajouter(`cable_${section}@${nomPiece}`, `cable_${section}`, LABEL_SECTION[section] ?? `Câble ${section}mm²`,
            nomPiece, legLength, "m");

          if (pose === "apparent") {
            ajouter(`moulure@${nomPiece}`, "moulure", "Moulure", nomPiece, legLength, "m");
          } else {
            const gaineInfo = gaineRecommandee([section, section, section]);
            const chiffres = gaineInfo.gaine.replace(/\D/g, "");
            const sousCatGaine = `gaine_irl${chiffres}`;
            ajouter(`${sousCatGaine}@${nomPiece}`, sousCatGaine, `Gaine ${gaineInfo.gaine}`, nomPiece, legLength, "m");
          }
        }
      });

      // Distance verticale "point d'arrivée des gaines → tableau" — ajoutée une fois par
      // circuit de ce niveau, à sa section propre, en pose encastrée (choix confirmé).
      if (niveau.distanceArriveeGainesTableau != null && niveau.distanceArriveeGainesTableau > 0) {
        const d = niveau.distanceArriveeGainesTableau;
        const nomPiece = pseudoCommun(niveau.nom || niveau.type);
        ajouter(`cable_${sectionCircuit}@${nomPiece}`, `cable_${sectionCircuit}`,
          LABEL_SECTION[sectionCircuit] ?? `Câble ${sectionCircuit}mm²`, nomPiece, d, "m");
        const gaineInfo = gaineRecommandee([sectionCircuit, sectionCircuit, sectionCircuit]);
        const chiffres = gaineInfo.gaine.replace(/\D/g, "");
        const sousCatGaine = `gaine_irl${chiffres}`;
        ajouter(`${sousCatGaine}@${nomPiece}`, sousCatGaine, `Gaine ${gaineInfo.gaine}`, nomPiece, d, "m");
      }
    });
  });

  // ─── Disjoncteurs et différentiels (tableau — une seule fois, pas par niveau) ─────
  const parCalibreDisjoncteur = new Map<number, number>();
  indexTableau.disjoncteurs.forEach(b => {
    if (BREAKER_TYPES[b.type]?.isDiff) return; // garde-fou (ne devrait pas arriver hors slot 0)
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

  return { besoins: Array.from(cumul.values()), alertes };
}

// ─── PASSE 2 — APPARIEMENT CATALOGUE ────────────────────────────────────────

// Exporté — réutilisé tel quel par la page pour la main d'œuvre (sous_categorie
// "main_oeuvre"), qui suit exactement la même logique de gammes que les consommables.
export function optionsPourSousCategorie(sousCategorie: string, prestations: Prestation[]): OptionArticle[] {
  return optionsPour(sousCategorie, prestations);
}

function optionsPour(sousCategorie: string, prestations: Prestation[]): OptionArticle[] {
  const items = prestations.filter(p => p.actif !== false && p.sous_categorie === sousCategorie);
  const gammes: Gamme[] = ["entree", "moyenne", "haut"];
  const versOption = (p: Prestation): OptionArticle => ({
    prestation_id: p.id, nom: p.nom, prix_unitaire: p.prix_unitaire, unite: p.unite,
    type_branche: p.type_branche, gamme: p.gamme ?? null, longueur_unitaire: p.longueur_unitaire ?? null,
  });
  const gammees = gammes.map(g => items.find(p => p.gamme === g)).filter((p): p is Prestation => !!p).map(versOption);
  if (gammees.length > 0) return gammees;
  // Compatibilité : aucun article "gammé" pour cette sous-catégorie — on propose le
  // premier article existant (sans gamme) comme option unique plutôt que de le signaler
  // à tort comme non identifié.
  const sansGamme = items.find(p => !p.gamme);
  return sansGamme ? [versOption(sansGamme)] : [];
}

export function apparierCatalogue(besoins: LigneBesoin[], prestations: Prestation[]): ResultatPreDevis {
  const parPiece: Record<string, BesoinApparie[]> = {};
  const nonIdentifies: BesoinApparie[] = [];

  besoins.forEach(besoin => {
    const options = optionsPour(besoin.sousCategorie, prestations);
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
}

// Un câble/gaine/moulure choisi en bobine (longueur_unitaire défini) est décomposé en
// bobines entières + un éventuel reliquat au mètre linéaire (autre article catalogue,
// même sous_categorie, sans longueur_unitaire) — sinon arrondi à une bobine de plus.
function genererLignesQuantiteBobinable(besoin: BesoinApparie, option: OptionArticle, prestations: Prestation[]): Omit<DevisLigne, "devis_id" | "ordre">[] {
  if (!option.longueur_unitaire || option.longueur_unitaire <= 0) {
    return [{
      nom: option.nom, description: besoin.piece, quantite: Math.ceil(besoin.quantite),
      prix_unitaire: option.prix_unitaire, unite: option.unite, type_branche: option.type_branche,
      prestation_id: option.prestation_id,
    }];
  }
  const L = option.longueur_unitaire;
  const nbBobines = Math.floor(besoin.quantite / L + 1e-6);
  const reliquat = Math.round((besoin.quantite - nbBobines * L) * 100) / 100;
  const lignes: Omit<DevisLigne, "devis_id" | "ordre">[] = [];
  if (nbBobines > 0) {
    lignes.push({
      nom: option.nom, description: besoin.piece, quantite: nbBobines,
      prix_unitaire: option.prix_unitaire, unite: option.unite, type_branche: option.type_branche,
      prestation_id: option.prestation_id,
    });
  }
  if (reliquat > 0.01) {
    const auMetre = prestations.find(p => p.sous_categorie === besoin.sousCategorie
      && (p.gamme ?? null) === (option.gamme ?? null) && !p.longueur_unitaire);
    if (auMetre) {
      lignes.push({
        nom: auMetre.nom, description: besoin.piece, quantite: Math.ceil(reliquat),
        prix_unitaire: auMetre.prix_unitaire, unite: auMetre.unite, type_branche: auMetre.type_branche,
        prestation_id: auMetre.id,
      });
    } else if (lignes.length > 0) {
      lignes[0].quantite += 1; // pas d'article "au mètre" pour ce reliquat — une bobine de plus
    } else {
      lignes.push({
        nom: option.nom, description: besoin.piece, quantite: 1,
        prix_unitaire: option.prix_unitaire, unite: option.unite, type_branche: option.type_branche,
        prestation_id: option.prestation_id,
      });
    }
  }
  return lignes;
}

function estBobinable(sousCategorie: string): boolean {
  return sousCategorie.startsWith("cable_") || sousCategorie.startsWith("gaine_irl") || sousCategorie === "moulure";
}

export function genererLignesDevis(choix: ChoixLigne[], prestations: Prestation[]): Omit<DevisLigne, "devis_id" | "ordre">[] {
  const lignes: Omit<DevisLigne, "devis_id" | "ordre">[] = [];
  choix.forEach(({ besoin, optionCatalogue, libre }) => {
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
        nom: optionCatalogue.nom, description: besoin.piece, quantite: besoin.quantite,
        prix_unitaire: optionCatalogue.prix_unitaire, unite: optionCatalogue.unite,
        type_branche: optionCatalogue.type_branche, prestation_id: optionCatalogue.prestation_id,
      });
    }
  });
  return lignes;
}
