"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmt, fmtDate, STATUT_LABELS, STATUT_COLORS, PLAFOND_SERVICE, PLAFOND_MATERIAU, cn } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { TrendingUp, FileText, Receipt, CheckCircle, Clock, AlertTriangle, BarChart3, PieChart, Euro, Users, Download, Landmark, ShoppingBag } from "lucide-react";

// Seuils de franchise en base de TVA 2026 (distincts des plafonds de CA du régime micro)
const FRANCHISE_TVA_SERVICE = 37500;
const FRANCHISE_TVA_MATERIAU = 85000;

interface CATStat { categorie: string; type_branche: string; total: number; nb: number; }
interface CommissionApporteur {
  id: string; nom: string; entreprise?: string;
  caMois: number; commissionPct: number; commissionEur: number;
}
interface DevisRentabilite {
  id: string; numero: string; date_emission: string; client_nom: string;
  total_materiau: number; cout_achat: number; sans_devis?: boolean;
}

function BarMois({ mois, service, materiau, serviceN1, materiauN1, maxMois, label }: {
  mois: number; service: number; materiau: number;
  serviceN1: number; materiauN1: number; maxMois: number; label: string;
}) {
  const [hover, setHover] = useState(false);
  const tot = service + materiau;
  const totN1 = serviceN1 + materiauN1;
  const hS   = maxMois > 0 ? Math.round(service / maxMois * 100) : 0;
  const hM   = maxMois > 0 ? Math.round(materiau / maxMois * 100) : 0;
  const hSN1 = maxMois > 0 ? Math.round(serviceN1 / maxMois * 100) : 0;
  const hMN1 = maxMois > 0 ? Math.round(materiauN1 / maxMois * 100) : 0;
  const MOIS_LONG = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

  return (
    <div className="flex-1 flex flex-col items-center gap-0.5 relative cursor-default"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {hover && (tot > 0 || totN1 > 0) && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-ink-900 text-white text-xs rounded-xl px-3 py-2 whitespace-nowrap z-10 shadow-xl">
          <p className="font-semibold mb-1">{MOIS_LONG[mois - 1]}</p>
          {tot > 0 && <p className="text-volt-400">N : {fmt(tot)}</p>}
          {totN1 > 0 && <p className="text-ink-400">N-1 : {fmt(totN1)}</p>}
        </div>
      )}
      <div className="w-full flex gap-0.5 justify-center items-end" style={{ height: "96px" }}>
        <div className="flex-1 flex flex-col justify-end" style={{ height: "96px" }}>
          <div className="w-full bg-ink-200 rounded-t-sm" style={{ height: `${hMN1}%`, minHeight: hMN1 > 0 ? "2px" : 0 }} />
          <div className="w-full bg-ink-300 rounded-t-sm" style={{ height: `${hSN1}%`, minHeight: hSN1 > 0 ? "2px" : 0 }} />
        </div>
        <div className="flex-1 flex flex-col justify-end" style={{ height: "96px" }}>
          <div className="w-full bg-emerald-400 rounded-t-sm" style={{ height: `${hM}%`, minHeight: hM > 0 ? "2px" : 0 }} />
          <div className="w-full bg-volt-500 rounded-t-sm" style={{ height: `${hS}%`, minHeight: hS > 0 ? "2px" : 0 }} />
        </div>
      </div>
      <span className="text-xs text-ink-400">{label}</span>
    </div>
  );
}

