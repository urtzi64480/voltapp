// src/lib/tableau-reel.ts
//
// TABLEAU RÉALISTE : à partir des rangées du tableau (BreakerRow[] — celles produites par assemblerTableau ou éditées à la main),
// reconstitue le tableau PHYSIQUE « comme devant soi » : rails en modules de 17,5 mm, différentiels, départs, réserve, hauteur des
// manettes, coffret, GTL, liaisons phase/neutre/terre depuis l'arrivée du coffret jusqu'à chaque départ et chaque gaine, contrôles NF C 15-100.
// Fonctions pures, sans état. Règle d'or : la norme ALERTE, elle ne bloque jamais (voir normes-nfc.ts pour les sources / statuts).

import type { Breaker, BreakerRow } from "./electrical-constants";
import { BREAKER_TYPES, CIRCUITS, DIFF_HIERARCHY, estAccessoireTableau, estCircuitSansDisjoncteur, largeurAppareil } from "./electrical-constants";
import { NORME_COFFRET, NORME_GTL, NORME_PARAFOUDRE, NORME_TABLEAU, sectionPE, type StatutNorme } from "./normes-nfc";

export interface ParamsGtl {
  largeurMm: number;
  profondeurMm: number;
  /** Espace technique électrique du logement (ETEL) : largeur = GTL + 100 mm. */
  etel: boolean;
  /** Largeur du coffret de communication placé dans la GTL (0 = absent, ex. déjà ailleurs). */
  largeurCoffretCommMm: number;
  /** « empile » : coffret et coffret de communication l'un au-dessus de l'autre (largeur = le plus large) ; « cote_a_cote » : côte à côte (largeurs additionnées). */
  agencement: "empile" | "cote_a_cote";
  hauteurCoffretCommMm: number;
  couchesGaines: number;
  diametreGaineMm: number;
  hauteurSousPlafondM: number;
  /** Jeu de séparation entre éléments (mm). */
  jeuMm: number;
}

export interface ParamsTableauReel {
  modulesParRail: number;
  pasRangeeMm: number;
  collectif: boolean;
  /** Surface habitable (m²) — sert uniquement au conseil sur le nombre de rangées. */
  surfaceM2?: number;
  /** Tableau derrière une porte (manettes 0,50 m mini) ou à découvert (0,90 m mini). */
  porte: boolean;
  /** Logement accessible PMR : manettes entre 0,90 et 1,30 m. */
  pmr: boolean;
  /** Hauteur (m) de la manette de la rangée la plus basse. */
  basManetteM: number;
  coupureGenerale: boolean;
  parafoudre: boolean;
  /** Le projet impose le parafoudre (zone AQ2, paratonnerre < 50 m, alimentation aérienne…). */
  parafoudreRequis: boolean;
  /** Phase du réseau — repris par défaut du raccordement. */
  couleurPhase: string;
  gtl: ParamsGtl;
}

export const PARAMS_GTL_DEFAUT: ParamsGtl = {
  largeurMm: NORME_GTL.largeurMiniMm.valeur, profondeurMm: NORME_GTL.profondeurMiniMm.valeur, etel: false,
  largeurCoffretCommMm: NORME_COFFRET.largeurCoffretCommunicationMm.valeur,
  agencement: "empile", hauteurCoffretCommMm: NORME_COFFRET.hauteurCoffretCommunicationMm.valeur,
  couchesGaines: NORME_COFFRET.couchesGainesMax.valeur, diametreGaineMm: NORME_COFFRET.diametreGaineExtMm.valeur,
  hauteurSousPlafondM: 2.5, jeuMm: 20,
};

export const PARAMS_TABLEAU_REEL_DEFAUT: ParamsTableauReel = {
  modulesParRail: 18, pasRangeeMm: NORME_COFFRET.pasRangeeMm.valeur, collectif: false, porte: true, pmr: false, basManetteM: 1.0,
  coupureGenerale: false, parafoudre: false, parafoudreRequis: false, couleurPhase: "rouge", gtl: PARAMS_GTL_DEFAUT,
};

