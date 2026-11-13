// src/lib/etiquettes.ts
//
// ÉTIQUETTES À LA DEMANDE (repérage des tableaux électriques) : modèle, formats de planche A4, grille, pagination,
// ajustement automatique du texte et import depuis un tableau enregistré. Fonctions pures (aucun accès navigateur) :
// la mesure du texte est injectée, ce qui permet d'utiliser exactement la même mise en page pour l'aperçu et le PDF.

import { BREAKER_TYPES, CIRCUITS, type BreakerRow } from "./electrical-constants";
import { PICTO_AUCUN, pictoPour, pictoValide } from "./pictogrammes";

/** icone : absent = pictogramme reconnu automatiquement ; « aucune » = sans pictogramme ; sinon l'identifiant d'un pictogramme choisi (voir pictogrammes.ts). */
/**
 * modules : largeur de l'étiquette en modules de rail (1 par défaut ; un différentiel ou un 2P = 2) — chaque module est un carré, donc une
 * étiquette de 2 modules fait 2 carrés côte à côte, pile sous l'appareil. rangee : numéro de la rangée du tableau d'où vient l'étiquette
 * (import) ; sert à passer à la ligne à chaque nouvelle rangée.
 */
export interface Etiquette { id: string; texte: string; ligne2: string; quantite: number; icone?: string; modules?: number; rangee?: number }

export interface FormatPlanche {
  id: string;
  nom: string;
  /** Dimensions d'UN module (une case), en mm : une étiquette de n modules fait n × largeur de large. Carré par défaut. */
  largeur: number;
  hauteur: number;
  /** Page A4 en paysage (297 × 210) : permet de garder une rangée de 13 modules sur une seule ligne. */
  paysage?: boolean;
  /** Marge de la page, en mm (jamais imprimée par l'imprimante en dessous de ~5 mm). */
  marge: number;
  /** Espace entre deux étiquettes, en mm (planche adhésive prédécoupée : 0 ; papier à découper : ~1). */
  ecart: number;
}

export const PAGE_A4 = { largeur: 210, hauteur: 297 } as const;
export const LIMITES = {
  texte: 80, ligne2: 40,
  quantiteMax: 100, totalMax: 1000, modulesMax: 6,
  dimMin: 5, dimMax: 190, margeMax: 40, ecartMax: 20,
} as const;

/**
 * Étiquettes CARRÉES, alignées sur le pas d'un module. Seule cote commune à tous les constructeurs : un module de rail DIN (EN 60715 / appareillage
 * EN 43880) fait 17,5 mm de large — un disjoncteur 1P, un repère Legrand « 17,5 mm », « leur largeur correspond à celle d'un disjoncteur ».
 * Les hauteurs de fenêtre varient (8 à 9,5 mm chez Legrand) et il n'existe pas d'étiquette carrée normalisée : on prend donc le carré de 17,5 mm
 * (largeur réelle d'un disjoncteur, assez haut pour l'icône + le nom + le calibre) et deux carrés plus grands pour les plastrons et les portes.
 */
export const FORMATS: FormatPlanche[] = [
  { id: "carre-17-5", nom: "Carré 17,5 × 17,5 mm — 1 module (standard)", largeur: 17.5, hauteur: 17.5, marge: 8, ecart: 0 },
  { id: "carre-22", nom: "Carré moyen 22 × 22 mm", largeur: 22, hauteur: 22, marge: 8, ecart: 0 },
  { id: "carre-28", nom: "Grand carré 28 × 28 mm (plastron, porte)", largeur: 28, hauteur: 28, marge: 8, ecart: 0 },
];
export const FORMAT_DEFAUT = "carre-17-5";
export const ID_PERSONNALISE = "perso";
export const FORMAT_PERSO_DEFAUT: FormatPlanche = { id: ID_PERSONNALISE, nom: "Personnalisé", largeur: 17.5, hauteur: 17.5, marge: 8, ecart: 0 };

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

export const modulesValide = (n: unknown): number => {
  const v = typeof n === "number" ? n : parseInt(String(n), 10);
  return Number.isFinite(v) ? Math.min(LIMITES.modulesMax, Math.max(1, Math.round(v))) : 1;
};

/** Une étiquette est imprimable si elle porte au moins un texte (après nettoyage). */
export const estImprimable = (e: Pick<Etiquette, "texte" | "ligne2">): boolean => nettoyerTexte(e.texte) !== "" || nettoyerTexte(e.ligne2, LIMITES.ligne2) !== "";

