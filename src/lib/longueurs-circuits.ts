// src/lib/longueurs-circuits.ts
//
// LONGUEUR RÉELLE des câbles d'un circuit : horizontale (distance sur le plan) + TOUTES les montées et descentes.
// Module PUR (aucune dépendance à three / React), source unique pour :
//   - le pré-devis (predevis-engine.ts : câble, gaine, moulure — par pièce et par pose) ;
//   - les étiquettes de longueur du plan 2D et de l'impression, la légende des circuits, le total par circuit.
//
// Le tracé est EXACTEMENT celui de la vue 3D (lib/chemin-3d.ts : construireChemin3D), avec les mêmes hauteurs :
//   - ancre « tableau » : hauteur du tableau (Niveau.tableauHauteur, 1,50 m par défaut) ; si un point d'arrivée des
//     gaines est configuré, le tracé visible part de CE point (à la hauteur de gaine) — le tronçon tableau → point
//     d'arrivée reste couvert, une seule fois par circuit, par Niveau.distanceArriveeGainesTableau (predevis-engine.ts) ;
//   - boîte de dérivation et point lumineux de plafond : hauteur de gaine ; autres appareillages : leur hauteur
//     d'installation (saisie, sinon valeur par défaut du type — voir hauteurAppareilM) ;
//   - course d'une section : hauteur réglée (section / coude) > hauteur de gaine, sauf prises-chaîne (voir
//     hauteurDefautLiaison, pose-circuits.ts : les prises d'un circuit se relient à plat à la hauteur de la 1re).
//
// Hypothèses de modélisation (assumées, à lire avant de comparer à un relevé sur chantier) :
//  - Mesure « face à face » sur le plan : le décrochement dans l'épaisseur du mur d'un câble encastré (couche 2 du
//    doublage, quelques cm par extrémité) n'est PAS compté — la vue 3D le dessine, mais l'ajouter déplacerait le
//    câble hors du polygone de sa pièce et fausserait la répartition par pièce.
//  - Le volet roulant est raccordé à sa hauteur d'installation par défaut (2,15 m), pas au moteur exact du modèle 3D.
//  - Une liaison domotique (sans fil) ne consomme aucun câble : elle est exclue (le pré-devis l'excluait déjà).

import {
  AppareillagePlace, Niveau, Piece, Point, PoseTroncon, SegmentCircuit, cleSegmentLiaison, trouverPiece, estLumierePlafond,
} from "@/lib/maison-types";
import type { Breaker } from "@/lib/electrical-constants";
import { segmentsPourCircuit } from "@/lib/maison-engine";
import { construireChemin3D, hauteurCourseSection, hauteurGaineNiveau, Jambe3D } from "@/lib/chemin-3d";
import { hauteurDefautLiaison, hauteursTroncons, posesTroncons } from "@/lib/pose-circuits";
import { hauteurAppareilM } from "@/lib/murs";

export const HAUTEUR_TABLEAU_DEFAUT = 1.5; // m — tableau électrique posé à 1,50 m si aucune hauteur n'est saisie

export interface ContexteLongueurs {
  niveau: Niveau;
  hauteurGaine: number;     // m — hauteur de course par défaut (sous le plafond le plus bas du niveau)
  hauteurTableau: number;   // m — hauteur du tableau / coffret de communication
  hauteurOrigine: number;   // m — hauteur de l'ancre « tableau » du tracé (tableau, ou gaine si point d'arrivée configuré)
}

export function creerContexteLongueurs(niveau: Niveau): ContexteLongueurs {
  const hauteurGaine = hauteurGaineNiveau(niveau.hauteurPlafond ?? 2.5, niveau.pieces.map(p => p.hauteurPlafond));
  const hauteurTableau = niveau.tableauHauteur != null ? niveau.tableauHauteur / 100 : HAUTEUR_TABLEAU_DEFAUT;
  return { niveau, hauteurGaine, hauteurTableau, hauteurOrigine: niveau.pointArriveeGaines ? hauteurGaine : hauteurTableau };
}

// Hauteur (m) de raccordement d'une ancre de circuit (id de tracé : "tableau", "boite", "boite-N" ou id d'appareillage).
export function hauteurAncreFn(ctx: ContexteLongueurs): (id: string) => number {
  const parId = new Map<string, AppareillagePlace>();
  ctx.niveau.pieces.forEach(p => p.appareillages.forEach(a => parId.set(String(a.id), a)));
  return id => {
    if (id === "tableau") return ctx.hauteurOrigine;
    if (id === "boite" || id.startsWith("boite-")) return ctx.hauteurGaine;
    const a = parId.get(id);
    if (!a) return 1.0;
    if (estLumierePlafond(a.type)) return Math.min(a.hauteur != null ? a.hauteur / 100 : Infinity, ctx.hauteurGaine);
    return hauteurAppareilM(a);
  };
}

