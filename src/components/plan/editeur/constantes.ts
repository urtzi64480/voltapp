// Extrait mécaniquement de src/app/plan/[clientId]/page.tsx (aucun changement de comportement).
import { Point, distance } from "@/lib/maison-types";
import { CIRCUITS } from "@/lib/electrical-constants";

export const PX_PER_M = 60;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

// Accroche grille + alignement (façon logiciel de dessin vectoriel) : un point saisi
// s'arrondit à la grille fine (10cm) par défaut, et s'aligne exactement sur un sommet
// existant proche (mur voisin, autre pièce) quand l'aimant est activé (désactivé par défaut) ;
// la grille est au centimètre par défaut (réglable 1 / 5 / 10 cm dans la barre d'outils).
export const ALIGN_THRESHOLD_PX = 8;
// Aimantation d'un appareillage sur le mur le plus proche de sa pièce (px écran, indépendant du zoom).
// Maintenir Alt pendant le geste la désactive pour poser un appareillage au milieu d'une pièce.
export const SNAP_MUR_PX = 22;
// Distance de détection (px écran) pour "clique près d'un mur" lors du placement
// d'une porte/fenêtre — plus généreux que l'accroche fine, un mur est fin à l'écran.
export const SEUIL_MUR_PX = 18;
// Outil cloison : distance (px écran) à un mur en deçà de laquelle un clic est pris pour un départ / une fin sur ce mur.
export const CLOISON_SEUIL_PX = 12;

// Types de circuit proposés pour un circuit manuel — tout CIRCUITS sauf les entrées qui ne
// correspondent pas à un vrai circuit posé sur le plan (arrivée générale, parafoudre) et
// l'ancienne clé "chauffage" (un seul radiateur, historique) remplacée par chauffage_16/20.
export const CIRCUIT_KEYS_MANUELS = Object.keys(CIRCUITS).filter(k => !["general", "parafoudre", "chauffage", "coupure_generale", "prise_modulaire"].includes(k));

// Réglage de précision du plan (modifiable dans la barre d'outils) : pas de la grille au centimètre par défaut,
// aimantation aux sommets des autres pièces désactivée par défaut, Alt = désactivation momentanée.
// Variable de module : lue au moment du geste par tous les outils (dessin, sommets, déplacements…).
export const reglageAimant = { pasM: 0.01, aimant: false, alt: false, murs: true };

// Couleurs de fond proposées pour une pièce sur le plan 2D (pastel).
export const COULEURS_FOND_PIECE: { nom: string; hex: string }[] = [
  { nom: "Rose", hex: "#F9D5DC" },
  { nom: "Bleu", hex: "#CFE5F7" },
  { nom: "Vert", hex: "#D3EFD9" },
  { nom: "Jaune", hex: "#FBF0C0" },
];

// Alignement d'une pièce en cours de déplacement : angles/faces EXTÉRIEURS (tracé hors-tout) ou INTÉRIEURS (face finie,
// selon les épaisseurs de murs) de la pièce déplacée comparés à ceux des autres pièces.
export type FaceKind = "ext" | "int";
export const NOM_FACE: Record<FaceKind, string> = { ext: "extérieur", int: "intérieur" };
export type AlignInfo = {
  x?: { pos: number; ecartCm: number; kM: FaceKind; kO: FaceKind };
  y?: { pos: number; ecartCm: number; kM: FaceKind; kO: FaceKind };
  mur?: { a: Point; dir: Point; ecartCm: number; kM: FaceKind; kO: FaceKind };
  coin?: { m: Point; o: Point; dxCm: number; dyCm: number; kM: FaceKind; kO: FaceKind };
};
