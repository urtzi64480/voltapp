"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { Zap, ShieldCheck, ShieldAlert, ShieldX, ChevronRight, Plus } from "lucide-react";

interface BreakerRow {
  id: number;
  name: string;
  capacity: number;
  breakers: { id: number; label: string; circuit: string; amperes: number; type: string }[];
}

const BREAKER_TYPES: Record<string, { isDiff?: boolean; diffType?: string }> = {
  "1P": {}, "2P": {},
  "diff-AC": { isDiff: true, diffType: "AC" },
  "diff-A":  { isDiff: true, diffType: "A" },
  "diff-F":  { isDiff: true, diffType: "F" },
};

const CIRCUITS: Record<string, { label: string; icon: string; ampMax: number; diffType: string | null; section: string | null }> = {
  lumiere:         { label: "Lumière",         icon: "💡", ampMax: 10,  diffType: "AC", section: "1.5" },
  prise_16:        { label: "Prises 16A",      icon: "🔌", ampMax: 16,  diffType: "AC", section: "1.5" },
  prise_20:        { label: "Prises 20A",      icon: "🔌", ampMax: 20,  diffType: "AC", section: "2.5" },
  cuisine_prises:  { label: "Prises cuisine",  icon: "🍳", ampMax: 20,  diffType: "AC", section: "2.5" },
  plaque:          { label: "Plaque cuisson",  icon: "🔥", ampMax: 32,  diffType: "A",  section: "6.0" },
  four:            { label: "Four",            icon: "🥘", ampMax: 20,  diffType: "AC", section: "2.5" },
  lave_linge:      { label: "Lave-linge",      icon: "🧺", ampMax: 20,  diffType: "A",  section: "2.5" },
  lave_vaisselle:  { label: "Lave-vaisselle",  icon: "🍽️", ampMax: 20,  diffType: "AC", section: "2.5" },
  seche_linge:     { label: "Sèche-linge",     icon: "👕", ampMax: 20,  diffType: "A",  section: "2.5" },
  chauffe_eau:     { label: "Chauffe-eau",     icon: "🚿", ampMax: 20,  diffType: "AC", section: "2.5" },
  chauffage:       { label: "Chauffage élec.", icon: "🌡️", ampMax: 20,  diffType: "AC", section: "2.5" },
  clim:            { label: "Climatisation",   icon: "❄️", ampMax: 20,  diffType: "F",  section: "2.5" },
  seche_serviette: { label: "Sèche-serviette", icon: "🛁", ampMax: 16,  diffType: "AC", section: "1.5" },
  congelateur:     { label: "Congélateur",     icon: "🧊", ampMax: 20,  diffType: "AC", section: "2.5" },
  irve:            { label: "IRVE",            icon: "🔋", ampMax: 32,  diffType: "A",  section: "6.0" },
  piscine:         { label: "Piscine/PAC",     icon: "🏊", ampMax: 20,  diffType: "F",  section: "2.5" },
  vmc:             { label: "VMC",             icon: "💨", ampMax: 10,  diffType: "AC", section: "1.5" },
  alarme:          { label: "Alarme",          icon: "🔔", ampMax: 6,   diffType: "AC", section: "1.5" },
  exterieur:       { label: "Extérieur",       icon: "🌿", ampMax: 16,  diffType: "AC", section: "1.5" },
  garage:          { label: "Garage",          icon: "🏠", ampMax: 16,  diffType: "AC", section: "1.5" },
  general:         { label: "Général",         icon: "⚡", ampMax: 63,  diffType: null, section: "10.0" },
  parafoudre:      { label: "Parafoudre",      icon: "⛈️", ampMax: 0,   diffType: null, section: null },
  autre:           { label: "Autre",           icon: "⚙️", ampMax: 32,  diffType: "AC", section: "2.5" },
};

const DIFF_HIERARCHY: Record<string, number> = { AC: 0, A: 1, F: 2 };

