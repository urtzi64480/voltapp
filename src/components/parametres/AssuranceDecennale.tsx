"use client";
// Paramètres → assurance décennale : mentions des devis / factures, dates de validité et dépôt de l'attestation (jointe à chaque dossier de fin de chantier).
// Les champs texte et les dates passent par le bouton « Enregistrer » du profil ; le fichier est envoyé et enregistré tout de suite.
import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle, ExternalLink, FileText, ShieldCheck, Trash2, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { alerteAssurance, etatAssurance, mentionDecennale, type InfosAssurance } from "@/lib/assurance";
import { typeDepuisOctets } from "@/lib/attestation-pdf";

export const BUCKET_DOCUMENTS_PRO = "documents-pro";
const TAILLE_MAX = 8 * 1024 * 1024;

export default function AssuranceDecennale({ profil, set }: { profil: InfosAssurance; set: (k: string, v: unknown) => void }) {
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");
  const entree = useRef<HTMLInputElement>(null);
  const v = (k: keyof InfosAssurance) => String(profil[k] ?? "");
  const etat = etatAssurance(profil).etat;
  const alerte = alerteAssurance(profil);
  const mention = mentionDecennale(profil);

  async function deposer(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    e.target.value = "";
    if (!fichier) return;
    setErreur("");
    if (fichier.size > TAILLE_MAX) { setErreur("Fichier trop lourd (8 Mo maximum)."); return; }
    const octets = new Uint8Array(await fichier.arrayBuffer());
    const type = typeDepuisOctets(octets);
    if (!type) { setErreur("Format non reconnu : PDF, PNG ou JPEG uniquement."); return; }
    setEnvoi(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setErreur("Session expirée, reconnecte-toi."); return; }
      const uid = session.user.id;
      const chemin = `${uid}/attestation-decennale-${Date.now()}.${type === "jpeg" ? "jpg" : type}`;
      const { error: errUp } = await supabase.storage.from(BUCKET_DOCUMENTS_PRO).upload(chemin, fichier, { contentType: fichier.type || undefined });
      if (errUp) { setErreur(`Envoi impossible : ${errUp.message}${/bucket|not found/i.test(errUp.message) ? " (la migration 020 n'a pas été lancée dans Supabase ?)" : ""}`); return; }
      const ancien = profil.assurance_fichier;
      const { error: errDb } = await supabase.from("profil").update({ assurance_fichier: chemin, assurance_fichier_nom: fichier.name }).eq("id", uid);
      if (errDb) {
        await supabase.storage.from(BUCKET_DOCUMENTS_PRO).remove([chemin]); // pas de fichier orphelin
        setErreur(`Fichier envoyé mais non enregistré : ${errDb.message}${/assurance_/i.test(errDb.message) ? " (migration 020 à lancer dans Supabase)" : ""}`);
        return;
      }
      if (ancien) await supabase.storage.from(BUCKET_DOCUMENTS_PRO).remove([ancien]);
      set("assurance_fichier", chemin); set("assurance_fichier_nom", fichier.name);
    } finally { setEnvoi(false); }
  }

  async function ouvrir() {
    if (!profil.assurance_fichier) return;
    const { data, error } = await supabase.storage.from(BUCKET_DOCUMENTS_PRO).createSignedUrl(profil.assurance_fichier, 120);
    if (error || !data) { setErreur(`Ouverture impossible : ${error?.message ?? "lien indisponible"}`); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function retirer() {
    if (!profil.assurance_fichier || !window.confirm("Retirer l'attestation ? Elle ne sera plus jointe aux dossiers de fin de chantier.")) return;
    const chemin = profil.assurance_fichier;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setErreur("Session expirée, reconnecte-toi."); return; }
    const { error } = await supabase.from("profil").update({ assurance_fichier: null, assurance_fichier_nom: null }).eq("id", session.user.id);
    if (error) { setErreur(`Suppression impossible : ${error.message}`); return; }
    await supabase.storage.from(BUCKET_DOCUMENTS_PRO).remove([chemin]);
    set("assurance_fichier", null); set("assurance_fichier_nom", null);
  }

  return (
    <div className="card card-inner">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck size={16} className="text-ink-500" />
        <h2 className="font-semibold text-ink-800">Assurance décennale</h2>
      </div>
      <p className="text-xs text-ink-400 mb-4">Ces informations sont imprimées sur tes devis et tes factures, et l&apos;attestation est jointe à chaque dossier de fin de chantier. Elles ne sont plus utilisées dès que l&apos;attestation est expirée.</p>

      {alerte && (
        <div className={cn("flex items-start gap-2 rounded-xl border p-3 mb-4 text-sm", etat === "valide" ? "" : etat === "bientot" || etat === "absente" || etat === "non_commencee" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-red-300 bg-red-50 text-red-800")} role="status">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" /> <span>{alerte}</span>
        </div>
      )}
      {!alerte && etat === "valide" && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700 mb-4"><CheckCircle size={13} /> Attestation en cours de validité.</p>
      )}

      <div className="space-y-3">
        <div className="grid md:grid-cols-2 gap-3">
          <div><label className="label">Assureur</label><input className="input" placeholder="Nom de l'assureur" value={v("assurance_assureur")} onChange={e => set("assurance_assureur", e.target.value)} /></div>
          <div><label className="label">N° de contrat</label><input className="input" value={v("assurance_contrat")} onChange={e => set("assurance_contrat", e.target.value)} /></div>
        </div>
        <div><label className="label">Adresse de l&apos;assureur</label><input className="input" placeholder="Rue, code postal, ville" value={v("assurance_adresse")} onChange={e => set("assurance_adresse", e.target.value)} /></div>
        <div><label className="label">Couverture géographique</label><input className="input" placeholder="France métropolitaine" value={v("assurance_zone")} onChange={e => set("assurance_zone", e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Valable du</label><input type="date" className="input" value={v("assurance_debut").slice(0, 10)} onChange={e => set("assurance_debut", e.target.value || null)} /></div>
          <div><label className="label">Jusqu&apos;au (inclus)</label><input type="date" className="input" value={v("assurance_fin").slice(0, 10)} onChange={e => set("assurance_fin", e.target.value || null)} /></div>
        </div>

        <div className="rounded-xl border border-ink-200 p-3">
          <p className="label mb-2">Attestation (PDF, PNG ou JPEG, 8 Mo max)</p>
          {profil.assurance_fichier ? (
            <div className="flex flex-wrap items-center gap-2">
              <FileText size={15} className="text-ink-500 shrink-0" />
              <span className="text-sm text-ink-800 min-w-0 flex-1 truncate">{profil.assurance_fichier_nom || "Attestation"}</span>
              <button type="button" onClick={ouvrir} className="btn-ghost !py-1.5 !text-xs"><ExternalLink size={12} /> Ouvrir</button>
              <button type="button" onClick={() => entree.current?.click()} disabled={envoi} className="btn-ghost !py-1.5 !text-xs"><Upload size={12} /> Remplacer</button>
              <button type="button" onClick={retirer} aria-label="Retirer l'attestation" className="btn-ghost !py-1.5 !text-xs text-red-500"><Trash2 size={12} /></button>
            </div>
          ) : (
            <button type="button" onClick={() => entree.current?.click()} disabled={envoi} className="btn-ghost"><Upload size={14} /> {envoi ? "Envoi…" : "Déposer l'attestation"}</button>
          )}
          <input ref={entree} type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={deposer} />
          {erreur && <p className="text-xs text-red-600 mt-2" role="alert">{erreur}</p>}
        </div>

        {mention && (
          <div className="rounded-xl bg-ink-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-1">Mention imprimée sur les devis et factures</p>
            <p className="text-xs text-ink-700">{mention}</p>
          </div>
        )}
        <p className="text-xs text-ink-400">Pense à cliquer sur « Enregistrer » pour garder les informations ci-dessus (le fichier, lui, est enregistré tout de suite).</p>
      </div>
    </div>
  );
}
