// src/lib/tableau-ia.ts
//
// OUTIL IA « photos du tableau → tableau refait à la norme » — partie MÉTIER (fonctions pures, partagées client / serveur, aucun réseau).
//
// Principe : le modèle de vision ne fait QUE LIRE les photos (un « relevé » brut : rangées, différentiels, disjoncteurs, étiquettes).
// Tout ce qui touche à la norme est refait ICI, de façon déterministe, avec les règles déjà utilisées dans l'application
// (electrical-constants, normes-nfc, tableau-reel, maison-engine.assemblerTableau) : aucune valeur normative n'est demandée à l'IA.
// Règle d'or du projet : la NF C 15-100 ALERTE, elle ne bloque jamais ; rien n'est appliqué au tableau sans clic de l'électricien.

import type { Breaker, BreakerRow } from "./electrical-constants";
import { CIRCUITS, emplacementsPourModules, largeurAppareil, premierEmplacementLibre, redimensionnerRangee, uid } from "./electrical-constants";
import { assemblerTableau, maxIdRows, remapperIdsRows } from "./maison-engine";
import { NORME_CIRCUITS, type StatutNorme } from "./normes-nfc";
import { calculerTableauReel, fusionnerParamsTableau, sectionMiniPourCalibre, type ParamsTableauReel, type ResultatTableauReel } from "./tableau-reel";

// ─── Usages (circuits) ────────────────────────────────────────────────────────────────────────────────────────────

export const USAGES = [
  "lumiere", "prises", "prises_cuisine", "plaque", "four", "lave_linge", "lave_vaisselle", "seche_linge", "chauffe_eau", "chauffage",
  "clim", "seche_serviette", "congelateur", "irve", "piscine", "vmc", "alarme", "volets_roulants", "exterieur", "garage", "autre",
] as const;
export type Usage = (typeof USAGES)[number];
export type UsageReleve = Usage | "inconnu";

interface RegleUsage { libelle: string; calibres: readonly number[]; defaut: number; cle: (calibreA: number) => string }
const fixe = (cle: string) => () => cle;

/** Calibres admis par usage (infographie Legrand « circuits spécialisés ») et clé du circuit correspondant dans CIRCUITS. */
export const REGLES_USAGE: Record<Usage, RegleUsage> = {
  lumiere:         { libelle: "Éclairage",              calibres: [10, 16],                     defaut: 10, cle: fixe("lumiere") },
  prises:          { libelle: "Prises de courant",      calibres: [16, 20],                     defaut: 16, cle: a => (a >= 20 ? "prise_20" : "prise_16") },
  prises_cuisine:  { libelle: "Prises de cuisine",      calibres: [20],                         defaut: 20, cle: fixe("cuisine_prises") },
  plaque:          { libelle: "Plaque de cuisson",      calibres: [32],                         defaut: 32, cle: fixe("plaque") },
  four:            { libelle: "Four",                   calibres: [20],                         defaut: 20, cle: fixe("four") },
  lave_linge:      { libelle: "Lave-linge",             calibres: [20],                         defaut: 20, cle: fixe("lave_linge") },
  lave_vaisselle:  { libelle: "Lave-vaisselle",         calibres: [20],                         defaut: 20, cle: fixe("lave_vaisselle") },
  seche_linge:     { libelle: "Sèche-linge",            calibres: [20],                         defaut: 20, cle: fixe("seche_linge") },
  chauffe_eau:     { libelle: "Chauffe-eau",            calibres: [20],                         defaut: 20, cle: fixe("chauffe_eau") },
  chauffage:       { libelle: "Chauffage électrique",   calibres: [16, 20],                     defaut: 16, cle: a => (a >= 20 ? "chauffage_20" : "chauffage_16") },
  clim:            { libelle: "Climatisation / PAC",    calibres: [20],                         defaut: 20, cle: fixe("clim") },
  seche_serviette: { libelle: "Sèche-serviette",        calibres: [16],                         defaut: 16, cle: fixe("seche_serviette") },
  congelateur:     { libelle: "Congélateur",            calibres: [20],                         defaut: 20, cle: fixe("congelateur") },
  irve:            { libelle: "Recharge véhicule (IRVE)", calibres: [20, 32],                   defaut: 32, cle: fixe("irve") },
  piscine:         { libelle: "Piscine / pompe",        calibres: [20],                         defaut: 20, cle: fixe("piscine") },
  vmc:             { libelle: "VMC",                    calibres: [2, 6, 10, 16],               defaut: 10, cle: fixe("vmc") },
  alarme:          { libelle: "Alarme",                 calibres: [2, 6, 10, 16],               defaut: 6,  cle: fixe("alarme") },
  volets_roulants: { libelle: "Volets roulants",        calibres: [10, 16],                     defaut: 16, cle: fixe("volets_roulants") },
  exterieur:       { libelle: "Extérieur",              calibres: [16, 20],                     defaut: 16, cle: fixe("exterieur") },
  garage:          { libelle: "Garage / atelier",       calibres: [16, 20],                     defaut: 16, cle: fixe("garage") },
  autre:           { libelle: "Autre circuit",          calibres: [2, 6, 10, 16, 20, 25, 32, 40], defaut: 16, cle: fixe("autre") },
};
export const OPTIONS_USAGE: { usage: Usage; label: string }[] = USAGES.map(u => ({ usage: u, label: REGLES_USAGE[u].libelle }));

