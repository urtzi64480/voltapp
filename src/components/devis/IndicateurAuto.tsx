"use client";
// État de la sauvegarde automatique d'un devis en édition : discret quand tout va bien, explicite quand ça échoue.
import { AlertTriangle, Check, CloudUpload, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type EtatAuto = "repos" | "attente" | "enCours" | "ok" | "echec";
const heure = (d?: Date) => (d ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");

export default function IndicateurAuto({ possible, etat, le, message, viderUnDevis, onReessayer, compact }: {
  possible: boolean; etat: EtatAuto; le?: Date; message?: string; viderUnDevis?: boolean; onReessayer: () => void; compact?: boolean;
}) {
  let contenu: React.ReactNode;
  let ton = "text-ink-500";
  if (!possible) contenu = <>Devis signé : enregistrement manuel</>;
  else if (etat === "echec") {
    ton = "text-red-700";
    contenu = (
      <>
        <AlertTriangle size={13} className="shrink-0" />
        <span className="min-w-0">Échec de l&apos;enregistrement automatique{!compact && message ? ` — ${message}` : ""}</span>
        <button type="button" onClick={onReessayer} className="underline font-semibold shrink-0">Réessayer</button>
      </>
    );
  } else if (viderUnDevis) {
    ton = "text-amber-700";
    contenu = <>Devis vidé : non enregistré automatiquement (utilise « Sauvegarder »)</>;
  } else if (etat === "enCours") contenu = <><Loader2 size={13} className="animate-spin shrink-0" /> Enregistrement…</>;
  else if (etat === "attente") contenu = <><CloudUpload size={13} className="shrink-0" /> Modifications en cours…</>;
  else if (etat === "ok") { ton = "text-emerald-700"; contenu = <><Check size={13} className="shrink-0" /> Enregistré à {heure(le)}</>; }
  else contenu = <><CloudUpload size={13} className="shrink-0" /> Enregistrement automatique activé</>;
  return <p role="status" aria-live="polite" className={cn("flex flex-wrap items-center gap-1.5 text-xs", ton, !compact && "mt-4")}>{contenu}</p>;
}
