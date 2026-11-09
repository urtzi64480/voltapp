"use client";
// Suivi de chantier — point d'entrée direct : tous les plans et les devis signés avec leur avancement, un clic pour ouvrir le suivi.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarCheck, ChevronRight, ClipboardCheck, LayoutTemplate, FileText } from "lucide-react";
import Shell from "@/components/layout/Shell";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { lireSuivi } from "@/lib/suivi-persistance";
import { suiviDepuisConfig, progressionPlan } from "@/lib/suivi-realisation";
import { rowsTableauProjet, qsProjet } from "@/lib/projets";
import { avancement, groupesDevis, type LigneDevisSuivi } from "@/lib/suivi-devis";
import { separerChantiers, type ChantierListe } from "@/lib/suivi-liste";
import type { Projet } from "@/types";

type ClientLite = { id: string; nom: string; prenom?: string | null };
const nomClient = (c?: ClientLite | null) => (c ? `${c.prenom ? `${c.prenom} ` : ""}${c.nom}` : "");
const dateFr = (iso: string) => { const d = new Date(`${iso.slice(0, 10)}T12:00:00`); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR"); };

function Carte({ c }: { c: ChantierListe }) {
  const p = c.progression;
  const fini = !!c.valideLe || (!!p && p.total > 0 && p.fait >= p.total);
  return (
    <Link href={c.href} className="card card-inner flex items-center gap-3 hover:border-volt-400 transition-colors">
      <span className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", c.type === "plan" ? "bg-volt-100 text-volt-700" : "bg-ink-100 text-ink-600")}>
        {c.type === "plan" ? <LayoutTemplate size={17} /> : <FileText size={17} />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-ink-900 text-sm break-words">{c.titre}</span>
        <span className="block text-xs text-ink-500 break-words">{c.sousTitre}</span>
        {p ? (
          <span className="flex items-center gap-2 mt-1.5">
            <span className="flex-1 h-2 bg-ink-100 rounded-full overflow-hidden">
              <span className={cn("block h-full rounded-full", fini ? "bg-emerald-500" : "bg-volt-500")} style={{ width: `${p.pct}%` }} />
            </span>
            <span className="text-xs font-semibold tabular-nums text-ink-700 shrink-0">{p.fait}/{p.total} · {p.pct} %</span>
          </span>
        ) : <span className="block text-xs text-ink-400 mt-1">Aucune étape à suivre</span>}
        {c.valideLe && <span className="flex items-center gap-1 text-[11px] text-emerald-700 mt-1"><CalendarCheck size={12} /> Validé le {dateFr(c.valideLe)}</span>}
      </span>
      <ChevronRight size={16} className="text-ink-300 shrink-0" />
    </Link>
  );
}

export default function SuiviListePage() {
  const [liste, setListe] = useState<ChantierListe[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [colonneAbsente, setColonneAbsente] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const [clientsR, projetsR, devisR] = await Promise.all([
          supabase.from("clients").select("id,nom,prenom"),
          supabase.from("projets").select("*").order("created_at", { ascending: true }),
          supabase.from("devis").select("id,numero,objet,statut,created_at,suivi_realisation,client:clients(nom,prenom),lignes:devis_lignes(*)").eq("statut", "signe").order("created_at", { ascending: false }),
        ]);
        if (clientsR.error) throw new Error(`Clients : ${clientsR.error.message}`);
        let devisData = devisR.data as unknown;
        let absente = false;
        if (devisR.error) {
          if (!/suivi_realisation/i.test(devisR.error.message)) throw new Error(`Devis : ${devisR.error.message}`);
          absente = true; // migration 013 pas lancée : les devis s'affichent, sans coches
          const r2 = await supabase.from("devis").select("id,numero,objet,statut,created_at,client:clients(nom,prenom),lignes:devis_lignes(*)").eq("statut", "signe").order("created_at", { ascending: false });
          if (r2.error) throw new Error(`Devis : ${r2.error.message}`);
          devisData = r2.data;
        }
        const clients = new Map(((clientsR.data ?? []) as ClientLite[]).map(c => [c.id, c]));
        const sortie: ChantierListe[] = [];

        ((projetsR.error ? [] : projetsR.data ?? []) as Projet[]).forEach(p => {
          let suivi = null;
          try { suivi = suiviDepuisConfig(p.maison_config, rowsTableauProjet(p)); } catch { suivi = null; }
          if (!suivi) return; // pas de plan dessiné : rien à suivre
          const s = lireSuivi(p.suivi_realisation);
          sortie.push({
            key: `plan:${p.id}`, type: "plan", href: `/plan/${p.client_id}/suivi${qsProjet(p.id)}`,
            titre: p.nom || "Plan", sousTitre: `Plan · ${nomClient(clients.get(p.client_id)) || "client inconnu"}`,
            progression: progressionPlan(suivi, s.coches), valideLe: s.chantier.valide_le ?? null, date: p.updated_at ?? p.created_at ?? "",
          });
        });

        ((devisData ?? []) as { id: string; numero: string; objet?: string | null; created_at?: string; suivi_realisation?: string | null; client?: ClientLite | null; lignes?: LigneDevisSuivi[] | null }[]).forEach(d => {
          const lignes = d.lignes ?? [];
          const s = lireSuivi(d.suivi_realisation);
          const etapes = groupesDevis(lignes).flatMap(g => g.etapes);
          sortie.push({
            key: `devis:${d.id}`, type: "devis", href: `/devis/${d.id}/suivi`,
            titre: `${d.numero}${d.objet ? ` · ${d.objet}` : ""}`, sousTitre: `Devis signé · ${nomClient(d.client) || "client inconnu"}`,
            progression: etapes.length > 0 ? avancement(etapes, s.coches) : null, valideLe: s.chantier.valide_le ?? null, date: d.created_at ?? "",
          });
        });
        if (annule) return;
        setColonneAbsente(absente); setListe(sortie);
      } catch (e) {
        if (!annule) setErreur(e instanceof Error ? e.message : "Chargement impossible");
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => { annule = true; };
  }, []);

  const { enCours, termines } = useMemo(() => separerChantiers(liste), [liste]);

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <h1 className="font-display text-3xl text-ink-900 flex items-center gap-2"><ClipboardCheck size={26} className="text-volt-600" /> Suivi de chantier</h1>
        <p className="text-ink-500 text-sm mt-1 mb-5">Tes plans et tes devis signés : ouvre un chantier pour cocher les étapes et noter le temps passé.</p>

        {erreur && <div className="card card-inner border-red-300 bg-red-50 mb-4 flex items-start gap-2 text-sm text-red-800"><AlertTriangle size={16} className="shrink-0 mt-0.5" /><span>{erreur}</span></div>}
        {colonneAbsente && <div className="card card-inner border-amber-300 bg-amber-50 mb-4 text-xs text-amber-900">L&apos;avancement des devis n&apos;est pas disponible : la migration 013 (colonne <span className="font-mono">devis.suivi_realisation</span>) n&apos;a pas été lancée. Les liens fonctionnent quand même.</div>}
        {chargement && <div className="p-8 text-center text-ink-400">Chargement…</div>}
        {!chargement && !erreur && liste.length === 0 && (
          <div className="card card-inner text-sm text-ink-500">Aucun chantier à suivre pour le moment : un plan dessiné ou un devis signé apparaît ici automatiquement.</div>
        )}

        {enCours.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-2">En cours ({enCours.length})</h2>
            <div className="space-y-2">{enCours.map(c => <Carte key={c.key} c={c} />)}</div>
          </section>
        )}
        {termines.length > 0 && (
          <section>
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-2">Terminés ({termines.length})</h2>
            <div className="space-y-2">{termines.map(c => <Carte key={c.key} c={c} />)}</div>
          </section>
        )}
      </div>
    </Shell>
  );
}
