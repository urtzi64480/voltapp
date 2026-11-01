"use client";
// Sauvegarde complète en un clic : télécharge un fichier JSON avec toutes les données.
import { useState } from "react";
import { ecrireStockage } from "@/lib/safe-storage";
import { CLE_DERNIERE_SAUVEGARDE, lireSauvegarde, restaurer, type RapportRestauration } from "@/lib/restauration";
import { DatabaseBackup, Download, Upload } from "lucide-react";
import Shell from "@/components/layout/Shell";
import { supabase } from "@/lib/supabase";
import { collecter, nomFichierSauvegarde, type FichierSauvegarde } from "@/lib/sauvegarde";

export default function SauvegardePage() {
  const [occupe, setOccupe] = useState(false);
  const [rapport, setRapport] = useState<FichierSauvegarde | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const [aRestaurer, setARestaurer] = useState<FichierSauvegarde | null>(null);
  const [restauration, setRestauration] = useState<RapportRestauration | null>(null);
  const [restOccupe, setRestOccupe] = useState(false);

  async function telecharger(prefixe = "") {
    const f = await collecter((table, de, a) => supabase.from(table).select("*").range(de, a));
    const blob = new Blob([JSON.stringify(f, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a"); el.href = url; el.download = prefixe + nomFichierSauvegarde(); document.body.appendChild(el); el.click(); el.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    return f;
  }

  async function choisirFichier(fichier: File | undefined) {
    setErreur(null); setRestauration(null); setARestaurer(null);
    if (!fichier) return;
    if (fichier.size > 100e6) { setErreur("Fichier trop volumineux pour une sauvegarde VoltApp."); return; }
    const lu = lireSauvegarde(await fichier.text());
    if (!lu.ok) { setErreur(lu.message); return; }
    setARestaurer(lu.fichier);
  }

  async function lancerRestauration() {
    if (!aRestaurer) return;
    const total = Object.values(aRestaurer.comptes).reduce((a, n) => a + n, 0);
    if (!window.confirm(`Restaurer ${total} enregistrements ? Les données du fichier remplacent celles qui ont le même identifiant ; rien n'est supprimé. Une sauvegarde de l'état actuel est téléchargée d'abord.`)) return;
    setRestOccupe(true); setErreur(null); setRestauration(null);
    try {
      await telecharger("avant-restauration-");
      setRestauration(await restaurer(aRestaurer, (table, lignes) => supabase.from(table).upsert(lignes as never)));
    } catch (e) { setErreur(e instanceof Error ? e.message : "Restauration impossible"); } finally { setRestOccupe(false); }
  }

  async function sauvegarder() {
    setOccupe(true); setErreur(null); setRapport(null);
    try {
      const f = await telecharger();
      ecrireStockage("local", CLE_DERNIERE_SAUVEGARDE, new Date().toISOString());
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
        <div className="card card-inner">
          <h2 className="font-semibold text-ink-800 mb-1 flex items-center gap-2"><Upload size={16} /> Restaurer depuis un fichier</h2>
          <p className="text-xs text-ink-500 mb-3">Les données du fichier sont réécrites par identifiant : rien n&apos;est supprimé, et tes compteurs de numérotation (devis, factures) ne reculent jamais. Une sauvegarde de l&apos;état actuel est téléchargée juste avant.</p>
          <input type="file" accept="application/json,.json" className="text-sm" disabled={restOccupe} onChange={e => { void choisirFichier(e.target.files?.[0]); e.target.value = ""; }} />
          {aRestaurer && (
            <div className="mt-3 text-sm">
              <p className="text-ink-700">Sauvegarde du {aRestaurer.genere_le ? new Date(aRestaurer.genere_le).toLocaleString("fr-FR") : "date inconnue"} : {Object.values(aRestaurer.comptes).reduce((a, n) => a + n, 0)} enregistrements.</p>
              <ul className="mt-1 grid grid-cols-2 gap-x-4 text-xs text-ink-500">{Object.entries(aRestaurer.comptes).map(([t, n]) => <li key={t} className="flex justify-between"><span>{t}</span><span>{n}</span></li>)}</ul>
              <button type="button" className="btn-volt mt-3" disabled={restOccupe} onClick={() => void lancerRestauration()}>{restOccupe ? "Restauration en cours…" : "Restaurer ces données"}</button>
            </div>
          )}
          {restauration && (
            <div className="mt-3 text-sm" role="status">
              <p className="font-semibold text-emerald-700">Restauration terminée : {Object.values(restauration.restaurees).reduce((a, n) => a + n, 0)} enregistrements écrits.</p>
              {Object.keys(restauration.erreurs).length > 0 && (
                <p className="text-xs text-amber-700 mt-1">Tables en erreur : {Object.entries(restauration.erreurs).map(([t, m]) => `${t} (${m})`).join(" ; ")}.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
