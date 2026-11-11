"use client";
// RÉCEPTION DES TRAVAUX : photos du chantier, rapport de fin de chantier établi et envoyé par l'entreprise (sans signature du client), et procès-verbal signé sur place par le client (facultatif).
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Camera, Check, RotateCcw, Trash2, WifiOff } from "lucide-react";
import Shell from "@/components/layout/Shell";
import SignaturePad, { type SignaturePadRef } from "@/components/SignaturePad";
import ActionsPdf, { type PdfPret } from "@/components/ActionsPdf";
import { supabase } from "@/lib/supabase";
import { dateLocale, fmtDate } from "@/lib/utils";
import type { Profil } from "@/types";
import { contexteDevis } from "@/lib/checklist-fin-chantier";
import { compresserPhoto } from "@/lib/image-compress";
import { useControles } from "@/lib/use-controles";
import { attestationUtilisable, type InfosAssurance } from "@/lib/assurance";
import { joindreAttestation } from "@/lib/attestation-pdf";
import { BUCKET_DOCUMENTS_PRO } from "@/components/parametres/AssuranceDecennale";
import { genPDFDossierBlob, nomFichierDossier, type InfosDossier } from "@/lib/pdf-dossier";

interface DevisRec {
  id: string; numero: string; objet?: string | null; suivi_realisation?: string | null;
  client?: { nom: string; prenom?: string | null; adresse?: string | null; code_postal?: string | null; ville?: string | null; telephone?: string | null; email?: string | null } | null;
  lignes?: { nom: string; description?: string | null; poste?: string | null; quantite: number; unite?: string | null; type_branche?: string | null }[] | null;
}

export default function ReceptionPage() {
  const { id } = useParams() as { id: string };
  const [devis, setDevis] = useState<DevisRec | null>(null);
  const [chargement, setChargement] = useState(true);
  useEffect(() => {
    (async () => {
      const SEL = "id, numero, objet, client:clients(nom, prenom, adresse, code_postal, ville, telephone, email), lignes:devis_lignes(*)";
      let res = await supabase.from("devis").select(`${SEL}, suivi_realisation`).eq("id", id).single();
      if (res.error && /suivi_realisation/i.test(res.error.message)) res = await supabase.from("devis").select(SEL).eq("id", id).single() as typeof res;
      setDevis((res.data as unknown as DevisRec) ?? null); setChargement(false);
    })();
  }, [id]);
  if (chargement) return <Shell><div className="p-8 text-center text-ink-400">Chargement…</div></Shell>;
  if (!devis) return <Shell><div className="p-8 text-center text-ink-500">Devis introuvable.</div></Shell>;
  return <Reception devis={devis} />;
}

