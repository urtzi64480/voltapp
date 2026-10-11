// src/lib/suivi-realisation.ts
//
// SUIVI DE RÉALISATION D'UN PLAN DE CIRCUITS : décompose chaque circuit généré (maison-engine.ts) en éléments
// PHYSIQUES à poser et à raccorder sur le chantier — disjoncteur, boîtes de dérivation, points lumineux, commandes
// (interrupteur, va-et-vient, permutateur, télérupteur…), câbles à tirer (départ, alimentation des commandes, navettes,
// retours) — avec, pour chaque commande, un guide de branchement précis (bornes, fils, schéma).
//
// Module PUR (aucune dépendance à React ni à Supabase) : la persistance des coches est dans suivi-persistance.ts.
// Les circuits sont REGÉNÉRÉS ici à partir du plan enregistré (genererCircuits) : le suivi montre donc exactement ce que
// le plan produit, ce qui permet de vérifier que la génération est juste avant de tirer le moindre câble.
//
// Clés de coche (stables d'une génération à l'autre, jamais basées sur les id de disjoncteur qui changent à chaque calcul) :
//   d|niveau|type|ids-membres        disjoncteur du circuit (change si la composition du circuit change : à recocher)
//   a|id|pose · a|id|raccord         appareillage (point lumineux, commande, prise…) : posé / raccordé
//   b|niveau|noeud|pose · …|raccord  boîte de dérivation
//   l|niveau|départ>arrivée          câble tiré entre deux ancres du tracé
// Une coche fausse (cochée alors que l'élément a changé) est plus dangereuse qu'une coche perdue : en cas de doute la clé
// change, l'élément repasse « à faire ».

import {
  AppareillagePlace, AppareillageType, Niveau, Piece, Point, SegmentCircuit,
  estCommande, estCommandeDouble, baseCommande, estLumiere, estLumierePlafond,
  commandeCetteLumiere, trouverPiece, cleSegmentLiaison, origineCircuits,
} from "@/lib/maison-types";
import { Breaker, CIRCUITS, MAX_PAR_CIRCUIT, effectiveSection, gaineRecommandee, estCircuitSansDisjoncteur } from "@/lib/electrical-constants";
import {
  genererCircuits, controlerCircuits, construireColorMap, breakersDuNiveau, segmentsPourCircuit,
  ProblemeCircuit,
} from "@/lib/maison-engine";
import { appareillagesParPieceReelle } from "@/lib/piece-reelle";
import { PREFIXE_CIRCUIT } from "@/lib/predevis-engine";
import { conducteursSegment, nbConducteurs } from "@/lib/couleurs-fils";
import { migrerModeleMurs } from "@/lib/murs";
import { migrerBoitesDerivation, reamorcerCompteurId, dedupliquerIds } from "@/lib/maison-types";
import { hauteurAppareilM } from "@/lib/murs";
import { creerContexteLongueurs, hauteurAncreFn, tracerLiaison, longueurJambe, longueurCircuit } from "@/lib/longueurs-circuits";

// ─── TYPES ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface Etape { cle: string; libelle: string }

export type CategorieElement = "tableau" | "boite" | "lampe" | "commande" | "appareil" | "liaison";

export interface ElementSuivi {
  id: string;
  categorie: CategorieElement;
  titre: string;
  sousTitre?: string;      // pièce / position
  details: string[];       // description précise de ce qu'il faut mettre en place
  alertes: string[];       // points de vigilance propres à cet élément
  badges: string[];        // « 3G1,5 », « 7,4 m », « encastrée »…
  etapes: Etape[];         // cases à cocher ; vide = élément déjà existant (information seulement)
  existant?: boolean;
  guideIds?: string[];     // commandes : guides de câblage concernés
  ordre: number;           // tri à l'intérieur d'une catégorie
}

export type ModeCommande = "simple" | "va_et_vient" | "telerupteur" | "detecteur" | "domotique";
export type RoleMecanisme = "interrupteur" | "va_et_vient_entree" | "va_et_vient_sortie" | "permutateur" | "bouton_poussoir" | "detecteur" | "module";

export interface LigneBorne { borne: string; fil: string }
export interface MecanismeGuide {
  id: number;
  titre: string;           // « Va-et-vient (Séjour) »
  role: RoleMecanisme;
  roleLibelle: string;     // « Va-et-vient côté alimentation »
  position: number;        // 1..total, dans l'ordre depuis l'alimentation
  hauteurCm: number;
  repere?: string;         // position sur le plan (pour le retrouver)
  plaque?: string;         // « Plaque triple, poste 2/3 en partant de la gauche »
  bornes: LigneBorne[];
}

export type TypeSchema = "simple" | "va_et_vient" | "telerupteur" | "detecteur";
export interface GuideCommande {
  id: string;
  titre: string;
  mode: ModeCommande;
  lampes: string[];
  mecanismes: MecanismeGuide[];
  etapes: string[];        // pas à pas
  attention: string[];     // erreurs classiques à éviter
  alertes: string[];       // incohérences détectées dans le plan
  schema: { type: TypeSchema; nbPermutateurs: number; nbBoutons: number } | null;
}

export interface Caracteristique { libelle: string; valeur: string; alerte?: boolean }

export interface CircuitSuivi {
  cle: string;
  label: string;           // libellé généré (clé des réglages du plan)
  nom: string;             // nom affiché (renommage éventuel)
  niveauId: number;
  niveauNom: string;
  poste: string;           // nom du poste du pré-devis / devis en mode « par circuit » (pour comparer heures chiffrées et temps passé)
  couleur: string;
  icone: string;
  famille: string;         // « lumiere », « prise_16 »…
  estEclairage: boolean;
  caracteristiques: Caracteristique[];
  resume: string[];        // « 5 points lumineux », « 2 va-et-vient »…
  elements: ElementSuivi[];
  guides: GuideCommande[];
  alertes: string[];
  problemes: ProblemeCircuit[];
}

export interface SuiviPlan {
  circuits: CircuitSuivi[];
  alertesPlan: string[];                  // alertes de génération (genererCircuits)
  problemesHorsCircuit: ProblemeCircuit[]; // contrôles qui ne concernent aucun circuit affiché
  clesConnues: Set<string>;               // toutes les clés de coche valides pour ce plan
  avertissements: string[];               // ex. « tableau non placé sur tel niveau »
}

// ─── LIBELLÉS ────────────────────────────────────────────────────────────────────────────────────────────────

export const LABEL_APPAREIL: Record<AppareillageType, string> = {
  prise: "Prise de courant", prise_commandee: "Prise commandée",
  point_lumineux: "Point lumineux (plafond)", applique: "Applique murale", spot: "Spot encastré", spot_etanche: "Spot étanche (IP65)",
  interrupteur: "Interrupteur simple", va_et_vient: "Va-et-vient", telerupteur: "Bouton poussoir (télérupteur)",
  interrupteur_double: "Double interrupteur", va_et_vient_double: "Double va-et-vient", telerupteur_double: "Double bouton poussoir",
  four: "Four", plaque: "Plaque de cuisson", lave_linge: "Lave-linge", lave_vaisselle: "Lave-vaisselle", seche_linge: "Sèche-linge",
  chauffe_eau: "Chauffe-eau", chauffage: "Radiateur électrique", clim: "Climatisation", seche_serviette: "Sèche-serviette",
  congelateur: "Congélateur", irve: "Borne de recharge véhicule", piscine: "Piscine / pompe à chaleur", vmc: "VMC", alarme: "Alarme",
  volet_roulant: "Volet roulant", rj45: "Prise RJ45", prise_tv: "Prise TV / antenne", prise_dediee: "Prise dédiée", prise_exterieure: "Prise extérieure (IP44)",
  applique_exterieure: "Applique extérieure (IP44)", point_lumineux_exterieur: "Point lumineux extérieur (IP44)",
  interrupteur_exterieur: "Interrupteur extérieur (IP55)",
  detecteur_mouvement: "Détecteur de mouvement", detecteur_mouvement_exterieur: "Détecteur de mouvement extérieur (IP55)",
};

const NOM_PLAQUE: Record<number, string> = { 2: "double", 3: "triple", 4: "quadruple" };

const fmtM = (v: number): string => `${v.toFixed(1).replace(".", ",")} m`;
const fmtSection = (s: string): string => String(parseFloat(s)).replace(".", ",");
const pluriel = (n: number, un: string, plusieurs: string): string => `${n} ${n > 1 ? plusieurs : un}`;

