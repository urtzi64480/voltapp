"use client";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Prestation, PrestationFournisseur } from "@/types";
import {
  attacherOffres, chargerOffres, draftsDepuisLegacy, draftsPourProduit, libelleOffre, libelleOffreMarque, marqueOffre, marquesDe,
  miroirPrestation, normaliserDrafts, normTexte, nouvelleOffreDraft, offrePrincipale, offresDe, imageOffre, nomDepuisUrl, normaliserUrl,
  offresTriees, offresVersNormalisees, prixVenteOffre, synchroniserOffres, rattacherParNom, OffreDraft, OffreNormalisee} from "@/lib/fournisseurs";

import { fmt, UNITES, cn, dateLocale, echecSupabase } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import { calcMarge, URSSAF_MATERIAU_PCT, margeMiniUrssaf, prixVenteMiniUrssaf, gainNetUrssaf, MargeTag, FournisseursEditor, longueurValide, BobineField } from "@/components/catalogue/EditeurArticle";
import FusionDoublons from "@/components/catalogue/FusionDoublons";
import BadgeConditionnement from "@/components/devis/BadgeConditionnement";
import { NOMENCLATURE_APPAREILLAGE } from "@/lib/predevis-engine";
import {
  Plus, Trash2, Save, Pencil, X, ChevronDown, ChevronUp,
  Wrench, Package, Search, Download, Upload, AlertCircle,
  CheckCircle2, Layers, RefreshCw, ExternalLink, GitMerge, Link2
} from "lucide-react";
import { sousCategoriesDe, joindreSousCategories, normaliserSousCategories, libelleSousCategories } from "@/lib/sous-categories";

type PrestationExt = Prestation & { prix_achat?: number | null; est_kit?: boolean; kit_description?: string | null };

interface KitComposant {
  id: string;
  composant_id: string;
  quantite: number;
  ordre: number;
  prestation?: PrestationExt;
}

