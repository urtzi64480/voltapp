"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Facture } from "@/types";
import { fmt, fmtDate, STATUT_LABELS, STATUT_COLORS, cn } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import ConfirmDialog from "@/components/ConfirmDialog";
import Link from "next/link";
import { Search, Receipt, ChevronRight, ChevronDown, ChevronUp, AlertCircle, User, Trash2 } from "lucide-react";

export default function FacturesPage() {
  const [factures, setFactures] = useState<Facture[]>([]);
  const [search, setSearch] = useState("");
  const [filtre, setFiltre] = useState("tous");
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [toDelete, setToDelete] = useState<Facture | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    supabase.from("factures").select("*, client:clients(nom,prenom)").order("created_at", { ascending: false })
      .then(({ data }) => { setFactures(data ?? []); setLoading(false); });
  }, []);

  const filtered = factures.filter(f => {
    const s = `${f.numero} ${f.objet ?? ""} ${(f.client as any)?.nom ?? ""}`.toLowerCase();
    return s.includes(search.toLowerCase()) && (filtre === "tous" || f.statut === filtre);
  });

  const totalImpaye = factures.filter(f => ["impayee", "relance"].includes(f.statut)).reduce((a, f) => a + f.total_ttc, 0);

  // Grouper par client alphabétiquement
  const byClient: Record<string, { label: string; items: Facture[] }> = {};
  filtered.forEach(f => {
    const client = f.client as any;
    const key = f.client_id ?? "__sans_client__";
    const label = client ? `${client.prenom ?? ""} ${client.nom}`.trim() : "Sans client";
    if (!byClient[key]) byClient[key] = { label, items: [] };
    byClient[key].items.push(f);
  });
  const groups = Object.entries(byClient).sort((a, b) => a[1].label.localeCompare(b[1].label, "fr"));

  async function handleDelete() {
    if (!toDelete) return;
    setDeleting(true);
    // Supprime d'abord les lignes liées (contrainte FK), puis la facture
    await supabase.from("facture_lignes").delete().eq("facture_id", toDelete.id);
    const { error } = await supabase.from("factures").delete().eq("id", toDelete.id);
    setDeleting(false);
    if (error) {
      alert("Erreur lors de la suppression de la facture.");
      return;
    }
    setFactures(prev => prev.filter(f => f.id !== toDelete.id));
    setToDelete(null);
  }

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-3xl text-ink-900">Factures</h1>
            <p className="text-ink-500 text-sm mt-1">{factures.length} facture{factures.length > 1 ? "s" : ""}</p>
          </div>
          {totalImpaye > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2 text-sm">
              <AlertCircle size={15} />
              <span>{fmt(totalImpaye)} impayé{totalImpaye > 0 ? "s" : ""}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="input pl-10" placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {["tous", "envoyee", "payee", "relance", "impayee"].map(f => (
              <button key={f} onClick={() => setFiltre(f)}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                  filtre === f ? "bg-ink-900 text-volt-400 border-ink-900" : "bg-white border-ink-200 text-ink-500 hover:bg-ink-50")}>
                {f === "tous" ? "Toutes" : STATUT_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        {loading ? <div className="text-center py-16 text-ink-400">Chargement…</div>
          : groups.length === 0 ? (
            <div className="card card-inner text-center py-16">
              <Receipt size={36} className="mx-auto mb-3 text-ink-200" />
              <p className="text-ink-400">Aucune facture</p>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map(([key, { label, items }]) => {
                const impaye = items.filter(f => ["impayee", "relance"].includes(f.statut)).reduce((a, f) => a + f.total_ttc, 0);
                return (
                  <div key={key} className="card overflow-hidden">
                    <button
                      onClick={() => setCollapsed(c => ({ ...c, [key]: !c[key] }))}
                      className="w-full flex items-center justify-between px-5 py-3 bg-ink-900 hover:bg-ink-800 transition-colors text-left">
                      <div className="flex items-center gap-3">
                        <User size={14} className="text-ink-400 shrink-0" />
                        <span className="font-semibold text-white text-sm">{label}</span>
                        <span className="text-ink-400 text-xs">{items.length} facture{items.length > 1 ? "s" : ""}</span>
                        {impaye > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-red-500/20 text-red-300 text-xs font-medium">
                            {fmt(impaye)} impayé
                          </span>
                        )}
                      </div>
                      {collapsed[key] ? <ChevronDown size={16} className="text-ink-400" /> : <ChevronUp size={16} className="text-ink-400" />}
                    </button>

                    {!collapsed[key] && (
                      <div className="divide-y divide-ink-100">
                        {items.map(f => (
                          <Link key={f.id} href={`/factures/${f.id}`}
                            className="flex items-center gap-4 px-5 py-3 hover:bg-ink-50 transition-colors group">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="font-bold text-ink-900 text-sm">{f.numero}</span>
                                <span className={cn("badge", STATUT_COLORS[f.statut])}>{STATUT_LABELS[f.statut]}</span>
                              </div>
                              {f.objet && <p className="text-xs text-ink-500 truncate">{f.objet}</p>}
                              <p className="text-xs text-ink-400">{fmtDate(f.date_emission)}{f.date_echeance ? ` · Éch. ${fmtDate(f.date_echeance)}` : ""}</p>
                            </div>
                            <p className={cn("text-base font-bold shrink-0", ["impayee", "relance"].includes(f.statut) ? "text-red-600" : "text-emerald-600")}>
                              {fmt(f.total_ttc)}
                            </p>
                            <button
                              onClick={e => { e.preventDefault(); e.stopPropagation(); setToDelete(f); }}
                              className="text-ink-300 hover:text-red-600 transition-colors shrink-0 p-1"
                              title="Supprimer"
                            >
                              <Trash2 size={15} />
                            </button>
                            <ChevronRight size={15} className="text-ink-300 group-hover:text-volt-500 transition-colors shrink-0" />
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title="Supprimer cette facture ?"
        message={toDelete ? `La facture ${toDelete.numero} et ses lignes seront supprimées définitivement. Cette action est irréversible.` : ""}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
        loading={deleting}
      />
    </Shell>
  );
}
