// src/lib/normes-nfc.ts
//
// TABLE DES RÈGLES NORMATIVES utilisées par le tableau réaliste, la GTL et le calcul de raccordement.
// Chaque valeur porte sa SOURCE et un STATUT :
//   · "verifie"  : retrouvée dans au moins deux sources concordantes (infographie Legrand « Les points clés de la NF C 15-100 »
//                  du projet, guide UTE C 15-105 / documents de formation, dossier technique Enedis) ;
//   · "a_verifier" : usage courant ou source unique — à confirmer dans le texte de la norme avant tout chantier. L'interface le signale.
// Règle d'or du projet : la NF C 15-100 ALERTE, elle ne bloque jamais. Aucune de ces valeurs n'empêche une saisie.

export type StatutNorme = "verifie" | "a_verifier";
export interface ReglNorme<T> { valeur: T; source: string; statut: StatutNorme }
const n = <T,>(valeur: T, source: string, statut: StatutNorme = "verifie"): ReglNorme<T> => ({ valeur, source, statut });

// ─── GTL / ETEL ──────────────────────────────────────────────────────────────────────────────────────────────
export const NORME_GTL = {
  largeurMiniMm: n(600, "NF C 15-100 (GTL) — 60 cm mini (infographie Legrand, 123elec.com)"),
  profondeurMiniMm: n(250, "NF C 15-100 (GTL) — 25 cm mini (infographie Legrand, 123elec.com)"),
  hauteur: n("sol → plafond", "NF C 15-100 (GTL) — du sol au plafond (123elec.com)"),
  // Organes de manœuvre du tableau et disjoncteur d'abonné
  manetteMiniSansPorteM: n(0.9, "Infographie Legrand : manettes 0,90 m mini sans porte"),
  manetteMiniAvecPorteM: n(0.5, "Infographie Legrand / eduscol ETEL : 0,50 m mini, partie 0,50–0,90 m atteignable par une porte"),
  manetteMaxiM: n(1.8, "Infographie Legrand / eduscol ETEL : 1,80 m maxi"),
  abonneMiniM: n(0.9, "Infographie Legrand : disjoncteur d'abonné 0,90 m mini"),
  abonneMaxiM: n(1.8, "Infographie Legrand : disjoncteur d'abonné 1,80 m maxi"),
  pmrMaxiM: n(1.3, "NF C 15-100 / accessibilité : commandes entre 0,90 et 1,30 m (logement adapté PMR)"),
  reservePctMaison: n(20, "NF C 15-100 — 20 % de modules libres (infographie Legrand, eduscol)"),
  reserveModulesCollectif: n(6, "NF C 15-100 — logement collectif : réserve limitée à 6 modules (infographie Legrand, eduscol)"),
  largeurEtelSupGtlMm: n(100, "ETEL : largeur = largeur GTL + 100 mm possible (infographie Legrand, eduscol)"),
  distanceGazM: n(0.1, "eduscol ETEL : > 10 cm d'une installation de gaz", "a_verifier"),
  distanceChaleurM: n(0.4, "eduscol ETEL : > 40 cm d'une source de chaleur non isolée", "a_verifier"),
  distancePointEauM: n(0.6, "eduscol ETEL : > 60 cm d'un point d'eau", "a_verifier"),
  moduleMm: n(17.5, "Largeur d'un module DIN : 17,5 mm (convention)"),
} as const;

