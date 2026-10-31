"use client";
// Livre des recettes : export CSV des factures encaissées (mois, trimestre ou année) + récapitulatif mensuel pour l'URSSAF.
import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import Shell from "@/components/layout/Shell";
import { supabase } from "@/lib/supabase";
import { fmt } from "@/lib/utils";
import {
  bornesPeriode, construireLivre, genererCsv, libellePeriode, MOIS, nomFichier, recapMensuel, totaux, type FactureExport, type Periode,
} from "@/lib/export-comptable";

type Mode = "mois" | "trimestre" | "annee";

export default function ExportComptablePage() {
  const now = new Date();
  const [mode, setMode] = useState<Mode>("mois");
  const [annee, setAnnee] = useState(now.getFullYear());
  const [mois, setMois] = useState(now.getMonth() + 1);
  const [trimestre, setTrimestre] = useState<1 | 2 | 3 | 4>(Math.ceil((now.getMonth() + 1) / 3) as 1 | 2 | 3 | 4);
  const [factures, setFactures] = useState<FactureExport[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const periode: Periode = useMemo(
    () => mode === "annee" ? { type: "annee", annee } : mode === "trimestre" ? { type: "trimestre", annee, trimestre } : { type: "mois", annee, mois },
    [mode, annee, mois, trimestre],
  );

  useEffect(() => {
    let annule = false;
    setFactures(null); setErreur(null);
    const { debut, fin } = bornesPeriode(periode);
    supabase.from("factures")
      .select("numero, objet, paye_le, total_service, total_materiau, total_ttc, client:clients(nom, prenom)")
      .eq("statut", "payee").gte("paye_le", debut).lt("paye_le", fin).order("paye_le")
      .then(({ data, error }) => {
        if (annule) return;
        if (error) { setErreur(error.message); setFactures([]); return; }
        setFactures((data ?? []) as unknown as FactureExport[]);
      });
    return () => { annule = true; };
  }, [periode]);

  const lignes = useMemo(() => construireLivre(factures ?? []), [factures]);
  const recap = useMemo(() => recapMensuel(lignes), [lignes]);
  const t = useMemo(() => totaux(lignes), [lignes]);

  const telecharger = () => {
    const blob = new Blob(["﻿" + genererCsv(lignes, periode)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = nomFichier(periode);
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const annees = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i);

  return (
    <Shell>
      <div className="max-w-3xl mx-auto p-4 md:p-8">
        <h1 className="font-display text-3xl text-ink-900 flex items-center gap-2"><FileSpreadsheet size={26} /> Livre des recettes</h1>
        <p className="text-ink-500 text-sm mt-1">Export CSV des factures encaissées, avec le récapitulatif mensuel services / marchandises pour ta déclaration.</p>

        <div className="card card-inner mt-5 flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="ec-mode">Période</label>
            <select id="ec-mode" className="input" value={mode} onChange={e => setMode(e.target.value as Mode)}>
              <option value="mois">Mois</option><option value="trimestre">Trimestre</option><option value="annee">Année</option>
            </select></div>
          {mode === "mois" && <div><label className="label" htmlFor="ec-mois">Mois</label>
            <select id="ec-mois" className="input" value={mois} onChange={e => setMois(Number(e.target.value))}>
              {MOIS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select></div>}
          {mode === "trimestre" && <div><label className="label" htmlFor="ec-tri">Trimestre</label>
            <select id="ec-tri" className="input" value={trimestre} onChange={e => setTrimestre(Number(e.target.value) as 1 | 2 | 3 | 4)}>
              {[1, 2, 3, 4].map(n => <option key={n} value={n}>T{n}</option>)}
            </select></div>}
          <div><label className="label" htmlFor="ec-an">Année</label>
            <select id="ec-an" className="input" value={annee} onChange={e => setAnnee(Number(e.target.value))}>
              {annees.map(a => <option key={a} value={a}>{a}</option>)}
            </select></div>
          <button type="button" className="btn-volt" onClick={telecharger} disabled={factures === null || lignes.length === 0}><Download size={14} /> Télécharger le CSV</button>
        </div>

        {erreur && <div className="card card-inner border-red-300 bg-red-50 mt-4 text-sm text-red-800" role="alert">Chargement impossible : {erreur}</div>}

        <div className="card card-inner mt-4">
          <h2 className="font-semibold text-ink-900">{libellePeriode(periode)}</h2>
          {factures === null ? <p className="text-sm text-ink-400 mt-2">Chargement…</p>
            : lignes.length === 0 ? <p className="text-sm text-ink-500 mt-2">Aucune facture encaissée sur cette période.</p>
            : <>
              <p className="text-sm text-ink-600 mt-1">{t.nb} facture{t.nb > 1 ? "s" : ""} · Services <b>{fmt(t.service)}</b> · Marchandises <b>{fmt(t.materiau)}</b> · Total <b>{fmt(t.total)}</b></p>
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-ink-500"><th className="py-1 pr-3">Mois</th><th className="pr-3">Factures</th><th className="pr-3 text-right">Services</th><th className="pr-3 text-right">Marchandises</th><th className="text-right">Total</th></tr></thead>
                  <tbody>{recap.map(r => (
                    <tr key={r.cle} className="border-t border-ink-100">
                      <td className="py-1.5 pr-3">{MOIS[Number(r.cle.slice(5)) - 1]} {r.cle.slice(0, 4)}</td><td className="pr-3">{r.nb}</td>
                      <td className="pr-3 text-right">{fmt(r.service)}</td><td className="pr-3 text-right">{fmt(r.materiau)}</td><td className="text-right font-semibold">{fmt(r.total)}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            </>}
          <p className="text-[11px] text-ink-400 mt-3">Seules les factures au statut « payée » comptent, à leur date de paiement. Une remise est répartie au prorata entre services et marchandises. Le mode de règlement n&apos;étant pas enregistré, sa colonne est laissée vide.</p>
        </div>
      </div>
    </Shell>
  );
}
