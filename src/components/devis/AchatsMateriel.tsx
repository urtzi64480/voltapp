"use client";
// Achats RÉELS de matériel d'un devis : plusieurs achats possibles (table devis_achats, migration 018), chacun avec montant, jour payé et fournisseur.
// Le montant se saisit en TTC (ticket de caisse) ou en HT ; il est TOUJOURS enregistré en TTC : en franchise en base de TVA, la TVA payée au
// fournisseur n'est pas récupérable, c'est la vraie dépense (même base que les prix d'achat du catalogue). Le jour payé décide du mois.
import { useState } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { htDepuisTtc, lireAchat, lireMontant, lireMontantTtc, SQL_MIGRATION_ACHATS, SQL_MIGRATION_ARTICLE, ttcDepuisHt, TVA_ACHAT_PCT, type AchatLigne, type BaseMontant } from "@/lib/depenses-materiel";
import { ecartArticle, tonEcart } from "@/lib/courses-achats";
import { cn, dateLocale, fmt, fmtDate } from "@/lib/utils";

const COLONNES = "id,devis_id,montant,date_achat,fournisseur";
// Base de saisie mémorisée sur cet appareil (commodité) : par défaut HT, les fournisseurs pros vendent en HT.
const CLE_BASE = "voltapp.achat.base";
function baseMemorisee(): BaseMontant { try { return window.localStorage.getItem(CLE_BASE) === "ttc" ? "ttc" : "ht"; } catch { return "ht"; } }
function memoriserBase(b: BaseMontant) { try { window.localStorage.setItem(CLE_BASE, b); } catch { /* stockage indisponible : sans importance */ } }
const texte = (n: number) => String(n).replace(".", ",");
const jourAffiche = (d: string) => (d ? fmtDate(`${d}T12:00:00`) : "date ?");

/** Ajout (sans `achat`) ou modification (avec `achat`) d'un achat.
 *  `article` : nom d'un article de la liste de courses (achat rattaché à cet article). `fournisseurFixe` : fournisseur imposé (champ masqué).
 *  `libelle` : texte du bouton d'ajout. `simple` : montant seulement (jour et fournisseur inchangés : aujourd'hui ou ceux de l'achat).
 *  Base de saisie : la dernière utilisée (HT au départ). En modification le montant s'affiche dans cette base ; tant qu'on n'y touche pas,
 *  la valeur TTC enregistrée est conservée au centime (aucune dérive due à l'aller-retour HT/TTC). */
