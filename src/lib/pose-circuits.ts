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
  AppareillagePlace, LiaisonWaypoint, Niveau, PoseTroncon, cleSegmentLiaison, origineCircuits,
} from "@/lib/maison-types";
import { ResultatGeneration, segmentsPourCircuit } from "@/lib/maison-engine";

// Pose de chacune des (coudes + 1) sections d'une liaison, dans l'ordre du tracé.
export function posesTroncons(niveau: Niveau, cle: string, coudes: LiaisonWaypoint[]): PoseTroncon[] {
  const poses: PoseTroncon[] = coudes.map(c => c.poseType ?? "encastre");
  poses.push(niveau.poseFinLiaison?.[cle] ?? "encastre");
  return poses;
}

// Hauteur (cm) de chacune des (coudes + 1) sections, ou undefined = non réglée (pente directe entre les points).
export function hauteursTroncons(niveau: Niveau, cle: string, coudes: LiaisonWaypoint[]): (number | undefined)[] {
  const h: (number | undefined)[] = coudes.map(c => c.hauteurSection);
  h.push(niveau.hauteurFinLiaison?.[cle]);
  return h;
}

// Ids des appareillages dont la section de circuit qui les touche est apparente : ils sont alors montés
// en saillie, avec goulotte (vue 3D).
export function appareillagesEnPoseApparente(
  niveau: Niveau, appareils: AppareillagePlace[], resultat: ResultatGeneration | null,
): Set<number> {
  const res = new Set<number>();
  const origine = origineCircuits(niveau);
  if (!resultat || !origine) return res;
  const parCircuit = new Map<number, AppareillagePlace[]>();
  appareils.forEach(a => {
    if (a.circuitId == null) return;
    parCircuit.set(a.circuitId, [...(parCircuit.get(a.circuitId) ?? []), a]);
  });
  const ids = new Set(appareils.map(a => String(a.id)));
  parCircuit.forEach((points, circuitId) => {
    const breaker = resultat.breakers.find(b => b.id === circuitId);
    if (!breaker) return;
    segmentsPourCircuit(breaker, points, niveau, origine).forEach(seg => {
      const cle = cleSegmentLiaison(seg.aId, seg.bId);
      const poses = posesTroncons(niveau, cle, niveau.liaisonWaypoints?.[cle] ?? []);
      if (poses[0] === "apparent" && ids.has(seg.aId)) res.add(Number(seg.aId));
      if (poses[poses.length - 1] === "apparent" && ids.has(seg.bId)) res.add(Number(seg.bId));
    });
  });
  return res;
}