// ─── Tableau ───────────────────────────────────────────────────────────────────────────────────────────────────
export const NORME_TABLEAU = {
  idMiniParLogement: n(2, "NF C 15-100 — 2 interrupteurs différentiels 30 mA minimum (infographie Legrand)"),
  circuitsMaxParId: n(8, "Infographie Legrand : 8 circuits maxi par interrupteur différentiel"),
  idTypeAMini: n(1, "Infographie Legrand : dont au minimum 1 de type A"),
  // Calibre de l'ID — règle de l'infographie : chauffage, chauffe-eau, prise VE à 100 % + moitié des autres circuits
  coefAutresCircuits: n(0.5, "Infographie Legrand : « somme intensités disjoncteurs prises, lumières et autres » × 1/2"),
  modulesParRailPossibles: n([13, 18, 24], "Coffrets usuels : 13, 18 ou 24 modules par rangée (Legrand)", "a_verifier"),
  rangeesConseillees: n({ moins35: 2, de35a100: 3, plus100: 4 }, "Legrand : 2 rangées < 35 m², 3 de 35 à 100 m², 4 au-delà (conseil constructeur)", "a_verifier"),
  modulesDisjoncteur: n(1, "Disjoncteur 1P+N : 1 module (Legrand)"),
  modulesDifferentiel: n(2, "Interrupteur différentiel : 2 modules (Legrand)"),
  modulesParafoudre: n(2, "Parafoudre : 2 modules (Legrand)", "a_verifier"),
  modulesTelerupteur: n(1, "Télérupteur : 1 module (Legrand)"),
  modulesSectionneur: n(2, "Interrupteur-sectionneur 2P : 2 modules", "a_verifier"),
  sectionnementPlaque: n(32, "Infographie Legrand : plaques de cuisson 32 A / 6 mm²"),
} as const;

// ─── Parafoudre (infographie Legrand) ───────────────────────────────────────────────────────────────────────
export const NORME_PARAFOUDRE = {
  obligatoireSi: n([
    "Bâtiment à moins de 50 m d'un bâtiment équipé d'un paratonnerre",
    "Alimentation électrique entièrement ou partiellement aérienne (zone à niveau kéraunique > 25 / AQ2)",
    "Alimentation enterrée et sécurité des personnes concernée (alarme, médicalisation à domicile…)",
  ], "Infographie Legrand « La protection contre la foudre »"),
  recommandeSi: n(["Matériel sensible (informatique, congélateur…) hors zone AQ2"], "Infographie Legrand"),
} as const;

// ─── Branchement / disjoncteur d'abonné (AGCP) ──────────────────────────────────────────────────────────────
export interface CalibreAgcp { calibreA: number; kva: number; phase: "mono" | "tri"; libelle: string }
export const CALIBRES_AGCP: ReglNorme<CalibreAgcp[]> = n([
  { calibreA: 15, kva: 3, phase: "mono", libelle: "15 A — 3 kVA" },
  { calibreA: 30, kva: 6, phase: "mono", libelle: "30 A — 6 kVA" },
  { calibreA: 45, kva: 9, phase: "mono", libelle: "45 A — 9 kVA" },
  { calibreA: 60, kva: 12, phase: "mono", libelle: "60 A — 12 kVA" },
  { calibreA: 10, kva: 6, phase: "tri", libelle: "3 × 10 A — 6 kVA" },
  { calibreA: 15, kva: 9, phase: "tri", libelle: "3 × 15 A — 9 kVA" },
  { calibreA: 20, kva: 12, phase: "tri", libelle: "3 × 20 A — 12 kVA" },
  { calibreA: 30, kva: 18, phase: "tri", libelle: "3 × 30 A — 18 kVA" },
  { calibreA: 40, kva: 24, phase: "tri", libelle: "3 × 40 A — 24 kVA" },
  { calibreA: 60, kva: 36, phase: "tri", libelle: "3 × 60 A — 36 kVA" },
], "Enedis (dossier technique) : AGCP 3/6/9/12 kVA = 15/30/45/60 A monophasé ; correspondances triphasées : usage Enedis", "a_verifier");

