"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Client, Projet } from "@/types";
import { qsProjet, supprimerProjet, viderDonneesHistoriques } from "@/lib/projets";
import ConfirmDialog from "@/components/ConfirmDialog";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { LayoutTemplate, Plus, Search, ChevronRight, X, Trash2 } from "lucide-react";

interface Niveau { id: number; nom: string; type: string; pieces: { id: number }[]; }

function ClientPickerModal({ clients, planClientIds, onPick, onClose }: {
  clients: Client[]; planClientIds: Set<string>; onPick: (clientId: string) => void; onClose: () => void;
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
              const hasPlan = planClientIds.has(c.id);
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

interface PlanEntry {
  key: string; clientId: string; projetId: string | null; projetNom: string | null;
  client: Client; niveaux: Niveau[]; nbPieces: number;
}

function lirePlan(raw: string | null | undefined): { niveaux: Niveau[]; nbPieces: number } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const niveaux: Niveau[] = Array.isArray(parsed?.niveaux) ? parsed.niveaux : [];
    if (niveaux.length === 0) return null;
    return { niveaux, nbPieces: niveaux.reduce((s, n) => s + (n.pieces?.length ?? 0), 0) };
  } catch { return null; }
}

export default function PlansPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [plans, setPlans] = useState<PlanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [aSupprimer, setASupprimer] = useState<PlanEntry | null>(null);
  const [suppEnCours, setSuppEnCours] = useState(false);

  const charger = () => {
    Promise.all([
      supabase.from("clients").select("*").order("nom"),
      supabase.from("projets").select("*").order("created_at", { ascending: true }),
    ]).then(([{ data }, { data: projetsData }]) => {
      const all = data ?? [];
      setClients(all);
      const parClient: Record<string, Projet[]> = {};
      ((projetsData ?? []) as Projet[]).forEach(p => { (parClient[p.client_id] ??= []).push(p); });
      const entries: PlanEntry[] = [];
      all.forEach(c => {
        const ps = parClient[c.id] ?? [];
        if (ps.length === 0) {
          // Client pas encore repris dans un projet : plan historique (migré à l'ouverture).
          const plan = lirePlan((c as any).maison_config);
          if (plan) entries.push({ key: c.id, clientId: c.id, projetId: null, projetNom: null, client: c, ...plan });
          return;
        }
        ps.forEach(p => {
          const plan = lirePlan(p.maison_config);
          if (plan) entries.push({ key: p.id, clientId: c.id, projetId: p.id, projetNom: ps.length > 1 ? p.nom : null, client: c, ...plan });
        });
      });
      setPlans(entries);
      setLoading(false);
    });
  };

  useEffect(() => { charger(); }, []);

  // Supprime un plan (projet du client). Le tableau, les annexes et le brouillon de pré-devis
  // du projet partent avec ; les devis déjà créés ne sont pas touchés.
  const confirmerSuppression = async () => {
    if (!aSupprimer) return;
    setSuppEnCours(true);
    try {
      const ok = aSupprimer.projetId
        ? await supprimerProjet(aSupprimer.clientId, aSupprimer.projetId)
        : await viderDonneesHistoriques(aSupprimer.clientId);
      if (!ok) { alert("La suppression a échoué."); return; }
      setASupprimer(null);
      charger();
    } finally { setSuppEnCours(false); }
  };

  const handleCreate = (clientId: string) => {
    setShowPicker(false);
    router.push(`/plan/${clientId}`);
  };

  // Recherche insensible à la casse et aux accents, sur nom / prénom (dans les deux ordres),
  // ville et nom du projet.
  const normaliser = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const requete = normaliser(search);
  const filtered = plans.filter(p => {
    if (!requete) return true;
    const c = p.client;
    const texte = normaliser(`${c.nom} ${c.prenom ?? ""} ${c.prenom ?? ""} ${c.nom} ${c.ville ?? ""} ${p.projetNom ?? ""}`);
    return requete.split(/\s+/).every(mot => texte.includes(mot));
  });

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

        {plans.length > 0 && (
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="input pl-10 pr-9" placeholder="Rechercher par nom de client…" value={search} onChange={e => setSearch(e.target.value)} />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600" title="Effacer la recherche">
                <X size={15} />
              </button>
            )}
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
              const { client, niveaux, nbPieces, projetNom } = entry;
              return (
                <div key={entry.key} className="card card-inner hover:border-volt-300 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-ink-900 flex items-center justify-center text-volt-400 font-semibold text-sm shrink-0">
                      {(client.prenom ? client.prenom[0] : "") + (client.nom?.[0] ?? "")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ink-900">{client.prenom ? `${client.prenom} ${client.nom}` : client.nom}</p>
                      <p className="text-xs text-ink-400">
                        {niveaux.filter(n => n.type !== "annexe").length} niveau{niveaux.filter(n => n.type !== "annexe").length > 1 ? "x" : ""}
                        {niveaux.some(n => n.type === "annexe") ? ` + ${niveaux.filter(n => n.type === "annexe").length} annexe${niveaux.filter(n => n.type === "annexe").length > 1 ? "s" : ""}` : ""}
                        {" "}· {nbPieces} pièce{nbPieces > 1 ? "s" : ""}
                        {projetNom ? ` · ${projetNom}` : ""}
                        {client.ville ? ` · ${client.ville}` : ""}
                      </p>
                      <div className="flex gap-2 mt-3">
                        <Link href={`/plan/${entry.clientId}${qsProjet(entry.projetId)}`} className="btn-volt !py-1.5 !text-xs">
                          <LayoutTemplate size={12} /> Ouvrir
                        </Link>
                        <button onClick={() => setASupprimer(entry)} className="btn-ghost !py-1.5 !text-xs text-red-500 ml-auto" title="Supprimer ce plan">
                          <Trash2 size={12} /> Supprimer
                        </button>
                        <Link href={`/clients/${entry.clientId}`} className="btn-ghost !py-1.5 !text-xs">
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

      <ConfirmDialog
        open={!!aSupprimer}
        title="Supprimer ce plan ?"
        message={aSupprimer
          ? `Le plan de ${aSupprimer.client.prenom ? `${aSupprimer.client.prenom} ${aSupprimer.client.nom}` : aSupprimer.client.nom}${aSupprimer.projetNom ? ` (${aSupprimer.projetNom})` : ""} sera supprimé avec son tableau électrique (annexes comprises) et son brouillon de pré-devis. Les devis déjà créés ne sont pas touchés. Cette action est définitive.`
          : ""}
        onConfirm={confirmerSuppression}
        onCancel={() => setASupprimer(null)}
        loading={suppEnCours}
      />

      {showPicker && (
        <ClientPickerModal clients={clients} planClientIds={new Set(plans.map(p => p.clientId))} onPick={handleCreate} onClose={() => setShowPicker(false)} />
      )}
    </Shell>
  );
}
