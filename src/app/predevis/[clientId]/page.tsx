"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Client, Prestation, DevisLigne, Projet } from "@/types";
import { useProjets, qsProjet, modifierProjet, lireAnnexes } from "@/lib/projets";
import ProjetSwitcher from "@/components/projets/ProjetSwitcher";
import { Niveau } from "@/lib/maison-types";
import { BreakerRow } from "@/lib/electrical-constants";
import {
  calculerBesoinsBruts, ModePreDevis, RecapCircuit, apparierCatalogue, optionsPourSousCategorie, genererLignesDevis, estBobinable,
  multiplicateurPourArticle, estSousCategorieAppareillage, estPieceReelle, estPieceTableau, optionAvecOffre, prixCompagnonAuMetre,
  ResultatPreDevis, BesoinApparie, estPointLumineuxADefinir, OptionArticle, ChoixLigne, POSTE_MAIN_OEUVRE, POSTE_CABLAGE,
} from "@/lib/predevis-engine";
import {
  attacherFournisseurs, libelleOffreMarque, marqueOffre, normTexte, offrePrincipale, offresTriees, prixVenteOffre,
  chargerOffres, libelleOffre, marquesDe, miroirPrestation, normaliserDrafts, nouvelleOffreDraft, offresDe, synchroniserOffres, OffreDraft, OffreNormalisee,
} from "@/lib/fournisseurs";
import { BobineField, FournisseursEditor, longueurValide } from "@/components/catalogue/EditeurArticle";
import { UNITES, arrondi2, echecSupabase } from "@/lib/utils";
import { colonnesFournisseur, colonnesImage } from "@/lib/devis-lignes";
import ProduitPicker from "@/components/devis/ProduitPicker";
import BadgeConditionnement from "@/components/devis/BadgeConditionnement";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Search, Sparkles, Save, Cable, RefreshCw, Euro, ChevronDown, ChevronRight, Check } from "lucide-react";
import { aSousCategorie, sousCategoriePrincipale} from "@/lib/sous-categories";
import { fondModal } from "@/lib/fond-modal";

const LABEL_GAMME: Record<string, string> = { entree: "Entrée de gamme", moyenne: "Moyenne gamme", haut: "Haut de gamme" };