export const NORME_CHUTE = {
  // Chute de tension maximale depuis l'origine de l'installation (NF C 15-100 tableau 52W, réseau public BT).
  maxEclairagePct: n(3, "NF C 15-100 — 3 % pour l'éclairage, réseau public BT (voltflow.net, macalculatriceenligne.com ; texte de la norme non consulté)"),
  maxAutresPct: n(5, "NF C 15-100 — 5 % pour les autres usages, réseau public BT (voltflow.net, macalculatriceenligne.com ; texte de la norme non consulté)"),
  // Formule complète UTE C 15-105 : u = b (ρ1 L/S cosφ + λ L sinφ) IB
  rho1Cuivre: n(0.023, "UTE C 15-105 / NF C 15-100 : ρ1 = 0,023 Ω·mm²/m (cuivre, 70 °C) — aussi Enedis NF C 14-100"),
  rho1Alu: n(0.037, "UTE C 15-105 / NF C 15-100 : ρ1 = 0,037 Ω·mm²/m (aluminium, 70 °C) — aussi Enedis"),
  lambdaOhmM: n(0.00008, "UTE C 15-105 : λ = 0,08 mΩ/m (80·10⁻⁶ Ω/m)"),
  cosPhiDefaut: n(0.8, "UTE C 15-105 : cos φ = 0,8 (sin φ = 0,6) par défaut"),
  tensionMonoV: n(230, "Tension simple 230 V"),
  tensionTriV: n(400, "Tension composée 400 V"),
  // Part de la chute totale accordée à la LIAISON disjoncteur d'abonné → tableau : le reste est pour les circuits terminaux.
  budgetLiaisonDefautPct: n(1.0, "Choix de conception : 1 % de la chute totale pour la liaison, le reste aux circuits terminaux (réglable)", "a_verifier"),
  sectionMiniLiaisonMm2: n(10, "Pratique usuelle : liaison AGCP → tableau en 10 mm² cuivre mini (à confirmer NF C 14-100 / guide Enedis)", "a_verifier"),
} as const;

// ─── Courants admissibles Iz (A) — cuivre, UTE C 15-105 / NF C 15-100 tableau 52 (θ ambiant 30 °C) ──────────────
// Modes de pose : B = conduit encastré / sous conduit en paroi ; C = câble fixé sur paroi / sous goulotte.
// PVC3/PVC2 = isolant PVC, 3 ou 2 conducteurs chargés ; PR3/PR2 = polyéthylène réticulé.
export type ModePose = "B" | "C";
export type Isolant = "PVC" | "PR";
export const SECTIONS_NORMALISEES = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120] as const;
export const IZ_CUIVRE: ReglNorme<Record<number, Record<`${ModePose}${"PVC3" | "PVC2" | "PR3" | "PR2"}`, number>>> = n({
  1.5: { BPVC3: 15.5, BPVC2: 17.5, BPR3: 18.5, BPR2: 19.5, CPVC3: 22, CPVC2: 23, CPR3: 24, CPR2: 26 },
  2.5: { BPVC3: 21, BPVC2: 24, BPR3: 25, BPR2: 27, CPVC3: 30, CPVC2: 31, CPR3: 33, CPR2: 36 },
  4: { BPVC3: 28, BPVC2: 32, BPR3: 34, BPR2: 36, CPVC3: 40, CPVC2: 42, CPR3: 45, CPR2: 49 },
  6: { BPVC3: 36, BPVC2: 41, BPR3: 43, BPR2: 48, CPVC3: 51, CPVC2: 54, CPR3: 58, CPR2: 63 },
  10: { BPVC3: 50, BPVC2: 57, BPR3: 60, BPR2: 63, CPVC3: 70, CPVC2: 75, CPR3: 80, CPR2: 86 },
  16: { BPVC3: 68, BPVC2: 76, BPR3: 80, BPR2: 85, CPVC3: 94, CPVC2: 100, CPR3: 107, CPR2: 115 },
  25: { BPVC3: 89, BPVC2: 96, BPR3: 101, BPR2: 112, CPVC3: 119, CPVC2: 127, CPR3: 138, CPR2: 149 },
  35: { BPVC3: 110, BPVC2: 119, BPR3: 126, BPR2: 138, CPVC3: 147, CPVC2: 158, CPR3: 169, CPR2: 185 },
  50: { BPVC3: 134, BPVC2: 144, BPR3: 153, BPR2: 168, CPVC3: 179, CPVC2: 192, CPR3: 207, CPR2: 225 },
  70: { BPVC3: 171, BPVC2: 184, BPR3: 196, BPR2: 213, CPVC3: 229, CPVC2: 246, CPR3: 268, CPR2: 289 },
  95: { BPVC3: 207, BPVC2: 223, BPR3: 238, BPR2: 258, CPVC3: 278, CPVC2: 298, CPR3: 328, CPR2: 352 },
  120: { BPVC3: 239, BPVC2: 259, BPR3: 276, BPR2: 299, CPVC3: 322, CPVC2: 346, CPR3: 382, CPR2: 410 },
}, "UTE C 15-105 annexe / NF C 15-100 tableau 52 — dossier BTS eduscol (E4.2 session 2015) ; sections ≥ 25 mm² : colonnes déduites de la séquence B puis C");

