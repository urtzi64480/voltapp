"use client";
// Rentabilité globale (privée) : marge par type de chantier et heures réelles vs estimées, sur les devis SIGNÉS.
// Les formules sont celles de la page de rentabilité d'un devis (voir src/lib/rentabilite.ts, couvert par des tests).
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock, TrendingUp } from "lucide-react";
import Shell from "@/components/layout/Shell";
import { supabase } from "@/lib/supabase";
import { cn, fmt } from "@/lib/utils";
import { formaterMinutes } from "@/lib/suivi-persistance";
import {
  analyserDevis, construirePrixAchatMap, grouperParType, minutesReelles, partCouverte, proratiser, tauxDepuisProfil,
  type FactureRentab, type InfoPrestation, type SourceRentab, type LigneRentab, type ResultatDevis,
} from "@/lib/rentabilite";

interface DevisBrut { id: string; statut: string; numero: string; objet: string | null; created_at: string; total_service: number; total_materiau: number; total_ttc: number; devis_lignes: LigneRentab[] | null }

const couleurMarge = (p: number | null) => p == null ? "text-ink-400" : p < 0 ? "text-red-600" : p < 25 ? "text-amber-600" : "text-emerald-600";
const heures = (h: number) => formaterMinutes(Math.round(h * 60));

