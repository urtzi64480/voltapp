"use client";
// CONTRÔLES DE FIN DE CHANTIER d'un devis : une proposition par défaut, l'électricien retient ceux qu'il fait sur CE chantier,
// les coche une fois réalisés (valeur mesurée facultative), puis remet au client un PDF (partage, SMS ou e-mail).
// Stockage : devis.suivi_realisation (même colonne que le suivi, migration 013) — utilisable hors ligne via la file locale.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, FileDown, Mail, MessageSquare, Plus, Share2, Trash2, WifiOff } from "lucide-react";
import Shell from "@/components/layout/Shell";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Profil } from "@/types";
import { lireSuivi, type SuiviStocke } from "@/lib/suivi-persistance";
import { appliquerFile, cleSuiviDevis, ecrireControles, enLigne, lireDevisMemorise, memoriserDevis, nbEnAttente, synchroniser, estErreurReseau, type ResultatEcritureSuivi } from "@/lib/suivi-hors-ligne";
import {
  appliquerActionControles, controlesVides, copierControles, estVide,
  contexteDevis, controlesAffiches, controlesRemis, controlesRestants, nouvelIdPerso, type ActionControles, type Controles, type ControleAffiche,
} from "@/lib/checklist-fin-chantier";
import { genPDFControlesBlob, nomFichierControles } from "@/lib/pdf-controles";

interface DevisFin {
  id: string; numero: string; objet?: string | null; suivi_realisation?: string | null;
  lignes?: { nom?: string | null; description?: string | null; poste?: string | null }[] | null;
  client?: { nom: string; prenom?: string | null; adresse?: string | null; telephone?: string | null; email?: string | null } | null;
}

export default function FinChantierPage() {
  const { id } = useParams() as { id: string };
  const [devis, setDevis] = useState<DevisFin | null>(null);
  const [chargement, setChargement] = useState(true);
  const [absente, setAbsente] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      const SELECT = "id, numero, objet, client:clients(nom, prenom, adresse, telephone, email), lignes:devis_lignes(*)";
      let res = await supabase.from("devis").select(`${SELECT}, suivi_realisation`).eq("id", id).single();
      let manque = false;
      if (res.error && /suivi_realisation/i.test(res.error.message)) {
        manque = true;
        res = await supabase.from("devis").select(SELECT).eq("id", id).single() as typeof res;
      }
      if (annule) return;
      if (res.data) {
        const d = res.data as unknown as DevisFin;
        setDevis(d); setAbsente(manque);
        if (!manque) memoriserDevis(d);
      } else {
        const copie = lireDevisMemorise<DevisFin>(id);
        if (copie) setDevis(copie.devis);
      }
      setChargement(false);
    })();
    return () => { annule = true; };
  }, [id]);

  if (chargement) return <Shell><div className="p-8 text-center text-ink-400">Chargement…</div></Shell>;
  if (!devis) return <Shell><div className="p-8 text-center text-ink-500">Devis introuvable.</div></Shell>;
  return <Fin devis={devis} absenteInitial={absente} />;
}

