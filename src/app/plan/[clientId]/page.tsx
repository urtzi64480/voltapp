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
  Zap, Sparkles, Eye, EyeOff, ArrowRightCircle, AlertTriangle, Search,
} from "lucide-react";
import {
  Point, Piece, Niveau, PieceType, NiveauType, AppareillagePlace, AppareillageType,
  Ouverture, OuvertureType, nouvelleOuverture, positionSurSegment, OuvertureEffective, ouverturesEffectivesMur,
  NIVEAU_TYPES, PIECE_TYPES, aireDuPolygone, centroide, trouverPiece, distance, ajusterLongueurContour,
  distanceAuSegment, positionnerADistanceDuSegment,
  CircuitManuel, FamilleCircuitManuel, FAMILLES_CIRCUIT_MANUEL, familleCircuitManuelAppareillage,
  nouveauNiveau, nouvellePiece, nouvelAppareillage, uidMaison, reamorcerCompteurId, dedupliquerIds,
  LiaisonWaypoint, sequenceAncresCircuit, cleSegmentLiaison, construireCheminCircuit, longueurCircuitAvecWaypoints,
} from "@/lib/maison-types";
import { AppareillageSymbol, appareillageSymbolSvgString, PALETTE, labelAppareillage } from "@/components/plan/AppareillageSymbols";
import Vue3D, { Vue3DHandle } from "@/components/plan/Vue3D";
import { genererCircuits, assemblerTableau, remapperIdsRows, maxIdRows, genererGainesNiveaux, construireColorMap, ResultatGeneration, TronconGaine } from "@/lib/maison-engine";
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

function rendreSVGImprimable(n: Niveau, resultat: ResultatGeneration | null, showCircuits: boolean, piecesSelectionnees: Set<number> | null): string {
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
  const colorMap = resultat ? construireColorMap(resultat) : new Map<number, string>();

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

  if (showCircuits && resultat && n.tableauPos) {
    const tousAppareils = niveauResultat.pieces.flatMap(p => p.appareillages);
    const parCircuit = new Map<number, AppareillagePlace[]>();
    tousAppareils.forEach(a => {
      if (a.circuitId == null) return;
      const arr = parCircuit.get(a.circuitId) ?? [];
      arr.push(a);
      parCircuit.set(a.circuitId, arr);
    });
    parCircuit.forEach((points, circuitId) => {
      const color = colorMap.get(circuitId) ?? "#666";
      const chemin = construireCheminCircuit(n.tableauPos!, points, n.liaisonWaypoints).map(toPx);
      const d = chemin.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
      s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.2" stroke-dasharray="3,2" opacity="0.85"/>`;
    });
  }

  niveauResultat.pieces.forEach(p => {
    p.appareillages.forEach(a => {
      const pos = toPx({ x: a.x, y: a.y });
      const color = showCircuits && a.circuitId != null ? (colorMap.get(a.circuitId) ?? "#1c1917") : "#1c1917";
      s += appareillageSymbolSvgString(a.type, pos.x, pos.y, 10, color);
    });
  });

  if (n.tableauPos) {
    const pos = toPx(n.tableauPos);
    s += `<rect x="${(pos.x - 6).toFixed(1)}" y="${(pos.y - 6).toFixed(1)}" width="12" height="12" rx="2" fill="#1c1917"/>`;
    s += `<text x="${pos.x.toFixed(1)}" y="${(pos.y + 3).toFixed(1)}" font-size="8" text-anchor="middle" fill="#FBBF24">⚡</text>`;
  }

  s += `</svg>`;
  return s;
}

function couleurTaux(tauxPct: number): string {
  return tauxPct <= 20 ? "#059669" : tauxPct <= 33 ? "#D97706" : "#DC2626";
}

function gaineNiveauHtml(troncon: TronconGaine | undefined): string {
  if (!troncon) return "";
  return `<div style="margin:0 6mm 6mm;font-size:8pt;font-family:monospace;color:#333;display:flex;align-items:center;gap:6px;">
    <span>🔀 Gaine principale : <strong>${escapeXml(troncon.gaine)}</strong></span>
    <span style="color:${couleurTaux(troncon.tauxPct)};font-weight:bold;">${troncon.tauxPct}% de remplissage</span>
    <span style="color:#888;">(${troncon.circuits.length} circuit${troncon.circuits.length > 1 ? "s" : ""} regroupés Tableau → niveau)</span>
  </div>`;
}

