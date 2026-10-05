// Escaliers : calcul de la géométrie (marches, paliers, balancées, hélice), de la trémie de l'étage desservi et des
// contrôles de confort / sécurité. Aucune dépendance à three.js : le plan 2D, la vue 3D et l'export partagent ce calcul.
//
// Repère LOCAL (cm) : s = sens de la montée de la 1re volée, t = à droite quand on monte. Un virage est calculé « à
// gauche » puis symétrisé (t → −t) pour un virage à droite. Le repère MONDE est celui du plan (mètres, y vers le bas) :
// rotation 0 = la montée va vers le HAUT du plan, rotation en degrés dans le sens horaire.

import { Escalier, EscalierTournant, EscalierType, Niveau, Point, estAnnexe, uidMaison } from "@/lib/maison-types";

export const LABEL_ESCALIER_TYPE: Record<EscalierType, string> = {
  droit: "Droit", quart_tournant: "Quart tournant", demi_tournant: "Demi-tournant", helicoidal: "Hélicoïdal",
};
export const LABEL_STRUCTURE: Record<Escalier["structure"], string> = {
  limons_lateraux: "Limons latéraux", limon_central: "Limon central", massif: "Massif (béton)",
  marches_seules: "Marches seules (console)", poteau_central: "Poteau central",
};
export const LABEL_RAMPE: Record<Escalier["rampe"], string> = {
  aucune: "Aucune", gauche: "À gauche", droite: "À droite", deux_cotes: "Des deux côtés",
};
export const LABEL_MATERIAU: Record<Escalier["materiau"], string> = { bois: "Bois", beton: "Béton", metal: "Métal", blanc: "Blanc laqué" };
export const COULEUR_MATERIAU: Record<Escalier["materiau"], number> = { bois: 0xb98b5a, beton: 0xb8b5ae, metal: 0x6b7280, blanc: 0xf1f1ef };

// Valeurs par défaut (cm) — SOURCE UNIQUE, partagées par le calcul, le panneau et la vue 3D.
export const HAUTEUR_MARCHE_CIBLE_CM = 17.5;
export const BLONDEL_CM = 64;                  // 2h + g
export const EPAISSEUR_MARCHE_DEFAUT_CM = 4;
export const HAUTEUR_PASSAGE_DEFAUT_CM = 190;
export const EPAISSEUR_PLANCHER_DEFAUT_CM = 22;
export const EPAISSEUR_STRUCTURE_CM = 14;       // épaisseur de la paillasse / des limons sous les marches
export const DIAMETRE_HELICE_DEFAUT_CM = 200;
export const DIAMETRE_POTEAU_DEFAUT_CM = 16;

interface P { s: number; t: number; }   // repère local, cm

interface MarcheLocale {
  poly: P[]; idx: number;                // idx : nombre de contremarches franchies au niveau de CETTE marche (z = idx × h)
  type: "marche" | "palier" | "balancee";
  entree: [P, P];                        // arête d'entrée (là où se dresse la contremarche)
  bords: { a: P; b: P; cote: "g" | "d" }[];   // côtés libres (limons, garde-corps), dans l'ordre de la marche
  axe: P;                                // direction de montée au droit de la marche (unitaire)
}

export interface MarcheCalc {
  poly: Point[];                         // monde, m
  z: number; zPrec: number;              // m — dessus de la marche / dessus de la marche précédente (pied de la contremarche)
  type: "marche" | "palier" | "balancee";
  entree: [Point, Point];
  bords: { a: Point; b: Point; cote: "g" | "d" }[];
  axe: Point;                            // vecteur unitaire, monde
}

