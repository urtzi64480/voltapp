// src/lib/devis-vocal.ts
//
// DEVIS PAR DICTÉE : « pour Monsieur Dupont, 5 prises 16 A, 3 spots, un disjoncteur différentiel 40 A et 2 heures de main d'œuvre »
// → client reconnu + lignes rapprochées du CATALOGUE de l'électricien. Fonctions pures, sans réseau, sans IA payante.
// Règle d'or : aucun prix n'est inventé. Ce qui ne correspond à aucun article devient une ligne « À compléter » à 0 €.

import type { Client, DevisLigne, Prestation } from "@/types";
import { ligneDepuisArticle, PREFIXE_A_COMPLETER } from "./devis-lignes";

// ─── Texte ────────────────────────────────────────────────────────────────────────────────────────────────────────

const sansAccent = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");
const minuscules = (t: string) => sansAccent(t).toLowerCase();

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

/** Découpe une dictée en segments (un article ou une prestation chacun). Le nom du client doit avoir été retiré avant. */
export function decouperDictee(texte: string): SegmentDicte[] {
  let t = (texte ?? "").replace(/[\n\r]+/g, ", ").replace(/\s+/g, " ").trim();
  if (!t) return [];
  t = heuresDemies(chiffrer(t));
  PROTEGES.forEach(([re, to]) => { t = t.replace(re, to); });
  t = t.replace(REMPLISSAGE, " ").replace(/\s+/g, " ");
  const morceaux = t.split(/\s*(?:(?<!\d)[,;.]|[,;.](?!\d)|\bet\b|\bpuis\b|\bplus\b|\bensuite\b|\bavec\b|\bainsi que\b)\s*/i).map(s => s.trim()).filter(Boolean);
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
    if (heures) libelle = reste.replace(/^(heures?|h|hr|hrs)\b\s*(de|d')?\s*/i, "");
    else libelle = reste.replace(/^(metres?|m|ml|mètres?)\s+(de|d')\s*/i, "");
    libelle = libelle.replace(/\b(de|d')\s*$/i, "").trim();
    if (!Number.isFinite(quantite) || quantite <= 0) quantite = 1;
    if (!libelle && !heures) continue;
    segments.push({ brut: m, quantite, libelle: libelle || "main d'oeuvre", heures: heures || (!debut && MOTS_MO.test(minuscules(m)) && /\b(heures?)\b/.test(minuscules(m))) });
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
  const propre = minuscules(t).replace(/(\d)\s*([a-z])/g, "$1 $2").replace(/(\d),(\d)/g, "$1.$2").replace(/[^a-z0-9.]+/g, " ");
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

export function analyserDictee(texte: string, prestations: Prestation[], clients: ClientCourt[]): AnalyseDictee {
  const { client, reste } = detecterClient(texte, clients);
  const segments = decouperDictee(reste);
  const vus = new Map<string, number>();
  const lignes: LigneVocale[] = segments.map(segment => {
    const base = minuscules(segment.brut).replace(/\s+/g, " ");
    const n = (vus.get(base) ?? 0) + 1; vus.set(base, n);
    const candidats = segment.heures ? chercherArticles("main d'oeuvre", prestations.filter(p => p.sous_categorie === "main_oeuvre" || /main d.?oeuvre/.test(minuscules(p.nom))), 3) : chercherArticles(segment.libelle, prestations);
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

export interface ChoixLigneVocale { inclus: boolean; quantite: number; prestationId: string | null }
export type LigneNouvelle = Omit<DevisLigne, "devis_id" | "ordre">;

/**
 * Lignes du devis. Article choisi → prix de vente du catalogue ; main d'œuvre sans article → taux horaire du profil ; sinon ligne « À compléter » à 0 €.
 * Une même ligne dictée deux fois (même article) est additionnée.
 */
export function lignesDepuisDictee(
  lignes: LigneVocale[], choix: (l: LigneVocale) => ChoixLigneVocale, prestations: Prestation[], tauxHoraire: number,
): LigneNouvelle[] {
  const sortie: LigneNouvelle[] = [];
  for (const l of lignes) {
    const c = choix(l);
    if (!c.inclus || !(c.quantite > 0)) continue;
    const p = c.prestationId ? prestations.find(x => x.id === c.prestationId) : undefined;
    if (p) {
      const base = ligneDepuisArticle(p, undefined, null);
      const existante = sortie.find(x => x.prestation_id === p.id);
      if (existante) existante.quantite += c.quantite;
      else sortie.push({ ...base, quantite: c.quantite });
    } else if (l.segment.heures && tauxHoraire > 0) {
      sortie.push({ nom: "Main d'œuvre", quantite: c.quantite, prix_unitaire: tauxHoraire, unite: "heure", type_branche: "service" });
    } else {
      sortie.push({
        nom: `${PREFIXE_A_COMPLETER}${l.segment.libelle}`, quantite: c.quantite, prix_unitaire: 0,
        unite: l.segment.heures ? "heure" : "u", type_branche: l.segment.heures ? "service" : "materiau",
      });
    }
  }
  return sortie;
}

export const libelleClient = (c: ClientCourt | Client): string => [c.prenom, c.nom].filter(Boolean).join(" ");
