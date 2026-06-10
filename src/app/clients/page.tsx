"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Client } from "@/types";
import { initiales, STATUT_LABELS, STATUT_COLORS, cn } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { UserPlus, Search, Phone, MapPin, ChevronRight } from "lucide-react";

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("clients").select("*").order("nom")
      .then(({ data }) => { setClients(data ?? []); setLoading(false); });
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
            {filtered.map(c => (
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
                </div>
                {c.statut && c.statut !== "actif" && (
                  <span className={cn("badge", STATUT_COLORS[c.statut])}>{STATUT_LABELS[c.statut]}</span>
                )}
                <ChevronRight size={16} className="text-ink-300 group-hover:text-volt-500 transition-colors shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
