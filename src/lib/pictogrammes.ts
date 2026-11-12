// src/lib/pictogrammes.ts
//
// PICTOGRAMMES des étiquettes : dessins vectoriels simples (traits, boîte 24 × 24) et reconnaissance automatique par mots-clés
// (« lave-linge » → machine à laver). Les dessins sont des primitives géométriques, rendues à l'identique en SVG (aperçu) et en jsPDF (PDF).
// Fonctions pures, sans accès navigateur.

/** t : l = ligne (x1 y1 x2 y2) · r = rectangle (x y l h rayon) · c = cercle (cx cy r) · d = point plein (cx cy r)
 *      p = ligne brisée ouverte (x y x y …) · z = polygone fermé (x y x y …). */
export interface Primitive { t: "l" | "r" | "c" | "d" | "p" | "z"; v: number[] }
export interface Pictogramme { id: string; nom: string; motsCles: string[]; prims: Primitive[] }

/** Épaisseur de trait dans la boîte 24 × 24. */
export const TRAIT_PICTO = 1.6;
export const BOITE_PICTO = 24;

const L = (x1: number, y1: number, x2: number, y2: number): Primitive => ({ t: "l", v: [x1, y1, x2, y2] });
const R = (x: number, y: number, w: number, h: number, r = 0): Primitive => ({ t: "r", v: [x, y, w, h, r] });
const C = (cx: number, cy: number, r: number): Primitive => ({ t: "c", v: [cx, cy, r] });
const D = (cx: number, cy: number, r = 0.9): Primitive => ({ t: "d", v: [cx, cy, r] });
const P = (...v: number[]): Primitive => ({ t: "p", v });
const Z = (...v: number[]): Primitive => ({ t: "z", v });
/** Arc de cercle (degrés, repère écran : 0° = droite, 90° = bas, 270° = haut) en ligne brisée. */
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 14): Primitive => {
  const v: number[] = [];
  for (let i = 0; i <= n; i++) { const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180; v.push(+(cx + r * Math.cos(a)).toFixed(2), +(cy + r * Math.sin(a)).toFixed(2)); }
  return P(...v);
};
const tourner = (v: number[], deg: number, cx = 12, cy = 12): number[] => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), sortie: number[] = [];
  for (let i = 0; i < v.length; i += 2) { const x = v[i] - cx, y = v[i + 1] - cy; sortie.push(+(cx + x * c - y * s).toFixed(2), +(cy + x * s + y * c).toFixed(2)); }
  return sortie;
};
const pale = [12, 12, 10.6, 3.6, 15.8, 5.2];

const MACHINE = [R(4, 2, 16, 20, 2), L(4, 7, 20, 7), D(7, 4.5, 0.8), D(10, 4.5, 0.8)];

/**
 * ORDRE = PRIORITÉ : le premier pictogramme dont un mot-clé figure dans le texte l'emporte. Les appareils précis passent donc avant les
 * mots génériques (« Prise lave-linge » → lave-linge, pas prise). Mot-clé terminé par « * » = début de mot (« eclairag* » → éclairage, éclairages).
 * Les mots-clés sont écrits sans accent, en minuscules, séparés par des espaces (« lave linge » reconnaît aussi « Lave-linge »).
 */