export function FormulaireAchat({ devisId, achat, article, fournisseurFixe, libelle, simple = false, onSaved, onCancel, compact = false }: {
  devisId: string; achat?: AchatLigne; article?: string; fournisseurFixe?: string; libelle?: string; simple?: boolean;
  onSaved: (a: AchatLigne) => void; onCancel?: () => void; compact?: boolean;
}) {
  // Lecture du stockage à l'initialisation : ces formulaires ne sont affichés qu'après le chargement des données (jamais au rendu serveur).
  const [base, setBase] = useState<BaseMontant>(() => (typeof window === "undefined" ? "ht" : baseMemorisee()));
  const [initial] = useState(() => (achat ? { base: typeof window === "undefined" ? "ht" as BaseMontant : baseMemorisee(), ttc: achat.montant } : null));
  const [montant, setMontant] = useState(() => {
    if (!achat) return "";
    return texte(initial?.base === "ht" ? htDepuisTtc(achat.montant) : achat.montant);
  });
  const [texteInitial] = useState(montant);   // texte affiché à l'ouverture
  const [jour, setJour] = useState(achat?.date || dateLocale());
  const [fournisseur, setFournisseur] = useState(achat?.fournisseur ?? "");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const montantLu = lireMontant(montant);
  // Montant intact depuis l'ouverture (même texte, même base) : on garde le TTC enregistré tel quel.
  const intact = initial != null && montant === texteInitial && base === initial.base;
  const ttc = intact ? initial.ttc : lireMontantTtc(montant, base);
  const vide = montant.trim() === "";
  const invalide = !vide && montantLu == null;
  const pret = ttc != null && !!jour && !envoi;   // `jour` est toujours renseigné (aujourd'hui par défaut)

  // Changer de base convertit le montant déjà tapé (1 000 € TTC ↔ 833,33 € HT) au lieu de le réinterpréter.
  function changerBase(b: BaseMontant) {
    if (b === base) return;
    if (montantLu != null) setMontant(texte(b === "ht" ? htDepuisTtc(montantLu) : ttcDepuisHt(montantLu)));
    setBase(b);
    memoriserBase(b);
  }

  async function enregistrer() {
    if (!pret || ttc == null) return;
    setEnvoi(true); setErreur(null);
    const valeurs = { montant: ttc, date_achat: jour, fournisseur: (fournisseurFixe ?? fournisseur).trim() || null };
    const r = achat
      ? await supabase.from("devis_achats").update(valeurs).eq("id", achat.id).select(COLONNES).single()
      : await supabase.from("devis_achats").insert({ devis_id: devisId, ...valeurs, ...(article ? { article } : {}) }).select(COLONNES).single();
    setEnvoi(false);
    if (r.error) {
      setErreur(/article/i.test(r.error.message) ? "Colonne absente : lance d'abord dans Supabase (SQL Editor) la migration 019 :\n" + SQL_MIGRATION_ARTICLE
        : /devis_achats/i.test(r.error.message) ? "Table absente : lance d'abord dans Supabase (SQL Editor) la migration 018 :\n" + SQL_MIGRATION_ACHATS : r.error.message);
      return;
    }
    const lu = lireAchat({ ...(r.data as object), article: achat?.article ?? article ?? "" });
    if (!lu) { setErreur("Réponse inattendue du serveur : recharge la page."); return; }
    onSaved(lu);
    if (!achat) { setMontant(""); setFournisseur(""); setJour(dateLocale()); }
  }

  const petit = compact ? "text-[10px]" : "text-xs";
  return (
    <div className={cn("flex flex-wrap items-end gap-2", compact && "gap-1.5")}>
      <div className="block">
        <span className={cn("flex items-center gap-1 text-ink-400", petit)}>Montant payé
          <span className="inline-flex rounded-md border border-ink-200 overflow-hidden ml-1" role="group" aria-label="Base du montant">
            {(["ttc", "ht"] as const).map(b => (
              <button key={b} type="button" onClick={() => changerBase(b)} aria-pressed={base === b}
                className={cn("px-1.5 py-px uppercase font-semibold", base === b ? "bg-volt-500 text-white" : "bg-white text-ink-500 hover:bg-ink-50")}>{b}</button>
            ))}
          </span>
        </span>
        <input inputMode="decimal" className={cn("input", compact ? "!py-1 !px-2 w-28 text-sm" : "w-36", invalide && "!border-red-400")} placeholder="0,00" value={montant}
          onChange={e => setMontant(e.target.value)} onKeyDown={e => { if (e.key === "Enter") enregistrer(); }} aria-invalid={invalide}
          aria-label={`Montant payé en ${base.toUpperCase()}`} />
      </div>
      {!simple && <label className="block">
        <span className={cn("block text-ink-400", petit)}>Jour payé</span>
        <input type="date" className={cn("input", compact ? "!py-1 !px-2 text-sm" : "")} value={jour} onChange={e => setJour(e.target.value)}
          title="Le jour où tu as payé décide du mois (et du virement à faire)." />
      </label>}
      {!simple && fournisseurFixe === undefined && (
        <label className="block">
          <span className={cn("block text-ink-400", petit)}>Fournisseur (facultatif)</span>
          <input className={cn("input", compact ? "!py-1 !px-2 w-32 text-sm" : "w-40")} value={fournisseur} onChange={e => setFournisseur(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") enregistrer(); }} maxLength={60} placeholder="Ex. Rexel" />
        </label>
      )}
      <button type="button" onClick={enregistrer} disabled={!pret} className={cn("btn-volt", compact ? "!px-2.5 !py-1 text-sm" : "")}>
        {envoi ? <Loader2 size={14} className="animate-spin" /> : achat ? <Check size={14} /> : <Plus size={14} />}
        {achat ? "Enregistrer" : (libelle ?? "Ajouter l'achat")}
      </button>
      {onCancel && <button type="button" onClick={onCancel} className={cn("btn-ghost", compact ? "!px-2.5 !py-1 text-sm" : "")}>Annuler</button>}
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

/** Une ligne d'achat : date, fournisseur, montant TTC ; modifier, supprimer (en deux temps), et ajouter un autre achat au même devis. */
export function LigneAchat({ achat, detail, compact = false, simple = false, prevuTtc = null, onUpdated, onDeleted, onAdded }: {
  achat: AchatLigne; detail?: React.ReactNode; compact?: boolean;
  /** Modification du montant seul (liste de courses). */
  simple?: boolean;
  /** Prix d'achat prévu de l'article : affiche le prévu et l'écart (payé − prévu) en TTC et HT. */
  prevuTtc?: number | null;
  onUpdated: (a: AchatLigne) => void; onDeleted: (id: string) => void; onAdded?: (a: AchatLigne) => void;
}) {
  const [mode, setMode] = useState<"vue" | "edition" | "ajout" | "confirmer">("vue");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const enCreation = achat.id.startsWith("tmp-");   // pas encore confirmé par le serveur : on n'y touche pas
  const ecart = prevuTtc != null ? ecartArticle(achat.montant, prevuTtc) : null;
  const ton = ecart ? tonEcart(ecart.ttc) : "neutre";
  const signe = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt(Math.abs(n))}`;

  async function supprimer() {
    setEnvoi(true); setErreur(null);
    const { error } = await supabase.from("devis_achats").delete().eq("id", achat.id);
    setEnvoi(false);
    if (error) { setErreur(error.message); setMode("vue"); return; }
    onDeleted(achat.id);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-ink-500 tabular-nums">{jourAffiche(achat.date)}</span>
        {detail}
        {achat.article && <span className="text-ink-500 truncate max-w-[14rem]">{achat.article}</span>}
        {achat.fournisseur && <span className="text-ink-400">{achat.fournisseur}</span>}
        <span className="ml-auto font-semibold tabular-nums">{fmt(achat.montant)} <span className="text-[11px] font-normal text-ink-400">TTC · {fmt(htDepuisTtc(achat.montant))} HT</span></span>
        <span className="flex items-center gap-1">
          {mode === "confirmer" ? (
            <>
              <button type="button" onClick={supprimer} disabled={envoi} className="btn-ghost !px-2 !py-1 text-xs text-red-600">{envoi ? "…" : "Supprimer l'achat"}</button>
              <button type="button" onClick={() => setMode("vue")} className="btn-ghost !px-2 !py-1 text-xs" aria-label="Annuler"><X size={13} /></button>
            </>
          ) : (
            <>
              {onAdded && <button type="button" onClick={() => setMode(m => (m === "ajout" ? "vue" : "ajout"))} className="btn-ghost !px-2 !py-1 text-xs" title="Ajouter un autre achat pour ce devis"><Plus size={13} /></button>}
              <button type="button" disabled={enCreation} onClick={() => setMode(m => (m === "edition" ? "vue" : "edition"))} className="btn-ghost !px-2 !py-1 text-xs" title="Modifier" aria-label="Modifier l'achat"><Pencil size={13} /></button>
              <button type="button" disabled={enCreation} onClick={() => setMode("confirmer")} className="btn-ghost !px-2 !py-1 text-xs" title="Supprimer" aria-label="Supprimer l'achat"><Trash2 size={13} /></button>
            </>
          )}
        </span>
      </div>
      {ecart && prevuTtc != null && (
        <p className="text-[11px] text-ink-400 tabular-nums">
          prévu {fmt(prevuTtc)} TTC · {fmt(htDepuisTtc(prevuTtc))} HT
          <span className={cn("ml-2 font-semibold", ton === "economie" ? "text-emerald-700" : ton === "surcout" ? "text-red-600" : "text-ink-500")}>
            {ton === "neutre" ? "= prévu" : `${ton === "economie" ? "économie" : "surcoût"} ${signe(ecart.ttc)} TTC · ${signe(ecart.ht)} HT`}
          </span>
        </p>
      )}
      {mode === "edition" && <FormulaireAchat simple={simple} compact={compact} devisId={achat.devisId} achat={achat} onSaved={a => { onUpdated(a); setMode("vue"); }} onCancel={() => setMode("vue")} />}
      {mode === "ajout" && onAdded && <FormulaireAchat compact={compact} devisId={achat.devisId} onSaved={a => { onAdded(a); setMode("vue"); }} onCancel={() => setMode("vue")} />}
      {erreur && <p className="text-xs text-red-500">{erreur}</p>}
    </div>
  );
}

/** Tous les achats d'un devis + total + ajout (fiche du devis). */
export default function AchatsDevis({ devisId, achats, onAdded, onUpdated, onDeleted }: {
  devisId: string; achats: AchatLigne[];
  onAdded: (a: AchatLigne) => void; onUpdated: (a: AchatLigne) => void; onDeleted: (id: string) => void;
}) {
  const total = Math.round(achats.reduce((t, a) => t + a.montant, 0) * 100) / 100;
  const tries = [...achats].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="flex flex-col gap-2">
      {tries.length > 0 && (
        <ul className="flex flex-col gap-2 divide-y divide-ink-100">
          {tries.map(a => <li key={a.id} className="pt-2 first:pt-0"><LigneAchat achat={a} compact onUpdated={onUpdated} onDeleted={onDeleted} /></li>)}
          <li className="pt-2 flex justify-between text-sm"><span className="text-ink-500">Total dépensé (TTC)</span><span className="font-bold tabular-nums">{fmt(total)}</span></li>
        </ul>
      )}
      <FormulaireAchat compact devisId={devisId} onSaved={onAdded} />
    </div>
  );
}
