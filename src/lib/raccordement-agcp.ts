// src/lib/raccordement-agcp.ts
//
// LIAISON DISJONCTEUR D'ABONNÉ (AGCP) → TABLEAU : courant d'emploi, section de câble, chute de tension, pertes, abaque.
// Fonctions pures, sans état. Les valeurs normatives viennent de normes-nfc.ts (avec leur source et leur statut de vérification).
//
// Principe de dimensionnement (la section retenue est la PLUS GRANDE de trois exigences) :
//  1. COURANT ADMISSIBLE : la liaison est protégée par l'AGCP, donc Iz corrigé ≥ calibre de l'AGCP
//     (Iz corrigé = Iz tableau × K1 mode de pose × K2 groupement × K3 température) ;
//  2. CHUTE DE TENSION : u = b (ρ1 L/S cosφ + λ L sinφ) IB ≤ budget accordé à la liaison, le reste de la chute admise (3 % éclairage /
//     5 % autres usages) étant laissé aux circuits terminaux ;
//  3. SECTION MINI de pratique pour une liaison de branchement (réglable).
// Le courant d'emploi IB est déduit des disjoncteurs installés, avec la règle de l'infographie Legrand pour le calibre des différentiels :
// chauffage, chauffe-eau et recharge de véhicule à 100 %, tous les autres circuits à 50 %.

import type { Breaker } from "./electrical-constants";
import { CIRCUITS, estCircuitSansDisjoncteur } from "./electrical-constants";
import {
  CALIBRES_AGCP, IZ_CUIVRE, K2_GROUPEMENT_PAROI, K3_TEMPERATURE, NORME_CHUTE, NORME_TABLEAU, SECTIONS_NORMALISEES, sectionPE,
  type Isolant, type ModePose, type CalibreAgcp,
} from "./normes-nfc";

export type PhaseRaccordement = "mono" | "tri";
export type BaseChute = "demande" | "calibre";

export interface ParamsRaccordement {
  phase: PhaseRaccordement;
  /** Calibre de l'AGCP (A, par phase). */
  calibreAgcpA: number;
  /** Longueur de la liaison AGCP → tableau (m). */
  longueurM: number;
  pose: ModePose;
  isolant: Isolant;
  /** Température ambiante (°C). */
  temperatureC: number;
  /** Nombre de circuits jointifs dans la même paroi / conduit (liaison comprise). 1 = seule. */
  nbCircuitsGroupes: number;
  /** K1 : coefficient du mode de pose (1 = cas général ; 0,7 à 0,95 selon l'isolation thermique de la paroi). */
  coefK1: number;
  cosPhi: number;
  /** Chute de tension admise sur la liaison (% de 230 V). */
  budgetChutePct: number;
  /** Section minimale de pratique (mm²). */
  sectionMiniMm2: number;
  /** Courant pris pour la chute : celui de la demande calculée, ou le calibre de l'AGCP (cas le plus défavorable). */
  baseChute: BaseChute;
  /** Courant d'emploi imposé (A) — remplace celui déduit des disjoncteurs. */
  courantEmploiForceA?: number;
}

export const PARAMS_RACCORDEMENT_DEFAUT: ParamsRaccordement = {
  phase: "mono", calibreAgcpA: 60, longueurM: 5, pose: "B", isolant: "PVC", temperatureC: 30, nbCircuitsGroupes: 1, coefK1: 1,
  cosPhi: NORME_CHUTE.cosPhiDefaut.valeur, budgetChutePct: NORME_CHUTE.budgetLiaisonDefautPct.valeur,
  sectionMiniMm2: NORME_CHUTE.sectionMiniLiaisonMm2.valeur, baseChute: "demande",
};

