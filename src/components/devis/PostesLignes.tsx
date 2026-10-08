"use client";
// Éditeur des lignes d'un devis : une page vierge où l'on ajoute des POSTES (regroupements libres)
// et des PRODUITS directement. « Ajouter un produit » ouvre une sur-fenêtre avec recherche et
// filtres (ProduitPicker) pour choisir le bon produit ET le bon fournisseur.
//
// Sur chaque ligne : changer de fournisseur (le prix suit l'offre choisie) ou changer carrément
// de produit — y compris sur un devis issu d'un pré-devis.
//
// Utilisé par « Nouveau devis » et par l'édition d'un devis existant (devis/[id]).

import { useEffect, useMemo, useState } from "react";
import { Plus, X, Trash2, Layers, RefreshCw, Package } from "lucide-react";
import { fmt, cn, UNITES } from "@/lib/utils";
import { grouperParPoste, memeNomPoste, nettoyerNomPoste, posteDe, totalItems } from "@/lib/postes";
import { libelleOffreMarque, margePct, offresTriees, prixVenteOffre } from "@/lib/fournisseurs";
import {
  changerFournisseurLigne, fusionnerLigne, ligneDepuisArticle, ligneDepuisKit, remplacerProduitLigne,
} from "@/lib/devis-lignes";
import ProduitPicker, { PrestationPicker } from "@/components/devis/ProduitPicker";
import LigneImage from "@/components/devis/LigneImage";
import { estLigneACompleter } from "@/lib/devis-lignes";
import type { DevisLigne, PrestationFournisseur } from "@/types";

type SetLignes = (fn: (prev: any[]) => any[]) => void;
type SetPostes = (fn: (prev: string[]) => string[]) => void;

interface Props {
  lignes: DevisLigne[];
  setLignes: SetLignes;
  postes: string[];
  setPostes: SetPostes;
  // Catalogue complet, offres fournisseurs attachées (voir attacherFournisseurs).
  prestations: PrestationPicker[];
  showUnite?: boolean;
  texteVide?: string;
}

type EtatPicker = { type: "ajout"; poste: string | null } | { type: "remplacement"; index: number };

// ─── Sous-composants (hors du composant principal : pas de perte de focus) ──────────────────

