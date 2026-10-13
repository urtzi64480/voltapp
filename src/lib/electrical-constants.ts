// src/lib/electrical-constants.ts
//
// Constantes et helpers NF C 15-100 partagés entre le module Tableau électrique
// et le module Plan de circuits (maison). Source de vérité unique — ne pas
// redéfinir ces dictionnaires localement dans une page.
//
// Extrait à l'identique de /tableau/[clientId]/page.tsx (version la plus
// complète des deux pages existantes — /tableau/page.tsx utilisait une copie
// partielle et désynchronisée du même dictionnaire CIRCUITS).

export type CommandeType = "simple" | "vav" | "telerupteur";
export type CircuitCategory = "lumiere" | "prises" | "chauffage";

export interface GroupeLumineux {
  nbPoints: number;
  typeCommande: CommandeType;
  nbCommandes: number;
}

export interface PieceConfig {
  nom: string;
  groupes: GroupeLumineux[];
  nbPrises: number;
}

export interface Breaker {
  id: number;
  label: string;
  circuit: string;
  amperes: number;
  type: string;
  customSection?: string;
  pieces: PieceConfig[];
  // Rempli par le module Plan quand ce circuit provient d'un CircuitManuel (voir
  // maison-types.ts / maison-engine.ts) — id stable, permet de retrouver sa couleur/son
  // nom d'un niveau même après régénération. Ignoré ailleurs (module Tableau).
  manuelId?: number;
  // Rempli par le module Plan : id du niveau dont provient ce circuit — sert à le router vers
  // le bon tableau (principal ou annexe, voir Niveau.tableauId) au moment du "Pousser". Non
  // conservé une fois le circuit dans un tableau_config ; ignoré ailleurs (module Tableau).
  niveauId?: number;
  // Éclairage réparti sur plusieurs ÉTAGES (va-et-vient entre niveaux) — posé par le module Plan à la génération :
  // lampes dont une commande est à un autre niveau (« vv » = va-et-vient, « simple » = autre commande), et commandes qui
  // pilotent une lampe de ce circuit située à un autre niveau. Voir construireBranchesCircuitEclairage (maison-types.ts).
  lampesAilleurs?: Record<number, "vv" | "simple">;
  commandesAilleurs?: number[];
}

export interface BreakerRow {
  id: number;
  name: string;
  slots: (Breaker | null)[];
  // « multimedia » : coffret de communication (case annexe NF C 15-100, grade 1/2/3) — pas de différentiel ni de disjoncteurs : des ports RJ45 (un par prise
  // RJ45 du plan), des prises 16 A modulaires et, au besoin, une coupure générale. `slots` y est de longueur libre (8 par ligne). Absent = rangée de tableau.
  kind?: "multimedia";
  // Tag posé par le module Plan sur les rangées qu'il génère — permet à un nouveau
  // "pousser vers le tableau" de remplacer proprement ce lot au lieu de le dupliquer,
  // sans jamais toucher aux rangées créées à la main dans l'éditeur de tableau.
  origine?: "plan";
}

export const BREAKER_TYPES: Record<string, { label: string; width: number; desc: string; isDiff?: boolean; diffType?: string; accessoire?: boolean }> = {
  "1P":      { label: "1P",    width: 1, desc: "Unipolaire" },
  "2P":      { label: "2P",    width: 2, desc: "Bipolaire" },
  "diff-AC": { label: "ID AC", width: 2, desc: "Différentiel Type AC", isDiff: true, diffType: "AC" },
  "diff-A":  { label: "ID A",  width: 2, desc: "Différentiel Type A",  isDiff: true, diffType: "A"  },
  "diff-F":  { label: "ID F",  width: 2, desc: "Différentiel Type F",  isDiff: true, diffType: "F"  },
  // Appareils modulaires qui ne sont PAS des disjoncteurs de circuit (jamais comptés comme circuits, ni contrôlés comme tels) :
  "sect":      { label: "Sect.",    width: 2, desc: "Interrupteur-sectionneur — coupure générale",              accessoire: true },
  "prise-mod": { label: "Prise 16A", width: 2, desc: "Prise de courant modulaire 16 A 2P+T (sur rail DIN)",      accessoire: true },
  "rj45":      { label: "RJ45",     width: 1, desc: "Port RJ45 du coffret de communication",                    accessoire: true },
};
/** Appareil modulaire du tableau qui n'est ni un disjoncteur ni un différentiel (coupure générale, prise modulaire, port RJ45). */
export const estAccessoireTableau = (b: { type: string } | null | undefined): boolean => !!b && !!BREAKER_TYPES[b.type]?.accessoire;

