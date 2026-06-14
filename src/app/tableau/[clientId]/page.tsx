"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Client } from "@/types";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import {
  ArrowLeft, Save, Printer, ShieldCheck, ShieldAlert,
  ShieldX, Plus, Trash2, Zap, Settings2, X,
} from "lucide-react";

// ─── TYPES ────────────────────────────────────────────────────────────────────

type CommandeType = "simple" | "vav" | "telerupteur";
type CircuitCategory = "lumiere" | "prises";

interface PieceConfig {
  nom: string;
  // lumiere
  pointsLumineux: number;
  typeCommande: CommandeType;
  nbCommandes: number;
  // prises
  nbPrises: number;
}

interface Breaker {
  id: number;
  label: string;
  circuit: string;
  amperes: number;
  type: string; // "diff-AC" | "diff-A" | "diff-F" | "1P" | "2P"
  pieces: PieceConfig[];
}

interface BreakerRow {
  id: number;
  name: string;
  slots: (Breaker | null)[]; // slot 0 = diff, slots 1-8 = breakers
}

// ─── NFC 15-100 CONSTANTS ─────────────────────────────────────────────────────

const BREAKER_TYPES: Record<string, { label: string; width: number; desc: string; isDiff?: boolean; diffType?: string }> = {
  "1P":      { label: "1P",    width: 1, desc: "Unipolaire" },
  "2P":      { label: "2P",    width: 2, desc: "Bipolaire" },
  "diff-AC": { label: "ID AC", width: 2, desc: "Différentiel Type AC", isDiff: true, diffType: "AC" },
  "diff-A":  { label: "ID A",  width: 2, desc: "Différentiel Type A",  isDiff: true, diffType: "A"  },
  "diff-F":  { label: "ID F",  width: 2, desc: "Différentiel Type F",  isDiff: true, diffType: "F"  },
};

