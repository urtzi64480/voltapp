"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Client } from "@/types";
import { initiales, STATUT_LABELS, STATUT_COLORS, cn, fmtDate } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { UserPlus, Search, Phone, MapPin, ChevronRight, CalendarDays } from "lucide-react";

const STATUT_IV: Record<string, { label: string; color: string }> = {
  planifie: { label: "Planifiée", color: "text-blue-600" },
  en_cours: { label: "En cours",  color: "text-amber-600" },
  termine:  { label: "Terminée",  color: "text-green-600" },
  annule:   { label: "Annulée",   color: "text-red-500" },
};

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [lastIvMap, setLastIvMap] = useState<Record<string, { titre: string; date_debut: string; statut: string }>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("clients").select("*").order("nom").then(async ({ data }) => {
      const cls = data ?? [];
      setClients(cls);

      // Dernière intervention par client
      if (cls.length > 0) {
        const ids = cls.map(c => c.id);
        const { data: ivs } = await supabase
          .from("interventions")
          .select("client_id, titre, date_debut, statut")
          .in("client_id", ids)
          .order("date_debut", { ascending: false });

        const map: Record<string, { titre: string; date_debut: string; statut: string }> = {};
        (ivs ?? []).forEach((iv: any) => {
          if (!map[iv.client_id]) map[iv.client_id] = iv;
        });
        setLastIvMap(map);
      }
      setLoading(false);
    });
  }, []);

  const filtered = clients.filter(c =>
    `${c.nom} ${c.prenom ?? ""} ${c.telephone ?? ""} ${c.ville ?? ""}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-3xl text-ink-900">Clients</h1>
            <p className="text-ink-500 text-sm mt-1">{clients.length} client{clients.length > 1 ? "s" : ""} enregistré{clients.length > 1 ? "s" : ""}</p>
          </div>
          <Link href="/clients/nouveau" className="btn-volt"><UserPlus size={16} /> Nouveau</Link>
        </div>
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-10" placeholder="Rechercher un client…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {loading ? (
          <div className="text-center py-16 text-ink-400">Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="card card-inner text-center py-16">
            <p className="text-ink-400 mb-4">Aucun client trouvé</p>
            <Link href="/clients/nouveau" className="btn-volt inline-flex"><UserPlus size={15} /> Créer le premier client</Link>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(c => {
              const lastIv = lastIvMap[c.id];
              const ivCfg = lastIv ? STATUT_IV[lastIv.statut] : null;
              return (
                <Link key={c.id} href={`/clients/${c.id}`}
                  className="card card-inner flex items-center gap-4 hover:border-volt-400 transition-colors group">
                  <div className="w-11 h-11 rounded-full bg-ink-900 flex items-center justify-center text-volt-400 font-semibold text-sm shrink-0">
                    {initiales(c.nom, c.prenom)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-ink-900">{c.prenom ? `${c.prenom} ${c.nom}` : c.nom}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
                      {c.telephone && <span className="text-xs text-ink-500 flex items-center gap-1"><Phone size={11} />{c.telephone}</span>}
                      {c.ville && <span className="text-xs text-ink-500 flex items-center gap-1"><MapPin size={11} />{c.ville}</span>}
                    </div>
                    {lastIv && ivCfg && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <CalendarDays size={11} className="text-ink-400" />
                        <span className="text-xs text-ink-400 truncate">{lastIv.titre}</span>
                        <span className="text-xs text-ink-300">·</span>
                        <span className="text-xs text-ink-400">{fmtDate(lastIv.date_debut)}</span>
                        <span className={cn("text-xs font-medium", ivCfg.color)}>· {ivCfg.label}</span>
                      </div>
                    )}
                  </div>
                  {c.statut && c.statut !== "actif" && (
                    <span className={cn("badge", STATUT_COLORS[c.statut])}>{STATUT_LABELS[c.statut]}</span>
                  )}
                  <ChevronRight size={16} className="text-ink-300 group-hover:text-volt-500 transition-colors shrink-0" />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}