export const PICTOS: Record<string, Pictogramme> = Object.fromEntries(([
  { id: "seche_linge", nom: "Sèche-linge", motsCles: ["seche linge*"], prims: [...MACHINE, C(12, 14.5, 5), P(9, 14.5, 10.5, 12.8, 12, 14.5, 13.5, 16.2, 15, 14.5)] },
  { id: "lave_linge", nom: "Lave-linge", motsCles: ["lave linge*", "machine a laver", "machine laver"], prims: [...MACHINE, C(12, 14.5, 5), arc(12, 14.5, 2.6, 190, 350)] },
  { id: "lave_vaisselle", nom: "Lave-vaisselle", motsCles: ["lave vaisselle*"],
    prims: [R(4, 2, 16, 20, 2), L(4, 7, 20, 7), D(7, 4.5, 0.8), L(7, 12, 17, 12), arc(9.2, 16.2, 2.4, 0, 180), arc(14.8, 16.2, 2.4, 0, 180)] },
  { id: "seche_serviette", nom: "Sèche-serviette", motsCles: ["seche serviette*"],
    prims: [L(6, 3, 6, 21), L(18, 3, 18, 21), L(6, 6.5, 18, 6.5), L(6, 10.5, 18, 10.5), L(6, 14.5, 18, 14.5), L(6, 18.5, 18, 18.5)] },
  { id: "chauffe_eau", nom: "Chauffe-eau", motsCles: ["chauffe eau*", "cumulus", "ballon", "eau chaude", "ecs"],
    prims: [R(6, 2, 12, 18, 5), L(9, 20, 9, 22.5), L(15, 20, 15, 22.5), P(9, 9, 10.5, 7.5, 12, 9, 13.5, 10.5, 15, 9), P(9, 14, 10.5, 12.5, 12, 14, 13.5, 15.5, 15, 14)] },
  { id: "micro_ondes", nom: "Micro-ondes", motsCles: ["micro ondes", "microondes", "micro onde*"],
    prims: [R(2, 5, 20, 14, 2), R(5, 8, 10, 8, 1), D(18.5, 9, 0.8), D(18.5, 12, 0.8), D(18.5, 15, 0.8)] },
  { id: "plaque", nom: "Plaque de cuisson", motsCles: ["plaque*", "cuisson", "induction", "vitroceramique", "cuisiniere", "gaziniere"],
    prims: [R(3, 4, 18, 16, 2), C(8, 9, 2.2), C(16, 9, 2.2), C(8, 15, 2.2), C(16, 15, 2.2)] },
  { id: "four", nom: "Four", motsCles: ["four", "fours"],
    prims: [R(3, 3, 18, 18, 2), L(3, 8, 21, 8), D(7, 5.5, 0.8), D(10.5, 5.5, 0.8), D(14, 5.5, 0.8), R(6, 11, 12, 7, 1)] },
  { id: "hotte", nom: "Hotte", motsCles: ["hotte*"], prims: [Z(9, 3, 15, 3, 21, 11, 3, 11), L(7, 15, 7, 19.5), L(12, 15, 12, 21), L(17, 15, 17, 19.5)] },
  { id: "frigo", nom: "Réfrigérateur / congélateur", motsCles: ["frigo*", "refrigerateur*", "congelateur*", "frigidaire", "cave a vin"],
    prims: [R(6, 2, 12, 20, 2), L(6, 9, 18, 9), L(9, 5, 9, 7), L(9, 12, 9, 16)] },
  { id: "clim", nom: "Climatisation / pompe à chaleur", motsCles: ["clim*", "pac", "pompe a chaleur", "split"],
    prims: [R(2, 5, 20, 8, 2), L(4, 10.5, 20, 10.5), L(6, 16, 5, 20.5), L(12, 16, 12, 21.5), L(18, 16, 19, 20.5)] },
  { id: "chauffage", nom: "Radiateur / chauffage", motsCles: ["radiateur*", "chauffage*", "convecteur*", "plancher chauffant", "accumulateur*", "inertie", "soufflant*"],
    prims: [R(3, 4, 18, 14, 2), L(8, 4, 8, 18), L(12, 4, 12, 18), L(16, 4, 16, 18), L(6, 18, 6, 21), L(18, 18, 18, 21)] },
  { id: "vmc", nom: "VMC / ventilation", motsCles: ["vmc", "ventilat*", "extracteur*", "aeration", "ventilo*"],
    prims: [C(12, 12, 10), Z(...pale), Z(...tourner(pale, 120)), Z(...tourner(pale, 240)), D(12, 12, 1.4)] },
  { id: "volet", nom: "Volet roulant / store", motsCles: ["volet*", "store*", "bso", "brise soleil", "pergola*"],
    prims: [R(4, 3, 16, 18, 1), L(4, 7.5, 20, 7.5), L(4, 12, 20, 12), L(4, 16.5, 20, 16.5)] },
  { id: "portail", nom: "Portail / porte de garage", motsCles: ["portail*", "portillon*", "porte de garage", "porte garage", "motorisation*"],
    prims: [L(3, 3, 3, 21), L(21, 3, 21, 21), L(1.5, 21, 22.5, 21), R(5.5, 8, 6, 10), R(12.5, 8, 6, 10), L(5.5, 18, 11.5, 8), L(18.5, 18, 12.5, 8)] },
  { id: "borne", nom: "Borne de recharge", motsCles: ["borne*", "irve", "wallbox", "vehicule*", "voiture*", "recharge*"],
    prims: [R(4, 2, 11, 17.5, 2), Z(10.2, 4.8, 6.8, 11, 9.4, 11, 8.4, 16.2, 12.6, 9.4, 10, 9.4), L(3, 21.5, 16, 21.5), P(15, 10, 19.5, 10, 19.5, 15.5), D(19.5, 18, 1.2)] },
  { id: "sonnette", nom: "Sonnette / visiophone", motsCles: ["sonnette*", "visiophone*", "interphone*", "portier*", "carillon*"],
    prims: [arc(12, 11, 6, 180, 360), L(6, 11, 6, 17), L(18, 11, 18, 17), L(4, 17, 20, 17), C(12, 20.2, 1.4), L(12, 3, 12, 5)] },
  { id: "detecteur", nom: "Alarme / détecteur", motsCles: ["alarme*", "detecteur*", "fumee", "sirene*", "daaf", "intrusion"],
    prims: [C(12, 12, 10), C(12, 12, 5.5), D(12, 12, 1.4)] },
  { id: "piscine", nom: "Piscine / spa", motsCles: ["piscine*", "spa", "jacuzzi", "bassin*"],
    prims: [P(8, 11, 8, 3.5, 12.5, 3.5, 12.5, 11), L(8, 7, 12.5, 7), P(2, 15, 5, 12.5, 8, 15, 11, 12.5, 14, 15, 17, 12.5, 20, 15, 22, 13.5), P(2, 20, 5, 17.5, 8, 20, 11, 17.5, 14, 20, 17, 17.5, 20, 20, 22, 18.5)] },
  { id: "terre", nom: "Terre / parafoudre", motsCles: ["terre", "parafoudre*", "paratonnerre*", "liaison equipotentielle"],
    prims: [L(12, 3, 12, 12), L(4.5, 12, 19.5, 12), L(7.5, 15.8, 16.5, 15.8), L(10.3, 19.6, 13.7, 19.6)] },
  { id: "coupure", nom: "Coupure générale", motsCles: ["coupure*", "agcp", "sectionneur*", "arret d urgence", "marche arret"],
    prims: [arc(12, 13, 7.5, -60, 240), L(12, 3.5, 12, 12)] },
  { id: "disjoncteur", nom: "Disjoncteur / différentiel", motsCles: ["disjoncteur*", "differentiel*", "id", "dj", "30 ma", "protection*"],
    prims: [R(6.5, 2.5, 11, 19, 1.5), R(9.5, 5.5, 5, 6.5, 0.6), C(12, 16.5, 1.6)] },
  { id: "tableau", nom: "Tableau / coffret", motsCles: ["tableau*", "coffret*", "gtl", "armoire*", "rangee*"],
    prims: [R(3, 2.5, 18, 19, 2), R(6, 5, 2.6, 5), R(10.7, 5, 2.6, 5), R(15.4, 5, 2.6, 5), R(6, 14, 2.6, 5), R(10.7, 14, 2.6, 5), R(15.4, 14, 2.6, 5)] },
  { id: "tv", nom: "Télévision / écran", motsCles: ["tv", "television*", "ecran*", "home cinema"],
    prims: [R(2.5, 4, 19, 12.5, 1.5), L(8, 20, 16, 20), L(12, 16.5, 12, 20)] },
  { id: "reseau", nom: "Réseau / RJ45 / Wi-Fi", motsCles: ["wifi", "wi fi", "rj45", "rj 45", "internet", "reseau*", "box", "fibre", "ethernet", "communication*", "multimedia", "telephone*"],
    prims: [arc(12, 19, 5, 225, 315), arc(12, 19, 10, 225, 315), arc(12, 19, 15, 225, 315), D(12, 19, 1.3)] },
  { id: "interrupteur", nom: "Interrupteur", motsCles: ["interrupteur*", "va et vient", "bouton*", "variateur*", "poussoir*", "telerupteur*", "commande*"],
    prims: [R(4, 4, 16, 16, 2), R(9, 7, 6, 10, 1), L(9, 12, 15, 12)] },
  { id: "prise", nom: "Prise de courant", motsCles: ["prise*", "pc", "socle*"],
    prims: [C(12, 12, 10), D(8.8, 12.8, 1.1), D(15.2, 12.8, 1.1), D(12, 6.8, 1)] },
  { id: "ampoule", nom: "Éclairage", motsCles: ["lumiere*", "eclairag*", "luminaire*", "plafonnier*", "spot*", "applique*", "lampe*", "led", "ampoule*", "guirlande*", "lustre*", "reglette*", "hublot*"],
    prims: [C(12, 9, 6.5), L(9.5, 17.5, 14.5, 17.5), L(10, 20, 14, 20), L(11, 22.3, 13, 22.3), P(9.5, 9, 10.7, 11.5, 12, 9, 13.3, 11.5, 14.5, 9)] },
] as Pictogramme[]).map(p => [p.id, p]));

