"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { Zap, ShieldCheck, ShieldAlert, ShieldX, Plus } from "lucide-react";

interface Breaker {
  id: number;
  label: string;
  circuit: string;
  amperes: number;
  type: string;
}

interface BreakerRow {
  id: number;
  name: string;
  slots?: (Breaker | null)[];
  breakers?: Breaker[];
}

const BREAKER_TYPES: Record<string, { isDiff?: boolean; diffType?: string }> = {
  "1P": {}, "2P": {},
  "diff-AC": { isDiff: true, diffType: "AC" },
  "diff-A":  { isDiff: true, diffType: "A" },
  "diff-F":  { isDiff: true, diffType: "F" },
};

const CIRCUITS: Record<string, { label: string; icon: string; ampMax: number; diffType: string | null }> = {
  lumiere:         { label: "Lumière",         icon: "💡", ampMax: 10,  diffType: "AC" },
  prise_16:        { label: "Prises 16A",      icon: "🔌", ampMax: 16,  diffType: "AC" },
  prise_20:        { label: "Prises 20A",      icon: "🔌", ampMax: 20,  diffType: "AC" },
  cuisine_prises:  { label: "Prises cuisine",  icon: "🍳", ampMax: 20,  diffType: "AC" },
  plaque:          { label: "Plaque cuisson",  icon: "🔥", ampMax: 32,  diffType: "A"  },
  four:            { label: "Four",            icon: "🥘", ampMax: 20,  diffType: "AC" },
  lave_linge:      { label: "Lave-linge",      icon: "🧺", ampMax: 20,  diffType: "A"  },
  lave_vaisselle:  { label: "Lave-vaisselle",  icon: "🍽️", ampMax: 20,  diffType: "AC" },
  seche_linge:     { label: "Sèche-linge",     icon: "👕", ampMax: 20,  diffType: "A"  },
  chauffe_eau:     { label: "Chauffe-eau",     icon: "🚿", ampMax: 20,  diffType: "AC" },
  chauffage:       { label: "Chauffage élec.", icon: "🌡️", ampMax: 20,  diffType: "AC" },
  clim:            { label: "Climatisation",   icon: "❄️", ampMax: 20,  diffType: "F"  },
  seche_serviette: { label: "Sèche-serviette", icon: "🛁", ampMax: 16,  diffType: "AC" },
  congelateur:     { label: "Congélateur",     icon: "🧊", ampMax: 20,  diffType: "AC" },
  irve:            { label: "IRVE",            icon: "🔋", ampMax: 32,  diffType: "A"  },
  piscine:         { label: "Piscine/PAC",     icon: "🏊", ampMax: 20,  diffType: "F"  },
  vmc:             { label: "VMC",             icon: "💨", ampMax: 10,  diffType: "AC" },
  alarme:          { label: "Alarme",          icon: "🔔", ampMax: 6,   diffType: "AC" },
  exterieur:       { label: "Extérieur",       icon: "🌿", ampMax: 16,  diffType: "AC" },
  garage:          { label: "Garage",          icon: "🏠", ampMax: 16,  diffType: "AC" },
  general:         { label: "Général",         icon: "⚡", ampMax: 63,  diffType: null },
  parafoudre:      { label: "Parafoudre",      icon: "⛈️", ampMax: 0,   diffType: null },
  autre:           { label: "Autre",           icon: "⚙️", ampMax: 32,  diffType: "AC" },
};

function safeBreakers(row: BreakerRow): Breaker[] {
  const items = row.slots ?? row.breakers ?? [];
  return items.filter((b): b is Breaker =>
    b != null && typeof b === "object" && typeof (b as any).type === "string" && (b as any).type.length > 0
  );
}

function quickScore(rows: BreakerRow[]): number {
  if (!Array.isArray(rows) || rows.length === 0) return 100;
  let errors = 0;
  const all = rows.flatMap(r => safeBreakers(r));
  const diffs = all.filter(b => !!BREAKER_TYPES[b.type]?.isDiff);
  if (diffs.length < 2) errors++;
  all.forEach(b => {
    if (BREAKER_TYPES[b.type]?.isDiff || b.circuit === "general" || b.circuit === "parafoudre") return;
    const spec = CIRCUITS[b.circuit];
    if (!spec) return;
    if (spec.ampMax && b.amperes > spec.ampMax) errors++;
  });
  return Math.max(0, Math.round(100 - errors * 15));
}

export default function TableauClientWidget({ clientId }: { clientId: string }) {
  const [rows, setRows]       = useState<BreakerRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("clients")
      .select("tableau_config")
      .eq("id", clientId)
      .single()
      .then(({ data }) => {
        if (data?.tableau_config) {
          try {
            const parsed = JSON.parse(data.tableau_config);
            setRows(Array.isArray(parsed) ? parsed : []);
          } catch { setRows([]); }
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

  const score = quickScore(rows);
  const ScoreIcon = score >= 85 ? ShieldCheck : score >= 60 ? ShieldAlert : ShieldX;
  const scoreClass = score >= 85
    ? "text-emerald-600 bg-emerald-50 border-emerald-200"
    : score >= 60 ? "text-amber-600 bg-amber-50 border-amber-200"
    : "text-red-600 bg-red-50 border-red-200";

  const allBreakers = rows.flatMap(r => safeBreakers(r)).filter(b => !BREAKER_TYPES[b.type]?.isDiff);
  const preview = allBreakers.slice(0, 10);

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
            <p className="text-xs text-ink-400">
              {rows.length} rangée{rows.length > 1 ? "s" : ""} · {allBreakers.length} circuit{allBreakers.length > 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-semibold ${scoreClass}`}>
          <ScoreIcon size={12} /> {score}/100
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {preview.map(b => {
          const c = CIRCUITS[b.circuit] || CIRCUITS.autre;
          return (
            <div key={b.id}
              className="flex items-center gap-1 px-2 py-1 bg-ink-50 rounded-lg border border-ink-200 text-xs text-ink-600">
              <span>{c.icon}</span>
              <span className="font-mono text-ink-400 text-[10px]">{b.amperes}A</span>
            </div>
          );
        })}
        {allBreakers.length > 10 && (
          <div className="flex items-center px-2 py-1 bg-ink-50 rounded-lg border border-ink-200 text-xs text-ink-400">
            +{allBreakers.length - 10}
          </div>
        )}
      </div>
    </Link>
  );
}
