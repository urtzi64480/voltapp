"use client";
import { AppareillageType, AppareillagePlace, LIBELLE_USAGE_DEDIE, USAGE_DEDIE_DEFAUT } from "@/lib/maison-types";

export const PALETTE: { type: AppareillageType; label: string; categorie: string }[] = [
  { type: "prise",           label: "Prise de courant",              categorie: "Prises" },
  { type: "prise_commandee", label: "Prise commandée",               categorie: "Prises" },
  { type: "prise_dediee",    label: "Prise dédiée (20 A / 32 A)",    categorie: "Prises" },
  { type: "rj45",           label: "Prise RJ45 (communication)",    categorie: "Prises" },
  { type: "point_lumineux",  label: "Point lumineux (plafond)",      categorie: "Éclairage" },
  { type: "applique",        label: "Applique murale",                categorie: "Éclairage" },
  { type: "spot",            label: "Spot encastré (plafond)",        categorie: "Éclairage" },
  { type: "spot_etanche",    label: "Spot encastré étanche (IP65)",   categorie: "Éclairage" },
  { type: "interrupteur",    label: "Interrupteur simple",           categorie: "Commandes" },
  { type: "va_et_vient",     label: "Va-et-vient",                    categorie: "Commandes" },
  { type: "telerupteur",     label: "Bouton poussoir (télérupteur)", categorie: "Commandes" },
  { type: "interrupteur_double", label: "Double interrupteur",         categorie: "Commandes" },
  { type: "va_et_vient_double",  label: "Double va-et-vient",          categorie: "Commandes" },
  { type: "telerupteur_double",  label: "Double bouton poussoir",      categorie: "Commandes" },
  { type: "detecteur_mouvement", label: "Détecteur de mouvement (allumage auto)", categorie: "Commandes" },
  // Extérieur : tout l'appareillage étanche au même endroit (prise, éclairage, commandes).
  { type: "prise_exterieure",         label: "Prise extérieure (étanche)",          categorie: "Extérieur" },
  { type: "applique_exterieure",      label: "Applique extérieure (étanche)",       categorie: "Extérieur" },
  { type: "point_lumineux_exterieur", label: "Point lumineux extérieur (étanche)",  categorie: "Extérieur" },
  { type: "interrupteur_exterieur",   label: "Interrupteur extérieur (étanche)",    categorie: "Extérieur" },
  { type: "detecteur_mouvement_exterieur", label: "Détecteur de mouvement extérieur (IP55)", categorie: "Extérieur" },
  { type: "four",            label: "Four",                           categorie: "Appareils dédiés" },
  { type: "plaque",          label: "Plaque de cuisson",              categorie: "Appareils dédiés" },
  { type: "lave_linge",      label: "Lave-linge",                     categorie: "Appareils dédiés" },
  { type: "lave_vaisselle",  label: "Lave-vaisselle",                 categorie: "Appareils dédiés" },
  { type: "seche_linge",     label: "Sèche-linge",                    categorie: "Appareils dédiés" },
  { type: "chauffe_eau",     label: "Chauffe-eau",                    categorie: "Appareils dédiés" },
  { type: "chauffage",       label: "Chauffage électrique",           categorie: "Appareils dédiés" },
  { type: "clim",            label: "Climatisation",                  categorie: "Appareils dédiés" },
  { type: "seche_serviette", label: "Sèche-serviette",                categorie: "Appareils dédiés" },
  { type: "congelateur",     label: "Congélateur",                    categorie: "Appareils dédiés" },
  { type: "irve",            label: "Borne IRVE",                     categorie: "Appareils dédiés" },
  { type: "piscine",         label: "Piscine / PAC",                  categorie: "Appareils dédiés" },
  { type: "vmc",             label: "VMC",                            categorie: "Appareils dédiés" },
  { type: "alarme",          label: "Alarme",                         categorie: "Appareils dédiés" },
  { type: "volet_roulant",   label: "Volet roulant",                  categorie: "Appareils dédiés" },
];