// ─── Courant d'emploi déduit des disjoncteurs ─────────────────────────────────────────────────────────────────────
const CLES_PLEINE_CHARGE = new Set(["chauffe_eau", "irve"]);
export interface DemandeInstallation {
  /** Σ calibres des circuits comptés à 100 % (chauffage, chauffe-eau, recharge VE). */
  pleineChargeA: number;
  /** Σ calibres des autres circuits (comptés à 50 %). */
  autresA: number;
  courantEmploiA: number;
  nbDisjoncteurs: number;
}
export function demandeInstallation(breakers: Breaker[]): DemandeInstallation {
  let pleine = 0, autres = 0, nb = 0;
  breakers.forEach(b => {
    if (estCircuitSansDisjoncteur(b) || b.circuit === "general" || b.amperes <= 0) return;
    nb++;
    const cat = CIRCUITS[b.circuit]?.category;
    if (cat === "chauffage" || CLES_PLEINE_CHARGE.has(b.circuit)) pleine += b.amperes; else autres += b.amperes;
  });
  return { pleineChargeA: pleine, autresA: autres, courantEmploiA: pleine + autres * NORME_TABLEAU.coefAutresCircuits.valeur, nbDisjoncteurs: nb };
}

// ─── Coefficients ──────────────────────────────────────────────────────────────────────────────────────────────────
function plusProche(cles: number[], v: number, sens: "inf" | "proche"): number {
  const tri = [...cles].sort((a, b) => a - b);
  if (sens === "inf") { let r = tri[0]; tri.forEach(c => { if (c <= v) r = c; }); return r; }
  return tri.reduce((m, c) => (Math.abs(c - v) < Math.abs(m - v) ? c : m), tri[0]);
}
/** K2 : coefficient de groupement (valeur du tableau la plus défavorable ≤ nombre de circuits). */
export function coefK2(nbCircuits: number): number {
  const t = K2_GROUPEMENT_PAROI.valeur;
  return t[plusProche(Object.keys(t).map(Number), Math.max(1, nbCircuits), "inf")];
}
/** K3 : coefficient de température (valeur la plus proche, en retenant la plus défavorable au-delà de 60 °C). */
export function coefK3(temperatureC: number, isolant: Isolant): number {
  const t = K3_TEMPERATURE.valeur;
  const cles = Object.keys(t).map(Number);
  const c = temperatureC >= 60 ? 60 : plusProche(cles, temperatureC, "proche");
  return t[c][isolant];
}
/** Iz tabulé (A) d'une section de cuivre pour un mode de pose / isolant / nombre de conducteurs chargés. */
export function izTable(sectionMm2: number, pose: ModePose, isolant: Isolant, phase: PhaseRaccordement): number {
  const ligne = IZ_CUIVRE.valeur[sectionMm2];
  return ligne ? ligne[`${pose}${isolant}${phase === "mono" ? 2 : 3}` as keyof typeof ligne] : 0;
}

// ─── Chute de tension et pertes ───────────────────────────────────────────────────────────────────────────────────
/** Chute de tension en volts : u = b (ρ1 L/S cosφ + λ L sinφ) IB, b = 2 en monophasé, 1 en triphasé (tension simple). */
export function chuteTensionV(sectionMm2: number, longueurM: number, courantA: number, phase: PhaseRaccordement, cosPhi: number): number {
  const b = phase === "mono" ? 2 : 1;
  const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
  return b * (NORME_CHUTE.rho1Cuivre.valeur * longueurM / sectionMm2 * cosPhi + NORME_CHUTE.lambdaOhmM.valeur * longueurM * sinPhi) * courantA;
}
export const chuteTensionPct = (sectionMm2: number, longueurM: number, courantA: number, phase: PhaseRaccordement, cosPhi: number): number =>
  100 * chuteTensionV(sectionMm2, longueurM, courantA, phase, cosPhi) / NORME_CHUTE.tensionMonoV.valeur;
/** Pertes par effet Joule dans la liaison (W) : 2 conducteurs actifs en mono, 3 en tri. */
export function pertesJouleW(sectionMm2: number, longueurM: number, courantA: number, phase: PhaseRaccordement): number {
  const r = NORME_CHUTE.rho1Cuivre.valeur * longueurM / sectionMm2;
  return (phase === "mono" ? 2 : 3) * r * courantA * courantA;
}

