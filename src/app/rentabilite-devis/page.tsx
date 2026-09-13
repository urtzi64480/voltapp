"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmt, fmtDate, STATUT_LABELS, STATUT_COLORS, cn } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { Euro, AlertTriangle, ArrowUpDown, TrendingUp, TrendingDown } from "lucide-react";

interface DevisRentabLigne {
  id: string;
  numero: string;
  date_emission: string;
  statut: string;
  objet: string | null;
  client_nom: string;
  total_service: number;
  total_materiau: number;
  total_ttc: number;
  cout_achat: number;
  cotisation_service: number;
  cotisation_materiau: number;
  ir_service: number;
  ir_materiau: number;
  net_service: number;
  net_materiau: number;
  net_global: number;
  marge_pct: number;
  sans_cout_achat: boolean;
}

type StatutFiltre = "tous" | "brouillon" | "envoye" | "signe" | "refuse";
type TriMode = "date" | "marge";

function margeColor(pct: number) {
  if (pct < 0) return "text-red-600";
  if (pct < 20) return "text-amber-600";
  return "text-emerald-600";
}
function margeBg(pct: number) {
  if (pct < 0) return "bg-red-50 border-red-100";
  if (pct < 20) return "bg-amber-50 border-amber-100";
  return "bg-emerald-50 border-emerald-100";
}