/** Circuits « spécialisés » comptés pour la règle des 3 circuits minimum (infographie Legrand). */
export const USAGES_SPECIALISES: readonly Usage[] = ["lave_linge", "lave_vaisselle", "seche_linge", "four", "congelateur"];

const sansAccent = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Ordre important : le plus spécifique d'abord (« prises cuisine » avant « prises », « sèche-serviette » avant « sèche-linge »…).
const MOTS_USAGE: { usage: Usage; re: RegExp }[] = [
  { usage: "plaque", re: /\b(plaques?|cuisson|induction|vitroceram\w*|table de cuisson)\b/ },
  { usage: "seche_serviette", re: /\b(seche serviettes?|serviettes?)\b/ },
  { usage: "seche_linge", re: /\b(seche linge|sl)\b/ },
  { usage: "lave_vaisselle", re: /\b(lave vaisselle|lv)\b/ },
  { usage: "lave_linge", re: /\b(lave linge|ll|machine a laver)\b/ },
  { usage: "four", re: /\b(fours?|micro ondes?)\b/ },
  { usage: "chauffe_eau", re: /\b(chauffe eau|cumulus|ballon|ce|eau chaude|ecs)\b/ },
  { usage: "clim", re: /\b(clim\w*|pac|pompe a chaleur)\b/ },
  { usage: "piscine", re: /\b(piscine|spa|jacuzzi)\b/ },
  { usage: "congelateur", re: /\b(congel\w*)\b/ },
  { usage: "irve", re: /\b(irve|borne|wallbox|recharge\w*|vehicule|voiture)\b/ },
  { usage: "vmc", re: /\b(vmc|ventilation)\b/ },
  { usage: "alarme", re: /\b(alarme|sirene|detecteurs? fumee|daaf)\b/ },
  { usage: "volets_roulants", re: /\b(volets?|stores?|bso|brise soleil)\b/ },
  { usage: "chauffage", re: /\b(chauffage|convecteurs?|radiateurs?|rayonnants?|plancher chauffant|chauff\w*)\b/ },
  { usage: "prises_cuisine", re: /\b(prises? cuisine|cuisine prises?|plan de travail)\b/ },
  { usage: "garage", re: /\b(garage|atelier|cave)\b/ },
  { usage: "exterieur", re: /\b(exterieur\w*|jardin|terrasse|portail|abri)\b/ },
  { usage: "lumiere", re: /\b(lumieres?|eclairage\w*|luminaires?|spots?|plafonniers?|appliques?|lampes?)\b/ },
  { usage: "prises", re: /\b(prises?|pc|socles?|pdc)\b/ },
];

/** Usage d'un circuit déduit de son étiquette (« LL », « Plaque cuisson », « Convecteurs chambres »…), ou null si rien de reconnaissable. */
export function usageDepuisEtiquette(etiquette: string): Usage | null {
  const t = sansAccent(etiquette);
  if (!t) return null;
  return MOTS_USAGE.find(m => m.re.test(t))?.usage ?? null;
}

// ─── Calibre et section conformes ─────────────────────────────────────────────────────────────────────────────────

export function calibreConforme(usage: Usage, lu: number | null): { calibre: number; modifie: boolean; illisible: boolean } {
  const regle = REGLES_USAGE[usage];
  if (lu == null) return { calibre: regle.defaut, modifie: false, illisible: true };
  if (regle.calibres.includes(lu)) return { calibre: lu, modifie: false, illisible: false };
  const dessous = regle.calibres.filter(c => c <= lu);
  return { calibre: dessous.length > 0 ? Math.max(...dessous) : regle.defaut, modifie: true, illisible: false };
}

export interface DecisionCircuit {
  cle: string;
  calibreA: number;
  sectionMm2: number;
  calibreModifie: boolean;
  calibreIllisible: boolean;
  /** Le câble observé est trop petit pour le calibre requis et aucun calibre admis ne le protège : câble à remplacer. */
  cableANeuf: boolean;
  /** Le calibre a été abaissé pour protéger le câble observé (plutôt que de recâbler). */
  calibreAbaisseParCable: boolean;
}

/** Calibre, section et circuit retenus pour un circuit lu sur photo. La section lue (étiquette de câble visible) prime sur le minimum de la norme. */
export function decider(usage: Usage, calibreLu: number | null, sectionLueMm2: number | null): DecisionCircuit {
  const regle = REGLES_USAGE[usage];
  const base = calibreConforme(usage, calibreLu);
  let calibre = base.calibre;
  let sectionMm2 = sectionMiniPourCalibre(calibre);
  let cableANeuf = false, abaisse = false;
  if (sectionLueMm2 != null && sectionLueMm2 > 0) {
    if (sectionLueMm2 + 1e-9 < sectionMm2) {
      const adapte = [...regle.calibres].sort((a, b) => b - a).find(c => c <= calibre && sectionMiniPourCalibre(c) <= sectionLueMm2 + 1e-9);
      if (adapte != null) { calibre = adapte; sectionMm2 = sectionLueMm2; abaisse = true; } else cableANeuf = true;
    } else sectionMm2 = sectionLueMm2;
  }
  return {
    cle: regle.cle(calibre), calibreA: calibre, sectionMm2, calibreModifie: base.modifie || abaisse || (calibreLu != null && calibre !== calibreLu),
    calibreIllisible: base.illisible, cableANeuf, calibreAbaisseParCable: abaisse,
  };
}

