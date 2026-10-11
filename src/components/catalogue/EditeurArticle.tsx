"use client";
// src/components/catalogue/EditeurArticle.tsx
//
// Briques d'édition d'un article du catalogue, PARTAGÉES entre la page Catalogue et l'ajout rapide du pré-devis : prix d'achat (TTC / HT),
// marge, prix de vente, rentabilité après URSSAF, offres par marque / fournisseur (référence, lien, pièces), conditionnement en bobine.
import { useState } from "react";
import { fmt, cn } from "@/lib/utils";
import { nouvelleOffreDraft, nouvellePieceDraft, totalPiecesDrafts, OffreDraft, PieceDraft } from "@/lib/fournisseurs";
import { Plus, Trash2, AlertCircle, TrendingUp, Gift } from "lucide-react";

export function calcMarge(prixAchat: number, prixVente: number): number | null {
  if (!prixAchat || prixAchat <= 0) return null;
  return Math.round(((prixVente - prixAchat) / prixAchat) * 1000) / 10;
}
export function prixVenteFromMarge(prixAchat: number, margePct: number): number {
  return Math.round(prixAchat * (1 + margePct / 100) * 100) / 100;
}

// ─── Rentabilité mini branche achat-revente (matériau) ─────────────────────
// Taux de cotisations URSSAF appliqué sur le CA encaissé de la branche achat-revente
// (vente de marchandises). Taux officiel 2026 = 12,3% ; on prend 12,5% avec une marge
// de sécurité (arrondi, CFP, évolution de taux). À ajuster ici si le taux officiel change.
export const URSSAF_MATERIAU_PCT = 12.5;

// L'URSSAF prélève sur le prix de vente (le CA), pas sur la marge. Pour être à 0€ de
// rentabilité nette après cotisations, le prix de vente doit couvrir le prix d'achat
// ET la cotisation calculée sur ce prix de vente lui-même :
//   PV = PA / (1 - taux)  →  marge_min% = taux / (1 - taux)
export function margeMiniUrssaf(): number {
  const t = URSSAF_MATERIAU_PCT / 100;
  return Math.round((t / (1 - t)) * 1000) / 10;
}
export function prixVenteMiniUrssaf(prixAchat: number): number | null {
  if (!prixAchat || prixAchat <= 0) return null;
  const t = URSSAF_MATERIAU_PCT / 100;
  return Math.round((prixAchat / (1 - t)) * 100) / 100;
}
// Gain réellement encaissé une fois la cotisation URSSAF retirée. La cotisation porte sur
// le prix de vente (le CA), pas sur la marge — donc gain net = (PV - PA) - PV * taux.
export function gainNetUrssaf(prixAchat: number, prixVente: number): number {
  const cotisation = prixVente * URSSAF_MATERIAU_PCT / 100;
  return Math.round((prixVente - prixAchat - cotisation) * 100) / 100;
}
export function MargeTag({ prixAchat, prixVente }: { prixAchat?: number | null; prixVente: number }) {
  if (!prixAchat || prixAchat <= 0) return null;
  const marge = calcMarge(prixAchat, prixVente);
  if (marge === null) return null;
  if (marge === 0) return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600 font-medium">
      <Gift size={10} /> Cadeau
    </span>
  );
  const color = marge < 0 ? "text-red-600 bg-red-50" : "text-emerald-700 bg-emerald-50";
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium", color)}>
      <TrendingUp size={10} /> {marge > 0 ? "+" : ""}{marge}%
    </span>
  );
}