export default function RentabiliteDevisPage() {
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [statutFiltre, setStatutFiltre] = useState<StatutFiltre>("tous");
  const [tri, setTri] = useState<TriMode>("date");
  const [loading, setLoading] = useState(true);
  const [tauxFiscaux, setTauxFiscaux] = useState({ cotis_service: 21.2, cotis_materiau: 12.3, ir_service: 0, ir_materiau: 0 });
  const [devisRentab, setDevisRentab] = useState<DevisRentabLigne[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const debut = `${annee}-01-01`;
      const fin = `${annee}-12-31`;

      const { data: { user } } = await supabase.auth.getUser();
      let taux = { cotis_service: 21.2, cotis_materiau: 12.3, ir_service: 0, ir_materiau: 0 };
      if (user) {
        const { data: profil } = await supabase
          .from("profil")
          .select("taux_cotisations_service,taux_cotisations_materiau,taux_ir_service,taux_ir_materiau")
          .eq("id", user.id)
          .single();
        if (profil) {
          taux = {
            cotis_service: (profil as any).taux_cotisations_service ?? 21.2,
            cotis_materiau: (profil as any).taux_cotisations_materiau ?? 12.3,
            ir_service: (profil as any).taux_ir_service ?? 0,
            ir_materiau: (profil as any).taux_ir_materiau ?? 0,
          };
        }
      }
      setTauxFiscaux(taux);

      let query = supabase
        .from("devis")
        .select("id,numero,date_emission,statut,objet,total_service,total_materiau,total_ttc,client:clients(nom,prenom)")
        .gte("date_emission", debut)
        .lte("date_emission", fin)
        .order("date_emission", { ascending: false });
      if (statutFiltre !== "tous") query = query.eq("statut", statutFiltre);

      const { data: devisData, error: errDevis } = await query;
      if (errDevis) console.error("Erreur récupération devis (rentabilité) :", errDevis);

      // ── Coût d'achat réel par devis ──
      // Même logique que le CRM : on récupère les lignes de devis liées à une prestation
      // du catalogue, puis leur prix d'achat catalogue actuel. Les lignes sans prestation_id
      // (lignes libres) ou les kits (dont la prestation elle-même n'a pas de prix_achat propre,
      // seuls ses kit_composants en ont un) ne contribuent pas au coût d'achat — même limitation
      // que le CRM, signalée via le flag sans_cout_achat plutôt que masquée.
      const devisIds = (devisData ?? []).map((d: any) => d.id);
      const coutParDevis: Record<string, number> = {};
      if (devisIds.length > 0) {
        const { data: lignesAchat, error: errLignes } = await supabase
          .from("devis_lignes")
          .select("devis_id,quantite,prestation_id")
          .in("devis_id", devisIds)
          .not("prestation_id", "is", null);
        if (errLignes) console.error("Erreur récupération devis_lignes (rentabilité) :", errLignes);

        const prestationIds = Array.from(new Set((lignesAchat ?? []).map((l: any) => l.prestation_id).filter(Boolean)));
        const prixAchatMap: Record<string, number> = {};
        if (prestationIds.length > 0) {
          const { data: prestAchat, error: errPrest } = await supabase
            .from("prestations")
            .select("id,prix_achat")
            .in("id", prestationIds);
          if (errPrest) console.error("Erreur récupération prestations (prix_achat) :", errPrest);
          (prestAchat ?? []).forEach((p: any) => { prixAchatMap[p.id] = p.prix_achat ?? 0; });
        }

        (lignesAchat ?? []).forEach((l: any) => {
          const prixAchat = prixAchatMap[l.prestation_id] ?? 0;
          if (prixAchat > 0) {
            coutParDevis[l.devis_id] = (coutParDevis[l.devis_id] ?? 0) + (l.quantite ?? 0) * prixAchat;
          }
        });
      }

      const rows: DevisRentabLigne[] = (devisData ?? []).map((d: any) => {
        const coutAchat = coutParDevis[d.id] ?? 0;
        const cotisService = d.total_service * taux.cotis_service / 100;
        const cotisMateriau = d.total_materiau * taux.cotis_materiau / 100;
        const irService = d.total_service * taux.ir_service / 100;
        const irMateriau = d.total_materiau * taux.ir_materiau / 100;
        const netService = d.total_service - cotisService - irService;
        const netMateriau = d.total_materiau - cotisMateriau - irMateriau - coutAchat;
        const netGlobal = netService + netMateriau;
        const margePct = d.total_ttc > 0 ? Math.round((netGlobal / d.total_ttc) * 1000) / 10 : 0;
        return {
          id: d.id,
          numero: d.numero,
          date_emission: d.date_emission,
          statut: d.statut,
          objet: d.objet,
          client_nom: d.client ? `${d.client.prenom ?? ""} ${d.client.nom}`.trim() : "—",
          total_service: d.total_service,
          total_materiau: d.total_materiau,
          total_ttc: d.total_ttc,
          cout_achat: coutAchat,
          cotisation_service: cotisService,
          cotisation_materiau: cotisMateriau,
          ir_service: irService,
          ir_materiau: irMateriau,
          net_service: netService,
          net_materiau: netMateriau,
          net_global: netGlobal,
          marge_pct: margePct,
          sans_cout_achat: d.total_materiau > 0 && coutAchat === 0,
        };
      });

      setDevisRentab(rows);
      setLoading(false);
    }
    load();
  }, [annee, statutFiltre]);

  const rowsTriees = [...devisRentab].sort((a, b) => {
    if (tri === "marge") return a.marge_pct - b.marge_pct;
    return new Date(b.date_emission).getTime() - new Date(a.date_emission).getTime();
  });

  const totaux = devisRentab.reduce((a, d) => ({
    ttc: a.ttc + d.total_ttc,
    service: a.service + d.total_service,
    materiau: a.materiau + d.total_materiau,
    coutAchat: a.coutAchat + d.cout_achat,
    cotisations: a.cotisations + d.cotisation_service + d.cotisation_materiau,
    ir: a.ir + d.ir_service + d.ir_materiau,
    netService: a.netService + d.net_service,
    netMateriau: a.netMateriau + d.net_materiau,
    netGlobal: a.netGlobal + d.net_global,
  }), { ttc: 0, service: 0, materiau: 0, coutAchat: 0, cotisations: 0, ir: 0, netService: 0, netMateriau: 0, netGlobal: 0 });
  const margeGlobalePct = totaux.ttc > 0 ? Math.round((totaux.netGlobal / totaux.ttc) * 1000) / 10 : 0;
  const nbNegatifs = devisRentab.filter(d => d.net_global < 0).length;

  const STATUTS: { id: StatutFiltre; label: string }[] = [
    { id: "tous", label: "Tous statuts" },
    { id: "brouillon", label: "Brouillons" },
    { id: "envoye", label: "Envoyés" },
    { id: "signe", label: "Signés" },
    { id: "refuse", label: "Refusés" },
  ];

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="font-display text-3xl text-ink-900">Rentabilité par devis</h1>
            <p className="text-ink-500 text-sm mt-1">Marge nette réelle service + achat-revente, cotisations et coût d'achat déduits</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select className="input !w-auto" value={statutFiltre} onChange={e => setStatutFiltre(e.target.value as StatutFiltre)}>
              {STATUTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select className="input !w-auto" value={annee} onChange={e => setAnnee(parseInt(e.target.value))}>
              {[2024, 2025, 2026, 2027, 2028].map(a => <option key={a}>{a}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-ink-400">Chargement…</div>
        ) : devisRentab.length === 0 ? (
          <div className="card card-inner text-center py-16">
            <p className="text-ink-400">Aucun devis sur cette période avec ces filtres</p>
          </div>
        ) : (
          <div className="space-y-5">

            {/* KPIs globaux */}
            <div className="card card-inner">
              <div className="flex items-center gap-2 mb-5">
                <Euro size={18} className="text-volt-600" />
                <h2 className="font-semibold text-ink-800">Vue d'ensemble {annee}</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-ink-50 rounded-xl p-4">
                  <p className="text-xs text-ink-400 mb-1">CA devis (TTC)</p>
                  <p className="text-2xl font-bold text-ink-900">{fmt(totaux.ttc)}</p>
                  <p className="text-xs text-ink-400 mt-1">{devisRentab.length} devis</p>
                </div>
                <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                  <p className="text-xs text-red-400 mb-1">Charges déduites</p>
                  <p className="text-2xl font-bold text-red-700">{fmt(totaux.coutAchat + totaux.cotisations + totaux.ir)}</p>
                  <div className="mt-1 space-y-0.5">
                    {totaux.coutAchat > 0 && <p className="text-xs text-red-500">Achat matériel : {fmt(totaux.coutAchat)}</p>}
                    <p className="text-xs text-red-500">Cotisations : {fmt(totaux.cotisations)}</p>
                    {totaux.ir > 0 && <p className="text-xs text-red-500">IR : {fmt(totaux.ir)}</p>}
                  </div>
                </div>
                <div className={cn("rounded-xl p-4 border", margeBg(margeGlobalePct))}>
                  <p className="text-xs text-ink-400 mb-1">Marge nette globale</p>
                  <p className={cn("text-2xl font-bold", margeColor(margeGlobalePct))}>{fmt(totaux.netGlobal)}</p>
                  <p className={cn("text-xs mt-1 font-medium", margeColor(margeGlobalePct))}>{margeGlobalePct}% du CA</p>
                </div>
                <div className={cn("rounded-xl p-4 border", nbNegatifs > 0 ? "bg-red-50 border-red-100" : "bg-emerald-50 border-emerald-100")}>
                  <p className="text-xs text-ink-400 mb-1">Devis déficitaires</p>
                  <p className={cn("text-2xl font-bold", nbNegatifs > 0 ? "text-red-700" : "text-emerald-700")}>{nbNegatifs}</p>
                  <p className="text-xs text-ink-400 mt-1">sur {devisRentab.length} devis</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-ink-100 text-sm">
                <div className="p-3 rounded-xl bg-volt-50 border border-volt-100">
                  <p className="text-xs font-semibold text-volt-700 mb-1">⚡ Net service</p>
                  <p className="text-lg font-bold text-ink-900">{fmt(totaux.netService)}</p>
                  <p className="text-xs text-ink-400">sur {fmt(totaux.service)} de CA service</p>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                  <p className="text-xs font-semibold text-emerald-700 mb-1">📦 Net matériaux</p>
                  <p className="text-lg font-bold text-ink-900">{fmt(totaux.netMateriau)}</p>
                  <p className="text-xs text-ink-400">sur {fmt(totaux.materiau)} de CA matériaux</p>
                </div>
              </div>
            </div>

            {/* Liste détaillée */}
            <div className="card card-inner">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className="font-semibold text-ink-800">Détail par devis</h2>
                <button onClick={() => setTri(t => t === "date" ? "marge" : "date")}
                  className="btn-ghost !px-3 text-xs flex items-center gap-1.5">
                  <ArrowUpDown size={13} />
                  {tri === "date" ? "Trier par marge la plus faible" : "Trier par date"}
                </button>
              </div>

              <div className="space-y-2">
                {rowsTriees.map(d => (
                  <Link key={d.id} href={`/devis/${d.id}`}
                    className="block p-3 rounded-xl bg-ink-50 border border-ink-100 hover:border-volt-300 transition-colors">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={cn("badge shrink-0", STATUT_COLORS[d.statut])}>{STATUT_LABELS[d.statut]}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink-900 truncate">{d.numero} · {d.client_nom}{d.objet ? ` — ${d.objet}` : ""}</p>
                        <p className="text-xs text-ink-400">{fmtDate(d.date_emission)} · TTC {fmt(d.total_ttc)}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {d.marge_pct >= 0
                          ? <TrendingUp size={14} className={margeColor(d.marge_pct)} />
                          : <TrendingDown size={14} className="text-red-600" />}
                        <span className={cn("text-sm font-bold", margeColor(d.marge_pct))}>{fmt(d.net_global)}</span>
                        <span className={cn("text-xs font-medium", margeColor(d.marge_pct))}>({d.marge_pct}%)</span>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-ink-100 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-ink-500">
                      <span>Service : {fmt(d.total_service)} → net {fmt(d.net_service)}</span>
                      <span>Matériaux : {fmt(d.total_materiau)} → net {fmt(d.net_materiau)}</span>
                      {d.cout_achat > 0 && <span>Achat matériel : − {fmt(d.cout_achat)}</span>}
                      <span>Cotisations : − {fmt(d.cotisation_service + d.cotisation_materiau)}</span>
                    </div>
                    {d.sans_cout_achat && (
                      <p className="text-xs text-amber-600 flex items-center gap-1 mt-1.5">
                        <AlertTriangle size={11} /> Coût d'achat indisponible pour ce devis (ligne libre ou kit sans prix d'achat renseigné) — marge probablement surestimée
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            </div>

            <p className="text-xs text-ink-400 px-1">
              Calcul basé sur les totaux du devis (service / matériaux), les cotisations URSSAF par branche ({tauxFiscaux.cotis_service}% service · {tauxFiscaux.cotis_materiau}% matériaux)
              {(tauxFiscaux.ir_service > 0 || tauxFiscaux.ir_materiau > 0) && " et l'IR libératoire"}, et le coût d'achat catalogue actuel des lignes liées à une prestation du catalogue.
              Le coût d'achat réel peut différer légèrement si vos tarifs fournisseurs ont changé depuis, et n'est pas disponible pour les lignes libres ou les composants de kit.
            </p>
          </div>
        )}
      </div>
    </Shell>
  );
}
