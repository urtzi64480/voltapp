"use client";

import type { ReactNode } from "react";
import { useState, useRef, useCallback, useEffect, useMemo, Fragment } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Client, Projet } from "@/types";
import Shell from "@/components/layout/Shell";
import { useProjets, qsProjet, modifierProjet, sauverTableau, sauverAnnexes, synchroniserAnnexes, lireAnnexes, nouvelIdAnnexe, TABLEAU_PRINCIPAL, TableauAnnexe } from "@/lib/projets";
import ProjetSwitcher from "@/components/projets/ProjetSwitcher";
import ConfirmDialog from "@/components/ConfirmDialog";
import Link from "next/link";
import {
  ArrowLeft, Save, Printer, Plus, Trash2, Pencil, ZoomIn, ZoomOut, MousePointer2, X,
  Zap, Sparkles, Eye, EyeOff, ArrowRightCircle, AlertTriangle, Search, Route,
  GripHorizontal, ChevronUp, ChevronDown, ArrowDownToLine, Link2, Receipt, Box,
  Lock, Unlock, Maximize2, Minimize2, ChevronLeft, ChevronRight, PanelTopClose, PanelTopOpen, SplitSquareHorizontal, BoxSelect, Undo2, Redo2,
} from "lucide-react";
import {
  Point, Piece, Niveau, PieceType, NiveauType, AppareillagePlace, AppareillageType,
  MurSpec, MUR_DEFAUT, PRESETS_MUR,
  Ouverture, OuvertureType, UsagePorte, USAGES_PORTE, LABEL_USAGE_PORTE, nouvelleOuverture, hauteurOuvertureDefautCm, positionSurSegment, OuvertureEffective, ouverturesEffectivesMur,
  NIVEAU_TYPES, estAnnexe, origineCircuits, PIECE_TYPES, aireDuPolygone, centroide, trouverPiece, distance,
  distanceAuSegment, positionnerADistanceDuSegment, pointDansPolygone, distanceAuMurLePlusProche,
  CircuitManuel, FamilleCircuitManuel,
  nouveauNiveau, nouvellePiece, nouvelAppareillage, uidMaison, reamorcerCompteurId, dedupliquerIds,
  LiaisonWaypoint, cleSegmentLiaison,
  cheminSegment, longueurBranchesEclairage, centroidePoints, assombrirCouleur, pointsOndulesEntre,
  BoiteDerivation, migrerBoitesDerivation,
  Zone, TypeCoteZone, MeubleSimple, nouveauMeuble, nouvellePersonne, HAUTEUR_PERSONNE_M, nouvelleVoiture, VOITURE_LONGUEUR_M, VOITURE_LARGEUR_M, COULEURS_VOLET, COULEURS_APPAREILLAGE, TYPES_APPAREILLAGE_COLORABLES,
  estCommande, estCommandeDouble, estLumiere, lumieresCommandees, nouvellePlaque, TYPES_POSTE_PLAQUE, TYPES_USAGE_DEDIE, LIBELLE_USAGE_DEDIE, MAX_POSTES_PLAQUE, MIN_POSTES_PLAQUE, USAGE_DEDIE_DEFAUT, PosteSpec, hauteurCommunePlaqueCm, ENTRAXE_POSTE_M, battantsFenetre, nbVantauxBaie, largeurVantailBaieCm, NB_VANTAUX_BAIE_MAX, RECOUVREMENT_VANTAUX_CM,
  Escalier, EscalierType, EscalierTournant,
} from "@/lib/maison-types";
import {
  calculerEscalier, hauteurTotaleEscalierCm, escaliersEntrants as lireEscaliersEntrants, nouvelEscalier,
  LABEL_ESCALIER_TYPE, LABEL_STRUCTURE, LABEL_RAMPE, LABEL_MATERIAU, COULEUR_MATERIAU, DIAMETRE_HELICE_DEFAUT_CM, DIAMETRE_POTEAU_DEFAUT_CM,
} from "@/lib/escaliers";
import { AppareillageSymbol, AppareillageGlyphe, symboleEstOriente, appareillageSymbolSvgString, PALETTE, labelAppareillage, labelAppareillagePlace, initialesAppareillage } from "@/components/plan/AppareillageSymbols";
import { cotesOuvertures, cotesExterieures, coteHorsTout } from "@/lib/cotes-archi";
import { normaliserAngle } from "@/lib/soleil";
import { posesTroncons, hauteursTroncons } from "@/lib/pose-circuits";
import { creerContexteLongueurs, hauteurAncreFn, tracerLiaison, longueurCircuit } from "@/lib/longueurs-circuits";
import { fusionnerPieces, voisinesFusionnables } from "@/lib/fusion-pieces";
import { decalerNiveau } from "@/lib/deplacer-niveau";
import { migrerModeleMurs, aimanterSurFaceMur, preparerMurs, definirMitoyens, mitoyensDe, longueursUtilesCm, geometrieMurs, decoupeOuverture, faceInterieureM, epaisseurTotaleM, surfaceUtile, longueurUtileCm, mursDe, murDe, appliquerMurs, murAfterSuppressionSommet, normaleInterieure } from "@/lib/murs";
import { accrocherSurContour, apercuCloison, appliquerCloison, OptionsCloison, PointAccroche } from "@/lib/cloisons";
import type { CloisonZone } from "@/lib/zones";
import { cotesParDefaut, nouvelleZone, validerTraceZone, surfaceZone, centreEtiquetteZone, cloisonsDeZone, quadCloison, decoupeOuvertureZone, longueurCote, nbCotes, segmentsZone, definirTypeCote, trouverCloisonZone, positionOuvertureValide } from "@/lib/zones";
import { enCm, estRectangle, redimensionnerMur, redimensionnerMurUtile, reporterAppareillages } from "@/lib/dimensions-piece";
import { placerEtiquettePiece, carreAutour, RectPx } from "@/lib/etiquette-piece";
import { disposerPlaque, normaliserPlaques, infosPlaques, InfoPlaque, droiteFaceAuMur, ancrageMurLePlusProche, aimanterSurMur, estMural, TOLERANCE_MUR_M, baieDuVolet, recentrerVolet, cotesAppareillage, filtrerCotesLisibles, geometrieCote, Cote, GeoCote, RepereCotes } from "@/lib/appareillage-mur";
import Vue3D, { Vue3DHandle } from "@/components/plan/Vue3D";
import Vue3DMaison from "@/components/plan/Vue3DMaison";
import { genererCircuits, assemblerTableau, remapperIdsRows, maxIdRows, genererGainesNiveaux, construireColorMap, segmentsPourCircuit, ResultatGeneration, TronconGaine } from "@/lib/maison-engine";
import { CIRCUITS, BreakerRow, Breaker, estCircuitSansDisjoncteur } from "@/lib/electrical-constants";

const PX_PER_M = 60;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

// Accroche grille + alignement (façon logiciel de dessin vectoriel) : un point saisi
// s'arrondit à la grille fine (10cm) par défaut, et s'aligne exactement sur un sommet
// existant proche (mur voisin, autre pièce) quand l'aimant est activé (désactivé par défaut) ;
// la grille est au centimètre par défaut (réglable 1 / 5 / 10 cm dans la barre d'outils).
const ALIGN_THRESHOLD_PX = 8;
// Aimantation d'un appareillage sur le mur le plus proche de sa pièce (px écran, indépendant du zoom).
// Maintenir Alt pendant le geste la désactive pour poser un appareillage au milieu d'une pièce.
const SNAP_MUR_PX = 22;
// Distance de détection (px écran) pour "clique près d'un mur" lors du placement
// d'une porte/fenêtre — plus généreux que l'accroche fine, un mur est fin à l'écran.
const SEUIL_MUR_PX = 18;
// Outil cloison : distance (px écran) à un mur en deçà de laquelle un clic est pris pour un départ / une fin sur ce mur.
const CLOISON_SEUIL_PX = 12;

// Types de circuit proposés pour un circuit manuel — tout CIRCUITS sauf les entrées qui ne
// correspondent pas à un vrai circuit posé sur le plan (arrivée générale, parafoudre) et
// l'ancienne clé "chauffage" (un seul radiateur, historique) remplacée par chauffage_16/20.
const CIRCUIT_KEYS_MANUELS = Object.keys(CIRCUITS).filter(k => !["general", "parafoudre", "chauffage"].includes(k));

// Réglage de précision du plan (modifiable dans la barre d'outils) : pas de la grille au centimètre par défaut,
// aimantation aux sommets des autres pièces désactivée par défaut, Alt = désactivation momentanée.
// Variable de module : lue au moment du geste par tous les outils (dessin, sommets, déplacements…).
const reglageAimant = { pasM: 0.01, aimant: false, alt: false, murs: true };

// Couleurs de fond proposées pour une pièce sur le plan 2D (pastel).
const COULEURS_FOND_PIECE: { nom: string; hex: string }[] = [
  { nom: "Rose", hex: "#F9D5DC" },
  { nom: "Bleu", hex: "#CFE5F7" },
  { nom: "Vert", hex: "#D3EFD9" },
  { nom: "Jaune", hex: "#FBF0C0" },
];

// Alignement d'une pièce en cours de déplacement : angles/faces EXTÉRIEURS (tracé hors-tout) ou INTÉRIEURS (face finie,
// selon les épaisseurs de murs) de la pièce déplacée comparés à ceux des autres pièces.
type FaceKind = "ext" | "int";
const NOM_FACE: Record<FaceKind, string> = { ext: "extérieur", int: "intérieur" };
type AlignInfo = {
  x?: { pos: number; ecartCm: number; kM: FaceKind; kO: FaceKind };
  y?: { pos: number; ecartCm: number; kM: FaceKind; kO: FaceKind };
  mur?: { a: Point; dir: Point; ecartCm: number; kM: FaceKind; kO: FaceKind };
  coin?: { m: Point; o: Point; dxCm: number; dyCm: number; kM: FaceKind; kO: FaceKind };
};

// ─── Alignement automatique des segments sur les murs adjacents ──────────────────────────────────────
// Un sommet qu'on crée ou qu'on déplace s'aligne sur : l'horizontale / la verticale, la parallèle ou la perpendiculaire
// d'un mur voisin (pour chacun des segments qui l'entourent), ou le prolongement d'un mur voisin. Deux contraintes
// compatibles se combinent (le sommet tombe alors à l'intersection exacte).
type SegRef = { a: Point; b: Point };
type ResultatAlignMurs = { point: Point; lignes: { q: Point; d: Point }[]; labels: string[] };
type ContrainteAlign = { q: Point; d: Point; dist: number; label: string };

function segmentsReferenceNiveau(niveau: Niveau | null, pieceId?: number, sommetIndex?: number): SegRef[] {
  if (!niveau) return [];
  const res: SegRef[] = [];
  niveau.pieces.forEach(pc => {
    const n = pc.contour.length;
    pc.contour.forEach((a, i) => {
      if (pc.id === pieceId && sommetIndex !== undefined && (i === sommetIndex || (i + 1) % n === sommetIndex)) return;
      res.push({ a, b: pc.contour[(i + 1) % n] });
    });
  });
  return res;
}

function alignerSurMurs(pt: Point, voisins: Point[], refs: SegRef[], seuilM: number): ResultatAlignMurs | null {
  const unite = (a: Point, b: Point) => { const L = Math.hypot(b.x - a.x, b.y - a.y); return L < 0.01 ? null : { x: (b.x - a.x) / L, y: (b.y - a.y) / L }; };
  const proches = refs.filter(r => distanceAuSegment(pt, r.a, r.b) <= 3);
  const dirs: { d: Point; label: string }[] = [
    { d: { x: 1, y: 0 }, label: "Segment horizontal" },
    { d: { x: 0, y: 1 }, label: "Segment vertical" },
  ];
  for (const r of proches) {
    const u = unite(r.a, r.b);
    if (!u) continue;
    dirs.push({ d: u, label: "Segment parallèle au mur adjacent" });
    dirs.push({ d: { x: -u.y, y: u.x }, label: "Segment perpendiculaire au mur adjacent" });
  }
  const contraintes: ContrainteAlign[] = [];
  for (const q of voisins) {
    if (Math.hypot(pt.x - q.x, pt.y - q.y) < 0.05) continue;
    let best: ContrainteAlign | null = null;
    for (const { d, label } of dirs) {
      const dist = Math.abs(d.x * (pt.y - q.y) - d.y * (pt.x - q.x));
      if (dist <= seuilM && (!best || dist < best.dist)) best = { q, d, dist, label };
    }
    if (best) contraintes.push(best);
  }
  let colin: ContrainteAlign | null = null;
  for (const r of proches) {
    const u = unite(r.a, r.b);
    if (!u) continue;
    const dist = Math.abs(u.x * (pt.y - r.a.y) - u.y * (pt.x - r.a.x));
    if (dist <= seuilM && (!colin || dist < colin.dist)) colin = { q: r.a, d: u, dist, label: "Point sur le prolongement du mur adjacent" };
  }
  if (colin) contraintes.push(colin);
  if (contraintes.length === 0) return null;
  contraintes.sort((a, b) => a.dist - b.dist);
  const c1 = contraintes[0], c2 = contraintes[1];
  const t1 = (pt.x - c1.q.x) * c1.d.x + (pt.y - c1.q.y) * c1.d.y;
  let point: Point = { x: c1.q.x + c1.d.x * t1, y: c1.q.y + c1.d.y * t1 };
  const lignes = [{ q: c1.q, d: c1.d }];
  const labels = [c1.label];
  if (c2) {
    const cross = c1.d.x * c2.d.y - c1.d.y * c2.d.x;
    if (Math.abs(cross) > 0.05) {
      const t = ((c2.q.x - c1.q.x) * c2.d.y - (c2.q.y - c1.q.y) * c2.d.x) / cross;
      const inter = { x: c1.q.x + c1.d.x * t, y: c1.q.y + c1.d.y * t };
      if (Math.hypot(inter.x - pt.x, inter.y - pt.y) <= seuilM * 2.5) { point = inter; lignes.push({ q: c2.q, d: c2.d }); labels.push(c2.label); }
    }
  }
  return { point: { x: Number(point.x.toFixed(3)), y: Number(point.y.toFixed(3)) }, lignes, labels };
}

function rectangleDepuis(a: Point, b: Point): Point[] {
  return [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
}

function arrondiGrille(v: number, pas: number = reglageAimant.pasM): number {
  return Number((Math.round(v / pas) * pas).toFixed(4));
}

function pointsReferenceNiveau(niveau: Niveau | null, excludePieceId?: number, excludeIndex?: number): Point[] {
  if (!niveau) return [];
  const pts: Point[] = [];
  niveau.pieces.forEach(p => {
    p.contour.forEach((pt, i) => {
      if (p.id === excludePieceId && i === excludeIndex) return;
      pts.push(pt);
    });
  });
  return pts;
}

// Trouve, sur tout le niveau, le mur (segment de contour d'une pièce) le plus proche
// d'un point cliqué — pour placer une porte/fenêtre dessus. `seuilM` en mètres, sinon null.
type MeilleurMur = { piece: Piece; segIndex: number; t: number; d: number };
function trouverMurLePlusProche(pieces: Piece[], pointMonde: Point, seuilM: number): { piece: Piece; segIndex: number; t: number } | null {
  let meilleur: MeilleurMur | null = null;
  pieces.forEach(piece => {
    piece.contour.forEach((a, i) => {
      const b = piece.contour[(i + 1) % piece.contour.length];
      const d = distanceAuSegment(pointMonde, a, b);
      if (!meilleur || d < meilleur.d) meilleur = { piece, segIndex: i, t: positionSurSegment(pointMonde, a, b), d };
    });
  });
  if (!meilleur) return null;
  const m: MeilleurMur = meilleur;
  if (m.d > seuilM) return null;
  return { piece: m.piece, segIndex: m.segIndex, t: m.t };
}

// Recalcule le segIndex d'une ouverture après suppression du sommet `k` (index dans le
// contour AVANT suppression, qui comptait `n` sommets/segments). Le sommet supprimé
// fusionne les deux murs qui s'y rejoignaient (segment k-1, qui se termine sur k, et
// segment k, qui en part) en un seul nouveau mur — toute ouverture posée sur l'un de
// ces deux murs perd son support géométrique d'origine et doit être retirée (null).
// Les autres murs gardent leur géométrie inchangée ; seuls ceux situés après le sommet
// supprimé voient leur index décalé d'un cran vers le bas.
function remapperSegIndexApresSuppressionSommet(segIndex: number, k: number, n: number): number | null {
  const segAvant = (k - 1 + n) % n;
  if (segIndex === segAvant || segIndex === k) return null;
  return segIndex > k ? segIndex - 1 : segIndex;
}

interface ResultatSnap { point: Point; guideX?: number; guideY?: number; }

function snapAvecAlignement(m: Point, candidats: Point[], seuilM: number): ResultatSnap {
  let x = arrondiGrille(m.x);
  let y = arrondiGrille(m.y);
  let guideX: number | undefined;
  let guideY: number | undefined;
  if (!reglageAimant.aimant || reglageAimant.alt) return { point: { x, y } };
  let meilleurDX = seuilM, meilleurDY = seuilM;
  candidats.forEach(c => {
    const dx = Math.abs(c.x - m.x);
    if (dx < meilleurDX) { meilleurDX = dx; x = c.x; guideX = c.x; }
    const dy = Math.abs(c.y - m.y);
    if (dy < meilleurDY) { meilleurDY = dy; y = c.y; guideY = c.y; }
  });
  return { point: { x, y }, guideX, guideY };
}

function ReglageAimant({ pasCm, setPasCm, aimant, setAimant, murs, setMurs }: { pasCm: number; setPasCm: (v: number) => void; aimant: boolean; setAimant: (v: boolean) => void; murs: boolean; setMurs: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => setAimant(!aimant)} className={`btn-ghost !px-2 !py-1 !text-xs ${aimant ? "!bg-ink-900 !text-volt-400" : ""}`}
        title="Aimanter aux sommets des autres pièces (maintenir Alt pour désactiver momentanément)">Aimant</button>
      <button onClick={() => setMurs(!murs)} className={`btn-ghost !px-2 !py-1 !text-xs ${murs ? "!bg-ink-900 !text-volt-400" : ""}`}
        title="Aligner automatiquement les segments créés ou déplacés sur les murs adjacents : horizontal/vertical, parallèle, perpendiculaire, prolongement (maintenir Alt pour désactiver momentanément)">Murs ∥</button>
      <select value={pasCm} onChange={e => setPasCm(Number(e.target.value))} title="Pas de placement"
        className="rounded-lg border border-ink-200 bg-white px-1 py-1 text-xs text-ink-900">
        <option value={1}>1 cm</option>
        <option value={5}>5 cm</option>
        <option value={10}>10 cm</option>
      </select>
    </div>
  );
}

// Repère de lecture des cotes d'une pièce : face intérieure finie des murs (ce qu'on mesure sur place).
function repereCotes(piece: Piece): RepereCotes {
  const g = geometrieMurs(piece);
  return { utile: g.utile, utileFin: g.utileFin, epaisseurTotaleM: i => epaisseurTotaleM(piece, i) };
}

// Rendu d'une cote sur le plan 2D : ligne de cote décalée hors de la pièce (appareillage au
// mur) avec traits d'attache et repères en bout, ou simple trait appareillage → mur
// (appareillage libre) ; valeur en cm au milieu, jamais à l'envers, sur halo blanc.
const COULEUR_COTE = "#0369A1";
function CoteSvg({ g }: { g: GeoCote }) {
  const dx = g.b2.x - g.a2.x, dy = g.b2.y - g.a2.y;
  const l = Math.hypot(dx, dy) || 1;
  const tx = -dy / l * 3, ty = dx / l * 3; // demi-repère perpendiculaire à la ligne de cote
  return (
    <g style={{ pointerEvents: "none" }}>
      {g.kind === "mur" ? (
        <>
          <line x1={g.A.x} y1={g.A.y} x2={g.a2.x} y2={g.a2.y} stroke={COULEUR_COTE} strokeWidth={0.7} opacity={0.6} />
          <line x1={g.B.x} y1={g.B.y} x2={g.b2.x} y2={g.b2.y} stroke={COULEUR_COTE} strokeWidth={0.7} opacity={0.6} />
          <line x1={g.a2.x} y1={g.a2.y} x2={g.b2.x} y2={g.b2.y} stroke={COULEUR_COTE} strokeWidth={1} />
          <line x1={g.a2.x - tx} y1={g.a2.y - ty} x2={g.a2.x + tx} y2={g.a2.y + ty} stroke={COULEUR_COTE} strokeWidth={1.2} />
          <line x1={g.b2.x - tx} y1={g.b2.y - ty} x2={g.b2.x + tx} y2={g.b2.y + ty} stroke={COULEUR_COTE} strokeWidth={1.2} />
        </>
      ) : (
        <>
          <line x1={g.A.x} y1={g.A.y} x2={g.B.x} y2={g.B.y} stroke={COULEUR_COTE} strokeWidth={1} strokeDasharray="3,2" />
          <circle cx={g.A.x} cy={g.A.y} r={1.8} fill={COULEUR_COTE} />
          <circle cx={g.B.x} cy={g.B.y} r={1.8} fill={COULEUR_COTE} />
        </>
      )}
      {/* halo blanc dessiné à part (puis le texte par-dessus) : lisible sur n'importe quel fond, sans dépendre de paint-order */}
      <g transform={`translate(${g.mid.x} ${g.mid.y}) rotate(${g.angle})`} textAnchor="middle" fontSize={9.5} fontWeight={600} fontFamily="monospace">
        <text dominantBaseline="central" fill="none" stroke="#fff" strokeWidth={3.2} strokeLinejoin="round">{g.txt}</text>
        <text dominantBaseline="central" fill={COULEUR_COTE}>{g.txt}</text>
      </g>
    </g>
  );
}

// Même cote pour la fenêtre d'impression (chaîne SVG, hors React).
function coteSvgString(c: Cote, toS: (p: Point) => Point): string {
  const g = geometrieCote(c, toS, 8);
  if (!g) return "";
  const col = COULEUR_COTE, f = (n: number) => n.toFixed(1);
  let out = "";
  if (g.kind === "mur") {
    const dx = g.b2.x - g.a2.x, dy = g.b2.y - g.a2.y, l = Math.hypot(dx, dy) || 1;
    const tx = -dy / l * 2.2, ty = dx / l * 2.2;
    out += `<line x1="${f(g.A.x)}" y1="${f(g.A.y)}" x2="${f(g.a2.x)}" y2="${f(g.a2.y)}" stroke="${col}" stroke-width="0.4" opacity="0.6"/>`;
    out += `<line x1="${f(g.B.x)}" y1="${f(g.B.y)}" x2="${f(g.b2.x)}" y2="${f(g.b2.y)}" stroke="${col}" stroke-width="0.4" opacity="0.6"/>`;
    out += `<line x1="${f(g.a2.x)}" y1="${f(g.a2.y)}" x2="${f(g.b2.x)}" y2="${f(g.b2.y)}" stroke="${col}" stroke-width="0.6"/>`;
    out += `<line x1="${f(g.a2.x - tx)}" y1="${f(g.a2.y - ty)}" x2="${f(g.a2.x + tx)}" y2="${f(g.a2.y + ty)}" stroke="${col}" stroke-width="0.8"/>`;
    out += `<line x1="${f(g.b2.x - tx)}" y1="${f(g.b2.y - ty)}" x2="${f(g.b2.x + tx)}" y2="${f(g.b2.y + ty)}" stroke="${col}" stroke-width="0.8"/>`;
  } else {
    out += `<line x1="${f(g.A.x)}" y1="${f(g.A.y)}" x2="${f(g.B.x)}" y2="${f(g.B.y)}" stroke="${col}" stroke-width="0.6" stroke-dasharray="2,1.5"/>`;
  }
  const tf = `translate(${f(g.mid.x)} ${f(g.mid.y)}) rotate(${f(g.angle)})`;
  out += `<g transform="${tf}" text-anchor="middle" font-size="5.5" font-weight="bold" font-family="monospace">`
    + `<text dominant-baseline="central" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round">${g.txt}</text>`
    + `<text dominant-baseline="central" fill="${col}">${g.txt}</text></g>`;
  return out;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── IMPRESSION ─────────────────────────────────────────────────────────────────

function rendreSVGImprimable(n: Niveau, resultat: ResultatGeneration | null, showCircuits: boolean, showHauteurs: boolean, showLongueurs: boolean, piecesSelectionnees: Set<number> | null, showCotes: boolean, showCotesPieces: boolean, showCotesExt: boolean, showCotesOuv: boolean): string {
  const pieces = piecesSelectionnees ? n.pieces.filter(p => piecesSelectionnees.has(p.id)) : n.pieces;
  const allPts = [
    ...pieces.flatMap(p => p.contour),
    ...(n.zones ?? []).flatMap(z => z.contour),
    ...(n.tableauPos ? [n.tableauPos] : []),
    ...(n.escaliers ?? []).flatMap(esc => { const c = calculerEscalier(esc, hauteurTotaleEscalierCm(esc, n)); return [{ x: c.emprise.minX, y: c.emprise.minY }, { x: c.emprise.maxX, y: c.emprise.maxY }]; }),
  ];
  if (allPts.length === 0) {
    return `<svg width="500" height="100"><text x="10" y="30" font-size="12" font-family="monospace">Aucune pièce dessinée</text></svg>`;
  }
  const xs = allPts.map(p => p.x), ys = allPts.map(p => p.y);
  const minX = Math.min(...xs) - 0.5, maxX = Math.max(...xs) + 0.5;
  const minY = Math.min(...ys) - 0.5, maxY = Math.max(...ys) + 0.5;
  const wM = Math.max(maxX - minX, 1), hM = Math.max(maxY - minY, 1);
  const scale = Math.min(700 / wM, 480 / hM, 50);
  const W = wM * scale, H = hM * scale;
  const toPx = (p: Point) => ({ x: (p.x - minX) * scale, y: (p.y - minY) * scale });

  const niveauResultatComplet = resultat?.maison.niveaux.find(rn => rn.id === n.id) ?? n;
  const niveauResultat: Niveau = {
    ...niveauResultatComplet,
    pieces: piecesSelectionnees ? niveauResultatComplet.pieces.filter(p => piecesSelectionnees.has(p.id)) : niveauResultatComplet.pieces,
  };
  const colorMap = resultat ? construireColorMap(resultat, [n]) : new Map<number, string>();
  // Murs extérieurs / mitoyens : déduits de l'ensemble des pièces (résultat figé ET plan vivant).
  preparerMurs(niveauResultat.pieces);
  preparerMurs(n.pieces);

  let s = `<svg width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg">`;
  s += `<rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="#fff"/>`;

  const ptsPx = (poly: Point[]) => poly.map(toPx).map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
  // 1) fonds de pièces, 2) murs en vraie épaisseur (structure + doublage), 3) ouvertures qui percent
  // toutes les épaisseurs — dans cet ordre pour que les murs ne soient jamais recouverts par le fond d'une voisine.
  niveauResultat.pieces.forEach(p => {
    s += `<polygon points="${ptsPx(p.contour)}" fill="${p.couleurFond ?? PIECE_TYPES[p.type].color}" stroke="none"/>`;
  });
  {
    const quads = niveauResultat.pieces.flatMap(p => geometrieMurs(p).quads);
    const struct = (q: (typeof quads)[number]) => {
      if (q.structureNulle) return;   // mur à 0 cm : rien à dessiner
      const col = q.type === "exterieur" ? "#44403c" : "#78716c";
      s += `<polygon points="${ptsPx(q.structure)}" fill="${col}" stroke="${col}" stroke-width="0.4"/>`;
    };
    quads.filter(q => q.type !== "exterieur").forEach(struct);   // cloisons d'abord,
    quads.filter(q => q.type === "exterieur").forEach(struct);   // murs extérieurs par-dessus (jonctions propres)
    quads.forEach(q => { if (q.doublage) s += `<polygon points="${ptsPx(q.doublage)}" fill="#d9dee4" stroke="#94a3b8" stroke-width="0.5"/>`; });
    quads.forEach(q => { if (q.finition) s += `<polygon points="${ptsPx(q.finition)}" fill="#fafaf9" stroke="#a8a29e" stroke-width="0.5"/>`; });
  }
  niveauResultat.pieces.forEach(p => {
    p.contour.forEach((_, i) => {
      ouverturesEffectivesMur(niveauResultat.pieces, p, i).forEach(e => {
        s += `<polygon points="${ptsPx(decoupeOuverture(p, i, e.position, e.largeur))}" fill="#fff" stroke="none"/>`;
        if (e.proprietaire) {
          const a = p.contour[i], b = p.contour[(i + 1) % p.contour.length];
          const u = { x: (b.x - a.x), y: (b.y - a.y) }, L = Math.hypot(u.x, u.y) || 1;
          const c0 = { x: a.x + u.x * e.position - u.x / L * e.largeur / 200, y: a.y + u.y * e.position - u.y / L * e.largeur / 200 };
          const c1 = { x: a.x + u.x * e.position + u.x / L * e.largeur / 200, y: a.y + u.y * e.position + u.y / L * e.largeur / 200 };
          const col = e.type === "porte" || e.type === "porte_coulissante" || e.type === "porte_garage" ? "#92400E" : e.type === "fenetre" || e.type === "baie_vitree" ? "#0369A1" : "#78716c";
          s += `<line x1="${toPx(c0).x.toFixed(1)}" y1="${toPx(c0).y.toFixed(1)}" x2="${toPx(c1).x.toFixed(1)}" y2="${toPx(c1).y.toFixed(1)}" stroke="${col}" stroke-width="1.2"/>`;
        }
      });
    });
  });
  // Escaliers de ce niveau : marches, flèche de montée, contour de la trémie (pointillés) à l'étage desservi.
  (n.escaliers ?? []).forEach(esc => {
    const c = calculerEscalier(esc, hauteurTotaleEscalierCm(esc, n));
    c.marches.forEach(m => { s += `<polygon points="${ptsPx(m.poly)}" fill="${m.type === "palier" ? "#e7e5e4" : "#fff"}" stroke="#57534e" stroke-width="0.5"/>`; });
    if (esc.niveauDestId != null) s += `<polygon points="${ptsPx(c.tremie)}" fill="none" stroke="#a16207" stroke-width="0.6" stroke-dasharray="3,2"/>`;
    const centres = c.marches.map(m => toPx(centroide(m.poly)));
    if (centres.length >= 2) {
      s += `<polyline points="${centres.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ")}" fill="none" stroke="#44403c" stroke-width="0.7"/>`;
      const fin = centres[centres.length - 1], av = centres[centres.length - 2], ang = Math.atan2(fin.y - av.y, fin.x - av.x);
      s += `<polygon points="${[0, 2.4, -2.4].map((d, k) => `${(fin.x + (k === 0 ? 5 : 3) * Math.cos(ang + d)).toFixed(1)},${(fin.y + (k === 0 ? 5 : 3) * Math.sin(ang + d)).toFixed(1)}`).join(" ")}" fill="#44403c"/>`;
      s += `<text x="${centres[0].x.toFixed(1)}" y="${(centres[0].y + 8).toFixed(1)}" font-size="6" font-family="monospace" fill="#292524" text-anchor="middle">${escapeXml(esc.nom || "Escalier")} · ${c.nbMarches} marches</text>`;
    }
  });
  // Zones : fond léger + limites virtuelles en pointillés, cloisons en épaisseur (percées de leurs portes), nom + surface.
  (n.zones ?? []).forEach(z => {
    if (z.ferme && z.contour.length >= 3) s += `<polygon points="${ptsPx(z.contour)}" fill="#a78bfa" fill-opacity="0.13" stroke="none"/>`;
    segmentsZone(z).forEach(sg => {
      if (z.cotes[sg.i] === "ouvert") s += `<line x1="${toPx(sg.a).x.toFixed(1)}" y1="${toPx(sg.a).y.toFixed(1)}" x2="${toPx(sg.b).x.toFixed(1)}" y2="${toPx(sg.b).y.toFixed(1)}" stroke="#7c3aed" stroke-width="0.9" stroke-dasharray="4,3"/>`;
    });
    cloisonsDeZone(z).forEach(c => {
      s += `<polygon points="${ptsPx(quadCloison(c))}" fill="#78716c" stroke="#78716c" stroke-width="0.4"/>`;
      (z.ouvertures ?? []).filter(o => o.segIndex === c.i).forEach(o => {
        s += `<polygon points="${ptsPx(decoupeOuvertureZone(c, o.position, o.largeur))}" fill="#fff" stroke="none"/>`;
        const L = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) || 1, ux = (c.b.x - c.a.x) / L, uy = (c.b.y - c.a.y) / L;
        const p0 = toPx({ x: c.a.x + ux * (o.position * L - o.largeur / 200), y: c.a.y + uy * (o.position * L - o.largeur / 200) });
        const p1 = toPx({ x: c.a.x + ux * (o.position * L + o.largeur / 200), y: c.a.y + uy * (o.position * L + o.largeur / 200) });
        s += `<line x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" stroke="#92400E" stroke-width="1.2"${o.type === "ouverture" ? ' stroke-dasharray="2,2"' : ""}/>`;
      });
    });
    const surfZ = surfaceZone(z), cz = toPx(centreEtiquetteZone(z));
    const nomZ = z.nom || (z.ferme ? "Zone" : "Cloison");
    s += `<g text-anchor="middle" font-family="monospace">`
      + `<text x="${cz.x.toFixed(1)}" y="${(cz.y - 2).toFixed(1)}" font-size="9" font-weight="bold" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round">${escapeXml(nomZ)}</text>`
      + `<text x="${cz.x.toFixed(1)}" y="${(cz.y - 2).toFixed(1)}" font-size="9" font-weight="bold" fill="#5b21b6">${escapeXml(nomZ)}</text>`
      + (surfZ ? `<text x="${cz.x.toFixed(1)}" y="${(cz.y + 8).toFixed(1)}" font-size="8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round">${surfZ.utile.toFixed(1)} m²</text>`
        + `<text x="${cz.x.toFixed(1)}" y="${(cz.y + 8).toFixed(1)}" font-size="8" fill="#5b21b6">${surfZ.utile.toFixed(1)} m²</text>` : "")
      + `</g>`;
  });
  niveauResultat.pieces.forEach(p => {
    const gU = geometrieMurs(p), utileP = gU.utile;
    p.contour.forEach((_, i) => {
      // Longueur INTÉRIEURE (face finie à face finie), posée côté pièce contre le mur.
      const aU = toPx(utileP[i]), bU = toPx(gU.utileFin[i]);
      const nIn = normaleInterieure(p.contour, i);
      const lx = (aU.x + bU.x) / 2 + nIn.x * 7, ly = (aU.y + bU.y) / 2 + nIn.y * 7;
      s += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="6" text-anchor="middle" font-family="monospace" fill="#444">${(longueurUtileCm(p, i) / 100).toFixed(2)}m</text>`;
    });
  });

  if ((showCircuits || showHauteurs) && resultat && origineCircuits(n)) {
    const tousAppareils = niveauResultat.pieces.flatMap(p => p.appareillages);
    const parCircuit = new Map<number, AppareillagePlace[]>();
    tousAppareils.forEach(a => {
      if (a.circuitId == null) return;
      const arr = parCircuit.get(a.circuitId) ?? [];
      arr.push(a);
      parCircuit.set(a.circuitId, arr);
    });
    parCircuit.forEach((points, circuitId) => {
      const breaker = resultat.breakers.find(b => b.id === circuitId);
      if (!breaker) return;
      const color = colorMap.get(circuitId) ?? "#666";
      const segments = segmentsPourCircuit(breaker, points, n, origineCircuits(n)!);
      // Longueurs RÉELLES (horizontales + montées / descentes) — même tracé et mêmes hauteurs que la vue 3D.
      const ctxL = creerContexteLongueurs(n);
      const hAncreL = hauteurAncreFn(ctxL);
      segments.forEach(seg => {
        const cheminM = cheminSegment(seg, n.liaisonWaypoints);
        const chemin = cheminM.map(toPx);
        const couleurSegment = seg.type === "navette" ? assombrirCouleur(color) : color;
        if (showCircuits) {
          // Sections apparentes : bande grise (moulure) sous le tracé — repérables à l'impression.
          const cleImp = cleSegmentLiaison(seg.aId, seg.bId);
          const posesImp = posesTroncons(n, cleImp, n.liaisonWaypoints?.[cleImp] ?? []);
          for (let j = 0; j < chemin.length - 1; j++) {
            if (posesImp[j] !== "apparent") continue;
            s += `<line x1="${chemin[j].x.toFixed(1)}" y1="${chemin[j].y.toFixed(1)}" x2="${chemin[j + 1].x.toFixed(1)}" y2="${chemin[j + 1].y.toFixed(1)}" stroke="#d6d3d1" stroke-width="4" stroke-linecap="round"/>`;
          }
          const d = chemin.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
          s += `<path d="${d}" fill="none" stroke="${couleurSegment}" stroke-width="1.2" stroke-dasharray="3,2" opacity="0.85"/>`;
          if (showLongueurs && seg.type !== "domotique") {
            const sectionsL = tracerLiaison(ctxL, breaker, segments, seg, hAncreL).sections;
            for (let j = 0; j < cheminM.length - 1; j++) {
              const distM = sectionsL[j] ?? distance(cheminM[j], cheminM[j + 1]);
              const aPx = chemin[j], bPx = chemin[j + 1];
              const mx = (aPx.x + bPx.x) / 2, my = (aPx.y + bPx.y) / 2;
              // Longueur toujours en noir, quelle que soit la couleur du circuit — lisible sur
              // n'importe quelle teinte de tracé, contrairement au trait lui-même (couleurSegment).
              s += `<rect x="${(mx - (distM.toFixed(2).length + 1) * 2.1).toFixed(1)}" y="${(my - 8).toFixed(1)}" width="${((distM.toFixed(2).length + 1) * 4.2).toFixed(1)}" height="7" fill="#fff" opacity="0.85"/>`;
              s += `<text x="${mx.toFixed(1)}" y="${(my - 3).toFixed(1)}" font-size="6" text-anchor="middle" font-family="monospace" fill="#111">${distM.toFixed(2)}m</text>`;
            }
          }
        }
        // Hauteur/pose de chaque coude (passage de gaine dans le mur, ou en apparent) —
        // indépendant de l'inclusion des circuits : le libellé de la case à cocher promet
        // "hauteurs d'implantation (appareillages + gaines)" quel que soit l'état de
        // "Inclure les circuits", donc ces annotations s'affichent dès que showHauteurs est
        // coché, même si showCircuits est décoché (dans ce cas, sans le tracé coloré).
        if (showHauteurs) {
          const cle = cleSegmentLiaison(seg.aId, seg.bId);
          const coudes = n.liaisonWaypoints?.[cle] ?? [];
          coudes.forEach(c => {
            if (c.hauteur == null && !c.poseType) return;
            const pC = toPx(c.point);
            const pose = c.poseType === "apparent" ? "apparent" : "encastré";
            const txt = c.hauteur != null ? `${c.hauteur}cm (${pose})` : `(${pose})`;
            const couleurPoint = showCircuits ? couleurSegment : "#78716c";
            s += `<circle cx="${pC.x.toFixed(1)}" cy="${pC.y.toFixed(1)}" r="2" fill="${couleurPoint}"/>`;
            s += `<text x="${(pC.x + 4).toFixed(1)}" y="${(pC.y - 4).toFixed(1)}" font-size="6" font-family="monospace" fill="#333">${escapeXml(txt)}</text>`;
          });
        }
      });
      if (showCircuits && breaker.circuit === "lumiere") {
        const lumieres = points.filter(a => estLumiere(a.type));
        const boitesExistantes = n.boitesDerivation?.[breaker.label] ?? [];
        const dessinerBoiteImprimee = (pt: Point, nom?: string) => {
          const pos = toPx(pt);
          s += `<rect x="${(pos.x - 4).toFixed(1)}" y="${(pos.y - 4).toFixed(1)}" width="8" height="8" fill="#fff" stroke="${color}" stroke-width="1.2"/>`;
          s += `<line x1="${(pos.x - 3.5).toFixed(1)}" y1="${(pos.y - 3.5).toFixed(1)}" x2="${(pos.x + 3.5).toFixed(1)}" y2="${(pos.y + 3.5).toFixed(1)}" stroke="${color}" stroke-width="0.8"/>`;
          s += `<line x1="${(pos.x - 3.5).toFixed(1)}" y1="${(pos.y + 3.5).toFixed(1)}" x2="${(pos.x + 3.5).toFixed(1)}" y2="${(pos.y - 3.5).toFixed(1)}" stroke="${color}" stroke-width="0.8"/>`;
          if (nom) s += `<text x="${pos.x.toFixed(1)}" y="${(pos.y - 6).toFixed(1)}" font-size="6" text-anchor="middle" font-family="monospace" fill="#111">${escapeXml(nom)}</text>`;
        };
        if (boitesExistantes.length > 0) {
          boitesExistantes.forEach(b => dessinerBoiteImprimee(b.point, b.nom));
        } else if (lumieres.length > 1) {
          dessinerBoiteImprimee(centroidePoints(lumieres.map(l => ({ x: l.x, y: l.y }))));
        }
      }
    });
  }

  niveauResultat.pieces.forEach(p => {
    const plaquesP = infosPlaques(p.appareillages);
    p.appareillages.forEach(a => {
      const infoPl = a.groupeId != null ? plaquesP.get(a.groupeId) : undefined;
      const ptAncreP = infoPl ? { x: infoPl.gx, y: infoPl.gy } : { x: a.x, y: a.y };
      const pos = toPx(ptAncreP);
      const color = showCircuits && a.circuitId != null ? (colorMap.get(a.circuitId) ?? "#1c1917") : "#1c1917";
      // Même logique qu'à l'écran : carré tangent au mur, symbole tourné vers l'intérieur.
      const TAILLE_SYM = 10;
      let cxP = pos.x, cyP = pos.y, rotP = 0;
      const ancP = estMural(a.type) ? ancrageMurLePlusProche(ptAncreP, p.contour) : null;
      if (ancP && ancP.distance <= TOLERANCE_MUR_M) {
        const pf = toPx(ancP.pied);
        const pn = toPx({ x: ancP.pied.x + ancP.normale.x * 0.1, y: ancP.pied.y + ancP.normale.y * 0.1 });
        const ln = Math.hypot(pn.x - pf.x, pn.y - pf.y) || 1;
        const nxp = (pn.x - pf.x) / ln, nyp = (pn.y - pf.y) / ln;
        const demiP = TAILLE_SYM * 0.75 + Math.max(0.8, faceInterieureM(p, ancP.segIndex) * scale);
        cxP = pf.x + nxp * demiP; cyP = pf.y + nyp * demiP;
        rotP = Math.atan2(nxp, -nyp) * 180 / Math.PI;
      }
      if (infoPl) {
        // Plaque multiple : un carré par poste, contigus le long du mur, + contour commun (dessiné avec le rang 0).
        const pas = TAILLE_SYM * 1.5 + 0.6;
        const dr = ancP ? droiteFaceAuMur(ancP.normale) : { x: 1, y: 0 };
        const off = ((a.rangPlaque ?? 0) - (infoPl.n - 1) / 2) * pas;
        if ((a.rangPlaque ?? 0) === 0) {
          const larg = infoPl.n * pas - 0.6 + 3;
          s += `<g transform="translate(${cxP.toFixed(2)} ${cyP.toFixed(2)}) rotate(${rotP.toFixed(2)})"><rect x="${(-larg / 2).toFixed(2)}" y="${(-TAILLE_SYM * 0.75 - 1.5).toFixed(2)}" width="${larg.toFixed(2)}" height="${(TAILLE_SYM * 1.5 + 3).toFixed(2)}" rx="3" fill="none" stroke="#78716c" stroke-width="0.8" stroke-dasharray="2,1.5"/></g>`;
        }
        cxP += dr.x * off; cyP += dr.y * off;
      }
      s += appareillageSymbolSvgString(a.type, cxP, cyP, TAILLE_SYM, color, rotP, true);
      if (a.type === "prise_dediee") {
        const ini = escapeXml(initialesAppareillage(a.type, a.usageDedie));
        s += `<text x="${cxP.toFixed(1)}" y="${(cyP + TAILLE_SYM * 1.5).toFixed(1)}" font-size="5.5" font-weight="bold" text-anchor="middle" font-family="monospace" fill="${color}">${ini}</text>`;
      }
      if (showHauteurs && a.hauteur != null) {
        s += `<text x="${(cxP + 9).toFixed(1)}" y="${(cyP + 3).toFixed(1)}" font-size="6" font-family="monospace" fill="#555">${a.hauteur}cm</text>`;
      }
    });
  });

  if (n.tableauPos) {
    const pos = toPx(n.tableauPos);
    s += `<rect x="${(pos.x - 6).toFixed(1)}" y="${(pos.y - 6).toFixed(1)}" width="12" height="12" rx="2" fill="#1c1917"/>`;
    s += `<text x="${pos.x.toFixed(1)}" y="${(pos.y + 3).toFixed(1)}" font-size="8" text-anchor="middle" fill="#FBBF24">⚡</text>`;
    if (showHauteurs && n.tableauHauteur != null) {
      s += `<text x="${pos.x.toFixed(1)}" y="${(pos.y + 16).toFixed(1)}" font-size="6" text-anchor="middle" font-family="monospace" fill="#555">${n.tableauHauteur}cm</text>`;
    }
  }

  if (n.pointArriveeGaines) {
    const pos = toPx(n.pointArriveeGaines);
    s += `<circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="6" fill="#0EA5E9" stroke="#fff" stroke-width="1.2"/>`;
    s += `<text x="${pos.x.toFixed(1)}" y="${(pos.y + 3).toFixed(1)}" font-size="7" text-anchor="middle" fill="#fff">⬇</text>`;
    if (n.distanceArriveeGainesTableau != null) {
      s += `<text x="${pos.x.toFixed(1)}" y="${(pos.y + 16).toFixed(1)}" font-size="6" text-anchor="middle" font-family="monospace" fill="#0369A1">${n.distanceArriveeGainesTableau}m → tableau</text>`;
    }
    {
      const candidats = n.pieces.flatMap(pc => pc.appareillages).filter(a => {
        if (a.dejaExistant) return false;
        const manuel = a.circuitManuelId != null ? (n.circuitsManuels ?? []).find(m => m.id === a.circuitManuelId) : undefined;
        return !manuel?.nonRelieTableau;
      });
      if (candidats.length > 0) {
        let dMin = Infinity;
        candidats.forEach(a => { const d = distance(n.pointArriveeGaines!, { x: a.x, y: a.y }); if (d < dMin) dMin = d; });
        const yDist = pos.y + (n.distanceArriveeGainesTableau != null ? 23 : 16);
        s += `<text x="${pos.x.toFixed(1)}" y="${yDist.toFixed(1)}" font-size="6" text-anchor="middle" font-family="monospace" fill="#0369A1">${dMin.toFixed(2)}m → 1er appareillage</text>`;
      }
    }
  }

  // Étiquettes des pièces (nom + surface), au-dessus de tout, avec halo blanc : position déplacée
  // à la main (Piece.nomDecalage) si elle existe, sinon placement automatique à l'endroit le plus
  // libre — même logique que sur le plan. Lue sur les pièces VIVANTES (pas sur le résultat figé).
  pieces.forEach(p => {
    const spec = PIECE_TYPES[p.type];
    const nom = p.nom || spec.label;
    const surf = `${(surfaceUtile(p) ?? aireDuPolygone(p.contour)).toFixed(1)} m²`;
    const w = Math.max(nom.length * 6, surf.length * 4.9) + 8, h = 22;
    const cW = centroide(p.contour), cPx = toPx(cW);
    let pos: Point;
    if (p.nomDecalage) {
      pos = toPx({ x: cW.x + p.nomDecalage.x, y: cW.y + p.nomDecalage.y });
    } else {
      const obstacles: RectPx[] = p.appareillages.map(a => carreAutour(toPx({ x: a.x, y: a.y }), 13));
      (p.ouvertures ?? []).forEach(o => {
        const a0 = p.contour[o.segIndex], b0 = p.contour[(o.segIndex + 1) % p.contour.length];
        if (!a0 || !b0) return;
        obstacles.push(carreAutour(toPx({ x: a0.x + (b0.x - a0.x) * o.position, y: a0.y + (b0.y - a0.y) * o.position }), (o.largeur / 100) * scale * (o.type === "fenetre" ? 0.5 : 0.75) + 3));
      });
      if (n.tableauPos && pointDansPolygone(n.tableauPos, p.contour)) obstacles.push(carreAutour(toPx(n.tableauPos), 12));
      pos = placerEtiquettePiece(p.contour.map(toPx), cPx, { w, h }, obstacles);
    }
    const tf = `text-anchor="middle" font-family="monospace"`;
    s += `<g ${tf}>`
      + (p.masquerNom ? "" : `<text x="${pos.x.toFixed(1)}" y="${(pos.y - 2).toFixed(1)}" font-size="10" font-weight="bold" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round">${escapeXml(nom)}</text>`
      + `<text x="${pos.x.toFixed(1)}" y="${(pos.y - 2).toFixed(1)}" font-size="10" font-weight="bold" fill="#111">${escapeXml(nom)}</text>`)
      + (p.masquerDimensions ? "" : `<text x="${pos.x.toFixed(1)}" y="${(pos.y + 9).toFixed(1)}" font-size="8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round">${surf}</text>`
      + `<text x="${pos.x.toFixed(1)}" y="${(pos.y + 9).toFixed(1)}" font-size="8" fill="#555">${surf}</text>`) + `</g>`;
  });

  // Cotes d'implantation (option d'impression) : une cote par appareillage mural — sa distance
  // au coin le plus proche — en écartant celles qui se chevaucheraient, pour rester lisible.
  if (showCotes) {
    const cotes = niveauResultat.pieces.flatMap(pc => pc.appareillages
      .filter(a => estMural(a.type))
      .flatMap(a => cotesAppareillage({ x: a.x, y: a.y }, pc.contour, a.type, false, repereCotes(pc))));
    filtrerCotesLisibles(cotes, toPx, [], 12, 22).forEach(c => { s += coteSvgString(c, toPx); });
    s += `<text x="4" y="10" font-size="6" font-family="monospace" fill="${COULEUR_COTE}">Cotes en cm — distance de l'appareillage au coin intérieur le plus proche</text>`;
  }
  // Cotes des pièces : dimension intérieure de chaque mur (face finie à face finie) + épaisseurs.
  if (showCotesPieces) {
    const cotesP: Cote[] = niveauResultat.pieces.filter(pc => !pc.masquerDimensions).flatMap(pc => {
      const { utile, utileFin } = geometrieMurs(pc);
      return pc.contour.map((_, i): Cote => {
        const a = utile[i], b = utileFin[i];
        return { kind: "mur", a, b, valeurCm: Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 100), normale: normaleInterieure(pc.contour, i), interieur: true, decalageM: 0 };
      });
    });
    filtrerCotesLisibles(cotesP, toPx, [], 12, 22).forEach(c => { s += coteSvgString(c, toPx); });
    niveauResultat.pieces.filter(pc => !pc.masquerDimensions).forEach(pc => pc.contour.forEach((_, i) => {
      const sp = murDe(pc, i);
      // Centre et direction de la bande de structure : là où l'épaisseur se lit sur le mur.
      const qs = geometrieMurs(pc).quads[i].structure.map(toPx);
      const cx = (qs[0].x + qs[1].x + qs[2].x + qs[3].x) / 4, cy = (qs[0].y + qs[1].y + qs[2].y + qs[3].y) / 4;
      const dx = (qs[1].x + qs[2].x) / 2 - (qs[0].x + qs[3].x) / 2, dy = (qs[1].y + qs[2].y) / 2 - (qs[0].y + qs[3].y) / 2;
      const A = { x: cx - dx / 2, y: cy - dy / 2 }, B = { x: cx + dx / 2, y: cy + dy / 2 };
      if (((sp.epaisseur + sp.doublage + (sp.finition ?? 0)) / 100) * scale < 7 || Math.hypot(B.x - A.x, B.y - A.y) < 30) return;
      let ang = Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI; if (ang > 90 || ang < -90) ang += 180;
      const txt = [sp.finition ?? 0, sp.doublage, sp.epaisseur].filter(v => v > 0).join("+");
      s += `<text transform="translate(${((A.x + B.x) / 2).toFixed(1)} ${((A.y + B.y) / 2).toFixed(1)}) rotate(${ang.toFixed(1)})" text-anchor="middle" dominant-baseline="central" font-size="5" font-weight="bold" font-family="monospace" fill="#fff" stroke="${sp.type === "exterieur" ? "#44403c" : "#78716c"}" stroke-width="1.6" paint-order="stroke">${txt}</text>`;
    }));
    s += `<text x="4" y="${showCotes ? 18 : 10}" font-size="6" font-family="monospace" fill="${COULEUR_COTE}">Cotes des pièces en cm — dimensions intérieures (faces finies) · épaisseurs : structure+doublage</text>`;
  }
  // Cotes d'ouvertures (chaîne le long de la face intérieure) et cotes extérieures / hors-tout.
  if (showCotesOuv || showCotesExt) {
    const cotesA: Cote[] = [
      ...(showCotesOuv ? niveauResultat.pieces.filter(pc => !pc.masquerDimensions).flatMap(pc => cotesOuvertures(pc, niveauResultat.pieces)) : []),
      ...(showCotesExt ? [...cotesExterieures(niveauResultat.pieces), ...coteHorsTout(niveauResultat.pieces)] : []),
    ];
    filtrerCotesLisibles(cotesA, toPx, [], 10, 20).forEach(c => { s += coteSvgString(c, toPx); });
  }
  s += `</svg>`;
  return s;
}

function couleurTaux(tauxPct: number): string {
  return tauxPct <= 20 ? "#059669" : tauxPct <= 33 ? "#D97706" : "#DC2626";
}

function gaineNiveauHtml(troncon: TronconGaine | undefined, niveau: Niveau): string {
  const lignes: string[] = [];
  if (troncon) {
    lignes.push(`<span>🔀 Gaine principale : <strong>${escapeXml(troncon.gaine)}</strong></span>` +
      `<span style="color:${couleurTaux(troncon.tauxPct)};font-weight:bold;">${troncon.tauxPct}% de remplissage</span>` +
      `<span style="color:#888;">(${troncon.circuits.length} circuit${troncon.circuits.length > 1 ? "s" : ""} regroupés Tableau → niveau)</span>`);
  }
  if (niveau.pointArriveeGaines && niveau.distanceArriveeGainesTableau != null) {
    lignes.push(`<span>⬇ Point d'arrivée des gaines — distance au tableau électrique : <strong>${niveau.distanceArriveeGainesTableau}m</strong> (liaison verticale non représentée sur le plan)</span>`);
  }
  if (lignes.length === 0) return "";
  return `<div style="margin:0 6mm 6mm;font-size:8pt;font-family:monospace;color:#333;display:flex;flex-wrap:wrap;align-items:center;gap:6px;">${lignes.join("")}</div>`;
}

function legendeCircuitsHtml(resultat: ResultatGeneration | null, niveau: Niveau, showLongueurs: boolean, niveauVivant: Niveau): string {
  if (!resultat) return "";
  const nomsPieces = new Set(niveau.pieces.map(p => p.nom));
  const colorMap = construireColorMap(resultat, [niveauVivant]);
  const utilises = resultat.breakers
    .map(b => ({ b, color: colorMap.get(b.id) ?? "#666" }))
    .filter(({ b }) => b.pieces.some(p => nomsPieces.has(p.nom)));
  if (utilises.length === 0) return "";
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:0 6mm 6mm;font-size:8pt;font-family:monospace;">` +
    utilises.map(({ b, color }) => {
      let lgTxt = "";
      // Longueur calculée sur le niveau VIVANT (tableau/coudes/ordre de câblage actuels) plutôt
      // que sur l'instantané figé au moment de la génération — sinon un cheminement redessiné
      // ou un coude déplacé après coup ne se répercuterait pas sur la longueur imprimée.
      if (showLongueurs && origineCircuits(niveauVivant)) {
        const pts = niveauVivant.pieces.flatMap(p => p.appareillages).filter(a => a.circuitId === b.id);
        if (pts.length > 0) {
          const lg = longueurCircuit(creerContexteLongueurs(niveauVivant), b, pts, origineCircuits(niveauVivant)!);
          lgTxt = ` — ${lg.totale.toFixed(1)}m${lg.verticale > 0.05 ? ` (dont ${lg.verticale.toFixed(1)}m vertical)` : ""}`;
        }
      }
      const nomCircuit = niveauVivant.nomsCircuits?.[b.label] ?? b.label;
      return `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;"></span>${escapeXml(nomCircuit || CIRCUITS[b.circuit]?.label || b.circuit)}${lgTxt}</span>`;
    }).join("") + `</div>`;
}

// Nomenclature des symboles d'un niveau : pour chaque type d'appareillage réellement présent, son symbole
// normalisé (le même que sur le plan), son libellé et sa quantité ; une prise dédiée est comptée par appareil
// alimenté. Termine par le décompte des appareillages multiples (plaques double / triple / quadruple).
function nomenclatureHtml(pieces: Piece[]): string {
  const ordre = new Map(PALETTE.map((pa, i) => [pa.type, i] as const));
  const lignes = new Map<string, { a: AppareillagePlace; nb: number }>();
  const postesParPlaque = new Map<number, number>();
  pieces.forEach(pc => pc.appareillages.forEach(a => {
    const cle = a.type === "prise_dediee" ? `prise_dediee:${a.usageDedie ?? USAGE_DEDIE_DEFAUT}` : a.type;
    const l = lignes.get(cle);
    if (l) l.nb++; else lignes.set(cle, { a, nb: 1 });
    if (a.groupeId != null) postesParPlaque.set(a.groupeId, (postesParPlaque.get(a.groupeId) ?? 0) + 1);
  }));
  if (lignes.size === 0) return "";
  const tri = [...lignes.entries()].sort((x, y) => (ordre.get(x[1].a.type) ?? 99) - (ordre.get(y[1].a.type) ?? 99) || x[0].localeCompare(y[0]));
  const lignesHtml = tri.map(([, { a, nb }]) =>
    `<tr><td style="padding:2px 8px;"><svg width="22" height="22" viewBox="0 0 22 22">${appareillageSymbolSvgString(a.type, 11, 11, 18, "#1c1917", 0, false)}</svg></td>` +
    `<td style="padding:2px 8px;">${escapeXml(labelAppareillagePlace(a))}</td><td style="padding:2px 8px;text-align:right;font-weight:bold;">${nb}</td></tr>`).join("");
  const plaques = new Map<number, number>();
  postesParPlaque.forEach(nb => { if (nb >= 2) plaques.set(nb, (plaques.get(nb) ?? 0) + 1); });
  const nomP = (n: number) => n === 2 ? "double" : n === 3 ? "triple" : "quadruple";
  const plaquesHtml = plaques.size === 0 ? "" :
    `<tr><td colspan="3" style="padding:4px 8px 0;border-top:1px solid #ccc;">Appareillages multiples : ${[...plaques.entries()].sort((x, y) => x[0] - y[0]).map(([n, nb]) => `${nb} ${nomP(n)}${nb > 1 ? "s" : ""}`).join(", ")}</td></tr>`;
  return `<div style="margin:0 6mm 6mm;font-size:8pt;font-family:monospace;break-inside:avoid;"><p style="margin:0 0 2mm;font-weight:bold;">Nomenclature des symboles</p>` +
    `<table style="border-collapse:collapse;border:1px solid #999;">${lignesHtml}${plaquesHtml}</table></div>`;
}

function imprimerPlan(
  niveaux: Niveau[], clientName: string, resultat: ResultatGeneration | null,
  showCircuits: boolean, showLongueurs: boolean, showHauteurs: boolean, piecesSelectionnees: Set<number> | null, showCotes: boolean, showCotesPieces: boolean, showCotesExt: boolean, showCotesOuv: boolean,
) {
  const w = window.open("", "_blank");
  if (!w) return;
  let html = `<html><head><title>Plan — ${clientName}</title><style>
    @page { margin: 10mm; }
    body { margin: 0; font-family: 'Courier New', monospace; }
    h2 { font-size: 14pt; margin: 6mm 6mm 1mm; }
    .meta { font-size: 9pt; color: #555; margin: 0 6mm 4mm; }
    svg { display: block; margin: 0 auto 4mm; }
  </style></head><body>`;
  const gainesNiveaux = resultat ? genererGainesNiveaux(resultat) : [];
  [...niveaux].sort((a, b) => a.ordre - b.ordre).forEach(n => {
    const piecesFiltrees = piecesSelectionnees ? n.pieces.filter(p => piecesSelectionnees.has(p.id)) : n.pieces;
    if (piecesFiltrees.length === 0) return;
    const niveauResultatComplet = resultat?.maison.niveaux.find(rn => rn.id === n.id) ?? n;
    const niveauResultat: Niveau = { ...niveauResultatComplet, pieces: niveauResultatComplet.pieces.filter(p => piecesFiltrees.some(pf => pf.id === p.id)) };
    html += `<h2>${escapeXml(n.nom || NIVEAU_TYPES[n.type])}</h2><div class="meta">${piecesFiltrees.length} pièce${piecesFiltrees.length > 1 ? "s" : ""}</div>`;
    html += rendreSVGImprimable(n, resultat, showCircuits, showHauteurs, showLongueurs, piecesSelectionnees, showCotes, showCotesPieces, showCotesExt, showCotesOuv);
    if (showCircuits) {
      html += legendeCircuitsHtml(resultat, niveauResultat, showLongueurs, n);
    }
    html += nomenclatureHtml(piecesFiltrees);
    const troncon = gainesNiveaux.find(g => g.niveau === (n.nom || n.type));
    if (showCircuits || (n.pointArriveeGaines && n.distanceArriveeGainesTableau != null)) {
      html += gaineNiveauHtml(showCircuits ? troncon : undefined, n);
    }
  });
  html += `</body></html>`;
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.print(); w.close(); }, 400);
}

// ─── DRAG STATE ───────────────────────────────────────────────────────────────

// Boussole du plan : l'aiguille rouge indique le NORD. Glisser pour la tourner (ou saisir l'angle dans la barre) —
// 0° = Nord en haut du plan, 90° = Nord à droite. Réglage commun au bâtiment, repris par le soleil de midi en 3D.
function BoussoleOrientation({ angle, onChange }: { angle: number; onChange: (deg: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [glisse, setGlisse] = useState(false);
  const depuisPointeur = (e: { clientX: number; clientY: number }) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < 4) return;
    // Angle horaire depuis le haut : atan2(dx, -dy).
    onChange((Math.atan2(dx, -dy) * 180) / Math.PI);
  };
  return (
    <div ref={ref}
      className="absolute top-3 right-3 z-10 w-16 h-16 rounded-full bg-white/90 border border-ink-200 shadow select-none"
      style={{ touchAction: "none", cursor: glisse ? "grabbing" : "grab" }}
      title="Orientation du bâtiment : glisser pour placer le Nord"
      onPointerDown={e => { e.stopPropagation(); (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); setGlisse(true); depuisPointeur(e); }}
      onPointerMove={e => { if (glisse) depuisPointeur(e); }}
      onPointerUp={e => { setGlisse(false); (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); }}>
      <svg viewBox="-32 -32 64 64" className="w-full h-full pointer-events-none">
        <circle r={29} fill="none" stroke="#d6d3d1" strokeWidth={1} />
        <g transform={`rotate(${angle})`}>
          <polygon points="0,-24 6,0 -6,0" fill="#dc2626" />
          <polygon points="0,24 6,0 -6,0" fill="#a8a29e" />
          <text y={-26} x={0} textAnchor="middle" fontSize="9" fontWeight="700" fill="#dc2626" transform="translate(0,-2)">N</text>
        </g>
        <circle r={2.5} fill="#1c1917" />
      </svg>
      <span className="absolute -bottom-4 inset-x-0 text-center text-[10px] font-mono text-ink-500">{Math.round(angle)}°</span>
    </div>
  );
}

type DragMode =
  | { kind: "none" }
  | { kind: "pan"; startX: number; startY: number; startPan: Point }
  | { kind: "vertex"; pieceId: number; vertexIndex: number }
  | { kind: "piece"; pieceId: number; startX: number; startY: number; startContour: Point[] }
  | { kind: "nomPiece"; pieceId: number; startX: number; startY: number; startOffset: Point }
  | { kind: "appareillage"; pieceId: number; appareillageId: number }
  | { kind: "meuble"; pieceId: number; meubleId: number }
  | { kind: "escalier"; escalierId: number; offX: number; offY: number }
  | { kind: "niveau"; startX: number; startY: number; dx0: number; dy0: number }
  | { kind: "personne"; pieceId: number }
  | { kind: "voiture"; pieceId: number }
  | { kind: "ouverture"; pieceId: number; ouvertureId: number }
  | { kind: "zone"; zoneId: number; startX: number; startY: number; startContour: Point[] }
  | { kind: "zoneSommet"; zoneId: number; index: number }
  | { kind: "tableau" }
  | { kind: "pointArrivee" }
  | { kind: "boite"; label: string; boiteId: number }
  | { kind: "liaison"; cle: string; waypointId: number };

// ─── FORMULAIRES ────────────────────────────────────────────────────────────────

function PieceForm({ initialNom, initialType, initialHauteurPlafond, initialContour, initialMurs, mitoyens, verrouillee, onValidate, onCancel, onDelete }: {
  initialNom: string; initialType: PieceType; initialHauteurPlafond?: number;
  initialContour: Point[]; initialMurs: MurSpec[]; mitoyens: boolean[]; verrouillee?: boolean;
  onValidate: (nom: string, type: PieceType, hauteurPlafond: number | undefined, contour: Point[], murs: MurSpec[]) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [nom, setNom] = useState(initialNom);
  const [type, setType] = useState<PieceType>(initialType);
  const [hauteurPlafond, setHauteurPlafond] = useState(initialHauteurPlafond != null ? String(initialHauteurPlafond) : "");

  // Murs : épaisseur de la structure et du doublage, par côté. (Mur extérieur ou mitoyen : déduit du plan.)
  const [saisiesMurs, setSaisiesMurs] = useState<SaisieMur[]>(initialMurs.map(saisieDepuisMur));
  const mursApercu = saisiesMurs.map((sm, i) => murDepuisSaisie(sm) ?? initialMurs[i]);
  const mursValides = saisiesMurs.every(sm => murDepuisSaisie(sm) != null);

  // Dimensions = dimensions UTILES (de face intérieure finie à face intérieure finie), celles que l'on
  // relève sur place. Rectangle → largeur et longueur ; autre forme → un champ par mur. Seuls les champs
  // modifiés sont appliqués ; les autres affichent la valeur courante.
  const rectangle = estRectangle(initialContour);
  const indices = rectangle ? [0, 1] : initialContour.map((_, i) => i);
  const etiquette = (i: number) => rectangle ? (i === 0 ? "Largeur" : "Longueur") : `Mur ${i + 1}`;
  const [saisies, setSaisies] = useState<Record<number, string>>({});
  const pieceAvec = (contour: Point[]): Piece => {
    const pc = { contour, murs: mursApercu } as Piece;
    definirMitoyens(pc, mitoyens);
    return pc;
  };
  const valeurValide = (i: number) => { const v = parseFloat((saisies[i] ?? "").replace(",", ".")); return v >= 1 ? Math.round(v) : null; };
  const contourApercu = indices.reduce((c, i) => {
    if (saisies[i] === undefined) return c;
    const v = valeurValide(i);
    return v != null ? redimensionnerMurUtile(pieceAvec(c), i, v) : c;
  }, initialContour);
  const pieceApercu = pieceAvec(contourApercu);
  const utiles = longueursUtilesCm(pieceApercu);
  const dimensionsValides = indices.every(i => saisies[i] === undefined || valeurValide(i) != null);
  const aireUtile = surfaceUtile(pieceApercu);
  const modifie = contourApercu !== initialContour;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="card w-full max-w-sm max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200 shrink-0">
          <p className="font-semibold text-ink-900">Pièce</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          <div>
            <label className="label">Nom</label>
            <input autoFocus className="input" placeholder="Ex: Chambre 1, Séjour…" value={nom} onChange={e => setNom(e.target.value)} />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={type} onChange={e => setType(e.target.value as PieceType)}>
              {Object.entries(PIECE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Hauteur sous plafond (m) — vide = hauteur du niveau</label>
            <input className="input" inputMode="decimal" placeholder="Ex: 2.50" value={hauteurPlafond} onChange={e => setHauteurPlafond(e.target.value)} />
          </div>
          <div className="border-t border-ink-100 pt-3">
            <label className="label">Dimensions intérieures (cm){rectangle ? "" : " — par mur"}</label>
            {verrouillee ? (
              <p className="text-xs text-amber-600">🔒 Pièce verrouillée : déverrouille-la pour modifier ses dimensions.</p>
            ) : (
              <>
                <div className="grid gap-2 grid-cols-2">
                  {indices.map(i => {
                    const ok = saisies[i] === undefined || valeurValide(i) != null;
                    return (
                      <label key={i} className="flex items-center gap-2 text-xs text-ink-500">
                        <span className="w-16 shrink-0">{etiquette(i)}</span>
                        <input className={`input !py-1 !text-xs ${ok ? "" : "!border-red-400"}`} inputMode="numeric"
                          value={saisies[i] ?? String(utiles[i])}
                          onChange={e => setSaisies(sv => ({ ...sv, [i]: e.target.value }))} />
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-ink-500 mt-2">
                  Surface : <span className="font-semibold text-ink-900">{aireUtile != null ? `${aireUtile.toFixed(2)} m²` : "—"}</span>
                  {modifie && <span className="text-volt-600"> (modifiée)</span>}
                </p>
                <p className="text-[11px] text-ink-400 mt-1">
                  Dimensions intérieures, de face finie à face finie. Le tracé de la pièce est son contour hors-tout : les épaisseurs de murs s&apos;ajoutent à l&apos;intérieur et réduisent ces dimensions.
                </p>
              </>
            )}
          </div>
          <div className="border-t border-ink-100 pt-3">
            <label className="label">Murs : 3 couches (cm), de l&apos;intérieur vers l&apos;extérieur</label>
            {verrouillee ? (
              <p className="text-xs text-amber-600">🔒 Pièce verrouillée : déverrouille-la pour modifier ses murs.</p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  {saisiesMurs.map((sm, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[11px] text-ink-500 w-10 shrink-0">Mur {i + 1}</span>
                      <ChampsMur compact valeur={sm} onChange={v => setSaisiesMurs(arr => arr.map((x, k) => k === i ? v : x))} />
                    </div>
                  ))}
                </div>
                {saisiesMurs.length > 1 && (
                  <button type="button" className="text-[11px] text-volt-600 underline mt-1.5"
                    onClick={() => setSaisiesMurs(arr => arr.map(() => ({ ...arr[0] })))}>
                    Appliquer les couches du mur 1 à tous les murs
                  </button>
                )}
                <p className="text-[11px] text-ink-400 mt-1.5">
                  1 = finition (côté pièce), 2 = doublage (les circuits y passent par défaut), 3 = structure (0 = pas de mur de ce côté, utile pour une cloison commune à deux pièces). Les couches s&apos;ajoutent à l&apos;intérieur du tracé : les dimensions intérieures sont recalculées. Les ouvertures percent les 3 couches.
                </p>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200 shrink-0">
          <button disabled={!verrouillee && (!dimensionsValides || !mursValides)}
            onClick={() => onValidate(nom, type, hauteurPlafond.trim() === "" ? undefined : (parseFloat(hauteurPlafond.replace(",", ".")) || undefined), verrouillee ? initialContour : contourApercu, verrouillee ? initialMurs : mursApercu)}
            className="btn-volt flex-1 disabled:opacity-40"><Save size={14} /> Valider</button>
          {onDelete && <button onClick={onDelete} className="btn-danger !px-3"><Trash2 size={14} /></button>}
        </div>
      </div>
    </div>
  );
}


// ─── CLOISON : formulaire de validation ─────────────────────────────────────────────────────────
// Après le tracé (mur → angles → mur) : noms et types des deux pièces obtenues, épaisseur de la cloison,
// porte éventuelle. Le résultat est calculé en direct (surfaces utiles, erreurs) par appliquerCloison.
const IDEES_SOUS_PIECE: { nom: string; type: PieceType }[] = [
  { nom: "Dressing", type: "autre" }, { nom: "Placard", type: "autre" }, { nom: "Bureau", type: "autre" },
  { nom: "Buanderie", type: "autre" }, { nom: "Salle d'eau", type: "sdb" }, { nom: "WC", type: "wc" },
];
function CloisonForm({ piece, pieces, chemin, onValidate, onCancel }: {
  piece: Piece; pieces: Piece[]; chemin: Point[];
  onValidate: (opts: OptionsCloison) => void; onCancel: () => void;
}) {
  const [nomOrigine, setNomOrigine] = useState(piece.nom);
  const [typeOrigine, setTypeOrigine] = useState<PieceType>(piece.type);
  const [nomNouvelle, setNomNouvelle] = useState("Dressing");
  const [typeNouvelle, setTypeNouvelle] = useState<PieceType>("autre");
  const [epaisseur, setEpaisseur] = useState("10");
  const [porte, setPorte] = useState<OptionsCloison["porte"]>("porte");

  const ep = parseFloat(epaisseur.replace(",", "."));
  const epaisseurValide = ep >= 5 && ep <= 50;
  const opts: OptionsCloison = { nomOrigine, typeOrigine, nomNouvelle, typeNouvelle, epaisseurCm: epaisseurValide ? ep : 10, porte };
  const essai = appliquerCloison(pieces, piece.id, chemin, opts);
  let aireOrigine: number | null = null, aireNouvelle: number | null = null;
  if (!("erreur" in essai)) {
    preparerMurs(essai.pieces);
    const po = essai.pieces.find(x => x.id === essai.idOrigine), pn = essai.pieces.find(x => x.id === essai.idNouvelle);
    aireOrigine = (po ? surfaceUtile(po) : null) ?? essai.aireOrigine;
    aireNouvelle = (pn ? surfaceUtile(pn) : null) ?? essai.aireNouvelle;
  }
  const longueurTotale = chemin.slice(1).reduce((t, pt, i) => t + distance(chemin[i], pt), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="card w-full max-w-sm max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200 shrink-0">
          <p className="font-semibold text-ink-900">Cloison — {chemin.length - 1} tronçon{chemin.length > 2 ? "s" : ""}, {longueurTotale.toFixed(2)} m</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          <div>
            <label className="label">Nouvelle pièce (petite partie)</label>
            <input autoFocus className="input" placeholder="Ex: Dressing" value={nomNouvelle} onChange={e => setNomNouvelle(e.target.value)} />
            <div className="flex flex-wrap gap-1 mt-1.5">
              {IDEES_SOUS_PIECE.map(i => (
                <button key={i.nom} type="button" onClick={() => { setNomNouvelle(i.nom); setTypeNouvelle(i.type); }}
                  className={`!text-[11px] px-2 py-0.5 rounded-md border transition-colors ${nomNouvelle === i.nom ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"}`}>
                  {i.nom}
                </button>
              ))}
            </div>
            <select className="input mt-1.5" value={typeNouvelle} onChange={e => setTypeNouvelle(e.target.value as PieceType)}>
              {Object.entries(PIECE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <p className="text-xs text-ink-500 mt-1">Surface utile : <span className="font-semibold text-ink-900">{aireNouvelle != null ? `${aireNouvelle.toFixed(2)} m²` : "—"}</span></p>
          </div>
          <div className="border-t border-ink-100 pt-3">
            <label className="label">Pièce d&apos;origine (grande partie)</label>
            <input className="input" value={nomOrigine} onChange={e => setNomOrigine(e.target.value)} />
            <select className="input mt-1.5" value={typeOrigine} onChange={e => setTypeOrigine(e.target.value as PieceType)}>
              {Object.entries(PIECE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <p className="text-xs text-ink-500 mt-1">Surface utile : <span className="font-semibold text-ink-900">{aireOrigine != null ? `${aireOrigine.toFixed(2)} m²` : "—"}</span></p>
          </div>
          <div className="border-t border-ink-100 pt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="label">Épaisseur cloison (cm)</label>
              <input className="input" inputMode="decimal" value={epaisseur} onChange={e => setEpaisseur(e.target.value)} />
            </div>
            <div>
              <label className="label">Porte dans la cloison</label>
              <select className="input" value={porte ?? ""} onChange={e => setPorte((e.target.value || null) as OptionsCloison["porte"])}>
                <option value="">Aucune</option>
                <option value="porte">Porte battante</option>
                <option value="porte_coulissante">Porte coulissante (sur rail)</option>
                <option value="porte_galandage">Porte à galandage (dans la cloison)</option>
                <option value="ouverture">Passage sans porte</option>
              </select>
            </div>
          </div>
          {!epaisseurValide && <p className="text-xs text-red-500">Épaisseur : entre 5 et 50 cm.</p>}
          {"erreur" in essai && <p className="text-xs text-red-500">{essai.erreur}</p>}
          {!("erreur" in essai) && essai.avertissement && <p className="text-xs text-amber-600">{essai.avertissement}</p>}
          <p className="text-[11px] text-ink-400">
            La cloison devient un mur mitoyen des deux pièces (même épaisseur des deux côtés). Les appareillages, meubles, portes et fenêtres passent dans la pièce qui les contient ;
            les circuits sont à regénérer. Une porte se déplace ensuite en la glissant sur la cloison.
          </p>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200 shrink-0">
          <button disabled={"erreur" in essai || !epaisseurValide || nomNouvelle.trim() === ""} onClick={() => onValidate(opts)}
            className="btn-volt flex-1 disabled:opacity-40"><Save size={14} /> Créer les deux pièces</button>
        </div>
      </div>
    </div>
  );
}

// ─── ZONE : symbole d'une porte posée dans une cloison de zone (plan 2D) ──────────────────────
// Calculé en mètres puis projeté point par point (indépendant de l'orientation de la cloison).
function OuvertureZoneSymbole({ c, o, toScreen, zoom, selectionnee, actif, onDown }: {
  c: CloisonZone; o: Ouverture; toScreen: (p: Point) => Point; zoom: number; selectionnee: boolean; actif: boolean;
  onDown: (e: React.PointerEvent) => void;
}) {
  const couleur = o.type === "fenetre" || o.type === "baie_vitree" ? "#0369A1" : o.type === "ouverture" ? "#78716c" : "#92400E";
  const L = distance(c.a, c.b) || 1, ux = (c.b.x - c.a.x) / L, uy = (c.b.y - c.a.y) / L, nx = -uy, ny = ux;
  const w = o.largeur / 100, s = o.position * L;
  const pt = (along: number, perp: number): Point => ({ x: c.a.x + ux * along + nx * perp, y: c.a.y + uy * along + ny * perp });
  const J0 = pt(s - w / 2, 0), J1 = pt(s + w / 2, 0), centre = pt(s, 0);
  const sg = o.ouvreVersInterieur === false ? -1 : 1;
  const P = (q: Point) => { const e = toScreen(q); return `${e.x},${e.y}`; };
  const e0 = toScreen(J0), e1 = toScreen(J1), ec = toScreen(centre);
  let corps: ReactNode = null;
  if (o.type === "porte") {
    const hingeAlong = o.charniere === "droite" ? s + w / 2 : s - w / 2, autreAlong = o.charniere === "droite" ? s - w / 2 : s + w / 2;
    const hinge = pt(hingeAlong, 0), bout = pt(hingeAlong, sg * w);
    const a1 = Math.atan2(bout.y - hinge.y, bout.x - hinge.x), a2 = Math.atan2(pt(autreAlong, 0).y - hinge.y, pt(autreAlong, 0).x - hinge.x);
    let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const arc = Array.from({ length: 11 }, (_, k) => ({ x: hinge.x + w * Math.cos(a1 + d * (k / 10)), y: hinge.y + w * Math.sin(a1 + d * (k / 10)) }));
    corps = (<>
      <line x1={toScreen(hinge).x} y1={toScreen(hinge).y} x2={toScreen(bout).x} y2={toScreen(bout).y} stroke={couleur} strokeWidth={1.6} />
      <polyline points={arc.map(P).join(" ")} fill="none" stroke={couleur} strokeWidth={1} strokeDasharray="3,2" />
    </>);
  } else if (o.type === "porte_coulissante") {
    const cote = o.coulisseVers === "gauche" ? -1 : 1;
    const q0 = pt(cote > 0 ? s + w / 2 : s - w / 2 - w, 0), q1 = pt(cote > 0 ? s + w / 2 + w : s - w / 2, 0);
    const poche = [q0, q1, { x: q1.x + nx * 0.03, y: q1.y + ny * 0.03 }, { x: q0.x + nx * 0.03, y: q0.y + ny * 0.03 }].map(P).join(" ");
    corps = o.montage === "galandage"
      ? (<>
          <polygon points={poche} fill="none" stroke={couleur} strokeWidth={1} strokeDasharray="3,2" />
          <line x1={e0.x} y1={e0.y} x2={e1.x} y2={e1.y} stroke={couleur} strokeWidth={2} />
        </>)
      : <polygon points={poche} fill={couleur} opacity={0.45} />;
  } else if (o.type === "fenetre" || o.type === "baie_vitree") {
    const nbV = o.type === "baie_vitree" ? nbVantauxBaie(o) : 1;
    corps = (<>
      {Array.from({ length: nbV - 1 }, (_, k) => {
        const sx = s - w / 2 + ((k + 1) * w) / nbV, a0 = toScreen(pt(sx, -0.03)), a1 = toScreen(pt(sx, 0.03));
        return <line key={`vant-${k}`} x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke={couleur} strokeWidth={1} />;
      })}
      <line x1={toScreen(pt(s - w / 2, 0.03)).x} y1={toScreen(pt(s - w / 2, 0.03)).y} x2={toScreen(pt(s + w / 2, 0.03)).x} y2={toScreen(pt(s + w / 2, 0.03)).y} stroke={couleur} strokeWidth={1.5} />
      <line x1={toScreen(pt(s - w / 2, -0.03)).x} y1={toScreen(pt(s - w / 2, -0.03)).y} x2={toScreen(pt(s + w / 2, -0.03)).x} y2={toScreen(pt(s + w / 2, -0.03)).y} stroke={couleur} strokeWidth={1.5} />
    </>);
  } else if (o.type === "porte_garage") {
    corps = <line x1={e0.x} y1={e0.y} x2={e1.x} y2={e1.y} stroke={couleur} strokeWidth={2.5} />;
  } else {
    corps = <line x1={e0.x} y1={e0.y} x2={e1.x} y2={e1.y} stroke={couleur} strokeWidth={1} strokeDasharray="2,2" />;
  }
  const rayon = Math.max(10, (w * PX_PER_M * zoom) / 2 + 4);
  return (
    <g onPointerDown={onDown} style={{ cursor: actif ? "pointer" : "default" }}>
      {corps}
      <circle cx={ec.x} cy={ec.y} r={rayon} fill="transparent" style={{ pointerEvents: actif ? "all" : "none" }} />
      {selectionnee && <circle cx={ec.x} cy={ec.y} r={rayon} fill="none" stroke="#F59E0B" strokeWidth={1.5} style={{ pointerEvents: "none" }} />}
    </g>
  );
}

// ─── ZONE : formulaire de création ────────────────────────────────────────────────────────────
// Nom, épaisseur des cloisons et nature de chaque côté (cloison à monter / limite ouverte). Un côté posé sur un
// mur existant est proposé « ouvert » : le mur est déjà là. La surface se recalcule en direct.
function ZoneForm({ contour, ferme, pieces, onValidate, onCancel }: {
  contour: Point[]; ferme: boolean; pieces: Piece[];
  onValidate: (nom: string, cotes: TypeCoteZone[], epaisseurCm: number) => void; onCancel: () => void;
}) {
  const [nom, setNom] = useState(ferme ? "Dressing" : "Cloison");
  const [epaisseur, setEpaisseur] = useState("10");
  const [cotes, setCotes] = useState<TypeCoteZone[]>(() => cotesParDefaut(contour, ferme, pieces));
  const ep = parseFloat(epaisseur.replace(",", "."));
  const epaisseurValide = ep >= 1 && ep <= 50;
  const apercu: Zone = { id: 0, nom, contour, ferme, cotes, epaisseurCm: epaisseurValide ? ep : 10 };
  const surf = surfaceZone(apercu);
  const longueurTotale = segmentsZone(apercu).reduce((t, sg) => t + distance(sg.a, sg.b), 0);
  const nbCloisons = cotes.filter(c => c === "cloison").length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="card w-full max-w-sm max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200 shrink-0">
          <p className="font-semibold text-ink-900">{ferme ? "Zone" : "Cloison libre"}</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          <div>
            <label className="label">Nom</label>
            <input autoFocus className="input" placeholder={ferme ? "Ex: Dressing, Coin bureau…" : "Ex: Cloison dressing"} value={nom} onChange={e => setNom(e.target.value)} />
            {ferme && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {["Dressing", "Placard", "Bureau", "Buanderie", "Coin repas", "Entrée"].map(n => (
                  <button key={n} type="button" onClick={() => setNom(n)}
                    className={`!text-[11px] px-2 py-0.5 rounded-md border transition-colors ${nom === n ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"}`}>{n}</button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-ink-500">
            {surf
              ? <>Surface utile : <span className="font-semibold text-ink-900">{surf.utile.toFixed(2)} m²</span> <span className="text-ink-400">(tracé à l&apos;axe {surf.brute.toFixed(2)} m²)</span></>
              : <>Longueur : <span className="font-semibold text-ink-900">{longueurTotale.toFixed(2)} m</span> · une cloison libre n&apos;a pas de surface</>}
          </p>
          <div className="border-t border-ink-100 pt-3">
            <label className="label">Épaisseur des cloisons (cm)</label>
            <input className="input !w-24" inputMode="decimal" value={epaisseur} onChange={e => setEpaisseur(e.target.value)} />
            {!epaisseurValide && <p className="text-xs text-red-500 mt-1">Épaisseur : entre 5 et 50 cm.</p>}
          </div>
          {ferme && (
            <div className="border-t border-ink-100 pt-3 flex flex-col gap-1.5">
              <label className="label">Côtés</label>
              {cotes.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="shrink-0 w-28">Côté {i + 1} · {distance(contour[i], contour[(i + 1) % contour.length]).toFixed(2)} m</span>
                  <div className="flex gap-1 flex-1">
                    {(["cloison", "ouvert"] as const).map(t => (
                      <button key={t} type="button" onClick={() => setCotes(arr => arr.map((x, k) => (k === i ? t : x)))}
                        className={`flex-1 !text-xs px-2 py-1 rounded-md border transition-colors ${c === t ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"}`}>
                        {t === "cloison" ? "Cloison" : "Ouvert"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-ink-400">
                « Cloison » = mur à monter, dessiné en épaisseur au plan et en 3D. « Ouvert » = limite virtuelle ou mur déjà existant (proposé automatiquement quand le côté longe un mur).
                {nbCloisons === 0 && " Sans aucune cloison, la zone ne sert qu'à nommer et mesurer un espace."}
              </p>
            </div>
          )}
          <p className="text-[11px] text-ink-400">Les portes se posent ensuite avec l&apos;outil « Porte / fenêtre », en cliquant sur une cloison. Une zone n&apos;est pas une pièce : pas d&apos;appareillage ni de circuit.</p>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200 shrink-0">
          <button disabled={!epaisseurValide || nom.trim() === ""} onClick={() => onValidate(nom, cotes, apercu.epaisseurCm)}
            className="btn-volt flex-1 disabled:opacity-40"><Save size={14} /> Créer</button>
        </div>
      </div>
    </div>
  );
}

// Enveloppe déplaçable pour les panneaux flottants (info pièce/appareillage/tableau/
// ouverture/coude, circuits manuels, légende des circuits, dessin de cheminement) — une
// poignée fine en haut (grip) permet de les glisser n'importe où sur l'écran pour ne plus
// gêner la vue du plan. Position de départ = son coin d'origine (corner) ; le déplacement
// est un simple offset (translate) appliqué par-dessus, remis à zéro à chaque réouverture
// du panneau (le composant est démonté/remonté avec la sélection qu'il représente).
// dark : bandeau à fond sombre (ex. dessin de cheminement) — adapte la couleur de la poignée.
function DraggablePanel({ corner, className, dark, children }: {
  corner: "bl" | "br" | "tr" | "tc";
  className: string;
  dark?: boolean;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });
  // minDy calculé UNE SEULE FOIS au moment où on attrape la poignée (pas à chaque
  // pointermove — relire le DOM et ré-enregistrer les écouteurs à chaque pixel déplacé
  // rendait le glisser-déposer saccadé, voire bloqué).
  const dragRef = useRef<{ x: number; y: number; dx: number; dy: number; minDy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = dragRef.current.dx + (e.clientX - dragRef.current.x);
      const dy = Math.max(dragRef.current.minDy, dragRef.current.dy + (e.clientY - dragRef.current.y));
      setOffset({ dx, dy });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const cornerClass = corner === "bl" ? "bottom-4 left-4" : corner === "br" ? "bottom-4 right-4" : corner === "tr" ? "top-4 right-4" : "top-4 left-1/2";
  // "tc" (top-center) a besoin d'un -50% de centrage en plus de l'offset de glisser-déposer —
  // les deux se composent dans un seul transform (translations pures : l'ordre n'a pas d'importance).
  const transform = `${corner === "tc" ? "translateX(-50%) " : ""}translate(${offset.dx}px, ${offset.dy}px)`;
  // Un panneau ancré en bas ("bl"/"br") grandit VERS LE HAUT avec son contenu — sur un
  // écran bas ou un panneau chargé (beaucoup de champs), sa poignée du haut peut se
  // retrouver nativement derrière la barre d'outils, SANS même avoir été déplacée. On
  // plafonne sa hauteur et on force un défilement interne pour que ça n'arrive jamais —
  // en dur ici, plutôt que de compter sur chaque appelant pour le faire dans className
  // (la plupart ne le faisaient pas).
  const maxHeightStyle = (corner === "bl" || corner === "br")
    ? { maxHeight: "calc(100dvh - 88px)", overflowY: "auto" as const }
    : undefined;

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    // On peut attraper le panneau n'importe où — sauf sur un champ, bouton, lien ou
    // élément marqué data-no-drag, qui doivent garder leur comportement de clic normal.
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, button, a, label, [data-no-drag]")) return;
    e.stopPropagation();
    const rect = panelRef.current?.getBoundingClientRect();
    const margeHaut = 72; // hauteur approx. de la barre d'outils du haut
    // Le plus petit dy permis tel que le haut du panneau ne passe jamais sous margeHaut :
    // top_base + dy >= margeHaut, avec top_base = rect.top - offset.dy (position actuelle
    // moins l'offset déjà appliqué) => dy >= margeHaut - top_base.
    const minDy = rect ? margeHaut - (rect.top - offset.dy) : -Infinity;
    dragRef.current = { x: e.clientX, y: e.clientY, dx: offset.dx, dy: offset.dy, minDy };
  };

  return (
    <div ref={panelRef} className={`absolute ${cornerClass} z-30`} style={{ transform }}>
      <div className={className} style={{ ...maxHeightStyle, cursor: "grab", touchAction: "none" }}
        onPointerDown={startDrag}>
        <div className={`flex items-center justify-center h-4 -mx-3 -mt-3 mb-2 rounded-t-xl ${dark ? "bg-white/10 hover:bg-white/20" : "bg-ink-100 hover:bg-ink-200"}`}>
          <GripHorizontal size={12} className={dark ? "text-white/50" : "text-ink-400"} />
        </div>
        {children}
      </div>
    </div>
  );
}

function EtiquetteLongueur({ aPx, bPx, texte, onClick, actif, normale }: {
  aPx: Point; bPx: Point; texte: string; onClick?: () => void; actif?: boolean; normale?: Point;
}) {
  const mx = (aPx.x + bPx.x) / 2, my = (aPx.y + bPx.y) / 2;
  const dx = bPx.x - aPx.x, dy = bPx.y - aPx.y;
  const len = Math.hypot(dx, dy) || 1;
  // normale (écran, unitaire) imposée = vers l'intérieur de la pièce ; sinon, normale gauche du segment.
  const nx = normale ? normale.x : -dy / len, ny = normale ? normale.y : dx / len;
  const lx = mx + nx * 9, ly = my + ny * 9;
  const w = Math.max(28, texte.length * 6 + 6);
  return (
    <g transform={`translate(${lx}, ${ly})`}
      onPointerDown={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      style={{ cursor: onClick ? "pointer" : "default" }}>
      <rect x={-w / 2} y={-7} width={w} height={14} rx={3}
        fill={actif ? "#F59E0B" : "white"} stroke={actif ? "#F59E0B" : "#d6d3d1"} strokeWidth={1} opacity={0.95} />
      <text x={0} y={4} textAnchor="middle" fontSize={9} fontFamily="monospace" fontWeight={600}
        fill={actif ? "#1c1917" : "#57534e"} style={{ pointerEvents: "none" }}>{texte}</text>
    </g>
  );
}

// Hauteur (cm) d'une section de circuit : vide = non réglée ; validée à la sortie du champ (Entrée / clic ailleurs).
function ChampHauteurTroncon({ valeur, onChange, cle }: { valeur: number | undefined; onChange: (cm: number | undefined) => void; cle: string }) {
  return (
    <input key={`${cle}-${valeur ?? "auto"}`} className="input !py-1 !text-xs !w-16" inputMode="numeric" placeholder="auto" defaultValue={valeur ?? ""}
      onBlur={e => { const t = e.target.value.trim().replace(",", "."); const v = t === "" ? undefined : parseFloat(t); onChange(v != null && v >= 0 && v <= 400 ? Math.round(v) : undefined); }}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

// Champs d'édition d'UN mur : les 3 couches, de l'intérieur de la pièce vers l'extérieur (cm).
// 1 = finition, 2 = doublage (les circuits y passent par défaut), 3 = structure. 0 = couche absente.
type SaisieMur = { finition: string; doublage: string; epaisseur: string };
const saisieDepuisMur = (m: MurSpec): SaisieMur => ({ finition: String(m.finition ?? 0), doublage: String(m.doublage), epaisseur: String(m.epaisseur) });
function murDepuisSaisie(s: SaisieMur): MurSpec | null {
  const num = (t: string) => t.trim() === "" ? 0 : parseFloat(t.replace(",", "."));
  const f = num(s.finition), d = num(s.doublage), e = num(s.epaisseur);
  if (!(e >= 0 && e <= 200) || !(d >= 0 && d <= 100) || !(f >= 0 && f <= 50)) return null;
  return { epaisseur: Math.round(e * 10) / 10, doublage: Math.round(d * 10) / 10, finition: Math.round(f * 10) / 10 };
}
function ChampsMur({ valeur, onChange, disabled }: {
  valeur: SaisieMur; onChange: (v: SaisieMur) => void; disabled?: boolean; compact?: boolean;
}) {
  const ok = murDepuisSaisie(valeur) != null;
  const cls = `input !py-1 !text-xs !w-14 ${ok ? "" : "!border-red-400"}`;
  const champs: [keyof SaisieMur, string, string][] = [
    ["finition", "1 · Finition", "Couche 1, côté pièce : plaque de plâtre, enduit, parement…"],
    ["doublage", "2 · Doublage", "Couche 2 : isolant / vide technique — les circuits y passent par défaut"],
    ["epaisseur", "3 · Structure", "Couche 3, contre le tracé : maçonnerie, ossature, cloison (0 = aucun mur de ce côté)"],
  ];
  return (
    <div className="flex items-end gap-2 flex-wrap">
      {champs.map(([k, lib, aide]) => (
        <label key={k} className="flex flex-col gap-0.5 text-[10px] text-ink-500" title={aide}>
          {lib}
          <input className={cls} inputMode="decimal" disabled={disabled} value={valeur[k]} onChange={e => onChange({ ...valeur, [k]: e.target.value })} />
        </label>
      ))}
    </div>
  );
}

function SegmentLengthForm({ longueurActuelle, murActuel, onValidate, onCancel }: {
  longueurActuelle: number; murActuel: MurSpec;
  onValidate: (nouvelleLongueurCm: number, mur: MurSpec) => void; onCancel: () => void;
}) {
  // Longueur INTÉRIEURE (face finie à face finie) en centimètres entiers, renvoyée en cm ; + épaisseurs du mur.
  const [valeur, setValeur] = useState(String(enCm(longueurActuelle)));
  const [saisieMur, setSaisieMur] = useState<SaisieMur>(saisieDepuisMur(murActuel));
  const cm = parseFloat(valeur.replace(",", "."));
  const mur = murDepuisSaisie(saisieMur);
  const valide = !isNaN(cm) && cm >= 1 && mur != null;
  const num = Math.round(cm);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="card w-full max-w-xs" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">Mur</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div>
            <label className="label">Longueur intérieure (cm)</label>
            <input autoFocus className="input" inputMode="numeric" value={valeur}
              onChange={e => setValeur(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && valide && mur) onValidate(num, mur); }} />
          </div>
          <div>
            <label className="label">Les 3 couches du mur (cm), de l&apos;intérieur vers l&apos;extérieur</label>
            <ChampsMur valeur={saisieMur} onChange={setSaisieMur} />
            <p className="text-[11px] text-ink-400 mt-1.5">Longueur mesurée de face finie à face finie. Les couches s&apos;ajoutent à l&apos;intérieur du tracé (0 = aucune) ; les circuits passent par défaut dans la couche 2.</p>
          </div>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button disabled={!valide} onClick={() => mur && onValidate(num, mur)} className="btn-volt flex-1 disabled:opacity-40">Valider</button>
        </div>
      </div>
    </div>
  );
}

function NiveauForm({ onValidate, onCancel }: { onValidate: (nom: string, type: NiveauType, hauteurPlafond: number) => void; onCancel: () => void }) {
  const [nom, setNom] = useState("");
  const [type, setType] = useState<NiveauType>("etage");
  const [hauteurPlafond, setHauteurPlafond] = useState("2.50");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="card w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">Nouveau niveau</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div>
            <label className="label">Nom</label>
            <input autoFocus className="input" placeholder={type === "annexe" ? "Ex: Pool house, Garage indépendant…" : "Ex: R+1, Combles…"} value={nom} onChange={e => setNom(e.target.value)} />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={type} onChange={e => setType(e.target.value as NiveauType)}>
              {Object.entries(NIVEAU_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <p className="text-[11px] text-ink-400 mt-1">
              {type === "annexe"
                ? "Une annexe (pool house, dépendance…) a son propre tableau électrique, à positionner sur son plan."
                : "Les niveaux de la maison partagent un seul tableau : pour chacun, tu renseignes sa distance au tableau."}
            </p>
          </div>
          <div>
            <label className="label">Hauteur sous plafond (m) — pour la vue 3D</label>
            <input className="input" inputMode="decimal" value={hauteurPlafond} onChange={e => setHauteurPlafond(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button onClick={() => onValidate(nom, type, parseFloat(hauteurPlafond.replace(",", ".")) || 2.5)} className="btn-volt flex-1"><Save size={14} /> Ajouter</button>
        </div>
      </div>
    </div>
  );
}

function CommandeLinkForm({ niveau, item, onValidate, onCancel }: {
  niveau: Niveau; item: AppareillagePlace;
  onValidate: (pointLumineuxIds: number[], pointLumineuxIds2: number[]) => void; onCancel: () => void;
}) {
  const points = niveau.pieces.flatMap(p =>
    p.appareillages.filter(a => estLumiere(a.type)).map(a => ({ a, pieceNom: p.nom })));
  const double = estCommandeDouble(item.type);
  // Double : chaque lampe va sur la voie 1, la voie 2 ou aucune (jamais les deux). Par défaut, voie 1 = 1re lampe, voie 2 = 2e.
  const [choix, setChoix] = useState<number[]>(item.commandePourIds ?? (points[0] ? [points[0].a.id] : []));
  const [choix2, setChoix2] = useState<number[]>(item.commandePourIds2 ?? (double && !item.commandePourIds && points[1] ? [points[1].a.id] : []));
  const toggle = (id: number) => setChoix(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id]);
  const setVoie = (id: number, voie: 1 | 2) => {
    const dansVoie = (voie === 1 ? choix : choix2).includes(id);
    setChoix(c => c.filter(x => x !== id).concat(voie === 1 && !dansVoie ? [id] : []));
    setChoix2(c => c.filter(x => x !== id).concat(voie === 2 && !dansVoie ? [id] : []));
  };
  const total = choix.length + (double ? choix2.length : 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="card w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">{labelAppareillage(item.type)} — quel(s) point(s) lumineux ?</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-1 max-h-64 overflow-y-auto">
          {double && points.length > 0 && <p className="text-[11px] text-ink-400 mb-1">Un double a deux voies : chaque lampe se règle sur la voie 1 ou la voie 2.</p>}
          {points.length === 0 ? (
            <p className="text-sm text-ink-400">Aucun point lumineux placé sur ce niveau. Place d'abord un ou plusieurs points lumineux, puis leur commande.</p>
          ) : points.map(({ a, pieceNom }) => double ? (
            <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-ink-50">
              <span className="text-sm text-ink-700 flex-1 min-w-0 truncate">{pieceNom || "Pièce"} — {a.nom || `point lumineux #${a.id}`}</span>
              {([1, 2] as const).map(v => (
                <button key={v} onClick={() => setVoie(a.id, v)}
                  className={`${(v === 1 ? choix : choix2).includes(a.id) ? "btn-volt" : "btn-ghost"} !text-xs !px-2 !py-0.5 shrink-0`}>Voie {v}</button>
              ))}
            </div>
          ) : (
            <label key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-ink-50 cursor-pointer">
              <input type="checkbox" checked={choix.includes(a.id)} onChange={() => toggle(a.id)} />
              <span className="text-sm text-ink-700">{pieceNom || "Pièce"} — {a.nom || `point lumineux #${a.id}`}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button disabled={total === 0} onClick={() => onValidate(choix, double ? choix2 : [])} className="btn-volt flex-1 disabled:opacity-40">
            {double ? `Lier (voie 1 : ${choix.length} · voie 2 : ${choix2.length})` : `Lier (${choix.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function CircuitManuelForm({ niveau, existing, onValidate, onCancel, onDelete }: {
  niveau: Niveau;
  existing: CircuitManuel | null; // null = création, sinon édition de ce circuit
  onValidate: (nom: string, famille: FamilleCircuitManuel, couleur: string | undefined, membreIds: number[], creerBoite: boolean, nonRelieTableau: boolean) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [nom, setNom] = useState(existing?.nom ?? "");
  const [famille, setFamille] = useState<FamilleCircuitManuel>(existing?.famille ?? "prise_16");
  const [couleur, setCouleur] = useState(existing?.couleur ?? "");
  const [creerBoite, setCreerBoite] = useState(false);
  const [nonRelieTableau, setNonRelieTableau] = useState(existing?.nonRelieTableau ?? false);
  const tousAppareils = niveau.pieces.flatMap(p => p.appareillages.filter(a => a.type !== "rj45").map(a => ({ a, pieceNom: p.nom }))); // RJ45 : courant faible, pas de circuit de puissance
  const [membres, setMembres] = useState<Set<number>>(
    () => new Set(existing ? tousAppareils.filter(({ a }) => a.circuitManuelId === existing.id).map(({ a }) => a.id) : []),
  );
  const toggleMembre = (id: number) => setMembres(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const nomValide = nom.trim() !== "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="card w-full max-w-md max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">{existing ? "Modifier le circuit manuel" : "Nouveau circuit manuel"}</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1">
          <div>
            <label className="label">Nom</label>
            <input autoFocus className="input" placeholder="Ex: Prises salon nord" value={nom} onChange={e => setNom(e.target.value)} />
          </div>
          <div>
            <label className="label">Type de circuit</label>
            <select className="input" value={famille} onChange={e => setFamille(e.target.value)}>
              {CIRCUIT_KEYS_MANUELS.map(k => <option key={k} value={k}>{CIRCUITS[k].icon} {CIRCUITS[k].label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Couleur — vide = couleur automatique</label>
            <div className="flex items-center gap-2">
              <input type="color" className="w-10 h-8 rounded-lg border border-ink-200 cursor-pointer p-0"
                value={couleur || "#78716c"} onChange={e => setCouleur(e.target.value)} />
              {couleur && <button onClick={() => setCouleur("")} className="text-xs text-ink-400 underline">Réinitialiser</button>}
            </div>
          </div>
          {!existing && famille === "lumiere" && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={creerBoite} onChange={e => setCreerBoite(e.target.checked)} />
              <span className="text-sm text-ink-700">Créer une boîte de dérivation pour ce circuit</span>
            </label>
          )}
          <label className="flex items-center gap-2 cursor-pointer border-t border-ink-100 pt-2">
            <input type="checkbox" checked={nonRelieTableau} onChange={e => setNonRelieTableau(e.target.checked)} />
            <span className="text-sm text-ink-700">Circuit déjà existant — non relié au tableau (piquage sur une installation en place)</span>
          </label>
          {nonRelieTableau && (
            <p className="text-xs text-ink-400 -mt-1.5">Aucun disjoncteur n'est ajouté au tableau pour ce circuit, et le câblage n'est tracé qu'entre ses appareillages — jamais jusqu'au tableau.</p>
          )}
          <div>
            <label className="label">Appareillages sur ce circuit ({membres.size})</label>
            <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto border border-ink-100 rounded-lg p-1.5">
              {tousAppareils.length === 0 ? (
                <p className="text-xs text-ink-400 px-1 py-1">Aucun appareillage sur ce niveau.</p>
              ) : tousAppareils.map(({ a, pieceNom }) => (
                <label key={a.id} className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-ink-50 cursor-pointer text-xs">
                  <input type="checkbox" checked={membres.has(a.id)} onChange={() => toggleMembre(a.id)} />
                  <AppareillageSymbol type={a.type} size={14} />
                  <span className="text-ink-700 truncate flex-1">{pieceNom || "Pièce"} — {a.nom || labelAppareillagePlace(a)}</span>
                  {a.circuitManuelId != null && a.circuitManuelId !== existing?.id && (
                    <span className="text-[10px] text-amber-600 shrink-0 whitespace-nowrap">déjà sur un autre circuit</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200 shrink-0">
          <button disabled={!nomValide} onClick={() => onValidate(nom.trim(), famille, couleur || undefined, Array.from(membres), creerBoite, nonRelieTableau)}
            className="btn-volt flex-1 disabled:opacity-40"><Save size={14} /> {existing ? "Enregistrer" : "Créer"}</button>
          {onDelete && <button onClick={onDelete} className="btn-danger !px-3"><Trash2 size={14} /></button>}
        </div>
      </div>
    </div>
  );
}

// ─── PALETTE ────────────────────────────────────────────────────────────────────

// Icône simple porte/fenêtre — pas de symbole normalisé dédié, juste de quoi
// distinguer les deux boutons et l'ouverture posée sur le plan.
// Aide courte affichée sous le choix du type de porte.
function u_aide(u: UsagePorte): string {
  return u === "entree" ? "Porte principale (pleine, seuil, serrure) — s'ouvre en 3D en cliquant dessus."
    : u === "service" ? "Porte secondaire sur l'extérieur (vitrée en partie haute, seuil) — s'ouvre en 3D."
    : "Porte entre deux pièces — s'ouvre en 3D en cliquant dessus.";
}

const LABEL_OUVERTURE: Record<OuvertureType, string> = {
  porte: "Porte", porte_coulissante: "Porte coulissante", porte_garage: "Porte de garage basculante", baie_vitree: "Baie vitrée coulissante", fenetre: "Fenêtre (1 ou 2 battants)", ouverture: "Ouverture murale",
};

function OuvertureIcon({ type, size = 16, color = "currentColor" }: { type: OuvertureType; size?: number; color?: string }) {
  switch (type) {
    case "porte":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path d="M3 14V2l9 2v10" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
          <path d="M3 14 A9 9 0 0 0 12 5" stroke={color} strokeWidth={1} strokeDasharray="1.5,1.3" />
        </svg>
      );
    case "porte_coulissante":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <rect x={1} y={3} width={6} height={10} stroke={color} strokeWidth={1.3} />
          <rect x={7} y={3} width={6} height={10} stroke={color} strokeWidth={1.3} strokeDasharray="1.4,1.2" />
          <path d="M9 1 h3 M12 1 l-1.6 -1.2 M12 1 l-1.6 1.2" stroke={color} strokeWidth={0.9} />
        </svg>
      );
    case "porte_garage":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <rect x={2} y={4} width={12} height={10} stroke={color} strokeWidth={1.4} />
          <path d="M2 7h12M2 10h12" stroke={color} strokeWidth={1} />
          <path d="M5 2.5 L8 1 L11 2.5" stroke={color} strokeWidth={0.9} />
        </svg>
      );
    case "baie_vitree":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <rect x={1.5} y={2.5} width={13} height={11} stroke={color} strokeWidth={1.4} />
          <path d="M8 2.5v11" stroke={color} strokeWidth={1.2} />
          <path d="M3.5 8h3M5.3 6.6L6.7 8l-1.4 1.4" stroke={color} strokeWidth={0.9} />
        </svg>
      );
    case "fenetre":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <rect x={2} y={4} width={12} height={8} stroke={color} strokeWidth={1.4} />
          <path d="M8 4v8M2 8h12" stroke={color} strokeWidth={1.2} />
        </svg>
      );
    case "ouverture":
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <rect x={2} y={3} width={12} height={10} stroke={color} strokeWidth={1.2} strokeDasharray="2,1.5" />
        </svg>
      );
  }
}


// Configurateur d'appareillage multiple : nombre de postes (2 à 4) puis, pour chaque poste, ce qu'il porte
// (prise, prise commandée, interrupteur, va-et-vient, bouton poussoir, RJ45, prise dédiée + appareil alimenté).
function PlaqueForm({ initial, onValider, onCancel }: {
  initial: PosteSpec[]; onValider: (postes: PosteSpec[]) => void; onCancel: () => void;
}) {
  const [postes, setPostes] = useState<PosteSpec[]>(initial.length >= MIN_POSTES_PLAQUE ? initial : [{ type: "prise" }, { type: "prise" }]);
  const nomPlaque = (n: number) => n === 2 ? "double" : n === 3 ? "triple" : "quadruple";
  const changerNombre = (n: number) => setPostes(ps => n <= ps.length ? ps.slice(0, n) : [...ps, ...Array.from({ length: n - ps.length }, (): PosteSpec => ({ type: "prise" }))]);
  const majPoste = (i: number, patch: Partial<PosteSpec>) => setPostes(ps => ps.map((po, k) => {
    if (k !== i) return po;
    const type = patch.type ?? po.type;
    return { type, ...(type === "prise_dediee" ? { usageDedie: patch.usageDedie ?? po.usageDedie ?? USAGE_DEDIE_DEFAUT } : {}) };
  }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="card w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">Appareillage {nomPlaque(postes.length)} ({postes.length} postes)</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs text-ink-500">
            <span className="shrink-0">Nombre de postes</span>
            {[2, 3, 4].map(n => (
              <button key={n} onClick={() => changerNombre(n)}
                className={`${postes.length === n ? "btn-volt" : "btn-ghost"} !text-xs !py-1 flex-1 justify-center`}>
                {n === 2 ? "Double" : n === 3 ? "Triple" : "Quadruple"}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-center gap-1 py-2 bg-ink-50 rounded-lg border border-ink-200">
            {postes.map((po, i) => (
              <div key={i} className="w-12 h-12 bg-white border border-ink-300 rounded flex items-center justify-center">
                <AppareillageSymbol type={po.type} size={24} />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
            {postes.map((po, i) => (
              <div key={i} className="flex flex-col gap-1 p-2 rounded-lg border border-ink-200">
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="shrink-0 w-14">Poste {i + 1}</span>
                  <select className="input !py-1 !text-xs flex-1" value={po.type}
                    onChange={e => majPoste(i, { type: e.target.value as AppareillageType })}>
                    {TYPES_POSTE_PLAQUE.map(t => <option key={t} value={t}>{labelAppareillage(t)}</option>)}
                  </select>
                </div>
                {po.type === "prise_dediee" && (
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0 w-14">Appareil</span>
                    <select className="input !py-1 !text-xs flex-1" value={po.usageDedie ?? USAGE_DEDIE_DEFAUT}
                      onChange={e => majPoste(i, { usageDedie: e.target.value as AppareillageType })}>
                      {TYPES_USAGE_DEDIE.map(t => <option key={t} value={t}>{LIBELLE_USAGE_DEDIE[t]}</option>)}
                    </select>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-ink-400">Les postes sont placés côte à côte (entraxe 71 mm), même hauteur, une seule boîte d'encastrement et une seule plaque. Chaque poste garde son propre circuit.</p>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button onClick={() => onValider(postes)} className="btn-volt flex-1">Placer sur un mur</button>
        </div>
      </div>
    </div>
  );
}

function PaletteBoutons({ placementType, onSelect, plaquePostes, onPlaque }: {
  placementType: AppareillageType | null; onSelect: (t: AppareillageType | null) => void;
  plaquePostes: PosteSpec[] | null; onPlaque: () => void;
}) {
  const categories = Array.from(new Set(PALETTE.map(p => p.categorie)));
  const plaqueActive = !!placementType && !!plaquePostes;
  return (
    <>
      <div className="mb-3">
        <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Appareillage multiple</p>
        <button onClick={onPlaque}
          className={`w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
            plaqueActive ? "bg-ink-900 border-ink-700 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-700 hover:border-ink-400"}`}>
          <span className="flex items-center gap-0.5">
            {(plaqueActive ? plaquePostes! : [{ type: "prise" as AppareillageType }, { type: "interrupteur" as AppareillageType }]).map((po, i) => (
              <AppareillageSymbol key={i} type={po.type} size={14} color={plaqueActive ? "#FBBF24" : "#44403c"} />
            ))}
          </span>
          {plaqueActive ? `Plaque ${plaquePostes!.length} postes — modifier` : "Double · triple · quadruple…"}
        </button>
      </div>
      {categories.map(cat => (
        <div key={cat} className="mb-3">
          <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">{cat}</p>
          <div className="grid grid-cols-5 md:grid-cols-4 gap-1.5">
            {PALETTE.filter(p => p.categorie === cat).map(p => (
              <button key={p.type} title={p.label}
                onClick={() => onSelect(placementType === p.type ? null : p.type)}
                className={`flex items-center justify-center p-1.5 rounded-lg border transition-colors shrink-0 ${
                  placementType === p.type ? "bg-ink-900 border-ink-700" : "bg-ink-50 border-ink-200 hover:border-ink-400"
                }`}>
                <AppareillageSymbol type={p.type} size={18} color={placementType === p.type ? "#FBBF24" : "#44403c"} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function PrintForm({ niveaux, resultatDisponible, onValider, onCancel }: {
  niveaux: Niveau[]; resultatDisponible: boolean;
  onValider: (piecesSelectionnees: Set<number> | null, avecCircuits: boolean, avecLongueurs: boolean, avecHauteurs: boolean, avecCotes: boolean, avecCotesPieces: boolean, avecCotesExt: boolean, avecCotesOuv: boolean) => void;
  onCancel: () => void;
}) {
  const toutesPieces = niveaux.flatMap(n => n.pieces.map(p => p.id));
  const [selection, setSelection] = useState<Set<number>>(new Set(toutesPieces));
  const [avecCircuits, setAvecCircuits] = useState(resultatDisponible);
  const [avecLongueurs, setAvecLongueurs] = useState(false);
  const [avecHauteurs, setAvecHauteurs] = useState(false);
  const [avecCotes, setAvecCotes] = useState(false);
  const [avecCotesPieces, setAvecCotesPieces] = useState(false);
  const [avecCotesExt, setAvecCotesExt] = useState(false);
  const [avecCotesOuv, setAvecCotesOuv] = useState(false);
  const toutSelectionne = selection.size === toutesPieces.length;

  const toggle = (id: number) => setSelection(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="card w-full max-w-sm max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">Imprimer le plan</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1">
          <div className="flex items-center justify-between">
            <label className="label mb-0">Pièces à inclure</label>
            <button className="text-xs text-volt-600 font-semibold"
              onClick={() => setSelection(toutSelectionne ? new Set() : new Set(toutesPieces))}>
              {toutSelectionne ? "Tout désélectionner" : "Tout sélectionner"}
            </button>
          </div>
          {[...niveaux].sort((a, b) => a.ordre - b.ordre).map(n => (
            <div key={n.id} className="border border-ink-200 rounded-xl overflow-hidden">
              <div className="px-3 py-1.5 bg-ink-100 text-xs font-bold text-ink-700 font-mono">{n.nom || NIVEAU_TYPES[n.type]}</div>
              <div className="p-2 flex flex-col gap-0.5">
                {n.pieces.length === 0 ? (
                  <p className="text-xs text-ink-400 px-2 py-1">Aucune pièce</p>
                ) : n.pieces.map(p => (
                  <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-ink-50 cursor-pointer">
                    <input type="checkbox" checked={selection.has(p.id)} onChange={() => toggle(p.id)} />
                    <span className="text-sm text-ink-700">{p.nom || PIECE_TYPES[p.type].label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-1.5 pt-2 border-t border-ink-100">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={avecHauteurs} onChange={e => setAvecHauteurs(e.target.checked)} />
              <span className="text-sm text-ink-700">Afficher les hauteurs d'implantation (appareillages + gaines)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={avecCotes} onChange={e => setAvecCotes(e.target.checked)} />
              <span className="text-sm text-ink-700">Afficher les cotes des appareillages (cm, depuis le coin intérieur le plus proche)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={avecCotesPieces} onChange={e => setAvecCotesPieces(e.target.checked)} />
              <span className="text-sm text-ink-700">Afficher les cotes des pièces (dimensions intérieures + épaisseurs de murs)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={avecCotesOuv} onChange={e => setAvecCotesOuv(e.target.checked)} />
              <span className="text-sm text-ink-700">Afficher les cotes des ouvertures (chaîne coin → baie → coin)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={avecCotesExt} onChange={e => setAvecCotesExt(e.target.checked)} />
              <span className="text-sm text-ink-700">Afficher les cotes extérieures (murs extérieurs + hors-tout)</span>
            </label>
            {resultatDisponible && (
              <>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={avecCircuits}
                    onChange={e => { const v = e.target.checked; setAvecCircuits(v); if (!v) setAvecLongueurs(false); }} />
                  <span className="text-sm text-ink-700">Inclure les circuits (couleurs + gaines)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={avecLongueurs} disabled={!avecCircuits} onChange={e => setAvecLongueurs(e.target.checked)} />
                  <span className={`text-sm ${avecCircuits ? "text-ink-700" : "text-ink-300"}`}>Afficher la longueur de chaque segment de circuit</span>
                </label>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200 shrink-0">
          <button disabled={selection.size === 0}
            onClick={() => onValider(toutSelectionne ? null : selection, avecCircuits, avecLongueurs, avecHauteurs, avecCotes, avecCotesPieces, avecCotesExt, avecCotesOuv)}
            className="btn-volt flex-1 disabled:opacity-40">
            <Printer size={14} /> Imprimer ({selection.size} pièce{selection.size > 1 ? "s" : ""})
          </button>
        </div>
      </div>
    </div>
  );
}

function Print3DForm({ niveaux, niveauActifId, onValider, onCancel }: {
  niveaux: Niveau[]; niveauActifId: number | null;
  onValider: (niveauId: number) => void; onCancel: () => void;
}) {
  const [choix, setChoix] = useState<number>(niveauActifId ?? niveaux[0]?.id);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="card w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">Imprimer la vue 3D</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4">
          <label className="label">Niveau à imprimer</label>
          <select className="input" value={choix} onChange={e => setChoix(Number(e.target.value))}>
            {[...niveaux].sort((a, b) => a.ordre - b.ordre).map(n => (
              <option key={n.id} value={n.id}>{n.nom || NIVEAU_TYPES[n.type]}</option>
            ))}
          </select>
          <p className="text-xs text-ink-400 mt-2">L'impression 3D capture la vue actuelle (circuits inclus si affichés) d'un niveau à la fois.</p>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button onClick={() => onValider(choix)} className="btn-volt flex-1"><Printer size={14} /> Imprimer</button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function PlanPage() {
  const params = useParams();
  const clientId = params.clientId as string;
  const { projets, projet, loading, changerProjet, recharger } = useProjets(clientId);
  // Recharge la liste (données fraîches de chaque projet) puis bascule : la clé force un
  // remontage complet de l'éditeur, donc aucun état d'un projet ne fuit dans l'autre.
  const choisir = async (id: string | null) => { await recharger(id ?? undefined); if (id) changerProjet(id); };
  if (loading) return <Shell><div className="flex items-center justify-center h-64 text-ink-400">Chargement…</div></Shell>;
  if (!projet) return <Shell><div className="p-8 text-center text-ink-500">Impossible de charger le projet de ce client. Vérifie que la migration 002_projets.sql a bien été exécutée.</div></Shell>;
  return <PlanEditor key={projet.id} clientId={clientId} projet={projet} projets={projets} onSelect={choisir} onChanged={choisir} />;
}

function PlanEditor({ clientId, projet, projets, onSelect, onChanged }: {
  clientId: string; projet: Projet; projets: Projet[];
  onSelect: (id: string) => Promise<void> | void; onChanged: (id: string | null) => Promise<void> | void;
}) {

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [niveaux, setNiveaux] = useState<Niveau[]>([]);
  const [niveauActifId, setNiveauActifId] = useState<number | null>(null);
  const [showNiveauForm, setShowNiveauForm] = useState(false);
  const [confirmSuppNiveau, setConfirmSuppNiveau] = useState(false);
  const [suppNiveauEnCours, setSuppNiveauEnCours] = useState(false);

  const [mode, setMode] = useState<"select" | "dessiner" | "cloison" | "zone">("select");
  // Outil cloison : points déjà posés (le 1er est sur un mur) ; tracé validé en attente du formulaire.
  const [cloisonPoints, setCloisonPoints] = useState<Point[]>([]);
  const [cloisonEnAttente, setCloisonEnAttente] = useState<{ pieceId: number; chemin: Point[] } | null>(null);
  // Outil zone : points déjà posés, tracé validé en attente du formulaire, zone / porte de zone sélectionnée.
  const [zonePoints, setZonePoints] = useState<Point[]>([]);
  const [zoneEnAttente, setZoneEnAttente] = useState<{ contour: Point[]; ferme: boolean } | null>(null);
  // Outil « Cloison » : même moteur que les zones, mais ne trace qu'un mur libre (polyligne) — il ne modifie jamais
  // une pièce existante. true = outil Cloison actif ; false = outil Zone (polygone nommé).
  const [zoneCloisonSeule, setZoneCloisonSeule] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const [selectedZoneOuv, setSelectedZoneOuv] = useState<{ zoneId: number; ouvId: number } | null>(null);
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  // Dessin d'une pièce : rectangle à 4 côtés (2 clics) ou forme libre point par point.
  const [formeDessin, setFormeDessin] = useState<"libre" | "rectangle">("rectangle");
  const [alignMurs, setAlignMurs] = useState(true);
  const [alignSeg, setAlignSeg] = useState<ResultatAlignMurs | null>(null);
  reglageAimant.murs = alignMurs;
  const [pendingContour, setPendingContour] = useState<Point[] | null>(null);
  const [cursorPx, setCursorPx] = useState<Point | null>(null);

  const [selectedPieceId, setSelectedPieceId] = useState<number | null>(null);
  // Incrémenté à CHAQUE clic de sélection (même sur un élément déjà sélectionné) — inclus
  // dans la clé des DraggablePanel de sélection (voir plus bas) pour forcer leur
  // réinitialisation à la position par défaut à chaque ouverture, y compris en recliquant
  // sur le même élément sans être passé par une désélection entre-temps (auquel cas React
  // ne remonterait pas le composant tout seul, puisque rien d'autre n'aurait changé).
  const [panelResetTick, setPanelResetTick] = useState(0);
  const [editingPiece, setEditingPiece] = useState<Piece | null>(null);
  const [editingSegment, setEditingSegment] = useState<{ pieceId: number; segIndex: number } | null>(null);
  const [snapGuide, setSnapGuide] = useState<{ x?: number; y?: number } | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>({ kind: "none" });

  const [placementType, setPlacementType] = useState<AppareillageType | null>(null);
  // Appareillage multiple : composition de la plaque en cours de pose (null = pose d'un appareillage simple).
  // Ignorée dès que placementType est null — armerPlacement() la remet à null pour une pose simple.
  const [plaquePostes, setPlaquePostes] = useState<PosteSpec[] | null>(null);
  const [plaqueFormOuvert, setPlaqueFormOuvert] = useState(false);
  const [plaqueConfig, setPlaqueConfig] = useState<PosteSpec[]>([{ type: "prise" }, { type: "prise" }]);
  const [placingTableau, setPlacingTableau] = useState(false);
  const [placingPointArrivee, setPlacingPointArrivee] = useState(false);
  const [placingMeuble, setPlacingMeuble] = useState(false);
  const [pendingCommande, setPendingCommande] = useState<{ item: AppareillagePlace; estNouveau: boolean } | null>(null);
  const [selectedAppareillageId, setSelectedAppareillageId] = useState<number | null>(null);
  const [selectedMeubleId, setSelectedMeubleId] = useState<number | null>(null);
  // Incrémenté à chaque fin de geste de déplacement — sert uniquement de "key" pour forcer
  // les champs de position/distance à se resynchroniser avec la géométrie après un drag,
  // sans jamais les resynchroniser pendant la frappe (ce qui bloquait l'effacement).
  const [dragEndTick, setDragEndTick] = useState(0);
  const [selectedTableau, setSelectedTableau] = useState(false);
  const [selectedPointArrivee, setSelectedPointArrivee] = useState(false);
  const [placingOuverture, setPlacingOuverture] = useState<OuvertureType | null>(null);
  // Usage de la porte battante en cours de pose : intérieure (défaut), d'entrée ou de service.
  const [placingUsagePorte, setPlacingUsagePorte] = useState<UsagePorte>("interieure");
  // Montage de la porte coulissante en cours de pose : « applique » (sur rail, visible ouverte) ou « galandage » (dans le mur).
  const [placingMontage, setPlacingMontage] = useState<"applique" | "galandage">("applique");
  const [ouvertureMenuOpen, setOuvertureMenuOpen] = useState(false);
  const [escalierMenuOpen, setEscalierMenuOpen] = useState(false);
  const [selectedEscalierId, setSelectedEscalierId] = useState<number | null>(null);
  // Déplacement de tout l'étage : niveau d'origine (pour annuler et pour un décalage absolu) + décalage courant (m).
  const [deplacementNiveau, setDeplacementNiveau] = useState<{ depart: Niveau; dx: number; dy: number } | null>(null);
  const departNiveauRef = useRef<Niveau | null>(null);
  const [selectedOuvertureId, setSelectedOuvertureId] = useState<number | null>(null);
  const [selectedBoite, setSelectedBoite] = useState<{ label: string; boiteId: number } | null>(null);
  const [circuitsManuelsOpen, setCircuitsManuelsOpen] = useState(false);
  // null = fermé ; { existing: null } = création ; { existing: <manuel> } = édition de ce circuit.
  const [circuitManuelForm, setCircuitManuelForm] = useState<{ existing: CircuitManuel | null } | null>(null);
  // Circuit dont on est en train de dessiner le cheminement à la main (clic sur ses
  // appareillages, dans l'ordre) — null = pas de dessin en cours. ordre est l'état de
  // travail local, appliqué (appliquerOrdreCircuit) seulement à la validation.
  const [cheminementDessin, setCheminementDessin] = useState<{ breaker: Breaker; ordre: number[] } | null>(null);
  // Liaison directe entre deux points lumineux (sans boîte de dérivation) : null = pas en
  // cours ; sinon le label du circuit concerné + le premier point lumineux déjà cliqué
  // (null tant qu'aucun n'a été choisi pour cette paire).
  const [liaisonLumiereMode, setLiaisonLumiereMode] = useState<{ label: string; premierId: number | null } | null>(null);
  const [selectedWaypoint, setSelectedWaypoint] = useState<{ cle: string; waypointId: number } | null>(null);
  // Section de circuit sélectionnée (Maj + clic sur le tracé) : index = rang de la section dans la liaison.
  const [selectedTroncon, setSelectedTroncon] = useState<{ cle: string; index: number } | null>(null);
  // Un simple CLIC sur une pièce / un appareillage arme un « glisser » sans rien déplacer : le résultat des
  // circuits ne doit être invalidé que si le pointeur a vraiment bougé (> 3 px) pendant l'appui.
  const dragBougeRef = useRef(false);
  const dragDepartRef = useRef<{ x: number; y: number } | null>(null);
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Barre d'outils (dessin + circuits) repliable — pour libérer un maximum de hauteur pour
  // le plan quand on n'en a pas besoin. Se replie ne laisse jamais un mode de placement/
  // dessin en cours orphelin (voir toggleToolbar) : on repart toujours de "Sélection".
  const [toolbarOuvert, setToolbarOuvert] = useState(true);
  // Espace de travail agrandi : plein écran (masque le menu latéral de l'appli) + palette
  // d'appareillages repliable. Échap quitte le plein écran.
  const [modeFocus, setModeFocus] = useState(false);
  const [paletteReduite, setPaletteReduite] = useState(false);
  // Menu du haut (en-tête + niveaux + barre d'outils) masquable d'un clic, comme la palette :
  // il est alors remplacé par une fine barre avec l'essentiel (niveau, zoom, 2D/3D, sauvegarde).
  const [menuHautReduit, setMenuHautReduit] = useState(false);
  const [, setLayoutTick] = useState(0);
  const [alertesOuvertes, setAlertesOuvertes] = useState(false);

  const [resultat, setResultat] = useState<ResultatGeneration | null>(null);
  const [showCircuits, setShowCircuits] = useState(false);
  // Cotes d'implantation : par défaut aucune (plan propre) ; l'appareillage sélectionné affiche
  // toujours les siennes ; ce bouton affiche une cote par appareillage mural (lisibilité filtrée).
  const [showCotes, setShowCotes] = useState(false);
  // Cotes des pièces : dimensions intérieures de chaque mur + épaisseurs (structure + doublage).
  const [showCotesPieces, setShowCotesPieces] = useState(false);
  const [showCotesExt, setShowCotesExt] = useState(false);   // cotes extérieures des murs + hors-tout
  const [showCotesOuv, setShowCotesOuv] = useState(false);   // chaîne de cotes des ouvertures
  const [menuCotesOuvert, setMenuCotesOuvert] = useState(false);
  const [showLongueurs, setShowLongueurs] = useState(false);
  // Ids de breakers actuellement affichés sur le plan (sous-ensemble de resultat.breakers) —
  // permet d'isoler un ou plusieurs circuits à l'écran pour vérifier leur tracé avant de les
  // retoucher à la main. Réinitialisé à "tous visibles" à chaque nouvelle génération
  // (voir handleGenerer) ; n'affecte jamais l'impression, qui inclut toujours tous les circuits.
  const [circuitsVisibles, setCircuitsVisibles] = useState<Set<number>>(new Set());
  const [showPrintForm, setShowPrintForm] = useState(false);
  const [show3DPrintForm, setShow3DPrintForm] = useState(false);
  const [vue3D, setVue3D] = useState(false);
  const [vue3DTous, setVue3DTous] = useState(false);              // vue 3D de TOUTE la maison (tous les niveaux empilés)
  const [masquerEtiquettes, setMasquerEtiquettes] = useState(false);   // plan 2D épuré : cache d'un coup tous les noms et toutes les dimensions des pièces
  const vue3DRef = useRef<Vue3DHandle>(null);
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  // Tableaux annexes du projet (pool house, garage…) — chaque niveau choisit son tableau
  // (Niveau.tableauId) ; le tableau principal reste dans projets.tableau_config.
  const [annexes, setAnnexes] = useState<TableauAnnexe[]>(() => lireAnnexes(projet.tableaux_annexes));

  const [zoom, setZoom] = useState(1);
  const [pasSnapCm, setPasSnapCm] = useState(1);
  // Retour visuel pendant le déplacement d'une pièce : proximité (≤ 10 cm) / alignement exact avec les sommets des autres pièces.
  const [alignPiece, setAlignPiece] = useState<AlignInfo | null>(null);
  const [aimantActif, setAimantActif] = useState(false);
  reglageAimant.pasM = pasSnapCm / 100;
  reglageAimant.aimant = aimantActif;
  useEffect(() => {
    const maj = (e: KeyboardEvent) => { reglageAimant.alt = e.altKey; };
    const raz = () => { reglageAimant.alt = false; };
    window.addEventListener("keydown", maj); window.addEventListener("keyup", maj); window.addEventListener("blur", raz);
    return () => { window.removeEventListener("keydown", maj); window.removeEventListener("keyup", maj); window.removeEventListener("blur", raz); };
  }, []);
  const [pan, setPan] = useState<Point>({ x: 60, y: 60 });
  const [, forceRerender] = useState(0);

  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => { forceRerender(t => t + 1); }, []);

  useEffect(() => {
    supabase.from("clients").select("*").eq("id", clientId).single().then(({ data: c }) => { if (c) setClient(c); });
  }, [clientId]);

  // Le plan vient du projet (et non plus directement du client) : un client peut avoir
  // plusieurs projets. L'éditeur est remonté (key=projet.id) à chaque changement de projet.
  useEffect(() => {
    const raw = projet.maison_config;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.niveaux) && parsed.niveaux.length > 0) {
          // Doit tourner avant reamorcerCompteurId : assigne de nouveaux id (uidMaison())
          // aux boîtes migrées depuis l'ancien format, que le compteur doit ensuite couvrir.
          // Plans enregistrés avant le modèle « tracé hors-tout » : convertis une fois, intérieurs inchangés.
          const { niveaux: niveauxMurs, migrees: nbMurs } = migrerModeleMurs(parsed.niveaux);
          parsed.niveaux = niveauxMurs;
          migrerBoitesDerivation(parsed.niveaux);
          reamorcerCompteurId(parsed.niveaux);
          // Nettoie une fois pour toutes d'éventuels id en double laissés par une
          // session précédente (voir dedupliquerIds) — sinon deux appareillages
          // différents peuvent partager le même id et se marcher dessus visuellement
          // (l'un "increvable" au clic, qui dérive sur le plan).
          const { niveaux: niveauxPropres, corrections } = dedupliquerIds(parsed.niveaux);
          // Une annexe sans tableau (tableau supprimé, ancienne donnée) en récupère un vierge,
          // pour que ses circuits aient toujours un tableau où être poussés.
          const orphelines = niveauxPropres.filter(n => estAnnexe(n) && !(n.tableauId && annexes.some(a => a.id === n.tableauId)));
          let niveauxFinal = niveauxPropres;
          if (orphelines.length > 0) {
            const nouvelles = orphelines.map(n => ({ niveauId: n.id, id: nouvelIdAnnexe(), nom: n.nom || "Annexe" }));
            niveauxFinal = niveauxPropres.map(n => {
              const r = nouvelles.find(x => x.niveauId === n.id);
              return r ? { ...n, tableauId: r.id } : n;
            });
            synchroniserAnnexes(projet.id, [...annexes.map(a => ({ id: a.id, nom: a.nom })), ...nouvelles.map(x => ({ id: x.id, nom: x.nom }))]).then(setAnnexes);
          }
          const premier = [...niveauxFinal].sort((a, b) => a.ordre - b.ordre)[0];
          setNiveaux(niveauxFinal);
          setNiveauActifId(premier.id);
          setLoading(false);
          if (corrections > 0 || orphelines.length > 0 || nbMurs > 0) {
            modifierProjet(projet.id, { maison_config: JSON.stringify({ niveaux: niveauxFinal }) });
          }
          return;
        }
      } catch {}
    }
    const def = nouveauNiveau("rdc", 0);
    def.nom = "RDC";
    setNiveaux([def]);
    setNiveauActifId(def.id);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projet.id]);

  const niveauActif = niveaux.find(n => n.id === niveauActifId) ?? null;
  // Escaliers : ceux qui partent de ce niveau (avec leur calcul) et ceux qui y arrivent (trémie à montrer / percer).
  const calculsEscaliers = useMemo(
    () => (niveauActif ? (niveauActif.escaliers ?? []).map(e => ({ e, calc: calculerEscalier(e, hauteurTotaleEscalierCm(e, niveauActif)) })) : []),
    [niveauActif],
  );
  const entrantsEscalier = useMemo(() => (niveauActif ? lireEscaliersEntrants(niveaux, niveauActif.id) : []), [niveaux, niveauActif]);

  // Orientation du bâtiment : angle entre le haut du plan et le Nord (voir Niveau.orientationNord). Commune à tous les
  // niveaux — stockée sur chacun pour suivre l'annuler/refaire et la sauvegarde sans rien changer au format du plan.
  const orientationNord = niveaux.find(n => n.orientationNord != null)?.orientationNord ?? 0;
  const definirOrientationNord = (deg: number) => {
    const v = normaliserAngle(deg);
    setNiveaux(nvs => nvs.map(n => ({ ...n, orientationNord: v })));
  };

  const toScreen = useCallback((pt: Point): Point =>
    ({ x: pt.x * PX_PER_M * zoom + pan.x, y: pt.y * PX_PER_M * zoom + pan.y }), [zoom, pan]);
  const toMeters = useCallback((px: number, py: number): Point =>
    ({ x: (px - pan.x) / (PX_PER_M * zoom), y: (py - pan.y) / (PX_PER_M * zoom) }), [zoom, pan]);

  const updateNiveauActif = (fn: (n: Niveau) => Niveau) => {
    setNiveaux(nvs => nvs.map(n => (n.id === niveauActifId ? fn(n) : n)));
  };

  const invalidateResultat = () => { if (resultat) { setResultat(null); setShowCircuits(false); } };

  useEffect(() => {
    if (dragMode.kind === "none") return;
    dragBougeRef.current = false; dragDepartRef.current = null;
    const onMove = (e: PointerEvent) => {
      if (!dragDepartRef.current) dragDepartRef.current = { x: e.clientX, y: e.clientY };
      else if (Math.hypot(e.clientX - dragDepartRef.current.x, e.clientY - dragDepartRef.current.y) > 3) dragBougeRef.current = true;
      if (dragMode.kind === "pan") {
        setPan({ x: dragMode.startPan.x + (e.clientX - dragMode.startX), y: dragMode.startPan.y + (e.clientY - dragMode.startY) });
      } else if (dragMode.kind === "vertex") {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const raw = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        const niveauCourant = niveaux.find(n => n.id === niveauActifId) ?? null;
        const candidats = pointsReferenceNiveau(niveauCourant, dragMode.pieceId, dragMode.vertexIndex);
        const seuilM = ALIGN_THRESHOLD_PX / (PX_PER_M * zoom);
        const base = snapAvecAlignement(raw, candidats, seuilM);
        let m = base.point;
        let al: ResultatAlignMurs | null = null;
        const pcV = niveauCourant?.pieces.find(p => p.id === dragMode.pieceId);
        if (niveauCourant && pcV && reglageAimant.murs && !reglageAimant.alt) {
          const nV = pcV.contour.length, v = dragMode.vertexIndex;
          al = alignerSurMurs(raw, [pcV.contour[(v - 1 + nV) % nV], pcV.contour[(v + 1) % nV]], segmentsReferenceNiveau(niveauCourant, pcV.id, v), seuilM);
          if (al) m = al.point;
        }
        setAlignSeg(al);
        setSnapGuide(!al && (base.guideX !== undefined || base.guideY !== undefined) ? { x: base.guideX, y: base.guideY } : null);
        updateNiveauActif(n => ({
          ...n,
          pieces: n.pieces.map(p => p.id !== dragMode.pieceId ? p : {
            ...p, contour: p.contour.map((pt, i) => (i === dragMode.vertexIndex ? m : pt)),
          }),
        }));
      } else if (dragMode.kind === "piece") {
        const dxM = arrondiGrille((e.clientX - dragMode.startX) / (PX_PER_M * zoom));
        const dyM = arrondiGrille((e.clientY - dragMode.startY) / (PX_PER_M * zoom));
        const niveauA = niveaux.find(n => n.id === niveauActifId) ?? null;
        const pieceM = niveauA?.pieces.find(p => p.id === dragMode.pieceId);
        if (niveauA && pieceM) {
          // Faces de chaque pièce : extérieure (tracé hors-tout) et intérieure (face finie, selon les épaisseurs de murs).
          const dep = { x: dragMode.startContour[0].x + dxM - pieceM.contour[0].x, y: dragMode.startContour[0].y + dyM - pieceM.contour[0].y };
          const facesDe = (pc: Piece, d: Point): { k: FaceKind; pts: Point[] }[] => {
            const g = geometrieMurs(pc);
            const dec = (pts: Point[]) => pts.map(q => ({ x: q.x + d.x, y: q.y + d.y }));
            const res: { k: FaceKind; pts: Point[] }[] = [{ k: "ext", pts: dec(g.exterieur) }];
            if (g.utile.length === pc.contour.length) res.push({ k: "int", pts: dec(g.utile) });
            return res;
          };
          const facesM = facesDe(pieceM, dep);
          const facesO = niveauA.pieces.filter(p => p.id !== pieceM.id).flatMap(pc => facesDe(pc, { x: 0, y: 0 }));
          const ptsM = facesM.flatMap(f => f.pts.map(pt => ({ pt, k: f.k })));
          const ptsO = facesO.flatMap(f => f.pts.map(pt => ({ pt, k: f.k })));
          let ax: AlignInfo["x"], ay: AlignInfo["y"], coin: (AlignInfo["coin"] & { d: number }) | undefined, am: AlignInfo["mur"];
          // Angles (n'importe quel angle de mur) : chaque angle de la pièce déplacée contre chaque angle des autres pièces.
          ptsM.forEach(m => ptsO.forEach(o => {
            const ex = Math.round(Math.abs(o.pt.x - m.pt.x) * 100), ey = Math.round(Math.abs(o.pt.y - m.pt.y) * 100);
            if (ex <= 10 && (!ax || ex < ax.ecartCm)) ax = { pos: o.pt.x, ecartCm: ex, kM: m.k, kO: o.k };
            if (ey <= 10 && (!ay || ey < ay.ecartCm)) ay = { pos: o.pt.y, ecartCm: ey, kM: m.k, kO: o.k };
            if (ex <= 10 && ey <= 10) {
              const d = Math.hypot(ex, ey);
              if (!coin || d < coin.d) coin = { m: m.pt, o: o.pt, dxCm: ex, dyCm: ey, kM: m.k, kO: o.k, d };
            }
          }));
          // Murs obliques parallèles (faces extérieures / intérieures) : distance entre les deux droites.
          const unit = (a: Point, b: Point) => { const L = Math.hypot(b.x - a.x, b.y - a.y); return L < 0.01 ? null : { x: (b.x - a.x) / L, y: (b.y - a.y) / L }; };
          facesM.forEach(fm => fm.pts.forEach((a, i) => {
            const u = unit(a, fm.pts[(i + 1) % fm.pts.length]);
            if (!u || Math.abs(u.x) < 1e-6 || Math.abs(u.y) < 1e-6) return;   // horizontaux/verticaux : couverts par X / Y
            facesO.forEach(fo => fo.pts.forEach((f, j) => {
              const v = unit(f, fo.pts[(j + 1) % fo.pts.length]);
              if (!v || Math.abs(u.x * v.y - u.y * v.x) > 0.01) return;      // pas parallèles (~0,6°)
              const ecartCm = Math.round(Math.abs(v.x * (a.y - f.y) - v.y * (a.x - f.x)) * 100);
              if (ecartCm <= 10 && (!am || ecartCm < am.ecartCm)) am = { a: f, dir: v, ecartCm, kM: fm.k, kO: fo.k };
            }));
          }));
          setAlignPiece(ax || ay || coin || am ? { x: ax, y: ay, mur: am, coin } : null);
        } else setAlignPiece(null);
        updateNiveauActif(n => ({
          ...n,
          pieces: n.pieces.map(p => p.id !== dragMode.pieceId ? p : {
            ...p, contour: dragMode.startContour.map(pt => ({ x: pt.x + dxM, y: pt.y + dyM })),
          }),
        }));
      } else if (dragMode.kind === "appareillage") {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const raw = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        const niveauCourant = niveaux.find(n => n.id === niveauActifId) ?? null;
        const candidats = pointsReferenceNiveau(niveauCourant);
        const seuilM = ALIGN_THRESHOLD_PX / (PX_PER_M * zoom);
        const { point: mAligne, guideX, guideY } = snapAvecAlignement(raw, candidats, seuilM);
        // Aimantation murale : l'appareillage "colle" au mur le plus proche de sa pièce (Alt = désactivée).
        const pieceDrag = niveauCourant?.pieces.find(p => p.id === dragMode.pieceId);
        const appDrag = pieceDrag?.appareillages.find(a => a.id === dragMode.appareillageId);
        const mAimante = pieceDrag && appDrag && !e.altKey
          ? aimanterSurFaceMur(mAligne, pieceDrag, appDrag.type, SNAP_MUR_PX / (PX_PER_M * zoom))
          : mAligne;
        // Volet roulant : une fois près d'une fenêtre, il se centre dessus (Alt = position libre).
        const m = pieceDrag && appDrag?.type === "volet_roulant" && !e.altKey && niveauCourant
          ? recentrerVolet(mAimante, pieceDrag, niveauCourant.pieces)
          : mAimante;
        setSnapGuide(guideX !== undefined || guideY !== undefined ? { x: guideX, y: guideY } : null);
        updateNiveauActif(n => ({
          ...n,
          pieces: n.pieces.map(p => {
            if (p.id !== dragMode.pieceId) return p;
            const gid = appDrag?.groupeId;
            if (gid != null) {
              // Plaque multiple : tous les postes suivent, re-disposés autour de la nouvelle position.
              const membres = p.appareillages.filter(a => a.groupeId === gid).sort((a, b) => (a.rangPlaque ?? 0) - (b.rangPlaque ?? 0));
              const pts = disposerPlaque(m, p.contour, membres.length);
              const nouvelle = new Map(membres.map((a, k) => [a.id, pts[k]] as const));
              return { ...p, appareillages: p.appareillages.map(a => nouvelle.has(a.id) ? { ...a, x: nouvelle.get(a.id)!.x, y: nouvelle.get(a.id)!.y } : a) };
            }
            return { ...p, appareillages: p.appareillages.map(a => a.id === dragMode.appareillageId ? { ...a, x: m.x, y: m.y } : a) };
          }),
        }));
      } else if (dragMode.kind === "nomPiece") {
        // Étiquette (nom + surface) déplacée librement — pas d'accroche à la grille : on la pose
        // où l'on veut. Stockée en décalage par rapport au centre de la pièce.
        const dxM = (e.clientX - dragMode.startX) / (PX_PER_M * zoom);
        const dyM = (e.clientY - dragMode.startY) / (PX_PER_M * zoom);
        updateNiveauActif(n => ({
          ...n,
          pieces: n.pieces.map(p => p.id !== dragMode.pieceId ? p : { ...p, nomDecalage: { x: dragMode.startOffset.x + dxM, y: dragMode.startOffset.y + dyM } }),
        }));
      } else if (dragMode.kind === "niveau") {
        // Déplacement de tout l'étage : décalage ABSOLU par rapport au niveau d'origine (jamais cumulatif), sur la grille.
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const raw = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        appliquerDecalageNiveau(arrondiGrille(dragMode.dx0 + raw.x - dragMode.startX), arrondiGrille(dragMode.dy0 + raw.y - dragMode.startY));
      } else if (dragMode.kind === "escalier") {
        // Escalier : déplacé sur la grille du plan, en gardant le décalage pris au moment de l'attraper.
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const raw = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        const x = arrondiGrille(raw.x + dragMode.offX), y = arrondiGrille(raw.y + dragMode.offY);
        updateNiveauActif(n => ({ ...n, escaliers: (n.escaliers ?? []).map(es => es.id === dragMode.escalierId ? { ...es, x, y } : es) }));
      } else if (dragMode.kind === "meuble") {
        // Aligné sur la grille du plan, comme une pièce (arrondiGrille) — pas de snap
        // d'alignement sur les murs/autres points, pas assez pertinent pour du mobilier.
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const raw = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        const snapped = { x: arrondiGrille(raw.x), y: arrondiGrille(raw.y) };
        updateNiveauActif(n => ({
          ...n,
          pieces: n.pieces.map(p => p.id !== dragMode.pieceId ? p : {
            ...p, meubles: (p.meubles ?? []).map(mb => mb.id === dragMode.meubleId ? { ...mb, x: snapped.x, y: snapped.y } : mb),
          }),
        }));
      } else if (dragMode.kind === "personne") {
        // Personne témoin 1,80 m : à la grille, comme un meuble.
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const raw = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        const snapped = { x: arrondiGrille(raw.x), y: arrondiGrille(raw.y) };
        updateNiveauActif(n => ({
          ...n,
          pieces: n.pieces.map(p => p.id !== dragMode.pieceId || !p.personne ? p : { ...p, personne: { ...p.personne, x: snapped.x, y: snapped.y } }),
        }));
      } else if (dragMode.kind === "voiture") {
        // Voiture témoin : à la grille, comme un meuble.
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const raw = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        const snapped = { x: arrondiGrille(raw.x), y: arrondiGrille(raw.y) };
        updateNiveauActif(n => ({
          ...n,
          pieces: n.pieces.map(p => p.id !== dragMode.pieceId || !p.voiture ? p : { ...p, voiture: { ...p.voiture, x: snapped.x, y: snapped.y } }),
        }));
      } else if (dragMode.kind === "zone") {
        // Cloison / zone entière : déplacée à la grille, portes comprises (leur position est relative au côté).
        const dxM = arrondiGrille((e.clientX - dragMode.startX) / (PX_PER_M * zoom));
        const dyM = arrondiGrille((e.clientY - dragMode.startY) / (PX_PER_M * zoom));
        updateNiveauActif(n => ({
          ...n,
          zones: (n.zones ?? []).map(z => z.id !== dragMode.zoneId ? z : { ...z, contour: dragMode.startContour.map(pt => ({ x: pt.x + dxM, y: pt.y + dyM })) }),
        }));
      } else if (dragMode.kind === "zoneSommet") {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const raw = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        const niveauCourant = niveaux.find(n => n.id === niveauActifId) ?? null;
        const refs = [
          ...pointsReferenceNiveau(niveauCourant),
          ...(niveauCourant?.zones ?? []).flatMap(z => z.id === dragMode.zoneId ? z.contour.filter((_, k) => k !== dragMode.index) : z.contour),
        ];
        const seuilM = ALIGN_THRESHOLD_PX / (PX_PER_M * zoom);
        const { point: m, guideX, guideY } = snapAvecAlignement(raw, refs, seuilM);
        setSnapGuide(guideX !== undefined || guideY !== undefined ? { x: guideX, y: guideY } : null);
        updateNiveauActif(n => ({
          ...n,
          zones: (n.zones ?? []).map(z => z.id !== dragMode.zoneId ? z : { ...z, contour: z.contour.map((pt, k) => (k === dragMode.index ? m : pt)) }),
        }));
      } else if (dragMode.kind === "tableau") {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const raw = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        const niveauCourant = niveaux.find(n => n.id === niveauActifId) ?? null;
        const candidats = pointsReferenceNiveau(niveauCourant);
        const seuilM = ALIGN_THRESHOLD_PX / (PX_PER_M * zoom);
        const { point: m, guideX, guideY } = snapAvecAlignement(raw, candidats, seuilM);
        setSnapGuide(guideX !== undefined || guideY !== undefined ? { x: guideX, y: guideY } : null);
        updateNiveauActif(n => ({ ...n, tableauPos: m }));
      } else if (dragMode.kind === "pointArrivee") {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const raw = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        const niveauCourant = niveaux.find(n => n.id === niveauActifId) ?? null;
        const candidats = pointsReferenceNiveau(niveauCourant);
        const seuilM = ALIGN_THRESHOLD_PX / (PX_PER_M * zoom);
        const { point: m, guideX, guideY } = snapAvecAlignement(raw, candidats, seuilM);
        setSnapGuide(guideX !== undefined || guideY !== undefined ? { x: guideX, y: guideY } : null);
        updateNiveauActif(n => ({ ...n, pointArriveeGaines: m }));
      } else if (dragMode.kind === "ouverture") {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const raw = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        const niveauCourant = niveaux.find(n => n.id === niveauActifId) ?? null;
        const piece = niveauCourant?.pieces.find(p => p.id === dragMode.pieceId);
        const ouverture = piece?.ouvertures?.find(o => o.id === dragMode.ouvertureId);
        if (!piece || !ouverture) return;
        // Contrainte au mur porteur : seule la position le long de CE segment change,
        // impossible de faire "sauter" une porte/fenêtre sur un autre mur en la glissant.
        const a = piece.contour[ouverture.segIndex], b = piece.contour[(ouverture.segIndex + 1) % piece.contour.length];
        const t = positionSurSegment(raw, a, b);
        updateNiveauActif(n => ({
          ...n,
          pieces: n.pieces.map(p => p.id !== dragMode.pieceId ? p : {
            ...p, ouvertures: (p.ouvertures ?? []).map(o => o.id === dragMode.ouvertureId ? { ...o, position: t } : o),
          }),
        }));
      } else if (dragMode.kind === "boite") {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const raw = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        const niveauCourant = niveaux.find(n => n.id === niveauActifId) ?? null;
        const candidats = pointsReferenceNiveau(niveauCourant);
        const seuilM = ALIGN_THRESHOLD_PX / (PX_PER_M * zoom);
        const { point: m, guideX, guideY } = snapAvecAlignement(raw, candidats, seuilM);
        setSnapGuide(guideX !== undefined || guideY !== undefined ? { x: guideX, y: guideY } : null);
        updateNiveauActif(n => ({
          ...n,
          boitesDerivation: {
            ...(n.boitesDerivation ?? {}),
            [dragMode.label]: (n.boitesDerivation?.[dragMode.label] ?? []).map(b => b.id === dragMode.boiteId ? { ...b, point: m } : b),
          },
        }));
      } else if (dragMode.kind === "liaison") {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const raw = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        const niveauCourant = niveaux.find(n => n.id === niveauActifId) ?? null;
        const candidats = pointsReferenceNiveau(niveauCourant);
        const seuilM = ALIGN_THRESHOLD_PX / (PX_PER_M * zoom);
        const { point: m, guideX, guideY } = snapAvecAlignement(raw, candidats, seuilM);
        setSnapGuide(guideX !== undefined || guideY !== undefined ? { x: guideX, y: guideY } : null);
        updateNiveauActif(n => ({
          ...n,
          liaisonWaypoints: {
            ...(n.liaisonWaypoints ?? {}),
            [dragMode.cle]: (n.liaisonWaypoints?.[dragMode.cle] ?? []).map(w => w.id === dragMode.waypointId ? { ...w, point: m } : w),
          },
        }));
      }
    };
    const onUp = () => {
      // "pan" (clic dans le vide / déplacement de la vue), "liaison" (coude), "ouverture"
      // (porte/fenêtre), "boite" et "pointArrivee" (purement cosmétiques/informatifs) ne
      // changent jamais la composition électrique du plan — les exclure évite de
      // réinitialiser les circuits générés à chaque simple clic ou déplacement de ces éléments.
      if (dragBougeRef.current && !["liaison", "pan", "ouverture", "boite", "pointArrivee", "meuble", "escalier", "personne", "voiture", "nomPiece", "zone", "zoneSommet"].includes(dragMode.kind)) invalidateResultat();
      setDragEndTick(t => t + 1);
      setDragMode({ kind: "none" });
      setSnapGuide(null);
      setAlignPiece(null);
      setAlignSeg(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragMode, zoom, niveauActifId]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    const meterX = (mx - pan.x) / (PX_PER_M * zoom);
    const meterY = (my - pan.y) / (PX_PER_M * zoom);
    setZoom(newZoom);
    setPan({ x: mx - meterX * PX_PER_M * newZoom, y: my - meterY * PX_PER_M * newZoom });
  };

  const zoomBtn = (dir: 1 | -1) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 450, cy = rect ? rect.height / 2 : 300;
    const factor = dir === 1 ? 1.25 : 1 / 1.25;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    const meterX = (cx - pan.x) / (PX_PER_M * zoom);
    const meterY = (cy - pan.y) / (PX_PER_M * zoom);
    setZoom(newZoom);
    setPan({ x: cx - meterX * PX_PER_M * newZoom, y: cy - meterY * PX_PER_M * newZoom });
  };

  const zoomSurPiece = (piece: Piece) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || piece.contour.length === 0) return;
    const xs = piece.contour.map(p => p.x), ys = piece.contour.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const margeM = 0.8;
    const wM = Math.max(maxX - minX + margeM * 2, 0.5), hM = Math.max(maxY - minY + margeM * 2, 0.5);
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(rect.width / (wM * PX_PER_M), rect.height / (hM * PX_PER_M))));
    const cxM = (minX + maxX) / 2, cyM = (minY + maxY) / 2;
    setZoom(newZoom);
    setPan({ x: rect.width / 2 - cxM * PX_PER_M * newZoom, y: rect.height / 2 - cyM * PX_PER_M * newZoom });
  };

  // Point de dessin (curseur) : grille / aimant aux sommets, puis alignement automatique sur les murs adjacents.
  const snapDessin = (m: Point): ResultatSnap & { align?: ResultatAlignMurs } => {
    const seuilM = ALIGN_THRESHOLD_PX / (PX_PER_M * zoom);
    const base = snapAvecAlignement(m, [...pointsReferenceNiveau(niveauActif), ...drawingPoints], seuilM);
    if (!reglageAimant.murs || reglageAimant.alt) return base;
    const voisins = formeDessin === "rectangle" ? [] : drawingPoints.slice(-1);
    const al = alignerSurMurs(m, voisins, segmentsReferenceNiveau(niveauActif), seuilM);
    return al ? { point: al.point, align: al } : base;
  };

  // Plier un mur : insère un sommet sur le segment (la forme ne change pas à l'insertion), puis le fait glisser.
  const insererSommetPiece = (pieceId: number, segIndex: number, e: React.PointerEvent) => {
    e.stopPropagation();
    const piece = niveauActif?.pieces.find(p => p.id === pieceId);
    if (!piece || piece.verrouillee || cheminementDessin || liaisonLumiereMode) return;
    const n = piece.contour.length;
    const a = piece.contour[segIndex], b = piece.contour[(segIndex + 1) % n];
    const rect = svgRef.current?.getBoundingClientRect();
    let t = 0.5;
    if (rect) t = Math.min(0.95, Math.max(0.05, positionSurSegment(toMeters(e.clientX - rect.left, e.clientY - rect.top), a, b)));
    const pt = { x: Number((a.x + (b.x - a.x) * t).toFixed(3)), y: Number((a.y + (b.y - a.y) * t).toFixed(3)) };
    updateNiveauActif(niv => ({
      ...niv,
      pieces: niv.pieces.map(p => {
        if (p.id !== pieceId) return p;
        const contour = [...p.contour.slice(0, segIndex + 1), pt, ...p.contour.slice(segIndex + 1)];
        const mursAvant = mursDe(p);
        const murs = p.murs ? [...mursAvant.slice(0, segIndex + 1), { ...mursAvant[segIndex] }, ...mursAvant.slice(segIndex + 1)] : undefined;
        const ouvertures = (p.ouvertures ?? []).map(o => {
          if (o.segIndex > segIndex) return { ...o, segIndex: o.segIndex + 1 };
          if (o.segIndex < segIndex) return o;
          return o.position < t ? { ...o, position: o.position / t } : { ...o, segIndex: segIndex + 1, position: (o.position - t) / (1 - t) };
        });
        return { ...p, contour, murs, ouvertures };
      }),
    }));
    if (editingSegment?.pieceId === pieceId) setEditingSegment(null);
    setDragMode({ kind: "vertex", pieceId, vertexIndex: segIndex + 1 });
  };

  const finirDessin = (points: Point[]) => {
    if (points.length < 3) return;
    setPendingContour(points);
    setDrawingPoints([]);
  };

  // Replier la barre annule tout mode de placement/dessin en cours (jamais de bouton
  // "Terminer/Annuler" orphelin caché derrière la barre repliée) — repart toujours d'un
  // état "Sélection" propre.
  const toggleToolbar = () => {
    setToolbarOuvert(o => {
      if (o) {
        setMode("select"); setDrawingPoints([]);
        setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null);
        setPlacingPointArrivee(false); setSelectedPointArrivee(false); setPlacingMeuble(false);
        setCheminementDessin(null); setLiaisonLumiereMode(null);
      }
      return !o;
    });
  };

  // Préférences d'agencement mémorisées sur cet appareil (palette repliée, menu du haut masqué).
  // Lues après le montage (jamais au rendu serveur → pas de décalage d'hydratation). Le plein
  // écran n'est volontairement pas mémorisé : on repart toujours d'une page normale.
  useEffect(() => {
    try {
      setPaletteReduite(localStorage.getItem("voltapp.plan.paletteReduite") === "1");
      setMenuHautReduit(localStorage.getItem("voltapp.plan.menuHautReduit") === "1");
    } catch { /* stockage indisponible : on garde les valeurs par défaut */ }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("voltapp.plan.paletteReduite", paletteReduite ? "1" : "0");
      localStorage.setItem("voltapp.plan.menuHautReduit", menuHautReduit ? "1" : "0");
    } catch { /* idem */ }
  }, [paletteReduite, menuHautReduit]);

  // Masquer le menu du haut annule tout mode de placement/dessin lié à la barre d'outils (comme
  // le repli de la barre : jamais de bouton « Terminer » orphelin caché) ; l'afficher ne change rien.
  const reduireMenuHaut = (reduire: boolean) => {
    if (reduire) {
      setMode("select"); setDrawingPoints([]);
      setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null);
      setPlacingPointArrivee(false); setSelectedPointArrivee(false); setPlacingMeuble(false);
      setCheminementDessin(null); setLiaisonLumiereMode(null);
    }
    setMenuHautReduit(reduire);
  };
  // Changement de niveau (onglets du menu et mini-barre) : repart d'une sélection vide.
  const changerNiveau = (id: number) => {
    setNiveauActifId(id); setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false);
    setSelectedOuvertureId(null); setSelectedBoite(null); setSelectedPointArrivee(false); setSelectedMeubleId(null);
    setCheminementDessin(null); setLiaisonLumiereMode(null);
  };

  // Quitter le plein écran avec Échap — sans toucher aux autres usages d'Échap (modes de
  // placement/dessin) : on ne réagit que si aucun champ de saisie n'a le focus.
  useEffect(() => {
    if (!modeFocus) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "Escape" && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"))) setModeFocus(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modeFocus]);
  // La taille du plan (grille, cadrage) est lue sur le DOM au rendu : on re-rend une fois la
  // mise en page appliquée, sinon la zone agrandie garderait l'ancienne taille.
  useEffect(() => {
    const id = requestAnimationFrame(() => setLayoutTick(t => t + 1));
    return () => cancelAnimationFrame(id);
  }, [modeFocus, paletteReduite, menuHautReduit, toolbarOuvert, vue3D]);

  // Le tracé de cloison ne survit ni à un changement d'outil, ni à un changement de niveau, ni à la vue 3D.
  useEffect(() => {
    if (mode !== "cloison" || vue3D) { setCloisonPoints([]); setCloisonEnAttente(null); }
    if (vue3D && mode === "cloison") setMode("select");
  }, [mode, vue3D]);
  useEffect(() => { setCloisonPoints([]); setCloisonEnAttente(null); }, [niveauActifId]);
  // Clavier de l'outil cloison : Retour arrière = retire le dernier point, Échap = quitte l'outil.
  useEffect(() => {
    if (mode !== "cloison" || cloisonEnAttente) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "Escape") { e.preventDefault(); if (cloisonPoints.length > 0) setCloisonPoints([]); else setMode("select"); }
      else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); setCloisonPoints(pts => pts.slice(0, -1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, cloisonEnAttente, cloisonPoints.length]);

  // Outil « Cloison » : trace un mur libre (jamais de découpe d'une pièce) — voir entrerModeZone (zones).
  const entrerModeCloison = () => {
    if (mode === "zone" && zoneCloisonSeule) { setMode("select"); return; }
    demarrerModeZone(true);
  };

  // Accroche du curseur pour l'outil cloison. 1er point : le mur le plus proche (toutes pièces). Ensuite : le
  // point est soit sur un mur de la pièce visée (= fin de cloison), soit un coude à l'intérieur, aligné sur les
  // sommets et sur les points déjà posés. Le même calcul sert à l'aperçu et au clic (rien de décalé entre les deux).
  const curseurCloison = (mCur: Point): { point: Point; surMur: boolean; piece: Piece | null; guideX?: number; guideY?: number } | null => {
    if (!niveauActif) return null;
    const seuilM = CLOISON_SEUIL_PX / (PX_PER_M * zoom);
    const seuilAlign = ALIGN_THRESHOLD_PX / (PX_PER_M * zoom);
    if (cloisonPoints.length === 0) {
      let meilleur: { acc: PointAccroche; d: number } | null = null;
      for (const pc of niveauActif.pieces) {
        const acc = accrocherSurContour(pc.contour, mCur, seuilM);
        if (!acc) continue;
        const d = distance(acc.point, mCur);
        if (!meilleur || d < meilleur.d) meilleur = { acc, d };
      }
      return meilleur ? { point: meilleur.acc.point, surMur: true, piece: null } : null;
    }
    const depart = cloisonPoints[0], dernier = cloisonPoints[cloisonPoints.length - 1];
    let candidates = niveauActif.pieces.filter(pc => distanceAuMurLePlusProche(depart, pc.contour) < 0.02);
    if (cloisonPoints.length >= 2) {
      const fixe = candidates.find(pc => pointDansPolygone(cloisonPoints[1], pc.contour));
      if (fixe) candidates = [fixe];
    }
    for (const pc of candidates) {
      const acc = accrocherSurContour(pc.contour, mCur, seuilM);
      if (!acc) continue;
      const milieu = { x: (dernier.x + acc.point.x) / 2, y: (dernier.y + acc.point.y) / 2 };
      if (pointDansPolygone(milieu, pc.contour)) return { point: acc.point, surMur: true, piece: pc };
    }
    const piece = candidates.find(pc => pointDansPolygone(mCur, pc.contour)) ?? null;
    const refs = [...(piece ? piece.contour : []), ...cloisonPoints];
    const { point, guideX, guideY } = snapAvecAlignement(mCur, refs, seuilAlign);
    return { point, surMur: false, piece, guideX, guideY };
  };

  // ─── ZONES (polygone nommé / cloison libre) ─────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "zone" || vue3D) { setZonePoints([]); setZoneEnAttente(null); setZoneCloisonSeule(false); }
    if (vue3D && mode === "zone") setMode("select");
  }, [mode, vue3D]);
  useEffect(() => { setZonePoints([]); setZoneEnAttente(null); setSelectedZoneId(null); setSelectedZoneOuv(null); }, [niveauActifId]);
  // Suppr : supprime la cloison / zone sélectionnée (hors saisie de texte).
  useEffect(() => {
    if (selectedZoneId == null || selectedZoneOuv || mode !== "select") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "Delete") { e.preventDefault(); supprimerZone(selectedZoneId); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedZoneId, selectedZoneOuv, mode, niveaux]);
  // Sélectionner autre chose qu'une zone referme les panneaux de zone (jamais deux panneaux à la fois).
  useEffect(() => {
    if (selectedPieceId != null || selectedAppareillageId != null || selectedOuvertureId != null || selectedMeubleId != null || selectedTableau) {
      setSelectedZoneId(null); setSelectedZoneOuv(null);
    }
  }, [selectedPieceId, selectedAppareillageId, selectedOuvertureId, selectedMeubleId, selectedTableau]);
  // Sélectionner autre chose qu'un escalier referme son panneau (jamais deux panneaux à la fois) ; changer de niveau aussi.
  useEffect(() => {
    if (selectedPieceId != null || selectedAppareillageId != null || selectedOuvertureId != null || selectedMeubleId != null || selectedTableau) setSelectedEscalierId(null);
  }, [selectedPieceId, selectedAppareillageId, selectedOuvertureId, selectedMeubleId, selectedTableau]);
  useEffect(() => { setSelectedEscalierId(null); setEscalierMenuOpen(false); departNiveauRef.current = null; setDeplacementNiveau(null); }, [niveauActifId]);
  // Déplacement d'étage : flèches du clavier = 1 cm (Maj : 10 cm) ; Échap = annuler.
  useEffect(() => {
    if (!deplacementNiveau) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const pas = e.shiftKey ? 0.1 : 0.01;
      const d = e.key === "ArrowLeft" ? [-pas, 0] : e.key === "ArrowRight" ? [pas, 0] : e.key === "ArrowUp" ? [0, -pas] : e.key === "ArrowDown" ? [0, pas] : null;
      if (d) { e.preventDefault(); appliquerDecalageNiveau(Math.round((deplacementNiveau.dx + d[0]) * 1000) / 1000, Math.round((deplacementNiveau.dy + d[1]) * 1000) / 1000); }
      else if (e.key === "Escape") { e.preventDefault(); terminerDeplacementNiveau(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deplacementNiveau]);
  // Suppr : supprime l'escalier sélectionné (hors saisie de texte).
  useEffect(() => {
    if (selectedEscalierId == null || mode !== "select") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "Delete") { e.preventDefault(); supprimerEscalier(selectedEscalierId); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEscalierId, mode]);
  // Clavier : Retour arrière = retire le dernier point, Échap = annule le tracé puis quitte l'outil.
  useEffect(() => {
    if (mode !== "zone" || zoneEnAttente) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "Escape") { e.preventDefault(); if (zonePoints.length > 0) setZonePoints([]); else setMode("select"); }
      else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); setZonePoints(pts => pts.slice(0, -1)); }
      else if (e.key === "Enter" && zoneCloisonSeule && zonePoints.length >= 2) { e.preventDefault(); terminerTraceZone(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, zoneEnAttente, zonePoints.length, zoneCloisonSeule]);

  const entrerModeZone = () => {
    if (mode === "zone" && !zoneCloisonSeule) { setMode("select"); return; }
    demarrerModeZone(false);
  };
  const demarrerModeZone = (cloisonSeule: boolean) => {
    setMode("zone"); setZonePoints([]); setZoneEnAttente(null); setZoneCloisonSeule(cloisonSeule);
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null); setSelectedMeubleId(null);
    setSelectedZoneId(null); setSelectedZoneOuv(null);
    setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null); setPlacingMeuble(false);
    setPlacingPointArrivee(false); setSelectedPointArrivee(false); setLiaisonLumiereMode(null); setDrawingPoints([]);
  };

  // Accroche du curseur : fermeture près du 1er point ; sur un mur existant (côté de zone qui longe un mur) ;
  // sinon alignement sur les sommets des pièces, des zones et des points déjà posés (grille de 10 cm).
  const curseurZone = (mCur: Point): { point: Point; surMur: boolean; ferme: boolean; guideX?: number; guideY?: number } | null => {
    if (!niveauActif) return null;
    const seuilM = CLOISON_SEUIL_PX / (PX_PER_M * zoom);
    const seuilAlign = ALIGN_THRESHOLD_PX / (PX_PER_M * zoom);
    if (!zoneCloisonSeule && zonePoints.length >= 3 && distance(mCur, zonePoints[0]) < seuilM) return { point: zonePoints[0], surMur: false, ferme: true };
    let meilleur: { acc: PointAccroche; d: number } | null = null;
    for (const pc of niveauActif.pieces) {
      const acc = accrocherSurContour(pc.contour, mCur, seuilM);
      if (!acc) continue;
      const d = distance(acc.point, mCur);
      if (!meilleur || d < meilleur.d) meilleur = { acc, d };
    }
    if (meilleur) return { point: meilleur.acc.point, surMur: true, ferme: false };
    const refs = [...pointsReferenceNiveau(niveauActif), ...(niveauActif.zones ?? []).flatMap(z => z.contour), ...zonePoints];
    const { point, guideX, guideY } = snapAvecAlignement(mCur, refs, seuilAlign);
    return { point, surMur: false, ferme: false, guideX, guideY };
  };

  const majZone = (zoneId: number, fn: (z: Zone) => Zone) => {
    updateNiveauActif(n => ({ ...n, zones: (n.zones ?? []).map(z => (z.id === zoneId ? fn(z) : z)) }));
  };
  const messageZone = (msg: string, ms = 2800) => { setPlacementError(msg); setTimeout(() => setPlacementError(null), ms); };
  // Termine le tracé : fermé (polygone) ou non (cloison libre). Le formulaire de nom / côtés prend ensuite la main.
  const terminerTraceZone = (ferme: boolean) => {
    const err = validerTraceZone(zonePoints, ferme);
    if (err) { messageZone(err); return; }
    setZoneEnAttente({ contour: zonePoints, ferme });
  };
  const validerNouvelleZone = (nom: string, cotes: TypeCoteZone[], epaisseurCm: number) => {
    if (!zoneEnAttente) return;
    const z = nouvelleZone(nom.trim(), zoneEnAttente.contour, zoneEnAttente.ferme, cotes, epaisseurCm);
    updateNiveauActif(n => ({ ...n, zones: [...(n.zones ?? []), z] }));
    setZoneEnAttente(null); setZonePoints([]);
    setMode("select"); setSelectedZoneId(z.id); setSelectedZoneOuv(null); setPanelResetTick(t => t + 1);
  };
  const supprimerZone = (zoneId: number) => {
    const z = niveauActif?.zones?.find(zz => zz.id === zoneId);
    if (!z || !window.confirm(`Supprimer « ${z.nom || (z.ferme ? "cette zone" : "cette cloison")} » et ses cloisons ?`)) return;
    updateNiveauActif(n => ({ ...n, zones: (n.zones ?? []).filter(zz => zz.id !== zoneId) }));
    setSelectedZoneId(null); setSelectedZoneOuv(null);
  };
  const zoneCliquable = mode === "select" && !placementType && !placingTableau && !placingOuverture && !placingPointArrivee && !placingMeuble && !cheminementDessin && !liaisonLumiereMode;
  const selectionnerZone = (zoneId: number, ouvId: number | null, e: React.PointerEvent) => {
    if (!zoneCliquable) return;
    e.stopPropagation();
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null);
    setSelectedBoite(null); setSelectedMeubleId(null); setSelectedPointArrivee(false); setSelectedWaypoint(null);
    setSelectedZoneId(zoneId); setSelectedZoneOuv(ouvId != null ? { zoneId, ouvId } : null);
    setPanelResetTick(t => t + 1);
  };
  // Clic sur une cloison de zone : la sélectionne ET démarre un glisser-déposer (le mur se déplace avec la souris).
  const cloisonDown = (z: Zone, e: React.PointerEvent) => {
    if (!zoneCliquable) return;
    selectionnerZone(z.id, null, e);
    setDragMode({ kind: "zone", zoneId: z.id, startX: e.clientX, startY: e.clientY, startContour: z.contour });
  };
  const sommetZoneDown = (z: Zone, index: number, e: React.PointerEvent) => {
    if (!zoneCliquable) return;
    e.stopPropagation();
    setDragMode({ kind: "zoneSommet", zoneId: z.id, index });
  };
  const modifierOuvertureZone = (zoneId: number, ouvId: number, patch: Partial<Ouverture>) => {
    majZone(zoneId, z => ({
      ...z,
      ouvertures: (z.ouvertures ?? []).map(o => {
        if (o.id !== ouvId) return o;
        const nouv = { ...o, ...patch };
        const pos = positionOuvertureValide(nouv.position, nouv.largeur, longueurCote(z, o.segIndex));
        return pos == null ? o : { ...nouv, position: pos };   // côté trop court pour cette largeur : on refuse
      }),
    }));
  };
  const supprimerOuvertureZone = (zoneId: number, ouvId: number) => {
    majZone(zoneId, z => ({ ...z, ouvertures: (z.ouvertures ?? []).filter(o => o.id !== ouvId) }));
    setSelectedZoneOuv(null);
  };

  const validerCloison = (opts: OptionsCloison) => {
    if (!cloisonEnAttente || !niveauActif) return;
    const r = appliquerCloison(niveauActif.pieces, cloisonEnAttente.pieceId, cloisonEnAttente.chemin, opts);
    if ("erreur" in r) { setPlacementError(r.erreur); setTimeout(() => setPlacementError(null), 3000); return; }
    updateNiveauActif(n => ({ ...n, pieces: r.pieces }));
    invalidateResultat();
    setCloisonEnAttente(null); setCloisonPoints([]);
    setMode("select"); setSelectedPieceId(r.idNouvelle);
    if (r.avertissement) { setPlacementError(r.avertissement); setTimeout(() => setPlacementError(null), 4000); }
  };

  const entrerModeDessiner = () => {
    setMode("dessiner"); setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null); setSelectedMeubleId(null);
    setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null); setPlacingMeuble(false);
    setPlacingPointArrivee(false); setSelectedPointArrivee(false); setLiaisonLumiereMode(null);
  };
  const armerPlaque = (postes: PosteSpec[]) => {
    armerPlacement(postes[0].type);
    setPlaquePostes(postes);
  };
  const armerPlacement = (t: AppareillageType | null) => {
    setPlaquePostes(null);
    setPlacementType(t); setMode("select"); setPlacingTableau(false); setPlacingOuverture(null); setPlacingMeuble(false); setDrawingPoints([]);
    setPlacingPointArrivee(false); setSelectedPointArrivee(false); setLiaisonLumiereMode(null);
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null); setSelectedMeubleId(null);
  };
  const armerPlacementTableau = () => {
    // Maison : un seul tableau. S'il est déjà posé sur un autre niveau, le placer ici le déplace.
    if (niveauActif && !estAnnexe(niveauActif) && !niveauActif.tableauPos) {
      const autre = niveaux.find(n => n.id !== niveauActif.id && !estAnnexe(n) && n.tableauPos);
      if (autre && !window.confirm(`Le tableau de la maison est déjà positionné sur « ${autre.nom || NIVEAU_TYPES[autre.type]} ». Le déplacer sur « ${niveauActif.nom || NIVEAU_TYPES[niveauActif.type]} » ?`)) return;
    }
    setPlacingTableau(true); setMode("select"); setPlacementType(null); setPlacingOuverture(null); setPlacingMeuble(false); setDrawingPoints([]);
    setPlacingPointArrivee(false); setSelectedPointArrivee(false); setLiaisonLumiereMode(null);
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null); setSelectedMeubleId(null);
  };
  const armerPlacementPointArrivee = () => {
    setPlacingPointArrivee(true); setMode("select"); setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null); setPlacingMeuble(false); setDrawingPoints([]);
    setLiaisonLumiereMode(null);
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null); setSelectedPointArrivee(false); setSelectedMeubleId(null);
  };
  const armerPlacementOuverture = (t: OuvertureType | null, usage: UsagePorte = "interieure", montage: "applique" | "galandage" = "applique") => {
    setPlacingOuverture(t); setPlacingUsagePorte(usage); setPlacingMontage(montage); setMode("select"); setPlacementType(null); setPlacingTableau(false); setPlacingMeuble(false); setDrawingPoints([]);
    setPlacingPointArrivee(false); setSelectedPointArrivee(false); setLiaisonLumiereMode(null);
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null); setSelectedMeubleId(null);
  };
  // Mobilier simple : reste armé après chaque pose (comme la palette d'appareillages) pour
  // enchaîner plusieurs meubles sans rerouvrir le bouton — se désarme via son propre bouton
  // (toggle) ou en passant à un autre mode/outil.
  const armerPlacementMeuble = () => {
    setPlacingMeuble(true); setMode("select"); setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null); setDrawingPoints([]);
    setPlacingPointArrivee(false); setSelectedPointArrivee(false); setLiaisonLumiereMode(null);
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null); setSelectedMeubleId(null);
  };

  // ─── APPAREILLAGES MULTIPLES : ajout / changement / retrait de poste ──────────────────────
  // Ajoute un poste (prise par défaut) à côté de l'appareillage : un appareillage simple devient
  // une plaque double, une plaque double devient triple… (4 postes maximum).
  const ajouterPoste = (appareillageId: number) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => {
        const a = p.appareillages.find(x => x.id === appareillageId);
        if (!a || !TYPES_POSTE_PLAQUE.includes(a.type)) return p;
        const groupeId = a.groupeId ?? uidMaison();
        const membres = p.appareillages.filter(x => x.groupeId === groupeId);
        const nb = a.groupeId != null ? membres.length : 1;
        if (nb >= MAX_POSTES_PLAQUE) return p;
        const hauteur = a.hauteur ?? hauteurCommunePlaqueCm([a.type, "prise"]);
        const nouveau: AppareillagePlace = { ...nouvelAppareillage("prise", a.x, a.y), groupeId, rangPlaque: nb, hauteur, couleur: a.couleur };
        const maj = p.appareillages.map(x => x.id === a.id ? { ...x, groupeId, rangPlaque: x.rangPlaque ?? 0, hauteur } : x);
        return normaliserPlaques({ ...p, appareillages: [...maj, nouveau] }, groupeId);
      }),
    }));
    invalidateResultat();
  };

  // Change le type d'un poste (prise, interrupteur, RJ45, prise dédiée…). Les liens propres à
  // l'ancien type (circuit manuel, commande, domotique) sont retirés ; le circuit est regénéré.
  const changerTypePoste = (appareillageId: number, type: AppareillageType) => {
    const ancien = niveauActif?.pieces.flatMap(p => p.appareillages).find(a => a.id === appareillageId);
    if (!ancien || ancien.type === type) return;
    // Calculé HORS de l'updater (setNiveaux est différé) : le même objet sert à la mise à jour et à la fenêtre de commande.
    const { commandePourIds, commandePourIds2, domotique, usageDedie, circuitManuelId, circuitId, ...reste } = ancien;
    void circuitId;
    const maj: AppareillagePlace = { ...reste, type, ...(type === "prise_dediee" ? { usageDedie: usageDedie ?? USAGE_DEDIE_DEFAUT } : {}) };
    const controleVersControle = estCommande(type) && estCommande(ancien.type);
    if (controleVersControle) {
      // Les lampes commandées et le circuit manuel sont conservés. Vers un double : voies 1 et 2 telles quelles (voie 2
      // vide depuis un simple). Vers un simple : les deux voies fusionnent en une seule liste.
      Object.assign(maj, { domotique, circuitManuelId });
      if (estCommandeDouble(type)) Object.assign(maj, { commandePourIds, commandePourIds2 });
      else Object.assign(maj, { commandePourIds: lumieresCommandees({ commandePourIds, commandePourIds2 }) });
    } else void domotique, void circuitManuelId, void commandePourIds, void commandePourIds2;
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({ ...p, appareillages: p.appareillages.map(a => a.id === appareillageId ? maj : a) })),
    }));
    invalidateResultat();
    // Fenêtre de liaison : nouvelle commande, ou simple → double (pour régler la voie 2).
    if (estCommande(type) && (!estCommande(ancien.type) || (estCommandeDouble(type) && !estCommandeDouble(ancien.type)))) {
      setPendingCommande({ item: maj, estNouveau: false });
    }
  };

  const modifierUsageDedie = (appareillageId: number, usageDedie: AppareillageType) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p, appareillages: p.appareillages.map(a => a.id === appareillageId ? { ...a, usageDedie } : a),
      })),
    }));
    invalidateResultat();
  };

  // Supprime tous les postes d'une plaque.
  const removerPlaque = (groupeId: number) => {
    const ids = new Set(niveauActif?.pieces.flatMap(p => p.appareillages).filter(a => a.groupeId === groupeId).map(a => a.id) ?? []);
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.filter(a => !ids.has(a.id))
          .map(a => (a.commandePourIds?.some(id => ids.has(id)) || a.commandePourIds2?.some(id => ids.has(id)))
            ? { ...a, commandePourIds: a.commandePourIds?.filter(id => !ids.has(id)), commandePourIds2: a.commandePourIds2?.filter(id => !ids.has(id)) } : a),
      })),
    }));
    setSelectedAppareillageId(null);
    invalidateResultat();
  };

  const removerAppareillage = (appareillageId: number) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => {
        const gid = p.appareillages.find(a => a.id === appareillageId)?.groupeId;
        const sans: Piece = {
          ...p,
          appareillages: p.appareillages
            .filter(a => a.id !== appareillageId)
            .map(a => (a.commandePourIds?.includes(appareillageId) || a.commandePourIds2?.includes(appareillageId))
              ? { ...a, commandePourIds: a.commandePourIds?.filter(id => id !== appareillageId), commandePourIds2: a.commandePourIds2?.filter(id => id !== appareillageId) }
              : a),
        };
        // Plaque multiple : les postes restants se re-serrent (et un poste seul redevient simple).
        return gid != null ? normaliserPlaques(sans, gid) : sans;
      }),
    }));
    setSelectedAppareillageId(null);
    invalidateResultat();
  };

  // ─── MOBILIER SIMPLE (vue 3D) ───────────────────────────────────────────────────
  // Purement visuel : jamais d'invalidateResultat() ici, un meuble n'entre dans aucun
  // circuit ni calcul.
  const modifierMeuble = (meubleId: number, patch: Partial<MeubleSimple>) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p,
        meubles: (p.meubles ?? []).map(m => m.id === meubleId ? { ...m, ...patch } : m),
      })),
    }));
  };
  const removerMeuble = (meubleId: number) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({ ...p, meubles: (p.meubles ?? []).filter(m => m.id !== meubleId) })),
    }));
    setSelectedMeubleId(null);
  };

  // ─── PERSONNE TÉMOIN 1,80 m (vue 3D) ────────────────────────────────────────────
  // Une par pièce, purement visuelle (jamais d'invalidateResultat : aucun effet sur circuits ni devis).
  const ajouterPersonne = (piece: Piece) => {
    const c = piece.contour.length > 0 ? centroide(piece.contour) : { x: 0, y: 0 };
    const centre = pointDansPolygone(c, piece.contour) ? c : piece.contour[0] ?? c;
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => p.id === piece.id ? { ...p, personne: nouvellePersonne(arrondiGrille(centre.x), arrondiGrille(centre.y)) } : p),
    }));
  };
  const basculerPersonne = (pieceId: number) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => p.id === pieceId && p.personne ? { ...p, personne: { ...p.personne, masquee: !p.personne.masquee } } : p),
    }));
  };
  const retirerPersonne = (pieceId: number) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => { if (p.id !== pieceId) return p; const { personne: _retiree, ...reste } = p; return reste; }),
    }));
  };
  const onPersonnePointerDown = (piece: Piece, e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return;
    if (mode !== "select" || placementType || placingTableau || placingOuverture || placingPointArrivee || placingMeuble) { e.stopPropagation(); return; }
    e.stopPropagation();
    setSelectedPieceId(piece.id);
    setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null);
    setSelectedMeubleId(null); setSelectedWaypoint(null); setSelectedPointArrivee(false);
    setPanelResetTick(t => t + 1);
    if (piece.verrouillee) return;
    setDragMode({ kind: "personne", pieceId: piece.id });
  };

  // ─── VOITURE TÉMOIN (vue 3D) ─────────────────────────────────────────────────────
  // Même principe que la personne : une par pièce, purement visuelle (aucun effet sur circuits ni devis).
  const ajouterVoiture = (piece: Piece) => {
    const c = piece.contour.length > 0 ? centroide(piece.contour) : { x: 0, y: 0 };
    const centre = pointDansPolygone(c, piece.contour) ? c : piece.contour[0] ?? c;
    // Capot dans le sens de la plus grande dimension de la pièce.
    const xs = piece.contour.map(p => p.x), ys = piece.contour.map(p => p.y);
    const rotation = (Math.max(...ys) - Math.min(...ys)) > (Math.max(...xs) - Math.min(...xs)) ? 90 : 0;
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => p.id === piece.id ? { ...p, voiture: nouvelleVoiture(arrondiGrille(centre.x), arrondiGrille(centre.y), rotation) } : p),
    }));
  };
  const modifierVoiture = (pieceId: number, patch: Partial<NonNullable<Piece["voiture"]>>) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => p.id === pieceId && p.voiture ? { ...p, voiture: { ...p.voiture, ...patch } } : p),
    }));
  };
  const pivoterVoiture = (piece: Piece) => modifierVoiture(piece.id, { rotation: (((piece.voiture?.rotation ?? 0) + 90) % 360) });
  const retirerVoiture = (pieceId: number) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => { if (p.id !== pieceId) return p; const { voiture: _retiree, ...reste } = p; return reste; }),
    }));
  };
  const onVoiturePointerDown = (piece: Piece, e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return;
    if (mode !== "select" || placementType || placingTableau || placingOuverture || placingPointArrivee || placingMeuble) { e.stopPropagation(); return; }
    e.stopPropagation();
    setSelectedPieceId(piece.id);
    setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null);
    setSelectedMeubleId(null); setSelectedWaypoint(null); setSelectedPointArrivee(false);
    setPanelResetTick(t => t + 1);
    if (piece.verrouillee) return;
    setDragMode({ kind: "voiture", pieceId: piece.id });
  };

  // ─── SOMMETS DU CONTOUR D'UNE PIÈCE ────────────────────────────────────────────

  // Supprime le sommet `index` du contour de la pièce `pieceId`, si la pièce en compte
  // encore plus de 3 (un polygone ne peut pas descendre sous 3 sommets). Toute ouverture
  // (porte/fenêtre) posée sur l'un des deux murs qui se rejoignaient à ce sommet est
  // retirée avec lui (ces murs disparaissent, remplacés par un seul nouveau mur) ; les
  // autres ouvertures gardent leur position mais voient leur segIndex réindexé pour
  // suivre le décalage des sommets suivants.
  const supprimerSommetPiece = (pieceId: number, index: number) => {
    const piece = niveauActif?.pieces.find(p => p.id === pieceId);
    if (!piece) return;
    if (piece.verrouillee) {
      setPlacementError("Pièce verrouillée : déverrouille-la pour modifier ses sommets.");
      setTimeout(() => setPlacementError(null), 2000);
      return;
    }
    const n = piece.contour.length;
    if (n <= 3) {
      setPlacementError("Une pièce doit garder au moins 3 sommets.");
      setTimeout(() => setPlacementError(null), 2000);
      return;
    }
    let ouvertureSelectionneeSupprimee = false;
    updateNiveauActif(niv => ({
      ...niv,
      pieces: niv.pieces.map(p => {
        if (p.id !== pieceId) return p;
        const nouveauContour = p.contour.filter((_, i) => i !== index);
        const nouvellesOuvertures = (p.ouvertures ?? [])
          .map(o => {
            const nouveauSegIndex = remapperSegIndexApresSuppressionSommet(o.segIndex, index, n);
            if (nouveauSegIndex === null) {
              if (o.id === selectedOuvertureId) ouvertureSelectionneeSupprimee = true;
              return null;
            }
            return { ...o, segIndex: nouveauSegIndex };
          })
          .filter((o): o is Ouverture => o !== null);
        return { ...p, contour: nouveauContour, ouvertures: nouvellesOuvertures, murs: murAfterSuppressionSommet(p.murs, index) };
      }),
    }));
    if (editingSegment?.pieceId === pieceId) setEditingSegment(null);
    if (ouvertureSelectionneeSupprimee) { setSelectedOuvertureId(null); setSelectedBoite(null); }
    invalidateResultat();
  };

  // ─── OUVERTURES (portes/fenêtres) ──────────────────────────────────────────────
  // Aucun impact électrique — ne déclenchent jamais invalidateResultat().

  const supprimerOuverture = (ouvertureId: number) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({ ...p, ouvertures: (p.ouvertures ?? []).filter(o => o.id !== ouvertureId) })),
    }));
    setSelectedOuvertureId(null); setSelectedBoite(null);
  };
  const modifierOuverture = (ouvertureId: number, patch: Partial<Pick<Ouverture, "largeur" | "hauteur" | "allege" | "charniere" | "ouvreVersInterieur" | "coulisseVers" | "usage" | "battants" | "montage" | "nbVantaux">>) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p, ouvertures: (p.ouvertures ?? []).map(o => o.id === ouvertureId ? { ...o, ...patch } : o),
      })),
    }));
  };

  // ─── ESCALIERS ──────────────────────────────────────────────────────────────────────────────────────────
  const deselectionnerAutres = () => {
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null);
    setSelectedMeubleId(null); setSelectedWaypoint(null); setSelectedPointArrivee(false);
  };
  // Crée un escalier au centre de la vue (puis il se déplace / se règle comme les autres objets).
  const ajouterEscalier = (type: EscalierType, tournant?: EscalierTournant) => {
    if (!niveauActif || vue3D) { setEscalierMenuOpen(false); return; }   // le centre de la vue n'existe qu'en 2D
    const rect = svgRef.current?.getBoundingClientRect();
    const c = rect ? toMeters(rect.width / 2, rect.height / 2) : { x: 0, y: 0 };
    const esc = nouvelEscalier(type, arrondiGrille(c.x), arrondiGrille(c.y), niveauActif, niveaux, tournant);
    updateNiveauActif(n => ({ ...n, escaliers: [...(n.escaliers ?? []), esc] }));
    deselectionnerAutres(); setSelectedEscalierId(esc.id); setEscalierMenuOpen(false); setPanelResetTick(t => t + 1);
  };
  const modifierEscalier = (id: number, patch: Partial<Escalier>) => {
    updateNiveauActif(n => ({ ...n, escaliers: (n.escaliers ?? []).map(es => (es.id === id ? { ...es, ...patch } : es)) }));
  };
  const supprimerEscalier = (id: number) => {
    updateNiveauActif(n => ({ ...n, escaliers: (n.escaliers ?? []).filter(es => es.id !== id) }));
    setSelectedEscalierId(null);
  };
  // ─── DÉPLACER TOUT UN ÉTAGE ─────────────────────────────────────────────────────────────────────────────
  // Pour caler un étage sur l'escalier qui y arrive : toutes les pièces, leur contenu, les zones, le tableau et les escaliers du
  // niveau bougent ensemble. Le décalage est toujours calculé depuis le niveau d'origine (annulation exacte).
  const demarrerDeplacementNiveau = () => {
    if (!niveauActif || vue3D) return;
    setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null); setPlacingMeuble(false); setPlacingPointArrivee(false);
    setMode("select"); setEscalierMenuOpen(false); setOuvertureMenuOpen(false);
    deselectionnerAutres(); setSelectedEscalierId(null);
    departNiveauRef.current = niveauActif;
    setDeplacementNiveau({ depart: niveauActif, dx: 0, dy: 0 });
  };
  const appliquerDecalageNiveau = (dx: number, dy: number) => {
    const depart = departNiveauRef.current;
    if (!depart) return;
    setDeplacementNiveau(d => (d ? { ...d, dx, dy } : d));
    setNiveaux(nvs => nvs.map(n => (n.id === depart.id ? decalerNiveau(depart, dx, dy) : n)));
  };
  const terminerDeplacementNiveau = (annuler: boolean) => {
    const depart = departNiveauRef.current;
    if (annuler && depart) setNiveaux(nvs => nvs.map(n => (n.id === depart.id ? depart : n)));
    departNiveauRef.current = null;
    setDeplacementNiveau(null);
    invalidateResultat();   // les chemins de circuits calculés avant le déplacement ne sont plus à la bonne place
  };
  const onDeplacementNiveauDown = (e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !deplacementNiveau) return;
    const m = toMeters(e.clientX - rect.left, e.clientY - rect.top);
    setDragMode({ kind: "niveau", startX: m.x, startY: m.y, dx0: deplacementNiveau.dx, dy0: deplacementNiveau.dy });
  };

  const onEscalierPointerDown = (esc: Escalier, e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return;
    if (mode !== "select" || placementType || placingTableau || placingOuverture || placingPointArrivee || placingMeuble) { e.stopPropagation(); return; }
    e.stopPropagation();
    deselectionnerAutres(); setSelectedEscalierId(esc.id); setPanelResetTick(t => t + 1);
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const m = toMeters(e.clientX - rect.left, e.clientY - rect.top);
    setDragMode({ kind: "escalier", escalierId: esc.id, offX: esc.x - m.x, offY: esc.y - m.y });
  };

  // Fusionne la pièce « idPrincipale » avec une pièce adjacente : une seule pièce (contour union, murs, appareillages,
  // meubles et ouvertures conservés — seules les ouvertures du mur commun disparaissent). Voir lib/fusion-pieces.ts.
  const fusionnerAvecPiece = (idPrincipale: number, idAutre: number) => {
    const A = niveauActif?.pieces.find(p => p.id === idPrincipale);
    const B = niveauActif?.pieces.find(p => p.id === idAutre);
    if (!A || !B) return;
    const r = fusionnerPieces(A, B);
    if (!r.ok) { alert(r.erreur); return; }
    const nom = (p: Piece) => p.nom || PIECE_TYPES[p.type].label;
    const avert = r.ouverturesSupprimees > 0 ? `\n\n${r.ouverturesSupprimees} porte(s)/fenêtre(s) posée(s) sur le mur commun seront supprimées.` : "";
    if (!window.confirm(`Fusionner « ${nom(B)} » dans « ${nom(A)} » ?${avert}`)) return;
    updateNiveauActif(n => ({ ...n, pieces: n.pieces.filter(p => p.id !== idAutre).map(p => p.id === idPrincipale ? r.piece : p) }));
    setSelectedPieceId(idPrincipale); setSelectedAppareillageId(null); setSelectedOuvertureId(null); setSelectedMeubleId(null);
    setEditingSegment(null);
  };

  // Repositionne une ouverture pour qu'elle soit exactement à distanceCm d'une extrémité
  // du mur qui la porte (donc du mur perpendiculaire/coin à cette extrémité) — largeur
  // inchangée, seule sa position glisse le long du mur pour respecter la cote demandée.
  const modifierDistanceBordOuverture = (piece: Piece, o: Ouverture, cote: "A" | "B", distanceCm: number) => {
    const a = piece.contour[o.segIndex], b = piece.contour[(o.segIndex + 1) % piece.contour.length];
    const longueurCm = distance(a, b) * 100;
    if (longueurCm < 1) return;
    const positionCm = cote === "A"
      ? Math.max(0, distanceCm) + o.largeur / 2
      : longueurCm - Math.max(0, distanceCm) - o.largeur / 2;
    const t = Math.max(0, Math.min(1, positionCm / longueurCm));
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => p.id !== piece.id ? p : {
        ...p, ouvertures: (p.ouvertures ?? []).map(ou => ou.id === o.id ? { ...ou, position: t } : ou),
      }),
    }));
  };


  const renommerAppareillage = (appareillageId: number, nom: string) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.map(a => a.id === appareillageId ? { ...a, nom } : a),
      })),
    }));
  };

  // Bascule le flag "domotique" (liaison sans fil) d'un interrupteur/va-et-vient/
  // télérupteur — n'affecte que la visualisation du cheminement (symbole d'onde à la place
  // du trait plein retour/navette), jamais la composition électrique du circuit : aucune
  // régénération nécessaire.
  const modifierDomotique = (appareillageId: number, domotique: boolean) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.map(a => a.id === appareillageId ? { ...a, domotique } : a),
      })),
    }));
  };

  // Bascule le flag "déjà existant" — l'appareillage reste un membre à part entière du
  // circuit (tracé, génération), mais sort de la facturation du pré-devis (lui et sa boîte
  // d'encastrement) : voir predevis-engine.ts. Purement une question de facturation, aucun
  // impact électrique : aucune régénération nécessaire.
  const modifierDejaExistant = (appareillageId: number, dejaExistant: boolean) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.map(a => a.id === appareillageId ? { ...a, dejaExistant } : a),
      })),
    }));
  };

  // Rattache un appareillage à la pièce de son choix, indépendamment de sa position réelle
  // sur le plan (x/y inchangés — seule l'appartenance "pièce" change) : corrige un placement
  // automatique erroné (détection de pièce imprécise près d'un mur/coin) sans avoir à
  // redessiner ou redéplacer l'appareillage. Affecte le comptage des prises minimum par
  // pièce et le regroupement des circuits (le nom de pièce affiché vient de cette
  // appartenance, pas de la position), d'où l'invalidation du résultat déjà généré.
  const deplacerAppareillageVersPiece = (appareillageId: number, cibleId: number) => {
    updateNiveauActif(n => {
      let trouve: AppareillagePlace | null = null;
      const sansAppareil = n.pieces.map(p => {
        const idx = p.appareillages.findIndex(a => a.id === appareillageId);
        if (idx === -1) return p;
        trouve = p.appareillages[idx];
        return { ...p, appareillages: p.appareillages.filter(a => a.id !== appareillageId) };
      });
      if (!trouve) return n;
      return {
        ...n,
        pieces: sansAppareil.map(p => p.id === cibleId ? { ...p, appareillages: [...p.appareillages, trouve!] } : p),
      };
    });
    invalidateResultat();
  };

  // Réglages propres au volet roulant (caisson intérieur/extérieur, ouvert/fermé) — purement
  // visuels (plan + vue 3D) : aucun effet sur les circuits, donc pas d'invalidation du résultat.
  const modifierVolet = (appareillageId: number, patch: Partial<Pick<AppareillagePlace, "caisson" | "voletOuvertPct" | "voletCouleur">>) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.map(a => a.id === appareillageId ? { ...a, ...patch } : a),
      })),
    }));
  };

  // Couleur de plaque d'une prise / commande (vue 3D) — pour un seul appareillage, ou
  // appliquée d'un coup à toutes les prises et commandes de tous les niveaux (une gamme).
  const modifierCouleurAppareillage = (appareillageId: number, couleur: string) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => {
        const gid = p.appareillages.find(a => a.id === appareillageId)?.groupeId; // plaque : couleur commune
        return { ...p, appareillages: p.appareillages.map(a => a.id === appareillageId || (gid != null && a.groupeId === gid) ? { ...a, couleur } : a) };
      }),
    }));
  };
  const appliquerCouleurATousAppareillages = (couleur: string) => {
    setNiveaux(nvs => nvs.map(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.map(a => TYPES_APPAREILLAGE_COLORABLES.includes(a.type) ? { ...a, couleur } : a),
      })),
    })));
  };

  const modifierHauteur = (appareillageId: number, hauteur: number | undefined) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => {
        const gid = p.appareillages.find(a => a.id === appareillageId)?.groupeId; // plaque : hauteur commune
        return { ...p, appareillages: p.appareillages.map(a => a.id === appareillageId || (gid != null && a.groupeId === gid) ? { ...a, hauteur } : a) };
      }),
    }));
  };

  // Puissance (W) d'un chauffage — sert au regroupement des circuits chauffage par
  // puissance cumulée (NF C 15-100, amdt A5) : une régénération est nécessaire pour que
  // le changement se répercute sur les circuits déjà générés.
  const modifierPuissance = (appareillageId: number, puissanceW: number | undefined) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.map(a => a.id === appareillageId ? { ...a, puissanceW } : a),
      })),
    }));
    invalidateResultat();
  };

  // Repositionne l'appareillage pour qu'il soit exactement à distanceCm du mur segIndex
  // de sa pièce (n'importe lequel des murs, pas seulement le plus proche), sans bouger sa
  // position "le long de ce mur" — pratique pour caler une prise à une cote précise.
  const modifierDistanceSegment = (piece: Piece, appareillageId: number, segIndex: number, distanceCm: number) => {
    const appareillage = piece.appareillages.find(a => a.id === appareillageId);
    if (!appareillage) return;
    const nouveauPoint = positionnerADistanceDuSegment({ x: appareillage.x, y: appareillage.y }, piece.contour, segIndex, Math.max(0, distanceCm) / 100);
    const dx = nouveauPoint.x - appareillage.x, dy = nouveauPoint.y - appareillage.y;
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => p.id !== piece.id ? p : {
        ...p, appareillages: p.appareillages.map(a =>
          a.id === appareillageId ? { ...a, x: nouveauPoint.x, y: nouveauPoint.y }
            : (appareillage.groupeId != null && a.groupeId === appareillage.groupeId) ? { ...a, x: a.x + dx, y: a.y + dy } : a),
      }),
    }));
    invalidateResultat();
  };

  // Position exacte (mètres) — pour un placement au centimètre près sans passer par le drag.
  const modifierPositionExacte = (appareillageId: number, x: number, y: number) => {
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => {
        const cible = p.appareillages.find(a => a.id === appareillageId);
        if (!cible) return p;
        const dx = x - cible.x, dy = y - cible.y;
        return { ...p, appareillages: p.appareillages.map(a =>
          a.id === appareillageId ? { ...a, x, y }
            : (cible.groupeId != null && a.groupeId === cible.groupeId) ? { ...a, x: a.x + dx, y: a.y + dy } : a) };
      }),
    }));
    invalidateResultat();
  };

  const modifierTableauHauteur = (hauteur: number | undefined) => {
    updateNiveauActif(n => ({ ...n, tableauHauteur: hauteur }));
  };
  const modifierTableauRotation = (rotationDeg: number) => {
    updateNiveauActif(n => ({ ...n, tableauRotation: ((rotationDeg % 360) + 360) % 360 }));
  };
  // Calage rapide : aligne le tableau sur l'angle du mur le plus proche, quelle que soit
  // la distance (pas de seuil ici, contrairement au placement d'ouvertures) — pratique
  // utilitaire, l'angle reste ensuite librement modifiable à la main.
  const alignerTableauSurMur = () => {
    if (!niveauActif?.tableauPos) return;
    const mur = trouverMurLePlusProche(niveauActif.pieces, niveauActif.tableauPos, Infinity);
    if (!mur) return;
    const a = mur.piece.contour[mur.segIndex], b = mur.piece.contour[(mur.segIndex + 1) % mur.piece.contour.length];
    modifierTableauRotation(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI);
  };

  // ─── POINT D'ARRIVÉE DES GAINES (par étage) ────────────────────────────────────
  // Purement informatif — ne déclenche jamais invalidateResultat() (aucun impact sur la
  // composition électrique des circuits).

  const modifierPositionArriveeExacte = (x: number, y: number) => {
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    updateNiveauActif(n => ({ ...n, pointArriveeGaines: { x, y } }));
  };
  const modifierDistanceArriveeGaines = (distanceM: number | undefined) => {
    updateNiveauActif(n => ({ ...n, distanceArriveeGainesTableau: distanceM }));
  };
  const supprimerPointArrivee = () => {
    updateNiveauActif(n => ({ ...n, pointArriveeGaines: undefined, distanceArriveeGainesTableau: undefined }));
    setSelectedPointArrivee(false);
  };

  // ─── CIRCUITS MANUELS ────────────────────────────────────────────────────────

  // Ouvre le formulaire de création (existing: null) ou d'édition (existing: le circuit
  // cliqué) — même composant pour les deux, voir CircuitManuelForm.
  const ouvrirNouveauCircuitManuel = () => setCircuitManuelForm({ existing: null });
  const ouvrirEditionCircuitManuel = (m: CircuitManuel) => setCircuitManuelForm({ existing: m });

  // Création OU mise à jour d'un circuit manuel EN UN SEUL GESTE, membres compris : plus
  // besoin d'aller assigner appareillage par appareillage après coup. membreIds est l'état
  // complet souhaité (coché/décoché dans le formulaire) — les appareillages retirés de la
  // liste sont détachés, ceux ajoutés sont rattachés, en une seule mise à jour. creerBoite
  // (uniquement à la création d'un circuit lumière) crée aussi une première boîte de
  // dérivation, positionnée au tableau (ou à l'origine) faute de membres à ce stade.
  const validerCircuitManuel = (nom: string, famille: FamilleCircuitManuel, couleur: string | undefined, membreIds: number[], creerBoite: boolean, nonRelieTableau: boolean) => {
    const existing = circuitManuelForm?.existing ?? null;
    const id = existing ? existing.id : uidMaison();
    updateNiveauActif(n => ({
      ...n,
      boitesDerivation: (!existing && famille === "lumiere" && creerBoite)
        ? { ...(n.boitesDerivation ?? {}), [nom]: [{ id: uidMaison(), nom: "Boîte 1", point: origineCircuits(n) ?? { x: 0, y: 0 } }] }
        : n.boitesDerivation,
      circuitsManuels: existing
        ? (n.circuitsManuels ?? []).map(m => m.id === id ? { ...m, nom, famille, couleur, nonRelieTableau } : m)
        : [...(n.circuitsManuels ?? []), { id, nom, famille, couleur, nonRelieTableau }],
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.map(a => {
          const appartient = membreIds.includes(a.id);
          if (appartient) return a.circuitManuelId === id ? a : { ...a, circuitManuelId: id };
          return a.circuitManuelId === id ? { ...a, circuitManuelId: undefined } : a;
        }),
      })),
    }));
    setCircuitManuelForm(null);
    invalidateResultat();
  };
  const supprimerCircuitManuelEtFermer = (manuelId: number) => {
    supprimerCircuitManuel(manuelId);
    setCircuitManuelForm(null);
  };
  // Corrige le résultat déjà généré (breakers + circuitId sur les appareillages) après la
  // suppression d'UN circuit, au lieu de tout invalider (setResultat(null)) — sinon le
  // panneau "Circuits" se fermait à chaque suppression, obligeant à recliquer "Générer les
  // circuits" avant de pouvoir en supprimer un second. resultat.alertes n'est volontairement
  // pas recalculé ici (recalcul complet réservé à une vraie régénération) — le badge rouge
  // "non raccordé" sur le plan, lui, reste à jour car il lit circuitId en direct.
  const retirerBreakerDuResultat = (breakerId: number, membreIds: number[]) => {
    setResultat(r => r ? {
      ...r,
      breakers: r.breakers.filter(x => x.id !== breakerId),
      maison: {
        niveaux: r.maison.niveaux.map(n => ({
          ...n,
          pieces: n.pieces.map(p => ({
            ...p,
            appareillages: p.appareillages.map(a => membreIds.includes(a.id) ? { ...a, circuitId: undefined } : a),
          })),
        })),
      },
    } : r);
  };
  const supprimerCircuitManuel = (manuelId: number) => {
    const breaker = resultat?.breakers.find(b => b.manuelId === manuelId);
    const membreIds = niveauActif?.pieces.flatMap(p => p.appareillages).filter(a => a.circuitManuelId === manuelId).map(a => a.id) ?? [];
    updateNiveauActif(n => ({
      ...n,
      circuitsManuels: (n.circuitsManuels ?? []).filter(m => m.id !== manuelId),
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.map(a => a.circuitManuelId === manuelId ? { ...a, circuitManuelId: undefined, circuitId: undefined } : a),
      })),
    }));
    if (breaker) retirerBreakerDuResultat(breaker.id, membreIds);
  };
  // Supprime N'IMPORTE QUEL circuit déjà généré, manuel ou automatique. Un circuit manuel
  // se supprime lui-même (supprimerCircuitManuel, ci-dessus — ses membres retombent dans le
  // clustering automatique). Un circuit AUTOMATIQUE n'a pas d'existence propre à effacer :
  // le "supprimer" revient à exclure tous ses membres actuels (même mécanisme que "oublier"
  // un appareillage en redessinant son cheminement, voir terminerDessinCheminement) — ils
  // deviennent non raccordés, librement réaffectables ensuite, plutôt que reformer aussitôt
  // le même circuit à la prochaine génération.
  const supprimerCircuit = (b: Breaker) => {
    if (b.manuelId != null) { supprimerCircuitManuel(b.manuelId); return; }
    if (!niveauActif) return;
    const membreIds = niveauActif.pieces.flatMap(p => p.appareillages).filter(a => a.circuitId === b.id).map(a => a.id);
    updateNiveauActif(n => ({
      ...n,
      appareillagesExclus: Array.from(new Set([...(n.appareillagesExclus ?? []), ...membreIds])),
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.map(a => membreIds.includes(a.id) ? { ...a, circuitId: undefined } : a),
      })),
    }));
    retirerBreakerDuResultat(b.id, membreIds);
  };
  // Rattache (ou détache, avec undefined) un appareillage à un circuit manuel — prioritaire
  // sur le clustering automatique une fois "Générer les circuits" relancé.
  const assignerCircuitManuel = (appareillageId: number, manuelId: number | undefined) => {
    updateNiveauActif(n => ({
      ...n,
      // Une assignation manuelle explicite lève toute exclusion précédente — c'est
      // exactement le geste attendu pour "récupérer" un appareillage exclu.
      appareillagesExclus: manuelId != null ? (n.appareillagesExclus ?? []).filter(id => id !== appareillageId) : n.appareillagesExclus,
      pieces: n.pieces.map(p => ({
        ...p, appareillages: p.appareillages.map(a => a.id === appareillageId ? { ...a, circuitManuelId: manuelId } : a),
      })),
    }));
    invalidateResultat();
  };
  // Retire un appareillage de la liste d'exclusion (Niveau.appareillagesExclus) pour qu'il
  // rejoigne à nouveau la génération automatique à la prochaine régénération.
  const reinclureAppareillage = (appareillageId: number) => {
    updateNiveauActif(n => ({
      ...n, appareillagesExclus: (n.appareillagesExclus ?? []).filter(id => id !== appareillageId),
    }));
    invalidateResultat();
  };
  // Couleur d'un circuit déjà généré (manuel ou automatique) — voir construireColorMap
  // (maison-engine.ts) pour la logique de résolution symétrique.
  const definirCouleurCircuit = (b: Breaker, couleur: string) => {
    if (b.manuelId != null) {
      updateNiveauActif(n => ({
        ...n, circuitsManuels: (n.circuitsManuels ?? []).map(m => m.id === b.manuelId ? { ...m, couleur } : m),
      }));
    } else {
      updateNiveauActif(n => ({ ...n, couleursCircuits: { ...(n.couleursCircuits ?? {}), [b.label]: couleur } }));
    }
  };

  // Renomme N'IMPORTE QUEL circuit (manuel ou automatique). Un circuit manuel se renomme
  // directement via son CircuitManuel.nom (déjà la source de b.label) ; un circuit
  // automatique n'a pas de nom propre — le renommage est stocké à part (Niveau.nomsCircuits,
  // indexé par le label généré) et résolu à l'affichage via nomAffiche().
  const renommerCircuit = (b: Breaker, nom: string) => {
    if (b.manuelId != null) {
      updateNiveauActif(n => ({
        ...n, circuitsManuels: (n.circuitsManuels ?? []).map(m => m.id === b.manuelId ? { ...m, nom } : m),
      }));
    } else {
      updateNiveauActif(n => ({ ...n, nomsCircuits: { ...(n.nomsCircuits ?? {}), [b.label]: nom } }));
    }
  };
  const nomAffiche = (b: Breaker): string => niveauActif?.nomsCircuits?.[b.label] ?? b.label;
  // Variantes "directes" pour un circuit MANUEL pas encore généré (aucun Breaker n'existe
  // encore pour lui) — mêmes champs (CircuitManuel.nom / .couleur) que ci-dessus, appelées
  // depuis le panneau "Circuits" quand ce circuit n'a encore aucun appareillage raccordé.
  const renommerCircuitManuelDirect = (manuelId: number, nom: string) => {
    updateNiveauActif(n => ({ ...n, circuitsManuels: (n.circuitsManuels ?? []).map(m => m.id === manuelId ? { ...m, nom } : m) }));
  };
  const changerCouleurCircuitManuelDirect = (manuelId: number, couleur: string) => {
    updateNiveauActif(n => ({ ...n, circuitsManuels: (n.circuitsManuels ?? []).map(m => m.id === manuelId ? { ...m, couleur } : m) }));
  };

  // Ordre de câblage choisi à la main pour un circuit — indexé par label, voir
  // Niveau.ordresCircuits (maison-types.ts) et segmentsPourCircuit (maison-engine.ts) pour
  // la logique de tracé qui l'utilise.
  const appliquerOrdreCircuit = (label: string, ordre: number[]) => {
    updateNiveauActif(n => ({ ...n, ordresCircuits: { ...(n.ordresCircuits ?? {}), [label]: ordre } }));
  };
  const reinitialiserOrdreCircuit = (label: string) => {
    updateNiveauActif(n => {
      const { [label]: _retire, ...reste } = n.ordresCircuits ?? {};
      return { ...n, ordresCircuits: reste };
    });
  };

  // ─── DESSIN DU CHEMINEMENT (clic sur les appareillages du circuit, dans l'ordre) ───────
  const demarrerDessinCheminement = (b: Breaker) => {
    setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null); setPlacingMeuble(false);
    setPlacingPointArrivee(false); setSelectedPointArrivee(false); setLiaisonLumiereMode(null);
    setMode("select"); setDrawingPoints([]);
    setSelectedAppareillageId(null); setSelectedPieceId(null); setSelectedTableau(false); setSelectedMeubleId(null);
    setSelectedOuvertureId(null); setSelectedBoite(null); setSelectedWaypoint(null);
    const existant = niveauActif?.ordresCircuits?.[b.label];
    setCheminementDessin({ breaker: b, ordre: existant ? [...existant] : [] });
  };
  // Clic sur un appareillage pendant le dessin : l'ajoute à la suite du tracé s'il n'y est
  // pas déjà, ou le retire s'il y est déjà (pour corriger une erreur de clic sans tout refaire).
  const toggleAppareillageCheminement = (appareillageId: number) => {
    setCheminementDessin(cd => {
      if (!cd) return cd;
      const dansOrdre = cd.ordre.includes(appareillageId);
      return { ...cd, ordre: dansOrdre ? cd.ordre.filter(id => id !== appareillageId) : [...cd.ordre, appareillageId] };
    });
  };
  const terminerDessinCheminement = () => {
    if (!cheminementDessin) return;
    // Appareillage du circuit non recliqué en dessinant : pour un circuit MANUEL, reste
    // rattaché au même circuit (comportement historique, voir sequenceAncresCircuitOrdonnee)
    // — un simple avertissement suffit. Pour un circuit AUTOMATIQUE en revanche, "oublier"
    // un appareillage au clic doit vraiment l'EXCLURE de ce circuit (pas le rattacher quand
    // même en silence) — pour pouvoir librement le réaffecter ailleurs ensuite ; il devient
    // alors non raccordé, et une alerte le signale nommément après régénération.
    const estManuel = cheminementDessin.breaker.manuelId != null;
    const membres = niveauActif?.pieces.flatMap(p => p.appareillages).filter(a => a.circuitId === cheminementDessin.breaker.id) ?? [];
    const oublies = membres.filter(a => !cheminementDessin.ordre.includes(a.id));
    if (oublies.length > 0) {
      if (estManuel) {
        setPlacementError(`${oublies.length} appareillage(s) non cliqué(s) — resté(s) sur ce circuit, en fin de tracé.`);
      } else {
        updateNiveauActif(n => ({
          ...n,
          appareillagesExclus: Array.from(new Set([...(n.appareillagesExclus ?? []), ...oublies.map(a => a.id)])),
        }));
        setPlacementError(`${oublies.length} appareillage(s) exclu(s) de ce circuit — non raccordé(s) tant que tu ne les réaffectes pas.`);
      }
      setTimeout(() => setPlacementError(null), 3500);
    }
    appliquerOrdreCircuit(cheminementDessin.breaker.label, cheminementDessin.ordre);
    setCheminementDessin(null);
    if (!estManuel && oublies.length > 0) invalidateResultat();
  };
  const annulerDessinCheminement = () => setCheminementDessin(null);
  const reinitialiserDessinCheminement = () => {
    if (!cheminementDessin) return;
    reinitialiserOrdreCircuit(cheminementDessin.breaker.label);
    setCheminementDessin(null);
  };

  // ─── LIAISON DIRECTE ENTRE POINTS LUMINEUX (sans boîte de dérivation) ──────────────
  const demarrerLiaisonDirecteLumiere = (label: string) => {
    setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null); setPlacingPointArrivee(false); setPlacingMeuble(false);
    setMode("select"); setDrawingPoints([]); setCheminementDessin(null);
    setSelectedAppareillageId(null); setSelectedPieceId(null); setSelectedTableau(false); setSelectedMeubleId(null);
    setSelectedOuvertureId(null); setSelectedBoite(null); setSelectedWaypoint(null); setSelectedPointArrivee(false);
    setLiaisonLumiereMode({ label, premierId: null });
  };
  // Ajoute ou retire (toggle) une liaison directe entre deux points lumineux d'un même
  // circuit — purement une décision de routage du câblage, sans impact sur la composition
  // électrique du circuit : aucune régénération nécessaire.
  const toggleLiaisonDirecteLumiere = (label: string, id1: number, id2: number) => {
    const paire: [number, number] = id1 < id2 ? [id1, id2] : [id2, id1];
    updateNiveauActif(n => {
      const existantes = n.liaisonsDirectesLumiere?.[label] ?? [];
      const idx = existantes.findIndex(([a, b]) => a === paire[0] && b === paire[1]);
      const maj = idx >= 0 ? existantes.filter((_, i) => i !== idx) : [...existantes, paire];
      return { ...n, liaisonsDirectesLumiere: { ...(n.liaisonsDirectesLumiere ?? {}), [label]: maj } };
    });
  };
  const handleClicLumierePourLiaison = (id: number) => {
    setLiaisonLumiereMode(m => {
      if (!m) return m;
      if (m.premierId == null) return { ...m, premierId: id };
      if (m.premierId === id) return { ...m, premierId: null };
      toggleLiaisonDirecteLumiere(m.label, m.premierId, id);
      return { ...m, premierId: null };
    });
  };
  const annulerLiaisonLumiere = () => setLiaisonLumiereMode(null);

  // apresIndex = position dans la liste existante des coudes après laquelle insérer
  // (0 = avant le premier coude existant, longueur actuelle = après le dernier).
  const ajouterWaypoint = (cle: string, apresIndex: number, point: Point): number => {
    const id = uidMaison();
    updateNiveauActif(n => {
      const existants = n.liaisonWaypoints?.[cle] ?? [];
      // Couper une section en deux : les deux moitiés gardent sa pose ET sa hauteur (le nouveau coude porte celles
      // de la moitié qui y aboutit ; l'autre moitié garde ce que porte son coude / la fin de liaison).
      const poseCoupee = posesTroncons(n, cle, existants)[apresIndex];
      const hauteurCoupee = hauteursTroncons(n, cle, existants)[apresIndex];
      const nouveau: LiaisonWaypoint = {
        id, point,
        ...(poseCoupee === "apparent" ? { poseType: "apparent" as const } : {}),
        ...(hauteurCoupee != null ? { hauteurSection: hauteurCoupee } : {}),
      };
      const maj = [...existants.slice(0, apresIndex), nouveau, ...existants.slice(apresIndex)];
      return { ...n, liaisonWaypoints: { ...(n.liaisonWaypoints ?? {}), [cle]: maj } };
    });
    return id;
  };
  const supprimerWaypoint = (cle: string, waypointId: number) => {
    updateNiveauActif(n => ({
      ...n,
      liaisonWaypoints: { ...(n.liaisonWaypoints ?? {}), [cle]: (n.liaisonWaypoints?.[cle] ?? []).filter(w => w.id !== waypointId) },
    }));
    setSelectedWaypoint(null);
  };
  const modifierHauteurWaypoint = (cle: string, waypointId: number, hauteur: number | undefined) => {
    updateNiveauActif(n => ({
      ...n,
      liaisonWaypoints: {
        ...(n.liaisonWaypoints ?? {}),
        [cle]: (n.liaisonWaypoints?.[cle] ?? []).map(w => w.id === waypointId ? { ...w, hauteur } : w),
      },
    }));
  };
  // Pose d'UNE section de circuit (index = rang dans la liaison, 0 = depuis le point de départ). Les sections
  // portent leur pose sur le coude où elles aboutissent ; la dernière (après le dernier coude) sur la liaison.
  const modifierPoseTroncon = (cle: string, index: number, poseType: "encastre" | "apparent") => {
    updateNiveauActif(n => {
      const coudes = n.liaisonWaypoints?.[cle] ?? [];
      if (index < coudes.length) {
        return { ...n, liaisonWaypoints: { ...(n.liaisonWaypoints ?? {}), [cle]: coudes.map((w, k) => k === index ? { ...w, poseType } : w) } };
      }
      return { ...n, poseFinLiaison: { ...(n.poseFinLiaison ?? {}), [cle]: poseType } };
    });
  };
  // Hauteur (cm) d'UNE section de circuit — vide = non réglée (hauteur du coude, sinon hauteur de gaine par défaut sous plafond).
  const modifierHauteurTroncon = (cle: string, index: number, hauteurCm: number | undefined) => {
    updateNiveauActif(n => {
      const coudes = n.liaisonWaypoints?.[cle] ?? [];
      if (index < coudes.length) {
        return { ...n, liaisonWaypoints: { ...(n.liaisonWaypoints ?? {}), [cle]: coudes.map((w, k) => k === index ? { ...w, hauteurSection: hauteurCm } : w) } };
      }
      const fin = { ...(n.hauteurFinLiaison ?? {}) };
      if (hauteurCm == null) delete fin[cle]; else fin[cle] = hauteurCm;
      return { ...n, hauteurFinLiaison: fin };
    });
  };
  // Mode de pose (encastré dans le mur / apparent en goulotte) du passage de gaine à ce
  // coude — affiché avec la hauteur sur l'impression technique (option "hauteurs d'implantation").
  const modifierPoseWaypoint = (cle: string, waypointId: number, poseType: "encastre" | "apparent") => {
    updateNiveauActif(n => ({
      ...n,
      liaisonWaypoints: {
        ...(n.liaisonWaypoints ?? {}),
        [cle]: (n.liaisonWaypoints?.[cle] ?? []).map(w => w.id === waypointId ? { ...w, poseType } : w),
      },
    }));
  };

  const lierCommande = (itemId: number, pointLumineuxIds: number[], pointLumineuxIds2: number[] = []) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.map(a => a.id === itemId
          ? { ...a, commandePourIds: pointLumineuxIds, commandePourIds2: estCommandeDouble(a.type) ? pointLumineuxIds2 : undefined }
          : a),
      })),
    }));
    setPendingCommande(null);
    invalidateResultat();
  };

  const appliquerLongueurSegment = (nouvelleLongueurCm: number, mur: MurSpec) => {
    if (!editingSegment) return;
    const longueurAvant = longueurUtileCm(niveauActif!.pieces.find(p => p.id === editingSegment.pieceId)!, editingSegment.segIndex);
    updateNiveauActif(n => {
      // 1) épaisseurs du mur (reportées sur le côté mitoyen voisin), 2) longueur INTÉRIEURE demandée.
      const mursNouveaux = mursDe(n.pieces.find(p => p.id === editingSegment.pieceId)!);
      mursNouveaux[editingSegment.segIndex] = mur;
      const avecMurs = appliquerMurs(n.pieces, editingSegment.pieceId, mursNouveaux);
      preparerMurs(avecMurs);
      const ancienContour = avecMurs.find(p => p.id === editingSegment.pieceId)!.contour;
      const pieces = avecMurs.map(p => {
        if (p.id !== editingSegment.pieceId) return p;
        const contour = redimensionnerMurUtile(p, editingSegment.segIndex, nouvelleLongueurCm);
        return { ...p, contour, appareillages: reporterAppareillages(p.contour, contour, p.appareillages) };
      });
      // Les pièces voisines ne bougent JAMAIS : seule la pièce modifiée change de dimensions.
      void ancienContour;
      return { ...n, pieces };
    });
    // Seule une vraie modification de LONGUEUR déplace des appareillages : un simple changement d'épaisseur
    // de mur ne touche pas aux circuits, qui restent affichés.
    if (nouvelleLongueurCm !== longueurAvant) invalidateResultat();
    setEditingSegment(null);
  };

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return; // dessin de cheminement / liaison directe : seuls les appareillages ciblés réagissent
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const m = toMeters(px, py);

    if (mode === "dessiner") {
      if (formeDessin === "rectangle") {
        const { point: pr } = snapDessin(m);
        if (drawingPoints.length === 0) { setDrawingPoints([pr]); return; }
        const p0 = drawingPoints[0];
        if (Math.abs(pr.x - p0.x) < 0.1 || Math.abs(pr.y - p0.y) < 0.1) return;
        finirDessin(rectangleDepuis(p0, pr));
        return;
      }
      if (drawingPoints.length >= 3) {
        const first = toScreen(drawingPoints[0]);
        if (Math.hypot(px - first.x, py - first.y) < 12) { finirDessin(drawingPoints); return; }
      }
      const { point: mSnap } = snapDessin(m);
      setDrawingPoints(pts => [...pts, mSnap]);
      return;
    }

    if (mode === "cloison") {
      if (cloisonEnAttente) return;
      const erreurCloison = (msg: string) => { setPlacementError(msg); setTimeout(() => setPlacementError(null), 2600); };
      const cur = curseurCloison(m);
      if (!cur) {
        erreurCloison(cloisonPoints.length === 0 ? "Clique sur un mur de la pièce pour démarrer la cloison." : "Clique à l'intérieur de la pièce (angle de la cloison) ou sur un mur (fin de la cloison).");
        return;
      }
      if (cloisonPoints.length === 0) { setCloisonPoints([cur.point]); return; }
      if (distance(cur.point, cloisonPoints[cloisonPoints.length - 1]) < 0.05) return;
      if (cur.surMur) {
        if (!cur.piece) { erreurCloison("Impossible de déterminer la pièce à cloisonner."); return; }
        const chemin = [...cloisonPoints, cur.point];
        const ap = apercuCloison(cur.piece, chemin);
        if ("erreur" in ap) { erreurCloison(ap.erreur); return; }
        setCloisonEnAttente({ pieceId: cur.piece.id, chemin });
        return;
      }
      if (!cur.piece) { erreurCloison("Le point doit être à l'intérieur de la pièce à cloisonner."); return; }
      setCloisonPoints(pts => [...pts, cur.point]);
      return;
    }

    if (mode === "zone") {
      if (zoneEnAttente) return;
      const cur = curseurZone(m);
      if (!cur) return;
      if (cur.ferme) { terminerTraceZone(true); return; }
      if (zonePoints.length > 0 && distance(cur.point, zonePoints[zonePoints.length - 1]) < 0.05) return;
      setZonePoints(pts => [...pts, cur.point]);
      return;
    }

    if (placingTableau) {
      const actifEstMaison = !!niveauActif && !estAnnexe(niveauActif);
      setNiveaux(nvs => nvs.map(n => {
        if (n.id === niveauActifId) return { ...n, tableauPos: m };
        // Un seul tableau pour la maison : on le retire des autres niveaux de la maison.
        if (actifEstMaison && !estAnnexe(n) && n.tableauPos) return { ...n, tableauPos: undefined, tableauHauteur: undefined, tableauRotation: undefined };
        return n;
      }));
      setPlacingTableau(false);
      invalidateResultat();
      return;
    }

    if (placingPointArrivee) {
      updateNiveauActif(n => ({ ...n, pointArriveeGaines: m }));
      setPlacingPointArrivee(false);
      return;
    }

    if (placementType) {
      const piece = niveauActif ? trouverPiece(m, niveauActif.pieces) : null;
      if (!piece) {
        setPlacementError("Clique à l'intérieur d'une pièce dessinée.");
        setTimeout(() => setPlacementError(null), 2000);
        return;
      }
      const mAimantee = e.altKey ? m : aimanterSurFaceMur(m, piece, placementType, SNAP_MUR_PX / (PX_PER_M * zoom));
      const mPose = placementType === "volet_roulant" && !e.altKey && niveauActif
        ? recentrerVolet(mAimantee, piece, niveauActif.pieces)
        : mAimantee;
      if (plaquePostes && plaquePostes.length >= MIN_POSTES_PLAQUE) {
        // Appareillage multiple : tous les postes d'un coup, alignés le long du mur, centrés sur le clic.
        const postes = nouvellePlaque(plaquePostes, mPose.x, mPose.y);
        const pts = disposerPlaque(mPose, piece.contour, postes.length);
        postes.forEach((a, i) => { a.x = pts[i].x; a.y = pts[i].y; });
        updateNiveauActif(n => ({
          ...n,
          pieces: n.pieces.map(p => p.id === piece.id ? { ...p, appareillages: [...p.appareillages, ...postes] } : p),
        }));
        invalidateResultat();
        // Un poste de commande se lie à ses points lumineux comme un interrupteur seul (le premier d'abord).
        const premiereCommande = postes.find(a => estCommande(a.type));
        if (premiereCommande) setPendingCommande({ item: premiereCommande, estNouveau: false });
        return;
      }
      const nouveau = nouvelAppareillage(placementType, mPose.x, mPose.y);
      updateNiveauActif(n => ({
        ...n,
        pieces: n.pieces.map(p => p.id === piece.id ? { ...p, appareillages: [...p.appareillages, nouveau] } : p),
      }));
      invalidateResultat();
      if (estCommande(placementType)) {
        setPendingCommande({ item: nouveau, estNouveau: true });
      }
      return;
    }

    if (placingMeuble) {
      const piece = niveauActif ? trouverPiece(m, niveauActif.pieces) : null;
      if (!piece) {
        setPlacementError("Clique à l'intérieur d'une pièce dessinée.");
        setTimeout(() => setPlacementError(null), 2000);
        return;
      }
      const nouveau = nouveauMeuble(arrondiGrille(m.x), arrondiGrille(m.y));
      updateNiveauActif(n => ({
        ...n,
        pieces: n.pieces.map(p => p.id === piece.id ? { ...p, meubles: [...(p.meubles ?? []), nouveau] } : p),
      }));
      setSelectedMeubleId(nouveau.id);
      return;
    }

    if (placingOuverture) {
      const seuilM = SEUIL_MUR_PX / (PX_PER_M * zoom);
      // Une cloison de zone (dressing, cloison libre) prime sur un mur de pièce : c'est elle que l'on vise.
      const cz = niveauActif ? trouverCloisonZone(niveauActif.zones ?? [], m, seuilM) : null;
      if (cz) {
        const nouvelleZ = nouvelleOuverture(placingOuverture, cz.segIndex, cz.t, placingUsagePorte);
        if (placingOuverture === "porte_coulissante") nouvelleZ.montage = placingMontage;
        const posZ = positionOuvertureValide(cz.t, nouvelleZ.largeur, longueurCote(cz.zone, cz.segIndex));
        if (posZ == null) { messageZone(`Cette cloison est trop courte pour une ${LABEL_OUVERTURE[placingOuverture].toLowerCase()} de ${nouvelleZ.largeur} cm.`, 3200); return; }
        nouvelleZ.position = posZ;
        majZone(cz.zone.id, z => ({ ...z, ouvertures: [...(z.ouvertures ?? []), nouvelleZ] }));
        setSelectedZoneId(cz.zone.id); setSelectedZoneOuv({ zoneId: cz.zone.id, ouvId: nouvelleZ.id });
        return;
      }
      const mur = niveauActif ? trouverMurLePlusProche(niveauActif.pieces, m, seuilM) : null;
      if (!mur) {
        setPlacementError("Clique tout près d'un mur pour y placer une porte ou une fenêtre.");
        setTimeout(() => setPlacementError(null), 2000);
        return;
      }
      const nouvelle = nouvelleOuverture(placingOuverture, mur.segIndex, mur.t, placingUsagePorte);
      if (placingOuverture === "porte_coulissante") nouvelle.montage = placingMontage;
      updateNiveauActif(n => ({
        ...n,
        pieces: n.pieces.map(p => p.id === mur.piece.id ? { ...p, ouvertures: [...(p.ouvertures ?? []), nouvelle] } : p),
      }));
      return;
    }

    setSelectedPieceId(null);
    setSelectedAppareillageId(null);
    setSelectedTableau(false);
    setSelectedOuvertureId(null); setSelectedBoite(null);
    setSelectedWaypoint(null);
    setSelectedPointArrivee(false);
    setSelectedMeubleId(null);
    setSelectedZoneId(null); setSelectedZoneOuv(null);
    setDragMode({ kind: "pan", startX: e.clientX, startY: e.clientY, startPan: pan });
  };

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    if (mode !== "dessiner" && mode !== "cloison" && mode !== "zone") return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCursorPx({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // Sélection d'une pièce par son id (liste déroulante, clic sur son étiquette, Ctrl+clic en cascade).
  const selectionnerPiece = (id: number) => {
    setMode("select");
    setSelectedPieceId(id);
    setSelectedAppareillageId(null);
    setSelectedTableau(false);
    setSelectedOuvertureId(null); setSelectedBoite(null);
    setSelectedWaypoint(null);
    setSelectedMeubleId(null);
    setPanelResetTick(t => t + 1);
  };

  const onPieceDown = (piece: Piece, e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode || mode === "dessiner" || mode === "cloison" || mode === "zone" || placementType || placingTableau || placingOuverture || placingPointArrivee || placingMeuble) return;
    e.stopPropagation();
    // Ctrl (ou Cmd) + clic : sélectionne la pièce SOUS celle du dessus, à l'endroit cliqué (clics répétés = on descend, puis on boucle).
    if ((e.ctrlKey || e.metaKey) && niveauActif) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect) {
        const m = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        const dessous = [...niveauActif.pieces].reverse().filter(pc => pointDansPolygone(m, pc.contour));
        if (dessous.length > 1) {
          const i = dessous.findIndex(pc => pc.id === selectedPieceId);
          selectionnerPiece(dessous[(i + 1) % dessous.length].id);
          return;
        }
      }
    }
    if (selectedPieceId === piece.id) {
      if (piece.verrouillee) return; // pièce verrouillée : sélectionnée mais jamais déplacée
      setDragMode({ kind: "piece", pieceId: piece.id, startX: e.clientX, startY: e.clientY, startContour: piece.contour });
    } else {
      setSelectedPieceId(piece.id);
      setSelectedAppareillageId(null);
      setSelectedTableau(false);
      setSelectedOuvertureId(null); setSelectedBoite(null);
      setSelectedWaypoint(null);
      setSelectedMeubleId(null);
      setPanelResetTick(t => t + 1);
    }
  };

  const onVertexDown = (pieceId: number, index: number, e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return;
    e.stopPropagation();
    if (niveauActif?.pieces.find(p => p.id === pieceId)?.verrouillee) return;
    setDragMode({ kind: "vertex", pieceId, vertexIndex: index });
  };

  const onAppareillagePointerDown = (piece: Piece, a: AppareillagePlace, e: React.PointerEvent) => {
    if (liaisonLumiereMode) {
      e.stopPropagation();
      if (estLumiere(a.type)) {
        handleClicLumierePourLiaison(a.id);
      } else {
        setPlacementError("Sélectionne un point lumineux pour créer une liaison directe.");
        setTimeout(() => setPlacementError(null), 2000);
      }
      return;
    }
    if (cheminementDessin) {
      e.stopPropagation();
      if (a.circuitId === cheminementDessin.breaker.id) {
        toggleAppareillageCheminement(a.id);
      } else {
        setPlacementError("Cet appareillage n'appartient pas à ce circuit.");
        setTimeout(() => setPlacementError(null), 2000);
      }
      return;
    }
    if (mode !== "select" || placementType || placingTableau || placingOuverture || placingPointArrivee || placingMeuble) { e.stopPropagation(); return; }
    e.stopPropagation();
    // Sélectionne ET arme le déplacement dès le premier appui (comme un vrai
    // glisser-déposer) : un simple clic sans bouger équivaut juste à une sélection,
    // puisque le déplacement ne prend effet qu'au premier pointermove.
    setSelectedAppareillageId(a.id);
    setSelectedTableau(false);
    setSelectedPieceId(null);
    setSelectedOuvertureId(null); setSelectedBoite(null);
    setSelectedWaypoint(null);
    setSelectedPointArrivee(false);
    setSelectedMeubleId(null);
    setPanelResetTick(t => t + 1);
    if (piece.verrouillee) return; // sélectionné (panneau accessible) mais non déplaçable
    setDragMode({ kind: "appareillage", pieceId: piece.id, appareillageId: a.id });
  };

  const onMeublePointerDown = (piece: Piece, m: MeubleSimple, e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return;
    if (mode !== "select" || placementType || placingTableau || placingOuverture || placingPointArrivee || placingMeuble) { e.stopPropagation(); return; }
    e.stopPropagation();
    setSelectedMeubleId(m.id);
    setSelectedAppareillageId(null);
    setSelectedTableau(false);
    setSelectedPieceId(null);
    setSelectedOuvertureId(null); setSelectedBoite(null);
    setSelectedWaypoint(null);
    setSelectedPointArrivee(false);
    setPanelResetTick(t => t + 1);
    if (piece.verrouillee) return;
    setDragMode({ kind: "meuble", pieceId: piece.id, meubleId: m.id });
  };

  // Verrouillage d'une pièce (ou de toutes celles du niveau actif) — voir Piece.verrouillee.
  const verrouillerPiece = (pieceId: number, verrouillee: boolean) => {
    updateNiveauActif(n => ({ ...n, pieces: n.pieces.map(p => p.id === pieceId ? { ...p, verrouillee: verrouillee || undefined } : p) }));
  };
  const verrouillerToutLeNiveau = (verrouillee: boolean) => {
    updateNiveauActif(n => ({ ...n, pieces: n.pieces.map(p => ({ ...p, verrouillee: verrouillee || undefined })) }));
  };

  // Poignée ✥ de l'étiquette d'une pièce : démarre son déplacement à la main. offsetDepart =
  // décalage actuel (m) par rapport au centre de la pièce — y compris quand la position affichée
  // vient du placement automatique, pour que l'étiquette ne « saute » pas au premier mouvement.
  const onNomPieceDown = (piece: Piece, offsetDepart: Point, e: React.PointerEvent) => {
    if (mode !== "select" || placementType || placingTableau || placingOuverture || placingPointArrivee || placingMeuble) { e.stopPropagation(); return; }
    e.stopPropagation();
    if (piece.verrouillee) return;
    setDragMode({ kind: "nomPiece", pieceId: piece.id, startX: e.clientX, startY: e.clientY, startOffset: offsetDepart });
  };
  // Double-clic sur la poignée (ou bouton du panneau) : retour au placement automatique.
  const reinitialiserNomPiece = (pieceId: number) => {
    updateNiveauActif(n => ({ ...n, pieces: n.pieces.map(p => p.id === pieceId ? { ...p, nomDecalage: undefined } : p) }));
  };

  const onTableauPointerDown = (e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return;
    if (mode !== "select" || placementType || placingTableau || placingOuverture || placingPointArrivee || placingMeuble) { e.stopPropagation(); return; }
    e.stopPropagation();
    setSelectedTableau(true);
    setSelectedPieceId(null);
    setSelectedAppareillageId(null);
    setSelectedOuvertureId(null); setSelectedBoite(null);
    setSelectedWaypoint(null);
    setSelectedPointArrivee(false);
    setSelectedMeubleId(null);
    setPanelResetTick(t => t + 1);
    setDragMode({ kind: "tableau" });
  };

  const onPointArriveePointerDown = (e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return;
    if (mode !== "select" || placementType || placingTableau || placingOuverture || placingPointArrivee || placingMeuble) { e.stopPropagation(); return; }
    e.stopPropagation();
    setSelectedPointArrivee(true);
    setSelectedPieceId(null);
    setSelectedAppareillageId(null);
    setSelectedTableau(false);
    setSelectedOuvertureId(null); setSelectedBoite(null);
    setSelectedWaypoint(null);
    setSelectedMeubleId(null);
    setPanelResetTick(t => t + 1);
    setDragMode({ kind: "pointArrivee" });
  };

  const onOuverturePointerDown = (piece: Piece, o: Ouverture, e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return;
    if (mode !== "select" || placementType || placingTableau || placingOuverture || placingPointArrivee || placingMeuble) { e.stopPropagation(); return; }
    e.stopPropagation();
    setSelectedOuvertureId(o.id);
    setSelectedPieceId(null);
    setSelectedAppareillageId(null);
    setSelectedTableau(false);
    setSelectedBoite(null);
    setSelectedWaypoint(null);
    setSelectedPointArrivee(false);
    setSelectedMeubleId(null);
    setPanelResetTick(t => t + 1);
    if (piece.verrouillee) return;
    setDragMode({ kind: "ouverture", pieceId: piece.id, ouvertureId: o.id });
  };

  const onBoitePointerDown = (label: string, boite: BoiteDerivation | null, positionActuelle: Point, e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return;
    if (mode !== "select" || placementType || placingTableau || placingOuverture || placingPointArrivee || placingMeuble) { e.stopPropagation(); return; }
    e.stopPropagation();
    let boiteId = boite?.id;
    if (boiteId == null) {
      // Boîte implicite (jamais nommée) : la première interaction la "promeut" en vraie
      // boîte nommée, à sa position actuelle — pour qu'elle devienne déplaçable et
      // renommable comme n'importe quelle autre dès qu'on y touche.
      boiteId = uidMaison();
      const nouvelId = boiteId;
      updateNiveauActif(n => ({
        ...n,
        boitesDerivation: {
          ...(n.boitesDerivation ?? {}),
          [label]: [...(n.boitesDerivation?.[label] ?? []), { id: nouvelId, nom: "Boîte 1", point: positionActuelle }],
        },
      }));
    }
    setSelectedBoite({ label, boiteId });
    setSelectedPieceId(null);
    setSelectedAppareillageId(null);
    setSelectedTableau(false);
    setSelectedOuvertureId(null);
    setSelectedWaypoint(null);
    setSelectedPointArrivee(false);
    setSelectedMeubleId(null);
    setPanelResetTick(t => t + 1);
    setDragMode({ kind: "boite", label, boiteId });
  };
  // Ajoute une nouvelle boîte de dérivation nommée à un circuit d'éclairage — proposée pour
  // tout circuit lumière, généré (label = breaker.label) ou manuel pas encore généré (label
  // = nom du CircuitManuel, qui deviendra son label naturel dès la première génération).
  const ajouterBoiteDerivation = (label: string) => {
    if (!niveauActif) return;
    const breaker = resultat?.breakers.find(b => b.label === label);
    let centre = origineCircuits(niveauActif) ?? { x: 0, y: 0 };
    if (breaker) {
      const lumieres = niveauActif.pieces.flatMap(p => p.appareillages)
        .filter(a => a.circuitId === breaker.id && (estLumiere(a.type)));
      if (lumieres.length > 0) centre = centroidePoints(lumieres.map(l => ({ x: l.x, y: l.y })));
    }
    const existantes = niveauActif.boitesDerivation?.[label] ?? [];
    const decalage = existantes.length * 0.4;
    const nouvelle: BoiteDerivation = { id: uidMaison(), nom: `Boîte ${existantes.length + 1}`, point: { x: centre.x + decalage, y: centre.y } };
    updateNiveauActif(n => ({ ...n, boitesDerivation: { ...(n.boitesDerivation ?? {}), [label]: [...existantes, nouvelle] } }));
  };
  const renommerBoiteDerivation = (label: string, boiteId: number, nom: string) => {
    updateNiveauActif(n => ({
      ...n,
      boitesDerivation: { ...(n.boitesDerivation ?? {}), [label]: (n.boitesDerivation?.[label] ?? []).map(b => b.id === boiteId ? { ...b, nom } : b) },
    }));
  };
  // Position exacte (mètres) d'une boîte de dérivation — pour un placement au centimètre
  // près sans passer par le drag, même logique que modifierPositionExacte (appareillage).
  const modifierPositionBoite = (label: string, boiteId: number, x: number, y: number) => {
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    updateNiveauActif(n => ({
      ...n,
      boitesDerivation: {
        ...(n.boitesDerivation ?? {}),
        [label]: (n.boitesDerivation?.[label] ?? []).map(b => b.id === boiteId ? { ...b, point: { x, y } } : b),
      },
    }));
  };
  const supprimerBoiteDerivation = (label: string, boiteId: number) => {
    updateNiveauActif(n => ({
      ...n,
      boitesDerivation: { ...(n.boitesDerivation ?? {}), [label]: (n.boitesDerivation?.[label] ?? []).filter(b => b.id !== boiteId) },
    }));
    setSelectedBoite(null);
  };

  // Supprime le niveau actif (niveau de la maison ou annexe) — enregistré tout de suite, en une
  // fois : plan + (pour une annexe) suppression de son tableau et de ses rangées.
  const supprimerNiveauActif = async () => {
    if (!niveauActif || niveaux.length <= 1) return;
    setSuppNiveauEnCours(true);
    try {
      const cible = niveauActif;
      const restants = niveaux.filter(n => n.id !== cible.id);
      if (estAnnexe(cible)) {
        const liste = await synchroniserAnnexes(projet.id, annexes.filter(a => a.id !== cible.tableauId).map(a => ({ id: a.id, nom: a.nom })));
        setAnnexes(liste);
      }
      const ok = await modifierProjet(projet.id, { maison_config: JSON.stringify({ niveaux: restants }) });
      if (!ok) { alert("La suppression n'a pas pu être enregistrée."); return; }
      const suivant = [...restants].sort((a, b) => a.ordre - b.ordre)[0];
      setNiveaux(restants);
      setNiveauActifId(suivant.id);
      setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null);
      setSelectedBoite(null); setSelectedPointArrivee(false); setSelectedMeubleId(null); setCheminementDessin(null); setLiaisonLumiereMode(null);
      setResultat(null); setShowCircuits(false);
      setConfirmSuppNiveau(false);
    } finally { setSuppNiveauEnCours(false); }
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    await modifierProjet(projet.id, { maison_config: JSON.stringify({ niveaux }) });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [niveaux, projet.id]);


  // ─── ANNULER / REFAIRE + SAUVEGARDE AUTOMATIQUE ─────────────────────────────────────────────────
  // Une « action » = un changement du plan qui se stabilise (500 ms sans nouvelle modification, et aucun glisser en
  // cours) : un déplacement à la souris, une saisie, une pose, une suppression… comptent chacun pour UNE action.
  // Chaque action empile l'état précédent (annulable : bouton ou Ctrl+Z, refaire : Ctrl+Y / Ctrl+Maj+Z) ; toutes les
  // 5 actions, le plan est enregistré tout seul. « Sauvegarder » reste disponible à tout moment.
  const HISTORIQUE_MAX = 60;
  const ACTIONS_PAR_SAUVEGARDE_AUTO = 5;
  const niveauxRef = useRef<Niveau[]>(niveaux);
  niveauxRef.current = niveaux;
  const dernierEtatRef = useRef<Niveau[] | null>(null);
  const pileAnnulerRef = useRef<Niveau[][]>([]);
  const pileRefaireRef = useRef<Niveau[][]>([]);
  const compteActionsRef = useRef(0);
  const [, setHistoTick] = useState(0);
  const [autoSaveMsg, setAutoSaveMsg] = useState<string | null>(null);

  const sauvegardeAuto = useCallback(async (etat: Niveau[]) => {
    const ok = await modifierProjet(projet.id, { maison_config: JSON.stringify({ niveaux: etat }) });
    setAutoSaveMsg(ok ? "Sauvegarde auto ✓" : "Sauvegarde auto impossible");
    setTimeout(() => setAutoSaveMsg(null), 2500);
  }, [projet.id]);

  const compterAction = useCallback((etat: Niveau[]) => {
    compteActionsRef.current += 1;
    if (compteActionsRef.current % ACTIONS_PAR_SAUVEGARDE_AUTO === 0) void sauvegardeAuto(etat);
  }, [sauvegardeAuto]);

  useEffect(() => {
    if (loading) return;
    if (dernierEtatRef.current === null) { dernierEtatRef.current = niveaux; return; }   // état chargé : point de départ
    if (dragMode.kind !== "none") return;                                                  // pas pendant un glisser
    if (niveaux === dernierEtatRef.current) return;
    const t = setTimeout(() => {
      const avant = dernierEtatRef.current;
      if (!avant || avant === niveauxRef.current) return;
      pileAnnulerRef.current.push(avant);
      if (pileAnnulerRef.current.length > HISTORIQUE_MAX) pileAnnulerRef.current.shift();
      pileRefaireRef.current = [];
      dernierEtatRef.current = niveauxRef.current;
      setHistoTick(x => x + 1);
      compterAction(niveauxRef.current);
    }, 500);
    return () => clearTimeout(t);
  }, [niveaux, dragMode.kind, loading, compterAction]);

  // Remplace tout le plan par un état de l'historique, et referme tout ce qui dépendait de l'ancien (sélections, circuits générés).
  const restaurerEtat = (etat: Niveau[]) => {
    dernierEtatRef.current = etat;
    setNiveaux(etat);
    setNiveauActifId(id => (etat.some(n => n.id === id) ? id : [...etat].sort((a, b) => a.ordre - b.ordre)[0]?.id ?? null));
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null);
    setSelectedBoite(null); setSelectedMeubleId(null); setSelectedPointArrivee(false); setSelectedZoneId(null); setSelectedZoneOuv(null);
    setEditingPiece(null); setEditingSegment(null);
    setResultat(null); setShowCircuits(false);
    setHistoTick(x => x + 1);
    compterAction(etat);
  };
  const annuler = () => {
    const courant = niveauxRef.current, base = dernierEtatRef.current;
    let cible: Niveau[] | undefined;
    if (base && courant !== base) cible = base;                       // modification pas encore enregistrée dans l'historique
    else cible = pileAnnulerRef.current.pop();
    if (!cible) return;
    pileRefaireRef.current.push(courant);
    restaurerEtat(cible);
  };
  const refaire = () => {
    const cible = pileRefaireRef.current.pop();
    if (!cible) return;
    pileAnnulerRef.current.push(niveauxRef.current);
    restaurerEtat(cible);
  };
  const peutAnnuler = pileAnnulerRef.current.length > 0 || (dernierEtatRef.current !== null && dernierEtatRef.current !== niveaux);
  const peutRefaire = pileRefaireRef.current.length > 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); annuler(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); refaire(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compterAction]);

  const handleGenerer = () => {
    const res = genererCircuits({ niveaux });
    setResultat(res);
    setNiveaux(res.maison.niveaux);
    setShowCircuits(true);
    setCircuitsVisibles(new Set(res.breakers.map(b => b.id)));
  };

  const toggleCircuitVisible = (breakerId: number) => {
    setCircuitsVisibles(prev => {
      const next = new Set(prev);
      if (next.has(breakerId)) next.delete(breakerId); else next.add(breakerId);
      return next;
    });
  };

  const capturerEtImprimer3D = () => {
    const img = vue3DRef.current?.capturerImage();
    if (!img) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>Vue 3D — ${client?.nom ?? ""}</title><style>@page{margin:10mm}body{margin:0;text-align:center}img{max-width:100%}</style></head><body><img src="${img}" /></body></html>`);
    w.document.close();
    setTimeout(() => { w.print(); w.close(); }, 400);
  };

  const handleImprimer3D = (niveauId: number) => {
    setShow3DPrintForm(false);
    if (niveauId === niveauActifId) {
      setTimeout(capturerEtImprimer3D, 100);
    } else {
      setNiveauActifId(niveauId);
      // laisse le temps au composant Vue3D de se remonter sur le nouveau niveau avant la capture
      setTimeout(capturerEtImprimer3D, 500);
    }
  };

  const handlePousserVersTableau = async () => {
    if (!resultat || resultat.breakers.filter(b => !estCircuitSansDisjoncteur(b)).length === 0) return;
    setPushing(true);
    // Circuits manuels "déjà existants" (CircuitManuel.nonRelieTableau) : jamais poussés
    // au tableau — ils restent protégés par le disjoncteur déjà en place sur l'installation
    // existante, hors de ce plan.
    const idsManuelsNonRelies = new Set(
      niveaux.flatMap(n => (n.circuitsManuels ?? []).filter(m => m.nonRelieTableau).map(m => m.id)),
    );
    // Courant faible (RJ45) : jamais de disjoncteur au tableau.
    const breakersAPousser = resultat.breakers.filter(b => !estCircuitSansDisjoncteur(b) && (b.manuelId == null || !idsManuelsNonRelies.has(b.manuelId)));
    const nbExclus = resultat.breakers.filter(b => !estCircuitSansDisjoncteur(b)).length - breakersAPousser.length;
    // Renommer un circuit automatique (Niveau.nomsCircuits) ne modifie jamais resultat.breakers
    // (label "naturel", utilisé comme clé stable par couleursCircuits/ordresCircuits) — on
    // résout donc le nom affiché ici, juste avant de pousser vers le tableau, en fusionnant
    // les nomsCircuits de tous les niveaux (le label naturel inclut déjà le nom du niveau,
    // donc pas de collision entre niveaux en pratique).
    const tousNomsCircuits: Record<string, string> = {};
    niveaux.forEach(n => Object.assign(tousNomsCircuits, n.nomsCircuits ?? {}));
    const breakersAvecNoms = breakersAPousser.map(b => ({ ...b, label: tousNomsCircuits[b.label] ?? b.label }));
    // Routage par niveau : les circuits de la maison partent vers l'unique tableau principal,
    // ceux d'une annexe vers le tableau de cette annexe.
    const idsAnnexes = new Set(annexes.map(a => a.id));
    const cibleDuNiveau = (niveauId: number | undefined): string => {
      const niv = niveaux.find(n => n.id === niveauId);
      // Maison = toujours le tableau principal ; annexe = son propre tableau.
      return niv && estAnnexe(niv) && niv.tableauId && idsAnnexes.has(niv.tableauId) ? niv.tableauId : TABLEAU_PRINCIPAL;
    };
    const groupes: Record<string, typeof breakersAvecNoms> = { [TABLEAU_PRINCIPAL]: [] };
    annexes.forEach(a => { groupes[a.id] = []; });
    breakersAvecNoms.forEach(b => { groupes[cibleDuNiveau(b.niveauId)].push(b); });

    // Remplace le lot généré par le plan (tag origine:"plan") dans un tableau : sans ça, chaque
    // clic sur "Pousser" dupliquerait les rangées. Les rangées créées à la main dans l'éditeur
    // de tableau (sans ce tag) ne sont jamais touchées. Appliqué à TOUS les tableaux, même
    // sans nouveau circuit : un niveau rattaché à un autre tableau doit disparaître de l'ancien.
    const remplacerLotPlan = (existantes: BreakerRow[], circuits: typeof breakersAvecNoms) => {
      const rowsConservees = existantes.filter(r => r.origine !== "plan");
      const nouvelles = circuits.length > 0 ? assemblerTableau(circuits) : [];
      const offset = maxIdRows(rowsConservees) + 100000;
      const remap = remapperIdsRows(nouvelles, offset).map((r, i) => ({ ...r, name: `Rangée ${rowsConservees.length + i + 1}` }));
      return { rowsFinal: [...rowsConservees, ...remap], nbRangees: remap.length };
    };

    const { data: c } = await supabase.from("projets").select("tableau_config, tableaux_annexes").eq("id", projet.id).single();
    let rowsPrincipal: BreakerRow[] = [];
    if (c?.tableau_config) {
      try { const parsed = JSON.parse(c.tableau_config); if (Array.isArray(parsed)) rowsPrincipal = parsed; } catch {}
    }
    const annexesBase = lireAnnexes((c as any)?.tableaux_annexes);

    const resPrincipal = remplacerLotPlan(rowsPrincipal, groupes[TABLEAU_PRINCIPAL]);
    await sauverTableau(clientId, projet.id, JSON.stringify(resPrincipal.rowsFinal));

    let nbRangeesAnnexes = 0;
    let nbCircuitsAnnexes = 0;
    if (annexes.length > 0) {
      // On repart de la version en base (elle peut avoir été modifiée dans l'éditeur de
      // tableau) ; une annexe créée ici mais absente de la base est reprise de l'état local.
      const parId = new Map<string, TableauAnnexe>();
      annexes.forEach(a => parId.set(a.id, a));
      annexesBase.forEach(a => parId.set(a.id, a));
      const annexesFinales = annexes.map(a => {
        const base = parId.get(a.id) ?? a;
        const r = remplacerLotPlan(base.rows ?? [], groupes[a.id] ?? []);
        nbRangeesAnnexes += r.nbRangees;
        nbCircuitsAnnexes += (groupes[a.id] ?? []).length;
        return { ...base, rows: r.rowsFinal };
      });
      await sauverAnnexes(projet.id, annexesFinales);
      setAnnexes(annexesFinales);
    }

    setPushing(false);
    setPushMsg(
      `${resPrincipal.nbRangees} rangée(s) et ${groupes[TABLEAU_PRINCIPAL].length} circuit(s) mis à jour dans le tableau principal.` +
      (annexes.length > 0 ? ` Annexes : ${nbRangeesAnnexes} rangée(s), ${nbCircuitsAnnexes} circuit(s).` : "") +
      (nbExclus > 0 ? ` ${nbExclus} circuit(s) déjà existant(s) non poussé(s).` : ""),
    );
    setTimeout(() => setPushMsg(null), 5000);
  };

  const rect = svgRef.current?.getBoundingClientRect();
  const W = rect?.width ?? 900, H = rect?.height ?? 600;
  const topLeftM = toMeters(0, 0), botRightM = toMeters(W, H);
  let step = 1;
  if ((botRightM.x - topLeftM.x) > 60) step = 5;
  const xStart = Math.floor(topLeftM.x / step) * step, xEnd = Math.ceil(botRightM.x / step) * step;
  const yStart = Math.floor(topLeftM.y / step) * step, yEnd = Math.ceil(botRightM.y / step) * step;
  const gridLinesX: number[] = [];
  for (let x = xStart; x <= xEnd; x += step) gridLinesX.push(x);
  const gridLinesY: number[] = [];
  for (let y = yStart; y <= yEnd; y += step) gridLinesY.push(y);

  const selectedPiece = niveauActif?.pieces.find(p => p.id === selectedPieceId) ?? null;

  const seuilAlignementM = ALIGN_THRESHOLD_PX / (PX_PER_M * zoom);
  let curseurSnap: (ResultatSnap & { align?: ResultatAlignMurs }) | null = null;
  if (mode === "dessiner" && cursorPx) curseurSnap = snapDessin(toMeters(cursorPx.x, cursorPx.y));
  const alignAffiche: ResultatAlignMurs | null = dragMode.kind === "vertex" ? alignSeg : mode === "dessiner" ? (curseurSnap?.align ?? null) : null;
  const curseurCl = mode === "cloison" && cursorPx && !cloisonEnAttente ? curseurCloison(toMeters(cursorPx.x, cursorPx.y)) : null;
  const cloisonAffichee: Point[] = cloisonEnAttente ? cloisonEnAttente.chemin : cloisonPoints;
  const curseurZ = mode === "zone" && cursorPx && !zoneEnAttente ? curseurZone(toMeters(cursorPx.x, cursorPx.y)) : null;
  const zoneAffichee: Point[] = zoneEnAttente ? zoneEnAttente.contour : zonePoints;
  const selectedZone = niveauActif?.zones?.find(z => z.id === selectedZoneId) ?? null;
  const guideActif: { x?: number; y?: number } | null =
    mode === "zone" ? (curseurZ && (curseurZ.guideX !== undefined || curseurZ.guideY !== undefined) ? { x: curseurZ.guideX, y: curseurZ.guideY } : null)
    : mode === "cloison" ? (curseurCl && (curseurCl.guideX !== undefined || curseurCl.guideY !== undefined) ? { x: curseurCl.guideX, y: curseurCl.guideY } : null)
    : dragMode.kind === "vertex" ? snapGuide
    : mode === "dessiner" && curseurSnap && (curseurSnap.guideX !== undefined || curseurSnap.guideY !== undefined)
      ? { x: curseurSnap.guideX, y: curseurSnap.guideY }
      : null;
  const selectedAppareillage = niveauActif?.pieces.flatMap(p => p.appareillages).find(a => a.id === selectedAppareillageId) ?? null;
  const pieceDeSelectedAppareillage = selectedAppareillage
    ? niveauActif?.pieces.find(p => p.appareillages.some(a => a.id === selectedAppareillage.id)) ?? null
    : null;
  // Postes de la plaque de l'appareillage sélectionné (vide = appareillage simple), triés de gauche à droite.
  const postesPlaqueSel: AppareillagePlace[] = selectedAppareillage?.groupeId != null && pieceDeSelectedAppareillage
    ? pieceDeSelectedAppareillage.appareillages.filter(a => a.groupeId === selectedAppareillage.groupeId).sort((a, b) => (a.rangPlaque ?? 0) - (b.rangPlaque ?? 0))
    : [];
  // Cotes à dessiner : celles de l'appareillage sélectionné (toujours, mises à jour en direct
  // pendant le déplacement) + optionnellement une par appareillage mural, filtrées pour ne
  // jamais se chevaucher.
  const cotesAffichees: GeoCote[] = (() => {
    if (!niveauActif) return [];
    const prioritaires = selectedAppareillage && pieceDeSelectedAppareillage && mode === "select"
      ? cotesAppareillage({ x: selectedAppareillage.x, y: selectedAppareillage.y }, pieceDeSelectedAppareillage.contour, selectedAppareillage.type, true, repereCotes(pieceDeSelectedAppareillage))
      : [];
    const cotesPieces: Cote[] = showCotesPieces && !masquerEtiquettes
      ? niveauActif.pieces.filter(pc => !pc.masquerDimensions).flatMap(pc => {
          const { utile, utileFin } = geometrieMurs(pc);
          return pc.contour.map((_, i): Cote => {
            const a = utile[i], b = utileFin[i];
            return { kind: "mur", a, b, valeurCm: Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 100), normale: normaleInterieure(pc.contour, i), interieur: true, decalageM: 0 };
          });
        })
      : [];
    const autres = showCotes
      ? niveauActif.pieces.flatMap(pc => pc.appareillages
          .filter(a => a.id !== selectedAppareillageId && estMural(a.type))
          .flatMap(a => cotesAppareillage({ x: a.x, y: a.y }, pc.contour, a.type, false, repereCotes(pc))))
      : [];
    const cotesArchi: Cote[] = [
      ...(showCotesOuv && !masquerEtiquettes ? niveauActif.pieces.filter(pc => !pc.masquerDimensions).flatMap(pc => cotesOuvertures(pc, niveauActif.pieces)) : []),
      ...(showCotesExt && !masquerEtiquettes ? [...cotesExterieures(niveauActif.pieces), ...coteHorsTout(niveauActif.pieces)] : []),
    ];
    return filtrerCotesLisibles([...cotesPieces, ...cotesArchi, ...autres], toScreen, prioritaires)
      .map(c => geometrieCote(c, toScreen, 14))
      .filter((g): g is GeoCote => g != null);
  })();
  const selectedMeuble = niveauActif?.pieces.flatMap(p => p.meubles ?? []).find(m => m.id === selectedMeubleId) ?? null;
  const selectedEscalier = niveauActif?.escaliers?.find(es => es.id === selectedEscalierId) ?? null;

  const colorMap = resultat ? construireColorMap(resultat, niveaux) : new Map<number, string>();

  // Symbole + carré d'appui : le carré (boxSize) est ce qui vient toucher le mur — le symbole,
  // lui, reste lisible à tous les zooms : 20 px à zoom 1 (inchangé), jusqu'à 30 px en zoom avant, et
  // il RÉTRÉCIT en zoom arrière (jusqu'à 7 px) pour que le plan d'une maison entière ne soit pas surchargé.
  const symSize = Math.min(30, Math.max(7, 20 * zoom));
  // Marge du carré d'appui : 8 px à partir de zoom 1 (inchangé), réduite proportionnellement en dessous.
  const boxSize = symSize + Math.min(8, Math.max(3, symSize * 0.4));
  // Échelle des annotations (pastille « ! », initiales des prises dédiées) : 1 jusqu'à zoom 1, réduite en dessous.
  const echelleAnnot = Math.min(1, Math.max(0.55, symSize / 20));
  // Plaques multiples : centre + nombre de postes de chaque groupe, par pièce (voir infosPlaques).
  const infosPlaquesParPiece = new Map<number, Map<number, InfoPlaque>>(
    (niveauActif?.pieces ?? []).map(pc => [pc.id, infosPlaques(pc.appareillages)] as const));
  // Murs extérieurs / mitoyens du niveau affiché : à déduire de l'ensemble des pièces avant de dessiner les murs.
  if (niveauActif) preparerMurs(niveauActif.pieces);

  // Épaisseur de chaque mur (cm) — structure, + doublage — posée sur le mur, uniquement si le trait
  // est assez épais à l'écran pour la porter (sinon elle ne servirait qu'à encombrer).
  const epaisseursMurs = showCotesPieces && !masquerEtiquettes && niveauActif ? niveauActif.pieces.filter(pc => !pc.masquerDimensions).flatMap(pc => {
    const g = geometrieMurs(pc);
    return g.quads.flatMap(q => {
      const sp = murDe(pc, q.i);
      const pts = q.structure.map(toScreen);
      // Direction du mur et centre de la bande de structure (là où le texte se lit sur le mur).
      const centre = { x: (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4, y: (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4 };
      const dirL = { x: (pts[1].x + pts[2].x) / 2 - (pts[0].x + pts[3].x) / 2, y: (pts[1].y + pts[2].y) / 2 - (pts[0].y + pts[3].y) / 2 };
      const A = { x: centre.x - dirL.x / 2, y: centre.y - dirL.y / 2 }, B = { x: centre.x + dirL.x / 2, y: centre.y + dirL.y / 2 };
      const epPx = ((sp.epaisseur + sp.doublage + (sp.finition ?? 0)) / 100) * PX_PER_M * zoom;
      if (epPx < 9 || Math.hypot(B.x - A.x, B.y - A.y) < 40) return [];
      let ang = Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI;
      if (ang > 90 || ang < -90) ang += 180;
      return [{ key: `ep-${pc.id}-${q.i}`, x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, ang, txt: [sp.finition ?? 0, sp.doublage, sp.epaisseur].filter(v => v > 0).join("+"), ext: sp.type === "exterieur" }];
    });
  }) : [];

  // Étiquette (nom + surface) de chaque pièce : position manuelle si l'utilisateur l'a déplacée,
  // sinon placement automatique à l'endroit le plus libre — centre si rien n'y est, sinon le point
  // le plus proche du centre qui évite appareillages, meubles, tableau et débattement des portes.
  // Dessinée au-dessus de tout (halo blanc) : toujours lisible, même en dernier recours.
  const etiquettesPieces = (niveauActif?.pieces ?? []).map(piece => {
    const nom = piece.nom || PIECE_TYPES[piece.type].label;
    const surf = `${(surfaceUtile(piece) ?? aireDuPolygone(piece.contour)).toFixed(1)} m²`;
    const w = Math.max(nom.length * 7.4, surf.length * 6.2) + 14, h = 32;
    const cW = centroide(piece.contour), cPx = toScreen(cW);
    let pos: Point;
    if (piece.nomDecalage) {
      pos = toScreen({ x: cW.x + piece.nomDecalage.x, y: cW.y + piece.nomDecalage.y });
    } else {
      const obstacles: RectPx[] = [];
      piece.appareillages.forEach(a => {
        const pa = toScreen({ x: a.x, y: a.y });
        const prochedumur = estMural(a.type) && (ancrageMurLePlusProche({ x: a.x, y: a.y }, piece.contour)?.distance ?? 9) <= TOLERANCE_MUR_M;
        obstacles.push(carreAutour(pa, prochedumur ? boxSize * 1.05 : symSize / 2 + 6));
      });
      (piece.meubles ?? []).forEach(mb => obstacles.push(carreAutour(toScreen({ x: mb.x, y: mb.y }), Math.hypot(mb.largeur, mb.profondeur) / 2 * PX_PER_M * zoom)));
      (piece.ouvertures ?? []).forEach(o => {
        const a0 = piece.contour[o.segIndex], b0 = piece.contour[(o.segIndex + 1) % piece.contour.length];
        if (!a0 || !b0) return;
        const pc = toScreen({ x: a0.x + (b0.x - a0.x) * o.position, y: a0.y + (b0.y - a0.y) * o.position });
        obstacles.push(carreAutour(pc, (o.largeur / 100) * PX_PER_M * zoom * (o.type === "fenetre" ? 0.5 : 0.75) + 4));
      });
      if (niveauActif?.tableauPos && pointDansPolygone(niveauActif.tableauPos, piece.contour)) {
        obstacles.push(carreAutour(toScreen(niveauActif.tableauPos), 22));
      }
      pos = placerEtiquettePiece(piece.contour.map(toScreen), cPx, { w, h }, obstacles);
    }
    return { piece, nom, surf, w, h, x: pos.x, y: pos.y, centrePx: cPx };
  });

  const circuitsNiveauActif = niveauActif
    ? resultat?.breakers.filter(b => b.pieces.some(pc => niveauActif.pieces.some(p => p.nom === pc.nom))) ?? []
    : [];

  // Fusionne les circuits déjà générés (circuitsNiveauActif) avec les circuits MANUELS qui
  // n'ont pas encore de Breaker (créés à l'instant, ou sans aucun appareillage raccordé —
  // genererCircuits ne produit rien pour un circuit manuel vide) : sans cette fusion, un
  // circuit manuel tout juste créé resterait invisible dans le panneau "Circuits" jusqu'à
  // avoir raccordé quelque chose ET relancé une génération.
  const circuitsAffiches: { key: string; breaker: Breaker | null; manuel: CircuitManuel | null }[] = niveauActif ? (() => {
    const items = circuitsNiveauActif.map(b => ({
      key: `b-${b.id}`, breaker: b as Breaker | null,
      manuel: b.manuelId != null ? (niveauActif.circuitsManuels ?? []).find(m => m.id === b.manuelId) ?? null : null,
    }));
    const manuelsDejaListes = new Set(items.map(it => it.manuel?.id).filter((id): id is number => id != null));
    (niveauActif.circuitsManuels ?? []).forEach(m => {
      if (manuelsDejaListes.has(m.id)) return;
      items.push({ key: `m-${m.id}`, breaker: null, manuel: m });
    });
    return items;
  })() : [];

  const gainesNiveaux = resultat ? genererGainesNiveaux(resultat) : [];
  const gaineNiveauActif = niveauActif
    ? gainesNiveaux.find(g => g.niveau === (niveauActif.nom || niveauActif.type))
    : undefined;
  const couleurTauxUi = (t: number) => (t <= 20 ? "text-emerald-600 bg-emerald-50 border-emerald-200" : t <= 33 ? "text-amber-600 bg-amber-50 border-amber-200" : "text-red-600 bg-red-50 border-red-200");

  if (loading) return <Shell><div className="flex items-center justify-center h-64 text-ink-400">Chargement…</div></Shell>;


  // Actions « circuits » (générer / afficher / point de départ manquant) : mêmes éléments en 2D (bandeau en haut à gauche)
  // et en 3D (onglet « Vue » du bandeau de commandes). null = rien à proposer.
  const blocCircuits: ReactNode = (() => {
    if (!niveauActif || !niveauActif.pieces.some(pc => pc.appareillages.length > 0)) return null;
    const origine = origineCircuits(niveauActif);
    if (resultat && showCircuits && origine) return null;
    return (
      <>
        {!resultat && (
          <button onClick={handleGenerer} className="btn-volt !text-xs shadow-lg"><Sparkles size={13} /> Circuits non affichés — Générer les circuits</button>
        )}
        {resultat && !showCircuits && (
          <button onClick={() => setShowCircuits(true)} className="btn-volt !text-xs shadow-lg"><Eye size={13} /> Afficher les circuits</button>
        )}
        {resultat && showCircuits && !origine && (
          <div className="bg-amber-50 border border-amber-300 text-amber-800 text-xs rounded-lg px-3 py-2 shadow">
            Aucun point de départ sur ce niveau : pose le <strong>tableau</strong> (⚡ Position tableau) ou le point d&apos;arrivée des gaines pour tracer les circuits.
          </div>
        )}
      </>
    );
  })();

  return (
    <Shell>
      <div className={modeFocus
        ? "fixed inset-0 z-[45] flex flex-col bg-white overflow-hidden"
        : "flex flex-col h-[calc(100vh-4rem)] md:h-screen overflow-hidden"}>
        {menuHautReduit ? (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-ink-200 bg-white shrink-0 relative z-10">
          <button onClick={() => reduireMenuHaut(false)} className="btn-ghost !px-2 !py-1 !text-xs" title="Afficher le menu du haut">
            <PanelTopOpen size={15} /> Menu
          </button>
          {niveaux.length > 1 ? (
            <select className="input !py-0.5 !text-xs !w-auto max-w-[10rem]" value={niveauActifId ?? ""} onChange={e => changerNiveau(Number(e.target.value))}>
              {[...niveaux].sort((a, b) => a.ordre - b.ordre).map(n => <option key={n.id} value={n.id}>{n.nom || NIVEAU_TYPES[n.type]}</option>)}
            </select>
          ) : (
            <span className="text-xs font-semibold text-ink-700 truncate">{niveauActif ? (niveauActif.nom || NIVEAU_TYPES[niveauActif.type]) : ""}</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {!vue3D && (
              <>
                <button onClick={() => zoomBtn(-1)} className="btn-ghost !px-2 !py-1" title="Zoom arrière"><ZoomOut size={14} /></button>
                <span className="text-xs font-mono text-ink-400 w-10 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => zoomBtn(1)} className="btn-ghost !px-2 !py-1" title="Zoom avant"><ZoomIn size={14} /></button>
              </>
            )}
            <button onClick={handleGenerer} className="btn-ghost !px-2 !py-1 !text-xs" title="Générer les circuits"><Sparkles size={13} /> Générer</button>
            <button onClick={() => setShowCircuits(v => !v)} disabled={!resultat} className={`btn-ghost !px-2 !py-1 !text-xs disabled:opacity-40 ${resultat && showCircuits ? "!bg-ink-900 !text-volt-400" : ""}`} title="Afficher / masquer les circuits"><Eye size={13} /> Circuits</button>
            <button onClick={() => setVue3D(v => !v)} className={`btn-ghost !px-2 !py-1 !text-xs ${vue3D ? "!bg-ink-900 !text-volt-400" : ""}`}>{vue3D ? "Vue 2D" : "Vue 3D"}</button>
            {vue3D && (
              <button onClick={() => setVue3DTous(v => !v)} className={`btn-ghost !px-2 !py-1 !text-xs ${vue3DTous ? "!bg-ink-900 !text-volt-400" : ""}`}
                title="Voir tous les étages empilés en 3D (sols, murs, escaliers) — masquer / afficher chaque niveau">Tous les étages</button>
            )}
            {!vue3D && (
              <button onClick={() => setMasquerEtiquettes(v => !v)} className={`btn-ghost !px-2 !py-1 !text-xs ${masquerEtiquettes ? "!bg-ink-900 !text-volt-400" : ""}`}
                title={masquerEtiquettes ? "Noms et dimensions des pièces masqués — cliquer pour les réafficher" : "Plan épuré : masquer d'un coup tous les noms et toutes les dimensions des pièces"}>Épuré</button>
            )}
            <button onClick={() => setModeFocus(f => !f)} className={`btn-ghost !px-2 !py-1 ${modeFocus ? "!bg-ink-900 !text-volt-400" : ""}`}
              title={modeFocus ? "Quitter le plein écran (Échap)" : "Plein écran"}>
              {modeFocus ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <ReglageAimant pasCm={pasSnapCm} setPasCm={setPasSnapCm} aimant={aimantActif} setAimant={setAimantActif} murs={alignMurs} setMurs={setAlignMurs} />
            {niveauActif && niveauActif.pieces.length > 0 && (
              <select value={selectedPieceId ?? ""} onChange={e => { if (e.target.value !== "") selectionnerPiece(Number(e.target.value)); }}
                title="Sélectionner une pièce par son nom (utile quand elle est cachée sous une autre — sinon Ctrl+clic pour descendre d'une pièce)"
                className="rounded-lg border border-ink-200 bg-white px-1 py-1 text-xs text-ink-900 max-w-[9rem]">
                <option value="">Pièce…</option>
                {niveauActif.pieces.map(pc => <option key={pc.id} value={pc.id}>{pc.nom || PIECE_TYPES[pc.type].label}</option>)}
              </select>
            )}
            <button onClick={annuler} disabled={!peutAnnuler} className="btn-ghost !px-2 !py-1 disabled:opacity-40" title="Annuler la dernière action (Ctrl+Z)"><Undo2 size={14} /></button>
            <button onClick={refaire} disabled={!peutRefaire} className="btn-ghost !px-2 !py-1 disabled:opacity-40" title="Refaire (Ctrl+Y)"><Redo2 size={14} /></button>
            {autoSaveMsg && <span className="text-[11px] text-emerald-600 whitespace-nowrap">{autoSaveMsg}</span>}
            <button onClick={handleSave} disabled={saving} className={`btn-volt !px-3 !py-1 !text-xs ${saved ? "!bg-emerald-500 !border-emerald-600 !text-white" : ""}`}>
              <Save size={13} />{saving ? "…" : saved ? "Sauvegardé !" : "Sauvegarder"}
            </button>
          </div>
        </div>
        ) : (
        <>
        <div className={`flex items-center justify-between px-4 md:px-6 ${modeFocus ? "py-1.5" : "py-3"} border-b border-ink-200 bg-white shrink-0 gap-3 flex-wrap relative z-10`}>
          <div className="flex items-center gap-3">
            <Link href={`/clients/${clientId}`} className="btn-ghost !px-2 !py-1.5 text-ink-400"><ArrowLeft size={16} /></Link>
            <div>
              <h1 className={`font-display ${modeFocus ? "text-base" : "text-lg"} text-ink-900 leading-tight`}>Plan de circuits</h1>
              {client && !modeFocus && <p className="text-xs text-ink-400">{client.prenom ? `${client.prenom} ${client.nom}` : client.nom}</p>}
            </div>
            <ProjetSwitcher clientId={clientId} projets={projets} projetId={projet.id}
              avantChangement={handleSave} onSelect={onSelect} onChanged={onChanged} compact />
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button onClick={() => reduireMenuHaut(true)} className="btn-ghost !px-2 !py-1.5" title="Masquer le menu du haut (plus de place pour le plan)">
              <PanelTopClose size={15} />
            </button>
            <button onClick={() => setModeFocus(f => !f)} className={`btn-ghost !px-2 !py-1.5 ${modeFocus ? "!bg-ink-900 !text-volt-400" : ""}`}
              title={modeFocus ? "Quitter le plein écran (Échap)" : "Agrandir l'espace de travail (plein écran, masque le menu)"}>
              {modeFocus ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            {!vue3D && (
              <button onClick={toggleToolbar} className="btn-ghost !px-2 !py-1.5" title={toolbarOuvert ? "Replier la barre d'outils" : "Déplier la barre d'outils"}>
                {toolbarOuvert ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
            )}
            <button onClick={() => setVue3D(v => !v)} className={`btn-ghost ${vue3D ? "!bg-ink-900 !text-volt-400" : ""}`}>
              {vue3D ? "Vue 2D" : "Vue 3D"}
            </button>
            {vue3D && (
              <button onClick={() => setVue3DTous(v => !v)} className={`btn-ghost ${vue3DTous ? "!bg-ink-900 !text-volt-400" : ""}`}
                title="Voir tous les étages empilés en 3D (sols, murs, escaliers) — masquer / afficher chaque niveau">Tous les étages</button>
            )}
            {vue3D ? (
              <button onClick={() => setShow3DPrintForm(true)} disabled={vue3DTous} title={vue3DTous ? "L'impression 3D se fait depuis la vue d'un seul niveau" : undefined}
                className="btn-ghost disabled:opacity-40"><Printer size={15} /> Imprimer la vue 3D</button>
            ) : (
              <button onClick={() => setShowPrintForm(true)} className="btn-ghost"><Printer size={15} /> Imprimer</button>
            )}
            <Link href={`/predevis/${clientId}${qsProjet(projet.id)}`} className="btn-ghost"><Receipt size={15} /> Pré-devis</Link>
            <ReglageAimant pasCm={pasSnapCm} setPasCm={setPasSnapCm} aimant={aimantActif} setAimant={setAimantActif} murs={alignMurs} setMurs={setAlignMurs} />
            {niveauActif && niveauActif.pieces.length > 0 && (
              <select value={selectedPieceId ?? ""} onChange={e => { if (e.target.value !== "") selectionnerPiece(Number(e.target.value)); }}
                title="Sélectionner une pièce par son nom (utile quand elle est cachée sous une autre — sinon Ctrl+clic pour descendre d'une pièce)"
                className="rounded-lg border border-ink-200 bg-white px-1 py-1 text-xs text-ink-900 max-w-[9rem]">
                <option value="">Pièce…</option>
                {niveauActif.pieces.map(pc => <option key={pc.id} value={pc.id}>{pc.nom || PIECE_TYPES[pc.type].label}</option>)}
              </select>
            )}
            <button onClick={annuler} disabled={!peutAnnuler} className="btn-ghost !px-2 !py-1 disabled:opacity-40" title="Annuler la dernière action (Ctrl+Z)"><Undo2 size={14} /></button>
            <button onClick={refaire} disabled={!peutRefaire} className="btn-ghost !px-2 !py-1 disabled:opacity-40" title="Refaire (Ctrl+Y)"><Redo2 size={14} /></button>
            {autoSaveMsg && <span className="text-[11px] text-emerald-600 whitespace-nowrap">{autoSaveMsg}</span>}
            <button onClick={handleSave} disabled={saving} className={`btn-volt ${saved ? "!bg-emerald-500 !border-emerald-600 !text-white" : ""}`}>
              <Save size={15} />{saving ? "…" : saved ? "Sauvegardé !" : "Sauvegarder"}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-4 md:px-6 py-2 border-b border-ink-100 bg-ink-50 overflow-x-auto shrink-0">
          {[...niveaux].sort((a, b) => a.ordre - b.ordre).map((n, idx, arr) => {
            const annexe = estAnnexe(n);
            const debutAnnexes = annexe && (idx === 0 || !estAnnexe(arr[idx - 1]));
            const actif = n.id === niveauActifId;
            return (
              <Fragment key={n.id}>
                {debutAnnexes && (
                  <span className="flex items-center gap-1.5 shrink-0 pl-1">
                    <span className="w-px h-5 bg-ink-300" />
                    <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600">Annexes</span>
                  </span>
                )}
                <button onClick={() => changerNiveau(n.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    annexe
                      ? (actif ? "bg-amber-500 text-white" : "bg-amber-50 border border-amber-300 text-amber-700 hover:border-amber-500")
                      : (actif ? "bg-ink-900 text-volt-400" : "bg-white border border-ink-200 text-ink-500 hover:border-ink-400")
                  }`}>
                  {n.nom || NIVEAU_TYPES[n.type]}
                </button>
              </Fragment>
            );
          })}
          <button onClick={() => setShowNiveauForm(true)} className="btn-ghost !px-2 !py-1.5 shrink-0" title="Ajouter un niveau ou une annexe"><Plus size={14} /></button>
          {niveauActif && niveaux.length > 1 && (
            <button onClick={() => setConfirmSuppNiveau(true)} className="btn-ghost !px-2 !py-1.5 shrink-0 text-red-500"
              title={estAnnexe(niveauActif) ? "Supprimer cette annexe (et son tableau)" : "Supprimer ce niveau"}>
              <Trash2 size={14} />
            </button>
          )}
          {niveauActif && (
            <div className="flex items-center gap-1.5 ml-auto shrink-0 text-xs text-ink-400">
              {estAnnexe(niveauActif) ? (
                <span className="px-2 py-1 rounded-md bg-amber-100 text-amber-700 font-semibold">Tableau propre à l'annexe</span>
              ) : (
                <>
                  <span title="Distance entre le tableau de la maison et l'arrivée des gaines de ce niveau (liaison verticale non dessinée)">Distance tableau</span>
                  <input type="number" min={0} step="0.1" className="input !py-1 !text-xs !w-16" placeholder="—"
                    value={niveauActif.distanceArriveeGainesTableau ?? ""}
                    onChange={e => modifierDistanceArriveeGaines(e.target.value !== "" ? Number(e.target.value) : undefined)} />
                  <span>m</span>
                </>
              )}
              <span className="ml-2" title="Angle entre le haut du plan et le Nord, dans le sens horaire (0 = Nord en haut). Sert au soleil de midi en vue 3D.">Nord</span>
              <input type="number" min={0} max={359} step={1} className="input !py-1 !text-xs !w-16"
                value={orientationNord}
                onChange={e => { if (e.target.value !== "") definirOrientationNord(Number(e.target.value)); }} />
              <span>°</span>
              <span className="ml-2">Plafond</span>
              <input type="number" step="0.1" className="input !py-1 !text-xs !w-16"
                value={niveauActif.hauteurPlafond ?? 2.5}
                onChange={e => updateNiveauActif(n => ({ ...n, hauteurPlafond: parseFloat(e.target.value) || 2.5 }))} />
              <span>m</span>
            </div>
          )}
        </div>

        {!vue3D && toolbarOuvert && (
        <div className="flex items-center gap-2 px-4 md:px-6 py-2 border-b border-ink-100 shrink-0 flex-wrap bg-ink-50">
          <button onClick={() => { setMode("select"); setDrawingPoints([]); setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null); setPlacingPointArrivee(false); setPlacingMeuble(false); }}
            className={`btn-ghost !text-xs ${mode === "select" && !placementType && !placingTableau && !placingOuverture && !placingPointArrivee && !placingMeuble ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <MousePointer2 size={13} /> Sélection
          </button>
          <button onClick={entrerModeDessiner} className={`btn-ghost !text-xs ${mode === "dessiner" ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <Pencil size={13} /> Dessiner une pièce
          </button>
          {mode === "dessiner" && (
            <div className="flex items-center gap-1">
              <button onClick={() => { setFormeDessin("rectangle"); setDrawingPoints([]); }} title="Rectangle à 4 côtés : 2 clics (un coin, puis le coin opposé). Tu pourras ensuite plier ses murs en forme complexe."
                className={`btn-ghost !px-2 !py-1 !text-xs ${formeDessin === "rectangle" ? "!bg-ink-900 !text-volt-400" : ""}`}>▭ Rectangle</button>
              <button onClick={() => { setFormeDessin("libre"); setDrawingPoints([]); }} title="Forme libre : un clic par sommet"
                className={`btn-ghost !px-2 !py-1 !text-xs ${formeDessin === "libre" ? "!bg-ink-900 !text-volt-400" : ""}`}>Libre</button>
            </div>
          )}
          <button onClick={entrerModeCloison} disabled={!niveauActif}
            title="Monter une cloison (mur intérieur) : clic pour chaque point, Entrée pour terminer. Elle ne modifie aucune pièce : on peut ensuite la nommer, la déplacer à la souris, y percer une porte ou la supprimer"
            className={`btn-ghost !text-xs disabled:opacity-40 ${mode === "zone" && zoneCloisonSeule ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <SplitSquareHorizontal size={13} /> Cloison
          </button>
          <button onClick={entrerModeZone} disabled={!niveauActif}
            title="Dessiner une zone nommée (dressing ouvert, coin bureau…) avec sa surface, ou une cloison libre qui s'arrête dans la pièce"
            className={`btn-ghost !text-xs disabled:opacity-40 ${mode === "zone" && !zoneCloisonSeule ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <BoxSelect size={13} /> Zone
          </button>
          <button onClick={armerPlacementTableau} className={`btn-ghost !text-xs ${placingTableau ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <Zap size={13} /> Position tableau
          </button>
          <button onClick={armerPlacementPointArrivee} className={`btn-ghost !text-xs ${placingPointArrivee ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <ArrowDownToLine size={13} /> Arrivée gaines
          </button>
          <button onClick={() => placingMeuble ? setPlacingMeuble(false) : armerPlacementMeuble()}
            title="Meuble simple (vue 3D) — pour mieux juger l'éclairage"
            className={`btn-ghost !text-xs ${placingMeuble ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <Box size={13} /> Meuble
          </button>
          <div className="relative">
            <button onClick={() => setOuvertureMenuOpen(o => !o)}
              className={`btn-ghost !text-xs ${placingOuverture ? "!bg-ink-900 !text-volt-400" : ""}`}>
              <OuvertureIcon type={placingOuverture ?? "porte"} size={13} /> {placingOuverture ? (placingOuverture === "porte" ? LABEL_USAGE_PORTE[placingUsagePorte] : placingOuverture === "porte_coulissante" && placingMontage === "galandage" ? "Porte à galandage" : LABEL_OUVERTURE[placingOuverture]) : "Porte / fenêtre"}
            </button>
            {ouvertureMenuOpen && (
              <div className="absolute z-20 top-full left-0 mt-1 card card-inner !p-1 flex flex-col shadow-lg w-56">
                {([
                  { t: "porte", usage: "interieure" }, { t: "porte", usage: "entree" }, { t: "porte", usage: "service" },
                  { t: "porte_coulissante", montage: "applique" }, { t: "porte_coulissante", montage: "galandage" },
                  { t: "porte_garage" }, { t: "baie_vitree" }, { t: "fenetre" }, { t: "ouverture" },
                ] as { t: OuvertureType; usage?: UsagePorte; montage?: "applique" | "galandage" }[]).map(({ t, usage, montage }) => {
                  const actif = placingOuverture === t && (t !== "porte" || placingUsagePorte === usage) && (t !== "porte_coulissante" || placingMontage === montage);
                  const libelle = usage ? LABEL_USAGE_PORTE[usage] : montage === "galandage" ? "Porte à galandage (dans le mur)" : montage === "applique" ? "Porte coulissante (sur rail)" : LABEL_OUVERTURE[t];
                  return (
                    <button key={`${t}-${usage ?? ""}-${montage ?? ""}`}
                      onClick={() => { armerPlacementOuverture(actif ? null : t, usage, montage); setOuvertureMenuOpen(false); }}
                      className={`flex items-center gap-2 !text-xs px-2 py-1.5 rounded-md hover:bg-ink-50 ${actif ? "text-volt-600 font-semibold" : "text-ink-600"}`}>
                      <OuvertureIcon type={t} size={14} /> {libelle}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="relative">
            <button onClick={() => setEscalierMenuOpen(o => !o)} className={`btn-ghost !text-xs ${escalierMenuOpen ? "!bg-ink-900 !text-volt-400" : ""}`}
              title="Ajouter un escalier (droit, tournant, hélicoïdal) qui dessert un autre niveau : sa trémie apparaît sur l'étage desservi">
              🪜 Escalier
            </button>
            {escalierMenuOpen && (
              <div className="absolute z-20 top-full left-0 mt-1 card card-inner !p-1 flex flex-col shadow-lg w-64">
                {([
                  { t: "droit", label: "Droit" },
                  { t: "quart_tournant", tournant: "palier", label: "Quart tournant — avec palier" },
                  { t: "quart_tournant", tournant: "balancees", label: "Quart tournant — marches balancées" },
                  { t: "demi_tournant", tournant: "palier", label: "Demi-tournant — avec palier" },
                  { t: "demi_tournant", tournant: "balancees", label: "Demi-tournant — marches balancées" },
                  { t: "helicoidal", label: "Hélicoïdal" },
                ] as { t: EscalierType; tournant?: EscalierTournant; label: string }[]).map(o => (
                  <button key={`${o.t}-${o.tournant ?? ""}`} onClick={() => ajouterEscalier(o.t, o.tournant)}
                    className="flex items-center gap-2 !text-xs px-2 py-1.5 rounded-md hover:bg-ink-50 text-ink-600 text-left">
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => (deplacementNiveau ? terminerDeplacementNiveau(false) : demarrerDeplacementNiveau())}
            className={`btn-ghost !text-xs ${deplacementNiveau ? "!bg-ink-900 !text-volt-400" : ""}`}
            title="Déplacer tout l'étage d'un bloc (toutes les pièces et leur contenu, zones, tableau, escaliers) — pour le caler sur l'escalier qui y arrive">
            ⤧ Déplacer l&apos;étage
          </button>
          <button onClick={() => setCircuitsManuelsOpen(o => !o)} className={`btn-ghost !text-xs ${circuitsManuelsOpen ? "!bg-ink-900 !text-volt-400" : ""}`}>
            🎛️ Circuits manuels
          </button>
          <button onClick={() => setPaletteOpen(o => !o)} className={`btn-ghost !text-xs lg:hidden ${paletteOpen ? "!bg-ink-900 !text-volt-400" : ""}`}>
            Appareillages
          </button>
          {mode === "zone" && !zoneCloisonSeule && (
            <>
              <span className="text-[11px] text-ink-500 max-w-md">
                {zonePoints.length === 0
                  ? "Zone — clique les sommets (un côté posé sur un mur existant s'accroche) · Retour arrière = annuler le dernier point · Échap = quitter"
                  : zonePoints.length < 3 ? "Zone — continue le tracé" : "Zone — clique le 1er point (ou « Fermer ») pour terminer le polygone"}
              </span>
              {zonePoints.length >= 3 && <button onClick={() => terminerTraceZone(true)} className="btn-volt !text-xs">Fermer le polygone</button>}
              {zonePoints.length > 0 && <button onClick={() => setZonePoints([])} className="btn-ghost !text-xs text-red-500">Annuler</button>}
            </>
          )}
          {mode === "zone" && zoneCloisonSeule && (
            <>
              <span className="text-[11px] text-ink-500 max-w-md">
                {zonePoints.length === 0
                  ? "Cloison — clique le point de départ (s'accroche sur un mur existant) · Échap = quitter"
                  : "Cloison — clique chaque angle, puis « Terminer la cloison » (ou Entrée) · Retour arrière = annuler le dernier point"}
              </span>
              {zonePoints.length >= 2 && <button onClick={() => terminerTraceZone(false)} className="btn-volt !text-xs">Terminer la cloison</button>}
              {zonePoints.length > 0 && <button onClick={() => setZonePoints([])} className="btn-ghost !text-xs text-red-500">Annuler</button>}
            </>
          )}
          {mode === "dessiner" && drawingPoints.length > 0 && (
            <>
              <button onClick={() => setDrawingPoints([])} className="btn-ghost !text-xs text-red-500">Annuler</button>
              {drawingPoints.length >= 3 && <button onClick={() => finirDessin(drawingPoints)} className="btn-volt !text-xs">Terminer la pièce</button>}
            </>
          )}

          <div className="w-px h-5 bg-ink-200 mx-0.5 hidden sm:block" />

          <button onClick={handleGenerer} className="btn-volt !text-xs"><Sparkles size={13} /> Générer les circuits</button>
          <button onClick={() => setShowCircuits(s => !s)} disabled={!resultat} className="btn-ghost !text-xs disabled:opacity-40">
            {showCircuits ? <Eye size={13} /> : <EyeOff size={13} />} Afficher les circuits
          </button>
          <button onClick={() => setShowLongueurs(s => !s)} disabled={!resultat || !showCircuits} className="btn-ghost !text-xs disabled:opacity-40">
            📏 Longueurs des circuits
          </button>
          {niveauActif && niveauActif.pieces.length > 0 && (() => {
            const toutVerrouille = niveauActif.pieces.every(pc => pc.verrouillee);
            return (
              <button onClick={() => verrouillerToutLeNiveau(!toutVerrouille)} className={`${toutVerrouille ? "btn-volt" : "btn-ghost"} !text-xs`}
                title={toutVerrouille ? "Déverrouiller toutes les pièces de ce niveau" : "Verrouiller toutes les pièces de ce niveau (aucun déplacement par erreur)"}>
                {toutVerrouille ? <Lock size={13} /> : <Unlock size={13} />} {toutVerrouille ? "Niveau verrouillé" : "Verrouiller le niveau"}
              </button>
            );
          })()}
          <button onClick={() => setMasquerEtiquettes(v => !v)} className={`${masquerEtiquettes ? "btn-volt" : "btn-ghost"} !text-xs`}
            title={masquerEtiquettes ? "Noms et dimensions des pièces masqués — cliquer pour les réafficher" : "Plan épuré : masquer d'un coup tous les noms et toutes les dimensions des pièces (surfaces, longueurs de murs, cotes, épaisseurs) pour placer appareillages et circuits sur un écran dégagé"}>
            {masquerEtiquettes ? "👁 Réafficher noms et cotes" : "🧹 Plan épuré"}
          </button>
          <div className="relative">
            {(() => {
              const nb = [showCotes, showCotesPieces, showCotesExt, showCotesOuv].filter(Boolean).length;
              return (
                <button onClick={() => setMenuCotesOuvert(o => !o)} className={`${nb > 0 ? "btn-volt" : "btn-ghost"} !text-xs`}
                  title="Cotes d'architecte : à afficher selon le besoin">
                  📐 Cotes{nb > 0 ? ` (${nb})` : ""} <ChevronDown size={12} />
                </button>
              );
            })()}
            {menuCotesOuvert && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuCotesOuvert(false)} />
                <div className="absolute left-0 top-full mt-1 z-40 w-72 card p-3 flex flex-col gap-2 shadow-lg">
                  {([
                    ["Appareillages", "distance de chaque prise / interrupteur au coin intérieur", showCotes, setShowCotes],
                    ["Pièces et murs", "dimensions intérieures de chaque mur + épaisseurs", showCotesPieces, setShowCotesPieces],
                    ["Ouvertures", "chaîne coin → baie → coin le long de chaque mur percé", showCotesOuv, setShowCotesOuv],
                    ["Extérieures", "longueur de chaque mur extérieur + dimensions hors-tout", showCotesExt, setShowCotesExt],
                  ] as [string, string, boolean, (v: boolean) => void][]).map(([nom, aide, val, set]) => (
                    <label key={nom} className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" className="mt-0.5" checked={val} onChange={e => set(e.target.checked)} />
                      <span className="text-xs text-ink-700"><span className="font-semibold">{nom}</span><br /><span className="text-ink-400">{aide}</span></span>
                    </label>
                  ))}
                  <p className="text-[11px] text-ink-400 border-t border-ink-100 pt-2">Cotes en cm. L&apos;appareillage sélectionné affiche toujours les siennes.</p>
                </div>
              </>
            )}
          </div>
          <button onClick={handlePousserVersTableau} disabled={!resultat || pushing} className="btn-ghost !text-xs disabled:opacity-40">
            <ArrowRightCircle size={13} /> {pushing ? "…" : "Pousser vers le tableau"}
          </button>
          {resultat && (
            <span className="text-[11px] text-ink-400 font-mono">{resultat.breakers.length} circuit{resultat.breakers.length > 1 ? "s" : ""} généré{resultat.breakers.length > 1 ? "s" : ""}</span>
          )}
          {gaineNiveauActif && (
            <span className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-mono font-semibold ${couleurTauxUi(gaineNiveauActif.tauxPct)}`}>
              🔀 {gaineNiveauActif.gaine} · {gaineNiveauActif.tauxPct}%
            </span>
          )}
          {resultat && niveauActif && !origineCircuits(niveauActif) && (
            <span className="text-[11px] text-amber-600 font-semibold">
              {estAnnexe(niveauActif)
                ? "Positionne le tableau de l'annexe pour voir le tracé des gaines"
                : niveaux.some(n => !estAnnexe(n) && n.tableauPos)
                  ? "Place l'arrivée des gaines de ce niveau pour voir le tracé (le tableau de la maison est sur un autre niveau)"
                  : "Positionne le tableau pour voir le tracé des gaines"}
            </span>
          )}
          {resultat && resultat.alertes.length > 0 && (
            <div className="relative">
              <button onClick={() => setAlertesOuvertes(o => !o)}
                className={`btn-ghost !text-xs !text-amber-700 ${alertesOuvertes ? "!bg-amber-100" : ""}`}>
                <AlertTriangle size={13} /> {resultat.alertes.length} alerte{resultat.alertes.length > 1 ? "s" : ""}
              </button>
              {alertesOuvertes && (
                <div className="absolute z-20 top-full left-0 mt-1 card card-inner !p-2 flex flex-col gap-1 shadow-lg w-72 max-h-56 overflow-y-auto">
                  {resultat.alertes.map((a, i) => <p key={i} className="text-[11px] text-amber-700">{a}</p>)}
                </div>
              )}
            </div>
          )}
          {pushMsg && (
            <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-2">
              {pushMsg} <Link href={`/tableau/${clientId}${qsProjet(projet.id)}`} className="underline">Voir le tableau →</Link>
            </span>
          )}

          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => zoomBtn(-1)} className="btn-ghost !px-2 !py-1.5"><ZoomOut size={14} /></button>
            <span className="text-xs font-mono text-ink-400 w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => zoomBtn(1)} className="btn-ghost !px-2 !py-1.5"><ZoomIn size={14} /></button>
          </div>
        </div>
        )}
        </>
        )}

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 relative overflow-hidden bg-white">
            {/* Circuits : ils ne sont jamais enregistrés avec le plan, il faut les générer (ou les ré-afficher) à
                chaque ouverture. En 2D : bandeau en haut à gauche ; en 3D : ces mêmes actions sont dans l'onglet « Vue »
                du bandeau de commandes (voir Vue3D, circuitsAction). */}
            {!vue3D && blocCircuits && (
              <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 max-w-xs">{blocCircuits}</div>
            )}
            {!vue3D && niveauActif && (
              <BoussoleOrientation angle={orientationNord} onChange={definirOrientationNord} />
            )}
            {vue3D ? (
              vue3DTous ? (
                <Vue3DMaison niveaux={niveaux} niveauActifId={niveauActifId} />
              ) : niveauActif ? (
                <Vue3D ref={vue3DRef} niveau={niveauActif} resultat={resultat} showCircuits={showCircuits} orientationNord={orientationNord} circuitsAction={blocCircuits} escaliersEntrants={entrantsEscalier} />
              ) : null
            ) : (
              <>
            <svg
              ref={svgRef}
              className="w-full h-full block"
              style={{ touchAction: "none", cursor: deplacementNiveau ? "move" : mode === "dessiner" || mode === "cloison" || mode === "zone" || placementType || placingTableau || placingPointArrivee || placingMeuble ? "crosshair" : "grab" }}
              onPointerDown={onBackgroundPointerDown}
              // Outil cloison : le clic gauche est traité ICI, avant les pièces / appareillages / portes (un
              // appareillage posé sur le mur ne doit pas avaler le départ de la cloison).
              onPointerDownCapture={e => {
                if (deplacementNiveau && e.button === 0 && !e.shiftKey) { e.stopPropagation(); onDeplacementNiveauDown(e); return; }   // Maj + glisser = déplacer la vue
                if ((mode === "cloison" || mode === "zone") && e.button === 0) { e.stopPropagation(); onBackgroundPointerDown(e); }
              }}
              onPointerMove={onCanvasPointerMove}
              onWheel={handleWheel}
            >
              <rect width="100%" height="100%" fill="#fafaf9" />
              {gridLinesX.map(x => {
                const p = toScreen({ x, y: 0 });
                return <line key={`gx${x}`} x1={p.x} y1={0} x2={p.x} y2={H} stroke={x === 0 ? "#c4c4c0" : "#e7e7e3"} strokeWidth={x === 0 ? 1.5 : 1} />;
              })}
              {gridLinesY.map(y => {
                const p = toScreen({ x: 0, y });
                return <line key={`gy${y}`} x1={0} y1={p.y} x2={W} y2={p.y} stroke={y === 0 ? "#c4c4c0" : "#e7e7e3"} strokeWidth={y === 0 ? 1.5 : 1} />;
              })}

              {/* Couche 1 — fonds de pièces (clic = sélection, glisser = déplacement) */}
              {niveauActif?.pieces.map(piece => (
                <polygon key={`fond-${piece.id}`} points={piece.contour.map(toScreen).map(q => `${q.x},${q.y}`).join(" ")}
                  fill={piece.couleurFond ?? PIECE_TYPES[piece.type].color} fillOpacity={0.85} stroke="none"
                  style={{ cursor: mode === "select" && !placementType && !placingTableau && !placingOuverture && !piece.verrouillee ? "move" : "default" }}
                  onPointerDown={e => onPieceDown(piece, e)} />
              ))}

              {/* Couche 2 — murs en vraie épaisseur : structure (pleine) puis doublage (clair, côté intérieur).
                  Ordre : cloisons, puis murs extérieurs par-dessus (jonctions propres), puis doublages. */}
              {niveauActif && (() => {
                const toPts = (poly: Point[]) => poly.map(toScreen).map(q => `${q.x},${q.y}`).join(" ");
                const quads = niveauActif.pieces.flatMap(pc => geometrieMurs(pc).quads.map(q => ({ ...q, cle: `${pc.id}-${q.i}` })));
                const struct = (q: typeof quads[number]) => {
                  if (q.structureNulle) return null;   // mur à 0 cm : rien à dessiner
                  const col = q.type === "exterieur" ? "#44403c" : "#78716c";
                  return <polygon key={`s-${q.cle}`} points={toPts(q.structure)} fill={col} stroke={col} strokeWidth={0.6} strokeLinejoin="round" />;
                };
                return (
                  <g style={{ pointerEvents: "none" }}>
                    {quads.filter(q => q.type !== "exterieur").map(struct)}
                    {quads.filter(q => q.type === "exterieur").map(struct)}
                    {quads.filter(q => q.doublage).map(q => (
                      <polygon key={`d-${q.cle}`} points={toPts(q.doublage!)} fill="#d9dee4" stroke="#94a3b8" strokeWidth={0.8} strokeLinejoin="round" />
                    ))}
                    {quads.filter(q => q.finition).map(q => (
                      <polygon key={`f-${q.cle}`} points={toPts(q.finition!)} fill="#fafaf9" stroke="#a8a29e" strokeWidth={0.8} strokeLinejoin="round" />
                    ))}
                  </g>
                );
              })()}

              {/* Couche 3 — ouvertures : percent TOUTES les épaisseurs du mur (structure + doublage),
                  y compris vues depuis la pièce voisine sur un mur mitoyen */}
              {niveauActif && niveauActif.pieces.flatMap(piece => piece.contour.flatMap((_, i) =>
                ouverturesEffectivesMur(niveauActif.pieces, piece, i).map((e, k) => (
                  <polygon key={`decoupe-${piece.id}-${i}-${k}`} fill="#fff" stroke="none" style={{ pointerEvents: "none" }}
                    points={decoupeOuverture(piece, i, e.position, e.largeur).map(toScreen).map(q => `${q.x},${q.y}`).join(" ")} />
                ))
              ))}

              {/* Couche 3 bis — zones : fond léger, limites virtuelles (pointillés), cloisons en épaisseur, portes.
                  Sous les appareillages ; seules les cloisons et les portes captent le clic (jamais le fond). */}
              {(niveauActif?.zones ?? []).map(z => {
                const toPts = (poly: Point[]) => poly.map(toScreen).map(q => `${q.x},${q.y}`).join(" ");
                const sel = z.id === selectedZoneId;
                const cloisons = cloisonsDeZone(z);
                return (
                  <g key={`zone-${z.id}`}>
                    {z.ferme && <polygon points={toPts(z.contour)} fill={z.escalierVisibleId != null ? "#f59e0b" : "#a78bfa"} fillOpacity={z.escalierVisibleId != null ? 0.22 : 0.14} stroke="none" style={{ pointerEvents: "none" }} />}
                    {segmentsZone(z).filter(sg => z.cotes[sg.i] === "ouvert" || z.escalierVisibleId != null).map(sg => {
                      const a = toScreen(sg.a), b = toScreen(sg.b);
                      return <line key={`zo-${sg.i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={z.escalierVisibleId != null ? "#d97706" : "#7c3aed"} strokeWidth={1.6} strokeDasharray="7,5" style={{ pointerEvents: "none" }} />;
                    })}
                    {cloisons.map(c => (
                      <polygon key={`zc-${c.i}`} points={toPts(quadCloison(c))} fill="#78716c" stroke="#78716c" strokeWidth={0.6} strokeLinejoin="round" style={{ pointerEvents: "none" }} />
                    ))}
                    {cloisons.flatMap(c => (z.ouvertures ?? []).filter(o => o.segIndex === c.i).map(o => (
                      <polygon key={`zd-${o.id}`} points={toPts(decoupeOuvertureZone(c, o.position, o.largeur))} fill="#fff" stroke="none" style={{ pointerEvents: "none" }} />
                    )))}
                    {cloisons.flatMap(c => (z.ouvertures ?? []).filter(o => o.segIndex === c.i).map(o => (
                      <OuvertureZoneSymbole key={`zs-${o.id}`} c={c} o={o} toScreen={toScreen} zoom={zoom}
                        selectionnee={selectedZoneOuv?.ouvId === o.id} actif={zoneCliquable}
                        onDown={e => selectionnerZone(z.id, o.id, e)} />
                    )))}
                    {sel && (z.ferme
                      ? <polygon points={toPts(z.contour)} fill="none" stroke="#F59E0B" strokeWidth={2.2} strokeLinejoin="round" style={{ pointerEvents: "none" }} />
                      : <polyline points={toPts(z.contour)} fill="none" stroke="#F59E0B" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" style={{ pointerEvents: "none" }} />)}
                    {zoneCliquable && cloisons.map(c => {
                      const a = toScreen(c.a), b = toScreen(c.b);
                      return <line key={`zh-${c.i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} strokeLinecap="round"
                        style={{ cursor: "move", pointerEvents: "stroke" }} onPointerDown={e => cloisonDown(z, e)} />;
                    })}
                    {sel && !selectedZoneOuv && zoneCliquable && z.contour.map((pt, k) => {
                      const q = toScreen(pt);
                      return <circle key={`zv-${k}`} cx={q.x} cy={q.y} r={6} fill="#fff" stroke="#F59E0B" strokeWidth={2} style={{ cursor: "grab" }}
                        onPointerDown={e => sommetZoneDown(z, k, e)}><title>Glisser pour déplacer ce point</title></circle>;
                    })}
                  </g>
                );
              })}

              {niveauActif?.pieces.map(piece => {
                const pts = piece.contour.map(toScreen).map(p => `${p.x},${p.y}`).join(" ");
                const isSelected = piece.id === selectedPieceId;
                return (
                  <g key={piece.id}>
                    {isSelected && (
                      <polygon points={pts} fill="none" stroke="#F59E0B" strokeWidth={2.5} strokeLinejoin="round" style={{ pointerEvents: "none" }} />
                    )}
                    {isSelected && mode === "select" && !piece.verrouillee && piece.contour.map((pt, i) => {
                      const p = toScreen(pt);
                      const peutSupprimer = piece.contour.length > 3;
                      return (
                        <circle key={i} cx={p.x} cy={p.y} r={6} fill="#fff" stroke="#F59E0B" strokeWidth={2}
                          style={{ cursor: "grab" }}
                          onPointerDown={e => onVertexDown(piece.id, i, e)}
                          onDoubleClick={e => { e.stopPropagation(); supprimerSommetPiece(piece.id, i); }}>
                          <title>{peutSupprimer ? "Double-clic pour supprimer ce sommet" : "Une pièce doit garder au moins 3 sommets"}</title>
                        </circle>
                      );
                    })}
                    {isSelected && mode === "select" && !piece.verrouillee && !placementType && piece.contour.map((pt, i) => {
                      const b = piece.contour[(i + 1) % piece.contour.length];
                      const pa = toScreen(pt), pb = toScreen(b);
                      if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < 40) return null;
                      const nIn = normaleInterieure(piece.contour, i);
                      const mx = (pa.x + pb.x) / 2 - nIn.x * 16, my = (pa.y + pb.y) / 2 - nIn.y * 16;
                      return (
                        <g key={`plus${i}`} style={{ cursor: "copy" }} onPointerDown={e => insererSommetPiece(piece.id, i, e)}>
                          <circle cx={mx} cy={my} r={8} fill="#F59E0B" stroke="#fff" strokeWidth={1.5} />
                          <path d={`M${mx - 4} ${my}H${mx + 4}M${mx} ${my - 4}V${my + 4}`} stroke="#fff" strokeWidth={2} strokeLinecap="round" />
                          <title>Glisser pour plier ce mur (ajoute un sommet) — il s'aligne sur les murs adjacents</title>
                        </g>
                      );
                    })}
                    {!piece.masquerDimensions && !masquerEtiquettes && (() => {
                      const gU = geometrieMurs(piece), utileP = gU.utile;
                      return piece.contour.map((pt, i) => {
                      const aU = utileP[i], bU = gU.utileFin[i];
                      const nIn = normaleInterieure(piece.contour, i);
                      const mil = { x: (aU.x + bU.x) / 2, y: (aU.y + bU.y) / 2 };
                      const m0 = toScreen(mil), m1 = toScreen({ x: mil.x + nIn.x * 0.1, y: mil.y + nIn.y * 0.1 });
                      const ln = Math.hypot(m1.x - m0.x, m1.y - m0.y) || 1;
                      const normaleEcran = { x: (m1.x - m0.x) / ln, y: (m1.y - m0.y) / ln };
                      return (
                        <EtiquetteLongueur key={`seg${i}`} aPx={toScreen(aU)} bPx={toScreen(bU)} normale={normaleEcran} texte={`${(longueurUtileCm(piece, i) / 100).toFixed(2)} m`}
                          onClick={mode === "select" && !placementType && !placingTableau && !placingOuverture && !piece.verrouillee ? () => setEditingSegment({ pieceId: piece.id, segIndex: i }) : undefined}
                          actif={editingSegment?.pieceId === piece.id && editingSegment?.segIndex === i} />
                      );
                      });
                    })()}
                    {(piece.ouvertures ?? []).map(o => {
                      const a = piece.contour[o.segIndex], b = piece.contour[(o.segIndex + 1) % piece.contour.length];
                      if (!a || !b) return null;
                      const centreM = { x: a.x + (b.x - a.x) * o.position, y: a.y + (b.y - a.y) * o.position };
                      // Le contour est le tracé hors-tout : le symbole se pose au milieu du mur (fenêtre, ouverture, coulissante) ou sur
                      // la face intérieure finie (vantail de porte, emprise de la porte de garage).
                      const nInO = normaleInterieure(piece.contour, o.segIndex), faceO = faceInterieureM(piece, o.segIndex);
                      const centreMur = { x: centreM.x + nInO.x * faceO / 2, y: centreM.y + nInO.y * faceO / 2 };
                      const centreFace = { x: centreM.x + nInO.x * faceO, y: centreM.y + nInO.y * faceO };
                      const pC = toScreen(centreMur), pA = toScreen(a), pB = toScreen(b);
                      const angleDeg = Math.atan2(pB.y - pA.y, pB.x - pA.x) * 180 / Math.PI;
                      const largeurPx = Math.max(10, (o.largeur / 100) * PX_PER_M * zoom);
                      const isSel = o.id === selectedOuvertureId;
                      // Porte battante : couleur selon l'usage (intérieure brun, entrée brun foncé, service vert d'eau).
                      const couleur = o.type === "porte"
                        ? (o.usage === "entree" ? "#7C2D12" : o.usage === "service" ? "#0F766E" : "#92400E")
                        : o.type === "porte_coulissante" || o.type === "porte_garage" ? "#92400E" : o.type === "fenetre" || o.type === "baie_vitree" ? "#0369A1" : "#78716c";

                      // Symbole d'ouverture de porte (vantail + arc de débattement) — calculé en
                      // mètres à partir de la charnière et du sens choisis, puis chaque point est
                      // projeté à l'écran individuellement pour rester correct quelle que soit
                      // l'orientation du mur (pas de rotation SVG locale à démêler).
                      let vantail: { hinge: Point; bout: Point; arc: Point[] } | null = null;
                      // Porte de garage basculante : emprise balayée par le tablier quand il se relève
                      // sous le plafond (pointillés vers l'intérieur de la pièce, profondeur = hauteur).
                      let basculement: Point[] | null = null;
                      if (o.type === "porte_garage") {
                        const largeurM = o.largeur / 100;
                        const profondeurM = (o.hauteur ?? hauteurOuvertureDefautCm("porte_garage")) / 100;
                        const dxw = b.x - a.x, dyw = b.y - a.y;
                        const longueurMur = Math.hypot(dxw, dyw) || 1;
                        const dirX = dxw / longueurMur, dirY = dyw / longueurMur;
                        const jambeA = { x: centreFace.x - dirX * (largeurM / 2), y: centreFace.y - dirY * (largeurM / 2) };
                        const jambeB = { x: centreFace.x + dirX * (largeurM / 2), y: centreFace.y + dirY * (largeurM / 2) };
                        let nx = -dirY, ny = dirX;
                        const cPiece = centroide(piece.contour);
                        if (nx * (cPiece.x - centreM.x) + ny * (cPiece.y - centreM.y) < 0) { nx = -nx; ny = -ny; }
                        basculement = [
                          jambeA, jambeB,
                          { x: jambeB.x + nx * profondeurM, y: jambeB.y + ny * profondeurM },
                          { x: jambeA.x + nx * profondeurM, y: jambeA.y + ny * profondeurM },
                        ].map(toScreen);
                      }
                      if (o.type === "porte") {
                        const largeurM = o.largeur / 100;
                        const dxw = b.x - a.x, dyw = b.y - a.y;
                        const longueurMur = Math.hypot(dxw, dyw) || 1;
                        const dirX = dxw / longueurMur, dirY = dyw / longueurMur;
                        const jambeA = { x: centreFace.x - dirX * (largeurM / 2), y: centreFace.y - dirY * (largeurM / 2) };
                        const jambeB = { x: centreFace.x + dirX * (largeurM / 2), y: centreFace.y + dirY * (largeurM / 2) };
                        let nx = -dirY, ny = dirX;
                        const cPiece = centroide(piece.contour);
                        const versCentre = { x: cPiece.x - centreM.x, y: cPiece.y - centreM.y };
                        if (nx * versCentre.x + ny * versCentre.y < 0) { nx = -nx; ny = -ny; }
                        if (o.ouvreVersInterieur === false) { nx = -nx; ny = -ny; }
                        const hinge = o.charniere === "droite" ? jambeB : jambeA;
                        const autreJambe = o.charniere === "droite" ? jambeA : jambeB;
                        const bout = { x: hinge.x + nx * largeurM, y: hinge.y + ny * largeurM };
                        const v1 = { x: bout.x - hinge.x, y: bout.y - hinge.y };
                        const v2 = { x: autreJambe.x - hinge.x, y: autreJambe.y - hinge.y };
                        const ang1 = Math.atan2(v1.y, v1.x), ang2 = Math.atan2(v2.y, v2.x);
                        let delta = ang2 - ang1;
                        while (delta > Math.PI) delta -= 2 * Math.PI;
                        while (delta < -Math.PI) delta += 2 * Math.PI;
                        const N = 10;
                        const arcM: Point[] = [];
                        for (let k = 0; k <= N; k++) {
                          const ang = ang1 + delta * (k / N);
                          arcM.push({ x: hinge.x + largeurM * Math.cos(ang), y: hinge.y + largeurM * Math.sin(ang) });
                        }
                        vantail = { hinge: toScreen(hinge), bout: toScreen(bout), arc: arcM.map(toScreen) };
                      }

                      // Fenêtre à battant(s) : un ou deux vantaux (trait + arc de débattement), comme une porte — calculés en mètres
                      // puis projetés point par point. Double battant : charnières aux deux jambages, chaque vantail = demi-largeur.
                      const vantauxFenetre: { hinge: Point; bout: Point; arc: Point[] }[] = [];
                      const nbBattants = o.type === "fenetre" ? battantsFenetre(o) : 0;
                      if (nbBattants > 0) {
                        const largeurM = o.largeur / 100;
                        const dxw = b.x - a.x, dyw = b.y - a.y;
                        const longueurMur = Math.hypot(dxw, dyw) || 1;
                        const dirX = dxw / longueurMur, dirY = dyw / longueurMur;
                        const jambeA = { x: centreFace.x - dirX * (largeurM / 2), y: centreFace.y - dirY * (largeurM / 2) };
                        const jambeB = { x: centreFace.x + dirX * (largeurM / 2), y: centreFace.y + dirY * (largeurM / 2) };
                        let nx = -dirY, ny = dirX;
                        const cPiece = centroide(piece.contour);
                        if (nx * (cPiece.x - centreM.x) + ny * (cPiece.y - centreM.y) < 0) { nx = -nx; ny = -ny; }
                        if (o.ouvreVersInterieur === false) { nx = -nx; ny = -ny; }
                        const ajouterVantail = (hinge: Point, autre: Point, longM: number) => {
                          const bout = { x: hinge.x + nx * longM, y: hinge.y + ny * longM };
                          const ang1 = Math.atan2(bout.y - hinge.y, bout.x - hinge.x), ang2 = Math.atan2(autre.y - hinge.y, autre.x - hinge.x);
                          let delta = ang2 - ang1;
                          while (delta > Math.PI) delta -= 2 * Math.PI;
                          while (delta < -Math.PI) delta += 2 * Math.PI;
                          const N = 8;
                          const arcM: Point[] = [];
                          for (let k = 0; k <= N; k++) {
                            const ang = ang1 + delta * (k / N);
                            arcM.push({ x: hinge.x + longM * Math.cos(ang), y: hinge.y + longM * Math.sin(ang) });
                          }
                          vantauxFenetre.push({ hinge: toScreen(hinge), bout: toScreen(bout), arc: arcM.map(toScreen) });
                        };
                        if (nbBattants === 2) {
                          ajouterVantail(jambeA, centreFace, largeurM / 2);
                          ajouterVantail(jambeB, centreFace, largeurM / 2);
                        } else if (o.charniere === "droite") ajouterVantail(jambeB, jambeA, largeurM);
                        else ajouterVantail(jambeA, jambeB, largeurM);
                      }

                      return (
                        <g key={`ouv-${o.id}`} onPointerDown={e => onOuverturePointerDown(piece, o, e)}
                          style={{ cursor: mode === "select" && !placementType && !placingTableau && !placingOuverture ? (piece.verrouillee ? "pointer" : "grab") : "default" }}>
                          <g transform={`translate(${pC.x}, ${pC.y}) rotate(${angleDeg})`}>
                            <rect x={-largeurPx / 2} y={-4} width={largeurPx} height={8} fill="#fff" />
                            <rect x={-largeurPx / 2 - 4} y={-11} width={largeurPx + 8} height={22} fill="transparent" />
                            {o.type === "fenetre" && (
                              <>
                                <line x1={-largeurPx / 2} y1={-3} x2={largeurPx / 2} y2={-3} stroke={couleur} strokeWidth={1.5} />
                                <line x1={-largeurPx / 2} y1={3} x2={largeurPx / 2} y2={3} stroke={couleur} strokeWidth={1.5} />
                              </>
                            )}
                            {o.type === "baie_vitree" && (() => {
                              // Deux rails ; N vantaux de même largeur (en quinconce, un sur deux par rail), flèche = sens d'ouverture.
                              const cote = o.coulisseVers === "gauche" ? -1 : 1;
                              const nbV = nbVantauxBaie(o);
                              const recPx = (RECOUVREMENT_VANTAUX_CM / (o.largeur || 1)) * largeurPx;
                              const wV = (largeurPx + (nbV - 1) * recPx) / nbV;
                              return (
                                <>
                                  <line x1={-largeurPx / 2} y1={-3} x2={largeurPx / 2} y2={-3} stroke={couleur} strokeWidth={1.5} />
                                  <line x1={-largeurPx / 2} y1={3} x2={largeurPx / 2} y2={3} stroke={couleur} strokeWidth={1.5} />
                                  {Array.from({ length: nbV }, (_, k) => (
                                    <rect key={k} x={-largeurPx / 2 + k * (wV - recPx)} y={k % 2 === 0 ? -5 : 1} width={wV} height={4} fill={couleur} opacity={0.4} />
                                  ))}
                                  <polyline points={`${-cote * largeurPx / 6},0 ${cote * largeurPx / 6},0 ${cote * largeurPx / 6 - cote * 4},-3 ${cote * largeurPx / 6},0 ${cote * largeurPx / 6 - cote * 4},3`}
                                    fill="none" stroke={couleur} strokeWidth={1} />
                                </>
                              );
                            })()}
                            {o.type === "ouverture" && (
                              <rect x={-largeurPx / 2} y={-4} width={largeurPx} height={8} fill="none" stroke={couleur} strokeWidth={1} strokeDasharray="2,2" />
                            )}
                            {o.type === "porte_garage" && (
                              <>
                                <line x1={-largeurPx / 2} y1={0} x2={largeurPx / 2} y2={0} stroke={couleur} strokeWidth={2.5} />
                                <line x1={-largeurPx / 2} y1={-4} x2={-largeurPx / 2} y2={4} stroke={couleur} strokeWidth={1.2} />
                                <line x1={largeurPx / 2} y1={-4} x2={largeurPx / 2} y2={4} stroke={couleur} strokeWidth={1.2} />
                              </>
                            )}
                            {o.type === "porte_coulissante" && (() => {
                              const cote = o.coulisseVers === "gauche" ? -1 : 1;
                              const xPanneau = cote > 0 ? largeurPx / 2 : -largeurPx / 2 - largeurPx;
                              // Galandage : la « cassette » dans le mur est en pointillés (le vantail y rentre), le vantail fermé barre l'ouverture.
                              if (o.montage === "galandage") return (
                                <>
                                  <rect x={xPanneau} y={-3} width={largeurPx} height={6} fill="none" stroke={couleur} strokeWidth={1} strokeDasharray="3,2" />
                                  <line x1={-largeurPx / 2} y1={0} x2={largeurPx / 2} y2={0} stroke={couleur} strokeWidth={2} />
                                </>
                              );
                              return <rect x={xPanneau} y={-3} width={largeurPx} height={6} fill={couleur} opacity={0.45} />;
                            })()}
                          </g>
                          {basculement && (
                            <polygon points={basculement.map(p => `${p.x},${p.y}`).join(" ")} fill={couleur} fillOpacity={0.06}
                              stroke={couleur} strokeWidth={1} strokeDasharray="5,3" pointerEvents="none" />
                          )}
                          {vantail && (
                            <>
                              <line x1={vantail.hinge.x} y1={vantail.hinge.y} x2={vantail.bout.x} y2={vantail.bout.y} stroke={couleur} strokeWidth={o.usage === "entree" ? 2.6 : 1.5} />
                              <polyline points={vantail.arc.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={couleur} strokeWidth={1} strokeDasharray="3,2" />
                            </>
                          )}
                          {vantauxFenetre.map((v, k) => (
                            <g key={`vf-${k}`} pointerEvents="none">
                              <line x1={v.hinge.x} y1={v.hinge.y} x2={v.bout.x} y2={v.bout.y} stroke={couleur} strokeWidth={1.2} />
                              <polyline points={v.arc.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={couleur} strokeWidth={0.9} strokeDasharray="3,2" />
                            </g>
                          ))}
                          {isSel && <circle cx={pC.x} cy={pC.y} r={largeurPx / 2 + 6} fill="none" stroke="#F59E0B" strokeWidth={1.5} />}
                        </g>
                      );
                    })}
                  </g>
                );
              })}

              {showCircuits && resultat && niveauActif && origineCircuits(niveauActif) && (() => {
                // Origine du tracé : le point d'arrivée des gaines quand il est configuré
                // sur ce niveau (cohérent avec le calcul de facturation, predevis-engine.ts
                // — origineCalcul), sinon le tableau directement.
                const tableauPos = origineCircuits(niveauActif)!;
                const waypointsNiveau = niveauActif.liaisonWaypoints;
                const tousAppareils = niveauActif.pieces.flatMap(p => p.appareillages);
                const parCircuit = new Map<number, AppareillagePlace[]>();
                tousAppareils.forEach(a => {
                  if (a.circuitId == null || !circuitsVisibles.has(a.circuitId)) return;
                  const arr = parCircuit.get(a.circuitId) ?? [];
                  arr.push(a);
                  parCircuit.set(a.circuitId, arr);
                });
                return Array.from(parCircuit.entries()).flatMap(([circuitId, points]) => {
                  const breaker = resultat.breakers.find(b => b.id === circuitId);
                  if (!breaker) return [];
                  const color = colorMap.get(circuitId) ?? "#666";
                  const segments = segmentsPourCircuit(breaker, points, niveauActif, tableauPos);
                  const elements: ReactNode[] = [];
                  // Longueur RÉELLE de chaque section (horizontale + montée de départ, + descente finale pour la dernière).
                  const ctxLg = creerContexteLongueurs(niveauActif);
                  const hAncreLg = hauteurAncreFn(ctxLg);
                  segments.forEach(seg => {
                    const sectionsLg = showLongueurs && seg.type !== "domotique" ? tracerLiaison(ctxLg, breaker, segments, seg, hAncreLg).sections : null;
                    const cle = cleSegmentLiaison(seg.aId, seg.bId);
                    const coudes = waypointsNiveau?.[cle] ?? [];
                    // Liaison (navette) entre deux va-et-vient : couleur du circuit assombrie,
                    // pour rester rattachée au circuit tout en se distinguant du reste du tracé.
                    const estDomotique = seg.type === "domotique";
                    const couleurSegment = seg.type === "navette" ? assombrirCouleur(color) : color;
                    // Sous-chaîne du segment : point de départ, coudes existants, point d'arrivée.
                    const sousChaine = [seg.aPoint, ...coudes.map(c => c.point), seg.bPoint];
                    const posesSections = posesTroncons(niveauActif, cle, coudes);
                    for (let j = 0; j < sousChaine.length - 1; j++) {
                      const ptA = sousChaine[j], ptB = sousChaine[j + 1];
                      const aPx = toScreen(ptA), bPx = toScreen(ptB);
                      const apparente = !estDomotique && posesSections[j] === "apparent";
                      const sectionSel = selectedTroncon?.cle === cle && selectedTroncon?.index === j;
                      // Section APPARENTE (le câble sort du mur) : trait plein sur une bande grise = moulure.
                      // Section ENCASTRÉE : pointillé, comme avant (câble caché dans le mur).
                      if (apparente) {
                        elements.push(<line key={`${cle}-${j}-moulure`} x1={aPx.x} y1={aPx.y} x2={bPx.x} y2={bPx.y} stroke="#d6d3d1" strokeWidth={8} strokeLinecap="round" opacity={0.9} style={{ pointerEvents: "none" }} />);
                      }
                      const hSec = hauteursTroncons(niveauActif, cle, coudes)[j];
                      if (hSec != null && !estDomotique) {
                        const mx = (aPx.x + bPx.x) / 2, my = (aPx.y + bPx.y) / 2;
                        elements.push(
                          <g key={`${cle}-${j}-h`} style={{ pointerEvents: "none" }}>
                            <rect x={mx - 16} y={my - 7} width={32} height={14} rx={4} fill="#fff" stroke={couleurSegment} strokeWidth={1} />
                            <text x={mx} y={my + 3.5} textAnchor="middle" fontSize={9} fontWeight={700} fontFamily="monospace" fill="#1c1917">↕{hSec}</text>
                          </g>);
                      }
                      if (sectionSel) {
                        elements.push(<line key={`${cle}-${j}-sel`} x1={aPx.x} y1={aPx.y} x2={bPx.x} y2={bPx.y} stroke="#F59E0B" strokeWidth={11} strokeLinecap="round" opacity={0.35} style={{ pointerEvents: "none" }} />);
                      }
                      if (estDomotique) {
                        // Liaison "particulière" (domotique/sans fil) : symbole d'onde plutôt
                        // qu'un trait plein, pour tous les types d'interrupteur.
                        const wavePts = pointsOndulesEntre(ptA, ptB).map(toScreen);
                        const dOnde = wavePts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
                        elements.push(<polyline key={`${cle}-${j}`} points={dOnde} fill="none" stroke={couleurSegment} strokeWidth={1.8} opacity={0.85} />);
                      } else {
                        elements.push(<line key={`${cle}-${j}`} x1={aPx.x} y1={aPx.y} x2={bPx.x} y2={bPx.y} stroke={couleurSegment} strokeWidth={apparente ? 2.4 : 2} strokeDasharray={apparente ? undefined : "6,4"} opacity={apparente ? 1 : 0.8} />);
                      }
                      if (sectionsLg) {
                        elements.push(<EtiquetteLongueur key={`${cle}-${j}-lg`} aPx={aPx} bPx={bPx} texte={`${(sectionsLg[j] ?? distance(ptA, ptB)).toFixed(2)}m`} />);
                      }
                      if (mode === "select" && !cheminementDessin) {
                        elements.push(
                          <line key={`${cle}-${j}-hit`} x1={aPx.x} y1={aPx.y} x2={bPx.x} y2={bPx.y} stroke="transparent" strokeWidth={14}
                            style={{ cursor: "copy" }}
                            onPointerDown={e => {
                              e.stopPropagation();
                              // Maj + clic : choisir la SECTION (pour régler sa pose) ; clic simple : ajouter un point.
                              if (e.shiftKey) {
                                setSelectedTroncon({ cle, index: j });
                                setSelectedWaypoint(null); setSelectedPieceId(null); setSelectedAppareillageId(null);
                                setSelectedTableau(false); setSelectedBoite(null); setSelectedMeubleId(null);
                                setPanelResetTick(t => t + 1);
                                return;
                              }
                              const rect = svgRef.current?.getBoundingClientRect();
                              if (!rect) return;
                              const m = toMeters(e.clientX - rect.left, e.clientY - rect.top);
                              // Appui + glisser sur un tracé = nouveau point que l'on tire aussitôt : on déforme le circuit
                              // d'un seul geste. (Un simple clic sans bouger ajoute juste le point.)
                              const nouveauId = ajouterWaypoint(cle, j, m);
                              setSelectedWaypoint({ cle, waypointId: nouveauId });
                              setSelectedTroncon(null); setSelectedPieceId(null); setSelectedAppareillageId(null);
                              setSelectedTableau(false); setSelectedBoite(null); setSelectedMeubleId(null);
                              setPanelResetTick(t => t + 1);
                              setDragMode({ kind: "liaison", cle, waypointId: nouveauId });
                            }} />
                        );
                      }
                    }
                    coudes.forEach(c => {
                      const cPx = toScreen(c.point);
                      const estSel = selectedWaypoint?.cle === cle && selectedWaypoint?.waypointId === c.id;
                      elements.push(
                        <g key={`${cle}-wp-${c.id}`}
                          style={{ cursor: mode === "select" ? "grab" : "default" }}
                          onPointerDown={e => {
                            if (mode !== "select" || cheminementDessin) return;
                            e.stopPropagation();
                            // Sélectionne ET arme le déplacement dès le premier appui, comme les
                            // appareillages et le tableau — un simple clic sans bouger reste une
                            // sélection puisque le déplacement ne prend effet qu'au premier pointermove.
                            setSelectedWaypoint({ cle, waypointId: c.id });
                            setSelectedPieceId(null);
                            setSelectedAppareillageId(null);
                            setSelectedTableau(false);
                            setSelectedBoite(null);
                            setSelectedMeubleId(null);
                            setPanelResetTick(t => t + 1);
                            setDragMode({ kind: "liaison", cle, waypointId: c.id });
                          }}
                          onDoubleClick={e => { e.stopPropagation(); supprimerWaypoint(cle, c.id); }}>
                          <circle cx={cPx.x} cy={cPx.y} r={14} fill={estSel ? "#FEF3C7" : "transparent"} stroke="none" />
                          <rect x={cPx.x - 5} y={cPx.y - 5} width={10} height={10} rx={2}
                            fill={estSel ? "#F59E0B" : "#fff"} stroke={color} strokeWidth={2} style={{ pointerEvents: "none" }} />
                        </g>
                      );
                    });
                  });
                  // Boîte(s) de dérivation, déplaçables en drag-drop et nommées indépendamment
                  // — le câble les chaîne dans l'ordre, chaque lampe repart en étoile depuis
                  // la boîte la plus proche d'elle (voir construireBranchesCircuitEclairage).
                  if (breaker.circuit === "lumiere") {
                    const lumieres = points.filter(a => estLumiere(a.type));
                    const boitesExistantes = niveauActif.boitesDerivation?.[breaker.label] ?? [];
                    if (boitesExistantes.length > 0) {
                      boitesExistantes.forEach(boite => {
                        const p = toScreen(boite.point);
                        const estSelBoite = selectedBoite?.label === breaker.label && selectedBoite?.boiteId === boite.id;
                        elements.push(
                          <g key={`boite-${breaker.label}-${boite.id}`} onPointerDown={e => onBoitePointerDown(breaker.label, boite, boite.point, e)}
                            style={{ cursor: mode === "select" ? "grab" : "default" }}>
                            <circle cx={p.x} cy={p.y} r={13} fill={estSelBoite ? "#FEF3C7" : "transparent"} stroke="none" />
                            <rect x={p.x - 6} y={p.y - 6} width={12} height={12} fill="#fff" stroke={color} strokeWidth={2} />
                            <line x1={p.x - 4.5} y1={p.y - 4.5} x2={p.x + 4.5} y2={p.y + 4.5} stroke={color} strokeWidth={1} />
                            <line x1={p.x - 4.5} y1={p.y + 4.5} x2={p.x + 4.5} y2={p.y - 4.5} stroke={color} strokeWidth={1} />
                            <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="9" fontWeight="700" fill="#1c1917" style={{ pointerEvents: "none" }}>{boite.nom}</text>
                            {estSelBoite && <circle cx={p.x} cy={p.y} r={13} fill="none" stroke="#F59E0B" strokeWidth={1.5} />}
                          </g>
                        );
                      });
                    } else if (lumieres.length > 1) {
                      // Boîte implicite (jamais nommée) — la première interaction la promeut
                      // en vraie boîte nommée, voir onBoitePointerDown.
                      const boitePos = centroidePoints(lumieres.map(l => ({ x: l.x, y: l.y })));
                      const p = toScreen(boitePos);
                      elements.push(
                        <g key={`boite-${breaker.label}-implicite`} onPointerDown={e => onBoitePointerDown(breaker.label, null, boitePos, e)}
                          style={{ cursor: mode === "select" ? "grab" : "default" }}>
                          <circle cx={p.x} cy={p.y} r={13} fill="transparent" stroke="none" />
                          <rect x={p.x - 6} y={p.y - 6} width={12} height={12} fill="#fff" stroke={color} strokeWidth={2} />
                          <line x1={p.x - 4.5} y1={p.y - 4.5} x2={p.x + 4.5} y2={p.y + 4.5} stroke={color} strokeWidth={1} />
                          <line x1={p.x - 4.5} y1={p.y + 4.5} x2={p.x + 4.5} y2={p.y - 4.5} stroke={color} strokeWidth={1} />
                        </g>
                      );
                    }
                  }
                  return elements;
                });
              })()}

              {/* Pendant le déplacement d'étage : contours (pointillés bleus) des niveaux reliés par un escalier, pour caler les murs. */}
              {deplacementNiveau && niveauActif && (() => {
                const ids = new Set<number>();
                (niveauActif.escaliers ?? []).forEach(es => { if (es.niveauDestId != null) ids.add(es.niveauDestId); });
                entrantsEscalier.forEach(en => ids.add(en.source.id));
                return niveaux.filter(n => ids.has(n.id) && n.id !== niveauActif.id).map(n => (
                  <g key={`calque-${n.id}`} style={{ pointerEvents: "none" }}>
                    {n.pieces.map(pc => (
                      <polygon key={pc.id} points={pc.contour.map(q => { const sp = toScreen(q); return `${sp.x},${sp.y}`; }).join(" ")}
                        fill="#2563eb" fillOpacity={0.05} stroke="#2563eb" strokeWidth={1.2} strokeDasharray="6,4" opacity={0.7} />
                    ))}
                  </g>
                ));
              })()}

              {/* Escaliers qui ARRIVENT sur ce niveau : trémie hachurée, non éditable (elle se règle depuis le niveau de départ). */}
              {entrantsEscalier.map(({ escalier, source, calcul }) => {
                const pts = (poly: Point[]) => poly.map(q => { const sp = toScreen(q); return `${sp.x},${sp.y}`; }).join(" ");
                const c = toScreen(centroide(calcul.tremie));
                return (
                  <g key={`esc-in-${escalier.id}`} style={{ pointerEvents: "none" }}>
                    <defs>
                      <pattern id={`hachure-tremie-${escalier.id}`} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="7" stroke="#a16207" strokeWidth="1" />
                      </pattern>
                    </defs>
                    <polygon points={pts(calcul.tremie)} fill={`url(#hachure-tremie-${escalier.id})`} stroke="#a16207" strokeWidth={1.4} />
                    {calcul.marches.slice(-calcul.tremieZone).map((m, i) => (
                      <polygon key={i} points={pts(m.poly)} fill="none" stroke="#a16207" strokeWidth={0.7} strokeDasharray="3,2" />
                    ))}
                    <text x={c.x} y={c.y} textAnchor="middle" fontSize="9" fontWeight="700" fill="#713f12" stroke="#fff" strokeWidth={3} paintOrder="stroke">
                      Trémie · escalier depuis {source.nom || NIVEAU_TYPES[source.type]}
                    </text>
                  </g>
                );
              })}

              {/* Escaliers qui PARTENT de ce niveau : marches, flèche de montée, contour de la trémie (en pointillés) à l'étage desservi. */}
              {calculsEscaliers.map(({ e: esc, calc }) => {
                const sel = esc.id === selectedEscalierId;
                const actif = mode === "select" && !placementType && !placingTableau && !placingOuverture && !placingMeuble;
                const pts = (poly: Point[]) => poly.map(q => { const sp = toScreen(q); return `${sp.x},${sp.y}`; }).join(" ");
                const centres = calc.marches.map(m => toScreen(centroide(m.poly)));
                const dest = esc.niveauDestId != null ? niveaux.find(n => n.id === esc.niveauDestId) : undefined;
                const moy = centres.length ? { x: centres.reduce((a, q) => a + q.x, 0) / centres.length, y: centres.reduce((a, q) => a + q.y, 0) / centres.length } : toScreen({ x: esc.x, y: esc.y });
                const n = centres.length;
                const fin = n >= 2 ? centres[n - 1] : null, avant = n >= 2 ? centres[n - 2] : null;
                const ang = fin && avant ? Math.atan2(fin.y - avant.y, fin.x - avant.x) : 0;
                const tete = fin ? [
                  { x: fin.x + 9 * Math.cos(ang), y: fin.y + 9 * Math.sin(ang) },
                  { x: fin.x + 5 * Math.cos(ang + 2.4), y: fin.y + 5 * Math.sin(ang + 2.4) },
                  { x: fin.x + 5 * Math.cos(ang - 2.4), y: fin.y + 5 * Math.sin(ang - 2.4) },
                ] : [];
                return (
                  <g key={`esc-${esc.id}`} onPointerDown={ev => onEscalierPointerDown(esc, ev)} style={{ cursor: actif ? (sel ? "grab" : "pointer") : "default" }}>
                    {calc.marches.map((m, i) => (
                      <polygon key={i} points={pts(m.poly)} fill={m.type === "palier" ? "#d6d3d1" : "#fafaf9"} fillOpacity={0.92}
                        stroke={sel ? "#F59E0B" : "#57534e"} strokeWidth={sel ? 1.5 : 0.9} />
                    ))}
                    {calc.poteau && <circle cx={toScreen(calc.poteau.centre).x} cy={toScreen(calc.poteau.centre).y} r={calc.poteau.rayon * PX_PER_M * zoom} fill="#78716c" style={{ pointerEvents: "none" }} />}
                    {dest && <polygon points={pts(calc.tremie)} fill="none" stroke="#a16207" strokeWidth={1} strokeDasharray="5,3" opacity={0.7} style={{ pointerEvents: "none" }} />}
                    {centres.length >= 2 && (
                      <g style={{ pointerEvents: "none" }}>
                        <circle cx={centres[0].x} cy={centres[0].y} r={3} fill="#44403c" />
                        <polyline points={centres.map(q => `${q.x},${q.y}`).join(" ")} fill="none" stroke="#44403c" strokeWidth={1.2} />
                        <polygon points={tete.map(q => `${q.x},${q.y}`).join(" ")} fill="#44403c" />
                      </g>
                    )}
                    <text x={moy.x} y={moy.y} textAnchor="middle" fontSize="9" fontWeight="700" fill="#292524" stroke="#fff" strokeWidth={3} paintOrder="stroke" style={{ pointerEvents: "none" }}>
                      {esc.nom || "Escalier"} · {calc.nbMarches} marches{dest ? ` ↑ ${dest.nom || NIVEAU_TYPES[dest.type]}` : ""}
                    </text>
                  </g>
                );
              })}

              {niveauActif?.pieces.flatMap(piece => (piece.meubles ?? []).map(m => ({ piece, m }))).map(({ piece, m }) => {
                const p = toScreen({ x: m.x, y: m.y });
                const wPx = m.largeur * PX_PER_M * zoom;
                const dPx = m.profondeur * PX_PER_M * zoom;
                const isSel = m.id === selectedMeubleId;
                const couleur = m.couleur || "#A8A29E";
                return (
                  <g key={`meuble-${m.id}`}
                    onPointerDown={e => onMeublePointerDown(piece, m, e)}
                    transform={`translate(${p.x}, ${p.y}) rotate(${m.rotation ?? 0})`}
                    style={{ cursor: mode === "select" && !placementType && !placingTableau && !placingOuverture && !placingMeuble ? (isSel && !piece.verrouillee ? "grab" : "pointer") : "default" }}>
                    <rect x={-wPx / 2} y={-dPx / 2} width={wPx} height={dPx} rx={3}
                      fill={couleur} fillOpacity={0.35} stroke={isSel ? "#F59E0B" : couleur} strokeWidth={isSel ? 2 : 1.2}
                      strokeDasharray={isSel ? undefined : "4,2"} />
                    {m.nom && (
                      <text x={0} y={3} textAnchor="middle" fontSize="9" fontWeight="600" fill="#44403c" style={{ pointerEvents: "none" }}>{m.nom}</text>
                    )}
                  </g>
                );
              })}

              {niveauActif?.pieces.filter(piece => piece.voiture).map(piece => {
                const v = piece.voiture!;
                const p = toScreen({ x: v.x, y: v.y });
                const wL = VOITURE_LONGUEUR_M * PX_PER_M * zoom, wW = VOITURE_LARGEUR_M * PX_PER_M * zoom;
                const actif = mode === "select" && !placementType && !placingTableau && !placingOuverture && !placingMeuble;
                return (
                  <g key={`voiture-${piece.id}`} onPointerDown={e => onVoiturePointerDown(piece, e)}
                    transform={`translate(${p.x}, ${p.y}) rotate(${v.rotation ?? 0})`} opacity={v.masquee ? 0.35 : 1}
                    style={{ cursor: actif ? (piece.verrouillee ? "pointer" : "grab") : "default" }}>
                    <rect x={-wL / 2} y={-wW / 2} width={wL} height={wW} rx={wW * 0.18} fill="#64748b" fillOpacity={0.28} stroke="#475569" strokeWidth={1.5}
                      strokeDasharray={v.masquee ? "4,3" : undefined} />
                    <rect x={-wL * 0.2} y={-wW * 0.38} width={wL * 0.42} height={wW * 0.76} rx={wW * 0.1} fill="#0f172a" fillOpacity={0.35} />
                    <polygon points={`${wL / 2},0 ${wL / 2 - wW * 0.22},${-wW * 0.18} ${wL / 2 - wW * 0.22},${wW * 0.18}`} fill="#475569" />
                    <text x={0} y={wW / 2 + 11} textAnchor="middle" fontSize="9" fontWeight="600" fill="#334155"
                      transform={`rotate(${-(v.rotation ?? 0)}, 0, ${wW / 2 + 8})`} style={{ pointerEvents: "none" }}>
                      Voiture{v.masquee ? " (masquée)" : ""}
                    </text>
                  </g>
                );
              })}

              {niveauActif?.pieces.filter(piece => piece.personne).map(piece => {
                const pe = piece.personne!;
                const p = toScreen({ x: pe.x, y: pe.y });
                const r = 0.25 * PX_PER_M * zoom; // épaules ≈ 50 cm vues de dessus
                const actif = mode === "select" && !placementType && !placingTableau && !placingOuverture && !placingMeuble;
                return (
                  <g key={`personne-${piece.id}`} onPointerDown={e => onPersonnePointerDown(piece, e)}
                    opacity={pe.masquee ? 0.35 : 1}
                    style={{ cursor: actif ? (piece.verrouillee ? "pointer" : "grab") : "default" }}>
                    <ellipse cx={p.x} cy={p.y} rx={r} ry={r * 0.6} fill="#2563eb" fillOpacity={0.35} stroke="#2563eb" strokeWidth={1.5}
                      strokeDasharray={pe.masquee ? "3,2" : undefined} />
                    <circle cx={p.x} cy={p.y} r={r * 0.45} fill="#f1c9a5" stroke="#92400e" strokeWidth={1} />
                    <text x={p.x} y={p.y + r * 0.6 + 11} textAnchor="middle" fontSize="9" fontWeight="600" fill="#1d4ed8" style={{ pointerEvents: "none" }}>
                      {HAUTEUR_PERSONNE_M.toFixed(2).replace(".", ",")} m{pe.masquee ? " (masquée)" : ""}
                    </text>
                  </g>
                );
              })}

              {niveauActif?.pieces.flatMap(piece => piece.appareillages.map(a => ({ piece, a }))).map(({ piece, a }) => {
                // p = position stockée (sur la ligne du mur quand l'appareillage est aimanté) ;
                // (cx, cy) = centre du carré dessiné : décalé vers l'intérieur de la pièce d'une
                // demi-taille pour que le carré soit TANGENT au mur au lieu de le chevaucher.
                const p = toScreen({ x: a.x, y: a.y });
                const isSel = a.id === selectedAppareillageId;
                const color = showCircuits && a.circuitId != null && circuitsVisibles.has(a.circuitId) ? (colorMap.get(a.circuitId) ?? "#1c1917") : (isSel ? "#F59E0B" : "#1c1917");
                // Poste d'une plaque multiple : ancrage au mur sur le CENTRE de la plaque, puis décalage le long du mur.
                const infoPl = a.groupeId != null ? infosPlaquesParPiece.get(piece.id)?.get(a.groupeId) : undefined;
                const ptAncre = infoPl ? { x: infoPl.gx, y: infoPl.gy } : { x: a.x, y: a.y };
                const anc = estMural(a.type) ? ancrageMurLePlusProche(ptAncre, piece.contour) : null;
                let cx = p.x, cy = p.y, rot = 0, nxs = 0, nys = 0, facePx = 2;
                if (infoPl) { const pc0 = toScreen(ptAncre); cx = pc0.x; cy = pc0.y; }
                if (anc && anc.distance <= TOLERANCE_MUR_M) {
                  // Le point stocké est sur l'AXE du mur ; l'appareillage se pose sur sa face intérieure finie.
                  facePx = Math.max(2, faceInterieureM(piece, anc.segIndex) * PX_PER_M * zoom);
                  const pPied = toScreen(anc.pied);
                  const pN = toScreen({ x: anc.pied.x + anc.normale.x * 0.1, y: anc.pied.y + anc.normale.y * 0.1 });
                  const lenN = Math.hypot(pN.x - pPied.x, pN.y - pPied.y) || 1;
                  nxs = (pN.x - pPied.x) / lenN; nys = (pN.y - pPied.y) / lenN;
                  const demi = boxSize / 2 + facePx; // carré tangent à la face intérieure finie du mur
                  cx = pPied.x + nxs * demi; cy = pPied.y + nys * demi;
                  rot = Math.atan2(nxs, -nys) * 180 / Math.PI;
                }
                let cxPlaque = cx, cyPlaque = cy, largeurPlaque = 0;
                if (infoPl) {
                  // Un carré par poste, contigus (rang 0 = à gauche vu de la pièce) ; la plaque est le contour commun.
                  const dr = anc ? droiteFaceAuMur(anc.normale) : { x: 1, y: 0 };
                  const off = ((a.rangPlaque ?? 0) - (infoPl.n - 1) / 2) * (boxSize + 1);
                  cx += dr.x * off; cy += dr.y * off;
                  largeurPlaque = infoPl.n * boxSize + (infoPl.n - 1);
                }
                const demiBoite = boxSize / 2;
                const fondBoite = isSel ? "#FEF3C7" : "#ffffff";
                // Volet roulant : trait pointillé sur TOUTE la largeur de la fenêtre qu'il équipe
                // (convention des plans : le volet se lit le long de la baie), à 4 px dans la pièce.
                let traitVolet: { x1: number; y1: number; x2: number; y2: number } | null = null;
                if (a.type === "volet_roulant" && anc && anc.distance <= TOLERANCE_MUR_M) {
                  const baie = baieDuVolet({ x: a.x, y: a.y }, piece, niveauActif.pieces);
                  if (baie.detectee) {
                    const sg = piece.contour[(anc.segIndex + 1) % piece.contour.length], sa = piece.contour[anc.segIndex];
                    const lg = Math.hypot(sg.x - sa.x, sg.y - sa.y) || 1;
                    const ux = (sg.x - sa.x) / lg, uy = (sg.y - sa.y) / lg;
                    const e1 = toScreen({ x: baie.centre.x - ux * baie.largeur / 2, y: baie.centre.y - uy * baie.largeur / 2 });
                    const e2 = toScreen({ x: baie.centre.x + ux * baie.largeur / 2, y: baie.centre.y + uy * baie.largeur / 2 });
                    traitVolet = { x1: e1.x + nxs * (facePx + 4), y1: e1.y + nys * (facePx + 4), x2: e2.x + nxs * (facePx + 4), y2: e2.y + nys * (facePx + 4) };
                  }
                }
                // Pastille d'alerte directement sur le plan — un appareillage sans circuit
                // après génération (exclu, commande orpheline…) se repère sans devoir ouvrir
                // la liste des alertes. Uniquement pertinent une fois un résultat généré :
                // avant ça, l'absence de circuitId ne veut encore rien dire.
                const nonRaccorde = resultat != null && a.circuitId == null && a.type !== "rj45"; // RJ45 : courant faible, jamais de circuit de puissance
                return (
                  <g key={a.id}
                    onPointerDown={e => onAppareillagePointerDown(piece, a, e)}
                    style={{ cursor: mode === "select" && !placementType && !placingTableau && !placingOuverture ? (isSel && !piece.verrouillee ? "grab" : "pointer") : "default" }}>
                    {traitVolet && (
                      <line {...traitVolet} stroke={color} strokeWidth={2.4} strokeDasharray="7,3" strokeLinecap="round" opacity={0.85} style={{ pointerEvents: "none" }} />
                    )}
                    {/* Cible de clic généreuse (invisible, 5 px autour du carré) */}
                    <rect x={cx - demiBoite - 5} y={cy - demiBoite - 5} width={boxSize + 10} height={boxSize + 10} fill="transparent" stroke="none" />
                    {a.dejaExistant && (
                      <rect x={cx - demiBoite - 3} y={cy - demiBoite - 3} width={boxSize + 6} height={boxSize + 6} rx={4} fill="none" stroke="#0EA5E9" strokeWidth={1.2} strokeDasharray="2,2" style={{ pointerEvents: "none" }} />
                    )}
                    <rect x={cx - demiBoite} y={cy - demiBoite} width={boxSize} height={boxSize} rx={3}
                      fill={fondBoite} fillOpacity={0.96} stroke={isSel ? "#F59E0B" : color} strokeWidth={isSel ? 2 : 1.2} style={{ pointerEvents: "none" }} />
                    <g transform={`translate(${cx}, ${cy})`} style={{ pointerEvents: "none" }}>
                      <AppareillageGlyphe type={a.type} size={symSize} color={color} rotation={rot} fond={fondBoite} />
                    </g>
                    {infoPl && (a.rangPlaque ?? 0) === 0 && (
                      <g transform={`translate(${cxPlaque}, ${cyPlaque}) rotate(${rot})`} style={{ pointerEvents: "none" }}>
                        <rect x={-largeurPlaque / 2 - 3} y={-boxSize / 2 - 3} width={largeurPlaque + 6} height={boxSize + 6} rx={6}
                          fill="none" stroke="#78716c" strokeWidth={1.2} strokeDasharray="3,2" />
                      </g>
                    )}
                    {a.type === "prise_dediee" && (
                      <g style={{ pointerEvents: "none" }} textAnchor="middle" fontFamily="monospace" fontWeight={800} fontSize={8 * echelleAnnot}>
                        <text x={cx + nxs * (demiBoite + 7)} y={cy + nys * (demiBoite + 7) + 3} fill="none" stroke="#fff" strokeWidth={3} strokeLinejoin="round">{initialesAppareillage(a.type, a.usageDedie)}</text>
                        <text x={cx + nxs * (demiBoite + 7)} y={cy + nys * (demiBoite + 7) + 3} fill={color}>{initialesAppareillage(a.type, a.usageDedie)}</text>
                      </g>
                    )}
                    {nonRaccorde && (
                      <g transform={`translate(${cx + demiBoite - 1}, ${cy - demiBoite - 1}) scale(${echelleAnnot})`} style={{ pointerEvents: "none" }}>
                        <circle cx={0} cy={0} r={6.5} fill="#EF4444" stroke="#fff" strokeWidth={1.5} />
                        <text x={0} y={2.8} textAnchor="middle" fontSize={9} fontWeight={800} fill="#fff">!</text>
                      </g>
                    )}
                  </g>
                );
              })}

              {etiquettesPieces.map(({ piece, nom, surf, w, h, x, y, centrePx }) => {
                const poigneeActive = piece.id === selectedPieceId && mode === "select";
                return (
                  <g key={`etiq-${piece.id}`}>
                    {!(piece.masquerNom && piece.masquerDimensions) && !masquerEtiquettes && piece.id !== selectedPieceId && mode === "select" && !placementType && !placingTableau && !placingOuverture && !placingMeuble && (
                      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} fill="transparent" style={{ cursor: "pointer", pointerEvents: "all" }}
                        onPointerDown={e => { e.stopPropagation(); selectionnerPiece(piece.id); }}>
                        <title>Sélectionner cette pièce</title>
                      </rect>
                    )}
                    <g style={{ pointerEvents: "none" }} textAnchor="middle" fontFamily="monospace">
                      {!piece.masquerNom && !masquerEtiquettes && <>
                        <text x={x} y={y - 3} fontSize={12} fontWeight={700} fill="none" stroke="#fff" strokeWidth={4} strokeLinejoin="round">{nom}</text>
                        <text x={x} y={y - 3} fontSize={12} fontWeight={700} fill="#1c1917">{nom}</text>
                      </>}
                      {!piece.masquerDimensions && !masquerEtiquettes && <>
                        <text x={x} y={y + 11} fontSize={10} fill="none" stroke="#fff" strokeWidth={3.5} strokeLinejoin="round">{surf}</text>
                        <text x={x} y={y + 11} fontSize={10} fill="#78716c">{surf}</text>
                      </>}
                    </g>
                    {piece.verrouillee && (
                      <text x={x + w / 2 - 2} y={y - h / 2 + 4} textAnchor="end" fontSize={11} style={{ pointerEvents: "none" }}>🔒</text>
                    )}
                    {poigneeActive && !piece.verrouillee && (
                      <>
                        <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={4} fill="none" stroke="#F59E0B" strokeWidth={1} strokeDasharray="3,2" style={{ pointerEvents: "none" }} />
                        <g style={{ cursor: "grab" }}
                          onPointerDown={e => onNomPieceDown(piece, { x: (x - centrePx.x) / (PX_PER_M * zoom), y: (y - centrePx.y) / (PX_PER_M * zoom) }, e)}
                          onDoubleClick={e => { e.stopPropagation(); reinitialiserNomPiece(piece.id); }}>
                          <circle cx={x - w / 2} cy={y - h / 2} r={8} fill="#fff" stroke="#F59E0B" strokeWidth={1.8} />
                          <text x={x - w / 2} y={y - h / 2 + 3.5} textAnchor="middle" fontSize={10} fill="#B45309" style={{ pointerEvents: "none" }}>✥</text>
                          <title>Glisser pour déplacer le nom · double-clic : replacer automatiquement</title>
                        </g>
                      </>
                    )}
                  </g>
                );
              })}

              {!masquerEtiquettes && (niveauActif?.zones ?? []).map(z => {
                const surf = surfaceZone(z);
                const nom = z.nom || (z.ferme ? "Zone" : "Cloison");
                const q = toScreen(centreEtiquetteZone(z));
                const txtSurf = surf ? `${surf.utile.toFixed(1)} m²` : "";
                const w = Math.max(nom.length * 6.6, txtSurf.length * 5.6) + 12, h = surf ? 28 : 16;
                return (
                  <g key={`zetiq-${z.id}`} textAnchor="middle" fontFamily="monospace">
                    <rect x={q.x - w / 2} y={q.y - h / 2 - 2} width={w} height={h} rx={4} fill="transparent"
                      style={{ cursor: zoneCliquable ? "pointer" : "default", pointerEvents: zoneCliquable ? "all" : "none" }}
                      onPointerDown={e => selectionnerZone(z.id, null, e)} />
                    <g style={{ pointerEvents: "none" }}>
                      <text x={q.x} y={q.y - (surf ? 3 : -1)} fontSize={11} fontWeight={700} fill="none" stroke="#fff" strokeWidth={4} strokeLinejoin="round">{nom}</text>
                      <text x={q.x} y={q.y - (surf ? 3 : -1)} fontSize={11} fontWeight={700} fill="#5b21b6">{nom}</text>
                      {surf && <text x={q.x} y={q.y + 10} fontSize={9.5} fill="none" stroke="#fff" strokeWidth={3.2} strokeLinejoin="round">{txtSurf}</text>}
                      {surf && <text x={q.x} y={q.y + 10} fontSize={9.5} fill="#6d28d9">{txtSurf}</text>}
                    </g>
                  </g>
                );
              })}

              {cotesAffichees.map((g, i) => <CoteSvg key={`cote-${i}`} g={g} />)}
              {epaisseursMurs.map(t => (
                <g key={t.key} transform={`translate(${t.x} ${t.y}) rotate(${t.ang})`} style={{ pointerEvents: "none" }} textAnchor="middle" fontFamily="monospace" fontSize={8} fontWeight={700}>
                  <text dominantBaseline="central" fill="none" stroke={t.ext ? "#44403c" : "#78716c"} strokeWidth={3} strokeLinejoin="round">{t.txt}</text>
                  <text dominantBaseline="central" fill="#fff">{t.txt}</text>
                </g>
              ))}

              {pieceDeSelectedAppareillage && mode === "select" && pieceDeSelectedAppareillage.contour.map((pt, i) => {
                const next = pieceDeSelectedAppareillage.contour[(i + 1) % pieceDeSelectedAppareillage.contour.length];
                const p = toScreen({ x: (pt.x + next.x) / 2, y: (pt.y + next.y) / 2 });
                return (
                  <g key={`mur-num-${i}`} style={{ pointerEvents: "none" }}>
                    <circle cx={p.x} cy={p.y} r={10} fill="#1c1917" stroke="#fff" strokeWidth={1.5} />
                    <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{i + 1}</text>
                  </g>
                );
              })}

              {niveauActif?.tableauPos && (() => {
                const p = toScreen(niveauActif.tableauPos);
                const rZoneClic = 18;
                // Angle écran équivalent à l'angle monde stocké — reconverti point par point
                // via toScreen plutôt que réutilisé tel quel, au cas où l'échelle/l'axe y
                // écran ne seraient pas dans le même sens que le repère monde.
                const rotDeg = niveauActif.tableauRotation ?? 0;
                const rotRad = (rotDeg * Math.PI) / 180;
                const pDir = toScreen({ x: niveauActif.tableauPos.x + Math.cos(rotRad), y: niveauActif.tableauPos.y + Math.sin(rotRad) });
                const angleEcran = Math.atan2(pDir.y - p.y, pDir.x - p.x) * 180 / Math.PI;
                return (
                  <g onPointerDown={onTableauPointerDown}
                    style={{ cursor: mode === "select" && !placementType && !placingTableau && !placingOuverture ? (selectedTableau ? "grab" : "pointer") : "default" }}>
                    <circle cx={p.x} cy={p.y} r={rZoneClic} fill={selectedTableau ? "#FEF3C7" : "transparent"} stroke="none" />
                    <g transform={`translate(${p.x}, ${p.y}) rotate(${angleEcran})`} style={{ pointerEvents: "none" }}>
                      <rect x={-12} y={-12} width="24" height="24" rx="4" fill="#1c1917" />
                      <text x="0" y="4" textAnchor="middle" fontSize="14" fill="#FBBF24">⚡</text>
                    </g>
                    {selectedTableau && <circle cx={p.x} cy={p.y} r={rZoneClic} fill="none" stroke="#F59E0B" strokeWidth={1.5} />}
                  </g>
                );
              })()}

              {niveauActif?.pointArriveeGaines && (() => {
                const p = toScreen(niveauActif.pointArriveeGaines);
                const rZoneClic = 16;
                return (
                  <g onPointerDown={onPointArriveePointerDown}
                    style={{ cursor: mode === "select" && !placementType && !placingTableau && !placingOuverture && !placingPointArrivee ? (selectedPointArrivee ? "grab" : "pointer") : "default" }}>
                    <circle cx={p.x} cy={p.y} r={rZoneClic} fill={selectedPointArrivee ? "#FEF3C7" : "transparent"} stroke="none" />
                    <circle cx={p.x} cy={p.y} r={10} fill="#0EA5E9" stroke="#fff" strokeWidth={2} />
                    <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="11" fill="#fff" style={{ pointerEvents: "none" }}>⬇</text>
                    {niveauActif.distanceArriveeGainesTableau != null && (
                      <text x={p.x} y={p.y + 24} textAnchor="middle" fontSize="9" fontFamily="monospace" fill="#0369A1" style={{ pointerEvents: "none" }}>
                        {niveauActif.distanceArriveeGainesTableau}m → tableau
                      </text>
                    )}
                    {showCircuits && showLongueurs && resultat && (() => {
                      // Ligne pointillée + étiquette de longueur jusqu'à l'appareillage le
                      // plus proche — même calcul que celui utilisé par le pré-devis
                      // (origineCalcul, predevis-engine.ts). Pointillé pour bien la
                      // distinguer d'un vrai tronçon de circuit dessiné (couleur/gamme
                      // propre à un circuit) : ceci n'est qu'un repère de distance.
                      const candidats = niveauActif.pieces.flatMap(pc => pc.appareillages).filter(a => {
                        if (a.dejaExistant) return false;
                        const manuel = a.circuitManuelId != null ? (niveauActif.circuitsManuels ?? []).find(m => m.id === a.circuitManuelId) : undefined;
                        return !manuel?.nonRelieTableau;
                      });
                      if (candidats.length === 0) return null;
                      let plusProche: AppareillagePlace | null = null;
                      let dMin = Infinity;
                      candidats.forEach(a => { const d = distance(niveauActif.pointArriveeGaines!, { x: a.x, y: a.y }); if (d < dMin) { dMin = d; plusProche = a; } });
                      if (!plusProche) return null;
                      // + la descente de la hauteur de gaine jusqu'à l'appareillage (longueur réelle, pas seulement le plan).
                      const ctxArr = creerContexteLongueurs(niveauActif);
                      dMin += Math.abs(ctxArr.hauteurGaine - hauteurAncreFn(ctxArr)(String((plusProche as AppareillagePlace).id)));
                      const bPx = toScreen({ x: (plusProche as AppareillagePlace).x, y: (plusProche as AppareillagePlace).y });
                      return (
                        <>
                          <line x1={p.x} y1={p.y} x2={bPx.x} y2={bPx.y} stroke="#0EA5E9" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.7} style={{ pointerEvents: "none" }} />
                          <EtiquetteLongueur aPx={p} bPx={bPx} texte={`${dMin.toFixed(2)}m`} />
                        </>
                      );
                    })()}
                    {selectedPointArrivee && <circle cx={p.x} cy={p.y} r={rZoneClic} fill="none" stroke="#F59E0B" strokeWidth={1.5} />}
                  </g>
                );
              })()}

              {cheminementDessin && niveauActif && origineCircuits(niveauActif) && (() => {
                const membres = niveauActif.pieces.flatMap(p => p.appareillages).filter(a => a.circuitId === cheminementDessin.breaker.id);
                // Un circuit manuel "déjà existant" (non relié au tableau) ne part jamais du
                // tableau — même pendant l'aperçu du dessin de cheminement, avant de valider.
                const manuelDuCircuit = cheminementDessin.breaker.manuelId != null
                  ? (niveauActif.circuitsManuels ?? []).find(m => m.id === cheminementDessin.breaker.manuelId)
                  : undefined;
                const relieAuTableau = !manuelDuCircuit?.nonRelieTableau;
                const placesPx = cheminementDessin.ordre
                  .map(id => membres.find(m => m.id === id))
                  .filter((m): m is AppareillagePlace => !!m)
                  .map(a => toScreen({ x: a.x, y: a.y }));
                const chemin = relieAuTableau ? [toScreen(origineCircuits(niveauActif)!), ...placesPx] : placesPx;
                const d = chemin.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
                return (
                  <>
                    {chemin.length > 1 && <path d={d} fill="none" stroke="#F59E0B" strokeWidth={2.5} strokeDasharray="6,4" opacity={0.9} style={{ pointerEvents: "none" }} />}
                    {membres.map(a => {
                      const p = toScreen({ x: a.x, y: a.y });
                      const idx = cheminementDessin.ordre.indexOf(a.id);
                      const place = idx !== -1;
                      return (
                        <g key={`chem-badge-${a.id}`} style={{ pointerEvents: "none" }}>
                          <circle cx={p.x} cy={p.y} r={11} fill={place ? "#F59E0B" : "#fff"} stroke="#F59E0B" strokeWidth={2} />
                          <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="10" fontWeight="700" fill={place ? "#1c1917" : "#F59E0B"}>
                            {place ? idx + 1 : "?"}
                          </text>
                        </g>
                      );
                    })}
                  </>
                );
              })()}

              {liaisonLumiereMode && niveauActif && (() => {
                const points = niveauActif.pieces.flatMap(p => p.appareillages).filter(a => estLumiere(a.type));
                return points.map(a => {
                  const p = toScreen({ x: a.x, y: a.y });
                  const estPremier = liaisonLumiereMode.premierId === a.id;
                  return (
                    <g key={`liaison-badge-${a.id}`} style={{ pointerEvents: "none" }}>
                      <circle cx={p.x} cy={p.y} r={11} fill={estPremier ? "#0EA5E9" : "none"} stroke="#0EA5E9" strokeWidth={2} />
                    </g>
                  );
                });
              })()}

              {dragMode.kind === "piece" && alignPiece && (() => {
                const COUL_OK = "#16A34A", COUL_PROCHE = "#F59E0B";
                const al = alignPiece;
                const nf = (a: FaceKind, b: FaceKind) => `${NOM_FACE[a]} ↔ ${NOM_FACE[b]}`;
                const items: { key: string; ok: boolean; texte: string }[] = [
                  ...(al.coin ? [{ key: "coin", ok: al.coin.dxCm === 0 && al.coin.dyCm === 0,
                    texte: al.coin.dxCm === 0 && al.coin.dyCm === 0 ? `Angle ${nf(al.coin.kM, al.coin.kO)} : coïncident ✔` : `Angle ${nf(al.coin.kM, al.coin.kO)} : ΔX ${al.coin.dxCm} · ΔY ${al.coin.dyCm} cm` }] : []),
                  ...(al.x ? [{ key: "x", ok: al.x.ecartCm === 0, texte: al.x.ecartCm === 0 ? `X aligné ✔ (${nf(al.x.kM, al.x.kO)})` : `X : à ${al.x.ecartCm} cm (${nf(al.x.kM, al.x.kO)})` }] : []),
                  ...(al.y ? [{ key: "y", ok: al.y.ecartCm === 0, texte: al.y.ecartCm === 0 ? `Y aligné ✔ (${nf(al.y.kM, al.y.kO)})` : `Y : à ${al.y.ecartCm} cm (${nf(al.y.kM, al.y.kO)})` }] : []),
                  ...(al.mur ? [{ key: "mur", ok: al.mur.ecartCm === 0, texte: al.mur.ecartCm === 0 ? `Mur oblique aligné ✔ (${nf(al.mur.kM, al.mur.kO)})` : `Mur oblique : à ${al.mur.ecartCm} cm (${nf(al.mur.kM, al.mur.kO)})` }] : []),
                ];
                const trait = (ok: boolean) => ({ stroke: ok ? COUL_OK : COUL_PROCHE, strokeWidth: ok ? 2 : 1, strokeDasharray: "4,3", opacity: ok ? 0.95 : 0.6 });
                return (
                  <g style={{ pointerEvents: "none" }}>
                    {al.mur && (() => {
                      const m = al.mur;
                      const p1 = toScreen({ x: m.a.x - m.dir.x * 200, y: m.a.y - m.dir.y * 200 });
                      const p2 = toScreen({ x: m.a.x + m.dir.x * 200, y: m.a.y + m.dir.y * 200 });
                      return <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} {...trait(m.ecartCm === 0)} />;
                    })()}
                    {al.x && <line x1={toScreen({ x: al.x.pos, y: 0 }).x} y1={0} x2={toScreen({ x: al.x.pos, y: 0 }).x} y2={H} {...trait(al.x.ecartCm === 0)} />}
                    {al.y && <line x1={0} y1={toScreen({ x: 0, y: al.y.pos }).y} x2={W} y2={toScreen({ x: 0, y: al.y.pos }).y} {...trait(al.y.ecartCm === 0)} />}
                    {al.coin && (() => {
                      const ok = al.coin.dxCm === 0 && al.coin.dyCm === 0, col = ok ? COUL_OK : COUL_PROCHE;
                      const po = toScreen(al.coin.o), pm = toScreen(al.coin.m);
                      return (
                        <g>
                          <circle cx={po.x} cy={po.y} r={9} fill="none" stroke={col} strokeWidth={2.5} />
                          <circle cx={pm.x} cy={pm.y} r={4} fill={col} />
                        </g>
                      );
                    })()}
                    {items.map((it, i) => {
                      const col = it.ok ? COUL_OK : COUL_PROCHE;
                      const w = it.texte.length * 6.6 + 16;
                      return (
                        <g key={`b${it.key}`} transform={`translate(${W / 2 - w / 2} ${12 + i * 28})`} fontFamily="monospace">
                          <rect width={w} height={22} rx={6} fill="#fff" stroke={col} strokeWidth={1.5} />
                          <text x={w / 2} y={15} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={it.ok ? "#15803D" : "#B45309"}>{it.texte}</text>
                        </g>
                      );
                    })}
                  </g>
                );
              })()}

              {alignAffiche && (() => {
                const labels = Array.from(new Set(alignAffiche.labels));
                return (
                  <g style={{ pointerEvents: "none" }}>
                    {alignAffiche.lignes.map((l, i) => {
                      const p1 = toScreen({ x: l.q.x - l.d.x * 200, y: l.q.y - l.d.y * 200 });
                      const p2 = toScreen({ x: l.q.x + l.d.x * 200, y: l.q.y + l.d.y * 200 });
                      return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#16A34A" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.9} />;
                    })}
                    {labels.map((txt, i) => {
                      const t = `${txt} ✔`, w = t.length * 6.6 + 16;
                      return (
                        <g key={`al${i}`} transform={`translate(${W / 2 - w / 2} ${12 + i * 28})`} fontFamily="monospace">
                          <rect width={w} height={22} rx={6} fill="#fff" stroke="#16A34A" strokeWidth={1.5} />
                          <text x={w / 2} y={15} textAnchor="middle" fontSize={11.5} fontWeight={700} fill="#15803D">{t}</text>
                        </g>
                      );
                    })}
                  </g>
                );
              })()}

              {guideActif?.x !== undefined && (() => {
                const p = toScreen({ x: guideActif.x, y: 0 });
                return <line x1={p.x} y1={0} x2={p.x} y2={H} stroke="#F59E0B" strokeWidth={1} strokeDasharray="4,3" opacity={0.7} />;
              })()}
              {guideActif?.y !== undefined && (() => {
                const p = toScreen({ x: 0, y: guideActif.y });
                return <line x1={0} y1={p.y} x2={W} y2={p.y} stroke="#F59E0B" strokeWidth={1} strokeDasharray="4,3" opacity={0.7} />;
              })()}

              {mode === "zone" && (zoneAffichee.length > 0 || curseurZ) && (() => {
                const COUL = "#7C3AED";
                const live = curseurZ && zoneAffichee.length > 0 && !zoneEnAttente ? curseurZ.point : null;
                const trace = [...zoneAffichee, ...(live ? [live] : [])].map(toScreen);
                const ferme = !!zoneEnAttente?.ferme || (curseurZ?.ferme ?? false);
                return (
                  <g pointerEvents="none">
                    {zoneAffichee.length >= 3 && ferme && <polygon points={zoneAffichee.map(toScreen).map(q => `${q.x},${q.y}`).join(" ")} fill={COUL} fillOpacity={0.12} stroke="none" />}
                    {trace.length >= 2 && (
                      <polyline points={trace.map(q => `${q.x},${q.y}`).join(" ")} fill="none" stroke={COUL} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={zoneEnAttente ? undefined : "8,5"} />
                    )}
                    {zoneAffichee.map((pt, i) => {
                      const q = toScreen(pt);
                      return <circle key={`zp${i}`} cx={q.x} cy={q.y} r={i === 0 ? (zonePoints.length >= 3 ? 9 : 7) : 5} fill={i === 0 ? COUL : "#fff"} stroke={COUL} strokeWidth={2} />;
                    })}
                    {zoneAffichee.slice(1).map((pt, i) => (
                      <EtiquetteLongueur key={`zseg${i}`} aPx={toScreen(zoneAffichee[i])} bPx={toScreen(pt)} texte={`${distance(zoneAffichee[i], pt).toFixed(2)} m`} />
                    ))}
                    {live && zoneAffichee.length > 0 && (
                      <EtiquetteLongueur key="zlive" aPx={toScreen(zoneAffichee[zoneAffichee.length - 1])} bPx={toScreen(live)}
                        texte={`${distance(zoneAffichee[zoneAffichee.length - 1], live).toFixed(2)} m`} actif />
                    )}
                    {curseurZ && (() => {
                      const q = toScreen(curseurZ.point);
                      return <circle cx={q.x} cy={q.y} r={8} fill="none" stroke={curseurZ.ferme || curseurZ.surMur ? "#16A34A" : COUL} strokeWidth={2.5} />;
                    })()}
                  </g>
                );
              })()}

              {mode === "cloison" && (cloisonAffichee.length > 0 || curseurCl) && (() => {
                const COUL = "#B45309";
                const live = curseurCl && cloisonAffichee.length > 0 ? curseurCl.point : null;
                const trace = [...cloisonAffichee, ...(live ? [live] : [])].map(toScreen);
                return (
                  <g pointerEvents="none">
                    {trace.length >= 2 && (
                      <polyline points={trace.map(q => `${q.x},${q.y}`).join(" ")} fill="none" stroke={COUL} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round"
                        opacity={cloisonEnAttente ? 0.9 : 0.7} strokeDasharray={cloisonEnAttente ? undefined : "9,6"} />
                    )}
                    {cloisonAffichee.map((pt, i) => {
                      const q = toScreen(pt);
                      return <circle key={`cl${i}`} cx={q.x} cy={q.y} r={i === 0 ? 7 : 5} fill={i === 0 ? COUL : "#fff"} stroke={COUL} strokeWidth={2} />;
                    })}
                    {cloisonAffichee.slice(1).map((pt, i) => (
                      <EtiquetteLongueur key={`clseg${i}`} aPx={toScreen(cloisonAffichee[i])} bPx={toScreen(pt)} texte={`${distance(cloisonAffichee[i], pt).toFixed(2)} m`} />
                    ))}
                    {live && cloisonAffichee.length > 0 && (
                      <EtiquetteLongueur key="cllive" aPx={toScreen(cloisonAffichee[cloisonAffichee.length - 1])} bPx={toScreen(live)}
                        texte={`${distance(cloisonAffichee[cloisonAffichee.length - 1], live).toFixed(2)} m`} actif />
                    )}
                    {curseurCl && (() => {
                      const q = toScreen(curseurCl.point);
                      return <circle cx={q.x} cy={q.y} r={8} fill="none" stroke={curseurCl.surMur ? "#16A34A" : COUL} strokeWidth={2.5} />;
                    })()}
                  </g>
                );
              })()}

              {mode === "dessiner" && drawingPoints.length > 0 && (formeDessin === "rectangle" ? (() => {
                const p0 = drawingPoints[0], p1 = curseurSnap?.point ?? p0;
                const rc = rectangleDepuis(p0, p1);
                const pts = rc.map(toScreen).map(q => `${q.x},${q.y}`).join(" ");
                const c0 = toScreen(p0);
                return (
                  <>
                    <polygon points={pts} fill="#F59E0B" fillOpacity={0.12} stroke="#F59E0B" strokeWidth={2} strokeDasharray="6,4" />
                    <circle cx={c0.x} cy={c0.y} r={7} fill="#F59E0B" stroke="#F59E0B" strokeWidth={2} />
                    <EtiquetteLongueur key="rw" aPx={toScreen(rc[0])} bPx={toScreen(rc[1])} texte={`${Math.abs(p1.x - p0.x).toFixed(2)} m`} actif />
                    <EtiquetteLongueur key="rh" aPx={toScreen(rc[1])} bPx={toScreen(rc[2])} texte={`${Math.abs(p1.y - p0.y).toFixed(2)} m`} actif />
                  </>
                );
              })() : (
                <>
                  <polyline
                    points={[...drawingPoints.map(toScreen), ...(curseurSnap ? [toScreen(curseurSnap.point)] : [])].map(p => `${p.x},${p.y}`).join(" ")}
                    fill="none" stroke="#F59E0B" strokeWidth={2} strokeDasharray="6,4" />
                  {drawingPoints.map((pt, i) => {
                    const p = toScreen(pt);
                    return <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? 7 : 5} fill={i === 0 ? "#F59E0B" : "#fff"} stroke="#F59E0B" strokeWidth={2} />;
                  })}
                  {drawingPoints.slice(1).map((pt, i) => {
                    const prev = drawingPoints[i];
                    return <EtiquetteLongueur key={`dseg${i}`} aPx={toScreen(prev)} bPx={toScreen(pt)} texte={`${distance(prev, pt).toFixed(2)} m`} />;
                  })}
                  {curseurSnap && (() => {
                    const last = drawingPoints[drawingPoints.length - 1];
                    return <EtiquetteLongueur key="live" aPx={toScreen(last)} bPx={toScreen(curseurSnap!.point)} texte={`${distance(last, curseurSnap!.point).toFixed(2)} m`} actif />;
                  })()}
                </>
              ))}
            </svg>

            {deplacementNiveau && niveauActif && (() => {
              const liés = new Set<number>();
              (niveauActif.escaliers ?? []).forEach(es => { if (es.niveauDestId != null) liés.add(es.niveauDestId); });
              entrantsEscalier.forEach(en => liés.add(en.source.id));
              const nomsLies = niveaux.filter(n => liés.has(n.id) && n.id !== niveauActif.id).map(n => n.nom || NIVEAU_TYPES[n.type]);
              const cm = (v: number) => Math.round(v * 1000) / 10;
              return (
                <DraggablePanel key="deplacement-niveau" corner="bl" className="card card-inner !p-3 flex flex-col gap-2 shadow-lg w-80">
                  <p className="text-sm font-semibold text-ink-900">⤧ Déplacer tout l&apos;étage <span className="text-xs font-normal text-ink-400">· {niveauActif.nom || NIVEAU_TYPES[niveauActif.type]}</span></p>
                  <p className="text-[11px] text-ink-500">
                    Glisse sur le plan : toutes les pièces et leur contenu, les zones, le tableau et les escaliers bougent ensemble. Maj + glisser = déplacer la vue · flèches = 1 cm (Maj : 10 cm) · Échap = annuler.
                  </p>
                  {nomsLies.length > 0 && <p className="text-[11px] text-blue-700">Contours en pointillés bleus : {nomsLies.join(", ")} (calage des murs). La trémie hachurée montre où arrive l&apos;escalier.</p>}
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0 w-24">Décalage X (cm)</span>
                    <input type="number" className="input !py-1 !text-xs !w-24" key={`dn-x-${dragEndTick}-${cm(deplacementNiveau.dx)}`} defaultValue={cm(deplacementNiveau.dx)}
                      onChange={ev => { const v = Number(ev.target.value); if (ev.target.value !== "" && !Number.isNaN(v)) appliquerDecalageNiveau(v / 100, deplacementNiveau.dy); }} />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0 w-24">Décalage Y (cm)</span>
                    <input type="number" className="input !py-1 !text-xs !w-24" key={`dn-y-${dragEndTick}-${cm(deplacementNiveau.dy)}`} defaultValue={cm(deplacementNiveau.dy)}
                      onChange={ev => { const v = Number(ev.target.value); if (ev.target.value !== "" && !Number.isNaN(v)) appliquerDecalageNiveau(deplacementNiveau.dx, v / 100); }} />
                  </div>
                  {niveauActif.pieces.some(p => p.verrouillee) && <p className="text-[11px] text-ink-400">Les pièces verrouillées suivent aussi : c&apos;est le niveau entier qui se déplace.</p>}
                  <div className="flex gap-2">
                    <button onClick={() => terminerDeplacementNiveau(false)} className="btn-volt !text-xs flex-1">Terminer</button>
                    <button onClick={() => terminerDeplacementNiveau(true)} className="btn-ghost !text-xs flex-1">Annuler le déplacement</button>
                  </div>
                </DraggablePanel>
              );
            })()}

            {selectedEscalier && niveauActif && mode === "select" && (() => {
              const esc = selectedEscalier;
              const calc = calculerEscalier(esc, hauteurTotaleEscalierCm(esc, niveauActif));
              const maj = (patch: Partial<Escalier>) => modifierEscalier(esc.id, patch);
              const dest = esc.niveauDestId != null ? niveaux.find(n => n.id === esc.niveauDestId) : undefined;
              const nomNiveau = (n: Niveau) => n.nom || NIVEAU_TYPES[n.type];
              const alertes = [...calc.avertissements];
              if (!dest) alertes.push("Aucun niveau desservi : l'escalier ne mène nulle part (pas de trémie).");
              else if (dest.pieces.length > 0 && !trouverPiece(centroide(calc.tremie), dest.pieces)) alertes.push(`La trémie n'est dans aucune pièce de « ${nomNiveau(dest)} » : déplace l'escalier.`);
              const ligne = (label: string, contenu: ReactNode) => (
                <div className="flex items-center gap-2 text-xs text-ink-500"><span className="shrink-0 w-28">{label}</span>{contenu}</div>
              );
              const num = (label: string, valeur: number | undefined, onVal: (v: number | undefined) => void, o: { placeholder?: string; min?: number; step?: number } = {}) =>
                ligne(label, (
                  <input type="number" min={o.min} step={o.step} placeholder={o.placeholder} className="input !py-1 !text-xs !w-24"
                    key={`esc-${esc.id}-${label}-${dragEndTick}`} defaultValue={valeur ?? ""}
                    onChange={ev => { const v = ev.target.value; if (v === "") onVal(undefined); else { const x = Number(v); if (!Number.isNaN(x)) onVal(x); } }} />
                ));
              const choix = <T extends string>(label: string, valeur: T, options: [T, string][], onVal: (v: T) => void) =>
                ligne(label, (
                  <select className="input !py-1 !text-xs flex-1" value={valeur} onChange={ev => onVal(ev.target.value as T)}>
                    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                ));
              const tournant = esc.type === "quart_tournant" || esc.type === "demi_tournant";
              const changerType = (t: EscalierType) => maj({
                type: t,
                tournant: t === "quart_tournant" || t === "demi_tournant" ? (esc.tournant ?? "palier") : undefined,
                structure: t === "helicoidal"
                  ? (esc.structure === "limons_lateraux" || esc.structure === "limon_central" ? "poteau_central" : esc.structure)
                  : (esc.structure === "poteau_central" ? "limons_lateraux" : esc.structure),
                ...(t === "helicoidal" ? { diametre: esc.diametre ?? DIAMETRE_HELICE_DEFAUT_CM, diametrePoteau: esc.diametrePoteau ?? DIAMETRE_POTEAU_DEFAUT_CM } : {}),
              });
              const structures: [Escalier["structure"], string][] = (esc.type === "helicoidal"
                ? ["poteau_central", "massif", "marches_seules"]
                : ["limons_lateraux", "limon_central", "massif", "marches_seules"]
              ).map(k => [k as Escalier["structure"], LABEL_STRUCTURE[k as Escalier["structure"]]]);
              const couleurDefaut = `#${COULEUR_MATERIAU[esc.materiau].toString(16).padStart(6, "0")}`;
              const tourner = (d: number) => { maj({ rotation: (((esc.rotation + d) % 360) + 360) % 360 }); setDragEndTick(t => t + 1); };
              return (
                <DraggablePanel key={`esc-${esc.id}-${panelResetTick}`} corner="bl" className="card card-inner !p-3 flex flex-col gap-1.5 shadow-lg w-80 max-h-[75vh] overflow-y-auto">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink-900">🪜 {esc.nom || "Escalier"} <span className="text-xs font-normal text-ink-400">· {LABEL_ESCALIER_TYPE[esc.type]}</span></p>
                    <button onClick={() => supprimerEscalier(esc.id)} className="btn-danger !px-2 !py-1" title="Supprimer l'escalier (Suppr)"><Trash2 size={13} /></button>
                  </div>
                  <p className="text-[11px] text-ink-500">
                    {calc.nbMarches} marches de {calc.hMarche.toFixed(1)} cm · giron {calc.giron.toFixed(1)} cm · pente {calc.pente.toFixed(0)}° · Blondel {calc.blondel} · hauteur {calc.hauteurTotale} cm
                  </p>
                  <p className="text-[11px] text-ink-500">Emprise {calc.empriseCm.longueur} × {calc.empriseCm.largeur} cm · emmarchement {calc.emmarchementCm} cm · trémie {calc.tremieCm.longueur} × {calc.tremieCm.largeur} cm</p>
                  {alertes.length > 0 && (
                    <ul className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 list-disc list-inside">
                      {alertes.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  )}
                  {ligne("Nom", (
                    <input type="text" className="input !py-1 !text-xs flex-1" placeholder="Escalier" key={`esc-${esc.id}-nom`} defaultValue={esc.nom ?? ""}
                      onChange={ev => maj({ nom: ev.target.value || undefined })} />
                  ))}
                  {choix<EscalierType>("Type", esc.type, [["droit", "Droit"], ["quart_tournant", "Quart tournant"], ["demi_tournant", "Demi-tournant"], ["helicoidal", "Hélicoïdal"]], changerType)}
                  {ligne("Dessert", (
                    <select className="input !py-1 !text-xs flex-1" value={esc.niveauDestId ?? ""} onChange={ev => maj({ niveauDestId: ev.target.value === "" ? undefined : Number(ev.target.value) })}>
                      <option value="">— Aucun —</option>
                      {niveaux.filter(n => n.id !== niveauActif.id).map(n => <option key={n.id} value={n.id}>{nomNiveau(n)}</option>)}
                    </select>
                  ))}

                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400 mt-1">Dimensions (cm) — tout est calculé automatiquement ; renseigne une valeur pour l'imposer, le reste s'adapte</p>
                  {num("Hauteur à franchir", esc.hauteurCm, v => maj({ hauteurCm: v }), { placeholder: String(calc.hauteurTotale), min: 50 })}
                  {num("Épaisseur plancher", esc.epaisseurPlancher, v => v !== undefined && maj({ epaisseurPlancher: v }), { min: 0 })}
                  {num("Nb de marches", esc.nbMarches, v => maj({ nbMarches: v === undefined ? undefined : Math.round(v) }), { placeholder: String(calc.nbMarches), min: 3 })}
                  {num("Giron", esc.giron, v => maj({ giron: v }), { placeholder: calc.giron.toFixed(1), min: 10 })}
                  {esc.type !== "helicoidal" && num("Largeur (emmarchement)", esc.largeur, v => v !== undefined && maj({ largeur: v }), { min: 40 })}
                  {esc.type !== "helicoidal" && num("Longueur hors-tout", esc.longueurHorsTout, v => maj({ longueurHorsTout: v }), { placeholder: String(calc.empriseCm.longueur), min: 100 })}
                  {(esc.type === "quart_tournant" || esc.type === "demi_tournant") && num("Largeur hors-tout", esc.largeurHorsTout, v => maj({ largeurHorsTout: v }), { placeholder: String(calc.empriseCm.largeur), min: 80 })}
                  {num("Épaisseur marche", esc.epaisseurMarche, v => maj({ epaisseurMarche: v }), { placeholder: "4", min: 1 })}

                  {esc.type === "helicoidal" && (
                    <>
                      {num("Diamètre extérieur", esc.diametre, v => maj({ diametre: v }), { placeholder: String(DIAMETRE_HELICE_DEFAUT_CM), min: 80 })}
                      {num("Diamètre poteau", esc.diametrePoteau, v => maj({ diametrePoteau: v }), { placeholder: String(DIAMETRE_POTEAU_DEFAUT_CM), min: 4 })}
                    </>
                  )}
                  {tournant && (
                    <>
                      {choix<"palier" | "balancees">("Virage", esc.tournant ?? "palier", [["palier", "Avec palier"], ["balancees", "Marches balancées"]], v => maj({ tournant: v }))}
                      {num("Marches 1re volée", esc.nbMarchesVolee1, v => maj({ nbMarchesVolee1: v === undefined ? undefined : Math.round(v) }), { placeholder: "auto", min: 1 })}
                      {esc.tournant === "balancees" && num("Marches balancées", esc.nbBalancees, v => maj({ nbBalancees: v === undefined ? undefined : Math.round(v) }), { placeholder: esc.type === "quart_tournant" ? "3" : "6", min: 2 })}
                      {esc.type === "demi_tournant" && esc.tournant !== "balancees" && num("Jour entre volées", esc.jour, v => maj({ jour: v }), { placeholder: "10", min: 0 })}
                    </>
                  )}
                  {esc.type !== "droit" && choix<"gauche" | "droite">("Sens du virage", esc.sens, [["gauche", "À gauche"], ["droite", "À droite"]], v => maj({ sens: v }))}

                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400 mt-1">Aspect</p>
                  {choix<Escalier["structure"]>("Structure", esc.structure, structures, v => maj({ structure: v }))}
                  {choix<Escalier["rampe"]>("Garde-corps", esc.rampe, (["aucune", "gauche", "droite", "deux_cotes"] as const).map(k => [k, LABEL_RAMPE[k]] as [Escalier["rampe"], string]), v => maj({ rampe: v }))}
                  {choix<Escalier["materiau"]>("Matériau", esc.materiau, (["bois", "beton", "metal", "blanc"] as const).map(k => [k, LABEL_MATERIAU[k]] as [Escalier["materiau"], string]), v => maj({ materiau: v }))}
                  {ligne("Couleur marches", (
                    <div className="flex items-center gap-2 flex-1">
                      <input type="color" value={esc.couleur ?? couleurDefaut} onChange={ev => maj({ couleur: ev.target.value })} className="w-8 h-6 p-0 border border-ink-200 rounded" />
                      {esc.couleur && <button onClick={() => maj({ couleur: undefined })} className="text-[11px] text-volt-600 underline">↺ matériau</button>}
                    </div>
                  ))}
                  {ligne("Contremarches", (
                    <label className="flex items-center gap-1.5 text-xs text-ink-600"><input type="checkbox" checked={esc.contremarches} onChange={ev => maj({ contremarches: ev.target.checked })} /> pleines (décocher = ajourées)</label>
                  ))}

                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400 mt-1">Trémie (étage desservi)</p>
                  {num("Hauteur de passage", esc.hauteurPassage, v => maj({ hauteurPassage: v }), { placeholder: "190", min: 100 })}
                  {num("Jeu autour", esc.jeuTremie, v => maj({ jeuTremie: v }), { placeholder: "0", min: 0 })}

                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400 mt-1">Position</p>
                  {num("X (cm)", Math.round(esc.x * 100), v => v !== undefined && maj({ x: v / 100 }))}
                  {num("Y (cm)", Math.round(esc.y * 100), v => v !== undefined && maj({ y: v / 100 }))}
                  {ligne("Rotation (°)", (
                    <div className="flex items-center gap-1.5">
                      <input type="number" className="input !py-1 !text-xs !w-16" key={`esc-${esc.id}-rot-${dragEndTick}`} defaultValue={Math.round(esc.rotation)}
                        onChange={ev => { const x = Number(ev.target.value); if (ev.target.value !== "" && !Number.isNaN(x)) maj({ rotation: x }); }} />
                      <button onClick={() => tourner(-90)} className="btn-ghost !px-2 !py-1 !text-xs" title="Tourner de 90° vers la gauche">↺ 90</button>
                      <button onClick={() => tourner(90)} className="btn-ghost !px-2 !py-1 !text-xs" title="Tourner de 90° vers la droite">↻ 90</button>
                    </div>
                  ))}
                  <p className="text-[11px] text-ink-400">Glisse l'escalier sur le plan pour le déplacer. La montée va vers le haut du plan à 0°.</p>
                </DraggablePanel>
              );
            })()}

            {selectedPiece && mode === "select" && (
              <DraggablePanel key={`${selectedPiece.id}-${panelResetTick}`} corner="bl" className="card card-inner !p-3 flex items-center gap-3 shadow-lg">
                <div>
                  <p className="text-sm font-semibold text-ink-900">{selectedPiece.nom || PIECE_TYPES[selectedPiece.type].label}</p>
                  <p className="text-xs text-ink-400">{PIECE_TYPES[selectedPiece.type].label} · {aireDuPolygone(selectedPiece.contour).toFixed(1)} m² · {selectedPiece.appareillages.length} appareillage(s) · {selectedPiece.contour.length} sommets</p>
                </div>
                <button onClick={() => verrouillerPiece(selectedPiece.id, !selectedPiece.verrouillee)}
                  className={`${selectedPiece.verrouillee ? "btn-volt" : "btn-ghost"} !px-2 !py-1.5 !text-xs`}
                  title={selectedPiece.verrouillee ? "Pièce verrouillée — cliquer pour déverrouiller" : "Verrouiller la pièce : plus aucun déplacement (pièce, sommets, murs, appareillages, meubles, portes/fenêtres, nom)"}>
                  {selectedPiece.verrouillee ? <><Lock size={13} /> Verrouillée</> : <><Unlock size={13} /> Verrouiller</>}
                </button>
                {(() => {
                  const voisines = niveauActif && !selectedPiece.verrouillee ? voisinesFusionnables(niveauActif.pieces.filter(p => !p.verrouillee), selectedPiece) : [];
                  if (voisines.length === 0) return null;
                  return (
                    <select value="" className="input !py-1 !text-xs !w-auto"
                      title="Fusionner cette pièce avec une pièce adjacente (mur commun) : une seule pièce, au contour réuni"
                      onChange={e => { if (e.target.value) fusionnerAvecPiece(selectedPiece.id, Number(e.target.value)); }}>
                      <option value="">Fusionner avec…</option>
                      {voisines.map(v => <option key={v.id} value={v.id}>{v.nom || PIECE_TYPES[v.type].label}</option>)}
                    </select>
                  );
                })()}
                <button onClick={() => updateNiveauActif(n => ({ ...n, pieces: n.pieces.map(p => p.id === selectedPiece.id ? { ...p, masquerNom: p.masquerNom ? undefined : true } : p) }))}
                  className={`${selectedPiece.masquerNom ? "btn-ghost" : "btn-volt"} !px-2 !py-1.5 !text-xs`}
                  title={selectedPiece.masquerNom ? "Nom masqué — cliquer pour l'afficher" : "Masquer le nom de cette pièce"}>Nom</button>
                <button onClick={() => updateNiveauActif(n => ({ ...n, pieces: n.pieces.map(p => p.id === selectedPiece.id ? { ...p, masquerDimensions: p.masquerDimensions ? undefined : true } : p) }))}
                  className={`${selectedPiece.masquerDimensions ? "btn-ghost" : "btn-volt"} !px-2 !py-1.5 !text-xs`}
                  title={selectedPiece.masquerDimensions ? "Dimensions masquées — cliquer pour les afficher" : "Masquer toutes les dimensions de cette pièce (surface, longueur et largeur des murs, cotes, épaisseurs)"}>Dimensions</button>
                <div className="flex items-center gap-1" title="Couleur de fond de la pièce (plan 2D) — recliquer sur la couleur choisie pour revenir à la couleur par défaut">
                  {COULEURS_FOND_PIECE.map(c => (
                    <button key={c.hex} aria-label={c.nom} title={c.nom}
                      onClick={() => updateNiveauActif(n => ({ ...n, pieces: n.pieces.map(p => p.id === selectedPiece.id ? { ...p, couleurFond: p.couleurFond === c.hex ? undefined : c.hex } : p) }))}
                      className="w-5 h-5 rounded-full border"
                      style={{ background: c.hex, borderColor: selectedPiece.couleurFond === c.hex ? "#1c1917" : "#d6d3d1", borderWidth: selectedPiece.couleurFond === c.hex ? 2 : 1 }} />
                  ))}
                </div>
                {selectedPiece.nomDecalage && !selectedPiece.verrouillee && (
                  <button onClick={() => reinitialiserNomPiece(selectedPiece.id)} className="btn-ghost !px-2 !py-1.5 !text-xs" title="Replacer le nom et la surface automatiquement">↺ Nom</button>
                )}
                {!selectedPiece.personne ? (
                  <button onClick={() => ajouterPersonne(selectedPiece)} className="btn-ghost !px-2 !py-1.5 !text-xs"
                    title="Pose une personne de 1,80 m dans la pièce (vue 3D) pour juger les échelles — déplaçable à la souris">+ Personne 1,80 m</button>
                ) : (
                  <>
                    <button onClick={() => basculerPersonne(selectedPiece.id)} className={`${selectedPiece.personne.masquee ? "btn-ghost" : "btn-volt"} !px-2 !py-1.5 !text-xs`}
                      title={selectedPiece.personne.masquee ? "Personne masquée en 3D — cliquer pour l'afficher" : "Masquer la personne en 3D (elle reste en place)"}>
                      {selectedPiece.personne.masquee ? "Afficher la personne" : "Masquer la personne"}
                    </button>
                    <button onClick={() => retirerPersonne(selectedPiece.id)} className="btn-danger !px-2 !py-1.5" title="Supprimer la personne de cette pièce"><Trash2 size={13} /></button>
                  </>
                )}
                {!selectedPiece.voiture ? (
                  <button onClick={() => ajouterVoiture(selectedPiece)} className="btn-ghost !px-2 !py-1.5 !text-xs"
                    title="Pose une voiture familiale standard (4,60 × 1,85 m) dans la pièce (vue 3D) pour juger les échelles — déplaçable à la souris">+ Voiture</button>
                ) : (
                  <>
                    <button onClick={() => pivoterVoiture(selectedPiece)} className="btn-ghost !px-2 !py-1.5 !text-xs" title="Tourner la voiture de 90°">↻ 90°</button>
                    <button onClick={() => modifierVoiture(selectedPiece.id, { masquee: !selectedPiece.voiture!.masquee })}
                      className={`${selectedPiece.voiture.masquee ? "btn-ghost" : "btn-volt"} !px-2 !py-1.5 !text-xs`}
                      title={selectedPiece.voiture.masquee ? "Voiture masquée en 3D — cliquer pour l'afficher" : "Masquer la voiture en 3D (elle reste en place)"}>
                      {selectedPiece.voiture.masquee ? "Afficher la voiture" : "Masquer la voiture"}
                    </button>
                    <button onClick={() => retirerVoiture(selectedPiece.id)} className="btn-danger !px-2 !py-1.5" title="Supprimer la voiture de cette pièce"><Trash2 size={13} /></button>
                  </>
                )}
                <button onClick={() => zoomSurPiece(selectedPiece)} className="btn-ghost !px-2 !py-1.5" title="Zoomer sur la pièce"><Search size={13} /></button>
                <button onClick={() => setEditingPiece(selectedPiece)} className="btn-ghost !px-2 !py-1.5"><Pencil size={13} /></button>
              </DraggablePanel>
            )}

            {selectedAppareillage && mode === "select" && (
              <DraggablePanel key={`${selectedAppareillage.id}-${panelResetTick}`} corner="bl" className="card card-inner !p-3 flex flex-col gap-2 shadow-lg w-72 max-h-[80vh] overflow-y-auto">
                <div className="flex items-center gap-2">
                  <AppareillageSymbol type={selectedAppareillage.type} size={22} />
                  <input className="input !py-1 !text-sm flex-1 min-w-0" placeholder={labelAppareillagePlace(selectedAppareillage)}
                    value={selectedAppareillage.nom ?? ""}
                    onChange={e => renommerAppareillage(selectedAppareillage.id, e.target.value)} />
                  <button onClick={() => removerAppareillage(selectedAppareillage.id)} className="btn-danger !px-2 !py-1.5 shrink-0"><Trash2 size={13} /></button>
                </div>
                {niveauActif && niveauActif.pieces.length > 1 && (
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0">Pièce</span>
                    <select className="input !py-1 !text-xs flex-1"
                      value={pieceDeSelectedAppareillage?.id ?? ""}
                      disabled={!!pieceDeSelectedAppareillage?.verrouillee}
                      onChange={e => deplacerAppareillageVersPiece(selectedAppareillage.id, Number(e.target.value))}>
                      {niveauActif.pieces.map(p => <option key={p.id} value={p.id}>{p.nom || PIECE_TYPES[p.type].label}</option>)}
                    </select>
                  </div>
                )}
                {selectedAppareillage.type !== "volet_roulant" && (
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="shrink-0">Hauteur (cm)</span>
                  <input type="number" className="input !py-1 !text-xs !w-20" placeholder="—"
                    value={selectedAppareillage.hauteur ?? ""}
                    onChange={e => modifierHauteur(selectedAppareillage.id, e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                )}
                {selectedAppareillage.type === "volet_roulant" && pieceDeSelectedAppareillage && niveauActif && (() => {
                  const baie = baieDuVolet({ x: selectedAppareillage.x, y: selectedAppareillage.y }, pieceDeSelectedAppareillage, niveauActif.pieces);
                  const caisson = selectedAppareillage.caisson ?? "interieur";
                  const pct = selectedAppareillage.voletOuvertPct ?? 0;
                  return (
                    <div className="flex flex-col gap-2 text-xs text-ink-500">
                      <p className={baie.detectee ? "text-ink-700" : "text-amber-600"}>
                        {baie.detectee
                          ? `Fenêtre détectée : ${Math.round(baie.largeur * 100)} × ${Math.round(baie.hauteur * 100)} cm (allège ${Math.round(baie.allege * 100)} cm) — le volet en prend les dimensions.`
                          : "Aucune fenêtre à proximité sur ce mur — dimensions par défaut (100 × 120 cm). Rapproche le volet d'une fenêtre."}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0">Caisson</span>
                        {(["interieur", "exterieur"] as const).map(c => (
                          <button key={c} onClick={() => modifierVolet(selectedAppareillage.id, { caisson: c })}
                            className={`${caisson === c ? "btn-volt" : "btn-ghost"} !text-xs !py-1 flex-1 justify-center`}>
                            {c === "interieur" ? "Intérieur" : "Extérieur"}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0">Volet</span>
                        {([["Fermé", 0], ["Mi-ouvert", 50], ["Ouvert", 100]] as const).map(([lib, v]) => (
                          <button key={lib} onClick={() => modifierVolet(selectedAppareillage.id, { voletOuvertPct: v })}
                            className={`${pct === v ? "btn-volt" : "btn-ghost"} !text-xs !py-1 flex-1 justify-center`}>
                            {lib}
                          </button>
                        ))}
                      </div>
                      <input type="range" min={0} max={100} step={5} value={pct}
                        onChange={e => modifierVolet(selectedAppareillage.id, { voletOuvertPct: Number(e.target.value) })} />
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0">Couleur</span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {COULEURS_VOLET.map(c => {
                            const actif = (selectedAppareillage.voletCouleur ?? "#ffffff").toLowerCase() === c.hex;
                            return (
                              <button key={c.hex} title={c.nom} aria-label={c.nom}
                                onClick={() => modifierVolet(selectedAppareillage.id, { voletCouleur: c.hex })}
                                className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                                style={{ background: c.hex, borderColor: actif ? "#F59E0B" : "#d6d3d1", boxShadow: actif ? "0 0 0 2px #FEF3C7" : undefined }} />
                            );
                          })}
                          <label className="flex items-center gap-1 cursor-pointer" title="Choisir n'importe quelle couleur">
                            <input type="color" value={selectedAppareillage.voletCouleur ?? "#ffffff"}
                              onChange={e => modifierVolet(selectedAppareillage.id, { voletCouleur: e.target.value })}
                              className="w-7 h-7 p-0 border-0 bg-transparent cursor-pointer" />
                            <span>Autre…</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {selectedAppareillage.type === "chauffage" && (
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0">Puissance (W)</span>
                    <input type="number" min={0} step={50} className="input !py-1 !text-xs !w-24" placeholder="1000"
                      value={selectedAppareillage.puissanceW ?? ""}
                      onChange={e => modifierPuissance(selectedAppareillage.id, e.target.value ? Number(e.target.value) : undefined)} />
                    <span className="text-ink-400">— regroupé par puissance (NF C 15-100)</span>
                  </div>
                )}
                {selectedAppareillage.type === "prise_dediee" && postesPlaqueSel.length === 0 && (
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0">Appareil alimenté</span>
                    <select className="input !py-1 !text-xs flex-1" value={selectedAppareillage.usageDedie ?? USAGE_DEDIE_DEFAUT}
                      onChange={e => modifierUsageDedie(selectedAppareillage.id, e.target.value as AppareillageType)}>
                      {TYPES_USAGE_DEDIE.map(t => <option key={t} value={t}>{LIBELLE_USAGE_DEDIE[t]}</option>)}
                    </select>
                  </div>
                )}
                {TYPES_POSTE_PLAQUE.includes(selectedAppareillage.type) && (
                  <div className="flex flex-col gap-1.5 text-xs text-ink-500 border-t border-ink-100 pt-2">
                    <span className="font-semibold text-ink-700">
                      {postesPlaqueSel.length >= 2 ? `Plaque ${postesPlaqueSel.length === 2 ? "double" : postesPlaqueSel.length === 3 ? "triple" : "quadruple"} — ${postesPlaqueSel.length} postes` : "Appareillage simple"}
                    </span>
                    {postesPlaqueSel.map((po, i) => (
                      <div key={po.id} className={`flex flex-col gap-1 p-1.5 rounded-lg border ${po.id === selectedAppareillage.id ? "border-volt-400 bg-volt-50" : "border-ink-200"}`}>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => setSelectedAppareillageId(po.id)} className="shrink-0 w-12 text-left font-semibold">Poste {i + 1}</button>
                          <select className="input !py-1 !text-xs flex-1 min-w-0" value={po.type}
                            onChange={e => changerTypePoste(po.id, e.target.value as AppareillageType)}>
                            {TYPES_POSTE_PLAQUE.map(t => <option key={t} value={t}>{labelAppareillage(t)}</option>)}
                          </select>
                        </div>
                        {po.type === "prise_dediee" && (
                          <select className="input !py-1 !text-xs" value={po.usageDedie ?? USAGE_DEDIE_DEFAUT}
                            onChange={e => modifierUsageDedie(po.id, e.target.value as AppareillageType)}>
                            {TYPES_USAGE_DEDIE.map(t => <option key={t} value={t}>{LIBELLE_USAGE_DEDIE[t]}</option>)}
                          </select>
                        )}
                      </div>
                    ))}
                    {postesPlaqueSel.length === 0 && (
                      <select className="input !py-1 !text-xs" value={selectedAppareillage.type}
                        onChange={e => changerTypePoste(selectedAppareillage.id, e.target.value as AppareillageType)}>
                        {TYPES_POSTE_PLAQUE.map(t => <option key={t} value={t}>{labelAppareillage(t)}</option>)}
                      </select>
                    )}
                    <div className="flex items-center gap-1.5">
                      {Math.max(postesPlaqueSel.length, 1) < MAX_POSTES_PLAQUE && (
                        <button onClick={() => ajouterPoste(selectedAppareillage.id)} disabled={!!pieceDeSelectedAppareillage?.verrouillee}
                          className="btn-ghost !text-xs !py-1 flex-1 justify-center disabled:opacity-40">+ Ajouter un poste</button>
                      )}
                      {postesPlaqueSel.length >= 2 && (
                        <button onClick={() => removerPlaque(selectedAppareillage.groupeId!)} disabled={!!pieceDeSelectedAppareillage?.verrouillee}
                          className="btn-danger !text-xs !py-1 flex-1 justify-center disabled:opacity-40">Supprimer la plaque</button>
                      )}
                    </div>
                    {postesPlaqueSel.length >= 2 && <p className="text-ink-400">Hauteur, couleur et position sont communes à la plaque ; le bouton corbeille en haut ne retire que ce poste.</p>}
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="shrink-0 w-16">Position X/Y</span>
                  <input type="number" step="0.01" className="input !py-1 !text-xs !w-20"
                    disabled={!!pieceDeSelectedAppareillage?.verrouillee}
                    key={`${selectedAppareillage.id}-x-${dragEndTick}`}
                    defaultValue={selectedAppareillage.x.toFixed(2)}
                    onChange={e => { if (e.target.value !== "") modifierPositionExacte(selectedAppareillage.id, Number(e.target.value), selectedAppareillage.y); }} />
                  <input type="number" step="0.01" className="input !py-1 !text-xs !w-20"
                    disabled={!!pieceDeSelectedAppareillage?.verrouillee}
                    key={`${selectedAppareillage.id}-y-${dragEndTick}`}
                    defaultValue={selectedAppareillage.y.toFixed(2)}
                    onChange={e => { if (e.target.value !== "") modifierPositionExacte(selectedAppareillage.id, selectedAppareillage.x, Number(e.target.value)); }} />
                  <span className="text-ink-400">m</span>
                </div>
                {pieceDeSelectedAppareillage && (
                  <div className="flex flex-col gap-1 border-t border-ink-100 pt-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Distance à chaque mur (cm)</span>
                    <div className="flex flex-col gap-1 max-h-28 overflow-y-auto pr-1">
                      {pieceDeSelectedAppareillage.contour.map((pt, i) => {
                        const next = pieceDeSelectedAppareillage.contour[(i + 1) % pieceDeSelectedAppareillage.contour.length];
                        const d = distanceAuSegment({ x: selectedAppareillage.x, y: selectedAppareillage.y }, pt, next);
                        return (
                          <div key={i} className="flex items-center gap-2 text-xs text-ink-500">
                            <span className="w-14 shrink-0 text-ink-400 flex items-center gap-1">
                              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-ink-900 text-white text-[9px] font-bold shrink-0">{i + 1}</span>
                              Mur
                            </span>
                            <input type="number" min={0} className="input !py-0.5 !text-xs !w-20"
                              disabled={!!pieceDeSelectedAppareillage.verrouillee}
                              key={`${selectedAppareillage.id}-mur${i}-${dragEndTick}`}
                              defaultValue={Math.round(d * 100)}
                              onChange={e => {
                                if (e.target.value === "") return;
                                modifierDistanceSegment(pieceDeSelectedAppareillage, selectedAppareillage.id, i, Number(e.target.value));
                              }} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {(niveauActif?.circuitsManuels?.length ?? 0) > 0 && selectedAppareillage.type !== "rj45" && (
                  <div className="flex items-center gap-2 text-xs text-ink-500 border-t border-ink-100 pt-2">
                    <span className="shrink-0">Circuit</span>
                    <select className="input !py-1 !text-xs flex-1"
                      value={selectedAppareillage.circuitManuelId ?? ""}
                      onChange={e => assignerCircuitManuel(selectedAppareillage.id, e.target.value ? Number(e.target.value) : undefined)}>
                      <option value="">Automatique</option>
                      {(niveauActif?.circuitsManuels ?? []).map(m => <option key={m.id} value={m.id}>{m.nom}</option>)}
                    </select>
                  </div>
                )}
                {TYPES_APPAREILLAGE_COLORABLES.includes(selectedAppareillage.type) && (
                  <div className="flex flex-col gap-1.5 text-xs text-ink-500 border-t border-ink-100 pt-2">
                    <span>Couleur de la plaque (vue 3D)</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {COULEURS_APPAREILLAGE.map(c => {
                        const actif = (selectedAppareillage.couleur ?? "#ffffff").toLowerCase() === c.hex;
                        return (
                          <button key={c.hex} title={c.nom} aria-label={c.nom}
                            onClick={() => modifierCouleurAppareillage(selectedAppareillage.id, c.hex)}
                            className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                            style={{ background: c.hex, borderColor: actif ? "#F59E0B" : "#d6d3d1", boxShadow: actif ? "0 0 0 2px #FEF3C7" : undefined }} />
                        );
                      })}
                      <label className="flex items-center gap-1 cursor-pointer" title="Choisir n'importe quelle couleur">
                        <input type="color" value={selectedAppareillage.couleur ?? "#ffffff"}
                          onChange={e => modifierCouleurAppareillage(selectedAppareillage.id, e.target.value)}
                          className="w-7 h-7 p-0 border-0 bg-transparent cursor-pointer" />
                        <span>Autre…</span>
                      </label>
                    </div>
                    <button onClick={() => appliquerCouleurATousAppareillages(selectedAppareillage.couleur ?? "#ffffff")}
                      className="btn-ghost !text-xs !py-1 justify-center">
                      Appliquer cette couleur à toutes les prises et commandes
                    </button>
                  </div>
                )}
                {estCommande(selectedAppareillage.type) && (
                  <>
                    <button onClick={() => setPendingCommande({ item: selectedAppareillage, estNouveau: false })}
                      className="btn-ghost !text-xs justify-center">
                      {estCommandeDouble(selectedAppareillage.type)
                        ? `Commande : voie 1 → ${selectedAppareillage.commandePourIds?.length ?? 0} · voie 2 → ${selectedAppareillage.commandePourIds2?.length ?? 0} point(s) lumineux — modifier`
                        : `Commande : ${selectedAppareillage.commandePourIds?.length ?? 0} point(s) lumineux — modifier`}
                    </button>
                    <label className="flex items-center gap-2 text-xs text-ink-500 cursor-pointer border-t border-ink-100 pt-2">
                      <input type="checkbox" checked={selectedAppareillage.domotique ?? false}
                        onChange={e => modifierDomotique(selectedAppareillage.id, e.target.checked)} />
                      <span>📶 Domotique (liaison sans fil — tracé en onde, pas de câble physique)</span>
                    </label>
                  </>
                )}
                <label className="flex items-center gap-2 text-xs text-ink-500 cursor-pointer border-t border-ink-100 pt-2">
                  <input type="checkbox" checked={selectedAppareillage.dejaExistant ?? false}
                    onChange={e => modifierDejaExistant(selectedAppareillage.id, e.target.checked)} />
                  <span>🏚️ Déjà existant — ne pas facturer (sert quand même de point de départ pour le circuit)</span>
                </label>
                {selectedAppareillage.circuitId != null ? (
                  <p className="text-xs text-ink-400">Circuit : {resultat?.breakers.find(b => b.id === selectedAppareillage.circuitId)?.label}</p>
                ) : niveauActif?.appareillagesExclus?.includes(selectedAppareillage.id) ? (
                  <div className="flex items-center justify-between gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                    <span className="text-amber-700">Exclu de la génération automatique</span>
                    <button onClick={() => reinclureAppareillage(selectedAppareillage.id)} className="btn-ghost !text-[11px] !px-1.5 !py-0.5 shrink-0">Réinclure</button>
                  </div>
                ) : selectedAppareillage.type === "rj45" ? (
                  <p className="text-xs text-ink-400">Courant faible : câblée en étoile vers le coffret de communication — aucun circuit de puissance.</p>
                ) : resultat ? (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">Non raccordé à un circuit.</p>
                ) : null}
              </DraggablePanel>
            )}

            {selectedMeuble && mode === "select" && (
              <DraggablePanel key={`meuble-${selectedMeuble.id}-${panelResetTick}`} corner="bl" className="card card-inner !p-3 flex flex-col gap-2 shadow-lg w-72">
                <div className="flex items-center gap-2">
                  <Box size={18} className="text-ink-400 shrink-0" />
                  <input className="input !py-1 !text-sm flex-1 min-w-0" placeholder="Meuble"
                    value={selectedMeuble.nom ?? ""}
                    onChange={e => modifierMeuble(selectedMeuble.id, { nom: e.target.value })} />
                  <button onClick={() => removerMeuble(selectedMeuble.id)} className="btn-danger !px-2 !py-1.5 shrink-0"><Trash2 size={13} /></button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-ink-500">
                  <div>
                    <span className="block mb-1">Largeur (m)</span>
                    <input type="text" inputMode="decimal" className="input !py-1 !text-xs"
                      key={`${selectedMeuble.id}-largeur-${panelResetTick}`}
                      defaultValue={selectedMeuble.largeur}
                      onChange={e => {
                        const n = Number(e.target.value.replace(",", "."));
                        if (!Number.isNaN(n) && n > 0) modifierMeuble(selectedMeuble.id, { largeur: n });
                      }} />
                  </div>
                  <div>
                    <span className="block mb-1">Profondeur (m)</span>
                    <input type="text" inputMode="decimal" className="input !py-1 !text-xs"
                      key={`${selectedMeuble.id}-profondeur-${panelResetTick}`}
                      defaultValue={selectedMeuble.profondeur}
                      onChange={e => {
                        const n = Number(e.target.value.replace(",", "."));
                        if (!Number.isNaN(n) && n > 0) modifierMeuble(selectedMeuble.id, { profondeur: n });
                      }} />
                  </div>
                  <div>
                    <span className="block mb-1">Hauteur (m)</span>
                    <input type="text" inputMode="decimal" className="input !py-1 !text-xs"
                      key={`${selectedMeuble.id}-hauteur-${panelResetTick}`}
                      defaultValue={selectedMeuble.hauteur}
                      onChange={e => {
                        const n = Number(e.target.value.replace(",", "."));
                        if (!Number.isNaN(n) && n > 0) modifierMeuble(selectedMeuble.id, { hauteur: n });
                      }} />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="shrink-0 w-16">Rotation</span>
                  <input type="range" min={0} max={359} step={1} className="flex-1"
                    value={selectedMeuble.rotation ?? 0}
                    onChange={e => modifierMeuble(selectedMeuble.id, { rotation: Number(e.target.value) })} />
                  <span className="w-10 text-right font-mono">{selectedMeuble.rotation ?? 0}°</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="shrink-0">Couleur</span>
                  <input type="color" className="w-8 h-8 rounded-lg border border-ink-200 cursor-pointer"
                    value={selectedMeuble.couleur || "#A8A29E"}
                    onChange={e => modifierMeuble(selectedMeuble.id, { couleur: e.target.value })} />
                  <span className="text-ink-400">Purement visuel — vue 3D uniquement, aucun impact sur les circuits.</span>
                </div>
              </DraggablePanel>
            )}

            {selectedTableau && niveauActif?.tableauPos && mode === "select" && (
              <DraggablePanel key={`tableau-${panelResetTick}`} corner="bl" className="card card-inner !p-3 flex flex-col gap-2 shadow-lg w-64">
                <div className="flex items-center gap-2">
                  <span className="text-lg leading-none">⚡</span>
                  <p className="text-sm font-semibold text-ink-900 flex-1">Tableau électrique</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="shrink-0">Hauteur d'installation (cm)</span>
                  <input type="number" className="input !py-1 !text-xs !w-20" placeholder="150"
                    value={niveauActif.tableauHauteur ?? ""}
                    onChange={e => modifierTableauHauteur(e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="shrink-0">Orientation (°)</span>
                  <input type="number" className="input !py-1 !text-xs !w-20"
                    key={`tableau-rotation-${dragEndTick}`}
                    defaultValue={Math.round(niveauActif.tableauRotation ?? 0)}
                    onChange={e => { if (e.target.value !== "") modifierTableauRotation(Number(e.target.value)); }} />
                  <button onClick={alignerTableauSurMur} className="btn-ghost !text-[11px] !px-2 !py-1 flex-1">
                    Aligner sur le mur
                  </button>
                </div>
                <p className="text-[11px] text-ink-400">Glisse-le directement sur le plan pour le repositionner.</p>
              </DraggablePanel>
            )}

            {selectedPointArrivee && niveauActif?.pointArriveeGaines && mode === "select" && (
              <DraggablePanel key={`arrivee-${panelResetTick}`} corner="bl" className="card card-inner !p-3 flex flex-col gap-2 shadow-lg w-72">
                <div className="flex items-center gap-2">
                  <span className="text-lg leading-none">⬇</span>
                  <p className="text-sm font-semibold text-ink-900 flex-1">Point d'arrivée des gaines</p>
                  <button onClick={supprimerPointArrivee} className="btn-danger !px-2 !py-1.5 shrink-0"><Trash2 size={13} /></button>
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="shrink-0 w-16">Position X/Y</span>
                  <input type="number" step="0.01" className="input !py-1 !text-xs !w-20"
                    key={`arrivee-x-${dragEndTick}`}
                    defaultValue={niveauActif.pointArriveeGaines.x.toFixed(2)}
                    onChange={e => { if (e.target.value !== "") modifierPositionArriveeExacte(Number(e.target.value), niveauActif.pointArriveeGaines!.y); }} />
                  <input type="number" step="0.01" className="input !py-1 !text-xs !w-20"
                    key={`arrivee-y-${dragEndTick}`}
                    defaultValue={niveauActif.pointArriveeGaines.y.toFixed(2)}
                    onChange={e => { if (e.target.value !== "") modifierPositionArriveeExacte(niveauActif.pointArriveeGaines!.x, Number(e.target.value)); }} />
                  <span className="text-ink-400">m</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="shrink-0">Distance au tableau (m)</span>
                  <input type="number" min={0} step="0.1" className="input !py-1 !text-xs !w-20" placeholder="—"
                    value={niveauActif.distanceArriveeGainesTableau ?? ""}
                    onChange={e => modifierDistanceArriveeGaines(e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <p className="text-[11px] text-ink-400">Liaison verticale (gaine technique, autre niveau…) non dessinée sur le plan — distance paramétrable indépendamment sur chaque étage. Glisse le point directement sur le plan pour le repositionner.</p>
              </DraggablePanel>
            )}

            {selectedZone && !selectedZoneOuv && mode === "select" && (() => {
              const z = selectedZone;
              const surf = surfaceZone(z);
              const longueurTotale = segmentsZone(z).reduce((t, sg) => t + distance(sg.a, sg.b), 0);
              return (
                <DraggablePanel key={`zone-${z.id}-${panelResetTick}`} corner="bl" className="card card-inner !p-3 flex flex-col gap-2 shadow-lg w-72 max-h-[80vh] overflow-y-auto">
                  <div className="flex items-center gap-2">
                    <BoxSelect size={16} className="text-violet-600 shrink-0" />
                    <input className="input !py-1 !text-sm flex-1 min-w-0" placeholder={z.ferme ? "Nom de la zone (Dressing…)" : "Nom de la cloison"}
                      value={z.nom} onChange={e => majZone(z.id, zz => ({ ...zz, nom: e.target.value }))} />
                    <button onClick={() => supprimerZone(z.id)} className="btn-danger !px-2 !py-1.5 shrink-0" title="Supprimer la zone"><Trash2 size={13} /></button>
                  </div>
                  <p className="text-xs text-ink-500">
                    {surf
                      ? <>Surface utile <span className="font-semibold text-ink-900">{surf.utile.toFixed(2)} m²</span> · tracé à l&apos;axe {surf.brute.toFixed(2)} m²</>
                      : <>Cloison libre · {longueurTotale.toFixed(2)} m · pas de surface</>}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0 w-28">Épaisseur cloison (cm)</span>
                    <input type="number" min={1} max={50} className="input !py-1 !text-xs !w-20" key={`zep-${z.id}`} defaultValue={z.epaisseurCm}
                      onChange={e => { const v = parseFloat(e.target.value); if (v >= 1 && v <= 50) majZone(z.id, zz => ({ ...zz, epaisseurCm: v })); }} />
                  </div>
                  {z.ferme && (
                    <div className="flex flex-col gap-1 border-t border-ink-100 pt-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Escalier visible dans cette zone (vue 3D)</span>
                      <select className="input !py-1 !text-xs" value={z.escalierVisibleId ?? ""}
                        onChange={ev => majZone(z.id, zz => ({ ...zz, escalierVisibleId: ev.target.value === "" ? undefined : Number(ev.target.value) }))}>
                        <option value="">Aucun — zone ordinaire</option>
                        {entrantsEscalier.map(({ escalier, source }) => (
                          <option key={escalier.id} value={escalier.id}>{escalier.nom || "Escalier"} · depuis {source.nom || NIVEAU_TYPES[source.type]}</option>
                        ))}
                      </select>
                      <p className="text-[11px] text-ink-500">
                        {entrantsEscalier.length === 0
                          ? "Aucun escalier n'arrive sur ce niveau : crée-le sur le niveau de départ et choisis ce niveau comme niveau desservi."
                          : z.escalierVisibleId != null
                            ? "En 3D, le sol est ouvert dans cette zone et l'escalier n'y est visible que là (rien de plus bas). Aucune cloison. Déplace les points orange pour changer la forme."
                            : "Choisis un escalier pour ouvrir le sol en 3D dans cette zone et n'y montrer que lui."}
                      </p>
                    </div>
                  )}
                  {z.ferme && z.escalierVisibleId == null && (
                    <div className="flex flex-col gap-1 border-t border-ink-100 pt-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Côtés</span>
                      {z.cotes.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-ink-500">
                          <span className="shrink-0 w-24">Côté {i + 1} · {longueurCote(z, i).toFixed(2)} m</span>
                          <div className="flex gap-1 flex-1">
                            {(["cloison", "ouvert"] as const).map(t => (
                              <button key={t} onClick={() => majZone(z.id, zz => definirTypeCote(zz, i, t))}
                                className={`flex-1 !text-xs px-2 py-1 rounded-md border transition-colors ${c === t ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"}`}>
                                {t === "cloison" ? "Cloison" : "Ouvert"}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-ink-400">
                    Glisse la cloison (ou ses points orange) pour la déplacer · Suppr = supprimer · Pour percer une porte : outil « Porte / fenêtre », puis clic sur une cloison. Une zone n&apos;est pas une pièce : elle ne porte ni appareillage ni circuit.
                  </p>
                </DraggablePanel>
              );
            })()}

            {selectedZoneOuv && mode === "select" && (() => {
              const z = niveauActif?.zones?.find(zz => zz.id === selectedZoneOuv.zoneId);
              const o = z?.ouvertures?.find(oo => oo.id === selectedZoneOuv.ouvId);
              if (!z || !o) return null;
              const Lcm = longueurCote(z, o.segIndex) * 100;
              const majO = (patch: Partial<Ouverture>) => modifierOuvertureZone(z.id, o.id, patch);
              const segmente = (actuel: boolean, vrai: string, faux: string, onVrai: () => void, onFaux: () => void) => (
                <div className="flex gap-1 flex-1">
                  {[[true, vrai, onVrai], [false, faux, onFaux]].map(([v, lib, fn]) => (
                    <button key={String(lib)} onClick={fn as () => void}
                      className={`flex-1 !text-xs px-2 py-1 rounded-md border transition-colors ${actuel === v ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"}`}>{lib as string}</button>
                  ))}
                </div>
              );
              return (
                <DraggablePanel key={`zo-${o.id}-${panelResetTick}`} corner="bl" className="card card-inner !p-3 flex flex-col gap-2 shadow-lg w-64">
                  <div className="flex items-center gap-2">
                    <OuvertureIcon type={o.type} size={18} color="#1c1917" />
                    <p className="text-sm font-semibold text-ink-900 flex-1">{LABEL_OUVERTURE[o.type]} · {z.nom || "zone"}</p>
                    <button onClick={() => supprimerOuvertureZone(z.id, o.id)} className="btn-danger !px-2 !py-1.5 shrink-0"><Trash2 size={13} /></button>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0 w-24">Largeur (cm)</span>
                    <input type="number" min={20} className="input !py-1 !text-xs !w-20" key={`zo-${o.id}-l`} defaultValue={o.largeur}
                      onChange={e => { const v = parseFloat(e.target.value); if (v >= 20) majO({ largeur: v }); }} />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0 w-24">Depuis le début (cm)</span>
                    <input type="number" min={0} className="input !py-1 !text-xs !w-20" key={`zo-${o.id}-d-${o.largeur}`} defaultValue={Math.round(o.position * Lcm - o.largeur / 2)}
                      onChange={e => { const v = parseFloat(e.target.value); if (v >= 0) majO({ position: (v + o.largeur / 2) / Lcm }); }} />
                  </div>
                  <p className="text-[11px] text-ink-400 -mt-1">Cloison de {(Lcm / 100).toFixed(2)} m : la porte reste entièrement dans la cloison.</p>
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0 w-24">Hauteur (cm)</span>
                    <input type="number" min={30} className="input !py-1 !text-xs !w-20" key={`zo-${o.id}-h`} defaultValue={o.hauteur ?? hauteurOuvertureDefautCm(o.type)}
                      onChange={e => { const v = parseFloat(e.target.value); if (v >= 30) majO({ hauteur: v }); }} />
                  </div>
                  {o.type === "porte" && (
                    <>
                      <div className="flex items-center gap-2 text-xs text-ink-500">
                        <span className="shrink-0 w-24">Charnière</span>
                        {segmente((o.charniere ?? "gauche") === "gauche", "Gauche", "Droite", () => majO({ charniere: "gauche" }), () => majO({ charniere: "droite" }))}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-ink-500">
                        <span className="shrink-0 w-24">Ouvre vers</span>
                        {segmente(o.ouvreVersInterieur !== false, "Côté A", "Côté B", () => majO({ ouvreVersInterieur: true }), () => majO({ ouvreVersInterieur: false }))}
                      </div>
                    </>
                  )}
                  {o.type === "porte_coulissante" && (
                    <>
                      <div className="flex items-center gap-2 text-xs text-ink-500">
                        <span className="shrink-0 w-24">Montage</span>
                        {segmente(o.montage !== "galandage", "Sur rail", "Galandage", () => majO({ montage: "applique" }), () => majO({ montage: "galandage" }))}
                      </div>
                      {o.montage === "galandage" && <p className="text-[11px] text-ink-500 -mt-1">Le vantail coulisse dans l&apos;épaisseur de la cloison (≈ 9 cm minimum) : prévois {o.largeur} cm de cloison pleine de son côté.</p>}
                    </>
                  )}
                  {o.type === "baie_vitree" && (
                    <div className="flex items-center gap-2 text-xs text-ink-500">
                      <span className="shrink-0 w-24">Vantaux</span>
                      <div className="flex gap-1 flex-1">
                        {Array.from({ length: NB_VANTAUX_BAIE_MAX }, (_, k) => k + 1).map(k => (
                          <button key={k} onClick={() => majO({ nbVantaux: k })}
                            className={`flex-1 !text-xs px-2 py-1 rounded-md border transition-colors ${
                              nbVantauxBaie(o) === k ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"
                            }`}>{k}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {(o.type === "porte_coulissante" || o.type === "baie_vitree") && (
                    <div className="flex items-center gap-2 text-xs text-ink-500">
                      <span className="shrink-0 w-24">Glisse vers</span>
                      {segmente((o.coulisseVers ?? "droite") === "gauche", "Gauche", "Droite", () => majO({ coulisseVers: "gauche" }), () => majO({ coulisseVers: "droite" }))}
                    </div>
                  )}
                  <button onClick={() => setSelectedZoneOuv(null)} className="text-[11px] text-volt-600 underline self-start">Retour à la zone</button>
                </DraggablePanel>
              );
            })()}

            {selectedOuvertureId != null && mode === "select" && (() => {
              const piece = niveauActif?.pieces.find(p => p.ouvertures?.some(o => o.id === selectedOuvertureId));
              const o = piece?.ouvertures?.find(o => o.id === selectedOuvertureId);
              if (!piece || !o) return null;
              return (
                <DraggablePanel key={`${o.id}-${panelResetTick}`} corner="bl" className="card card-inner !p-3 flex flex-col gap-2 shadow-lg w-64">
                  <div className="flex items-center gap-2">
                    <OuvertureIcon type={o.type} size={18} color="#1c1917" />
                    <p className="text-sm font-semibold text-ink-900 flex-1">{o.type === "porte" ? LABEL_USAGE_PORTE[o.usage ?? "interieure"] : LABEL_OUVERTURE[o.type]}</p>
                    <button onClick={() => supprimerOuverture(o.id)} className="btn-danger !px-2 !py-1.5 shrink-0"><Trash2 size={13} /></button>
                  </div>
                  {o.type === "porte" && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Type de porte</span>
                      <div className="flex gap-1">
                        {USAGES_PORTE.map(u => (
                          <button key={u} onClick={() => modifierOuverture(o.id, { usage: u })}
                            className={`flex-1 !text-xs px-1.5 py-1 rounded-md border transition-colors ${
                              (o.usage ?? "interieure") === u ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"
                            }`}>
                            {u === "interieure" ? "Intérieure" : u === "entree" ? "Entrée" : "Service"}
                          </button>
                        ))}
                      </div>
                      <span className="text-[11px] text-ink-400">{u_aide(o.usage ?? "interieure")}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0 w-24">Largeur (cm)</span>
                    <input type="number" min={20} className="input !py-1 !text-xs !w-20"
                      key={`ouv-${o.id}-largeur-${dragEndTick}`} defaultValue={o.largeur}
                      onChange={e => { if (e.target.value !== "") modifierOuverture(o.id, { largeur: Number(e.target.value) }); }} />
                  </div>
                  {(() => {
                    const a = piece.contour[o.segIndex], b = piece.contour[(o.segIndex + 1) % piece.contour.length];
                    const longueurCm = distance(a, b) * 100;
                    const distA = o.position * longueurCm - o.largeur / 2;
                    const distB = longueurCm - o.position * longueurCm - o.largeur / 2;
                    return (
                      <div className="flex flex-col gap-1 border-t border-ink-100 pt-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Distance exacte au mur (cm)</span>
                        <div className="flex items-center gap-2 text-xs text-ink-500">
                          <span className="shrink-0 w-24">Depuis mur début</span>
                          <input type="number" min={0} className="input !py-1 !text-xs !w-20"
                            disabled={!!piece.verrouillee}
                            key={`ouv-${o.id}-distA-${dragEndTick}`} defaultValue={Math.round(distA)}
                            onChange={e => { if (e.target.value !== "") modifierDistanceBordOuverture(piece, o, "A", Number(e.target.value)); }} />
                        </div>
                        <div className="flex items-center gap-2 text-xs text-ink-500">
                          <span className="shrink-0 w-24">Depuis mur fin</span>
                          <input type="number" min={0} className="input !py-1 !text-xs !w-20"
                            disabled={!!piece.verrouillee}
                            key={`ouv-${o.id}-distB-${dragEndTick}`} defaultValue={Math.round(distB)}
                            onChange={e => { if (e.target.value !== "") modifierDistanceBordOuverture(piece, o, "B", Number(e.target.value)); }} />
                        </div>
                      </div>
                    );
                  })()}
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0 w-24">Hauteur (cm)</span>
                    <input type="number" min={30} className="input !py-1 !text-xs !w-20"
                      key={`ouv-${o.id}-hauteur-${dragEndTick}`} defaultValue={o.hauteur ?? hauteurOuvertureDefautCm(o.type)}
                      onChange={e => { if (e.target.value !== "") modifierOuverture(o.id, { hauteur: Number(e.target.value) }); }} />
                  </div>
                  {(o.type === "fenetre" || o.type === "baie_vitree" || o.type === "ouverture") && (
                    <div className="flex items-center gap-2 text-xs text-ink-500">
                      <span className="shrink-0 w-24">{o.type === "ouverture" ? "Départ / sol (cm)" : "Allège (cm)"}</span>
                      <input type="number" min={0} className="input !py-1 !text-xs !w-20"
                        key={`ouv-${o.id}-allege-${dragEndTick}`} defaultValue={o.allege ?? (o.type === "fenetre" ? 90 : 0)}
                        onChange={e => { if (e.target.value !== "") modifierOuverture(o.id, { allege: Number(e.target.value) }); }} />
                    </div>
                  )}
                  {o.type === "fenetre" && (() => {
                    const nb = battantsFenetre(o);
                    const bouton = (actif: boolean, label: string, onClick: () => void) => (
                      <button onClick={onClick}
                        className={`flex-1 !text-xs px-2 py-1 rounded-md border transition-colors ${
                          actif ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"
                        }`}>
                        {label}
                      </button>
                    );
                    return (
                      <>
                        <div className="flex items-center gap-2 text-xs text-ink-500">
                          <span className="shrink-0 w-24">Battants</span>
                          <div className="flex gap-1 flex-1">
                            {bouton(nb === 0, "Fixe", () => modifierOuverture(o.id, { battants: 0 }))}
                            {bouton(nb === 1, "Simple", () => modifierOuverture(o.id, { battants: 1 }))}
                            {bouton(nb === 2, "Double", () => modifierOuverture(o.id, { battants: 2 }))}
                          </div>
                        </div>
                        {nb === 1 && (
                          <div className="flex items-center gap-2 text-xs text-ink-500">
                            <span className="shrink-0 w-24">Charnière</span>
                            <div className="flex gap-1 flex-1">
                              {bouton((o.charniere ?? "gauche") === "gauche", "Gauche", () => modifierOuverture(o.id, { charniere: "gauche" }))}
                              {bouton(o.charniere === "droite", "Droite", () => modifierOuverture(o.id, { charniere: "droite" }))}
                            </div>
                          </div>
                        )}
                        {nb > 0 && (
                          <div className="flex items-center gap-2 text-xs text-ink-500">
                            <span className="shrink-0 w-24">Ouvre vers</span>
                            <div className="flex gap-1 flex-1">
                              {bouton(o.ouvreVersInterieur !== false, "Intérieur", () => modifierOuverture(o.id, { ouvreVersInterieur: true }))}
                              {bouton(o.ouvreVersInterieur === false, "Extérieur", () => modifierOuverture(o.id, { ouvreVersInterieur: false }))}
                            </div>
                          </div>
                        )}
                        {nb > 0 && <p className="text-[11px] text-ink-400">S'ouvre en 3D en cliquant dessus ou depuis « Ouvrants ».</p>}
                      </>
                    );
                  })()}
                  {o.type === "porte" && (
                    <>
                      <div className="flex items-center gap-2 text-xs text-ink-500">
                        <span className="shrink-0 w-24">Charnière</span>
                        <div className="flex gap-1 flex-1">
                          {(["gauche", "droite"] as const).map(c => (
                            <button key={c} onClick={() => modifierOuverture(o.id, { charniere: c })}
                              className={`flex-1 !text-xs px-2 py-1 rounded-md border transition-colors ${
                                (o.charniere ?? "gauche") === c ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"
                              }`}>
                              {c === "gauche" ? "Gauche" : "Droite"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-ink-500">
                        <span className="shrink-0 w-24">Ouvre vers</span>
                        <div className="flex gap-1 flex-1">
                          <button onClick={() => modifierOuverture(o.id, { ouvreVersInterieur: true })}
                            className={`flex-1 !text-xs px-2 py-1 rounded-md border transition-colors ${
                              o.ouvreVersInterieur !== false ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"
                            }`}>
                            Intérieur
                          </button>
                          <button onClick={() => modifierOuverture(o.id, { ouvreVersInterieur: false })}
                            className={`flex-1 !text-xs px-2 py-1 rounded-md border transition-colors ${
                              o.ouvreVersInterieur === false ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"
                            }`}>
                            Extérieur
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                  {o.type === "porte_coulissante" && (() => {
                    const galandage = o.montage === "galandage";
                    const aP = piece.contour[o.segIndex], bP = piece.contour[(o.segIndex + 1) % piece.contour.length];
                    const Lcm = distance(aP, bP) * 100;
                    const placeCm = (o.coulisseVers ?? "droite") === "droite" ? Lcm - o.position * Lcm - o.largeur / 2 : o.position * Lcm - o.largeur / 2;
                    const epCm = epaisseurTotaleM(piece, o.segIndex) * 100;
                    return (
                      <>
                        <div className="flex items-center gap-2 text-xs text-ink-500">
                          <span className="shrink-0 w-24">Montage</span>
                          <div className="flex gap-1 flex-1">
                            {([["applique", "Sur rail"], ["galandage", "Galandage"]] as const).map(([k, lib]) => (
                              <button key={k} onClick={() => modifierOuverture(o.id, { montage: k })}
                                className={`flex-1 !text-xs px-2 py-1 rounded-md border transition-colors ${
                                  (galandage ? "galandage" : "applique") === k ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"
                                }`}>{lib}</button>
                            ))}
                          </div>
                        </div>
                        {galandage && (
                          <div className="text-[11px] text-ink-500 flex flex-col gap-0.5">
                            <span>Le vantail coulisse dans l&apos;épaisseur du mur : il disparaît entièrement à l&apos;ouverture.</span>
                            {placeCm < o.largeur + 2 && <span className="text-amber-700">⚠ Pas assez de mur de ce côté pour loger le vantail : {Math.round(placeCm)} cm disponibles, {o.largeur} cm nécessaires.</span>}
                            {epCm < 9 && <span className="text-amber-700">⚠ Mur de {Math.round(epCm)} cm : trop mince pour un galandage (≈ 9 cm minimum).</span>}
                          </div>
                        )}
                      </>
                    );
                  })()}
                  {o.type === "baie_vitree" && (() => {
                    const nbV = nbVantauxBaie(o);
                    return (
                      <>
                        <div className="flex items-center gap-2 text-xs text-ink-500">
                          <span className="shrink-0 w-24">Vantaux</span>
                          <div className="flex gap-1 flex-1">
                            {Array.from({ length: NB_VANTAUX_BAIE_MAX }, (_, k) => k + 1).map(k => (
                              <button key={k} onClick={() => modifierOuverture(o.id, { nbVantaux: k })}
                                className={`flex-1 !text-xs px-2 py-1 rounded-md border transition-colors ${
                                  nbV === k ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"
                                }`}>{k}</button>
                            ))}
                          </div>
                        </div>
                        <p className="text-[11px] text-ink-500 -mt-1">
                          {nbV} vantail{nbV > 1 ? "x" : ""} de {largeurVantailBaieCm(o.largeur, nbV).toFixed(1)} cm (recouvrement {RECOUVREMENT_VANTAUX_CM} cm), tous mobiles : en 3D, clique un vantail ou utilise « Ouvrants ».
                        </p>
                      </>
                    );
                  })()}
                  {(o.type === "porte_coulissante" || o.type === "baie_vitree") && (
                    <div className="flex items-center gap-2 text-xs text-ink-500">
                      <span className="shrink-0 w-24">Glisse vers</span>
                      <div className="flex gap-1 flex-1">
                        {(["gauche", "droite"] as const).map(c => (
                          <button key={c} onClick={() => modifierOuverture(o.id, { coulisseVers: c })}
                            className={`flex-1 !text-xs px-2 py-1 rounded-md border transition-colors ${
                              (o.coulisseVers ?? "droite") === c ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"
                            }`}>
                            {c === "gauche" ? "Gauche" : "Droite"}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-[11px] text-ink-400">Glisse-la directement sur le mur pour la repositionner — elle reste sur ce mur.</p>
                </DraggablePanel>
              );
            })()}

            {selectedWaypoint && niveauActif && mode === "select" && (() => {
              const wp = niveauActif.liaisonWaypoints?.[selectedWaypoint.cle]?.find(w => w.id === selectedWaypoint.waypointId);
              if (!wp) return null;
              return (
                <DraggablePanel key={`${selectedWaypoint.cle}-${selectedWaypoint.waypointId}-${panelResetTick}`} corner="bl" className="card card-inner !p-3 flex flex-col gap-2 shadow-lg w-64">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-500 shrink-0">Coude — hauteur (cm)</span>
                    <input type="number" className="input !py-1 !text-xs !w-20" placeholder="—"
                      value={wp.hauteur ?? ""}
                      onChange={e => modifierHauteurWaypoint(selectedWaypoint.cle, selectedWaypoint.waypointId, e.target.value ? Number(e.target.value) : undefined)} />
                    <button onClick={() => supprimerWaypoint(selectedWaypoint.cle, selectedWaypoint.waypointId)} className="btn-danger !px-2 !py-1.5 shrink-0"><Trash2 size={13} /></button>
                  </div>
                  {(() => {
                    const coudes = niveauActif.liaisonWaypoints?.[selectedWaypoint.cle] ?? [];
                    const rang = coudes.findIndex(w => w.id === selectedWaypoint.waypointId);
                    const poses = posesTroncons(niveauActif, selectedWaypoint.cle, coudes);
                    return (
                      <>
                        {([["Section avant", rang], ["Section après", rang + 1]] as [string, number][]).map(([lib, idx]) => (
                          <div key={lib} className="flex items-center gap-2 text-xs text-ink-500">
                            <span className="shrink-0 w-20">{lib}</span>
                            <ChampHauteurTroncon cle={`${selectedWaypoint.cle}-${idx}`} valeur={hauteursTroncons(niveauActif, selectedWaypoint.cle, coudes)[idx]}
                              onChange={v => modifierHauteurTroncon(selectedWaypoint.cle, idx, v)} />
                            <div className="flex gap-1 flex-1">
                              {(["encastre", "apparent"] as const).map(pose => (
                                <button key={pose} onClick={() => modifierPoseTroncon(selectedWaypoint.cle, idx, pose)}
                                  className={`flex-1 !text-xs px-2 py-1 rounded-md border transition-colors ${
                                    poses[idx] === pose ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"
                                  }`}>
                                  {pose === "encastre" ? "Encastré" : "Apparent"}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                        <p className="text-[10px] text-ink-400">Pour chaque section : hauteur (cm, vide = auto) puis pose. Apparent = le câble sort du mur : moulure au pré-devis. Un circuit peut être encastré sur une partie et apparent sur une autre.</p>
                      </>
                    );
                  })()}
                </DraggablePanel>
              );
            })()}

            {selectedTroncon && niveauActif && mode === "select" && (() => {
              const coudes = niveauActif.liaisonWaypoints?.[selectedTroncon.cle] ?? [];
              const poses = posesTroncons(niveauActif, selectedTroncon.cle, coudes);
              if (selectedTroncon.index >= poses.length) return null;
              return (
                <DraggablePanel key={`troncon-${selectedTroncon.cle}-${selectedTroncon.index}-${panelResetTick}`} corner="bl" className="card card-inner !p-3 flex flex-col gap-2 shadow-lg w-64">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-700 font-semibold flex-1">Section {selectedTroncon.index + 1} / {poses.length} du circuit</span>
                    <button onClick={() => setSelectedTroncon(null)} className="btn-ghost !px-1.5 !py-1"><X size={13} /></button>
                  </div>
                  <div className="flex gap-1">
                    {(["encastre", "apparent"] as const).map(pose => (
                      <button key={pose} onClick={() => modifierPoseTroncon(selectedTroncon.cle, selectedTroncon.index, pose)}
                        className={`flex-1 !text-xs px-2 py-1 rounded-md border transition-colors ${
                          poses[selectedTroncon.index] === pose ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"
                        }`}>
                        {pose === "encastre" ? "Encastré" : "Apparent"}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0">Hauteur (cm)</span>
                    <ChampHauteurTroncon cle={`${selectedTroncon.cle}-${selectedTroncon.index}`} valeur={hauteursTroncons(niveauActif, selectedTroncon.cle, coudes)[selectedTroncon.index]}
                      onChange={v => modifierHauteurTroncon(selectedTroncon.cle, selectedTroncon.index, v)} />
                  </div>
                  <p className="text-[10px] text-ink-400">Encastré : dans la couche 2 du mur (gaine). Apparent : le câble sort du mur, sous moulure. Hauteur : le câble court à plat à cette hauteur (vide = hauteur de gaine par défaut, sous plafond). Tire sur le tracé pour le déformer.</p>
                </DraggablePanel>
              );
            })()}

            {selectedBoite && niveauActif && mode === "select" && (() => {
              const boite = niveauActif.boitesDerivation?.[selectedBoite.label]?.find(b => b.id === selectedBoite.boiteId);
              if (!boite) return null;
              return (
                <DraggablePanel key={`${selectedBoite.label}-${selectedBoite.boiteId}-${panelResetTick}`} corner="bl" className="card card-inner !p-3 flex flex-col gap-2 shadow-lg w-64">
                  <div className="flex items-center gap-2">
                    <span className="text-lg leading-none">🔀</span>
                    <input className="input !py-1 !text-sm flex-1 min-w-0" placeholder="Boîte de dérivation"
                      value={boite.nom}
                      onChange={e => renommerBoiteDerivation(selectedBoite.label, selectedBoite.boiteId, e.target.value)} />
                    <button onClick={() => supprimerBoiteDerivation(selectedBoite.label, selectedBoite.boiteId)} className="btn-danger !px-2 !py-1.5 shrink-0"><Trash2 size={13} /></button>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0 w-16">Position X/Y</span>
                    <input type="number" step="0.01" className="input !py-1 !text-xs !w-20"
                      key={`${selectedBoite.boiteId}-x-${dragEndTick}`}
                      defaultValue={boite.point.x.toFixed(2)}
                      onChange={e => { if (e.target.value !== "") modifierPositionBoite(selectedBoite.label, selectedBoite.boiteId, Number(e.target.value), boite.point.y); }} />
                    <input type="number" step="0.01" className="input !py-1 !text-xs !w-20"
                      key={`${selectedBoite.boiteId}-y-${dragEndTick}`}
                      defaultValue={boite.point.y.toFixed(2)}
                      onChange={e => { if (e.target.value !== "") modifierPositionBoite(selectedBoite.label, selectedBoite.boiteId, boite.point.x, Number(e.target.value)); }} />
                    <span className="text-ink-400">m</span>
                  </div>
                  <p className="text-[11px] text-ink-400">Glisse-la directement sur le plan pour la repositionner.</p>
                </DraggablePanel>
              );
            })()}

            {circuitsManuelsOpen && niveauActif && (
              <DraggablePanel corner="tr" className="card card-inner !p-3 flex flex-col gap-2 shadow-lg w-80 max-h-[70vh] overflow-y-auto">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink-900">Circuits manuels — {niveauActif.nom || NIVEAU_TYPES[niveauActif.type]}</p>
                  <button onClick={() => setCircuitsManuelsOpen(false)} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={14} /></button>
                </div>
                <p className="text-[11px] text-ink-400">
                  Crée un circuit de n'importe quel type (prises, éclairage, chauffage, appareil dédié…) et choisis toi-même ses appareillages — prioritaire sur la génération automatique. Clique sur un circuit existant pour le modifier.
                </p>
                <button onClick={ouvrirNouveauCircuitManuel} className="btn-volt !text-xs justify-center"><Plus size={13} /> Nouveau circuit manuel</button>
                <div className="flex flex-col gap-1 pt-1">
                  {(niveauActif.circuitsManuels ?? []).length === 0 && (
                    <p className="text-[11px] text-ink-300 italic">Aucun circuit manuel sur ce niveau</p>
                  )}
                  {(niveauActif.circuitsManuels ?? []).map(m => {
                    const nbMembres = niveauActif.pieces.flatMap(p => p.appareillages).filter(a => a.circuitManuelId === m.id).length;
                    const spec = CIRCUITS[m.famille] ?? CIRCUITS.autre;
                    return (
                      <button key={m.id} onClick={() => ouvrirEditionCircuitManuel(m)}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-ink-200 hover:border-ink-400 text-left">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: m.couleur ?? "#78716c" }} />
                        <span className="text-xs text-ink-700 truncate flex-1">{m.nom}</span>
                        {m.nonRelieTableau && <span className="text-[9px] text-sky-600 shrink-0 whitespace-nowrap" title="Circuit déjà existant, non relié au tableau">🔗✕</span>}
                        <span className="text-[10px] text-ink-400 shrink-0">{spec.icon} {nbMembres}</span>
                      </button>
                    );
                  })}
                </div>
              </DraggablePanel>
            )}

            {placementError && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-500 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-lg">
                {placementError}
              </div>
            )}

            {placementType && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-ink-900 text-volt-400 text-xs font-semibold px-3 py-2 rounded-lg shadow-lg">
                Clique dans une pièce pour placer : {plaquePostes ? `plaque ${plaquePostes.length} postes (${plaquePostes.map(po => labelAppareillagePlace(po)).join(" + ")})` : labelAppareillage(placementType)}
              </div>
            )}
            {placingTableau && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-ink-900 text-volt-400 text-xs font-semibold px-3 py-2 rounded-lg shadow-lg">
                Clique pour positionner le tableau électrique
              </div>
            )}
            {placingMeuble && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-ink-900 text-volt-400 text-xs font-semibold px-3 py-2 rounded-lg shadow-lg">
                Clique dans une pièce pour placer un meuble — reste armé pour en poser plusieurs
              </div>
            )}
            {placingPointArrivee && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-ink-900 text-volt-400 text-xs font-semibold px-3 py-2 rounded-lg shadow-lg">
                Clique pour positionner le point d'arrivée des gaines
              </div>
            )}
            {cheminementDessin && (
              <DraggablePanel corner="tc" dark
                className="bg-ink-900 text-volt-400 text-xs font-semibold p-3 rounded-lg shadow-lg flex items-center gap-3 flex-wrap justify-center max-w-[92vw]">
                <span>Cheminement « {nomAffiche(cheminementDessin.breaker)} » : clique ses appareillages dans l'ordre voulu ({cheminementDessin.ordre.length} placé{cheminementDessin.ordre.length > 1 ? "s" : ""})</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={terminerDessinCheminement} className="btn-volt !text-[11px] !px-2 !py-1"><Save size={11} /> Terminer</button>
                  <button onClick={reinitialiserDessinCheminement} className="btn-ghost !text-[11px] !px-2 !py-1 !text-white !border-white/30">Auto</button>
                  <button onClick={annulerDessinCheminement} className="btn-ghost !text-[11px] !px-2 !py-1 !text-white !border-white/30">Annuler</button>
                </div>
              </DraggablePanel>
            )}

            {liaisonLumiereMode && (
              <DraggablePanel corner="tc" dark
                className="bg-ink-900 text-volt-400 text-xs font-semibold p-3 rounded-lg shadow-lg flex items-center gap-3 flex-wrap justify-center max-w-[92vw]">
                <span>
                  Liaison directe « {liaisonLumiereMode.label} » : clique deux points lumineux pour les relier sans boîte — re-clique la même paire pour délier
                  {liaisonLumiereMode.premierId != null ? " · 1er point choisi, clique le second" : ""}
                </span>
                <button onClick={annulerLiaisonLumiere} className="btn-volt !text-[11px] !px-2 !py-1"><Save size={11} /> Terminer</button>
              </DraggablePanel>
            )}

            {circuitsAffiches.length > 0 && (
              <DraggablePanel corner="br" className="card card-inner !p-3 max-w-[260px] max-h-56 overflow-y-auto shadow-lg">
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide">Circuits</p>
                  {circuitsNiveauActif.length > 0 && (
                    <button className="text-[10px] text-volt-600 font-semibold shrink-0"
                      onClick={() => {
                        const idsNiveau = circuitsNiveauActif.map(b => b.id);
                        const tousVisibles = idsNiveau.every(id => circuitsVisibles.has(id));
                        setCircuitsVisibles(prev => {
                          const next = new Set(prev);
                          idsNiveau.forEach(id => (tousVisibles ? next.delete(id) : next.add(id)));
                          return next;
                        });
                      }}>
                      {circuitsNiveauActif.every(b => circuitsVisibles.has(b.id)) ? "Tout masquer" : "Tout afficher"}
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  {circuitsAffiches.map(item => {
                    const b = item.breaker;
                    const manuel = item.manuel;
                    const circuitEclairage = b ? CIRCUITS[b.circuit]?.category === "lumiere" : manuel?.famille === "lumiere";
                    const labelStockage = b ? b.label : manuel!.nom; // clé pour boitesDerivation
                    const nomAffichage = b ? nomAffiche(b) : manuel!.nom;
                    const couleur = b ? (colorMap.get(b.id) ?? "#666666") : (manuel!.couleur ?? "#78716c");
                    const visible = b ? circuitsVisibles.has(b.id) : true;
                    const pointsCircuit = b ? (niveauActif?.pieces.flatMap(p => p.appareillages).filter(a => a.circuitId === b.id) ?? []) : [];
                    // Longueur RÉELLE : horizontale + montées / descentes (même tracé que la vue 3D et le pré-devis).
                    const lgDetail = b && showLongueurs && niveauActif && origineCircuits(niveauActif) && pointsCircuit.length > 0
                      ? longueurCircuit(creerContexteLongueurs(niveauActif), b, pointsCircuit, origineCircuits(niveauActif)!)
                      : null;
                    const lg = lgDetail ? lgDetail.totale : null;
                    return (
                      <label key={item.key} className={`flex items-center gap-1.5 text-[11px] cursor-pointer ${visible ? "text-ink-600" : "text-ink-300"}`}>
                        {b ? (
                          <input type="checkbox" checked={visible} onChange={() => toggleCircuitVisible(b.id)}
                            title={visible ? "Masquer ce circuit" : "Afficher ce circuit"} />
                        ) : (
                          <span className="w-[13px] shrink-0" />
                        )}
                        <input type="color" title="Choisir la couleur de ce circuit"
                          className="w-4 h-4 shrink-0 rounded-full border-0 p-0 cursor-pointer overflow-hidden"
                          value={couleur}
                          onClick={e => e.stopPropagation()}
                          onChange={e => b ? definirCouleurCircuit(b, e.target.value) : changerCouleurCircuitManuelDirect(manuel!.id, e.target.value)} />
                        <input className="input !text-[11px] !py-0.5 !px-1.5 flex-1 min-w-0" value={nomAffichage}
                          onClick={e => e.stopPropagation()}
                          onChange={e => b ? renommerCircuit(b, e.target.value) : renommerCircuitManuelDirect(manuel!.id, e.target.value)} />
                        {lg !== null && <span className="font-mono text-ink-400 shrink-0" title={lgDetail ? `${lgDetail.horizontale.toFixed(2)} m à l'horizontale + ${lgDetail.verticale.toFixed(2)} m de montées / descentes` : undefined}>{lg.toFixed(1)}m</span>}
                        {!b && <span className="text-[9px] text-ink-400 shrink-0 italic whitespace-nowrap">à générer</span>}
                        {manuel?.nonRelieTableau && <span className="text-[9px] text-sky-600 shrink-0" title="Circuit déjà existant, non relié au tableau">🔗✕</span>}
                        {b && CIRCUITS[b.circuit]?.category !== "lumiere" && (
                          <button onClick={e => { e.preventDefault(); e.stopPropagation(); demarrerDessinCheminement(b); }}
                            className="btn-ghost !p-0.5 shrink-0" title="Dessiner le cheminement">
                            <Route size={12} />
                          </button>
                        )}
                        {circuitEclairage && (
                          <>
                            <button onClick={e => { e.preventDefault(); e.stopPropagation(); ajouterBoiteDerivation(labelStockage); }}
                              className="btn-ghost !p-0.5 shrink-0" title="Ajouter une boîte de dérivation">
                              <Plus size={12} />
                            </button>
                            <button onClick={e => { e.preventDefault(); e.stopPropagation(); demarrerLiaisonDirecteLumiere(labelStockage); }}
                              className="btn-ghost !p-0.5 shrink-0" title="Lier des points lumineux directement, sans boîte">
                              <Link2 size={12} />
                            </button>
                          </>
                        )}
                        <button onClick={e => { e.preventDefault(); e.stopPropagation(); b ? supprimerCircuit(b) : supprimerCircuitManuel(manuel!.id); }}
                          className="btn-ghost !p-0.5 shrink-0 !text-red-500" title="Supprimer ce circuit">
                          <Trash2 size={12} />
                        </button>
                      </label>
                    );
                  })}
                </div>
              </DraggablePanel>
            )}

            {niveauActif && niveauActif.pieces.length === 0 && mode === "select" && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-ink-300 text-sm">Clique sur "Dessiner une pièce" pour commencer</p>
              </div>
            )}
              </>
            )}
          </div>

          {!vue3D && (paletteReduite ? (
          <div className="hidden lg:flex lg:flex-col items-center w-9 border-l border-ink-200 bg-white shrink-0 py-2 gap-2">
            <button onClick={() => setPaletteReduite(false)} className="btn-ghost !px-1.5 !py-1.5" title="Déplier la palette d'appareillages"><ChevronLeft size={15} /></button>
            <span className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide" style={{ writingMode: "vertical-rl" }}>Appareillages</span>
          </div>
          ) : (
          <div className="hidden lg:flex lg:flex-col w-56 border-l border-ink-200 bg-white overflow-y-auto shrink-0 p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide">Appareillages</p>
              <button onClick={() => setPaletteReduite(true)} className="btn-ghost !px-1.5 !py-1" title="Replier la palette (plus de place pour le plan)"><ChevronRight size={14} /></button>
            </div>
            <PaletteBoutons placementType={placementType} onSelect={armerPlacement} plaquePostes={plaquePostes} onPlaque={() => setPlaqueFormOuvert(true)} />
          </div>
          ))}

          {!vue3D && paletteOpen && (
            <div className="lg:hidden fixed inset-0 z-40 flex justify-end" onClick={() => setPaletteOpen(false)}>
              <div className="absolute inset-0 bg-black/40" />
              <div className="relative w-72 max-w-[85vw] bg-white h-full overflow-y-auto p-3 shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide">Appareillages</p>
                  <button onClick={() => setPaletteOpen(false)} className="btn-ghost !px-2 !py-1"><X size={16} /></button>
                </div>
                <PaletteBoutons placementType={placementType} onSelect={t => { armerPlacement(t); setPaletteOpen(false); }} plaquePostes={plaquePostes} onPlaque={() => { setPlaqueFormOuvert(true); setPaletteOpen(false); }} />
              </div>
            </div>
          )}
        </div>

        <div className={`px-4 py-1.5 bg-ink-50 border-t border-ink-100 text-[11px] text-ink-400 ${modeFocus ? "hidden" : "hidden md:block"} shrink-0`}>
          {vue3D
            ? "Glisser = tourner la caméra · Clic droit (ou Maj + glisser) = déplacer la vue · Molette = zoom"
            : "Molette = zoom · Glisser le fond = déplacer la vue · En dessin : clic = ajouter un point, clic près du 1er point = fermer la pièce · Cloison : clic sur un mur, angles, clic sur un mur · Zone : clic = sommets, clic sur le 1er point = fermer · Pièce sélectionnée : double-clic sur un sommet (rond orange) pour le supprimer (min. 3 sommets) · Tracé de circuit : clic = ajouter un point, Maj + clic = choisir une section (encastré / apparent)"}
        </div>
      </div>

      {zoneEnAttente && niveauActif && (
        <ZoneForm contour={zoneEnAttente.contour} ferme={zoneEnAttente.ferme} pieces={niveauActif.pieces}
          onValidate={validerNouvelleZone} onCancel={() => setZoneEnAttente(null)} />
      )}

      {cloisonEnAttente && niveauActif && (() => {
        const pieceCloison = niveauActif.pieces.find(pc => pc.id === cloisonEnAttente.pieceId);
        if (!pieceCloison) return null;
        return (
          <CloisonForm piece={pieceCloison} pieces={niveauActif.pieces} chemin={cloisonEnAttente.chemin}
            onValidate={validerCloison} onCancel={() => setCloisonEnAttente(null)} />
        );
      })()}

      {pendingContour && (
        <PieceForm
          initialNom="" initialType="autre" initialContour={pendingContour} initialMurs={pendingContour.map(() => ({ ...MUR_DEFAUT }))} mitoyens={pendingContour.map(() => false)}
          onValidate={(nom, type, hauteurPlafond, contour, murs) => {
            // Dimensions affinables au cm dès la création (le tracé reste calé sur 10 cm) ; murs paramétrables.
            const nouvelle = nouvellePiece(contour, nom, type);
            nouvelle.hauteurPlafond = hauteurPlafond;
            updateNiveauActif(n => ({ ...n, pieces: appliquerMurs([...n.pieces, nouvelle], nouvelle.id, murs) }));
            setPendingContour(null);
            invalidateResultat();
          }}
          onCancel={() => setPendingContour(null)}
        />
      )}

      {editingPiece && (
        <PieceForm
          initialNom={editingPiece.nom} initialType={editingPiece.type} initialHauteurPlafond={editingPiece.hauteurPlafond}
          initialContour={editingPiece.contour} initialMurs={mursDe(editingPiece)} mitoyens={mitoyensDe(editingPiece)} verrouillee={editingPiece.verrouillee}
          onValidate={(nom, type, hauteurPlafond, contour, murs) => {
            // Si les dimensions ont changé : les appareillages posés au mur suivent leur mur, et le
            // résultat de génération (longueurs de câbles, quantités…) n'est plus à jour.
            const dimensionsModifiees = contour !== editingPiece.contour;
            const mursModifies = JSON.stringify(murs) !== JSON.stringify(mursDe(editingPiece));
            updateNiveauActif(n => {
              const pieces = n.pieces.map(p => p.id !== editingPiece.id ? p : {
                ...p, nom, type, hauteurPlafond,
                ...(dimensionsModifiees ? { contour, appareillages: reporterAppareillages(p.contour, contour, p.appareillages) } : {}),
              });
              // Épaisseur de structure reportée sur les côtés mitoyens voisins ; les pièces voisines ne se déforment jamais.
              const avecMurs = mursModifies ? appliquerMurs(pieces, editingPiece.id, murs) : pieces;
              return { ...n, pieces: avecMurs };
            });
            // Les épaisseurs de murs seules ne changent rien aux circuits (positions inchangées) : on ne remet
            // à zéro le résultat que si les dimensions de la pièce ont bougé.
            if (dimensionsModifiees) invalidateResultat();
            setEditingPiece(null);
          }}
          onCancel={() => setEditingPiece(null)}
          onDelete={editingPiece.verrouillee ? undefined : () => {
            updateNiveauActif(n => ({ ...n, pieces: n.pieces.filter(p => p.id !== editingPiece.id) }));
            setSelectedPieceId(null);
            setEditingPiece(null);
            invalidateResultat();
          }}
        />
      )}

      <ConfirmDialog
        open={confirmSuppNiveau && !!niveauActif}
        title={niveauActif && estAnnexe(niveauActif) ? "Supprimer cette annexe ?" : "Supprimer ce niveau ?"}
        message={!niveauActif ? "" : estAnnexe(niveauActif)
          ? `L'annexe « ${niveauActif.nom || "Annexe"} » sera supprimée avec ses pièces, ses appareillages et son tableau électrique (rangées comprises). Cette action est définitive.`
          : `Le niveau « ${niveauActif.nom || NIVEAU_TYPES[niveauActif.type]} » sera supprimé avec ses ${niveauActif.pieces.length} pièce(s) et leurs appareillages.${niveauActif.tableauPos ? " Il porte le tableau de la maison : sa position sera perdue et sera à replacer sur un autre niveau." : ""} Les circuits déjà poussés restent dans le tableau jusqu'au prochain « Pousser vers le tableau ». Cette action est définitive.`}
        onConfirm={supprimerNiveauActif}
        onCancel={() => setConfirmSuppNiveau(false)}
        loading={suppNiveauEnCours}
      />

      {showNiveauForm && (
        <NiveauForm
          onValidate={async (nom, type, hauteurPlafond) => {
            const annexe = type === "annexe";
            // Annexes triées après la maison (ordre ≥ 100) ; niveaux de la maison à la suite.
            const ordre = annexe
              ? 100 + niveaux.filter(estAnnexe).length
              : Math.max(-1, ...niveaux.filter(n => !estAnnexe(n)).map(n => n.ordre)) + 1;
            const nouveau = nouveauNiveau(type, ordre);
            nouveau.nom = nom.trim() || (annexe ? "Annexe" : "");
            nouveau.hauteurPlafond = hauteurPlafond;
            if (annexe) {
              // Une annexe naît avec son propre tableau (vide) ; ses circuits y seront poussés.
              const idTableau = nouvelIdAnnexe();
              nouveau.tableauId = idTableau;
              const liste = await synchroniserAnnexes(projet.id, [...annexes.map(a => ({ id: a.id, nom: a.nom })), { id: idTableau, nom: nouveau.nom }]);
              setAnnexes(liste);
            }
            setNiveaux(nvs => [...nvs, nouveau]);
            setNiveauActifId(nouveau.id);
            setShowNiveauForm(false);
          }}
          onCancel={() => setShowNiveauForm(false)}
        />
      )}

      {plaqueFormOuvert && (
        <PlaqueForm
          initial={plaquePostes ?? plaqueConfig}
          onValider={postes => { setPlaqueConfig(postes); setPlaqueFormOuvert(false); armerPlaque(postes); }}
          onCancel={() => setPlaqueFormOuvert(false)}
        />
      )}

      {pendingCommande && niveauActif && (
        <CommandeLinkForm
          niveau={niveauActif} item={pendingCommande.item}
          onValidate={(ids, ids2) => lierCommande(pendingCommande.item.id, ids, ids2)}
          onCancel={() => {
            if (pendingCommande.estNouveau) removerAppareillage(pendingCommande.item.id);
            setPendingCommande(null);
          }}
        />
      )}

      {editingSegment && niveauActif && (() => {
        const piece = niveauActif.pieces.find(p => p.id === editingSegment.pieceId);
        if (!piece) return null;
        const a = piece.contour[editingSegment.segIndex];
        const b = piece.contour[(editingSegment.segIndex + 1) % piece.contour.length];
        if (!a || !b) return null;
        return (
          <SegmentLengthForm
            longueurActuelle={longueurUtileCm(piece, editingSegment.segIndex) / 100} murActuel={murDe(piece, editingSegment.segIndex)}
            onValidate={appliquerLongueurSegment}
            onCancel={() => setEditingSegment(null)}
          />
        );
      })()}

      {showPrintForm && (
        <PrintForm
          niveaux={niveaux} resultatDisponible={!!resultat}
          onValider={(piecesSelectionnees, avecCircuits, avecLongueurs, avecHauteurs, avecCotes, avecCotesPieces, avecCotesExt, avecCotesOuv) => {
            setShowPrintForm(false);
            imprimerPlan(niveaux, client?.nom ?? "", resultat, avecCircuits, avecLongueurs, avecHauteurs, piecesSelectionnees, avecCotes, avecCotesPieces, avecCotesExt, avecCotesOuv);
          }}
          onCancel={() => setShowPrintForm(false)}
        />
      )}

      {show3DPrintForm && (
        <Print3DForm
          niveaux={niveaux} niveauActifId={niveauActifId}
          onValider={handleImprimer3D}
          onCancel={() => setShow3DPrintForm(false)}
        />
      )}

      {circuitManuelForm && niveauActif && (
        <CircuitManuelForm
          niveau={niveauActif}
          existing={circuitManuelForm.existing}
          onValidate={validerCircuitManuel}
          onCancel={() => setCircuitManuelForm(null)}
          onDelete={circuitManuelForm.existing ? () => supprimerCircuitManuelEtFermer(circuitManuelForm.existing!.id) : undefined}
        />
      )}
    </Shell>
  );
}