// ─── CLÉS DE COCHE ───────────────────────────────────────────────────────────────────────────────────────────

const cleDisjoncteur = (niveauId: number, circuit: string, ids: number[]): string =>
  `d|${niveauId}|${circuit}|${[...ids].sort((a, b) => a - b).join(".")}`;
const cleAppareil = (id: number, etape: "pose" | "raccord"): string => `a|${id}|${etape}`;
const cleBoite = (niveauId: number, noeud: string, etape: "pose" | "raccord"): string => `b|${niveauId}|${noeud}|${etape}`;
const cleLiaisonCoche = (niveauId: number, a: string, b: string): string => `l|${niveauId}|${a}>${b}`;

// ─── CONTEXTE ────────────────────────────────────────────────────────────────────────────────────────────────

interface Entree { a: AppareillagePlace; piece: Piece; niveau: Niveau }
interface Contexte {
  parId: Map<string, Entree>;       // id d'appareillage (texte) → appareillage, pièce réelle, niveau
  numero: Map<number, number>;      // n° d'ordre dans la pièce quand plusieurs appareillages du même type s'y trouvent
  tous: Entree[];
}

function construireContexte(niveaux: Niveau[]): Contexte {
  const parId = new Map<string, Entree>();
  const numero = new Map<number, number>();
  const tous: Entree[] = [];
  niveaux.forEach(niveau => {
    const reelles = appareillagesParPieceReelle(niveau);
    niveau.pieces.forEach(p => p.appareillages.forEach(a => {
      const piece = reelles.vers.get(a.id) ?? p;
      const e = { a, piece, niveau };
      parId.set(String(a.id), e);
      tous.push(e);
    }));
    reelles.pieces.forEach(({ apps }) => {
      const parType = new Map<string, AppareillagePlace[]>();
      apps.forEach(a => { const l = parType.get(a.type) ?? []; l.push(a); parType.set(a.type, l); });
      parType.forEach(liste => {
        if (liste.length < 2) return;
        [...liste].sort((x, y) => x.id - y.id).forEach((a, i) => numero.set(a.id, i + 1));
      });
    });
  });
  return { parId, numero, tous };
}

function libelle(ctx: Contexte, a: AppareillagePlace): string {
  const base = LABEL_APPAREIL[a.type] ?? a.type;
  const nom = a.nom?.trim();
  if (nom) return `${base} « ${nom} »`;
  const n = ctx.numero.get(a.id);
  return n ? `${base} n°${n}` : base;
}
const nomPiece = (p: Piece): string => p.nom?.trim() || (p.type === "exterieur" ? "Extérieur" : "Pièce sans nom");
const libelleLong = (ctx: Contexte, a: AppareillagePlace): string => {
  const e = ctx.parId.get(String(a.id));
  return e ? `${libelle(ctx, a)} (${nomPiece(e.piece)})` : libelle(ctx, a);
};
const pieceNomDe = (ctx: Contexte, a: AppareillagePlace): string => { const e = ctx.parId.get(String(a.id)); return e ? nomPiece(e.piece) : ""; };
const cm = (a: AppareillagePlace): number => Math.round(hauteurAppareilM(a) * 100);
const reperePlan = (p: Point): string => `repère plan x ${p.x.toFixed(2).replace(".", ",")} m · y ${p.y.toFixed(2).replace(".", ",")} m`;

// Plaque (double / triple / quadruple) : postes de la même plaque, de gauche à droite vue de la pièce.
function infoPlaque(ctx: Contexte, a: AppareillagePlace): { court: string; detail: string } | null {
  if (a.groupeId == null) return null;
  const e = ctx.parId.get(String(a.id));
  if (!e) return null;
  const postes = e.niveau.pieces.flatMap(p => p.appareillages).filter(x => x.groupeId === a.groupeId)
    .sort((x, y) => (x.rangPlaque ?? 0) - (y.rangPlaque ?? 0));
  if (postes.length < 2) return null;
  const rang = postes.findIndex(x => x.id === a.id) + 1;
  const taille = NOM_PLAQUE[postes.length] ?? `${postes.length} postes`;
  return {
    court: `Plaque ${taille}, poste ${rang}/${postes.length} en partant de la gauche`,
    detail: `Plaque ${taille} (${postes.length} postes, de gauche à droite vue de la pièce) : ${postes.map((x, i) => `${i + 1}) ${libelle(ctx, x)}`).join(" · ")}`,
  };
}

// ─── ANALYSE DES COMMANDES D'ÉCLAIRAGE ───────────────────────────────────────────────────────────────────────

interface GroupeCommande {
  chaine: AppareillagePlace[];          // commandes filaires, dans l'ordre depuis l'alimentation (ou depuis la lampe si sens = "lampe")
  sens: "alimentation" | "lampe" | "inconnu";
  horsTrace: AppareillagePlace[];       // commandes filaires de la lampe absentes du tracé (autre niveau, tableau non placé…)
  domotiques: AppareillagePlace[];
  lampes: AppareillagePlace[];
  voies: Map<number, 1 | 2>;            // id de commande double → voie qui pilote ces lampes
  provenance: string;                   // d'où arrive la phase
}

function voieDe(c: AppareillagePlace, lampeId: number): 1 | 2 {
  return c.commandePourIds?.includes(lampeId) ? 1 : 2;
}

// Ordre des commandes d'UNE lampe, lu sur les segments réellement tracés (donc identique au plan).
function ordonnerChaine(lampe: AppareillagePlace, filaires: AppareillagePlace[], segments: SegmentCircuit[]):
  { chaine: AppareillagePlace[]; sens: "alimentation" | "lampe" | "inconnu"; premierId: string | null } {
  const parIdTexte = new Map(filaires.map(c => [String(c.id), c]));
  const L = String(lampe.id);
  const chaine: string[] = [];
  const vus = new Set<string>();

  const retour = segments.find(s => s.type !== "domotique" && s.bId === L && parIdTexte.has(s.aId));
  if (retour) {
    let cur = retour.aId;
    chaine.push(cur); vus.add(cur);
    for (;;) {
      const prec = segments.find(s => s.type !== "domotique" && s.bId === cur && parIdTexte.has(s.aId) && !vus.has(s.aId));
      if (!prec) break;
      chaine.unshift(prec.aId); vus.add(prec.aId); cur = prec.aId;
    }
    return { chaine: chaine.map(i => parIdTexte.get(i)!), sens: "alimentation", premierId: chaine[0] };
  }
  const depart = segments.find(s => s.type !== "domotique" && s.aId === L && parIdTexte.has(s.bId));
  if (depart) {
    let cur = depart.bId;
    chaine.push(cur); vus.add(cur);
    for (;;) {
      const suiv = segments.find(s => s.type !== "domotique" && s.aId === cur && parIdTexte.has(s.bId) && !vus.has(s.bId));
      if (!suiv) break;
      chaine.push(suiv.bId); vus.add(suiv.bId); cur = suiv.bId;
    }
    return { chaine: chaine.map(i => parIdTexte.get(i)!), sens: "lampe", premierId: chaine[0] };
  }
  return { chaine: [], sens: "inconnu", premierId: null };
}

const estDetecteur = (t: AppareillageType): boolean => t === "detecteur_mouvement" || t === "detecteur_mouvement_exterieur";

function modeDe(filaires: AppareillagePlace[], domotiques: AppareillagePlace[]): ModeCommande | null {
  if (filaires.length === 0) return domotiques.length > 0 ? "domotique" : null;
  if (filaires.some(c => estDetecteur(c.type))) return "detecteur";
  if (filaires.some(c => baseCommande(c.type) === "telerupteur")) return "telerupteur";
  if (filaires.some(c => baseCommande(c.type) === "va_et_vient")) return "va_et_vient";
  return "simple";
}

// ─── GUIDES DE CÂBLAGE ───────────────────────────────────────────────────────────────────────────────────────

const COMMUN = "L (borne commune)";
const REGLES_FILS =
  "Couleurs VoltApp (plan, schémas, 3D) : phase = rouge, neutre = bleu clair, terre = vert/jaune, retour = violet foncé, navettes = orange. " +
  "NF C 15-100 : neutre bleu clair et terre vert/jaune sont imposés ; pour les autres fils, reprendre ces couleurs si le câble le permet, sinon repérer " +
  "chaque fil de retour/navette au marqueur ou au ruban dès la pose.";

function nomLampes(ctx: Contexte, lampes: AppareillagePlace[]): string {
  return lampes.map(l => libelleLong(ctx, l)).join(", ");
}

