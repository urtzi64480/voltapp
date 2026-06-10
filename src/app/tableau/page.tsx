"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Client } from "@/types";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { Zap, Plus, ShieldCheck, ShieldAlert, ShieldX, Search, ChevronRight, X } from "lucide-react";

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

const DIFF_HIERARCHY: Record<string, number> = { AC: 0, A: 1, F: 2 };

function quickScore(rows: BreakerRow[]) {
  let errors = 0;
  const all = rows.flatMap(r => (r.breakers ?? []).filter((b): b is typeof b => b != null && typeof (b as any)?.type === "string"));
  const diffs = all.filter(b => BREAKER_TYPES[b?.type ?? ""]?.isDiff);
  if (diffs.length < 2) errors++;
  all.forEach(b => {
    if (BREAKER_TYPES[b?.type ?? ""]?.isDiff || b.circuit === "general" || b.circuit === "parafoudre") return;
    const spec = CIRCUITS[b.circuit];
    if (!spec) return;
    if (spec.ampMax && b.amperes > spec.ampMax) errors++;
    let cov: typeof all[0] | null = null;
    for (const row of rows) {
      let last: typeof all[0] | null = null;
      for (const rb of row.breakers) {
        if (BREAKER_TYPES[rb?.type ?? ""]?.isDiff) last = rb;
        if (rb.id === b.id) { cov = last; break; }
      }
    }
    if (!cov) errors++;
    else if (spec.diffType && BREAKER_TYPES[cov?.type ?? ""]?.diffType) {
      if ((DIFF_HIERARCHY[BREAKER_TYPES[cov?.type ?? ""].diffType!] ?? -1) < (DIFF_HIERARCHY[spec.diffType] ?? -1)) errors++;
    }
  });
  return Math.max(0, Math.round(100 - errors * 15));
}

// ─── CLIENT PICKER MODAL ─────────────────────────────────────────────────────