export interface TraceLiaison {
  jambes: Jambe3D[];       // tubes rectilignes du tracé (même que la vue 3D) — chacun avec sa pose
  sections: number[];      // longueur 3D de chaque section (coudes + 1) : horizontale + montée de départ (+ descente finale pour la dernière)
}

// Trace 3D d'UNE liaison. `segments` = tous les segments du circuit (la règle « prises en chaîne » en a besoin).
export function tracerLiaison(
  ctx: ContexteLongueurs, breaker: Pick<Breaker, "circuit">, segments: SegmentCircuit[], seg: SegmentCircuit,
  hauteurAncre: (id: string) => number = hauteurAncreFn(ctx),
): TraceLiaison {
  const niveau = ctx.niveau;
  const cle = cleSegmentLiaison(seg.aId, seg.bId);
  const coudes = niveau.liaisonWaypoints?.[cle] ?? [];
  const poses = posesTroncons(niveau, cle, coudes);
  const hauteurs = hauteursTroncons(niveau, cle, coudes);
  const hDefaut = hauteurDefautLiaison(breaker, segments, hauteurAncre, ctx.hauteurGaine)(seg);
  const entreesCoudes = coudes.map(c => ({ point: c.point, hauteurCm: c.hauteur }));
  const depart = { x: seg.aPoint.x, y: hauteurAncre(seg.aId), z: seg.aPoint.y };
  const arrivee = { x: seg.bPoint.x, y: hauteurAncre(seg.bId), z: seg.bPoint.y };
  const jambes = construireChemin3D({ depart, arrivee, coudes: entreesCoudes, poses, hauteursSection: hauteurs, hauteurGaine: hDefaut });

  const plan: Point[] = [seg.aPoint, ...coudes.map(c => c.point), seg.bPoint];
  const sections: number[] = [];
  let hCourante = depart.y;
  for (let j = 0; j < plan.length - 1; j++) {
    const H = hauteurCourseSection(j, entreesCoudes, hauteurs, hDefaut);
    sections.push(Math.hypot(plan[j + 1].x - plan[j].x, plan[j + 1].y - plan[j].y) + Math.abs(H - hCourante));
    hCourante = H;
  }
  if (sections.length > 0) sections[sections.length - 1] += Math.abs(arrivee.y - hCourante);
  return { jambes, sections };
}

export const longueurJambe = (j: Jambe3D): number => Math.hypot(j.b.x - j.a.x, j.b.y - j.a.y, j.b.z - j.a.z);
export const estVerticale = (j: Jambe3D): boolean => Math.hypot(j.b.x - j.a.x, j.b.z - j.a.z) < 1e-6 && Math.abs(j.b.y - j.a.y) > 1e-6;

export interface LongueurCircuit { totale: number; horizontale: number; verticale: number }

// Longueur réelle d'un circuit : somme des liaisons filaires (les liaisons domotiques, sans fil, sont exclues).
export function longueurCircuit(
  ctx: ContexteLongueurs, breaker: Pick<Breaker, "circuit"> & Partial<Breaker>, points: AppareillagePlace[], origine: Point,
): LongueurCircuit {
  const segments = segmentsPourCircuit(breaker as Breaker, points, ctx.niveau, origine);
  const hauteurAncre = hauteurAncreFn(ctx);
  let horizontale = 0, verticale = 0;
  segments.forEach(seg => {
    if (seg.type === "domotique") return;
    tracerLiaison(ctx, breaker, segments, seg, hauteurAncre).jambes.forEach(j => {
      const h = Math.hypot(j.b.x - j.a.x, j.b.z - j.a.z);
      horizontale += h; verticale += Math.abs(j.b.y - j.a.y);
    });
  });
  return { totale: horizontale + verticale, horizontale, verticale };
}

// Pièce à laquelle attribuer une jambe (répartition des longueurs par pièce au pré-devis).
//  - horizontale : pièce du point médian (comportement historique) ;
//  - verticale à une extrémité : pièce de l'appareillage raccordé (un point sur l'axe d'un mur est ambigu) ;
//  - autre verticale : pièce du point, sinon null (pseudo-pièce « Commun »).
export function pieceDeJambe(
  j: Jambe3D, seg: SegmentCircuit, pieceDeAppareil: Map<string, Piece>, pieces: Piece[],
): Piece | null {
  if (estVerticale(j)) {
    if (j.extremite) {
      const p = pieceDeAppareil.get(j.extremite === "depart" ? seg.aId : seg.bId);
      if (p) return p;
    }
    return trouverPiece({ x: j.a.x, y: j.a.z }, pieces);
  }
  return trouverPiece({ x: (j.a.x + j.b.x) / 2, y: (j.a.z + j.b.z) / 2 }, pieces);
}

export function indexPiecesAppareils(niveau: Niveau): Map<string, Piece> {
  const m = new Map<string, Piece>();
  niveau.pieces.forEach(p => p.appareillages.forEach(a => m.set(String(a.id), p)));
  return m;
}

export type { PoseTroncon };
