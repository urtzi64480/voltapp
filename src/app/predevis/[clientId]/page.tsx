"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Client, Prestation, DevisLigne } from "@/types";
import { Niveau } from "@/lib/maison-types";
import { BreakerRow } from "@/lib/electrical-constants";
import {
  calculerBesoinsBruts, apparierCatalogue, optionsPourSousCategorie, genererLignesDevis, estBobinable,
  multiplicateurPourArticle, estPieceReelle,
  ResultatPreDevis, BesoinApparie, OptionArticle, ChoixLigne,
} from "@/lib/predevis-engine";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Search, X, Sparkles, Save, Cable } from "lucide-react";

const LABEL_GAMME: Record<string, string> = { entree: "Entrée de gamme", moyenne: "Moyenne gamme", haut: "Haut de gamme" };

function fmt(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

// ─── État de choix par besoin ───────────────────────────────────────────────

type ModeChoix = "option" | "autre" | "libre" | "exclu";
interface EtatChoix {
  mode: ModeChoix;
  optionIndex: number;
  autrePrestationId: string;
  libreNom: string;
  librePrix: string;
  libreUnite: string;
  libreBranche: "service" | "materiau";
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
  };
}

// Estime le total réellement facturable pour un besoin bobinable, en reproduisant EXACTEMENT
// la décomposition de genererLignesQuantiteBobinable (predevis-engine.ts) — bobines entières
// au prix plein + reliquat via un article "au mètre" de même sous-catégorie/gamme si trouvé,
// sinon une bobine de plus. Un simple Math.round(quantité / longueur bobine) arrondit au plus
// proche et peut faire disparaître un reliquat important de l'affichage (ex. 29m avec des
// bobines de 25m arrondissait à "1" au lieu de facturer les 4m restants) — d'où cette version
// qui ne sous-estime jamais.
function totalBobinable(besoin: BesoinApparie, option: { longueur_unitaire?: number | null; quantiteMultiplicateur?: number; prix_unitaire: number; gamme?: OptionArticle["gamme"]; sousCategorieArticle?: string }, prestations: Prestation[]): number {
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
    const auMetre = prestations.find(p => p.sous_categorie === (option.sousCategorieArticle ?? besoin.sousCategorie)
      && (p.gamme ?? null) === (option.gamme ?? null) && !p.longueur_unitaire);
    total += auMetre ? Math.ceil(reliquat) * auMetre.prix_unitaire : option.prix_unitaire; // bobine de plus si pas d'article au mètre
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
  const auMetre = prestations.find(p => p.sous_categorie === (option.sousCategorieArticle ?? besoin.sousCategorie)
    && (p.gamme ?? null) === (option.gamme ?? null) && !p.longueur_unitaire);
  const baseBobines = nb > 0 ? `${nb} bobine${nb > 1 ? "s" : ""} de ${L}m` : "";
  if (auMetre) {
    return `→ ${baseBobines ? `${baseBobines} + ` : ""}${Math.ceil(reliquat)}m au mètre (${quantiteReelle.toFixed(2)}m au total)`;
  }
  const bobinesFinales = nb + 1; // reliquat non couvert par un article au mètre -> une bobine de plus
  return `→ ${bobinesFinales} bobine${bobinesFinales > 1 ? "s" : ""} de ${L}m (couvre les ${quantiteReelle.toFixed(2)}m nécessaires — pas d'article au mètre pour ${besoin.label} en stock)`;
}