function construireGuide(ctx: Contexte, g: GroupeCommande, mode: ModeCommande, idGuide: string): GuideCommande {
  const alertes: string[] = [];
  const attention: string[] = [];
  const etapes: string[] = [];
  const mecanismes: MecanismeGuide[] = [];
  const lampesTxt = nomLampes(ctx, g.lampes);
  const m = g.chaine.length;
  const total = m + g.horsTrace.length;
  const tous = [...g.chaine, ...g.horsTrace];

  const fiche = (c: AppareillagePlace, role: RoleMecanisme, roleLibelle: string, position: number, bornes: LigneBorne[]): MecanismeGuide => {
    const pl = infoPlaque(ctx, c);
    const voie = estCommandeDouble(c.type) ? ` — voie ${g.voies.get(c.id) ?? 1}` : "";
    return {
      id: c.id, titre: `${libelleLong(ctx, c)}${voie}`, role, roleLibelle, position, hauteurCm: cm(c),
      repere: reperePlan({ x: c.x, y: c.y }), plaque: pl?.court, bornes,
    };
  };
  const lampesRetour = g.lampes.length > 1 ? `les ${g.lampes.length} points lumineux commandés` : "le point lumineux commandé";
  const provenance = g.provenance;

  // Mécanismes doubles : rappel commun
  const doubles = [...g.chaine, ...g.horsTrace].filter(c => estCommandeDouble(c.type));
  if (doubles.length > 0) {
    attention.push(
      "Mécanisme DOUBLE : deux voies indépendantes sous une même plaque. Chaque voie se câble comme une commande à part entière (ce guide ne traite que la voie indiquée). " +
      "Les deux bornes communes peuvent être reliées par un pont (peigne) uniquement si les deux voies partent de la même arrivée de phase ET du même circuit ; sinon, une arrivée de phase par voie, sans pont.",
    );
  }
  if (g.horsTrace.length > 0) {
    alertes.push(
      `${pluriel(g.horsTrace.length, "commande n'est", "commandes ne sont")} pas tracée${g.horsTrace.length > 1 ? "s" : ""} dans ce circuit (autre niveau, ou tableau non placé) : ` +
      `${g.horsTrace.map(c => libelleLong(ctx, c)).join(", ")}. Le câble qui la/les relie doit être tiré à la main et n'est pas dans les câbles listés.`,
    );
  }
  if (g.sens === "lampe") {
    alertes.push(
      "Aucune alimentation amont tracée : le plan fait partir les commandes depuis le point lumineux (circuit sans boîte/tableau en amont). " +
      "Vérifier sur place d'où arrive la phase avant de câbler.",
    );
  }

  if (mode === "simple") {
    if (m > 1) {
      alertes.push(
        `${m} interrupteurs simples commandent le même point lumineux : câblés ainsi ils seraient en série (les deux doivent être fermés pour allumer). ` +
        "S'il s'agit d'une commande depuis deux endroits, remplacer par des va-et-vient.",
      );
    }
    tous.forEach((c, i) => {
      mecanismes.push(fiche(c, "interrupteur", "Interrupteur simple allumage", i + 1, [
        { borne: COMMUN, fil: `Phase d'alimentation, venant de ${provenance}` },
        { borne: "Sortie (autre borne du mécanisme)", fil: `Fil de RETOUR (phase commutée) → ${lampesRetour}` },
        { borne: "Neutre / terre", fil: "Ne se raccordent PAS au mécanisme : ils passent dans la boîte d'encastrement (raccordés entre eux par connecteur) et continuent vers la lampe" },
      ]));
    });
    etapes.push(
      "Couper le disjoncteur du circuit au tableau et vérifier l'absence de tension (VAT) avant toute intervention.",
      `Amener la phase à la borne commune (L) de l'interrupteur (arrivée depuis ${provenance}).`,
      `Raccorder le fil de retour sur l'autre borne de l'interrupteur, puis le tirer jusqu'à ${lampesRetour}.`,
      "Neutre (bleu) et terre (vert/jaune) : les relier entre eux dans la boîte d'encastrement par connecteur, sans les brancher sur le mécanisme, et les poursuivre vers la lampe.",
      "À la lampe (boîte DCL) : retour sur la borne phase du luminaire, neutre sur la borne neutre, terre sur la borne terre (luminaire classe I).",
    );
    attention.push(
      "Marquage des bornes : il varie selon les marques. Sur la gamme Odace la borne COMMUNE est repérée « L » (les navettes sont « 1 » et « 2 »), mais le marquage varie selon les marques — la repérer avant de câbler, jamais au hasard.",
      "Interrupteur à voyant lumineux (ou témoin) : le neutre doit alors aussi arriver au mécanisme (borne N).",
    );
    attention.push(REGLES_FILS);
  } else if (mode === "detecteur") {
    tous.forEach((c, i) => {
      mecanismes.push(fiche(c, "detecteur", "Détecteur de mouvement", i + 1, [
        { borne: "Phase (L)", fil: `Phase d'alimentation, venant de ${provenance}` },
        { borne: "Neutre (N)", fil: "Neutre OBLIGATOIRE : le détecteur est alimenté en continu (contrairement à un interrupteur)" },
        { borne: "Sortie / charge", fil: `Fil de RETOUR (phase commutée) → ${lampesRetour}` },
        { borne: "Terre", fil: "Continuité de la terre dans la boîte (selon modèle)" },
      ]));
    });
    etapes.push(
      "Couper le disjoncteur du circuit au tableau et vérifier l'absence de tension (VAT).",
      "Raccorder phase ET neutre à l'entrée du détecteur (il consomme en permanence).",
      `Relier la sortie du détecteur à ${lampesRetour} par le fil de retour.`,
      "Régler la portée, la temporisation et le seuil de luminosité selon la notice, puis tester à la mise sous tension.",
    );
    attention.push(
      "Vérifier la puissance maximale commutable du détecteur par rapport à la somme des lampes (LED : respecter la charge minimale/maximale de la notice).",
      REGLES_FILS,
    );
  } else if (mode === "telerupteur") {
    const nb = total;
    tous.forEach((c, i) => {
      mecanismes.push(fiche(c, "bouton_poussoir", "Bouton poussoir (contact fugitif)", i + 1, [
        { borne: COMMUN, fil: `Phase (même phase que le télérupteur), reliée en parallèle avec les autres boutons — venant de ${provenance}` },
        { borne: "Sortie", fil: "Fil de commande → bobine A1 du télérupteur (au tableau), reliée avec les sorties des autres boutons" },
      ]));
    });
    mecanismes.push({
      id: -1, titre: "Télérupteur (module au tableau)", role: "module", roleLibelle: "Module de puissance dans le tableau", position: nb + 1, hauteurCm: 0,
      bornes: [
        { borne: "A1", fil: "Fil de commande venant de la sortie des boutons poussoirs" },
        { borne: "A2", fil: "Neutre (bobine)" },
        { borne: "1 (entrée contact)", fil: "Phase du circuit d'éclairage" },
        { borne: "2 (sortie contact)", fil: `Phase commutée → ${lampesRetour}` },
      ],
    });
    etapes.push(
      "Couper le disjoncteur du circuit au tableau et vérifier l'absence de tension (VAT).",
      "Poser le télérupteur dans le tableau (module sur rail, sous le disjoncteur du circuit).",
      "Boutons poussoirs : tous les boutons sont en PARALLÈLE — toutes les bornes communes reliées à la phase, toutes les sorties reliées ensemble vers la borne A1.",
      "Borne A2 du télérupteur au neutre ; entrée de contact (1) à la phase du circuit ; sortie de contact (2) vers les points lumineux.",
      "Neutre et terre des points lumineux : en direct depuis la boîte de dérivation / le tableau (ils ne passent pas par les boutons).",
    );
    attention.push(
      "Le plan suit ce câblage : la lampe est alimentée directement (phase commutée par le télérupteur, neutre, terre) et les boutons forment une ligne de commande tirée depuis le tableau : phase + un fil de RETOUR (violet) par télérupteur + terre. Un télérupteur DOUBLE a donc 2 retours dans le même câble.",
      "Ne jamais utiliser un interrupteur ordinaire à la place d'un bouton poussoir (il maintiendrait la bobine alimentée).",
      REGLES_FILS,
    );
  } else if (mode === "va_et_vient") {
    const nbVV = tous.filter(c => baseCommande(c.type) === "va_et_vient").length;
    if (nbVV === 1) {
      alertes.push("Un seul va-et-vient sur ce point lumineux : il en faut au moins deux (sinon, un interrupteur simple).");
    }
    if (tous.some(c => baseCommande(c.type) !== "va_et_vient")) {
      alertes.push("Des commandes de nature différente (interrupteur simple, bouton…) sont mélangées avec des va-et-vient sur la même lampe : montage impossible tel quel.");
    }
    const p = Math.max(0, total - 2);
    g.chaine.forEach((c, i) => {
      const premier = i === 0, dernier = i === m - 1;
      const prev = i > 0 ? g.chaine[i - 1] : null, suiv = i < m - 1 ? g.chaine[i + 1] : null;
      const nPrev = prev ? libelleLong(ctx, prev) : "", nSuiv = suiv ? libelleLong(ctx, suiv) : "";
      if (m === 1) {
        mecanismes.push(fiche(c, "va_et_vient_entree", "Va-et-vient (autre(s) commande(s) hors tracé)", i + 1, [
          { borne: COMMUN, fil: `Phase venant de ${provenance} OU retour vers ${lampesRetour} (selon sa place dans la chaîne)` },
          { borne: "L1 et L2", fil: "Les deux navettes vers la/les autre(s) commande(s)" },
        ]));
      } else if (premier) {
        mecanismes.push(fiche(c, "va_et_vient_entree", "Va-et-vient — côté alimentation", i + 1, [
          { borne: COMMUN, fil: g.sens === "lampe" ? "Un des deux fils actifs reliés à la lampe (phase ou retour — voir alerte)" : `Phase d'alimentation, venant de ${provenance}` },
          { borne: "L1", fil: `Navette 1 → ${nSuiv}` },
          { borne: "L2", fil: `Navette 2 → ${nSuiv}` },
        ]));
      } else if (dernier) {
        mecanismes.push(fiche(c, "va_et_vient_sortie", "Va-et-vient — côté lampe", i + 1, [
          { borne: "L1", fil: `Navette 1 ← ${nPrev}` },
          { borne: "L2", fil: `Navette 2 ← ${nPrev}` },
          { borne: COMMUN, fil: g.sens === "lampe" ? "L'autre fil actif relié à la lampe (voir alerte)" : `Fil de RETOUR → ${lampesRetour}` },
        ]));
      } else {
        mecanismes.push(fiche(c, "permutateur", "Permutateur (inverseur de croisement)", i + 1, [
          { borne: "2 bornes d'un même côté (entrées)", fil: `Navettes 1 et 2 venant de ${nPrev}` },
          { borne: "2 bornes de l'autre côté (sorties)", fil: `Navettes 1 et 2 vers ${nSuiv}` },
          { borne: "Phase / retour / neutre", fil: "AUCUN : un permutateur ne reçoit que les deux navettes" },
        ]));
      }
    });
    g.horsTrace.forEach((c, i) => {
      mecanismes.push(fiche(c, "va_et_vient_sortie", "Va-et-vient — commande hors tracé", m + i + 1, [
        { borne: "Navettes / COM", fil: "À raccorder à la main selon sa position dans la chaîne (ce circuit ne la trace pas)" },
      ]));
    });
    if (total >= 2) {
      etapes.push(
        "Couper le disjoncteur du circuit au tableau et vérifier l'absence de tension (VAT).",
        `Premier va-et-vient (côté alimentation) : phase sur la borne COMMUN (venant de ${provenance}) — jamais sur L1 ou L2.`,
        `Tirer DEUX fils de navette (orange, repérés 1 et 2) du premier va-et-vient jusqu'${p > 0 ? "au premier permutateur, puis de permutateur en permutateur jusqu'" : ""}au dernier va-et-vient : navette 1 sur L1, navette 2 sur L2.`,
        ...(p > 0 ? [
          `Permutateurs (${p}) : les deux navettes qui arrivent se raccordent aux deux bornes d'un même côté, les deux navettes qui repartent aux deux bornes de l'autre côté. Aucune phase, aucun retour sur un permutateur.`,
        ] : []),
        `Dernier va-et-vient (côté lampe) : navette 1 sur L1, navette 2 sur L2, et borne COMMUN → fil de RETOUR vers ${lampesRetour}.`,
        "Neutre (bleu) et terre (vert/jaune) : ne se raccordent à aucun mécanisme ; ils sont reliés entre eux dans chaque boîte d'encastrement et poursuivent vers la lampe.",
        "À la lampe (boîte DCL) : retour sur la borne phase du luminaire, neutre sur la borne neutre, terre sur la borne terre.",
        `Test : à la mise sous tension, la lampe doit s'allumer et s'éteindre depuis ${total === 2 ? "chacun des 2 points" : `chacun des ${total} points, quel que soit l'état des autres`}.`,
      );
      attention.push(
        "ERREUR n°1 : phase ou retour branché sur 1/2 au lieu de la borne commune L → la lampe ne répond que dans certaines positions. Phase et retour vont TOUJOURS sur la borne commune (L).",
        "ERREUR n°2 : une seule navette tirée, ou les deux navettes raccordées à la même borne → la lampe ne s'éteint plus ou ne s'allume que d'un côté. Il faut DEUX fils distincts, un sur L1 et un sur L2 à chaque extrémité.",
        "Intervertir les deux navettes (navette 1 sur L1 d'un côté et sur L2 de l'autre, pour les DEUX fils) fonctionne aussi : cela inverse seulement la position « allumé » des interrupteurs. Garder le même repérage aux deux bouts évite surtout de se tromper.",
        "Le neutre ne se raccorde jamais à un va-et-vient mais il TRANSITE par les boîtes des commandes pour rejoindre la lampe : le câble entre deux va-et-vient est donc un 4G1,5 (neutre + 2 navettes + terre), comme au plan. Pour des va-et-vient DOUBLES, chaque voie a ses 2 navettes (6 conducteurs).",
        "Lampe alimentée en bout de chaîne (câble qui part de la lampe) : la phase monte au premier va-et-vient, le retour redescend ; le câble entre va-et-vient porte alors 2 navettes + le retour + la terre, sans neutre.",
        REGLES_FILS,
      );
    }
  } else if (mode === "domotique") {
    etapes.push(
      "Commande domotique (module radio/Wi-Fi) : aucun fil de retour ni de navette n'est tiré.",
      `Alimenter ${lampesRetour} directement en phase, neutre et terre.`,
      "Installer et appairer le module/récepteur selon la notice du fabricant, puis tester la commande.",
    );
    attention.push("Le module domotique a généralement besoin du neutre à son emplacement : prévoir le neutre en attente dans la boîte de la commande.");
  }

  const schema = mode === "domotique" ? null
    : mode === "simple" ? { type: "simple" as const, nbPermutateurs: 0, nbBoutons: 1 }
      : mode === "detecteur" ? { type: "detecteur" as const, nbPermutateurs: 0, nbBoutons: 1 }
        : mode === "telerupteur" ? { type: "telerupteur" as const, nbPermutateurs: 0, nbBoutons: Math.max(1, total) }
          : { type: "va_et_vient" as const, nbPermutateurs: Math.max(0, total - 2), nbBoutons: total };

  let intitule: string;
  if (mode === "simple") intitule = "Interrupteur simple allumage";
  else if (mode === "detecteur") intitule = "Détecteur de mouvement";
  else if (mode === "telerupteur") intitule = `Télérupteur — ${pluriel(Math.max(1, total), "bouton poussoir", "boutons poussoirs")}`;
  else if (mode === "domotique") intitule = "Commande domotique (sans fil)";
  else if (total === 2) intitule = "Va-et-vient (2 points de commande)";
  else if (total === 3) intitule = "Triple va-et-vient (3 points de commande : 2 va-et-vient + 1 permutateur)";
  else intitule = `${total} points de commande : 2 va-et-vient + ${Math.max(0, total - 2)} permutateurs`;

  return {
    id: idGuide,
    titre: `${intitule} → ${lampesTxt}`,
    mode, lampes: g.lampes.map(l => libelleLong(ctx, l)), mecanismes, etapes, attention, alertes, schema,
  };
}