function quickCheckNFC(rows: BreakerRow[]) {
  let errors = 0;
  const allBreakers = rows.flatMap(r => r.breakers);
  const diffs = allBreakers.filter(b => BREAKER_TYPES[b.type]?.isDiff);
  if (diffs.length < 2) errors++;
  allBreakers.forEach(b => {
    if (BREAKER_TYPES[b.type]?.isDiff || b.circuit === "general" || b.circuit === "parafoudre") return;
    const spec = CIRCUITS[b.circuit];
    if (!spec) return;
    if (spec.ampMax && b.amperes > spec.ampMax) errors++;
    let cov: (typeof allBreakers)[0] | null = null;
    for (const row of rows) {
      let last: (typeof allBreakers)[0] | null = null;
      for (const rb of row.breakers) {
        if (BREAKER_TYPES[rb.type]?.isDiff) last = rb;
        if (rb.id === b.id) { cov = last; break; }
      }
    }
    if (!cov) errors++;
    else if (spec.diffType && BREAKER_TYPES[cov.type]?.diffType) {
      const covLevel = DIFF_HIERARCHY[BREAKER_TYPES[cov.type]?.diffType!] ?? -1;
      const reqLevel = DIFF_HIERARCHY[spec.diffType] ?? -1;
      if (covLevel < reqLevel) errors++;
    }
  });
  const totalBreakers = allBreakers.filter(b => !BREAKER_TYPES[b.type]?.isDiff).length;
  const score = Math.max(0, Math.round(100 - errors * 15));
  return { errors, totalBreakers, rows: rows.length, score };
}

export default function TableauClientWidget({ clientId }: { clientId: string }) {
  const [rows, setRows]     = useState<BreakerRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("clients")
      .select("tableau_config")
      .eq("id", clientId)
      .single()
      .then(({ data }) => {
        if (data?.tableau_config) {
          try { setRows(JSON.parse(data.tableau_config)); } catch {}
        } else {
          setRows([]);
        }
        setLoading(false);
      });
  }, [clientId]);

  if (loading) {
    return (
      <div className="card card-inner">
        <div className="flex items-center gap-2 text-ink-400 text-sm">
          <Zap size={16} /> Chargement du tableau…
        </div>
      </div>
    );
  }

  // No tableau yet
  if (!rows || rows.length === 0) {
    return (
      <div className="card card-inner flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-ink-100 flex items-center justify-center">
            <Zap size={18} className="text-ink-400" />
          </div>
          <div>
            <p className="font-semibold text-ink-700 text-sm">Tableau électrique</p>
            <p className="text-xs text-ink-400">Aucun tableau configuré</p>
          </div>
        </div>
        <Link href={`/tableau/${clientId}`} className="btn-volt !py-1.5 !text-xs">
          <Plus size={13} /> Créer
        </Link>
      </div>
    );
  }

  const { errors, totalBreakers, score } = quickCheckNFC(rows);
  const ScoreIcon = score >= 85 ? ShieldCheck : score >= 60 ? ShieldAlert : ShieldX;
  const scoreClass  = score >= 85 ? "text-emerald-600 bg-emerald-50 border-emerald-200"
                    : score >= 60 ? "text-amber-600 bg-amber-50 border-amber-200"
                    : "text-red-600 bg-red-50 border-red-200";
  const iconClass   = score >= 85 ? "text-emerald-500" : score >= 60 ? "text-amber-500" : "text-red-500";

  // Preview: first 8 non-diff breakers as icons
  const previewBreakers = rows
    .flatMap(r => r.breakers)
    .filter(b => !BREAKER_TYPES[b.type]?.isDiff)
    .slice(0, 10);

  return (
    <Link href={`/tableau/${clientId}`}
      className="card card-inner block hover:border-volt-400 transition-colors group">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-ink-900 flex items-center justify-center">
            <Zap size={15} className="text-volt-400" />
          </div>
          <div>
            <p className="font-semibold text-ink-900 text-sm">Tableau électrique</p>
            <p className="text-xs text-ink-400">{rows.length} rangée{rows.length>1?"s":""} · {totalBreakers} circuit{totalBreakers>1?"s":""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-semibold ${scoreClass}`}>
            <ScoreIcon size={12} />
            {score}/100
          </div>
          <ChevronRight size={16} className="text-ink-300 group-hover:text-volt-500 transition-colors" />
        </div>
      </div>

      {/* Circuit icons preview */}
      <div className="flex flex-wrap gap-1.5">
        {previewBreakers.map(b => {
          const c = CIRCUITS[b.circuit] || CIRCUITS.autre;
          return (
            <div key={b.id}
              title={`${b.label || c.label} — ${b.amperes}A`}
              className="flex items-center gap-1 px-2 py-1 bg-ink-50 rounded-lg border border-ink-200 text-xs text-ink-600">
              <span>{c.icon}</span>
              <span className="font-mono text-ink-400 text-[10px]">{b.amperes}A</span>
            </div>
          );
        })}
        {totalBreakers > 10 && (
          <div className="flex items-center px-2 py-1 bg-ink-50 rounded-lg border border-ink-200 text-xs text-ink-400">
            +{totalBreakers - 10}
          </div>
        )}
      </div>

      {errors > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
          <ShieldX size={12} />
          {errors} non-conformité{errors>1?"s":""} NFC 15-100 détectée{errors>1?"s":""}
        </div>
      )}
    </Link>
  );
}