// ─── EMPLACEMENTS (modules de 17,5 mm) ─────────────────────────────────────────────────────────────────────────────
// Une rangée de tableau = 1 différentiel de tête (case 0, sa propre case double) + 8 emplacements (cases 1 à 8). Le coffret de
// communication = des lignes de 8 emplacements. Un appareil est rangé dans `slots` à l'indice de son PREMIER emplacement ; la coupure
// générale et la prise modulaire en occupent 2 (BREAKER_TYPES.width) : l'indice suivant reste alors null mais n'est PAS libre
// (« couvert »). Toute la logique de pose, de déplacement et de réserve (20 %) passe par les fonctions ci-dessous.

export const EMPLACEMENTS_PAR_RANGEE = 8;

type Appareil = Breaker | null | undefined;
const appareilPresent = (b: Appareil): b is Breaker => !!b && typeof b === "object" && typeof b.type === "string" && b.type.length > 0;

/** Nombre d'emplacements occupés par un appareil : 2 pour la coupure générale et la prise modulaire, 1 pour le reste (disjoncteur, port RJ45…). */
export function largeurAppareil(b: Appareil): number {
  if (!appareilPresent(b) || !estAccessoireTableau(b)) return 1;
  return Math.max(1, BREAKER_TYPES[b.type].width);
}

/** Largeur à l'indice `i` : la case 0 d'une rangée de tableau (celle du différentiel) est déjà une case double et reste comptée pour 1. */
function largeurEn(b: Appareil, i: number, coffret: boolean): number {
  return !coffret && i === 0 ? 1 : largeurAppareil(b);
}

/** Plage d'emplacements d'un rail : cases 1 à 8 d'une rangée de tableau, toutes les cases du coffret. */
function bornesRail(slots: readonly unknown[], coffret: boolean): { debut: number; fin: number } {
  return coffret ? { debut: 0, fin: slots.length } : { debut: 1, fin: Math.min(slots.length, 1 + EMPLACEMENTS_PAR_RANGEE) };
}

/** Fin (exclue) de la ligne qui contient l'indice `i` : un appareil large ne se pose jamais à cheval sur deux lignes du coffret. */
function finLigne(slots: readonly unknown[], i: number, coffret: boolean): number {
  return coffret ? Math.min(slots.length, (Math.floor(i / EMPLACEMENTS_PAR_RANGEE) + 1) * EMPLACEMENTS_PAR_RANGEE) : bornesRail(slots, false).fin;
}

/** couvert[i] = true quand l'indice i est le 2e emplacement d'un appareil large posé juste avant (case vide mais occupée). */
export function emplacementsCouverts(slots: readonly Appareil[], coffret: boolean): boolean[] {
  const couvert: boolean[] = Array(slots.length).fill(false);
  for (let i = bornesRail(slots, coffret).debut; i < slots.length; i++) {
    const b = slots[i];
    if (!appareilPresent(b)) continue;
    for (let k = 1; k < largeurEn(b, i, coffret) && i + k < slots.length; k++) couvert[i + k] = true;
  }
  return couvert;
}