export function labelAppareillage(type: AppareillageType): string {
  return PALETTE.find(p => p.type === type)?.label ?? type;
}

// Libellé d'un appareillage PLACÉ : pour une prise dédiée, précise l'appareil alimenté
// (ex. « Prise dédiée — Four »).
export function labelAppareillagePlace(a: Pick<AppareillagePlace, "type" | "usageDedie">): string {
  if (a.type === "prise_dediee") return `Prise dédiée — ${LIBELLE_USAGE_DEDIE[a.usageDedie ?? USAGE_DEDIE_DEFAUT] ?? "?"}`;
  return labelAppareillage(a.type);
}

const DEDIE_INITIALES: Record<string, string> = {
  four: "F", plaque: "PC", lave_linge: "LL", lave_vaisselle: "LV", seche_linge: "SL",
  chauffe_eau: "CE", chauffage: "CH", clim: "CL", seche_serviette: "SS",
  congelateur: "CG", irve: "EV", piscine: "PI", vmc: "VMC", alarme: "AL", volet_roulant: "VR",
};

// Initiales courtes par type — utilisées comme étiquette d'identification (ex. vue 3D),
// même logique que les symboles 2D mais réduite à 1-3 caractères.
const INITIALES_BASE: Record<string, string> = {
  prise: "P", prise_commandee: "PC", point_lumineux: "PL", applique: "AP", spot: "SP", spot_etanche: "SE",
  interrupteur: "I", va_et_vient: "VV", telerupteur: "BP", rj45: "RJ", prise_dediee: "PD", prise_exterieure: "PE",
  interrupteur_double: "I2", va_et_vient_double: "VV2", telerupteur_double: "BP2",
  applique_exterieure: "AE", point_lumineux_exterieur: "PLE", interrupteur_exterieur: "IE",
  detecteur_mouvement: "DM", detecteur_mouvement_exterieur: "DME",
};
// usageDedie : pour une prise dédiée, l'étiquette est celle de l'appareil alimenté (F, LL, LV…).
export function initialesAppareillage(type: AppareillageType, usageDedie?: AppareillageType): string {
  if (type === "prise_dediee") return DEDIE_INITIALES[usageDedie ?? USAGE_DEDIE_DEFAUT] ?? "PD";
  return INITIALES_BASE[type] ?? DEDIE_INITIALES[type] ?? "?";
}

// ─── SYMBOLES D'IMPLANTATION NORMALISÉS (schéma architectural, NF C 15-100 / CEI 60617) ───
// Source unique : chaque symbole est une liste de primitives dans un repère 24 × 24, avec
// le MUR EN BAS (y = 24) et l'intérieur de la pièce en haut. Le même dessin sert au plan 2D
// (React), à la palette et à l'impression (chaîne SVG) — on ne maintient qu'une définition.
// Les symboles "orientés" (prises, commandes, applique) pivotent pour que leur base reste
// plaquée contre le mur auquel ils sont aimantés ; les autres (lampe de plafond, appareils
// dédiés avec abréviation) restent droits pour que le texte reste lisible.

type Prim =
  | { k: "c"; cx: number; cy: number; r: number; f?: boolean }
  | { k: "l"; x1: number; y1: number; x2: number; y2: number; w?: number }
  | { k: "p"; d: string; f?: boolean }
  | { k: "r"; x: number; y: number; w: number; h: number; f?: boolean }
  | { k: "t"; x: number; y: number; s: number; txt: string };

interface DefSymbole { oriente: boolean; prims: Prim[]; }

const L = (x1: number, y1: number, x2: number, y2: number, w?: number): Prim => ({ k: "l", x1, y1, x2, y2, w });

// Interrupteur : petit cercle + "tige" oblique ; les barbes en bout de tige distinguent
// simple allumage (1 barbe), va-et-vient (barbe de chaque côté) et bouton-poussoir (carré).
const TIGE: Prim[] = [{ k: "c", cx: 10.5, cy: 15.5, r: 3.8 }, L(13.2, 12.8, 19, 7)];