const fmtSection = (s: number) => (Math.round(s * 10) / 10).toFixed(1);   // « 1.5 », « 2.5 », « 4.0 » : format de Breaker.customSection

// ─── Relevé (ce que l'IA lit sur les photos) ──────────────────────────────────────────────────────────────────────

export const NATURES = [
  "disjoncteur", "disjoncteur_differentiel", "fusible", "differentiel", "interrupteur_sectionneur", "parafoudre",
  "telerupteur", "contacteur", "delesteur", "minuterie", "autre", "vide",
] as const;
export type Nature = (typeof NATURES)[number];
/** Natures qui deviennent un circuit (un départ) dans le tableau refait. */
const NATURES_DEPART: readonly Nature[] = ["disjoncteur", "disjoncteur_differentiel", "fusible"];
/** Natures qu'on ne sait pas représenter dans le tableau de l'application : signalées à l'électricien, jamais perdues en silence. */
const NATURES_HORS_MODELE: readonly Nature[] = ["interrupteur_sectionneur", "telerupteur", "contacteur", "delesteur", "minuterie", "autre"];
export const LIBELLE_NATURE: Record<Nature, string> = {
  disjoncteur: "Disjoncteur", disjoncteur_differentiel: "Disjoncteur différentiel", fusible: "Fusible / coupe-circuit", differentiel: "Interrupteur différentiel",
  interrupteur_sectionneur: "Interrupteur-sectionneur", parafoudre: "Parafoudre", telerupteur: "Télérupteur", contacteur: "Contacteur (heures creuses…)",
  delesteur: "Délesteur", minuterie: "Minuterie", autre: "Autre appareil", vide: "Emplacement vide",
};

export type TypeDiff = "AC" | "A" | "F" | "B" | "inconnu";
export type Confiance = "haute" | "moyenne" | "basse";

export interface AppareilReleve {
  nature: Nature;
  calibreA: number | null;
  poles: number | null;
  etiquette: string;
  usage: UsageReleve;
  confiance: Confiance;
  /** Différentiel / disjoncteur différentiel : sensibilité lue (mA) et type. */
  sensibiliteMa: number | null;
  typeDiff: TypeDiff;
  /** Section (mm²) lue sur une étiquette de câble visible — rarement renseignée. */
  sectionMm2: number | null;
  /** Décoché par l'électricien : n'est pas repris dans le tableau refait. */
  ecarte?: boolean;
}
export interface DifferentielReleve { calibreA: number | null; sensibiliteMa: number | null; type: TypeDiff; confiance: Confiance }
export interface RangeeReleve { nom: string; differentiel: DifferentielReleve | null; appareils: AppareilReleve[] }
export type GraviteObservation = "securite" | "vetuste" | "lisibilite" | "info";
export interface ObservationReleve { gravite: GraviteObservation; texte: string }
export interface ReleveTableau {
  photosExploitables: boolean;
  marque: string;
  disjoncteurAbonne: { present: boolean; calibreA: number | null };
  parafoudrePresent: boolean;
  rangees: RangeeReleve[];
  observations: ObservationReleve[];
  questions: string[];
}

export const MAX_RANGEES = 12;
export const MAX_APPAREILS_PAR_RANGEE = 40;
const GRAVITES: readonly GraviteObservation[] = ["securite", "vetuste", "lisibilite", "info"];
const CONFIANCES: readonly Confiance[] = ["haute", "moyenne", "basse"];
const TYPES_DIFF: readonly TypeDiff[] = ["AC", "A", "F", "B", "inconnu"];
const USAGES_RELEVE: readonly UsageReleve[] = [...USAGES, "inconnu"];

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const texte = (v: unknown, max = 120): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const nombre = (v: unknown, min: number, max: number): number | null => {
  const x = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v.replace(",", ".")) : NaN;
  return Number.isFinite(x) && x >= min && x <= max ? x : null;
};
const choix = <T extends string>(v: unknown, liste: readonly T[], def: T): T => (typeof v === "string" && (liste as readonly string[]).includes(v) ? (v as T) : def);

function normaliserAppareil(brut: unknown): AppareilReleve | null {
  const a = obj(brut);
  if (!a) return null;
  const nature = choix(a.nature, NATURES, "autre");
  return {
    nature, calibreA: nombre(a.calibre_a ?? a.calibreA, 1, 160), poles: (() => { const p = nombre(a.poles, 1, 4); return p == null ? null : Math.round(p); })(),
    etiquette: texte(a.etiquette), usage: choix(a.usage, USAGES_RELEVE, "inconnu"), confiance: choix(a.confiance, CONFIANCES, "moyenne"),
    sensibiliteMa: nombre(a.sensibilite_ma ?? a.sensibiliteMa, 1, 2000), typeDiff: choix(a.type_diff ?? a.typeDiff, TYPES_DIFF, "inconnu"),
    sectionMm2: nombre(a.section_mm2 ?? a.sectionMm2, 0.5, 240),
  };
}

