"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Client } from "@/types";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { LayoutTemplate, Plus, Search, ChevronRight, X } from "lucide-react";

interface Niveau { id: number; nom: string; type: string; pieces: { id: number }[]; }

function ClientPickerModal({ clients, onPick, onClose }: {
  clients: Client[]; onPick: (clientId: string) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = clients.filter(c =>
    `${c.nom} ${c.prenom ?? ""} ${c.ville ?? ""}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-ink-900/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-md max-h-[80vh] flex flex-col rounded-t-2xl md:rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <div>
            <p className="font-semibold text-ink-900">Nouveau plan</p>
            <p className="text-xs text-ink-400 mt-0.5">Choisir le client concerné</p>
          </div>
          <button onClick={onClose} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-3 border-b border-ink-200">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input autoFocus className="input pl-9 !py-2 text-sm" placeholder="Rechercher un client…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {clients.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-ink-400 text-sm mb-3">Aucun client enregistré</p>
              <Link href="/clients/nouveau" className="btn-volt inline-flex text-xs"><Plus size={13} /> Créer un client</Link>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-ink-400 text-sm py-8">Aucun client trouvé</p>
          ) : (
            filtered.map(c => {
              const hasPlan = !!(c as any).maison_config && (c as any).maison_config !== "";
              return (
                <button key={c.id} onClick={() => onPick(c.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-volt-50 transition-colors text-left">
                  <div className="w-9 h-9 rounded-full bg-ink-900 flex items-center justify-center text-volt-400 font-semibold text-sm shrink-0">
                    {(c.prenom ? c.prenom[0] : "") + (c.nom?.[0] ?? "")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink-900 truncate">{c.prenom ? `${c.prenom} ${c.nom}` : c.nom}</p>
                    <p className="text-xs text-ink-400">{c.ville ?? ""}{hasPlan ? " · Plan existant" : " · Aucun plan"}</p>
                  </div>
                  {hasPlan
                    ? <span className="text-[10px] font-semibold text-volt-600 bg-volt-100 px-2 py-0.5 rounded-full shrink-0">📐 Modifier</span>
                    : <ChevronRight size={14} className="text-ink-300 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

interface PlanEntry { clientId: string; client: Client; niveaux: Niveau[]; nbPieces: number; }

export default function PlansPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [plans, setPlans] = useState<PlanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    supabase.from("clients").select("*").order("nom").then(({ data }) => {
      const all = data ?? [];
      setClients(all);
      const entries: PlanEntry[] = [];
      all.forEach(c => {
        const raw = (c as any).maison_config as string | null | undefined;
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          const niveaux: Niveau[] = Array.isArray(parsed?.niveaux) ? parsed.niveaux : [];
          const nbPieces = niveaux.reduce((s, n) => s + (n.pieces?.length ?? 0), 0);
          if (niveaux.length === 0) return;
          entries.push({ clientId: c.id, client: c, niveaux, nbPieces });
        } catch {}
      });
      setPlans(entries);
      setLoading(false);
    });
  }, []);

  const handleCreate = (clientId: string) => {
    setShowPicker(false);
    router.push(`/plan/${clientId}`);
  };

  const filtered = plans.filter(p =>
    `${p.client.nom} ${p.client.prenom ?? ""} ${p.client.ville ?? ""}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-3xl text-ink-900">Plans de circuits</h1>
            <p className="text-ink-500 text-sm mt-1">
              {plans.length} plan{plans.length > 1 ? "s" : ""} dessiné{plans.length > 1 ? "s" : ""}
            </p>
          </div>
          <button onClick={() => setShowPicker(true)} className="btn-volt"><Plus size={16} /> Nouveau</button>
        </div>

        {plans.length > 3 && (
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="input pl-10" placeholder="Rechercher par client…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-ink-400">Chargement…</div>
        ) : filtered.length === 0 && plans.length === 0 ? (
          <div className="card card-inner text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-ink-100 flex items-center justify-center mx-auto mb-4">
              <LayoutTemplate size={28} className="text-ink-300" />
            </div>
            <p className="text-ink-500 mb-2 font-medium">Aucun plan dessiné</p>
            <p className="text-ink-400 text-sm mb-5">Créez le plan de circuits d'un client pour commencer.</p>
            <button onClick={() => setShowPicker(true)} className="btn-volt inline-flex"><Plus size={15} /> Créer un plan</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card card-inner text-center py-8">
            <p className="text-ink-400 text-sm">Aucun résultat pour "{search}"</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(entry => {
              const { client, niveaux, nbPieces } = entry;
              return (
                <div key={entry.clientId} className="card card-inner hover:border-volt-300 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-ink-900 flex items-center justify-center text-volt-400 font-semibold text-sm shrink-0">
                      {(client.prenom ? client.prenom[0] : "") + (client.nom?.[0] ?? "")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ink-900">{client.prenom ? `${client.prenom} ${client.nom}` : client.nom}</p>
                      <p className="text-xs text-ink-400">
                        {niveaux.length} niveau{niveaux.length > 1 ? "x" : ""} · {nbPieces} pièce{nbPieces > 1 ? "s" : ""}
                        {client.ville ? ` · ${client.ville}` : ""}
                      </p>
                      <div className="flex gap-2 mt-3">
                        <Link href={`/plan/${entry.clientId}`} className="btn-volt !py-1.5 !text-xs">
                          <LayoutTemplate size={12} /> Ouvrir
                        </Link>
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
        <ClientPickerModal clients={clients} onPick={handleCreate} onClose={() => setShowPicker(false)} />
      )}
    </Shell>
  );
}