// Doubles : le même cercle porte deux tiges parallèles (une par voie). Tige A (haut-gauche) et tige B
// (bas-droite), décalées de ±1,7 perpendiculairement à la tige, chacune partant du bord du cercle.
const CERCLE: Prim = { k: "c", cx: 10.5, cy: 15.5, r: 3.8 };
const TIGES_DOUBLES: Prim[] = [CERCLE, L(11.7, 11.9, 16.4, 7.2), L(14.1, 14.3, 18.8, 9.6)];

const SYMBOLES: Record<AppareillageType, DefSymbole> = {
  // Prise de courant 2P+T : demi-cercle posé sur le mur, trait perpendiculaire (pôles)
  // prolongé d'une barre (contact de terre).
  prise: { oriente: true, prims: [
    { k: "p", d: "M 5.5 19 A 6.5 6.5 0 0 1 18.5 19 Z" }, L(12, 19, 12, 7.5), L(8.5, 7.5, 15.5, 7.5),
  ] },
  // Prise commandée : prise 2P+T + tige de commande (comme un interrupteur).
  prise_commandee: { oriente: true, prims: [
    { k: "p", d: "M 4.5 19 A 6.5 6.5 0 0 1 17.5 19 Z" }, L(11, 19, 11, 8), L(7.5, 8, 14.5, 8),
    L(17, 14, 21, 10), L(21, 10, 22.8, 11.8),
  ] },
  // Point d'éclairage en plafond : cercle barré d'une croix.
  point_lumineux: { oriente: false, prims: [
    { k: "c", cx: 12, cy: 12, r: 7 }, L(7.05, 7.05, 16.95, 16.95), L(16.95, 7.05, 7.05, 16.95),
  ] },
  // Spot encastré au plafond : petit cercle croisé, nettement plus petit que le point lumineux de plafond (rayon 5
  // contre 7) pour qu'une rangée de spots se lise d'un coup d'œil sur le plan.
  spot: { oriente: false, prims: [
    { k: "c", cx: 12, cy: 12, r: 5 }, L(8.46, 8.46, 15.54, 15.54), L(15.54, 8.46, 8.46, 15.54),
  ] },
  // Spot étanche (IP65) : même spot, entouré d'un double cercle (joint d'étanchéité) — même convention
  // que la prise extérieure étanche, pour le distinguer d'un spot ordinaire.
  spot_etanche: { oriente: false, prims: [
    { k: "c", cx: 12, cy: 12, r: 9 }, { k: "c", cx: 12, cy: 12, r: 5 }, L(8.46, 8.46, 15.54, 15.54), L(15.54, 8.46, 8.46, 15.54),
  ] },
  // Applique : point d'éclairage (cercle croisé) tangent à un trait épais = le mur.
  applique: { oriente: true, prims: [
    { k: "c", cx: 12, cy: 13.5, r: 5.5 }, L(8.1, 9.6, 15.9, 17.4), L(15.9, 9.6, 8.1, 17.4), L(6, 20, 18, 20, 2.6),
  ] },
  // Prise dédiée (circuit spécialisé : four, lave-linge…) : prise 2P+T à demi-disque PLEIN — se
  // distingue d'une prise ordinaire ; l'appareil alimenté s'indique à côté (initiales, voir
  // initialesAppareillage).
  prise_dediee: { oriente: true, prims: [
    { k: "p", d: "M 5.5 19 A 6.5 6.5 0 0 1 18.5 19 Z", f: true }, L(12, 19, 12, 7.5), L(8.5, 7.5, 15.5, 7.5),
  ] },
  // Prise extérieure (étanche IP44) : prise 2P+T dans un demi-cercle double (capot étanche), pour la
  // distinguer d'une prise intérieure ; reste sur le circuit « extérieur ».
  prise_exterieure: { oriente: true, prims: [
    { k: "p", d: "M 3.5 19 A 8.5 8.5 0 0 1 20.5 19 Z" }, { k: "p", d: "M 6.5 19 A 5.5 5.5 0 0 1 17.5 19 Z" },
    L(12, 19, 12, 9), L(8.5, 9, 15.5, 9),
  ] },
  // Prise de communication RJ45 : triangle posé sur le mur, pointe vers la pièce, repéré par un
  // carré plein (prise de communication — voltage faible, jamais sur un circuit de puissance).
  rj45: { oriente: true, prims: [
    { k: "p", d: "M 4.5 19 L 19.5 19 L 12 6 Z" }, { k: "r", x: 10, y: 13, w: 4, h: 4, f: true },
  ] },
  // Applique extérieure (étanche) : applique (cercle croisé tangent au mur) entourée d'un second cercle — même
  // convention « double contour = étanche » que le spot étanche et la prise extérieure.
  applique_exterieure: { oriente: true, prims: [
    { k: "c", cx: 12, cy: 12.5, r: 7.5 }, { k: "c", cx: 12, cy: 12.5, r: 4.6 },
    L(8.75, 9.25, 15.25, 15.75), L(15.25, 9.25, 8.75, 15.75), L(5, 21.2, 19, 21.2, 2.6),
  ] },
  // Point lumineux extérieur (étanche) : point lumineux de plafond (cercle barré d'une croix) sous un cercle de joint.
  point_lumineux_exterieur: { oriente: false, prims: [
    { k: "c", cx: 12, cy: 12, r: 9.5 }, { k: "c", cx: 12, cy: 12, r: 6.5 }, L(7.4, 7.4, 16.6, 16.6), L(16.6, 7.4, 7.4, 16.6),
  ] },
  // Interrupteur extérieur (étanche) : l'interrupteur simple dont le cercle est doublé d'un cercle de joint.
  interrupteur_exterieur: { oriente: true, prims: [
    { k: "c", cx: 10.5, cy: 15.5, r: 5.8 }, ...TIGE, L(19, 7, 21.5, 9.5),
  ] },
  // Détecteur de mouvement : lentille (petit disque plein, posé contre le mur) d'où part un secteur de détection
  // dirigé vers la pièce. Le secteur est ouvert (traits seuls) pour rester lisible à 7-10 px.
  detecteur_mouvement: { oriente: true, prims: [
    { k: "p", d: "M 12 17 L 4.5 6 Q 12 2 19.5 6 Z" }, { k: "c", cx: 12, cy: 18.5, r: 2.4, f: true },
  ] },
  // Détecteur de mouvement extérieur (IP55) : même détecteur, lentille cerclée d'un double contour étanche.
  detecteur_mouvement_exterieur: { oriente: true, prims: [
    { k: "p", d: "M 12 15 L 4.5 4.5 Q 12 1 19.5 4.5 Z" }, { k: "c", cx: 12, cy: 18.3, r: 4.4 }, { k: "c", cx: 12, cy: 18.3, r: 2, f: true },
  ] },
  interrupteur: { oriente: true, prims: [...TIGE, L(19, 7, 21.5, 9.5)] },
  // Double allumage : une barbe au bout de CHAQUE tige.
  interrupteur_double: { oriente: true, prims: [...TIGES_DOUBLES, L(16.4, 7.2, 18.1, 8.9), L(18.8, 9.6, 20.5, 11.3)] },
  // Double va-et-vient : barbes de part et d'autre de chaque tige.
  va_et_vient_double: { oriente: true, prims: [
    ...TIGES_DOUBLES, L(16.4, 7.2, 18.1, 8.9), L(16.4, 7.2, 14.7, 5.5), L(18.8, 9.6, 20.5, 11.3), L(18.8, 9.6, 17.1, 7.9),
  ] },
  // Double bouton poussoir : un carré plein au bout de chaque tige.
  telerupteur_double: { oriente: true, prims: [
    ...TIGES_DOUBLES, { k: "r", x: 14.6, y: 4.9, w: 3.6, h: 3.6, f: true }, { k: "r", x: 17, y: 7.3, w: 3.6, h: 3.6, f: true },
  ] },
  va_et_vient: { oriente: true, prims: [...TIGE, L(19, 7, 21.5, 9.5), L(19, 7, 16.5, 4.5)] },
  telerupteur: { oriente: true, prims: [
    { k: "c", cx: 10.5, cy: 15.5, r: 3.8 }, L(13.2, 12.8, 17.5, 8.5), { k: "r", x: 16.2, y: 3.2, w: 5, h: 5, f: true },
  ] },
  // Appareils dédiés : sortie de câble = cercle + abréviation (texte non pivoté).
  four: { oriente: false, prims: [{ k: "c", cx: 12, cy: 12, r: 8.5 }, { k: "t", x: 12, y: 14.4, s: 7.5, txt: "F" }] },
  plaque: { oriente: false, prims: [{ k: "c", cx: 12, cy: 12, r: 8.5 }, { k: "t", x: 12, y: 14.2, s: 6.6, txt: "PC" }] },
  lave_linge: { oriente: false, prims: [{ k: "c", cx: 12, cy: 12, r: 8.5 }, { k: "t", x: 12, y: 14.2, s: 6.6, txt: "LL" }] },
  lave_vaisselle: { oriente: false, prims: [{ k: "c", cx: 12, cy: 12, r: 8.5 }, { k: "t", x: 12, y: 14.2, s: 6.6, txt: "LV" }] },
  seche_linge: { oriente: false, prims: [{ k: "c", cx: 12, cy: 12, r: 8.5 }, { k: "t", x: 12, y: 14.2, s: 6.6, txt: "SL" }] },
  congelateur: { oriente: false, prims: [{ k: "c", cx: 12, cy: 12, r: 8.5 }, { k: "t", x: 12, y: 14.2, s: 6.6, txt: "CG" }] },
  clim: { oriente: false, prims: [{ k: "c", cx: 12, cy: 12, r: 8.5 }, { k: "t", x: 12, y: 14.2, s: 6.6, txt: "CL" }] },
  irve: { oriente: false, prims: [{ k: "c", cx: 12, cy: 12, r: 8.5 }, { k: "t", x: 12, y: 14.2, s: 6.6, txt: "EV" }] },
  piscine: { oriente: false, prims: [{ k: "c", cx: 12, cy: 12, r: 8.5 }, { k: "t", x: 12, y: 14.2, s: 6.6, txt: "PI" }] },
  vmc: { oriente: false, prims: [{ k: "c", cx: 12, cy: 12, r: 8.5 }, { k: "t", x: 12, y: 14, s: 5.6, txt: "VMC" }] },
  alarme: { oriente: false, prims: [{ k: "c", cx: 12, cy: 12, r: 8.5 }, { k: "t", x: 12, y: 14.2, s: 6.6, txt: "AL" }] },
  // Volet roulant : coffre (rectangle) + lames du tablier, abréviation VR. Ne pivote pas (texte).
  volet_roulant: { oriente: false, prims: [
    { k: "r", x: 2.5, y: 6, w: 19, h: 12 }, L(2.5, 10, 21.5, 10), { k: "t", x: 12, y: 16.4, s: 6.4, txt: "VR" },
  ] },
  // Chauffe-eau : réservoir (cercle) à hachures verticales.
  chauffe_eau: { oriente: false, prims: [
    { k: "c", cx: 12, cy: 12, r: 8.5 }, L(8.5, 7.2, 8.5, 16.8), L(12, 5.6, 12, 18.4), L(15.5, 7.2, 15.5, 16.8),
  ] },
  // Radiateur / convecteur électrique : rectangle à ailettes.
  chauffage: { oriente: false, prims: [
    { k: "r", x: 3, y: 7.5, w: 18, h: 9 }, L(7.5, 7.5, 7.5, 16.5), L(10.5, 7.5, 10.5, 16.5), L(13.5, 7.5, 13.5, 16.5), L(16.5, 7.5, 16.5, 16.5),
  ] },
  seche_serviette: { oriente: false, prims: [
    { k: "r", x: 7, y: 3, w: 10, h: 18 }, L(7, 8, 17, 8), L(7, 12, 17, 12), L(7, 16, 17, 16),
  ] },
};