function normaliserDifferentiel(brut: unknown): DifferentielReleve | null {
  const d = obj(brut);
  if (!d || d.present === false) return null;
  return {
    calibreA: nombre(d.calibre_a ?? d.calibreA, 1, 160), sensibiliteMa: nombre(d.sensibilite_ma ?? d.sensibiliteMa, 1, 2000),
    type: choix(d.type, TYPES_DIFF, "inconnu"), confiance: choix(d.confiance, CONFIANCES, "moyenne"),
  };
}

/**
 * Valide et nettoie TOUT ce que renvoie le modèle : types, bornes, énumérations, tailles. Ne lève jamais d'exception.
 * Un différentiel posé au milieu d'un rail coupe ce rail en deux « rangées logiques » (chaque différentiel protège les appareils qui le suivent).
 */
export function normaliserReleve(brut: unknown): ReleveTableau {
  const o = obj(brut) ?? {};
  const rangees: RangeeReleve[] = [];
  const brutes = Array.isArray(o.rangees) ? o.rangees.slice(0, MAX_RANGEES) : [];
  brutes.forEach(rb => {
    const r = obj(rb);
    if (!r) return;
    const nomBase = texte(r.nom, 40) || `Rangée ${rangees.length + 1}`;
    const apps = (Array.isArray(r.appareils) ? r.appareils.slice(0, MAX_APPAREILS_PAR_RANGEE) : []).map(normaliserAppareil).filter((a): a is AppareilReleve => a !== null);
    let courante: RangeeReleve = { nom: nomBase, differentiel: normaliserDifferentiel(r.differentiel), appareils: [] };
    let nbCoupes = 1;
    const fermer = () => { if (courante.differentiel || courante.appareils.length > 0) rangees.push(courante); };
    apps.forEach(a => {
      if (a.nature === "differentiel") {
        const diff: DifferentielReleve = { calibreA: a.calibreA, sensibiliteMa: a.sensibiliteMa, type: a.typeDiff, confiance: a.confiance };
        if (!courante.differentiel && courante.appareils.length === 0) { courante.differentiel = diff; return; }
        fermer();
        nbCoupes++;
        courante = { nom: `${nomBase} · ${nbCoupes}`, differentiel: diff, appareils: [] };
        return;
      }
      if (a.nature === "vide") return;
      courante.appareils.push(a);
    });
    fermer();
  });
  const abonne = obj(o.disjoncteur_abonne ?? o.disjoncteurAbonne);
  const observations: ObservationReleve[] = [];
  (Array.isArray(o.observations) ? o.observations.slice(0, 12) : []).forEach(ob => {
    const x = obj(ob); const t = x ? texte(x.texte, 300) : texte(ob, 300);
    if (t) observations.push({ gravite: x ? choix(x.gravite, GRAVITES, "info") : "info", texte: t });
  });
  return {
    photosExploitables: o.photos_exploitables === false || o.photosExploitables === false ? false : rangees.length > 0,
    marque: texte(o.marque, 40),
    disjoncteurAbonne: { present: !!abonne && abonne.present !== false, calibreA: abonne ? nombre(abonne.calibre_a ?? abonne.calibreA, 1, 160) : null },
    parafoudrePresent: o.parafoudre_present === true || o.parafoudrePresent === true || brutes.some(rb => (Array.isArray(obj(rb)?.appareils) ? (obj(rb)!.appareils as unknown[]) : []).some(a => obj(a)?.nature === "parafoudre")),
    rangees: rangees.slice(0, MAX_RANGEES), observations,
    questions: (Array.isArray(o.questions) ? o.questions.slice(0, 8) : []).map(q => texte(q, 300)).filter(Boolean),
  };
}

// ─── Contexte, circuits, ajouts ───────────────────────────────────────────────────────────────────────────────────

export interface ContexteTableau {
  surfaceM2: number | null;
  collectif: boolean;
  /** Parafoudre exigé (zone AQ2, bâtiment à moins de 50 m d'un paratonnerre, alimentation aérienne…) : décision de l'électricien. */
  parafoudreRequis: boolean;
  /** Tableau derrière une porte (manettes à 0,50 m mini) plutôt qu'à découvert (0,90 m mini). */
  porte: boolean;
  /** Largeur des rails du tableau refait : « auto » (défaut) = le plus petit coffret usuel qui garde la réserve de 20 % ; sinon 13, 18 ou 24 modules imposés. */
  modulesParRail?: "auto" | 13 | 18 | 24;
  /** Plusieurs différentiels sur un même rail (chacun protège ses départs, 8 maxi) au lieu d'un rail par différentiel. Défaut : non. */
  plusieursDifferentielsParRangee?: boolean;
}
export const CONTEXTE_DEFAUT: ContexteTableau = { surfaceM2: null, collectif: false, parafoudreRequis: false, porte: true, modulesParRail: "auto", plusieursDifferentielsParRangee: false };

export interface CircuitReleve {
  id: number;
  usage: Usage;
  usageIncertain: boolean;
  etiquette: string;
  calibreA: number | null;
  sectionMm2: number | null;
  confiance: Confiance;
  fusible: boolean;
  differentielIndividuel: boolean;
  origine: "photo" | "ajout";
  /** Rangée du relevé où le circuit a été lu (undefined pour un ajout). */
  rangee?: number;
}

export function usageEffectif(a: Pick<AppareilReleve, "usage" | "etiquette">): { usage: Usage; incertain: boolean } {
  if (a.usage !== "inconnu") return { usage: a.usage, incertain: false };
  const dep = usageDepuisEtiquette(a.etiquette);
  return { usage: dep ?? "autre", incertain: true };
}

