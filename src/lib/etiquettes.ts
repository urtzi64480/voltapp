// src/lib/etiquettes.ts
//
// ÉTIQUETTES À LA DEMANDE (repérage des tableaux électriques) : modèle, formats de planche A4, grille, pagination,
// ajustement automatique du texte et import depuis un tableau enregistré. Fonctions pures (aucun accès navigateur) :
// la mesure du texte est injectée, ce qui permet d'utiliser exactement la même mise en page pour l'aperçu et le PDF.

import { BREAKER_TYPES, CIRCUITS, type BreakerRow } from "./electrical-constants";
import { PICTO_AUCUN, pictoPour, pictoValide } from "./pictogrammes";

/** icone : absent = pictogramme reconnu automatiquement ; « aucune » = sans pictogramme ; sinon l'identifiant d'un pictogramme choisi (voir pictogrammes.ts). */
/**
 * UNE étiquette = UN appareil (disjoncteur ou interrupteur différentiel). rangee : numéro de la rangée du
 * tableau d'où vient l'étiquette (import) ; sert à passer à la ligne à chaque nouvelle rangée.
 * icone : absent = pictogramme reconnu automatiquement ; « aucune » = sans pictogramme ; sinon l'identifiant d'un pictogramme (voir pictogrammes.ts).
 */
export interface Etiquette { id: string; texte: string; ligne2: string; quantite: number; icone?: string; rangee?: number }

export interface FormatPlanche {
  id: string;
  nom: string;
  /** Dimensions d'une étiquette, en mm. */
  largeur: number;
  hauteur: number;
  /** Page A4 en paysage (297 × 210) : permet de garder une rangée entière sur une seule ligne. */
  paysage?: boolean;
  /** Marge de la page, en mm (jamais imprimée par l'imprimante en dessous de ~5 mm). */
  marge: number;
  /** Espace entre deux étiquettes, en mm (planche adhésive prédécoupée : 0 ; papier à découper : ~1). */
  ecart: number;
}

export const PAGE_A4 = { largeur: 210, hauteur: 297 } as const;
export const LIMITES = {
  // Plafonds choisis pour que le texte tienne TOUJOURS lisiblement dans le carré de 17,5 mm (vérifié avec la vraie police, voir tests) :
  // 16 caractères pour le nom (2 lignes), 14 pour la 2e ligne (« 125 A - 30 mA »).
  texte: 16, ligne2: 14,
  quantiteMax: 100, totalMax: 1000,
  dimMin: 5, dimMax: 190, margeMax: 40, ecartMax: 20,
} as const;

/**
 * DEUX sortes d'étiquettes, car elles ne vont pas au même endroit du tableau :
 *  - « picto » : le petit autocollant SUR le disjoncteur / différentiel (fenêtre de repérage de l'appareil, ~12,7 × 9,5 mm chez Legrand), pictogramme seul ;
 *  - « texte » : le repère AU-DESSUS des appareils (porte-repère du rail, 17,5 mm = un module de large × 8 mm, comme les repères Legrand Logicab2 17,5 × 8),
 *    nom + calibre, sans pictogramme.
 * Chaque sorte a sa propre zone d'impression, réglable (vieux tableaux, autres marques) ; un même nombre d'appareils donne le même nombre d'étiquettes dans chaque sorte.
 */
export type GenreEtiquette = "picto" | "texte";
/** Ce que l'on imprime : les pictogrammes seuls, les textes seuls, ou les deux (deux planches dans le même PDF). */
export type ModeEtiquettes = GenreEtiquette | "les-deux";
export const MODES: ModeEtiquettes[] = ["picto", "texte", "les-deux"];