function Reception({ devis }: { devis: DevisRec }) {
  const { controles, valideLe, agir, erreur, absente, attente } = useControles(devis.id, devis.suivi_realisation);
  const nomClient = devis.client ? `${devis.client.prenom ? `${devis.client.prenom} ` : ""}${devis.client.nom}` : "";
  const [date, setDate] = useState(dateLocale());
  const [signataire, setSignataire] = useState(nomClient);
  const [reserves, setReserves] = useState("");
  const [legende, setLegende] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [envoiPhoto, setEnvoiPhoto] = useState(false);
  const pad = useRef<SignaturePadRef>(null);
  const reception = controles?.reception;
  const photos = controles?.photos ?? [];
  const ctx = useMemo(() => contexteDevis([devis.objet, ...(devis.lignes ?? []).flatMap(l => [l.nom, l.description, l.poste])]), [devis]);

  const enregistrer = () => {
    setMsg(null);
    if (!signataire.trim()) { setMsg("Indique le nom de la personne qui signe."); return; }
    const sig = pad.current?.exporter();
    if (!sig) { setMsg("La signature est vide."); return; }
    agir({ action: "reception", id: devis.id, reception: { le: date, nom: signataire, reserves, signature: sig } });
  };

  async function ajouterPhotos(fichiers: FileList | null) {
    if (!fichiers || fichiers.length === 0) return;
    setEnvoiPhoto(true); setMsg(null);
    try {
      for (const f of Array.from(fichiers)) {
        if (photos.length >= 12) { setMsg("12 photos maximum."); break; }
        const blob = await compresserPhoto(f);
        const chemin = `chantiers/${devis.id}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.jpg`;
        const { error } = await supabase.storage.from("documents").upload(chemin, blob, { contentType: "image/jpeg" });
        if (error) { setMsg(`Envoi de la photo impossible : ${error.message}`); break; }
        agir({ action: "photo+", id: devis.id, photo: { url: supabase.storage.from("documents").getPublicUrl(chemin).data.publicUrl, legende } });
      }
    } catch { setMsg("Photo illisible."); } finally { setEnvoiPhoto(false); }
  }

  const infos = (): InfosDossier => ({
    numeroDevis: devis.numero, objet: devis.objet, client: devis.client, contexte: ctx,
    lignes: (devis.lignes ?? []).map(l => ({ nom: l.nom, quantite: l.quantite, unite: l.unite, type_branche: l.type_branche })),
  });
  const construire = (type: "pv" | "dossier") => async (): Promise<PdfPret | null> => {
    // Le procès-verbal exige la signature du client ; le rapport de fin de chantier, non : il est établi et envoyé par l'entreprise.
    if (type === "pv" && !reception) { setMsg("Fais d'abord signer le procès-verbal de réception."); return null; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setMsg("Session expirée : reconnecte-toi."); return null; }
    const { data: p } = await supabase.from("profil").select("*").eq("id", user.id).single();
    if (!p) { setMsg("Profil introuvable."); return null; }
    const blob = await genPDFDossierBlob(type, controles, p as Profil, infos());
    if (type !== "dossier") return { blob, nom: nomFichierDossier(devis.numero, type) };
    // Dossier de fin de chantier : l'attestation d'assurance décennale est jointe à la fin, tant qu'elle est en cours de validité.
    const ass = p as InfosAssurance;
    if (!ass.assurance_fichier) { setMsg("Aucune attestation décennale déposée : le dossier est généré sans elle (Paramètres → Assurance décennale)."); return { blob, nom: nomFichierDossier(devis.numero, type) }; }
    if (!attestationUtilisable(ass)) { setMsg("Attestation décennale expirée (ou sans date de fin) : le dossier est généré sans elle. Mets-la à jour dans Paramètres."); return { blob, nom: nomFichierDossier(devis.numero, type) }; }
    const { data: fichier, error: errFichier } = await supabase.storage.from(BUCKET_DOCUMENTS_PRO).download(ass.assurance_fichier);
    if (errFichier || !fichier) { setMsg(`Attestation décennale introuvable (${errFichier?.message ?? "fichier absent"}) : dossier non généré, pour ne pas l'envoyer sans elle.`); return null; }
    try {
      const complet = await joindreAttestation(new Uint8Array(await blob.arrayBuffer()), new Uint8Array(await fichier.arrayBuffer()));
      setMsg(null);
      return { blob: new Blob([complet as BlobPart], { type: "application/pdf" }), nom: nomFichierDossier(devis.numero, type) };
    } catch (e) {
      setMsg(`Attestation décennale illisible (${e instanceof Error ? e.message : "erreur"}) : dossier non généré. Dépose-la à nouveau dans Paramètres.`);
      return null;
    }
  };
  const bonjour = nomClient ? `Bonjour ${devis.client?.prenom || devis.client?.nom}` : "Bonjour";

  return (
    <Shell>
      <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-4">
        <div>
          <Link href={`/devis/${devis.id}/fin-chantier`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-800 mb-3"><ArrowLeft size={13} /> Contrôles de fin de chantier</Link>
          <h1 className="font-display text-3xl text-ink-900">Réception des travaux</h1>
          <p className="text-ink-500 text-sm mt-1">{devis.numero}{devis.objet ? ` · ${devis.objet}` : ""}{nomClient ? ` · ${nomClient}` : ""}{valideLe ? ` · chantier validé le ${fmtDate(valideLe)}` : ""}</p>
        </div>
        {attente > 0 && <div className="card card-inner border-amber-300 bg-amber-50 text-sm text-amber-900 flex items-center gap-2" role="status"><WifiOff size={16} /> {attente} modification{attente > 1 ? "s" : ""} gardée{attente > 1 ? "s" : ""} sur cet appareil, envoyée{attente > 1 ? "s" : ""} au retour du réseau.</div>}
        {absente && <div className="card card-inner border-red-300 bg-red-50 text-sm text-red-800">Enregistrement indisponible : lance dans Supabase <span className="font-mono">alter table devis add column if not exists suivi_realisation text;</span> puis recharge.</div>}
        {erreur && <div className="card card-inner border-red-300 bg-red-50 text-sm text-red-800" role="alert">{erreur}</div>}

        <section className="card card-inner">
          <h2 className="font-semibold text-ink-800 mb-2 flex items-center gap-2"><Camera size={16} /> Photos du chantier ({photos.length}/12)</h2>
          <input className="input mb-2" placeholder="Légende des prochaines photos (facultatif)" value={legende} maxLength={120} onChange={e => setLegende(e.target.value)} />
          <label className="btn-ghost cursor-pointer inline-flex">
            <Camera size={14} /> {envoiPhoto ? "Envoi…" : "Prendre / ajouter des photos"}
            <input type="file" accept="image/*" capture="environment" multiple className="sr-only" disabled={envoiPhoto} onChange={e => { void ajouterPhotos(e.target.files); e.target.value = ""; }} />
          </label>
          {photos.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 mt-3">
              {photos.map(p => (
                <li key={p.url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.legende ?? "Photo du chantier"} className="w-full h-24 object-cover rounded-lg border border-ink-200" loading="lazy" />
                  {p.legende && <p className="text-[10px] text-ink-500 truncate">{p.legende}</p>}
                  <button type="button" aria-label="Supprimer la photo" className="absolute top-1 right-1 bg-white/90 rounded-full p-1 text-ink-500 hover:text-red-600" onClick={() => agir({ action: "photo-", id: p.url })}><Trash2 size={12} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card card-inner">
          <h2 className="font-semibold text-ink-800 mb-2">Procès-verbal de réception</h2>
          {reception ? (
            <div className="text-sm text-ink-700 space-y-2">
              <p className="flex items-center gap-2 text-emerald-700 font-semibold"><Check size={16} /> Signé le {fmtDate(reception.le)} par {reception.nom}</p>
              <p>{reception.reserves ? `Réserves : ${reception.reserves}` : "Sans réserve."}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={reception.signature} alt="Signature" className="h-16 bg-ink-50 rounded-lg border border-ink-200" />
              <button type="button" className="btn-ghost !py-1.5 !text-xs" onClick={() => agir({ action: "reception", id: devis.id, reception: null })}><RotateCcw size={12} /> Refaire la signature</button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-ink-500">Le client déclare réceptionner les travaux. Les réserves éventuelles sont notées ci-dessous.</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">Date de réception<input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></label>
                <label className="text-xs">Nom du signataire<input className="input" value={signataire} onChange={e => setSignataire(e.target.value)} maxLength={120} /></label>
              </div>
              <label className="text-xs block">Réserves (laisser vide si aucune)<textarea className="input" rows={2} value={reserves} maxLength={1000} onChange={e => setReserves(e.target.value)} /></label>
              <SignaturePad ref={pad} />
              <div className="flex gap-2">
                <button type="button" className="btn-ghost" onClick={() => pad.current?.effacer()}><RotateCcw size={14} /> Effacer</button>
                <button type="button" className="btn-volt" onClick={enregistrer}><Check size={14} /> Enregistrer le PV signé</button>
              </div>
            </div>
          )}
          {msg && <p className="text-xs text-amber-700 mt-2" role="status">{msg}</p>}
        </section>

        <section className="card card-inner space-y-4">
          <div>
            <h2 className="font-semibold text-ink-800 mb-2">Envoyer le rapport de fin de chantier</h2>
            <p className="text-xs text-ink-500 mb-2">Établi par toi, sans signature du client : travaux posés, contrôles réalisés, photos{reception ? ", réception signée et garanties" : ""} et attestation décennale. Envoi par SMS ou par e-mail.</p>
            <ActionsPdf construire={construire("dossier")} sujet={`Rapport de fin de chantier — ${devis.numero}`} telephone={devis.client?.telephone} email={devis.client?.email} dossierStockage="dossiers"
              corpsLien={l => `${bonjour}, voici le rapport de fin de chantier (travaux réalisés, contrôles, photos) : ${l}`} />
          </div>
          {reception && (
            <div className="border-t border-ink-100 pt-4">
              <h2 className="font-semibold text-ink-800 mb-2">Remettre le procès-verbal de réception (1 page)</h2>
              <ActionsPdf construire={construire("pv")} sujet={`Procès-verbal de réception — ${devis.numero}`} telephone={devis.client?.telephone} email={devis.client?.email} dossierStockage="receptions"
                corpsLien={l => `${bonjour}, voici le procès-verbal de réception de vos travaux : ${l}`} />
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}