const estDepart = (a: AppareilReleve) => NATURES_DEPART.includes(a.nature);

/** Circuits à reproduire dans le tableau refait : un par départ lu, hors appareils écartés. */
export function circuitsDepuisReleve(releve: ReleveTableau): CircuitReleve[] {
  const out: CircuitReleve[] = [];
  releve.rangees.forEach((r, ri) => r.appareils.forEach(a => {
    if (!estDepart(a) || a.ecarte) return;
    const u = usageEffectif(a);
    out.push({
      id: out.length + 1, usage: u.usage, usageIncertain: u.incertain, etiquette: a.etiquette, calibreA: a.calibreA, sectionMm2: a.sectionMm2,
      confiance: a.confiance, fusible: a.nature === "fusible", differentielIndividuel: a.nature === "disjoncteur_differentiel", origine: "photo", rangee: ri,
    });
  }));
  return out;
}

/** Circuit ajouté à la main (ou suggéré) : usage et calibre par défaut de la norme. */
export function nouveauCircuit(usage: Usage, etiquette = "", calibreA: number | null = null): Omit<CircuitReleve, "id"> {
  return { usage, usageIncertain: false, etiquette, calibreA, sectionMm2: null, confiance: "haute", fusible: false, differentielIndividuel: false, origine: "ajout" };
}

// ─── Relevé → tableau tel que constaté (pour mesurer l'écart avec la norme) ───────────────────────────────────────

const typeDiffApp = (t: TypeDiff): string => (t === "A" ? "diff-A" : t === "F" || t === "B" ? "diff-F" : "diff-AC");

/**
 * Le tableau tel qu'il a été relevé, au format de l'application, pour le soumettre aux MÊMES contrôles que le tableau refait.
 * Utilisé uniquement pour l'analyse : jamais enregistré. Les valeurs illisibles reçoivent une valeur neutre (jamais une valeur qui crée une fausse alerte).
 */
export function releveVersRows(releve: ReleveTableau): BreakerRow[] {
  return releve.rangees.map((r, i) => {
    const departs = r.appareils.filter(estDepart);
    const slots: (Breaker | null)[] = Array(Math.max(9, 1 + departs.length)).fill(null);
    const d = r.differentiel;
    // Un différentiel de plus de 30 mA n'est pas un différentiel 30 mA : il n'est pas compté (signalé à part dans les écarts).
    if (d && (d.sensibiliteMa == null || d.sensibiliteMa <= NORME_CIRCUITS.sensibiliteDifferentielMa.valeur)) {
      slots[0] = { id: uid(), label: "", circuit: "general", amperes: d.calibreA ?? 63, type: typeDiffApp(d.type), customSection: "10.0", pieces: [] };
    }
    departs.forEach((a, k) => {
      const u = usageEffectif(a).usage;
      const cal = a.calibreA ?? REGLES_USAGE[u].defaut;
      slots[1 + k] = {
        id: uid(), label: a.etiquette || REGLES_USAGE[u].libelle, circuit: REGLES_USAGE[u].cle(cal), amperes: cal, type: (a.poles ?? 1) >= 2 ? "2P" : "1P",
        customSection: fmtSection(a.sectionMm2 ?? sectionMiniPourCalibre(cal)), pieces: [],
      };
    });
    return { id: uid(), name: r.nom || `Rangée ${i + 1}`, slots };
  });
}

// ─── Reconstruction à la norme ────────────────────────────────────────────────────────────────────────────────────

export type NiveauEcart = "modif" | "ajout" | "alerte" | "info";
export interface EcartTableau { niveau: NiveauEcart; texte: string; source?: string; statut?: StatutNorme; circuitId?: number }

export interface ManqueNorme {
  id: string;
  texte: string;
  source: string;
  statut: StatutNorme;
  /** Ajout proposé en un clic (absent = simple alerte, à traiter par l'électricien). */
  ajout?: { usage: Usage; etiquette: string };
}

export interface Proposition {
  /** Rangées de puissance du tableau refait (sans coffret de communication), ids propres, sans l'étiquette « origine plan ». */
  rows: BreakerRow[];
  /** Le tableau tel que relevé (analyse uniquement). */
  rowsAvant: BreakerRow[];
  params: ParamsTableauReel;
  resApres: ResultatTableauReel;
  resAvant: ResultatTableauReel;
  ecarts: EcartTableau[];
  manques: ManqueNorme[];
  /** Ce que la photo ne permet pas de savoir : à contrôler sur place avant le devis. */
  aVerifierSurPlace: string[];
  /** Appareils vus sur la photo mais que le tableau de l'application ne sait pas représenter (télérupteur, contacteur…). */
  nonRepris: string[];
  nbCircuits: number;
  nbNonConformesAvant: number;
  nbNonConformesApres: number;
}

const nonConformes = (res: ResultatTableauReel) => res.controles.filter(c => c.niveau !== "info").length;