export interface CelluleAbaque { sectionMm2: number; longueurM: number; chutePct: number; ok: boolean }
export const SECTIONS_ABAQUE = [6, 10, 16, 25, 35, 50] as const;
export const LONGUEURS_ABAQUE = [2, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100] as const;
/** Abaque chute de tension (%) : une ligne par section, une colonne par longueur, pour le courant donné. */
export function abaqueChute(courantA: number, phase: PhaseRaccordement, cosPhi: number, budgetPct: number): CelluleAbaque[][] {
  return SECTIONS_ABAQUE.map(s => LONGUEURS_ABAQUE.map(l => {
    const p = chuteTensionPct(s, l, courantA, phase, cosPhi);
    return { sectionMm2: s, longueurM: l, chutePct: p, ok: p <= budgetPct + 1e-9 };
  }));
}

// ─── Calcul principal ──────────────────────────────────────────────────────────────────────────────────────────────
export interface ResultatRaccordement {
  courantEmploiA: number;
  courantChuteA: number;
  demande: DemandeInstallation | null;
  puissanceDemandeeKva: number;
  puissanceAgcpKva: number | null;
  k1: number; k2: number; k3: number; kTotal: number;
  sectionIzMm2: number | null;
  sectionChuteMm2: number | null;
  sectionRetenueMm2: number;
  /** Quelle exigence impose la section retenue. */
  imposePar: "courant admissible" | "chute de tension" | "section minimale";
  izCorrigeRetenueA: number;
  chutePct: number;
  chuteV: number;
  /** Chute restant pour les circuits terminaux : limite NF C 15-100 − chute de la liaison (éclairage / autres usages). */
  resteEclairagePct: number;
  resteAutresPct: number;
  pertesW: number;
  sectionNeutreMm2: number;
  sectionPEMm2: number;
  abaque: CelluleAbaque[][];
  /** Calibre d'AGCP mini couvrant la demande (A), ou null si aucune valeur standard n'y suffit. */
  calibreAgcpConseilleA: number | null;
  alertes: string[];
}