// K3 — température ambiante (isolant PVC / PR), θ de référence 30 °C
export const K3_TEMPERATURE: ReglNorme<Record<number, { PVC: number; PR: number }>> = n({
  10: { PVC: 1.22, PR: 1.15 }, 15: { PVC: 1.17, PR: 1.12 }, 20: { PVC: 1.12, PR: 1.08 }, 25: { PVC: 1.06, PR: 1.04 },
  30: { PVC: 1.0, PR: 1.0 }, 35: { PVC: 0.94, PR: 0.96 }, 40: { PVC: 0.87, PR: 0.91 }, 45: { PVC: 0.79, PR: 0.87 },
  50: { PVC: 0.71, PR: 0.82 }, 55: { PVC: 0.61, PR: 0.76 }, 60: { PVC: 0.5, PR: 0.71 },
}, "UTE C 15-105 / NF C 15-100 — dossier BTS eduscol (E4.2 session 2015)");

// K2 — groupement de circuits (câbles encastrés / dans des parois) : nombre de circuits jointifs → coefficient
export const K2_GROUPEMENT_PAROI: ReglNorme<Record<number, number>> = n({
  1: 1.0, 2: 0.8, 3: 0.7, 4: 0.65, 5: 0.6, 6: 0.55, 7: 0.55, 8: 0.5, 9: 0.5, 12: 0.45, 16: 0.4, 20: 0.4,
}, "UTE C 15-105 / NF C 15-100 — dossier BTS eduscol (E4.2 session 2015)");

// Section minimale du conducteur de protection (PE) en fonction de la section de phase (CEI 60364-5-54 tableau 54.2)
export function sectionPE(sectionPhaseMm2: number): number {
  if (sectionPhaseMm2 <= 16) return sectionPhaseMm2;
  if (sectionPhaseMm2 <= 35) return 16;
  return sectionPhaseMm2 / 2;
}

// ─── Coffret / rail : dimensions de pratique constructeur (réglables, jamais bloquantes) ───────────────────────────
export const NORME_COFFRET = {
  pasRangeeMm: n(150, "Pas vertical d'une rangée de coffret modulaire (≈ 150 mm, catalogues Legrand/Schneider)", "a_verifier"),
  margeLateraleMm: n(50, "Marge latérale de coffret de chaque côté du rail (≈ 50 mm)", "a_verifier"),
  margeHauteBasseMm: n(100, "Marge haute + basse de coffret au-dessus/au-dessous des rangées extrêmes (≈ 100 mm)", "a_verifier"),
  largeurCoffretCommunicationMm: n(300, "Coffret de communication grade 1/2/3 : ≈ 300 mm de large (4 à 8 rangs)", "a_verifier"),
  largeurAgcpMm: n(150, "Disjoncteur de branchement (AGCP) + plastron : ≈ 150 mm de large", "a_verifier"),
  hauteurCoffretCommunicationMm: n(400, "Coffret de communication : ≈ 400 mm de haut (grade 1/2/3, 4 à 8 rangs)", "a_verifier"),
  hauteurAgcpMm: n(250, "Disjoncteur de branchement (AGCP) + plastron : ≈ 250 mm de haut", "a_verifier"),
  reserveHautBasGtlMm: n(300, "Zone libre en haut/bas de GTL pour l'arrivée et le départ des gaines (≈ 300 mm chacune côté plafond)", "a_verifier"),
  diametreGaineExtMm: n(20, "Gaine ICTA/IRL Ø 20 (le plus courant)", "verifie"),
  couchesGainesMax: n(2, "Gaines posées sur 2 couches max dans une GTL de 250 mm de profondeur", "a_verifier"),
  hauteurSousPlafondMiniM: n(2.2, "Hauteur sous plafond mini de la GTL (sol au plafond)", "a_verifier"),
} as const;
