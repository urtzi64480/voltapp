// src/lib/devis-vocal.ts
//
// DEVIS PAR DICTÉE : « pour Monsieur Dupont, 5 prises 16 A, 3 spots, un disjoncteur différentiel 40 A et 2 heures de main d'œuvre »
// → client reconnu + lignes rapprochées du CATALOGUE de l'électricien. Fonctions pures, sans réseau, sans IA payante.
// Règle d'or : aucun prix n'est inventé. Ce qui ne correspond à aucun article devient une ligne « À compléter » à 0 €.

import type { Client, DevisLigne, Prestation } from "@/types";
import { ligneDepuisArticle, PREFIXE_A_COMPLETER } from "./devis-lignes";
import { articleAuMetre, estBobinable, genererLignesDevis, optionDepuisPrestation, type BesoinApparie, type Conditionnement } from "./predevis-engine";
import { sousCategoriesDe } from "./sous-categories";

// ─── Texte ────────────────────────────────────────────────────────────────────────────────────────────────────────

const sansAccent = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");
const minuscules = (t: string) => sansAccent(t).toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae");

// ─── Erreurs classiques de la reconnaissance vocale ──────────────────────────────────────────────────────────────

const CORRECTIONS_VOCALES: [RegExp, string][] = [
  [/\b(\d+)\s+virgule\s+(\d+)\b/gi, "$1,$2"],                                   // « 2 virgule 5 » → 2,5
  [/\b(?:des?|dis|dit|disque|dix)\s*[-]?\s*joncteurs?\b/gi, "disjoncteur"],        // « des joncteurs », « disque joncteur »
  [/\bdisjoncteu?rs?\b/gi, "disjoncteur"],
  [/\bva\s*(?:et\s*)?vien[st]?\b/gi, "va et vient"],
  [/\br\.?\s*j\.?\s*45\b/gi, "rj45"],
  [/\b(\d+(?:[.,]\d+)?)\s*(?:mm|millim[eè]tres?)\s*(?:carr[eé]s?|²|2)(?![a-z0-9àâäçéèêëîïôöùûü])/gi, "$1 mm"],
  [/\bprises?\s+de\s+courants?\b/gi, "prise"],
  [/\bmain\s+d[' ]?\s*œuvre\b/gi, "main d'oeuvre"],
];

/** Corrige les erreurs de transcription les plus fréquentes du vocabulaire électrique. Idempotent. */
export function corrigerReconnaissance(texte: string): string {
  return CORRECTIONS_VOCALES.reduce((t, [re, to]) => t.replace(re, to), texte ?? "");
}

// ─── Proximité phonétique (« prisent » ≈ « prises », « spotte » ≈ « spot ») ──────────────────────────────────────

const cacheSon = new Map<string, string>();

/** Clé phonétique approximative du français : deux mots qui se prononcent presque pareil ont des clés proches. */
export function cleSon(mot: string): string {
  const memo = cacheSon.get(mot);
  if (memo !== undefined) return memo;
  let s = minuscules(mot).replace(/[^a-z]/g, "");
  s = s.replace(/ph/g, "f").replace(/ch/g, "5").replace(/qu/g, "k").replace(/ck/g, "k").replace(/gu(?=[eiy])/g, "g")
    .replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/g(?=[eiy])/g, "j")
    .replace(/eau|au/g, "o").replace(/ou/g, "u").replace(/oi/g, "wa").replace(/ai|ei/g, "e")
    .replace(/(?:an|am|en|em)(?![aeiouy])/g, "a").replace(/(?:on|om)(?![aeiouy])/g, "o").replace(/(?:ain|ein|in|im|un)(?![aeiouy])/g, "1")
    .replace(/y/g, "i").replace(/h/g, "").replace(/(?<=[aeiou1])s(?=[aeiou1])/g, "z")
    .replace(/(.)\1+/g, "$1");
  if (s.length > 3) s = s.replace(/(?:nt|[sxtd])+$/, "").replace(/e$/, "");
  cacheSon.set(mot, s);
  return s;
}

function distance(a: string, b: string): number {
  const d: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prec = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prec + (a[i - 1] === b[j - 1] ? 0 : 1));
      prec = tmp;
    }
  }
  return d[b.length];
}