function Fin({ devis, absenteInitial }: { devis: DevisFin; absenteInitial: boolean }) {
  const cle = cleSuiviDevis(devis.id);
  const initial = useMemo(() => appliquerFile(lireSuivi(devis.suivi_realisation), cle), [devis.suivi_realisation, cle]);
  const [controles, setControles] = useState<Controles | undefined>(initial.controles);
  const [valideLe, setValideLe] = useState<string | undefined>(initial.chantier.valide_le);
  const [absente, setAbsente] = useState(absenteInitial);
  const [erreur, setErreur] = useState<string | null>(null);
  const [attente, setAttente] = useState(() => nbEnAttente(cle));
  const [nouveau, setNouveau] = useState("");
  const [occupe, setOccupe] = useState<null | "pdf" | "share" | "sms" | "mail">(null);
  const [info, setInfo] = useState<string | null>(null);
  const pendingRef = useRef(0);
  const fileRef = useRef<Promise<void>>(Promise.resolve());

  const appliquer = useCallback((s: SuiviStocke) => {
    const r = appliquerFile(s, cle);
    setControles(r.controles); setValideLe(r.chantier.valide_le);
  }, [cle]);

  const agir = (a: ActionControles) => {
    // Affichage immédiat via la même logique que l'écriture, puis écriture (relit la base avant d'écrire).
    setControles(prev => {
      const s: SuiviStocke = { coches: {}, chantier: {}, temps: {}, tempsPostes: {}, controles: prev };
      return appliquerEnLocal(s, a);
    });
    pendingRef.current += 1;
    fileRef.current = fileRef.current.then(async () => {
      const res: ResultatEcritureSuivi = await ecrireControles(cle, a);
      pendingRef.current -= 1;
      if (res.ok && "enAttente" in res) { setErreur(null); setAttente(res.nbEnAttente); }
      else if (res.ok) { setErreur(null); setAttente(nbEnAttente(cle)); if (pendingRef.current === 0) appliquer(res.suivi); }
      else if (res.colonneAbsente) setAbsente(true);
      else setErreur(`Enregistrement impossible : ${res.message}`);
    });
  };

  useEffect(() => {
    const envoyer = async () => {
      if (pendingRef.current > 0 || nbEnAttente(cle) === 0) return;
      const res = await synchroniser(cle);
      if (res?.ok && pendingRef.current === 0) appliquer(res.suivi);
      else if (res && !res.ok && !estErreurReseau(res.message)) setErreur(res.message);
      setAttente(nbEnAttente(cle));
    };
    void envoyer();
    window.addEventListener("online", envoyer);
    return () => window.removeEventListener("online", envoyer);
  }, [cle, appliquer]);

  const ctx = useMemo(
    () => contexteDevis([devis.objet, ...(devis.lignes ?? []).flatMap(l => [l.nom, l.description, l.poste])]),
    [devis.objet, devis.lignes],
  );
  const liste = useMemo(() => controlesAffiches(controles, ctx), [controles, ctx]);
  const parCategorie = useMemo(() => {
    const m = new Map<string, ControleAffiche[]>();
    liste.forEach(c => m.set(c.categorie, [...(m.get(c.categorie) ?? []), c]));
    return [...m.entries()];
  }, [liste]);
  const retenus = liste.filter(c => c.retenu).length;
  const restants = controlesRestants(controles, ctx);
  const remis = controlesRemis(controles, ctx);

  async function construirePdf(): Promise<{ blob: Blob; nom: string } | null> {
    if (remis.length === 0) { setInfo("Coche au moins un contrôle réalisé : le PDF ne contient que ce qui a été fait."); return null; }
    if (restants.length > 0 && !window.confirm(`${restants.length} contrôle${restants.length > 1 ? "s" : ""} retenu${restants.length > 1 ? "s" : ""} pas encore réalisé${restants.length > 1 ? "s" : ""} : ${restants.length > 1 ? "ils" : "il"} ne figurer${restants.length > 1 ? "ont" : "a"} pas dans le PDF. Continuer ?`)) return null;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setInfo("Session expirée : reconnecte-toi."); return null; }
    const { data: p } = await supabase.from("profil").select("*").eq("id", user.id).single();
    if (!p) { setInfo("Profil introuvable."); return null; }
    const blob = await genPDFControlesBlob(controles, p as Profil, { numeroDevis: devis.numero, objet: devis.objet, client: devis.client, dateChantier: valideLe, contexte: ctx });
    return { blob, nom: nomFichierControles(devis.numero) };
  }

  const telecharger = async () => {
    setOccupe("pdf"); setInfo(null);
    try {
      const pdf = await construirePdf(); if (!pdf) return;
      const url = URL.createObjectURL(pdf.blob);
      const a = document.createElement("a"); a.href = url; a.download = pdf.nom; document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { setInfo(`PDF impossible : ${e instanceof Error ? e.message : "erreur inconnue"}`); }
    finally { setOccupe(null); }
  };

  const partager = async () => {
    setOccupe("share"); setInfo(null);
    try {
      const pdf = await construirePdf(); if (!pdf) return;
      const fichier = new File([pdf.blob], pdf.nom, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [fichier] })) {
        try { await navigator.share({ files: [fichier], title: `Contrôles de fin de chantier — ${devis.numero}` }); }
        catch (e) { if ((e as Error).name !== "AbortError") setInfo("Partage impossible sur cet appareil : utilise SMS, e-mail ou Télécharger."); }
      } else setInfo("Le partage de fichier n'est pas disponible ici : utilise SMS, e-mail ou Télécharger.");
    } catch (e) { setInfo(`PDF impossible : ${e instanceof Error ? e.message : "erreur inconnue"}`); }
    finally { setOccupe(null); }
  };

  // SMS / e-mail : le PDF est déposé dans le stockage « documents » (lien public), le lien est mis dans le message.
  const envoyerLien = async (canal: "sms" | "mail") => {
    setOccupe(canal); setInfo(null);
    try {
      const pdf = await construirePdf(); if (!pdf) return;
      const chemin = `controles/${pdf.nom.replace(/\.pdf$/, "")}-${Date.now().toString(36)}.pdf`;
      const { error } = await supabase.storage.from("documents").upload(chemin, pdf.blob, { contentType: "application/pdf", upsert: true });
      if (error) { setInfo(`Dépôt du PDF impossible (${error.message}). Utilise Télécharger ou Partager.`); return; }
      const lien = supabase.storage.from("documents").getPublicUrl(chemin).data.publicUrl;
      const nom = devis.client?.prenom || devis.client?.nom || "";
      if (canal === "sms") {
        const tel = (devis.client?.telephone ?? "").replace(/[^\d+]/g, "");
        const msg = `Bonjour${nom ? ` ${nom}` : ""}, voici le récapitulatif des contrôles réalisés à la fin de votre chantier : ${lien}`;
        const sep = /iPad|iPhone|iPod/.test(navigator.userAgent) ? "&" : "?";
        window.location.href = `sms:${tel}${sep}body=${encodeURIComponent(msg)}`;
      } else {
        const sujet = `Contrôles de fin de chantier — devis ${devis.numero}`;
        const corps = `Bonjour${nom ? ` ${nom}` : ""},\n\nVoici le récapitulatif des contrôles réalisés à la fin de votre chantier :\n${lien}\n\nCordialement`;
        window.location.href = `mailto:${devis.client?.email ?? ""}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
      }
    } catch (e) { setInfo(`Envoi impossible : ${e instanceof Error ? e.message : "erreur inconnue"}`); }
    finally { setOccupe(null); }
  };

  const ajouter = () => {
    const libelle = nouveau.trim();
    if (!libelle) return;
    agir({ action: "perso+", id: nouvelIdPerso(), libelle });
    setNouveau("");
  };

  const client = devis.client ? `${devis.client.prenom ? `${devis.client.prenom} ` : ""}${devis.client.nom}` : "";
  const desactive = occupe !== null;

  return (
    <Shell>
      <div className="max-w-3xl mx-auto p-4 md:p-8">
        <Link href={`/devis/${devis.id}/suivi`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-800 mb-3">
          <ArrowLeft size={13} /> Suivi du devis {devis.numero}
        </Link>
        <h1 className="font-display text-3xl text-ink-900">Contrôles de fin de chantier</h1>
        <p className="text-ink-500 text-sm mt-1">{devis.numero}{devis.objet ? ` · ${devis.objet}` : ""}{client ? ` · ${client}` : ""}</p>
        <p className="text-xs text-ink-500 mt-3">
          Choisis les contrôles que tu fais sur ce chantier (la proposition suit le contenu du devis), marque-les réalisés, puis envoie le PDF au client : il ne contient que les contrôles retenus <b>et</b> réalisés.
        </p>

        {(attente > 0) && (
          <div className="card card-inner border-amber-300 bg-amber-50 mt-4 flex items-center gap-2 text-sm text-amber-900" role="status">
            <WifiOff size={16} className="shrink-0" /> {attente} modification{attente > 1 ? "s" : ""} gardée{attente > 1 ? "s" : ""} sur cet appareil, envoyée{attente > 1 ? "s" : ""} dès que le réseau revient.
          </div>
        )}
        {absente && (
          <div className="card card-inner border-red-300 bg-red-50 mt-4 text-sm text-red-800">
            <p className="font-semibold flex items-center gap-2"><AlertTriangle size={15} /> Enregistrement indisponible : la colonne du suivi n&apos;existe pas encore dans Supabase.</p>
            <p className="text-xs mt-1">Lance dans Supabase → SQL Editor : <span className="font-mono">alter table devis add column if not exists suivi_realisation text;</span> puis recharge.</p>
          </div>
        )}
        {erreur && <div className="card card-inner border-red-300 bg-red-50 mt-4 text-sm text-red-800" role="alert">{erreur}</div>}

        <div className="mt-5 space-y-4">
          {parCategorie.map(([cat, items]) => (
            <section key={cat} className="card card-inner">
              <h2 className="text-xs font-bold uppercase tracking-wide text-ink-500 mb-2">{cat}</h2>
              <ul className="divide-y divide-ink-100">
                {items.map(c => (
                  <li key={c.id} className="py-2.5">
                    <div className="flex items-start gap-3">
                      <label className="flex items-start gap-2 flex-1 min-w-0 cursor-pointer">
                        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={c.retenu} onChange={e => agir({ action: "retenir", id: c.id, retenu: e.target.checked, ids: liste.filter(x => x.id === c.id ? e.target.checked : x.retenu).map(x => x.id) })} aria-label={`Retenir : ${c.libelle}`} />
                        <span className="min-w-0">
                          <span className={cn("block text-sm", c.retenu ? "text-ink-900" : "text-ink-400")}>{c.libelle}</span>
                          {c.aide && <span className="block text-[11px] text-ink-400">{c.aide}</span>}
                          {c.lieAuDevis && <span className="block text-[10px] font-semibold text-volt-600">Prévu dans ce devis</span>}
                        </span>
                      </label>
                      {c.categorie === "Personnalisé" && (
                        <button type="button" onClick={() => agir({ action: "perso-", id: c.id })} className="text-ink-300 hover:text-red-600 p-1" aria-label="Supprimer ce contrôle"><Trash2 size={14} /></button>
                      )}
                      {c.retenu && (
                        <button type="button" onClick={() => agir({ action: "fait", id: c.id, fait: !c.fait, dateIso: new Date().toISOString() })}
                          className={cn("shrink-0 inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold", c.fait ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "border-ink-200 text-ink-500 hover:bg-ink-50")}>
                          <Check size={13} /> {c.fait ? "Réalisé" : "À faire"}
                        </button>
                      )}
                    </div>
                    {c.retenu && (
                      <CommentaireInput valeur={c.commentaire ?? ""} onValider={t => agir({ action: "commentaire", id: c.id, texte: t })} />
                    )}
                    {c.retenu && c.fait && c.mesure && (
                      <MesureInput valeur={c.fait.valeur ?? ""} unite={c.mesure} onValider={v => agir({ action: "valeur", id: c.id, valeur: v })} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="card card-inner mt-4 flex gap-2">
          <input className="input flex-1" placeholder="Ajouter un contrôle perso…" value={nouveau} maxLength={120}
            onChange={e => setNouveau(e.target.value)} onKeyDown={e => { if (e.key === "Enter") ajouter(); }} />
          <button type="button" className="btn-ghost" onClick={ajouter} disabled={!nouveau.trim()}><Plus size={14} /> Ajouter</button>
        </div>

        <div className="card card-inner mt-4">
          <p className="text-sm text-ink-700 mb-3"><b>{remis.length}</b> réalisé{remis.length > 1 ? "s" : ""} sur <b>{retenus}</b> retenu{retenus > 1 ? "s" : ""}{restants.length > 0 ? ` · ${restants.length} restant${restants.length > 1 ? "s" : ""}` : ""}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-volt" disabled={desactive} onClick={() => void partager()}><Share2 size={14} /> {occupe === "share" ? "…" : "Partager le PDF"}</button>
            <button type="button" className="btn-ghost" disabled={desactive} onClick={() => void envoyerLien("sms")}><MessageSquare size={14} /> {occupe === "sms" ? "…" : "SMS"}</button>
            <button type="button" className="btn-ghost" disabled={desactive} onClick={() => void envoyerLien("mail")}><Mail size={14} /> {occupe === "mail" ? "…" : "E-mail"}</button>
            <button type="button" className="btn-ghost" disabled={desactive} onClick={() => void telecharger()}><FileDown size={14} /> {occupe === "pdf" ? "…" : "Télécharger"}</button>
          </div>
          {(!devis.client?.telephone || !devis.client?.email) && <p className="text-[11px] text-ink-400 mt-2">{!devis.client?.telephone ? "Pas de téléphone sur la fiche client : le SMS s'ouvrira sans destinataire. " : ""}{!devis.client?.email ? "Pas d'e-mail sur la fiche client : l'e-mail s'ouvrira sans destinataire." : ""}</p>}
          {info && <p className="text-xs text-amber-700 mt-2" role="status">{info}</p>}
          <Link href={`/devis/${devis.id}/reception`} className="btn-ghost mt-3 inline-flex">Réception signée, photos et dossier complet →</Link>
          <p className="text-[11px] text-ink-400 mt-3">Le PDF précise qu&apos;il ne remplace ni une attestation Consuel ni un rapport de vérification réglementaire. Les valeurs mesurées sont celles que tu saisis : rien n&apos;est calculé ni validé automatiquement.</p>
        </div>
      </div>
    </Shell>
  );
}

function CommentaireInput({ valeur, onValider }: { valeur: string; onValider: (t: string) => void }) {
  const [v, setV] = useState(valeur);
  useEffect(() => setV(valeur), [valeur]);
  return (
    <input className="input !py-1 !text-sm mt-2 ml-6 w-[calc(100%-1.5rem)]" placeholder="Commentaire (affiché sur le rapport)" maxLength={300} value={v}
      aria-label="Commentaire" onChange={e => setV(e.target.value)} onBlur={() => { if (v.trim() !== valeur) onValider(v); }} />
  );
}

function MesureInput({ valeur, unite, onValider }: { valeur: string; unite: string; onValider: (v: string) => void }) {
  const [v, setV] = useState(valeur);
  useEffect(() => setV(valeur), [valeur]);
  return (
    <div className="mt-2 ml-6 flex items-center gap-2">
      <label className="text-[11px] text-ink-500" htmlFor={`m-${unite}-${valeur}`}>Valeur mesurée</label>
      <input id={`m-${unite}-${valeur}`} className="input !py-1 !text-sm w-28" inputMode="decimal" value={v} maxLength={40}
        onChange={e => setV(e.target.value)} onBlur={() => { if (v.trim() !== valeur) onValider(v); }} />
      <span className="text-xs text-ink-500">{unite}</span>
    </div>
  );
}

/** Affichage immédiat : même logique que l'écriture. */
function appliquerEnLocal(s: SuiviStocke, a: ActionControles): Controles | undefined {
  const c = copierControles(s.controles) ?? controlesVides();
  appliquerActionControles(c, a);
  return estVide(c) ? undefined : c;
}