export function MargeFields({ prixAchat, prixVente, onPrixAchatChange, onPrixVenteChange, typeBranche, achatVerrouille }: {
  prixAchat: string; prixVente: string;
  onPrixAchatChange: (v: string) => void;
  onPrixVenteChange: (v: string) => void;
  typeBranche?: string;
  // Prix d'achat calculé (somme des pièces de l'offre) : affiché mais non modifiable ici.
  achatVerrouille?: boolean;
}) {
  const [margePct, setMargePct] = useState("");
  // Mode de saisie du prix d'achat : "ttc" (par défaut — la plupart des fournisseurs
  // donnent un prix tout compris, ou Ben n'a pas le détail HT) ou "ht" (Ben tape le HT
  // depuis une facture fournisseur, la TVA à 20% est ajoutée automatiquement). Dans les
  // deux cas, ce qui remonte via onPrixAchatChange (donc ce qui est stocké en base et
  // utilisé partout ailleurs — marge ici, rentabilité dans le devis) est TOUJOURS le TTC :
  // en franchise en base de TVA, cette TVA n'est jamais récupérable, c'est la vraie
  // dépense de Ben. Aucune autre logique de calcul n'a besoin de changer.
  const [modeAchat, setModeAchat] = useState<"ttc" | "ht">("ttc");
  const [achatHtSaisi, setAchatHtSaisi] = useState("");

  function recalculerDepuisAchatTTC(nouveauTTC: string) {
    onPrixAchatChange(nouveauTTC);
    if (margePct !== "" && parseFloat(nouveauTTC) > 0) {
      const pv = prixVenteFromMarge(parseFloat(nouveauTTC), parseFloat(margePct) || 0);
      onPrixVenteChange(String(pv));
    }
  }
  function handleAchatTTC(v: string) {
    recalculerDepuisAchatTTC(v);
  }
  function handleAchatHT(v: string) {
    setAchatHtSaisi(v);
    const ht = parseFloat(v);
    const ttc = !isNaN(ht) && ht > 0 ? Math.round(ht * 1.2 * 100) / 100 : 0;
    recalculerDepuisAchatTTC(ttc > 0 ? String(ttc) : "");
  }
  function toggleModeAchat(m: "ttc" | "ht") {
    if (m === "ht" && modeAchat === "ttc") {
      // Bascule TTC -> HT : reconstruit le HT saisi depuis le TTC déjà en mémoire, pour
      // ne rien perdre en changeant simplement de vue (utile en édition d'un article existant).
      const pa = parseFloat(prixAchat);
      setAchatHtSaisi(pa > 0 ? String(Math.round((pa / 1.2) * 100) / 100) : "");
    }
    setModeAchat(m);
  }
  function handleMarge(v: string) {
    setMargePct(v);
    if (parseFloat(prixAchat) > 0) {
      const pv = prixVenteFromMarge(parseFloat(prixAchat), parseFloat(v) || 0);
      onPrixVenteChange(String(pv));
    }
  }
  function handlePrixVente(v: string) {
    onPrixVenteChange(v);
    if (parseFloat(prixAchat) > 0 && parseFloat(v) >= 0) {
      const m = calcMarge(parseFloat(prixAchat), parseFloat(v));
      setMargePct(m !== null ? String(m) : "");
    }
  }
  const pa = parseFloat(prixAchat);
  const pv = parseFloat(prixVente);
  const margeCalc = pa > 0 && pv >= 0 ? calcMarge(pa, pv) : null;
  const isMateriau = typeBranche === "materiau";
  const margeMini = margeMiniUrssaf();
  const pvMini = pa > 0 ? prixVenteMiniUrssaf(pa) : null;
  const sousRentable = isMateriau && margeCalc !== null && margeCalc < margeMini;
  return (
    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="label text-emerald-800 mb-0">Prix d'achat</label>
          <div className="flex rounded-lg border border-emerald-300 overflow-hidden shrink-0">
            <button type="button" onClick={() => toggleModeAchat("ttc")}
              className={cn("px-2 py-0.5 text-xs font-medium transition-colors", modeAchat === "ttc" ? "bg-emerald-700 text-white" : "bg-white text-emerald-700")}>TTC</button>
            <button type="button" onClick={() => toggleModeAchat("ht")}
              className={cn("px-2 py-0.5 text-xs font-medium transition-colors border-l border-emerald-300", modeAchat === "ht" ? "bg-emerald-700 text-white" : "bg-white text-emerald-700")}>HT</button>
          </div>
        </div>
        {achatVerrouille ? (
          <input className="input text-sm text-right bg-ink-50" type="number" readOnly tabIndex={-1} value={prixAchat} />
        ) : modeAchat === "ttc" ? (
          <input className="input text-sm text-right" type="number" step="0.01" placeholder="0.00"
            value={prixAchat} onChange={e => handleAchatTTC(e.target.value)} />
        ) : (
          <input className="input text-sm text-right" type="number" step="0.01" placeholder="0.00"
            value={achatHtSaisi} onChange={e => handleAchatHT(e.target.value)} />
        )}
        <p className="text-xs text-emerald-600 mt-1">
          {achatVerrouille
            ? "Somme des pièces ci-dessous (TTC) — modifie les pièces pour changer ce prix"
            : modeAchat === "ttc"
            ? "Prix payé au fournisseur, TVA incluse — laisser en TTC si le fournisseur ne détaille pas le HT"
            : `TVA 20% ajoutée automatiquement → ${fmt((parseFloat(achatHtSaisi) || 0) * 1.2)} TTC, non récupérable en franchise de TVA`}
        </p>
      </div>
      <div>
        <label className="label text-emerald-800">Marge (%)</label>
        <input className="input text-sm text-right" type="number" step="0.5" placeholder="Ex : 30"
          value={margePct} onChange={e => handleMarge(e.target.value)} />
        <p className="text-xs text-emerald-600 mt-1">0% = cadeau client</p>
      </div>
      <div>
        <label className="label text-emerald-800">Prix de vente HT (€) *</label>
        <input className="input text-sm text-right font-semibold" type="number" step="0.01" placeholder="0.00"
          value={prixVente} onChange={e => handlePrixVente(e.target.value)} />
        {margeCalc !== null && (
          <p className={cn("text-xs mt-1 font-medium",
            margeCalc === 0 ? "text-blue-600" : margeCalc < 0 ? "text-red-500" : "text-emerald-700")}>
            {margeCalc === 0 ? "Offert au client" : `Marge : ${margeCalc > 0 ? "+" : ""}${margeCalc}% · Gain net (après URSSAF ${URSSAF_MATERIAU_PCT}%) : ${fmt(isMateriau ? gainNetUrssaf(pa, pv) : pv - pa)}`}
          </p>
        )}
        {isMateriau && pvMini !== null && (
          <p className={cn("text-xs mt-1", sousRentable ? "text-red-600 font-medium" : "text-emerald-600/70")}>
            {sousRentable ? <AlertCircle size={10} className="inline -mt-0.5 mr-0.5" /> : null}
            Mini après URSSAF ({URSSAF_MATERIAU_PCT}%) : {fmt(pvMini)} (marge ≥ +{margeMini}%)
          </p>
        )}
      </div>
    </div>
  );
}