/** Deux mots (≥ 4 lettres, non numériques) qui sonnent presque pareil. */
export function sonProche(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4 || /\d/.test(a) || /\d/.test(b)) return false;
  const ka = cleSon(a), kb = cleSon(b);
  if (ka.length < 3 || kb.length < 3) return false;
  if (ka === kb) return true;
  if (ka[0] !== kb[0]) return false;
  return distance(ka, kb) <= (Math.max(ka.length, kb.length) >= 7 ? 2 : 1);
}

const UNITES: Record<string, number> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
  treize: 13, quatorze: 14, quinze: 15, seize: 16,
};
const DIZAINES: Record<string, number> = { vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 };
const estMotNombre = (m: string) => m in UNITES || m in DIZAINES || m === "cent" || m === "cents" || m === "et";

/** Lit un nombre écrit en lettres (0–999) à partir de `i`. Renvoie la valeur et le nombre de mots consommés, ou null. */
function lireNombre(mots: string[], i: number): { valeur: number; n: number } | null {
  let total = 0, courant = 0, n = 0, vu = false;
  for (let k = i; k < mots.length; k++) {
    const m = mots[k];
    if (m in UNITES) { courant += UNITES[m]; vu = true; n++; continue; }
    if (m === "vingt" || m === "vingts") {
      if (courant === 4) { courant = 80; vu = true; n++; continue; }   // quatre-vingt(s)
      courant += 20; vu = true; n++; continue;
    }
    if (m in DIZAINES) { courant += DIZAINES[m]; vu = true; n++; continue; }
    if (m === "cent" || m === "cents") { total += (courant || 1) * 100; courant = 0; vu = true; n++; continue; }
    if (m === "et" && vu && (mots[k + 1] === "un" || mots[k + 1] === "une" || mots[k + 1] === "onze") && courant % 10 === 0 && courant >= 20) { n++; continue; }
    break;
  }
  if (!vu) return null;
  return { valeur: total + courant, n };
}

/**
 * Remplace les nombres écrits en lettres par des chiffres. « un / une » ne sont convertis qu'en début de segment (ce sont surtout des articles :
 * « pour une cuisine » ne doit pas devenir « pour 1 cuisine »).
 */
export function chiffrer(texte: string): string {
  const mots = texte.split(/(\s+|-)/).filter(x => x !== "" && x !== "-" && !/^\s+$/.test(x));
  const bas = mots.map(m => minuscules(m).replace(/[^a-z0-9.,]/g, ""));
  const sortie: string[] = [];
  for (let i = 0; i < mots.length;) {
    const debutSegment = sortie.length === 0 || /[.;,]$/.test(sortie[sortie.length - 1]);
    if (estMotNombre(bas[i]) && bas[i] !== "et") {
      const r = lireNombre(bas, i);
      if (r) {
        const seulArticle = r.n === 1 && (bas[i] === "un" || bas[i] === "une");
        if (!seulArticle || debutSegment) { sortie.push(String(r.valeur)); i += r.n; continue; }
      }
    }
    sortie.push(mots[i]); i++;
  }
  return sortie.join(" ");
}

// ─── Découpage ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SegmentDicte {
  /** Texte du segment tel que dicté (pour l'affichage). */
  brut: string;
  quantite: number;
  /** Libellé sans la quantité ni les mots de liaison, prêt à être rapproché du catalogue. */
  libelle: string;
  /** Segment de main d'œuvre : la quantité est un nombre d'heures. */
  heures: boolean;
  /** « 20 mètres de câble » : la quantité est une longueur. */
  metres: boolean;
  /** « 2 bobines de câble » : la quantité est un nombre de bobines / rouleaux (pas de découpage en mètres). */
  bobines: boolean;
}

const PROTEGES: [RegExp, string][] = [
  [/\bva et vient\b/gi, "va_et_vient"],
  [/\baller et retour\b/gi, "aller_et_retour"],
];