export function symboleEstOriente(type: AppareillageType): boolean {
  return SYMBOLES[type]?.oriente ?? false;
}

// Pictogramme centré sur (0,0), à insérer dans un <svg> existant (plan 2D) : size = côté
// visuel en px, rotation = degrés (sens horaire écran) appliqués aux symboles orientés.
// rotation = 0 → mur en bas de l'écran, intérieur de la pièce vers le haut.
export function AppareillageGlyphe({ type, size = 20, color = "#1c1917", rotation = 0, fond = "#ffffff" }: {
  type: AppareillageType; size?: number; color?: string; rotation?: number; fond?: string;
}) {
  const def = SYMBOLES[type] ?? SYMBOLES.prise;
  const rot = def.oriente ? rotation : 0;
  const trait = { stroke: color, strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <g transform={`rotate(${rot}) scale(${size / 24}) translate(-12 -12)`}>
      {def.prims.map((p, i) => {
        switch (p.k) {
          case "c": return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={p.f ? color : fond} {...trait} />;
          case "l": return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} {...trait} strokeWidth={p.w ?? 1.5} />;
          case "p": return <path key={i} d={p.d} fill={p.f ? color : fond} {...trait} />;
          case "r": return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.f ? color : fond} {...trait} />;
          case "t": return <text key={i} x={p.x} y={p.y} fontSize={p.s} textAnchor="middle" fill={color} fontFamily="monospace" fontWeight="bold">{p.txt}</text>;
        }
      })}
    </g>
  );
}