/** Fusion profonde des réglages enregistrés avec les défauts (réglages anciens / partiels / corrompus tolérés). */
export function fusionnerParamsTableau(p?: Partial<ParamsTableauReel> | null): ParamsTableauReel {
  const d = PARAMS_TABLEAU_REEL_DEFAUT;
  const num = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) ? v : def);
  const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
  const g: Partial<ParamsGtl> = p?.gtl ?? {};
  return {
    modulesParRail: Math.max(4, Math.round(num(p?.modulesParRail, d.modulesParRail))),
    pasRangeeMm: Math.max(50, num(p?.pasRangeeMm, d.pasRangeeMm)),
    collectif: bool(p?.collectif, d.collectif), surfaceM2: typeof p?.surfaceM2 === "number" && p.surfaceM2 > 0 ? p.surfaceM2 : undefined,
    porte: bool(p?.porte, d.porte), pmr: bool(p?.pmr, d.pmr), basManetteM: num(p?.basManetteM, d.basManetteM),
    coupureGenerale: bool(p?.coupureGenerale, d.coupureGenerale), parafoudre: bool(p?.parafoudre, d.parafoudre),
    parafoudreRequis: bool(p?.parafoudreRequis, d.parafoudreRequis),
    couleurPhase: typeof p?.couleurPhase === "string" && p.couleurPhase ? p.couleurPhase : d.couleurPhase,
    gtl: {
      largeurMm: num(g.largeurMm, d.gtl.largeurMm), profondeurMm: num(g.profondeurMm, d.gtl.profondeurMm), etel: bool(g.etel, d.gtl.etel),
      largeurCoffretCommMm: Math.max(0, num(g.largeurCoffretCommMm, d.gtl.largeurCoffretCommMm)),
      agencement: g.agencement === "cote_a_cote" ? "cote_a_cote" : "empile",
      hauteurCoffretCommMm: Math.max(0, num(g.hauteurCoffretCommMm, d.gtl.hauteurCoffretCommMm)),
      couchesGaines: Math.max(1, Math.round(num(g.couchesGaines, d.gtl.couchesGaines))),
      diametreGaineMm: Math.max(8, num(g.diametreGaineMm, d.gtl.diametreGaineMm)),
      hauteurSousPlafondM: num(g.hauteurSousPlafondM, d.gtl.hauteurSousPlafondM), jeuMm: Math.max(0, num(g.jeuMm, d.gtl.jeuMm)),
    },
  };
}

// ─── Modèle de sortie ─────────────────────────────────────────────────────────────────────────────────────────────
export type NiveauControle = "erreur" | "avertissement" | "info";
export interface ControleNF { id: string; niveau: NiveauControle; titre: string; detail: string; source: string; statut: StatutNorme; rangee?: number; breakerId?: number }

export interface DepartReel {
  breakerId: number;
  label: string;
  circuit: string;
  amperes: number;
  type: string;
  /** Section du câble de départ (mm², nombre). */
  sectionMm2: number;
  modules: number;
  /** Position (en modules, depuis la gauche du rail, ID compris). */
  positionModule: number;
  rangee: number;
  /** Identifiant de gaine (option « gaines optimisées »), sinon une gaine par départ. */
  gaineId: string;
  accessoire: boolean;
}

export interface RailReel {
  index: number;
  nom: string;
  rangeeId: number;
  diffType: string;
  calibreId: number | null;
  capaciteModules: number;
  modulesId: number;
  modulesDeparts: number;
  modulesUtilises: number;
  modulesLibres: number;
  nbCircuits: number;
  departs: DepartReel[];
  hauteurManetteM: number;
  depassement: boolean;
}

export interface Conducteur { role: "phase" | "neutre" | "terre"; couleur: string; sectionMm2: number }
export interface LiaisonReelle { id: string; de: string; vers: string; calibreA: number | null; conducteurs: Conducteur[]; longueurM?: number; rangee?: number; breakerId?: number }

export interface GtlReelle {
  largeurRequiseMm: number;
  largeurRetenueMm: number;
  largeurEtelMm: number | null;
  profondeurMm: number;
  hauteurM: number;
  composants: { nom: string; largeurMm: number; hauteurMm: number; detail: string }[];
  hauteurRequiseMm: number;
  hauteurDisponibleMm: number;
  nbGaines: number;
  largeurGainesMm: number;
}

