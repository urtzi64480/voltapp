"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Client, Projet } from "@/types";
import { suiviDepuisConfig, progressionPlan, Progression } from "@/lib/suivi-realisation";
import { lireSuivi } from "@/lib/suivi-persistance";
import { qsProjet, supprimerProjet, viderDonneesHistoriques, listerProjets, creerProjet, modifierProjet } from "@/lib/projets";
import ConfirmDialog from "@/components/ConfirmDialog";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { LayoutTemplate, ListChecks, FilePlus2, Pencil, ChevronDown, Plus, Search, ChevronRight, X, Trash2, Receipt } from "lucide-react";
import { fondModal } from "@/lib/fond-modal";

interface Niveau { id: number; nom: string; type: string; pieces: { id: number }[]; }

function ClientPickerModal({ clients, planClientIds, onPick, onClose }: {
  clients: Client[]; planClientIds: Set<string>; onPick: (clientId: string) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = clients.filter(c =>
    `${c.nom} ${c.prenom ?? ""} ${c.ville ?? ""}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-ink-900/60 backdrop-blur-sm" {...fondModal(onClose)}>
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
                    ? <span className="text-[10px] font-semibold text-volt-600 bg-volt-100 px-2 py-0.5 rounded-full shrink-0">📐 Plans · Nouveau</span>
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

// Nouveau plan (projet) pour un client qui en a déjà un : un client peut avoir autant de plans / chantiers que voulu.
function NouveauPlanModal({ client, existants, onCreer, onClose }: {
  client: Client; existants: PlanEntry[]; onCreer: (nom: string) => Promise<void>; onClose: () => void;
}) {
  const [nom, setNom] = useState("");
  const [busy, setBusy] = useState(false);
  const valider = async () => {
    if (!nom.trim() || busy) return;
    setBusy(true);
    try { await onCreer(nom.trim()); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" {...fondModal(() => !busy && onClose())}>
      <div className="card w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <p className="font-semibold text-ink-900">Nouveau plan · {client.prenom ? `${client.prenom} ${client.nom}` : client.nom}</p>
          <button onClick={onClose} className="btn-ghost !px-2 !py-1 text-ink-400" aria-label="Fermer"><X size={16} /></button>
        </div>
        <p className="text-xs text-ink-400 mb-3">
          Un plan = un logement ou un chantier, avec son propre plan de circuits, tableau, pré-devis, suivi de réalisation et devis.
        </p>
        {existants.length > 0 && (
          <div className="mb-4">
            <p className="label">Plans existants de ce client</p>
            <div className="space-y-1.5">
              {existants.map(e => (
                <Link key={e.key} href={`/plan/${e.clientId}${qsProjet(e.projetId)}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-ink-200 hover:border-volt-400 text-sm">
                  <span className="truncate">{e.projetNom ?? "Logement principal"}</span>
                  <span className="text-[10px] font-semibold text-volt-600 shrink-0">Modifier <ChevronRight size={11} className="inline" /></span>
                </Link>
              ))}
            </div>
          </div>
        )}
        <label className="label" htmlFor="nouveau-plan-nom">Nom du nouveau plan / chantier</label>
        <input id="nouveau-plan-nom" autoFocus className="input mb-4" placeholder="Extension garage, Appartement Bayonne…"
          value={nom} maxLength={80} onChange={e => setNom(e.target.value)} onKeyDown={e => e.key === "Enter" && void valider()} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="btn-ghost">Annuler</button>
          <button onClick={() => void valider()} disabled={busy || !nom.trim()} className="btn-volt">{busy ? "…" : "Créer et ouvrir"}</button>
        </div>
      </div>
    </div>
  );
}

interface PlanEntry {
  key: string; clientId: string; projetId: string | null; projetNom: string | null;
  client: Client; niveaux: Niveau[]; nbPieces: number;
  avancement: Progression | null; // suivi de réalisation (null = pas de suivi calculable)
  valideLe: string | null;        // validation finale du chantier (AAAA-MM-JJ)
}

