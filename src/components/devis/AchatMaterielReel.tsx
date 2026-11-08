"use client";
// Saisie du matériel RÉELLEMENT acheté pour un devis (montant + date d'achat). Utilisée sur la fiche du devis et dans la page « Achats matériel ».
// Enregistre dans devis.achat_materiel_reel / achat_materiel_date (migration 017). Montant vide = « pas encore saisi ».
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { lireDate, lireMontant, SQL_MIGRATION_ACHATS } from "@/lib/depenses-materiel";
import { cn, echecSupabase } from "@/lib/utils";

export interface ValeursAchat { reel: number | null; date: string | null }

export default function AchatMaterielReel({ devisId, reel, date, dateRef, onSaved, compact = false }: {
  devisId: string; reel: number | null; date: string | null; dateRef: string; onSaved: (v: ValeursAchat) => void; compact?: boolean;
}) {
  const [montant, setMontant] = useState(reel != null ? String(reel).replace(".", ",") : "");
  const [jour, setJour] = useState(lireDate(date) ?? "");
  const [etat, setEtat] = useState<"repos" | "envoi" | "ok">("repos");
  const [erreur, setErreur] = useState<string | null>(null);

  // La valeur enregistrée peut changer depuis l'extérieur (rechargement) : on resynchronise les champs.
  useEffect(() => { setMontant(reel != null ? String(reel).replace(".", ",") : ""); }, [reel]);
  useEffect(() => { setJour(lireDate(date) ?? ""); }, [date]);

  const montantLu = lireMontant(montant);
  const vide = montant.trim() === "";
  const invalide = !vide && montantLu == null;
  const inchange = (vide ? null : montantLu) === reel && (jour || null) === (lireDate(date) ?? null);

  async function enregistrer() {
    if (invalide || etat === "envoi") return;
    setEtat("envoi"); setErreur(null);
    const v: ValeursAchat = { reel: vide ? null : montantLu, date: vide ? null : (jour || null) };
    const { error } = await supabase.from("devis").update({ achat_materiel_reel: v.reel, achat_materiel_date: v.date }).eq("id", devisId);
    if (error) {
      setEtat("repos");
      if (/achat_materiel/i.test(error.message)) setErreur("Colonnes absentes : lance d'abord dans Supabase (SQL Editor) :\n" + SQL_MIGRATION_ACHATS);
      else { echecSupabase(error, "Enregistrement des achats matériel"); setErreur(error.message); }
      return;
    }
    onSaved(v);
    setEtat("ok");
    setTimeout(() => setEtat(e => (e === "ok" ? "repos" : e)), 1500);
  }

  return (
    <div className={cn("flex flex-wrap items-end gap-2", compact && "gap-1.5")}>
      <label className="block">
        <span className={cn("block text-ink-400", compact ? "text-[10px]" : "text-xs")}>Dépensé réellement (€)</span>
        <input inputMode="decimal" className={cn("input", compact ? "!py-1 !px-2 w-28 text-sm" : "w-36", invalide && "!border-red-400")} placeholder="0,00" value={montant}
          onChange={e => { setMontant(e.target.value); setEtat("repos"); }} onKeyDown={e => { if (e.key === "Enter") enregistrer(); }} aria-invalid={invalide} />
      </label>
      <label className="block">
        <span className={cn("block text-ink-400", compact ? "text-[10px]" : "text-xs")}>Date d&apos;achat</span>
        <input type="date" className={cn("input", compact ? "!py-1 !px-2 text-sm" : "")} value={jour} placeholder={dateRef} title={`Vide : classé dans le mois de signature (${dateRef || "—"})`}
          onChange={e => { setJour(e.target.value); setEtat("repos"); }} />
      </label>
      <button type="button" onClick={enregistrer} disabled={invalide || inchange || etat === "envoi"} className={cn("btn-volt", compact ? "!px-2.5 !py-1 text-sm" : "")}>
        {etat === "envoi" ? <Loader2 size={14} className="animate-spin" /> : etat === "ok" ? <Check size={14} /> : null}
        {etat === "ok" ? "Enregistré" : "Enregistrer"}
      </button>
      {invalide && <p className="w-full text-xs text-red-500">Montant invalide (exemple : 123,45).</p>}
      {erreur && <p className="w-full text-xs text-red-500 whitespace-pre-wrap">{erreur}</p>}
    </div>
  );
}
