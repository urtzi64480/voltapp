// src/lib/pose-circuits.ts
//
// Pose d'un circuit, SECTION PAR SECTION. Un circuit part d'un point (tableau, boîte, appareillage), passe par
// des points ajoutés à la main (coudes) et arrive à un autre point : chaque section entre deux points
// consécutifs est soit ENCASTRÉE (défaut — câble sous gaine dans le doublage ou la structure), soit
// APPARENTE (le câble sort du mur : moulure). Un même circuit peut donc être encastré sur une partie de
// son tracé et apparent sur une autre.
//
// Stockage : la pose d'une section est portée par le coude où elle ABOUTIT (LiaisonWaypoint.poseType) ;
// la dernière section (après le dernier coude) par Niveau.poseFinLiaison[cle]. Pré-devis, plan 2D,
// impression et vue 3D lisent tous ici : une section apparente = de la moulure partout.

import {
  AppareillagePlace, LiaisonWaypoint, Niveau, PoseTroncon, SegmentCircuit, cleSegmentLiaison, origineCircuits,
} from "@/lib/maison-types";
import { ResultatGeneration, segmentsPourCircuit } from "@/lib/maison-engine";
import { hauteurCourseSection } from "@/lib/chemin-3d";
import { hauteurAppareilM } from "@/lib/murs";
import type { Breaker } from "@/lib/electrical-constants";

// ─── HAUTEUR DE COURSE PAR DÉFAUT D'UNE LIAISON ────────────────────────────────────────────
// Un circuit de prises (comme tout circuit autre que l'éclairage) est une CHAÎNE : tableau → 1re prise → 2e prise…
// Le câble arrive du tableau à la hauteur de gaine, descend à la 1re prise, puis les prises se relient ENTRE ELLES
// à plat, à la hauteur de la 1re prise — il ne remonte pas à la hauteur de gaine à chaque prise. Un éclairage reste
// en étoile à la hauteur de gaine (boîte de dérivation au plafond). Les hauteurs réglées à la main (section,
// coude) priment toujours (voir hauteurCourseSection, chemin-3d.ts). Source unique, partagée par la vue 3D
// (tracé du câble) et la pose apparente (hauteur de goulotte) pour que câble et goulotte coïncident.
// N'influe PAS sur les longueurs : toutes les longueurs (pré-devis, plan, impression) sont mesurées sur le plan 2D.
const estAncreAppareillage = (id: string): boolean => id !== "tableau" && id !== "boite" && !id.startsWith("boite-");

// Première ancre appareillage du tracé : celle qui suit le tableau, ou (circuit non relié au tableau) la 1re du tracé.
export function premierAppareillageChaine(segments: SegmentCircuit[]): string | null {
  const depuisTableau = segments.find(s => s.aId === "tableau" && estAncreAppareillage(s.bId));
  if (depuisTableau) return depuisTableau.bId;
  const premier = segments.find(s => estAncreAppareillage(s.aId));
  return premier ? premier.aId : null;
}

// Renvoie, pour un circuit, la hauteur de course par défaut (m) de chacune de ses liaisons.
// hauteurAncre : hauteur (m) de raccordement d'une ancre (appareillage), telle que dessinée.
export function hauteurDefautLiaison(
  breaker: Pick<Breaker, "circuit">, segments: SegmentCircuit[], hauteurAncre: (id: string) => number, hauteurGaine: number,
): (seg: SegmentCircuit) => number {
  if (breaker.circuit === "lumiere") return () => hauteurGaine;
  const premier = premierAppareillageChaine(segments);
  if (premier == null) return () => hauteurGaine;
  const hChaine = hauteurAncre(premier);
  return seg => (estAncreAppareillage(seg.aId) && estAncreAppareillage(seg.bId)) ? hChaine : hauteurGaine;
}

// Pose de chacune des (coudes + 1) sections d'une liaison, dans l'ordre du tracé.
export function posesTroncons(niveau: Niveau, cle: string, coudes: LiaisonWaypoint[]): PoseTroncon[] {
  const poses: PoseTroncon[] = coudes.map(c => c.poseType ?? "encastre");
  poses.push(niveau.poseFinLiaison?.[cle] ?? "encastre");
  return poses;
}

// Hauteur (cm) de chacune des (coudes + 1) sections, ou undefined = non réglée (le câble court alors à la hauteur du coude, sinon à la hauteur de gaine par défaut).
export function hauteursTroncons(niveau: Niveau, cle: string, coudes: LiaisonWaypoint[]): (number | undefined)[] {
  const h: (number | undefined)[] = coudes.map(c => c.hauteurSection);
  h.push(niveau.hauteurFinLiaison?.[cle]);
  return h;
}

// Appareillages dont la section de circuit qui les touche est apparente : ils sont alors montés en saillie, avec
// goulotte (vue 3D). Renvoie, pour chacun, la hauteur (m) jusqu'où monte la goulotte = hauteur de course de cette
// section (la même que celle du câble tracé), pour que boîtier, goulotte et câble coïncident.
export function appareillagesEnPoseApparente(
  niveau: Niveau, appareils: AppareillagePlace[], resultat: ResultatGeneration | null, hauteurGaine: number,
): Map<number, number> {
  const res = new Map<number, number>();
  const origine = origineCircuits(niveau);
  if (!resultat || !origine) return res;
  const parCircuit = new Map<number, AppareillagePlace[]>();
  appareils.forEach(a => {
    if (a.circuitId == null) return;
    parCircuit.set(a.circuitId, [...(parCircuit.get(a.circuitId) ?? []), a]);
  });
  const ids = new Set(appareils.map(a => String(a.id)));
  const parId = new Map(appareils.map(a => [String(a.id), a] as const));
  const hauteurAncre = (id: string): number => { const a = parId.get(id); return a ? hauteurAppareilM(a) : hauteurGaine; };
  parCircuit.forEach((points, circuitId) => {
    const breaker = resultat.breakers.find(b => b.id === circuitId);
    if (!breaker) return;
    const segmentsCircuit = segmentsPourCircuit(breaker, points, niveau, origine);
    const hauteurDefaut = hauteurDefautLiaison(breaker, segmentsCircuit, hauteurAncre, hauteurGaine);
    segmentsCircuit.forEach(seg => {
      if (seg.type === "domotique") return; // liaison sans fil : aucune goulotte
      const cle = cleSegmentLiaison(seg.aId, seg.bId);
      const coudes = niveau.liaisonWaypoints?.[cle] ?? [];
      const poses = posesTroncons(niveau, cle, coudes);
      const hauteurs = hauteursTroncons(niveau, cle, coudes);
      const entrees = coudes.map(c => ({ point: c.point, hauteurCm: c.hauteur }));
      if (poses[0] === "apparent" && ids.has(seg.aId)) {
        res.set(Number(seg.aId), Math.max(res.get(Number(seg.aId)) ?? 0, hauteurCourseSection(0, entrees, hauteurs, hauteurDefaut(seg))));
      }
      const dernier = poses.length - 1;
      if (poses[dernier] === "apparent" && ids.has(seg.bId)) {
        res.set(Number(seg.bId), Math.max(res.get(Number(seg.bId)) ?? 0, hauteurCourseSection(dernier, entrees, hauteurs, hauteurDefaut(seg))));
      }
    });
  });
  return res;
}