function getFavicon(url: string) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`; }
  catch { return null; }
}
function getLinkLabel(url: string) {
  try { return new URL(url).hostname.replace("www.", ""); }
  catch { return url; }
}
function matchSearch(p: PrestationExt, q: string): boolean {
  if (!q.trim()) return true;
  const lower = q.toLowerCase();
  return [p.nom, p.description, p.marque, p.sous_categorie, p.categorie, ...marquesDe(p),
    ...(p.fournisseurs ?? []).flatMap(o => [o.fournisseur, o.reference])]
    .some(v => v?.toLowerCase().includes(lower));
}
function genKitDescription(composants: KitComposant[]): string {
  if (composants.length === 0) return "";
  const parts = composants.map(c => {
    const nom = c.prestation?.nom ?? "?";
    const qte = c.quantite;
    const unite = c.prestation?.unite ?? "u";
    return `${qte}× ${nom}${unite !== "u" && unite !== "forfait" ? ` (${unite})` : ""}`;
  });
  return "Contient : " + parts.join(", ");
}

// ─── Sous-composants ────────────────────────────────────────────────────────

function FournisseurLogo({ url, titre }: { url: string; titre?: string }) {
  const favicon = getFavicon(url);
  const label = getLinkLabel(url);
  if (!favicon) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      onClick={e => e.stopPropagation()} title={titre ?? `Vérifier le prix sur ${label}`}
      className="flex items-center justify-center w-8 h-8 rounded-lg border border-ink-100 bg-white hover:border-volt-400 hover:shadow-sm transition-all overflow-hidden shrink-0">
      <img src={favicon} alt={label} className="w-5 h-5 object-contain" />
    </a>
  );
}

// Lien de vérification de prix : quelle marque, chez quel fournisseur, pour quel produit.
interface LienVerif { url: string; marque: string; fournisseur: string; reference?: string | null }

function liensVerification(p: PrestationExt, offres: PrestationFournisseur[]): LienVerif[] {
  if (offres.length > 0) {
    return offres.filter(o => !!o.url).map(o => ({
      url: o.url as string, marque: marqueOffre(p, o), fournisseur: libelleOffre(o), reference: o.reference,
    }));
  }
  return (p.liens_fournisseurs ?? []).filter(Boolean).map(url => ({
    url, marque: (p.marque ?? "").trim(), fournisseur: nomDepuisUrl(url) || getLinkLabel(url),
  }));
}

// Liens de vérification d'un produit : toujours la même icône (Link2) avec le nombre de liens, quel que soit
// le nombre de marques — la liste reste uniforme. Le menu qui s'ouvre détaille, pour chaque lien, le logo du
// fournisseur, la marque et le produit visés. Il est en position fixe : la carte de la catégorie masque ce qui dépasse.
function LiensVerification({ produit, liens }: { produit: string; liens: LienVerif[] }) {
  const [menu, setMenu] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const fermer = () => setMenu(null);
    window.addEventListener("scroll", fermer, true);
    window.addEventListener("resize", fermer);
    return () => { window.removeEventListener("scroll", fermer, true); window.removeEventListener("resize", fermer); };
  }, [menu]);
  if (liens.length === 0) return (
    <span className="flex items-center justify-center w-8 h-8 rounded-lg border border-dashed border-ink-100 text-ink-200" title="Aucun lien de vérification">
      <Link2 size={14} />
    </span>
  );
  function ouvrir(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (menu) { setMenu(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - 320, window.innerWidth - 328));
    setMenu(r.bottom > window.innerHeight * 0.6 ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  }
  return (
    <div className="relative shrink-0">
      <button type="button" onClick={ouvrir}
        title={`${liens.length} lien${liens.length > 1 ? "s" : ""} de vérification des prix`} aria-label="Liens de vérification des prix"
        className={cn("relative flex items-center justify-center w-8 h-8 rounded-lg border bg-white text-volt-600 transition-all hover:border-volt-400 hover:shadow-sm",
          menu ? "border-volt-400 shadow-sm" : "border-ink-100")}>
        <Link2 size={15} />
        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-ink-900 text-volt-400 text-[10px] font-semibold leading-4 text-center">{liens.length}</span>
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setMenu(null); }} />
          <div className="fixed z-50 w-80 max-h-[60vh] overflow-y-auto rounded-xl border border-ink-200 bg-white shadow-lg"
            style={{ left: menu.left, top: menu.top, bottom: menu.bottom }} onClick={e => e.stopPropagation()}>
            <p className="px-3 py-2 text-xs font-semibold text-ink-700 border-b border-ink-100 truncate" title={produit}>Vérifier les prix · {produit}</p>
            <div className="divide-y divide-ink-100">
              {liens.map((l, i) => (
                <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" onClick={() => setMenu(null)}
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-ink-50">
                  <FournisseurLogo url={l.url} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-ink-900 truncate">{[l.marque, l.fournisseur].filter(Boolean).join(" · ") || getLinkLabel(l.url)}</span>
                    <span className="block text-[11px] text-ink-400 truncate">{l.reference ? `réf. ${l.reference} · ` : ""}{getLinkLabel(l.url)}</span>
                  </span>
                  <ExternalLink size={13} className="text-ink-300 shrink-0" />
                </a>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ProduitThumb({ imageUrl }: { imageUrl: string | null }) {
  if (!imageUrl) return (
    <div className="w-10 h-10 rounded-lg bg-ink-50 border border-ink-100 flex items-center justify-center shrink-0">
      <Package size={14} className="text-ink-300" />
    </div>
  );
  return (
    <div className="w-10 h-10 rounded-lg border border-ink-100 overflow-hidden shrink-0 bg-white">
      <img src={imageUrl} alt="" className="w-full h-full object-contain p-0.5"
        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
    </div>
  );
}

// ─── Sous-catégories connues (référence du moteur pré-devis, predevis-engine.ts) ───
// Autocomplétion pour le champ "Sous-catégorie" — évite les fautes de frappe/copié-collé
// qui rendraient un article invisible au pré-devis sans qu'on s'en aperçoive. Cette liste
// doit rester synchronisée avec les sous_categorie recherchées par calculerBesoinsBruts()
// dans src/lib/predevis-engine.ts — la mettre à jour si de nouveaux besoins y sont ajoutés.
const SOUS_CATEGORIES_CONNUES: { code: string; label: string }[] = [
  { code: "cable_1.5", label: "Câble tout-en-un 1.5mm² (3G1.5)" },
  { code: "cable_2.5", label: "Câble tout-en-un 2.5mm² (3G2.5)" },
  { code: "cable_4.0", label: "Câble tout-en-un 4mm² (3G4)" },
  { code: "cable_6.0", label: "Câble tout-en-un 6mm² (3G6)" },
  { code: "cable_10.0", label: "Câble tout-en-un 10mm² (3G10)" },
  { code: "fil_1.5", label: "Fil séparé 1.5mm² (H07V-U)" },
  { code: "fil_2.5", label: "Fil séparé 2.5mm² (H07V-U)" },
  { code: "fil_4.0", label: "Fil séparé 4mm² (H07V-U)" },
  { code: "fil_6.0", label: "Fil séparé 6mm² (H07V-U)" },
  { code: "fil_10.0", label: "Fil séparé 10mm² (H07V-U)" },
  { code: "gaine_irl16", label: "Gaine IRL 16" },
  { code: "gaine_irl20", label: "Gaine IRL 20" },
  { code: "gaine_irl25", label: "Gaine IRL 25" },
  { code: "gaine_irl32", label: "Gaine IRL 32" },
  { code: "gaine_irl40", label: "Gaine IRL 40" },
  { code: "moulure", label: "Moulure" },
  { code: "retour_lampe", label: "Retour lampe (fil, lampe → 1er interrupteur)" },
  { code: "navette", label: "Navette (fil, entre deux va-et-vient)" },
  { code: "boite_derivation", label: "Boîte de dérivation" },
  { code: "wago_221_2", label: "Borne WAGO 221-412 (2 conducteurs, à levier)" },
  { code: "wago_221_3", label: "Borne WAGO 221-413 (3 conducteurs, à levier)" },
  { code: "wago_221_5", label: "Borne WAGO 221-415 (5 conducteurs, à levier)" },
  { code: "boite_encastrement_1poste", label: "Boîte d'encastrement simple" },
  { code: "boite_encastrement_2postes", label: "Boîte d'encastrement double" },
  { code: "boite_encastrement_3postes", label: "Boîte d'encastrement triple" },
  { code: "boite_encastrement_4postes", label: "Boîte d'encastrement quadruple" },
  { code: "boite_encastrement_dcl", label: "Boîte d'encastrement DCL (point lumineux)" },
  { code: "plaque_1poste", label: "Plaque de finition simple (1 poste)" },
  { code: "plaque_2postes", label: "Plaque de finition double (2 postes)" },
  { code: "plaque_3postes", label: "Plaque de finition triple (3 postes)" },
  { code: "plaque_4postes", label: "Plaque de finition quadruple (4 postes)" },
  { code: "cable_rj45", label: "Câble RJ45 cat. 6 STP (au mètre / bobine)" },
  { code: "cable_coax", label: "Câble coaxial TV / antenne (au mètre / bobine)" },
  { code: "disjoncteur_2A", label: "Disjoncteur 2A" },
  { code: "disjoncteur_6A", label: "Disjoncteur 6A" },
  { code: "disjoncteur_10A", label: "Disjoncteur 10A" },
  { code: "disjoncteur_16A", label: "Disjoncteur 16A" },
  { code: "disjoncteur_20A", label: "Disjoncteur 20A" },
  { code: "disjoncteur_25A", label: "Disjoncteur 25A" },
  { code: "disjoncteur_32A", label: "Disjoncteur 32A" },
  { code: "disjoncteur_40A", label: "Disjoncteur 40A" },
  { code: "disjoncteur_63A", label: "Disjoncteur 63A" },
  ...[25, 40, 63, 80, 100, 125].flatMap(cal =>
    (["AC", "A", "F"] as const).map(t => ({ code: `differentiel_${cal}A_${t}`, label: `Différentiel ${cal}A Type ${t}` }))),
  ...[40, 63, 80, 100, 125].map(cal => ({ code: `interrupteur_sectionneur_${cal}A`, label: `Interrupteur-sectionneur ${cal}A (coupure générale)` })),
  { code: "prise_modulaire_16A", label: "Prise de courant modulaire 16A 2P+T (rail DIN)" },
  // GTL (gaine technique du logement) : poste « Tableau électrique » du pré-devis.
  { code: "coffret_communication", label: "Coffret de communication (grade 3, avec répartiteur RJ45)" },
  { code: "kit_gtl", label: "Gaine technique logement GTL 60 × 25 cm" },
  { code: "panneau_controle_gtl", label: "Panneau de contrôle GTL (compteur / disjoncteur d'abonné)" },
  { code: "moulure_gtl", label: "Moulure GTL 2,5 m" },
  { code: "boitier_derivation_gtl", label: "Boîtier de raccordement / dérivation GTL" },
  { code: "coffret_tableau_1r", label: "Coffret de tableau 1 rangée 13 modules" },
  { code: "coffret_tableau_2r", label: "Coffret de tableau 2 rangées 13 modules" },
  { code: "coffret_tableau_3r", label: "Coffret de tableau 3 rangées 13 modules" },
  { code: "coffret_tableau_4r", label: "Coffret de tableau 4 rangées 13 modules" },
  { code: "plastron_tableau", label: "Plastron de finition (1 par rangée)" },
  { code: "peigne_tableau", label: "Peigne de distribution (1 par rangée)" },
  { code: "bornier_terre_tableau", label: "Répartiteur / barrette de terre (1 par rangée)" },
  { code: "bornier_neutre_tableau", label: "Répartiteur de neutre (1 par rangée)" },
  { code: "obturateur_module", label: "Obturateur de module vide" },
  { code: "liaison_abonne_10mm", label: "Câble 10 mm² liaison disjoncteur d'abonné → tableau" },
  { code: "etiquettes_tableau", label: "Lot d'étiquettes de repérage des circuits" },
  { code: "parafoudre_type2", label: "Parafoudre type 2" },
  { code: "barrette_terre_principale", label: "Barrette de terre principale de la GTL" },
  { code: "liaison_equipotentielle_6mm", label: "Conducteur vert/jaune 6 mm² (liaison équipotentielle)" },
  { code: "visserie_gtl", label: "Visserie, colliers, chevilles et gaine de liaison GTL (lot)" },
  { code: "dti_rj45", label: "DTI — dispositif de terminaison intérieur RJ45" },
  { code: "repartiteur_tv", label: "Répartiteur TV" },
  { code: "bandeau_brassage_rj45", label: "Bandeau de brassage RJ45 cat. 6 STP 4 ports" },
  { code: "cordon_brassage_rj45", label: "Cordon de brassage RJ45 cat. 6" },
  { code: "support_box_gtl", label: "Support / tablette pour box et switch" },
  { code: "goulotte_tableau", label: "Goulotte de montage du tableau (1 par rangée)" },
  // Appareillages (prise, interrupteurs simples/doubles, RJ45, points lumineux, variantes domotiques, sortie
  // spécialisée…) : dérivés du moteur pré-devis — voir NOMENCLATURE_APPAREILLAGE.
  ...NOMENCLATURE_APPAREILLAGE,
  { code: "main_oeuvre", label: "Main d'œuvre" },
];

// Sous-catégories (« nomenclatures ») d'un article : une ou PLUSIEURS — un même interrupteur peut être un simple ET un
// va-et-vient. Chaque code est une pastille ; on en ajoute en tapant (autocomplétion sur la nomenclature du pré-devis) puis
// Entrée / virgule / clic sur une suggestion, on en retire avec ✕ ou Retour arrière. Valeur stockée : codes séparés par « | ».
function SousCategorieInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [saisie, setSaisie] = useState("");
  const codes = sousCategoriesDe(value);
  const q = saisie.trim().toLowerCase();
  const suggestions = SOUS_CATEGORIES_CONNUES
    .filter(c => !codes.includes(c.code))
    .filter(c => q.length === 0 || c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q));
  const ajouter = (code: string) => {
    const c = code.trim();
    if (c) onChange(joindreSousCategories([...codes, c]));
    setSaisie("");
  };
  const retirer = (code: string) => onChange(joindreSousCategories(codes.filter(c => c !== code)));
  return (
    <div className="relative">
      <div className="input flex flex-wrap items-center gap-1 !h-auto min-h-[2.25rem] !py-1">
        {codes.map(c => (
          <span key={c} className="inline-flex items-center gap-1 rounded-md bg-volt-50 border border-volt-200 px-1.5 py-0.5 text-xs font-mono font-semibold text-volt-700">
            {c}
            <button type="button" onClick={() => retirer(c)} className="text-volt-500 hover:text-red-500 leading-none" title="Retirer cette nomenclature">✕</button>
          </span>
        ))}
        <input className="flex-1 min-w-[8rem] bg-transparent outline-none text-sm"
          placeholder={codes.length === 0 ? "Ex : fil_2.5, prise, disjoncteur_16A…" : "Ajouter une autre nomenclature…"}
          value={saisie}
          onChange={e => {
            const v = e.target.value;
            if (/[,;|]/.test(v)) { v.split(/[,;|]/).forEach((part, i, arr) => { if (i < arr.length - 1) ajouter(part); else setSaisie(part); }); }
            else setSaisie(v);
            setOpen(true);
          }}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); if (saisie.trim()) ajouter(saisie); }
            else if (e.key === "Backspace" && saisie === "" && codes.length > 0) retirer(codes[codes.length - 1]);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => { if (saisie.trim()) ajouter(saisie); setOpen(false); }, 150)} />
      </div>
      {codes.length > 1 && <p className="text-[10px] text-ink-400 mt-0.5">Cet article sera proposé pour chacune de ces nomenclatures du pré-devis.</p>}
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-ink-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {suggestions.map(s => (
            <button key={s.code} type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { ajouter(s.code); }}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-volt-50">
              <span className="font-mono font-semibold text-volt-600 shrink-0">{s.code}</span>
              <span className="text-ink-400 truncate">{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Modal Kit ───────────────────────────────────────────────────────────────

function KitModal({
  kit, prestations, onClose, onSaved,
}: {
  kit: PrestationExt | null;
  prestations: PrestationExt[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nomKit, setNomKit] = useState(kit?.nom ?? "");
  const [categorieKit, setCategorieKit] = useState(kit?.categorie ?? "Kits");
  const [composants, setComposants] = useState<KitComposant[]>([]);
  const [searchComp, setSearchComp] = useState("");
  const [description, setDescription] = useState(kit?.kit_description ?? "");
  const [descriptionManuelle, setDescriptionManuelle] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!kit);

  const categories = [...new Set(prestations.map(p => p.categorie))].sort();
  const disponibles = prestations.filter(p =>
    !p.est_kit &&
    p.id !== kit?.id &&
    !composants.some(c => c.composant_id === p.id) &&
    matchSearch(p, searchComp)
  );

  const prixTotal = composants.reduce((sum, c) => {
    return sum + (c.prestation?.prix_unitaire ?? 0) * c.quantite;
  }, 0);

  const brancheMajoritaire: "service" | "materiau" = (() => {
    const services = composants.filter(c => c.prestation?.type_branche === "service").length;
    const materiaux = composants.filter(c => c.prestation?.type_branche === "materiau").length;
    return services >= materiaux ? "service" : "materiau";
  })();

  useEffect(() => {
    if (!kit) return;
    supabase.from("kit_composants")
      .select("*, prestation:composant_id(*)")
      .eq("kit_id", kit.id)
      .order("ordre")
      .then(({ data }) => {
        setComposants((data ?? []).map((d: any) => ({
          id: d.id,
          composant_id: d.composant_id,
          quantite: d.quantite,
          ordre: d.ordre,
          prestation: d.prestation,
        })));
        setLoading(false);
      });
  }, [kit]);

  useEffect(() => {
    if (descriptionManuelle) return;
    setDescription(genKitDescription(composants));
  }, [composants, descriptionManuelle]);

  function addComposant(p: PrestationExt) {
    setComposants(prev => [...prev, {
      id: crypto.randomUUID(),
      composant_id: p.id,
      quantite: 1,
      ordre: prev.length,
      prestation: p,
    }]);
    setSearchComp("");
  }

  function updateQte(idx: number, qte: number) {
    setComposants(prev => {
      const n = [...prev];
      n[idx] = { ...n[idx], quantite: qte };
      return n;
    });
  }

  function removeComposant(idx: number) {
    setComposants(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!nomKit.trim()) { alert("Le nom du kit est obligatoire."); return; }
    if (composants.length < 2) { alert("Un kit doit contenir au moins 2 composants."); return; }
    setSaving(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { setSaving(false); return; }

    let kitId = kit?.id;
    let anciensComposants: string[] = [];

    if (!kitId) {
      const { data, error } = await supabase.from("prestations").insert({
        user_id: session.user.id,
        nom: nomKit,
        categorie: categorieKit,
        prix_unitaire: prixTotal,
        unite: "forfait",
        type_branche: brancheMajoritaire,
        est_kit: true,
        kit_description: description,
        actif: true,
      }).select().single();
      if (error || !data) { alert("Erreur : " + error?.message); setSaving(false); return; }
      kitId = data.id;
    } else {
      const { error: errKit } = await supabase.from("prestations").update({
        nom: nomKit,
        categorie: categorieKit,
        prix_unitaire: prixTotal,
        type_branche: brancheMajoritaire,
        est_kit: true,
        kit_description: description,
      }).eq("id", kitId);
      if (echecSupabase(errKit, "Modification du kit")) { setSaving(false); return; }
      // Anciens composants mémorisés : on ne les supprime qu'APRÈS l'insertion réussie des nouveaux
      // (sinon un échec réseau entre les deux laissait le kit vide).
      const { data: anciens, error: errAnciens } = await supabase.from("kit_composants").select("id").eq("kit_id", kitId);
      if (echecSupabase(errAnciens, "Lecture des composants du kit")) { setSaving(false); return; }
      anciensComposants = (anciens ?? []).map((a: { id: string }) => a.id);
    }

    const { error: errInsert } = await supabase.from("kit_composants").insert(
      composants.map((c, i) => ({
        kit_id: kitId,
        composant_id: c.composant_id,
        quantite: c.quantite,
        ordre: i,
        user_id: session.user.id,
      }))
    );
    if (echecSupabase(errInsert, "Enregistrement des composants du kit")) { setSaving(false); return; }
    if (anciensComposants.length > 0) {
      const { error: errSuppr } = await supabase.from("kit_composants").delete().in("id", anciensComposants);
      echecSupabase(errSuppr, "Nettoyage des anciens composants du kit");
    }

    setSaving(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
              <Layers size={15} className="text-purple-600" />
            </div>
            <h2 className="font-semibold text-ink-900">{kit ? "Modifier le kit" : "Nouveau kit"}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-ink-100 text-ink-400"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading ? (
            <p className="text-center text-ink-400 py-8">Chargement…</p>
          ) : (
            <>
              {/* Infos kit */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Nom du kit *</label>
                  <input className="input" placeholder="Ex : Prise complète encastrée"
                    value={nomKit} onChange={e => setNomKit(e.target.value)} />
                </div>
                <div>
                  <label className="label">Catégorie</label>
                  <select className="input" value={categorieKit} onChange={e => setCategorieKit(e.target.value)}>
                    <option value="Kits">Kits</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Recherche composants */}
              <div>
                <label className="label">Ajouter des composants</label>
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
                  <input className="input pl-8 text-sm"
                    placeholder="Rechercher dans le catalogue…"
                    value={searchComp}
                    onChange={e => setSearchComp(e.target.value)} />
                  {searchComp && (
                    <button onClick={() => setSearchComp("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-600">
                      <X size={13} />
                    </button>
                  )}
                </div>
                {searchComp && (
                  <div className="border border-ink-100 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                    {disponibles.length === 0 ? (
                      <p className="text-xs text-ink-400 text-center py-4">Aucun résultat</p>
                    ) : disponibles.map(p => (
                      <button key={p.id} onClick={() => addComposant(p)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-volt-50 transition-colors text-left border-b border-ink-50 last:border-0">
                        <span className={cn("badge text-xs shrink-0",
                          p.type_branche === "service" ? "bg-volt-100 text-volt-700" : "bg-emerald-100 text-emerald-700")}>
                          {p.type_branche === "service" ? "S" : "M"}
                        </span>
                        <span className="flex-1 text-sm text-ink-800 truncate">{p.nom}</span>
                        <span className="text-xs text-ink-400 shrink-0">{p.unite}</span>
                        <span className="text-sm font-semibold text-ink-900 shrink-0">{fmt(p.prix_unitaire)}</span>
                        <Plus size={13} className="text-ink-300 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Liste composants */}
              <div>
                <label className="label">Composition du kit</label>
                {composants.length === 0 ? (
                  <div className="text-center py-6 border-2 border-dashed border-ink-100 rounded-xl">
                    <Layers size={24} className="text-ink-200 mx-auto mb-2" />
                    <p className="text-xs text-ink-400">Recherchez des produits ci-dessus pour les ajouter</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {composants.map((c, i) => (
                      <div key={c.id} className="flex items-center gap-2 px-3 py-2 bg-ink-50 rounded-xl border border-ink-100">
                        <span className={cn("badge text-xs shrink-0",
                          c.prestation?.type_branche === "service" ? "bg-volt-100 text-volt-700" : "bg-emerald-100 text-emerald-700")}>
                          {c.prestation?.type_branche === "service" ? "S" : "M"}
                        </span>
                        <span className="flex-1 text-sm text-ink-800 truncate">{c.prestation?.nom}</span>
                        <span className="text-xs text-ink-400 shrink-0">{c.prestation?.unite}</span>
                        <input type="number" min="0.1" step="0.5" value={c.quantite}
                          onChange={e => updateQte(i, parseFloat(e.target.value) || 1)}
                          className="w-16 text-center text-xs border border-ink-200 rounded-lg py-1 bg-white" />
                        <span className="text-xs font-semibold text-ink-900 w-16 text-right shrink-0">
                          {fmt((c.prestation?.prix_unitaire ?? 0) * c.quantite)}
                        </span>
                        <button onClick={() => removeComposant(i)} className="text-ink-300 hover:text-red-500 transition-colors">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    <div className="flex justify-between text-sm font-bold text-ink-900 px-3 pt-2 border-t border-ink-200">
                      <span>Total kit</span>
                      <span className="text-purple-600">{fmt(prixTotal)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Description */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="label mb-0">Description (sur le devis)</label>
                  {descriptionManuelle && (
                    <button
                      onClick={() => {
                        setDescriptionManuelle(false);
                        setDescription(genKitDescription(composants));
                      }}
                      className="flex items-center gap-1 text-xs text-ink-400 hover:text-ink-700 transition-colors">
                      <RefreshCw size={11} /> Regénérer
                    </button>
                  )}
                </div>
                <textarea
                  className="input text-sm resize-none"
                  rows={3}
                  placeholder="Description affichée sous le nom du kit dans le devis…"
                  value={description}
                  onChange={e => {
                    setDescriptionManuelle(true);
                    setDescription(e.target.value);
                  }}
                />
                {!descriptionManuelle && composants.length > 0 && (
                  <p className="text-xs text-ink-400 mt-1">Générée automatiquement — modifiez pour personnaliser</p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-ink-100">
          <button onClick={onClose} className="btn-ghost flex-1 justify-center">Annuler</button>
          <button onClick={handleSave} disabled={saving || loading}
            className="btn-volt flex-1 justify-center">
            <Save size={14} /> {saving ? "Enregistrement…" : kit ? "Mettre à jour" : "Créer le kit"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  "nom", "description", "type_branche", "categorie", "sous_categorie",
  "marque", "unite", "prix_achat", "prix_unitaire", "gamme", "longueur_unitaire", "image_url", "liens_fournisseurs", "fournisseurs"
];

// Colonne « fournisseurs » : offres séparées par |, champs séparés par ^ → nom^référence^lien^prix_achat^prix_vente^marque^image
// (la première offre est la principale ; marque et image sont facultatives — absentes, ce sont celles des colonnes « marque » / « image_url »).
function nettoyerChampCSV(v: string): string { return v.replace(/[|^]/g, " ").trim(); }
function fournisseursVersCSV(p: PrestationExt): string {
  return offresTriees(p.fournisseurs).map(o => [
    nettoyerChampCSV(libelleOffre(o)), nettoyerChampCSV(o.reference ?? ""), nettoyerChampCSV(o.url ?? ""),
    o.prix_achat ?? "", o.prix_vente ?? "", nettoyerChampCSV(marqueOffre(p, o)), nettoyerChampCSV(o.image_url ?? ""),
  ].join("^")).join("|");
}
function fournisseursDepuisCSV(cell: string, marqueParDefaut = "", imageParDefaut = ""): OffreNormalisee[] {
  if (!cell || !cell.trim()) return [];
  const drafts: OffreDraft[] = cell.split("|").map(e => e.trim()).filter(Boolean).map((e, i) => {
    const [nom = "", ref = "", url = "", pa = "", pv = "", marque = "", image = ""] = e.split("^").map(x => x.trim());
    return { ...nouvelleOffreDraft(i === 0), marque: marque || marqueParDefaut, fournisseur: nom, reference: ref, url, prixAchat: pa, prixVente: pv, imageUrl: image || imageParDefaut };
  });
  return normaliserDrafts(drafts);
}

function exportCSV(prestations: PrestationExt[]) {
  const rows = [
    CSV_HEADERS.join(";"),
    ...prestations.filter(p => !p.est_kit).map(p => [
      p.nom, p.description ?? "", p.type_branche, p.categorie,
      p.sous_categorie ?? "", p.marque ?? "", p.unite,
      p.prix_achat ?? "", p.prix_unitaire, (p as any).gamme ?? "", (p as any).longueur_unitaire ?? "", p.image_url ?? "",
      (p.liens_fournisseurs ?? []).join("|"), fournisseursVersCSV(p),
    ].map(v => `"${String(v).replace(/\r?\n/g, " ").replace(/"/g, '""')}"`).join(";"))
  ];
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `catalogue_voltapp_${dateLocale()}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

type ImportRow = {
  nom: string; description: string; type_branche: string; categorie: string;
  sous_categorie: string; marque: string; unite: string;
  prix_achat: string; prix_unitaire: string; gamme: string; longueur_unitaire: string;
  image_url: string; liens_fournisseurs: string; fournisseurs: string;
  _valid: boolean; _errors: string[];
};

function parseCSV(text: string): ImportRow[] {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(";").map(h => h.replace(/^"|"$/g, "").trim());
  return lines.slice(1).map(line => {
    const values: string[] = [];
    let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (ch === ";" && !inQ) { values.push(cur); cur = ""; }
      else cur += ch;
    }
    values.push(cur);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (values[i] ?? "").trim(); });
    // Virgule décimale (Excel français) : « 12,5 » serait lu « 12 » par parseFloat.
    ["prix_achat", "prix_unitaire", "longueur_unitaire"].forEach(k => { if (row[k]) row[k] = row[k].replace(",", "."); });
    const errors: string[] = [];
    if (!row.nom?.trim()) errors.push("Nom manquant");
    if (!row.prix_unitaire || isNaN(parseFloat(row.prix_unitaire))) errors.push("Prix de vente invalide");
    if (!["service", "materiau"].includes(row.type_branche)) errors.push("Branche invalide (service/materiau)");
    if (row.gamme && !["entree", "moyenne", "haut"].includes(row.gamme)) errors.push("Gamme invalide (entree/moyenne/haut)");
    return {
      nom: row.nom ?? "", description: row.description ?? "",
      type_branche: row.type_branche ?? "service",
      categorie: row.categorie || "Divers", sous_categorie: normaliserSousCategories(row.sous_categorie),
      marque: row.marque ?? "", unite: row.unite || "forfait",
      prix_achat: row.prix_achat ?? "", prix_unitaire: row.prix_unitaire ?? "",
      gamme: row.gamme ?? "", longueur_unitaire: row.longueur_unitaire ?? "",
      image_url: row.image_url ?? "", liens_fournisseurs: row.liens_fournisseurs ?? "",
      fournisseurs: row.fournisseurs ?? "",
      _valid: errors.length === 0, _errors: errors,
    };
  });
}

function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (rows: ImportRow[]) => Promise<void> }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setRows(parseCSV(ev.target?.result as string)); };
    reader.readAsText(file, "utf-8");
  }

  async function handleImport() {
    if (!rows) return;
    setImporting(true);
    await onImport(rows.filter(r => r._valid));
    setImporting(false); setDone(true);
  }

  const validCount = rows?.filter(r => r._valid).length ?? 0;
  const invalidCount = rows?.filter(r => !r._valid).length ?? 0;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-100">
          <h2 className="font-semibold text-ink-900">Importer un catalogue CSV</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-ink-100 text-ink-400"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {!rows && !done && (
            <div className="space-y-4">
              <div className="p-4 bg-ink-50 rounded-xl text-sm text-ink-600 space-y-1">
                <p className="font-medium text-ink-800">Format attendu (CSV séparé par ;)</p>
                <p>Colonnes : <code className="text-xs bg-ink-200 px-1 rounded">{CSV_HEADERS.join(" · ")}</code></p>
                <p>• <code>type_branche</code> : <strong>service</strong> ou <strong>materiau</strong></p>
                <p>• <code>liens_fournisseurs</code> : URLs séparées par <strong>|</strong></p>
                <p>• <code>fournisseurs</code> : <code>nom^référence^lien^prix_achat^prix_vente^marque</code>, une offre par marque / fournisseur séparées par <strong>|</strong> (la première est la principale ; marque facultative)</p>
                <p>• <code>prix_achat</code> : toujours en TTC (ajoute la TVA à 20% avant d'exporter si tu pars d'un prix HT)</p>
              </div>
              <div>
                <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
                <button onClick={() => fileRef.current?.click()} className="btn-volt w-full justify-center">
                  <Upload size={16} /> Choisir un fichier CSV
                </button>
              </div>
            </div>
          )}
          {done && (
            <div className="text-center py-8">
              <CheckCircle2 size={48} className="text-emerald-500 mx-auto mb-3" />
              <p className="font-semibold text-ink-900">{validCount} prestation{validCount > 1 ? "s" : ""} importée{validCount > 1 ? "s" : ""}</p>
            </div>
          )}
          {rows && !done && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1 p-3 bg-emerald-50 rounded-xl text-center">
                  <p className="text-2xl font-bold text-emerald-700">{validCount}</p>
                  <p className="text-xs text-emerald-600">ligne{validCount > 1 ? "s" : ""} valide{validCount > 1 ? "s" : ""}</p>
                </div>
                {invalidCount > 0 && (
                  <div className="flex-1 p-3 bg-red-50 rounded-xl text-center">
                    <p className="text-2xl font-bold text-red-600">{invalidCount}</p>
                    <p className="text-xs text-red-500">ignorée{invalidCount > 1 ? "s" : ""}</p>
                  </div>
                )}
              </div>
              <div className="border border-ink-100 rounded-xl overflow-hidden">
                <div className="max-h-64 overflow-y-auto divide-y divide-ink-50">
                  {rows.map((row, i) => (
                    <div key={i} className={cn("px-4 py-2 flex items-start gap-3", row._valid ? "bg-white" : "bg-red-50")}>
                      {row._valid ? <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                        : <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink-800 truncate">{row.nom || "(sans nom)"}</p>
                        {row._errors.length > 0 && <p className="text-xs text-red-500">{row._errors.join(", ")}</p>}
                        {row._valid && <p className="text-xs text-ink-400">{row.type_branche} · {row.categorie} · {fmt(parseFloat(row.prix_unitaire))}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        {rows && !done && (
          <div className="flex gap-3 px-6 py-4 border-t border-ink-100">
            <button onClick={onClose} className="btn-ghost flex-1 justify-center">Annuler</button>
            <button onClick={handleImport} disabled={validCount === 0 || importing} className="btn-volt flex-1 justify-center">
              {importing ? "Import en cours…" : `Importer ${validCount} ligne${validCount > 1 ? "s" : ""}`}
            </button>
          </div>
        )}
        {done && (
          <div className="px-6 py-4 border-t border-ink-100">
            <button onClick={onClose} className="btn-volt w-full justify-center">Fermer</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CategorieBlock ───────────────────────────────────────────────────────────

function CategorieBlock({
  cat, items, branche, editId, editData, editNewCat, editCatMode, editOffres,
  editPrixVente, categories, marques, marqueOk, imageOk, collapsed, fournisseursConnus,
  toggleCollapse, delCategorie, startEdit, saveEdit, del, onEditKit,
  setEditId, setEditData, setEditNewCat, setEditCatMode, setEditOffres,
  setEditPrixVente, editEnBobine, setEditEnBobine, editLongueur, setEditLongueur,
}: any) {
  const isOpen = !collapsed;
  const [offresOuvertes, setOffresOuvertes] = useState<Record<string, boolean>>({});

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-ink-900">
        <button onClick={toggleCollapse} className="flex items-center gap-3 flex-1 text-left">
          <span className="font-semibold text-white text-sm">{cat}</span>
          <span className="text-ink-400 text-xs">{items.length} prestation{items.length > 1 ? "s" : ""}</span>
        </button>
        <div className="flex items-center gap-2">
          {items.length === 0 && (
            <button onClick={() => delCategorie(cat)}
              className="p-1.5 rounded-lg text-ink-400 hover:text-red-400 hover:bg-white/10 transition-colors">
              <Trash2 size={14} />
            </button>
          )}
          {isOpen ? <ChevronUp size={16} className="text-ink-400" /> : <ChevronDown size={16} className="text-ink-400" />}
        </div>
      </div>

      {isOpen && (
        <div className="divide-y divide-ink-100">
          {branche === "service" && (
            <div className="hidden md:grid grid-cols-[2fr_90px_90px_80px] gap-4 px-5 py-2 text-xs font-semibold text-ink-400 uppercase tracking-wide bg-ink-50">
              <span>Nom</span><span>Unité</span><span className="text-right">Prix</span><span></span>
            </div>
          )}
          {branche === "materiau" && (
            <div className="hidden md:grid grid-cols-[40px_2fr_90px_90px_120px_70px_80px] gap-4 px-5 py-2 text-xs font-semibold text-ink-400 uppercase tracking-wide bg-ink-50">
              <span></span><span>Nom</span><span>Unité</span><span className="text-right">Prix vente</span>
              <span className="text-right">Marge</span><span>Liens</span><span></span>
            </div>
          )}
          {branche === "kit" && (
            <div className="hidden md:grid grid-cols-[2fr_90px_80px] gap-4 px-5 py-2 text-xs font-semibold text-ink-400 uppercase tracking-wide bg-ink-50">
              <span>Nom</span><span className="text-right">Prix total</span><span></span>
            </div>
          )}

          {items.length === 0 && (
            <div className="px-5 py-4 text-sm text-ink-400 italic">Aucune prestation — catégorie vide.</div>
          )}

          {/* Kits */}
          {branche === "kit" && items.map((p: PrestationExt) => (
            <div key={p.id} className="px-4 py-3">
              <div className="flex items-center gap-3 md:grid md:grid-cols-[2fr_90px_80px]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-purple-100 text-purple-700 text-xs font-semibold shrink-0">
                      <Layers size={10} /> KIT
                    </span>
                    <p className="font-medium text-ink-900 text-sm truncate">{p.nom}</p>
                  </div>
                  {p.kit_description && (
                    <p className="text-xs text-ink-400 italic mt-0.5 truncate">{p.kit_description}</p>
                  )}
                </div>
                <span className="font-semibold text-ink-900 text-sm ml-auto md:ml-0 md:text-right">{fmt(p.prix_unitaire)}</span>
                <div className="flex gap-1 shrink-0 justify-end">
                  <button onClick={() => onEditKit(p)}
                    className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700"><Pencil size={13} /></button>
                  <button onClick={() => del(p.id)}
                    className="p-1.5 rounded-lg text-ink-300 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}

          {/* Matériaux */}
          {branche === "materiau" && (() => {
            // Un produit porte plusieurs marques (une par offre) : plus de regroupement par marque,
            // les marques s'affichent sous le nom de chaque produit.
            return [items as PrestationExt[]].map((itemsMq: PrestationExt[]) => {
              return (
                <div key="materiaux">
                  {itemsMq.map((p: PrestationExt) => {
                    const offres: PrestationFournisseur[] = offresTriees(p.fournisseurs);
                    const liens: LienVerif[] = liensVerification(p, offres);
                    const prixOffres = offres.map(o => prixVenteOffre(p, o));
                    const marquesProduit: string[] = marquesDe(p);
                    const sousCat: string = p.sous_categorie ?? "";
                    return (
                      <div key={p.id} className="px-4 py-3">
                        {editId === p.id ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div><label className="label">Nom</label>
                                <input className="input text-sm" value={(editData as any).nom ?? p.nom}
                                  onChange={e => setEditData((d: any) => ({ ...d, nom: e.target.value }))} /></div>
                              <div><label className="label">Description</label>
                                <input className="input text-sm" value={(editData as any).description ?? p.description ?? ""}
                                  onChange={e => setEditData((d: any) => ({ ...d, description: e.target.value }))} /></div>
                              <div><label className="label">Branche</label>
                                <select className="input text-sm" value={(editData as any).type_branche ?? p.type_branche}
                                  onChange={e => setEditData((d: any) => ({ ...d, type_branche: e.target.value }))}>
                                  <option value="service">Service</option>
                                  <option value="materiau">Matériau</option>
                                </select></div>
                              <div><label className="label">Unité</label>
                                <select className="input text-sm" value={(editData as any).unite ?? p.unite}
                                  onChange={e => setEditData((d: any) => ({ ...d, unite: e.target.value }))}>
                                  {UNITES.map((u: string) => <option key={u}>{u}</option>)}
                                </select></div>
                              <div><label className="label">Catégorie</label>
                                {editCatMode === "select" ? (
                                  <div className="flex gap-2">
                                    <select className="input text-sm flex-1" value={(editData as any).categorie ?? p.categorie}
                                      onChange={e => setEditData((d: any) => ({ ...d, categorie: e.target.value }))}>
                                      {categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <button onClick={() => setEditCatMode("new")} className="btn-ghost !px-3 text-xs shrink-0">Nouvelle</button>
                                  </div>
                                ) : (
                                  <div className="flex gap-2">
                                    <input className="input text-sm flex-1" placeholder="Nouvelle catégorie"
                                      value={editNewCat} onChange={e => setEditNewCat(e.target.value)} autoFocus />
                                    <button onClick={() => setEditCatMode("select")} className="btn-ghost !px-3 text-xs shrink-0">Existante</button>
                                  </div>
                                )}</div>
                              <div><label className="label">Sous-catégorie</label>
                                <SousCategorieInput value={(editData as any).sous_categorie ?? sousCat}
                                  onChange={v => setEditData((d: any) => ({ ...d, sous_categorie: v }))} /></div>
                              <div><label className="label">Gamme (pré-devis)</label>
                                <select className="input text-sm" value={(editData as any).gamme ?? p.gamme ?? ""}
                                  onChange={e => setEditData((d: any) => ({ ...d, gamme: e.target.value || null }))}>
                                  <option value="">— Aucune —</option>
                                  <option value="entree">Entrée de gamme</option>
                                  <option value="moyenne">Moyenne gamme</option>
                                  <option value="haut">Haut de gamme</option>
                                </select></div>
                              {(((editData as any).type_branche ?? p.type_branche) === "materiau") && (
                                <BobineField small actif={editEnBobine} setActif={setEditEnBobine}
                                  longueur={editLongueur} setLongueur={setEditLongueur} />
                              )}
                            </div>
                            <FournisseursEditor offres={editOffres} setOffres={setEditOffres} fournisseursConnus={fournisseursConnus} marquesConnues={marques} marqueOk={marqueOk}
                              imageOk={imageOk} imageProduit={(editData as any).image_url ?? p.image_url ?? null} />
                            <div><label className="label">Image du produit (URL)</label>
                              <p className="text-xs text-ink-400 mb-1">Image par défaut : utilisée par toutes les marques qui n'ont pas la leur (voir chaque marque ci-dessus).</p>
                              <input className="input text-sm" placeholder="https://…/image-produit.jpg"
                                value={(editData as any).image_url ?? p.image_url ?? ""}
                                onChange={e => setEditData((d: any) => ({ ...d, image_url: e.target.value }))} />
                              {((editData as any).image_url ?? p.image_url) && (
                                <img src={(editData as any).image_url ?? p.image_url} alt=""
                                  className="mt-2 h-16 object-contain rounded-lg border border-ink-100 p-1 bg-white" />
                              )}</div>
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => saveEdit(p.id)} className="btn-volt text-xs"><Save size={13} /> Sauvegarder</button>
                              <button onClick={() => setEditId(null)} className="btn-ghost text-xs"><X size={13} /> Annuler</button>
                            </div>
                          </div>
                        ) : (
                          <div className={cn("flex items-center gap-3",
                            "md:grid md:grid-cols-[40px_2fr_90px_90px_120px_70px_80px]")}>
                            <div className="hidden md:block"><ProduitThumb imageUrl={imageOffre(p, offrePrincipale(p.fournisseurs))} /></div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 md:block">
                                <div className="md:hidden shrink-0"><ProduitThumb imageUrl={imageOffre(p, offrePrincipale(p.fournisseurs))} /></div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <p className="font-medium text-ink-900 text-sm truncate">{p.nom}</p>
                                    <BadgeConditionnement longueur={(p as any).longueur_unitaire} sousCategorie={p.sous_categorie} />
                                  </div>
                                  <p className="text-xs text-ink-400 truncate">{[marquesProduit.join(" / "), libelleSousCategories(sousCat), p.description].filter(Boolean).join(" · ")}</p>
                                  {offres.length > 0 && (
                                    <button type="button" onClick={() => setOffresOuvertes(o => ({ ...o, [p.id]: !o[p.id] }))}
                                      className="inline-flex items-center gap-1 text-[11px] text-volt-600 font-medium hover:underline mt-0.5">
                                      {marquesProduit.length >= 2
                                        ? `${marquesProduit.length} marques · ${offres.length} offres`
                                        : `${offres.length} fournisseur${offres.length > 1 ? "s" : ""}`}
                                      {offres.length > 1
                                        ? ` · ${fmt(Math.min(...prixOffres))}${Math.min(...prixOffres) !== Math.max(...prixOffres) ? ` – ${fmt(Math.max(...prixOffres))}` : ""}`
                                        : ` · ${libelleOffre(offres[0])}`}
                                      {offresOuvertes[p.id] ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                    </button>
                                  )}
                                </div>
                              </div>
                              {liens.length > 0 && (
                                <div className="mt-1.5 md:hidden">
                                  <LiensVerification produit={p.nom} liens={liens} />
                                </div>
                              )}
                            </div>
                            <span className="text-xs text-ink-500 hidden md:block">{p.unite}</span>
                            <span className="font-semibold text-ink-900 text-sm ml-auto md:ml-0 md:text-right">{fmt(p.prix_unitaire)}</span>
                            <div className="hidden md:flex items-center justify-end">
                              {p.prix_achat != null && p.prix_achat > 0 ? (
                                <div className="text-right">
                                  <MargeTag prixAchat={p.prix_achat} prixVente={p.prix_unitaire} />
                                  <p className="text-xs text-ink-300 mt-0.5">PA {fmt(p.prix_achat)}</p>
                                  {p.type_branche === "materiau" && (() => {
                                    const margeMini = margeMiniUrssaf();
                                    const marge = calcMarge(p.prix_achat!, p.prix_unitaire);
                                    const sousRentable = marge !== null && marge < margeMini;
                                    const gainNet = gainNetUrssaf(p.prix_achat!, p.prix_unitaire);
                                    return (
                                      <>
                                        <p className={cn("text-[10px] mt-0.5 font-medium",
                                          gainNet < 0 ? "text-red-500" : "text-emerald-600")}
                                          title={`Gain net une fois la cotisation URSSAF (${URSSAF_MATERIAU_PCT}%) retirée du prix de vente`}>
                                          Gain net {fmt(gainNet)}
                                        </p>
                                        <p className={cn("text-[10px] mt-0.5",
                                          sousRentable ? "text-red-500 font-medium" : "text-ink-300")}
                                          title={`Prix de vente minimum pour couvrir les cotisations URSSAF (${URSSAF_MATERIAU_PCT}%) sans perte`}>
                                          Mini URSSAF {fmt(prixVenteMiniUrssaf(p.prix_achat!)!)}
                                        </p>
                                      </>
                                    );
                                  })()}
                                </div>
                              ) : <span className="text-ink-200 text-xs">—</span>}
                            </div>
                            <div className="hidden md:flex items-center">
                              <LiensVerification produit={p.nom} liens={liens} />
                            </div>
                            <div className="flex gap-1 shrink-0 justify-end">
                              <button onClick={() => startEdit(p)} className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700"><Pencil size={13} /></button>
                              <button onClick={() => del(p.id)} className="p-1.5 rounded-lg text-ink-300 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
                            </div>
                          </div>
                        )}
                        {editId !== p.id && offresOuvertes[p.id] && offres.length > 0 && (
                          <div className="mt-2 rounded-xl border border-ink-100 divide-y divide-ink-100 bg-ink-50/50">
                            {offres.map(o => {
                              const pv = prixVenteOffre(p, o);
                              return (
                                <div key={o.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                                  <ProduitThumb imageUrl={imageOffre(p, o)} />
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-ink-800 truncate">
                                      {libelleOffreMarque(p, o)}
                                      {o.principal && <span className="ml-1.5 badge text-[10px] bg-volt-100 text-volt-700">Principal</span>}
                                    </p>
                                    {o.reference && <p className="text-ink-400 truncate">réf. {o.reference}</p>}
                                    {(o.pieces ?? []).length > 0 && (
                                      <p className="text-ink-500 truncate" title={(o.pieces ?? []).map(pc => `${pc.quantite}× ${pc.nom}`).join(", ")}>
                                        {(o.pieces ?? []).length} pièces : {(o.pieces ?? []).map(pc => `${pc.quantite}× ${pc.nom}`).join(", ")}
                                      </p>
                                    )}
                                  </div>
                                  <span className="text-ink-400 shrink-0">{o.prix_achat != null ? `PA ${fmt(o.prix_achat)}` : "PA —"}</span>
                                  <MargeTag prixAchat={o.prix_achat} prixVente={pv} />
                                  <span className="font-semibold text-ink-900 shrink-0 w-20 text-right">{fmt(pv)}</span>
                                  {o.url ? (
                                    <a href={o.url} target="_blank" rel="noopener noreferrer" title={`${p.nom} — ${libelleOffreMarque(p, o)} : vérifier le prix`}
                                      className="text-ink-300 hover:text-volt-600 shrink-0"><ExternalLink size={13} /></a>
                                  ) : <span className="w-[13px] shrink-0" />}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}

          {/* Services */}
          {branche === "service" && items.map((p: PrestationExt) => {
            const sousCat: string = p.sous_categorie ?? "";
            return (
              <div key={p.id} className="px-4 py-3">
                {editId === p.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div><label className="label">Nom</label>
                        <input className="input text-sm" value={(editData as any).nom ?? p.nom}
                          onChange={e => setEditData((d: any) => ({ ...d, nom: e.target.value }))} /></div>
                      <div><label className="label">Description</label>
                        <input className="input text-sm" value={(editData as any).description ?? p.description ?? ""}
                          onChange={e => setEditData((d: any) => ({ ...d, description: e.target.value }))} /></div>
                      <div><label className="label">Prix unitaire (€)</label>
                        <input className="input text-sm text-right" type="number" step="0.5"
                          value={(editData as any).prix_unitaire ?? p.prix_unitaire}
                          onChange={e => { const v = e.target.value; setEditData((d: any) => ({ ...d, prix_unitaire: parseFloat(v) || 0 })); setEditPrixVente(v); }} /></div>
                      <div><label className="label">Branche</label>
                        <select className="input text-sm" value={(editData as any).type_branche ?? p.type_branche}
                          onChange={e => setEditData((d: any) => ({ ...d, type_branche: e.target.value }))}>
                          <option value="service">Service</option>
                          <option value="materiau">Matériau</option>
                        </select></div>
                      <div><label className="label">Unité</label>
                        <select className="input text-sm" value={(editData as any).unite ?? p.unite}
                          onChange={e => setEditData((d: any) => ({ ...d, unite: e.target.value }))}>
                          {UNITES.map((u: string) => <option key={u}>{u}</option>)}
                        </select></div>
                      <div><label className="label">Catégorie</label>
                        {editCatMode === "select" ? (
                          <div className="flex gap-2">
                            <select className="input text-sm flex-1" value={(editData as any).categorie ?? p.categorie}
                              onChange={e => setEditData((d: any) => ({ ...d, categorie: e.target.value }))}>
                              {categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <button onClick={() => setEditCatMode("new")} className="btn-ghost !px-3 text-xs shrink-0">Nouvelle</button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <input className="input text-sm flex-1" placeholder="Nouvelle catégorie"
                              value={editNewCat} onChange={e => setEditNewCat(e.target.value)} autoFocus />
                            <button onClick={() => setEditCatMode("select")} className="btn-ghost !px-3 text-xs shrink-0">Existante</button>
                          </div>
                        )}</div>
                      <div><label className="label">Sous-catégorie</label>
                        <SousCategorieInput value={(editData as any).sous_categorie ?? sousCat}
                          onChange={v => setEditData((d: any) => ({ ...d, sous_categorie: v }))} /></div>
                      <div><label className="label">Gamme (pré-devis)</label>
                        <select className="input text-sm" value={(editData as any).gamme ?? p.gamme ?? ""}
                          onChange={e => setEditData((d: any) => ({ ...d, gamme: e.target.value || null }))}>
                          <option value="">— Aucune —</option>
                          <option value="entree">Entrée de gamme</option>
                          <option value="moyenne">Moyenne gamme</option>
                          <option value="haut">Haut de gamme</option>
                        </select></div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => saveEdit(p.id)} className="btn-volt text-xs"><Save size={13} /> Sauvegarder</button>
                      <button onClick={() => setEditId(null)} className="btn-ghost text-xs"><X size={13} /> Annuler</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 md:grid md:grid-cols-[2fr_90px_90px_80px]">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink-900 text-sm truncate">{p.nom}</p>
                      <p className="text-xs text-ink-400 truncate">{[libelleSousCategories(sousCat), p.description].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className="text-xs text-ink-500 hidden md:block">{p.unite}</span>
                    <span className="font-semibold text-ink-900 text-sm ml-auto md:ml-0 md:text-right">{fmt(p.prix_unitaire)}</span>
                    <div className="flex gap-1 shrink-0 justify-end">
                      <button onClick={() => startEdit(p)} className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700"><Pencil size={13} /></button>
                      <button onClick={() => del(p.id)} className="p-1.5 rounded-lg text-ink-300 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

// Longueur de bobine/rouleau à enregistrer : null si l'option est désactivée ou si la saisie
// n'est pas un nombre > 0 (0, vide, texte) — un 0 ne doit JAMAIS compter comme une bobine.
export default function CataloguePage() {
  const [prestations, setPrestations] = useState<PrestationExt[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<PrestationExt>>({});
  const [editNewCat, setEditNewCat] = useState("");
  const [editCatMode, setEditCatMode] = useState<"select" | "new">("select");
  const [editOffres, setEditOffres] = useState<OffreDraft[]>([]);
  const [editPrixVente, setEditPrixVente] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [formOffres, setFormOffres] = useState<OffreDraft[]>(() => [nouvelleOffreDraft(true)]);
  const [formPrixVente, setFormPrixVente] = useState("");
  const [offresOk, setOffresOk] = useState(true);
  // Colonne `marque` des offres présente (migration 006) — voir chargerOffres().
  const [marqueOk, setMarqueOk] = useState(true);
  // Colonne `image_url` des offres présente (migration 007) — image propre à chaque marque.
  const [imageOk, setImageOk] = useState(true);
  const [showFusion, setShowFusion] = useState(false);
  const [formLongueurUnitaire, setFormLongueurUnitaire] = useState("");
  // Option « vendu en bobine / rouleau » : tant qu'elle est désactivée, aucune longueur n'est
  // enregistrée (null) et le devis ne mentionne jamais bobine/rouleau.
  const [formEnBobine, setFormEnBobine] = useState(false);
  const [editEnBobine, setEditEnBobine] = useState(false);
  const [editLongueur, setEditLongueur] = useState("");
  const [form, setForm] = useState({
    nom: "", description: "", unite: "forfait",
    type_branche: "service", categorie: "",
    sous_categorie: "", image_url: "", gamme: "",
  });

  const [collapsedServices, setCollapsedServices] = useState<Record<string, boolean>>({});
  const [collapsedMateriaux, setCollapsedMateriaux] = useState<Record<string, boolean>>({});
  const [collapsedKits, setCollapsedKits] = useState<Record<string, boolean>>({});
  const [marques, setMarques] = useState<string[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [kitModal, setKitModal] = useState<PrestationExt | null | "new">(null);

  async function load() {
    const { data } = await supabase
      .from("prestations")
      .select("*")
      .eq("actif", true)
      .order("categorie")
      .order("nom");
    // Offres fournisseurs (plusieurs fournisseurs / prix par produit)
    const { offres, ok, marqueOk: colonneMarque, imageOk: colonneImage } = await chargerOffres();
    setOffresOk(ok);
    setMarqueOk(colonneMarque);
    setImageOk(colonneImage);
    const prests: PrestationExt[] = attacherOffres((data ?? []) as PrestationExt[], offres);
    setPrestations(prests);
    const cats = [...new Set(prests.map(p => p.categorie))].sort();
    setCategories(cats);
    const initCollapsed = cats.reduce((acc, c) => ({ ...acc, [c]: true }), {} as Record<string, boolean>);
    setCollapsedServices(initCollapsed);
    setCollapsedMateriaux(initCollapsed);
    setCollapsedKits(initCollapsed);
    const mqs = [...new Set(prests.flatMap(p => marquesDe(p)))].sort((a, b) => a.localeCompare(b, "fr"));
    setMarques(mqs);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.nom.trim()) { alert("Le nom est obligatoire."); return; }
    const cat = newCat.trim() || form.categorie || "Divers";
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { alert("Session expirée."); return; }
    const estMateriau = form.type_branche === "materiau";
    let prixVente = 0;
    let prixAchatNum: number | null = null;
    let liens: string[] = [];
    let marquePrincipale: string | null = null;
    let offresN: OffreNormalisee[] = [];
    if (estMateriau) {
      offresN = normaliserDrafts(formOffres);
      const principale = offresN.find(o => o.principal);
      if (!principale || principale.prix_vente == null || principale.prix_vente < 0) {
        alert("Le prix de vente de l'offre principale est obligatoire."); return;
      }
      const m = miroirPrestation(offresN, principale.prix_vente);
      prixVente = m.prix_unitaire; prixAchatNum = m.prix_achat; liens = m.liens_fournisseurs; marquePrincipale = m.marque ?? null;
    } else {
      prixVente = parseFloat(formPrixVente);
      if (isNaN(prixVente) || prixVente < 0) { alert("Le prix de vente est obligatoire."); return; }
    }
    const longueurCreation = estMateriau ? longueurValide(formEnBobine, formLongueurUnitaire) : null;
    if (estMateriau && formEnBobine && longueurCreation == null) {
      alert("Indique une longueur de bobine/rouleau supérieure à 0, ou désactive l'option."); return;
    }
    const { data, error } = await supabase.from("prestations").insert({
      user_id: session.user.id, nom: form.nom,
      description: form.description || null, prix_unitaire: prixVente,
      prix_achat: prixAchatNum, unite: form.unite, type_branche: form.type_branche,
      categorie: cat, actif: true, sous_categorie: normaliserSousCategories(form.sous_categorie) || null,
      marque: marquePrincipale, liens_fournisseurs: liens,
      image_url: form.image_url || null, gamme: form.gamme || null,
      longueur_unitaire: longueurCreation,
    }).select().single();
    if (error) { alert("Erreur : " + error.message); return; }
    if (data) {
      let fournisseurs: PrestationFournisseur[] = [];
      if (estMateriau && offresN.length > 0) {
        const err = await synchroniserOffres(session.user.id, data.id, offresN);
        if (err) alert("Produit créé, mais fournisseurs non enregistrés : " + err);
        else fournisseurs = await offresDe(data.id);
      }
      const nouveau = { ...data, fournisseurs } as PrestationExt;
      setPrestations(p => [...p, nouveau].sort((a, b) => a.categorie.localeCompare(b.categorie) || a.nom.localeCompare(b.nom)));
      if (!categories.includes(cat)) setCategories(c => [...c, cat].sort());
    }
    const nouvellesMarques = offresN.map(o => o.marque).filter((m): m is string => !!m && !marques.includes(m));
    if (nouvellesMarques.length > 0) setMarques(m => [...new Set([...m, ...nouvellesMarques])].sort((a, b) => a.localeCompare(b, "fr")));
    setForm({ nom: "", description: "", unite: "forfait", type_branche: "service", categorie: "", sous_categorie: "", image_url: "", gamme: "" });
    setNewCat(""); setFormOffres([nouvelleOffreDraft(true)]); setFormPrixVente(""); setFormLongueurUnitaire(""); setFormEnBobine(false); setShowForm(false);
  }

  async function del(id: string) {
    if (!confirm("Supprimer cette prestation ?")) return;
    const { error } = await supabase.from("prestations").update({ actif: false }).eq("id", id);
    if (echecSupabase(error, "Suppression de la prestation")) return;
    setPrestations(p => p.filter(x => x.id !== id));
  }

  async function delCategorie(cat: string) {
    if (!confirm(`Supprimer la catégorie "${cat}" ?`)) return;
    setCategories(c => c.filter(x => x !== cat));
  }

  async function saveEdit(id: string) {
    const orig = prestations.find(p => p.id === id);
    if (!orig) return;
    const typeFinal = ((editData as any).type_branche ?? orig.type_branche) as "service" | "materiau";
    const finalCat = (editCatMode === "new" && editNewCat.trim() ? editNewCat.trim() : editData.categorie) ?? "Divers";
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { alert("Session expirée."); return; }

    // Longueur enregistrée seulement si l'option « bobine/rouleau » est activée ET > 0 ; sinon null.
    const longueurEdition = typeFinal === "materiau" ? longueurValide(editEnBobine, editLongueur) : null;
    if (typeFinal === "materiau" && editEnBobine && longueurEdition == null) {
      alert("Indique une longueur de bobine/rouleau supérieure à 0, ou désactive l'option."); return;
    }
    const dataToSave: any = {
      ...editData, categorie: finalCat,
      gamme: (editData as any).gamme || null,
      longueur_unitaire: longueurEdition,
    };
    // null = on ne touche pas aux offres ; tableau = état voulu des offres du produit.
    let offresN: OffreNormalisee[] | null = null;

    if (typeFinal === "materiau") {
      offresN = normaliserDrafts(editOffres);
      if (offresN.length > 0) {
        const principale = offresN.find(o => o.principal);
        if (!principale || principale.prix_vente == null || principale.prix_vente < 0) {
          alert("Le prix de vente de l'offre principale est obligatoire."); return;
        }
        const m = miroirPrestation(offresN, principale.prix_vente);
        dataToSave.prix_unitaire = m.prix_unitaire;
        dataToSave.prix_achat = m.prix_achat;
        dataToSave.liens_fournisseurs = m.liens_fournisseurs;
        if (marqueOk) dataToSave.marque = m.marque ?? null;   // marque du produit = celle de l'offre principale
      } else {
        dataToSave.prix_achat = null;
        dataToSave.liens_fournisseurs = [];
        if (marqueOk) dataToSave.marque = null;
      }
    } else {
      const prixVenteNum = parseFloat(editPrixVente);
      dataToSave.prix_unitaire = isNaN(prixVenteNum) ? (editData.prix_unitaire ?? orig.prix_unitaire) : prixVenteNum;
      if (orig.type_branche === "materiau") {
        // Passage matériau → service : plus de fournisseurs ni de prix d'achat.
        dataToSave.prix_achat = null;
        dataToSave.liens_fournisseurs = [];
        dataToSave.marque = null;
        offresN = [];
      }
    }

    const { error } = await supabase.from("prestations").update(dataToSave).eq("id", id);
    if (error) { alert("Erreur : " + error.message); return; }

    let fournisseurs: PrestationFournisseur[] = orig.fournisseurs ?? [];
    if (offresN !== null && (offresN.length > 0 || fournisseurs.length > 0)) {
      const err = await synchroniserOffres(session.user.id, id, offresN);
      if (err) alert("Produit enregistré, mais fournisseurs non enregistrés : " + err);
      else fournisseurs = await offresDe(id);
    }
    setPrestations(p => p.map(x => x.id === id ? { ...x, ...dataToSave, fournisseurs } as PrestationExt : x));
    if (finalCat && !categories.includes(finalCat)) setCategories(c => [...c, finalCat].sort());
    const nouvellesMarques = (offresN ?? []).map(o => o.marque).filter((m): m is string => !!m && !marques.includes(m));
    if (nouvellesMarques.length > 0) setMarques(m => [...new Set([...m, ...nouvellesMarques])].sort((a, b) => a.localeCompare(b, "fr")));
    setEditId(null); setEditNewCat(""); setEditCatMode("select"); setEditOffres([]);
    setEditPrixVente("");
  }

  function startEdit(p: PrestationExt) {
    setEditId(p.id);
    setEditData({
      nom: p.nom, description: p.description, prix_unitaire: p.prix_unitaire,
      unite: p.unite, type_branche: p.type_branche, categorie: p.categorie,
      sous_categorie: p.sous_categorie ?? undefined,
      image_url: p.image_url ?? undefined,
      gamme: (p as any).gamme ?? undefined,
    } as any);
    const longueurActuelle = (p as any).longueur_unitaire as number | null | undefined;
    setEditEnBobine(!!longueurActuelle && longueurActuelle > 0);
    setEditLongueur(longueurActuelle && longueurActuelle > 0 ? String(longueurActuelle) : "");
    setEditCatMode("select"); setEditNewCat("");
    // Offres du produit (ou reconstruites depuis les anciens champs prix d'achat / liens).
    // Sans la colonne marque (migration 006) ou image (migration 007), ni marque ni image d'offre n'est lue ni écrite.
    setEditOffres(draftsPourProduit(p).map(d => {
      const avecMarque = marqueOk ? d : { ...d, marque: "", marqueEnBase: false };
      return imageOk ? avecMarque : { ...avecMarque, imageUrl: "", imageEnBase: false };
    }));
    setEditPrixVente(String(p.prix_unitaire));
  }

  async function handleImport(rows: ImportRow[]) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const uid = session.user.id;
    const erreurs: string[] = [];
    const toInsert: { payload: any; offres: OffreNormalisee[] }[] = [];
    const toUpdate: { id: string; data: any; offres: OffreNormalisee[] | null; principale?: PrestationFournisseur }[] = [];
    // Lignes du CSV qui apportent une NOUVELLE marque à un produit déjà au catalogue : ajoutées comme
    // offres de ce produit (regroupées par produit, puis écrites en une seule fois).
    const ajoutsMarque = new Map<string, OffreNormalisee[]>();

    for (const r of rows) {
      const estMateriau = r.type_branche === "materiau";
      const marqueLigne = marqueOk ? r.marque.trim() : "";
      // Colonne image d'offre absente (migration 007 non exécutée) : les images du CSV sont ignorées.
      const sansImage = (l: OffreNormalisee[]): OffreNormalisee[] => (imageOk ? l : l.map(({ image_url: _i, effacerImage: _e, ...o }) => o));
      const offresCsv = estMateriau ? sansImage(fournisseursDepuisCSV(r.fournisseurs, marqueLigne)) : [];
      let payload: any = {
        nom: r.nom, description: r.description || null,
        type_branche: r.type_branche as "service" | "materiau",
        categorie: r.categorie || "Divers", sous_categorie: normaliserSousCategories(r.sous_categorie) || null,
        marque: r.marque || null, unite: r.unite || "forfait",
        prix_achat: r.prix_achat !== "" ? parseFloat(r.prix_achat) : null,
        prix_unitaire: parseFloat(r.prix_unitaire), image_url: r.image_url || null,
        gamme: ["entree", "moyenne", "haut"].includes(r.gamme) ? r.gamme : null,
        longueur_unitaire: estMateriau ? longueurValide(true, String(r.longueur_unitaire ?? "")) : null,
        liens_fournisseurs: r.liens_fournisseurs ? r.liens_fournisseurs.split("|").filter(Boolean) : [],
        actif: true,
      };
      if (offresCsv.length > 0) {
        // Les offres du CSV font foi : l'offre principale est recopiée dans le produit.
        const m = miroirPrestation(offresCsv, payload.prix_unitaire);
        payload = { ...payload, prix_unitaire: m.prix_unitaire, prix_achat: m.prix_achat, liens_fournisseurs: m.liens_fournisseurs };
      }
      // Offres reconstruites depuis les colonnes prix_achat / liens quand le CSV n'a pas de colonne fournisseurs.
      const offresLegacy = estMateriau && offresCsv.length === 0
        ? normaliserDrafts(draftsDepuisLegacy({ prix_unitaire: payload.prix_unitaire, prix_achat: payload.prix_achat, liens_fournisseurs: payload.liens_fournisseurs, marque: marqueLigne || undefined } as Prestation))
            .filter(o => o.url || o.prix_achat != null)
        : [];
      const existing = prestations.find(p => p.nom.trim().toLowerCase() === r.nom.trim().toLowerCase() && p.type_branche === r.type_branche);
      // Même produit déjà au catalogue mais sous d'autres marques : cette marque devient une offre de
      // plus (sans toucher aux offres existantes) au lieu d'écraser le prix de la marque en place.
      const marquesExistantes = existing ? marquesDe(existing).map(normTexte) : [];
      if (existing && estMateriau && marqueLigne && marquesExistantes.length > 0 && !marquesExistantes.includes(normTexte(marqueLigne))) {
        // Seules les offres d'une marque encore absente du produit sont ajoutées (pas de doublon des autres).
        const nouvelles = (offresCsv.length > 0 ? offresCsv : offresLegacy.length > 0 ? offresLegacy
          : normaliserDrafts([{ ...nouvelleOffreDraft(false), marque: marqueLigne, prixAchat: r.prix_achat, prixVente: r.prix_unitaire }]))
          .filter(o => !o.marque || !marquesExistantes.includes(normTexte(o.marque)))
          // Nouvelle marque sans image propre dans le CSV : elle prend l'image de la ligne (image_url du CSV).
          .map(o => ({ ...o, id: undefined, principal: false,
            ...(imageOk && !o.image_url && normaliserUrl(r.image_url) ? { image_url: normaliserUrl(r.image_url) } : {}) }));
        if (nouvelles.length > 0) ajoutsMarque.set(existing.id, [...(ajoutsMarque.get(existing.id) ?? []), ...nouvelles]);
        continue;
      }
      if (existing) {
        const aDejaDesOffres = (existing.fournisseurs ?? []).length > 0;
        if (offresCsv.length > 0) toUpdate.push({ id: existing.id, data: payload, offres: offresCsv });
        else if (estMateriau && !aDejaDesOffres) toUpdate.push({ id: existing.id, data: payload, offres: offresLegacy });
        else toUpdate.push({ id: existing.id, data: payload, offres: null, principale: estMateriau ? offrePrincipale(existing.fournisseurs) : undefined });
      } else {
        toInsert.push({ payload: { user_id: uid, ...payload }, offres: offresCsv.length > 0 ? offresCsv : offresLegacy });
      }
    }

    if (toInsert.length > 0) {
      const { data: ins, error } = await supabase.from("prestations").insert(toInsert.map(t => t.payload)).select("id,nom,type_branche");
      if (error) { alert("Erreur d'import : " + error.message); return; }
      for (let i = 0; i < toInsert.length; i++) {
        const t = toInsert[i];
        if (t.offres.length === 0) continue;
        const cree = (ins ?? [])[i]?.nom === t.payload.nom ? (ins ?? [])[i]
          : (ins ?? []).find((x: any) => x.nom === t.payload.nom && x.type_branche === t.payload.type_branche);
        if (!cree) continue;
        const err = await synchroniserOffres(uid, cree.id, t.offres);
        if (err) erreurs.push(`${t.payload.nom} : ${err}`);
      }
    }
    for (const u of toUpdate) {
      const { error } = await supabase.from("prestations").update(u.data).eq("id", u.id);
      if (error) { erreurs.push(`${u.data.nom} : ${error.message}`); continue; }
      if (u.offres !== null) {
        if (u.offres.length === 0) continue;
        const existantes = prestations.find(p => p.id === u.id)?.fournisseurs ?? [];
        const err = await synchroniserOffres(uid, u.id, rattacherParNom(existantes, u.offres, prestations.find(p => p.id === u.id)?.marque ?? ""));
        if (err) erreurs.push(`${u.data.nom} : ${err}`);
      } else if (u.principale && (u.principale.pieces ?? []).length === 0) {
        // Import « ancien format » sur un produit qui a des fournisseurs : on aligne l'offre principale.
        const { error: errPrincipale } = await supabase.from("prestation_fournisseurs").update({ prix_achat: u.data.prix_achat, prix_vente: u.data.prix_unitaire }).eq("id", u.principale.id);
        if (errPrincipale) erreurs.push(`${u.data.nom} : ${errPrincipale.message}`);
      }
    }
    for (const [id, ajouts] of Array.from(ajoutsMarque.entries())) {
      const produit = prestations.find(p => p.id === id);
      if (!produit) continue;
      // Offres actuelles (ids conservés) + les nouvelles ; un produit encore sans offre est d'abord reconstruit
      // depuis ses anciens champs (prix, liens).
      const actuelles = (produit.fournisseurs ?? []).length > 0
        ? offresVersNormalisees(produit.fournisseurs ?? [], produit.marque ?? "")
        : normaliserDrafts(draftsDepuisLegacy(produit));
      const voulues = [...actuelles, ...ajouts].map((o, i) => ({ ...o, ordre: i }));
      if (!voulues.some(o => o.principal)) voulues[0].principal = true;
      const err = await synchroniserOffres(uid, id, voulues);
      if (err) erreurs.push(`${produit.nom} : ${err}`);
    }
    if (erreurs.length > 0) alert("Import terminé avec des erreurs :\n" + erreurs.slice(0, 5).join("\n"));
    await load();
  }

  const filtered = prestations.filter(p => matchSearch(p, search));
  const kitsPrests = filtered.filter(p => p.est_kit);
  const servicesPrests = filtered.filter(p => !p.est_kit && p.type_branche === "service");
  const materiauxPrests = filtered.filter(p => !p.est_kit && p.type_branche === "materiau");

  const catKits = [...new Set(kitsPrests.map(p => p.categorie))].sort();
  const catServices = [...new Set(servicesPrests.map(p => p.categorie))].sort();
  const catMateriaux = [...new Set(materiauxPrests.map(p => p.categorie))].sort();

  const byCatKits = catKits.reduce((acc, cat) => { acc[cat] = kitsPrests.filter(p => p.categorie === cat); return acc; }, {} as Record<string, PrestationExt[]>);
  const byCatServices = catServices.reduce((acc, cat) => { acc[cat] = servicesPrests.filter(p => p.categorie === cat); return acc; }, {} as Record<string, PrestationExt[]>);
  const byCatMateriaux = catMateriaux.reduce((acc, cat) => { acc[cat] = materiauxPrests.filter(p => p.categorie === cat); return acc; }, {} as Record<string, PrestationExt[]>);

  const fournisseursConnus = Array.from(new Set(prestations.flatMap(p => (p.fournisseurs ?? []).map(libelleOffre)))).sort();

  const sharedProps = {
    editId, editData, editNewCat, editCatMode, editOffres, editPrixVente,
    categories, marques, marqueOk, imageOk, fournisseursConnus, delCategorie, startEdit, saveEdit, del,
    setEditId, setEditData, setEditNewCat, setEditCatMode, setEditOffres,
    setEditPrixVente, editEnBobine, setEditEnBobine, editLongueur, setEditLongueur,
    onEditKit: (p: PrestationExt) => setKitModal(p),
  };

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-3xl text-ink-900">Catalogue</h1>
            <p className="text-ink-500 text-sm mt-1">
              {prestations.filter(p => !p.est_kit).length} article{prestations.filter(p => !p.est_kit).length > 1 ? "s" : ""}
              {kitsPrests.length > 0 && ` · ${kitsPrests.length} kit${kitsPrests.length > 1 ? "s" : ""}`}
              {search && ` · ${filtered.length} résultat${filtered.length > 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => exportCSV(prestations)} title="Exporter CSV" className="btn-ghost !px-3"><Download size={16} /></button>
            <button onClick={() => setShowImport(true)} title="Importer CSV" className="btn-ghost !px-3"><Upload size={16} /></button>
            <button onClick={() => setShowFusion(true)} title="Regrouper les produits saisis plusieurs fois (une fois par marque)" className="btn-ghost">
              <GitMerge size={15} /> Doublons
            </button>
            <button onClick={() => setKitModal("new")} className="btn-ghost">
              <Layers size={15} /> Kit
            </button>
            <button onClick={() => setShowForm(!showForm)} className="btn-volt">
              <Plus size={16} /> Ajouter
            </button>
          </div>
        </div>

        <div className="relative mb-6">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
          <input className="input pl-9 w-full" placeholder="Rechercher dans le catalogue…"
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700">
              <X size={14} />
            </button>
          )}
        </div>

        {!loading && !offresOk && (
          <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-4 py-3 text-sm">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <p>Les fournisseurs multiples ne sont pas encore activés : exécute la migration <strong>003_fournisseurs_produits.sql</strong> dans Supabase (SQL Editor, un bloc à la fois).</p>
          </div>
        )}

        {!loading && offresOk && !marqueOk && (
          <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-4 py-3 text-sm">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <p>Les marques par offre ne sont pas encore activées : exécute la migration <strong>006_marques_offres.sql</strong> dans Supabase (SQL Editor, un bloc à la fois).</p>
          </div>
        )}

        {showForm && (
          <div className="card card-inner mb-6 border-volt-400">
            <h2 className="font-semibold text-ink-800 mb-4">Nouvelle prestation</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2"><label className="label">Nom *</label>
                <input className="input" placeholder="Ex : Pose prise de courant 16A"
                  value={form.nom} onChange={e => setForm(f => ({ ...f, nom: e.target.value }))} /></div>
              <div className="md:col-span-2"><label className="label">Description (optionnel)</label>
                <input className="input" placeholder="Détail de la prestation…"
                  value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
              <div><label className="label">Branche AE</label>
                <select className="input" value={form.type_branche} onChange={e => setForm(f => ({ ...f, type_branche: e.target.value }))}>
                  <option value="service">Service (main d'œuvre)</option>
                  <option value="materiau">Matériau (achat/revente)</option>
                </select></div>
              <div><label className="label">Unité</label>
                <select className="input" value={form.unite} onChange={e => setForm(f => ({ ...f, unite: e.target.value }))}>
                  {UNITES.map(u => <option key={u} value={u}>{u}</option>)}
                </select></div>
              <div><label className="label">Catégorie</label>
                {categories.length > 0 && !newCat ? (
                  <div className="flex gap-2">
                    <select className="input flex-1" value={form.categorie} onChange={e => setForm(f => ({ ...f, categorie: e.target.value }))}>
                      <option value="">— Choisir —</option>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button onClick={() => setNewCat(" ")} className="btn-ghost !px-3 text-xs">Nouvelle</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input className="input flex-1" placeholder="Nom de la catégorie"
                      value={newCat} onChange={e => setNewCat(e.target.value)} />
                    {categories.length > 0 && <button onClick={() => setNewCat("")} className="btn-ghost !px-3 text-xs">Existante</button>}
                  </div>
                )}</div>
              <div><label className="label">Sous-catégorie</label>
                <SousCategorieInput value={form.sous_categorie} onChange={v => setForm(f => ({ ...f, sous_categorie: v }))} /></div>
              <div><label className="label">Gamme (pré-devis)</label>
                <select className="input" value={form.gamme} onChange={e => setForm(f => ({ ...f, gamme: e.target.value }))}>
                  <option value="">— Aucune —</option>
                  <option value="entree">Entrée de gamme</option>
                  <option value="moyenne">Moyenne gamme</option>
                  <option value="haut">Haut de gamme</option>
                </select></div>
              {form.type_branche === "materiau" && (
                <BobineField actif={formEnBobine} setActif={setFormEnBobine}
                  longueur={formLongueurUnitaire} setLongueur={setFormLongueurUnitaire} />
              )}
              {form.type_branche === "service" ? (
                <div><label className="label">Prix unitaire (€) *</label>
                  <input className="input" type="number" step="0.5" placeholder="0.00"
                    value={formPrixVente} onChange={e => setFormPrixVente(e.target.value)} /></div>
              ) : (
                <FournisseursEditor offres={formOffres} setOffres={setFormOffres} fournisseursConnus={fournisseursConnus} marquesConnues={marques} marqueOk={marqueOk}
                  imageOk={imageOk} imageProduit={form.image_url || null} />
              )}
              {form.type_branche === "materiau" && (
                <>
                  <div className="md:col-span-2"><label className="label">Image du produit (URL)</label>
                    <input className="input" placeholder="https://…/image-produit.jpg"
                      value={form.image_url ?? ""} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} />
                    {form.image_url && (
                      <img src={form.image_url} alt="" className="mt-2 h-16 object-contain rounded-lg border border-ink-100 p-1 bg-white" />
                    )}</div>
                </>
              )}
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => { setShowForm(false); setFormOffres([nouvelleOffreDraft(true)]); setFormPrixVente(""); setFormLongueurUnitaire(""); setFormEnBobine(false); }}
                className="btn-ghost flex-1 justify-center">Annuler</button>
              <button onClick={add} className="btn-volt flex-1 justify-center"><Save size={15} /> Enregistrer</button>
            </div>
          </div>
        )}

        {!loading && prestations.length === 0 && !showForm && (
          <div className="card card-inner text-center py-16">
            <p className="text-ink-400 mb-2">Catalogue vide</p>
            <p className="text-ink-300 text-sm mb-6">Ajoutez vos prestations et matériaux avec leurs prix, unités et catégories.</p>
            <button onClick={() => setShowForm(true)} className="btn-volt inline-flex"><Plus size={15} /> Ajouter la première prestation</button>
          </div>
        )}

        {!loading && prestations.length > 0 && filtered.length === 0 && (
          <div className="card card-inner text-center py-10">
            <Search size={32} className="text-ink-200 mx-auto mb-2" />
            <p className="text-ink-400">Aucun résultat pour « {search} »</p>
          </div>
        )}

        {loading && <div className="text-center py-10 text-ink-400">Chargement…</div>}

        {/* Section Kits */}
        {!loading && kitsPrests.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                <Layers size={16} className="text-purple-600" />
              </div>
              <div>
                <h2 className="font-bold text-ink-900">Kits</h2>
                <p className="text-xs text-ink-400">{kitsPrests.length} kit{kitsPrests.length > 1 ? "s" : ""} · Compositions multi-produits</p>
              </div>
            </div>
            <div className="space-y-3">
              {Object.entries(byCatKits).map(([cat, items]) => (
                <CategorieBlock key={`k-${cat}`} cat={cat} items={items} branche="kit"
                  collapsed={collapsedKits[cat] ?? true}
                  toggleCollapse={() => setCollapsedKits(c => ({ ...c, [cat]: !c[cat] }))}
                  {...sharedProps} />
              ))}
            </div>
          </div>
        )}

        {/* Section Services */}
        {!loading && servicesPrests.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-volt-100 flex items-center justify-center">
                <Wrench size={16} className="text-volt-700" />
              </div>
              <div>
                <h2 className="font-bold text-ink-900">Services</h2>
                <p className="text-xs text-ink-400">{servicesPrests.length} prestation{servicesPrests.length > 1 ? "s" : ""} · Main d'œuvre</p>
              </div>
            </div>
            <div className="space-y-3">
              {Object.entries(byCatServices).map(([cat, items]) => (
                <CategorieBlock key={`s-${cat}`} cat={cat} items={items} branche="service"
                  collapsed={collapsedServices[cat] ?? true}
                  toggleCollapse={() => setCollapsedServices(c => ({ ...c, [cat]: !c[cat] }))}
                  {...sharedProps} />
              ))}
            </div>
          </div>
        )}

        {/* Section Matériaux */}
        {!loading && materiauxPrests.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Package size={16} className="text-emerald-700" />
              </div>
              <div>
                <h2 className="font-bold text-ink-900">Matériaux</h2>
                <p className="text-xs text-ink-400">{materiauxPrests.length} article{materiauxPrests.length > 1 ? "s" : ""} · Achat / revente</p>
              </div>
            </div>
            <div className="space-y-3">
              {Object.entries(byCatMateriaux).map(([cat, items]) => (
                <CategorieBlock key={`m-${cat}`} cat={cat} items={items} branche="materiau"
                  collapsed={collapsedMateriaux[cat] ?? true}
                  toggleCollapse={() => setCollapsedMateriaux(c => ({ ...c, [cat]: !c[cat] }))}
                  {...sharedProps} />
              ))}
            </div>
          </div>
        )}
      </div>

      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} onImport={handleImport} />
      )}

      {showFusion && (
        <FusionDoublons
          prestations={prestations}
          marqueOk={marqueOk && offresOk}
          onClose={() => setShowFusion(false)}
          onFusionne={load}
        />
      )}

      {kitModal !== null && (
        <KitModal
          kit={kitModal === "new" ? null : kitModal}
          prestations={prestations}
          onClose={() => setKitModal(null)}
          onSaved={() => { setKitModal(null); load(); }}
        />
      )}
    </Shell>
  );
}