export interface CalculEscalier {
  hauteurTotale: number;                 // cm
  nbMarches: number;                     // contremarches
  hMarche: number;                       // cm
  giron: number;                         // cm
  blondel: number;                       // 2h + g
  pente: number;                         // degrés
  marches: MarcheCalc[];                 // marches PHYSIQUES (nbMarches − 1) ; la dernière contremarche rejoint le plancher
  finRiser: { a: Point; b: Point; zBas: number; zHaut: number };   // dernière contremarche (m)
  tremie: Point[];                       // monde, m — polygone CONVEXE à percer dans le plancher du niveau desservi
  tremieZone: number;                    // nombre de marches comprises sous la trémie
  poteau?: { centre: Point; rayon: number };   // m
  emprise: { minX: number; minY: number; maxX: number; maxY: number };
  empriseCm: { longueur: number; largeur: number };    // encombrement obtenu (sens de la 1re volée × travers), cm
  tremieCm: { longueur: number; largeur: number };     // dimensions de la trémie (même repère), cm
  emmarchementCm: number;                              // largeur utile des marches, cm
  avertissements: string[];
}

// ─── Paramètres ─────────────────────────────────────────────────────────────────────────────────────────
export function hauteurTotaleEscalierCm(e: Escalier, source: Niveau): number {
  if (e.hauteurCm && e.hauteurCm > 0) return e.hauteurCm;
  return Math.round((source.hauteurPlafond ?? 2.5) * 100 + (e.epaisseurPlancher ?? EPAISSEUR_PLANCHER_DEFAUT_CM));
}

export interface Dimensionnement { H: number; n: number; h: number; g: number; L: number; n1?: number; }

// Dimensionnement AUTOMATIQUE : tout se calcule à partir de la hauteur à franchir ; chaque valeur renseignée par
// l'utilisateur est respectée et le reste se recalcule autour. Ordre de priorité du giron : giron imposé > déduit de
// l'encombrement imposé (longueur / largeur hors-tout) > Blondel. Le nombre de marches, s'il n'est pas imposé, est choisi
// (entre 15 et 21 cm de hauteur de marche) pour que 2h + g soit au plus près de 64 cm avec l'encombrement demandé.
export function dimensionner(e: Escalier, hauteurTotaleCm: number): Dimensionnement {
  const H = Math.max(50, hauteurTotaleCm);
  const Ls = e.longueurHorsTout && e.longueurHorsTout > 0 ? e.longueurHorsTout : undefined;
  const Lt = e.largeurHorsTout && e.largeurHorsTout > 0 ? e.largeurHorsTout : undefined;
  const balancees = e.tournant === "balancees";
  let L = Math.max(40, e.largeur || 90);
  if (e.type === "demi_tournant" && Lt) L = Math.max(40, (Lt - (balancees ? 0 : Math.max(0, e.jour ?? 10))) / 2);
  const gImpose = e.giron && e.giron > 5 ? e.giron : undefined;
  const nImpose = e.nbMarches ? Math.max(3, Math.round(e.nbMarches)) : undefined;
  const n1Impose = e.nbMarchesVolee1 ? Math.round(e.nbMarchesVolee1) : undefined;

  // Pour n marches : giron (et 1re volée) que l'encombrement impose ; undefined s'il ne contraint rien.
  const deduire = (n: number): { g: number; n1?: number } | undefined => {
    if (e.type === "helicoidal") return undefined;
    if (e.type === "droit") return Ls && n > 1 ? { g: Ls / (n - 1) } : undefined;
    const quart = e.type === "quart_tournant";
    const nb = balancees ? clamp(clamp(Math.round(e.nbBalancees ?? (quart ? 3 : 6)), quart ? 2 : 3, quart ? 6 : 10), quart ? 2 : 3, n - 2) : 0;
    // nb de pas (hors palier / éventail) de la volée 1 et de la volée 2 selon n1 ; −1 pour un palier (il compte comme une marche)
    const pas1 = (n1: number) => (balancees ? n1 : n1 - 1);
    const pas2 = (n1: number) => (balancees ? n - n1 - nb - 1 : n - n1 - 1);
    const gS = (n1: number) => (Ls && pas1(n1) > 0 ? (Ls - L) / pas1(n1) : undefined);
    const gT = (n1: number) => (quart && Lt && pas2(n1) > 0 ? (Lt - L) / pas2(n1) : undefined);
    const n1Defaut = balancees ? Math.ceil((n - nb) / 2) : Math.ceil(n / 2);
    const n1Max = balancees ? n - nb - 1 : n - 1;
    const combine = (n1: number): number | undefined => {
      const a = gS(n1), b = gT(n1);
      const valides = [a, b].filter((v): v is number => v !== undefined && v > 0);
      return valides.length ? valides.reduce((x, y) => x + y, 0) / valides.length : undefined;
    };
    if (n1Impose) { const n1 = clamp(n1Impose, 1, n1Max); const g = combine(n1); return g ? { g, n1 } : undefined; }
    if (quart && Ls && Lt) {
      // Les deux dimensions imposées : on cherche la répartition des marches entre les volées qui les respecte au mieux.
      let meilleur: { g: number; n1: number; ecart: number } | undefined;
      for (let n1 = 1; n1 <= n1Max; n1++) {
        const a = gS(n1), b = gT(n1);
        if (!a || !b || a <= 0 || b <= 0) continue;
        const ecart = Math.abs(a - b);
        if (!meilleur || ecart < meilleur.ecart) meilleur = { g: (a + b) / 2, n1, ecart };
      }
      return meilleur ? { g: meilleur.g, n1: meilleur.n1 } : undefined;
    }
    const g = combine(clamp(n1Defaut, 1, n1Max));
    return g ? { g } : undefined;
  };

  const nAuto = Math.max(3, Math.round(H / HAUTEUR_MARCHE_CIBLE_CM));
  let n = nImpose ?? nAuto;
  if (!nImpose && !gImpose && (Ls || Lt) && e.type !== "helicoidal") {
    let meilleur: { n: number; score: number } | undefined;
    for (let c = Math.max(3, Math.ceil(H / 21)); c <= Math.floor(H / 15); c++) {
      const d = deduire(c);
      if (!d) continue;
      const score = Math.abs(2 * (H / c) + d.g - BLONDEL_CM) + (d.g < 22 || d.g > 32 ? 20 : 0);
      if (!meilleur || score < meilleur.score) meilleur = { n: c, score };
    }
    if (meilleur) n = meilleur.n;
  }
  const h = H / n;
  const dd = gImpose ? undefined : deduire(n);
  const g = gImpose ?? dd?.g ?? clamp(Math.round((BLONDEL_CM - 2 * h) * 2) / 2, 22, 32);
  return { H, n, h, g, L, n1: n1Impose ? undefined : dd?.n1 };
}