export const LISTE_PICTOS: Pictogramme[] = Object.values(PICTOS);

/** « aucune » = l'utilisateur a choisi de ne pas mettre de pictogramme ; absent / « auto » = reconnaissance automatique. */
export const PICTO_AUCUN = "aucune";
export const PICTO_AUTO = "auto";

export const pictoValide = (id: unknown): id is string => typeof id === "string" && Object.prototype.hasOwnProperty.call(PICTOS, id);

const normaliser = (t: string): string => ` ${t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Pictogramme qui correspond au texte, ou null. Insensible à la casse, aux accents, aux tirets et aux pluriels des mots-clés « * ». */
export function detecterPicto(texte: unknown): string | null {
  if (typeof texte !== "string" || texte.trim() === "") return null;
  const t = normaliser(texte);
  for (const p of LISTE_PICTOS) {
    for (const mot of p.motsCles) {
      const prefixe = mot.endsWith("*");
      const m = normaliser(prefixe ? mot.slice(0, -1) : mot).trimEnd();   // « " lave linge" » ; garde l'espace de tête
      if (prefixe ? t.includes(m) : t.includes(`${m} `)) return p.id;
    }
  }
  return null;
}

/**
 * Pictogramme à imprimer pour une étiquette : le choix explicite de l'utilisateur, sinon la reconnaissance automatique ; null si les
 * pictogrammes sont désactivés, si l'utilisateur n'en veut pas, ou si rien n'est reconnu.
 */
export function pictoPour(e: { texte: string; icone?: string }, actifs = true): string | null {
  if (!actifs || e.icone === PICTO_AUCUN) return null;
  if (pictoValide(e.icone)) return e.icone;
  return detecterPicto(e.texte);
}