// ─── CONSTRUCTION DU SUIVI ───────────────────────────────────────────────────────────────────────────────────

export function construireSuivi(niveauxEntree: Niveau[]): SuiviPlan {
  const resultat = genererCircuits({ niveaux: niveauxEntree });
  const bilan = controlerCircuits(resultat);
  const couleurs = construireColorMap(resultat);
  const niveaux = [...resultat.maison.niveaux].sort((a, b) => a.ordre - b.ordre);
  const ctx = construireContexte(niveaux);
  const clesConnues = new Set<string>();
  const avertissements: string[] = [];
  const circuits: CircuitSuivi[] = [];
  const problemesAffectes = new Set<ProblemeCircuit>();

  niveaux.forEach(niveau => {
    const origine: Point | undefined = origineCircuits(niveau);
    const lctx = creerContexteLongueurs(niveau);
    const hauteurAncre = hauteurAncreFn(lctx);
    const breakersNiveau = breakersDuNiveau(resultat.breakers, niveau);
    if (!origine && breakersNiveau.length > 0) {
      avertissements.push(`« ${niveau.nom || niveau.type} » : la position du tableau n'est pas définie sur ce niveau — les câbles de ce niveau ne peuvent pas être calculés (seuls les appareillages sont listés).`);
    }

    breakersNiveau.forEach(b => {
      const points = niveau.pieces.flatMap(p => p.appareillages).filter(a => a.circuitId === b.id);
      if (points.length === 0) return;
      const spec = CIRCUITS[b.circuit] ?? CIRCUITS.autre;
      const manuel = b.manuelId != null ? (niveau.circuitsManuels ?? []).find(m => m.id === b.manuelId) : undefined;
      const nom = b.manuelId != null ? b.label : (niveau.nomsCircuits?.[b.label] ?? b.label);
      const eclairage = b.circuit === "lumiere";
      const sansDisj = estCircuitSansDisjoncteur(b);
      const nonRelie = !!manuel?.nonRelieTableau;
      const section = effectiveSection(b);
      const idsMembres = points.map(a => a.id);
      const minId = Math.min(...idsMembres);
      const segments: SegmentCircuit[] = origine ? segmentsPourCircuit(b, points, niveau, origine) : [];
      const elements: ElementSuivi[] = [];
      const alertes: string[] = [];
      const noeudCle = (id: string): string => (id === "boite" ? `boite@${minId}` : id);
      const nomTableau = sansDisj ? "Coffret de communication" : "Tableau électrique";
      const lampes = points.filter(a => estLumiere(a.type));
      const commandesCircuit = points.filter(a => estCommande(a.type));

      // Boîtes de dérivation : nommées (plan) ou implicite
      const boites = new Map<string, { point: Point; nom?: string }>();
      segments.forEach(s => {
        [{ id: s.aId, p: s.aPoint }, { id: s.bId, p: s.bPoint }].forEach(({ id, p }) => {
          if (!(id === "boite" || id.startsWith("boite-")) || boites.has(id)) return;
          const nommee = id.startsWith("boite-") ? Object.values(niveau.boitesDerivation ?? {}).flat().find(x => `boite-${x.id}` === id) : undefined;
          boites.set(id, { point: p, nom: nommee?.nom?.trim() || undefined });
        });
      });
      const nomNoeud = (id: string): string => {
        if (id === "tableau") return nomTableau;
        const bx = boites.get(id);
        if (bx) return bx.nom ? `Boîte de dérivation « ${bx.nom} »` : "Boîte de dérivation";
        const e = ctx.parId.get(id);
        return e ? libelleLong(ctx, e.a) : id;
      };

      // ── Guides de câblage des commandes (éclairage) ───────────────────────────────────────────────
      const guides: GuideCommande[] = [];
      const guidesParCommande = new Map<number, string[]>();
      if (eclairage) {
        const groupes = new Map<string, GroupeCommande>();
        lampes.forEach(lampe => {
          const cmds = ctx.tous.map(t => t.a).filter(c => estCommande(c.type) && commandeCetteLumiere(c, lampe.id));
          if (cmds.length === 0) return;
          const filaires = cmds.filter(c => !c.domotique);
          const domotiques = cmds.filter(c => c.domotique);
          const { chaine, sens, premierId } = ordonnerChaine(lampe, filaires, segments);
          const horsTrace = filaires.filter(c => !chaine.some(x => x.id === c.id));
          const entrant = premierId ? segments.find(s => s.bId === premierId && !chaine.some(x => String(x.id) === s.aId) && s.aId !== String(lampe.id)) : undefined;
          const boiteEntrante = entrant ? boites.get(entrant.aId) : undefined;
          const provenance = sens === "lampe" ? `le point lumineux ${libelleLong(ctx, lampe)}`
            : !entrant ? "l'alimentation du circuit"
              : entrant.aId === "tableau" ? (sansDisj ? "le coffret de communication" : "le tableau électrique")
                : boiteEntrante ? (boiteEntrante.nom ? `la boîte de dérivation « ${boiteEntrante.nom} »` : "la boîte de dérivation")
                  : nomNoeud(entrant.aId);
          const voies = new Map<number, 1 | 2>();
          [...chaine, ...horsTrace].forEach(c => { if (estCommandeDouble(c.type)) voies.set(c.id, voieDe(c, lampe.id)); });
          const signature = `${sens}|${chaine.map(c => `${c.id}:${voies.get(c.id) ?? 0}`).join(",")}|${horsTrace.map(c => c.id).sort((x, y) => x - y).join(",")}|${domotiques.map(c => c.id).sort((x, y) => x - y).join(",")}`;
          const existant = groupes.get(signature);
          if (existant) existant.lampes.push(lampe);
          else groupes.set(signature, { chaine, sens, horsTrace, domotiques, lampes: [lampe], voies, provenance });
        });
        let n = 0;
        groupes.forEach(g => {
          const mode = modeDe([...g.chaine, ...g.horsTrace], g.domotiques);
          if (!mode) return;
          n++;
          const id = `g|${niveau.id}|${minId}|${n}`;
          const guide = construireGuide(ctx, g, mode, id);
          guides.push(guide);
          [...g.chaine, ...g.horsTrace, ...g.domotiques].forEach(c => {
            const l = guidesParCommande.get(c.id) ?? [];
            l.push(id);
            guidesParCommande.set(c.id, l);
          });
        });
      }

      // ── Disjoncteur ───────────────────────────────────────────────────────────────────────────────
      if (!sansDisj && !nonRelie) {
        const cle = cleDisjoncteur(niveau.id, b.circuit, idsMembres);
        const details = [
          `Disjoncteur ${b.amperes} A pour le circuit « ${nom} » (${spec.label}).`,
          `Câble du circuit : section ${fmtSection(section)} mm².`,
          ...(spec.diffType ? [`À placer sous un interrupteur différentiel 30 mA de type ${spec.diffType} (ou supérieur).`] : []),
          "Disjoncteur obligatoire : coupe-circuit à fusible interdit en installation neuve (NF C 15-100).",
        ];
        elements.push({
          id: cle, categorie: "tableau", titre: `Disjoncteur ${b.amperes} A — ${nom}`, sousTitre: nomTableau,
          details, alertes: [], badges: [`${b.amperes} A`, `${fmtSection(section)} mm²`],
          etapes: [{ cle, libelle: "Posé et raccordé au tableau" }], ordre: 0,
        });
        clesConnues.add(cle);
      } else if (nonRelie) {
        elements.push({
          id: `info|${b.label}`, categorie: "tableau", titre: "Circuit existant — non relié au tableau",
          details: ["Ce circuit est déclaré comme déjà existant : aucun disjoncteur ni câble de départ à poser."],
          alertes: [], badges: [], etapes: [], existant: true, ordre: 0,
        });
      }

      // ── Boîtes de dérivation ──────────────────────────────────────────────────────────────────────
      let ordreBoite = 0;
      boites.forEach((bx, id) => {
        const piece = trouverPiece(bx.point, niveau.pieces);
        const kPose = cleBoite(niveau.id, noeudCle(id), "pose"), kRac = cleBoite(niveau.id, noeudCle(id), "raccord");
        const lampesBoite = lampes.length;
        elements.push({
          id: `b|${niveau.id}|${noeudCle(id)}`, categorie: "boite", titre: bx.nom ? `Boîte de dérivation « ${bx.nom} »` : "Boîte de dérivation",
          sousTitre: `${piece ? nomPiece(piece) : "Hors pièces"} · ${reperePlan(bx.point)}`,
          details: [
            `Boîte de dérivation à hauteur de gaine (${(lctx.hauteurGaine * 100).toFixed(0)} cm) : point où se séparent les départs ${eclairage ? `vers les commandes et les points lumineux (${pluriel(lampesBoite, "lampe", "lampes")} sur ce circuit)` : `vers les appareils du circuit (${pluriel(points.length, "appareil", "appareils")})`}.`,
            ...(bx.nom ? [] : ["Boîte non nommée sur le plan : sa position est calculée au centre des lampes du circuit (à ajuster en posant une boîte nommée dans le plan)."]),
            "Dérivation : tout câble qui se sépare en plusieurs se raccorde ICI, sur dominos / bornes à levier (un domino pour la phase, un pour le neutre, un pour la terre). Jamais d'épissure dans le vide, dans un mur ou sous une moulure.",
            ...(piece ? [] : ["Cette boîte tombe hors des pièces : la déplacer dans une pièce (glisser le repère carré sur le plan) pour qu'elle reste accessible."]),
            "Boîte étanche à l'air si posée en volume chauffé ; bornes de raccordement rapide, phase / neutre / terre repérés. Toujours accessible (jamais noyée dans le plâtre ni le béton).",
          ],
          alertes: [], badges: ["boîte de dérivation"],
          etapes: [{ cle: kPose, libelle: "Boîte posée" }, { cle: kRac, libelle: "Câbles raccordés" }], ordre: ordreBoite++,
        });
        clesConnues.add(kPose); clesConnues.add(kRac);
      });

      // ── Appareillages ─────────────────────────────────────────────────────────────────────────────
      const triParId = [...points].sort((x, y) => pieceNomDe(ctx, x).localeCompare(pieceNomDe(ctx, y), "fr") || x.id - y.id);
      triParId.forEach((a, idx) => {
        const e = ctx.parId.get(String(a.id));
        const piece = e ? nomPiece(e.piece) : "";
        const kPose = cleAppareil(a.id, "pose"), kRac = cleAppareil(a.id, "raccord");
        const plaque = infoPlaque(ctx, a);
        const details: string[] = [];
        const alertesEl: string[] = [];
        const badges: string[] = [];
        let categorie: CategorieElement = "appareil";
        let libPose = "Posé", libRac = "Raccordé";
        const sousTitre = `${piece} · ${reperePlan({ x: a.x, y: a.y })}`;

        if (estLumiere(a.type)) {
          categorie = "lampe";
          libPose = a.type === "spot" || a.type === "spot_etanche" ? "Spot posé (trou, réserve de câble)" : "Sortie / boîte DCL posée";
          libRac = "Raccordé (retour, neutre, terre)";
          if (a.type === "point_lumineux") details.push("Sortie de plafond : boîte DCL (Dispositif de Connexion Luminaire) accrochée à la structure du bâtiment (tige filetée, câble…), capable de porter au moins 25 kg.");
          else if (a.type === "point_lumineux_exterieur") details.push("Sortie étanche en sous-face (avancée de toit, plafond de terrasse) : boîte DCL étanche, indice de protection IP44 minimum.");
          else if (a.type === "applique") details.push(`Sortie murale à ${cm(a)} cm du sol : boîte d'encastrement ou boîte DCL murale.`);
          else if (a.type === "applique_exterieure") details.push(`Applique étanche (IP44 minimum) à ${cm(a)} cm du sol, entrée de câble par le bas.`);
          else if (a.type === "spot") details.push("Spot encastré au plafond : percer au diamètre indiqué par la notice du spot, laisser une réserve de câble. Un spot compte pour 1 point lumineux (8 maximum par circuit).");
          else details.push("Spot étanche IP65 encastré : percer au diamètre de la notice, laisser une réserve de câble. Compte pour 1 point lumineux (8 maximum par circuit).");
          details.push("Raccordement : retour (phase commutée), neutre et terre (luminaire de classe I).");
          if (e?.piece.type === "sdb") alertesEl.push("Salle de bains : luminaire protégé contre les projections d'eau (IPX4 minimum) — vérifier l'indice de protection selon le volume où il est installé.");
          if (estLumierePlafond(a.type)) badges.push("plafond"); else badges.push(`${cm(a)} cm`);
          const cmds = ctx.tous.map(t => t.a).filter(c => estCommande(c.type) && commandeCetteLumiere(c, a.id));
          if (cmds.length === 0) {
            alertesEl.push("Aucune commande (interrupteur, va-et-vient, télérupteur, détecteur) n'allume ce point lumineux : il restera allumé en permanence ou inutilisable. À corriger dans le plan.");
            details.push("Commande : AUCUNE.");
          } else {
            const resume = cmds.map(c => `${libelleLong(ctx, c)}${c.domotique ? " (domotique)" : ""}`).join(" ; ");
            details.push(`Commandé par : ${resume}.`);
          }
        } else if (estCommande(a.type)) {
          categorie = "commande";
          libPose = "Boîte + mécanisme posés";
          libRac = "Raccordé selon le guide";
          const h = cm(a);
          badges.push(`${h} cm`);
          if (a.domotique) badges.push("domotique");
          const base = baseCommande(a.type);
          details.push(`${LABEL_APPAREIL[a.type]} à ${h} cm du sol : boîte d'encastrement profondeur adaptée au doublage, mécanisme et plaque de finition.`);
          if (estCommandeDouble(a.type)) details.push("Mécanisme à deux voies : voie 1 et voie 2 se câblent séparément (voir le guide de chaque voie).");
          if (plaque) details.push(plaque.detail);
          const interieur = a.type === "interrupteur" || a.type === "va_et_vient" || a.type === "telerupteur" || estCommandeDouble(a.type) || a.type === "interrupteur_exterieur";
          if (interieur && (h < 90 || h > 130)) {
            alertesEl.push(`Hauteur ${h} cm : en dehors de la plage 0,90 m – 1,30 m préconisée pour les points d'allumage (accessibilité).`);
          }
          const cibles = lampes.filter(l => commandeCetteLumiere(a, l.id));
          const ciblesTout = ctx.tous.map(t => t.a).filter(l => estLumiere(l.type) && commandeCetteLumiere(a, l.id));
          details.push(`Commande : ${ciblesTout.length > 0 ? ciblesTout.map(l => libelleLong(ctx, l)).join(", ") : "AUCUN point lumineux"}.`);
          if (ciblesTout.length === 0) alertesEl.push("Cette commande ne pilote aucun point lumineux : à lier à une lampe dans le plan.");
          if (cibles.length < ciblesTout.length) alertesEl.push("Commande de points lumineux situés sur un autre niveau : ces liaisons ne sont pas tracées dans ce circuit.");
          if (base === "va_et_vient") badges.push("va-et-vient");
          if (a.domotique) details.push("Commande domotique : module radio/Wi-Fi, aucun fil de retour ni de navette vers la lampe.");
        } else if (a.type === "prise" || a.type === "prise_commandee" || a.type === "prise_exterieure" || a.type === "prise_dediee") {
          const h = cm(a);
          badges.push(`${h} cm`);
          libPose = "Boîte + socle posés";
          libRac = "Raccordée (phase, neutre, terre)";
          const usage = a.type === "prise_dediee" ? ` pour ${LABEL_APPAREIL[a.usageDedie ?? "four"].toLowerCase()}` : "";
          details.push(`${LABEL_APPAREIL[a.type]}${usage} à ${h} cm du sol : boîte d'encastrement, socle 2P+T (terre obligatoire), plaque de finition.`);
          if (plaque) details.push(plaque.detail);
          if (a.type === "prise_exterieure") alertesEl.push("Prise extérieure : socle étanche IP44 minimum, alimentée sous différentiel 30 mA.");
        } else if (a.type === "rj45" || a.type === "prise_tv") {
          const h = cm(a);
          badges.push(`${h} cm`);
          libPose = "Boîte + prise posées";
          libRac = "Câble raccordé";
          details.push(a.type === "rj45"
            ? `Prise RJ45 catégorie 6 blindée (STP) à ${h} cm du sol, placée à proximité d'une prise de courant. Câblage OBLIGATOIREMENT en étoile vers le coffret de communication.`
            : `Prise TV / antenne coaxiale à ${h} cm du sol, câblage en étoile vers le coffret de communication.`);
          if (plaque) details.push(plaque.detail);
        } else if (a.type === "volet_roulant") {
          libPose = "Moteur posé";
          libRac = "Raccordé";
          badges.push("16 A partagé");
          details.push("Moteur de volet roulant : circuit dédié 16 A / 1,5 mm² pour l'ensemble des volets (idéalement réparti sur 2 circuits). Commande par interrupteur de volet ou télécommande selon le modèle.");
        } else if (a.type === "chauffage") {
          libPose = "Radiateur posé";
          libRac = "Raccordé";
          const w = a.puissanceW ?? null;
          badges.push(w != null ? `${w} W` : "puissance à renseigner");
          details.push(`Radiateur électrique${w != null ? ` de ${w} W` : ""} : raccordement par boîte de connexion ou prise dédiée, fil pilote si le modèle l'exige.`);
          if (w == null) alertesEl.push("Puissance non renseignée dans le plan : le regroupement des radiateurs sur le circuit repose sur une valeur par défaut.");
        } else {
          libPose = "Alimentation en attente posée";
          libRac = "Raccordé";
          badges.push(`${cm(a)} cm`);
          details.push(`${LABEL_APPAREIL[a.type]} : sortie de câble (ou prise spécialisée) à ${cm(a)} cm du sol, circuit dédié ${b.amperes} A / ${fmtSection(section)} mm².`);
        }

        if (a.dejaExistant) {
          elements.push({
            id: `a|${a.id}`, categorie, titre: libelle(ctx, a), sousTitre, details: ["Appareillage DÉJÀ EXISTANT chez le client : point de raccordement, rien à poser."],
            alertes: [], badges: ["existant"], etapes: [], existant: true, guideIds: guidesParCommande.get(a.id), ordre: 100 + idx,
          });
          return;
        }
        elements.push({
          id: `a|${a.id}`, categorie, titre: libelle(ctx, a), sousTitre, details, alertes: alertesEl, badges,
          etapes: [{ cle: kPose, libelle: libPose }, { cle: kRac, libelle: libRac }],
          guideIds: guidesParCommande.get(a.id), ordre: 100 + idx,
        });
        clesConnues.add(kPose); clesConnues.add(kRac);
      });

      // ── Câbles à tirer ────────────────────────────────────────────────────────────────────────────
      let nbDepart = 0, nbAlimCmd = 0, nbNavettes = 0, nbRetours = 0, nbAutres = 0;
      const rolesOrdre: Record<string, number> = { depart: 0, boite: 1, alim: 2, navette: 3, retour: 4, directe: 5, chaine: 6 };
      let nSeg = 0;
      segments.forEach(seg => {
        if (seg.type === "domotique") return;
        nSeg++;
        const A = ctx.parId.get(seg.aId)?.a, B = ctx.parId.get(seg.bId)?.a;
        const kA = seg.aId === "tableau" ? "tableau" : (seg.aId === "boite" || seg.aId.startsWith("boite-")) ? "boite" : A && estCommande(A.type) ? "commande" : A && estLumiere(A.type) ? "lampe" : "autre";
        const kB = (seg.bId === "boite" || seg.bId.startsWith("boite-")) ? "boite" : B && estCommande(B.type) ? "commande" : B && estLumiere(B.type) ? "lampe" : "autre";
        let role = "chaine", fonction = "Câble du circuit", roleLiaison: "commande" | "normal" = "normal";
        const lignes: string[] = [];
        if (eclairage) {
          if (seg.type === "commande") { role = "alim"; fonction = "Ligne de commande des boutons-poussoirs (télérupteur)"; lignes.push("Les boutons-poussoirs sont en parallèle : phase + un fil de retour par télérupteur + terre. Le télérupteur est au tableau, la lampe est alimentée directement."); roleLiaison = "commande"; }
          else if (kA === "tableau" && kB === "boite") { role = "depart"; fonction = "Départ : tableau → boîte de dérivation"; lignes.push("Câble d'alimentation du circuit : phase, neutre, terre."); }
          else if (kA === "tableau" && kB === "commande") { role = "depart"; fonction = "Départ : tableau → commande (aller)"; lignes.push("La phase arrive à la borne L (commune) de la commande ; neutre et terre poursuivent vers la lampe sans se raccorder au mécanisme."); }
          else if (kA === "tableau" && kB === "lampe") { role = "depart"; fonction = "Départ : tableau → point lumineux"; lignes.push("Phase, neutre, terre jusqu'à la boîte DCL."); }
          else if (kA === "boite" && kB === "boite") { role = "boite"; fonction = "Liaison entre boîtes de dérivation"; lignes.push("Prolongement du câble d'alimentation : phase, neutre, terre."); }
          else if (kA === "boite" && kB === "commande") { role = "alim"; fonction = "Alimentation de la commande (aller depuis la boîte)"; lignes.push("La phase part de la boîte vers la borne L (commune) de la commande ; neutre et terre accompagnent le câble pour atteindre la lampe."); }
          else if (kA === "boite" && kB === "lampe") { role = "alim"; fonction = "Alimentation du point lumineux depuis la boîte"; lignes.push("Phase, neutre, terre jusqu'à la boîte DCL."); }
          else if (kA === "commande" && kB === "commande") {
            if (seg.type === "navette") { role = "navette"; fonction = "Navettes entre commandes"; lignes.push(`Fils de navette (deux par voie, repérés) : navette 1 sur L1, navette 2 sur L2 de chaque mécanisme${seg.neutre ? " ; le neutre de la lampe traverse ce câble" : " ; le retour de chaque voie repasse par ce câble jusqu'à la lampe"}.`); roleLiaison = "commande"; }
            else { role = "navette"; fonction = "Liaison entre commandes"; lignes.push("Fils de commande entre les boutons (en parallèle) : voir le guide de câblage."); roleLiaison = "commande"; }
          }
          else if (kA === "commande" && kB === "lampe") { role = "retour"; fonction = "Retour : commande → point lumineux"; lignes.push("Fil de RETOUR (phase commutée) + neutre + terre qui alimentent la lampe."); roleLiaison = "commande"; }
          else if (kA === "lampe" && kB === "commande") { role = "retour"; fonction = "Commande alimentée depuis le point lumineux"; lignes.push(seg.neutre ? "Lampe alimentée en bout de chaîne : le détecteur reçoit neutre + phase de la lampe et lui renvoie le retour." : "Lampe alimentée en bout de chaîne : la phase monte à la commande, le retour redescend vers la lampe (pas de neutre dans ce câble)."); roleLiaison = "commande"; }
          else if (kA === "lampe" && kB === "lampe") { role = "directe"; fonction = "Liaison directe entre points lumineux"; lignes.push("Chaînage lampe à lampe sans boîte : phase, neutre, terre (et retours selon les commandes)."); }
        } else {
          fonction = seg.aId === "tableau" ? `Câble de départ du ${sansDisj ? "coffret de communication" : "tableau"}` : "Câble du circuit (en chaîne)";
          if (b.circuit === "communication") lignes.push("Câble cuivre 4 paires torsadées blindé (grade 2 TV minimum, grade 3 TV pour 10 Gbit/s), tiré d'un seul tenant jusqu'au coffret de communication — jamais de dérivation.");
          else lignes.push("Câble en antenne : phase, neutre, terre. Les appareillages se raccordent en dérivation dans leur boîte d'encastrement, jamais en série.");
        }
        const sectionSeg = roleLiaison === "commande" ? "1.5" : section;
        const trace = tracerLiaison(lctx, b, segments, seg, hauteurAncre);
        const longueur = trace.jambes.reduce((s, j) => s + longueurJambe(j), 0);
        const apparent = trace.jambes.filter(j => j.pose === "apparent").reduce((s, j) => s + longueurJambe(j), 0);
        const waypoints = (niveau.liaisonWaypoints?.[cleSegmentLiaison(seg.aId, seg.bId)] ?? []).length;
        const pose = apparent <= 0.005 ? "encastré" : apparent >= longueur - 0.005 ? "apparent (moulure)" : `mixte (${fmtM(apparent)} apparents)`;
        const cable = b.circuit === "communication" ? (A?.type === "prise_tv" || B?.type === "prise_tv" ? "coaxial" : "RJ45 cat.6 STP") : `${eclairage ? nbConducteurs(seg) : 3}G${fmtSection(sectionSeg)}`;
        const gaine = pose === "apparent (moulure)" ? "moulure" : gaineRecommandee([sectionSeg, sectionSeg, sectionSeg]).gaine;
        const cleK = cleLiaisonCoche(niveau.id, noeudCle(seg.aId), noeudCle(seg.bId));
        const titre = `${nomNoeud(seg.aId)} → ${nomNoeud(seg.bId)}`;
        if (eclairage) lignes.push(`Fils du câble : ${conducteursSegment(seg).map(c => c.libelle).join(", ")}.`);
        const details = [...lignes, `Longueur prévue : ${fmtM(longueur)} (montées et descentes comprises).`];
        details.push(pose === "encastré" ? `Pose encastrée sous gaine ${gaine}.` : pose === "apparent (moulure)" ? "Pose apparente sous moulure." : `Pose ${pose} — gaine ${gaine} sur la partie encastrée.`);
        if (waypoints > 0) details.push(`Passe par ${pluriel(waypoints, "point de passage imposé", "points de passage imposés")} (coudes définis sur le plan).`);
        if (role === "depart" && !sansDisj && !nonRelie && !(niveau.type === "annexe") && (niveau.distanceArriveeGainesTableau ?? 0) > 0 && seg.aId === "tableau") {
          details.push(`À ce tracé s'ajoute la liaison verticale tableau → point d'arrivée des gaines : ${fmtM(niveau.distanceArriveeGainesTableau as number)} (même câble).`);
        }
        elements.push({
          id: cleK, categorie: "liaison", titre, sousTitre: fonction, details, alertes: [], badges: [cable, fmtM(longueur), pose.startsWith("mixte") ? "pose mixte" : pose],
          etapes: [{ cle: cleK, libelle: "Câble tiré" }], ordre: (rolesOrdre[role] ?? 9) * 1000 + nSeg,
        });
        clesConnues.add(cleK);
        if (role === "depart") nbDepart++;
        else if (role === "alim") nbAlimCmd++;
        else if (role === "navette") nbNavettes++;
        else if (role === "retour") nbRetours++;
        else nbAutres++;
      });

      // ── Contrôles propres au circuit ──────────────────────────────────────────────────────────────
      const pointsMembresTraces = new Set<string>();
      segments.forEach(s => { pointsMembresTraces.add(s.aId); pointsMembresTraces.add(s.bId); });
      if (origine) {
        points.filter(a => !pointsMembresTraces.has(String(a.id)) && !a.domotique).forEach(a => {
          alertes.push(`${libelleLong(ctx, a)} n'est relié par aucun câble dans le tracé (circuit réduit à un seul élément ou tracé incomplet).`);
        });
      }
      const maxPar = MAX_PAR_CIRCUIT[b.circuit];
      const nbPoints = eclairage ? lampes.length : points.filter(a => !estCommande(a.type)).length;
      const caracteristiques: Caracteristique[] = [
        { libelle: "Type de circuit", valeur: spec.label },
      ];
      if (!sansDisj) caracteristiques.push({ libelle: "Disjoncteur", valeur: `${b.amperes} A` });
      if (spec.diffType) caracteristiques.push({ libelle: "Différentiel 30 mA", valeur: `type ${spec.diffType}` });
      if (!sansDisj) caracteristiques.push({ libelle: "Section des conducteurs", valeur: `${fmtSection(section)} mm²` });
      if (maxPar != null) {
        const depasse = nbPoints > maxPar;
        caracteristiques.push({
          libelle: eclairage ? "Points lumineux" : "Appareils sur le circuit", valeur: `${nbPoints} / ${maxPar} maximum`, alerte: depasse,
        });
        if (depasse) alertes.push(`${nbPoints} ${eclairage ? "points lumineux" : "appareils"} sur ce circuit, maximum ${maxPar} (NF C 15-100).`);
      } else {
        caracteristiques.push({ libelle: "Appareils sur le circuit", valeur: String(nbPoints) });
      }
      if (origine) {
        const lg = longueurCircuit(lctx, b, points, origine);
        caracteristiques.push({
          libelle: "Câble prévu (total)", valeur: `${fmtM(lg.totale)} (dont ${fmtM(lg.verticale)} de montées/descentes)`,
        });
      }
      const resume: string[] = [];
      if (!sansDisj && !nonRelie) resume.push("1 disjoncteur");
      if (boites.size > 0) resume.push(pluriel(boites.size, "boîte de dérivation", "boîtes de dérivation"));
      if (eclairage) {
        if (lampes.length > 0) resume.push(pluriel(lampes.length, "point lumineux", "points lumineux"));
        const compte = (t: string) => commandesCircuit.filter(c => baseCommande(c.type) === t && !estDetecteur(c.type)).length;
        const nbS = compte("interrupteur"), nbV = compte("va_et_vient"), nbT = compte("telerupteur");
        const nbD = commandesCircuit.filter(c => estDetecteur(c.type)).length;
        if (nbS) resume.push(pluriel(nbS, "interrupteur simple", "interrupteurs simples"));
        if (nbV) resume.push(pluriel(nbV, "va-et-vient / permutateur", "va-et-vient / permutateurs"));
        if (nbT) resume.push(pluriel(nbT, "bouton poussoir", "boutons poussoirs"));
        if (nbD) resume.push(pluriel(nbD, "détecteur de mouvement", "détecteurs de mouvement"));
      } else {
        const nbA = points.length;
        if (nbA) resume.push(pluriel(nbA, "appareillage", "appareillages"));
      }
      if (nbDepart) resume.push(pluriel(nbDepart, "câble de départ", "câbles de départ"));
      if (nbAlimCmd) resume.push(pluriel(nbAlimCmd, "alimentation de commande", "alimentations de commande"));
      if (nbNavettes) resume.push(pluriel(nbNavettes, "liaison de navettes", "liaisons de navettes"));
      if (nbRetours) resume.push(pluriel(nbRetours, "retour vers une lampe", "retours vers une lampe"));
      if (nbAutres) resume.push(pluriel(nbAutres, "autre câble", "autres câbles"));

      const catOrdre: Record<CategorieElement, number> = { tableau: 0, boite: 1, lampe: 2, commande: 3, appareil: 4, liaison: 5 };
      elements.sort((x, y) => catOrdre[x.categorie] - catOrdre[y.categorie] || x.ordre - y.ordre);

      circuits.push({
        cle: `${niveau.id}|${b.circuit}|${idsMembres.slice().sort((x, y) => x - y).join(".")}`,
        label: b.label, nom, niveauId: niveau.id, niveauNom: niveau.nom || niveau.type,
        poste: `${PREFIXE_CIRCUIT}${nom} (${niveau.nom || niveau.type})`,
        couleur: couleurs.get(b.id) ?? "#666", icone: spec.icon, famille: b.circuit, estEclairage: eclairage,
        caracteristiques, resume, elements, guides, alertes, problemes: [],
      });
    });
  });

  // Rattache les contrôles du moteur (controlerCircuits) aux circuits concernés ; le reste est « hors circuit ».
  const idsParCircuit = circuits.map(c => ({
    c, ids: new Set(c.elements.filter(e => e.id.startsWith("a|")).map(e => Number(e.id.slice(2)))),
  }));
  bilan.problemes.forEach(p => {
    const cible = idsParCircuit.find(({ ids }) => p.appareilIds.some(id => ids.has(id)));
    if (cible) { cible.c.problemes.push(p); problemesAffectes.add(p); }
  });
  const problemesHorsCircuit = bilan.problemes.filter(p => !problemesAffectes.has(p));

  return { circuits, alertesPlan: resultat.alertes, problemesHorsCircuit, clesConnues, avertissements };
}