export function parametresEscalier(e: Escalier, hauteurTotaleCm: number): { H: number; n: number; h: number; g: number } {
  const { H, n, h, g } = dimensionner(e, hauteurTotaleCm);
  return { H, n, h, g };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const droiteDe = (u: P): P => ({ s: -u.t, t: u.s });          // vecteur à droite de u
const plus = (p: P, u: P, k: number): P => ({ s: p.s + u.s * k, t: p.t + u.t * k });
const egal = (p: P, q: P) => Math.abs(p.s - q.s) < 1e-6 && Math.abs(p.t - q.t) < 1e-6;
const sansDoublons = (pts: P[]): P[] => pts.filter((p, i) => !egal(p, pts[(i + pts.length - 1) % pts.length]));

// ─── Géométrie locale ───────────────────────────────────────────────────────────────────────────────────
interface Local {
  marches: MarcheLocale[];
  finRiser: [P, P]; dirSortie: P;
  poteau?: { rayon: number };
  rayonTremie?: number;                  // hélicoïdal : trémie circulaire centrée sur l'origine
  giron?: number;                        // hélicoïdal : giron effectif sur la ligne de foulée (cm)
  tours?: number;                        // hélicoïdal : nombre de tours parcourus
  marchesParTour?: number;               // hélicoïdal
}

function genererLocal(e: Escalier, n: number, g: number, L: number, n1Auto?: number): Local {

  // Volée droite : nbMarches marches de giron g, qui partent de P0 (milieu de l'arête d'entrée) dans la direction u.
  const volee = (P0: P, u: P, nbMarches: number, idx0: number): MarcheLocale[] => {
    const r = droiteDe(u);
    const out: MarcheLocale[] = [];
    for (let j = 1; j <= nbMarches; j++) {
      const E = plus(P0, u, (j - 1) * g);
      const eg = plus(E, r, -L / 2), ed = plus(E, r, L / 2);
      out.push({
        poly: [eg, plus(eg, u, g), plus(ed, u, g), ed], idx: idx0 + j, type: "marche", entree: [eg, ed],
        bords: [{ a: eg, b: plus(eg, u, g), cote: "g" }, { a: ed, b: plus(ed, u, g), cote: "d" }], axe: u,
      });
    }
    return out;
  };
  const finDeVolee = (P0: P, u: P, nbMarches: number): [P, P] => {
    const r = droiteDe(u), E = plus(P0, u, nbMarches * g);
    return [plus(E, r, -L / 2), plus(E, r, L / 2)];
  };

  // Marches balancées : éventail de nb marches autour du pivot Pv, sur un rectangle, balayant sweep degrés.
  const eventail = (Pv: P, rect: { smin: number; smax: number; tmin: number; tmax: number }, nb: number, sweepDeg: number, idx0: number): MarcheLocale[] => {
    const bord = (psi: number): P => {
      const dt = Math.cos(psi), ds = Math.sin(psi);
      let lam = Infinity;
      if (dt > 1e-9) lam = Math.min(lam, (rect.tmax - Pv.t) / dt);
      else if (dt < -1e-9) lam = Math.min(lam, (rect.tmin - Pv.t) / dt);
      if (ds > 1e-9) lam = Math.min(lam, (rect.smax - Pv.s) / ds);
      return { s: Pv.s + ds * lam, t: Pv.t + dt * lam };
    };
    const coins: P[] = [{ s: rect.smin, t: rect.tmax }, { s: rect.smax, t: rect.tmax }, { s: rect.smax, t: rect.tmin }, { s: rect.smin, t: rect.tmin }];
    const angleDe = (c: P) => Math.atan2(c.s - Pv.s, c.t - Pv.t);
    const out: MarcheLocale[] = [];
    for (let k = 1; k <= nb; k++) {
      const a = ((k - 1) * sweepDeg / nb) * Math.PI / 180, b = (k * sweepDeg / nb) * Math.PI / 180;
      const dedans = coins.filter(c => !egal(c, Pv) && angleDe(c) > a + 1e-6 && angleDe(c) < b - 1e-6).sort((c1, c2) => angleDe(c1) - angleDe(c2));
      const pts = sansDoublons([Pv, bord(a), ...dedans, bord(b)]);
      const bords: MarcheLocale["bords"] = [];
      for (let q = 1; q < pts.length - 1; q++) bords.push({ a: pts[q], b: pts[q + 1], cote: "d" });   // côté extérieur du virage
      const m = (a + b) / 2;
      out.push({ poly: pts, idx: idx0 + k, type: "balancee", entree: [Pv, bord(a)], bords, axe: { s: Math.sin(m), t: Math.cos(m) } });
    }
    return out;
  };

  const rep = (v: number | undefined, def: number, min: number, max: number) => clamp(Math.round(v ?? def), min, max);

  switch (e.type) {
    case "quart_tournant": {
      const U: P = { s: 1, t: 0 }, V: P = { s: 0, t: -1 };       // volée 1 vers +s, volée 2 vers −t (virage à gauche)
      if (e.tournant === "balancees") {
        const nb = clamp(rep(e.nbBalancees, 3, 2, 6), 2, n - 2);
        const n1 = rep(e.nbMarchesVolee1 ?? n1Auto, Math.ceil((n - nb) / 2), 1, n - nb - 1);
        const n2 = n - n1 - nb, s0 = n1 * g;
        const marches = [
          ...volee({ s: 0, t: 0 }, U, n1, 0),
          ...eventail({ s: s0, t: -L / 2 }, { smin: s0, smax: s0 + L, tmin: -L / 2, tmax: L / 2 }, nb, 90, n1),
          ...volee({ s: s0 + L / 2, t: -L / 2 }, V, n2 - 1, n1 + nb),
        ];
        return { marches, finRiser: finDeVolee({ s: s0 + L / 2, t: -L / 2 }, V, n2 - 1), dirSortie: V };
      }
      const n1 = rep(e.nbMarchesVolee1 ?? n1Auto, Math.ceil(n / 2), 1, n - 1);
      const n2 = n - n1, s0 = (n1 - 1) * g;
      const palier: MarcheLocale = {
        poly: [{ s: s0, t: -L / 2 }, { s: s0 + L, t: -L / 2 }, { s: s0 + L, t: L / 2 }, { s: s0, t: L / 2 }], idx: n1, type: "palier",
        entree: [{ s: s0, t: -L / 2 }, { s: s0, t: L / 2 }],
        bords: [{ a: { s: s0, t: L / 2 }, b: { s: s0 + L, t: L / 2 }, cote: "d" }, { a: { s: s0 + L, t: L / 2 }, b: { s: s0 + L, t: -L / 2 }, cote: "d" }],
        axe: U,
      };
      const P2: P = { s: s0 + L / 2, t: -L / 2 };
      return { marches: [...volee({ s: 0, t: 0 }, U, n1 - 1, 0), palier, ...volee(P2, V, n2 - 1, n1)], finRiser: finDeVolee(P2, V, n2 - 1), dirSortie: V };
    }

    case "demi_tournant": {
      const U: P = { s: 1, t: 0 }, V: P = { s: -1, t: 0 };       // volée 1 vers +s, volée 2 en sens inverse (virage à gauche)
      if (e.tournant === "balancees") {
        const nb = clamp(rep(e.nbBalancees, 6, 3, 10), 3, n - 2);
        const n1 = rep(e.nbMarchesVolee1 ?? n1Auto, Math.ceil((n - nb) / 2), 1, n - nb - 1);
        const n2 = n - n1 - nb, s0 = n1 * g;
        const P2: P = { s: s0, t: -L };
        const marches = [
          ...volee({ s: 0, t: 0 }, U, n1, 0),
          ...eventail({ s: s0, t: -L / 2 }, { smin: s0, smax: s0 + L, tmin: -1.5 * L, tmax: L / 2 }, nb, 180, n1),
          ...volee(P2, V, n2 - 1, n1 + nb),
        ];
        return { marches, finRiser: finDeVolee(P2, V, n2 - 1), dirSortie: V };
      }
      const jour = Math.max(0, e.jour ?? 10);
      const n1 = rep(e.nbMarchesVolee1 ?? n1Auto, Math.ceil(n / 2), 1, n - 1);
      const n2 = n - n1, s0 = (n1 - 1) * g;
      const tmin = -L / 2 - jour - L, tmax = L / 2;
      const bords: MarcheLocale["bords"] = [
        { a: { s: s0, t: tmax }, b: { s: s0 + L, t: tmax }, cote: "d" },
        { a: { s: s0 + L, t: tmax }, b: { s: s0 + L, t: tmin }, cote: "d" },
        { a: { s: s0 + L, t: tmin }, b: { s: s0, t: tmin }, cote: "d" },
      ];
      if (jour > 0) bords.push({ a: { s: s0, t: -L / 2 }, b: { s: s0, t: -L / 2 - jour }, cote: "g" });
      const palier: MarcheLocale = {
        poly: [{ s: s0, t: tmin }, { s: s0 + L, t: tmin }, { s: s0 + L, t: tmax }, { s: s0, t: tmax }], idx: n1, type: "palier",
        entree: [{ s: s0, t: -L / 2 }, { s: s0, t: L / 2 }], bords, axe: U,
      };
      const P2: P = { s: s0, t: -L / 2 - jour - L / 2 };
      return { marches: [...volee({ s: 0, t: 0 }, U, n1 - 1, 0), palier, ...volee(P2, V, n2 - 1, n1)], finRiser: finDeVolee(P2, V, n2 - 1), dirSortie: V };
    }

    case "helicoidal": {
      const R = Math.max(50, (e.diametre ?? DIAMETRE_HELICE_DEFAUT_CM) / 2);
      const r0 = clamp((e.diametrePoteau ?? DIAMETRE_POTEAU_DEFAUT_CM) / 2, 2, R - 25);
      // Giron mesuré sur la ligne de foulée. Par défaut : UN tour complet pour monter (les marches ne se superposent pas,
      // l'échappée est conservée) ; si le giron est imposé, l'hélice peut faire plus (ou moins) d'un tour.
      const rf = (R + r0) / 2, delta = e.giron && e.giron > 5 ? e.giron / rf : (2 * Math.PI) / n;
      const pt = (r: number, phi: number): P => ({ s: -r * Math.cos(phi), t: r * Math.sin(phi) });
      const marches: MarcheLocale[] = [];
      for (let i = 1; i <= n - 1; i++) {
        const pa = (i - 1) * delta, pb = i * delta, m = Math.max(1, Math.ceil((delta * 180 / Math.PI) / 10));
        const arc = (r: number, a: number, b: number) => Array.from({ length: m + 1 }, (_, k) => pt(r, a + (b - a) * (k / m)));
        const interieur = arc(r0, pa, pb), exterieur = arc(R, pa, pb);
        const bords: MarcheLocale["bords"] = [];
        for (let k = 0; k < m; k++) { bords.push({ a: exterieur[k], b: exterieur[k + 1], cote: "d" }); bords.push({ a: interieur[k], b: interieur[k + 1], cote: "g" }); }
        const phiM = (pa + pb) / 2;
        marches.push({ poly: [...interieur, ...exterieur.slice().reverse()], idx: i, type: "marche", entree: [pt(r0, pa), pt(R, pa)], bords, axe: { s: -Math.cos(phiM), t: Math.sin(phiM) } });
      }
      const pf = (n - 1) * delta;
      return {
        marches, finRiser: [pt(r0, pf), pt(R, pf)], dirSortie: { s: Math.sin(pf), t: Math.cos(pf) }, poteau: { rayon: r0 }, rayonTremie: R,
        giron: delta * rf, tours: pf / (2 * Math.PI), marchesParTour: (2 * Math.PI) / delta,
      };
    }

    case "droit":
    default: {
      const U: P = { s: 1, t: 0 };
      return { marches: volee({ s: 0, t: 0 }, U, n - 1, 0), finRiser: finDeVolee({ s: 0, t: 0 }, U, n - 1), dirSortie: U };
    }
  }
}

const miroir = (p: P): P => ({ s: p.s, t: -p.t });

// ─── Calcul complet ─────────────────────────────────────────────────────────────────────────────────────
export function calculerEscalier(e: Escalier, hauteurTotaleCm: number): CalculEscalier {
  const dim = dimensionner(e, hauteurTotaleCm);
  const { H, n, h, g: gParam, L } = dim;
  let loc = genererLocal(e, n, gParam, L, dim.n1);
  const g = loc.giron ?? gParam;
  if (e.sens === "droite" && e.type !== "droit") {
    loc = {
      ...loc,
      marches: loc.marches.map(m => ({
        ...m, poly: m.poly.map(miroir), entree: [miroir(m.entree[0]), miroir(m.entree[1])], axe: miroir(m.axe),
        bords: m.bords.map(b => ({ a: miroir(b.a), b: miroir(b.b), cote: b.cote === "g" ? "d" : "g" })),
      })),
      finRiser: [miroir(loc.finRiser[0]), miroir(loc.finRiser[1])], dirSortie: miroir(loc.dirSortie),
    };
  }

  const th = (e.rotation || 0) * Math.PI / 180;
  const f = { x: Math.sin(th), y: -Math.cos(th) }, r = { x: Math.cos(th), y: Math.sin(th) };
  const monde = (p: P): Point => ({ x: e.x + (p.s * f.x + p.t * r.x) / 100, y: e.y + (p.s * f.y + p.t * r.y) / 100 });
  const vecteur = (p: P): Point => ({ x: p.s * f.x + p.t * r.x, y: p.s * f.y + p.t * r.y });

  const marches: MarcheCalc[] = loc.marches.map(m => ({
    poly: m.poly.map(monde), z: m.idx * h / 100, zPrec: (m.idx - 1) * h / 100, type: m.type,
    entree: [monde(m.entree[0]), monde(m.entree[1])],
    bords: m.bords.map(b => ({ a: monde(b.a), b: monde(b.b), cote: b.cote })),
    axe: vecteur(m.axe),
  }));

  // Trémie : marches dont l'échappée sous le plancher du niveau desservi est insuffisante.
  const ep = e.epaisseurPlancher ?? EPAISSEUR_PLANCHER_DEFAUT_CM, hp = e.hauteurPassage ?? HAUTEUR_PASSAGE_DEFAUT_CM, jeu = e.jeuTremie ?? 0;
  let zone = loc.marches.filter(m => m.idx * h > H - ep - hp);
  if (zone.length === 0) zone = loc.marches.slice(-1);
  let tremieLocale: P[];
  if (loc.rayonTremie) {
    const R = loc.rayonTremie + jeu;
    tremieLocale = Array.from({ length: 32 }, (_, k) => ({ s: R * Math.cos(2 * Math.PI * k / 32), t: R * Math.sin(2 * Math.PI * k / 32) }));
  } else {
    const pts = zone.flatMap(m => m.poly);
    let smin = Math.min(...pts.map(p => p.s)) - jeu, smax = Math.max(...pts.map(p => p.s)) + jeu;
    let tmin = Math.min(...pts.map(p => p.t)) - jeu, tmax = Math.max(...pts.map(p => p.t)) + jeu;
    const d = loc.dirSortie;     // pas de marge côté sortie : le plancher commence à la dernière contremarche
    if (Math.abs(d.s) > 0.5) { if (d.s > 0) smax -= jeu; else smin += jeu; } else { if (d.t > 0) tmax -= jeu; else tmin += jeu; }
    tremieLocale = [{ s: smin, t: tmin }, { s: smax, t: tmin }, { s: smax, t: tmax }, { s: smin, t: tmax }];
  }
  const tremie = tremieLocale.map(monde);

  const tousPts = [...marches.flatMap(m => m.poly), ...tremie];
  const emprise = {
    minX: Math.min(...tousPts.map(p => p.x)), minY: Math.min(...tousPts.map(p => p.y)),
    maxX: Math.max(...tousPts.map(p => p.x)), maxY: Math.max(...tousPts.map(p => p.y)),
  };

  // Encombrement obtenu et dimensions de la trémie (repère local : sens de la montée × travers).
  const etendue = (pts: P[]) => ({
    longueur: Math.round(Math.max(...pts.map(p => p.s)) - Math.min(...pts.map(p => p.s))),
    largeur: Math.round(Math.max(...pts.map(p => p.t)) - Math.min(...pts.map(p => p.t))),
  });
  const empriseCm = etendue(loc.marches.flatMap(m => m.poly));
  const tremieCm = etendue(tremieLocale);
  const emmarchementCm = loc.rayonTremie ? Math.round(loc.rayonTremie - (loc.poteau?.rayon ?? 0)) : Math.round(L);

  // Contrôles de confort et de sécurité.
  const blondel = Math.round((2 * h + g) * 10) / 10;
  const avertissements: string[] = [];
  if (blondel < 60 || blondel > 66) avertissements.push(`Confort : 2h + g = ${blondel} cm (idéal entre 60 et 66).`);
  if (h > 20) avertissements.push(`Marches trop hautes : ${h.toFixed(1)} cm (maximum conseillé 20 cm).`);
  if (g < 21) avertissements.push(`Giron trop court : ${g.toFixed(1)} cm (minimum conseillé 21 cm).`);
  if (e.type !== "helicoidal" && L < 70) avertissements.push(`Emmarchement étroit : ${Math.round(L)} cm (minimum conseillé 70 cm, 80 cm en habitation).`);
  if (e.type === "helicoidal" && (e.diametre ?? DIAMETRE_HELICE_DEFAUT_CM) < 120) avertissements.push(`Diamètre faible : ${e.diametre} cm (minimum conseillé 120 cm).`);
  if (e.type === "helicoidal") {
    const R = (e.diametre ?? DIAMETRE_HELICE_DEFAUT_CM) / 2, r0 = clamp((e.diametrePoteau ?? DIAMETRE_POTEAU_DEFAUT_CM) / 2, 2, R - 25);
    const l = (R - r0);
    if (l < 55) avertissements.push(`Emmarchement utile de ${Math.round(l)} cm seulement (diamètre − poteau).`);
  }
  if (loc.tours && loc.marchesParTour && loc.tours > 1.001) {
    const separation = Math.round(loc.marchesParTour * h);
    if (separation < hp) avertissements.push(`Hélice de ${loc.tours.toFixed(2)} tours : échappée de ${separation} cm entre deux tours (minimum ${hp} cm) — augmente le diamètre ou réduis le giron.`);
  }
  if (e.longueurHorsTout && e.type !== "helicoidal" && Math.abs(empriseCm.longueur - e.longueurHorsTout) > 2)
    avertissements.push(`Longueur demandée ${Math.round(e.longueurHorsTout)} cm : emprise obtenue ${empriseCm.longueur} cm (nombre de marches, giron ou volée imposés).`);
  if (e.largeurHorsTout && (e.type === "quart_tournant" || e.type === "demi_tournant") && Math.abs(empriseCm.largeur - e.largeurHorsTout) > 2)
    avertissements.push(`Largeur demandée ${Math.round(e.largeurHorsTout)} cm : emprise obtenue ${empriseCm.largeur} cm (nombre de marches, giron ou volée imposés).`);
  if (loc.marches.length > 0 && marches.length !== n - 1) avertissements.push("Nombre de marches ajusté pour que le virage tienne dans la hauteur.");

  return {
    hauteurTotale: H, nbMarches: n, hMarche: h, giron: g, blondel, pente: Math.atan(h / g) * 180 / Math.PI,
    marches,
    finRiser: { a: monde(loc.finRiser[0]), b: monde(loc.finRiser[1]), zBas: (n - 1) * h / 100, zHaut: H / 100 },
    tremie, tremieZone: zone.length,
    poteau: loc.poteau ? { centre: { x: e.x, y: e.y }, rayon: loc.poteau.rayon / 100 } : undefined,
    emprise, empriseCm, tremieCm, emmarchementCm, avertissements,
  };
}

// ─── Niveaux ────────────────────────────────────────────────────────────────────────────────────────────
// Niveau desservi par défaut : le niveau de la maison immédiatement au-dessus (ordre croissant) ; aucune pour une annexe.
export function niveauSuivantId(niveaux: Niveau[], source: Niveau): number | undefined {
  if (estAnnexe(source)) return undefined;
  const suivants = niveaux.filter(n => !estAnnexe(n) && n.id !== source.id && n.ordre > source.ordre).sort((a, b) => a.ordre - b.ordre);
  return suivants[0]?.id;
}

export function nouvelEscalier(type: EscalierType, x: number, y: number, source: Niveau, niveaux: Niveau[], tournant?: EscalierTournant): Escalier {
  return {
    id: uidMaison(), type, x, y, rotation: 0, niveauDestId: niveauSuivantId(niveaux, source),
    largeur: 90, epaisseurPlancher: EPAISSEUR_PLANCHER_DEFAUT_CM, sens: "gauche",
    ...(type === "quart_tournant" || type === "demi_tournant" ? { tournant: tournant ?? "palier" } : {}),
    ...(type === "helicoidal" ? { diametre: DIAMETRE_HELICE_DEFAUT_CM, diametrePoteau: DIAMETRE_POTEAU_DEFAUT_CM } : {}),
    structure: type === "helicoidal" ? "poteau_central" : "limons_lateraux",
    rampe: "droite", contremarches: true, materiau: "bois",
  };
}

export interface EscalierEntrant { escalier: Escalier; source: Niveau; calcul: CalculEscalier; }

// Escaliers des AUTRES niveaux qui arrivent sur le niveau donné (leur trémie est à percer ici).
export function escaliersEntrants(niveaux: Niveau[], niveauId: number): EscalierEntrant[] {
  return niveaux.flatMap(source => (source.id === niveauId ? [] : (source.escaliers ?? []))
    .filter(e => e.niveauDestId === niveauId)
    .map(e => ({ escalier: e, source, calcul: calculerEscalier(e, hauteurTotaleEscalierCm(e, source)) })));
}