/** Une gaine qui arrive à la GTL : position dans la zone de passage (x depuis le bord gauche de la zone), couche (0 = devant). */
export interface GaineGtl { id: string; diametreMm: number; couche: number; xMm: number; nbCircuits: number; depart: boolean }

export interface CoffretReel { largeurMm: number; hauteurMm: number; nbRangees: number; modulesParRail: number }

export interface ResultatTableauReel {
  rails: RailReel[];
  coffret: CoffretReel;
  gtl: GtlReelle;
  /** Gaines de la GTL, positionnées (voir GtlReelle.largeurGainesMm). */
  gaines: GaineGtl[];
  liaisons: LiaisonReelle[];
  controles: ControleNF[];
  totaux: { circuits: number; differentiels: number; modulesUtilises: number; modulesLibres: number; capacite: number; reservePct: number; reserveRequisePct: number };
  gainesParDepart: number;
  nbRangeesConseille: number | null;
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────────────────────────────────────────
export const sectionDe = (b: Breaker): number => {
  const s = parseFloat(String(b.customSection ?? CIRCUITS[b.circuit]?.section ?? "0"));
  return Number.isFinite(s) ? s : 0;
};

/** Section minimale par calibre (infographie Legrand : 16 A→1,5 · 20 A→2,5 · 32 A→6). Au-delà de 32 A : proportionnel usuel. */
export function sectionMiniPourCalibre(a: number): number {
  if (a <= 16) return 1.5;
  if (a <= 20) return 2.5;
  if (a <= 25) return 4;
  if (a <= 32) return 6;
  if (a <= 40) return 10;
  return 16;
}

const estId = (b: Breaker | null | undefined): boolean => !!b && !!BREAKER_TYPES[b.type]?.isDiff;
const diffTypeDe = (b: Breaker): string => BREAKER_TYPES[b.type]?.diffType ?? "AC";

/** Nombre de rangées conseillé selon la surface (Legrand, à vérifier). */
export function rangeesConseillees(surfaceM2: number | undefined): number | null {
  if (!surfaceM2 || surfaceM2 <= 0) return null;
  const r = NORME_TABLEAU.rangeesConseillees.valeur;
  return surfaceM2 < 35 ? r.moins35 : surfaceM2 <= 100 ? r.de35a100 : r.plus100;
}

/** Diamètre extérieur (mm) d'une gaine à partir de son libellé « ICTA 25 », « IRL 20 verte »… ; défaut si illisible. */
export function diametreGaineDeLibelle(libelle: string | undefined, def: number): number {
  const m = libelle?.match(/(\d{2})/);
  return m ? parseInt(m[1], 10) : def;
}

/** Courant d'emploi d'un jeu de départs : chauffage / chauffe-eau / recharge VE à 100 %, les autres circuits au coefficient de simultanéité de la norme. */
function demandeInstallation(breakers: Breaker[]): { courantEmploiA: number } {
  const PLEINE = new Set(["chauffe_eau", "irve"]);
  let pleine = 0, autres = 0;
  breakers.forEach(b => {
    if (estCircuitSansDisjoncteur(b) || b.circuit === "general" || b.amperes <= 0) return;
    if (CIRCUITS[b.circuit]?.category === "chauffage" || PLEINE.has(b.circuit)) pleine += b.amperes; else autres += b.amperes;
  });
  return { courantEmploiA: pleine + autres * NORME_TABLEAU.coefAutresCircuits.valeur };
}

/** Section (mm²) des conducteurs d'arrivée du coffret (coupure générale → répartiteur). */
const NORME_TABLEAU_LIAISON_MM2 = 10;

export interface OptionsCalculTableau {
  params?: Partial<ParamsTableauReel> | null;
  /** breakerId → identifiant de gaine (option « gaines optimisées »). */
  gaineDeBreaker?: Record<number, string>;
  /** Diamètre extérieur (mm) de chaque gaine du tableau, par identifiant. Défaut : params.gtl.diametreGaineMm. */
  diametreGaines?: Record<string, number>;
  /** Gaines qui arrivent au tableau sans être rattachées à un départ (montées vers d'autres niveaux…) : diamètres extérieurs (mm). */
  gainesSupplementairesMm?: number[];
}

// ─── Calcul principal ─────────────────────────────────────────────────────────────────────────────────────────────
export function calculerTableauReel(rows: BreakerRow[], opts: OptionsCalculTableau = {}): ResultatTableauReel {
  const p = fusionnerParamsTableau(opts.params);
  const controles: ControleNF[] = [];
  const add = (c: ControleNF) => controles.push(c);
  const rails: RailReel[] = [];
  const tousBreakers: Breaker[] = [];
  const phaseCoul = p.couleurPhase;

  const rowsPuissance = rows.filter(r => r.kind !== "multimedia");
  rowsPuissance.forEach((row, index) => {
    const slots = row.slots ?? [];
    const id = slots.find(b => b != null && estId(b)) ?? null;
    const departsBruts: { b: Breaker; slot: number }[] = [];
    slots.forEach((b, i) => { if (b && !estId(b) && b.type) departsBruts.push({ b, slot: i }); });
    const modulesId = id ? Math.max(1, BREAKER_TYPES[id.type]?.width ?? 2) : 0;
    let curseur = modulesId;
    const departs: DepartReel[] = [];
    departsBruts.sort((a, b) => a.slot - b.slot).forEach(({ b }) => {
      const modules = largeurAppareil(b);
      const accessoire = estAccessoireTableau(b);
      if (!accessoire) tousBreakers.push(b);
      departs.push({
        breakerId: b.id, label: b.label || CIRCUITS[b.circuit]?.label || b.circuit, circuit: b.circuit, amperes: b.amperes, type: b.type,
        sectionMm2: sectionDe(b), modules, positionModule: curseur, rangee: index,
        gaineId: opts.gaineDeBreaker?.[b.id] ?? `dep-${b.id}`, accessoire,
      });
      curseur += modules;
    });
    const modulesDeparts = departs.reduce((s, d) => s + d.modules, 0);
    const utilises = modulesId + modulesDeparts;
    const manette = p.basManetteM + (rowsPuissance.length - 1 - index) * (p.pasRangeeMm / 1000); // rangée 0 = tout en haut
    rails.push({
      index, nom: row.name || `Rangée ${index + 1}`, rangeeId: row.id, diffType: id ? diffTypeDe(id) : "—", calibreId: id?.amperes ?? null,
      capaciteModules: p.modulesParRail, modulesId, modulesDeparts, modulesUtilises: utilises, modulesLibres: Math.max(0, p.modulesParRail - utilises),
      nbCircuits: departs.filter(d => !d.accessoire).length, departs, hauteurManetteM: manette, depassement: utilises > p.modulesParRail,
    });
  });

  const nbRangees = rails.length;
  const capacite = rails.reduce((s, r) => s + r.capaciteModules, 0);
  const utilises = rails.reduce((s, r) => s + r.modulesUtilises, 0);
  const modulesPara = p.parafoudre ? NORME_TABLEAU.modulesParafoudre.valeur : 0;
  const modulesSect = p.coupureGenerale ? NORME_TABLEAU.modulesSectionneur.valeur : 0;
  const libres = Math.max(0, capacite - utilises);
  const reservePct = capacite > 0 ? (100 * libres) / capacite : 0;
  const reserveRequisePct = p.collectif ? (capacite > 0 ? (100 * NORME_GTL.reserveModulesCollectif.valeur) / capacite : 0) : NORME_GTL.reservePctMaison.valeur;
  const nbId = rails.filter(r => r.calibreId != null).length;

  // ── Gaines
  const gainesIds = new Set<string>();
  rails.forEach(r => r.departs.forEach(d => { if (!d.accessoire) gainesIds.add(d.gaineId); }));
  const nbGaines = gainesIds.size + (opts.gainesSupplementairesMm?.length ?? 0);
  const nbCircuitsTotal = rails.reduce((s, r) => s + r.nbCircuits, 0);
  let largeurGainesMm = 0;
  const gaines: GaineGtl[] = [];
  {
    const nbParGaine = new Map<string, number>();
    rails.forEach(r => r.departs.forEach(d => { if (!d.accessoire) nbParGaine.set(d.gaineId, (nbParGaine.get(d.gaineId) ?? 0) + 1); }));
    const liste = [
      ...[...gainesIds].map(g => ({ id: g, diametreMm: opts.diametreGaines?.[g] ?? p.gtl.diametreGaineMm, nbCircuits: nbParGaine.get(g) ?? 0, depart: true })),
      ...(opts.gainesSupplementairesMm ?? []).map((dm, i) => ({ id: `montee-sup-${i}`, diametreMm: dm, nbCircuits: 0, depart: false })),
    ].sort((a, b) => b.diametreMm - a.diametreMm);
    const couches = Math.max(1, p.gtl.couchesGaines);
    const colonnes: number[] = Array(couches).fill(0);
    // remplissage glouton : chaque gaine va sur la couche la moins large
    liste.forEach(g => {
      let k = 0; colonnes.forEach((c, i) => { if (c < colonnes[k]) k = i; });
      gaines.push({ ...g, couche: k, xMm: colonnes[k] });
      colonnes[k] += g.diametreMm + p.gtl.jeuMm / 4;
    });
    largeurGainesMm = Math.ceil(Math.max(0, ...colonnes));
  }

  // ── Coffret
  const coffretLargeur = Math.ceil(p.modulesParRail * NORME_GTL.moduleMm.valeur + 2 * NORME_COFFRET.margeLateraleMm.valeur);
  const coffretHauteur = nbRangees * p.pasRangeeMm + NORME_COFFRET.margeHauteBasseMm.valeur;
  const coffret: CoffretReel = { largeurMm: coffretLargeur, hauteurMm: coffretHauteur, nbRangees, modulesParRail: p.modulesParRail };

  // ── GTL
  const composants = [
    { nom: "Coffret de distribution", largeurMm: coffretLargeur, hauteurMm: coffretHauteur, detail: `${p.modulesParRail} modules × 17,5 mm, ${nbRangees} rangée(s)` },
    ...(p.gtl.largeurCoffretCommMm > 0 ? [{ nom: "Coffret de communication", largeurMm: p.gtl.largeurCoffretCommMm, hauteurMm: p.gtl.hauteurCoffretCommMm, detail: "Grade VDI" }] : []),
  ];
  const jeu = p.gtl.jeuMm;
  const empile = p.gtl.agencement === "empile";
  const largeurBoitiers = composants.length === 0 ? 0
    : empile ? Math.max(...composants.map(c => c.largeurMm)) + 2 * jeu : composants.reduce((s, c) => s + c.largeurMm, 0) + jeu * (composants.length + 1);
  const hauteurRequise = empile ? composants.reduce((s, c) => s + c.hauteurMm, 0) + jeu * (composants.length + 1) : Math.max(0, ...composants.map(c => c.hauteurMm)) + 2 * jeu;
  const hauteurDispo = Math.max(0, p.gtl.hauteurSousPlafondM * 1000 - 2 * NORME_COFFRET.reserveHautBasGtlMm.valeur);
  const requise = largeurBoitiers + largeurGainesMm;
  const retenue = Math.max(p.gtl.largeurMm, NORME_GTL.largeurMiniMm.valeur);
  const gtl: GtlReelle = {
    largeurRequiseMm: Math.ceil(requise), largeurRetenueMm: retenue,
    largeurEtelMm: p.gtl.etel ? retenue + NORME_GTL.largeurEtelSupGtlMm.valeur : null,
    profondeurMm: p.gtl.profondeurMm, hauteurM: p.gtl.hauteurSousPlafondM,
    composants: [...composants, { nom: "Passage des gaines", largeurMm: largeurGainesMm, hauteurMm: 0, detail: `${nbGaines} gaine(s) sur ${p.gtl.couchesGaines} couche(s)` }],
    hauteurRequiseMm: Math.ceil(hauteurRequise), hauteurDisponibleMm: Math.floor(hauteurDispo), nbGaines, largeurGainesMm,
  };

  // ── Liaisons physiques
  const liaisons: LiaisonReelle[] = [];
  const sRac = NORME_TABLEAU_LIAISON_MM2;
  const cond = (s: number, pe = true): Conducteur[] => [
    { role: "phase", couleur: phaseCoul, sectionMm2: s }, { role: "neutre", couleur: "bleu", sectionMm2: s },
    ...(pe ? [{ role: "terre" as const, couleur: "vert/jaune", sectionMm2: sectionPE(s) }] : []),
  ];
  const peigne = nbId > 1;
  let amont = p.coupureGenerale ? "Coupure générale" : (peigne ? "Répartiteur" : "Arrivée");
  if (p.coupureGenerale) liaisons.push({ id: "sect-rep", de: "Coupure générale", vers: peigne ? "Répartiteur" : "Différentiel de tête", calibreA: null, conducteurs: cond(sRac) });
  if (p.parafoudre) liaisons.push({ id: "parafoudre", de: peigne ? "Répartiteur" : "Arrivée", vers: "Parafoudre (+ disjoncteur de déconnexion)", calibreA: 20, conducteurs: [{ role: "phase", couleur: phaseCoul, sectionMm2: 10 }, { role: "neutre", couleur: "bleu", sectionMm2: 10 }, { role: "terre", couleur: "vert/jaune", sectionMm2: 10 }] });
  rails.forEach(r => {
    if (r.calibreId == null) return;
    const sId = r.calibreId >= 63 ? 10 : r.calibreId >= 40 ? 10 : 6;
    liaisons.push({ id: `rail-${r.index}`, de: peigne ? "Répartiteur" : amont, vers: `Différentiel ${r.nom} (${r.calibreId} A type ${r.diffType})`, calibreA: r.calibreId, conducteurs: cond(sId, false), rangee: r.index });
    r.departs.forEach(d => {
      if (d.accessoire) return;
      const s = d.sectionMm2 || sectionMiniPourCalibre(d.amperes);
      liaisons.push({ id: `dep-${d.breakerId}`, de: `${r.nom} · peigne`, vers: `${d.label} → gaine ${d.gaineId}`, calibreA: d.amperes, conducteurs: cond(s), rangee: r.index, breakerId: d.breakerId });
    });
  });

  // ── Contrôles NF C 15-100 (alertes, jamais bloquantes)
  const srcTab = NORME_TABLEAU.idMiniParLogement.source;
  if (nbRangees === 0) add({ id: "vide", niveau: "info", titre: "Tableau vide", detail: "Aucune rangée : générez les circuits dans le plan ou ajoutez des rangées dans le module Tableau.", source: srcTab, statut: "verifie" });
  if (nbRangees > 0 && nbId < NORME_TABLEAU.idMiniParLogement.valeur) add({ id: "id-mini", niveau: "avertissement", titre: `Seulement ${nbId} différentiel(s) 30 mA`, detail: `Il en faut ${NORME_TABLEAU.idMiniParLogement.valeur} au minimum par logement.`, source: srcTab, statut: NORME_TABLEAU.idMiniParLogement.statut });
  const nbTypeA = rails.filter(r => r.diffType === "A" || r.diffType === "F").length;
  if (nbRangees > 0 && nbTypeA < NORME_TABLEAU.idTypeAMini.valeur) add({ id: "id-type-a", niveau: "avertissement", titre: "Aucun différentiel de type A", detail: "Au moins un différentiel de type A est exigé (plaque de cuisson, lave-linge, recharge VE).", source: NORME_TABLEAU.idTypeAMini.source, statut: NORME_TABLEAU.idTypeAMini.statut });
  rails.forEach(r => {
    const nom = r.nom;
    if (r.calibreId == null && r.departs.length > 0) add({ id: `sans-id-${r.index}`, niveau: "erreur", titre: `${nom} : pas de différentiel`, detail: "Des disjoncteurs sont posés sans interrupteur différentiel en tête de rangée.", source: srcTab, statut: "verifie", rangee: r.index });
    if (r.nbCircuits > NORME_TABLEAU.circuitsMaxParId.valeur) add({ id: `max-id-${r.index}`, niveau: "avertissement", titre: `${nom} : ${r.nbCircuits} circuits sur un différentiel`, detail: `Maximum ${NORME_TABLEAU.circuitsMaxParId.valeur} circuits par interrupteur différentiel.`, source: NORME_TABLEAU.circuitsMaxParId.source, statut: NORME_TABLEAU.circuitsMaxParId.statut, rangee: r.index });
    if (r.depassement) add({ id: `depasse-${r.index}`, niveau: "avertissement", titre: `${nom} : ${r.modulesUtilises} modules pour un rail de ${r.capaciteModules}`, detail: "Rail trop court : passer à un coffret plus large ou répartir sur une rangée de plus.", source: NORME_TABLEAU.modulesParRailPossibles.source, statut: NORME_TABLEAU.modulesParRailPossibles.statut, rangee: r.index });
    // Type de différentiel suffisant pour chaque départ
    r.departs.forEach(d => {
      if (d.accessoire) return;
      const requis = CIRCUITS[d.circuit]?.diffType;
      if (requis && DIFF_HIERARCHY[requis] != null && DIFF_HIERARCHY[r.diffType] != null && DIFF_HIERARCHY[r.diffType] < DIFF_HIERARCHY[requis]) {
        add({ id: `type-${d.breakerId}`, niveau: "avertissement", titre: `${d.label} : différentiel type ${r.diffType} insuffisant`, detail: `Ce circuit demande un différentiel de type ${requis} (ou supérieur).`, source: "NF C 15-100 / infographie Legrand (types AC, A, F)", statut: "verifie", rangee: r.index, breakerId: d.breakerId });
      }
      const mini = sectionMiniPourCalibre(d.amperes);
      if (d.sectionMm2 > 0 && d.sectionMm2 + 1e-9 < mini) add({ id: `section-${d.breakerId}`, niveau: "erreur", titre: `${d.label} : ${d.sectionMm2} mm² pour ${d.amperes} A`, detail: `Section minimale ${mini} mm² pour un disjoncteur ${d.amperes} A (16 A→1,5 · 20 A→2,5 · 32 A→6 mm²).`, source: "Infographie Legrand « circuits spécialisés »", statut: "verifie", rangee: r.index, breakerId: d.breakerId });
    });
    // Calibre du différentiel (règle : chauffage/chauffe-eau/VE à 100 %, le reste à 50 %)
    if (r.calibreId != null) {
      const dem = demandeInstallation(r.departs.filter(d => !d.accessoire).map(d => ({ id: d.breakerId, label: d.label, circuit: d.circuit, amperes: d.amperes, type: d.type, pieces: [] } as Breaker)));
      if (r.calibreId + 1e-9 < dem.courantEmploiA) add({ id: `calibre-id-${r.index}`, niveau: "avertissement", titre: `${nom} : différentiel ${r.calibreId} A < charge ${dem.courantEmploiA.toFixed(0)} A`, detail: "Le calibre du différentiel doit couvrir le chauffage, le chauffe-eau et la recharge VE à 100 % plus la moitié des autres circuits.", source: NORME_TABLEAU.coefAutresCircuits.source, statut: NORME_TABLEAU.coefAutresCircuits.statut, rangee: r.index });
    }
    // Hauteur des manettes
    const mini = p.pmr ? 0.9 : p.porte ? NORME_GTL.manetteMiniAvecPorteM.valeur : NORME_GTL.manetteMiniSansPorteM.valeur;
    const maxi = p.pmr ? NORME_GTL.pmrMaxiM.valeur : NORME_GTL.manetteMaxiM.valeur;
    if (r.hauteurManetteM + 1e-9 < mini || r.hauteurManetteM - 1e-9 > maxi) {
      add({ id: `hauteur-${r.index}`, niveau: "avertissement", titre: `${nom} : manettes à ${r.hauteurManetteM.toFixed(2)} m`, detail: `Hors de la plage ${mini.toFixed(2)}–${maxi.toFixed(2)} m (${p.pmr ? "PMR" : p.porte ? "avec porte" : "sans porte"}).`, source: p.pmr ? NORME_GTL.pmrMaxiM.source : NORME_GTL.manetteMaxiM.source, statut: "verifie", rangee: r.index });
    } else if (p.porte && !p.pmr && r.hauteurManetteM < NORME_GTL.manetteMiniSansPorteM.valeur) {
      add({ id: `hauteur-porte-${r.index}`, niveau: "info", titre: `${nom} : manettes à ${r.hauteurManetteM.toFixed(2)} m`, detail: "Sous 0,90 m, la rangée doit rester derrière une porte (partie 0,50–0,90 m atteignable par une porte).", source: NORME_GTL.manetteMiniAvecPorteM.source, statut: "verifie", rangee: r.index });
    }
  });

  // Réserve
  const reserveSource = p.collectif ? NORME_GTL.reserveModulesCollectif.source : NORME_GTL.reservePctMaison.source;
  if (nbRangees > 0 && reservePct + 1e-9 < reserveRequisePct) add({ id: "reserve", niveau: "avertissement", titre: `Réserve ${reservePct.toFixed(0)} % < ${reserveRequisePct.toFixed(0)} % requis`, detail: p.collectif ? `${NORME_GTL.reserveModulesCollectif.valeur} modules libres au minimum.` : `20 % de modules libres pour les extensions futures : ajouter une rangée ou un coffret plus large.`, source: reserveSource, statut: "verifie" });
  const conseil = rangeesConseillees(p.surfaceM2);
  if (conseil != null && nbRangees > 0 && nbRangees < conseil) add({ id: "rangees-conseil", niveau: "info", titre: `${nbRangees} rangée(s) pour ${p.surfaceM2} m²`, detail: `Conseil constructeur : ${conseil} rangées.`, source: NORME_TABLEAU.rangeesConseillees.source, statut: NORME_TABLEAU.rangeesConseillees.statut });

  // Parafoudre
  if (p.parafoudreRequis && !p.parafoudre) add({ id: "parafoudre", niveau: "avertissement", titre: "Parafoudre requis", detail: NORME_PARAFOUDRE.obligatoireSi.valeur.join(" · "), source: NORME_PARAFOUDRE.obligatoireSi.source, statut: NORME_PARAFOUDRE.obligatoireSi.statut });
  if (p.parafoudre && libres < modulesPara + modulesSect) add({ id: "para-place", niveau: "avertissement", titre: "Pas de place pour le parafoudre / la coupure générale", detail: `${modulesPara + modulesSect} module(s) nécessaires dans le coffret.`, source: NORME_TABLEAU.modulesParafoudre.source, statut: "a_verifier" });

  // GTL
  if (p.gtl.largeurMm + 1e-9 < NORME_GTL.largeurMiniMm.valeur) add({ id: "gtl-largeur", niveau: "avertissement", titre: `GTL de ${p.gtl.largeurMm} mm < ${NORME_GTL.largeurMiniMm.valeur} mm`, detail: "Largeur minimale de la GTL : 60 cm.", source: NORME_GTL.largeurMiniMm.source, statut: "verifie" });
  if (p.gtl.profondeurMm + 1e-9 < NORME_GTL.profondeurMiniMm.valeur) add({ id: "gtl-prof", niveau: "avertissement", titre: `GTL de ${p.gtl.profondeurMm} mm de profondeur`, detail: "Profondeur minimale de la GTL : 25 cm.", source: NORME_GTL.profondeurMiniMm.source, statut: "verifie" });
  if (gtl.largeurRequiseMm > retenue) add({ id: "gtl-requise", niveau: "avertissement", titre: `GTL trop étroite : ${gtl.largeurRequiseMm} mm nécessaires`, detail: `Composants + gaines (${nbGaines} gaine(s)) > ${retenue} mm. Élargir la GTL, passer en ETEL, optimiser les gaines ou réduire la largeur du coffret.`, source: NORME_GTL.largeurEtelSupGtlMm.source, statut: "verifie" });
  if (hauteurRequise > hauteurDispo + 1e-9) add({ id: "gtl-hauteur-requise", niveau: "avertissement", titre: `GTL trop basse : ${gtl.hauteurRequiseMm} mm nécessaires`, detail: `Éléments empilés > ${gtl.hauteurDisponibleMm} mm utiles. Passer en agencement côte à côte (GTL plus large) ou ETEL.`, source: NORME_GTL.hauteur.source, statut: "a_verifier" });
  if (p.gtl.hauteurSousPlafondM + 1e-9 < NORME_COFFRET.hauteurSousPlafondMiniM.valeur) add({ id: "gtl-hauteur", niveau: "info", titre: `Hauteur GTL ${p.gtl.hauteurSousPlafondM} m`, detail: "La GTL va du sol au plafond.", source: NORME_GTL.hauteur.source, statut: "verifie" });

  const totaux = { circuits: nbCircuitsTotal, differentiels: nbId, modulesUtilises: utilises, modulesLibres: libres, capacite, reservePct, reserveRequisePct };
  return { rails, coffret, gtl, gaines, liaisons, controles, totaux, gainesParDepart: nbCircuitsTotal > 0 ? nbGaines / nbCircuitsTotal : 0, nbRangeesConseille: conseil };
}