export default function CRMPage() {
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [moisCommission, setMoisCommission] = useState(new Date().getMonth() + 1);
  const [anneeExport, setAnneeExport] = useState(new Date().getFullYear());
  const [moisExport, setMoisExport] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);

  const [caAnnuel, setCaAnnuel] = useState({ service: 0, materiau: 0 });
  const [caMensuel, setCaMensuel] = useState<{ mois: number; service: number; materiau: number }[]>([]);
  const [caMensuelN1, setCaMensuelN1] = useState<{ mois: number; service: number; materiau: number }[]>([]);
  const [caAnnuelN1, setCaAnnuelN1] = useState({ service: 0, materiau: 0 });
  const [catStats, setCatStats] = useState<CATStat[]>([]);
  const [devisStats, setDevisStats] = useState({ total: 0, brouillon: 0, envoye: 0, signe: 0, refuse: 0, caDevis: 0, caSignes: 0 });
  const [paiementStats, setPaiementStats] = useState({ nbPayees: 0, nbImpayees: 0, nbRelance: 0, montantPayee: 0, montantImpayee: 0, montantRelance: 0 });
  const [topClients, setTopClients] = useState<{ nom: string; prenom?: string; ca: number; nb: number }[]>([]);
  const [devisEnAttente, setDevisEnAttente] = useState<any[]>([]);
  const [facturesImpayees, setFacturesImpayees] = useState<any[]>([]);
  const [tauxFiscaux, setTauxFiscaux] = useState({ cotis_service: 21.2, cotis_materiau: 12.3, ir_service: 0, ir_materiau: 0 });
  const [commissionsApporteurs, setCommissionsApporteurs] = useState<CommissionApporteur[]>([]);
  const [totalCommissions, setTotalCommissions] = useState(0);
  const [devisRentabilite, setDevisRentabilite] = useState<DevisRentabilite[]>([]);

  const MOIS_LONG = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  const MOIS = ["J","F","M","A","M","J","J","A","S","O","N","D"];

  useEffect(() => {
    async function load() {
      setLoading(true);
      const debut   = `${annee}-01-01`;
      const fin     = `${annee}-12-31`;
      const debutN1 = `${annee - 1}-01-01`;
      const finN1   = `${annee - 1}-12-31`;
      const moisStr = String(moisCommission).padStart(2, "0");
      const debutMois = `${annee}-${moisStr}-01`;
      const finMois = new Date(annee, moisCommission, 0).toISOString().split("T")[0];

      const { data: { user } } = await supabase.auth.getUser();
      const [
        { data: facsPayees },
        { data: facsPayeesN1 },
        { data: facsAll },
        { data: devisAll },
        { data: lignesPayees },
        { data: topCls },
        { data: devisAttente },
        { data: facsImp },
        { data: profil },
        { data: apporteurs },
        { data: paliersAp },
        { data: facsMois },
      ] = await Promise.all([
        supabase.from("factures").select("total_service,total_materiau,date_emission,statut").gte("paye_le", debut).lte("paye_le", fin).eq("statut", "payee"),
        supabase.from("factures").select("total_service,total_materiau,date_emission,statut").gte("paye_le", debutN1).lte("paye_le", finN1).eq("statut", "payee"),
        supabase.from("factures").select("statut,total_ttc").gte("date_emission", debut).lte("date_emission", fin),
        supabase.from("devis").select("statut,total_ttc,total_service,total_materiau").gte("date_emission", debut).lte("date_emission", fin),
        supabase.from("facture_lignes").select("nom,type_branche,quantite,prix_unitaire,facture:factures!inner(statut,date_emission)").gte("facture.date_emission", debut).lte("facture.date_emission", fin).eq("facture.statut", "payee"),
        supabase.from("factures").select("client_id,total_ttc,client:clients(nom,prenom)").eq("statut","payee").gte("date_emission",debut).lte("date_emission",fin),
        supabase.from("devis").select("*,client:clients(nom,prenom)").in("statut",["brouillon","envoye"]).order("date_emission",{ascending:false}).limit(5),
        supabase.from("factures").select("*,client:clients(nom,prenom)").in("statut",["impayee","relance"]).order("date_echeance",{ascending:true}).limit(5),
        user ? supabase.from("profil").select("taux_cotisations_service,taux_cotisations_materiau,taux_ir_service,taux_ir_materiau").eq("id", user.id).single() : Promise.resolve({ data: null }),
        supabase.from("apporteurs").select("*").eq("actif", true).order("nom"),
        supabase.from("paliers_apporteur").select("*").order("seuil_min"),
        supabase.from("factures").select("total_ttc,apporteur_id").eq("statut","payee").gte("paye_le", debutMois).lte("paye_le", finMois).not("apporteur_id", "is", null),
      ]);

      if (profil) {
        setTauxFiscaux({
          cotis_service:  (profil as any).taux_cotisations_service ?? 21.2,
          cotis_materiau: (profil as any).taux_cotisations_materiau ?? 12.3,
          ir_service:     (profil as any).taux_ir_service ?? 0,
          ir_materiau:    (profil as any).taux_ir_materiau ?? 0,
        });
      }

      const rows = facsPayees ?? [];
      const caS = rows.reduce((a, r) => a + r.total_service, 0);
      const caM = rows.reduce((a, r) => a + r.total_materiau, 0);
      setCaAnnuel({ service: caS, materiau: caM });

      const rowsN1 = facsPayeesN1 ?? [];
      setCaAnnuelN1({ service: rowsN1.reduce((a, r) => a + r.total_service, 0), materiau: rowsN1.reduce((a, r) => a + r.total_materiau, 0) });

      const map: Record<number, { service: number; materiau: number }> = {};
      for (let m = 1; m <= 12; m++) map[m] = { service: 0, materiau: 0 };
      rows.forEach(r => { const m = new Date(r.date_emission).getMonth() + 1; map[m].service += r.total_service; map[m].materiau += r.total_materiau; });
      setCaMensuel(Object.entries(map).map(([k, v]) => ({ mois: parseInt(k), ...v })));

      const mapN1: Record<number, { service: number; materiau: number }> = {};
      for (let m = 1; m <= 12; m++) mapN1[m] = { service: 0, materiau: 0 };
      rowsN1.forEach(r => { const m = new Date(r.date_emission).getMonth() + 1; mapN1[m].service += r.total_service; mapN1[m].materiau += r.total_materiau; });
      setCaMensuelN1(Object.entries(mapN1).map(([k, v]) => ({ mois: parseInt(k), ...v })));

      const catMap: Record<string, CATStat> = {};
      (lignesPayees ?? []).forEach((l: any) => {
        const key = l.type_branche;
        if (!catMap[key]) catMap[key] = { categorie: l.type_branche === "service" ? "Prestations service" : "Matériaux", type_branche: l.type_branche, total: 0, nb: 0 };
        catMap[key].total += l.prix_unitaire * l.quantite;
        catMap[key].nb++;
      });
      setCatStats(Object.values(catMap).sort((a, b) => b.total - a.total));

      const dv = devisAll ?? [];
      setDevisStats({
        total: dv.length,
        brouillon: dv.filter(d => d.statut === "brouillon").length,
        envoye: dv.filter(d => d.statut === "envoye").length,
        signe: dv.filter(d => d.statut === "signe").length,
        refuse: dv.filter(d => d.statut === "refuse").length,
        caDevis: dv.reduce((a, d) => a + d.total_ttc, 0),
        caSignes: dv.filter(d => d.statut === "signe").reduce((a, d) => a + d.total_ttc, 0),
      });

      const fa = facsAll ?? [];
      setPaiementStats({
        nbPayees: fa.filter(f => f.statut === "payee").length,
        nbImpayees: fa.filter(f => f.statut === "impayee").length,
        nbRelance: fa.filter(f => f.statut === "relance").length,
        montantPayee: fa.filter(f => f.statut === "payee").reduce((a, f) => a + f.total_ttc, 0),
        montantImpayee: fa.filter(f => f.statut === "impayee").reduce((a, f) => a + f.total_ttc, 0),
        montantRelance: fa.filter(f => f.statut === "relance").reduce((a, f) => a + f.total_ttc, 0),
      });

      const clMap: Record<string, { nom: string; prenom?: string; ca: number; nb: number }> = {};
      (topCls ?? []).forEach((f: any) => {
        if (!f.client_id) return;
        if (!clMap[f.client_id]) clMap[f.client_id] = { nom: f.client?.nom ?? "—", prenom: f.client?.prenom, ca: 0, nb: 0 };
        clMap[f.client_id].ca += f.total_ttc;
        clMap[f.client_id].nb++;
      });
      setTopClients(Object.values(clMap).sort((a, b) => b.ca - a.ca).slice(0, 5));

      setDevisEnAttente(devisAttente ?? []);
      setFacturesImpayees(facsImp ?? []);

      // ── Rentabilité achat-revente par facture payée ──
      // Basé sur l'argent réellement encaissé (statut payee), pas sur les devis signés.
      // Le coût d'achat est récupéré via le devis d'origine (facture.devis_id -> devis_lignes),
      // car facture_lignes ne porte pas de prestation_id.
      const { data: facsRentabBase } = await supabase
        .from("factures")
        .select("id,numero,paye_le,total_materiau,devis_id,client:clients(nom,prenom)")
        .eq("statut", "payee")
        .gte("paye_le", debut)
        .lte("paye_le", fin)
        .gt("total_materiau", 0);

      const devisIds = Array.from(new Set((facsRentabBase ?? []).map((f: any) => f.devis_id).filter(Boolean)));
      const coutParDevis: Record<string, number> = {};
      if (devisIds.length > 0) {
        const { data: lignesAchat } = await supabase
          .from("devis_lignes")
          .select("devis_id,quantite,type_branche,prestation:prestations(prix_achat)")
          .in("devis_id", devisIds)
          .eq("type_branche", "materiau");
        (lignesAchat ?? []).forEach((l: any) => {
          coutParDevis[l.devis_id] = (coutParDevis[l.devis_id] ?? 0) + (l.quantite ?? 0) * (l.prestation?.prix_achat ?? 0);
        });
      }

      const rentab: DevisRentabilite[] = (facsRentabBase ?? []).map((f: any) => ({
        id: f.id,
        numero: f.numero,
        date_emission: f.paye_le,
        client_nom: f.client ? `${f.client.prenom ?? ""} ${f.client.nom}`.trim() : "—",
        total_materiau: f.total_materiau ?? 0,
        cout_achat: f.devis_id ? (coutParDevis[f.devis_id] ?? 0) : 0,
        sans_devis: !f.devis_id,
      }));
      setDevisRentabilite(rentab.sort((a, b) => new Date(b.date_emission).getTime() - new Date(a.date_emission).getTime()));

      const aps = apporteurs ?? [];
      const pals = (paliersAp ?? []).sort((a: any, b: any) => a.seuil_min - b.seuil_min);
      const facsMoisData = facsMois ?? [];
      const caParAp: Record<string, number> = {};
      facsMoisData.forEach((f: any) => {
        if (!f.apporteur_id) return;
        caParAp[f.apporteur_id] = (caParAp[f.apporteur_id] ?? 0) + f.total_ttc;
      });
      const commissions: CommissionApporteur[] = [];
      let totalComm = 0;
      aps.forEach((ap: any) => {
        const ca = caParAp[ap.id] ?? 0;
        if (ca === 0) return;
        const palier = [...pals].reverse().find((p: any) => ca >= p.seuil_min) as any ?? null;
        const pct = palier?.commission_pct ?? 0;
        const comm = Math.round(ca * pct / 100 * 100) / 100;
        totalComm += comm;
        commissions.push({ id: ap.id, nom: ap.nom, entreprise: ap.entreprise, caMois: ca, commissionPct: pct, commissionEur: comm });
      });
      setCommissionsApporteurs(commissions.sort((a, b) => b.commissionEur - a.commissionEur));
      setTotalCommissions(totalComm);
      setLoading(false);
    }
    load();
  }, [annee, moisCommission]);

  // ── Export comptable CSV ──
  async function exportComptable() {
    const moisStr = String(moisExport).padStart(2, "0");
    const debutMois = `${anneeExport}-${moisStr}-01`;
    const finMois = new Date(anneeExport, moisExport, 0).toISOString().split("T")[0];

    const { data: facs } = await supabase
      .from("factures")
      .select("numero, date_emission, objet, total_service, total_materiau, total_ttc, paye_le, client:clients(nom, prenom)")
      .eq("statut", "payee")
      .gte("paye_le", debutMois)
      .lte("paye_le", finMois)
      .order("paye_le");

    if (!facs || facs.length === 0) {
      alert("Aucune facture payée sur cette période.");
      return;
    }

    const headers = ["Numéro", "Client", "Date émission", "Date paiement", "Objet", "CA Service (€)", "CA Matériaux (€)", "Total TTC (€)"];
    const rows = facs.map((f: any) => [
      f.numero,
      f.client ? `${f.client.prenom ?? ""} ${f.client.nom}`.trim() : "",
      f.date_emission,
      f.paye_le ? f.paye_le.split("T")[0] : "",
      f.objet ?? "",
      f.total_service.toFixed(2).replace(".", ","),
      f.total_materiau.toFixed(2).replace(".", ","),
      f.total_ttc.toFixed(2).replace(".", ","),
    ]);

    const totService = facs.reduce((a: number, f: any) => a + f.total_service, 0);
    const totMateriau = facs.reduce((a: number, f: any) => a + f.total_materiau, 0);
    const totTTC = facs.reduce((a: number, f: any) => a + f.total_ttc, 0);
    rows.push(["TOTAL", "", "", "", "", totService.toFixed(2).replace(".", ","), totMateriau.toFixed(2).replace(".", ","), totTTC.toFixed(2).replace(".", ",")]);

    const csv = [
      `Export comptable — ${MOIS_LONG[moisExport - 1]} ${anneeExport}`,
      "",
      headers.join(";"),
      ...rows.map((r: string[]) => r.map((v: string) => `"${String(v).replace(/"/g, '""')}"`).join(";")),
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `export-comptable-${anneeExport}-${moisStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const caTotal = caAnnuel.service + caAnnuel.materiau;
  const caTotalN1 = caAnnuelN1.service + caAnnuelN1.materiau;
  const cotisService  = caAnnuel.service  * tauxFiscaux.cotis_service  / 100;
  const cotisMatriau  = caAnnuel.materiau * tauxFiscaux.cotis_materiau / 100;
  const irService     = caAnnuel.service  * tauxFiscaux.ir_service     / 100;
  const irMateriau    = caAnnuel.materiau * tauxFiscaux.ir_materiau    / 100;
  const totalCotis    = cotisService + cotisMatriau;
  const totalIR       = irService + irMateriau;
  const totalCharges  = totalCotis + totalIR;
  const resultatNet   = caTotal - totalCharges;
  const pctCharges    = caTotal > 0 ? Math.round(totalCharges / caTotal * 100) : 0;
  const pctNet        = caTotal > 0 ? Math.round(resultatNet / caTotal * 100) : 0;
  const pctService  = Math.min(100, Math.round(caAnnuel.service / PLAFOND_SERVICE * 100));
  const pctMateriau = Math.min(100, Math.round(caAnnuel.materiau / PLAFOND_MATERIAU * 100));
  // ── Progression franchise TVA (distincte des plafonds micro) ──
  const pctFranchiseService  = Math.min(100, Math.round(caAnnuel.service  / FRANCHISE_TVA_SERVICE  * 100));
  const pctFranchiseMateriau = Math.min(100, Math.round(caAnnuel.materiau / FRANCHISE_TVA_MATERIAU * 100));
  const franchiseServiceDepassee  = caAnnuel.service  > FRANCHISE_TVA_SERVICE;
  const franchiseMateriauDepassee = caAnnuel.materiau > FRANCHISE_TVA_MATERIAU;
  const maxMois = Math.max(...caMensuel.map(m => m.service + m.materiau), ...caMensuelN1.map(m => m.service + m.materiau), 1);
  const devisDecides = devisStats.envoye + devisStats.signe + devisStats.refuse;
  const txConversion = devisDecides > 0 ? Math.round(devisStats.signe / devisDecides * 100) : 0;
  const evol = caTotalN1 > 0 ? Math.round((caTotal - caTotalN1) / caTotalN1 * 100) : null;

  // ── Cotisations URSSAF dues par mois ──
  const moisActuel = new Date().getMonth() + 1;
  const cotisMensuelles = caMensuel.map(m => {
    const cService  = m.service  * tauxFiscaux.cotis_service  / 100;
    const cMateriau = m.materiau * tauxFiscaux.cotis_materiau / 100;
    return { mois: m.mois, cService, cMateriau, total: cService + cMateriau, ca: m.service + m.materiau };
  });
  const totalCotisAnnee = cotisMensuelles.reduce((a, m) => a + m.total, 0);

  // ── Rentabilité achat-revente par devis, avec agrégats ──
  const rentabCalc = devisRentabilite.map(d => {
    const cotisation = d.total_materiau * tauxFiscaux.cotis_materiau / 100;
    const margeNette = d.total_materiau - cotisation - d.cout_achat;
    return { ...d, cotisation, margeNette };
  });
  const rentabTotaux = rentabCalc.reduce((a, d) => ({
    vente: a.vente + d.total_materiau,
    achat: a.achat + d.cout_achat,
    cotisation: a.cotisation + d.cotisation,
    margeNette: a.margeNette + d.margeNette,
  }), { vente: 0, achat: 0, cotisation: 0, margeNette: 0 });

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="font-display text-3xl text-ink-900">CRM</h1>
            <p className="text-ink-500 text-sm mt-1">Analyse complète de votre activité</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select className="input !w-auto" value={annee} onChange={e => setAnnee(parseInt(e.target.value))}>
              {[2024,2025,2026,2027,2028].map(a => <option key={a}>{a}</option>)}
            </select>
          </div>
        </div>

        {loading ? <div className="text-center py-16 text-ink-400">Chargement…</div> : (
          <div className="space-y-5">

            {/* Export comptable */}
            <div className="card card-inner">
              <div className="flex items-center gap-2 mb-4">
                <Download size={18} className="text-volt-600" />
                <h2 className="font-semibold text-ink-800">Export comptable</h2>
              </div>
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="label">Mois</label>
                  <select className="input !w-auto" value={moisExport} onChange={e => setMoisExport(parseInt(e.target.value))}>
                    {MOIS_LONG.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Année</label>
                  <select className="input !w-auto" value={anneeExport} onChange={e => setAnneeExport(parseInt(e.target.value))}>
                    {[2024,2025,2026,2027,2028].map(a => <option key={a}>{a}</option>)}
                  </select>
                </div>
                <button onClick={exportComptable} className="btn-volt flex items-center gap-2">
                  <Download size={15} /> Exporter CSV
                </button>
              </div>
              <p className="text-xs text-ink-400 mt-3">Toutes les factures payées du mois sélectionné · Format compatible déclaration AE (CA service / CA matériaux séparés) · Encodage UTF-8 BOM</p>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="card card-inner col-span-2 md:col-span-1">
                <p className="text-xs text-ink-400 mb-1">CA total {annee}</p>
                <p className="text-3xl font-bold text-ink-900">{fmt(caTotal)}</p>
                <div className="mt-2 space-y-0.5">
                  <p className="text-xs text-volt-600">Service : {fmt(caAnnuel.service)}</p>
                  <p className="text-xs text-emerald-600">Matériaux : {fmt(caAnnuel.materiau)}</p>
                  {caTotalN1 > 0 && (
                    <p className="text-xs text-ink-400 mt-1">N-1 : {fmt(caTotalN1)}
                      {evol !== null && <span className={cn("ml-1 font-semibold", evol >= 0 ? "text-emerald-600" : "text-red-500")}>{evol >= 0 ? "+" : ""}{evol}%</span>}
                    </p>
                  )}
                </div>
              </div>
              <div className="card card-inner">
                <p className="text-xs text-ink-400 mb-1">Taux conversion devis</p>
                <p className="text-3xl font-bold text-ink-900">{txConversion} %</p>
                <p className="text-xs text-ink-400 mt-1">{devisStats.signe} signé{devisStats.signe > 1 ? "s" : ""} / {devisDecides} envoyé{devisDecides > 1 ? "s" : ""}</p>
              </div>
              <div className="card card-inner">
                <p className="text-xs text-ink-400 mb-1">Factures payées</p>
                <p className="text-3xl font-bold text-emerald-600">{fmt(paiementStats.montantPayee)}</p>
                <p className="text-xs text-ink-400 mt-1">{paiementStats.nbPayees} facture{paiementStats.nbPayees > 1 ? "s" : ""}</p>
              </div>
              <div className="card card-inner">
                <p className="text-xs text-ink-400 mb-1">Impayés</p>
                <p className="text-3xl font-bold text-red-600">{fmt(paiementStats.montantImpayee + paiementStats.montantRelance)}</p>
                <p className="text-xs text-ink-400 mt-1">{paiementStats.nbImpayees + paiementStats.nbRelance} facture{(paiementStats.nbImpayees + paiementStats.nbRelance) > 1 ? "s" : ""}</p>
              </div>
            </div>

            {/* Rentabilité */}
            <div className="card card-inner">
              <div className="flex items-center gap-2 mb-5">
                <Euro size={18} className="text-volt-600" />
                <h2 className="font-semibold text-ink-800">Rentabilité estimée {annee}</h2>
              </div>
              {caTotal === 0 ? (
                <p className="text-ink-400 text-sm text-center py-6">Aucun CA payé sur cette période</p>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-ink-500 mb-1">
                      <span>CA brut</span><span className="font-semibold text-ink-900">{fmt(caTotal)}</span>
                    </div>
                    <div className="h-8 bg-ink-100 rounded-xl overflow-hidden flex">
                      <div className="h-full bg-red-400 flex items-center justify-center text-white text-xs font-semibold transition-all"
                        style={{ width: `${pctCharges}%`, minWidth: pctCharges > 5 ? "auto" : 0 }}>
                        {pctCharges > 8 && `${pctCharges}%`}
                      </div>
                      <div className="h-full bg-emerald-500 flex items-center justify-center text-white text-xs font-semibold transition-all"
                        style={{ width: `${pctNet}%` }}>
                        {pctNet > 8 && `${pctNet}%`}
                      </div>
                    </div>
                    <div className="flex gap-4 flex-wrap">
                      <span className="flex items-center gap-1.5 text-xs text-ink-500"><span className="w-3 h-3 rounded-sm bg-red-400" />Charges ({fmt(totalCharges)})</span>
                      <span className="flex items-center gap-1.5 text-xs text-ink-500"><span className="w-3 h-3 rounded-sm bg-emerald-500" />Résultat net ({fmt(resultatNet)})</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                    <div className="bg-ink-50 rounded-xl p-4">
                      <p className="text-xs text-ink-400 mb-1">CA brut</p>
                      <p className="text-2xl font-bold text-ink-900">{fmt(caTotal)}</p>
                      <div className="mt-2 space-y-0.5">
                        <p className="text-xs text-volt-600">Service : {fmt(caAnnuel.service)}</p>
                        <p className="text-xs text-emerald-600">Matériaux : {fmt(caAnnuel.materiau)}</p>
                      </div>
                    </div>
                    <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                      <p className="text-xs text-red-400 mb-1">Charges estimées</p>
                      <p className="text-2xl font-bold text-red-700">{fmt(totalCharges)}</p>
                      <div className="mt-2 space-y-0.5">
                        {totalCotis > 0 && <p className="text-xs text-red-500">Cotisations : {fmt(totalCotis)}</p>}
                        {totalIR > 0 && <p className="text-xs text-red-500">IR libératoire : {fmt(totalIR)}</p>}
                        <p className="text-xs text-red-400">{pctCharges}% du CA</p>
                      </div>
                    </div>
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                      <p className="text-xs text-emerald-500 mb-1">Résultat net estimé</p>
                      <p className="text-2xl font-bold text-emerald-700">{fmt(resultatNet)}</p>
                      <div className="mt-2 space-y-0.5">
                        <p className="text-xs text-emerald-500">{pctNet}% du CA</p>
                        <p className="text-xs text-emerald-400">≈ {fmt(resultatNet / 12)}/mois</p>
                      </div>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-ink-100">
                    <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-3">Détail par branche</p>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="p-3 rounded-xl bg-volt-50 border border-volt-100">
                        <p className="text-xs font-semibold text-volt-700 mb-2">⚡ Service</p>
                        <div className="space-y-1 text-xs text-ink-600">
                          <div className="flex justify-between"><span>CA</span><span className="font-semibold">{fmt(caAnnuel.service)}</span></div>
                          <div className="flex justify-between text-red-500"><span>Cotisations ({tauxFiscaux.cotis_service}%)</span><span>− {fmt(cotisService)}</span></div>
                          {irService > 0 && <div className="flex justify-between text-red-500"><span>IR ({tauxFiscaux.ir_service}%)</span><span>− {fmt(irService)}</span></div>}
                          <div className="flex justify-between font-semibold text-emerald-600 pt-1 border-t border-volt-200"><span>Net</span><span>{fmt(caAnnuel.service - cotisService - irService)}</span></div>
                        </div>
                      </div>
                      <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                        <p className="text-xs font-semibold text-emerald-700 mb-2">📦 Matériaux</p>
                        <div className="space-y-1 text-xs text-ink-600">
                          <div className="flex justify-between"><span>CA</span><span className="font-semibold">{fmt(caAnnuel.materiau)}</span></div>
                          <div className="flex justify-between text-red-500"><span>Cotisations ({tauxFiscaux.cotis_materiau}%)</span><span>− {fmt(cotisMatriau)}</span></div>
                          {irMateriau > 0 && <div className="flex justify-between text-red-500"><span>IR ({tauxFiscaux.ir_materiau}%)</span><span>− {fmt(irMateriau)}</span></div>}
                          <div className="flex justify-between font-semibold text-emerald-600 pt-1 border-t border-emerald-200"><span>Net</span><span>{fmt(caAnnuel.materiau - cotisMatriau - irMateriau)}</span></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Rentabilité nette achat-revente par devis */}
            <div className="card card-inner">
              <div className="flex items-center gap-2 mb-4">
                <ShoppingBag size={18} className="text-volt-600" />
                <h2 className="font-semibold text-ink-800">Rentabilité matériel — factures payées {annee}</h2>
              </div>
              <p className="text-xs text-ink-400 mb-4">
                Frais d'achat matériel réellement engagés vs argent réellement encaissé, après cotisations sociales de la branche achat-revente ({tauxFiscaux.cotis_materiau}%).
                Coût d'achat basé sur le prix catalogue actuel des lignes du devis d'origine — peut différer légèrement du coût réel si vos tarifs fournisseurs ont changé depuis.
              </p>
              {rentabCalc.length === 0 ? (
                <p className="text-ink-400 text-sm text-center py-6">Aucune facture payée avec CA matériaux sur cette période</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div className="bg-ink-50 rounded-xl p-3">
                      <p className="text-xs text-ink-400 mb-0.5">Vente matériel</p>
                      <p className="text-lg font-bold text-ink-900">{fmt(rentabTotaux.vente)}</p>
                    </div>
                    <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                      <p className="text-xs text-red-400 mb-0.5">Achat matériel</p>
                      <p className="text-lg font-bold text-red-700">− {fmt(rentabTotaux.achat)}</p>
                    </div>
                    <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                      <p className="text-xs text-red-400 mb-0.5">Cotisations ({tauxFiscaux.cotis_materiau}%)</p>
                      <p className="text-lg font-bold text-red-700">− {fmt(rentabTotaux.cotisation)}</p>
                    </div>
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                      <p className="text-xs text-emerald-500 mb-0.5">Marge nette réelle</p>
                      <p className="text-lg font-bold text-emerald-700">{fmt(rentabTotaux.margeNette)}</p>
                    </div>
                  </div>
                  <div className="space-y-1.5 max-h-80 overflow-y-auto">
                    {rentabCalc.map(d => (
                      <div key={d.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-ink-50">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-ink-900 truncate">{d.numero} · {d.client_nom}</p>
                          <p className="text-xs text-ink-400">{fmtDate(d.date_emission)} · Vente {fmt(d.total_materiau)} · Achat {fmt(d.cout_achat)} · Cotis. {fmt(d.cotisation)}</p>
                          {d.sans_devis && <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5"><AlertTriangle size={11} /> Facture sans devis lié — coût d'achat indisponible, marge surestimée</p>}
                        </div>
                        <span className={cn("text-sm font-bold shrink-0", d.margeNette >= 0 ? "text-emerald-600" : "text-red-600")}>
                          {fmt(d.margeNette)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Commissions apporteurs */}
            <div className="card card-inner">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Users size={18} className="text-volt-600" />
                  <h2 className="font-semibold text-ink-800">Commissions apporteurs</h2>
                </div>
                <select className="input !w-auto text-sm" value={moisCommission} onChange={e => setMoisCommission(parseInt(e.target.value))}>
                  {MOIS_LONG.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                </select>
              </div>
              {commissionsApporteurs.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-ink-400 text-sm">Aucune commission pour {MOIS_LONG[moisCommission - 1]} {annee}</p>
                  <p className="text-xs text-ink-300 mt-1">Les commissions apparaissent dès qu'une facture avec apporteur est marquée payée</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {commissionsApporteurs.map(ap => (
                    <div key={ap.id} className="flex items-center gap-3 p-3 rounded-xl bg-ink-50 border border-ink-100">
                      <div className="w-9 h-9 rounded-full bg-ink-900 flex items-center justify-center text-volt-400 text-sm font-bold shrink-0">
                        {ap.nom.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-ink-900">{ap.nom}</p>
                        <p className="text-xs text-ink-400">{ap.entreprise ?? ""} · CA apporté : {fmt(ap.caMois)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-amber-600">{fmt(ap.commissionEur)}</p>
                        <p className="text-xs text-ink-400">{ap.commissionPct}% du CA</p>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-3 border-t border-ink-200">
                    <p className="text-sm font-semibold text-ink-700">Total commissions {MOIS_LONG[moisCommission - 1]}</p>
                    <p className="text-lg font-bold text-amber-600">{fmt(totalCommissions)}</p>
                  </div>
                  <div className="mt-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
                    <p className="text-xs font-semibold text-amber-700 mb-2">Impact sur la rentabilité mensuelle estimée</p>
                    <div className="space-y-1 text-xs text-ink-600">
                      <div className="flex justify-between"><span>Résultat net annuel estimé</span><span className="font-semibold">{fmt(resultatNet)}</span></div>
                      <div className="flex justify-between text-amber-600"><span>Commissions {MOIS_LONG[moisCommission - 1]}</span><span>− {fmt(totalCommissions)}</span></div>
                      <div className="flex justify-between font-semibold text-emerald-700 pt-1 border-t border-amber-200"><span>Résultat net après commissions</span><span>{fmt(resultatNet - totalCommissions)}</span></div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Cotisations URSSAF dues par mois */}
            <div className="card card-inner">
              <div className="flex items-center gap-2 mb-4">
                <Landmark size={17} className="text-volt-600" />
                <h2 className="font-semibold text-ink-800">Cotisations URSSAF dues par mois {annee}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-ink-400 uppercase tracking-wide border-b border-ink-100">
                      <th className="text-left py-2 pr-2">Mois</th>
                      <th className="text-right py-2 px-2">CA encaissé</th>
                      <th className="text-right py-2 px-2">Cotis. service ({tauxFiscaux.cotis_service}%)</th>
                      <th className="text-right py-2 px-2">Cotis. matériaux ({tauxFiscaux.cotis_materiau}%)</th>
                      <th className="text-right py-2 pl-2">Total dû</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cotisMensuelles.map(m => (
                      <tr key={m.mois} className={cn("border-b border-ink-50", m.mois === moisActuel && annee === new Date().getFullYear() ? "bg-volt-50" : "")}>
                        <td className="py-2 pr-2 font-medium text-ink-700">{MOIS_LONG[m.mois - 1]}</td>
                        <td className="text-right py-2 px-2 text-ink-500">{m.ca > 0 ? fmt(m.ca) : "—"}</td>
                        <td className="text-right py-2 px-2 text-ink-600">{m.cService > 0 ? fmt(m.cService) : "—"}</td>
                        <td className="text-right py-2 px-2 text-ink-600">{m.cMateriau > 0 ? fmt(m.cMateriau) : "—"}</td>
                        <td className="text-right py-2 pl-2 font-semibold text-red-600">{m.total > 0 ? fmt(m.total) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-ink-200">
                      <td className="py-2 pr-2 font-bold text-ink-900">Total {annee}</td>
                      <td className="text-right py-2 px-2 font-semibold text-ink-700">{fmt(caTotal)}</td>
                      <td className="text-right py-2 px-2 font-semibold text-ink-700">{fmt(cotisService)}</td>
                      <td className="text-right py-2 px-2 font-semibold text-ink-700">{fmt(cotisMatriau)}</td>
                      <td className="text-right py-2 pl-2 font-bold text-red-700">{fmt(totalCotisAnnee)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-ink-400 mt-3">Calcul basé sur le CA encaissé (factures payées) du mois × taux de cotisation par branche · à titre indicatif, la déclaration URSSAF réelle peut suivre un rythme mensuel ou trimestriel selon votre option</p>
            </div>

            {/* Graphique CA mensuel */}
            <div className="card card-inner">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <BarChart3 size={18} className="text-volt-600" />
                  <h2 className="font-semibold text-ink-800">CA mensuel {annee}</h2>
                </div>
                {caTotalN1 > 0 && <span className="text-xs text-ink-400">vs {annee - 1}</span>}
              </div>
              <div className="flex items-end gap-1 md:gap-2" style={{ height: "120px" }}>
                {caMensuel.map((m, i) => {
                  const n1 = caMensuelN1[i] ?? { mois: m.mois, service: 0, materiau: 0 };
                  return <BarMois key={i} mois={m.mois} service={m.service} materiau={m.materiau} serviceN1={n1.service} materiauN1={n1.materiau} maxMois={maxMois} label={MOIS[i]} />;
                })}
              </div>
              <div className="flex gap-4 mt-3 flex-wrap">
                <span className="flex items-center gap-1.5 text-xs text-ink-500"><span className="w-3 h-3 rounded-sm bg-volt-500" />Service {annee}</span>
                <span className="flex items-center gap-1.5 text-xs text-ink-500"><span className="w-3 h-3 rounded-sm bg-emerald-400" />Matériaux {annee}</span>
                <span className="flex items-center gap-1.5 text-xs text-ink-500"><span className="w-3 h-3 rounded-sm bg-ink-300" />Service {annee - 1}</span>
                <span className="flex items-center gap-1.5 text-xs text-ink-500"><span className="w-3 h-3 rounded-sm bg-ink-200" />Matériaux {annee - 1}</span>
              </div>
            </div>

            {/* Plafonds + Franchise TVA + CA par type */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="card card-inner">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp size={17} className="text-volt-600" />
                  <h2 className="font-semibold text-ink-800">Plafonds AE {annee}</h2>
                </div>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-ink-600">Service <span className="text-ink-400 text-xs">/ {fmt(PLAFOND_SERVICE)}</span></span>
                      <span className="font-semibold text-volt-600">{fmt(caAnnuel.service)} ({pctService} %)</span>
                    </div>
                    <div className="h-3 bg-ink-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${pctService > 80 ? "bg-red-500" : "bg-volt-500"}`} style={{ width: `${pctService}%` }} />
                    </div>
                    {pctService > 80 && <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertTriangle size={11} /> Proche du plafond service</p>}
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-ink-600">Achat/revente <span className="text-ink-400 text-xs">/ {fmt(PLAFOND_MATERIAU)}</span></span>
                      <span className="font-semibold text-emerald-600">{fmt(caAnnuel.materiau)} ({pctMateriau} %)</span>
                    </div>
                    <div className="h-3 bg-ink-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${pctMateriau > 80 ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${pctMateriau}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="card card-inner">
                <div className="flex items-center gap-2 mb-4">
                  <Landmark size={17} className="text-volt-600" />
                  <h2 className="font-semibold text-ink-800">Franchise TVA {annee}</h2>
                </div>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-ink-600">Service <span className="text-ink-400 text-xs">/ {fmt(FRANCHISE_TVA_SERVICE)}</span></span>
                      <span className="font-semibold text-volt-600">{fmt(caAnnuel.service)} ({pctFranchiseService} %)</span>
                    </div>
                    <div className="h-3 bg-ink-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${pctFranchiseService >= 100 ? "bg-red-500" : pctFranchiseService > 80 ? "bg-amber-500" : "bg-volt-500"}`} style={{ width: `${pctFranchiseService}%` }} />
                    </div>
                    {franchiseServiceDepassee && <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertTriangle size={11} /> Franchise TVA dépassée — TVA applicable sur la branche service</p>}
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-ink-600">Achat/revente <span className="text-ink-400 text-xs">/ {fmt(FRANCHISE_TVA_MATERIAU)}</span></span>
                      <span className="font-semibold text-emerald-600">{fmt(caAnnuel.materiau)} ({pctFranchiseMateriau} %)</span>
                    </div>
                    <div className="h-3 bg-ink-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${pctFranchiseMateriau >= 100 ? "bg-red-500" : pctFranchiseMateriau > 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pctFranchiseMateriau}%` }} />
                    </div>
                    {franchiseMateriauDepassee && <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertTriangle size={11} /> Franchise TVA dépassée — TVA applicable sur la branche achat-revente</p>}
                  </div>
                  <p className="text-xs text-ink-400 pt-1 border-t border-ink-100">Seuils distincts du plafond micro : dépasser la franchise TVA vous rend redevable de la TVA, sans vous faire sortir du régime auto-entrepreneur.</p>
                </div>
              </div>

              <div className="card card-inner md:col-span-2">
                <div className="flex items-center gap-2 mb-4">
                  <PieChart size={17} className="text-volt-600" />
                  <h2 className="font-semibold text-ink-800">CA par branche</h2>
                </div>
                {catStats.length === 0 ? (
                  <p className="text-ink-400 text-sm text-center py-6">Aucune facture payée sur cette période</p>
                ) : catStats.map(c => (
                  <div key={c.type_branche} className="mb-3">
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="font-medium text-ink-800">{c.categorie}</span>
                      <span className="font-semibold text-ink-900">{fmt(c.total)} <span className="text-ink-400 text-xs">({c.nb} lignes)</span></span>
                    </div>
                    <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${c.type_branche === "service" ? "bg-volt-500" : "bg-emerald-500"}`}
                        style={{ width: `${Math.round(c.total / caTotal * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Suivi devis */}
            <div className="card card-inner">
              <div className="flex items-center gap-2 mb-4">
                <FileText size={17} className="text-volt-600" />
                <h2 className="font-semibold text-ink-800">Suivi des devis {annee}</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
                {[
                  { label: "Total", val: devisStats.total, color: "text-ink-900" },
                  { label: "Brouillons", val: devisStats.brouillon, color: "text-ink-500" },
                  { label: "Envoyés", val: devisStats.envoye, color: "text-volt-600" },
                  { label: "Signés", val: devisStats.signe, color: "text-emerald-600" },
                  { label: "Refusés", val: devisStats.refuse, color: "text-red-600" },
                ].map(s => (
                  <div key={s.label} className="text-center bg-ink-50 rounded-xl py-3">
                    <p className={`text-2xl font-bold ${s.color}`}>{s.val}</p>
                    <p className="text-xs text-ink-400 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <div><p className="text-xs text-ink-400 mb-0.5">CA total devis</p><p className="font-bold text-ink-800">{fmt(devisStats.caDevis)}</p></div>
                <div><p className="text-xs text-ink-400 mb-0.5">CA devis signés</p><p className="font-bold text-emerald-600">{fmt(devisStats.caSignes)}</p></div>
                <div><p className="text-xs text-ink-400 mb-0.5">Taux conversion</p><p className="font-bold text-volt-600">{txConversion} %</p></div>
              </div>
              {devisEnAttente.length > 0 && (
                <div className="mt-5 pt-4 border-t border-ink-100">
                  <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-3">En attente de signature</p>
                  <div className="space-y-2">
                    {devisEnAttente.map((d: any) => (
                      <Link key={d.id} href={`/devis/${d.id}`} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-ink-50 transition-colors">
                        <span className={cn("badge", STATUT_COLORS[d.statut])}>{STATUT_LABELS[d.statut]}</span>
                        <span className="text-sm font-medium text-ink-900">{d.numero}</span>
                        <span className="text-xs text-ink-400 flex-1 truncate">{(d.client as any)?.nom ?? "Sans client"}{d.objet ? ` — ${d.objet}` : ""}</span>
                        <span className="text-sm font-semibold text-volt-600 shrink-0">{fmt(d.total_ttc)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Suivi paiements */}
            <div className="card card-inner">
              <div className="flex items-center gap-2 mb-4">
                <Receipt size={17} className="text-volt-600" />
                <h2 className="font-semibold text-ink-800">Suivi des paiements {annee}</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2"><CheckCircle size={16} className="text-emerald-600" /><span className="text-xs font-semibold text-emerald-600 uppercase">Payées</span></div>
                  <p className="text-2xl font-bold text-emerald-700">{fmt(paiementStats.montantPayee)}</p>
                  <p className="text-xs text-emerald-500 mt-0.5">{paiementStats.nbPayees} facture{paiementStats.nbPayees > 1 ? "s" : ""}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2"><Clock size={16} className="text-amber-600" /><span className="text-xs font-semibold text-amber-600 uppercase">Relancées</span></div>
                  <p className="text-2xl font-bold text-amber-700">{fmt(paiementStats.montantRelance)}</p>
                  <p className="text-xs text-amber-500 mt-0.5">{paiementStats.nbRelance} facture{paiementStats.nbRelance > 1 ? "s" : ""}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2"><AlertTriangle size={16} className="text-red-600" /><span className="text-xs font-semibold text-red-600 uppercase">Impayées</span></div>
                  <p className="text-2xl font-bold text-red-700">{fmt(paiementStats.montantImpayee)}</p>
                  <p className="text-xs text-red-500 mt-0.5">{paiementStats.nbImpayees} facture{paiementStats.nbImpayees > 1 ? "s" : ""}</p>
                </div>
              </div>
              {facturesImpayees.length > 0 && (
                <div className="pt-4 border-t border-ink-100">
                  <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-3">À encaisser en priorité</p>
                  <div className="space-y-2">
                    {facturesImpayees.map((f: any) => (
                      <Link key={f.id} href={`/factures/${f.id}`} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-ink-50 transition-colors">
                        <span className={cn("badge", STATUT_COLORS[f.statut])}>{STATUT_LABELS[f.statut]}</span>
                        <span className="text-sm font-medium text-ink-900">{f.numero}</span>
                        <span className="text-xs text-ink-400 flex-1 truncate">{(f.client as any)?.nom ?? "Sans client"}{f.date_echeance ? ` · Éch. ${fmtDate(f.date_echeance)}` : ""}</span>
                        <span className="text-sm font-bold text-red-600 shrink-0">{fmt(f.total_ttc)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Top clients */}
            {topClients.length > 0 && (
              <div className="card card-inner">
                <h2 className="font-semibold text-ink-800 mb-4">Top clients {annee}</h2>
                <div className="space-y-2">
                  {topClients.map((c, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-ink-900 flex items-center justify-center text-volt-400 text-xs font-bold shrink-0">{i + 1}</div>
                      <span className="flex-1 text-sm font-medium text-ink-800">{c.prenom ? `${c.prenom} ${c.nom}` : c.nom}</span>
                      <span className="text-xs text-ink-400">{c.nb} facture{c.nb > 1 ? "s" : ""}</span>
                      <span className="text-sm font-bold text-volt-600">{fmt(c.ca)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </Shell>
  );
}