/** Manques par rapport aux minima de la norme : une alerte, avec — quand c'est sans ambiguïté — un ajout proposé (jamais appliqué seul). */
export function analyserManques(circuits: Pick<CircuitReleve, "usage">[], ctx: ContexteTableau): ManqueNorme[] {
  const manques: ManqueNorme[] = [];
  const nbLumiere = circuits.filter(c => c.usage === "lumiere").length;
  const studio = ctx.surfaceM2 != null && ctx.surfaceM2 <= NORME_CIRCUITS.eclairageSeuilSurfaceM2.valeur;
  const miniLumiere = studio ? 1 : NORME_CIRCUITS.eclairageCircuitsMini.valeur;
  if (nbLumiere < miniLumiere) {
    manques.push({
      id: "eclairage", texte: `${nbLumiere} circuit(s) d'éclairage : ${miniLumiere} au minimum${studio ? " (logement de 35 m² ou moins)" : " par logement"}.`,
      source: NORME_CIRCUITS.eclairageCircuitsMini.source, statut: NORME_CIRCUITS.eclairageCircuitsMini.statut,
      ajout: { usage: "lumiere", etiquette: "Éclairage" },
    });
  }
  const nbSpec = circuits.filter(c => USAGES_SPECIALISES.includes(c.usage)).length;
  if (nbSpec < NORME_CIRCUITS.specialisesMini.valeur) {
    manques.push({
      id: "specialises", texte: `${nbSpec} circuit(s) spécialisé(s) (lave-linge, lave-vaisselle, sèche-linge, four, congélateur) : ${NORME_CIRCUITS.specialisesMini.valeur} au minimum par logement. À ajouter selon les appareils réellement présents.`,
      source: NORME_CIRCUITS.specialisesMini.source, statut: NORME_CIRCUITS.specialisesMini.statut,
    });
  }
  return manques;
}

/** Pose un parafoudre (circuit « parafoudre », disjoncteur de déconnexion 2P 20 A — même représentation que le module Tableau) dans une rangée qui a de la place. */
function poserParafoudre(rows: BreakerRow[]): BreakerRow[] {
  const para: Breaker = { id: uid(), label: "Parafoudre", circuit: "parafoudre", amperes: 20, type: "2P", customSection: "4.0", pieces: [] };
  const maxCircuits = 8;
  for (let i = 0; i < rows.length; i++) {
    const nb = rows[i].slots.slice(1).filter(b => b != null).length;
    const idx = premierEmplacementLibre(rows[i].slots, largeurAppareil(para), false);
    if (nb < maxCircuits && idx >= 0) return rows.map((r, k) => (k === i ? { ...r, slots: r.slots.map((s, j) => (j === idx ? para : s)) } : r));
  }
  const diff: Breaker = { id: uid(), label: "", circuit: "general", amperes: 40, type: "diff-A", customSection: "10.0", pieces: [] };
  return [...rows, { id: uid(), name: `Rangée ${rows.length + 1}`, slots: [diff, para, ...Array(7).fill(null)] }];
}

function paramsPour(ctx: ContexteTableau, modulesParRail: number): ParamsTableauReel {
  // Le parafoudre est déjà posé comme appareil dans les rangées : on ne le redéclare pas ici (il serait compté deux fois par le contrôle de place).
  return fusionnerParamsTableau({
    modulesParRail, collectif: ctx.collectif, surfaceM2: ctx.surfaceM2 ?? undefined, porte: ctx.porte, pmr: false,
    parafoudre: false, parafoudreRequis: false, coupureGenerale: false,
  });
}

export const MODULES_PAR_RAIL_CANDIDATS = [13, 18, 24] as const;

/**
 * Range des groupes « un différentiel + ses départs » (les rangées logiques de assemblerTableau) sur des rails de `modules` modules : un rail
 * reçoit plusieurs groupes tant qu'il y a la place (2 modules par différentiel + les départs), dans l'ordre ; le suivant ouvre un nouveau rail.
 * Le différentiel de tête est en case 0, les suivants dans les emplacements (2 modules) et protègent les départs à leur droite. Rien n'est jamais perdu.
 */
export function emballerEnRails(rows: BreakerRow[], modules: number): BreakerRow[] {
  const nbEmpl = emplacementsPourModules(modules);
  const rails: BreakerRow[] = [];
  let courant: { row: BreakerRow; slots: (Breaker | null)[]; idx: number } | null = null;
  const ouvrir = (base: BreakerRow) => {
    courant = { row: base, slots: Array(nbEmpl + 1).fill(null), idx: 1 };
    rails.push(base);   // remplacé à la fin par la version remplie
  };
  const fermer = () => {
    if (!courant) return;
    const i = rails.indexOf(courant.row);
    rails[i] = { ...courant.row, modules, slots: courant.slots };
  };
  rows.forEach(r => {
    const id = r.slots[0] ?? null;
    const departs = r.slots.slice(1).filter((b): b is Breaker => !!b);
    const w = departs.reduce((n, b) => n + largeurAppareil(b), 0);
    const tient = courant != null && id != null && courant.idx + 1 + w <= nbEmpl;
    if (!tient) { fermer(); ouvrir(r); courant!.slots[0] = id; }
    else { courant!.slots[courant!.idx] = id; courant!.idx += 2; }
    const c = courant!;
    // garde-fou : un groupe plus large que le rail (inatteignable avec 8 départs) agrandit les cases plutôt que de perdre un appareil
    while (c.slots.length < c.idx + w) c.slots.push(null);
    departs.forEach(b => { c.slots[c.idx] = b; c.idx += largeurAppareil(b); });
  });
  fermer();
  return rails;
}

