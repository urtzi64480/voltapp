"use client";

import type { ReactNode } from "react";
import { useState, useRef, useCallback, useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Client } from "@/types";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import {
  ArrowLeft, Save, Printer, Plus, Trash2, Pencil, ZoomIn, ZoomOut, MousePointer2, X,
  Zap, Sparkles, Eye, EyeOff, ArrowRightCircle, AlertTriangle, Search, Route,
  GripHorizontal, ChevronUp, ChevronDown, ArrowDownToLine, Link2, Receipt,
} from "lucide-react";
import {
  Point, Piece, Niveau, PieceType, NiveauType, AppareillagePlace, AppareillageType,
  Ouverture, OuvertureType, nouvelleOuverture, positionSurSegment, OuvertureEffective, ouverturesEffectivesMur,
  NIVEAU_TYPES, PIECE_TYPES, aireDuPolygone, centroide, trouverPiece, distance, ajusterLongueurContour,
  distanceAuSegment, positionnerADistanceDuSegment,
  CircuitManuel, FamilleCircuitManuel,
  nouveauNiveau, nouvellePiece, nouvelAppareillage, uidMaison, reamorcerCompteurId, dedupliquerIds,
  LiaisonWaypoint, cleSegmentLiaison,
  cheminSegment, longueurBranchesEclairage, centroidePoints, assombrirCouleur, pointsOndulesEntre,
  BoiteDerivation, migrerBoitesDerivation,
} from "@/lib/maison-types";
import { AppareillageSymbol, appareillageSymbolSvgString, PALETTE, labelAppareillage } from "@/components/plan/AppareillageSymbols";
import Vue3D, { Vue3DHandle } from "@/components/plan/Vue3D";
import { genererCircuits, assemblerTableau, remapperIdsRows, maxIdRows, genererGainesNiveaux, construireColorMap, segmentsPourCircuit, ResultatGeneration, TronconGaine } from "@/lib/maison-engine";
import { CIRCUITS, BreakerRow, Breaker } from "@/lib/electrical-constants";

const PX_PER_M = 60;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

// Accroche grille + alignement (façon logiciel de dessin vectoriel) : un point saisi
// s'arrondit à la grille fine (10cm) par défaut, et s'aligne exactement sur un sommet
// existant proche (mur voisin, autre pièce) plutôt que sur la grille quand les deux
// sont en concurrence — l'alignement gagne toujours sur le simple arrondi de grille.
const SNAP_GRID_M = 0.1;
const ALIGN_THRESHOLD_PX = 8;
// Distance de détection (px écran) pour "clique près d'un mur" lors du placement
// d'une porte/fenêtre — plus généreux que l'accroche fine, un mur est fin à l'écran.
const SEUIL_MUR_PX = 18;

// Types de circuit proposés pour un circuit manuel — tout CIRCUITS sauf les entrées qui ne
// correspondent pas à un vrai circuit posé sur le plan (arrivée générale, parafoudre) et
// l'ancienne clé "chauffage" (un seul radiateur, historique) remplacée par chauffage_16/20.
const CIRCUIT_KEYS_MANUELS = Object.keys(CIRCUITS).filter(k => !["general", "parafoudre", "chauffage"].includes(k));