// ─── PROGRESSION ─────────────────────────────────────────────────────────────────────────────────────────────

export interface Progression { fait: number; total: number; pct: number }

export function progressionElements(elements: ElementSuivi[], coches: Record<string, string>): Progression {
  let fait = 0, total = 0;
  elements.forEach(e => e.etapes.forEach(et => { total++; if (coches[et.cle]) fait++; }));
  return { fait, total, pct: total === 0 ? 0 : Math.round((fait / total) * 100) };
}

/** Calcule le suivi depuis `projets.maison_config` (JSON brut), avec les mêmes migrations que l'éditeur de plan, dans le même ordre.
 *  null = pas de plan ; lève une exception si le JSON est illisible. */
export function suiviDepuisConfig(raw: string | null | undefined): SuiviPlan | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.niveaux) || parsed.niveaux.length === 0) return null;
  const { niveaux: apresMurs } = migrerModeleMurs(parsed.niveaux);
  migrerBoitesDerivation(apresMurs);
  reamorcerCompteurId(apresMurs);
  const { niveaux } = dedupliquerIds(apresMurs);
  return construireSuivi(niveaux);
}

export function progressionPlan(suivi: SuiviPlan, coches: Record<string, string>): Progression {
  return progressionElements(suivi.circuits.flatMap(c => c.elements), coches);
}

export function clesDuCircuit(c: CircuitSuivi): string[] {
  return c.elements.flatMap(e => e.etapes.map(et => et.cle));
}

/** Coches enregistrées qui ne correspondent plus à aucun élément du plan (élément supprimé, circuit recomposé). */
export function cochesOrphelines(suivi: SuiviPlan, coches: Record<string, string>): string[] {
  return Object.keys(coches).filter(k => !suivi.clesConnues.has(k));
}