/**
 * Refait le tableau à la norme à partir du relevé (corrigé par l'électricien), des circuits ajoutés et du contexte.
 * Déterministe : mêmes entrées, même tableau. Les contrôles sont ceux du « tableau réaliste » (calculerTableauReel).
 */
export function construireProposition(releve: ReleveTableau, ajouts: CircuitReleve[], ctx: ContexteTableau): Proposition {
  const circuits = [...circuitsDepuisReleve(releve), ...ajouts].map((c, i) => ({ ...c, id: i + 1 }));
  const ecarts: EcartTableau[] = [];
  const srcFusible = NORME_CIRCUITS.fusibleInterdit.source;

  // 1. Un disjoncteur par circuit, calibre et section conformes
  const breakers: Breaker[] = circuits.map(c => {
    const dec = decider(c.usage, c.calibreA, c.sectionMm2);
    const nom = c.etiquette || REGLES_USAGE[c.usage].libelle;
    const ref = `« ${nom} »`;
    if (c.fusible) ecarts.push({ niveau: "modif", texte: `${ref} : fusible remplacé par un disjoncteur ${dec.calibreA} A (coupe-circuit interdit).`, source: srcFusible, statut: NORME_CIRCUITS.fusibleInterdit.statut, circuitId: c.id });
    if (c.differentielIndividuel) ecarts.push({ niveau: "info", texte: `${ref} : disjoncteur différentiel individuel repris comme disjoncteur sous un différentiel de tête 30 mA.`, circuitId: c.id });
    if (dec.calibreIllisible) ecarts.push({ niveau: "alerte", texte: `${ref} : calibre illisible sur la photo — ${dec.calibreA} A retenu par défaut, à vérifier sur place.`, circuitId: c.id });
    else if (dec.calibreAbaisseParCable) ecarts.push({ niveau: "modif", texte: `${ref} : calibre ramené de ${c.calibreA} A à ${dec.calibreA} A pour protéger le câble observé (${fmtSection(dec.sectionMm2)} mm²).`, circuitId: c.id });
    else if (dec.calibreModifie) ecarts.push({ niveau: "modif", texte: `${ref} : calibre ${c.calibreA} A → ${dec.calibreA} A (${REGLES_USAGE[c.usage].libelle.toLowerCase()} : ${REGLES_USAGE[c.usage].calibres.join(" ou ")} A, section ${fmtSection(sectionMiniPourCalibre(dec.calibreA))} mm² mini).`, source: "Infographie Legrand « circuits spécialisés »", statut: "verifie", circuitId: c.id });
    if (dec.cableANeuf) ecarts.push({ niveau: "alerte", texte: `${ref} : câble observé ${fmtSection(c.sectionMm2 ?? 0)} mm² trop petit pour ${dec.calibreA} A (${fmtSection(sectionMiniPourCalibre(dec.calibreA))} mm² mini) — câble à remplacer.`, circuitId: c.id });
    if (c.usageIncertain && c.origine === "photo") ecarts.push({ niveau: "info", texte: `${ref} : usage déduit de l'étiquette (${REGLES_USAGE[c.usage].libelle}) — à confirmer.`, circuitId: c.id });
    if (c.origine === "ajout") ecarts.push({ niveau: "ajout", texte: `${ref} : circuit ajouté (${dec.calibreA} A, ${fmtSection(dec.sectionMm2)} mm²).`, circuitId: c.id });
    return {
      id: uid(), label: nom, circuit: dec.cle, amperes: dec.calibreA, type: (dec.cle === "plaque" ? "2P" : "1P"),
      customSection: fmtSection(dec.cableANeuf ? sectionMiniPourCalibre(dec.calibreA) : dec.sectionMm2), pieces: [],
    } as Breaker;
  });

  // 2. Différentiels : regroupement par type requis, 8 circuits maxi par différentiel, au moins un type A, calibre par la règle amont/aval (assemblerTableau)
  let rows: BreakerRow[] = assemblerTableau(breakers).map(({ origine: _origine, ...r }) => { void _origine; return r; });

  // 3. Parafoudre
  const parafoudre = ctx.parafoudreRequis || releve.parafoudrePresent;
  if (parafoudre && breakers.length > 0) {
    rows = poserParafoudre(rows);
    ecarts.push({ niveau: ctx.parafoudreRequis && !releve.parafoudrePresent ? "ajout" : "info", texte: ctx.parafoudreRequis && !releve.parafoudrePresent ? "Parafoudre ajouté (requis pour ce bâtiment) avec son disjoncteur de déconnexion 20 A." : "Parafoudre existant repris avec son disjoncteur de déconnexion 20 A." });
  }
  rows = rows.map((r, i) => ({ ...r, name: `Rangée ${i + 1}` }));

  // 4. Coffret : la largeur de rail imposée (13, 18 ou 24 modules), sinon le plus petit nombre de modules par rail qui laisse la réserve exigée.
  //    Par défaut un rail = un différentiel ; avec « plusieurs différentiels par rangée », les groupes sont rangés côte à côte sur les rails.
  const imposee = ctx.modulesParRail != null && ctx.modulesParRail !== "auto" && MODULES_PAR_RAIL_CANDIDATS.includes(ctx.modulesParRail) ? ctx.modulesParRail : null;
  const plusieursId = ctx.plusieursDifferentielsParRangee === true;
  const disposer = (m: number): BreakerRow[] => (plusieursId ? emballerEnRails(rows, m)
    : imposee != null ? rows.map(r => redimensionnerRangee(r, m) ?? r)
    : rows);
  const candidats: readonly number[] = imposee != null ? [imposee] : MODULES_PAR_RAIL_CANDIDATS;
  let modules: number = candidats[candidats.length - 1];
  for (const m of candidats) {
    const r = calculerTableauReel(disposer(m), { params: paramsPour(ctx, m) });
    if (!r.controles.some(c => c.id === "reserve" || c.id.startsWith("depasse-"))) { modules = m; break; }
  }
  rows = disposer(modules).map((r, i) => ({ ...r, name: `Rangée ${i + 1}` }));
  const params = paramsPour(ctx, modules);
  const resApres = calculerTableauReel(rows, { params });

  // 5. Le tableau tel que relevé, soumis aux mêmes contrôles
  const rowsAvant = releveVersRows(releve);
  const resAvant = calculerTableauReel(rowsAvant, { params });
  releve.rangees.forEach(r => {
    const s = r.differentiel?.sensibiliteMa;
    if (s != null && s > NORME_CIRCUITS.sensibiliteDifferentielMa.valeur) {
      ecarts.push({ niveau: "modif", texte: `${r.nom} : différentiel de ${s} mA remplacé par un différentiel ${NORME_CIRCUITS.sensibiliteDifferentielMa.valeur} mA.`, source: NORME_CIRCUITS.sensibiliteDifferentielMa.source, statut: NORME_CIRCUITS.sensibiliteDifferentielMa.statut });
    }
  });
  const nbIdAvant = resAvant.totaux.differentiels, nbIdApres = resApres.totaux.differentiels;
  if (nbIdAvant !== nbIdApres) ecarts.unshift({ niveau: "modif", texte: `Différentiels 30 mA : ${nbIdAvant} relevé(s) → ${nbIdApres} dans le tableau refait.`, source: "NF C 15-100 — 2 différentiels 30 mA minimum, 8 circuits maximum par différentiel" });
  if (releve.parafoudrePresent && !parafoudre) ecarts.push({ niveau: "info", texte: "Parafoudre non repris." });

  // 6. Manques, points à vérifier, appareils non repris
  const manques = analyserManques(circuits, ctx);
  const aVerifierSurPlace: string[] = [];
  if (circuits.some(c => c.origine === "photo" && c.sectionMm2 == null)) aVerifierSurPlace.push("Sections réelles des câbles : non visibles sur les photos, calculées d'après le calibre — à contrôler sur place.");
  if (releve.rangees.some(r => r.differentiel && r.differentiel.calibreA == null)) aVerifierSurPlace.push("Calibre d'un différentiel illisible : à relever sur place.");
  if (releve.rangees.some(r => r.differentiel && r.differentiel.type === "inconnu")) aVerifierSurPlace.push("Type d'un différentiel (AC, A, F) illisible : à relever sur place.");
  if (releve.rangees.some(r => !r.differentiel && r.appareils.some(estDepart))) aVerifierSurPlace.push("Une rangée relevée sans différentiel de tête : vérifier qu'il n'est pas hors champ de la photo.");
  if (circuits.some(c => c.usageIncertain && c.origine === "photo")) aVerifierSurPlace.push("Usage de certains circuits déduit d'une étiquette ou inconnu : à confirmer avec l'installation.");
  const horsModele = new Map<string, number>();
  releve.rangees.forEach(r => r.appareils.forEach(a => { if (!a.ecarte && NATURES_HORS_MODELE.includes(a.nature)) horsModele.set(LIBELLE_NATURE[a.nature], (horsModele.get(LIBELLE_NATURE[a.nature]) ?? 0) + 1); }));
  const nonRepris = [...horsModele.entries()].map(([nom, n]) => `${n} × ${nom.toLowerCase()} vu sur la photo : à ré-intégrer à la main (le tableau de l'application ne le représente pas).`);

  return {
    rows, rowsAvant, params, resApres, resAvant, ecarts, manques, aVerifierSurPlace, nonRepris, nbCircuits: circuits.length,
    nbNonConformesAvant: nonConformes(resAvant), nbNonConformesApres: nonConformes(resApres),
  };
}

// ─── Application au tableau existant ──────────────────────────────────────────────────────────────────────────────

/**
 * Remplace les rangées de puissance du tableau par la proposition ; le coffret de communication (RJ45, prises modulaires…) est conservé tel quel.
 * Les identifiants de la proposition sont décalés au-dessus de ceux conservés (aucune collision), et l'étiquette « origine plan » n'est jamais posée :
 * un futur « Pousser vers le tableau » ne remplacera donc pas ces rangées sans prévenir.
 */
export function appliquerAuTableau(existantes: BreakerRow[], proposees: BreakerRow[]): BreakerRow[] {
  const conservees = existantes.filter(r => r.kind === "multimedia");
  const neuves = remapperIdsRows(proposees, maxIdRows(conservees)).map(({ origine: _o, ...r }) => { void _o; return r as BreakerRow; });
  return [...neuves, ...conservees];
}

/** Libellé court d'un circuit du CIRCUITS de l'application (pour l'affichage des écarts). */
export const libelleCircuit = (cle: string): string => CIRCUITS[cle]?.label ?? cle;