/** Emplacements occupés dans le rail (un appareil large compte pour 2). */
export function emplacementsOccupes(slots: readonly Appareil[], coffret: boolean): number {
  const { debut, fin } = bornesRail(slots, coffret);
  let n = 0;
  for (let i = debut; i < fin; i++) if (appareilPresent(slots[i])) n += largeurEn(slots[i], i, coffret);
  return n;
}

/** Emplacements libres d'une rangée (réserve) : 8 moins les emplacements occupés, jamais négatif. */
export function emplacementsLibresRangee(slots: readonly Appareil[], coffret = false): number {
  const { debut, fin } = bornesRail(slots, coffret);
  return Math.max(0, fin - debut - emplacementsOccupes(slots, coffret));
}

/** Vrai si `largeur` emplacements consécutifs sont libres à partir de `i`, dans le rail et sur la même ligne. `slots` ne doit plus contenir l'appareil qu'on déplace. */
export function peutPlacerLargeur(slots: readonly Appareil[], i: number, largeur: number, coffret: boolean): boolean {
  if (!coffret && i === 0) return !appareilPresent(slots[0]);
  const { debut, fin } = bornesRail(slots, coffret);
  if (!Number.isInteger(i) || i < debut || i >= fin || i + largeur > finLigne(slots, i, coffret)) return false;
  const couvert = emplacementsCouverts(slots, coffret);
  for (let k = 0; k < largeur; k++) if (appareilPresent(slots[i + k]) || couvert[i + k]) return false;
  return true;
}

/** Premier indice où poser un appareil de `largeur` emplacements, ou -1 s'il n'y a pas assez de place côte à côte. */
export function premierEmplacementLibre(slots: readonly Appareil[], largeur: number, coffret: boolean): number {
  const { debut, fin } = bornesRail(slots, coffret);
  for (let i = debut; i < fin; i++) if (peutPlacerLargeur(slots, i, largeur, coffret)) return i;
  return -1;
}

/** Pose `b` à l'indice `i` (en remplaçant l'appareil qui s'y trouve). Renvoie les nouvelles cases, ou null si les emplacements nécessaires ne sont pas libres. */
export function poserAppareil(slots: readonly Appareil[], i: number, b: Breaker, coffret: boolean): (Breaker | null)[] | null {
  const copie: (Breaker | null)[] = slots.map(x => x ?? null);
  copie[i] = null;
  if (!peutPlacerLargeur(copie, i, largeurEn(b, i, coffret), coffret)) return null;
  copie[i] = b;
  return copie;
}

export interface PositionAppareil { rowId: number; slotIdx: number }

/**
 * Déplace l'appareil `de` vers la case `vers` (case vide : il s'y déplace ; case occupée : les deux appareils s'échangent), dans la même rangée
 * ou une autre. Renvoie les nouvelles rangées, ou null si l'un des deux appareils n'a pas assez de place à son nouvel emplacement.
 */
export function deplacerAppareil(rows: BreakerRow[], de: PositionAppareil, vers: PositionAppareil): BreakerRow[] | null {
  const rs = rows.find(r => r.id === de.rowId), rd = rows.find(r => r.id === vers.rowId);
  if (!rs || !rd) return null;
  const src = rs.slots[de.slotIdx] ?? null, dst = rd.slots[vers.slotIdx] ?? null;
  if (!appareilPresent(src)) return null;
  const memeRangee = rs.id === rd.id;
  const slotsS: (Breaker | null)[] = rs.slots.map(x => x ?? null);
  const slotsD: (Breaker | null)[] = memeRangee ? slotsS : rd.slots.map(x => x ?? null);
  slotsS[de.slotIdx] = null;
  slotsD[vers.slotIdx] = null;
  if (!peutPlacerLargeur(slotsD, vers.slotIdx, largeurEn(src, vers.slotIdx, rd.kind === "multimedia"), rd.kind === "multimedia")) return null;
  slotsD[vers.slotIdx] = src;
  if (appareilPresent(dst)) {
    if (!peutPlacerLargeur(slotsS, de.slotIdx, largeurEn(dst, de.slotIdx, rs.kind === "multimedia"), rs.kind === "multimedia")) return null;
    slotsS[de.slotIdx] = dst;
  }
  return rows.map(r => (r.id === rs.id ? { ...r, slots: slotsS } : r.id === rd.id ? { ...r, slots: slotsD } : r));
}

