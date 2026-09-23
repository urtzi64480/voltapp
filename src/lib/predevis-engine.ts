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
//    les unes des autres, jusqu'à 4 postes par boîte.
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
  point_lumineux: "Point lumineux (DCL)", applique: "Sortie applique",
};
// Une commande (interrupteur/va-et-vient/télérupteur) posée en domotique (AppareillagePlace.
// domotique) est un produit différent d'un mécanisme filaire classique — module radio/wifi
// au lieu d'un mécanisme + câblage retour/navette — donc une sous_categorie dédiée, pour
// pouvoir lui associer un prix catalogue propre.
const LABEL_APPAREILLAGE_DOMOTIQUE: Record<string, string> = {
  interrupteur: "Interrupteur domotique", va_et_vient: "Va-et-vient domotique", telerupteur: "Bouton télérupteur domotique",
};

const PSEUDO_TABLEAU = "Tableau électrique";
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
        if (a.dejaExistant) return; // déjà installé chez le client — jamais facturé, ni lui ni sa boîte
        const estCommande = a.type === "interrupteur" || a.type === "va_et_vient" || a.type === "telerupteur";
        if (estCommande && a.domotique && LABEL_APPAREILLAGE_DOMOTIQUE[a.type]) {
          const sousCat = `${a.type}_domotique`;
          ajouter(`${sousCat}@${piece.id}`, sousCat, LABEL_APPAREILLAGE_DOMOTIQUE[a.type], piece.nom || "Pièce", 1, "u");
        } else if (LABEL_APPAREILLAGE[a.type]) {
          ajouter(`${a.type}@${piece.id}`, a.type, LABEL_APPAREILLAGE[a.type], piece.nom || "Pièce", 1, "u");
        } else if (CIRCUIT_DEDIE[a.type] || a.type === "chauffage") {
          ajouter(`prise_specialisee@${piece.id}`, "prise_specialisee", "Prise / sortie de câble spécialisée",
            piece.nom || "Pièce", 1, "u");
        }
        // Tout point lumineux (plafonnier, applique…) a sa propre boîte d'encastrement
        // DCL — jamais groupée avec les boîtes murales (prise/interrupteur), toujours 1
        // par point lumineux quel que soit le type.
        if (a.type === "point_lumineux" || a.type === "applique") {
          ajouter(`boite_encastrement_dcl@${piece.id}`, "boite_encastrement_dcl", "Boîte d'encastrement DCL",
            piece.nom || "Pièce", 1, "u");
        }
        if (TYPES_ENCASTRABLES.includes(a.type)) clustersEncastrement.push({ id: a.id, x: a.x, y: a.y });
      });
      if (clustersEncastrement.length > 0) {
        const groupes = grouperParProximite(clustersEncastrement, 0.20, 4);
        const parTaille = new Map<number, number>();
        groupes.forEach(g => parTaille.set(g.length, (parTaille.get(g.length) ?? 0) + 1));
        parTaille.forEach((nb, taille) => {
          const suffixe = taille === 1 ? "1poste" : taille === 2 ? "2postes" : taille === 3 ? "3postes" : "4postes";
          ajouter(`boite_encastrement_${suffixe}@${piece.id}`, `boite_encastrement_${suffixe}`,
            `Boîte d'encastrement ${taille === 1 ? "simple" : taille === 2 ? "double" : taille === 3 ? "triple" : "quadruple"}`,
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
    // Origine utilisée pour MESURER les câbles visibles sur ce niveau (jamais pour le
    // tracé sur le plan, qui reste inchangé et part toujours du tableau réel) : si un
    // point d'arrivée des gaines est configuré, la distance géométrique visible (ex. point
    // d'arrivée -> première prise d'une pièce) commence là plutôt qu'au tableau. C'est un
    // tronçon DISTINCT de distanceArriveeGainesTableau (portion invisible tableau -> point
    // d'arrivée, voir plus bas) : les deux s'additionnent, aucun des deux ne remplace
    // l'autre. Sans point d'arrivée configuré : comportement inchangé, mesuré depuis le
    // tableau directement.
    const origineCalcul = niveau.pointArriveeGaines ?? tableauPos;
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
          alertes.push(`Pré-devis : circuit "${labelResolu}" (${niveau.nom}) introuvable dans le tableau électrique — section par défaut (${effectiveSection(b)}mm²) utilisée, à vérifier.`);
        }
        sectionCircuit = breakerTableau ? effectiveSection(breakerTableau) : effectiveSection(b);
      }

      const segments: SegmentCircuit[] = segmentsPourCircuit(b, points, niveau, origineCalcul);
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

          if (estLiaisonCommande) {
            // Retour lampe (lampe -> 1er interrupteur/va-et-vient/télérupteur) et navette
            // (entre deux va-et-vient) sont deux produits distincts au catalogue — même
            // section (1.5mm²) mais souvent des couleurs de fil différentes en pratique,
            // d'où deux sous-catégories séparées plutôt qu'une seule "fil_1.5" générique.
            // Toujours 1 seul fil, jamais de câble tout-en-un possible ici.
            const sousCatCommande = seg.type === "navette" ? "navette" : "retour_lampe";
            const labelCommande = seg.type === "navette" ? "Navette (entre va-et-vient)" : "Retour lampe";
            ajouter(`${sousCatCommande}@${nomPiece}`, sousCatCommande, labelCommande, nomPiece, legLength, "m");
          } else {
            // Tronçon d'alimentation principale : besoin générique "cablage_X" — le choix
            // entre câble tout-en-un (cable_X, ×1) et fils séparés phase/neutre/terre
            // (fil_X, ×3) se fait au niveau des OPTIONS catalogue, voir optionsPourBesoin.
            // La quantité de base ici reste la longueur géométrique brute, sans
            // multiplicateur — celui-ci est appliqué par option au moment du chiffrage
            // (quantiteApprox / genererLignesDevis).
            ajouter(`cablage_${section}@${nomPiece}`, `cablage_${section}`, LABEL_CABLAGE[section] ?? `Câblage ${section}mm²`,
              nomPiece, legLength, "m");
          }

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
      if (!nonRelie && niveau.distanceArriveeGainesTableau != null && niveau.distanceArriveeGainesTableau > 0) {
        const d = niveau.distanceArriveeGainesTableau;
        const nomPiece = pseudoLiaisonVerticale(niveau.nom || niveau.type);
        ajouter(`cablage_${sectionCircuit}@${nomPiece}`, `cablage_${sectionCircuit}`,
          LABEL_CABLAGE[sectionCircuit] ?? `Câblage ${sectionCircuit}mm²`, nomPiece, d, "m");
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
  return optionsPourBesoin(sousCategorie, prestations);
}

function optionsPour(sousCategorie: string, prestations: Prestation[]): OptionArticle[] {
  const items = prestations.filter(p => p.actif !== false && p.sous_categorie === sousCategorie);
  const gammes: Gamme[] = ["entree", "moyenne", "haut"];
  const versOption = (p: Prestation): OptionArticle => ({
    prestation_id: p.id, nom: p.nom, prix_unitaire: p.prix_unitaire, unite: p.unite,
    type_branche: p.type_branche, gamme: p.gamme ?? null, longueur_unitaire: p.longueur_unitaire ?? null,
    quantiteMultiplicateur: 1, sousCategorieArticle: sousCategorie,
  });
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
function optionsPourBesoin(sousCategorie: string, prestations: Prestation[]): OptionArticle[] {
  if (sousCategorie.startsWith("cablage_")) {
    const section = sousCategorie.slice("cablage_".length);
    const optsCable = optionsPour(`cable_${section}`, prestations).map(o => ({ ...o, quantiteMultiplicateur: 1 }));
    const optsFil = optionsPour(`fil_${section}`, prestations).map(o => ({ ...o, quantiteMultiplicateur: 3 }));
    return [...optsCable, ...optsFil];
  }
  return optionsPour(sousCategorie, prestations);
}

export function apparierCatalogue(besoins: LigneBesoin[], prestations: Prestation[]): ResultatPreDevis {
  const parPiece: Record<string, BesoinApparie[]> = {};
  const nonIdentifies: BesoinApparie[] = [];

  besoins.forEach(besoin => {
    const options = optionsPourBesoin(besoin.sousCategorie, prestations);
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
      prestation_id: option.prestation_id,
    }];
  }
  const L = option.longueur_unitaire;
  const nbBobines = Math.floor(quantiteReelle / L + 1e-6);
  const reliquat = Math.round((quantiteReelle - nbBobines * L) * 100) / 100;
  const lignes: Omit<DevisLigne, "devis_id" | "ordre">[] = [];
  if (nbBobines > 0) {
    lignes.push({
      nom: option.nom, description: besoin.piece, quantite: nbBobines,
      prix_unitaire: option.prix_unitaire, unite: option.unite, type_branche: option.type_branche,
      prestation_id: option.prestation_id,
    });
  }
  if (reliquat > 0.01) {
    const auMetre = prestations.find(p => p.sous_categorie === (option.sousCategorieArticle ?? besoin.sousCategorie)
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

export function estBobinable(sousCategorie: string): boolean {
  return sousCategorie.startsWith("cablage_") || sousCategorie.startsWith("fil_")
    || sousCategorie.startsWith("gaine_irl") || sousCategorie === "moulure";
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
        nom: optionCatalogue.nom, description: besoin.piece,
        quantite: besoin.quantite * (optionCatalogue.quantiteMultiplicateur ?? 1),
        prix_unitaire: optionCatalogue.prix_unitaire, unite: optionCatalogue.unite,
        type_branche: optionCatalogue.type_branche, prestation_id: optionCatalogue.prestation_id,
      });
    }
  });
  return lignes;
}

// Multiplicateur à appliquer à besoin.quantite pour un article choisi "manuellement"
// (recherche libre au catalogue, mode "autre" du pré-devis) — déduit de la sous_categorie
// réelle de l'article choisi : ×3 si Ben cherche et sélectionne un article "fil_X" pour un
// besoin "cablage_X", ×1 dans tous les autres cas.
export function multiplicateurPourArticle(besoinSousCategorie: string, articleSousCategorie: string | null | undefined): number {
  if (besoinSousCategorie.startsWith("cablage_") && articleSousCategorie?.startsWith("fil_")) return 3;
  return 1;
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