function arrondiGrille(v: number, pas: number = SNAP_GRID_M): number {
  return Math.round(v / pas) * pas;
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
  let meilleurDX = seuilM, meilleurDY = seuilM;
  candidats.forEach(c => {
    const dx = Math.abs(c.x - m.x);
    if (dx < meilleurDX) { meilleurDX = dx; x = c.x; guideX = c.x; }
    const dy = Math.abs(c.y - m.y);
    if (dy < meilleurDY) { meilleurDY = dy; y = c.y; guideY = c.y; }
  });
  return { point: { x, y }, guideX, guideY };
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── IMPRESSION ─────────────────────────────────────────────────────────────────

function rendreSVGImprimable(n: Niveau, resultat: ResultatGeneration | null, showCircuits: boolean, showHauteurs: boolean, showLongueurs: boolean, piecesSelectionnees: Set<number> | null): string {
  const pieces = piecesSelectionnees ? n.pieces.filter(p => piecesSelectionnees.has(p.id)) : n.pieces;
  const allPts = [
    ...pieces.flatMap(p => p.contour),
    ...(n.tableauPos ? [n.tableauPos] : []),
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

  let s = `<svg width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg">`;
  s += `<rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="#fff"/>`;

  niveauResultat.pieces.forEach(p => {
    const pts = p.contour.map(toPx).map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
    const c = toPx(centroide(p.contour));
    const surf = aireDuPolygone(p.contour).toFixed(1);
    const spec = PIECE_TYPES[p.type];
    s += `<polygon points="${pts}" fill="${spec.color}" stroke="#333" stroke-width="1.5"/>`;
    s += `<text x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" font-size="10" text-anchor="middle" font-family="monospace" fill="#111">${escapeXml(p.nom || spec.label)}</text>`;
    s += `<text x="${c.x.toFixed(1)}" y="${(c.y + 12).toFixed(1)}" font-size="8" text-anchor="middle" font-family="monospace" fill="#555">${surf} m²</text>`;
    p.contour.forEach((pt, i) => {
      const next = p.contour[(i + 1) % p.contour.length];
      const len = distance(pt, next);
      const aPx = toPx(pt), bPx = toPx(next);
      const mx = (aPx.x + bPx.x) / 2, my = (aPx.y + bPx.y) / 2;
      const dx = bPx.x - aPx.x, dy = bPx.y - aPx.y;
      const l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l;
      const lx = mx + nx * 7, ly = my + ny * 7;
      s += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="6" text-anchor="middle" font-family="monospace" fill="#444">${len.toFixed(2)}m</text>`;
    });
  });

  if ((showCircuits || showHauteurs) && resultat && n.tableauPos) {
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
      const segments = segmentsPourCircuit(breaker, points, n, n.tableauPos!);
      segments.forEach(seg => {
        const cheminM = cheminSegment(seg, n.liaisonWaypoints);
        const chemin = cheminM.map(toPx);
        const couleurSegment = seg.type === "navette" ? assombrirCouleur(color) : color;
        if (showCircuits) {
          const d = chemin.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
          s += `<path d="${d}" fill="none" stroke="${couleurSegment}" stroke-width="1.2" stroke-dasharray="3,2" opacity="0.85"/>`;
          if (showLongueurs) {
            for (let j = 0; j < cheminM.length - 1; j++) {
              const distM = distance(cheminM[j], cheminM[j + 1]);
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
        const lumieres = points.filter(a => a.type === "point_lumineux" || a.type === "applique");
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
    p.appareillages.forEach(a => {
      const pos = toPx({ x: a.x, y: a.y });
      const color = showCircuits && a.circuitId != null ? (colorMap.get(a.circuitId) ?? "#1c1917") : "#1c1917";
      s += appareillageSymbolSvgString(a.type, pos.x, pos.y, 10, color);
      if (showHauteurs && a.hauteur != null) {
        s += `<text x="${(pos.x + 7).toFixed(1)}" y="${(pos.y + 3).toFixed(1)}" font-size="6" font-family="monospace" fill="#555">${a.hauteur}cm</text>`;
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
      if (showLongueurs && niveauVivant.tableauPos) {
        const pts = niveauVivant.pieces.flatMap(p => p.appareillages).filter(a => a.circuitId === b.id);
        if (pts.length > 0) {
          const segments = segmentsPourCircuit(b, pts, niveauVivant, niveauVivant.tableauPos);
          lgTxt = ` — ${longueurBranchesEclairage(segments, niveauVivant.liaisonWaypoints).toFixed(1)}m`;
        }
      }
      const nomCircuit = niveauVivant.nomsCircuits?.[b.label] ?? b.label;
      return `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;"></span>${escapeXml(nomCircuit || CIRCUITS[b.circuit]?.label || b.circuit)}${lgTxt}</span>`;
    }).join("") + `</div>`;
}

function imprimerPlan(
  niveaux: Niveau[], clientName: string, resultat: ResultatGeneration | null,
  showCircuits: boolean, showLongueurs: boolean, showHauteurs: boolean, piecesSelectionnees: Set<number> | null,
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
    html += rendreSVGImprimable(n, resultat, showCircuits, showHauteurs, showLongueurs, piecesSelectionnees);
    if (showCircuits) {
      html += legendeCircuitsHtml(resultat, niveauResultat, showLongueurs, n);
    }
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

type DragMode =
  | { kind: "none" }
  | { kind: "pan"; startX: number; startY: number; startPan: Point }
  | { kind: "vertex"; pieceId: number; vertexIndex: number }
  | { kind: "piece"; pieceId: number; startX: number; startY: number; startContour: Point[] }
  | { kind: "appareillage"; pieceId: number; appareillageId: number }
  | { kind: "ouverture"; pieceId: number; ouvertureId: number }
  | { kind: "tableau" }
  | { kind: "pointArrivee" }
  | { kind: "boite"; label: string; boiteId: number }
  | { kind: "liaison"; cle: string; waypointId: number };

// ─── FORMULAIRES ────────────────────────────────────────────────────────────────

function PieceForm({ initialNom, initialType, initialHauteurPlafond, onValidate, onCancel, onDelete }: {
  initialNom: string; initialType: PieceType; initialHauteurPlafond?: number;
  onValidate: (nom: string, type: PieceType, hauteurPlafond: number | undefined) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [nom, setNom] = useState(initialNom);
  const [type, setType] = useState<PieceType>(initialType);
  const [hauteurPlafond, setHauteurPlafond] = useState(initialHauteurPlafond != null ? String(initialHauteurPlafond) : "");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="card w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">Pièce</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3">
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
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button onClick={() => onValidate(nom, type, hauteurPlafond.trim() === "" ? undefined : (parseFloat(hauteurPlafond.replace(",", ".")) || undefined))} className="btn-volt flex-1"><Save size={14} /> Valider</button>
          {onDelete && <button onClick={onDelete} className="btn-danger !px-3"><Trash2 size={14} /></button>}
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

function EtiquetteLongueur({ aPx, bPx, texte, onClick, actif }: {
  aPx: Point; bPx: Point; texte: string; onClick?: () => void; actif?: boolean;
}) {
  const mx = (aPx.x + bPx.x) / 2, my = (aPx.y + bPx.y) / 2;
  const dx = bPx.x - aPx.x, dy = bPx.y - aPx.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
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

function SegmentLengthForm({ longueurActuelle, onValidate, onCancel }: {
  longueurActuelle: number; onValidate: (nouvelleLongueur: number) => void; onCancel: () => void;
}) {
  const [valeur, setValeur] = useState(longueurActuelle.toFixed(2));
  const num = parseFloat(valeur.replace(",", "."));
  const valide = !isNaN(num) && num > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="card w-full max-w-xs" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">Longueur du segment</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4">
          <label className="label">Longueur (mètres)</label>
          <input autoFocus className="input" inputMode="decimal" value={valeur}
            onChange={e => setValeur(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && valide) onValidate(num); }} />
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button disabled={!valide} onClick={() => onValidate(num)} className="btn-volt flex-1 disabled:opacity-40">Valider</button>
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
            <input autoFocus className="input" placeholder="Ex: R+1, Combles…" value={nom} onChange={e => setNom(e.target.value)} />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={type} onChange={e => setType(e.target.value as NiveauType)}>
              {Object.entries(NIVEAU_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
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
  onValidate: (pointLumineuxIds: number[]) => void; onCancel: () => void;
}) {
  const points = niveau.pieces.flatMap(p =>
    p.appareillages.filter(a => a.type === "point_lumineux" || a.type === "applique").map(a => ({ a, pieceNom: p.nom })));
  const [choix, setChoix] = useState<number[]>(item.commandePourIds ?? (points[0] ? [points[0].a.id] : []));
  const toggle = (id: number) => setChoix(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="card w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">{labelAppareillage(item.type)} — quel(s) point(s) lumineux ?</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-1 max-h-64 overflow-y-auto">
          {points.length === 0 ? (
            <p className="text-sm text-ink-400">Aucun point lumineux placé sur ce niveau. Place d'abord un ou plusieurs points lumineux, puis leur commande.</p>
          ) : points.map(({ a, pieceNom }) => (
            <label key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-ink-50 cursor-pointer">
              <input type="checkbox" checked={choix.includes(a.id)} onChange={() => toggle(a.id)} />
              <span className="text-sm text-ink-700">{pieceNom || "Pièce"} — {a.nom || `point lumineux #${a.id}`}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button disabled={choix.length === 0} onClick={() => onValidate(choix)} className="btn-volt flex-1 disabled:opacity-40">Lier ({choix.length})</button>
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
  const tousAppareils = niveau.pieces.flatMap(p => p.appareillages.map(a => ({ a, pieceNom: p.nom })));
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
                  <span className="text-ink-700 truncate flex-1">{pieceNom || "Pièce"} — {a.nom || labelAppareillage(a.type)}</span>
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
const LABEL_OUVERTURE: Record<OuvertureType, string> = {
  porte: "Porte", porte_coulissante: "Porte coulissante", fenetre: "Fenêtre", ouverture: "Ouverture murale",
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

function PaletteBoutons({ placementType, onSelect }: { placementType: AppareillageType | null; onSelect: (t: AppareillageType | null) => void }) {
  const categories = Array.from(new Set(PALETTE.map(p => p.categorie)));
  return (
    <>
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
  onValider: (piecesSelectionnees: Set<number> | null, avecCircuits: boolean, avecLongueurs: boolean, avecHauteurs: boolean) => void;
  onCancel: () => void;
}) {
  const toutesPieces = niveaux.flatMap(n => n.pieces.map(p => p.id));
  const [selection, setSelection] = useState<Set<number>>(new Set(toutesPieces));
  const [avecCircuits, setAvecCircuits] = useState(resultatDisponible);
  const [avecLongueurs, setAvecLongueurs] = useState(false);
  const [avecHauteurs, setAvecHauteurs] = useState(false);
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
            onClick={() => onValider(toutSelectionne ? null : selection, avecCircuits, avecLongueurs, avecHauteurs)}
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

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [niveaux, setNiveaux] = useState<Niveau[]>([]);
  const [niveauActifId, setNiveauActifId] = useState<number | null>(null);
  const [showNiveauForm, setShowNiveauForm] = useState(false);

  const [mode, setMode] = useState<"select" | "dessiner">("select");
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
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
  const [placingTableau, setPlacingTableau] = useState(false);
  const [placingPointArrivee, setPlacingPointArrivee] = useState(false);
  const [pendingCommande, setPendingCommande] = useState<{ item: AppareillagePlace; estNouveau: boolean } | null>(null);
  const [selectedAppareillageId, setSelectedAppareillageId] = useState<number | null>(null);
  // Incrémenté à chaque fin de geste de déplacement — sert uniquement de "key" pour forcer
  // les champs de position/distance à se resynchroniser avec la géométrie après un drag,
  // sans jamais les resynchroniser pendant la frappe (ce qui bloquait l'effacement).
  const [dragEndTick, setDragEndTick] = useState(0);
  const [selectedTableau, setSelectedTableau] = useState(false);
  const [selectedPointArrivee, setSelectedPointArrivee] = useState(false);
  const [placingOuverture, setPlacingOuverture] = useState<OuvertureType | null>(null);
  const [ouvertureMenuOpen, setOuvertureMenuOpen] = useState(false);
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
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Barre d'outils (dessin + circuits) repliable — pour libérer un maximum de hauteur pour
  // le plan quand on n'en a pas besoin. Se replie ne laisse jamais un mode de placement/
  // dessin en cours orphelin (voir toggleToolbar) : on repart toujours de "Sélection".
  const [toolbarOuvert, setToolbarOuvert] = useState(true);
  const [alertesOuvertes, setAlertesOuvertes] = useState(false);

  const [resultat, setResultat] = useState<ResultatGeneration | null>(null);
  const [showCircuits, setShowCircuits] = useState(false);
  const [showLongueurs, setShowLongueurs] = useState(false);
  // Ids de breakers actuellement affichés sur le plan (sous-ensemble de resultat.breakers) —
  // permet d'isoler un ou plusieurs circuits à l'écran pour vérifier leur tracé avant de les
  // retoucher à la main. Réinitialisé à "tous visibles" à chaque nouvelle génération
  // (voir handleGenerer) ; n'affecte jamais l'impression, qui inclut toujours tous les circuits.
  const [circuitsVisibles, setCircuitsVisibles] = useState<Set<number>>(new Set());
  const [showPrintForm, setShowPrintForm] = useState(false);
  const [show3DPrintForm, setShow3DPrintForm] = useState(false);
  const [vue3D, setVue3D] = useState(false);
  const vue3DRef = useRef<Vue3DHandle>(null);
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 60, y: 60 });
  const [, forceRerender] = useState(0);

  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => { forceRerender(t => t + 1); }, []);

  useEffect(() => {
    supabase.from("clients").select("*").eq("id", clientId).single().then(({ data: c }) => {
      if (c) {
        setClient(c);
        const raw = (c as any).maison_config as string | null | undefined;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed?.niveaux) && parsed.niveaux.length > 0) {
              // Doit tourner avant reamorcerCompteurId : assigne de nouveaux id (uidMaison())
              // aux boîtes migrées depuis l'ancien format, que le compteur doit ensuite couvrir.
              migrerBoitesDerivation(parsed.niveaux);
              reamorcerCompteurId(parsed.niveaux);
              // Nettoie une fois pour toutes d'éventuels id en double laissés par une
              // session précédente (voir dedupliquerIds) — sinon deux appareillages
              // différents peuvent partager le même id et se marcher dessus visuellement
              // (l'un "increvable" au clic, qui dérive sur le plan).
              const { niveaux: niveauxPropres, corrections } = dedupliquerIds(parsed.niveaux);
              setNiveaux(niveauxPropres);
              setNiveauActifId(niveauxPropres[0].id);
              setLoading(false);
              if (corrections > 0) {
                supabase.from("clients").update({ maison_config: JSON.stringify({ niveaux: niveauxPropres }) } as any).eq("id", clientId);
              }
              return;
            }
          } catch {}
        }
      }
      const def = nouveauNiveau("rdc", 0);
      def.nom = "RDC";
      setNiveaux([def]);
      setNiveauActifId(def.id);
      setLoading(false);
    });
  }, [clientId]);

  const niveauActif = niveaux.find(n => n.id === niveauActifId) ?? null;

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
    const onMove = (e: PointerEvent) => {
      if (dragMode.kind === "pan") {
        setPan({ x: dragMode.startPan.x + (e.clientX - dragMode.startX), y: dragMode.startPan.y + (e.clientY - dragMode.startY) });
      } else if (dragMode.kind === "vertex") {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const raw = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        const niveauCourant = niveaux.find(n => n.id === niveauActifId) ?? null;
        const candidats = pointsReferenceNiveau(niveauCourant, dragMode.pieceId, dragMode.vertexIndex);
        const seuilM = ALIGN_THRESHOLD_PX / (PX_PER_M * zoom);
        const { point: m, guideX, guideY } = snapAvecAlignement(raw, candidats, seuilM);
        setSnapGuide(guideX !== undefined || guideY !== undefined ? { x: guideX, y: guideY } : null);
        updateNiveauActif(n => ({
          ...n,
          pieces: n.pieces.map(p => p.id !== dragMode.pieceId ? p : {
            ...p, contour: p.contour.map((pt, i) => (i === dragMode.vertexIndex ? m : pt)),
          }),
        }));
      } else if (dragMode.kind === "piece") {
        const dxM = arrondiGrille((e.clientX - dragMode.startX) / (PX_PER_M * zoom));
        const dyM = arrondiGrille((e.clientY - dragMode.startY) / (PX_PER_M * zoom));
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
        const { point: m, guideX, guideY } = snapAvecAlignement(raw, candidats, seuilM);
        setSnapGuide(guideX !== undefined || guideY !== undefined ? { x: guideX, y: guideY } : null);
        updateNiveauActif(n => ({
          ...n,
          pieces: n.pieces.map(p => p.id !== dragMode.pieceId ? p : {
            ...p, appareillages: p.appareillages.map(a => a.id === dragMode.appareillageId ? { ...a, x: m.x, y: m.y } : a),
          }),
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
      if (!["liaison", "pan", "ouverture", "boite", "pointArrivee"].includes(dragMode.kind)) invalidateResultat();
      setDragEndTick(t => t + 1);
      setDragMode({ kind: "none" });
      setSnapGuide(null);
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
        setPlacingPointArrivee(false); setSelectedPointArrivee(false);
        setCheminementDessin(null); setLiaisonLumiereMode(null);
      }
      return !o;
    });
  };

  const entrerModeDessiner = () => {
    setMode("dessiner"); setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null);
    setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null);
    setPlacingPointArrivee(false); setSelectedPointArrivee(false); setLiaisonLumiereMode(null);
  };
  const armerPlacement = (t: AppareillageType | null) => {
    setPlacementType(t); setMode("select"); setPlacingTableau(false); setPlacingOuverture(null); setDrawingPoints([]);
    setPlacingPointArrivee(false); setSelectedPointArrivee(false); setLiaisonLumiereMode(null);
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null);
  };
  const armerPlacementTableau = () => {
    setPlacingTableau(true); setMode("select"); setPlacementType(null); setPlacingOuverture(null); setDrawingPoints([]);
    setPlacingPointArrivee(false); setSelectedPointArrivee(false); setLiaisonLumiereMode(null);
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null);
  };
  const armerPlacementPointArrivee = () => {
    setPlacingPointArrivee(true); setMode("select"); setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null); setDrawingPoints([]);
    setLiaisonLumiereMode(null);
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null); setSelectedPointArrivee(false);
  };
  const armerPlacementOuverture = (t: OuvertureType | null) => {
    setPlacingOuverture(t); setMode("select"); setPlacementType(null); setPlacingTableau(false); setDrawingPoints([]);
    setPlacingPointArrivee(false); setSelectedPointArrivee(false); setLiaisonLumiereMode(null);
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null);
  };

  const removerAppareillage = (appareillageId: number) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages
          .filter(a => a.id !== appareillageId)
          .map(a => a.commandePourIds?.includes(appareillageId)
            ? { ...a, commandePourIds: a.commandePourIds.filter(id => id !== appareillageId) }
            : a),
      })),
    }));
    setSelectedAppareillageId(null);
    invalidateResultat();
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
        return { ...p, contour: nouveauContour, ouvertures: nouvellesOuvertures };
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
  const modifierOuverture = (ouvertureId: number, patch: Partial<Pick<Ouverture, "largeur" | "hauteur" | "allege" | "charniere" | "ouvreVersInterieur" | "coulisseVers">>) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p, ouvertures: (p.ouvertures ?? []).map(o => o.id === ouvertureId ? { ...o, ...patch } : o),
      })),
    }));
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

  const modifierHauteur = (appareillageId: number, hauteur: number | undefined) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.map(a => a.id === appareillageId ? { ...a, hauteur } : a),
      })),
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
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => p.id !== piece.id ? p : {
        ...p, appareillages: p.appareillages.map(a => a.id === appareillageId ? { ...a, x: nouveauPoint.x, y: nouveauPoint.y } : a),
      }),
    }));
    invalidateResultat();
  };

  // Position exacte (mètres) — pour un placement au centimètre près sans passer par le drag.
  const modifierPositionExacte = (appareillageId: number, x: number, y: number) => {
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p, appareillages: p.appareillages.map(a => a.id === appareillageId ? { ...a, x, y } : a),
      })),
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
        ? { ...(n.boitesDerivation ?? {}), [nom]: [{ id: uidMaison(), nom: "Boîte 1", point: n.tableauPos ?? { x: 0, y: 0 } }] }
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
    setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null);
    setPlacingPointArrivee(false); setSelectedPointArrivee(false); setLiaisonLumiereMode(null);
    setMode("select"); setDrawingPoints([]);
    setSelectedAppareillageId(null); setSelectedPieceId(null); setSelectedTableau(false);
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
    setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null); setPlacingPointArrivee(false);
    setMode("select"); setDrawingPoints([]); setCheminementDessin(null);
    setSelectedAppareillageId(null); setSelectedPieceId(null); setSelectedTableau(false);
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
  const ajouterWaypoint = (cle: string, apresIndex: number, point: Point) => {
    updateNiveauActif(n => {
      const existants = n.liaisonWaypoints?.[cle] ?? [];
      const nouveau: LiaisonWaypoint = { id: uidMaison(), point };
      const maj = [...existants.slice(0, apresIndex), nouveau, ...existants.slice(apresIndex)];
      return { ...n, liaisonWaypoints: { ...(n.liaisonWaypoints ?? {}), [cle]: maj } };
    });
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

  const lierCommande = (itemId: number, pointLumineuxIds: number[]) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.map(a => a.id === itemId ? { ...a, commandePourIds: pointLumineuxIds } : a),
      })),
    }));
    setPendingCommande(null);
    invalidateResultat();
  };

  const appliquerLongueurSegment = (nouvelleLongueur: number) => {
    if (!editingSegment) return;
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => p.id !== editingSegment.pieceId ? p : {
        ...p, contour: ajusterLongueurContour(p.contour, editingSegment.segIndex, nouvelleLongueur),
      }),
    }));
    setEditingSegment(null);
    invalidateResultat();
  };

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return; // dessin de cheminement / liaison directe : seuls les appareillages ciblés réagissent
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const m = toMeters(px, py);

    if (mode === "dessiner") {
      if (drawingPoints.length >= 3) {
        const first = toScreen(drawingPoints[0]);
        if (Math.hypot(px - first.x, py - first.y) < 12) { finirDessin(drawingPoints); return; }
      }
      const seuilM = ALIGN_THRESHOLD_PX / (PX_PER_M * zoom);
      const candidats = [...pointsReferenceNiveau(niveauActif), ...drawingPoints];
      const { point: mSnap } = snapAvecAlignement(m, candidats, seuilM);
      setDrawingPoints(pts => [...pts, mSnap]);
      return;
    }

    if (placingTableau) {
      updateNiveauActif(n => ({ ...n, tableauPos: m }));
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
      const nouveau = nouvelAppareillage(placementType, m.x, m.y);
      updateNiveauActif(n => ({
        ...n,
        pieces: n.pieces.map(p => p.id === piece.id ? { ...p, appareillages: [...p.appareillages, nouveau] } : p),
      }));
      invalidateResultat();
      if (["interrupteur", "va_et_vient", "telerupteur"].includes(placementType)) {
        setPendingCommande({ item: nouveau, estNouveau: true });
      }
      return;
    }

    if (placingOuverture) {
      const seuilM = SEUIL_MUR_PX / (PX_PER_M * zoom);
      const mur = niveauActif ? trouverMurLePlusProche(niveauActif.pieces, m, seuilM) : null;
      if (!mur) {
        setPlacementError("Clique tout près d'un mur pour y placer une porte ou une fenêtre.");
        setTimeout(() => setPlacementError(null), 2000);
        return;
      }
      const nouvelle = nouvelleOuverture(placingOuverture, mur.segIndex, mur.t);
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
    setDragMode({ kind: "pan", startX: e.clientX, startY: e.clientY, startPan: pan });
  };

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    if (mode !== "dessiner") return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCursorPx({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const onPieceDown = (piece: Piece, e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode || mode === "dessiner" || placementType || placingTableau || placingOuverture || placingPointArrivee) return;
    e.stopPropagation();
    if (selectedPieceId === piece.id) {
      setDragMode({ kind: "piece", pieceId: piece.id, startX: e.clientX, startY: e.clientY, startContour: piece.contour });
    } else {
      setSelectedPieceId(piece.id);
      setSelectedAppareillageId(null);
      setSelectedTableau(false);
      setSelectedOuvertureId(null); setSelectedBoite(null);
      setSelectedWaypoint(null);
      setPanelResetTick(t => t + 1);
    }
  };

  const onVertexDown = (pieceId: number, index: number, e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return;
    e.stopPropagation();
    setDragMode({ kind: "vertex", pieceId, vertexIndex: index });
  };

  const onAppareillagePointerDown = (piece: Piece, a: AppareillagePlace, e: React.PointerEvent) => {
    if (liaisonLumiereMode) {
      e.stopPropagation();
      if (a.type === "point_lumineux" || a.type === "applique") {
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
    if (mode !== "select" || placementType || placingTableau || placingOuverture || placingPointArrivee) { e.stopPropagation(); return; }
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
    setPanelResetTick(t => t + 1);
    setDragMode({ kind: "appareillage", pieceId: piece.id, appareillageId: a.id });
  };

  const onTableauPointerDown = (e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return;
    if (mode !== "select" || placementType || placingTableau || placingOuverture || placingPointArrivee) { e.stopPropagation(); return; }
    e.stopPropagation();
    setSelectedTableau(true);
    setSelectedPieceId(null);
    setSelectedAppareillageId(null);
    setSelectedOuvertureId(null); setSelectedBoite(null);
    setSelectedWaypoint(null);
    setSelectedPointArrivee(false);
    setPanelResetTick(t => t + 1);
    setDragMode({ kind: "tableau" });
  };

  const onPointArriveePointerDown = (e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return;
    if (mode !== "select" || placementType || placingTableau || placingOuverture || placingPointArrivee) { e.stopPropagation(); return; }
    e.stopPropagation();
    setSelectedPointArrivee(true);
    setSelectedPieceId(null);
    setSelectedAppareillageId(null);
    setSelectedTableau(false);
    setSelectedOuvertureId(null); setSelectedBoite(null);
    setSelectedWaypoint(null);
    setPanelResetTick(t => t + 1);
    setDragMode({ kind: "pointArrivee" });
  };

  const onOuverturePointerDown = (piece: Piece, o: Ouverture, e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return;
    if (mode !== "select" || placementType || placingTableau || placingOuverture || placingPointArrivee) { e.stopPropagation(); return; }
    e.stopPropagation();
    setSelectedOuvertureId(o.id);
    setSelectedPieceId(null);
    setSelectedAppareillageId(null);
    setSelectedTableau(false);
    setSelectedBoite(null);
    setSelectedWaypoint(null);
    setSelectedPointArrivee(false);
    setPanelResetTick(t => t + 1);
    setDragMode({ kind: "ouverture", pieceId: piece.id, ouvertureId: o.id });
  };

  const onBoitePointerDown = (label: string, boite: BoiteDerivation | null, positionActuelle: Point, e: React.PointerEvent) => {
    if (cheminementDessin || liaisonLumiereMode) return;
    if (mode !== "select" || placementType || placingTableau || placingOuverture || placingPointArrivee) { e.stopPropagation(); return; }
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
    setPanelResetTick(t => t + 1);
    setDragMode({ kind: "boite", label, boiteId });
  };
  // Ajoute une nouvelle boîte de dérivation nommée à un circuit d'éclairage — proposée pour
  // tout circuit lumière, généré (label = breaker.label) ou manuel pas encore généré (label
  // = nom du CircuitManuel, qui deviendra son label naturel dès la première génération).
  const ajouterBoiteDerivation = (label: string) => {
    if (!niveauActif) return;
    const breaker = resultat?.breakers.find(b => b.label === label);
    let centre = niveauActif.tableauPos ?? { x: 0, y: 0 };
    if (breaker) {
      const lumieres = niveauActif.pieces.flatMap(p => p.appareillages)
        .filter(a => a.circuitId === breaker.id && (a.type === "point_lumineux" || a.type === "applique"));
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

  const handleSave = useCallback(async () => {
    setSaving(true);
    await supabase.from("clients").update({ maison_config: JSON.stringify({ niveaux }) } as any).eq("id", clientId);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [niveaux, clientId]);

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
    if (!resultat || resultat.breakers.length === 0) return;
    setPushing(true);
    // Circuits manuels "déjà existants" (CircuitManuel.nonRelieTableau) : jamais poussés
    // au tableau — ils restent protégés par le disjoncteur déjà en place sur l'installation
    // existante, hors de ce plan.
    const idsManuelsNonRelies = new Set(
      niveaux.flatMap(n => (n.circuitsManuels ?? []).filter(m => m.nonRelieTableau).map(m => m.id)),
    );
    const breakersAPousser = resultat.breakers.filter(b => b.manuelId == null || !idsManuelsNonRelies.has(b.manuelId));
    const nbExclus = resultat.breakers.length - breakersAPousser.length;
    // Renommer un circuit automatique (Niveau.nomsCircuits) ne modifie jamais resultat.breakers
    // (label "naturel", utilisé comme clé stable par couleursCircuits/ordresCircuits) — on
    // résout donc le nom affiché ici, juste avant de pousser vers le tableau, en fusionnant
    // les nomsCircuits de tous les niveaux (le label naturel inclut déjà le nom du niveau,
    // donc pas de collision entre niveaux en pratique).
    const tousNomsCircuits: Record<string, string> = {};
    niveaux.forEach(n => Object.assign(tousNomsCircuits, n.nomsCircuits ?? {}));
    const breakersAvecNoms = breakersAPousser.map(b => ({ ...b, label: tousNomsCircuits[b.label] ?? b.label }));
    const nouvellesRows = assemblerTableau(breakersAvecNoms);
    const { data: c } = await supabase.from("clients").select("tableau_config").eq("id", clientId).single();
    let rows: BreakerRow[] = [];
    if (c?.tableau_config) {
      try { const parsed = JSON.parse(c.tableau_config); if (Array.isArray(parsed)) rows = parsed; } catch {}
    }
    // On retire l'ancien lot généré par le plan (tag origine:"plan") avant de réinsérer le
    // nouveau — sinon chaque clic sur "Pousser" duplique les rangées. Les rangées créées à
    // la main dans l'éditeur de tableau (sans ce tag) ne sont jamais touchées.
    const rowsConservees = rows.filter(r => r.origine !== "plan");
    const offset = maxIdRows(rowsConservees) + 100000;
    const remap = remapperIdsRows(nouvellesRows, offset).map((r, i) => ({ ...r, name: `Rangée ${rowsConservees.length + i + 1}` }));
    const rowsFinal = [...rowsConservees, ...remap];
    await supabase.from("clients").update({ tableau_config: JSON.stringify(rowsFinal) }).eq("id", clientId);
    setPushing(false);
    setPushMsg(`${remap.length} rangée(s) et ${breakersAPousser.length} circuit(s) mis à jour dans le tableau.${nbExclus > 0 ? ` ${nbExclus} circuit(s) déjà existant(s) non poussé(s).` : ""}`);
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
  let curseurSnap: ResultatSnap | null = null;
  if (mode === "dessiner" && cursorPx) {
    const mCurseur = toMeters(cursorPx.x, cursorPx.y);
    const candidatsCurseur = [...pointsReferenceNiveau(niveauActif), ...drawingPoints];
    curseurSnap = snapAvecAlignement(mCurseur, candidatsCurseur, seuilAlignementM);
  }
  const guideActif: { x?: number; y?: number } | null =
    dragMode.kind === "vertex" ? snapGuide
    : mode === "dessiner" && curseurSnap && (curseurSnap.guideX !== undefined || curseurSnap.guideY !== undefined)
      ? { x: curseurSnap.guideX, y: curseurSnap.guideY }
      : null;
  const selectedAppareillage = niveauActif?.pieces.flatMap(p => p.appareillages).find(a => a.id === selectedAppareillageId) ?? null;
  const pieceDeSelectedAppareillage = selectedAppareillage
    ? niveauActif?.pieces.find(p => p.appareillages.some(a => a.id === selectedAppareillage.id)) ?? null
    : null;

  const colorMap = resultat ? construireColorMap(resultat, niveaux) : new Map<number, string>();

  const symSize = Math.min(28, Math.max(11, 16 * zoom));

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

  return (
    <Shell>
      <div className="flex flex-col h-[calc(100vh-4rem)] md:h-screen overflow-hidden">
        <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-ink-200 bg-white shrink-0 gap-3 flex-wrap relative z-10">
          <div className="flex items-center gap-3">
            <Link href={`/clients/${clientId}`} className="btn-ghost !px-2 !py-1.5 text-ink-400"><ArrowLeft size={16} /></Link>
            <div>
              <h1 className="font-display text-lg text-ink-900 leading-tight">Plan de circuits</h1>
              {client && <p className="text-xs text-ink-400">{client.prenom ? `${client.prenom} ${client.nom}` : client.nom}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {!vue3D && (
              <button onClick={toggleToolbar} className="btn-ghost !px-2 !py-1.5" title={toolbarOuvert ? "Replier la barre d'outils" : "Déplier la barre d'outils"}>
                {toolbarOuvert ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
            )}
            <button onClick={() => setVue3D(v => !v)} className={`btn-ghost ${vue3D ? "!bg-ink-900 !text-volt-400" : ""}`}>
              {vue3D ? "Vue 2D" : "Vue 3D"}
            </button>
            {vue3D ? (
              <button onClick={() => setShow3DPrintForm(true)} className="btn-ghost"><Printer size={15} /> Imprimer la vue 3D</button>
            ) : (
              <button onClick={() => setShowPrintForm(true)} className="btn-ghost"><Printer size={15} /> Imprimer</button>
            )}
            <Link href={`/predevis/${clientId}`} className="btn-ghost"><Receipt size={15} /> Pré-devis</Link>
            <button onClick={handleSave} disabled={saving} className={`btn-volt ${saved ? "!bg-emerald-500 !border-emerald-600 !text-white" : ""}`}>
              <Save size={15} />{saving ? "…" : saved ? "Sauvegardé !" : "Sauvegarder"}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-4 md:px-6 py-2 border-b border-ink-100 bg-ink-50 overflow-x-auto shrink-0">
          {[...niveaux].sort((a, b) => a.ordre - b.ordre).map(n => (
            <button key={n.id} onClick={() => { setNiveauActifId(n.id); setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); setSelectedBoite(null); setSelectedPointArrivee(false); setCheminementDessin(null); setLiaisonLumiereMode(null); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                n.id === niveauActifId ? "bg-ink-900 text-volt-400" : "bg-white border border-ink-200 text-ink-500 hover:border-ink-400"
              }`}>
              {n.nom || NIVEAU_TYPES[n.type]}
            </button>
          ))}
          <button onClick={() => setShowNiveauForm(true)} className="btn-ghost !px-2 !py-1.5 shrink-0"><Plus size={14} /></button>
          {niveauActif && (
            <div className="flex items-center gap-1.5 ml-auto shrink-0 text-xs text-ink-400">
              <span>Plafond</span>
              <input type="number" step="0.1" className="input !py-1 !text-xs !w-16"
                value={niveauActif.hauteurPlafond ?? 2.5}
                onChange={e => updateNiveauActif(n => ({ ...n, hauteurPlafond: parseFloat(e.target.value) || 2.5 }))} />
              <span>m</span>
            </div>
          )}
        </div>

        {!vue3D && toolbarOuvert && (
        <div className="flex items-center gap-2 px-4 md:px-6 py-2 border-b border-ink-100 shrink-0 flex-wrap bg-ink-50">
          <button onClick={() => { setMode("select"); setDrawingPoints([]); setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null); setPlacingPointArrivee(false); }}
            className={`btn-ghost !text-xs ${mode === "select" && !placementType && !placingTableau && !placingOuverture && !placingPointArrivee ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <MousePointer2 size={13} /> Sélection
          </button>
          <button onClick={entrerModeDessiner} className={`btn-ghost !text-xs ${mode === "dessiner" ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <Pencil size={13} /> Dessiner une pièce
          </button>
          <button onClick={armerPlacementTableau} className={`btn-ghost !text-xs ${placingTableau ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <Zap size={13} /> Position tableau
          </button>
          <button onClick={armerPlacementPointArrivee} className={`btn-ghost !text-xs ${placingPointArrivee ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <ArrowDownToLine size={13} /> Arrivée gaines
          </button>
          <div className="relative">
            <button onClick={() => setOuvertureMenuOpen(o => !o)}
              className={`btn-ghost !text-xs ${placingOuverture ? "!bg-ink-900 !text-volt-400" : ""}`}>
              <OuvertureIcon type={placingOuverture ?? "porte"} size={13} /> {placingOuverture ? LABEL_OUVERTURE[placingOuverture] : "Porte / fenêtre"}
            </button>
            {ouvertureMenuOpen && (
              <div className="absolute z-20 top-full left-0 mt-1 card card-inner !p-1 flex flex-col shadow-lg w-48">
                {(["porte", "porte_coulissante", "fenetre", "ouverture"] as OuvertureType[]).map(t => (
                  <button key={t}
                    onClick={() => { armerPlacementOuverture(placingOuverture === t ? null : t); setOuvertureMenuOpen(false); }}
                    className={`flex items-center gap-2 !text-xs px-2 py-1.5 rounded-md hover:bg-ink-50 ${placingOuverture === t ? "text-volt-600 font-semibold" : "text-ink-600"}`}>
                    <OuvertureIcon type={t} size={14} /> {LABEL_OUVERTURE[t]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setCircuitsManuelsOpen(o => !o)} className={`btn-ghost !text-xs ${circuitsManuelsOpen ? "!bg-ink-900 !text-volt-400" : ""}`}>
            🎛️ Circuits manuels
          </button>
          <button onClick={() => setPaletteOpen(o => !o)} className={`btn-ghost !text-xs lg:hidden ${paletteOpen ? "!bg-ink-900 !text-volt-400" : ""}`}>
            Appareillages
          </button>
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
          {resultat && !niveauActif?.tableauPos && (
            <span className="text-[11px] text-amber-600 font-semibold">Positionne le tableau pour voir le tracé des gaines</span>
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
              {pushMsg} <Link href={`/tableau/${clientId}`} className="underline">Voir le tableau →</Link>
            </span>
          )}

          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => zoomBtn(-1)} className="btn-ghost !px-2 !py-1.5"><ZoomOut size={14} /></button>
            <span className="text-xs font-mono text-ink-400 w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => zoomBtn(1)} className="btn-ghost !px-2 !py-1.5"><ZoomIn size={14} /></button>
          </div>
        </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 relative overflow-hidden bg-white">
            {vue3D ? (
              niveauActif ? (
                <Vue3D ref={vue3DRef} niveau={niveauActif} resultat={resultat} showCircuits={showCircuits} />
              ) : null
            ) : (
              <>
            <svg
              ref={svgRef}
              className="w-full h-full block"
              style={{ touchAction: "none", cursor: mode === "dessiner" || placementType || placingTableau || placingPointArrivee ? "crosshair" : "grab" }}
              onPointerDown={onBackgroundPointerDown}
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

              {niveauActif?.pieces.map(piece => {
                const spec = PIECE_TYPES[piece.type];
                const pts = piece.contour.map(toScreen).map(p => `${p.x},${p.y}`).join(" ");
                const isSelected = piece.id === selectedPieceId;
                const c = toScreen(centroide(piece.contour));
                const surf = aireDuPolygone(piece.contour).toFixed(1);
                return (
                  <g key={piece.id}>
                    <polygon points={pts} fill={spec.color} fillOpacity={0.85}
                      stroke={isSelected ? "#F59E0B" : spec.stroke} strokeWidth={isSelected ? 2.5 : 1.5}
                      style={{ cursor: mode === "select" && !placementType && !placingTableau && !placingOuverture ? "move" : "default" }}
                      onPointerDown={e => onPieceDown(piece, e)} />
                    {niveauActif && piece.contour.flatMap((pt, i) => {
                      const next = piece.contour[(i + 1) % piece.contour.length];
                      // Ouvertures posées sur le mur mitoyen d'une AUTRE pièce, projetées ici en
                      // simple trouée (pas de vantail/vitrage — déjà dessinés côté propriétaire) :
                      // c'est ce qui fait que percer une porte d'un côté "perce" aussi la vue de
                      // la pièce voisine, sans dupliquer la donnée de l'ouverture.
                      const projetees = ouverturesEffectivesMur(niveauActif.pieces, piece, i).filter(e => !e.proprietaire);
                      return projetees.map((e, k) => {
                        const centreM = { x: pt.x + (next.x - pt.x) * e.position, y: pt.y + (next.y - pt.y) * e.position };
                        const pC = toScreen(centreM), pA = toScreen(pt), pB = toScreen(next);
                        const angleDeg = Math.atan2(pB.y - pA.y, pB.x - pA.x) * 180 / Math.PI;
                        const largeurPx = Math.max(10, (e.largeur / 100) * PX_PER_M * zoom);
                        return (
                          <g key={`jumeau-${i}-${k}`} transform={`translate(${pC.x}, ${pC.y}) rotate(${angleDeg})`} style={{ pointerEvents: "none" }}>
                            <rect x={-largeurPx / 2} y={-4} width={largeurPx} height={8} fill="#fff" />
                          </g>
                        );
                      });
                    })}
                    <text x={c.x} y={c.y - 4} textAnchor="middle" fontSize={12} fontFamily="monospace" fontWeight={700} fill="#1c1917" style={{ pointerEvents: "none" }}>
                      {piece.nom || spec.label}
                    </text>
                    <text x={c.x} y={c.y + 12} textAnchor="middle" fontSize={10} fontFamily="monospace" fill="#78716c" style={{ pointerEvents: "none" }}>
                      {surf} m²
                    </text>
                    {isSelected && mode === "select" && piece.contour.map((pt, i) => {
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
                    {piece.contour.map((pt, i) => {
                      const next = piece.contour[(i + 1) % piece.contour.length];
                      const len = distance(pt, next);
                      return (
                        <EtiquetteLongueur key={`seg${i}`} aPx={toScreen(pt)} bPx={toScreen(next)} texte={`${len.toFixed(2)} m`}
                          onClick={mode === "select" && !placementType && !placingTableau && !placingOuverture ? () => setEditingSegment({ pieceId: piece.id, segIndex: i }) : undefined}
                          actif={editingSegment?.pieceId === piece.id && editingSegment?.segIndex === i} />
                      );
                    })}
                    {(piece.ouvertures ?? []).map(o => {
                      const a = piece.contour[o.segIndex], b = piece.contour[(o.segIndex + 1) % piece.contour.length];
                      if (!a || !b) return null;
                      const centreM = { x: a.x + (b.x - a.x) * o.position, y: a.y + (b.y - a.y) * o.position };
                      const pC = toScreen(centreM), pA = toScreen(a), pB = toScreen(b);
                      const angleDeg = Math.atan2(pB.y - pA.y, pB.x - pA.x) * 180 / Math.PI;
                      const largeurPx = Math.max(10, (o.largeur / 100) * PX_PER_M * zoom);
                      const isSel = o.id === selectedOuvertureId;
                      const couleur = o.type === "porte" || o.type === "porte_coulissante" ? "#92400E" : o.type === "fenetre" ? "#0369A1" : "#78716c";

                      // Symbole d'ouverture de porte (vantail + arc de débattement) — calculé en
                      // mètres à partir de la charnière et du sens choisis, puis chaque point est
                      // projeté à l'écran individuellement pour rester correct quelle que soit
                      // l'orientation du mur (pas de rotation SVG locale à démêler).
                      let vantail: { hinge: Point; bout: Point; arc: Point[] } | null = null;
                      if (o.type === "porte") {
                        const largeurM = o.largeur / 100;
                        const dxw = b.x - a.x, dyw = b.y - a.y;
                        const longueurMur = Math.hypot(dxw, dyw) || 1;
                        const dirX = dxw / longueurMur, dirY = dyw / longueurMur;
                        const jambeA = { x: centreM.x - dirX * (largeurM / 2), y: centreM.y - dirY * (largeurM / 2) };
                        const jambeB = { x: centreM.x + dirX * (largeurM / 2), y: centreM.y + dirY * (largeurM / 2) };
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

                      return (
                        <g key={`ouv-${o.id}`} onPointerDown={e => onOuverturePointerDown(piece, o, e)}
                          style={{ cursor: mode === "select" && !placementType && !placingTableau && !placingOuverture ? "grab" : "default" }}>
                          <g transform={`translate(${pC.x}, ${pC.y}) rotate(${angleDeg})`}>
                            <rect x={-largeurPx / 2} y={-4} width={largeurPx} height={8} fill="#fff" />
                            <rect x={-largeurPx / 2 - 4} y={-11} width={largeurPx + 8} height={22} fill="transparent" />
                            {o.type === "fenetre" && (
                              <>
                                <line x1={-largeurPx / 2} y1={-3} x2={largeurPx / 2} y2={-3} stroke={couleur} strokeWidth={1.5} />
                                <line x1={-largeurPx / 2} y1={3} x2={largeurPx / 2} y2={3} stroke={couleur} strokeWidth={1.5} />
                              </>
                            )}
                            {o.type === "ouverture" && (
                              <rect x={-largeurPx / 2} y={-4} width={largeurPx} height={8} fill="none" stroke={couleur} strokeWidth={1} strokeDasharray="2,2" />
                            )}
                            {o.type === "porte_coulissante" && (() => {
                              const cote = o.coulisseVers === "gauche" ? -1 : 1;
                              const xPanneau = cote > 0 ? largeurPx / 2 : -largeurPx / 2 - largeurPx;
                              return <rect x={xPanneau} y={-3} width={largeurPx} height={6} fill={couleur} opacity={0.45} />;
                            })()}
                          </g>
                          {vantail && (
                            <>
                              <line x1={vantail.hinge.x} y1={vantail.hinge.y} x2={vantail.bout.x} y2={vantail.bout.y} stroke={couleur} strokeWidth={1.5} />
                              <polyline points={vantail.arc.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={couleur} strokeWidth={1} strokeDasharray="3,2" />
                            </>
                          )}
                          {isSel && <circle cx={pC.x} cy={pC.y} r={largeurPx / 2 + 6} fill="none" stroke="#F59E0B" strokeWidth={1.5} />}
                        </g>
                      );
                    })}
                  </g>
                );
              })}

              {showCircuits && resultat && niveauActif?.tableauPos && (() => {
                const tableauPos = niveauActif.tableauPos;
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
                  segments.forEach(seg => {
                    const cle = cleSegmentLiaison(seg.aId, seg.bId);
                    const coudes = waypointsNiveau?.[cle] ?? [];
                    // Liaison (navette) entre deux va-et-vient : couleur du circuit assombrie,
                    // pour rester rattachée au circuit tout en se distinguant du reste du tracé.
                    const estDomotique = seg.type === "domotique";
                    const couleurSegment = seg.type === "navette" ? assombrirCouleur(color) : color;
                    // Sous-chaîne du segment : point de départ, coudes existants, point d'arrivée.
                    const sousChaine = [seg.aPoint, ...coudes.map(c => c.point), seg.bPoint];
                    for (let j = 0; j < sousChaine.length - 1; j++) {
                      const ptA = sousChaine[j], ptB = sousChaine[j + 1];
                      const aPx = toScreen(ptA), bPx = toScreen(ptB);
                      if (estDomotique) {
                        // Liaison "particulière" (domotique/sans fil) : symbole d'onde plutôt
                        // qu'un trait plein, pour tous les types d'interrupteur.
                        const wavePts = pointsOndulesEntre(ptA, ptB).map(toScreen);
                        const dOnde = wavePts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
                        elements.push(<polyline key={`${cle}-${j}`} points={dOnde} fill="none" stroke={couleurSegment} strokeWidth={1.8} opacity={0.85} />);
                      } else {
                        elements.push(<line key={`${cle}-${j}`} x1={aPx.x} y1={aPx.y} x2={bPx.x} y2={bPx.y} stroke={couleurSegment} strokeWidth={2} strokeDasharray="6,4" opacity={0.8} />);
                      }
                      if (showLongueurs) {
                        elements.push(<EtiquetteLongueur key={`${cle}-${j}-lg`} aPx={aPx} bPx={bPx} texte={`${distance(ptA, ptB).toFixed(2)}m`} />);
                      }
                      if (mode === "select" && !cheminementDessin) {
                        elements.push(
                          <line key={`${cle}-${j}-hit`} x1={aPx.x} y1={aPx.y} x2={bPx.x} y2={bPx.y} stroke="transparent" strokeWidth={14}
                            style={{ cursor: "copy" }}
                            onPointerDown={e => {
                              e.stopPropagation();
                              const rect = svgRef.current?.getBoundingClientRect();
                              if (!rect) return;
                              const m = toMeters(e.clientX - rect.left, e.clientY - rect.top);
                              ajouterWaypoint(cle, j, m);
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
                    const lumieres = points.filter(a => a.type === "point_lumineux" || a.type === "applique");
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

              {niveauActif?.pieces.flatMap(piece => piece.appareillages.map(a => ({ piece, a }))).map(({ piece, a }) => {
                const p = toScreen({ x: a.x, y: a.y });
                const isSel = a.id === selectedAppareillageId;
                const color = showCircuits && a.circuitId != null && circuitsVisibles.has(a.circuitId) ? (colorMap.get(a.circuitId) ?? "#1c1917") : (isSel ? "#F59E0B" : "#1c1917");
                // Cible de clic généreuse et indépendante du zoom (invisible, sous l'icône) :
                // l'icône réelle peut être fine, la zone cliquable reste toujours confortable.
                const rZoneClic = Math.max(16, symSize / 2 + 7);
                // Pastille d'alerte directement sur le plan — un appareillage sans circuit
                // après génération (exclu, commande orpheline…) se repère sans devoir ouvrir
                // la liste des alertes. Uniquement pertinent une fois un résultat généré :
                // avant ça, l'absence de circuitId ne veut encore rien dire.
                const nonRaccorde = resultat != null && a.circuitId == null;
                return (
                  <g key={a.id}
                    onPointerDown={e => onAppareillagePointerDown(piece, a, e)}
                    style={{ cursor: mode === "select" && !placementType && !placingTableau && !placingOuverture ? (isSel ? "grab" : "pointer") : "default" }}>
                    <circle cx={p.x} cy={p.y} r={rZoneClic} fill={isSel ? "#FEF3C7" : "transparent"} stroke="none" />
                    {a.dejaExistant && (
                      <circle cx={p.x} cy={p.y} r={symSize / 2 + 3} fill="none" stroke="#0EA5E9" strokeWidth={1.2} strokeDasharray="2,2" style={{ pointerEvents: "none" }} />
                    )}
                    <g transform={`translate(${p.x - symSize / 2}, ${p.y - symSize / 2})`} style={{ pointerEvents: "none" }}>
                      <AppareillageSymbol type={a.type} size={symSize} color={color} />
                    </g>
                    {isSel && <circle cx={p.x} cy={p.y} r={rZoneClic} fill="none" stroke="#F59E0B" strokeWidth={1.5} />}
                    {nonRaccorde && (
                      <g transform={`translate(${p.x + symSize / 2 - 1}, ${p.y - symSize / 2 - 1})`} style={{ pointerEvents: "none" }}>
                        <circle cx={0} cy={0} r={6.5} fill="#EF4444" stroke="#fff" strokeWidth={1.5} />
                        <text x={0} y={2.8} textAnchor="middle" fontSize={9} fontWeight={800} fill="#fff">!</text>
                      </g>
                    )}
                  </g>
                );
              })}

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

              {cheminementDessin && niveauActif?.tableauPos && (() => {
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
                const chemin = relieAuTableau ? [toScreen(niveauActif.tableauPos), ...placesPx] : placesPx;
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
                const points = niveauActif.pieces.flatMap(p => p.appareillages).filter(a => a.type === "point_lumineux" || a.type === "applique");
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

              {guideActif?.x !== undefined && (() => {
                const p = toScreen({ x: guideActif.x, y: 0 });
                return <line x1={p.x} y1={0} x2={p.x} y2={H} stroke="#F59E0B" strokeWidth={1} strokeDasharray="4,3" opacity={0.7} />;
              })()}
              {guideActif?.y !== undefined && (() => {
                const p = toScreen({ x: 0, y: guideActif.y });
                return <line x1={0} y1={p.y} x2={W} y2={p.y} stroke="#F59E0B" strokeWidth={1} strokeDasharray="4,3" opacity={0.7} />;
              })()}

              {mode === "dessiner" && drawingPoints.length > 0 && (
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
              )}
            </svg>

            {selectedPiece && mode === "select" && (
              <DraggablePanel key={`${selectedPiece.id}-${panelResetTick}`} corner="bl" className="card card-inner !p-3 flex items-center gap-3 shadow-lg">
                <div>
                  <p className="text-sm font-semibold text-ink-900">{selectedPiece.nom || PIECE_TYPES[selectedPiece.type].label}</p>
                  <p className="text-xs text-ink-400">{PIECE_TYPES[selectedPiece.type].label} · {aireDuPolygone(selectedPiece.contour).toFixed(1)} m² · {selectedPiece.appareillages.length} appareillage(s) · {selectedPiece.contour.length} sommets</p>
                </div>
                <button onClick={() => zoomSurPiece(selectedPiece)} className="btn-ghost !px-2 !py-1.5" title="Zoomer sur la pièce"><Search size={13} /></button>
                <button onClick={() => setEditingPiece(selectedPiece)} className="btn-ghost !px-2 !py-1.5"><Pencil size={13} /></button>
              </DraggablePanel>
            )}

            {selectedAppareillage && mode === "select" && (
              <DraggablePanel key={`${selectedAppareillage.id}-${panelResetTick}`} corner="bl" className="card card-inner !p-3 flex flex-col gap-2 shadow-lg w-72 max-h-[80vh] overflow-y-auto">
                <div className="flex items-center gap-2">
                  <AppareillageSymbol type={selectedAppareillage.type} size={22} />
                  <input className="input !py-1 !text-sm flex-1 min-w-0" placeholder={labelAppareillage(selectedAppareillage.type)}
                    value={selectedAppareillage.nom ?? ""}
                    onChange={e => renommerAppareillage(selectedAppareillage.id, e.target.value)} />
                  <button onClick={() => removerAppareillage(selectedAppareillage.id)} className="btn-danger !px-2 !py-1.5 shrink-0"><Trash2 size={13} /></button>
                </div>
                {niveauActif && niveauActif.pieces.length > 1 && (
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0">Pièce</span>
                    <select className="input !py-1 !text-xs flex-1"
                      value={pieceDeSelectedAppareillage?.id ?? ""}
                      onChange={e => deplacerAppareillageVersPiece(selectedAppareillage.id, Number(e.target.value))}>
                      {niveauActif.pieces.map(p => <option key={p.id} value={p.id}>{p.nom || PIECE_TYPES[p.type].label}</option>)}
                    </select>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="shrink-0">Hauteur (cm)</span>
                  <input type="number" className="input !py-1 !text-xs !w-20" placeholder="—"
                    value={selectedAppareillage.hauteur ?? ""}
                    onChange={e => modifierHauteur(selectedAppareillage.id, e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                {selectedAppareillage.type === "chauffage" && (
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0">Puissance (W)</span>
                    <input type="number" min={0} step={50} className="input !py-1 !text-xs !w-24" placeholder="1000"
                      value={selectedAppareillage.puissanceW ?? ""}
                      onChange={e => modifierPuissance(selectedAppareillage.id, e.target.value ? Number(e.target.value) : undefined)} />
                    <span className="text-ink-400">— regroupé par puissance (NF C 15-100)</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="shrink-0 w-16">Position X/Y</span>
                  <input type="number" step="0.01" className="input !py-1 !text-xs !w-20"
                    key={`${selectedAppareillage.id}-x-${dragEndTick}`}
                    defaultValue={selectedAppareillage.x.toFixed(2)}
                    onChange={e => { if (e.target.value !== "") modifierPositionExacte(selectedAppareillage.id, Number(e.target.value), selectedAppareillage.y); }} />
                  <input type="number" step="0.01" className="input !py-1 !text-xs !w-20"
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
                {(niveauActif?.circuitsManuels?.length ?? 0) > 0 && (
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
                {(["interrupteur", "va_et_vient", "telerupteur"] as AppareillageType[]).includes(selectedAppareillage.type) && (
                  <>
                    <button onClick={() => setPendingCommande({ item: selectedAppareillage, estNouveau: false })}
                      className="btn-ghost !text-xs justify-center">
                      Commande : {selectedAppareillage.commandePourIds?.length ?? 0} point(s) lumineux — modifier
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
                ) : resultat ? (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">Non raccordé à un circuit.</p>
                ) : null}
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

            {selectedOuvertureId != null && mode === "select" && (() => {
              const piece = niveauActif?.pieces.find(p => p.ouvertures?.some(o => o.id === selectedOuvertureId));
              const o = piece?.ouvertures?.find(o => o.id === selectedOuvertureId);
              if (!piece || !o) return null;
              return (
                <DraggablePanel key={`${o.id}-${panelResetTick}`} corner="bl" className="card card-inner !p-3 flex flex-col gap-2 shadow-lg w-64">
                  <div className="flex items-center gap-2">
                    <OuvertureIcon type={o.type} size={18} color="#1c1917" />
                    <p className="text-sm font-semibold text-ink-900 flex-1">{LABEL_OUVERTURE[o.type]}</p>
                    <button onClick={() => supprimerOuverture(o.id)} className="btn-danger !px-2 !py-1.5 shrink-0"><Trash2 size={13} /></button>
                  </div>
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
                            key={`ouv-${o.id}-distA-${dragEndTick}`} defaultValue={Math.round(distA)}
                            onChange={e => { if (e.target.value !== "") modifierDistanceBordOuverture(piece, o, "A", Number(e.target.value)); }} />
                        </div>
                        <div className="flex items-center gap-2 text-xs text-ink-500">
                          <span className="shrink-0 w-24">Depuis mur fin</span>
                          <input type="number" min={0} className="input !py-1 !text-xs !w-20"
                            key={`ouv-${o.id}-distB-${dragEndTick}`} defaultValue={Math.round(distB)}
                            onChange={e => { if (e.target.value !== "") modifierDistanceBordOuverture(piece, o, "B", Number(e.target.value)); }} />
                        </div>
                      </div>
                    );
                  })()}
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0 w-24">Hauteur (cm)</span>
                    <input type="number" min={30} className="input !py-1 !text-xs !w-20"
                      key={`ouv-${o.id}-hauteur-${dragEndTick}`} defaultValue={o.hauteur ?? (o.type === "porte" || o.type === "porte_coulissante" ? 204 : 120)}
                      onChange={e => { if (e.target.value !== "") modifierOuverture(o.id, { hauteur: Number(e.target.value) }); }} />
                  </div>
                  {(o.type === "fenetre" || o.type === "ouverture") && (
                    <div className="flex items-center gap-2 text-xs text-ink-500">
                      <span className="shrink-0 w-24">{o.type === "ouverture" ? "Départ / sol (cm)" : "Allège (cm)"}</span>
                      <input type="number" min={0} className="input !py-1 !text-xs !w-20"
                        key={`ouv-${o.id}-allege-${dragEndTick}`} defaultValue={o.allege ?? (o.type === "fenetre" ? 90 : 0)}
                        onChange={e => { if (e.target.value !== "") modifierOuverture(o.id, { allege: Number(e.target.value) }); }} />
                    </div>
                  )}
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
                  {o.type === "porte_coulissante" && (
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
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0">Pose</span>
                    <div className="flex gap-1 flex-1">
                      {(["encastre", "apparent"] as const).map(pose => (
                        <button key={pose} onClick={() => modifierPoseWaypoint(selectedWaypoint.cle, selectedWaypoint.waypointId, pose)}
                          className={`flex-1 !text-xs px-2 py-1 rounded-md border transition-colors ${
                            (wp.poseType ?? "encastre") === pose ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"
                          }`}>
                          {pose === "encastre" ? "Encastré" : "Apparent"}
                        </button>
                      ))}
                    </div>
                  </div>
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
                Clique dans une pièce pour placer : {labelAppareillage(placementType)}
              </div>
            )}
            {placingTableau && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-ink-900 text-volt-400 text-xs font-semibold px-3 py-2 rounded-lg shadow-lg">
                Clique pour positionner le tableau électrique
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
                    const estLumiere = b ? CIRCUITS[b.circuit]?.category === "lumiere" : manuel?.famille === "lumiere";
                    const labelStockage = b ? b.label : manuel!.nom; // clé pour boitesDerivation
                    const nomAffichage = b ? nomAffiche(b) : manuel!.nom;
                    const couleur = b ? (colorMap.get(b.id) ?? "#666666") : (manuel!.couleur ?? "#78716c");
                    const visible = b ? circuitsVisibles.has(b.id) : true;
                    const pointsCircuit = b ? (niveauActif?.pieces.flatMap(p => p.appareillages).filter(a => a.circuitId === b.id) ?? []) : [];
                    const lg = b && showLongueurs && niveauActif?.tableauPos && pointsCircuit.length > 0
                      ? longueurBranchesEclairage(segmentsPourCircuit(b, pointsCircuit, niveauActif, niveauActif.tableauPos), niveauActif.liaisonWaypoints)
                      : null;
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
                        {lg !== null && <span className="font-mono text-ink-400 shrink-0">{lg.toFixed(1)}m</span>}
                        {!b && <span className="text-[9px] text-ink-400 shrink-0 italic whitespace-nowrap">à générer</span>}
                        {manuel?.nonRelieTableau && <span className="text-[9px] text-sky-600 shrink-0" title="Circuit déjà existant, non relié au tableau">🔗✕</span>}
                        {b && CIRCUITS[b.circuit]?.category !== "lumiere" && (
                          <button onClick={e => { e.preventDefault(); e.stopPropagation(); demarrerDessinCheminement(b); }}
                            className="btn-ghost !p-0.5 shrink-0" title="Dessiner le cheminement">
                            <Route size={12} />
                          </button>
                        )}
                        {estLumiere && (
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

          {!vue3D && (
          <div className="hidden lg:flex lg:flex-col w-56 border-l border-ink-200 bg-white overflow-y-auto shrink-0 p-3">
            <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-2">Appareillages</p>
            <PaletteBoutons placementType={placementType} onSelect={armerPlacement} />
          </div>
          )}

          {!vue3D && paletteOpen && (
            <div className="lg:hidden fixed inset-0 z-40 flex justify-end" onClick={() => setPaletteOpen(false)}>
              <div className="absolute inset-0 bg-black/40" />
              <div className="relative w-72 max-w-[85vw] bg-white h-full overflow-y-auto p-3 shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide">Appareillages</p>
                  <button onClick={() => setPaletteOpen(false)} className="btn-ghost !px-2 !py-1"><X size={16} /></button>
                </div>
                <PaletteBoutons placementType={placementType} onSelect={t => { armerPlacement(t); setPaletteOpen(false); }} />
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-1.5 bg-ink-50 border-t border-ink-100 text-[11px] text-ink-400 hidden md:block shrink-0">
          {vue3D
            ? "Glisser = tourner la caméra · Clic droit (ou Maj + glisser) = déplacer la vue · Molette = zoom"
            : "Molette = zoom · Glisser le fond = déplacer la vue · En dessin : clic = ajouter un point, clic près du 1er point = fermer la pièce · Pièce sélectionnée : double-clic sur un sommet (rond orange) pour le supprimer (min. 3 sommets)"}
        </div>
      </div>

      {pendingContour && (
        <PieceForm
          initialNom="" initialType="autre"
          onValidate={(nom, type, hauteurPlafond) => {
            const nouvelle = nouvellePiece(pendingContour, nom, type);
            nouvelle.hauteurPlafond = hauteurPlafond;
            updateNiveauActif(n => ({ ...n, pieces: [...n.pieces, nouvelle] }));
            setPendingContour(null);
            invalidateResultat();
          }}
          onCancel={() => setPendingContour(null)}
        />
      )}

      {editingPiece && (
        <PieceForm
          initialNom={editingPiece.nom} initialType={editingPiece.type} initialHauteurPlafond={editingPiece.hauteurPlafond}
          onValidate={(nom, type, hauteurPlafond) => {
            updateNiveauActif(n => ({ ...n, pieces: n.pieces.map(p => p.id === editingPiece.id ? { ...p, nom, type, hauteurPlafond } : p) }));
            setEditingPiece(null);
          }}
          onCancel={() => setEditingPiece(null)}
          onDelete={() => {
            updateNiveauActif(n => ({ ...n, pieces: n.pieces.filter(p => p.id !== editingPiece.id) }));
            setSelectedPieceId(null);
            setEditingPiece(null);
            invalidateResultat();
          }}
        />
      )}

      {showNiveauForm && (
        <NiveauForm
          onValidate={(nom, type, hauteurPlafond) => {
            const nouveau = nouveauNiveau(type, niveaux.length);
            nouveau.nom = nom;
            nouveau.hauteurPlafond = hauteurPlafond;
            setNiveaux(nvs => [...nvs, nouveau]);
            setNiveauActifId(nouveau.id);
            setShowNiveauForm(false);
          }}
          onCancel={() => setShowNiveauForm(false)}
        />
      )}

      {pendingCommande && niveauActif && (
        <CommandeLinkForm
          niveau={niveauActif} item={pendingCommande.item}
          onValidate={pointLumineuxIds => lierCommande(pendingCommande.item.id, pointLumineuxIds)}
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
            longueurActuelle={distance(a, b)}
            onValidate={appliquerLongueurSegment}
            onCancel={() => setEditingSegment(null)}
          />
        );
      })()}

      {showPrintForm && (
        <PrintForm
          niveaux={niveaux} resultatDisponible={!!resultat}
          onValider={(piecesSelectionnees, avecCircuits, avecLongueurs, avecHauteurs) => {
            setShowPrintForm(false);
            imprimerPlan(niveaux, client?.nom ?? "", resultat, avecCircuits, avecLongueurs, avecHauteurs, piecesSelectionnees);
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