function BesoinRow({ besoin, etat, onChange, prestations, detail }: {
  besoin: BesoinApparie; etat: EtatChoix; onChange: (e: EtatChoix) => void; prestations: Prestation[]; detail?: string;
}) {
  const [rechercheOuverte, setRechercheOuverte] = useState(false);
  const [recherche, setRecherche] = useState("");
  const autrePrestation = prestations.find(p => p.id === etat.autrePrestationId);

  const resultatsRecherche = recherche.trim().length >= 2
    ? prestations.filter(p => !p.est_kit && (p.nom.toLowerCase().includes(recherche.toLowerCase()) || p.sous_categorie?.toLowerCase().includes(recherche.toLowerCase()))).slice(0, 20)
    : [];

  return (
    <div className="border border-ink-100 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium text-ink-900">{besoin.label}</p>
          <p className="text-xs text-ink-400">{besoin.unite === "m" ? `${besoin.quantite.toFixed(2)} m` : `${besoin.quantite} ${besoin.unite === "heure" ? "h" : "u."}`}</p>
          {detail && <p className="text-[11px] text-ink-400 italic mt-0.5">{detail}</p>}
        </div>
        {besoin.options.length === 0 && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            <AlertTriangle size={12} /> Non identifié au catalogue
          </span>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer border-b border-ink-100 pb-2">
        <input type="checkbox" checked={etat.mode === "exclu"}
          onChange={e => onChange({ ...etat, mode: e.target.checked ? "exclu" : (besoin.options.length > 0 ? "option" : "libre") })} />
        <span className="text-red-600 font-medium">Ne pas inclure cette ligne dans le devis</span>
      </label>

      <div className={`flex flex-col gap-1.5 ${etat.mode === "exclu" ? "opacity-40 pointer-events-none" : ""}`}>
        {besoin.options.map((opt, i) => (
          <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" checked={etat.mode === "option" && etat.optionIndex === i}
              onChange={() => onChange({ ...etat, mode: "option", optionIndex: i })} />
            <span className="text-ink-700 flex-1 min-w-0 truncate">
              {opt.gamme ? `${LABEL_GAMME[opt.gamme]} — ` : ""}{opt.nom}
            </span>
            <span className="text-ink-500 shrink-0">{fmt(opt.prix_unitaire)} / {opt.unite}</span>
          </label>
        ))}
        {etat.mode === "option" && (() => {
          const label = decompositionLabel(besoin, besoin.options[etat.optionIndex] ?? {}, prestations);
          return label ? <p className="text-[11px] text-sky-600 font-mono ml-6">{label}</p> : null;
        })()}

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="radio" checked={etat.mode === "autre"} onChange={() => { onChange({ ...etat, mode: "autre" }); setRechercheOuverte(true); }} />
          <span className="text-ink-500">Chercher un autre article au catalogue</span>
        </label>
        {etat.mode === "autre" && (
          <div className="ml-6 flex flex-col gap-1.5">
            {autrePrestation && !rechercheOuverte && (
              <div className="flex items-center gap-2 text-xs bg-ink-50 rounded-lg px-2 py-1.5">
                <span className="flex-1 truncate">{autrePrestation.nom}</span>
                <span className="text-ink-400 shrink-0">{fmt(autrePrestation.prix_unitaire)} / {autrePrestation.unite}</span>
                <button onClick={() => setRechercheOuverte(true)} className="text-volt-600 shrink-0">Changer</button>
              </div>
            )}
            {(rechercheOuverte || !autrePrestation) && (
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-300" />
                <input className="input !text-xs !py-1.5 !pl-7" placeholder="Rechercher dans le catalogue…"
                  value={recherche} onChange={e => setRecherche(e.target.value)} />
                {resultatsRecherche.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-ink-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {resultatsRecherche.map(p => (
                      <button key={p.id} onClick={() => { onChange({ ...etat, mode: "autre", autrePrestationId: p.id }); setRecherche(""); setRechercheOuverte(false); }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-volt-50">
                        <span className="flex-1 truncate">{p.nom}</span>
                        <span className="text-ink-400 shrink-0">{fmt(p.prix_unitaire)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
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
    </div>
  );
}

// ─── Page principale ────────────────────────────────────────────────────────

export default function PreDevisPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.clientId as string;

  const [client, setClient] = useState<Client | null>(null);
  const [prestations, setPrestations] = useState<Prestation[]>([]);
  const [profil, setProfil] = useState<any>(null);
  const [resultat, setResultat] = useState<ResultatPreDevis | null>(null);
  const [alertesGeometrie, setAlertesGeometrie] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [choix, setChoix] = useState<Record<string, EtatChoix>>({});
  const [mainOeuvreHeures, setMainOeuvreHeures] = useState("0");
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
      setClient((c as any) ?? null);
      setPrestations((prest as Prestation[]) ?? []);
      setProfil(prof);

      let niveaux: Niveau[] = [];
      if ((c as any)?.maison_config) {
        try { const parsed = JSON.parse((c as any).maison_config); if (Array.isArray(parsed?.niveaux)) niveaux = parsed.niveaux; } catch {}
      }
      let rows: BreakerRow[] = [];
      if ((c as any)?.tableau_config) {
        try { const parsed = JSON.parse((c as any).tableau_config); if (Array.isArray(parsed)) rows = parsed; } catch {}
      }

      if (niveaux.length === 0) {
        setAlertesGeometrie(["Aucun plan de circuits enregistré pour ce client — dessine et génère les circuits d'abord."]);
        setLoading(false);
        return;
      }

      const { besoins, alertes } = calculerBesoinsBruts(niveaux, rows);
      const res = apparierCatalogue(besoins, (prest as Prestation[]) ?? []);
      setResultat(res);
      setAlertesGeometrie(alertes);

      // Brouillon sauvegardé précédemment (voir sauvegarderBrouillon) — ne réapplique que
      // les choix dont la clé de besoin existe encore (le plan/tableau peut avoir changé
      // depuis la dernière sauvegarde) ; le reste repart sur les valeurs par défaut.
      let brouillon: { choix?: Record<string, EtatChoix>; mainOeuvreHeures?: string; mainOeuvreIndex?: number; fraisGenerauxPct?: string; deplacementEur?: string } | null = null;
      if ((c as any)?.predevis_config) {
        try { brouillon = JSON.parse((c as any).predevis_config); } catch {}
      }

      const initChoix: Record<string, EtatChoix> = {};
      Object.values(res.parPiece).flat().forEach(b => {
        initChoix[b.cle] = brouillon?.choix?.[b.cle] ?? etatParDefaut(b);
      });
      setChoix(initChoix);
      if (brouillon) {
        if (brouillon.mainOeuvreHeures != null) setMainOeuvreHeures(brouillon.mainOeuvreHeures);
        if (brouillon.mainOeuvreIndex != null) setMainOeuvreIndex(brouillon.mainOeuvreIndex);
        if (brouillon.fraisGenerauxPct != null) setFraisGenerauxPct(brouillon.fraisGenerauxPct);
        if (brouillon.deplacementEur != null) setDeplacementEur(brouillon.deplacementEur);
      }
      setLoading(false);
    }
    load();
  }, [clientId]);

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
    if (piecesSelectionnees === null) return resultat.parPiece;
    return Object.fromEntries(
      Object.entries(resultat.parPiece).filter(([piece]) => !estPieceReelle(piece) || piecesSelectionnees.has(piece)),
    );
  }, [resultat, piecesSelectionnees]);

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
        if (!(b.cle in next)) { next[b.cle] = etatParDefaut(b); changed = true; }
      });
      return changed ? next : prev;
    });
  }, [besoinsAgreges]);

  async function sauvegarderBrouillon() {
    setSavingDraft(true);
    const contenu = JSON.stringify({ choix, mainOeuvreHeures, mainOeuvreIndex, fraisGenerauxPct, deplacementEur });
    await supabase.from("clients").update({ predevis_config: contenu } as any).eq("id", clientId);
    setSavingDraft(false);
    setDraftSaved(true);
    setTimeout(() => setDraftSaved(false), 2000);
  }


  const optionsMainOeuvre = optionsPourSousCategorie("main_oeuvre", prestations);

  function majChoix(cle: string, e: EtatChoix) {
    setChoix(prev => ({ ...prev, [cle]: e }));
  }

  // Total HT approximatif affiché en direct — le total exact (avec décomposition en
  // bobines) est recalculé à la génération finale.
  function totalLigneApprox(besoin: BesoinApparie, etat: EtatChoix): number {
    if (etat.mode === "exclu") return 0;
    if (etat.mode === "option") {
      const opt = besoin.options[etat.optionIndex];
      if (!opt) return 0;
      if (besoin.unite === "m" && estBobinable(besoin.sousCategorie)) return totalBobinable(besoin, opt, prestations);
      return besoin.quantite * (opt.quantiteMultiplicateur ?? 1) * opt.prix_unitaire;
    }
    if (etat.mode === "autre") {
      const p = prestations.find(x => x.id === etat.autrePrestationId);
      if (!p) return 0;
      const mult = multiplicateurPourArticle(besoin.sousCategorie, p.sous_categorie);
      if (besoin.unite === "m" && estBobinable(besoin.sousCategorie)) {
        return totalBobinable(besoin, { longueur_unitaire: p.longueur_unitaire ?? null, quantiteMultiplicateur: mult, prix_unitaire: p.prix_unitaire, gamme: p.gamme ?? null, sousCategorieArticle: p.sous_categorie ?? undefined }, prestations);
      }
      return besoin.quantite * mult * p.prix_unitaire;
    }
    const prix = parseFloat(etat.librePrix) || 0;
    return (besoin.unite === "m" ? Math.ceil(besoin.quantite) : besoin.quantite) * prix;
  }

  const heures = parseFloat(mainOeuvreHeures) || 0;
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

  async function genererDevis() {
    if (!resultat || !client) return;
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { alert("Session expirée."); setGenerating(false); return; }

      const tousLesBesoins = Object.values(parPieceFiltre).flat().filter(b => !estBobinable(b.sousCategorie));
      const construireChoixLigne = (besoin: BesoinApparie, etat: EtatChoix): ChoixLigne => {
        if (etat.mode === "exclu") return { besoin };
        if (etat.mode === "option") {
          return { besoin, optionCatalogue: besoin.options[etat.optionIndex] };
        }
        if (etat.mode === "autre") {
          const p = prestations.find(x => x.id === etat.autrePrestationId);
          if (!p) return { besoin };
          return {
            besoin,
            optionCatalogue: {
              prestation_id: p.id, nom: p.nom, prix_unitaire: p.prix_unitaire, unite: p.unite,
              type_branche: p.type_branche, gamme: p.gamme ?? null, longueur_unitaire: p.longueur_unitaire ?? null,
              quantiteMultiplicateur: multiplicateurPourArticle(besoin.sousCategorie, p.sous_categorie),
              sousCategorieArticle: p.sous_categorie ?? besoin.sousCategorie,
            },
          };
        }
        const prix = parseFloat(etat.librePrix) || 0;
        if (!etat.libreNom.trim() || prix <= 0) return { besoin };
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

      if (heures > 0) {
        const optMO = optionsMainOeuvre[mainOeuvreIndex];
        lignesFinales.push({
          nom: optMO?.nom ?? "Main d'œuvre", quantite: heures, prix_unitaire: tauxHoraire, unite: "heure",
          type_branche: "service", prestation_id: optMO?.prestation_id,
        });
      }

      const sousTotal = lignesFinales.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);
      const pctFrais = parseFloat(fraisGenerauxPct) || 0;
      if (pctFrais > 0) {
        lignesFinales.push({ nom: "Frais généraux", quantite: 1, prix_unitaire: Math.round(sousTotal * pctFrais / 100 * 100) / 100, unite: "forfait", type_branche: "service" });
      }
      if (deplacement > 0) {
        lignesFinales.push({ nom: "Déplacement", quantite: 1, prix_unitaire: deplacement, unite: "forfait", type_branche: "service" });
      }

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

      const totalService = lignesFinales.filter(l => l.type_branche === "service").reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);
      const totalMateriau = lignesFinales.filter(l => l.type_branche === "materiau").reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);

      const { data: prof } = await supabase.from("profil").select("*").eq("id", session.user.id).single();
      const numero = `${prof?.prefixe_devis ?? "DEV"}-${new Date().getFullYear()}-${String((prof?.compteur_devis ?? 0) + 1).padStart(3, "0")}`;

      const { data: devis, error } = await supabase.from("devis").insert({
        user_id: session.user.id, client_id: clientId, numero,
        objet: "Pré-devis électrique",
        statut: "brouillon", total_service: totalService, total_materiau: totalMateriau,
        total_ttc: totalService + totalMateriau,
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
      const { error: errLignes } = await supabase.from("devis_lignes").insert(
        lignesFinales.map((l, i) => ({ ...l, devis_id: devis.id, ordre: i }))
      );
      if (errLignes) {
        await supabase.from("devis").delete().eq("id", devis.id);
        alert("Erreur lors de l'enregistrement des lignes du devis (aucune ligne sauvegardée) : " + errLignes.message);
        setGenerating(false);
        return;
      }
      await supabase.from("profil").update({ compteur_devis: (prof?.compteur_devis ?? 0) + 1 }).eq("id", session.user.id);
      // Le devis final matérialise le brouillon — on l'efface pour ne pas laisser un
      // brouillon obsolète si le client revient sur cette page plus tard.
      await supabase.from("clients").update({ predevis_config: null } as any).eq("id", clientId);

      router.push(`/devis/${devis.id}`);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <Shell><div className="p-8 text-center text-ink-400">Chargement…</div></Shell>;

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href={`/plan/${clientId}`} className="btn-ghost !px-2.5 !py-2"><ArrowLeft size={16} /></Link>
          <div className="flex-1">
            <h1 className="font-display text-2xl">Pré-devis électrique</h1>
            {client && <p className="text-xs text-ink-400">{client.prenom ? `${client.prenom} ${client.nom}` : client.nom}</p>}
          </div>
        </div>

        {toutesLesPiecesReelles.length > 1 && (
          <div className="card card-inner mb-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-ink-800 text-sm">Pièces à inclure</h2>
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
            <p className="text-xs text-ink-400 mt-2">Le tableau électrique, la distance au point d'arrivée des gaines et les boîtes de dérivation communes au niveau restent toujours pris en compte, même si tu ne sélectionnes que certaines pièces — sinon le calcul des longueurs de câbles et gaines serait faussé.</p>
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

        {resultat && Object.entries(parPieceFiltre)
          .map(([piece, besoins]) => [piece, besoins.filter(b => !estBobinable(b.sousCategorie))] as const)
          .filter(([, besoins]) => besoins.length > 0)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([piece, besoins]) => (
          <div key={piece} className="card card-inner mb-4">
            <h2 className="font-semibold text-ink-800 mb-3">{piece}</h2>
            <div className="flex flex-col gap-2">
              {besoins.map(b => (
                <BesoinRow key={b.cle} besoin={b} etat={choix[b.cle] ?? etatParDefaut(b)}
                  onChange={e => majChoix(b.cle, e)} prestations={prestations} />
              ))}
            </div>
          </div>
        ))}

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
                  onChange={e => setChoixAgrege(prev => ({ ...prev, [b.cle]: e }))} prestations={prestations} detail={b.piece} />
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
              <label className="label">Main d'œuvre (heures)</label>
              <input className="input" type="number" min="0" step="0.5" value={mainOeuvreHeures}
                onChange={e => setMainOeuvreHeures(e.target.value)} />
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