// Plusieurs offres pour un même produit : une par marque (et par fournisseur), chacune avec sa
// référence, son lien et ses propres prix d'achat / de vente — on ne recrée pas le produit pour
// changer de marque. L'offre « principale » donne le prix par défaut (recopié dans le produit et
// utilisé par le pré-devis tant qu'on n'en choisit pas une autre).
export function FournisseursEditor({ offres, setOffres, fournisseursConnus, marquesConnues, marqueOk, imageOk, imageProduit }: {
  offres: OffreDraft[]; setOffres: (fn: (prev: OffreDraft[]) => OffreDraft[]) => void; fournisseursConnus: string[]; marquesConnues: string[];
  marqueOk: boolean; imageOk: boolean; imageProduit?: string | null;
}) {
  const maj = (cle: string, patch: Partial<OffreDraft>) =>
    setOffres(prev => prev.map(o => (o.cle === cle ? { ...o, ...patch } : o)));
  const definirPrincipal = (cle: string) => setOffres(prev => prev.map(o => ({ ...o, principal: o.cle === cle })));
  // Pièces d'une offre : le prix d'achat de l'offre est recalculé à chaque modification (somme des pièces).
  const majPieces = (cle: string, fn: (pieces: PieceDraft[]) => PieceDraft[]) =>
    setOffres(prev => prev.map(o => {
      if (o.cle !== cle) return o;
      const pieces = fn(o.pieces ?? []);
      const total = pieces.length > 0 ? totalPiecesDrafts(pieces) : null;
      return { ...o, pieces, prixAchat: pieces.length > 0 ? (total != null ? String(total) : "") : o.prixAchat };
    }));
  const ajouter = () => setOffres(prev => [...prev, nouvelleOffreDraft(prev.length === 0)]);
  const retirer = (cle: string) => setOffres(prev => {
    const n = prev.filter(o => o.cle !== cle);
    if (n.length === 0) return [nouvelleOffreDraft(true)];
    return n.some(o => o.principal) ? n : n.map((o, i) => (i === 0 ? { ...o, principal: true } : o));
  });
  const groupe = `principal-${offres[0]?.cle ?? "x"}`;
  return (
    <div className="md:col-span-2 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <label className="label mb-0">Marques, fournisseurs & prix</label>
          <p className="text-xs text-ink-400">Une offre par marque (et par fournisseur), chacune avec son prix d'achat et de vente. Prix de vente vide = prix de l'offre principale.</p>
          {!marqueOk && <p className="text-xs text-amber-600">Saisie des marques indisponible tant que la migration 006_marques_offres.sql n'est pas exécutée dans Supabase.</p>}
          {!imageOk && <p className="text-xs text-amber-600">Image par marque indisponible tant que la migration 007_images_offres.sql n'est pas exécutée dans Supabase.</p>}
        </div>
        <button type="button" onClick={ajouter} className="btn-ghost !px-3 text-xs shrink-0"><Plus size={13} /> Marque / fournisseur</button>
      </div>
      <datalist id="fournisseurs-connus">
        {fournisseursConnus.map(f => <option key={f} value={f} />)}
      </datalist>
      <datalist id="marques-connues">
        {marquesConnues.map(m => <option key={m} value={m} />)}
      </datalist>
      {offres.map(o => (
        <div key={o.cle} className={cn("rounded-xl border p-3 space-y-3", o.principal ? "border-volt-400 bg-volt-50/30" : "border-ink-200 bg-white")}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <label className="label">Marque</label>
              <input className="input text-sm" list="marques-connues" placeholder="Ex : Legrand, Schneider…"
                disabled={!marqueOk} value={o.marque} onChange={e => maj(o.cle, { marque: e.target.value })} />
            </div>
            <div>
              <label className="label">Fournisseur</label>
              <input className="input text-sm" list="fournisseurs-connus" placeholder="Ex : Rexel, Leroy Merlin…"
                value={o.fournisseur} onChange={e => maj(o.cle, { fournisseur: e.target.value })} />
            </div>
            <div>
              <label className="label">Référence</label>
              <input className="input text-sm" placeholder="Réf. fournisseur"
                value={o.reference} onChange={e => maj(o.cle, { reference: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">Lien du produit chez ce fournisseur</label>
            <input className="input text-sm" placeholder="https://www.leroymerlin.fr/…"
              value={o.url} onChange={e => maj(o.cle, { url: e.target.value })} />
          </div>
          <div>
            <label className="label">Image de cette marque (URL)</label>
            <div className="flex items-center gap-2">
              <input className="input text-sm flex-1" placeholder={imageProduit ? "Vide = image du produit" : "https://…/photo.jpg"}
                disabled={!imageOk} value={o.imageUrl} onChange={e => maj(o.cle, { imageUrl: e.target.value })} />
              {(o.imageUrl.trim() || imageProduit) && (
                <img src={o.imageUrl.trim() || imageProduit || ""} alt=""
                  className={cn("h-10 w-10 shrink-0 object-contain rounded-lg border border-ink-100 p-0.5 bg-white", !o.imageUrl.trim() && "opacity-50")}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              )}
            </div>
          </div>
          <div className="rounded-lg border border-dashed border-ink-200 p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <label className="label mb-0">Pièces à acheter pour cet article fini</label>
                <p className="text-xs text-ink-400">Si ce fournisseur vend l'article en plusieurs morceaux (ex. mécanisme + enjoliveur), liste-les : le prix d'achat devient leur somme.</p>
              </div>
              <button type="button" onClick={() => majPieces(o.cle, ps => [...ps, nouvellePieceDraft()])}
                className="btn-ghost !px-3 text-xs shrink-0"><Plus size={13} /> Pièce</button>
            </div>
            {(o.pieces ?? []).length > 0 && (
              <div className="space-y-1.5">
                <div className="hidden md:grid grid-cols-[3fr_2fr_70px_100px_28px] gap-2 text-[11px] text-ink-400 px-0.5">
                  <span>Pièce</span><span>Référence</span><span className="text-right">Qté</span><span className="text-right">Prix achat TTC</span><span />
                </div>
                {(o.pieces ?? []).map(pc => (
                  <div key={pc.cle} className="grid grid-cols-2 md:grid-cols-[3fr_2fr_70px_100px_28px] gap-2 items-center">
                    <input className="input text-sm col-span-2 md:col-span-1" placeholder="Ex : Mécanisme, Plaque…"
                      value={pc.nom} onChange={e => majPieces(o.cle, ps => ps.map(x => x.cle === pc.cle ? { ...x, nom: e.target.value } : x))} />
                    <input className="input text-sm" placeholder="Réf."
                      value={pc.reference} onChange={e => majPieces(o.cle, ps => ps.map(x => x.cle === pc.cle ? { ...x, reference: e.target.value } : x))} />
                    <input className="input text-sm text-right" type="number" min="0" step="1" placeholder="Qté"
                      value={pc.quantite} onChange={e => majPieces(o.cle, ps => ps.map(x => x.cle === pc.cle ? { ...x, quantite: e.target.value } : x))} />
                    <input className="input text-sm text-right" type="number" step="0.01" placeholder="0.00"
                      value={pc.prixAchat} onChange={e => majPieces(o.cle, ps => ps.map(x => x.cle === pc.cle ? { ...x, prixAchat: e.target.value } : x))} />
                    <button type="button" aria-label="Retirer la pièce" onClick={() => majPieces(o.cle, ps => ps.filter(x => x.cle !== pc.cle))}
                      className="text-red-500 hover:text-red-700 justify-self-end"><Trash2 size={14} /></button>
                  </div>
                ))}
                {totalPiecesDrafts(o.pieces ?? []) == null && (
                  <p className="text-xs text-amber-600">Renseigne le prix de chaque pièce pour obtenir le prix d'achat de l'article.</p>
                )}
              </div>
            )}
          </div>
          <MargeFields prixAchat={o.prixAchat} prixVente={o.prixVente} typeBranche="materiau"
            achatVerrouille={(o.pieces ?? []).length > 0}
            onPrixAchatChange={v => maj(o.cle, { prixAchat: v })}
            onPrixVenteChange={v => maj(o.cle, { prixVente: v })} />
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-ink-600 cursor-pointer">
              <input type="radio" name={groupe} checked={o.principal} onChange={() => definirPrincipal(o.cle)} />
              Offre principale (prix par défaut)
            </label>
            {offres.length > 1 && (
              <button type="button" onClick={() => retirer(o.cle)} className="text-xs text-red-500 hover:text-red-700 inline-flex items-center gap-1">
                <Trash2 size={12} /> Retirer
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function longueurValide(actif: boolean, saisie: string): number | null {
  if (!actif) return null;
  const n = parseFloat(saisie.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Bascule « Vendu en bobine / rouleau » + champ longueur (visible seulement si activé).
export function BobineField({ actif, setActif, longueur, setLongueur, small }: {
  actif: boolean; setActif: (v: boolean) => void; longueur: string; setLongueur: (v: string) => void; small?: boolean;
}) {
  return (
    <div>
      <label className="label">Conditionnement</label>
      <label className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer select-none">
        <input type="checkbox" checked={actif} onChange={e => setActif(e.target.checked)} />
        Vendu en bobine / rouleau (longueur fixe)
      </label>
      {actif ? (
        <input className={small ? "input text-sm mt-1.5" : "input mt-1.5"} type="number" min="0" step="any"
          placeholder="Longueur (m) — ex : 25" value={longueur} onChange={e => setLongueur(e.target.value)} />
      ) : (
        <p className="text-xs text-ink-400 mt-1">Désactivé : vendu au mètre / à l'unité, rien n'apparaît sur le devis.</p>
      )}
    </div>
  );
}