/**
 * Remet un rail en conformité avec les largeurs (données enregistrées avant que les appareils larges ne prennent 2 emplacements, ou plan
 * généré) : chaque appareil garde son indice quand il peut ; sinon il est poussé vers la droite en conservant l'ordre, puis, à défaut, rangé
 * dans le premier trou assez large. Rien n'est jamais perdu : ce qui ne tient pas du tout est renvoyé dans `debordement`
 * (le coffret, lui, s'agrandit d'une ligne de 8, dans la limite de 64 emplacements).
 */
export function agencerAppareils(slots: readonly Appareil[], coffret: boolean): { slots: (Breaker | null)[]; debordement: Breaker[] } {
  const { debut, fin } = bornesRail(slots, coffret);
  const resultat: (Breaker | null)[] = slots.map((b, i) => (i < debut || i >= fin ? (b ?? null) : null));
  const sansPlace: Breaker[] = [];
  let curseur = debut;
  for (let i = debut; i < fin; i++) {
    const b = slots[i];
    if (!appareilPresent(b)) continue;
    const w = largeurEn(b, i, coffret);
    let t = Math.max(i, curseur);
    if (t + w > finLigne(slots, t, coffret)) t = finLigne(slots, t, coffret);   // à cheval sur la fin de la ligne : on passe à la suivante
    if (t + w > fin) { sansPlace.push(b); continue; }
    resultat[t] = b;
    curseur = t + w;
  }
  const debordement: Breaker[] = [];
  [...sansPlace].sort((a, b) => largeurAppareil(b) - largeurAppareil(a)).forEach(b => {
    const w = largeurAppareil(b);
    let idx = premierEmplacementLibre(resultat, w, coffret);
    while (idx < 0 && coffret && resultat.length < 64) {
      for (let k = 0; k < EMPLACEMENTS_PAR_RANGEE; k++) resultat.push(null);
      idx = premierEmplacementLibre(resultat, w, coffret);
    }
    if (idx < 0) debordement.push(b); else resultat[idx] = b;
  });
  return { slots: resultat, debordement };
}