const REMPLISSAGE = /\b(je veux|je voudrais|il faut|il me faut|on veut|on a besoin de|prevoir|prevois|mets|mettre|ajoute|ajouter|rajoute|rajouter|compte|comptez|devis pour|devis|fourniture et pose( de| d')?|fourniture|svp|s'il te plait|s'il vous plait|aussi|egalement|encore)\b/gi;

/** « 2 heures et demie » → « 2.5 heures » ; « une demi-heure » → « 0.5 heure ». */
function heuresDemies(t: string): string {
  return t
    .replace(/\b(\d+(?:[.,]\d+)?)\s*(heures?|h)\s+et\s+demie?\b/gi, (_m, n: string, u: string) => `${parseFloat(n.replace(",", ".")) + 0.5} ${u}`)
    .replace(/\b(?:1\s+)?demi[\s-]*heure\b/gi, "0.5 heure");
}

const MOTS_HEURES = /^(heures?|h|hr|hrs)$/;
const MOTS_MO = /\b(main d'?(?:oe|œ)uvre|mo|temps de travail|installation|intervention)\b/;

function nombreDe(t: string): number {
  return parseFloat(t.replace(",", "."));
}

// ─── Dictée naturelle : on coupe là où une nouvelle quantité commence, sans besoin de dire « plus » ─────────────────

// Mots qui suivent un nombre SANS en faire une quantité : « 16 ampères », « 2,5 mm », « 230 volts »…
const UNITES_SPEC = new Set(["a", "amp", "amps", "ampere", "amperes", "ma", "mm", "mm2", "millimetre", "millimetres", "v", "volt", "volts", "w", "watt", "watts", "kw", "kva", "va", "pole", "poles", "p", "m2", "degre", "degres", "lumens", "lm", "k", "mhz"]);
const LIAISONS = new Set(["un", "une", "de", "du", "des", "d", "et", "ou", "x", "fois", "le", "la", "les"]);
// Un nombre précédé de ces mots est une caractéristique (« type 2 », « calibre 16 »), pas une quantité.
const AVANT_SPEC = new Set(["type", "n", "no", "numero", "num", "ref", "reference", "calibre", "section", "diametre", "taille", "de", "du", "d", "x", "fois", "au", "aux", "en", "sur", "sous", "jusqu", "environ", "ou"]);
// « un / une » après ces mots est un article (« pour une cuisine »), pas une quantité.
const PREPOSITIONS = new Set(["pour", "dans", "sur", "sous", "de", "du", "d", "en", "a", "au", "aux", "chez", "avec", "par", "entre", "vers", "sans", "comme", "ou", "dont", "que", "qui"]);

const mot = (tok: string) => minuscules(tok).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "").replace(/'$/, "");
const estNombreTok = (tok: string) => /^\d+(?:[.,]\d+)?$/.test(tok);
const estMotTok = (tok: string) => /^[a-zà-ÿœ][a-zà-ÿœ'’-]*$/i.test(tok.replace(/[.,;:!?]+$/, ""));

/**
 * Insère une virgule avant chaque nouvelle quantité : « 5 prises 16 ampères 3 spots un disjoncteur 40 A » → « 5 prises 16 ampères, 3 spots, un disjoncteur 40 A ».
 * Un nombre est une quantité s'il est suivi d'un mot qui n'est pas une unité technique (ampères, mm…) et si l'article précédent est déjà décrit ;
 * « un / une » en est une sauf après une préposition. Les nombres nus (« câble 2,5 ») restent des caractéristiques.
 */
export function couperAuxQuantites(texte: string): string {
  const tok = texte.split(/\s+/).filter(Boolean);
  const sortie: string[] = [];
  let motsDansSegment = 0;
  for (let i = 0; i < tok.length; i++) {
    const cur = tok[i], suivant = tok[i + 1], precedent = i > 0 ? mot(tok[i - 1]) : "";
    const m = mot(cur);
    const fin = /[,;.]$/.test(sortie[sortie.length - 1] ?? "");
    if (fin || sortie.length === 0) motsDansSegment = 0;
    let coupe = false;
    if (motsDansSegment > 0 && suivant !== undefined && estMotTok(suivant)) {
      const s = mot(suivant);
      if (estNombreTok(cur) && !UNITES_SPEC.has(s) && !LIAISONS.has(s) && !AVANT_SPEC.has(precedent)) coupe = true;
      else if ((m === "un" || m === "une") && !PREPOSITIONS.has(precedent) && !LIAISONS.has(s)) coupe = true;
    }
    if (coupe && sortie.length > 0 && !/[,;.]$/.test(sortie[sortie.length - 1])) sortie[sortie.length - 1] += ",";
    if (coupe) motsDansSegment = 0;
    sortie.push(cur);
    if (estMotTok(cur) && !LIAISONS.has(m)) motsDansSegment++;
  }
  return sortie.join(" ");
}

/** Découpe une dictée en segments (un article ou une prestation chacun). Le nom du client doit avoir été retiré avant. */
export function decouperDictee(texte: string): SegmentDicte[] {
  let t = corrigerReconnaissance(texte ?? "").replace(/[\n\r]+/g, ", ").replace(/\s+/g, " ").trim();
  if (!t) return [];
  t = heuresDemies(chiffrer(t));
  PROTEGES.forEach(([re, to]) => { t = t.replace(re, to); });
  t = t.replace(REMPLISSAGE, " ").replace(/\s+/g, " ");
  t = couperAuxQuantites(t);
  const morceaux = t.split(/\s*(?:(?<!\d)[,;.]|[,;.](?!\d)|\bet\b|\bpuis\b|\bplus\b|\bensuite\b|\bavec\b|\bainsi que\b|[+&])\s*/i).map(s => s.trim()).filter(Boolean);
  const segments: SegmentDicte[] = [];
  for (const morceau of morceaux) {
    const m = morceau.replace(/va_et_vient/g, "va et vient").replace(/aller_et_retour/g, "aller et retour").trim();
    if (!/[a-z0-9]/i.test(minuscules(m))) continue;
    let quantite = 1;
    let reste = m;
    // Quantité : « 5 prises », « x5 prises », « prises x 5 », « 5 fois … ».
    const debut = reste.match(/^(?:x\s*)?(\d+(?:[.,]\d+)?)\s*(?:x|fois)?\s+(.*)$/i);
    const fin = reste.match(/^(.*?)\s+(?:x|fois)\s*(\d+(?:[.,]\d+)?)$/i);
    if (debut) { quantite = nombreDe(debut[1]); reste = debut[2]; }
    else if (fin) { quantite = nombreDe(fin[2]); reste = fin[1]; }
    reste = reste.replace(/^(?:un|une|des|du|de la|de l'|le|la|les)\s+/i, "").trim();
    const premier = minuscules(reste).split(/\s+/)[0] ?? "";
    const heures = MOTS_HEURES.test(premier) || (debut !== null && MOTS_MO.test(minuscules(reste)) && /\b(heures?|h)\b/.test(minuscules(m)));
    let libelle = reste;
    let metres = false, bobines = false;
    if (heures) libelle = reste.replace(/^(heures?|h|hr|hrs)\b\s*(de|d')?\s*/i, "");
    else if (/^(metres?|mètres?|m|ml)(?=\s)/i.test(reste) && debut) { metres = true; libelle = reste.replace(/^(metres?|mètres?|m|ml)\s+(?:(?:de|d')\s*)?/i, ""); }
    else if (/^(bobines?|rouleaux?|couronnes?|bottes?|barres?)(?=\s)/i.test(minuscules(reste)) && debut) { bobines = true; libelle = reste.replace(/^\S+\s+(?:(?:de|d')\s*)?/i, ""); }
    libelle = libelle.replace(/\b(de|d')\s*$/i, "").trim();
    if (!Number.isFinite(quantite) || quantite <= 0) quantite = 1;
    if (!libelle && !heures) continue;
    segments.push({ brut: m, quantite, libelle: libelle || "main d'oeuvre", heures: heures || (!debut && MOTS_MO.test(minuscules(m)) && /\b(heures?)\b/.test(minuscules(m))), metres, bobines });
  }
  return segments;
}

// ─── Client ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ClientCourt { id: string; nom: string; prenom?: string | null }

/** Retire de la dictée la mention « pour / chez / client … » du client reconnu, et le renvoie. Prudent : aucun client si le rapprochement est ambigu. */
export function detecterClient<C extends ClientCourt>(texte: string, clients: C[]): { client: C | null; reste: string } {
  const bas = minuscules(texte);
  const re = /\b(?:pour|chez|client|cliente)\s+((?:(?:monsieur|madame|mademoiselle|mme|mlle|mr|m)\.?\s+)?[a-z'-]+(?:\s+[a-z'-]+){0,2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bas)) !== null) {
    const mots = m[1].replace(/^(?:monsieur|madame|mademoiselle|mme|mlle|mr|m)\.?\s+/, "").split(/\s+/).filter(Boolean);
    // On teste d'abord 1, 2 puis 3 mots : « Dupont », « Jean Dupont »…
    for (let k = 1; k <= mots.length; k++) {
      const cible = mots.slice(0, k).join(" ");
      const trouves = clients.filter(c => {
        const nom = minuscules(c.nom ?? "").trim(), pre = minuscules(c.prenom ?? "").trim();
        return nom.length >= 3 && (cible === nom || cible === `${pre} ${nom}`.trim() || cible === `${nom} ${pre}`.trim());
      });
      if (trouves.length === 1) {
        const debut = m.index, fin = m.index + m[0].indexOf(mots[0]) + cible.length;
        const reste = (texte.slice(0, debut) + " " + texte.slice(fin)).replace(/\s+/g, " ").replace(/^[\s,;.]+|[\s,;.]+$/g, "");
        return { client: trouves[0], reste };
      }
    }
  }
  return { client: null, reste: texte };
}

// ─── Rapprochement catalogue ──────────────────────────────────────────────────────────────────────────────────────

const MOTS_VIDES = new Set(["de", "du", "des", "la", "le", "les", "un", "une", "d", "l", "en", "au", "aux", "pour", "sur", "dans", "avec", "et", "ou", "a", "par", "type"]);
const SYNONYMES: Record<string, string> = {
  pc: "prise", socle: "prise", socles: "prise", dj: "disjoncteur", diff: "differentiel", id: "differentiel", inter: "interrupteur", interrupteurs: "interrupteur",
  ampere: "a", amperes: "a", amp: "a", mm2: "mm", millimetres: "mm", millimetre: "mm", cable: "cable", cables: "cable", fil: "fil", fils: "fil",
  luminaire: "luminaire", luminaires: "luminaire", spot: "spot", spots: "spot", led: "led", rj: "rj45", tableau: "tableau", coffret: "coffret",
};

/** Mots significatifs d'un texte : minuscules, sans accent, singulier approximatif, synonymes, « 16A » → « 16 », « a ». */
export function motsCles(t: string): string[] {
  const propre = minuscules(t).replace(/(\d)\s*([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d),(\d)/g, "$1.$2").replace(/[^a-z0-9.]+/g, " ");
  const mots: string[] = [];
  propre.split(/\s+/).filter(Boolean).forEach(w0 => {
    let w = w0.replace(/^\.+|\.+$/g, "");
    if (!w || MOTS_VIDES.has(w)) return;
    w = SYNONYMES[w] ?? w;
    if (!/^\d/.test(w) && w.length > 3 && /[sx]$/.test(w)) w = w.replace(/[sx]$/, "");
    if (!w || MOTS_VIDES.has(w)) return;
    mots.push(w);
  });
  return mots;
}

export interface Candidat { prestation: Prestation; score: number; couverture: number }

const estNombre = (w: string) => /^\d+(\.\d+)?$/.test(w);

function champsPrestation(p: Prestation): { nom: string[]; autres: string[] } {
  return { nom: motsCles(p.nom), autres: motsCles(`${p.marque ?? ""} ${p.sous_categorie ?? ""} ${p.categorie ?? ""} ${p.description ?? ""}`) };
}

/** Meilleurs articles du catalogue pour un libellé dicté. `couverture` ∈ [0 ; 1] : part des mots dictés retrouvés (nombres inclus). */
export function chercherArticles(libelle: string, prestations: Prestation[], max = 5): Candidat[] {
  const q = motsCles(libelle);
  if (q.length === 0) return [];
  const resultats: Candidat[] = [];
  for (const p of prestations) {
    if (p.actif === false) continue;
    const { nom, autres } = champsPrestation(p);
    let trouve = 0, score = 0, motsNonNombre = 0, retrouvesNonNombre = 0;
    for (const w of q) {
      const nb = estNombre(w);
      if (!nb) motsNonNombre++;
      let pts = 0;
      if (nom.includes(w)) pts = nb ? 3 : 3;
      else if (!nb && w.length >= 4 && nom.some(x => x.startsWith(w) || w.startsWith(x) && x.length >= 4)) pts = 2;
      else if (autres.includes(w)) pts = 1;
      else if (!nb && w.length >= 4 && nom.some(x => sonProche(w, x))) pts = 2;
      if (pts > 0) { trouve++; score += pts; if (!nb) retrouvesNonNombre++; }
      else if (nb && nom.some(estNombre)) score -= 2;   // un calibre / une section différente éloigne l'article
    }
    if (retrouvesNonNombre === 0 && motsNonNombre > 0) continue;
    const couverture = trouve / q.length;
    // Un nom court et précis passe avant un nom long qui contient les mêmes mots.
    score += couverture * 4 - Math.min(nom.length, 12) * 0.05;
    if (couverture > 0) resultats.push({ prestation: p, score, couverture });
  }
  return resultats.sort((a, b) => b.score - a.score).slice(0, max);
}

// ─── Analyse complète ─────────────────────────────────────────────────────────────────────────────────────────────

export type ConfianceLigne = "haute" | "moyenne" | "aucune";

export interface LigneVocale {
  /** Clé stable (texte du segment normalisé) : sert à conserver les corrections de l'électricien quand la dictée change. */
  cle: string;
  segment: SegmentDicte;
  candidats: Candidat[];
  /** Article retenu par défaut (null = « À compléter »). */
  choixAuto: string | null;
  confiance: ConfianceLigne;
}

export interface AnalyseDictee { client: ClientCourt | null; lignes: LigneVocale[] }

const SEUIL_AUTO = 0.75;

/** Clé d'un libellé dicté pour retenir une correction de l'électricien (« prises 16 A » → l'article qu'il a choisi). */
export const cleAlias = (libelle: string): string => motsCles(libelle).join(" ");

/** Articles appris : libellé dicté (cleAlias) → id de prestation. */
export type Alias = Record<string, string>;

export function analyserDictee(texte: string, prestations: Prestation[], clients: ClientCourt[], alias: Alias = {}): AnalyseDictee {
  const { client, reste } = detecterClient(corrigerReconnaissance(texte), clients);
  const segments = decouperDictee(reste);
  const vus = new Map<string, number>();
  const lignes: LigneVocale[] = segments.map(segment => {
    const base = minuscules(segment.brut).replace(/\s+/g, " ");
    const n = (vus.get(base) ?? 0) + 1; vus.set(base, n);
    const candidats = segment.heures ? chercherArticles("main d'oeuvre", prestations.filter(p => p.sous_categorie === "main_oeuvre" || /main d.?oeuvre/.test(minuscules(p.nom))), 3) : chercherArticles(segment.libelle, prestations);
    const idAlias = segment.heures ? undefined : alias[cleAlias(segment.libelle)];
    const appris = idAlias ? prestations.find(x => x.id === idAlias && x.actif !== false) : undefined;
    if (appris) {
      const deja = candidats.findIndex(c => c.prestation.id === appris.id);
      if (deja >= 0) candidats.splice(deja, 1);
      candidats.unshift({ prestation: appris, score: 99, couverture: 1 });
      return { cle: `${base}#${n}`, segment, candidats: candidats.slice(0, 5), choixAuto: appris.id, confiance: "haute" as ConfianceLigne };
    }
    const meilleur = candidats[0];
    const second = candidats[1];
    const net = meilleur && (!second || meilleur.score - second.score >= 0.75 || meilleur.couverture - second.couverture >= 0.25);
    const auto = meilleur && meilleur.couverture >= SEUIL_AUTO && net;
    return {
      cle: `${base}#${n}`, segment, candidats,
      choixAuto: auto ? meilleur.prestation.id : null,
      confiance: auto ? (meilleur.couverture >= 0.99 ? "haute" : "moyenne") : candidats.length > 0 ? "moyenne" : "aucune",
    };
  });
  return { client, lignes };
}

// ─── Lignes de devis ──────────────────────────────────────────────────────────────────────────────────────────────

export interface ChoixLigneVocale { inclus: boolean; quantite: number; prestationId: string | null; conditionnement?: Conditionnement }
export type LigneNouvelle = Omit<DevisLigne, "devis_id" | "ordre">;

/**
 * Sous-catégories d'un article vendu au mètre / en bobine : celle du « besoin » du pré-devis et celle de l'article. Un câble « cable_2.5 » répond
 * au besoin « cablage_2.5 » ; fils, gaines, moulures, RJ45 et coax portent le même code des deux côtés. null = pas un article de métrage.
 */
function metrage(p: Prestation): { besoin: string; article: string } | null {
  for (const code of sousCategoriesDe(p)) {
    if (estBobinable(code)) return { besoin: code, article: code };
    if (code.startsWith("cable_")) return { besoin: `cablage_${code.slice("cable_".length)}`, article: code };
  }
  return null;
}

/** La quantité dictée est-elle une longueur ? Oui si « mètres » a été dit, ou si l'article est un câble / une gaine / une moulure (comme dans le pré-devis). */
export function enMetres(l: LigneVocale, p: Prestation): boolean {
  if (l.segment.bobines || l.segment.heures) return false;
  if (l.segment.metres) return true;
  return ["m", "ml"].includes((p.unite ?? "").toLowerCase()) || metrage(p) !== null;
}

/**
 * Lignes d'UNE ligne dictée. Un câble / une gaine en bobine suit le pré-devis : bobines entières + reliquat au mètre (ou « tout au mètre »).
 * Sans article : main d'œuvre au taux horaire, sinon ligne « À compléter » à 0 €.
 */
export function lignesDeLaLigne(l: LigneVocale, c: ChoixLigneVocale, prestations: Prestation[], tauxHoraire: number): LigneNouvelle[] {
  if (!c.inclus || !(c.quantite > 0)) return [];
  const p = c.prestationId ? prestations.find(x => x.id === c.prestationId) : undefined;
  if (p) {
    const m = metrage(p);
    if (m && enMetres(l, p)) {
      const option = optionDepuisPrestation(p, m.article);
      const besoin: BesoinApparie = { cle: "VOCAL", sousCategorie: m.besoin, label: p.nom, piece: "", quantite: c.quantite, unite: "m", options: [option] };
      return genererLignesDevis([{ besoin, optionCatalogue: option, conditionnement: c.conditionnement }], prestations)
        .map(x => ({ ...x, description: undefined, poste: null }));
    }
    return [{ ...ligneDepuisArticle(p, undefined, null), quantite: c.quantite }];
  }
  if (l.segment.heures && tauxHoraire > 0) return [{ nom: "Main d'œuvre", quantite: c.quantite, prix_unitaire: tauxHoraire, unite: "heure", type_branche: "service" }];
  return [{
    nom: `${PREFIXE_A_COMPLETER}${l.segment.libelle}`, quantite: c.quantite, prix_unitaire: 0,
    unite: l.segment.heures ? "heure" : l.segment.metres ? "ml" : "u", type_branche: l.segment.heures ? "service" : "materiau",
  }];
}

/** Lignes du devis. Un même article dicté deux fois est additionné. */
export function lignesDepuisDictee(
  lignes: LigneVocale[], choix: (l: LigneVocale) => ChoixLigneVocale, prestations: Prestation[], tauxHoraire: number,
): LigneNouvelle[] {
  const sortie: LigneNouvelle[] = [];
  for (const l of lignes) {
    for (const nouvelle of lignesDeLaLigne(l, choix(l), prestations, tauxHoraire)) {
      const existante = nouvelle.prestation_id ? sortie.find(x => x.prestation_id === nouvelle.prestation_id && x.nom === nouvelle.nom) : undefined;
      if (existante) existante.quantite += nouvelle.quantite;
      else sortie.push(nouvelle);
    }
  }
  return sortie;
}

/** L'article « au mètre » existe-t-il (pour « tout au mètre ») ? Sert à prévenir comme le pré-devis. */
export function auMetreDisponible(p: Prestation, prestations: Prestation[]): boolean {
  const m = metrage(p);
  return !!m && !!articleAuMetre(m.article, p.gamme, prestations);
}

export const libelleClient = (c: ClientCourt | Client): string => [c.prenom, c.nom].filter(Boolean).join(" ");