export function calculerRaccordement(p: ParamsRaccordement, breakers?: Breaker[]): ResultatRaccordement {
  const alertes: string[] = [];
  const demande = breakers ? demandeInstallation(breakers) : null;
  const ib = p.courantEmploiForceA ?? demande?.courantEmploiA ?? 0;
  const courantChuteA = p.baseChute === "calibre" ? p.calibreAgcpA : Math.max(ib, 0);
  const k1 = p.coefK1, k2 = coefK2(p.nbCircuitsGroupes), k3 = coefK3(p.temperatureC, p.isolant), kTotal = k1 * k2 * k3;

  let sectionIz: number | null = null, sectionChute: number | null = null;
  for (const s of SECTIONS_NORMALISEES) {
    if (s < 6) continue;
    if (sectionIz == null && izTable(s, p.pose, p.isolant, p.phase) * kTotal >= p.calibreAgcpA) sectionIz = s;
    if (sectionChute == null && chuteTensionPct(s, p.longueurM, courantChuteA, p.phase, p.cosPhi) <= p.budgetChutePct + 1e-9) sectionChute = s;
    if (sectionIz != null && sectionChute != null) break;
  }
  const plusGrande = SECTIONS_NORMALISEES[SECTIONS_NORMALISEES.length - 1];
  const miniNorm = SECTIONS_NORMALISEES.find(s => s >= p.sectionMiniMm2) ?? plusGrande;
  const candidats: [number, ResultatRaccordement["imposePar"]][] = [
    [sectionIz ?? plusGrande, "courant admissible"], [sectionChute ?? plusGrande, "chute de tension"], [miniNorm, "section minimale"],
  ];
  let [retenue, imposePar] = candidats[2];
  candidats.forEach(([s, q]) => { if (s > retenue) { retenue = s; imposePar = q; } });

  if (sectionIz == null) alertes.push(`Aucune section de cuivre jusqu'à ${plusGrande} mm² ne tient le calibre de l'AGCP (${p.calibreAgcpA} A) avec K = ${kTotal.toFixed(2)} : revoir le mode de pose, la température ou le groupement.`);
  if (sectionChute == null) alertes.push(`La chute de tension reste au-dessus de ${p.budgetChutePct} % même en ${plusGrande} mm² sur ${p.longueurM} m : rapprocher le tableau du disjoncteur d'abonné ou relever le budget alloué à la liaison.`);

  const izCorrige = izTable(retenue, p.pose, p.isolant, p.phase) * kTotal;
  const chuteV = chuteTensionV(retenue, p.longueurM, courantChuteA, p.phase, p.cosPhi);
  const chutePct = 100 * chuteV / NORME_CHUTE.tensionMonoV.valeur;
  const kva = (a: number) => (p.phase === "mono" ? a * NORME_CHUTE.tensionMonoV.valeur : 3 * a * NORME_CHUTE.tensionMonoV.valeur) / 1000;
  const agcp: CalibreAgcp | undefined = CALIBRES_AGCP.valeur.find(c => c.phase === p.phase && c.calibreA === p.calibreAgcpA);
  const conseilles = CALIBRES_AGCP.valeur.filter(c => c.phase === p.phase).sort((a, b) => a.calibreA - b.calibreA);
  const calibreConseille = ib > 0 ? (conseilles.find(c => c.calibreA >= ib)?.calibreA ?? null) : null;

  if (ib > p.calibreAgcpA) alertes.push(`Courant d'emploi estimé ${ib.toFixed(1)} A > calibre de l'AGCP ${p.calibreAgcpA} A : la puissance souscrite est insuffisante pour tous les circuits à pleine charge (délestage ou calibre supérieur à étudier).`);
  if (p.longueurM > 30) alertes.push(`Liaison de ${p.longueurM} m : au-delà de 30 m, le branchement relève d'une configuration particulière (disjoncteur en limite de propriété) — à confirmer avec le gestionnaire de réseau.`);
  if (izCorrige < p.calibreAgcpA) alertes.push(`Iz corrigé ${izCorrige.toFixed(0)} A < calibre de l'AGCP ${p.calibreAgcpA} A : la liaison n'est pas protégée contre les surcharges.`);
  if (chutePct > p.budgetChutePct + 1e-9) alertes.push(`Chute de tension de la liaison ${chutePct.toFixed(2)} % > budget ${p.budgetChutePct} %.`);
  if (p.nbCircuitsGroupes > 1) alertes.push(`Groupement de ${p.nbCircuitsGroupes} circuits : coefficient K2 = ${k2} appliqué.`);
  const statuts = [CALIBRES_AGCP.statut, NORME_CHUTE.budgetLiaisonDefautPct.statut, NORME_CHUTE.sectionMiniLiaisonMm2.statut];
  if (statuts.includes("a_verifier")) alertes.push("Certaines valeurs (correspondance calibre/puissance de l'AGCP, budget de chute alloué à la liaison, section mini) sont d'usage courant et marquées « à vérifier » dans la table des normes : à confirmer avec la NF C 14-100 et la NF C 15-100 en vigueur avant chantier.");

  return {
    courantEmploiA: ib, courantChuteA, demande, puissanceDemandeeKva: kva(ib), puissanceAgcpKva: agcp?.kva ?? null,
    k1, k2, k3, kTotal, sectionIzMm2: sectionIz, sectionChuteMm2: sectionChute, sectionRetenueMm2: retenue, imposePar,
    izCorrigeRetenueA: izCorrige, chutePct, chuteV,
    resteEclairagePct: NORME_CHUTE.maxEclairagePct.valeur - chutePct, resteAutresPct: NORME_CHUTE.maxAutresPct.valeur - chutePct,
    pertesW: pertesJouleW(retenue, p.longueurM, courantChuteA, p.phase),
    sectionNeutreMm2: retenue, sectionPEMm2: sectionPE(retenue),
    abaque: abaqueChute(courantChuteA, p.phase, p.cosPhi, p.budgetChutePct),
    calibreAgcpConseilleA: calibreConseille, alertes,
  };
}