// Titre de poste éditable : la modification est validée à la sortie du champ / Entrée.
function PosteTitre({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [val, setVal] = useState(value);
  useEffect(() => { setVal(value); }, [value]);
  return (
    <input
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={() => onCommit(val)}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="flex-1 min-w-0 font-semibold text-sm text-white bg-transparent border-b border-transparent focus:border-white/40 outline-none"
    />
  );
}

function FormLibre({ onAjouter, onAnnuler }: { onAjouter: (l: DevisLigne) => void; onAnnuler: () => void }) {
  const [nom, setNom] = useState("");
  const [prix, setPrix] = useState("");
  const [unite, setUnite] = useState<string>("forfait");
  const [branche, setBranche] = useState<"service" | "materiau">("service");
  function valider() {
    const p = parseFloat(prix);
    if (!nom.trim() || isNaN(p)) return;
    onAjouter({ nom: nom.trim(), prix_unitaire: p, quantite: 1, unite, type_branche: branche });
  }
  return (
    <div className="p-3 bg-ink-50 rounded-xl border border-ink-100 space-y-2">
      <input className="input text-sm" placeholder="Désignation" autoFocus value={nom} onChange={e => setNom(e.target.value)} />
      <div className="grid grid-cols-3 gap-2">
        <input className="input text-sm" type="number" placeholder="Prix €" value={prix} onChange={e => setPrix(e.target.value)} />
        <select className="input text-sm" value={unite} onChange={e => setUnite(e.target.value)}>
          {UNITES.map(u => <option key={u}>{u}</option>)}
        </select>
        <select className="input text-sm" value={branche} onChange={e => setBranche(e.target.value as "service" | "materiau")}>
          <option value="service">Service</option>
          <option value="materiau">Matériau</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button onClick={onAnnuler} className="btn-ghost flex-1 justify-center text-sm">Annuler</button>
        <button onClick={valider} className="btn-volt flex-1 justify-center text-sm"><Plus size={14} /> Ajouter la ligne</button>
      </div>
    </div>
  );
}

function LigneRow({ l, i, setLignes, showUnite, postes, produit, onChanger }: {
  l: DevisLigne; i: number; setLignes: SetLignes; showUnite?: boolean; postes: string[];
  produit?: PrestationPicker; onChanger: (index: number) => void;
}) {
  const estKit = l.kit_ratio_service != null;
  const offres = offresTriees(produit?.fournisseurs);
  const fournisseurInconnu = !!l.fournisseur_id && !offres.some(o => o.id === l.fournisseur_id);
  const marge = !estKit && l.type_branche === "materiau" ? margePct(l.prix_achat, l.prix_unitaire) : null;

  function choisirFournisseur(id: string) {
    if (!produit) return;
    const offre: PrestationFournisseur | null = offres.find(o => o.id === id) ?? null;
    setLignes(prev => prev.map((x, idx) => idx === i ? changerFournisseurLigne(x, produit, offre) : x));
  }

  return (
    <div className="rounded-xl bg-white border border-ink-100 p-3 flex flex-col md:flex-row md:items-start gap-2 md:gap-4">
      <div className="flex items-start gap-2 flex-1 min-w-0">
        {estKit ? (
          <span className="inline-flex items-center gap-1 badge text-xs shrink-0 bg-purple-100 text-purple-700 mt-0.5"><Layers size={10} /> KIT</span>
        ) : (
          <span className={cn("badge text-xs shrink-0 mt-0.5", l.type_branche === "service" ? "bg-volt-100 text-volt-700" : "bg-emerald-100 text-emerald-700")}>
            {l.type_branche === "service" ? "S" : "M"}
          </span>
        )}
        <LigneImage url={l.image_url} taille={44} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className={cn("text-sm break-words", estLigneACompleter(l) ? "text-red-600 font-semibold" : "text-ink-900")}>{l.nom}</p>
          {l.description && <p className="text-xs text-ink-400 line-clamp-2">{l.description}</p>}
          {l.kit_description && <p className="text-xs text-ink-400 italic line-clamp-2">{l.kit_description}</p>}
          {estKit && (
            <p className="text-xs text-purple-400">
              Ventilation : {fmt(l.prix_unitaire * l.quantite * (l.kit_ratio_service ?? 0))} service · {fmt(l.prix_unitaire * l.quantite * (1 - (l.kit_ratio_service ?? 0)))} matériaux
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {offres.length >= 2 && produit ? (
              <label className="flex items-center gap-1.5 text-xs text-ink-500">
                <span className="shrink-0">Marque · fournisseur</span>
                <select value={l.fournisseur_id ?? ""} onChange={e => choisirFournisseur(e.target.value)}
                  className={cn("max-w-[15rem] text-xs border rounded-lg py-1 px-1.5 bg-white",
                    l.fournisseur_id ? "border-ink-200" : "border-amber-300 bg-amber-50")}>
                  {!l.fournisseur_id && <option value="">Non précisé</option>}
                  {fournisseurInconnu && <option value={l.fournisseur_id ?? ""}>{l.fournisseur_nom ?? "Fournisseur"} (retiré du catalogue)</option>}
                  {offres.map(o => <option key={o.id} value={o.id}>{libelleOffreMarque(produit, o)} — {fmt(prixVenteOffre(produit, o))}</option>)}
                </select>
              </label>
            ) : l.fournisseur_nom ? (
              <span className="text-xs text-ink-500">Fournisseur : <span className="font-medium text-ink-700">{l.fournisseur_nom}</span></span>
            ) : null}

            {marge !== null && (
              <span className={cn("text-xs", marge < 0 ? "text-red-500" : "text-ink-400")}>
                achat {fmt(l.prix_achat ?? 0)} · marge {marge > 0 ? "+" : ""}{marge}%
              </span>
            )}

            {postes.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-ink-500">
                <span className="shrink-0">Poste</span>
                <select
                  value={posteDe(l) ?? ""}
                  onChange={e => {
                    const cible = e.target.value === "" ? null : e.target.value;
                    setLignes(prev => prev.map((x, idx) => idx === i ? { ...x, poste: cible } : x));
                  }}
                  className="max-w-[12rem] text-xs border border-ink-200 rounded-lg py-1 px-1.5 bg-white">
                  <option value="">Hors poste</option>
                  {postes.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 pl-7 md:pl-0 md:shrink-0">
        {showUnite && <span className="text-xs text-ink-400 shrink-0">{l.unite}</span>}
        <ChampQuantite valeur={l.quantite}
          onChange={q => setLignes(prev => prev.map((x, idx) => idx === i ? { ...x, quantite: q } : x))} />
        <span className="text-xs text-ink-400 shrink-0">×</span>
        <input type="number" min="0" step="0.5" value={l.prix_unitaire}
          onChange={e => setLignes(prev => prev.map((x, idx) => idx === i ? { ...x, prix_unitaire: parseFloat(e.target.value) || 0 } : x))}
          className="w-20 shrink-0 text-right text-sm border border-ink-200 rounded-lg py-1.5 bg-white" />
        <span className="text-sm font-semibold text-ink-900 w-20 text-right shrink-0">{fmt(l.prix_unitaire * l.quantite)}</span>
        {!estKit && (
          <button onClick={() => onChanger(i)} title="Changer de produit ou de fournisseur"
            className="p-1.5 rounded-lg text-ink-400 hover:bg-volt-50 hover:text-volt-600 transition-colors shrink-0"><RefreshCw size={14} /></button>
        )}
        <button onClick={() => setLignes(p => p.filter((_, idx) => idx !== i))} title="Supprimer la ligne"
          className="p-1.5 rounded-lg text-ink-300 hover:bg-red-50 hover:text-red-500 transition-colors shrink-0"><X size={14} /></button>
      </div>
    </div>
  );
}

// Quantité d'une ligne : accepte les demi-unités (0,5 h de main d'œuvre, etc.). Le texte saisi est
// gardé localement pour pouvoir taper « 0 » puis « 0,5 » sans être remplacé par 1 ; la quantité de
// la ligne n'est mise à jour que pour une valeur > 0, et une saisie invalide est annulée à la sortie.
function ChampQuantite({ valeur, onChange }: { valeur: number; onChange: (q: number) => void }) {
  const [texte, setTexte] = useState(String(valeur));
  const lire = (s: string) => parseFloat(s.replace(",", "."));
  useEffect(() => {
    if (lire(texte) !== valeur) setTexte(String(valeur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valeur]);
  return (
    <input type="number" inputMode="decimal" min="0.5" step="0.5" value={texte}
      onChange={e => {
        setTexte(e.target.value);
        const n = lire(e.target.value);
        if (Number.isFinite(n) && n > 0) onChange(n);
      }}
      onBlur={() => { const n = lire(texte); if (!(Number.isFinite(n) && n > 0)) setTexte(String(valeur)); }}
      className="w-16 shrink-0 text-center text-sm border border-ink-200 rounded-lg py-1.5 bg-white" />
  );
}

function BoutonsAjout({ onProduit, onLibre }: { onProduit: () => void; onLibre: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={onProduit} className="flex-1 min-w-[10rem] inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-ink-200 hover:border-volt-400 hover:bg-volt-50 text-ink-600 hover:text-volt-700 text-sm font-medium py-2.5 transition-all">
        <Package size={14} /> Ajouter un produit
      </button>
      <button onClick={onLibre} className="inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-ink-200 hover:border-ink-300 hover:bg-ink-50 text-ink-500 text-sm font-medium px-4 py-2.5 transition-all">
        <Plus size={14} /> Ligne libre
      </button>
    </div>
  );
}

// ─── Composant principal ────────────────────────────────────────────────────

export default function PostesLignes({ lignes, setLignes, postes, setPostes, prestations, showUnite, texteVide }: Props) {
  const [nouveauPoste, setNouveauPoste] = useState<string | null>(null);
  const [erreur, setErreur] = useState("");
  const [picker, setPicker] = useState<EtatPicker | null>(null);
  const [libreCible, setLibreCible] = useState<{ poste: string | null } | null>(null);

  const parId = useMemo(() => new Map(prestations.map(p => [p.id, p])), [prestations]);

  function ajouterPoste() {
    const nom = nettoyerNomPoste(nouveauPoste ?? "");
    if (!nom) return;
    if (postes.some(p => memeNomPoste(p, nom))) { setErreur("Ce poste existe déjà."); return; }
    setPostes(prev => [...prev, nom]);
    setNouveauPoste(null);
    setErreur("");
  }

  function supprimerPoste(nom: string) {
    setLignes(prev => prev.filter(l => posteDe(l) !== nom));
    setPostes(prev => prev.filter(p => p !== nom));
  }

  function renommerPoste(ancien: string, saisie: string) {
    const nom = nettoyerNomPoste(saisie);
    if (!nom || nom === ancien) return;
    if (postes.some(p => p !== ancien && memeNomPoste(p, nom))) return;
    setPostes(prev => prev.map(p => (p === ancien ? nom : p)));
    setLignes(prev => prev.map(l => (posteDe(l) === ancien ? { ...l, poste: nom } : l)));
  }

  async function ajouterProduit(p: PrestationPicker, offre: PrestationFournisseur | null, poste: string | null) {
    const ligne = p.est_kit ? await ligneDepuisKit(p, poste) : ligneDepuisArticle(p, offre, poste);
    setLignes(prev => fusionnerLigne(prev, ligne));
  }

  function remplacerProduit(index: number, p: PrestationPicker, offre: PrestationFournisseur | null) {
    setLignes(prev => prev.map((x, i) => i === index ? remplacerProduitLigne(x, p, offre) : x));
  }

  const avecPostes = postes.length > 0;
  const blocs = grouperParPoste(lignes, { postes, inclureVides: true });
  const horsPoste = blocs.find(b => b.poste === null)?.items ?? [];
  const vide = lignes.length === 0 && !avecPostes;

  const ligneEnRemplacement = picker?.type === "remplacement" ? lignes[picker.index] : undefined;
  const produitEnRemplacement = ligneEnRemplacement?.prestation_id ? parId.get(ligneEnRemplacement.prestation_id) : undefined;

  const rowProps = (i: number) => ({
    i, setLignes, showUnite, postes,
    produit: lignes[i]?.prestation_id ? parId.get(lignes[i].prestation_id as string) : undefined,
    onChanger: (index: number) => setPicker({ type: "remplacement", index }),
  });

  const formNouveauPoste = nouveauPoste !== null && (
    <div className="p-3 rounded-xl bg-ink-50 border border-ink-100 space-y-1.5">
      <div className="flex gap-2">
        <input autoFocus className="input text-sm flex-1 min-w-0" placeholder="Nom du poste (ex : Pose d'une prise)"
          value={nouveauPoste} onChange={e => { setNouveauPoste(e.target.value); setErreur(""); }}
          onKeyDown={e => { if (e.key === "Enter") ajouterPoste(); if (e.key === "Escape") { setNouveauPoste(null); setErreur(""); } }} />
        <button onClick={ajouterPoste} className="btn-volt !px-3 text-sm shrink-0"><Plus size={14} /> Créer</button>
        <button onClick={() => { setNouveauPoste(null); setErreur(""); }} className="btn-ghost !px-3 text-sm shrink-0">Annuler</button>
      </div>
      {erreur && <p className="text-xs text-red-500">{erreur}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      {vide ? (
        <div className="rounded-2xl border-2 border-dashed border-ink-200 bg-ink-50/40 px-4 py-14 text-center">
          <p className="text-ink-500 text-sm mb-1">{texteVide ?? "Page vierge"}</p>
          <p className="text-ink-400 text-xs mb-5">Crée un poste pour regrouper des lignes, ou ajoute directement un produit.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button onClick={() => setNouveauPoste("")} className="btn-ghost"><Plus size={15} /> Ajouter un poste</button>
            <button onClick={() => setPicker({ type: "ajout", poste: null })} className="btn-volt"><Package size={15} /> Ajouter un produit</button>
            <button onClick={() => setLibreCible({ poste: null })} className="btn-ghost"><Plus size={15} /> Ligne libre</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setNouveauPoste("")} className="btn-ghost"><Plus size={15} /> Ajouter un poste</button>
          <button onClick={() => setPicker({ type: "ajout", poste: null })} className="btn-volt"><Package size={15} /> Ajouter un produit</button>
          <button onClick={() => setLibreCible({ poste: null })} className="btn-ghost"><Plus size={15} /> Ligne libre</button>
        </div>
      )}

      {formNouveauPoste}

      {libreCible?.poste === null && (
        <FormLibre onAnnuler={() => setLibreCible(null)}
          onAjouter={l => { setLignes(prev => [...prev, { ...l, poste: null }]); setLibreCible(null); }} />
      )}

      {!avecPostes && lignes.length > 0 && (
        <div className="space-y-2">
          {lignes.map((l, i) => <LigneRow key={i} l={l} {...rowProps(i)} />)}
        </div>
      )}

      {avecPostes && (
        <div className="space-y-4">
          {blocs.filter(b => b.poste !== null).map(b => {
            const nom = b.poste as string;
            return (
              <div key={nom} className="rounded-2xl border border-ink-200 overflow-hidden bg-ink-50/40">
                <div className="flex items-center gap-3 px-4 py-2.5 bg-ink-900">
                  <PosteTitre value={nom} onCommit={v => renommerPoste(nom, v)} />
                  <span className="text-sm font-semibold text-volt-400 shrink-0">{fmt(totalItems(b.items))}</span>
                  <button onClick={() => supprimerPoste(nom)} title="Supprimer le poste et toutes ses lignes"
                    className="text-ink-400 hover:text-red-400 transition-colors shrink-0"><Trash2 size={15} /></button>
                </div>
                <div className="p-3 space-y-2">
                  {b.items.length === 0 && (
                    <p className="text-xs text-ink-400 italic text-center py-2">Poste vide — ajoute un produit ou une ligne libre</p>
                  )}
                  {b.items.map(({ l, i }) => <LigneRow key={i} l={l} {...rowProps(i)} />)}
                  {libreCible?.poste === nom ? (
                    <FormLibre onAnnuler={() => setLibreCible(null)}
                      onAjouter={l => { setLignes(prev => [...prev, { ...l, poste: nom }]); setLibreCible(null); }} />
                  ) : (
                    <BoutonsAjout onProduit={() => setPicker({ type: "ajout", poste: nom })} onLibre={() => setLibreCible({ poste: nom })} />
                  )}
                </div>
              </div>
            );
          })}

          {horsPoste.length > 0 && (
            <div className="rounded-2xl border border-ink-200 overflow-hidden bg-ink-50/40">
              <div className="flex items-center gap-3 px-4 py-2.5 bg-ink-200">
                <span className="flex-1 font-semibold text-sm text-ink-700">Hors poste</span>
                <span className="text-sm font-semibold text-ink-900 shrink-0">{fmt(totalItems(horsPoste))}</span>
              </div>
              <div className="p-3 space-y-2">
                {horsPoste.map(({ l, i }) => <LigneRow key={i} l={l} {...rowProps(i)} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {picker?.type === "ajout" && (
        <ProduitPicker
          prestations={prestations}
          titre="Ajouter un produit"
          sousTitre={picker.poste ? `Dans le poste « ${picker.poste} »` : avecPostes ? "Hors poste" : "Au devis"}
          onChoisir={(p, offre) => ajouterProduit(p, offre, picker.poste)}
          onFermer={() => setPicker(null)}
        />
      )}

      {picker?.type === "remplacement" && ligneEnRemplacement && (
        <ProduitPicker
          prestations={prestations}
          titre="Changer de produit ou de fournisseur"
          sousTitre={`Ligne actuelle : ${ligneEnRemplacement.nom}${ligneEnRemplacement.fournisseur_nom ? ` (${ligneEnRemplacement.fournisseur_nom})` : ""} — la quantité est conservée`}
          remplacement
          inclureKits={false}
          produitActuelId={ligneEnRemplacement.prestation_id ?? null}
          fournisseurPrefere={ligneEnRemplacement.fournisseur_nom ?? null}
          filtreInitial={{
            type: ligneEnRemplacement.type_branche,
            sousCat: produitEnRemplacement?.sous_categorie ?? "",
          }}
          onChoisir={(p, offre) => remplacerProduit(picker.index, p, offre)}
          onFermer={() => setPicker(null)}
        />
      )}
    </div>
  );
}
