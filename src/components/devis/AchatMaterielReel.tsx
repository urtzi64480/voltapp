"use client";
// Saisie du matériel RÉELLEMENT acheté pour un devis (montant + date d'achat). Utilisée sur la fiche du devis et dans la page « Achats matériel ».
// Le montant se saisit en TTC (ticket de caisse, facture) ou en HT ; il est TOUJOURS enregistré en TTC : en franchise en base de TVA, la TVA payée
// au fournisseur n'est pas récupérable, c'est la vraie dépense (même base que les prix d'achat du catalogue). Enregistré dans
// devis.achat_materiel_reel / achat_materiel_date (migration 017). Montant vide = « pas encore saisi ».
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { htDepuisTtc, lireDate, lireMontant, lireMontantTtc, SQL_MIGRATION_ACHATS, ttcDepuisHt, TVA_ACHAT_PCT, type BaseMontant } from "@/lib/depenses-materiel";
import { cn, echecSupabase, fmt } from "@/lib/utils";

export interface ValeursAchat { reel: number | null; date: string | null }
const texte = (n: number) => String(n).replace(".", ",");

export default function AchatMaterielReel({ devisId, reel, date, dateRef, onSaved, compact = false }: {
  /** `reel` : montant enregistré, en TTC. */
  devisId: string; reel: number | null; date: string | null; dateRef: string; onSaved: (v: ValeursAchat) => void; compact?: boolean;
}) {
  const [base, setBase] = useState<BaseMontant>("ttc");
  const [montant, setMontant] = useState(reel != null ? texte(reel) : "");
  const [jour, setJour] = useState(lireDate(date) ?? "");
  const [etat, setEtat] = useState<"repos" | "envoi" | "ok">("repos");
  const [erreur, setErreur] = useState<string | null>(null);

  // La valeur enregistrée peut changer depuis l'extérieur (rechargement) : on resynchronise les champs (affichés dans la base choisie).
  useEffect(() => { setMontant(reel != null ? texte(base === "ht" ? htDepuisTtc(reel) : reel) : ""); }, [reel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setJour(lireDate(date) ?? ""); }, [date]);

  const montantLu = lireMontant(montant);
  const ttc = lireMontantTtc(montant, base);
  const vide = montant.trim() === "";
  const invalide = !vide && montantLu == null;
  const inchange = (vide ? null : ttc) === reel && (jour || null) === (lireDate(date) ?? null);

  // Changer de base convertit le montant déjà tapé (1 000 € TTC ↔ 833,33 € HT) au lieu de le réinterpréter.
  function changerBase(b: BaseMontant) {
    if (b === base) return;
    if (montantLu != null) setMontant(texte(b === "ht" ? htDepuisTtc(montantLu) : ttcDepuisHt(montantLu)));
    setBase(b); setEtat("repos");
  }

  async function enregistrer() {
    if (invalide || etat === "envoi") return;
    setEtat("envoi"); setErreur(null);
    const v: ValeursAchat = { reel: vide ? null : ttc, date: vide ? null : (jour || null) };
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

  const petit = compact ? "text-[10px]" : "text-xs";
  return (
    <div className={cn("flex flex-wrap items-end gap-2", compact && "gap-1.5")}>
      <div className="block">
        <span className={cn("flex items-center gap-1 text-ink-400", petit)}>Dépensé réellement
          <span className="inline-flex rounded-md border border-ink-200 overflow-hidden ml-1" role="group" aria-label="Base du montant">
            {(["ttc", "ht"] as const).map(b => (
              <button key={b} type="button" onClick={() => changerBase(b)} aria-pressed={base === b}
                className={cn("px-1.5 py-px uppercase font-semibold", base === b ? "bg-volt-500 text-white" : "bg-white text-ink-500 hover:bg-ink-50")}>{b}</button>
            ))}
          </span>
        </span>
        <input inputMode="decimal" className={cn("input", compact ? "!py-1 !px-2 w-28 text-sm" : "w-36", invalide && "!border-red-400")} placeholder="0,00" value={montant}
          onChange={e => { setMontant(e.target.value); setEtat("repos"); }} onKeyDown={e => { if (e.key === "Enter") enregistrer(); }} aria-invalid={invalide}
          aria-label={`Montant dépensé en ${base.toUpperCase()}`} />
      </div>
      <label className="block">
        <span className={cn("block text-ink-400", petit)}>Date d&apos;achat</span>
        <input type="date" className={cn("input", compact ? "!py-1 !px-2 text-sm" : "")} value={jour} title={`Vide : classé dans le mois de signature (${dateRef || "—"})`}
          onChange={e => { setJour(e.target.value); setEtat("repos"); }} />
      </label>
      <button type="button" onClick={enregistrer} disabled={invalide || inchange || etat === "envoi"} className={cn("btn-volt", compact ? "!px-2.5 !py-1 text-sm" : "")}>
        {etat === "envoi" ? <Loader2 size={14} className="animate-spin" /> : etat === "ok" ? <Check size={14} /> : null}
        {etat === "ok" ? "Enregistré" : "Enregistrer"}
      </button>
      {ttc != null && <p className="w-full text-[11px] text-ink-400">
        {base === "ht"
          ? <>= <strong className="text-ink-600">{fmt(ttc)} TTC</strong> enregistré (TVA {TVA_ACHAT_PCT} % ajoutée : non récupérable en franchise, c&apos;est ta vraie dépense)</>
          : <>= {fmt(htDepuisTtc(ttc))} HT · enregistré en <strong className="text-ink-600">TTC</strong> (TVA non récupérable en franchise)</>}
      </p>}
      {invalide && <p className="w-full text-xs text-red-500">Montant invalide (exemple : 123,45).</p>}
      {erreur && <p className="w-full text-xs text-red-500 whitespace-pre-wrap">{erreur}</p>}
    </div>
  );
}