export const CIRCUITS: Record<string, {
  label: string; icon: string; ampMax: number; dedié: boolean;
  diffType: string | null; section: string | null; category: CircuitCategory | null;
}> = {
  lumiere:         { label: "Lumière",          icon: "💡", ampMax: 10, dedié: false, diffType: "AC", section: "1.5", category: "lumiere" },
  prise_16:        { label: "Prises 16A",       icon: "🔌", ampMax: 16, dedié: false, diffType: "AC", section: "1.5", category: "prises" },
  prise_20:        { label: "Prises 20A",       icon: "🔌", ampMax: 20, dedié: false, diffType: "AC", section: "2.5", category: "prises" },
  cuisine_prises:  { label: "Prises cuisine",   icon: "🍳", ampMax: 20, dedié: false, diffType: "AC", section: "2.5", category: "prises" },
  plaque:          { label: "Plaque cuisson",   icon: "🔥", ampMax: 32, dedié: true,  diffType: "A",  section: "6.0", category: null },
  four:            { label: "Four",             icon: "🥘", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5", category: null },
  lave_linge:      { label: "Lave-linge",       icon: "🧺", ampMax: 20, dedié: true,  diffType: "A",  section: "2.5", category: null },
  lave_vaisselle:  { label: "Lave-vaisselle",   icon: "🍽️", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5", category: null },
  seche_linge:     { label: "Sèche-linge",      icon: "👕", ampMax: 20, dedié: true,  diffType: "A",  section: "2.5", category: null },
  chauffe_eau:     { label: "Chauffe-eau",      icon: "🚿", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5", category: null },
  // "chauffage" (historique) reste défini pour les circuits déjà sauvegardés (tableau_config
  // existant, générés avant ce regroupement) — la génération à partir du plan produit
  // désormais chauffage_16 / chauffage_20 selon la puissance cumulée du circuit (voir
  // genererBreakersChauffage, maison-engine.ts). Ne pas réutiliser cette clé pour du nouveau.
  chauffage:       { label: "Chauffage élec.",  icon: "🌡️", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5", category: null },
  // NF C 15-100 (amendement A5) : plusieurs radiateurs peuvent partager un circuit tant que
  // la puissance cumulée reste sous le calibre du disjoncteur — 3500 W max en 16A/1,5mm²,
  // 4500 W max en 20A/2,5mm², sur différentiel 30 mA type AC. Voir genererBreakersChauffage.
  chauffage_16:    { label: "Chauffage élec.",  icon: "🌡️", ampMax: 16, dedié: false, diffType: "AC", section: "1.5", category: "chauffage" },
  chauffage_20:    { label: "Chauffage élec.",  icon: "🌡️", ampMax: 20, dedié: false, diffType: "AC", section: "2.5", category: "chauffage" },
  clim:            { label: "Climatisation",    icon: "❄️", ampMax: 20, dedié: true,  diffType: "F",  section: "2.5", category: null },
  seche_serviette: { label: "Sèche-serviette",  icon: "🛁", ampMax: 16, dedié: true,  diffType: "AC", section: "1.5", category: null },
  congelateur:     { label: "Congélateur",      icon: "🧊", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5", category: null },
  irve:            { label: "IRVE (recharge)",  icon: "🔋", ampMax: 32, dedié: true,  diffType: "A",  section: "6.0", category: null },
  piscine:         { label: "Piscine/PAC",      icon: "🏊", ampMax: 20, dedié: true,  diffType: "F",  section: "2.5", category: null },
  vmc:             { label: "VMC",              icon: "💨", ampMax: 10, dedié: true,  diffType: "AC", section: "1.5", category: null },
  alarme:          { label: "Alarme",           icon: "🔔", ampMax: 6,  dedié: true,  diffType: "AC", section: "1.5", category: null },
  // NF C 15-100 : 1 circuit dédié 16 A / 1,5 mm² pour l'ensemble des volets roulants (partagé,
  // d'où dedié:false — contrairement aux appareils à un circuit par instance), différentiel AC.
  volets_roulants: { label: "Volets roulants",  icon: "🪟", ampMax: 16, dedié: false, diffType: "AC", section: "1.5", category: null },
  exterieur:       { label: "Extérieur",        icon: "🌿", ampMax: 16, dedié: false, diffType: "AC", section: "1.5", category: "prises" },
  garage:          { label: "Garage",           icon: "🏠", ampMax: 16, dedié: false, diffType: "AC", section: "1.5", category: "prises" },
  general:         { label: "Général / Arrivée",icon: "⚡", ampMax: 63, dedié: true,  diffType: null, section: "10.0", category: null },
  parafoudre:      { label: "Parafoudre",       icon: "⛈️", ampMax: 0,  dedié: true,  diffType: null, section: null,  category: null },
  autre:           { label: "Autre",            icon: "⚙️", ampMax: 32, dedié: false, diffType: "AC", section: "2.5", category: null },
  // Courant faible : un câble RJ45 par prise, en étoile vers le coffret de communication. Circuit de PLAN uniquement
  // (tracé, longueur, couleur) : jamais de disjoncteur, jamais poussé au tableau (voir CIRCUIT_COMMUNICATION).
  // Appareils modulaires du tableau (voir BREAKER_TYPES « accessoire ») : pas des circuits à part entière.
  coupure_generale: { label: "Coupure générale", icon: "⏻", ampMax: 160, dedié: true, diffType: null, section: "10.0", category: null },
  prise_modulaire: { label: "Prise 16A modulaire", icon: "🔌", ampMax: 16, dedié: true, diffType: null, section: "1.5", category: null },
  communication:   { label: "RJ45 (communication)", icon: "🌐", ampMax: 0, dedié: true, diffType: null, section: null, category: null },
};
export const CIRCUIT_COMMUNICATION = "communication";
// Vrai pour un circuit qui n'a pas de disjoncteur au tableau (courant faible).
export const estCircuitSansDisjoncteur = (b: { circuit: string }): boolean => b.circuit === CIRCUIT_COMMUNICATION;

export const SECTIONS_CABLE = ["1.5", "2.5", "4.0", "6.0", "10.0"];

// Diamètre EXTÉRIEUR (mm) d'UN conducteur isolé H07V-U / H07V-R (valeurs hautes de la norme) : gaineRecommandee compte les conducteurs
// un par un (phase, neutre, terre = 3 entrées). Ces valeurs valaient avant ~6,8 à 13 mm — des diamètres de câbles multiconducteurs
// comptés trois fois — ce qui surdimensionnait les gaines (une simple prise en IRL 32).
export const CABLE_DIAM_MM: Record<string, number> = {
  "1.5": 3.3, "2.5": 4.0, "4.0": 4.8, "6.0": 5.4, "10.0": 7.2,
};

export const GAINES_IRL = [
  { label: "IRL 16", diamInt: 12.2 },
  { label: "IRL 20", diamInt: 15.8 },
  { label: "IRL 25", diamInt: 20.0 },
  { label: "IRL 32", diamInt: 26.0 },
  { label: "IRL 40", diamInt: 33.0 },
];

// COURANTS FAIBLES (RJ45 / VDI, coaxial TV, antenne) : gaine de couleur VERTE, séparée des gaines de puissance (convention normalisée des
// réseaux de communication, NF C 15-100 / guide VDI UTE C 90-483 ; les gaines de puissance, elles, ne sont pas vertes). Un câble de
// communication (cat. 6 STP ou coaxial, ~7 mm) passe dans sa propre gaine : ICTA verte Ø20 en pose encastrée (jamais sous le Ø20 recommandé
// pour tirer un câble blindé sans le contraindre), IRL verte Ø20 en pose apparente.
export const GAINE_COMMUNICATION_DIAMETRE = 20;
export const gaineCommunication = (pose: "encastre" | "apparent" = "encastre") =>
  `${pose === "apparent" ? "IRL" : "ICTA"} ${GAINE_COMMUNICATION_DIAMETRE} verte (courants faibles)`;

export const DIFF_HIERARCHY: Record<string, number> = { AC: 0, A: 1, F: 2 };
export const AMPERES = [2, 6, 10, 16, 20, 25, 32, 40, 63];
// Calibres réellement commercialisés pour un interrupteur différentiel (ID) résidentiel —
// distinct de AMPERES (calibres de disjoncteur de circuit) : un ID ne se choisit pas parmi
// les petits calibres (2/6/10/16/20/32A, qui n'existent pas pour ce type d'appareil), et
// 25A reste rare (réservé aux tableaux divisionnaires légers) — 40A/63A couvrent la quasi-
// totalité des tableaux principaux résidentiels, 80/100/125A les installations plus lourdes.
export const AMPERES_DIFFERENTIEL = [25, 40, 63, 80, 100, 125];

// Seuils de regroupement par circuit — alignés sur le compliance checker (checkNFC)
// déjà en place dans /tableau/[clientId]/page.tsx (règles socles16 / socles20).
export const MAX_PAR_CIRCUIT: Record<string, number> = {
  lumiere: 8,          // points lumineux — Art. 771.312
  prise_16: 8,         // socles — Art. 771.314
  exterieur: 8,
  garage: 8,
  cuisine_prises: 6,   // socles cuisine — Art. 771.314.2
  volets_roulants: 8,  // moteurs par circuit — pas de maximum normatif ; 8 pour répartir sur plusieurs circuits (conseil NF C 15-100)
  prise_20: 12,        // NF C 15-100 : 20 A / 2,5 mm² = 12 socles maximum (6 seulement pour le circuit dédié aux prises de cuisine)
};

// Minimums réglementaires de socles par pièce — NF C 15-100, quantitatif socles de prise.
export const MIN_PRISES_PIECE: Record<string, (surface?: number) => number> = {
  sejour:  (s) => (s && s > 28 ? Math.max(7, Math.ceil(s / 4)) : 5),
  chambre: () => 3,
  cuisine: () => 6,
  autre:   (s) => (s && s >= 4 ? 1 : 0),
};

// Plafonds de puissance par circuit de chauffage électrique — NF C 15-100, amendement A5
// (homologué 27/05/2015, obligatoire depuis le 27/11/2015) : un circuit chauffage dédié
// protégé en 16A/1,5mm² accepte jusqu'à 3500 W cumulés, un circuit en 20A/2,5mm² jusqu'à
// 4500 W, sur différentiel 30 mA type AC. Voir genererBreakersChauffage (maison-engine.ts).
export const PMAX_CHAUFFAGE_16A_W = 3500;
export const PMAX_CHAUFFAGE_20A_W = 4500;
export const PUISSANCE_CHAUFFAGE_DEFAUT_W = 1000;

// type : ICTA (gaine annelée, pose ENCASTRÉE — par défaut) ou IRL (gaine rigide, pose APPARENTE). Mêmes diamètres nominaux.
export function gaineRecommandee(sections: string[], type: "ICTA" | "IRL" = "ICTA"): { gaine: string; tauxPct: number; ok: boolean } {
  const totalSection = sections.reduce((sum, s) => {
    const d = CABLE_DIAM_MM[s] ?? 8;
    return sum + Math.PI * (d / 2) ** 2;
  }, 0);
  for (const g of GAINES_IRL) {
    const sectionInt = Math.PI * (g.diamInt / 2) ** 2;
    const taux = Math.round((totalSection / sectionInt) * 100);
    if (taux <= 33) return { gaine: g.label.replace("IRL", type), tauxPct: taux, ok: true };
  }
  const last = GAINES_IRL[GAINES_IRL.length - 1];
  const sectionInt = Math.PI * (last.diamInt / 2) ** 2;
  // Pas de mention verbale de non-conformité dans le libellé (ex. "(insuffisant)") — la
  // gaine calculée reste la plus grande disponible, et `ok: false` seul porte l'info de
  // dépassement pour un éventuel badge dans l'app ; le document imprimé reste factuel.
  return { gaine: last.label.replace("IRL", type), tauxPct: Math.round((totalSection / sectionInt) * 100), ok: false };
}

export function cablesGroupe(groupe: GroupeLumineux, section: string): string[] {
  const cables: string[] = [section, section, section];
  if (groupe.typeCommande === "simple") {
    cables.push("1.5");
  } else if (groupe.typeCommande === "vav") {
    cables.push("1.5", "1.5");
  } else {
    for (let i = 0; i < groupe.nbCommandes; i++) cables.push("1.5");
    cables.push("1.5");
  }
  return cables;
}

export function cablesPrises(section: string): string[] {
  return [section, section, section];
}

export function labelCommande(g: GroupeLumineux): string {
  if (g.typeCommande === "simple") return "Simple allumage";
  if (g.typeCommande === "vav") return `Va-et-vient (${g.nbCommandes} inter.)`;
  return `Télérupteur (${g.nbCommandes} BP)`;
}

export function getCategory(circuit: string): CircuitCategory | null {
  return CIRCUITS[circuit]?.category ?? null;
}

export function effectiveSection(b: Breaker): string {
  return b.customSection ?? CIRCUITS[b.circuit]?.section ?? "2.5";
}

let _uidCounter = 0;
export const uid = (): number => ++_uidCounter;