const CIRCUITS: Record<string, {
  label: string; icon: string; ampMax: number; dedié: boolean;
  diffType: string | null; section: string | null; category: CircuitCategory | null;
}> = {
  lumiere:         { label: "Lumière",          icon: "💡", ampMax: 10, dedié: false, diffType: "AC", section: "1.5", category: "lumiere" },
  prise_16:        { label: "Prises 16A",       icon: "🔌", ampMax: 16, dedié: false, diffType: "AC", section: "1.5", category: "prises" },
  prise_20:        { label: "Prises 20A",       icon: "🔌", ampMax: 20, dedié: false, diffType: "AC", section: "2.5", category: "prises" },
  cuisine_prises:  { label: "Prises cuisine",   icon: "🍳", ampMax: 20, dedié: false, diffType: "AC", section: "2.5", category: "prises" },
  plaque:          { label: "Plaque cuisson",   icon: "🔥", ampMax: 32, dedié: true,  diffType: "A",  section: "6.0", category: null },
  four:            { label: "Four",             icon: "🥘", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5", category: null },
  lave_linge:      { label: "Lave-linge",       icon: "🧺", ampMax: 20, dedié: true,  diffType: "A",  section: "2.5", category: null },
  lave_vaisselle:  { label: "Lave-vaisselle",   icon: "🍽️", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5", category: null },
  seche_linge:     { label: "Sèche-linge",      icon: "👕", ampMax: 20, dedié: true,  diffType: "A",  section: "2.5", category: null },
  chauffe_eau:     { label: "Chauffe-eau",      icon: "🚿", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5", category: null },
  chauffage:       { label: "Chauffage élec.",  icon: "🌡️", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5", category: null },
  clim:            { label: "Climatisation",    icon: "❄️", ampMax: 20, dedié: true,  diffType: "F",  section: "2.5", category: null },
  seche_serviette: { label: "Sèche-serviette",  icon: "🛁", ampMax: 16, dedié: true,  diffType: "AC", section: "1.5", category: null },
  congelateur:     { label: "Congélateur",      icon: "🧊", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5", category: null },
  irve:            { label: "IRVE (recharge)",  icon: "🔋", ampMax: 32, dedié: true,  diffType: "A",  section: "6.0", category: null },
  piscine:         { label: "Piscine/PAC",      icon: "🏊", ampMax: 20, dedié: true,  diffType: "F",  section: "2.5", category: null },
  vmc:             { label: "VMC",              icon: "💨", ampMax: 10, dedié: true,  diffType: "AC", section: "1.5", category: null },
  alarme:          { label: "Alarme",           icon: "🔔", ampMax: 6,  dedié: true,  diffType: "AC", section: "1.5", category: null },
  exterieur:       { label: "Extérieur",        icon: "🌿", ampMax: 16, dedié: false, diffType: "AC", section: "1.5", category: "prises" },
  garage:          { label: "Garage",           icon: "🏠", ampMax: 16, dedié: false, diffType: "AC", section: "1.5", category: "prises" },
  general:         { label: "Général / Arrivée",icon: "⚡", ampMax: 63, dedié: true,  diffType: null, section: "10.0", category: null },
  parafoudre:      { label: "Parafoudre",       icon: "⛈️", ampMax: 0,  dedié: true,  diffType: null, section: null,  category: null },
  autre:           { label: "Autre",            icon: "⚙️", ampMax: 32, dedié: false, diffType: "AC", section: "2.5", category: null },
};

// Diamètres extérieurs câbles (mm) par section — valeurs fabricants typ.
const CABLE_DIAM_MM: Record<string, number> = {
  "1.5": 6.8, "2.5": 7.8, "4.0": 9.0, "6.0": 10.5, "10.0": 13.0,
};

// Gaines IRL (diamètre intérieur utile mm) — NF C 15-100 art. 529.1
const GAINES_IRL = [
  { label: "IRL 16", diamInt: 12.2 },
  { label: "IRL 20", diamInt: 15.8 },
  { label: "IRL 25", diamInt: 20.0 },
  { label: "IRL 32", diamInt: 26.0 },
  { label: "IRL 40", diamInt: 33.0 },
];

function gaineRecommandee(sections: string[]): { gaine: string; tauxPct: number; ok: boolean } {
  const totalSection = sections.reduce((sum, s) => {
    const d = CABLE_DIAM_MM[s] ?? 8;
    return sum + Math.PI * (d / 2) ** 2;
  }, 0);
  for (const g of GAINES_IRL) {
    const sectionInt = Math.PI * (g.diamInt / 2) ** 2;
    const taux = Math.round((totalSection / sectionInt) * 100);
    if (taux <= 33) return { gaine: g.label, tauxPct: taux, ok: true };
  }
  const last = GAINES_IRL[GAINES_IRL.length - 1];
  const sectionInt = Math.PI * (last.diamInt / 2) ** 2;
  return { gaine: last.label + " (insuffisant)", tauxPct: Math.round((totalSection / sectionInt) * 100), ok: false };
}

function cablesLumiere(piece: PieceConfig, section: string): string[] {
  const cables: string[] = [section, section, section]; // Ph + N + PE
  if (piece.typeCommande === "simple") {
    cables.push("1.5"); // retour lampe
  } else if (piece.typeCommande === "vav") {
    cables.push("1.5", "1.5"); // 2 navettes
  } else {
    for (let i = 0; i < piece.nbCommandes; i++) cables.push("1.5"); // navettes BP
    cables.push("1.5"); // retour
  }
  return cables;
}

function cablesPrises(section: string): string[] {
  return [section, section, section]; // Ph + N + PE
}

const DIFF_HIERARCHY: Record<string, number> = { AC: 0, A: 1, F: 2 };
const AMPERES = [2, 6, 10, 16, 20, 25, 32, 40, 63];
const SLOT_W = 52;
const DIFF_W = 96;
const BREAKER_H = 130;

let _id = 0;
const uid = () => ++_id;

const defaultPiece = (): PieceConfig => ({
  nom: "",
  pointsLumineux: 1,
  typeCommande: "simple",
  nbCommandes: 1,
  nbPrises: 1,
});

const emptyRow = (rowNum: number): BreakerRow => ({
  id: uid(),
  name: `Rangée ${rowNum}`,
  slots: Array(9).fill(null),
});

function safeBreakers(slots: (Breaker | null)[] | undefined): Breaker[] {
  if (!Array.isArray(slots)) return [];
  return slots.filter((b): b is Breaker =>
    b != null && typeof b === "object" && typeof b.type === "string" && b.type.length > 0
  );
}

function getCategory(circuit: string): CircuitCategory | null {
  return CIRCUITS[circuit]?.category ?? null;
}

// ─── NFC 15-100 CHECKER ───────────────────────────────────────────────────────

function checkNFC(rows: BreakerRow[]) {
  const errors:   { id: string; msg: string; rule: string }[] = [];
  const warnings: { id: string; msg: string; rule: string }[] = [];
  const infos:    { id: string; msg: string; rule: string }[] = [];

  if (!Array.isArray(rows) || rows.length === 0) {
    infos.push({ id: "empty", msg: "Tableau vide — ajoutez des rangées pour commencer.", rule: "—" });
    return { errors, warnings, infos, score: 100 };
  }

  const allBreakers = rows.flatMap(r => safeBreakers(r.slots));
  const diffs = allBreakers.filter(b => !!BREAKER_TYPES[b.type]?.isDiff);

  if (diffs.length === 0) {
    errors.push({ id: "no-diff", msg: "Aucun différentiel 30mA détecté. Minimum 2 obligatoires.", rule: "Art. 531.2" });
  } else if (diffs.length === 1) {
    errors.push({ id: "one-diff", msg: "Un seul différentiel détecté. Minimum 2 ID 30mA requis.", rule: "Art. 531.2" });
  }

  rows.forEach(row => {
    const rawDiff = Array.isArray(row.slots) ? row.slots[0] : null;
    const diff = (rawDiff != null && typeof rawDiff === "object" && typeof (rawDiff as any).type === "string")
      ? rawDiff as Breaker : null;
    const breakers = safeBreakers(Array.isArray(row.slots) ? row.slots.slice(1) : []);

    if (breakers.length > 8) {
      errors.push({ id: `max8-${row.id}`, msg: `Rangée "${row.name}" : plus de 8 circuits sous le différentiel.`, rule: "Art. 531.2.4" });
    }

    breakers.forEach(b => {
      const spec = CIRCUITS[b.circuit];
      if (!spec) return;
      if (spec.ampMax && b.amperes > spec.ampMax) {
        errors.push({ id: `amp-${b.id}`, msg: `"${b.label || spec.label}" : ${b.amperes}A dépasse le max autorisé (${spec.ampMax}A).`, rule: "NFC §533" });
      }
      if (!diff) {
        errors.push({ id: `nodiff-${b.id}`, msg: `"${b.label || spec.label}" : aucun différentiel en amont.`, rule: "Art. 531.2" });
      } else if (spec.diffType) {
        const covType = BREAKER_TYPES[diff.type]?.diffType;
        if (covType && (DIFF_HIERARCHY[covType] ?? -1) < (DIFF_HIERARCHY[spec.diffType] ?? -1)) {
          errors.push({ id: `difftype-${b.id}`, msg: `"${b.label || spec.label}" : nécessite diff. Type ${spec.diffType}, protégé par Type ${covType}.`, rule: "NFC §531.2" });
        }
      }
    });
  });

  if (!allBreakers.some(b => b.circuit === "parafoudre")) {
    infos.push({ id: "parafoudre", msg: "Parafoudre non détecté. Obligatoire NFC 15-100 (2024).", rule: "§443" });
  }

  const specialTypes = ["plaque", "four", "lave_linge", "lave_vaisselle", "chauffe_eau"];
  const found = specialTypes.filter(t => allBreakers.some(b => b.circuit === t)).length;
  if (found < 4) {
    infos.push({ id: "spec", msg: `${found} circuit(s) spécialisé(s) sur 5 recommandés.`, rule: "Art. 771.314.2" });
  }

  const score = Math.max(0, Math.round(100 - errors.length * 15 - warnings.length * 5 - infos.length * 2));
  return { errors, warnings, infos, score };
}

// ─── LEGRAND SVG ──────────────────────────────────────────────────────────────

function BreakerSVG({ breaker, isEmpty, isSelected, isDiffSlot }: {
  breaker: Breaker | null; isEmpty: boolean; isSelected: boolean; isDiffSlot?: boolean;
}) {
  const w = isDiffSlot ? DIFF_W : SLOT_W;
  const h = BREAKER_H;
  const isDiff = breaker ? !!BREAKER_TYPES[breaker.type]?.isDiff : false;
  const bodyColor = "#e8e8e6";
  const bodyDark  = "#c8c8c4";

  if (isEmpty) {
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <rect x="1" y="1" width={w-2} height={h-2} rx="4" fill="#f1f1ef" stroke="#d4d4d0" strokeWidth="1" strokeDasharray="4,3" />
        <text x={w/2} y={h/2+4} textAnchor="middle" fontSize="18" fill="#d4d4d0">+</text>
      </svg>
    );
  }

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`body-${breaker!.id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#c8c8c4" /><stop offset="8%" stopColor="#ebebea" />
          <stop offset="50%" stopColor={bodyColor} /><stop offset="92%" stopColor="#d8d8d4" />
          <stop offset="100%" stopColor="#b8b8b4" />
        </linearGradient>
        <linearGradient id={`shine-${breaker!.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity="0.35" />
          <stop offset="25%" stopColor="white" stopOpacity="0.08" />
          <stop offset="100%" stopColor="black" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id={`lever-${breaker!.id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#111" /><stop offset="30%" stopColor="#2d2d2d" />
          <stop offset="60%" stopColor="#1a1a1a" /><stop offset="100%" stopColor="#0a0a0a" />
        </linearGradient>
        <radialGradient id={`screw-${breaker!.id}`} cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#f0f0ee" /><stop offset="60%" stopColor="#a0a09c" />
          <stop offset="100%" stopColor="#606060" />
        </radialGradient>
      </defs>
      <rect x="2" y="3" width={w-3} height={h-3} rx="5" fill="rgba(0,0,0,0.18)" />
      <rect x="0.5" y="0.5" width={w-1} height={h-1} rx="5" fill={`url(#body-${breaker!.id})`} stroke={bodyDark} strokeWidth="1" />
      <rect x="0.5" y="0.5" width={w-1} height={h-1} rx="5" fill={`url(#shine-${breaker!.id})`} />
      <rect x="0.5" y="0.5" width={w-1} height="20" rx="5" fill={bodyDark} />
      <rect x="0.5" y="14" width={w-1} height="6" fill={bodyDark} />
      <rect x="0.5" y={h-20} width={w-1} height="20" rx="5" fill={bodyDark} />
      <rect x="0.5" y={h-20} width={w-1} height="6" fill={bodyDark} />
      <rect x={w*0.18} y="3" width={w*0.64} height="12" rx="2" fill="rgba(0,0,0,0.15)" />
      <circle cx={w/2} cy="9" r="4.5" fill={`url(#screw-${breaker!.id})`} />
      <line x1={w/2-3} y1="9" x2={w/2+3} y2="9" stroke="#444" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1={w/2} y1="5.5" x2={w/2} y2="12.5" stroke="#444" strokeWidth="1.3" strokeLinecap="round"/>
      <rect x={w*0.18} y={h-15} width={w*0.64} height="12" rx="2" fill="rgba(0,0,0,0.15)" />
      <circle cx={w/2} cy={h-9} r="4.5" fill={`url(#screw-${breaker!.id})`} />
      <line x1={w/2-3} y1={h-9} x2={w/2+3} y2={h-9} stroke="#444" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1={w/2} y1={h-12.5} x2={w/2} y2={h-5.5} stroke="#444" strokeWidth="1.3" strokeLinecap="round"/>
      {isDiff ? (
        <>
          {[w*0.27, w*0.73].map((lx, i) => (
            <g key={i}>
              <rect x={lx-7} y="22" width="14" height="52" rx="6" fill="rgba(0,0,0,0.3)" />
              <rect x={lx-6} y="21" width="12" height="50" rx="5" fill={`url(#lever-${breaker!.id})`} />
              <rect x={lx-4} y="41" width="8" height="3.5" rx="1.5" fill="rgba(255,255,255,0.08)" />
              <ellipse cx={lx-1} cy="30" rx="3.5" ry="6" fill="rgba(255,255,255,0.1)" />
              <rect x={lx-1.5} y="24" width="3" height="9" rx="1.5" fill="rgba(255,255,255,0.55)" />
            </g>
          ))}
          <rect x={w/2-11} y="76" width="22" height="12" rx="3" fill="#1a0000" />
          <rect x={w/2-10} y="75" width="20" height="11" rx="3" fill="#b91c1c" />
          <rect x={w/2-9}  y="76" width="18" height="7"  rx="2" fill="#ef4444" />
          <rect x={w/2-8}  y="76.5" width="16" height="3" rx="1" fill="rgba(255,255,255,0.2)" />
          <text x={w/2} y="84" textAnchor="middle" fontSize="4.5" fill="white" fontWeight="bold" fontFamily="monospace">TEST</text>
          <text x={w/2} y="96" textAnchor="middle" fontSize="6.5" fill="#555" fontFamily="monospace" fontWeight="600">30mA</text>
          <text x={w/2} y="107" textAnchor="middle" fontSize="7.5" fill="#1a1a1a" fontFamily="monospace" fontWeight="800">
            {`Type ${BREAKER_TYPES[breaker!.type]?.diffType ?? ""}`}
          </text>
        </>
      ) : (
        <>
          <rect x={w/2-8} y="22" width="16" height="60" rx="7" fill="rgba(0,0,0,0.25)" />
          <rect x={w/2-7} y="21" width="14" height="58" rx="6" fill={`url(#lever-${breaker!.id})`} />
          <rect x={w/2-5} y="46" width="10" height="4" rx="2" fill="rgba(255,255,255,0.07)" />
          <ellipse cx={w/2-1} cy="31" rx="4" ry="7" fill="rgba(255,255,255,0.1)" />
          <rect x={w/2-1.5} y="24" width="3" height="10" rx="1.5" fill="rgba(255,255,255,0.55)" />
          <rect x={w/2-12} y="82" width="24" height="14" rx="2.5" fill="white" opacity="0.9" />
          <rect x={w/2-11} y="83" width="22" height="12" rx="2" fill="#f8f8f6" />
          <text x={w/2} y="93" textAnchor="middle"
            fontSize={breaker!.amperes >= 25 ? "8" : "9"} fontWeight="900"
            fill="#1a1a1a" fontFamily="monospace" letterSpacing="0.3">
            {breaker!.amperes}A
          </text>
        </>
      )}
      {isSelected && (
        <rect x="0.5" y="0.5" width={w-1} height={h-1} rx="5" fill="none" stroke="#F59E0B" strokeWidth="2.5" />
      )}
    </svg>
  );
}

// ─── BREAKER EDIT MODAL ───────────────────────────────────────────────────────

function BreakerEditModal({ breaker, slotIndex, compliance, onUpdate, onClose, onShowSchema, onRemove }: {
  breaker: Breaker;
  slotIndex: number;
  compliance: ReturnType<typeof checkNFC>;
  onUpdate: (b: Breaker) => void;
  onClose: () => void;
  onShowSchema: (b: Breaker) => void;
  onRemove: () => void;
}) {
  const isDiff = !!BREAKER_TYPES[breaker.type]?.isDiff;
  const hasError = compliance.errors.some(e => e.id.includes(String(breaker.id)));
  const spec = CIRCUITS[breaker.circuit];
  const category = getCategory(breaker.circuit);

  const [piecesText, setPiecesText] = useState(
    breaker.pieces.map(p => p.nom).join(" · ")
  );

  const handlePiecesTextChange = (val: string) => {
    setPiecesText(val);
    const noms = val.split(/[·,]/).map(s => s.trim()).filter(Boolean);
    const newPieces: PieceConfig[] = noms.map(nom => {
      const existing = breaker.pieces.find(p => p.nom.toLowerCase() === nom.toLowerCase());
      return existing ? { ...existing, nom } : { ...defaultPiece(), nom };
    });
    onUpdate({ ...breaker, pieces: newPieces });
  };

  const updatePiece = (idx: number, patch: Partial<PieceConfig>) => {
    const newPieces = breaker.pieces.map((p, i) => i === idx ? { ...p, ...patch } : p);
    onUpdate({ ...breaker, pieces: newPieces });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-ink-900/60 backdrop-blur-sm"
      onClick={onClose}>
      <div className="card w-full max-w-sm md:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl md:rounded-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <div className="flex items-center gap-2">
            <span className="text-xl">{isDiff ? "🔲" : (spec || CIRCUITS.autre).icon}</span>
            <span className="font-semibold text-ink-900">
              {isDiff ? "Différentiel" : "Disjoncteur"} — emplacement {slotIndex + 1}
            </span>
          </div>
          <button onClick={onClose} className="btn-ghost !px-2 !py-1 text-ink-400">✕</button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          <div>
            <label className="label">Libellé (étiquette)</label>
            <input className="input" placeholder="Ex: Éclairage RDC, Prises séjour…"
              value={breaker.label}
              onChange={e => onUpdate({ ...breaker, label: e.target.value })} />
          </div>

          <div>
            <label className="label">Type</label>
            <select className="input" value={breaker.type}
              onChange={e => onUpdate({ ...breaker, type: e.target.value })}>
              {Object.entries(BREAKER_TYPES)
                .filter(([k]) => isDiff ? BREAKER_TYPES[k].isDiff : !BREAKER_TYPES[k].isDiff)
                .map(([k, v]) => <option key={k} value={k}>{v.label} — {v.desc}</option>)}
            </select>
          </div>

          {!isDiff && (
            <>
              <div>
                <label className="label">Circuit</label>
                <select className="input" value={breaker.circuit}
                  onChange={e => onUpdate({ ...breaker, circuit: e.target.value, pieces: [] })}>
                  {Object.entries(CIRCUITS).map(([k, v]) => (
                    <option key={k} value={k}>{v.icon} {v.label} (max {v.ampMax}A)</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Calibre</label>
                <div className="flex flex-wrap gap-2">
                  {AMPERES.map(a => (
                    <button key={a} onClick={() => onUpdate({ ...breaker, amperes: a })}
                      className={`px-3 py-1.5 rounded-lg text-sm font-mono font-bold border transition-all ${
                        breaker.amperes === a
                          ? "bg-ink-900 text-volt-400 border-ink-700"
                          : "bg-ink-50 text-ink-500 border-ink-200 hover:border-ink-400"
                      }`}>{a}A</button>
                  ))}
                </div>
              </div>

              {spec && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 font-mono leading-relaxed">
                  📋 NFC 15-100 — Max {spec.ampMax}A · Section {spec.section}mm²
                  <br />Diff requis : Type {spec.diffType || "—"} · {spec.dedié ? "Circuit dédié" : "Partageable"}
                </div>
              )}

              {category && (
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="label">Pièces desservies</label>
                    <input className="input"
                      placeholder={category === "lumiere" ? "Ex: Salon · Chambre 1 · Couloir" : "Ex: Séjour · Cuisine · Entrée"}
                      value={piecesText}
                      onChange={e => handlePiecesTextChange(e.target.value)} />
                    <p className="text-xs text-ink-400 mt-1">
                      Séparez par · ou , — les détails apparaissent ci-dessous
                    </p>
                  </div>

                  {breaker.pieces.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {breaker.pieces.map((piece, pi) => (
                        <div key={pi} className="border border-ink-200 rounded-xl p-3 flex flex-col gap-2.5 bg-ink-50">
                          <p className="text-xs font-bold text-ink-700 font-mono">
                            {category === "lumiere" ? "💡" : "🔌"} {piece.nom || `Pièce ${pi + 1}`}
                          </p>

                          {category === "lumiere" && (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-ink-500 w-36 shrink-0">Points lumineux</span>
                                <div className="flex gap-1 flex-wrap">
                                  {[1,2,3,4,5,6].map(n => (
                                    <button key={n} onClick={() => updatePiece(pi, { pointsLumineux: n })}
                                      className={`w-7 h-7 rounded-md text-xs font-bold border transition-all ${
                                        piece.pointsLumineux === n
                                          ? "bg-amber-400 text-ink-900 border-amber-500"
                                          : "bg-white text-ink-500 border-ink-200 hover:border-ink-400"
                                      }`}>{n}</button>
                                  ))}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-ink-500 w-36 shrink-0">Commande</span>
                                <div className="flex gap-1">
                                  {([["simple","Simple"],["vav","V&V"],["telerupteur","Télér."]] as [CommandeType, string][]).map(([v, l]) => (
                                    <button key={v}
                                      onClick={() => updatePiece(pi, { typeCommande: v, nbCommandes: v === "vav" ? 2 : 1 })}
                                      className={`px-2 py-1 rounded-md text-xs font-semibold border transition-all ${
                                        piece.typeCommande === v
                                          ? "bg-emerald-700 text-white border-emerald-800"
                                          : "bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                                      }`}>{l}</button>
                                  ))}
                                </div>
                              </div>
                              {piece.typeCommande !== "simple" && (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-ink-500 w-36 shrink-0">
                                    {piece.typeCommande === "vav" ? "Nb V&V" : "Nb boutons-poussoirs"}
                                  </span>
                                  <div className="flex gap-1">
                                    {(piece.typeCommande === "vav" ? [2,3] : [1,2,3,4,5]).map(n => (
                                      <button key={n} onClick={() => updatePiece(pi, { nbCommandes: n })}
                                        className={`w-7 h-7 rounded-md text-xs font-bold border transition-all ${
                                          piece.nbCommandes === n
                                            ? "bg-orange-500 text-white border-orange-600"
                                            : "bg-white text-ink-500 border-ink-200 hover:border-ink-400"
                                        }`}>{n}</button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          )}

                          {category === "prises" && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-ink-500 w-36 shrink-0">Nombre de prises</span>
                              <div className="flex gap-1 flex-wrap">
                                {[1,2,3,4,5,6,8,10].map(n => (
                                  <button key={n} onClick={() => updatePiece(pi, { nbPrises: n })}
                                    className={`w-7 h-7 rounded-md text-xs font-bold border transition-all ${
                                      piece.nbPrises === n
                                        ? "bg-volt-400 text-ink-900 border-volt-500"
                                        : "bg-white text-ink-500 border-ink-200 hover:border-ink-400"
                                    }`}>{n}</button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button onClick={onClose} className="btn-primary flex-1">
            <Save size={14} /> Valider
          </button>
          {!hasError && !isDiff && (
            <button onClick={() => { onClose(); onShowSchema(breaker); }} className="btn-ghost">
              <Zap size={14} /> Schéma
            </button>
          )}
          <button onClick={onRemove} className="btn-danger !px-3">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── COMPLIANCE PANEL ─────────────────────────────────────────────────────────

function CompliancePanel({ result, onClose }: { result: ReturnType<typeof checkNFC>; onClose: () => void }) {
  const { errors, warnings, infos, score } = result;
  const scoreColor = score >= 85 ? "text-emerald-600" : score >= 60 ? "text-amber-500" : "text-red-600";
  const scoreBg    = score >= 85 ? "bg-emerald-50 border-emerald-200" : score >= 60 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200";
  const ScoreIcon  = score >= 85 ? ShieldCheck : score >= 60 ? ShieldAlert : ShieldX;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center w-12 h-12 rounded-xl border ${scoreBg}`}>
              <ScoreIcon size={22} className={scoreColor} />
            </div>
            <div>
              <p className="font-display text-lg text-ink-900">Rapport NFC 15-100</p>
              <p className={`text-sm font-semibold ${scoreColor}`}>Score {score}/100</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost !px-2 !py-1">✕</button>
        </div>
        <div className="flex gap-2 p-4 border-b border-ink-200 flex-wrap">
          {errors.length > 0   && <span className="badge bg-red-100 text-red-700">❌ {errors.length} erreur{errors.length>1?"s":""}</span>}
          {warnings.length > 0 && <span className="badge bg-amber-100 text-amber-700">⚠️ {warnings.length} avertissement{warnings.length>1?"s":""}</span>}
          {infos.length > 0    && <span className="badge bg-blue-100 text-blue-700">ℹ️ {infos.length} recommandation{infos.length>1?"s":""}</span>}
          {errors.length === 0 && warnings.length === 0 && infos.length === 0 && (
            <span className="badge bg-emerald-100 text-emerald-700">✅ Installation conforme</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {([
            { items: errors,   icon: "❌", bg: "bg-red-50",   border: "border-red-200",   text: "text-red-800",   sub: "text-red-400",  title: "NON-CONFORMITÉS" },
            { items: warnings, icon: "⚠️", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", sub: "text-amber-400", title: "AVERTISSEMENTS" },
            { items: infos,    icon: "ℹ️", bg: "bg-blue-50",  border: "border-blue-200",  text: "text-blue-800",  sub: "text-blue-400",  title: "RECOMMANDATIONS" },
          ] as const).map(({ items, icon, bg, border, text, sub, title }) => items.length > 0 && (
            <div key={title}>
              <p className="label mb-2">{title}</p>
              {items.map(item => (
                <div key={item.id} className={`${bg} border ${border} rounded-xl p-3 mb-2 flex gap-2`}>
                  <span className="shrink-0 mt-0.5">{icon}</span>
                  <div>
                    <p className={`text-sm ${text}`}>{item.msg}</p>
                    <p className={`text-xs font-mono mt-1 ${sub}`}>NFC 15-100 — {item.rule}</p>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-ink-200 text-xs text-ink-400 text-center">
          NFC 15-100 éd. 2024. Indicatif — ne remplace pas un contrôle CONSUEL.
        </div>
      </div>
    </div>
  );
}

// ─── CIRCUIT SCHEMA MODAL ─────────────────────────────────────────────────────

const CABLE_COLORS = {
  phase:   "#DC2626",
  neutre:  "#2563EB",
  terre:   "#16A34A",
  retour:  "#7C3AED",
  navette: "#EA580C",
};

function CircuitSchema({ breaker, rowBreakers, onClose }: {
  breaker: Breaker;
  rowBreakers: (Breaker | null)[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"unifilaire" | "gaines">("unifilaire");

  const spec    = CIRCUITS[breaker.circuit];
  const circuit = spec || CIRCUITS.autre;
  const isLight = breaker.circuit === "lumiere";
  const isPrise = ["prise_16","prise_20","cuisine_prises","exterieur","garage"].includes(breaker.circuit);
  const diff    = rowBreakers[0] as Breaker | null;
  const section = spec?.section ?? "2.5";

  const firstPiece  = breaker.pieces[0];
  const switchType  = firstPiece?.typeCommande ?? "simple";
  const switchCount = firstPiece?.nbCommandes ?? 1;
  const lampCount   = firstPiece?.pointsLumineux ?? 1;

  // ── GAINES DATA ──
  interface GaineGroup {
    nom: string;
    cables: string[];
    circuits: string[];
    boiteDerivation: boolean;
    raison: string;
  }

  const gainesData = useMemo((): GaineGroup[] => {
    if (breaker.pieces.length === 0) return [];
    const groups: GaineGroup[] = [];

    if (isLight) {
      if (breaker.pieces.length > 1) {
        groups.push({
          nom: "Tableau → Zone de dérivation principale",
          cables: cablesPrises(section),
          circuits: [`Ph/N/PE ${section}mm² commun — se distribue ensuite par pièce`],
          boiteDerivation: true,
          raison: `${breaker.pieces.length} pièces desservies → 1 boîte centrale économise les passages câble`,
        });
      }
      breaker.pieces.forEach(piece => {
        const cables = cablesLumiere(piece, section);
        const desc: string[] = [`Ph/N/PE ${section}mm²`];
        if (piece.typeCommande === "simple") desc.push("Retour lampe 1.5mm²");
        else if (piece.typeCommande === "vav") desc.push("2× Navette 1.5mm²");
        else desc.push(`${piece.nbCommandes}× Navette BP 1.5mm² + Retour 1.5mm²`);
        groups.push({
          nom: breaker.pieces.length > 1
            ? `Dérivation → ${piece.nom || "Pièce"}`
            : `Tableau → ${piece.nom || "Pièce"}`,
          cables,
          circuits: desc,
          boiteDerivation: piece.pointsLumineux > 1,
          raison: piece.pointsLumineux > 1
            ? `${piece.pointsLumineux} points lumineux → boîte de dérivation pour distribuer`
            : "Point lumineux unique — alimentation directe",
        });
      });
    } else {
      if (breaker.pieces.length > 1) {
        groups.push({
          nom: "Tableau → Zone de dérivation principale",
          cables: cablesPrises(section),
          circuits: [`Ph/N/PE ${section}mm² commun`],
          boiteDerivation: true,
          raison: `${breaker.pieces.length} pièces → mutualiser jusqu'à une boîte centrale réduit le câblage`,
        });
      }
      breaker.pieces.forEach(piece => {
        groups.push({
          nom: breaker.pieces.length > 1
            ? `Dérivation → ${piece.nom || "Pièce"}`
            : `Tableau → ${piece.nom || "Pièce"}`,
          cables: cablesPrises(section),
          circuits: [`Ph/N/PE ${section}mm²`],
          boiteDerivation: piece.nbPrises > 1,
          raison: piece.nbPrises > 1
            ? `${piece.nbPrises} prises → boîte de dérivation ou maillage prise à prise`
            : "Prise unique — alimentation directe",
        });
      });
    }
    return groups;
  }, [breaker.pieces, isLight, section]);

  // ── UNIFILAIRE SVG ──
  const H = isLight ? 340 : 240;
  const midY = H / 2;
  const elements: React.ReactNode[] = [];

  elements.push(
    <g key="in">
      <line x1={20} y1={midY}    x2={55} y2={midY}    stroke={CABLE_COLORS.phase}  strokeWidth={2.5}/>
      <line x1={20} y1={midY+20} x2={55} y2={midY+20} stroke={CABLE_COLORS.neutre} strokeWidth={2.5}/>
      <line x1={20} y1={midY+38} x2={55} y2={midY+38} stroke={CABLE_COLORS.terre}  strokeWidth={2.5} strokeDasharray="5,3"/>
      <text x={14} y={midY-5}  textAnchor="middle" fontSize={8} fill={CABLE_COLORS.phase}  fontFamily="monospace">Ph</text>
      <text x={14} y={midY+33} textAnchor="middle" fontSize={8} fill={CABLE_COLORS.neutre} fontFamily="monospace">N</text>
      <text x={14} y={midY+51} textAnchor="middle" fontSize={8} fill={CABLE_COLORS.terre}  fontFamily="monospace">PE</text>
    </g>
  );

  let curX = 55;

  if (diff) {
    const dt = BREAKER_TYPES[diff.type]?.diffType || "AC";
    elements.push(
      <g key="diff">
        <rect x={curX} y={midY-28} width={38} height={58} rx={4} fill="#1e293b" stroke="#475569" strokeWidth={1.5}/>
        <text x={curX+19} y={midY-12} textAnchor="middle" fontSize={8} fill="#93c5fd" fontFamily="monospace">ID</text>
        <text x={curX+19} y={midY}    textAnchor="middle" fontSize={9} fill="#60a5fa" fontFamily="monospace" fontWeight="bold">{dt}</text>
        <text x={curX+19} y={midY+12} textAnchor="middle" fontSize={7} fill="#64748b" fontFamily="monospace">30mA</text>
        <rect x={curX+9}  y={midY+18} width={20} height={9} rx={2} fill="#7f1d1d"/>
        <rect x={curX+10} y={midY+19} width={18} height={7} rx={2} fill="#ef4444"/>
        <text x={curX+19} y={midY+25} textAnchor="middle" fontSize={4} fill="white" fontFamily="monospace">TEST</text>
      </g>,
      <line key="wph-d" x1={curX} y1={midY}    x2={curX+38} y2={midY}    stroke={CABLE_COLORS.phase}  strokeWidth={2.5}/>,
      <line key="wn-d"  x1={curX} y1={midY+20} x2={curX+38} y2={midY+20} stroke={CABLE_COLORS.neutre} strokeWidth={2.5}/>,
      <line key="wpe-d" x1={curX} y1={midY+38} x2={curX+38} y2={midY+38} stroke={CABLE_COLORS.terre}  strokeWidth={2.5} strokeDasharray="5,3"/>
    );
    curX += 58;
  }

  elements.push(
    <g key="brk">
      <rect x={curX} y={midY-22} width={28} height={44} rx={4} fill="#e8e8e6" stroke="#c0c0bc" strokeWidth={1.5}/>
      <rect x={curX+7} y={midY-14} width={14} height={28} rx={4} fill="#1a1a1a"/>
      <rect x={curX+9} y={midY-12} width={10} height={10} rx={3} fill="#2d2d2d"/>
      <rect x={curX+11} y={midY-11} width={3} height={8} rx={1.5} fill="rgba(255,255,255,0.5)"/>
      <text x={curX+14} y={midY+10} textAnchor="middle" fontSize={8} fill="white" fontFamily="monospace">{breaker.amperes}A</text>
    </g>,
    <line key="bph1" x1={curX}    y1={midY}    x2={curX+2}  y2={midY}    stroke={CABLE_COLORS.phase}  strokeWidth={2.5}/>,
    <line key="bph2" x1={curX+26} y1={midY}    x2={curX+56} y2={midY}    stroke={CABLE_COLORS.phase}  strokeWidth={2.5}/>,
    <line key="bn"   x1={curX}    y1={midY+20} x2={curX+56} y2={midY+20} stroke={CABLE_COLORS.neutre} strokeWidth={2.5}/>,
    <line key="bpe"  x1={curX}    y1={midY+38} x2={curX+56} y2={midY+38} stroke={CABLE_COLORS.terre}  strokeWidth={2.5} strokeDasharray="5,3"/>
  );
  if (spec?.section) {
    elements.push(
      <text key="sec" x={curX+13} y={midY-26} textAnchor="middle" fontSize={8} fill="#64748b" fontFamily="monospace">{spec.section}mm²</text>
    );
  }
  curX += 56;

  if (isLight) {
    const phY = midY, nY = midY+20, peY = midY+38;
    if (switchType === "simple") {
      const swX = curX + 40;
      elements.push(
        <line key="ps1" x1={curX} y1={phY} x2={swX-12} y2={phY} stroke={CABLE_COLORS.phase} strokeWidth={2.5}/>,
        <g key="sw">
          <rect x={swX-12} y={phY-12} width={24} height={24} rx={4} fill="#1e293b" stroke="#64748b" strokeWidth={1}/>
          <circle cx={swX} cy={phY} r={5} fill="none" stroke="#94a3b8" strokeWidth={1.5}/>
          <line x1={swX} y1={phY-5} x2={swX+7} y2={phY-10} stroke="#94a3b8" strokeWidth={1.5}/>
          <text x={swX} y={phY+24} textAnchor="middle" fontSize={8} fill="#64748b" fontFamily="monospace">I.S.</text>
        </g>,
        <line key="ps2" x1={swX+12} y1={phY} x2={swX+50} y2={phY} stroke={CABLE_COLORS.retour} strokeWidth={2.5}/>,
        <text key="rl" x={swX+31} y={phY-8} textAnchor="middle" fontSize={8} fill={CABLE_COLORS.retour} fontFamily="monospace">retour</text>
      );
      for (let i = 0; i < lampCount; i++) {
        const lx = swX + 78 + i*58;
        elements.push(
          <g key={`l${i}`}>
            <circle cx={lx} cy={phY} r={12} fill="#1e293b" stroke="#fbbf24" strokeWidth={1.5}/>
            <line x1={lx-7} y1={phY-7} x2={lx+7} y2={phY+7} stroke="#fbbf24" strokeWidth={1.5}/>
            <line x1={lx+7} y1={phY-7} x2={lx-7} y2={phY+7} stroke="#fbbf24" strokeWidth={1.5}/>
          </g>,
          <line key={`ln${i}`} x1={lx} y1={phY+12} x2={lx} y2={nY} stroke={CABLE_COLORS.neutre} strokeWidth={2.5}/>,
          <line key={`lc${i}`} x1={i===0?swX+62:lx-46} y1={phY} x2={lx-12} y2={phY} stroke={CABLE_COLORS.retour} strokeWidth={2.5}/>
        );
      }
      const lastLx = swX + 78 + (lampCount-1)*58;
      elements.push(
        <line key="nline"  x1={curX} y1={nY}  x2={lastLx+58} y2={nY}  stroke={CABLE_COLORS.neutre} strokeWidth={2.5}/>,
        <line key="peline" x1={curX} y1={peY} x2={lastLx+58} y2={peY} stroke={CABLE_COLORS.terre}  strokeWidth={2.5} strokeDasharray="5,3"/>
      );
    } else if (switchType === "vav") {
      const sw1X = curX+40, sw2X = curX+200;
      elements.push(
        <line key="ps1" x1={curX} y1={phY} x2={sw1X-14} y2={phY} stroke={CABLE_COLORS.phase} strokeWidth={2.5}/>,
        <g key="vav1">
          <rect x={sw1X-14} y={phY-14} width={28} height={28} rx={4} fill="#1e293b" stroke="#f97316" strokeWidth={1.5}/>
          <circle cx={sw1X} cy={phY} r={5} fill="none" stroke="#f97316" strokeWidth={1.5}/>
          <line x1={sw1X} y1={phY-5} x2={sw1X+7} y2={phY-10} stroke="#f97316" strokeWidth={1.5}/>
          <line x1={sw1X} y1={phY+5} x2={sw1X+7} y2={phY+10} stroke="#f97316" strokeWidth={1.5}/>
          <text x={sw1X} y={phY+26} textAnchor="middle" fontSize={8} fill="#f97316" fontFamily="monospace">V&amp;V 1</text>
        </g>,
        <line key="nav1" x1={sw1X+14} y1={phY-8} x2={sw2X-14} y2={phY-8} stroke={CABLE_COLORS.navette} strokeWidth={2.5}/>,
        <line key="nav2" x1={sw1X+14} y1={phY+8} x2={sw2X-14} y2={phY+8} stroke={CABLE_COLORS.navette} strokeWidth={2.5}/>,
        <text key="nvl" x={(sw1X+sw2X)/2} y={phY-14} textAnchor="middle" fontSize={8} fill={CABLE_COLORS.navette} fontFamily="monospace">navettes</text>,
        <g key="vav2">
          <rect x={sw2X-14} y={phY-14} width={28} height={28} rx={4} fill="#1e293b" stroke="#f97316" strokeWidth={1.5}/>
          <circle cx={sw2X} cy={phY} r={5} fill="none" stroke="#f97316" strokeWidth={1.5}/>
          <line x1={sw2X} y1={phY-5} x2={sw2X+7} y2={phY-10} stroke="#f97316" strokeWidth={1.5}/>
          <line x1={sw2X} y1={phY+5} x2={sw2X+7} y2={phY+10} stroke="#f97316" strokeWidth={1.5}/>
          <text x={sw2X} y={phY+26} textAnchor="middle" fontSize={8} fill="#f97316" fontFamily="monospace">V&amp;V 2</text>
        </g>,
        <line key="ret" x1={sw2X+14} y1={phY} x2={sw2X+50} y2={phY} stroke={CABLE_COLORS.retour} strokeWidth={2.5}/>,
        <text key="retl" x={sw2X+32} y={phY-8} textAnchor="middle" fontSize={8} fill={CABLE_COLORS.retour} fontFamily="monospace">retour</text>
      );
      for (let i = 0; i < lampCount; i++) {
        const lx = sw2X+78+i*56;
        elements.push(
          <g key={`l${i}`}>
            <circle cx={lx} cy={phY} r={12} fill="#1e293b" stroke="#fbbf24" strokeWidth={1.5}/>
            <line x1={lx-7} y1={phY-7} x2={lx+7} y2={phY+7} stroke="#fbbf24" strokeWidth={1.5}/>
            <line x1={lx+7} y1={phY-7} x2={lx-7} y2={phY+7} stroke="#fbbf24" strokeWidth={1.5}/>
          </g>,
          <line key={`ln${i}`} x1={lx} y1={phY+12} x2={lx} y2={nY} stroke={CABLE_COLORS.neutre} strokeWidth={2.5}/>,
          <line key={`lc${i}`} x1={i===0?sw2X+62:lx-44} y1={phY} x2={lx-12} y2={phY} stroke={CABLE_COLORS.retour} strokeWidth={2.5}/>
        );
      }
      const lastLx = sw2X+78+(lampCount-1)*56;
      elements.push(
        <line key="nline"  x1={curX} y1={nY}  x2={lastLx+56} y2={nY}  stroke={CABLE_COLORS.neutre} strokeWidth={2.5}/>,
        <line key="peline" x1={curX} y1={peY} x2={lastLx+56} y2={peY} stroke={CABLE_COLORS.terre}  strokeWidth={2.5} strokeDasharray="5,3"/>
      );
    } else {
      const btnSpacing = 55, teleX = curX+30+switchCount*btnSpacing+20;
      elements.push(<line key="pbus" x1={curX} y1={phY} x2={teleX-16} y2={phY} stroke={CABLE_COLORS.phase} strokeWidth={2.5}/>);
      for (let i = 0; i < switchCount; i++) {
        const bx = curX+30+i*btnSpacing;
        elements.push(
          <g key={`btn${i}`}>
            <circle cx={bx} cy={phY-28} r={10} fill="#1e293b" stroke="#94a3b8" strokeWidth={1.5}/>
            <rect x={bx-4} y={phY-33} width={8} height={4} rx={1} fill="#94a3b8"/>
            <text x={bx} y={phY-44} textAnchor="middle" fontSize={7} fill="#64748b" fontFamily="monospace">BP {i+1}</text>
            <line x1={bx} y1={phY-18} x2={bx} y2={phY} stroke={CABLE_COLORS.phase} strokeWidth={1.5}/>
            <line x1={bx} y1={phY-38} x2={bx} y2={phY-50} stroke={CABLE_COLORS.phase} strokeWidth={1.5}/>
            <line x1={bx} y1={phY-50} x2={teleX} y2={phY-50} stroke={CABLE_COLORS.navette} strokeWidth={2}/>
          </g>
        );
      }
      elements.push(
        <line key="nav-d" x1={teleX} y1={phY-50} x2={teleX} y2={phY-28} stroke={CABLE_COLORS.navette} strokeWidth={2}/>,
        <g key="tele">
          <rect x={teleX-16} y={phY-16} width={32} height={32} rx={4} fill="#1e293b" stroke="#7c3aed" strokeWidth={1.5}/>
          <text x={teleX} y={phY-3} textAnchor="middle" fontSize={7} fill="#a78bfa" fontFamily="monospace">TELE</text>
          <text x={teleX} y={phY+9} textAnchor="middle" fontSize={7} fill="#7c3aed" fontFamily="monospace">RUPT.</text>
        </g>,
        <text key="nvl" x={teleX} y={phY-54} textAnchor="middle" fontSize={8} fill={CABLE_COLORS.navette} fontFamily="monospace">navettes</text>,
        <line key="ret" x1={teleX+16} y1={phY} x2={teleX+50} y2={phY} stroke={CABLE_COLORS.retour} strokeWidth={2.5}/>,
        <text key="retl" x={teleX+33} y={phY-8} textAnchor="middle" fontSize={8} fill={CABLE_COLORS.retour} fontFamily="monospace">retour</text>
      );
      for (let i = 0; i < lampCount; i++) {
        const lx = teleX+68+i*56;
        elements.push(
          <g key={`l${i}`}>
            <circle cx={lx} cy={phY} r={12} fill="#1e293b" stroke="#fbbf24" strokeWidth={1.5}/>
            <line x1={lx-7} y1={phY-7} x2={lx+7} y2={phY+7} stroke="#fbbf24" strokeWidth={1.5}/>
            <line x1={lx+7} y1={phY-7} x2={lx-7} y2={phY+7} stroke="#fbbf24" strokeWidth={1.5}/>
          </g>,
          <line key={`ln${i}`} x1={lx} y1={phY+12} x2={lx} y2={nY} stroke={CABLE_COLORS.neutre} strokeWidth={2.5}/>,
          <line key={`lc${i}`} x1={i===0?teleX+51:lx-44} y1={phY} x2={lx-12} y2={phY} stroke={CABLE_COLORS.retour} strokeWidth={2.5}/>
        );
      }
      const lastLx = teleX+68+(lampCount-1)*56;
      elements.push(
        <line key="nline"  x1={curX} y1={nY}  x2={lastLx+56} y2={nY}  stroke={CABLE_COLORS.neutre} strokeWidth={2.5}/>,
        <line key="peline" x1={curX} y1={peY} x2={lastLx+56} y2={peY} stroke={CABLE_COLORS.terre}  strokeWidth={2.5} strokeDasharray="5,3"/>
      );
    }
  } else if (isPrise) {
    const outX = curX+40;
    elements.push(
      <g key="sock">
        <circle cx={outX} cy={midY} r={14} fill="#1e293b" stroke="#94a3b8" strokeWidth={1.5}/>
        <circle cx={outX-5} cy={midY} r={2.5} fill="none" stroke="#94a3b8" strokeWidth={1.5}/>
        <circle cx={outX+5} cy={midY} r={2.5} fill="none" stroke="#94a3b8" strokeWidth={1.5}/>
        <line x1={outX} y1={midY+6} x2={outX} y2={midY+11} stroke="#16A34A" strokeWidth={1.5}/>
      </g>,
      <line key="sph"  x1={curX} y1={midY}    x2={outX-14} y2={midY}    stroke={CABLE_COLORS.phase}  strokeWidth={2.5}/>,
      <line key="sn"   x1={curX} y1={midY+20} x2={outX}    y2={midY+20} stroke={CABLE_COLORS.neutre} strokeWidth={2.5}/>,
      <line key="sn2"  x1={outX} y1={midY+14} x2={outX}    y2={midY+20} stroke={CABLE_COLORS.neutre} strokeWidth={2.5}/>,
      <line key="spe"  x1={curX} y1={midY+38} x2={outX}    y2={midY+38} stroke={CABLE_COLORS.terre}  strokeWidth={2.5} strokeDasharray="5,3"/>,
      <line key="spe2" x1={outX} y1={midY+25} x2={outX}    y2={midY+38} stroke={CABLE_COLORS.terre}  strokeWidth={2.5} strokeDasharray="5,3"/>
    );
  } else {
    const outX = curX+40;
    elements.push(
      <g key="app">
        <rect x={outX-18} y={midY-18} width={36} height={36} rx={6} fill="#1e293b" stroke="#475569" strokeWidth={1.5}/>
        <text x={outX} y={midY+7} textAnchor="middle" fontSize={18}>{circuit.icon}</text>
      </g>,
      <line key="aph"  x1={curX}    y1={midY}    x2={outX-18} y2={midY}    stroke={CABLE_COLORS.phase}  strokeWidth={2.5}/>,
      <line key="an"   x1={curX}    y1={midY+20} x2={outX-18} y2={midY+20} stroke={CABLE_COLORS.neutre} strokeWidth={2.5}/>,
      <line key="an2"  x1={outX-18} y1={midY+20} x2={outX-18} y2={midY+18} stroke={CABLE_COLORS.neutre} strokeWidth={2.5}/>,
      <line key="ape"  x1={curX}    y1={midY+38} x2={outX-18} y2={midY+38} stroke={CABLE_COLORS.terre}  strokeWidth={2.5} strokeDasharray="5,3"/>,
      <line key="ape2" x1={outX-18} y1={midY+38} x2={outX-18} y2={midY+18} stroke={CABLE_COLORS.terre}  strokeWidth={2.5} strokeDasharray="5,3"/>
    );
  }

  const vbW = isLight && switchType === "telerupteur" ? 220+switchCount*55+lampCount*56+150
    : isLight && switchType === "vav" ? 520+lampCount*56
    : isLight ? 360+lampCount*58 : 420;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <div className="flex items-center gap-2">
            <span className="text-xl">{circuit.icon}</span>
            <div>
              <p className="font-semibold text-ink-900">Schéma — {breaker.label || circuit.label}</p>
              <p className="text-xs font-mono text-ink-400">
                {breaker.amperes}A · {spec?.section}mm² · Diff. Type {diff ? BREAKER_TYPES[diff.type]?.diffType : "—"}
                {breaker.pieces.length > 0 && ` · ${breaker.pieces.map(p => p.nom).filter(Boolean).join(", ")}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost !px-2 !py-1">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-ink-200">
          {([["unifilaire", "⚡ Schéma unifilaire"], ["gaines", "🔀 Cheminement gaines"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 py-2.5 text-xs font-semibold transition-all border-b-2 ${
                tab === key
                  ? "border-volt-400 text-volt-600 bg-volt-50"
                  : "border-transparent text-ink-400 hover:text-ink-700"
              }`}>{label}</button>
          ))}
        </div>

        {/* Unifilaire */}
        {tab === "unifilaire" && (
          <>
            {isLight && firstPiece && (
              <div className="flex flex-wrap gap-3 p-3 border-b border-ink-200 bg-ink-50 text-xs">
                <span className="text-ink-500">Vue : <strong className="text-ink-800">{firstPiece.nom || "Pièce 1"}</strong></span>
                <span className="text-ink-400">
                  {switchType === "simple" ? "Interrupteur simple" : switchType === "vav" ? `Va-et-vient (${switchCount})` : `Télérupteur (${switchCount} BP)`}
                  {" · "}{lampCount} pt{lampCount > 1 ? "s" : ""} lumineux
                </span>
              </div>
            )}
            <div className="flex-1 overflow-x-auto p-4 bg-slate-900">
              <svg viewBox={`0 0 ${vbW} ${H}`} width="100%" style={{ minWidth: Math.min(vbW, 380), display: "block" }}>
                <rect width={vbW} height={H} fill="#0f172a" rx="8"/>
                {elements}
              </svg>
            </div>
            <div className="flex flex-wrap gap-4 px-4 py-3 border-t border-ink-200 bg-ink-50">
              {[
                { color: CABLE_COLORS.phase,   label: "Phase" },
                { color: CABLE_COLORS.neutre,  label: "Neutre" },
                { color: CABLE_COLORS.terre,   label: "Terre", dash: true },
                ...(isLight ? [
                  { color: CABLE_COLORS.retour, label: "Retour lampe" },
                  ...(switchType !== "simple" ? [{ color: CABLE_COLORS.navette, label: "Navette" }] : []),
                ] : []),
              ].map(({ color, label, dash }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <svg width={24} height={6}>
                    <line x1={0} y1={3} x2={24} y2={3} stroke={color} strokeWidth={2} strokeDasharray={dash ? "4,3" : "none"}/>
                  </svg>
                  <span className="text-xs font-mono text-ink-500">{label}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Gaines */}
        {tab === "gaines" && (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {gainesData.length === 0 ? (
              <div className="text-center py-12 text-ink-400">
                <p className="text-sm mb-1">Aucune pièce configurée</p>
                <p className="text-xs">Renseignez les pièces desservies dans la configuration du disjoncteur</p>
              </div>
            ) : (
              <>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 flex gap-2">
                  <span className="shrink-0">📋</span>
                  <span>NFC 15-100 art. 529.1 — Taux de remplissage gaine ≤ 1/3 de la section intérieure. Boîtes de dérivation accessibles obligatoires (art. 526.3).</span>
                </div>
                {gainesData.map((g, gi) => {
                  const gaineInfo = gaineRecommandee(g.cables);
                  const tauxColor = gaineInfo.tauxPct <= 20
                    ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                    : gaineInfo.tauxPct <= 33
                    ? "text-amber-700 bg-amber-50 border-amber-200"
                    : "text-red-700 bg-red-50 border-red-200";
                  return (
                    <div key={gi} className="border border-ink-200 rounded-2xl overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-ink-900">
                        <span className="text-volt-400 font-mono font-bold text-sm">{g.nom}</span>
                        {g.boiteDerivation && (
                          <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/30 px-2 py-0.5 rounded-full">
                            🔀 Boîte dérivation
                          </span>
                        )}
                      </div>
                      <div className="p-3 flex flex-col gap-1.5">
                        {g.circuits.map((c, ci) => (
                          <div key={ci} className="flex items-center gap-2 text-xs text-ink-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-volt-400 shrink-0"></span>
                            {c}
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between px-3 py-2.5 bg-ink-50 border-t border-ink-100 gap-3">
                        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                          <span className="text-xs text-ink-500">{g.raison}</span>
                          {g.boiteDerivation && (
                            <span className="text-[10px] text-amber-600 font-mono">
                              → Boîte accessible obligatoire — art. 526.3 NFC 15-100
                            </span>
                          )}
                        </div>
                        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono font-bold shrink-0 ${tauxColor}`}>
                          <span>{gaineInfo.gaine}</span>
                          <span className="opacity-70 text-[10px]">{gaineInfo.tauxPct}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-3 text-[10px] font-mono text-ink-400 pt-1">
                  <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1"></span>{"< 20%"} — optimal</span>
                  <span><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1"></span>{"≤ 33%"} — limite NFC</span>
                  <span><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1"></span>{"> 33%"} — hors norme</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DIN RAIL ROW ─────────────────────────────────────────────────────────────

function DinRailRow({ row, globalOffset, selectedSlot, compliance, onClickSlot, onDeleteRow, onUpdateName }: {
  row: BreakerRow;
  globalOffset: number;
  selectedSlot: { rowId: number; slotIdx: number } | null;
  compliance: ReturnType<typeof checkNFC>;
  onClickSlot: (rowId: number, slotIdx: number) => void;
  onDeleteRow: (rowId: number) => void;
  onUpdateName: (rowId: number, name: string) => void;
}) {
  const totalW = DIFF_W + 8 * SLOT_W + 9 * 4 + 40;
  const panelW = Math.max(totalW, 400);

  const getIssue = (b: Breaker | null) => {
    if (!b) return null;
    if (compliance.errors.some(e => e.id.includes(String(b.id)))) return "error";
    if (compliance.warnings.some(w => w.id.includes(String(b.id)))) return "warning";
    return null;
  };

  return (
    <div className="mb-10">
      <div className="flex items-center gap-3 mb-2">
        <input value={row.name} onChange={e => onUpdateName(row.id, e.target.value)}
          className="text-xs font-semibold text-ink-600 bg-transparent border-none outline-none font-mono" />
        <button onClick={() => onDeleteRow(row.id)} className="text-ink-300 hover:text-red-400 transition-colors ml-auto">
          <Trash2 size={14} />
        </button>
      </div>
      <div style={{
        background: "linear-gradient(160deg,#d1d5db 0%,#9ca3af 60%,#6b7280 100%)",
        borderRadius: 8, padding: "16px 16px 50px", width: panelW,
        display: "inline-flex", alignItems: "flex-start", gap: 4,
        boxShadow: "inset 0 2px 6px rgba(0,0,0,0.2), 0 4px 12px rgba(0,0,0,0.15)",
        border: "2px solid #9ca3af", position: "relative" as const,
      }}>
        <div style={{ position: "absolute", left: 12, right: 12, top: 16 + BREAKER_H * 0.40, height: 7, background: "linear-gradient(180deg,#b0b8c0,#6b7280,#9ca3af)", borderRadius: 1, boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
        <div style={{ position: "absolute", left: 12, right: 12, top: 16 + BREAKER_H * 0.40 + 9, height: 3, background: "linear-gradient(180deg,#4b5563,#374151)" }} />
        {([[6,6],[panelW-22,6],[6,16+BREAKER_H+4],[panelW-22,16+BREAKER_H+4]] as [number,number][]).map(([x,y],i) => (
          <div key={i} style={{ position: "absolute", left: x, top: y, width: 12, height: 12, borderRadius: "50%", background: "radial-gradient(circle at 35% 35%,#e5e7eb,#6b7280)", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.4)", zIndex: 2 }} />
        ))}
        <SlotCell breaker={row.slots[0]} slotIdx={0} isDiffSlot issue={getIssue(row.slots[0])}
          isSelected={selectedSlot?.rowId === row.id && selectedSlot?.slotIdx === 0}
          globalNum={globalOffset + 1} onClick={() => onClickSlot(row.id, 0)} />
        {Array.from({ length: 8 }, (_, i) => i + 1).map(slotIdx => (
          <SlotCell key={slotIdx} breaker={row.slots[slotIdx]} slotIdx={slotIdx}
            issue={getIssue(row.slots[slotIdx])}
            isSelected={selectedSlot?.rowId === row.id && selectedSlot?.slotIdx === slotIdx}
            globalNum={globalOffset + slotIdx + 1} onClick={() => onClickSlot(row.id, slotIdx)} />
        ))}
      </div>
    </div>
  );
}

function SlotCell({ breaker, slotIdx, isDiffSlot, issue, isSelected, globalNum, onClick }: {
  breaker: Breaker | null; slotIdx: number; isDiffSlot?: boolean;
  issue: "error" | "warning" | null; isSelected: boolean;
  globalNum: number; onClick: () => void;
}) {
  const w = isDiffSlot ? DIFF_W : SLOT_W;
  const label = breaker ? (breaker.label || (CIRCUITS[breaker.circuit]?.label ?? "")) : "";

  return (
    <div onClick={onClick} style={{
      position: "relative", zIndex: 1, cursor: "pointer", flexShrink: 0,
      transform: isSelected ? "translateY(-3px)" : "none", transition: "transform 0.1s",
      filter: issue === "error" ? "drop-shadow(0 0 6px rgba(239,68,68,0.6))"
            : issue === "warning" ? "drop-shadow(0 0 5px rgba(245,158,11,0.5))"
            : isSelected ? "drop-shadow(0 4px 10px rgba(245,158,11,0.4))" : "none",
    }}>
      <BreakerSVG breaker={breaker} isEmpty={!breaker} isSelected={isSelected} isDiffSlot={isDiffSlot} />
      {issue && (
        <div style={{ position: "absolute", top: 4, right: 4, width: 14, height: 14, borderRadius: "50%", background: issue === "error" ? "#ef4444" : "#f59e0b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "white", fontWeight: "bold" }}>!</div>
      )}
      <div style={{
        position: "absolute", bottom: -34, left: 0, right: 0, height: 32,
        background: "#fffde7",
        border: `1px solid ${issue==="error" ? "#ef4444" : issue==="warning" ? "#f59e0b" : "#d4c97a"}`,
        borderRadius: 2, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", padding: "1px 3px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
      }}>
        {breaker && (
          <div style={{ fontSize: Math.max(6, 9 - Math.max(0, label.length - 8)), fontWeight: 700, color: "#1c1917", textAlign: "center", lineHeight: 1.2, fontFamily: "monospace", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", width: "100%", paddingLeft: 2, paddingRight: 2 }}>
            {(CIRCUITS[breaker.circuit]?.icon ?? "")} {label}
          </div>
        )}
        <div style={{ fontSize: 6, color: "#a8a29e", fontFamily: "monospace" }}>
          {breaker ? `N°${globalNum}` : "—"}
        </div>
      </div>
      {isSelected && (
        <div style={{ position: "absolute", bottom: -58, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap", zIndex: 10, background: "#1c1917", color: "#fbbf24", border: "1px solid #fbbf24", borderRadius: 6, fontSize: 10, fontWeight: 700, padding: "3px 8px", display: "flex", alignItems: "center", gap: 4 }}>
          <Settings2 size={10} />
          {breaker ? "Configurer" : "Ajouter"}
        </div>
      )}
    </div>
  );
}

// ─── PRINT LABELS — libellé général uniquement ────────────────────────────────

function printLabels(rows: BreakerRow[], clientName: string) {
  let gn = 0, html = "";
  rows.forEach(row => {
    row.slots.forEach(b => {
      if (!b) return;
      gn++;
      const c = CIRCUITS[b.circuit] || CIRCUITS.autre;
      const label = b.label || c.label;
      html += `<div style="display:inline-flex;flex-direction:column;align-items:center;justify-content:center;width:28mm;height:22mm;border:1.5px solid #333;border-radius:2mm;overflow:hidden;background:#fff;vertical-align:top;margin:2mm;font-family:'Courier New',monospace;">
        <div style="font-size:18pt;line-height:1;margin-bottom:2mm;">${c.icon}</div>
        <div style="font-size:8pt;font-weight:700;color:#111;text-align:center;padding:0 2mm;line-height:1.2;">${label}</div>
      </div>`;
    });
  });
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<html><head><title>Étiquettes — ${clientName}</title><style>@page{margin:8mm}body{margin:0;background:#fff;}</style></head><body>
    <div style="padding:4mm 6mm 2mm;font-family:monospace;font-size:8pt;color:#555;border-bottom:1px solid #ddd;margin-bottom:3mm;">${clientName} — ${gn} étiquette${gn>1?"s":""}</div>
    ${html}</body></html>`);
  w.document.close();
  setTimeout(() => { w.print(); w.close(); }, 400);
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function TableauPage() {
  const params   = useParams();
  const clientId = params.clientId as string;

  const [client, setClient]   = useState<Client | null>(null);
  const [rows, setRows]       = useState<BreakerRow[]>([]);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [loading, setLoading] = useState(true);

  const [selectedSlot, setSelectedSlot]   = useState<{ rowId: number; slotIdx: number } | null>(null);
  const [editBreaker, setEditBreaker]     = useState<{ breaker: Breaker; rowId: number; slotIdx: number } | null>(null);
  const [schemaBreaker, setSchemaBreaker] = useState<{ breaker: Breaker; rowBreakers: (Breaker|null)[] } | null>(null);
  const [showReport, setShowReport]       = useState(false);

  useEffect(() => {
    supabase.from("clients").select("*").eq("id", clientId).single().then(({ data: c }) => {
      if (c) {
        setClient(c);
        if (c.tableau_config) {
          try {
            const parsed = JSON.parse(c.tableau_config);
            if (!Array.isArray(parsed)) { setLoading(false); return; }
            const normalized = parsed.map((row: any) => {
              if (!row || typeof row !== "object") return null;
              const slots: (Breaker | null)[] = Array(9).fill(null);
              const rawSlots = Array.isArray(row.slots) ? row.slots : (Array.isArray(row.breakers) ? row.breakers : []);
              rawSlots.forEach((b: any, i: number) => {
                if (i >= 9 || b == null || typeof b !== "object" || typeof b.type !== "string") return;
                slots[i] = {
                  id: b.id ?? uid(),
                  label: b.label ?? "",
                  circuit: b.circuit ?? "autre",
                  amperes: b.amperes ?? 16,
                  type: b.type,
                  pieces: Array.isArray(b.pieces) ? b.pieces : (
                    (b.switchType || b.lampCount || b.switchCount) ? [{
                      nom: b.label ?? "",
                      pointsLumineux: b.lampCount ?? 1,
                      typeCommande: (b.switchType ?? "simple") as CommandeType,
                      nbCommandes: b.switchCount ?? 1,
                      nbPrises: 1,
                    }] : []
                  ),
                } as Breaker;
              });
              return { id: row.id ?? uid(), name: row.name ?? "Rangée", slots };
            }).filter(Boolean) as BreakerRow[];
            setRows(normalized);
          } catch {}
        }
      }
      setLoading(false);
    });
  }, [clientId]);

  const compliance = useMemo(() => checkNFC(rows), [rows]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    await supabase.from("clients").update({ tableau_config: JSON.stringify(rows) }).eq("id", clientId);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [rows, clientId]);

  const addRow = () => setRows(r => [...r, emptyRow(r.length + 1)]);

  const deleteRow = (rowId: number) => {
    setRows(r => r.filter(x => x.id !== rowId));
    if (selectedSlot?.rowId === rowId) setSelectedSlot(null);
  };

  const updateRowName = (rowId: number, name: string) =>
    setRows(r => r.map(x => x.id === rowId ? { ...x, name } : x));

  const handleClickSlot = (rowId: number, slotIdx: number) => {
    const row = rows.find(r => r.id === rowId);
    if (!row) return;
    if (selectedSlot?.rowId === rowId && selectedSlot?.slotIdx === slotIdx) {
      const existing = row.slots[slotIdx];
      const isDiffSlot = slotIdx === 0;
      const defaultBreaker: Breaker = existing ?? {
        id: uid(),
        label: "",
        circuit: isDiffSlot ? "general" : "prise_16",
        amperes: isDiffSlot ? 25 : 16,
        type: isDiffSlot ? "diff-AC" : "1P",
        pieces: [],
      };
      setEditBreaker({ breaker: defaultBreaker, rowId, slotIdx });
      return;
    }
    setSelectedSlot({ rowId, slotIdx });
  };

  const updateSlot = (rowId: number, slotIdx: number, breaker: Breaker) => {
    setRows(r => r.map(row => {
      if (row.id !== rowId) return row;
      const newSlots = [...row.slots];
      newSlots[slotIdx] = breaker;
      return { ...row, slots: newSlots };
    }));
  };

  const removeSlot = (rowId: number, slotIdx: number) => {
    setRows(r => r.map(row => {
      if (row.id !== rowId) return row;
      const newSlots = [...row.slots];
      newSlots[slotIdx] = null;
      return { ...row, slots: newSlots };
    }));
    setEditBreaker(null);
    setSelectedSlot(null);
  };

  const getOffset = (ri: number) =>
    rows.slice(0, ri).reduce((s, r) => s + safeBreakers(r.slots ?? []).length, 0);

  const scoreColor = compliance.score >= 85 ? "text-emerald-600 bg-emerald-50 border-emerald-200"
    : compliance.score >= 60 ? "text-amber-600 bg-amber-50 border-amber-200"
    : "text-red-600 bg-red-50 border-red-200";
  const ScoreIcon = compliance.score >= 85 ? ShieldCheck : compliance.score >= 60 ? ShieldAlert : ShieldX;

  if (loading) return <Shell><div className="flex items-center justify-center h-64 text-ink-400">Chargement…</div></Shell>;

  return (
    <Shell>
      <div className="flex flex-col h-[calc(100vh-4rem)] md:h-screen overflow-hidden">

        <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-ink-200 bg-white shrink-0 gap-3">
          <div className="flex items-center gap-3">
            <Link href={`/clients/${clientId}`} className="btn-ghost !px-2 !py-1.5 text-ink-400">
              <ArrowLeft size={16} />
            </Link>
            <div>
              <h1 className="font-display text-lg text-ink-900 leading-tight">Tableau électrique</h1>
              {client && (
                <p className="text-xs text-ink-400">
                  {client.prenom ? `${client.prenom} ${client.nom}` : client.nom}
                  {client.adresse ? ` · ${client.adresse}` : ""}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setShowReport(true)}
              className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${scoreColor}`}>
              <ScoreIcon size={13} /> NFC {compliance.score}/100
            </button>
            <button onClick={() => printLabels(rows, client?.nom ?? "")} className="btn-ghost hidden md:flex">
              <Printer size={15} /> Étiquettes
            </button>
            <button onClick={handleSave} disabled={saving}
              className={`btn-volt ${saved ? "!bg-emerald-500 !border-emerald-600 !text-white" : ""}`}>
              <Save size={15} />
              {saving ? "…" : saved ? "Sauvegardé !" : "Sauvegarder"}
            </button>
          </div>
        </div>

        <div className="px-6 py-2 bg-ink-50 border-b border-ink-100 text-xs text-ink-400 hidden md:block">
          1er clic = sélectionner · 2e clic = configurer · Chaque rangée : 1 différentiel + 8 disjoncteurs
        </div>

        <div className="flex-1 overflow-auto p-4 md:p-8">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-ink-100 flex items-center justify-center">
                <Zap size={28} className="text-ink-300" />
              </div>
              <p className="text-ink-500 font-medium">Tableau vide</p>
              <p className="text-ink-400 text-sm text-center max-w-xs">Ajoutez une rangée pour commencer.</p>
              <button onClick={addRow} className="btn-volt"><Plus size={15} /> Ajouter une rangée</button>
            </div>
          ) : (
            <>
              <div style={{ background: "linear-gradient(170deg,#374151 0%,#1f2937 100%)", borderRadius: 14, padding: "24px 24px 12px", boxShadow: "0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)", border: "2px solid #4b5563", display: "inline-block", minWidth: 400 }}>
                <div style={{ background: "#111827", borderRadius: 7, padding: "6px 16px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: "#F59E0B", fontFamily: "monospace", fontWeight: 700, letterSpacing: 2 }}>TABLEAU ÉLECTRIQUE</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[
                      compliance.errors.length > 0  ? "#ef4444" : "#374151",
                      compliance.warnings.length > 0 ? "#f59e0b" : "#374151",
                      compliance.score >= 85          ? "#10b981" : "#374151",
                    ].map((c, i) => (
                      <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: c, boxShadow: c !== "#374151" ? `0 0 6px ${c}` : "none" }} />
                    ))}
                  </div>
                </div>
                {rows.map((row, ri) => (
                  <DinRailRow key={row.id} row={row} globalOffset={getOffset(ri)}
                    selectedSlot={selectedSlot} compliance={compliance}
                    onClickSlot={handleClickSlot} onDeleteRow={deleteRow} onUpdateName={updateRowName} />
                ))}
              </div>
              <div className="mt-6">
                <button onClick={addRow} className="btn-ghost border-dashed border-ink-300 text-ink-400 hover:text-volt-600 hover:border-volt-300">
                  <Plus size={15} /> Ajouter une rangée
                </button>
              </div>
            </>
          )}

          <div className="flex gap-2 mt-6 md:hidden">
            <button onClick={() => setShowReport(true)}
              className={`btn flex-1 text-xs items-center justify-center gap-1.5 px-3 py-2 rounded-xl border font-semibold ${scoreColor}`}>
              <ScoreIcon size={13} /> NFC {compliance.score}/100
            </button>
            <button onClick={() => printLabels(rows, client?.nom ?? "")} className="btn-ghost">
              <Printer size={15} />
            </button>
          </div>
        </div>
      </div>

      {editBreaker && (
        <BreakerEditModal
          breaker={editBreaker.breaker}
          slotIndex={editBreaker.slotIdx}
          compliance={compliance}
          onUpdate={updated => {
            updateSlot(editBreaker.rowId, editBreaker.slotIdx, updated);
            setEditBreaker({ ...editBreaker, breaker: updated });
          }}
          onClose={() => { setEditBreaker(null); setSelectedSlot(null); }}
          onShowSchema={b => {
            const row = rows.find(r => r.id === editBreaker.rowId);
            setEditBreaker(null);
            setSchemaBreaker({ breaker: b, rowBreakers: row?.slots ?? [] });
          }}
          onRemove={() => removeSlot(editBreaker.rowId, editBreaker.slotIdx)}
        />
      )}

      {showReport && <CompliancePanel result={compliance} onClose={() => setShowReport(false)} />}

      {schemaBreaker && (
        <CircuitSchema
          breaker={schemaBreaker.breaker}
          rowBreakers={schemaBreaker.rowBreakers}
          onClose={() => setSchemaBreaker(null)}
        />
      )}
    </Shell>
  );
}