export default function RentabilitePage() {
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [tempsIndisponible, setTempsIndisponible] = useState(false);
  const [brut, setBrut] = useState<{ r: ResultatDevis; statut: string; ttc: number; factures: FactureRentab[]; annee: string }[]>([]);
  const [source, setSource] = useState<SourceRentab>("devis");
  const [facturesIndisponibles, setFacturesIndisponibles] = useState(false);
  const [annee, setAnnee] = useState<string>("toutes");

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const [devisR, prestR, compR, projR, suiviDevisR, facturesR, profilR] = await Promise.all([
          supabase.from("devis").select("id,numero,objet,statut,created_at,total_service,total_materiau,total_ttc,devis_lignes(*)").order("created_at", { ascending: false }),
          supabase.from("prestations").select("id,categorie,prix_achat"),
          supabase.from("kit_composants").select("kit_id,composant_id,quantite"),
          supabase.from("projets").select("suivi_realisation"),
          supabase.from("devis").select("id,suivi_realisation"),
          supabase.from("factures").select("devis_id,statut,total_ttc"),
          user ? supabase.from("profil").select("*").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
        ]);
        if (devisR.error) throw new Error(`Devis : ${devisR.error.message}`);
        if (prestR.error) throw new Error(`Catalogue : ${prestR.error.message}`);
        if (compR.error) throw new Error(`Kits : ${compR.error.message}`);
        // Sans la migration 008 (colonne suivi_realisation) : on affiche quand même les marges, sans les heures réelles.
        const projets = projR.error ? [] : ((projR.data ?? []) as { suivi_realisation?: string | null }[]);
        // « est_kit » n'est pas une colonne de la base : un kit = une prestation qui a des composants.
        const composants = (compR.data ?? []) as { kit_id: string; composant_id: string; quantite?: number | null }[];
        const idsKits = new Set(composants.map(c => c.kit_id));
        // Suivi propre à chaque devis (migration 013) : s'il n'existe pas encore, seuls les suivis de plans comptent.
        const suiviParDevis = new Map<string, string | null>();
        if (!suiviDevisR.error) ((suiviDevisR.data ?? []) as { id: string; suivi_realisation?: string | null }[]).forEach(r => suiviParDevis.set(r.id, r.suivi_realisation ?? null));
        const prestations = ((prestR.data ?? []) as ({ id: string } & InfoPrestation)[]).map(p => ({ ...p, est_kit: idsKits.has(p.id) }));
        const infos: Record<string, InfoPrestation> = {};
        prestations.forEach(p => { infos[p.id] = p; });
        const prixAchat = construirePrixAchatMap(prestations, composants);
        const taux = tauxDepuisProfil(profilR.data as Record<string, number | null> | null);
        const facturesParDevis = new Map<string, FactureRentab[]>();
        if (!facturesR.error) ((facturesR.data ?? []) as FactureRentab[]).forEach(f => {
          if (f.devis_id) facturesParDevis.set(f.devis_id, [...(facturesParDevis.get(f.devis_id) ?? []), f]);
        });
        const res = ((devisR.data ?? []) as unknown as DevisBrut[]).map(d => ({
          r: analyserDevis(d, d.devis_lignes ?? [], prixAchat, infos, taux, minutesReelles(d.id, projets, suiviParDevis.get(d.id))),
          statut: d.statut, ttc: Number(d.total_ttc) || 0, factures: facturesParDevis.get(d.id) ?? [],
          annee: (d.created_at ?? "").slice(0, 4) || "—",
        }));
        if (annule) return;
        setTempsIndisponible(!!projR.error && !!suiviDevisR.error);
        setFacturesIndisponibles(!!facturesR.error);
        setBrut(res);
      } catch (e) {
        if (!annule) setErreur(e instanceof Error ? e.message : "Chargement impossible");
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => { annule = true; };
  }, []);

  // Source : devis signés, ou devis ayant au moins une facture émise / payée (montants ramenés à la part réellement facturée).
  const resultats = useMemo(() => brut.flatMap(b => {
    const part = partCouverte(source, b.statut, b.ttc, b.factures);
    return part == null ? [] : [{ ...proratiser(b.r, part), annee: b.annee }];
  }), [brut, source]);
  const annees = useMemo(() => Array.from(new Set(resultats.map(r => r.annee))).sort().reverse(), [resultats]);
  const filtres = useMemo(() => annee === "toutes" ? resultats : resultats.filter(r => r.annee === annee), [resultats, annee]);
  const groupes = useMemo(() => grouperParType(filtres), [filtres]);
  const ca = filtres.reduce((a, r) => a + r.ca, 0), net = filtres.reduce((a, r) => a + r.net, 0);
  const margeGlobale = ca > 0 ? Math.round((net / ca) * 1000) / 10 : null;
  const sansCout = filtres.reduce((a, r) => a + r.lignesSansCout, 0);
  const nbChrono = filtres.filter(r => r.heuresReelles != null).length;

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-5xl mx-auto">
        <div className="flex items-end justify-between mb-6 gap-3">
          <div>
            <h1 className="font-display text-3xl text-ink-900">Rentabilité</h1>
            <p className="text-ink-500 mt-1 text-sm">Privé, jamais visible par les clients</p>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
          <select value={source} onChange={e => setSource(e.target.value as SourceRentab)} className="input !w-auto" aria-label="Source de l'analyse">
            <option value="devis">Devis signés</option>
            <option value="emises">Factures émises</option>
            <option value="payees">Factures payées</option>
          </select>
          {annees.length > 1 && (
            <select value={annee} onChange={e => setAnnee(e.target.value)} className="input !w-auto" aria-label="Année">
              <option value="toutes">Toutes les années</option>
              {annees.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          </div>
        </div>

        {source !== "devis" && (
          <p className="text-xs text-ink-500 mb-3">
            {facturesIndisponibles ? "Factures illisibles sur cette base : aucun résultat. " : ""}
            Les achats et le net sont ramenés à la part du devis couverte par les factures {source === "payees" ? "payées" : "émises (hors « à envoyer »)"}. Les factures sans devis lié ne sont pas comptées.
          </p>
        )}
        {erreur && <div className="card card-inner text-red-700 text-sm mb-4" role="alert">Erreur : {erreur}</div>}
        {chargement && <p className="text-ink-500">Chargement…</p>}

        {!chargement && !erreur && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {[
                { label: source === "devis" ? "Devis signés" : source === "emises" ? "Devis facturés" : "Devis encaissés", value: String(filtres.length), sub: "analysés" },
                { label: "Chiffre d'affaires", value: fmt(ca), sub: source === "devis" ? "total TTC des devis" : "TTC facturé (au prorata du devis)" },
                { label: "Net après charges", value: fmt(net), sub: "cotisations, impôt et achats déduits" },
                { label: "Marge nette", value: margeGlobale == null ? "—" : `${margeGlobale} %`, sub: "du chiffre d'affaires", classe: couleurMarge(margeGlobale) },
              ].map(k => (
                <div key={k.label} className="card card-inner">
                  <p className="text-xs text-ink-500 mb-0.5">{k.label}</p>
                  <p className={cn("text-2xl font-semibold text-ink-900", k.classe)}>{k.value}</p>
                  <p className="text-xs text-ink-400 mt-0.5">{k.sub}</p>
                </div>
              ))}
            </div>

            {sansCout > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs p-3 mb-4 flex gap-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                {sansCout} ligne(s) de matériau sans prix d&apos;achat : les marges marquées « ≈ » sont probablement surestimées.
              </div>
            )}

            {filtres.length === 0 ? (
              <div className="card card-inner text-ink-500 text-sm">{source === "devis" ? "Aucun devis signé" : source === "emises" ? "Aucune facture émise" : "Aucune facture payée"}{annee !== "toutes" ? ` en ${annee}` : ""} pour le moment.</div>
            ) : (
              <>
                <h2 className="font-semibold text-ink-800 mb-2 flex items-center gap-2"><TrendingUp size={17} className="text-volt-600" /> Marge par type de chantier</h2>
                <p className="text-xs text-ink-400 mb-3">Type = catégorie du catalogue qui pèse le plus dans le devis.</p>
                <div className="space-y-3 mb-8">
                  {groupes.map(g => (
                    <div key={g.type} className="card card-inner">
                      <div className="flex justify-between items-start gap-3">
                        <div>
                          <p className="font-semibold text-ink-900">{g.type}</p>
                          <p className="text-xs text-ink-400">{g.nbDevis} devis · CA {fmt(g.ca)}</p>
                        </div>
                        <div className="text-right">
                          <p className={cn("text-lg font-bold", couleurMarge(g.margePct))}>{g.incomplet ? "≈ " : ""}{fmt(g.net)}</p>
                          <p className={cn("text-xs font-semibold", couleurMarge(g.margePct))}>{g.margePct == null ? "—" : `${g.incomplet ? "≈ " : ""}${g.margePct} %`}</p>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-ink-100 grid grid-cols-3 gap-2 text-xs">
                        <div><p className="text-ink-400">Heures estimées</p><p className="font-semibold text-ink-800">{g.heuresEstimees > 0 ? heures(g.heuresEstimees) : "—"}</p></div>
                        <div><p className="text-ink-400">Heures réelles</p><p className="font-semibold text-ink-800">{g.nbAvecTempsReel > 0 ? heures(g.heuresReelles) : "—"}</p></div>
                        <div>
                          <p className="text-ink-400">Écart / net par heure</p>
                          <p className="font-semibold text-ink-800">
                            {g.ecartHeuresPct == null ? "—" : <span className={g.ecartHeuresPct > 10 ? "text-red-600" : g.ecartHeuresPct < -10 ? "text-emerald-600" : ""}>{g.ecartHeuresPct > 0 ? "+" : ""}{g.ecartHeuresPct} %</span>}
                            {g.netParHeure != null && <span className="text-ink-500 font-normal"> · {fmt(g.netParHeure)}/h</span>}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <h2 className="font-semibold text-ink-800 mb-2 flex items-center gap-2"><Clock size={17} className="text-volt-600" /> Détail par devis</h2>
                {tempsIndisponible && <p className="text-xs text-amber-700 mb-2">Le suivi de chantier n&apos;est pas disponible sur cette base (migrations 008 et 013) : heures réelles non affichées.</p>}
                {nbChrono === 0 && !tempsIndisponible && <p className="text-xs text-ink-400 mb-2">Aucun temps saisi : ouvre un devis, bouton « Suivi de chantier », et note le temps passé par poste pour le comparer aux heures chiffrées.</p>}
                <div className="card divide-y divide-ink-100">
                  {filtres.map(r => (
                    <Link key={r.id} href={`/devis/${r.id}/rentabilite`} className="flex items-center justify-between gap-3 p-3 hover:bg-ink-50">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900 truncate">{r.numero}{r.objet ? ` · ${r.objet}` : ""}</p>
                        <p className="text-xs text-ink-400">{r.type} · {fmt(r.ca)}
                          {r.heuresEstimees > 0 && ` · ${heures(r.heuresEstimees)} estimées`}
                          {r.heuresReelles != null && ` · ${heures(r.heuresReelles)} réelles`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn("text-sm font-semibold", couleurMarge(r.margePct))}>{r.lignesSansCout > 0 ? "≈ " : ""}{fmt(r.net)}</p>
                        <p className={cn("text-xs", couleurMarge(r.margePct))}>{r.margePct == null ? "—" : `${r.margePct} %`}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