function ClientPickerModal({
  clients, onPick, onClose,
}: {
  clients: Client[];
  onPick: (clientId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = clients.filter(c =>
    `${c.nom} ${c.prenom ?? ""} ${c.ville ?? ""}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-ink-900/60 backdrop-blur-sm"
      onClick={onClose}>
      <div className="card w-full max-w-md max-h-[80vh] flex flex-col rounded-t-2xl md:rounded-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <div>
            <p className="font-semibold text-ink-900">Nouveau tableau</p>
            <p className="text-xs text-ink-400 mt-0.5">Choisir le client concerné</p>
          </div>
          <button onClick={onClose} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-3 border-b border-ink-200">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              autoFocus
              className="input pl-9 !py-2 text-sm"
              placeholder="Rechercher un client…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {clients.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-ink-400 text-sm mb-3">Aucun client enregistré</p>
              <Link href="/clients/nouveau" className="btn-volt inline-flex text-xs">
                <Plus size={13} /> Créer un client
              </Link>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-ink-400 text-sm py-8">Aucun client trouvé</p>
          ) : (
            filtered.map(c => {
              const hasTableau = !!c.tableau_config && c.tableau_config !== "[]";
              return (
                <button key={c.id}
                  onClick={() => onPick(c.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-volt-50 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-ink-900 flex items-center justify-center text-volt-400 font-semibold text-sm shrink-0">
                    {(c.prenom ? c.prenom[0] : "") + (c.nom?.[0] ?? "")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink-900 truncate">
                      {c.prenom ? `${c.prenom} ${c.nom}` : c.nom}
                    </p>
                    <p className="text-xs text-ink-400">
                      {c.ville ?? ""}
                      {hasTableau ? " · Tableau existant" : " · Aucun tableau"}
                    </p>
                  </div>
                  {hasTableau
                    ? <span className="text-[10px] font-semibold text-volt-600 bg-volt-100 px-2 py-0.5 rounded-full shrink-0">⚡ Modifier</span>
                    : <ChevronRight size={14} className="text-ink-300 shrink-0" />
                  }
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─── REASSIGN MODAL ───────────────────────────────────────────────────────────

function ReassignModal({
  clients, currentClientId, onPick, onClose,
}: {
  clients: Client[];
  currentClientId: string | null;
  onPick: (clientId: string | null) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = clients.filter(c =>
    `${c.nom} ${c.prenom ?? ""} ${c.ville ?? ""}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-ink-900/60 backdrop-blur-sm"
      onClick={onClose}>
      <div className="card w-full max-w-md max-h-[80vh] flex flex-col rounded-t-2xl md:rounded-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">Réattribuer le tableau</p>
          <button onClick={onClose} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-3 border-b border-ink-200">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input autoFocus className="input pl-9 !py-2 text-sm" placeholder="Rechercher…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <button onClick={() => onPick(null)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-50 transition-colors text-left mb-1">
            <div className="w-9 h-9 rounded-full bg-ink-100 flex items-center justify-center text-ink-400 shrink-0">
              <X size={16} />
            </div>
            <p className="text-sm font-semibold text-red-500">Retirer l'attribution</p>
          </button>
          <div className="h-px bg-ink-100 my-1" />
          {filtered.map(c => (
            <button key={c.id} onClick={() => onPick(c.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-volt-50 transition-colors text-left ${c.id === currentClientId ? "bg-volt-50 border border-volt-200" : ""}`}>
              <div className="w-9 h-9 rounded-full bg-ink-900 flex items-center justify-center text-volt-400 font-semibold text-sm shrink-0">
                {(c.prenom ? c.prenom[0] : "") + (c.nom?.[0] ?? "")}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink-900 truncate">{c.prenom ? `${c.prenom} ${c.nom}` : c.nom}</p>
                {c.ville && <p className="text-xs text-ink-400">{c.ville}</p>}
              </div>
              {c.id === currentClientId && <span className="text-xs text-volt-600 font-semibold">Actuel</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

interface TableauEntry {
  clientId: string;
  client: Client;
  rows: BreakerRow[];
  score: number;
}

export default function TableauxPage() {
  const router = useRouter();
  const [clients, setClients]       = useState<Client[]>([]);
  const [tableaux, setTableaux]     = useState<TableauEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [reassign, setReassign]     = useState<TableauEntry | null>(null);

  useEffect(() => {
    supabase.from("clients").select("*").order("nom").then(({ data }) => {
      const all = data ?? [];
      setClients(all);
      const entries: TableauEntry[] = [];
      all.forEach(c => {
        if (!c.tableau_config) return;
        try {
          const rows: BreakerRow[] = JSON.parse(c.tableau_config);
          if (rows.length === 0) return;
          entries.push({ clientId: c.id, client: c, rows, score: quickScore(rows) });
        } catch {}
      });
      setTableaux(entries);
      setLoading(false);
    });
  }, []);

  const handleCreate = (clientId: string) => {
    setShowPicker(false);
    router.push(`/tableau/${clientId}`);
  };

  const handleReassign = async (entry: TableauEntry, newClientId: string | null) => {
    setReassign(null);
    if (!newClientId) {
      // Remove tableau from old client
      await supabase.from("clients").update({ tableau_config: null }).eq("id", entry.clientId);
      setTableaux(t => t.filter(x => x.clientId !== entry.clientId));
      return;
    }
    if (newClientId === entry.clientId) return;
    // Move config to new client, clear old
    await Promise.all([
      supabase.from("clients").update({ tableau_config: JSON.stringify(entry.rows) }).eq("id", newClientId),
      supabase.from("clients").update({ tableau_config: null }).eq("id", entry.clientId),
    ]);
    const newClient = clients.find(c => c.id === newClientId);
    if (!newClient) return;
    setTableaux(t => t.map(x =>
      x.clientId === entry.clientId
        ? { ...x, clientId: newClientId, client: newClient }
        : x
    ));
  };

  const filtered = tableaux.filter(t =>
    `${t.client.nom} ${t.client.prenom ?? ""} ${t.client.ville ?? ""}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-3xl text-ink-900">Tableaux électriques</h1>
            <p className="text-ink-500 text-sm mt-1">
              {tableaux.length} tableau{tableaux.length > 1 ? "x" : ""} configuré{tableaux.length > 1 ? "s" : ""}
            </p>
          </div>
          <button onClick={() => setShowPicker(true)} className="btn-volt">
            <Plus size={16} /> Nouveau
          </button>
        </div>

        {/* Search */}
        {tableaux.length > 3 && (
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="input pl-10" placeholder="Rechercher par client…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-ink-400">Chargement…</div>
        ) : filtered.length === 0 && tableaux.length === 0 ? (
          <div className="card card-inner text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-ink-100 flex items-center justify-center mx-auto mb-4">
              <Zap size={28} className="text-ink-300" />
            </div>
            <p className="text-ink-500 mb-2 font-medium">Aucun tableau configuré</p>
            <p className="text-ink-400 text-sm mb-5">Créez le tableau électrique d'un client pour commencer.</p>
            <button onClick={() => setShowPicker(true)} className="btn-volt inline-flex">
              <Plus size={15} /> Créer un tableau
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card card-inner text-center py-8">
            <p className="text-ink-400 text-sm">Aucun résultat pour "{search}"</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(entry => {
              const { client, rows, score } = entry;
              const ScoreIcon = score >= 85 ? ShieldCheck : score >= 60 ? ShieldAlert : ShieldX;
              const scoreClass = score >= 85
                ? "text-emerald-600 bg-emerald-50 border-emerald-200"
                : score >= 60 ? "text-amber-600 bg-amber-50 border-amber-200"
                : "text-red-600 bg-red-50 border-red-200";
              const totalBreakers = rows.flatMap(r => r.breakers ?? []).filter(b => b != null && typeof b?.type === "string" && !BREAKER_TYPES[b?.type ?? ""]?.isDiff).length;
              const preview = rows.flatMap(r => r.breakers ?? []).filter(b => b != null && typeof b?.type === "string" && !BREAKER_TYPES[b?.type ?? ""]?.isDiff).slice(0, 8);

              return (
                <div key={entry.clientId} className="card card-inner hover:border-volt-300 transition-colors">
                  <div className="flex items-start gap-3">
                    {/* Client avatar */}
                    <div className="w-10 h-10 rounded-full bg-ink-900 flex items-center justify-center text-volt-400 font-semibold text-sm shrink-0">
                      {(client.prenom ? client.prenom[0] : "") + (client.nom?.[0] ?? "")}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <p className="font-semibold text-ink-900">
                            {client.prenom ? `${client.prenom} ${client.nom}` : client.nom}
                          </p>
                          <p className="text-xs text-ink-400">
                            {rows.length} rangée{rows.length > 1 ? "s" : ""} · {totalBreakers} circuit{totalBreakers > 1 ? "s" : ""}
                            {client.ville ? ` · ${client.ville}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-semibold ${scoreClass}`}>
                            <ScoreIcon size={11} /> {score}/100
                          </div>
                        </div>
                      </div>

                      {/* Circuit preview */}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {preview.map(b => {
                          const c = CIRCUITS[b.circuit] || CIRCUITS.autre;
                          return (
                            <span key={b.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-ink-50 border border-ink-200 rounded-md text-xs text-ink-500">
                              {c.icon} <span className="font-mono text-ink-400 text-[10px]">{b.amperes}A</span>
                            </span>
                          );
                        })}
                        {totalBreakers > 8 && (
                          <span className="px-1.5 py-0.5 bg-ink-50 border border-ink-200 rounded-md text-xs text-ink-400">+{totalBreakers - 8}</span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 mt-3">
                        <Link href={`/tableau/${entry.clientId}`} className="btn-volt !py-1.5 !text-xs">
                          <Zap size={12} /> Ouvrir
                        </Link>
                        <button
                          onClick={() => setReassign(entry)}
                          className="btn-ghost !py-1.5 !text-xs"
                        >
                          Réattribuer
                        </button>
                        <Link href={`/clients/${entry.clientId}`} className="btn-ghost !py-1.5 !text-xs ml-auto">
                          Fiche client <ChevronRight size={12} />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showPicker && (
        <ClientPickerModal
          clients={clients}
          onPick={handleCreate}
          onClose={() => setShowPicker(false)}
        />
      )}

      {reassign && (
        <ReassignModal
          clients={clients}
          currentClientId={reassign.clientId}
          onPick={newId => handleReassign(reassign, newId)}
          onClose={() => setReassign(null)}
        />
      )}
    </Shell>
  );
}