/** Zone d'impression d'une sorte d'étiquette : dimensions d'une étiquette, marge de page et écart entre étiquettes, en mm. */
export interface DimsPlanche { largeur: number; hauteur: number; marge: number; ecart: number }
export const DIMS_STANDARD: Record<GenreEtiquette, DimsPlanche> = {
  picto: { largeur: 12.7, hauteur: 9.5, marge: 8, ecart: 0 },
  texte: { largeur: 17.5, hauteur: 8, marge: 8, ecart: 0 },
};
export const NOM_GENRE: Record<GenreEtiquette, string> = { picto: "Pictogrammes (sur le disjoncteur)", texte: "Textes (au-dessus des disjoncteurs)" };
export const genresDuMode = (m: ModeEtiquettes): GenreEtiquette[] => (m === "les-deux" ? ["picto", "texte"] : [m]);
export const modeValide = (m: unknown): m is ModeEtiquettes => typeof m === "string" && (MODES as string[]).includes(m);

export const formatDe = (genre: GenreEtiquette, d: DimsPlanche, paysage: boolean): FormatPlanche => ({ id: genre, nom: NOM_GENRE[genre], ...d, paysage });

// ─── Texte ──────────────────────────────────────────────────────────────────────────────────────
// Les polices PDF standard ne couvrent que le Latin-1 : on remplace les caractères courants hors Latin-1 et on retire le reste,
// pour qu'aucune étiquette n'affiche de symbole illisible.
const REMPLACEMENTS: Record<string, string> = {
  "’": "'", "‘": "'", "“": '"', "”": '"', "«": '"', "»": '"', "–": "-", "—": "-", "…": "...", "œ": "oe", "Œ": "OE",
  "\u20AC": "EUR", "\u2192": "->", "\u2190": "<-", "\u2265": ">=", "\u2264": "<=", "\u03A9": "ohm", "\u2126": "ohm", "\u2205": "\u00D8", "\u202F": " ", "\u2009": " ",
};