// Version autonome (palette, listes) : même dessin, dans son propre <svg>.
export function AppareillageSymbol({ type, size = 20, color = "#1c1917" }: {
  type: AppareillageType; size?: number; color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}>
      <AppareillageGlyphe type={type} size={size} color={color} fond="none" />
    </svg>
  );
}

// Version chaîne SVG (fenêtre d'impression, hors React). x,y = centre ; size = côté du
// pictogramme ; rotationDeg = orientation écran (symboles orientés) ; avecBoite entoure le
// symbole d'un carré blanc, comme sur le plan.
export function appareillageSymbolSvgString(
  type: AppareillageType, x: number, y: number, size = 14, color = "#1c1917",
  rotationDeg = 0, avecBoite = false,
): string {
  const def = SYMBOLES[type] ?? SYMBOLES.prise;
  const rot = def.oriente ? rotationDeg : 0;
  const sw = 1.5;
  const attrs = `stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  const corps = def.prims.map(p => {
    switch (p.k) {
      case "c": return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="${p.f ? color : "#fff"}" ${attrs}/>`;
      case "l": return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" ${attrs} stroke-width="${p.w ?? sw}"/>`;
      case "p": return `<path d="${p.d}" fill="${p.f ? color : "#fff"}" ${attrs}/>`;
      case "r": return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${p.f ? color : "#fff"}" ${attrs}/>`;
      case "t": return `<text x="${p.x}" y="${p.y}" font-size="${p.s}" text-anchor="middle" fill="${color}" font-family="monospace" font-weight="bold">${p.txt}</text>`;
    }
  }).join("");
  const boite = avecBoite
    ? `<rect x="${(x - size * 0.75).toFixed(2)}" y="${(y - size * 0.75).toFixed(2)}" width="${(size * 1.5).toFixed(2)}" height="${(size * 1.5).toFixed(2)}" rx="2" fill="#fff" stroke="${color}" stroke-width="0.9"/>`
    : "";
  return `${boite}<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rot}) scale(${(size / 24).toFixed(4)}) translate(-12 -12)">${corps}</g>`;
}