export const nouvelleEtiquette = (texte = "", ligne2 = "", quantite = 1): Etiquette => ({
  id: (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
  texte, ligne2, quantite,
});

// ─── Grille et pagination ───────────────────────────────────────────────────────────────────────

/** Cases (1 module chacune) par ligne et par page. */
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

/** Une case posée sur la page : (x, y) = coin haut-gauche en mm, largeur = modules × largeur d'un module. */
export interface Case { x: number; y: number; largeur: number; hauteur: number; etiquette: Etiquette | null; index: number }
export type Planche = Case[];

/** Une étiquette par exemplaire demandé, dans l'ordre de la liste, sans les étiquettes vides. */
export function exemplaires(liste: Etiquette[]): Etiquette[] {
  return liste.filter(estImprimable).flatMap(e => Array.from({ length: quantiteValide(e.quantite) }, () => e));
}

/** Nombre de modules de la rangée la plus large de la liste (étiquettes importées d'un tableau) ; 0 si aucune étiquette ne vient d'une rangée. */
export function modulesMaxParRangee(liste: Etiquette[]): number {
  const somme = new Map<number, number>();
  for (const e of liste) if (estImprimable(e) && typeof e.rangee === "number") somme.set(e.rangee, (somme.get(e.rangee) ?? 0) + modulesValide(e.modules) * quantiteValide(e.quantite));
  return Math.max(0, ...somme.values());
}

export interface ResultatPlanches { planches: Planche[]; total: number; grille: Grille }
export interface OptionsPlanches {
  /** Passe à la ligne à chaque changement de rangée du tableau (étiquettes importées) : une rangée = une ligne, comme sur le tableau. */
  ligneParRangee?: boolean;
}

/**
 * Pose les étiquettes CÔTE À CÔTE, de gauche à droite puis ligne par ligne, chacune sur n modules de large (un carré par module). Une étiquette qui
 * ne tient plus en fin de ligne passe à la ligne suivante ; avec `ligneParRangee`, on passe aussi à la ligne à chaque nouvelle rangée du tableau.
 * `debut` = nombre de cases (1 module) déjà utilisées au début de la PREMIÈRE page (planche adhésive entamée) : elles restent vides.
 * Renvoie une erreur lisible plutôt que de produire un document énorme ou faux.
 */
export function composerPlanches(liste: Etiquette[], f: FormatPlanche, debut = 0, opt: OptionsPlanches = {}): ResultatPlanches | { erreur: string } {
  const g = grille(f);
  if (!g) return { erreur: formatValide(f) ? "Ce format est trop grand pour une page A4." : "Dimensions invalides : vérifie la largeur, la hauteur, la marge et l'écart." };
  const items = exemplaires(liste);
  if (items.length === 0) return { erreur: "Aucune étiquette à imprimer : renseigne au moins un texte." };
  if (items.length > LIMITES.totalMax) return { erreur: `Trop d'étiquettes (${items.length}) : ${LIMITES.totalMax} maximum par document.` };
  const saut = Number.isFinite(debut) ? Math.min(g.parPage - 1, Math.max(0, Math.floor(debut))) : 0;
  const elements: { etiquette: Etiquette | null; modules: number }[] = [
    ...Array.from({ length: saut }, () => ({ etiquette: null, modules: 1 })),
    ...items.map(e => ({ etiquette: e, modules: Math.min(g.colonnes, modulesValide(e.modules)) })),
  ];
  const planches: Planche[] = [[]];
  let col = 0, lig = 0, index = 0, rangeePrecedente: number | undefined;
  for (const el of elements) {
    const rangee = el.etiquette?.rangee;
    const changeDeRangee = !!opt.ligneParRangee && el.etiquette !== null && rangee !== undefined && rangeePrecedente !== undefined && rangee !== rangeePrecedente;
    if (col > 0 && (col + el.modules > g.colonnes || changeDeRangee)) { col = 0; lig++; }
    if (lig >= g.lignes) { planches.push([]); lig = 0; col = 0; }
    planches[planches.length - 1].push({
      x: f.marge + col * (f.largeur + f.ecart), y: f.marge + lig * (f.hauteur + f.ecart),
      largeur: el.modules * f.largeur + (el.modules - 1) * f.ecart, hauteur: f.hauteur, etiquette: el.etiquette, index: index++,
    });
    col += el.modules;
    if (el.etiquette) rangeePrecedente = rangee;
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

/** Pictogramme effectivement imprimé pour une étiquette (réglage de l'étiquette, sinon reconnaissance automatique), ou null. */
export const pictoDeEtiquette = (e: Pick<Etiquette, "texte" | "icone">, actifs: boolean): string | null => pictoPour(e, actifs);

// ─── Import depuis un tableau enregistré ────────────────────────────────────────────────────────

/**
 * Une étiquette par appareil posé (différentiels compris), dans l'ordre des rangées, avec le calibre en 2e ligne. La largeur en modules suit
 * l'appareil (1P = 1, 2P / différentiel / coupure générale / prise modulaire = 2) et la rangée d'origine est mémorisée (une rangée = une ligne).
 */
export function etiquettesDepuisRangees(rows: BreakerRow[]): Etiquette[] {
  const sortie: Etiquette[] = [];
  (Array.isArray(rows) ? rows : []).forEach((r, indexRangee) => {
    if (!r || !Array.isArray(r.slots)) return;
    for (const b of r.slots) {
      if (!b) continue;
      const type = BREAKER_TYPES[b.type];
      const circuit = CIRCUITS[b.circuit];
      const nom = nettoyerTexte(b.label) || circuit?.label || type?.label || "";
      if (!nom) continue;
      const amperes = Number(b.amperes);
      // Espaces insécables : « 30 mA », « 20 A », « type A » ne sont jamais coupés en fin de ligne.
      const calibre = Number.isFinite(amperes) && amperes > 0 ? `${amperes}\u00A0A` : "";
      const ligne2 = type?.isDiff ? [calibre, "30\u00A0mA", type.diffType ? `type\u00A0${type.diffType}` : ""].filter(Boolean).join(" - ") : calibre;
      sortie.push({ ...nouvelleEtiquette(nom, ligne2, 1), modules: modulesValide(type?.width ?? 1), rangee: indexRangee });
    }
  });
  return sortie;
}

// ─── Brouillon (stockage local) ─────────────────────────────────────────────────────────────────

export const CLE_BROUILLON_ETIQUETTES = "voltapp:etiquettes";

export interface BrouillonEtiquettes {
  etiquettes: Etiquette[];
  formatId: string;
  perso: FormatPlanche;
  debut: number;
  guides: boolean;
  /** Pictogrammes (reconnus automatiquement ou choisis) : désactivables pour toute la planche. */
  pictos: boolean;
  /** Page A4 en paysage. */
  paysage: boolean;
  /** Une rangée du tableau = une ligne de la planche (étiquettes importées d'un tableau). */
  ligneParRangee: boolean;
}

export const brouillonVide = (): BrouillonEtiquettes => ({
  etiquettes: [nouvelleEtiquette()], formatId: FORMAT_DEFAUT, perso: { ...FORMAT_PERSO_DEFAUT }, debut: 0, guides: true, pictos: true, paysage: false, ligneParRangee: true,
});

export const serialiserBrouillon = (b: BrouillonEtiquettes): string => JSON.stringify({ v: 1, ...b });

const nombre = (v: unknown, defaut: number) => (typeof v === "number" && Number.isFinite(v) ? v : defaut);

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
          ...(typeof e.modules === "number" && modulesValide(e.modules) > 1 ? { modules: modulesValide(e.modules) } : {}),
          ...(typeof e.rangee === "number" && Number.isInteger(e.rangee) && e.rangee >= 0 && e.rangee < 1000 ? { rangee: e.rangee } : {}),
        }))
      : [];
    const p = o.perso && typeof o.perso === "object" ? o.perso as Record<string, unknown> : {};
    const perso: FormatPlanche = {
      ...FORMAT_PERSO_DEFAUT,
      largeur: nombre(p.largeur, FORMAT_PERSO_DEFAUT.largeur), hauteur: nombre(p.hauteur, FORMAT_PERSO_DEFAUT.hauteur),
      marge: nombre(p.marge, FORMAT_PERSO_DEFAUT.marge), ecart: nombre(p.ecart, FORMAT_PERSO_DEFAUT.ecart),
    };
    const formatId = typeof o.formatId === "string" && (o.formatId === ID_PERSONNALISE || FORMATS.some(f => f.id === o.formatId)) ? o.formatId : FORMAT_DEFAUT;
    return {
      etiquettes: etiquettes.length > 0 ? etiquettes : defaut.etiquettes,
      formatId, perso, debut: Math.max(0, Math.floor(nombre(o.debut, 0))), guides: o.guides !== false, pictos: o.pictos !== false, paysage: o.paysage === true, ligneParRangee: o.ligneParRangee !== false,
    };
  } catch { return defaut; }
}

/** Format retenu (prédéfini ou personnalisé), avec l'orientation de la page. */
export const formatChoisi = (b: Pick<BrouillonEtiquettes, "formatId" | "perso"> & { paysage?: boolean }): FormatPlanche => {
  const base = b.formatId === ID_PERSONNALISE ? { ...b.perso, id: ID_PERSONNALISE, nom: "Personnalisé" } : (FORMATS.find(f => f.id === b.formatId) ?? FORMATS[0]);
  return { ...base, paysage: b.paysage === true };
};