export function nettoyerTexte(brut: unknown, max: number = LIMITES.texte): string {
  if (typeof brut !== "string") return "";
  let t = brut.normalize("NFC").replace(/[\u2018\u2019\u201C\u201D\u00AB\u00BB\u2013\u2014\u2026\u0153\u0152\u20AC\u2192\u2190\u2265\u2264\u03A9\u2126\u2205\u202F\u2009]/g, c => REMPLACEMENTS[c] ?? "");
  t = t.replace(/\r\n?/g, "\n").replace(/[^\n\u0020-\u007E\u00A0-\u00FF]/g, "");
  t = t.split("\n").map(l => l.replace(/ {2,}/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

export const quantiteValide = (n: unknown): number => {
  const v = typeof n === "number" ? n : parseInt(String(n), 10);
  return Number.isFinite(v) ? Math.min(LIMITES.quantiteMax, Math.max(1, Math.round(v))) : 1;
};

/** Une étiquette est imprimable si elle porte au moins un texte (après nettoyage). */
export const estImprimable = (e: Pick<Etiquette, "texte" | "ligne2">): boolean => nettoyerTexte(e.texte) !== "" || nettoyerTexte(e.ligne2, LIMITES.ligne2) !== "";

export const nouvelleEtiquette = (texte = "", ligne2 = "", quantite = 1): Etiquette => ({
  id: (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
  texte, ligne2, quantite,
});

// ─── Grille et pagination ───────────────────────────────────────────────────────────────────────

/** Étiquettes par ligne et par page. */
export interface Grille { colonnes: number; lignes: number; parPage: number }

/** Dimensions valides (nombres finis, dans les bornes) — sinon le format est refusé plutôt que de produire un PDF faux. */
export function formatValide(f: FormatPlanche): boolean {
  const ok = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;
  return ok(f.largeur, LIMITES.dimMin, LIMITES.dimMax) && ok(f.hauteur, LIMITES.dimMin, LIMITES.dimMax)
    && ok(f.marge, 0, LIMITES.margeMax) && ok(f.ecart, 0, LIMITES.ecartMax);
}

/** Dimensions de la page A4 (portrait ou paysage) en mm. */
export const pageDe = (f: Pick<FormatPlanche, "paysage">): { largeur: number; hauteur: number } =>
  f.paysage ? { largeur: PAGE_A4.hauteur, hauteur: PAGE_A4.largeur } : { largeur: PAGE_A4.largeur, hauteur: PAGE_A4.hauteur };

/** Nombre de cases par ligne / par colonne / par page ; null si le format est invalide ou ne tient pas sur la page. */
export function grille(f: FormatPlanche): Grille | null {
  if (!formatValide(f)) return null;
  const eps = 1e-9, page = pageDe(f);
  const colonnes = Math.floor((page.largeur - 2 * f.marge + f.ecart + eps) / (f.largeur + f.ecart));
  const lignes = Math.floor((page.hauteur - 2 * f.marge + f.ecart + eps) / (f.hauteur + f.ecart));
  if (colonnes < 1 || lignes < 1) return null;
  return { colonnes, lignes, parPage: colonnes * lignes };
}

/** Une case posée sur la page : (x, y) = coin haut-gauche en mm. */
export interface Case { x: number; y: number; largeur: number; hauteur: number; etiquette: Etiquette | null; index: number }
export type Planche = Case[];

/** Une étiquette par exemplaire demandé, dans l'ordre de la liste, sans les étiquettes vides. */
export function exemplaires(liste: Etiquette[]): Etiquette[] {
  return liste.filter(estImprimable).flatMap(e => Array.from({ length: quantiteValide(e.quantite) }, () => e));
}

/** Nombre d'étiquettes de la rangée la plus longue de la liste (étiquettes importées d'un tableau) ; 0 si aucune étiquette ne vient d'une rangée. */
export function maxParRangee(liste: Etiquette[]): number {
  const compte = new Map<number, number>();
  for (const e of liste) if (estImprimable(e) && typeof e.rangee === "number") compte.set(e.rangee, (compte.get(e.rangee) ?? 0) + quantiteValide(e.quantite));
  return Math.max(0, ...compte.values());
}

export interface ResultatPlanches { planches: Planche[]; total: number; grille: Grille }
export interface OptionsPlanches {
  /** Passe à la ligne à chaque changement de rangée du tableau (étiquettes importées) : une rangée = une ligne, comme sur le tableau. */
  ligneParRangee?: boolean;
}

/**
 * Pose les étiquettes CÔTE À CÔTE, de gauche à droite puis ligne par ligne, toutes de la même dimension. En fin de ligne on passe à la suivante ;
 * avec `ligneParRangee`, on passe aussi à la ligne à chaque nouvelle rangée du tableau.
 * `debut` = nombre de cases déjà utilisées au début de la PREMIÈRE page (planche adhésive entamée) : elles restent vides.
 * Renvoie une erreur lisible plutôt que de produire un document énorme ou faux.
 */
export function composerPlanches(liste: Etiquette[], f: FormatPlanche, debut = 0, opt: OptionsPlanches = {}): ResultatPlanches | { erreur: string } {
  const g = grille(f);
  if (!g) return { erreur: formatValide(f) ? "Ce format est trop grand pour une page A4." : "Dimensions invalides : vérifie la largeur, la hauteur, la marge et l'écart." };
  const items = exemplaires(liste);
  if (items.length === 0) return { erreur: "Aucune étiquette à imprimer : renseigne au moins un texte." };
  if (items.length > LIMITES.totalMax) return { erreur: `Trop d'étiquettes (${items.length}) : ${LIMITES.totalMax} maximum par document.` };
  const saut = Number.isFinite(debut) ? Math.min(g.parPage - 1, Math.max(0, Math.floor(debut))) : 0;
  const elements: (Etiquette | null)[] = [...Array<null>(saut).fill(null), ...items];
  const planches: Planche[] = [[]];
  let col = 0, lig = 0, index = 0, rangeePrecedente: number | undefined;
  for (const etiquette of elements) {
    const rangee = etiquette?.rangee;
    const changeDeRangee = !!opt.ligneParRangee && etiquette !== null && rangee !== undefined && rangeePrecedente !== undefined && rangee !== rangeePrecedente;
    if (col > 0 && (col + 1 > g.colonnes || changeDeRangee)) { col = 0; lig++; }
    if (lig >= g.lignes) { planches.push([]); lig = 0; col = 0; }
    planches[planches.length - 1].push({
      x: f.marge + col * (f.largeur + f.ecart), y: f.marge + lig * (f.hauteur + f.ecart),
      largeur: f.largeur, hauteur: f.hauteur, etiquette, index: index++,
    });
    col += 1;
    if (etiquette) rangeePrecedente = rangee;
  }
  return { planches, total: items.length, grille: g };
}

// ─── Mise en page du texte dans une étiquette ───────────────────────────────────────────────────

export const PT_EN_MM = 25.4 / 72;
/** (texte, taille en points, gras) → largeur en mm. Injectée : jsPDF pour le PDF, canvas pour l'aperçu. */
export type Mesure = (texte: string, pt: number, gras: boolean) => number;

export interface LigneMiseEnPage { texte: string; pt: number; gras: boolean; /** Position de la ligne de base depuis le haut de l'étiquette, en mm. */ y: number }

const INTERLIGNE = 1.15;
const PADDING_X = 1.2, PADDING_Y = 0.5;
const PT_MIN = 4, PT_MAX = 16, PT_COUPE_MAX = 6;

/**
 * Coupe en lignes qui tiennent dans `largeur` : retours à la ligne aux espaces et après les traits d'union (« Lave- / vaisselle »).
 * Un mot plus large que l'étiquette n'est coupé au caractère que si `couperMots` est vrai ; sinon il garde sa propre ligne (qui déborde),
 * ce qui permet à l'appelant de réduire la police plutôt que de casser le mot.
 */
export function couperLignes(texte: string, largeur: number, pt: number, gras: boolean, mesure: Mesure, couperMots = true): string[] {
  const sortie: string[] = [];
  const tient = (s: string) => mesure(s, pt, gras) <= largeur;
  for (const para of texte.split("\n")) {
    let courante = "";
    const pousser = () => { if (courante !== "") { sortie.push(courante); courante = ""; } };
    for (const mot of para.split(" ").filter(Boolean)) {
      const pieces = mot.match(/[^-]+-*|-+/g) ?? [mot];
      for (let k = 0; k < pieces.length; k++) {
        const piece = pieces[k];
        const essai = courante === "" ? piece : k > 0 ? courante + piece : `${courante} ${piece}`;
        if (tient(essai)) { courante = essai; continue; }
        pousser();
        if (tient(piece) || !couperMots) { courante = piece; continue; }
        // pièce plus large que l'étiquette : découpe caractère par caractère
        let morceau = "";
        for (const c of Array.from(piece)) {
          if (morceau !== "" && !tient(morceau + c)) { sortie.push(morceau); morceau = ""; }
          morceau += c;
        }
        courante = morceau;
      }
    }
    pousser();
  }
  return sortie;
}

/**
 * Plus grande taille de police (de 16 à 4 pt, par demi-point) pour laquelle le texte principal (gras) et la 2e ligne (plus petite, ex. « 16 A »)
 * tiennent dans l'étiquette. Si rien ne tient même à 4 pt, le texte est tronqué avec « ... » au lieu de déborder.
 */
export function mettreEnPage(texte: string, ligne2: string, largeur: number, hauteur: number, mesure: Mesure): LigneMiseEnPage[] {
  const t = nettoyerTexte(texte), l2 = nettoyerTexte(ligne2, LIMITES.ligne2).replace(/\n+/g, " ");
  if (t === "" && l2 === "") return [];
  // marge verticale proportionnelle : sur une zone de ~4 mm de haut, 2 × 0,5 mm mangeraient le quart de la place
  const padY = Math.min(PADDING_Y, hauteur * 0.05);
  const wU = Math.max(1, largeur - 2 * PADDING_X), hU = Math.max(1, hauteur - 2 * padY);
  const hauteurLigne = (pt: number) => pt * PT_EN_MM * INTERLIGNE;

  const construire = (pt: number, couper = true): { lignes: { texte: string; pt: number; gras: boolean }[]; ok: boolean } => {
    const pt2 = Math.max(PT_MIN, Math.round(pt * 0.8 * 2) / 2);
    const lignes: { texte: string; pt: number; gras: boolean }[] = [
      ...(t ? couperLignes(t, wU, pt, true, mesure, couper).map(x => ({ texte: x, pt, gras: true })) : []),
      ...(l2 ? couperLignes(l2, wU, t ? pt2 : pt, false, mesure, couper).map(x => ({ texte: x, pt: t ? pt2 : pt, gras: false })) : []),
    ];
    const total = lignes.reduce((s, x) => s + hauteurLigne(x.pt), 0);
    const largeurOk = lignes.every(x => mesure(x.texte, x.pt, x.gras) <= wU + 1e-6);
    return { lignes, ok: total <= hU + 1e-6 && largeurOk };
  };

  // 1) on réduit la police tant qu'il le faut pour que chaque mot tienne entier ; 2) seulement si un mot est trop large même à 4 pt,
  // on accepte de le couper (à petite taille) ; 3) sinon troncature avec « ... ».
  let retenu: { texte: string; pt: number; gras: boolean }[] | null = null;
  for (let pt = PT_MAX; pt >= PT_MIN - 1e-9 && !retenu; pt -= 0.5) { const r = construire(pt, false); if (r.ok) retenu = r.lignes; }
  for (let pt = PT_COUPE_MAX; pt >= PT_MIN - 1e-9 && !retenu; pt -= 0.5) { const r = construire(pt, true); if (r.ok) retenu = r.lignes; }
  // Nom + 2e ligne ne tiennent pas ensemble à 4 pt : on garde le NOM en entier et on abandonne la 2e ligne plutôt que de tronquer le nom.
  if (!retenu && t && l2) return mettreEnPage(t, "", largeur, hauteur, mesure);
  if (!retenu) {
    // Rien ne tient à la taille minimale : on garde ce qui rentre en hauteur, dernière ligne tronquée avec « ... ».
    const r = construire(PT_MIN);
    const nbMax = Math.max(1, Math.floor(hU / hauteurLigne(PT_MIN)));
    const gardees = r.lignes.slice(0, nbMax);
    const derniere = gardees[gardees.length - 1];
    let s = derniere.texte;
    while (s.length > 1 && mesure(`${s}...`, derniere.pt, derniere.gras) > wU) s = s.slice(0, -1);
    gardees[gardees.length - 1] = { ...derniere, texte: r.lignes.length > nbMax || mesure(derniere.texte, derniere.pt, derniere.gras) > wU ? `${s.trimEnd()}...` : derniere.texte };
    retenu = gardees;
  }
  const total = retenu.reduce((s, x) => s + hauteurLigne(x.pt), 0);
  let haut = (hauteur - total) / 2;
  return retenu.map(x => {
    const h = hauteurLigne(x.pt);
    // ligne de base ≈ 80 % de la hauteur de ligne depuis le haut de celle-ci
    const y = haut + h * 0.8;
    haut += h;
    return { ...x, y };
  });
}

// ─── Étiquette complète : pictogramme + texte ───────────────────────────────────────────────────

export type LigneComposee = LigneMiseEnPage & { /** Centre horizontal du texte depuis le bord gauche de l'étiquette, en mm. */ x: number };
export interface PictoPlace { id: string; /** Coin haut-gauche depuis le coin haut-gauche de l'étiquette, en mm. */ x: number; y: number; /** Côté du carré, en mm. */ taille: number }
export interface EtiquetteComposee { picto: PictoPlace | null; lignes: LigneComposee[] }

/** Le pictogramme est toujours AU-DESSUS du texte ; omis seulement si l'étiquette est si basse qu'il tomberait sous 3,5 mm. */
export const PICTO = { tailleMini: 3.5, tailleMaxi: 18, marge: 1.2, fractions: [0.48, 0.4] } as const;

/**
 * Place le pictogramme (au-dessus, centré) et le texte (dessous, centré) d'une étiquette. La marge s'adapte aux très petites étiquettes. Deux tailles
 * de pictogramme sont essayées (48 % puis 40 % de la hauteur) : la plus petite n'est retenue que si elle laisse au texte une police nettement plus lisible.
 * Le texte garde sa mise en page automatique (police réduite avant de couper un mot) dans la zone qui lui reste.
 */
export function composerEtiquette(texte: string, ligne2: string, largeur: number, hauteur: number, pictoId: string | null, mesure: Mesure): EtiquetteComposee {
  const seul = (): EtiquetteComposee => ({ picto: null, lignes: mettreEnPage(texte, ligne2, largeur, hauteur, mesure).map(l => ({ ...l, x: largeur / 2 })) });
  if (!pictoId || !pictoValide(pictoId)) return seul();
  const m = Math.min(PICTO.marge, hauteur * 0.08);
  let meilleur: (EtiquetteComposee & { ptMin: number }) | null = null;
  for (const fraction of PICTO.fractions) {
    const taille = Math.min(largeur - 2 * m, hauteur * fraction, PICTO.tailleMaxi);
    if (taille < PICTO.tailleMini) continue;
    const dessous = m + taille;
    const lignes = mettreEnPage(texte, ligne2, largeur, hauteur - dessous, mesure).map(l => ({ ...l, x: largeur / 2, y: dessous + l.y }));
    const ptMin = lignes.length > 0 ? Math.min(...lignes.map(l => l.pt)) : Infinity;
    if (!meilleur || ptMin > meilleur.ptMin + 0.25) meilleur = { picto: { id: pictoId, x: (largeur - taille) / 2, y: m, taille }, lignes, ptMin };
  }
  return meilleur ? { picto: meilleur.picto, lignes: meilleur.lignes } : seul();
}

/**
 * Étiquette « pictogramme seul » : le pictogramme, centré, le plus grand possible dans la case (marge de 10 % du petit côté, 1 mm maximum).
 * null si la case est trop petite pour un pictogramme lisible.
 */
export function composerPicto(largeur: number, hauteur: number, pictoId: string | null): PictoPlace | null {
  if (!pictoId || !pictoValide(pictoId)) return null;
  const m = Math.min(1, Math.min(largeur, hauteur) * 0.1);
  const taille = Math.min(largeur - 2 * m, hauteur - 2 * m, PICTO.tailleMaxi);
  if (taille < PICTO.tailleMini) return null;
  return { id: pictoId, x: (largeur - taille) / 2, y: (hauteur - taille) / 2, taille };
}

/** Pictogramme effectivement imprimé pour une étiquette (réglage de l'étiquette, sinon reconnaissance automatique), ou null. */
export const pictoDeEtiquette = (e: Pick<Etiquette, "texte" | "icone">, actifs: boolean): string | null => pictoPour(e, actifs);

// ─── Import depuis un tableau enregistré ────────────────────────────────────────────────────────

/** Nom complet d'un appareil (libellé saisi, sinon nom du circuit, sinon type d'appareil), avant raccourcissement à LIMITES.texte caractères. */
function nomAppareil(b: NonNullable<BreakerRow["slots"][number]>): string {
  return nettoyerTexte(b.label, 500) || CIRCUITS[b.circuit]?.label || BREAKER_TYPES[b.type]?.label || "";
}

/** Nombre d'appareils dont le nom dépasse la limite et sera donc raccourci à l'import (pour le dire à l'utilisateur). */
export function nomsRaccourcis(rows: BreakerRow[]): number {
  let n = 0;
  for (const r of Array.isArray(rows) ? rows : []) if (r && Array.isArray(r.slots)) for (const b of r.slots) if (b && nettoyerTexte(nomAppareil(b), 500).length > LIMITES.texte) n++;
  return n;
}

/**
 * Une étiquette par appareil posé (différentiels compris — même dimension que les disjoncteurs), dans l'ordre des rangées, avec le calibre en
 * 2e ligne (« 40 A - 30 mA » pour un différentiel). Les noms trop longs sont raccourcis à LIMITES.texte caractères ; la rangée d'origine est
 * mémorisée (une rangée = une ligne).
 */
export function etiquettesDepuisRangees(rows: BreakerRow[]): Etiquette[] {
  const sortie: Etiquette[] = [];
  (Array.isArray(rows) ? rows : []).forEach((r, indexRangee) => {
    if (!r || !Array.isArray(r.slots)) return;
    for (const b of r.slots) {
      if (!b) continue;
      const type = BREAKER_TYPES[b.type];
      const nom = nettoyerTexte(nomAppareil(b));
      if (!nom) continue;
      const amperes = Number(b.amperes);
      // Espaces insécables : « 30 mA » et « 20 A » ne sont jamais coupés en fin de ligne.
      const calibre = Number.isFinite(amperes) && amperes > 0 ? `${amperes}\u00A0A` : "";
      const ligne2 = nettoyerTexte(type?.isDiff ? [calibre, "30\u00A0mA"].filter(Boolean).join(" - ") : calibre, LIMITES.ligne2);
      sortie.push({ ...nouvelleEtiquette(nom, ligne2, 1), rangee: indexRangee });
    }
  });
  return sortie;
}

// ─── Planches à imprimer (une par sorte d'étiquette) ───────────────────────────────────────────

export interface GroupePlanches { genre: GenreEtiquette; format: FormatPlanche; planches: Planche[]; total: number; grille: Grille }
export interface ResultatGroupes { groupes: GroupePlanches[]; /** Étiquettes sans pictogramme, absentes de la planche des pictogrammes. */ sansPicto: number }

/** Étiquettes d'une sorte : les textes concernent toutes les étiquettes ; les pictogrammes seulement celles qui en ont un (reconnu ou choisi). */
export function etiquettesDuGenre(liste: Etiquette[], genre: GenreEtiquette): Etiquette[] {
  return genre === "texte" ? liste : liste.filter(e => pictoPour(e, true) !== null);
}

export interface OptionsGroupes { mode: ModeEtiquettes; dims: Record<GenreEtiquette, DimsPlanche>; paysage: boolean; debut: number; ligneParRangee: boolean }

/** Compose la planche de chaque sorte demandée par le mode ; une erreur lisible dès qu'une des planches est impossible. */
export function composerGroupes(liste: Etiquette[], o: OptionsGroupes): ResultatGroupes | { erreur: string } {
  const groupes: GroupePlanches[] = [];
  const imprimables = liste.filter(estImprimable);
  for (const genre of genresDuMode(o.mode)) {
    const format = formatDe(genre, o.dims[genre], o.paysage);
    const choisies = etiquettesDuGenre(imprimables, genre);
    if (genre === "picto" && imprimables.length > 0 && choisies.length === 0) {
      return { erreur: "Aucune étiquette n'a de pictogramme : choisis-en un (ou écris « lave-linge », « four »… pour qu'il soit reconnu), ou imprime les textes." };
    }
    const r = composerPlanches(choisies, format, o.debut, { ligneParRangee: o.ligneParRangee });
    if ("erreur" in r) return { erreur: o.mode === "les-deux" ? `${NOM_GENRE[genre]} : ${r.erreur}` : r.erreur };
    groupes.push({ genre, format, planches: r.planches, total: r.total, grille: r.grille });
  }
  return { groupes, sansPicto: o.mode === "texte" ? 0 : imprimables.length - etiquettesDuGenre(imprimables, "picto").length };
}

/** Plus petit nombre d'étiquettes par ligne parmi les planches du mode (pour décider si une rangée entière tient sur une ligne). */
export function colonnesMini(mode: ModeEtiquettes, dims: Record<GenreEtiquette, DimsPlanche>, paysage: boolean): number {
  const cols = genresDuMode(mode).map(g => grille(formatDe(g, dims[g], paysage))?.colonnes ?? 0);
  return Math.min(...cols);
}

// ─── Brouillon (stockage local) ─────────────────────────────────────────────────────────────────

export const CLE_BROUILLON_ETIQUETTES = "voltapp:etiquettes";

export interface BrouillonEtiquettes {
  etiquettes: Etiquette[];
  debut: number;
  guides: boolean;
  /** Ce que l'on imprime : pictogrammes seuls, textes seuls, ou les deux. */
  mode: ModeEtiquettes;
  /** Zone d'impression de chaque sorte (réglable pour les vieux tableaux). */
  dims: Record<GenreEtiquette, DimsPlanche>;
  /** Page A4 en paysage. */
  paysage: boolean;
  /** Une rangée du tableau = une ligne de la planche (étiquettes importées d'un tableau). */
  ligneParRangee: boolean;
}

export const brouillonVide = (): BrouillonEtiquettes => ({
  etiquettes: [nouvelleEtiquette()], debut: 0, guides: true, mode: "les-deux", dims: { picto: { ...DIMS_STANDARD.picto }, texte: { ...DIMS_STANDARD.texte } }, paysage: false, ligneParRangee: true,
});

export const serialiserBrouillon = (b: BrouillonEtiquettes): string => JSON.stringify({ v: 1, ...b });

const nombre = (v: unknown, defaut: number) => (typeof v === "number" && Number.isFinite(v) ? v : defaut);

/** Dimensions relues : chaque valeur hors bornes retombe sur la valeur standard de la sorte. */
function lireDims(brut: unknown, genre: GenreEtiquette): DimsPlanche {
  const d = DIMS_STANDARD[genre], o = (brut && typeof brut === "object" ? brut : {}) as Record<string, unknown>;
  const dans = (v: unknown, min: number, max: number, defaut: number) => { const n = nombre(v, NaN); return n >= min && n <= max ? n : defaut; };
  return {
    largeur: dans(o.largeur, LIMITES.dimMin, LIMITES.dimMax, d.largeur), hauteur: dans(o.hauteur, LIMITES.dimMin, LIMITES.dimMax, d.hauteur),
    marge: dans(o.marge, 0, LIMITES.margeMax, d.marge), ecart: dans(o.ecart, 0, LIMITES.ecartMax, d.ecart),
  };
}

/** Lecture tolérante : tout ce qui est illisible ou hors bornes retombe sur la valeur par défaut, jamais d'exception. */
export function lireBrouillon(brut: string | null): BrouillonEtiquettes {
  const defaut = brouillonVide();
  if (!brut) return defaut;
  try {
    const o = JSON.parse(brut);
    if (!o || typeof o !== "object" || o.v !== 1) return defaut;
    const etiquettes: Etiquette[] = Array.isArray(o.etiquettes)
      ? o.etiquettes.filter((e: unknown) => e && typeof e === "object").slice(0, 500).map((e: Record<string, unknown>) => ({
          id: typeof e.id === "string" && e.id ? e.id : nouvelleEtiquette().id,
          texte: nettoyerTexte(e.texte), ligne2: nettoyerTexte(e.ligne2, LIMITES.ligne2), quantite: quantiteValide(e.quantite),
          ...(e.icone === PICTO_AUCUN || pictoValide(e.icone) ? { icone: e.icone as string } : {}),
          ...(typeof e.rangee === "number" && Number.isInteger(e.rangee) && e.rangee >= 0 && e.rangee < 1000 ? { rangee: e.rangee } : {}),
        }))
      : [];
    const dims = (o.dims && typeof o.dims === "object" ? o.dims : {}) as Record<string, unknown>;
    return {
      etiquettes: etiquettes.length > 0 ? etiquettes : defaut.etiquettes,
      debut: Math.max(0, Math.floor(nombre(o.debut, 0))), guides: o.guides !== false, mode: modeValide(o.mode) ? o.mode : defaut.mode,
      dims: { picto: lireDims(dims.picto, "picto"), texte: lireDims(dims.texte, "texte") },
      paysage: o.paysage === true, ligneParRangee: o.ligneParRangee !== false,
    };
  } catch { return defaut; }
}
