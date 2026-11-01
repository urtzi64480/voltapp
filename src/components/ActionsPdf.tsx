"use client";
// Boutons communs pour remettre un PDF au client : partage (feuille du téléphone), SMS, e-mail (lien public) et téléchargement.
import { useState } from "react";
import { FileDown, Mail, MessageSquare, Share2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Canal = "share" | "sms" | "mail" | "pdf";
export interface PdfPret { blob: Blob; nom: string }

export default function ActionsPdf({ construire, sujet, corpsLien, telephone, email, dossierStockage }: {
  construire: () => Promise<PdfPret | null>; sujet: string; corpsLien: (lien: string) => string; telephone?: string | null; email?: string | null; dossierStockage: string;
}) {
  const [occupe, setOccupe] = useState<Canal | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function lancer(canal: Canal) {
    setOccupe(canal); setInfo(null);
    try {
      const pdf = await construire(); if (!pdf) return;
      if (canal === "pdf") {
        const url = URL.createObjectURL(pdf.blob);
        const a = document.createElement("a"); a.href = url; a.download = pdf.nom; document.body.appendChild(a); a.click(); a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      } else if (canal === "share") {
        const f = new File([pdf.blob], pdf.nom, { type: "application/pdf" });
        if (navigator.canShare?.({ files: [f] })) {
          try { await navigator.share({ files: [f], title: sujet }); } catch (e) { if ((e as Error).name !== "AbortError") setInfo("Partage impossible : utilise SMS, e-mail ou Télécharger."); }
        } else setInfo("Partage de fichier indisponible ici : utilise SMS, e-mail ou Télécharger.");
      } else {
        const chemin = `${dossierStockage}/${pdf.nom.replace(/\.pdf$/, "")}-${Date.now().toString(36)}.pdf`;
        const { error } = await supabase.storage.from("documents").upload(chemin, pdf.blob, { contentType: "application/pdf", upsert: true });
        if (error) { setInfo(`Dépôt du PDF impossible (${error.message}). Utilise Télécharger ou Partager.`); return; }
        const lien = supabase.storage.from("documents").getPublicUrl(chemin).data.publicUrl;
        const corps = corpsLien(lien);
        if (canal === "sms") {
          const sep = /iPad|iPhone|iPod/.test(navigator.userAgent) ? "&" : "?";
          window.location.href = `sms:${(telephone ?? "").replace(/[^\d+]/g, "")}${sep}body=${encodeURIComponent(corps)}`;
        } else window.location.href = `mailto:${email ?? ""}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
      }
    } catch (e) { setInfo(`Impossible : ${e instanceof Error ? e.message : "erreur inconnue"}`); } finally { setOccupe(null); }
  }

  const b = (canal: Canal, icone: React.ReactNode, texte: string, volt = false) => (
    <button type="button" className={volt ? "btn-volt" : "btn-ghost"} disabled={occupe !== null} onClick={() => void lancer(canal)}>{icone} {occupe === canal ? "…" : texte}</button>
  );
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {b("share", <Share2 size={14} />, "Partager le PDF", true)}
        {b("sms", <MessageSquare size={14} />, "SMS")}
        {b("mail", <Mail size={14} />, "E-mail")}
        {b("pdf", <FileDown size={14} />, "Télécharger")}
      </div>
      {info && <p className="text-xs text-amber-700 mt-2" role="status">{info}</p>}
    </div>
  );
}