function fmt(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

// ─── État de choix par besoin ───────────────────────────────────────────────

type ModeChoix = "option" | "autre" | "libre" | "exclu" | "adefinir";
interface EtatChoix {
  mode: ModeChoix;
  optionIndex: number;
  autrePrestationId: string;
  libreNom: string;
  librePrix: string;
  libreUnite: string;
  libreBranche: "service" | "materiau";
  // Fournisseur retenu pour l'article choisi (id d'une offre de prestation_fournisseurs).
  // "" = offre principale du produit. S'applique à l'option cochée / à l'article « autre ».
  fournisseurId: string;
}

function etatParDefaut(besoin: BesoinApparie): EtatChoix {
  return {
    mode: besoin.options.length > 0 ? "option" : "libre",
    optionIndex: 0,
    autrePrestationId: "",
    libreNom: besoin.label,
    librePrix: "",
    libreUnite: besoin.unite === "m" ? "ml" : besoin.unite === "heure" ? "heure" : "u",
    libreBranche: "materiau",
    fournisseurId: "",
  };
}

// Besoin resté « champ libre » sans rien saisi alors qu'un article du catalogue existe désormais (ajouté entre-temps) :
// on bascule automatiquement sur cet article — jamais un choix déjà fait par l'utilisateur.
function libreNonTouche(etat: EtatChoix | undefined, besoin: BesoinApparie): boolean {
  return !!etat && etat.mode === "libre" && !etat.librePrix && (!etat.libreNom || etat.libreNom === besoin.label) && besoin.options.length > 0;
}

// Option réellement retenue pour un besoin, avec le fournisseur choisi : c'est elle qui sert
// au total affiché ET à la génération du devis (une seule source de vérité).
function optionEffective(besoin: BesoinApparie, etat: EtatChoix, prestations: Prestation[]): OptionArticle | null {
  if (etat.mode === "option") {
    const base = besoin.options[etat.optionIndex];
    if (!base) return null;
    const p = prestations.find(x => x.id === base.prestation_id);
    if (!p) return base;
    const offre = etat.fournisseurId ? (p.fournisseurs ?? []).find(o => o.id === etat.fournisseurId) ?? null : null;
    return offre ? optionAvecOffre(base, p, offre) : base;
  }
  if (etat.mode === "autre") {
    const p = prestations.find(x => x.id === etat.autrePrestationId);
    if (!p) return null;
    const offre = etat.fournisseurId ? (p.fournisseurs ?? []).find(o => o.id === etat.fournisseurId) ?? null : null;
    const base: OptionArticle = {
      prestation_id: p.id, nom: p.nom, prix_unitaire: p.prix_unitaire, unite: p.unite,
      type_branche: p.type_branche, gamme: p.gamme ?? null, longueur_unitaire: p.longueur_unitaire && p.longueur_unitaire > 0 ? p.longueur_unitaire : null,
      quantiteMultiplicateur: multiplicateurPourArticle(besoin.sousCategorie, p.sous_categorie),
      sousCategorieArticle: aSousCategorie(p, besoin.sousCategorie) ? besoin.sousCategorie : (sousCategoriePrincipale(p) ?? besoin.sousCategorie),
      image_url: p.image_url ?? null,
    };
    return optionAvecOffre(base, p, offre);
  }
  return null;
}

// Estime le total réellement facturable pour un besoin bobinable, en reproduisant EXACTEMENT
// la décomposition de genererLignesQuantiteBobinable (predevis-engine.ts) — bobines entières
// au prix plein + reliquat via un article "au mètre" de même sous-catégorie/gamme si trouvé,
// sinon une bobine de plus. Un simple Math.round(quantité / longueur bobine) arrondit au plus
// proche et peut faire disparaître un reliquat important de l'affichage (ex. 29m avec des
// bobines de 25m arrondissait à "1" au lieu de facturer les 4m restants) — d'où cette version
// qui ne sous-estime jamais.
function totalBobinable(besoin: BesoinApparie, option: { longueur_unitaire?: number | null; quantiteMultiplicateur?: number; prix_unitaire: number; gamme?: OptionArticle["gamme"]; sousCategorieArticle?: string; fournisseur_nom?: string | null }, prestations: Prestation[]): number {
  const quantiteReelle = besoin.quantite * (option.quantiteMultiplicateur ?? 1);
  if (!option.longueur_unitaire || option.longueur_unitaire <= 0) {
    const q = besoin.unite === "m" ? Math.ceil(quantiteReelle) : quantiteReelle;
    return q * option.prix_unitaire;
  }
  const L = option.longueur_unitaire;
  const nbBobines = Math.floor(quantiteReelle / L + 1e-6);
  const reliquat = Math.round((quantiteReelle - nbBobines * L) * 100) / 100;
  let total = nbBobines * option.prix_unitaire;
  if (reliquat > 0.01) {
    const auMetre = prestations.find(p => aSousCategorie(p, option.sousCategorieArticle ?? besoin.sousCategorie)
      && (p.gamme ?? null) === (option.gamme ?? null) && !p.longueur_unitaire);
    total += auMetre ? Math.ceil(reliquat) * prixCompagnonAuMetre(auMetre, option.fournisseur_nom) : option.prix_unitaire; // bobine de plus si pas d'article au mètre
  }
  return total;
}

// ─── Ligne d'un besoin ───────────────────────────────────────────────────────

function decompositionLabel(besoin: BesoinApparie, option: { longueur_unitaire?: number | null; quantiteMultiplicateur?: number; gamme?: OptionArticle["gamme"]; sousCategorieArticle?: string }, prestations: Prestation[]): string | null {
  if (!(besoin.unite === "m" && estBobinable(besoin.sousCategorie) && option.longueur_unitaire && option.longueur_unitaire > 0)) return null;
  const quantiteReelle = besoin.quantite * (option.quantiteMultiplicateur ?? 1);
  const L = option.longueur_unitaire;
  const nb = Math.floor(quantiteReelle / L + 1e-6);
  const reliquat = Math.round((quantiteReelle - nb * L) * 100) / 100;
  if (reliquat <= 0.01) return `→ ${nb} bobine${nb > 1 ? "s" : ""} de ${L}m (${quantiteReelle.toFixed(2)}m au total)`;
  // Reproduit EXACTEMENT genererLignesQuantiteBobinable (predevis-engine.ts) : on cherche
  // vraiment l'article "au mètre" compagnon plutôt que de laisser un texte vague — sinon,
  // avec nb=0 (besoin plus petit qu'une bobine), l'ancien texte "Xm restants... sinon 1
  // bobine de plus" donnait l'impression qu'aucune bobine n'était prévue, alors que le
  // résultat final en achète bien une.
  const auMetre = prestations.find(p => aSousCategorie(p, option.sousCategorieArticle ?? besoin.sousCategorie)
    && (p.gamme ?? null) === (option.gamme ?? null) && !p.longueur_unitaire);
  const baseBobines = nb > 0 ? `${nb} bobine${nb > 1 ? "s" : ""} de ${L}m` : "";
  if (auMetre) {
    return `→ ${baseBobines ? `${baseBobines} + ` : ""}${Math.ceil(reliquat)}m au mètre (${quantiteReelle.toFixed(2)}m au total)`;
  }
  const bobinesFinales = nb + 1; // reliquat non couvert par un article au mètre -> une bobine de plus
  return `→ ${bobinesFinales} bobine${bobinesFinales > 1 ? "s" : ""} de ${L}m (couvre les ${quantiteReelle.toFixed(2)}m nécessaires — pas d'article au mètre pour ${besoin.label} en stock)`;
}

// Création d'un article au catalogue SANS quitter le pré-devis : le formulaire est pré-rempli à partir du besoin non identifié,
// l'article créé est ajouté au catalogue chargé puis sélectionné tout de suite sur la ligne.
function AjoutCatalogueRapide({ besoin, prestations, onCree, onFermer }: {
  besoin: BesoinApparie; prestations: Prestation[]; onCree: (p: Prestation) => void; onFermer: () => void;
}) {
  const voisin = prestations.find(p => aSousCategorie(p, besoin.sousCategorie));
  const [nom, setNom] = useState(besoin.label);
  const [description, setDescription] = useState("");
  const [unite, setUnite] = useState<string>(besoin.unite === "m" ? "ml" : besoin.unite === "heure" ? "heure" : "u");
  const [branche, setBranche] = useState<"materiau" | "service">(besoin.unite === "heure" ? "service" : "materiau");
  const [categorie, setCategorie] = useState(voisin?.categorie ?? "");
  const [nouvelleCat, setNouvelleCat] = useState(false);
  const [gamme, setGamme] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [prixService, setPrixService] = useState("");
  const [offres, setOffres] = useState<OffreDraft[]>(() => [nouvelleOffreDraft(true)]);
  const [enBobine, setEnBobine] = useState(false);
  const [longueur, setLongueur] = useState("");
  const [flags, setFlags] = useState({ marqueOk: true, imageOk: true });
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const categories = Array.from(new Set(prestations.map(p => p.categorie).filter(Boolean))).sort((a, b) => a.localeCompare(b, "fr"));
  const marquesConnues = Array.from(new Set(prestations.flatMap(p => marquesDe(p)))).sort((a, b) => a.localeCompare(b, "fr"));
  const fournisseursConnus = Array.from(new Set(prestations.flatMap(p => (p.fournisseurs ?? []).map(libelleOffre)))).sort();
  useEffect(() => { chargerOffres().then(r => setFlags({ marqueOk: r.marqueOk, imageOk: r.imageOk })).catch(() => {}); }, []);

  async function creer() {
    if (!nom.trim()) { setErreur("Donne un nom à l'article."); return; }
    const estMateriau = branche === "materiau";
    let prixVente = 0, prixAchat: number | null = null, liens: string[] = [], marque: string | null = null;
    let offresN: OffreNormalisee[] = [];
    if (estMateriau) {
      offresN = normaliserDrafts(offres);
      const principale = offresN.find(o => o.principal);
      if (!principale || principale.prix_vente == null || principale.prix_vente < 0) { setErreur("Le prix de vente HT de l'offre principale est obligatoire."); return; }
      if (principale.prix_achat != null && principale.prix_vente < principale.prix_achat
        && !confirm(`Le prix de vente (${principale.prix_vente.toFixed(2)} €) est inférieur au prix d'achat TTC (${principale.prix_achat.toFixed(2)} €) : tu vends à perte. Enregistrer quand même ?`)) return;
      const m = miroirPrestation(offresN, principale.prix_vente);
      prixVente = m.prix_unitaire; prixAchat = m.prix_achat; liens = m.liens_fournisseurs; marque = m.marque ?? null;
    } else {
      prixVente = parseFloat(prixService.replace(",", "."));
      if (isNaN(prixVente) || prixVente < 0) { setErreur("Le prix unitaire est obligatoire."); return; }
    }
    const lg = estMateriau ? longueurValide(enBobine, longueur) : null;
    if (estMateriau && enBobine && lg == null) { setErreur("Indique une longueur de bobine supérieure à 0, ou décoche « Vendu en bobine »."); return; }
    setEnCours(true); setErreur("");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { setErreur("Session expirée : reconnecte-toi."); setEnCours(false); return; }
    const { data, error } = await supabase.from("prestations").insert({
      user_id: session.user.id, nom: nom.trim(), description: description.trim() || null, prix_unitaire: prixVente, prix_achat: prixAchat, unite,
      type_branche: branche, categorie: categorie.trim() || "Divers", actif: true, sous_categorie: besoin.sousCategorie || null,
      marque, liens_fournisseurs: liens, image_url: estMateriau ? (imageUrl.trim() || null) : null, gamme: gamme || null, longueur_unitaire: lg,
    }).select().single();
    if (error || !data) { setErreur("Erreur : " + (error?.message ?? "création impossible")); setEnCours(false); return; }
    let fournisseurs: any[] = [];
    if (estMateriau && offresN.length > 0) {
      const err = await synchroniserOffres(session.user.id, data.id, offresN);
      if (err) alert("Article créé, mais fournisseurs non enregistrés : " + err);
      else fournisseurs = await offresDe(data.id);
    }
    setEnCours(false);
    onCree({ ...(data as Prestation), fournisseurs } as Prestation);
  }

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-3" {...fondModal(onFermer)}>
      <div className="card card-inner w-full max-w-3xl max-h-[92vh] overflow-y-auto flex flex-col gap-3" onClick={e => e.stopPropagation()}>
        <div>
          <p className="text-base font-bold text-ink-900">Ajouter au catalogue</p>
          <p className="text-xs text-ink-400">Besoin du pré-devis : <strong>{besoin.label}</strong>{besoin.sousCategorie ? <> · sous-catégorie <code>{besoin.sousCategorie}</code> (reprise automatiquement)</> : null}. Même formulaire que le catalogue : l'article est créé puis sélectionné ici, tu restes sur le pré-devis.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2"><label className="label">Nom *</label>
            <input className="input" value={nom} onChange={e => setNom(e.target.value)} autoFocus /></div>
          <div className="md:col-span-2"><label className="label">Description (optionnel)</label>
            <input className="input" value={description} onChange={e => setDescription(e.target.value)} /></div>
          <div><label className="label">Branche AE</label>
            <select className="input" value={branche} onChange={e => setBranche(e.target.value as "materiau" | "service")}>
              <option value="service">Service (main d'œuvre)</option>
              <option value="materiau">Matériau (achat/revente)</option>
            </select></div>
          <div><label className="label">Unité</label>
            <select className="input" value={unite} onChange={e => setUnite(e.target.value)}>
              {UNITES.map(u => <option key={u} value={u}>{u}</option>)}
            </select></div>
          <div><label className="label">Catégorie</label>
            {categories.length > 0 && !nouvelleCat ? (
              <div className="flex gap-2">
                <select className="input flex-1" value={categorie} onChange={e => setCategorie(e.target.value)}>
                  <option value="">— Choisir —</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button type="button" onClick={() => { setNouvelleCat(true); setCategorie(""); }} className="btn-ghost !px-3 text-xs">Nouvelle</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input className="input flex-1" placeholder="Nom de la catégorie" value={categorie} onChange={e => setCategorie(e.target.value)} />
                {categories.length > 0 && <button type="button" onClick={() => setNouvelleCat(false)} className="btn-ghost !px-3 text-xs">Existante</button>}
              </div>
            )}</div>
          <div><label className="label">Gamme (pré-devis)</label>
            <select className="input" value={gamme} onChange={e => setGamme(e.target.value)}>
              <option value="">— Aucune —</option>
              <option value="entree">Entrée de gamme</option>
              <option value="moyenne">Moyenne gamme</option>
              <option value="haut">Haut de gamme</option>
            </select></div>
          {branche === "materiau" && <BobineField actif={enBobine} setActif={setEnBobine} longueur={longueur} setLongueur={setLongueur} />}
          {branche === "service" ? (
            <div><label className="label">Prix unitaire HT (€) *</label>
              <input className="input" type="number" step="0.5" placeholder="0.00" value={prixService} onChange={e => setPrixService(e.target.value)} /></div>
          ) : (
            <FournisseursEditor offres={offres} setOffres={setOffres} fournisseursConnus={fournisseursConnus} marquesConnues={marquesConnues}
              marqueOk={flags.marqueOk} imageOk={flags.imageOk} imageProduit={imageUrl || null} />
          )}
          {branche === "materiau" && (
            <div className="md:col-span-2"><label className="label">Image du produit (URL)</label>
              <input className="input" placeholder="https://…/image-produit.jpg" value={imageUrl} onChange={e => setImageUrl(e.target.value)} />
              {imageUrl && <img src={imageUrl} alt="" className="mt-2 h-16 object-contain rounded-lg border border-ink-100 p-1 bg-white" />}</div>
          )}
        </div>
        {erreur && <p className="text-sm text-red-600 font-medium">{erreur}</p>}
        <div className="flex gap-3">
          <button className="btn-ghost flex-1 justify-center" onClick={onFermer}>Annuler</button>
          <button className="btn-volt flex-1 justify-center disabled:opacity-40" disabled={enCours} onClick={creer}>{enCours ? "Création…" : "Ajouter au catalogue et utiliser"}</button>
        </div>
      </div>
    </div>
  );
}

function BesoinRow({ besoin, etat, onChange, prestations, detail, onCatalogueAjoute }: {
  besoin: BesoinApparie; etat: EtatChoix; onChange: (e: EtatChoix) => void; prestations: Prestation[]; detail?: string;
  onCatalogueAjoute: (p: Prestation) => void;
}) {
  const [pickerOuvert, setPickerOuvert] = useState(false);
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const autrePrestation = prestations.find(p => p.id === etat.autrePrestationId);
  const effective = optionEffective(besoin, etat, prestations);

  // Sélecteur de fournisseur pour l'article actuellement retenu (option cochée ou article « autre »).
  function selecteurFournisseur(p: Prestation | undefined) {
    const offres = offresTriees(p?.fournisseurs);
    if (!p || offres.length < 2) {
      return effective?.fournisseur_nom
        ? <p className="text-[11px] text-ink-400 ml-6">Fournisseur : {effective.fournisseur_nom}</p>
        : null;
    }
    const courant = offres.some(o => o.id === etat.fournisseurId) ? etat.fournisseurId : (offrePrincipale(offres)?.id ?? "");
    return (
      <label className="ml-6 flex items-center gap-1.5 text-xs text-ink-500">
        <span className="shrink-0">Marque · fournisseur</span>
        <select value={courant} onChange={e => onChange({ ...etat, fournisseurId: e.target.value })}
          className="min-w-0 max-w-full text-xs border border-ink-200 rounded-lg py-1 px-1.5 bg-white">
          {offres.map(o => (
            <option key={o.id} value={o.id}>{libelleOffreMarque(p, o)} — {fmt(prixVenteOffre(p, o))}{o.principal ? " (principal)" : ""}</option>
          ))}
        </select>
      </label>
    );
  }

  const prestationOptionCochee = etat.mode === "option"
    ? prestations.find(p => p.id === besoin.options[etat.optionIndex]?.prestation_id)
    : undefined;
  const decomposition = (etat.mode === "option" || etat.mode === "autre") && effective
    ? decompositionLabel(besoin, effective, prestations) : null;

  return (
    <div className="border border-ink-100 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium text-ink-900">{besoin.label}</p>
          <p className="text-xs text-ink-400">{besoin.unite === "m" ? `${besoin.quantite.toFixed(2)} m` : `${besoin.quantite} ${besoin.unite === "heure" ? "h" : "u."}`}</p>
          {detail && <p className="text-[11px] text-ink-400 italic mt-0.5">{detail}</p>}
          {besoin.note && <p className="text-[11px] text-sky-700 mt-0.5">ℹ {besoin.note}</p>}
        </div>
        {besoin.options.length === 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
              <AlertTriangle size={12} /> Non identifié au catalogue
            </span>
            <button type="button" className="btn-volt !text-xs !py-1" onClick={() => setAjoutOuvert(true)}>+ Ajouter au catalogue</button>
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer border-b border-ink-100 pb-2">
        <input type="checkbox" checked={etat.mode === "exclu"}
          onChange={e => onChange({ ...etat, mode: e.target.checked ? "exclu" : (besoin.options.length > 0 ? "option" : "libre") })} />
        <span className="text-red-600 font-medium">Ne pas inclure cette ligne dans le devis</span>
      </label>

      <div className={`flex flex-col gap-1.5 ${etat.mode === "exclu" ? "opacity-40 pointer-events-none" : ""}`}>
        {besoin.options.map((opt, i) => {
          const coche = etat.mode === "option" && etat.optionIndex === i;
          const prix = coche && effective ? effective.prix_unitaire : opt.prix_unitaire;
          return (
            <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" checked={coche}
                onChange={() => onChange({ ...etat, mode: "option", optionIndex: i, fournisseurId: "" })} />
              <span className="text-ink-700 flex-1 min-w-0 truncate">
                {opt.gamme ? `${LABEL_GAMME[opt.gamme]} — ` : ""}{opt.nom}
              </span>
              <BadgeConditionnement longueur={opt.longueur_unitaire} sousCategorie={opt.sousCategorieArticle} />
              <span className="text-ink-500 shrink-0">{fmt(prix)} / {opt.unite}</span>
            </label>
          );
        })}
        {etat.mode === "option" && selecteurFournisseur(prestationOptionCochee)}

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="radio" checked={etat.mode === "autre"}
            onChange={() => { onChange({ ...etat, mode: "autre", fournisseurId: etat.mode === "autre" ? etat.fournisseurId : "" }); if (!autrePrestation) setPickerOuvert(true); }} />
          <span className="text-ink-500">Choisir un autre produit / fournisseur dans le catalogue</span>
        </label>
        {etat.mode === "autre" && (
          <div className="ml-6 flex flex-col gap-1.5">
            {autrePrestation ? (
              <div className="flex items-center gap-2 text-xs bg-ink-50 rounded-lg px-2 py-1.5">
                <span className="flex-1 truncate">{autrePrestation.nom}</span>
                <BadgeConditionnement longueur={autrePrestation.longueur_unitaire} sousCategorie={autrePrestation.sous_categorie} />
                <span className="text-ink-400 shrink-0">{fmt(effective?.prix_unitaire ?? autrePrestation.prix_unitaire)} / {autrePrestation.unite}</span>
                <button onClick={() => setPickerOuvert(true)} className="inline-flex items-center gap-1 text-volt-600 font-medium shrink-0"><RefreshCw size={11} /> Changer</button>
              </div>
            ) : (
              <button onClick={() => setPickerOuvert(true)} className="btn-ghost !py-1.5 text-xs justify-center"><Search size={12} /> Parcourir le catalogue</button>
            )}
          </div>
        )}
        {etat.mode === "autre" && autrePrestation && selecteurFournisseur(autrePrestation)}

        {decomposition && <p className="text-[11px] text-sky-600 font-mono ml-6">{decomposition}</p>}

        {estPointLumineuxADefinir(besoin.sousCategorie) && (
          <label className={`flex items-center gap-2 text-sm cursor-pointer ${etat.mode === "adefinir" ? "bg-red-50 border border-red-300 rounded-lg px-2 py-1.5" : ""}`}>
            <input type="radio" checked={etat.mode === "adefinir"} onChange={() => onChange({ ...etat, mode: "adefinir" })} />
            <span className={etat.mode === "adefinir" ? "text-red-700 font-semibold flex items-center gap-1.5" : "text-ink-500"}>
              {etat.mode === "adefinir" && <AlertTriangle size={13} />} À définir avec le client
            </span>
          </label>
        )}

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="radio" checked={etat.mode === "libre"} onChange={() => onChange({ ...etat, mode: "libre" })} />
          <span className="text-ink-500">Champ libre (prix personnalisé)</span>
        </label>
        {etat.mode === "libre" && (
          <div className="ml-6 grid grid-cols-2 gap-2">
            <input className="input !text-xs !py-1.5 col-span-2" placeholder="Désignation"
              value={etat.libreNom} onChange={e => onChange({ ...etat, libreNom: e.target.value })} />
            <input className="input !text-xs !py-1.5" type="number" step="0.01" placeholder="Prix unitaire €"
              value={etat.librePrix} onChange={e => onChange({ ...etat, librePrix: e.target.value })} />
            <select className="input !text-xs !py-1.5" value={etat.libreBranche}
              onChange={e => onChange({ ...etat, libreBranche: e.target.value as "service" | "materiau" })}>
              <option value="materiau">Matériau</option>
              <option value="service">Service</option>
            </select>
          </div>
        )}
      </div>

      {ajoutOuvert && (
        <AjoutCatalogueRapide besoin={besoin} prestations={prestations} onFermer={() => setAjoutOuvert(false)}
          onCree={p => { onCatalogueAjoute(p); onChange({ ...etat, mode: "autre", autrePrestationId: p.id, fournisseurId: "" }); setAjoutOuvert(false); }} />
      )}

      {pickerOuvert && (
        <ProduitPicker
          prestations={prestations}
          titre="Choisir un autre produit ou fournisseur"
          sousTitre={`Besoin : ${besoin.label}`}
          remplacement
          inclureKits={false}
          produitActuelId={etat.mode === "autre" ? etat.autrePrestationId : (besoin.options[etat.optionIndex]?.prestation_id ?? null)}
          fournisseurPrefere={effective?.fournisseur_nom ?? null}
          filtreInitial={prestations.some(p => aSousCategorie(p, besoin.sousCategorie)) ? { sousCat: besoin.sousCategorie } : {}}
          onChoisir={(p, offre) => onChange({ ...etat, mode: "autre", autrePrestationId: p.id, fournisseurId: offre?.id ?? "" })}
          onFermer={() => setPickerOuvert(false)}
        />
      )}
    </div>
  );
}

// ─── Page principale ────────────────────────────────────────────────────────

export default function PreDevisPage() {
  const params = useParams();
  const clientId = params.clientId as string;
  const { projets, projet, loading, changerProjet, recharger } = useProjets(clientId);
  // Recharge les projets (données fraîches) puis bascule ; la clé remonte toute la page.
  const choisir = async (id: string | null) => { await recharger(id ?? undefined); if (id) changerProjet(id); };
  if (loading) return <Shell><div className="p-8 text-center text-ink-400">Chargement…</div></Shell>;
  if (!projet) return <Shell><div className="p-8 text-center text-ink-500">Impossible de charger le projet de ce client. Vérifie que la migration 002_projets.sql a bien été exécutée.</div></Shell>;
  return <PreDevisEditor key={projet.id} clientId={clientId} projet={projet} projets={projets} onSelect={choisir} onChanged={choisir} />;
}

function PreDevisEditor({ clientId, projet, projets, onSelect, onChanged }: {
  clientId: string; projet: Projet; projets: Projet[];
  onSelect: (id: string) => Promise<void> | void; onChanged: (id: string | null) => Promise<void> | void;
}) {
  const router = useRouter();

  const [client, setClient] = useState<Client | null>(null);
  const [prestations, setPrestations] = useState<Prestation[]>([]);
  const ajouterAuCatalogue = (p: Prestation) => setPrestations(prev => (prev.some(x => x.id === p.id) ? prev : [...prev, p]));
  const [profil, setProfil] = useState<any>(null);
  // Postes (circuits / pièces) validés « devis OK » + état replié/déplié (clé = nom du poste). Le « OK » est sauvegardé avec le brouillon.
  const [postesOk, setPostesOk] = useState<Record<string, boolean>>({});
  const [postesOuverts, setPostesOuverts] = useState<Record<string, boolean>>({});
  const [autoSauve, setAutoSauve] = useState<string | null>(null); // heure de la dernière sauvegarde automatique
  const dernierContenuSauve = useRef<string | null>(null);
  const brouillonEfface = useRef(false);
  const [rentabOuverte, setRentabOuverte] = useState(false); // panneau « rentabilité » (privé, jamais dans le devis)
  const [resultat, setResultat] = useState<ResultatPreDevis | null>(null);
  // Toutes les pièces du plan (nom + niveau), même celles sans aucun besoin — sert au contrôle « rien oublié ».
  const [piecesDuPlan, setPiecesDuPlan] = useState<{ nom: string; niveau: string }[]>([]);
  const [alertesGeometrie, setAlertesGeometrie] = useState<string[]>([]);
  // Mode de chiffrage : null = pas encore choisi (la page le demande d'abord) ; « piece » = postes par pièce ;
  // « circuit » = postes par circuit (un circuit de prises peut traverser plusieurs pièces).
  const [mode, setMode] = useState<ModePreDevis | null>(null);
  // Métrage par circuit (information seulement : jamais ajouté au devis, ces mètres sont déjà dans les besoins).
  const [recapCircuits, setRecapCircuits] = useState<RecapCircuit[]>([]);
  const [donnees, setDonnees] = useState<{ niveaux: Niveau[]; rows: BreakerRow[]; prest: Prestation[]; brouillon: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [choix, setChoix] = useState<Record<string, EtatChoix>>({});
  const [mainOeuvreHeures, setMainOeuvreHeures] = useState("0");
  // Heures de main d'œuvre PAR POSTE (nom du poste → heures, optionnel). Chaque poste renseigné donne une ligne de main
  // d'œuvre rattachée à ce poste dans le devis : c'est ce temps chiffré que le suivi de réalisation compare au temps passé.
  const [heuresPostes, setHeuresPostes] = useState<Record<string, string>>({});
  const [mainOeuvreIndex, setMainOeuvreIndex] = useState(0);
  const [fraisGenerauxPct, setFraisGenerauxPct] = useState("0");
  const [deplacementEur, setDeplacementEur] = useState("0");
  const [generating, setGenerating] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [choixAgrege, setChoixAgrege] = useState<Record<string, EtatChoix>>({});
  // null = toutes les pièces incluses (comportement par défaut, inchangé). Un Set = pièces
  // réelles sélectionnées uniquement — les pseudo-pièces (Tableau électrique, Commun — X :
  // distance verticale au tableau, boîtes de dérivation communes au niveau) restent TOUJOURS
  // incluses quelle que soit la sélection, pour ne jamais fausser les longueurs de câbles et
  // gaines nécessaires (voir estPieceReelle, predevis-engine.ts).
  const [piecesSelectionnees, setPiecesSelectionnees] = useState<Set<string> | null>(null);
  // Le tableau électrique (disjoncteurs, différentiels, goulottes de montage) entre-t-il dans le devis ?
  // null = pas encore répondu → l'alerte s'affiche à l'ouverture du pré-devis (sauf si un brouillon porte déjà la réponse).
  const [inclureTableau, setInclureTableau] = useState<boolean | null>(null);
  // « Même marque partout » : marque choisie + portée (appareillage et plaques seulement, ou tout le matériel) + dernier résultat.
  const [marqueGlobale, setMarqueGlobale] = useState("");
  const [porteeMarque, setPorteeMarque] = useState<"appareillage" | "tout">("appareillage");
  const [bilanMarque, setBilanMarque] = useState<{ marque: string; appliques: number; sans: string[] } | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      const [{ data: c }, { data: prest }] = await Promise.all([
        supabase.from("clients").select("*").eq("id", clientId).single(),
        supabase.from("prestations").select("*").eq("actif", true),
      ]);
      let prof: any = null;
      if (session?.user) {
        const { data } = await supabase.from("profil").select("*").eq("id", session.user.id).single();
        prof = data;
      }
      // Catalogue + offres fournisseurs : une offre = un fournisseur et ses prix pour un produit.
      const prestAvecFournisseurs = await attacherFournisseurs((prest as Prestation[]) ?? []);
      setClient((c as any) ?? null);
      setPrestations(prestAvecFournisseurs);
      setProfil(prof);

      let niveaux: Niveau[] = [];
      if (projet.maison_config) {
        try { const parsed = JSON.parse(projet.maison_config); if (Array.isArray(parsed?.niveaux)) niveaux = parsed.niveaux; } catch {}
      }
      let rows: BreakerRow[] = [];
      if (projet.tableau_config) {
        try { const parsed = JSON.parse(projet.tableau_config); if (Array.isArray(parsed)) rows = parsed; } catch {}
      }
      // Tableaux annexes (pool house, garage…) : leurs disjoncteurs/différentiels se chiffrent
      // avec ceux du principal, et la section d'un circuit se retrouve par son libellé quel
      // que soit le tableau qui le porte.
      rows = [...rows, ...lireAnnexes(projet.tableaux_annexes).flatMap(a => a.rows)];

      if (niveaux.length === 0) {
        setAlertesGeometrie(["Aucun plan de circuits enregistré pour ce projet — dessine et génère les circuits d'abord."]);
        setLoading(false);
        return;
      }

      setPiecesDuPlan(niveaux.flatMap(n => n.pieces.map(pc => ({ nom: pc.nom, niveau: n.nom }))).filter(x => x.nom));
      // Brouillon sauvegardé précédemment (voir sauvegarderBrouillon). S'il porte un mode, on le reprend sans reposer la question.
      let brouillon: any = null;
      if (projet.predevis_config) {
        try { brouillon = JSON.parse(projet.predevis_config); } catch {}
      }
      setDonnees({ niveaux, rows, prest: prestAvecFournisseurs, brouillon });
      if (brouillon?.mode === "piece" || brouillon?.mode === "circuit") setMode(brouillon.mode);
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, projet.id]);

  // Calcul des besoins une fois le mode choisi (et à chaque changement de mode).
  useEffect(() => {
    if (!donnees || !mode) return;
    const { niveaux, rows, prest, brouillon } = donnees;
    const { besoins, alertes, recap } = calculerBesoinsBruts(niveaux, rows, mode);
    setRecapCircuits(recap);
    // Catalogue COURANT (articles ajoutés depuis l'ouverture de la page inclus), pas celui du chargement initial.
    const res = apparierCatalogue(besoins, prestations.length > 0 ? prestations : prest);
    setResultat(res);
    setAlertesGeometrie(alertes);
    setPiecesSelectionnees(null);
    // Les choix du brouillon ne se réappliquent que si le brouillon a été fait dans le même mode (les clés de besoin diffèrent).
    const memeMode = !!brouillon && (brouillon.mode ?? "piece") === mode;
    const initChoix: Record<string, EtatChoix> = {};
    Object.values(res.parPiece).flat().forEach(b => {
      initChoix[b.cle] = { ...etatParDefaut(b), ...(memeMode ? (brouillon?.choix?.[b.cle] ?? {}) : {}) };
    });
    setChoix(initChoix);
    setChoixAgrege(memeMode && brouillon?.choixAgrege ? brouillon.choixAgrege : {});
    if (brouillon) {
      if (brouillon.mainOeuvreHeures != null) setMainOeuvreHeures(brouillon.mainOeuvreHeures);
      // Les postes (pièces / circuits) dépendent du mode : les heures par poste ne se reprennent que dans le même mode.
      setHeuresPostes(memeMode && brouillon.heuresPostes && typeof brouillon.heuresPostes === "object" ? brouillon.heuresPostes : {});
      setPostesOk(memeMode && brouillon.postesOk && typeof brouillon.postesOk === "object" ? brouillon.postesOk : {});
      if (brouillon.mainOeuvreIndex != null) setMainOeuvreIndex(brouillon.mainOeuvreIndex);
      if (brouillon.fraisGenerauxPct != null) setFraisGenerauxPct(brouillon.fraisGenerauxPct);
      if (brouillon.deplacementEur != null) setDeplacementEur(brouillon.deplacementEur);
      if (typeof brouillon.inclureTableau === "boolean") setInclureTableau(brouillon.inclureTableau);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [donnees, mode]);

  // Regroupe câbles/gaines/moulures par sous-catégorie, TOUTES PIÈCES CONFONDUES, pour
  // choisir une seule fois la meilleure combinaison bobine + mètre linéaire sur le métrage
  // total nécessaire — plutôt que de faire un choix (et un arrondi de bobine) séparé par
  // pièce, ce qui gâche souvent des mètres. Le détail par pièce reste visible (piece est
  // réutilisé comme texte descriptif affiché sur la ligne du devis final).
  // Liste des pièces réelles disponibles pour la sélection (pseudo-pièces exclues — elles
  // n'ont pas de case à cocher, elles sont toujours incluses).
  const toutesLesPiecesReelles = useMemo(
    () => resultat ? Object.keys(resultat.parPiece).filter(estPieceReelle).sort((a, b) => a.localeCompare(b)) : [],
    [resultat],
  );

  // Vue filtrée de resultat.parPiece selon piecesSelectionnees — toujours utilisée à la
  // place de resultat.parPiece directement, partout dans la page (affichage, agrégat,
  // totaux, génération du devis), pour que la sélection pièce par pièce soit cohérente
  // de bout en bout.
  const parPieceFiltre: Record<string, BesoinApparie[]> = useMemo(() => {
    if (!resultat) return {};
    // Poste « Tableau électrique » : retiré tant que l'alerte n'a pas reçu un « oui » (inclureTableau !== true).
    const sansTableauSiRefuse = Object.entries(resultat.parPiece).filter(([piece]) => !estPieceTableau(piece) || inclureTableau === true);
    if (piecesSelectionnees === null) return Object.fromEntries(sansTableauSiRefuse);
    return Object.fromEntries(
      sansTableauSiRefuse.filter(([piece]) => !estPieceReelle(piece) || piecesSelectionnees.has(piece)),
    );
  }, [resultat, piecesSelectionnees, inclureTableau]);

  // Besoins du tableau (disjoncteurs, différentiels, goulottes) tels que calculés, indépendamment de la réponse.
  const besoinsTableau: BesoinApparie[] = useMemo(
    () => (resultat ? Object.entries(resultat.parPiece).filter(([piece]) => estPieceTableau(piece)).flatMap(([, b]) => b) : []),
    [resultat],
  );

  const besoinsAgreges: BesoinApparie[] = useMemo(() => {
    if (!resultat) return [];
    const parSousCat = new Map<string, { label: string; total: number; options: OptionArticle[]; detail: Map<string, number> }>();
    Object.values(parPieceFiltre).flat().forEach(b => {
      if (!estBobinable(b.sousCategorie)) return;
      const entry = parSousCat.get(b.sousCategorie) ?? { label: b.label, total: 0, options: b.options, detail: new Map() };
      entry.total += b.quantite;
      entry.detail.set(b.piece, (entry.detail.get(b.piece) ?? 0) + b.quantite);
      parSousCat.set(b.sousCategorie, entry);
    });
    return Array.from(parSousCat.entries()).map(([sousCategorie, e]) => ({
      cle: `AGREGE_${sousCategorie}`, sousCategorie, label: e.label,
      piece: Array.from(e.detail.entries()).map(([piece, q]) => `${piece} : ${q.toFixed(2)}m`).join(", "),
      quantite: e.total, unite: "m" as const, options: e.options,
    }));
  }, [resultat, parPieceFiltre]);

  useEffect(() => {
    setChoixAgrege(prev => {
      let changed = false;
      const next = { ...prev };
      besoinsAgreges.forEach(b => {
        if (!(b.cle in next) || libreNonTouche(next[b.cle], b)) { next[b.cle] = etatParDefaut(b); changed = true; }
      });
      return changed ? next : prev;
    });
  }, [besoinsAgreges]);

  const contenuBrouillon = () => JSON.stringify({ choix, choixAgrege, mainOeuvreHeures, heuresPostes, mainOeuvreIndex, fraisGenerauxPct, deplacementEur, postesOk, ...(mode ? { mode } : {}), ...(inclureTableau !== null ? { inclureTableau } : {}) });

  async function sauvegarderBrouillon() {
    setSavingDraft(true);
    const contenu = contenuBrouillon();
    const ok = await modifierProjet(projet.id, { predevis_config: contenu });
    setSavingDraft(false);
    if (!ok) { alert("Le brouillon n'a pas pu être enregistré."); return; }
    dernierContenuSauve.current = contenu;
    setDraftSaved(true);
    setTimeout(() => setDraftSaved(false), 2000);
  }

  // Sauvegarde AUTOMATIQUE : 2 s après la dernière modification (et dès que l'onglet passe en arrière-plan). Silencieuse.
  // La première valeur observée (état chargé depuis le brouillon / calculé) sert de référence : rien n'est écrit tant que rien n'a changé.
  const contenuCourant = resultat ? contenuBrouillon() : null;
  const contenuRef = useRef<string | null>(null);
  contenuRef.current = contenuCourant;
  async function sauvegardeAuto() {
    const c = contenuRef.current;
    if (!c || brouillonEfface.current || dernierContenuSauve.current === null || c === dernierContenuSauve.current) return;
    const ok = await modifierProjet(projet.id, { predevis_config: c });
    if (ok) { dernierContenuSauve.current = c; setAutoSauve(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })); }
  }
  useEffect(() => {
    if (!contenuCourant) return;
    if (dernierContenuSauve.current === null) { dernierContenuSauve.current = contenuCourant; return; }
    if (contenuCourant === dernierContenuSauve.current) return;
    const t = setTimeout(() => { sauvegardeAuto(); }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contenuCourant]);
  useEffect(() => {
    const h = () => { if (document.visibilityState === "hidden") sauvegardeAuto(); };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Catalogue en temps réel : un article ajouté (ici, ou dans un autre onglet — rechargement au retour sur la page) est
  // immédiatement proposé sur TOUS les postes concernés ; les besoins restés « champ libre » vides basculent dessus.
  useEffect(() => {
    if (!resultat) return;
    const signature = (r: ResultatPreDevis) => Object.values(r.parPiece).flat().map(b => `${b.cle}:${b.options.map(o => `${o.prestation_id}@${o.prix_unitaire}`).join(",")}`).join("|");
    const res = apparierCatalogue(Object.values(resultat.parPiece).flat(), prestations);
    if (signature(res) === signature(resultat)) return;
    setResultat(res);
    setChoix(prev => {
      const next = { ...prev };
      Object.values(res.parPiece).flat().forEach(b => { if (libreNonTouche(next[b.cle], b)) next[b.cle] = etatParDefaut(b); });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prestations]);
  useEffect(() => {
    async function recharger() {
      if (document.visibilityState !== "visible") return;
      const { data } = await supabase.from("prestations").select("*").eq("actif", true);
      if (!data) return;
      const avecFournisseurs = await attacherFournisseurs(data as Prestation[]);
      setPrestations(avecFournisseurs);
    }
    document.addEventListener("visibilitychange", recharger);
    return () => document.removeEventListener("visibilitychange", recharger);
  }, []);

  const optionsMainOeuvre = optionsPourSousCategorie("main_oeuvre", prestations);

  function majChoix(cle: string, e: EtatChoix) {
    setChoix(prev => ({ ...prev, [cle]: e }));
  }

  // ── Même marque partout ──
  // Offre d'un article pour une marque (la principale d'abord, sinon la moins chère) ; undefined si l'article n'existe pas dans cette marque.
  function offreDeMarque(p: Prestation, marqueNorm: string) {
    const offres = offresTriees(p.fournisseurs).filter(o => normTexte(marqueOffre(p, o)) === marqueNorm);
    if (offres.length === 0) return undefined;
    return offres.find(o => o.principal) ?? [...offres].sort((a, b) => prixVenteOffre(p, a) - prixVenteOffre(p, b))[0];
  }
  const besoinsMarquables = useMemo(
    () => Object.values(parPieceFiltre).flat().filter(b => !estBobinable(b.sousCategorie) && b.options.length > 0
      && (porteeMarque === "tout" || estSousCategorieAppareillage(b.sousCategorie))),
    [parPieceFiltre, porteeMarque]);
  const marquesDisponibles = useMemo(() => {
    const m = new Map<string, { nom: string; lignes: Set<string> }>();
    besoinsMarquables.forEach(b => b.options.forEach(opt => {
      const p = prestations.find(x => x.id === opt.prestation_id);
      if (!p) return;
      (p.fournisseurs && p.fournisseurs.length > 0 ? p.fournisseurs.map(o => marqueOffre(p, o)) : [marqueOffre(p, null)]).forEach(nom => {
        const k = normTexte(nom);
        if (!k) return;
        const e = m.get(k) ?? { nom, lignes: new Set<string>() };
        e.lignes.add(b.cle); m.set(k, e);
      });
    }));
    return Array.from(m.entries()).map(([k, e]) => ({ cle: k, nom: e.nom, nbLignes: e.lignes.size })).sort((a, b) => b.nbLignes - a.nbLignes || a.nom.localeCompare(b.nom));
  }, [besoinsMarquables, prestations]);
  function appliquerMarque() {
    const k = normTexte(marqueGlobale);
    const info = marquesDisponibles.find(x => x.cle === k);
    if (!k || !info) return;
    let appliques = 0;
    const sans: string[] = [];
    {
      const suite = { ...choix };
      besoinsMarquables.forEach(b => {
        const etat = suite[b.cle] ?? etatParDefaut(b);
        if (etat.mode === "exclu") return;
        // L'option (gamme) déjà cochée est gardée si elle existe dans la marque ; sinon la première qui l'a.
        const ordre = [etat.mode === "option" ? etat.optionIndex : -1, ...b.options.map((_, i) => i)].filter(i => i >= 0 && i < b.options.length);
        for (const i of ordre) {
          const p = prestations.find(x => x.id === b.options[i].prestation_id);
          const offre = p ? offreDeMarque(p, k) : undefined;
          if (p && offre) { suite[b.cle] = { ...etat, mode: "option", optionIndex: i, fournisseurId: offre.id }; appliques++; return; }
        }
        sans.push(`${b.label} (${b.piece})`);
      });
      setChoix(suite);
    }
    setBilanMarque({ marque: info.nom, appliques, sans });
  }

  // Total HT approximatif affiché en direct — le total exact (avec décomposition en
  // bobines) est recalculé à la génération finale.
  function totalLigneApprox(besoin: BesoinApparie, etat: EtatChoix): number {
    if (etat.mode === "exclu" || etat.mode === "adefinir") return 0;
    if (etat.mode === "option" || etat.mode === "autre") {
      const opt = optionEffective(besoin, etat, prestations);
      if (!opt) return 0;
      if (besoin.unite === "m" && estBobinable(besoin.sousCategorie)) return totalBobinable(besoin, opt, prestations);
      return besoin.quantite * (opt.quantiteMultiplicateur ?? 1) * opt.prix_unitaire;
    }
    const prix = parseFloat(etat.librePrix) || 0;
    return (besoin.unite === "m" ? Math.ceil(besoin.quantite) : besoin.quantite) * prix;
  }

  const heuresGenerales = parseFloat(mainOeuvreHeures) || 0;
  // Heures par poste : seulement les postes encore présents dans le devis (pièce décochée = poste retiré).
  const heuresParPoste: [string, number][] = Object.keys(parPieceFiltre)
    .map(poste => [poste, parseFloat((heuresPostes[poste] ?? "").replace(",", ".")) || 0] as [string, number])
    .filter(([, h]) => h > 0);
  const totalHeuresPostes = heuresParPoste.reduce((s, [, h]) => s + h, 0);
  const heures = heuresGenerales + totalHeuresPostes;
  const tauxHoraire = optionsMainOeuvre[mainOeuvreIndex]?.prix_unitaire ?? profil?.taux_horaire ?? 0;
  const totalMainOeuvre = heures * tauxHoraire;

  const totalConsommablesApprox = resultat
    ? Object.values(parPieceFiltre).flat().filter(b => !estBobinable(b.sousCategorie))
        .reduce((s, b) => s + totalLigneApprox(b, choix[b.cle] ?? etatParDefaut(b)), 0)
      + besoinsAgreges.reduce((s, b) => s + totalLigneApprox(b, choixAgrege[b.cle] ?? etatParDefaut(b)), 0)
    : 0;
  const fraisGeneraux = (parseFloat(fraisGenerauxPct) || 0) / 100 * (totalConsommablesApprox + totalMainOeuvre);
  const deplacement = parseFloat(deplacementEur) || 0;
  const totalGeneral = totalConsommablesApprox + totalMainOeuvre + fraisGeneraux + deplacement;

  // Assemble les lignes du devis (consommables + main d'œuvre + frais + déplacement) : source unique, utilisée par la génération ET par l'aperçu de rentabilité.
  function assemblerLignes() {
    const tousLesBesoins = Object.values(parPieceFiltre).flat().filter(b => !estBobinable(b.sousCategorie));
    const construireChoixLigne = (besoin: BesoinApparie, etat: EtatChoix): ChoixLigne => {
    if (etat.mode === "exclu") return { besoin };
    if (etat.mode === "adefinir") return { besoin, aCompleter: true, aDefinir: true };
    if (etat.mode === "option" || etat.mode === "autre") {
      // Option avec le fournisseur choisi (prix de vente + prix d'achat de CE fournisseur).
      const opt = optionEffective(besoin, etat, prestations);
      return opt ? { besoin, optionCatalogue: opt } : { besoin, aCompleter: true };
    }
    const prix = parseFloat(etat.librePrix) || 0;
    if (!etat.libreNom.trim() || prix <= 0) return { besoin, aCompleter: true };
    return { besoin, libre: { nom: etat.libreNom, prixUnitaire: prix, unite: etat.libreUnite, typeBranche: etat.libreBranche } };
    };
    const choixLignes: ChoixLigne[] = [
    ...tousLesBesoins.map(besoin => construireChoixLigne(besoin, choix[besoin.cle] ?? etatParDefaut(besoin))),
    // Câbles/gaines/moulures : un seul choix par sous-catégorie sur le métrage total
    // (toutes pièces confondues) — voir besoinsAgreges plus haut.
    ...besoinsAgreges.map(besoin => construireChoixLigne(besoin, choixAgrege[besoin.cle] ?? etatParDefaut(besoin))),
    ];

    const lignesConsommables = genererLignesDevis(choixLignes, prestations);

    const lignesFinales: Omit<DevisLigne, "devis_id" | "ordre">[] = [...lignesConsommables];

    const optMO = optionsMainOeuvre[mainOeuvreIndex];
    // Main d'œuvre rattachée à chaque poste renseigné (comparée au temps passé dans le suivi de réalisation)…
    heuresParPoste.forEach(([poste, h]) => {
    lignesFinales.push({
    nom: optMO?.nom ?? "Main d'œuvre", quantite: h, prix_unitaire: tauxHoraire, unite: "heure",
    type_branche: "service", prestation_id: optMO?.prestation_id, poste,
    });
    });
    // … et main d'œuvre générale (non rattachée à un poste).
    if (heuresGenerales > 0) {
    lignesFinales.push({
    nom: optMO?.nom ?? "Main d'œuvre", quantite: heuresGenerales, prix_unitaire: tauxHoraire, unite: "heure",
    type_branche: "service", prestation_id: optMO?.prestation_id, poste: POSTE_MAIN_OEUVRE,
    });
    }

    const sousTotal = lignesFinales.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);
    const pctFrais = parseFloat(fraisGenerauxPct) || 0;
    if (pctFrais > 0) {
    lignesFinales.push({ nom: "Frais généraux", quantite: 1, prix_unitaire: Math.round(sousTotal * pctFrais / 100 * 100) / 100, unite: "forfait", type_branche: "service", poste: POSTE_MAIN_OEUVRE });
    }
    if (deplacement > 0) {
    lignesFinales.push({ nom: "Déplacement", quantite: 1, prix_unitaire: deplacement, unite: "forfait", type_branche: "service", poste: POSTE_MAIN_OEUVRE });
    }

    return { lignesFinales, choixLignes };
  }

  async function genererDevis() {
    if (!resultat || !client) return;
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { alert("Session expirée."); setGenerating(false); return; }

      const { lignesFinales, choixLignes } = assemblerLignes();
      // Besoins ni exclus ni résolus : on prévient, puis ils deviennent des lignes « À compléter » à 0 €.
      const manquants = choixLignes.filter(c => c.aCompleter && !c.aDefinir);
      const nbADefinir = choixLignes.filter(c => c.aDefinir).length;
      if (manquants.length > 0) {
        const liste = manquants.slice(0, 8).map(c => `• ${c.besoin.label} (${c.besoin.piece})`).join("\n");
        const suite = manquants.length > 8 ? `\n… et ${manquants.length - 8} autre(s)` : "";
        const ok = confirm(`${manquants.length} besoin(s) sans produit ni prix :\n${liste}${suite}\n\nIls seront ajoutés au devis en lignes « À compléter » à 0 € (le devis ne pourra pas être envoyé tant qu'elles restent). Générer quand même ?`);
        if (!ok) { setGenerating(false); return; }
      }
      if (nbADefinir > 0 && !confirm(`${nbADefinir} luminaire(s) « à définir avec le client » : ils seront ajoutés au devis en lignes « À compléter » à 0 € (envoi et signature bloqués tant qu'ils restent). Générer quand même ?`)) { setGenerating(false); return; }
      // Garde-fou : un devis sans aucune ligne (désignation) est un document invalide,
      // impossible à faire signer et faussant toute rentabilité en aval (CRM). On bloque
      // la génération AVANT de créer le moindre enregistrement en base plutôt que de
      // laisser passer un devis vide — ce qui pouvait arriver en silence si tous les
      // besoins étaient exclus/non résolus (mode "libre" sans prix saisi) et qu'aucune
      // main d'œuvre/frais/déplacement n'était renseigné(e).
      if (lignesFinales.length === 0) {
        alert("Aucune ligne à générer : tous les besoins sont exclus ou non résolus (pas de prix saisi), et aucune main d'œuvre/frais/déplacement n'est renseigné. Résous au moins une ligne avant de générer le devis.");
        setGenerating(false);
        return;
      }

      const totalService = lignesFinales.filter(l => l.type_branche === "service").reduce((s, l) => s + arrondi2(l.quantite * l.prix_unitaire), 0);
      const totalMateriau = lignesFinales.filter(l => l.type_branche === "materiau").reduce((s, l) => s + arrondi2(l.quantite * l.prix_unitaire), 0);

      const { data: prof } = await supabase.from("profil").select("*").eq("id", session.user.id).single();
      const numero = `${prof?.prefixe_devis ?? "DEV"}-${new Date().getFullYear()}-${String((prof?.compteur_devis ?? 0) + 1).padStart(3, "0")}`;

      const { data: devis, error } = await supabase.from("devis").insert({
        user_id: session.user.id, client_id: clientId, numero,
        objet: projets.length > 1 ? `Pré-devis électrique — ${projet.nom}` : "Pré-devis électrique",
        statut: "brouillon", total_service: totalService, total_materiau: totalMateriau,
        total_ttc: arrondi2(totalService + totalMateriau),
      }).select().single();
      if (error || !devis) { alert("Erreur création devis : " + error?.message); setGenerating(false); return; }

      // CRITIQUE : on vérifie l'erreur de cet insert — sans ce contrôle, un échec ici
      // (RLS, contrainte, colonne) passait totalement inaperçu : le devis (en-tête) était
      // déjà créé avec des totaux calculés en mémoire, mais aucune ligne n'était
      // réellement enregistrée. Résultat : un devis "signable" vide (aucune désignation,
      // ni matériel ni main d'œuvre) et une rentabilité faussée côté CRM (qui lit les
      // coûts depuis devis_lignes). On échoue maintenant bruyamment, et on supprime le
      // devis orphelin plutôt que de laisser un document invalide et une rentabilité
      // faussée dans la base.
      // Colonnes fournisseur envoyées uniquement si au moins une ligne en porte (voir
      // colonnesFournisseur) — sinon l'insertion est identique à l'ancienne.
      const colFournisseur = colonnesFournisseur(lignesFinales as DevisLigne[]);
      const colImage = colonnesImage(lignesFinales);
      // Chaque pièce du plan devient un POSTE du devis (devis_lignes.poste, voir posteDuBesoin). Si la colonne `poste`
      // n'existe pas encore en base, on retente sans elle plutôt que de perdre le devis.
      const construireLignes = (avecPoste: boolean) => lignesFinales.map((l, i) => {
        const { fournisseur_id, fournisseur_nom, prix_achat, image_url, poste, ...reste } = l;
        return { ...reste, devis_id: devis.id, ordre: i, ...(avecPoste ? { poste: poste ?? null } : {}), ...colFournisseur(l as DevisLigne), ...colImage(l) };
      });
      let { error: errLignes } = await supabase.from("devis_lignes").insert(construireLignes(true));
      if (errLignes && /poste/i.test(errLignes.message)) {
        ({ error: errLignes } = await supabase.from("devis_lignes").insert(construireLignes(false)));
      }
      if (errLignes) {
        await supabase.from("devis").delete().eq("id", devis.id);
        alert("Erreur lors de l'enregistrement des lignes du devis (aucune ligne sauvegardée) : " + errLignes.message);
        setGenerating(false);
        return;
      }
      const { error: errCompteur } = await supabase.from("profil").update({ compteur_devis: (prof?.compteur_devis ?? 0) + 1 }).eq("id", session.user.id);
      echecSupabase(errCompteur, "Mise à jour du compteur de devis");
      // Le devis final matérialise le brouillon — on l'efface pour ne pas laisser un
      // brouillon obsolète si le client revient sur cette page plus tard.
      brouillonEfface.current = true;
      await modifierProjet(projet.id, { predevis_config: null });

      router.push(`/devis/${devis.id}`);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <Shell><div className="p-8 text-center text-ink-400">Chargement…</div></Shell>;

  // Avant tout calcul : comment organiser le pré-devis ?
  if (donnees && !mode) {
    return (
      <Shell>
        <div className="p-4 md:p-8 max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Link href={`/plan/${clientId}${qsProjet(projet.id)}`} className="btn-ghost !px-2.5 !py-2"><ArrowLeft size={16} /></Link>
            <div className="flex-1">
              <h1 className="font-display text-2xl">Pré-devis électrique</h1>
              {client && <p className="text-xs text-ink-400">{client.prenom ? `${client.prenom} ${client.nom}` : client.nom}</p>}
            </div>
          </div>
          <div className="card card-inner">
            <h2 className="font-semibold text-ink-800 mb-1">Comment veux-tu chiffrer ce projet ?</h2>
            <p className="text-xs text-ink-500 mb-4">Les quantités totales (câbles, appareillage…) sont identiques dans les deux cas : seul le découpage en postes du devis change.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <button onClick={() => setMode("piece")} className="text-left p-4 rounded-xl border border-ink-200 hover:border-volt-500 hover:bg-volt-50 transition">
                <div className="font-semibold text-ink-800 mb-1">À la pièce</div>
                <p className="text-xs text-ink-500">Un poste par pièce (salon, chambre…). Le câblage est réparti selon les pièces traversées. Idéal pour une rénovation pièce par pièce ou un petit projet.</p>
              </button>
              <button onClick={() => setMode("circuit")} className="text-left p-4 rounded-xl border border-ink-200 hover:border-volt-500 hover:bg-volt-50 transition">
                <div className="font-semibold text-ink-800 mb-1">Par circuit</div>
                <p className="text-xs text-ink-500">Un poste par circuit (prises, lumière, four…) : appareillage, boîtes et câbles d'un circuit regroupés, même s'il traverse plusieurs pièces. Idéal pour une maison entière.</p>
              </button>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href={`/plan/${clientId}${qsProjet(projet.id)}`} className="btn-ghost !px-2.5 !py-2"><ArrowLeft size={16} /></Link>
          <div className="flex-1">
            <h1 className="font-display text-2xl">Pré-devis électrique</h1>
            {client && <p className="text-xs text-ink-400">{client.prenom ? `${client.prenom} ${client.nom}` : client.nom}</p>}
            {mode && (
              <p className="text-xs text-ink-500 mt-0.5">
                Mode : <strong>{mode === "circuit" ? "par circuit" : "à la pièce"}</strong>{" · "}
                <button className="text-volt-600 font-medium" onClick={() => {
                  if (window.confirm("Changer de mode recalcule le pré-devis : les choix d'articles faits dans ce mode seront perdus. Continuer ?")) { setResultat(null); setMode(mode === "circuit" ? "piece" : "circuit"); }
                }}>passer {mode === "circuit" ? "à la pièce" : "par circuit"}</button>
              </p>
            )}
          </div>
          <button type="button" onClick={() => setRentabOuverte(o => !o)} disabled={!resultat}
            className={`btn-ghost !px-2.5 !py-2 hover:text-volt-600 ${rentabOuverte ? "text-volt-600" : "text-ink-400"}`} title="Rentabilité en temps réel (privé)">
            <Euro size={16} />
          </button>
          <ProjetSwitcher clientId={clientId} projets={projets} projetId={projet.id}
            avantChangement={sauvegarderBrouillon} onSelect={onSelect} onChanged={onChanged} compact />
        </div>

        {/* Rentabilité en temps réel — mêmes formules que la page /devis/[id]/rentabilite, sur les lignes qui seraient générées. */}
        {rentabOuverte && resultat && (() => {
          let lignes: Omit<DevisLigne, "devis_id" | "ordre">[] = [];
          try { lignes = assemblerLignes().lignesFinales; } catch { return null; }
          const tauxCotisService = profil?.taux_cotisations_service ?? 21.2;
          const tauxCotisMateriau = profil?.taux_cotisations_materiau ?? 12.3;
          const tauxIrService = profil?.taux_ir_service ?? 0;
          const tauxIrMateriau = profil?.taux_ir_materiau ?? 0;
          let coutAchatTotal = 0, sansCout = 0;
          lignes.forEach(l => {
            const aFournisseur = !!l.fournisseur_id || l.prix_achat != null;
            const pa: number | null = aFournisseur ? (l.prix_achat ?? null) : (l.prestation_id ? (prestations.find(x => x.id === l.prestation_id)?.prix_achat ?? null) : null);
            const cout = pa && pa > 0 ? pa * l.quantite : 0;
            coutAchatTotal += cout;
            if (l.type_branche === "materiau" && cout === 0 && l.prix_unitaire > 0) sansCout++;
          });
          const totalService = lignes.filter(l => l.type_branche === "service").reduce((a, l) => a + arrondi2(l.quantite * l.prix_unitaire), 0);
          const totalMateriau = lignes.filter(l => l.type_branche === "materiau").reduce((a, l) => a + arrondi2(l.quantite * l.prix_unitaire), 0);
          const totalVente = arrondi2(totalService + totalMateriau);
          const cotis = totalService * tauxCotisService / 100 + totalMateriau * tauxCotisMateriau / 100;
          const ir = totalService * tauxIrService / 100 + totalMateriau * tauxIrMateriau / 100;
          const netService = totalService - totalService * (tauxCotisService + tauxIrService) / 100;
          const netMateriau = totalMateriau - totalMateriau * (tauxCotisMateriau + tauxIrMateriau) / 100 - coutAchatTotal;
          const net = netService + netMateriau;
          const pct = totalVente > 0 ? Math.round(net / totalVente * 1000) / 10 : 0;
          const couleur = pct < 0 ? "text-red-600" : pct < 20 ? "text-amber-600" : "text-emerald-600";
          return (
            <div className="card card-inner mb-4 sticky top-2 z-20 shadow-md">
              <div className="flex items-center gap-2 mb-2">
                <Euro size={15} className="text-volt-600" />
                <h2 className="font-semibold text-ink-800 text-sm flex-1">Rentabilité en temps réel <span className="text-xs font-normal text-ink-400">(privé — absent du devis)</span></h2>
                <span className={`text-sm font-bold ${couleur}`}>{fmt(net)} ({pct.toString().replace(".", ",")} %)</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="bg-ink-50 rounded-lg p-2"><p className="text-ink-400">Vente HT</p><p className="font-bold text-ink-900 text-sm">{fmt(totalVente)}</p></div>
                <div className="bg-red-50 border border-red-100 rounded-lg p-2"><p className="text-red-400">Achat matériel</p><p className="font-bold text-red-700 text-sm">− {fmt(coutAchatTotal)}</p></div>
                <div className="bg-red-50 border border-red-100 rounded-lg p-2"><p className="text-red-400">Cotisations{ir > 0 ? " + IR" : ""}</p><p className="font-bold text-red-700 text-sm">− {fmt(cotis + ir)}</p></div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2"><p className="text-ink-400">Marge nette</p><p className={`font-bold text-sm ${couleur}`}>{fmt(net)}</p></div>
              </div>
              <p className="text-xs text-ink-500 mt-2">Service {fmt(totalService)} → net {fmt(netService)} · Matériaux {fmt(totalMateriau)} → net {fmt(netMateriau)}</p>
              {sansCout > 0 && (
                <p className="text-xs text-amber-600 flex items-center gap-1.5 mt-1"><AlertTriangle size={12} className="shrink-0" /> {sansCout} ligne{sansCout > 1 ? "s" : ""} matériau sans prix d'achat connu (ligne libre, kit ou fiche incomplète) — marge probablement surestimée.</p>
              )}
            </div>
          );
        })()}

        {/* Alerte : le tableau électrique entre-t-il dans le devis ? (posée à chaque ouverture tant qu'aucune réponse n'est enregistrée) */}
        {resultat && besoinsTableau.length > 0 && inclureTableau === null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="card card-inner bg-white max-w-md w-full max-h-[90vh] overflow-y-auto">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <AlertTriangle size={13} /> Tableau électrique
              </p>
              <h2 className="font-semibold text-ink-900 mb-2">Intégrer aussi le tableau électrique au devis ?</h2>
              <p className="text-xs text-ink-500 mb-3">
                Le devis reprendrait absolument tous les disjoncteurs et différentiels du tableau (chacun chiffré avec son article du catalogue), plus les goulottes de montage :
              </p>
              <ul className="text-sm text-ink-700 mb-4 flex flex-col gap-0.5">
                {besoinsTableau.map(b => (
                  <li key={b.cle} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{b.label}</span>
                    <span className="shrink-0 text-ink-500">× {b.quantite}</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-3">
                <button onClick={() => setInclureTableau(false)} className="btn-ghost flex-1 justify-center">Non, sans le tableau</button>
                <button onClick={() => setInclureTableau(true)} className="btn-volt flex-1 justify-center">Oui, intégrer le tableau</button>
              </div>
            </div>
          </div>
        )}

        {resultat && besoinsTableau.length > 0 && inclureTableau !== null && (
          <label className="card card-inner mb-4 flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={inclureTableau} onChange={e => setInclureTableau(e.target.checked)} />
            <span className="text-ink-800 font-medium">Intégrer le tableau électrique au devis</span>
            <span className="text-xs text-ink-400">(disjoncteurs, différentiels et goulottes de montage)</span>
          </label>
        )}

        {toutesLesPiecesReelles.length > 1 && (
          <div className="card card-inner mb-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-ink-800 text-sm">{mode === "circuit" ? "Circuits à inclure" : "Pièces à inclure"}</h2>
              <button
                onClick={() => setPiecesSelectionnees(prev => prev === null ? new Set() : null)}
                className="text-xs text-volt-600 font-medium">
                {piecesSelectionnees === null ? "Tout désélectionner" : "Tout sélectionner"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {toutesLesPiecesReelles.map(piece => {
                const coche = piecesSelectionnees === null || piecesSelectionnees.has(piece);
                return (
                  <label key={piece} className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer ${coche ? "border-volt-400 bg-volt-50 text-volt-700" : "border-ink-200 text-ink-400"}`}>
                    <input type="checkbox" checked={coche} onChange={() => {
                      setPiecesSelectionnees(prev => {
                        const base = prev === null ? new Set(toutesLesPiecesReelles) : new Set(prev);
                        if (base.has(piece)) base.delete(piece); else base.add(piece);
                        return base.size === toutesLesPiecesReelles.length ? null : base;
                      });
                    }} />
                    {piece}
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-ink-400 mt-2">La distance au point d'arrivée des gaines et les boîtes de dérivation communes au niveau restent toujours prises en compte, même si tu ne sélectionnes que certaines pièces — sinon le calcul des longueurs de câbles et gaines serait faussé. Le tableau électrique, lui, dépend de ta réponse à l'alerte « Intégrer le tableau au devis ».</p>
          </div>
        )}

        {alertesGeometrie.length > 0 && (
          <div className="card card-inner mb-4 bg-amber-50 border-amber-200">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <AlertTriangle size={13} /> Alertes du plan
            </p>
            <div className="flex flex-col gap-1">
              {alertesGeometrie.map((a, i) => <p key={i} className="text-xs text-amber-700">{a}</p>)}
            </div>
          </div>
        )}

        {resultat && (() => {
          const nonIdentifiesFiltres = Object.values(parPieceFiltre).flat().filter(b => b.options.length === 0);
          return nonIdentifiesFiltres.length > 0 && (
          <div className="card card-inner mb-4 bg-red-50 border-red-200">
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1 flex items-center gap-1.5">
              <AlertTriangle size={13} /> {nonIdentifiesFiltres.length} besoin{nonIdentifiesFiltres.length > 1 ? "s" : ""} non identifié{nonIdentifiesFiltres.length > 1 ? "s" : ""} au catalogue
            </p>
            <p className="text-xs text-red-600">Choisis un article existant, cherche-en un autre ou saisis un prix libre pour chacun ci-dessous.</p>
          </div>
          );
        })()}

        {resultat && marquesDisponibles.length > 0 && (
          <div className="card card-inner mb-4">
            <h2 className="font-semibold text-ink-800 text-sm mb-1">Même marque partout</h2>
            <p className="text-xs text-ink-400 mb-2">Choisis une marque : toutes les lignes qui existent dans cette marque passent d'un coup sur elle (même gamme conservée si possible). Tu peux ensuite corriger ligne par ligne.</p>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={marqueGlobale} onChange={e => { setMarqueGlobale(e.target.value); setBilanMarque(null); }}
                className="text-sm border border-ink-200 rounded-lg py-1.5 px-2 bg-white min-w-[12rem]">
                <option value="">Marque…</option>
                {marquesDisponibles.map(m => <option key={m.cle} value={m.nom}>{m.nom} — {m.nbLignes} ligne{m.nbLignes > 1 ? "s" : ""}</option>)}
              </select>
              <button onClick={appliquerMarque} disabled={!marqueGlobale} className="btn-volt !text-xs disabled:opacity-40">Appliquer à toutes les lignes</button>
              <label className="flex items-center gap-1.5 text-xs text-ink-500 cursor-pointer">
                <input type="checkbox" checked={porteeMarque === "tout"} onChange={e => { setPorteeMarque(e.target.checked ? "tout" : "appareillage"); setBilanMarque(null); }} />
                Aussi boîtes, disjoncteurs et autre matériel (pas seulement l'appareillage et les plaques)
              </label>
            </div>
            {bilanMarque && (
              <div className="mt-2 text-xs">
                <p className="text-emerald-700">{bilanMarque.appliques} ligne{bilanMarque.appliques > 1 ? "s" : ""} passée{bilanMarque.appliques > 1 ? "s" : ""} en {bilanMarque.marque}.</p>
                {bilanMarque.sans.length > 0 && (
                  <details className="text-amber-700 mt-1">
                    <summary className="cursor-pointer">{bilanMarque.sans.length} ligne{bilanMarque.sans.length > 1 ? "s" : ""} sans article {bilanMarque.marque} (inchangée{bilanMarque.sans.length > 1 ? "s" : ""})</summary>
                    <ul className="list-disc ml-5 mt-1">{bilanMarque.sans.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {resultat && (() => {
          const postes = Object.entries(parPieceFiltre)
            .map(([piece, besoins]) => [piece, besoins.filter(b => !estBobinable(b.sousCategorie))] as const)
            .filter(([, besoins]) => besoins.length > 0)
            .sort(([a], [b]) => a.localeCompare(b));
          const nomPoste = mode === "circuit" ? "circuit" : "pièce";
          const ouvert = (piece: string) => postesOuverts[piece] ?? !postesOk[piece];
          const nbOk = postes.filter(([piece]) => postesOk[piece]).length;
          return (<>
            {(() => {
              const nb = postes.reduce((n, [, besoins]) => n + besoins.filter(b => (choix[b.cle] ?? etatParDefaut(b)).mode === "adefinir").length, 0);
              return nb > 0 ? (
                <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                  <AlertTriangle size={16} className="shrink-0" /> {nb} luminaire{nb > 1 ? "s" : ""} à définir avec le client — le devis ne pourra pas être envoyé tant qu'il en reste.
                </div>
              ) : null;
            })()}
            {postes.length > 0 && (
              <div className="flex items-center gap-3 mb-3 text-xs text-ink-500 flex-wrap">
                <span className="flex items-center gap-1.5">
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${nbOk === postes.length ? "bg-emerald-500" : "bg-ink-300"}`} />
                  <strong className="text-ink-700">{nbOk} / {postes.length}</strong> {mode === "circuit" ? "circuits" : "pièces"} validé{nbOk > 1 ? "s" : ""} « devis OK »
                </span>
                <button className="text-volt-600 font-medium" onClick={() => setPostesOuverts(Object.fromEntries(postes.map(([piece]) => [piece, true])))}>Tout déplier</button>
                <button className="text-volt-600 font-medium" onClick={() => setPostesOuverts(Object.fromEntries(postes.map(([piece]) => [piece, false])))}>Tout replier</button>
                <span className="ml-auto text-ink-400">{autoSauve ? `Sauvegarde auto ✓ ${autoSauve}` : "Sauvegarde auto activée"}</span>
              </div>
            )}
            {postes.map(([piece, besoins]) => {
              const ok = !!postesOk[piece];
              const ouv = ouvert(piece);
              const nbDef = besoins.filter(b => (choix[b.cle] ?? etatParDefaut(b)).mode === "adefinir").length;
              return (
          <div key={piece} className={`card card-inner mb-4 ${ok ? "!border-emerald-300" : ""}`}>
            <div className="flex items-center justify-between gap-3">
              <button type="button" className="flex items-center gap-2 min-w-0 flex-1 text-left" aria-expanded={ouv}
                onClick={() => setPostesOuverts(prev => ({ ...prev, [piece]: !ouv }))}>
                {ouv ? <ChevronDown size={16} className="shrink-0 text-ink-400" /> : <ChevronRight size={16} className="shrink-0 text-ink-400" />}
                <span className="font-semibold text-ink-800 min-w-0 break-words">{piece}{(() => {
                // Aide au chiffrage, AFFICHAGE SEUL (le nom du poste du devis reste `piece`) : longueur de câble du circuit + nombre d'appareils.
                if (mode !== "circuit") return null;
                const r = recapCircuits.find(x => x.groupe === piece);
                if (!r) return null;
                const m = r.lignes.filter(l => l.sousCategorie.startsWith("cablage_") || l.sousCategorie === "retour_lampe" || l.sousCategorie === "navette" || l.sousCategorie === "aller_commande" || l.sousCategorie === "cable_rj45" || l.sousCategorie === "cable_coax").reduce((a, l) => a + l.quantite, 0);
                return <span className="ml-2 text-sm font-normal text-ink-500 whitespace-nowrap">({m.toFixed(1).replace(".", ",")} m · {r.nbAppareils} appareil{r.nbAppareils > 1 ? "s" : ""})</span>;
              })()}</span>
                {nbDef > 0 && <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-300 rounded-full px-2 py-0.5"><AlertTriangle size={11} /> À définir avec le client{nbDef > 1 ? ` ×${nbDef}` : ""}</span>}
                {ok && <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> OK devis</span>}
              </button>
              <label className="flex items-center gap-1.5 shrink-0 text-xs text-ink-500" title="Temps de main d'œuvre chiffré pour ce poste (facultatif) — comparé au temps passé dans le suivi de réalisation">
                <span className="hidden sm:inline">Main d'œuvre</span>
                <input className="input !py-1 !px-2 !w-16 text-right text-sm" type="number" inputMode="decimal" min="0" step="0.25" placeholder="0"
                  value={heuresPostes[piece] ?? ""}
                  onChange={e => setHeuresPostes(prev => ({ ...prev, [piece]: e.target.value }))} />
                <span>h</span>
              </label>
            </div>
            {ouv && (<>
            <div className="flex flex-col gap-2 mt-3">
              {besoins.map(b => (
                <BesoinRow key={b.cle} besoin={b} etat={choix[b.cle] ?? etatParDefaut(b)}
                  onChange={e => majChoix(b.cle, e)} prestations={prestations} onCatalogueAjoute={ajouterAuCatalogue} />
              ))}
            </div>
            <label className={`mt-3 pt-3 border-t border-ink-100 flex items-center gap-2 text-sm cursor-pointer ${ok ? "text-emerald-700 font-semibold" : "text-ink-600"}`}>
              <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={ok}
                onChange={e => {
                  const v = e.target.checked;
                  setPostesOk(prev => ({ ...prev, [piece]: v }));
                  if (v) setPostesOuverts(prev => ({ ...prev, [piece]: false })); // validé → on replie
                }} />
              <Check size={14} className={ok ? "text-emerald-600" : "text-ink-300"} /> Devis OK pour ce {nomPoste}
            </label>
            </>)}
          </div>
              );
            })}
          </>);
        })()}

        {besoinsAgreges.length > 0 && (
          <div className="card card-inner mb-4 border-sky-200">
            <div className="flex items-center gap-2 mb-1">
              <Cable size={16} className="text-sky-600" />
              <h2 className="font-semibold text-ink-800">Câbles, gaines & moulures — total toutes pièces</h2>
            </div>
            <p className="text-xs text-ink-400 mb-3">Un seul choix par section/type sur le métrage total nécessaire — la meilleure combinaison bobine + mètre linéaire se calcule sur l'ensemble, pas pièce par pièce. Le détail par pièce reste visible dans chaque besoin ci-dessous.</p>
            <div className="flex flex-col gap-2">
              {besoinsAgreges.map(b => (
                <BesoinRow key={b.cle} besoin={b} etat={choixAgrege[b.cle] ?? etatParDefaut(b)}
                  onChange={e => setChoixAgrege(prev => ({ ...prev, [b.cle]: e }))} prestations={prestations} detail={b.piece} onCatalogueAjoute={ajouterAuCatalogue} />
              ))}
            </div>
            {/* Validation du câblage : sert au double contrôle du plan (« Masquer OK devis ») — câbles et gaines ne se masquent que s'ils sont validés ici. */}
            <div className="mt-3 pt-3 border-t border-ink-100 flex flex-col gap-1.5">
              {([["__cables__", "Câbles OK devis"], ["__gaines__", "Gaines & moulures OK devis"]] as const).map(([cle, libelle]) => (
                <label key={cle} className={`flex items-center gap-2 text-sm cursor-pointer ${postesOk[cle] ? "text-emerald-700 font-semibold" : "text-ink-600"}`}>
                  <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={!!postesOk[cle]}
                    onChange={e => setPostesOk(prev => ({ ...prev, [cle]: e.target.checked }))} />
                  <Check size={14} className={postesOk[cle] ? "text-emerald-600" : "text-ink-300"} /> {libelle}
                  {postesOk[cle] && <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> OK devis</span>}
                </label>
              ))}
            </div>
          </div>
        )}

        {resultat && Object.keys(parPieceFiltre).length === 0 && (
          <div className="card card-inner text-center py-10 text-ink-400 mb-4">
            Aucun besoin détecté — le plan de circuits est-il complet (appareillages placés, tableau positionné) ?
          </div>
        )}

        <div className="card card-inner mb-4">
          <h2 className="font-semibold text-ink-800 mb-3">Main d'œuvre & frais</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label">Main d'œuvre générale (heures)</label>
              <input className="input" type="number" min="0" step="0.5" value={mainOeuvreHeures}
                onChange={e => setMainOeuvreHeures(e.target.value)} />
              <p className="text-[11px] text-ink-400 mt-1">
                {totalHeuresPostes > 0
                  ? `+ ${totalHeuresPostes} h saisie${totalHeuresPostes > 1 ? "s" : ""} par poste ci-dessus (${heuresParPoste.length} poste${heuresParPoste.length > 1 ? "s" : ""}) = ${heures} h au total.`
                  : "Heures non rattachées à un poste. Tu peux aussi saisir les heures poste par poste (champ « Main d'œuvre » de chaque carte) : elles s'ajoutent à celles-ci et servent à comparer ton estimation au temps réellement passé."}
              </p>
            </div>
            <div>
              <label className="label">Tarif horaire</label>
              {optionsMainOeuvre.length > 0 ? (
                <select className="input" value={mainOeuvreIndex} onChange={e => setMainOeuvreIndex(Number(e.target.value))}>
                  {optionsMainOeuvre.map((o, i) => (
                    <option key={i} value={i}>{o.gamme ? `${LABEL_GAMME[o.gamme]} — ` : ""}{o.nom} ({fmt(o.prix_unitaire)}/h)</option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-2">
                  Aucun article "main_oeuvre" au catalogue — taux du profil utilisé ({fmt(profil?.taux_horaire ?? 0)}/h).
                </p>
              )}
            </div>
            <div>
              <label className="label">Frais généraux (%)</label>
              <input className="input" type="number" min="0" step="0.5" value={fraisGenerauxPct}
                onChange={e => setFraisGenerauxPct(e.target.value)} />
            </div>
            <div>
              <label className="label">Déplacement (€)</label>
              <input className="input" type="number" min="0" step="1" value={deplacementEur}
                onChange={e => setDeplacementEur(e.target.value)} />
            </div>
          </div>
        </div>

        {resultat && recapCircuits.length > 0 && (() => {
          // En mode « par circuit », la sélection des circuits à inclure s'applique aussi au métrage.
          const visibles = recapCircuits.filter(r => mode !== "circuit" || piecesSelectionnees === null || piecesSelectionnees.has(r.groupe));
          if (visibles.length === 0) return null;
          const estCable = (c: string) => c.startsWith("cablage_") || c === "retour_lampe" || c === "navette" || c === "aller_commande" || c === "cable_rj45" || c === "cable_coax";
          const fmtM = (n: number) => `${n.toFixed(2)} m`;
          const totaux = new Map<string, { label: string; quantite: number; unite: string }>();
          let totalCable = 0;
          visibles.forEach(r => r.lignes.forEach(l => {
            const t = totaux.get(l.sousCategorie) ?? { label: l.label, quantite: 0, unite: l.unite };
            t.quantite += l.quantite; totaux.set(l.sousCategorie, t);
            if (estCable(l.sousCategorie)) totalCable += l.quantite;
          }));
          const ordre = (c: string) => estCable(c) ? 0 : c.startsWith("gaine") ? 1 : c === "moulure" ? 2 : 3;
          return (
            <div className="card card-inner mb-4">
              <h2 className="font-semibold text-ink-800 text-sm mb-1">Métrage par circuit</h2>
              <p className="text-xs text-ink-500 mb-3">Câbles, gaines, moulures… de chaque circuit — <strong>à titre d'information</strong> : ces mètres sont déjà dans les lignes du devis, ils ne sont pas recomptés.</p>
              <div className="flex flex-col gap-2">
                {visibles.map(r => {
                  const cable = r.lignes.filter(l => estCable(l.sousCategorie)).reduce((a, l) => a + l.quantite, 0);
                  return (
                    <div key={r.cle} className="rounded-lg border border-ink-200 px-3 py-2">
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="font-medium text-ink-800">{r.nom} <span className="text-xs text-ink-400">({r.niveau})</span></span>
                        <span className="text-ink-600 whitespace-nowrap">câble {fmtM(cable)}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-500 mt-1">
                        {[...r.lignes].sort((a, b) => ordre(a.sousCategorie) - ordre(b.sousCategorie)).map(l => (
                          <span key={l.sousCategorie}>{l.label} : <strong className="text-ink-700">{l.unite === "m" ? fmtM(l.quantite) : `${l.quantite} u`}</strong></span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-ink-200 bg-ink-50 rounded-lg px-3 py-2">
                <div className="flex justify-between text-sm font-semibold text-ink-700">
                  <span>Récapitulatif total (information — non recompté)</span><span>câble {fmtM(totalCable)}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-500 mt-1">
                  {[...totaux.entries()].sort((a, b) => ordre(a[0]) - ordre(b[0]) || a[0].localeCompare(b[0])).map(([c, t]) => (
                    <span key={c}>{t.label} : <strong className="text-ink-700">{t.unite === "m" ? fmtM(t.quantite) : `${t.quantite} u`}</strong></span>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {resultat && mode === "piece" && piecesDuPlan.length > 0 && (() => {
          // Contrôle « rien oublié » : chaque pièce du plan doit devenir un poste du devis. Une pièce sans aucune ligne
          // (aucun appareillage, besoins tous exclus, ou décochée plus haut) n'aura PAS de poste — on la signale ici.
          const lignesParPiece = new Map<string, number>();
          Object.entries(parPieceFiltre).forEach(([piece, besoins]) => {
            const n = besoins.filter(b => !estBobinable(b.sousCategorie) && (choix[b.cle] ?? etatParDefaut(b)).mode !== "exclu").length;
            if (n > 0) lignesParPiece.set(piece, n);
          });
          const metrage = new Set<string>();
          Object.entries(parPieceFiltre).forEach(([piece, besoins]) => { if (besoins.some(b => estBobinable(b.sousCategorie))) metrage.add(piece); });
          const lignesPlan = piecesDuPlan.map(pc => {
            const exclue = piecesSelectionnees !== null && !piecesSelectionnees.has(pc.nom) && estPieceReelle(pc.nom);
            const n = lignesParPiece.get(pc.nom) ?? 0;
            const cable = metrage.has(pc.nom);
            return { ...pc, exclue, n, cable, ok: !exclue && (n > 0 || cable) };
          });
          const aVerifier = lignesPlan.filter(x => !x.ok);
          return (
            <div className={`card card-inner mb-4 ${aVerifier.length > 0 ? "bg-amber-50 border-amber-200" : "border-emerald-200"}`}>
              <h2 className="font-semibold text-ink-800 text-sm mb-1">Contrôle des pièces → postes du devis</h2>
              <p className="text-xs text-ink-500 mb-2">
                Chaque pièce chiffrée devient un <strong>poste</strong> du devis (même nom). Le tableau et les liaisons communes ont leur propre poste, les câbles/gaines/moulures forment le poste « {POSTE_CABLAGE} », et la main d'œuvre le poste « {POSTE_MAIN_OEUVRE} ».
              </p>
              <div className="flex flex-wrap gap-1.5">
                {lignesPlan.map((x, i) => (
                  <span key={`${x.niveau}-${x.nom}-${i}`}
                    className={`text-xs px-2 py-1 rounded-lg border ${x.ok ? "border-emerald-300 bg-emerald-50 text-emerald-700" : x.exclue ? "border-ink-300 bg-ink-100 text-ink-500" : "border-amber-400 bg-amber-100 text-amber-800"}`}
                    title={x.niveau}>
                    {x.ok ? "✓" : x.exclue ? "⛔" : "⚠"} {x.nom} — {x.exclue ? "décochée" : x.ok ? `${x.n} ligne${x.n > 1 ? "s" : ""}${x.cable ? " + câblage" : ""}` : "aucune ligne"}
                  </span>
                ))}
              </div>
              {aVerifier.length > 0 && (
                <p className="text-xs text-amber-700 mt-2">
                  {aVerifier.length} pièce{aVerifier.length > 1 ? "s" : ""} sans poste dans le devis : {aVerifier.map(x => x.nom).join(", ")}. Vérifie qu'il n'y a vraiment rien à y chiffrer (appareillage non posé, besoins exclus, pièce décochée).
                </p>
              )}
            </div>
          );
        })()}

        <div className="card card-inner mb-6">
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between text-ink-500"><span>Consommables</span><span>{fmt(totalConsommablesApprox)}</span></div>
            <div className="flex justify-between text-ink-500"><span>Main d'œuvre</span><span>{fmt(totalMainOeuvre)}</span></div>
            {fraisGeneraux > 0 && <div className="flex justify-between text-ink-500"><span>Frais généraux</span><span>{fmt(fraisGeneraux)}</span></div>}
            {deplacement > 0 && <div className="flex justify-between text-ink-500"><span>Déplacement</span><span>{fmt(deplacement)}</span></div>}
            <div className="flex justify-between font-bold text-volt-600 text-base pt-2 border-t border-ink-200">
              <span>Total estimé HT</span><span>{fmt(totalGeneral)}</span>
            </div>
          </div>
          <p className="text-xs text-ink-400 mt-2">Total approximatif (arrondis de bobines non appliqués ici) — le devis final, lui, applique la décomposition exacte en bobines.</p>
        </div>

        <div className="flex gap-3">
          <button onClick={sauvegarderBrouillon} disabled={savingDraft || !resultat}
            className={`btn-ghost flex-1 justify-center ${draftSaved ? "!bg-emerald-500 !border-emerald-600 !text-white" : ""}`}>
            <Save size={15} /> {savingDraft ? "…" : draftSaved ? "Brouillon sauvegardé !" : "Sauvegarder le brouillon"}
          </button>
          <button onClick={genererDevis} disabled={generating || !resultat} className="btn-volt flex-1 justify-center">
            <Sparkles size={15} /> {generating ? "Génération…" : "Valider → Générer le devis final"}
          </button>
        </div>
      </div>
    </Shell>
  );
}