function calculerAvancement(p: Projet): Progression | null {
  try {
    const suivi = suiviDepuisConfig(p.maison_config);
    return suivi ? progressionPlan(suivi, lireSuivi(p.suivi_realisation).coches) : null;
  } catch { return null; }
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
  const [nouveauPour, setNouveauPour] = useState<Client | null>(null);
  const [clientsOuverts, setClientsOuverts] = useState<Set<string>>(new Set());
  const [aRenommer, setARenommer] = useState<PlanEntry | null>(null);
  const [nomSaisi, setNomSaisi] = useState("");
  const [renommageEnCours, setRenommageEnCours] = useState(false);

  const confirmerRenommage = async () => {
    if (!aRenommer?.projetId || !nomSaisi.trim()) return;
    setRenommageEnCours(true);
    const ok = await modifierProjet(aRenommer.projetId, { nom: nomSaisi.trim() });
    setRenommageEnCours(false);
    if (!ok) { alert("Le renommage a échoué."); return; }
    setARenommer(null);
    charger();
  };

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
          if (plan) entries.push({ key: c.id, clientId: c.id, projetId: null, projetNom: null, client: c, avancement: null, valideLe: null, ...plan });
          return;
        }
        ps.forEach(p => {
          const plan = lirePlan(p.maison_config);
          if (plan) entries.push({ key: p.id, clientId: c.id, projetId: p.id, projetNom: p.nom, client: c, avancement: calculerAvancement(p), valideLe: lireSuivi(p.suivi_realisation).chantier.valide_le ?? null, ...plan });
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

  // Client sans plan : on ouvre directement l'éditeur (le projet par défaut est créé à l'ouverture). Client qui a déjà un plan :
  // on propose d'en créer un NOUVEAU (autre logement / autre chantier) ou d'ouvrir un existant.
  const handleCreate = (clientId: string) => {
    setShowPicker(false);
    const client = clients.find(c => c.id === clientId);
    if (client && plans.some(p => p.clientId === clientId)) { setNouveauPour(client); return; }
    router.push(`/plan/${clientId}`);
  };

  const creerNouveauPlan = async (nom: string) => {
    if (!nouveauPour) return;
    // listerProjets d'abord : il reprend un éventuel plan historique du client dans un projet, qui sinon serait masqué par le nouveau.
    await listerProjets(nouveauPour.id);
    const p = await creerProjet(nouveauPour.id, nom);
    if (!p) { alert("La création du plan a échoué."); return; }
    router.push(`/plan/${nouveauPour.id}${qsProjet(p.id)}`);
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

  // Plans regroupés par client (ordre alphabétique des clients, plans dans l'ordre de création).
  const groupes = (() => {
    const m = new Map<string, PlanEntry[]>();
    filtered.forEach(e => { const l = m.get(e.clientId); if (l) l.push(e); else m.set(e.clientId, [e]); });
    return [...m.values()];
  })();
  const rechercheActive = requete.length > 0;
  const estOuvert = (clientId: string) => rechercheActive || clientsOuverts.has(clientId);
  const basculerClient = (clientId: string) => setClientsOuverts(prev => { const n = new Set(prev); if (n.has(clientId)) n.delete(clientId); else n.add(clientId); return n; });
  const toutOuvert = groupes.length > 0 && groupes.every(g => clientsOuverts.has(g[0].clientId));

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-3xl text-ink-900">Plans interventions</h1>
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
          <>
            <div className="flex justify-end mb-2">
              <button type="button" className="text-xs font-semibold text-volt-700 hover:text-volt-800"
                onClick={() => setClientsOuverts(toutOuvert ? new Set() : new Set(groupes.map(g => g[0].clientId)))}>
                {toutOuvert ? "Tout fermer" : "Tout ouvrir"}
              </button>
            </div>
            <div className="space-y-3">
              {groupes.map(entrees => {
                const client = entrees[0].client;
                const ouvert = estOuvert(client.id);
                const avancements = entrees.map(e => e.avancement).filter((a): a is Progression => !!a && a.total > 0);
                const totalFait = avancements.reduce((t, a) => t + a.fait, 0);
                const totalTotal = avancements.reduce((t, a) => t + a.total, 0);
                const pct = totalTotal > 0 ? Math.round((totalFait / totalTotal) * 100) : 0;
                return (
                  <div key={client.id} className="card overflow-hidden">
                    <button type="button" onClick={() => basculerClient(client.id)} aria-expanded={ouvert}
                      className="w-full flex items-center gap-3 p-4 text-left">
                      <div className="w-10 h-10 rounded-full bg-ink-900 flex items-center justify-center text-volt-400 font-semibold text-sm shrink-0">
                        {(client.prenom ? client.prenom[0] : "") + (client.nom?.[0] ?? "")}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-ink-900 truncate">{client.prenom ? `${client.prenom} ${client.nom}` : client.nom}</p>
                        <p className="text-xs text-ink-400 truncate">
                          {entrees.length} plan{entrees.length > 1 ? "s" : ""}{client.ville ? ` · ${client.ville}` : ""}
                          {totalTotal > 0 ? ` · réalisation ${pct} %` : ""}
                        </p>
                      </div>
                      {ouvert ? <ChevronDown size={18} className="shrink-0 text-ink-400" /> : <ChevronRight size={18} className="shrink-0 text-ink-400" />}
                    </button>
                    {ouvert && (
                      <div className="px-4 pb-4 border-t border-ink-100 pt-3 space-y-2.5">
                        {entrees.map(entry => {
                          const { niveaux, nbPieces, projetNom } = entry;
              return (
                <div key={entry.key} className="rounded-xl border border-ink-200 bg-white p-3.5 hover:border-volt-300 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      {projetNom ? (
                        <button type="button" onClick={() => { setARenommer(entry); setNomSaisi(projetNom); }}
                          className="inline-flex items-center gap-1.5 font-semibold text-ink-900 hover:text-volt-700 text-left" title="Renommer ce plan / chantier">
                          {projetNom} <Pencil size={12} className="text-ink-400" />
                        </button>
                      ) : (
                        <p className="font-semibold text-ink-900">Plan à reprendre (ouvre-le une fois pour pouvoir le nommer)</p>
                      )}
                      <p className="text-xs text-ink-400">
                        {niveaux.filter(n => n.type !== "annexe").length} niveau{niveaux.filter(n => n.type !== "annexe").length > 1 ? "x" : ""}
                        {niveaux.some(n => n.type === "annexe") ? ` + ${niveaux.filter(n => n.type === "annexe").length} annexe${niveaux.filter(n => n.type === "annexe").length > 1 ? "s" : ""}` : ""}
                        {" "}· {nbPieces} pièce{nbPieces > 1 ? "s" : ""}
                      </p>
                      {entry.avancement && entry.avancement.total > 0 && (() => {
                        const av = entry.avancement!;
                        const fini = av.fait === av.total;
                        return (
                          <div className="mt-3" title="Avancement de la réalisation du chantier">
                            <div className="flex items-center justify-between text-[11px] text-ink-500 mb-1">
                              <span className="font-semibold truncate">Réalisation chantier</span>
                              <span className={`shrink-0 ${fini ? "font-semibold text-emerald-700" : "tabular-nums"}`}>{fini ? "Terminé ✓" : `${av.fait}/${av.total} · ${av.pct}%`}</span>
                            </div>
                            <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${fini ? "bg-emerald-500" : "bg-volt-500"}`} style={{ width: `${av.pct}%` }} />
                            </div>
                            {entry.valideLe && (
                              <p className="text-[11px] text-emerald-700 font-medium mt-1">
                                Chantier validé le {new Date(`${entry.valideLe}T12:00:00`).toLocaleDateString("fr-FR")}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                      <div className="flex flex-wrap gap-2 mt-3">
                        <Link href={`/plan/${entry.clientId}${qsProjet(entry.projetId)}`} className="btn-volt !py-1.5 !text-xs">
                          <LayoutTemplate size={12} /> Ouvrir
                        </Link>
                        <Link href={`/plan/${entry.clientId}/suivi${qsProjet(entry.projetId)}`} className="btn-ghost !py-1.5 !text-xs" title="Suivi de réalisation des circuits">
                          <ListChecks size={12} /> Suivi
                        </Link>
                        <Link href={`/predevis/${entry.clientId}${qsProjet(entry.projetId)}`} className="btn-ghost !py-1.5 !text-xs" title="Pré-devis de ce projet">
                          <Receipt size={12} /> Pré-devis
                        </Link>
                        <button onClick={() => setASupprimer(entry)} className="btn-ghost !py-1.5 !text-xs text-red-500 ml-auto" title="Supprimer ce plan">
                          <Trash2 size={12} /> Supprimer
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
                        })}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button onClick={() => setNouveauPour(client)} className="btn-ghost !py-1.5 !text-xs"><FilePlus2 size={12} /> Nouveau plan pour ce client</button>
                          <Link href={`/clients/${client.id}`} className="btn-ghost !py-1.5 !text-xs">Fiche client <ChevronRight size={12} /></Link>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
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

      {aRenommer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" {...fondModal(() => !renommageEnCours && setARenommer(null))}>
          <div className="card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <p className="font-semibold text-ink-900 mb-3">Renommer le plan / chantier</p>
            <input autoFocus className="input mb-4" value={nomSaisi} maxLength={80} onChange={e => setNomSaisi(e.target.value)}
              onKeyDown={e => e.key === "Enter" && void confirmerRenommage()} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setARenommer(null)} disabled={renommageEnCours} className="btn-ghost">Annuler</button>
              <button onClick={() => void confirmerRenommage()} disabled={renommageEnCours || !nomSaisi.trim()} className="btn-volt">{renommageEnCours ? "…" : "Enregistrer"}</button>
            </div>
          </div>
        </div>
      )}

      {nouveauPour && (
        <NouveauPlanModal client={nouveauPour} existants={plans.filter(p => p.clientId === nouveauPour.id)}
          onCreer={creerNouveauPlan} onClose={() => setNouveauPour(null)} />
      )}

      {showPicker && (
        <ClientPickerModal clients={clients} planClientIds={new Set(plans.map(p => p.clientId))} onPick={handleCreate} onClose={() => setShowPicker(false)} />
      )}
    </Shell>
  );
}