function legendeCircuitsHtml(resultat: ResultatGeneration | null, niveau: Niveau, showLongueurs: boolean): string {
  if (!resultat) return "";
  const nomsPieces = new Set(niveau.pieces.map(p => p.nom));
  const colorMap = construireColorMap(resultat);
  const utilises = resultat.breakers
    .map(b => ({ b, color: colorMap.get(b.id) ?? "#666" }))
    .filter(({ b }) => b.pieces.some(p => nomsPieces.has(p.nom)));
  if (utilises.length === 0) return "";
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:0 6mm 6mm;font-size:8pt;font-family:monospace;">` +
    utilises.map(({ b, color }) => {
      let lgTxt = "";
      if (showLongueurs && niveau.tableauPos) {
        const pts = niveau.pieces.flatMap(p => p.appareillages).filter(a => a.circuitId === b.id);
        if (pts.length > 0) lgTxt = ` — ${longueurCircuitAvecWaypoints(niveau.tableauPos, pts, niveau.liaisonWaypoints).toFixed(1)}m`;
      }
      return `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;"></span>${escapeXml(b.label || CIRCUITS[b.circuit]?.label || b.circuit)}${lgTxt}</span>`;
    }).join("") + `</div>`;
}

function imprimerPlan(
  niveaux: Niveau[], clientName: string, resultat: ResultatGeneration | null,
  showCircuits: boolean, showLongueurs: boolean, piecesSelectionnees: Set<number> | null,
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
    html += rendreSVGImprimable(n, resultat, showCircuits, piecesSelectionnees);
    if (showCircuits) {
      html += legendeCircuitsHtml(resultat, niveauResultat, showLongueurs);
      const troncon = gainesNiveaux.find(g => g.niveau === (n.nom || n.type));
      html += gaineNiveauHtml(troncon);
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
  onValider: (piecesSelectionnees: Set<number> | null, avecCircuits: boolean, avecLongueurs: boolean) => void;
  onCancel: () => void;
}) {
  const toutesPieces = niveaux.flatMap(n => n.pieces.map(p => p.id));
  const [selection, setSelection] = useState<Set<number>>(new Set(toutesPieces));
  const [avecCircuits, setAvecCircuits] = useState(resultatDisponible);
  const [avecLongueurs, setAvecLongueurs] = useState(false);
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
          {resultatDisponible && (
            <div className="flex flex-col gap-1.5 pt-2 border-t border-ink-100">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={avecCircuits} onChange={e => setAvecCircuits(e.target.checked)} />
                <span className="text-sm text-ink-700">Inclure les circuits (couleurs + gaines)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={avecLongueurs} disabled={!avecCircuits} onChange={e => setAvecLongueurs(e.target.checked)} />
                <span className={`text-sm ${avecCircuits ? "text-ink-700" : "text-ink-300"}`}>Afficher la longueur de chaque circuit</span>
              </label>
            </div>
          )}
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200 shrink-0">
          <button disabled={selection.size === 0}
            onClick={() => onValider(toutSelectionne ? null : selection, avecCircuits, avecLongueurs)}
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
  const [editingPiece, setEditingPiece] = useState<Piece | null>(null);
  const [editingSegment, setEditingSegment] = useState<{ pieceId: number; segIndex: number } | null>(null);
  const [snapGuide, setSnapGuide] = useState<{ x?: number; y?: number } | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>({ kind: "none" });

  const [placementType, setPlacementType] = useState<AppareillageType | null>(null);
  const [placingTableau, setPlacingTableau] = useState(false);
  const [pendingCommande, setPendingCommande] = useState<{ item: AppareillagePlace; estNouveau: boolean } | null>(null);
  const [selectedAppareillageId, setSelectedAppareillageId] = useState<number | null>(null);
  // Incrémenté à chaque fin de geste de déplacement — sert uniquement de "key" pour forcer
  // les champs de position/distance à se resynchroniser avec la géométrie après un drag,
  // sans jamais les resynchroniser pendant la frappe (ce qui bloquait l'effacement).
  const [dragEndTick, setDragEndTick] = useState(0);
  const [selectedTableau, setSelectedTableau] = useState(false);
  const [placingOuverture, setPlacingOuverture] = useState<OuvertureType | null>(null);
  const [ouvertureMenuOpen, setOuvertureMenuOpen] = useState(false);
  const [selectedOuvertureId, setSelectedOuvertureId] = useState<number | null>(null);
  const [circuitsManuelsOpen, setCircuitsManuelsOpen] = useState(false);
  const [selectedWaypoint, setSelectedWaypoint] = useState<{ cle: string; waypointId: number } | null>(null);
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [resultat, setResultat] = useState<ResultatGeneration | null>(null);
  const [showCircuits, setShowCircuits] = useState(false);
  const [showLongueurs, setShowLongueurs] = useState(false);
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
      // "pan" (clic dans le vide / déplacement de la vue), "liaison" (coude) et
      // "ouverture" (porte/fenêtre, sans impact électrique) ne changent jamais la
      // composition électrique du plan — les exclure évite de réinitialiser les
      // circuits générés à chaque simple clic ou déplacement d'ouverture.
      if (dragMode.kind !== "liaison" && dragMode.kind !== "pan" && dragMode.kind !== "ouverture") invalidateResultat();
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

  const entrerModeDessiner = () => {
    setMode("dessiner"); setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null);
    setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null);
  };
  const armerPlacement = (t: AppareillageType | null) => {
    setPlacementType(t); setMode("select"); setPlacingTableau(false); setPlacingOuverture(null); setDrawingPoints([]);
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null);
  };
  const armerPlacementTableau = () => {
    setPlacingTableau(true); setMode("select"); setPlacementType(null); setPlacingOuverture(null); setDrawingPoints([]);
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null);
  };
  const armerPlacementOuverture = (t: OuvertureType | null) => {
    setPlacingOuverture(t); setMode("select"); setPlacementType(null); setPlacingTableau(false); setDrawingPoints([]);
    setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null);
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

  // ─── OUVERTURES (portes/fenêtres) ──────────────────────────────────────────────
  // Aucun impact électrique — ne déclenchent jamais invalidateResultat().

  const supprimerOuverture = (ouvertureId: number) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({ ...p, ouvertures: (p.ouvertures ?? []).filter(o => o.id !== ouvertureId) })),
    }));
    setSelectedOuvertureId(null);
  };
  const modifierOuverture = (ouvertureId: number, patch: Partial<Pick<Ouverture, "largeur" | "hauteur" | "allege" | "charniere" | "ouvreVersInterieur" | "coulisseVers">>) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p, ouvertures: (p.ouvertures ?? []).map(o => o.id === ouvertureId ? { ...o, ...patch } : o),
      })),
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

  const modifierHauteur = (appareillageId: number, hauteur: number | undefined) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.map(a => a.id === appareillageId ? { ...a, hauteur } : a),
      })),
    }));
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

  // ─── CIRCUITS MANUELS ────────────────────────────────────────────────────────

  const ajouterCircuitManuel = (famille: FamilleCircuitManuel) => {
    const nouveau: CircuitManuel = { id: uidMaison(), nom: `${FAMILLES_CIRCUIT_MANUEL[famille]} — nouveau`, famille };
    updateNiveauActif(n => ({ ...n, circuitsManuels: [...(n.circuitsManuels ?? []), nouveau] }));
    invalidateResultat();
  };
  const renommerCircuitManuel = (manuelId: number, nom: string) => {
    updateNiveauActif(n => ({
      ...n, circuitsManuels: (n.circuitsManuels ?? []).map(m => m.id === manuelId ? { ...m, nom } : m),
    }));
  };
  const changerCouleurCircuitManuel = (manuelId: number, couleur: string) => {
    updateNiveauActif(n => ({
      ...n, circuitsManuels: (n.circuitsManuels ?? []).map(m => m.id === manuelId ? { ...m, couleur } : m),
    }));
  };
  const supprimerCircuitManuel = (manuelId: number) => {
    updateNiveauActif(n => ({
      ...n,
      circuitsManuels: (n.circuitsManuels ?? []).filter(m => m.id !== manuelId),
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.map(a => a.circuitManuelId === manuelId ? { ...a, circuitManuelId: undefined } : a),
      })),
    }));
    invalidateResultat();
  };
  // Rattache (ou détache, avec undefined) un appareillage à un circuit manuel — prioritaire
  // sur le clustering automatique une fois "Générer les circuits" relancé.
  const assignerCircuitManuel = (appareillageId: number, manuelId: number | undefined) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p, appareillages: p.appareillages.map(a => a.id === appareillageId ? { ...a, circuitManuelId: manuelId } : a),
      })),
    }));
    invalidateResultat();
  };
  // Couleur d'un circuit déjà généré (manuel ou automatique) — voir construireColorMap
  // (maison-engine.ts) pour la logique de résolution symétrique.
  const definirCouleurCircuit = (b: Breaker, couleur: string) => {
    if (b.manuelId != null) {
      changerCouleurCircuitManuel(b.manuelId, couleur);
    } else {
      updateNiveauActif(n => ({ ...n, couleursCircuits: { ...(n.couleursCircuits ?? {}), [b.label]: couleur } }));
    }
  };

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
    setSelectedOuvertureId(null);
    setSelectedWaypoint(null);
    setDragMode({ kind: "pan", startX: e.clientX, startY: e.clientY, startPan: pan });
  };

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    if (mode !== "dessiner") return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCursorPx({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const onPieceDown = (piece: Piece, e: React.PointerEvent) => {
    if (mode === "dessiner" || placementType || placingTableau || placingOuverture) return;
    e.stopPropagation();
    if (selectedPieceId === piece.id) {
      setDragMode({ kind: "piece", pieceId: piece.id, startX: e.clientX, startY: e.clientY, startContour: piece.contour });
    } else {
      setSelectedPieceId(piece.id);
      setSelectedAppareillageId(null);
      setSelectedTableau(false);
      setSelectedOuvertureId(null);
      setSelectedWaypoint(null);
    }
  };

  const onVertexDown = (pieceId: number, index: number, e: React.PointerEvent) => {
    e.stopPropagation();
    setDragMode({ kind: "vertex", pieceId, vertexIndex: index });
  };

  const onAppareillagePointerDown = (piece: Piece, a: AppareillagePlace, e: React.PointerEvent) => {
    if (mode !== "select" || placementType || placingTableau || placingOuverture) return;
    e.stopPropagation();
    // Sélectionne ET arme le déplacement dès le premier appui (comme un vrai
    // glisser-déposer) : un simple clic sans bouger équivaut juste à une sélection,
    // puisque le déplacement ne prend effet qu'au premier pointermove.
    setSelectedAppareillageId(a.id);
    setSelectedTableau(false);
    setSelectedPieceId(null);
    setSelectedOuvertureId(null);
    setSelectedWaypoint(null);
    setDragMode({ kind: "appareillage", pieceId: piece.id, appareillageId: a.id });
  };

  const onTableauPointerDown = (e: React.PointerEvent) => {
    if (mode !== "select" || placementType || placingTableau || placingOuverture) return;
    e.stopPropagation();
    setSelectedTableau(true);
    setSelectedPieceId(null);
    setSelectedAppareillageId(null);
    setSelectedOuvertureId(null);
    setSelectedWaypoint(null);
    setDragMode({ kind: "tableau" });
  };

  const onOuverturePointerDown = (piece: Piece, o: Ouverture, e: React.PointerEvent) => {
    if (mode !== "select" || placementType || placingTableau || placingOuverture) return;
    e.stopPropagation();
    setSelectedOuvertureId(o.id);
    setSelectedPieceId(null);
    setSelectedAppareillageId(null);
    setSelectedTableau(false);
    setSelectedWaypoint(null);
    setDragMode({ kind: "ouverture", pieceId: piece.id, ouvertureId: o.id });
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
    const nouvellesRows = assemblerTableau(resultat.breakers);
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
    setPushMsg(`${remap.length} rangée(s) et ${resultat.breakers.length} circuit(s) mis à jour dans le tableau.`);
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

  const colorMap = resultat ? construireColorMap(resultat) : new Map<number, string>();

  const symSize = Math.min(28, Math.max(11, 16 * zoom));

  const circuitsNiveauActif = niveauActif
    ? resultat?.breakers.filter(b => b.pieces.some(pc => niveauActif.pieces.some(p => p.nom === pc.nom))) ?? []
    : [];

  const gainesNiveaux = resultat ? genererGainesNiveaux(resultat) : [];
  const gaineNiveauActif = niveauActif
    ? gainesNiveaux.find(g => g.niveau === (niveauActif.nom || niveauActif.type))
    : undefined;
  const couleurTauxUi = (t: number) => (t <= 20 ? "text-emerald-600 bg-emerald-50 border-emerald-200" : t <= 33 ? "text-amber-600 bg-amber-50 border-amber-200" : "text-red-600 bg-red-50 border-red-200");

  if (loading) return <Shell><div className="flex items-center justify-center h-64 text-ink-400">Chargement…</div></Shell>;

  return (
    <Shell>
      <div className="flex flex-col h-[calc(100vh-4rem)] md:h-screen overflow-hidden">
        <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-ink-200 bg-white shrink-0 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href={`/clients/${clientId}`} className="btn-ghost !px-2 !py-1.5 text-ink-400"><ArrowLeft size={16} /></Link>
            <div>
              <h1 className="font-display text-lg text-ink-900 leading-tight">Plan de circuits</h1>
              {client && <p className="text-xs text-ink-400">{client.prenom ? `${client.prenom} ${client.nom}` : client.nom}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button onClick={() => setVue3D(v => !v)} className={`btn-ghost ${vue3D ? "!bg-ink-900 !text-volt-400" : ""}`}>
              {vue3D ? "Vue 2D" : "Vue 3D"}
            </button>
            {vue3D ? (
              <button onClick={() => setShow3DPrintForm(true)} className="btn-ghost"><Printer size={15} /> Imprimer la vue 3D</button>
            ) : (
              <button onClick={() => setShowPrintForm(true)} className="btn-ghost"><Printer size={15} /> Imprimer</button>
            )}
            <button onClick={handleSave} disabled={saving} className={`btn-volt ${saved ? "!bg-emerald-500 !border-emerald-600 !text-white" : ""}`}>
              <Save size={15} />{saving ? "…" : saved ? "Sauvegardé !" : "Sauvegarder"}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-4 md:px-6 py-2 border-b border-ink-100 bg-ink-50 overflow-x-auto shrink-0">
          {[...niveaux].sort((a, b) => a.ordre - b.ordre).map(n => (
            <button key={n.id} onClick={() => { setNiveauActifId(n.id); setSelectedPieceId(null); setSelectedAppareillageId(null); setSelectedTableau(false); setSelectedOuvertureId(null); }}
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

        {!vue3D && (
        <div className="flex items-center gap-2 px-4 md:px-6 py-2 border-b border-ink-100 shrink-0 flex-wrap">
          <button onClick={() => { setMode("select"); setDrawingPoints([]); setPlacementType(null); setPlacingTableau(false); setPlacingOuverture(null); }}
            className={`btn-ghost !text-xs ${mode === "select" && !placementType && !placingTableau && !placingOuverture ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <MousePointer2 size={13} /> Sélection
          </button>
          <button onClick={entrerModeDessiner} className={`btn-ghost !text-xs ${mode === "dessiner" ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <Pencil size={13} /> Dessiner une pièce
          </button>
          <button onClick={armerPlacementTableau} className={`btn-ghost !text-xs ${placingTableau ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <Zap size={13} /> Position tableau
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
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => zoomBtn(-1)} className="btn-ghost !px-2 !py-1.5"><ZoomOut size={14} /></button>
            <span className="text-xs font-mono text-ink-400 w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => zoomBtn(1)} className="btn-ghost !px-2 !py-1.5"><ZoomIn size={14} /></button>
          </div>
        </div>
        )}

        <div className="flex items-center gap-2 px-4 md:px-6 py-2 border-b border-ink-100 shrink-0 flex-wrap bg-ink-50">
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
              🔀 Gaine principale : {gaineNiveauActif.gaine} · {gaineNiveauActif.tauxPct}%
            </span>
          )}
          {resultat && !niveauActif?.tableauPos && (
            <span className="text-[11px] text-amber-600 font-semibold">Positionne le tableau pour voir le tracé des gaines</span>
          )}
          {pushMsg && (
            <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-2">
              {pushMsg} <Link href={`/tableau/${clientId}`} className="underline">Voir le tableau →</Link>
            </span>
          )}
        </div>

        {resultat && resultat.alertes.length > 0 && (
          <div className="px-4 md:px-6 py-2 bg-amber-50 border-b border-amber-200 flex items-start gap-2 shrink-0 max-h-24 overflow-y-auto">
            <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
            <div className="flex flex-col gap-0.5">
              {resultat.alertes.map((a, i) => <p key={i} className="text-[11px] text-amber-700">{a}</p>)}
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
              style={{ touchAction: "none", cursor: mode === "dessiner" || placementType || placingTableau ? "crosshair" : "grab" }}
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
                      return <circle key={i} cx={p.x} cy={p.y} r={6} fill="#fff" stroke="#F59E0B" strokeWidth={2} style={{ cursor: "grab" }} onPointerDown={e => onVertexDown(piece.id, i, e)} />;
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
                  if (a.circuitId == null) return;
                  const arr = parCircuit.get(a.circuitId) ?? [];
                  arr.push(a);
                  parCircuit.set(a.circuitId, arr);
                });
                return Array.from(parCircuit.entries()).flatMap(([circuitId, points]) => {
                  const color = colorMap.get(circuitId) ?? "#666";
                  const sequence = sequenceAncresCircuit(tableauPos, points);
                  const elements: ReactNode[] = [];
                  for (let i = 0; i < sequence.length - 1; i++) {
                    const cle = cleSegmentLiaison(sequence[i].id, sequence[i + 1].id);
                    const coudes = waypointsNiveau?.[cle] ?? [];
                    // Sous-chaîne du segment : point de départ, coudes existants, point d'arrivée.
                    const sousChaine = [sequence[i].point, ...coudes.map(c => c.point), sequence[i + 1].point];
                    for (let j = 0; j < sousChaine.length - 1; j++) {
                      const aPx = toScreen(sousChaine[j]), bPx = toScreen(sousChaine[j + 1]);
                      elements.push(<line key={`${cle}-${j}`} x1={aPx.x} y1={aPx.y} x2={bPx.x} y2={bPx.y} stroke={color} strokeWidth={2} strokeDasharray="6,4" opacity={0.8} />);
                      if (mode === "select") {
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
                            if (mode !== "select") return;
                            e.stopPropagation();
                            // Sélectionne ET arme le déplacement dès le premier appui, comme les
                            // appareillages et le tableau — un simple clic sans bouger reste une
                            // sélection puisque le déplacement ne prend effet qu'au premier pointermove.
                            setSelectedWaypoint({ cle, waypointId: c.id });
                            setSelectedPieceId(null);
                            setSelectedAppareillageId(null);
                            setSelectedTableau(false);
                            setDragMode({ kind: "liaison", cle, waypointId: c.id });
                          }}
                          onDoubleClick={e => { e.stopPropagation(); supprimerWaypoint(cle, c.id); }}>
                          <circle cx={cPx.x} cy={cPx.y} r={14} fill={estSel ? "#FEF3C7" : "transparent"} stroke="none" />
                          <rect x={cPx.x - 5} y={cPx.y - 5} width={10} height={10} rx={2}
                            fill={estSel ? "#F59E0B" : "#fff"} stroke={color} strokeWidth={2} style={{ pointerEvents: "none" }} />
                        </g>
                      );
                    });
                  }
                  return elements;
                });
              })()}

              {niveauActif?.pieces.flatMap(piece => piece.appareillages.map(a => ({ piece, a }))).map(({ piece, a }) => {
                const p = toScreen({ x: a.x, y: a.y });
                const isSel = a.id === selectedAppareillageId;
                const color = showCircuits && a.circuitId != null ? (colorMap.get(a.circuitId) ?? "#1c1917") : (isSel ? "#F59E0B" : "#1c1917");
                // Cible de clic généreuse et indépendante du zoom (invisible, sous l'icône) :
                // l'icône réelle peut être fine, la zone cliquable reste toujours confortable.
                const rZoneClic = Math.max(16, symSize / 2 + 7);
                return (
                  <g key={a.id}
                    onPointerDown={e => onAppareillagePointerDown(piece, a, e)}
                    style={{ cursor: mode === "select" && !placementType && !placingTableau && !placingOuverture ? (isSel ? "grab" : "pointer") : "default" }}>
                    <circle cx={p.x} cy={p.y} r={rZoneClic} fill={isSel ? "#FEF3C7" : "transparent"} stroke="none" />
                    <g transform={`translate(${p.x - symSize / 2}, ${p.y - symSize / 2})`} style={{ pointerEvents: "none" }}>
                      <AppareillageSymbol type={a.type} size={symSize} color={color} />
                    </g>
                    {isSel && <circle cx={p.x} cy={p.y} r={rZoneClic} fill="none" stroke="#F59E0B" strokeWidth={1.5} />}
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
                return (
                  <g onPointerDown={onTableauPointerDown}
                    style={{ cursor: mode === "select" && !placementType && !placingTableau && !placingOuverture ? (selectedTableau ? "grab" : "pointer") : "default" }}>
                    <circle cx={p.x} cy={p.y} r={rZoneClic} fill={selectedTableau ? "#FEF3C7" : "transparent"} stroke="none" />
                    <g transform={`translate(${p.x - 12}, ${p.y - 12})`} style={{ pointerEvents: "none" }}>
                      <rect width="24" height="24" rx="4" fill="#1c1917" />
                      <text x="12" y="16" textAnchor="middle" fontSize="14" fill="#FBBF24">⚡</text>
                    </g>
                    {selectedTableau && <circle cx={p.x} cy={p.y} r={rZoneClic} fill="none" stroke="#F59E0B" strokeWidth={1.5} />}
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
              <div className="absolute bottom-4 left-4 card card-inner !p-3 flex items-center gap-3 shadow-lg">
                <div>
                  <p className="text-sm font-semibold text-ink-900">{selectedPiece.nom || PIECE_TYPES[selectedPiece.type].label}</p>
                  <p className="text-xs text-ink-400">{PIECE_TYPES[selectedPiece.type].label} · {aireDuPolygone(selectedPiece.contour).toFixed(1)} m² · {selectedPiece.appareillages.length} appareillage(s)</p>
                </div>
                <button onClick={() => zoomSurPiece(selectedPiece)} className="btn-ghost !px-2 !py-1.5" title="Zoomer sur la pièce"><Search size={13} /></button>
                <button onClick={() => setEditingPiece(selectedPiece)} className="btn-ghost !px-2 !py-1.5"><Pencil size={13} /></button>
              </div>
            )}

            {selectedAppareillage && mode === "select" && (
              <div className="absolute bottom-4 left-4 card card-inner !p-3 flex flex-col gap-2 shadow-lg w-72 max-h-[80vh] overflow-y-auto">
                <div className="flex items-center gap-2">
                  <AppareillageSymbol type={selectedAppareillage.type} size={22} />
                  <input className="input !py-1 !text-sm flex-1 min-w-0" placeholder={labelAppareillage(selectedAppareillage.type)}
                    value={selectedAppareillage.nom ?? ""}
                    onChange={e => renommerAppareillage(selectedAppareillage.id, e.target.value)} />
                  <button onClick={() => removerAppareillage(selectedAppareillage.id)} className="btn-danger !px-2 !py-1.5 shrink-0"><Trash2 size={13} /></button>
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="shrink-0">Hauteur (cm)</span>
                  <input type="number" className="input !py-1 !text-xs !w-20" placeholder="—"
                    value={selectedAppareillage.hauteur ?? ""}
                    onChange={e => modifierHauteur(selectedAppareillage.id, e.target.value ? Number(e.target.value) : undefined)} />
                </div>
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
                {pieceDeSelectedAppareillage && (() => {
                  const famille = familleCircuitManuelAppareillage(selectedAppareillage.type, pieceDeSelectedAppareillage.type);
                  if (!famille) return null;
                  const options = (niveauActif?.circuitsManuels ?? []).filter(m => m.famille === famille);
                  return (
                    <div className="flex items-center gap-2 text-xs text-ink-500 border-t border-ink-100 pt-2">
                      <span className="shrink-0">Circuit</span>
                      <select className="input !py-1 !text-xs flex-1"
                        value={selectedAppareillage.circuitManuelId ?? ""}
                        onChange={e => assignerCircuitManuel(selectedAppareillage.id, e.target.value ? Number(e.target.value) : undefined)}>
                        <option value="">Automatique</option>
                        {options.map(m => <option key={m.id} value={m.id}>{m.nom}</option>)}
                      </select>
                    </div>
                  );
                })()}
                {(["interrupteur", "va_et_vient", "telerupteur"] as AppareillageType[]).includes(selectedAppareillage.type) && (
                  <button onClick={() => setPendingCommande({ item: selectedAppareillage, estNouveau: false })}
                    className="btn-ghost !text-xs justify-center">
                    Commande : {selectedAppareillage.commandePourIds?.length ?? 0} point(s) lumineux — modifier
                  </button>
                )}
                {selectedAppareillage.circuitId != null && (
                  <p className="text-xs text-ink-400">Circuit : {resultat?.breakers.find(b => b.id === selectedAppareillage.circuitId)?.label}</p>
                )}
              </div>
            )}

            {selectedTableau && niveauActif?.tableauPos && mode === "select" && (
              <div className="absolute bottom-4 left-4 card card-inner !p-3 flex flex-col gap-2 shadow-lg w-64">
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
                <p className="text-[11px] text-ink-400">Glisse-le directement sur le plan pour le repositionner.</p>
              </div>
            )}

            {selectedOuvertureId != null && mode === "select" && (() => {
              const piece = niveauActif?.pieces.find(p => p.ouvertures?.some(o => o.id === selectedOuvertureId));
              const o = piece?.ouvertures?.find(o => o.id === selectedOuvertureId);
              if (!piece || !o) return null;
              return (
                <div className="absolute bottom-4 left-4 card card-inner !p-3 flex flex-col gap-2 shadow-lg w-64">
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
                </div>
              );
            })()}

            {selectedWaypoint && niveauActif && mode === "select" && (() => {
              const wp = niveauActif.liaisonWaypoints?.[selectedWaypoint.cle]?.find(w => w.id === selectedWaypoint.waypointId);
              if (!wp) return null;
              return (
                <div className="absolute bottom-4 left-4 card card-inner !p-3 flex items-center gap-2 shadow-lg">
                  <span className="text-xs text-ink-500 shrink-0">Coude — hauteur du câble (cm)</span>
                  <input type="number" className="input !py-1 !text-xs !w-20" placeholder="—"
                    value={wp.hauteur ?? ""}
                    onChange={e => modifierHauteurWaypoint(selectedWaypoint.cle, selectedWaypoint.waypointId, e.target.value ? Number(e.target.value) : undefined)} />
                  <button onClick={() => supprimerWaypoint(selectedWaypoint.cle, selectedWaypoint.waypointId)} className="btn-danger !px-2 !py-1.5 shrink-0"><Trash2 size={13} /></button>
                </div>
              );
            })()}

            {circuitsManuelsOpen && niveauActif && (
              <div className="absolute top-4 right-4 card card-inner !p-3 flex flex-col gap-2 shadow-lg w-80 max-h-[70vh] overflow-y-auto z-10">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink-900">Circuits manuels — {niveauActif.nom || NIVEAU_TYPES[niveauActif.type]}</p>
                  <button onClick={() => setCircuitsManuelsOpen(false)} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={14} /></button>
                </div>
                <p className="text-[11px] text-ink-400">
                  Crée un circuit nommé et coloré à la main, puis rattache-lui des appareillages depuis leur panneau (menu "Circuit"). Prioritaire sur le clustering automatique à la prochaine génération.
                </p>
                {(Object.keys(FAMILLES_CIRCUIT_MANUEL) as FamilleCircuitManuel[]).map(famille => {
                  const items = (niveauActif.circuitsManuels ?? []).filter(m => m.famille === famille);
                  return (
                    <div key={famille} className="flex flex-col gap-1.5 border-t border-ink-100 pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{FAMILLES_CIRCUIT_MANUEL[famille]}</span>
                        <button onClick={() => ajouterCircuitManuel(famille)} className="btn-ghost !px-1.5 !py-0.5 !text-[11px]"><Plus size={11} /> Ajouter</button>
                      </div>
                      {items.length === 0 && <p className="text-[11px] text-ink-300 italic">Aucun circuit manuel</p>}
                      {items.map(m => (
                        <div key={m.id} className="flex items-center gap-1.5">
                          <input type="color" title="Couleur du circuit"
                            className="w-5 h-5 shrink-0 rounded-full border-0 p-0 cursor-pointer overflow-hidden"
                            value={m.couleur ?? "#78716c"}
                            onChange={e => changerCouleurCircuitManuel(m.id, e.target.value)} />
                          <input className="input !py-1 !text-xs flex-1 min-w-0" value={m.nom}
                            onChange={e => renommerCircuitManuel(m.id, e.target.value)} />
                          <button onClick={() => supprimerCircuitManuel(m.id)} className="btn-danger !px-1.5 !py-1 shrink-0"><Trash2 size={11} /></button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
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

            {showCircuits && resultat && circuitsNiveauActif.length > 0 && (
              <div className="absolute bottom-4 right-4 card card-inner !p-3 max-w-[260px] max-h-56 overflow-y-auto shadow-lg">
                <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Circuits</p>
                <div className="flex flex-col gap-1">
                  {circuitsNiveauActif.map(b => {
                    const pointsCircuit = niveauActif?.pieces.flatMap(p => p.appareillages).filter(a => a.circuitId === b.id) ?? [];
                    const lg = showLongueurs && niveauActif?.tableauPos && pointsCircuit.length > 0
                      ? longueurCircuitAvecWaypoints(niveauActif.tableauPos, pointsCircuit, niveauActif.liaisonWaypoints)
                      : null;
                    return (
                      <div key={b.id} className="flex items-center gap-1.5 text-[11px] text-ink-600">
                        <input type="color" title="Choisir la couleur de ce circuit"
                          className="w-4 h-4 shrink-0 rounded-full border-0 p-0 cursor-pointer overflow-hidden"
                          value={colorMap.get(b.id) ?? "#666666"}
                          onChange={e => definirCouleurCircuit(b, e.target.value)} />
                        <span className="truncate flex-1">{b.label}</span>
                        {lg !== null && <span className="font-mono text-ink-400 shrink-0">{lg.toFixed(1)}m</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
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
            ? "Glisser = tourner la caméra · Molette = zoom"
            : "Molette = zoom · Glisser le fond = déplacer la vue · En dessin : clic = ajouter un point, clic près du 1er point = fermer la pièce"}
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
          onValider={(piecesSelectionnees, avecCircuits, avecLongueurs) => {
            setShowPrintForm(false);
            imprimerPlan(niveaux, client?.nom ?? "", resultat, avecCircuits, avecLongueurs, piecesSelectionnees);
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
    </Shell>
  );
}
