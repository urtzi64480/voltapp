"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Client } from "@/types";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import {
  ArrowLeft, Save, Printer, Plus, Trash2, Pencil, ZoomIn, ZoomOut, MousePointer2, X,
  Zap, Sparkles, Eye, EyeOff, ArrowRightCircle, AlertTriangle,
} from "lucide-react";
import {
  Point, Piece, Niveau, PieceType, NiveauType, AppareillagePlace, AppareillageType,
  NIVEAU_TYPES, PIECE_TYPES, aireDuPolygone, centroide, trouverPiece, distance, ajusterLongueurContour,
  nouveauNiveau, nouvellePiece, nouvelAppareillage, couleurCircuit, ordonnerParProximite,
} from "@/lib/maison-types";
import { AppareillageSymbol, appareillageSymbolSvgString, PALETTE, labelAppareillage } from "@/components/plan/AppareillageSymbols";
import { genererCircuits, assemblerTableau, remapperIdsRows, maxIdRows, genererGainesNiveaux, ResultatGeneration, TronconGaine } from "@/lib/maison-engine";
import { CIRCUITS } from "@/lib/electrical-constants";

const PX_PER_M = 60;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── IMPRESSION ─────────────────────────────────────────────────────────────────

function rendreSVGImprimable(n: Niveau, resultat: ResultatGeneration | null, showCircuits: boolean): string {
  const allPts = [
    ...n.pieces.flatMap(p => p.contour),
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

  const niveauResultat = resultat?.maison.niveaux.find(rn => rn.id === n.id) ?? n;
  const colorMap = new Map<number, string>();
  if (resultat) resultat.breakers.forEach((b, i) => colorMap.set(b.id, couleurCircuit(i)));

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
      const ordonnes = ordonnerParProximite(n.tableauPos!, points);
      const chemin = [n.tableauPos!, ...ordonnes].map(toPx);
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

function legendeCircuitsHtml(resultat: ResultatGeneration | null, niveau: Niveau): string {
  if (!resultat) return "";
  const nomsPieces = new Set(niveau.pieces.map(p => p.nom));
  const utilises = resultat.breakers
    .map((b, i) => ({ b, color: couleurCircuit(i) }))
    .filter(({ b }) => b.pieces.some(p => nomsPieces.has(p.nom)));
  if (utilises.length === 0) return "";
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:0 6mm 6mm;font-size:8pt;font-family:monospace;">` +
    utilises.map(({ b, color }) =>
      `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;"></span>${escapeXml(b.label || CIRCUITS[b.circuit]?.label || b.circuit)}</span>`
    ).join("") + `</div>`;
}

function imprimerPlan(niveaux: Niveau[], clientName: string, resultat: ResultatGeneration | null, showCircuits: boolean) {
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
    const niveauResultat = resultat?.maison.niveaux.find(rn => rn.id === n.id) ?? n;
    html += `<h2>${escapeXml(n.nom || NIVEAU_TYPES[n.type])}</h2><div class="meta">${n.pieces.length} pièce${n.pieces.length > 1 ? "s" : ""}</div>`;
    html += rendreSVGImprimable(n, resultat, showCircuits);
    if (showCircuits) {
      html += legendeCircuitsHtml(resultat, niveauResultat);
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
  | { kind: "piece"; pieceId: number; startX: number; startY: number; startContour: Point[] };

// ─── FORMULAIRES ────────────────────────────────────────────────────────────────

function PieceForm({ initialNom, initialType, onValidate, onCancel, onDelete }: {
  initialNom: string; initialType: PieceType;
  onValidate: (nom: string, type: PieceType) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [nom, setNom] = useState(initialNom);
  const [type, setType] = useState<PieceType>(initialType);
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
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button onClick={() => onValidate(nom, type)} className="btn-volt flex-1"><Save size={14} /> Valider</button>
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

function NiveauForm({ onValidate, onCancel }: { onValidate: (nom: string, type: NiveauType) => void; onCancel: () => void }) {
  const [nom, setNom] = useState("");
  const [type, setType] = useState<NiveauType>("etage");
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
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button onClick={() => onValidate(nom, type)} className="btn-volt flex-1"><Save size={14} /> Ajouter</button>
        </div>
      </div>
    </div>
  );
}

function CommandeLinkForm({ niveau, item, onValidate, onCancel }: {
  niveau: Niveau; item: AppareillagePlace;
  onValidate: (pointLumineuxId: number) => void; onCancel: () => void;
}) {
  const points = niveau.pieces.flatMap(p =>
    p.appareillages.filter(a => a.type === "point_lumineux" || a.type === "applique").map(a => ({ a, pieceNom: p.nom })));
  const [choix, setChoix] = useState<number | null>(points[0]?.a.id ?? null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="card w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">{labelAppareillage(item.type)} — quel point lumineux ?</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4">
          {points.length === 0 ? (
            <p className="text-sm text-ink-400">Aucun point lumineux placé sur ce niveau. Place d'abord un point lumineux, puis sa commande.</p>
          ) : (
            <select className="input" value={choix ?? ""} onChange={e => setChoix(Number(e.target.value))}>
              {points.map(({ a, pieceNom }) => <option key={a.id} value={a.id}>{pieceNom || "Pièce"} — point lumineux #{a.id}</option>)}
            </select>
          )}
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button disabled={choix == null} onClick={() => choix != null && onValidate(choix)} className="btn-volt flex-1 disabled:opacity-40">Lier</button>
        </div>
      </div>
    </div>
  );
}

// ─── PALETTE ────────────────────────────────────────────────────────────────────

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
  const [dragMode, setDragMode] = useState<DragMode>({ kind: "none" });

  const [placementType, setPlacementType] = useState<AppareillageType | null>(null);
  const [placingTableau, setPlacingTableau] = useState(false);
  const [pendingCommande, setPendingCommande] = useState<AppareillagePlace | null>(null);
  const [selectedAppareillageId, setSelectedAppareillageId] = useState<number | null>(null);
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [resultat, setResultat] = useState<ResultatGeneration | null>(null);
  const [showCircuits, setShowCircuits] = useState(false);
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
              setNiveaux(parsed.niveaux);
              setNiveauActifId(parsed.niveaux[0].id);
              setLoading(false);
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
        const m = toMeters(e.clientX - rect.left, e.clientY - rect.top);
        updateNiveauActif(n => ({
          ...n,
          pieces: n.pieces.map(p => p.id !== dragMode.pieceId ? p : {
            ...p, contour: p.contour.map((pt, i) => (i === dragMode.vertexIndex ? m : pt)),
          }),
        }));
      } else if (dragMode.kind === "piece") {
        const dxM = (e.clientX - dragMode.startX) / (PX_PER_M * zoom);
        const dyM = (e.clientY - dragMode.startY) / (PX_PER_M * zoom);
        updateNiveauActif(n => ({
          ...n,
          pieces: n.pieces.map(p => p.id !== dragMode.pieceId ? p : {
            ...p, contour: dragMode.startContour.map(pt => ({ x: pt.x + dxM, y: pt.y + dyM })),
          }),
        }));
      }
    };
    const onUp = () => { setDragMode({ kind: "none" }); invalidateResultat(); };
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

  const finirDessin = (points: Point[]) => {
    if (points.length < 3) return;
    setPendingContour(points);
    setDrawingPoints([]);
  };

  const entrerModeDessiner = () => {
    setMode("dessiner"); setSelectedPieceId(null); setSelectedAppareillageId(null);
    setPlacementType(null); setPlacingTableau(false);
  };
  const armerPlacement = (t: AppareillageType | null) => {
    setPlacementType(t); setMode("select"); setPlacingTableau(false); setDrawingPoints([]);
  };
  const armerPlacementTableau = () => {
    setPlacingTableau(true); setMode("select"); setPlacementType(null); setDrawingPoints([]);
  };

  const removerAppareillage = (appareillageId: number) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.filter(a => a.id !== appareillageId && a.commandePourId !== appareillageId),
      })),
    }));
    setSelectedAppareillageId(null);
    invalidateResultat();
  };

  const lierCommande = (itemId: number, pointLumineuxId: number) => {
    updateNiveauActif(n => ({
      ...n,
      pieces: n.pieces.map(p => ({
        ...p,
        appareillages: p.appareillages.map(a => a.id === itemId ? { ...a, commandePourId: pointLumineuxId } : a),
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
      setDrawingPoints(pts => [...pts, m]);
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
        setPendingCommande(nouveau);
      }
      return;
    }

    setSelectedPieceId(null);
    setSelectedAppareillageId(null);
    setDragMode({ kind: "pan", startX: e.clientX, startY: e.clientY, startPan: pan });
  };

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    if (mode !== "dessiner") return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCursorPx({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const onPieceDown = (piece: Piece, e: React.PointerEvent) => {
    e.stopPropagation();
    if (mode === "dessiner" || placementType || placingTableau) return;
    if (selectedPieceId === piece.id) {
      setDragMode({ kind: "piece", pieceId: piece.id, startX: e.clientX, startY: e.clientY, startContour: piece.contour });
    } else {
      setSelectedPieceId(piece.id);
      setSelectedAppareillageId(null);
    }
  };

  const onVertexDown = (pieceId: number, index: number, e: React.PointerEvent) => {
    e.stopPropagation();
    setDragMode({ kind: "vertex", pieceId, vertexIndex: index });
  };

  const onAppareillagePointerDown = (a: AppareillagePlace, e: React.PointerEvent) => {
    e.stopPropagation();
    if (mode !== "select" || placementType || placingTableau) return;
    setSelectedAppareillageId(a.id);
    setSelectedPieceId(null);
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

  const handlePousserVersTableau = async () => {
    if (!resultat || resultat.breakers.length === 0) return;
    setPushing(true);
    const nouvellesRows = assemblerTableau(resultat.breakers);
    const { data: c } = await supabase.from("clients").select("tableau_config").eq("id", clientId).single();
    let rows: any[] = [];
    if (c?.tableau_config) {
      try { const parsed = JSON.parse(c.tableau_config); if (Array.isArray(parsed)) rows = parsed; } catch {}
    }
    const offset = maxIdRows(rows) + 100000;
    const remap = remapperIdsRows(nouvellesRows, offset).map((r, i) => ({ ...r, name: `Rangée ${rows.length + i + 1}` }));
    const rowsFinal = [...rows, ...remap];
    await supabase.from("clients").update({ tableau_config: JSON.stringify(rowsFinal) }).eq("id", clientId);
    setPushing(false);
    setPushMsg(`${remap.length} rangée(s) et ${resultat.breakers.length} circuit(s) ajoutés au tableau.`);
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
  const selectedAppareillage = niveauActif?.pieces.flatMap(p => p.appareillages).find(a => a.id === selectedAppareillageId) ?? null;

  const colorMap = new Map<number, string>();
  if (resultat) resultat.breakers.forEach((b, i) => colorMap.set(b.id, couleurCircuit(i)));

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
            <button onClick={() => imprimerPlan(niveaux, client?.nom ?? "", resultat, showCircuits)} className="btn-ghost"><Printer size={15} /> Imprimer</button>
            <button onClick={handleSave} disabled={saving} className={`btn-volt ${saved ? "!bg-emerald-500 !border-emerald-600 !text-white" : ""}`}>
              <Save size={15} />{saving ? "…" : saved ? "Sauvegardé !" : "Sauvegarder"}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-4 md:px-6 py-2 border-b border-ink-100 bg-ink-50 overflow-x-auto shrink-0">
          {[...niveaux].sort((a, b) => a.ordre - b.ordre).map(n => (
            <button key={n.id} onClick={() => { setNiveauActifId(n.id); setSelectedPieceId(null); setSelectedAppareillageId(null); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                n.id === niveauActifId ? "bg-ink-900 text-volt-400" : "bg-white border border-ink-200 text-ink-500 hover:border-ink-400"
              }`}>
              {n.nom || NIVEAU_TYPES[n.type]}
            </button>
          ))}
          <button onClick={() => setShowNiveauForm(true)} className="btn-ghost !px-2 !py-1.5 shrink-0"><Plus size={14} /></button>
        </div>

        <div className="flex items-center gap-2 px-4 md:px-6 py-2 border-b border-ink-100 shrink-0 flex-wrap">
          <button onClick={() => { setMode("select"); setDrawingPoints([]); setPlacementType(null); setPlacingTableau(false); }}
            className={`btn-ghost !text-xs ${mode === "select" && !placementType && !placingTableau ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <MousePointer2 size={13} /> Sélection
          </button>
          <button onClick={entrerModeDessiner} className={`btn-ghost !text-xs ${mode === "dessiner" ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <Pencil size={13} /> Dessiner une pièce
          </button>
          <button onClick={armerPlacementTableau} className={`btn-ghost !text-xs ${placingTableau ? "!bg-ink-900 !text-volt-400" : ""}`}>
            <Zap size={13} /> Position tableau
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

        <div className="flex items-center gap-2 px-4 md:px-6 py-2 border-b border-ink-100 shrink-0 flex-wrap bg-ink-50">
          <button onClick={handleGenerer} className="btn-volt !text-xs"><Sparkles size={13} /> Générer les circuits</button>
          <button onClick={() => setShowCircuits(s => !s)} disabled={!resultat} className="btn-ghost !text-xs disabled:opacity-40">
            {showCircuits ? <Eye size={13} /> : <EyeOff size={13} />} Afficher les circuits
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
                      style={{ cursor: mode === "select" && !placementType && !placingTableau ? "move" : "default" }}
                      onPointerDown={e => onPieceDown(piece, e)} />
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
                          onClick={mode === "select" && !placementType && !placingTableau ? () => setEditingSegment({ pieceId: piece.id, segIndex: i }) : undefined}
                          actif={editingSegment?.pieceId === piece.id && editingSegment?.segIndex === i} />
                      );
                    })}
                  </g>
                );
              })}

              {showCircuits && resultat && niveauActif?.tableauPos && (() => {
                const tousAppareils = niveauActif.pieces.flatMap(p => p.appareillages);
                const parCircuit = new Map<number, AppareillagePlace[]>();
                tousAppareils.forEach(a => {
                  if (a.circuitId == null) return;
                  const arr = parCircuit.get(a.circuitId) ?? [];
                  arr.push(a);
                  parCircuit.set(a.circuitId, arr);
                });
                return Array.from(parCircuit.entries()).map(([circuitId, points]) => {
                  const color = colorMap.get(circuitId) ?? "#666";
                  const ordonnes = ordonnerParProximite(niveauActif.tableauPos!, points);
                  const chemin = [niveauActif.tableauPos!, ...ordonnes].map(toScreen);
                  const d = chemin.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
                  return <path key={circuitId} d={d} fill="none" stroke={color} strokeWidth={2} strokeDasharray="6,4" opacity={0.8} />;
                });
              })()}

              {niveauActif?.pieces.flatMap(p => p.appareillages).map(a => {
                const p = toScreen({ x: a.x, y: a.y });
                const isSel = a.id === selectedAppareillageId;
                const color = showCircuits && a.circuitId != null ? (colorMap.get(a.circuitId) ?? "#1c1917") : (isSel ? "#F59E0B" : "#1c1917");
                return (
                  <g key={a.id} transform={`translate(${p.x - symSize / 2}, ${p.y - symSize / 2})`}
                    onPointerDown={e => onAppareillagePointerDown(a, e)}
                    style={{ cursor: mode === "select" && !placementType && !placingTableau ? "pointer" : "default" }}>
                    <AppareillageSymbol type={a.type} size={symSize} color={color} />
                    {isSel && <rect x={-2} y={-2} width={symSize + 4} height={symSize + 4} fill="none" stroke="#F59E0B" strokeWidth={1.5} rx={3} />}
                  </g>
                );
              })}

              {niveauActif?.tableauPos && (() => {
                const p = toScreen(niveauActif.tableauPos);
                return (
                  <g transform={`translate(${p.x - 12}, ${p.y - 12})`}>
                    <rect width="24" height="24" rx="4" fill="#1c1917" />
                    <text x="12" y="16" textAnchor="middle" fontSize="14" fill="#FBBF24">⚡</text>
                  </g>
                );
              })()}

              {mode === "dessiner" && drawingPoints.length > 0 && (
                <>
                  <polyline
                    points={[...drawingPoints.map(toScreen), ...(cursorPx ? [cursorPx] : [])].map(p => `${p.x},${p.y}`).join(" ")}
                    fill="none" stroke="#F59E0B" strokeWidth={2} strokeDasharray="6,4" />
                  {drawingPoints.map((pt, i) => {
                    const p = toScreen(pt);
                    return <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? 7 : 5} fill={i === 0 ? "#F59E0B" : "#fff"} stroke="#F59E0B" strokeWidth={2} />;
                  })}
                  {drawingPoints.slice(1).map((pt, i) => {
                    const prev = drawingPoints[i];
                    return <EtiquetteLongueur key={`dseg${i}`} aPx={toScreen(prev)} bPx={toScreen(pt)} texte={`${distance(prev, pt).toFixed(2)} m`} />;
                  })}
                  {cursorPx && (() => {
                    const last = drawingPoints[drawingPoints.length - 1];
                    const curM = toMeters(cursorPx.x, cursorPx.y);
                    return <EtiquetteLongueur key="live" aPx={toScreen(last)} bPx={cursorPx} texte={`${distance(last, curM).toFixed(2)} m`} actif />;
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
                <button onClick={() => setEditingPiece(selectedPiece)} className="btn-ghost !px-2 !py-1.5"><Pencil size={13} /></button>
              </div>
            )}

            {selectedAppareillage && mode === "select" && (
              <div className="absolute bottom-4 left-4 card card-inner !p-3 flex items-center gap-3 shadow-lg">
                <AppareillageSymbol type={selectedAppareillage.type} size={22} />
                <div>
                  <p className="text-sm font-semibold text-ink-900">{labelAppareillage(selectedAppareillage.type)}</p>
                  {selectedAppareillage.circuitId != null && (
                    <p className="text-xs text-ink-400">Circuit : {resultat?.breakers.find(b => b.id === selectedAppareillage.circuitId)?.label}</p>
                  )}
                </div>
                <button onClick={() => removerAppareillage(selectedAppareillage.id)} className="btn-danger !px-2 !py-1.5"><Trash2 size={13} /></button>
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
              <div className="absolute bottom-4 right-4 card card-inner !p-3 max-w-[220px] max-h-48 overflow-y-auto shadow-lg">
                <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Circuits</p>
                <div className="flex flex-col gap-1">
                  {circuitsNiveauActif.map(b => {
                    const i = resultat.breakers.findIndex(x => x.id === b.id);
                    return (
                      <div key={b.id} className="flex items-center gap-1.5 text-[11px] text-ink-600">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: couleurCircuit(i) }} />
                        <span className="truncate">{b.label}</span>
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
          </div>

          <div className="hidden lg:flex lg:flex-col w-56 border-l border-ink-200 bg-white overflow-y-auto shrink-0 p-3">
            <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-2">Appareillages</p>
            <PaletteBoutons placementType={placementType} onSelect={armerPlacement} />
          </div>

          {paletteOpen && (
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
          Molette = zoom · Glisser le fond = déplacer la vue · En dessin : clic = ajouter un point, clic près du 1er point = fermer la pièce
        </div>
      </div>

      {pendingContour && (
        <PieceForm
          initialNom="" initialType="autre"
          onValidate={(nom, type) => {
            updateNiveauActif(n => ({ ...n, pieces: [...n.pieces, nouvellePiece(pendingContour, nom, type)] }));
            setPendingContour(null);
            invalidateResultat();
          }}
          onCancel={() => setPendingContour(null)}
        />
      )}

      {editingPiece && (
        <PieceForm
          initialNom={editingPiece.nom} initialType={editingPiece.type}
          onValidate={(nom, type) => {
            updateNiveauActif(n => ({ ...n, pieces: n.pieces.map(p => p.id === editingPiece.id ? { ...p, nom, type } : p) }));
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
          onValidate={(nom, type) => {
            const nouveau = nouveauNiveau(type, niveaux.length);
            nouveau.nom = nom;
            setNiveaux(nvs => [...nvs, nouveau]);
            setNiveauActifId(nouveau.id);
            setShowNiveauForm(false);
          }}
          onCancel={() => setShowNiveauForm(false)}
        />
      )}

      {pendingCommande && niveauActif && (
        <CommandeLinkForm
          niveau={niveauActif} item={pendingCommande}
          onValidate={pointLumineuxId => lierCommande(pendingCommande.id, pointLumineuxId)}
          onCancel={() => { removerAppareillage(pendingCommande.id); setPendingCommande(null); }}
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
    </Shell>
  );
}
