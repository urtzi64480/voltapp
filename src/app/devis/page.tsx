"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Devis } from "@/types";
import { fmt, fmtDate, STATUT_LABELS, STATUT_COLORS, cn } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import ConfirmDialog from "@/components/ConfirmDialog";
import Link from "next/link";
import { Plus, Search, FileText, ChevronRight, ChevronDown, ChevronUp, Receipt, CalendarDays, CalendarX, Trash2 } from "lucide-react";

const FILTRES = ["tous", "brouillon", "envoye", "signe", "refuse", "non_planifie"] as const;
const STATUTS_VISIBLES = ["envoye", "signe", "brouillon", "refuse"];

function moisKey(dateStr: string | null | undefined) {
  if (!dateStr) return "__sans_date__";
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Certains devis anciens n'ont pas de date_emission renseignée (bug de création corrigé) :
// on retombe sur created_at pour ne pas les perdre dans "Sans date".
function dateGroupe(d: Devis) {
  return d.date_emission ?? (d as any).created_at ?? null;
}

function moisLabel(key: string) {
  if (key === "__sans_date__") return "Sans date";
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const label = d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function DevisPage() {
  const [devis, setDevis] = useState<Devis[]>([]);
  const [facturesMap, setFacturesMap] = useState<Record<string, string>>({});
  const [interventionsMap, setInterventionsMap] = useState<Record<string, boolean>>({}); // devis_id → planifié ?
  const [search, setSearch] = useState("");
  const [filtre, setFiltre] = useState("tous");
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [toDelete, setToDelete] = useState<Devis | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    supabase.from("devis").select("*, client:clients(nom,prenom)")
      .in("statut", STATUTS_VISIBLES)
      .order("date_emission", { ascending: false })
      .then(async ({ data }) => {
        const dvs = data ?? [];
        setDevis(dvs);

        const allIds = dvs.map(d => d.id);
        const signesIds = dvs.filter(d => d.statut === "signe").map(d => d.id);

        await Promise.all([
          // Factures liées
          (async () => {
            if (signesIds.length === 0) return;
            const { data: facs } = await supabase.from("factures").select("id, devis_id").in("devis_id", signesIds);
            const map: Record<string, string> = {};
            (facs ?? []).forEach((f: any) => { if (f.devis_id) map[f.devis_id] = f.id; });
            setFacturesMap(map);
          })(),
          // Interventions liées (pour badge planifié)
          (async () => {
            if (allIds.length === 0) return;
            const { data: ivs } = await supabase.from("interventions").select("devis_id").in("devis_id", allIds);
            const map: Record<string, boolean> = {};
            (ivs ?? []).forEach((iv: any) => { if (iv.devis_id) map[iv.devis_id] = true; });
            setInterventionsMap(map);
          })(),
        ]);

        setLoading(false);
      });
  }, []);

  const filtered = devis.filter(d => {
    const client = d.client as any;
    const clientNom = client ? `${client.prenom ?? ""} ${client.nom ?? ""}` : "";
    const s = `${d.numero} ${d.objet ?? ""} ${clientNom}`.toLowerCase();
    const matchSearch = s.includes(search.toLowerCase());
    if (filtre === "non_planifie") return matchSearch && !interventionsMap[d.id];
    return matchSearch && (filtre === "tous" || d.statut === filtre);
  });

  const byMonth: Record<string, Devis[]> = {};
  filtered.forEach(d => {
    const key = moisKey(dateGroupe(d));
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(d);
  });
  // Tri des mois décroissant (plus récent en premier), "sans date" à la fin
  const groups = Object.entries(byMonth).sort((a, b) => {
    if (a[0] === "__sans_date__") return 1;
    if (b[0] === "__sans_date__") return -1;
    return b[0].localeCompare(a[0]);
  });

  async function handleDelete() {
    if (!toDelete) return;
    setDeleting(true);
    // Supprime d'abord les lignes liées (contrainte FK), puis le devis
    await supabase.from("devis_lignes").delete().eq("devis_id", toDelete.id);
    const { error } = await supabase.from("devis").delete().eq("id", toDelete.id);
    setDeleting(false);
    if (error) {
      alert("Erreur lors de la suppression du devis.");
      return;
    }
    setDevis(prev => prev.filter(d => d.id !== toDelete.id));
    setToDelete(null);
  }

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-3xl text-ink-900">Devis</h1>
            <p className="text-ink-500 text-sm mt-1">{devis.length} devis</p>
          </div>
          <Link href="/devis/nouveau" className="btn-volt"><Plus size={16} /> Nouveau</Link>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="input pl-10" placeholder="Rechercher (client, n°, objet)…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {FILTRES.map(f => (
              <button key={f} onClick={() => setFiltre(f)}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                  filtre === f ? "bg-ink-900 text-volt-400 border-ink-900" : "bg-white border-ink-200 text-ink-500 hover:bg-ink-50")}>
                {f === "tous" ? "Tous" : f === "non_planifie" ? "Non planifié" : STATUT_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        {loading ? <div className="text-center py-16 text-ink-400">Chargement…</div>
          : groups.length === 0 ? (
            <div className="card card-inner text-center py-16">
              <FileText size={36} className="mx-auto mb-3 text-ink-200" />
              <p className="text-ink-400">Aucun devis</p>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map(([key, items]) => (
                <div key={key} className="card overflow-hidden">
                  <button
                    onClick={() => setCollapsed(c => ({ ...c, [key]: !c[key] }))}
                    className="w-full flex items-center justify-between px-5 py-3 bg-ink-900 hover:bg-ink-800 transition-colors text-left">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-white text-sm">{moisLabel(key)}</span>
                      <span className="text-ink-400 text-xs">{items.length} devis</span>
                    </div>
                    {collapsed[key] ? <ChevronDown size={16} className="text-ink-400" /> : <ChevronUp size={16} className="text-ink-400" />}
                  </button>

                  {!collapsed[key] && (
                    <div className="divide-y divide-ink-100">
                      {items.map(d => {
                        const factureId = facturesMap[d.id];
                        const planifie = interventionsMap[d.id] ?? false;
                        const client = d.client as any;
                        const clientLabel = client ? `${client.prenom ?? ""} ${client.nom ?? ""}`.trim() : "Sans client";
                        return (
                          <Link key={d.id} href={`/devis/${d.id}`}
                            className="flex items-center gap-4 px-5 py-3 hover:bg-ink-50 transition-colors group">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                <span className="font-bold text-ink-900 text-sm">{d.numero}</span>
                                <span className={cn("badge", STATUT_COLORS[d.statut])}>{STATUT_LABELS[d.statut]}</span>
                                {factureId && (
                                  <span
                                    onClick={e => { e.preventDefault(); e.stopPropagation(); window.location.href = `/factures/${factureId}`; }}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors cursor-pointer">
                                    <Receipt size={11} /> Facturé
                                  </span>
                                )}
                                {planifie ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                                    <CalendarDays size={11} /> Planifié
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-ink-100 text-ink-400">
                                    <CalendarX size={11} /> Non planifié
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-ink-500 truncate">{clientLabel}{d.objet ? ` — ${d.objet}` : ""}</p>
                              <p className="text-xs text-ink-400">{fmtDate(dateGroupe(d))}</p>
                            </div>
                            <p className="text-base font-bold text-volt-600 shrink-0">{fmt(d.total_ttc)}</p>
                            <button
                              onClick={e => { e.preventDefault(); e.stopPropagation(); setToDelete(d); }}
                              className="text-ink-300 hover:text-red-600 transition-colors shrink-0 p-1"
                              title="Supprimer"
                            >
                              <Trash2 size={15} />
                            </button>
                            <ChevronRight size={15} className="text-ink-300 group-hover:text-volt-500 transition-colors shrink-0" />
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title="Supprimer ce devis ?"
        message={toDelete ? `Le devis ${toDelete.numero} et ses lignes seront supprimés définitivement. Cette action est irréversible.` : ""}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
        loading={deleting}
      />
    </Shell>
  );
}
