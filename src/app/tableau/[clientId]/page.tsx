"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Client } from "@/types";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import {
  ArrowLeft, Save, Printer, ShieldCheck, ShieldAlert,
  ShieldX, Plus, Trash2, Zap, Settings2,
} from "lucide-react";

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Breaker {
  id: number;
  label: string;
  circuit: string;
  amperes: number;
  type: string;        // "diff-AC" | "diff-A" | "diff-F" | "1P" | "2P"
  switchType?: string;
  switchCount?: number;
  lampCount?: number;
}

interface BreakerRow {
  id: number;
  name: string;
  // Fixed: slot 0 = diff, slots 1-8 = breakers (null = empty)
  slots: (Breaker | null)[];
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const BREAKER_TYPES: Record<string, { label: string; width: number; desc: string; isDiff?: boolean; diffType?: string }> = {
  "1P":      { label: "1P",    width: 1, desc: "Unipolaire" },
  "2P":      { label: "2P",    width: 2, desc: "Bipolaire" },
  "diff-AC": { label: "ID AC", width: 2, desc: "Différentiel Type AC", isDiff: true, diffType: "AC" },
  "diff-A":  { label: "ID A",  width: 2, desc: "Différentiel Type A",  isDiff: true, diffType: "A" },
  "diff-F":  { label: "ID F",  width: 2, desc: "Différentiel Type F",  isDiff: true, diffType: "F" },
};

const CIRCUITS: Record<string, { label: string; icon: string; ampMax: number; dedié: boolean; diffType: string | null; section: string | null }> = {
  lumiere:         { label: "Lumière",          icon: "💡", ampMax: 10, dedié: false, diffType: "AC", section: "1.5" },
  prise_16:        { label: "Prises 16A",       icon: "🔌", ampMax: 16, dedié: false, diffType: "AC", section: "1.5" },
  prise_20:        { label: "Prises 20A",       icon: "🔌", ampMax: 20, dedié: false, diffType: "AC", section: "2.5" },
  cuisine_prises:  { label: "Prises cuisine",   icon: "🍳", ampMax: 20, dedié: false, diffType: "AC", section: "2.5" },
  plaque:          { label: "Plaque cuisson",   icon: "🔥", ampMax: 32, dedié: true,  diffType: "A",  section: "6.0" },
  four:            { label: "Four",             icon: "🥘", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5" },
  lave_linge:      { label: "Lave-linge",       icon: "🧺", ampMax: 20, dedié: true,  diffType: "A",  section: "2.5" },
  lave_vaisselle:  { label: "Lave-vaisselle",   icon: "🍽️", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5" },
  seche_linge:     { label: "Sèche-linge",      icon: "👕", ampMax: 20, dedié: true,  diffType: "A",  section: "2.5" },
  chauffe_eau:     { label: "Chauffe-eau",      icon: "🚿", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5" },
  chauffage:       { label: "Chauffage élec.",  icon: "🌡️", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5" },
  clim:            { label: "Climatisation",    icon: "❄️", ampMax: 20, dedié: true,  diffType: "F",  section: "2.5" },
  seche_serviette: { label: "Sèche-serviette",  icon: "🛁", ampMax: 16, dedié: true,  diffType: "AC", section: "1.5" },
  congelateur:     { label: "Congélateur",      icon: "🧊", ampMax: 20, dedié: true,  diffType: "AC", section: "2.5" },
  irve:            { label: "IRVE (recharge)",  icon: "🔋", ampMax: 32, dedié: true,  diffType: "A",  section: "6.0" },
  piscine:         { label: "Piscine/PAC",      icon: "🏊", ampMax: 20, dedié: true,  diffType: "F",  section: "2.5" },
  vmc:             { label: "VMC",              icon: "💨", ampMax: 10, dedié: true,  diffType: "AC", section: "1.5" },
  alarme:          { label: "Alarme",           icon: "🔔", ampMax: 6,  dedié: true,  diffType: "AC", section: "1.5" },
  exterieur:       { label: "Extérieur",        icon: "🌿", ampMax: 16, dedié: false, diffType: "AC", section: "1.5" },
  garage:          { label: "Garage",           icon: "🏠", ampMax: 16, dedié: false, diffType: "AC", section: "1.5" },
  general:         { label: "Général / Arrivée",icon: "⚡", ampMax: 63, dedié: true,  diffType: null, section: "10.0" },
  parafoudre:      { label: "Parafoudre",       icon: "⛈️", ampMax: 0,  dedié: true,  diffType: null, section: null },
  autre:           { label: "Autre",            icon: "⚙️", ampMax: 32, dedié: false, diffType: "AC", section: "2.5" },
};

const DIFF_HIERARCHY: Record<string, number> = { AC: 0, A: 1, F: 2 };
const AMPERES = [2, 6, 10, 16, 20, 25, 32, 40, 63];

// Row dimensions
const SLOT_W = 52;   // px per breaker slot
const DIFF_W = 96;   // px for diff slot (double width)
const BREAKER_H = 130;

let _id = 0;
const uid = () => ++_id;

const emptyRow = (rowNum: number): BreakerRow => ({ // v2
  id: uid(),
  name: `Rangée ${rowNum}`,
  slots: Array(9).fill(null),  // slot 0 = diff, slots 1-8 = breakers
});

// ─── NFC CHECKER ──────────────────────────────────────────────────────────────

function safeBreakers(slots: (Breaker | null)[] | undefined): Breaker[] {
  if (!Array.isArray(slots)) return [];
  return slots.filter((b): b is Breaker => b != null && typeof b === "object" && typeof b.type === "string" && b.type.length > 0);
}

function checkNFC(rows: BreakerRow[]) {
  const errors:   { id: string; msg: string; rule: string }[] = [];
  const warnings: { id: string; msg: string; rule: string }[] = [];
  const infos:    { id: string; msg: string; rule: string }[] = [];

  if (!Array.isArray(rows) || rows.length === 0) {
    infos.push({ id: "empty", msg: "Tableau vide — ajoutez des rangées pour commencer.", rule: "—" });
    return { errors, warnings, infos, score: 100 };
  }

  const allBreakers = rows.flatMap(r => safeBreakers(r.slots));
  const diffs = allBreakers.filter(b => b && b.type && BREAKER_TYPES[b.type]?.isDiff);

  if (diffs.length === 0) {
    errors.push({ id: "no-diff", msg: "Aucun différentiel 30mA détecté. Minimum 2 obligatoires.", rule: "Art. 531.2" });
  } else if (diffs.length === 1) {
    errors.push({ id: "one-diff", msg: "Un seul différentiel détecté. Minimum 2 ID 30mA requis.", rule: "Art. 531.2" });
  }

  rows.forEach(row => {
    const rawDiff = Array.isArray(row.slots) ? row.slots[0] : null;
    const diff = (rawDiff != null && typeof rawDiff === 'object' && typeof (rawDiff as any).type === 'string') ? rawDiff as Breaker : null;
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

  const specialTypes = ["plaque","four","lave_linge","lave_vaisselle","chauffe_eau"];
  const found = specialTypes.filter(t => allBreakers.some(b => b.circuit === t)).length;
  if (found < 4) {
    infos.push({ id: "spec", msg: `${found} circuit(s) spécialisé(s) sur 5 recommandés.`, rule: "Art. 771.314.2" });
  }

  const score = Math.max(0, Math.round(100 - errors.length * 15 - warnings.length * 5 - infos.length * 2));
  return { errors, warnings, infos, score };
}

// ─── LEGRAND-STYLE BREAKER SVG ────────────────────────────────────────────────

function BreakerSVG({ breaker, isEmpty, isSelected, isDiffSlot }: {
  breaker: Breaker | null;
  isEmpty: boolean;
  isSelected: boolean;
  isDiffSlot?: boolean;
}) {
  const w = isDiffSlot ? DIFF_W : SLOT_W;
  const h = BREAKER_H;
  const isDiff = breaker ? !!BREAKER_TYPES[breaker.type]?.isDiff : false;

  // Legrand palette: corps gris clair, levier noir
  const bodyColor = "#e8e8e6";       // gris clair Legrand
  const bodyDark  = "#c8c8c4";       // liseret
  const leverColor = "#1a1a1a";      // levier noir mat
  const leverShine = "#2d2d2d";      // reflet levier

  if (isEmpty) {
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <rect x="1" y="1" width={w-2} height={h-2} rx="4"
          fill="#f1f1ef" stroke="#d4d4d0" strokeWidth="1"
          strokeDasharray="4,3" />
        <text x={w/2} y={h/2+4} textAnchor="middle" fontSize="18" fill="#d4d4d0">+</text>
      </svg>
    );
  }

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <defs>
        {/* Corps: dégradé latéral plastique */}
        <linearGradient id={`body-${breaker!.id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#c8c8c4" />
          <stop offset="8%"   stopColor="#ebebea" />
          <stop offset="50%"  stopColor={bodyColor} />
          <stop offset="92%"  stopColor="#d8d8d4" />
          <stop offset="100%" stopColor="#b8b8b4" />
        </linearGradient>
        {/* Reflet vertical */}
        <linearGradient id={`shine-${breaker!.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="white" stopOpacity="0.35" />
          <stop offset="25%"  stopColor="white" stopOpacity="0.08" />
          <stop offset="100%" stopColor="black" stopOpacity="0.12" />
        </linearGradient>
        {/* Levier */}
        <linearGradient id={`lever-${breaker!.id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#111" />
          <stop offset="30%"  stopColor={leverShine} />
          <stop offset="60%"  stopColor={leverColor} />
          <stop offset="100%" stopColor="#0a0a0a" />
        </linearGradient>
        {/* Vis */}
        <radialGradient id={`screw-${breaker!.id}`} cx="35%" cy="35%" r="65%">
          <stop offset="0%"   stopColor="#f0f0ee" />
          <stop offset="60%"  stopColor="#a0a09c" />
          <stop offset="100%" stopColor="#606060" />
        </radialGradient>
      </defs>

      {/* Ombre portée */}
      <rect x="2" y="3" width={w-3} height={h-3} rx="5" fill="rgba(0,0,0,0.18)" />

      {/* Corps principal */}
      <rect x="0.5" y="0.5" width={w-1} height={h-1} rx="5"
        fill={`url(#body-${breaker!.id})`}
        stroke={bodyDark} strokeWidth="1" />
      <rect x="0.5" y="0.5" width={w-1} height={h-1} rx="5"
        fill={`url(#shine-${breaker!.id})`} />

      {/* Liseret haut (zone bornes) */}
      <rect x="0.5" y="0.5" width={w-1} height="20" rx="5"
        fill={bodyDark} />
      <rect x="0.5" y="14" width={w-1} height="6" fill={bodyDark} />

      {/* Liseret bas */}
      <rect x="0.5" y={h-20} width={w-1} height="20" rx="5"
        fill={bodyDark} />
      <rect x="0.5" y={h-20} width={w-1} height="6" fill={bodyDark} />

      {/* Vis haute */}
      <rect x={w*0.18} y="3" width={w*0.64} height="12" rx="2" fill="rgba(0,0,0,0.15)" />
      <circle cx={w/2} cy="9" r="4.5" fill={`url(#screw-${breaker!.id})`} />
      <line x1={w/2-3} y1="9" x2={w/2+3} y2="9" stroke="#444" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1={w/2} y1="5.5" x2={w/2} y2="12.5" stroke="#444" strokeWidth="1.3" strokeLinecap="round"/>

      {/* Vis basse */}
      <rect x={w*0.18} y={h-15} width={w*0.64} height="12" rx="2" fill="rgba(0,0,0,0.15)" />
      <circle cx={w/2} cy={h-9} r="4.5" fill={`url(#screw-${breaker!.id})`} />
      <line x1={w/2-3} y1={h-9} x2={w/2+3} y2={h-9} stroke="#444" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1={w/2} y1={h-12.5} x2={w/2} y2={h-5.5} stroke="#444" strokeWidth="1.3" strokeLinecap="round"/>

      {isDiff ? (
        <>
          {/* ── DIFFÉRENTIEL : 2 leviers noirs ── */}
          {[w*0.27, w*0.73].map((lx, i) => (
            <g key={i}>
              {/* Embase levier */}
              <rect x={lx-7} y="22" width="14" height="52" rx="6" fill="rgba(0,0,0,0.3)" />
              {/* Corps levier */}
              <rect x={lx-6} y="21" width="12" height="50" rx="5"
                fill={`url(#lever-${breaker!.id})`} />
              {/* Encoche */}
              <rect x={lx-4} y="41" width="8" height="3.5" rx="1.5" fill="rgba(255,255,255,0.08)" />
              {/* Reflet */}
              <ellipse cx={lx-1} cy="30" rx="3.5" ry="6" fill="rgba(255,255,255,0.1)" />
              {/* Trait ON blanc */}
              <rect x={lx-1.5} y="24" width="3" height="9" rx="1.5" fill="rgba(255,255,255,0.55)" />
            </g>
          ))}
          {/* Bouton TEST Legrand (rouge, centré) */}
          <rect x={w/2-11} y="76" width="22" height="12" rx="3" fill="#1a0000" />
          <rect x={w/2-10} y="75" width="20" height="11" rx="3" fill="#b91c1c" />
          <rect x={w/2-9}  y="76" width="18" height="7"  rx="2" fill="#ef4444" />
          <rect x={w/2-8}  y="76.5" width="16" height="3" rx="1" fill="rgba(255,255,255,0.2)" />
          <text x={w/2} y="84" textAnchor="middle" fontSize="4.5" fill="white" fontWeight="bold" fontFamily="monospace">TEST</text>
          {/* Label 30mA */}
          <text x={w/2} y="96" textAnchor="middle" fontSize="6.5" fill="#555" fontFamily="monospace" fontWeight="600">30mA</text>
          {/* Type diff */}
          <text x={w/2} y="107" textAnchor="middle" fontSize="7.5" fill="#1a1a1a" fontFamily="monospace" fontWeight="800">
            {`Type ${BREAKER_TYPES[breaker!.type]?.diffType ?? ""}`}
          </text>
        </>
      ) : (
        <>
          {/* ── DISJONCTEUR : 1 levier noir ── */}
          {/* Embase */}
          <rect x={w/2-8} y="22" width="16" height="60" rx="7" fill="rgba(0,0,0,0.25)" />
          {/* Corps levier */}
          <rect x={w/2-7} y="21" width="14" height="58" rx="6"
            fill={`url(#lever-${breaker!.id})`} />
          {/* Encoche préhension */}
          <rect x={w/2-5} y="46" width="10" height="4" rx="2" fill="rgba(255,255,255,0.07)" />
          <rect x={w/2-5} y="47" width="10" height="1.5" rx="1" fill="rgba(255,255,255,0.04)" />
          {/* Reflet */}
          <ellipse cx={w/2-1} cy="31" rx="4" ry="7" fill="rgba(255,255,255,0.1)" />
          {/* Trait I blanc (indicateur ON) */}
          <rect x={w/2-1.5} y="24" width="3" height="10" rx="1.5" fill="rgba(255,255,255,0.55)" />
          {/* Plaque ampérage (fond blanc cassé comme Legrand) */}
          <rect x={w/2-12} y="82" width="24" height="14" rx="2.5" fill="white" opacity="0.9" />
          <rect x={w/2-11} y="83" width="22" height="12" rx="2" fill="#f8f8f6" />
          <text x={w/2} y="93" textAnchor="middle"
            fontSize={breaker!.amperes >= 25 ? "8" : "9"} fontWeight="900"
            fill="#1a1a1a" fontFamily="monospace" letterSpacing="0.3">
            {breaker!.amperes}A
          </text>
        </>
      )}

      {/* Bordure sélection */}
      {isSelected && (
        <rect x="0.5" y="0.5" width={w-1} height={h-1} rx="5"
          fill="none" stroke="#F59E0B" strokeWidth="2.5" />
      )}
    </svg>
  );
}

// ─── BREAKER EDIT MODAL ───────────────────────────────────────────────────────

function BreakerEditModal({
  breaker, slotIndex, compliance, allBreakers, onUpdate, onClose, onShowSchema, onRemove,
}: {
  breaker: Breaker; slotIndex: number;
  compliance: ReturnType<typeof checkNFC>;
  allBreakers: Breaker[];
  onUpdate: (b: Breaker) => void;
  onClose: () => void;
  onShowSchema: (b: Breaker) => void;
  onRemove: () => void;
}) {
  const isDiff = !!BREAKER_TYPES[breaker.type]?.isDiff;
  const hasError = compliance.errors.some(e => e.id.includes(String(breaker.id)));
  const spec = CIRCUITS[breaker.circuit];

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-ink-900/60 backdrop-blur-sm"
      onClick={onClose}>
      <div className="card w-full max-w-sm md:max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-2xl"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <div className="flex items-center gap-2">
            <span className="text-xl">{isDiff ? "🔲" : (CIRCUITS[breaker.circuit] || CIRCUITS.autre).icon}</span>
            <span className="font-semibold text-ink-900">
              {isDiff ? "Différentiel" : "Disjoncteur"} — emplacement {slotIndex + 1}
            </span>
          </div>
          <button onClick={onClose} className="btn-ghost !px-2 !py-1 text-ink-400">✕</button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {/* Libellé */}
          <div>
            <label className="label">Libellé</label>
            <input className="input" placeholder="Ex: Salon, Cuisine…"
              value={breaker.label}
              onChange={e => onUpdate({ ...breaker, label: e.target.value })}
            />
          </div>

          {/* Type */}
          <div>
            <label className="label">Type</label>
            <select className="input" value={breaker.type}
              onChange={e => onUpdate({ ...breaker, type: e.target.value })}>
              {Object.entries(BREAKER_TYPES)
                .filter(([k]) => isDiff ? BREAKER_TYPES[k].isDiff : !BREAKER_TYPES[k].isDiff)
                .map(([k, v]) => (
                  <option key={k} value={k}>{v.label} — {v.desc}</option>
                ))}
            </select>
          </div>

          {!isDiff && (
            <>
              {/* Circuit */}
              <div>
                <label className="label">Circuit</label>
                <select className="input" value={breaker.circuit}
                  onChange={e => onUpdate({ ...breaker, circuit: e.target.value })}>
                  {Object.entries(CIRCUITS).map(([k, v]) => (
                    <option key={k} value={k}>{v.icon} {v.label} (max {v.ampMax}A)</option>
                  ))}
                </select>
              </div>

              {/* Calibre */}
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

              {/* NFC hint */}
              {spec && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 font-mono leading-relaxed">
                  📋 NFC 15-100 — Max {spec.ampMax}A · Section {spec.section}mm²
                  <br />Diff requis : Type {spec.diffType || "—"} · {spec.dedié ? "Circuit dédié" : "Partageable"}
                </div>
              )}

              {/* Config lumière */}
              {breaker.circuit === "lumiere" && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-col gap-3">
                  <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">💡 Appareillage lumière</p>
                  <div>
                    <label className="label">Type de commande</label>
                    <div className="flex flex-wrap gap-2">
                      {[["simple","Interrupteur"],["vav","Va-et-vient"],["telerupteur","Télérupteur"]].map(([v,l]) => (
                        <button key={v}
                          onClick={() => onUpdate({ ...breaker, switchType: v, switchCount: v==="vav" ? 2 : (breaker.switchCount||1) })}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                            (breaker.switchType||"simple")===v
                              ? "bg-emerald-700 text-white border-emerald-800"
                              : "bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                          }`}>{l}</button>
                      ))}
                    </div>
                  </div>
                  {(breaker.switchType||"simple") !== "simple" && (
                    <div>
                      <label className="label">
                        {(breaker.switchType||"simple")==="vav" ? "Nb interrupteurs V&V" : "Nb boutons-poussoirs"}
                      </label>
                      <div className="flex gap-2">
                        {((breaker.switchType||"simple")==="vav" ? [2,3] : [1,2,3,4,5]).map(n => (
                          <button key={n} onClick={() => onUpdate({ ...breaker, switchCount: n })}
                            className={`w-9 h-9 rounded-lg text-sm font-bold border transition-all ${
                              (breaker.switchCount||1)===n
                                ? "bg-orange-500 text-white border-orange-600"
                                : "bg-white text-ink-500 border-ink-200 hover:border-ink-400"
                            }`}>{n}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="label">Points lumineux</label>
                    <div className="flex flex-wrap gap-2">
                      {[1,2,3,4,5,6].map(n => (
                        <button key={n} onClick={() => onUpdate({ ...breaker, lampCount: n })}
                          className={`w-9 h-9 rounded-lg text-sm font-bold border transition-all ${
                            (breaker.lampCount||1)===n
                              ? "bg-amber-400 text-ink-900 border-amber-500"
                              : "bg-white text-ink-500 border-ink-200 hover:border-ink-400"
                          }`}>{n}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>
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
          {[
            { items: errors,   icon: "❌", bg: "bg-red-50",   border: "border-red-200",   text: "text-red-800",   sub: "text-red-400",   title: "NON-CONFORMITÉS" },
            { items: warnings, icon: "⚠️", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", sub: "text-amber-400",  title: "AVERTISSEMENTS" },
            { items: infos,    icon: "ℹ️", bg: "bg-blue-50",  border: "border-blue-200",  text: "text-blue-800",  sub: "text-blue-400",   title: "RECOMMANDATIONS" },
          ].map(({ items, icon, bg, border, text, sub, title }) => items.length > 0 && (
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

const CABLE = {
  phase:   { stroke: "#DC2626", label: "Phase" },
  neutre:  { stroke: "#2563EB", label: "Neutre" },
  terre:   { stroke: "#16A34A", label: "Terre", dash: true },
  retour:  { stroke: "#7C3AED", label: "Retour lampe" },
  navette: { stroke: "#EA580C", label: "Navette" },
};

function CircuitSchema({ breaker, rowBreakers, onClose }: {
  breaker: Breaker; rowBreakers: (Breaker|null)[]; onClose: () => void;
}) {
  const [switchType, setSwitchType]   = useState(breaker.switchType || "simple");
  const [switchCount, setSwitchCount] = useState(breaker.switchCount || 1);
  const [lampCount, setLampCount]     = useState(breaker.lampCount || 1);

  const circuit = CIRCUITS[breaker.circuit] || CIRCUITS.autre;
  const spec    = CIRCUITS[breaker.circuit];
  const isLight = breaker.circuit === "lumiere";
  const H = isLight ? 340 : 240;
  const midY = H / 2;

  const diff = rowBreakers[0];
  const elements: React.ReactNode[] = [];

  // Input wires
  elements.push(
    <g key="in">
      <line x1={20} y1={midY}    x2={55} y2={midY}    stroke={CABLE.phase.stroke}  strokeWidth={2.5}/>
      <line x1={20} y1={midY+20} x2={55} y2={midY+20} stroke={CABLE.neutre.stroke} strokeWidth={2.5}/>
      <line x1={20} y1={midY+38} x2={55} y2={midY+38} stroke={CABLE.terre.stroke}  strokeWidth={2.5} strokeDasharray="5,3"/>
      <text x={14} y={midY-5}  textAnchor="middle" fontSize={8} fill={CABLE.phase.stroke}  fontFamily="monospace">Ph</text>
      <text x={14} y={midY+33} textAnchor="middle" fontSize={8} fill={CABLE.neutre.stroke} fontFamily="monospace">N</text>
      <text x={14} y={midY+51} textAnchor="middle" fontSize={8} fill={CABLE.terre.stroke}  fontFamily="monospace">PE</text>
    </g>
  );

  let curX = 55;

  // Diff block
  if (diff) {
    const dt = BREAKER_TYPES[diff.type]?.diffType || "AC";
    elements.push(
      <g key="diff">
        <rect x={curX} y={midY-28} width={38} height={58} rx={4} fill="#1e293b" stroke="#475569" strokeWidth={1.5}/>
        <text x={curX+19} y={midY-12} textAnchor="middle" fontSize={8}  fill="#93c5fd" fontFamily="monospace">ID</text>
        <text x={curX+19} y={midY}    textAnchor="middle" fontSize={9}  fill="#60a5fa" fontFamily="monospace" fontWeight="bold">{dt}</text>
        <text x={curX+19} y={midY+12} textAnchor="middle" fontSize={7}  fill="#64748b" fontFamily="monospace">30mA</text>
        <rect x={curX+9}  y={midY+18} width={20} height={9} rx={2} fill="#7f1d1d"/>
        <rect x={curX+10} y={midY+19} width={18} height={7} rx={2} fill="#ef4444"/>
        <text x={curX+19} y={midY+25} textAnchor="middle" fontSize={4}  fill="white"  fontFamily="monospace">TEST</text>
      </g>,
      <line key="wph-d" x1={curX}    y1={midY}    x2={curX+38} y2={midY}    stroke={CABLE.phase.stroke}  strokeWidth={2.5}/>,
      <line key="wn-d"  x1={curX}    y1={midY+20} x2={curX+38} y2={midY+20} stroke={CABLE.neutre.stroke} strokeWidth={2.5}/>,
      <line key="wpe-d" x1={curX}    y1={midY+38} x2={curX+38} y2={midY+38} stroke={CABLE.terre.stroke}  strokeWidth={2.5} strokeDasharray="5,3"/>
    );
    curX += 58;
  }

  // Breaker block
  elements.push(
    <g key="brk">
      <rect x={curX} y={midY-22} width={28} height={44} rx={4} fill="#e8e8e6" stroke="#c0c0bc" strokeWidth={1.5}/>
      <rect x={curX+7} y={midY-14} width={14} height={28} rx={4} fill="#1a1a1a"/>
      <rect x={curX+9} y={midY-12} width={10} height={10} rx={3} fill="#2d2d2d"/>
      <rect x={curX+11} y={midY-11} width={3} height={8} rx={1.5} fill="rgba(255,255,255,0.5)"/>
      <text x={curX+14} y={midY+10} textAnchor="middle" fontSize={8} fill="white" fontFamily="monospace">{breaker.amperes}A</text>
    </g>,
    <line key="bph1" x1={curX}    y1={midY}    x2={curX+2}  y2={midY}    stroke={CABLE.phase.stroke}  strokeWidth={2.5}/>,
    <line key="bph2" x1={curX+26} y1={midY}    x2={curX+56} y2={midY}    stroke={CABLE.phase.stroke}  strokeWidth={2.5}/>,
    <line key="bn"   x1={curX}    y1={midY+20} x2={curX+56} y2={midY+20} stroke={CABLE.neutre.stroke} strokeWidth={2.5}/>,
    <line key="bpe"  x1={curX}    y1={midY+38} x2={curX+56} y2={midY+38} stroke={CABLE.terre.stroke}  strokeWidth={2.5} strokeDasharray="5,3"/>
  );
  if (spec?.section) {
    elements.push(<text key="sec" x={curX+13} y={midY-26} textAnchor="middle" fontSize={8} fill="#64748b" fontFamily="monospace">{spec.section}mm²</text>);
  }
  curX += 56;

  // Load
  if (isLight) {
    const phY = midY, nY = midY+20, peY = midY+38;
    if (switchType === "simple") {
      const swX = curX + 40;
      elements.push(
        <line key="ps1" x1={curX} y1={phY} x2={swX-12} y2={phY} stroke={CABLE.phase.stroke} strokeWidth={2.5}/>,
        <g key="sw">
          <rect x={swX-12} y={phY-12} width={24} height={24} rx={4} fill="#1e293b" stroke="#64748b" strokeWidth={1}/>
          <circle cx={swX} cy={phY} r={5} fill="none" stroke="#94a3b8" strokeWidth={1.5}/>
          <line x1={swX} y1={phY-5} x2={swX+7} y2={phY-10} stroke="#94a3b8" strokeWidth={1.5}/>
          <text x={swX} y={phY+24} textAnchor="middle" fontSize={8} fill="#64748b" fontFamily="monospace">I.S.</text>
        </g>,
        <line key="ps2" x1={swX+12} y1={phY} x2={swX+50} y2={phY} stroke={CABLE.retour.stroke} strokeWidth={2.5}/>,
        <text key="rl" x={swX+31} y={phY-8} textAnchor="middle" fontSize={8} fill={CABLE.retour.stroke} fontFamily="monospace">retour</text>
      );
      for (let i = 0; i < lampCount; i++) {
        const lx = swX + 78 + i*58;
        elements.push(
          <g key={`l${i}`}>
            <circle cx={lx} cy={phY} r={12} fill="#1e293b" stroke="#fbbf24" strokeWidth={1.5}/>
            <line x1={lx-7} y1={phY-7} x2={lx+7} y2={phY+7} stroke="#fbbf24" strokeWidth={1.5}/>
            <line x1={lx+7} y1={phY-7} x2={lx-7} y2={phY+7} stroke="#fbbf24" strokeWidth={1.5}/>
          </g>,
          <line key={`ln${i}`} x1={lx} y1={phY+12} x2={lx} y2={nY} stroke={CABLE.neutre.stroke} strokeWidth={2.5}/>,
          <line key={`lc${i}`} x1={i===0?swX+62:lx-46} y1={phY} x2={lx-12} y2={phY} stroke={CABLE.retour.stroke} strokeWidth={2.5}/>
        );
      }
      const lastLx = swX + 78 + (lampCount-1)*58;
      elements.push(
        <line key="nline" x1={curX} y1={nY}  x2={lastLx+58} y2={nY}  stroke={CABLE.neutre.stroke} strokeWidth={2.5}/>,
        <line key="peline" x1={curX} y1={peY} x2={lastLx+58} y2={peY} stroke={CABLE.terre.stroke}  strokeWidth={2.5} strokeDasharray="5,3"/>
      );
    } else if (switchType === "vav") {
      const sw1X = curX+40, sw2X = curX+200;
      elements.push(
        <line key="ps1" x1={curX} y1={phY} x2={sw1X-14} y2={phY} stroke={CABLE.phase.stroke} strokeWidth={2.5}/>,
        <g key="vav1">
          <rect x={sw1X-14} y={phY-14} width={28} height={28} rx={4} fill="#1e293b" stroke="#f97316" strokeWidth={1.5}/>
          <circle cx={sw1X} cy={phY} r={5} fill="none" stroke="#f97316" strokeWidth={1.5}/>
          <line x1={sw1X} y1={phY-5} x2={sw1X+7} y2={phY-10} stroke="#f97316" strokeWidth={1.5}/>
          <line x1={sw1X} y1={phY+5} x2={sw1X+7} y2={phY+10} stroke="#f97316" strokeWidth={1.5}/>
          <text x={sw1X} y={phY+26} textAnchor="middle" fontSize={8} fill="#f97316" fontFamily="monospace">V&V 1</text>
        </g>,
        <line key="nav1" x1={sw1X+14} y1={phY-8} x2={sw2X-14} y2={phY-8} stroke={CABLE.navette.stroke} strokeWidth={2.5}/>,
        <line key="nav2" x1={sw1X+14} y1={phY+8} x2={sw2X-14} y2={phY+8} stroke={CABLE.navette.stroke} strokeWidth={2.5}/>,
        <text key="navlbl" x={(sw1X+sw2X)/2} y={phY-14} textAnchor="middle" fontSize={8} fill={CABLE.navette.stroke} fontFamily="monospace">navettes</text>,
        <g key="vav2">
          <rect x={sw2X-14} y={phY-14} width={28} height={28} rx={4} fill="#1e293b" stroke="#f97316" strokeWidth={1.5}/>
          <circle cx={sw2X} cy={phY} r={5} fill="none" stroke="#f97316" strokeWidth={1.5}/>
          <line x1={sw2X} y1={phY-5} x2={sw2X+7} y2={phY-10} stroke="#f97316" strokeWidth={1.5}/>
          <line x1={sw2X} y1={phY+5} x2={sw2X+7} y2={phY+10} stroke="#f97316" strokeWidth={1.5}/>
          <text x={sw2X} y={phY+26} textAnchor="middle" fontSize={8} fill="#f97316" fontFamily="monospace">V&V 2</text>
        </g>,
        <line key="ret" x1={sw2X+14} y1={phY} x2={sw2X+50} y2={phY} stroke={CABLE.retour.stroke} strokeWidth={2.5}/>,
        <text key="retlbl" x={sw2X+32} y={phY-8} textAnchor="middle" fontSize={8} fill={CABLE.retour.stroke} fontFamily="monospace">retour</text>
      );
      for (let i = 0; i < lampCount; i++) {
        const lx = sw2X+78+i*56;
        elements.push(
          <g key={`l${i}`}>
            <circle cx={lx} cy={phY} r={12} fill="#1e293b" stroke="#fbbf24" strokeWidth={1.5}/>
            <line x1={lx-7} y1={phY-7} x2={lx+7} y2={phY+7} stroke="#fbbf24" strokeWidth={1.5}/>
            <line x1={lx+7} y1={phY-7} x2={lx-7} y2={phY+7} stroke="#fbbf24" strokeWidth={1.5}/>
          </g>,
          <line key={`ln${i}`} x1={lx} y1={phY+12} x2={lx} y2={nY} stroke={CABLE.neutre.stroke} strokeWidth={2.5}/>,
          <line key={`lc${i}`} x1={i===0?sw2X+62:lx-44} y1={phY} x2={lx-12} y2={phY} stroke={CABLE.retour.stroke} strokeWidth={2.5}/>
        );
      }
      const lastLx = sw2X+78+(lampCount-1)*56;
      elements.push(
        <line key="nline"  x1={curX} y1={nY}  x2={lastLx+56} y2={nY}  stroke={CABLE.neutre.stroke} strokeWidth={2.5}/>,
        <line key="peline" x1={curX} y1={peY} x2={lastLx+56} y2={peY} stroke={CABLE.terre.stroke}  strokeWidth={2.5} strokeDasharray="5,3"/>
      );
    } else {
      const btnSpacing = 55, teleX = curX+30+switchCount*btnSpacing+20;
      elements.push(<line key="pbus" x1={curX} y1={phY} x2={teleX-16} y2={phY} stroke={CABLE.phase.stroke} strokeWidth={2.5}/>);
      for (let i=0; i<switchCount; i++) {
        const bx = curX+30+i*btnSpacing;
        elements.push(
          <g key={`btn${i}`}>
            <circle cx={bx} cy={phY-28} r={10} fill="#1e293b" stroke="#94a3b8" strokeWidth={1.5}/>
            <rect x={bx-4} y={phY-33} width={8} height={4} rx={1} fill="#94a3b8"/>
            <text x={bx} y={phY-44} textAnchor="middle" fontSize={7} fill="#64748b" fontFamily="monospace">BP {i+1}</text>
            <line x1={bx} y1={phY-18} x2={bx} y2={phY} stroke={CABLE.phase.stroke} strokeWidth={1.5}/>
            <line x1={bx} y1={phY-38} x2={bx} y2={phY-50} stroke={CABLE.phase.stroke} strokeWidth={1.5}/>
            <line x1={bx} y1={phY-50} x2={teleX} y2={phY-50} stroke={CABLE.navette.stroke} strokeWidth={2}/>
          </g>
        );
      }
      elements.push(
        <line key="nav-down" x1={teleX} y1={phY-50} x2={teleX} y2={phY-28} stroke={CABLE.navette.stroke} strokeWidth={2}/>,
        <g key="tele">
          <rect x={teleX-16} y={phY-16} width={32} height={32} rx={4} fill="#1e293b" stroke="#7c3aed" strokeWidth={1.5}/>
          <text x={teleX} y={phY-3} textAnchor="middle" fontSize={7} fill="#a78bfa" fontFamily="monospace">TELE</text>
          <text x={teleX} y={phY+9} textAnchor="middle" fontSize={7} fill="#7c3aed" fontFamily="monospace">RUPT.</text>
        </g>,
        <text key="navlbl" x={teleX} y={phY-54} textAnchor="middle" fontSize={8} fill={CABLE.navette.stroke} fontFamily="monospace">navettes</text>,
        <line key="ret" x1={teleX+16} y1={phY} x2={teleX+50} y2={phY} stroke={CABLE.retour.stroke} strokeWidth={2.5}/>,
        <text key="retlbl" x={teleX+33} y={phY-8} textAnchor="middle" fontSize={8} fill={CABLE.retour.stroke} fontFamily="monospace">retour</text>
      );
      for (let i=0; i<lampCount; i++) {
        const lx = teleX+68+i*56;
        elements.push(
          <g key={`l${i}`}>
            <circle cx={lx} cy={phY} r={12} fill="#1e293b" stroke="#fbbf24" strokeWidth={1.5}/>
            <line x1={lx-7} y1={phY-7} x2={lx+7} y2={phY+7} stroke="#fbbf24" strokeWidth={1.5}/>
            <line x1={lx+7} y1={phY-7} x2={lx-7} y2={phY+7} stroke="#fbbf24" strokeWidth={1.5}/>
          </g>,
          <line key={`ln${i}`} x1={lx} y1={phY+12} x2={lx} y2={nY} stroke={CABLE.neutre.stroke} strokeWidth={2.5}/>,
          <line key={`lc${i}`} x1={i===0?teleX+51:lx-44} y1={phY} x2={lx-12} y2={phY} stroke={CABLE.retour.stroke} strokeWidth={2.5}/>
        );
      }
      const lastLx = teleX+68+(lampCount-1)*56;
      elements.push(
        <line key="nline"  x1={curX} y1={nY}  x2={lastLx+56} y2={nY}  stroke={CABLE.neutre.stroke} strokeWidth={2.5}/>,
        <line key="peline" x1={curX} y1={peY} x2={lastLx+56} y2={peY} stroke={CABLE.terre.stroke}  strokeWidth={2.5} strokeDasharray="5,3"/>
      );
    }
  } else {
    const isSocket = ["prise_16","prise_20","cuisine_prises","exterieur","garage"].includes(breaker.circuit);
    const outX = curX+40;
    if (isSocket) {
      elements.push(
        <g key="sock">
          <circle cx={outX} cy={midY} r={14} fill="#1e293b" stroke="#94a3b8" strokeWidth={1.5}/>
          <circle cx={outX-5} cy={midY} r={2.5} fill="none" stroke="#94a3b8" strokeWidth={1.5}/>
          <circle cx={outX+5} cy={midY} r={2.5} fill="none" stroke="#94a3b8" strokeWidth={1.5}/>
          <line x1={outX} y1={midY+6} x2={outX} y2={midY+11} stroke="#16A34A" strokeWidth={1.5}/>
        </g>,
        <line key="sph"  x1={curX}   y1={midY}    x2={outX-14} y2={midY}    stroke={CABLE.phase.stroke}  strokeWidth={2.5}/>,
        <line key="sn"   x1={curX}   y1={midY+20} x2={outX}    y2={midY+20} stroke={CABLE.neutre.stroke} strokeWidth={2.5}/>,
        <line key="sn2"  x1={outX}   y1={midY+14} x2={outX}    y2={midY+20} stroke={CABLE.neutre.stroke} strokeWidth={2.5}/>,
        <line key="spe"  x1={curX}   y1={midY+38} x2={outX}    y2={midY+38} stroke={CABLE.terre.stroke}  strokeWidth={2.5} strokeDasharray="5,3"/>,
        <line key="spe2" x1={outX}   y1={midY+25} x2={outX}    y2={midY+38} stroke={CABLE.terre.stroke}  strokeWidth={2.5} strokeDasharray="5,3"/>
      );
    } else {
      elements.push(
        <g key="app">
          <rect x={outX-18} y={midY-18} width={36} height={36} rx={6} fill="#1e293b" stroke="#475569" strokeWidth={1.5}/>
          <text x={outX} y={midY+7} textAnchor="middle" fontSize={18}>{circuit.icon}</text>
        </g>,
        <line key="aph"  x1={curX}   y1={midY}    x2={outX-18} y2={midY}    stroke={CABLE.phase.stroke}  strokeWidth={2.5}/>,
        <line key="an"   x1={curX}   y1={midY+20} x2={outX-18} y2={midY+20} stroke={CABLE.neutre.stroke} strokeWidth={2.5}/>,
        <line key="an2"  x1={outX-18} y1={midY+20} x2={outX-18} y2={midY+18} stroke={CABLE.neutre.stroke} strokeWidth={2.5}/>,
        <line key="ape"  x1={curX}   y1={midY+38} x2={outX-18} y2={midY+38} stroke={CABLE.terre.stroke}  strokeWidth={2.5} strokeDasharray="5,3"/>,
        <line key="ape2" x1={outX-18} y1={midY+38} x2={outX-18} y2={midY+18} stroke={CABLE.terre.stroke}  strokeWidth={2.5} strokeDasharray="5,3"/>
      );
    }
  }

  const vbW = isLight && switchType==="telerupteur" ? 220+switchCount*55+lampCount*56+150
    : isLight && switchType==="vav" ? 520+lampCount*56
    : isLight ? 360+lampCount*58 : 420;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <div className="flex items-center gap-2">
            <span className="text-xl">{circuit.icon}</span>
            <div>
              <p className="font-semibold text-ink-900">Schéma — {breaker.label || circuit.label}</p>
              <p className="text-xs font-mono text-ink-400">
                {breaker.amperes}A · {spec?.section}mm² · Diff. Type {diff ? BREAKER_TYPES[diff.type]?.diffType : "—"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost !px-2 !py-1">✕</button>
        </div>

        {isLight && (
          <div className="flex flex-wrap gap-4 p-3 border-b border-ink-200 bg-ink-50">
            <div>
              <p className="label mb-1">Commande</p>
              <div className="flex gap-1.5">
                {[["simple","Simple"],["vav","Va-et-vient"],["telerupteur","Télérupteur"]].map(([v,l]) => (
                  <button key={v} onClick={() => { setSwitchType(v); if(v==="simple") setSwitchCount(1); }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                      switchType===v ? "bg-ink-900 text-volt-400 border-ink-700" : "bg-white text-ink-500 border-ink-200"
                    }`}>{l}</button>
                ))}
              </div>
            </div>
            {switchType !== "simple" && (
              <div>
                <p className="label mb-1">{switchType==="vav"?"Nb V&V":"Nb boutons"}</p>
                <div className="flex gap-1.5">
                  {(switchType==="vav"?[2,3]:[1,2,3,4,5]).map(n => (
                    <button key={n} onClick={() => setSwitchCount(n)}
                      className={`w-8 h-8 rounded-lg text-xs font-bold border transition-all ${
                        switchCount===n ? "bg-orange-500 text-white border-orange-600" : "bg-white text-ink-500 border-ink-200"
                      }`}>{n}</button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="label mb-1">Points lumineux</p>
              <div className="flex gap-1.5">
                {[1,2,3,4,5,6].map(n => (
                  <button key={n} onClick={() => setLampCount(n)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold border transition-all ${
                      lampCount===n ? "bg-volt-400 text-ink-900 border-volt-500" : "bg-white text-ink-500 border-ink-200"
                    }`}>{n}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-x-auto p-4 bg-slate-900 rounded-b-2xl">
          <svg viewBox={`0 0 ${vbW} ${H}`} width="100%"
            style={{ minWidth: Math.min(vbW, 380), display: "block" }}>
            <rect width={vbW} height={H} fill="#0f172a" rx="8"/>
            {elements}
          </svg>
        </div>

        <div className="flex flex-wrap gap-4 px-4 py-3 border-t border-ink-200 bg-ink-50">
          {Object.entries(CABLE).filter(([k]) =>
            k!=="navette"&&k!=="retour" ? true :
            k==="navette" ? isLight&&(switchType==="vav"||switchType==="telerupteur") : isLight
          ).map(([k,v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <svg width={24} height={6}>
                <line x1={0} y1={3} x2={24} y2={3} stroke={v.stroke} strokeWidth={2}
                  strokeDasharray={(v as any).dash ? "4,3" : "none"}/>
              </svg>
              <span className="text-xs font-mono text-ink-500">{v.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── DIN RAIL ROW ─────────────────────────────────────────────────────────────

function DinRailRow({
  row, globalOffset, selectedSlot, compliance,
  onClickSlot, onDeleteRow, onUpdateName,
}: {
  row: BreakerRow;
  globalOffset: number;
  selectedSlot: { rowId: number; slotIdx: number } | null;
  compliance: ReturnType<typeof checkNFC>;
  onClickSlot: (rowId: number, slotIdx: number) => void;
  onDeleteRow: (rowId: number) => void;
  onUpdateName: (rowId: number, name: string) => void;
}) {
  const totalW = DIFF_W + 8 * SLOT_W + 9 * 4 + 40; // diff + 8 slots + gaps + padding
  const panelW = Math.max(totalW, 400);

  const getIssue = (b: Breaker | null) => {
    if (!b) return null;
    if (compliance.errors.some(e => e.id.includes(String(b.id)))) return "error";
    if (compliance.warnings.some(w => w.id.includes(String(b.id)))) return "warning";
    return null;
  };

  return (
    <div className="mb-10">
      {/* Row header */}
      <div className="flex items-center gap-3 mb-2">
        <input
          value={row.name}
          onChange={e => onUpdateName(row.id, e.target.value)}
          className="text-xs font-semibold text-ink-600 bg-transparent border-none outline-none font-mono"
        />
        <button onClick={() => onDeleteRow(row.id)}
          className="text-ink-300 hover:text-red-400 transition-colors ml-auto">
          <Trash2 size={14} />
        </button>
      </div>

      {/* Panel enclosure */}
      <div style={{
        background: "linear-gradient(160deg,#d1d5db 0%,#9ca3af 60%,#6b7280 100%)",
        borderRadius: 8,
        padding: "16px 16px 50px",
        width: panelW,
        display: "inline-flex",
        alignItems: "flex-start",
        gap: 4,
        boxShadow: "inset 0 2px 6px rgba(0,0,0,0.2), 0 4px 12px rgba(0,0,0,0.15)",
        border: "2px solid #9ca3af",
        position: "relative" as const,
      }}>
        {/* DIN rail bar */}
        <div style={{
          position: "absolute", left: 12, right: 12,
          top: 16 + BREAKER_H * 0.40, height: 7,
          background: "linear-gradient(180deg,#b0b8c0,#6b7280,#9ca3af)",
          borderRadius: 1,
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }} />
        <div style={{
          position: "absolute", left: 12, right: 12,
          top: 16 + BREAKER_H * 0.40 + 9, height: 3,
          background: "linear-gradient(180deg,#4b5563,#374151)",
        }} />

        {/* Corner screws */}
        {[[6,6],[panelW-22,6],[6,16+BREAKER_H+4],[panelW-22,16+BREAKER_H+4]].map(([x,y],i) => (
          <div key={i} style={{
            position: "absolute", left: x, top: y,
            width: 12, height: 12, borderRadius: "50%",
            background: "radial-gradient(circle at 35% 35%,#e5e7eb,#6b7280)",
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.4)",
            zIndex: 2,
          }} />
        ))}

        {/* Slot 0: Differential */}
        <SlotCell
          breaker={row.slots[0]}
          slotIdx={0}
          isDiffSlot
          issue={getIssue(row.slots[0])}
          isSelected={selectedSlot?.rowId === row.id && selectedSlot?.slotIdx === 0}
          globalNum={globalOffset + 1}
          onClick={() => onClickSlot(row.id, 0)}
        />

        {/* Slots 1-8: Breakers */}
        {Array.from({ length: 8 }, (_, i) => i + 1).map(slotIdx => (
          <SlotCell
            key={slotIdx}
            breaker={row.slots[slotIdx]}
            slotIdx={slotIdx}
            issue={getIssue(row.slots[slotIdx])}
            isSelected={selectedSlot?.rowId === row.id && selectedSlot?.slotIdx === slotIdx}
            globalNum={globalOffset + slotIdx + 1}
            onClick={() => onClickSlot(row.id, slotIdx)}
          />
        ))}
      </div>
    </div>
  );
}

function SlotCell({
  breaker, slotIdx, isDiffSlot, issue, isSelected, globalNum, onClick,
}: {
  breaker: Breaker | null; slotIdx: number; isDiffSlot?: boolean;
  issue: "error" | "warning" | null; isSelected: boolean;
  globalNum: number; onClick: () => void;
}) {
  const w = isDiffSlot ? DIFF_W : SLOT_W;
  const label = breaker ? (breaker.label || (CIRCUITS[breaker.circuit]?.label ?? "")) : "";

  return (
    <div
      onClick={onClick}
      style={{
        position: "relative", zIndex: 1, cursor: "pointer", flexShrink: 0,
        transform: isSelected ? "translateY(-3px)" : "none",
        transition: "transform 0.1s",
        filter: issue === "error" ? "drop-shadow(0 0 6px rgba(239,68,68,0.6))"
              : issue === "warning" ? "drop-shadow(0 0 5px rgba(245,158,11,0.5))"
              : isSelected ? "drop-shadow(0 4px 10px rgba(245,158,11,0.4))" : "none",
      }}
    >
      <BreakerSVG
        breaker={breaker}
        isEmpty={!breaker}
        isSelected={isSelected}
        isDiffSlot={isDiffSlot}
      />

      {/* Issue badge */}
      {issue && (
        <div style={{
          position: "absolute", top: 4, right: 4,
          width: 14, height: 14, borderRadius: "50%",
          background: issue === "error" ? "#ef4444" : "#f59e0b",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, color: "white", fontWeight: "bold",
        }}>!</div>
      )}

      {/* Sticker label */}
      <div style={{
        position: "absolute", bottom: -34, left: 0, right: 0, height: 32,
        background: "#fffde7",
        border: `1px solid ${issue==="error" ? "#ef4444" : issue==="warning" ? "#f59e0b" : "#d4c97a"}`,
        borderRadius: 2,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "1px 3px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
      }}>
        {breaker && (
          <div style={{
            fontSize: Math.max(6, 9 - Math.max(0, label.length - 8)),
            fontWeight: 700, color: "#1c1917",
            textAlign: "center", lineHeight: 1.2,
            fontFamily: "monospace",
            overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
            width: "100%", paddingLeft: 2, paddingRight: 2,
          }}>
            {(CIRCUITS[breaker.circuit]?.icon ?? "")} {label}
          </div>
        )}
        <div style={{ fontSize: 6, color: "#a8a29e", fontFamily: "monospace" }}>
          {breaker ? `N°${globalNum}` : `—`}
        </div>
      </div>

      {/* Config button on select */}
      {isSelected && (
        <div style={{
          position: "absolute", bottom: -58, left: "50%",
          transform: "translateX(-50%)",
          whiteSpace: "nowrap", zIndex: 10,
          background: "#1c1917", color: "#fbbf24",
          border: "1px solid #fbbf24",
          borderRadius: 6, fontSize: 10, fontWeight: 700,
          padding: "3px 8px",
          display: "flex", alignItems: "center", gap: 4,
        }}>
          <Settings2 size={10} />
          {breaker ? "Configurer" : "Ajouter"}
        </div>
      )}
    </div>
  );
}

// ─── PRINT LABELS ─────────────────────────────────────────────────────────────

function printLabels(rows: BreakerRow[], clientName: string) {
  let gn = 0, html = "";
  rows.forEach(row => {
    row.slots.forEach(b => {
      if (!b) return;
      gn++;
      const c = CIRCUITS[b.circuit] || CIRCUITS.autre;
      const label = b.label || c.label;
      html += `
        <div style="
          display:inline-flex;flex-direction:column;align-items:center;justify-content:center;
          width:28mm;height:22mm;border:1.5px solid #333;border-radius:2mm;
          overflow:hidden;background:#fff;vertical-align:top;margin:2mm;
          font-family:'Courier New',monospace;
        ">
          <div style="font-size:18pt;line-height:1;margin-bottom:2mm;">${c.icon}</div>
          <div style="font-size:8pt;font-weight:700;color:#111;text-align:center;padding:0 2mm;line-height:1.2;">${label}</div>
        </div>
      `;
    });
  });
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<html><head><title>Étiquettes — ${clientName}</title>
    <style>@page{margin:8mm}body{margin:0;background:#fff;}</style>
  </head><body>
    <div style="padding:4mm 6mm 2mm;font-family:monospace;font-size:8pt;color:#555;border-bottom:1px solid #ddd;margin-bottom:3mm;">
      ${clientName} — ${gn} étiquette${gn>1?"s":""}
    </div>
    ${html}
  </body></html>`);
  w.document.close();
  setTimeout(() => { w.print(); w.close(); }, 400);
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function TableauPage() {
  const params   = useParams();
  const router   = useRouter();
  const clientId = params.clientId as string;

  const [client, setClient]   = useState<Client | null>(null);
  const [rows, setRows]       = useState<BreakerRow[]>([]);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [loading, setLoading] = useState(true);

  // Selection: which slot is active
  const [selectedSlot, setSelectedSlot] = useState<{ rowId: number; slotIdx: number } | null>(null);
  const [editBreaker, setEditBreaker]   = useState<{ breaker: Breaker; rowId: number; slotIdx: number } | null>(null);
  const [schemaBreaker, setSchemaBreaker] = useState<{ breaker: Breaker; rowBreakers: (Breaker|null)[] } | null>(null);
  const [showReport, setShowReport] = useState(false);

  // Load
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
              // New format: has slots[]
              if (Array.isArray(row.slots)) {
                // Ensure exactly 9 slots, each either valid Breaker or null
                const slots: (Breaker | null)[] = Array(9).fill(null);
                row.slots.forEach((b: any, i: number) => {
                  if (i < 9 && b != null && typeof b === "object" && typeof b.type === "string") {
                    slots[i] = b as Breaker;
                  }
                });
                return { id: row.id ?? uid(), name: row.name ?? `Rangée`, slots };
              }
              // Old format: has breakers[]
              const slots: (Breaker | null)[] = Array(9).fill(null);
              (row.breakers ?? []).forEach((b: any, i: number) => {
                if (i < 9 && b != null && typeof b === "object" && typeof b.type === "string") {
                  slots[i] = b as Breaker;
                }
              });
              return { id: row.id ?? uid(), name: row.name ?? `Rangée`, slots };
            }).filter(Boolean) as BreakerRow[];
            setRows(normalized);
          } catch {}
        }
      }
      setLoading(false);
    });
  }, [clientId]);

  const compliance = checkNFC(rows);

  const handleSave = useCallback(async () => {
    setSaving(true);
    await supabase.from("clients")
      .update({ tableau_config: JSON.stringify(rows) })
      .eq("id", clientId);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [rows, clientId]);

  // Row management
  const addRow = () => {
    setRows(r => [...r, emptyRow(r.length + 1)]);
  };
  const deleteRow = (rowId: number) => {
    setRows(r => r.filter(x => x.id !== rowId));
    if (selectedSlot?.rowId === rowId) setSelectedSlot(null);
  };
  const updateRowName = (rowId: number, name: string) => {
    setRows(r => r.map(x => x.id === rowId ? { ...x, name } : x));
  };

  // Slot click: if empty → open edit with default breaker, if filled → open edit
  const handleClickSlot = (rowId: number, slotIdx: number) => {
    const row = rows.find(r => r.id === rowId);
    if (!row) return;

    // Toggle selection
    if (selectedSlot?.rowId === rowId && selectedSlot?.slotIdx === slotIdx) {
      // Open edit modal
      const existing = row.slots[slotIdx];
      const isDiffSlot = slotIdx === 0;
      const defaultBreaker: Breaker = existing ?? {
        id: uid(),
        label: "",
        circuit: isDiffSlot ? "general" : "prise_16",
        amperes: isDiffSlot ? 25 : 16,
        type: isDiffSlot ? "diff-AC" : "1P",
      };
      setEditBreaker({ breaker: defaultBreaker, rowId, slotIdx });
      return;
    }
    setSelectedSlot({ rowId, slotIdx });
  };

  // Update breaker in slot
  const updateSlot = (rowId: number, slotIdx: number, breaker: Breaker) => {
    setRows(r => r.map(row => {
      if (row.id !== rowId) return row;
      const newSlots = [...row.slots];
      newSlots[slotIdx] = breaker;
      return { ...row, slots: newSlots };
    }));
  };

  // Remove breaker from slot
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

  // Global offset for numbering (count filled slots)
  const getOffset = (ri: number) =>
    rows.slice(0, ri).reduce((s, r) => s + safeBreakers(r.slots).length, 0);

  const scoreColor = compliance.score >= 85 ? "text-emerald-600 bg-emerald-50 border-emerald-200"
    : compliance.score >= 60 ? "text-amber-600 bg-amber-50 border-amber-200"
    : "text-red-600 bg-red-50 border-red-200";
  const ScoreIcon = compliance.score >= 85 ? ShieldCheck : compliance.score >= 60 ? ShieldAlert : ShieldX;

  if (loading) {
    return <Shell><div className="flex items-center justify-center h-64 text-ink-400">Chargement…</div></Shell>;
  }

  return (
    <Shell>
      <div className="flex flex-col h-[calc(100vh-4rem)] md:h-screen overflow-hidden">

        {/* Top bar */}
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

        {/* Hint */}
        <div className="px-6 py-2 bg-ink-50 border-b border-ink-100 text-xs text-ink-400 hidden md:block">
          1er clic = sélectionner · 2e clic = configurer · Chaque rangée : 1 différentiel + 8 disjoncteurs
        </div>

        {/* Main scrollable area */}
        <div className="flex-1 overflow-auto p-4 md:p-8">

          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-ink-100 flex items-center justify-center">
                <Zap size={28} className="text-ink-300" />
              </div>
              <p className="text-ink-500 font-medium">Tableau vide</p>
              <p className="text-ink-400 text-sm text-center max-w-xs">
                Ajoutez une rangée pour commencer à composer le tableau électrique.
              </p>
              <button onClick={addRow} className="btn-volt">
                <Plus size={15} /> Ajouter une rangée
              </button>
            </div>
          ) : (
            <>
              {/* Enclosure */}
              <div style={{
                background: "linear-gradient(170deg,#374151 0%,#1f2937 100%)",
                borderRadius: 14, padding: "24px 24px 12px",
                boxShadow: "0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)",
                border: "2px solid #4b5563",
                display: "inline-block", minWidth: 400,
              }}>
                {/* Panel label */}
                <div style={{
                  background: "#111827", borderRadius: 7,
                  padding: "6px 16px", marginBottom: 20,
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <span style={{ fontSize: 11, color: "#F59E0B", fontFamily: "monospace", fontWeight: 700, letterSpacing: 2 }}>
                    TABLEAU ÉLECTRIQUE
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[
                      compliance.errors.length > 0   ? "#ef4444" : "#374151",
                      compliance.warnings.length > 0  ? "#f59e0b" : "#374151",
                      compliance.score >= 85           ? "#10b981" : "#374151",
                    ].map((c, i) => (
                      <div key={i} style={{
                        width: 8, height: 8, borderRadius: "50%", background: c,
                        boxShadow: c !== "#374151" ? `0 0 6px ${c}` : "none",
                      }} />
                    ))}
                  </div>
                </div>

                {rows.map((row, ri) => (
                  <DinRailRow
                    key={row.id}
                    row={row}
                    globalOffset={getOffset(ri)}
                    selectedSlot={selectedSlot}
                    compliance={compliance}
                    onClickSlot={handleClickSlot}
                    onDeleteRow={deleteRow}
                    onUpdateName={updateRowName}
                  />
                ))}
              </div>

              {/* Add row button */}
              <div className="mt-6">
                <button onClick={addRow} className="btn-ghost border-dashed border-ink-300 text-ink-400 hover:text-volt-600 hover:border-volt-300">
                  <Plus size={15} /> Ajouter une rangée
                </button>
              </div>
            </>
          )}

          {/* Mobile actions */}
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

      {/* Modals */}
      {editBreaker && (
        <BreakerEditModal
          breaker={editBreaker.breaker}
          slotIndex={editBreaker.slotIdx}
          compliance={compliance}
          allBreakers={rows.flatMap(r => (r.slots ?? []).filter((b): b is Breaker => b != null && !!b.type))}
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

      {showReport && (
        <CompliancePanel result={compliance} onClose={() => setShowReport(false)} />
      )}

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
