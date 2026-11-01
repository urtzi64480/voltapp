"use client";
// Sauvegarde complète en un clic : télécharge un fichier JSON avec toutes les données.
import { useState } from "react";
import { DatabaseBackup, Download } from "lucide-react";
import Shell from "@/components/layout/Shell";
import { supabase } from "@/lib/supabase";
import { collecter, nomFichierSauvegarde, type FichierSauvegarde } from "@/lib/sauvegarde";

export default function SauvegardePage() {
  const [occupe, setOccupe] = useState(false);
  const [rapport, setRapport] = useState<FichierSauvegarde | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function sauvegarder() {
    setOccupe(true); setErreur(null); setRapport(null);
    try {
      const f = await collecter((table, de, a) => supabase.from(table).select("*").range(de, a));
      const blob = new Blob([JSON.stringify(f, null, 1)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const el = document.createElement("a"); el.href = url; el.download = nomFichierSauvegarde(); document.body.appendChild(el); el.click(); el.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      setRapport(f);
    } catch (e) { setErreur(e instanceof Error ? e.message : "Sauvegarde impossible"); } finally { setOccupe(false); }
  }

  const nbErreurs = rapport ? Object.keys(rapport.erreurs).length : 0;
  return (
    <Shell>
      <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-4">
        <div>
          <h1 className="font-display text-3xl text-ink-900 flex items-center gap-2"><DatabaseBackup size={26} /> Sauvegarde</h1>
          <p className="text-ink-500 text-sm mt-1">Télécharge toutes tes données (clients, devis, factures, plans, planning, catalogue…) dans un seul fichier. À garder sur ton ordinateur ou ton cloud personnel.</p>
        </div>
        <div className="card card-inner">
          <button type="button" className="btn-volt" disabled={occupe} onClick={() => void sauvegarder()}><Download size={14} /> {occupe ? "Sauvegarde en cours…" : "Télécharger la sauvegarde"}</button>
          {erreur && <p className="text-sm text-red-700 mt-3" role="alert">{erreur}</p>}
          {rapport && (
            <div className="mt-4 text-sm text-ink-700" role="status">
              <p className="font-semibold text-emerald-700">Sauvegarde téléchargée ({Object.values(rapport.comptes).reduce((a, n) => a + n, 0)} enregistrements).</p>
              <ul className="mt-2 grid grid-cols-2 gap-x-4 text-xs text-ink-500">
                {Object.entries(rapport.comptes).map(([t, n]) => <li key={t} className="flex justify-between"><span>{t}</span><span>{n}</span></li>)}
              </ul>
              {nbErreurs > 0 && <p className="text-xs text-amber-700 mt-2">Non lues : {Object.entries(rapport.erreurs).map(([t, m]) => `${t} (${m})`).join(" ; ")}.</p>}
            </div>
          )}
          <p className="text-[11px] text-ink-400 mt-4">Les photos et PDF (logo, réalisations, documents) restent dans le stockage et ne sont pas inclus : le fichier contient leurs adresses. Le mot de passe d&apos;application Apple n&apos;est pas exporté.</p>
        </div>
      </div>
    </Shell>
  );
}
