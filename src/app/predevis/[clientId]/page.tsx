"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Client, Prestation, DevisLigne } from "@/types";
import { Niveau } from "@/lib/maison-types";
import { BreakerRow } from "@/lib/electrical-constants";
import {
  calculerBesoinsBruts, apparierCatalogue, optionsPourSousCategorie, genererLignesDevis,
  ResultatPreDevis, BesoinApparie, OptionArticle, ChoixLigne,
} from "@/lib/predevis-engine";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Search, X, Sparkles, Save } from "lucide-react";

const LABEL_GAMME: Record<string, string> = { entree: "Entrée de gamme", moyenne: "Moyenne gamme", haut: "Haut de gamme" };

function fmt(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

// ─── État de choix par besoin ───────────────────────────────────────────────

type ModeChoix = "option" | "autre" | "libre";
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

// Quantité approximative facturée pour l'affichage en direct (le calcul exact, avec
// décomposition en bobines, n'est fait qu'à la génération finale — voir genererLignesDevis).
function quantiteApprox(besoin: BesoinApparie, option?: { longueur_unitaire?: number | null }): number {
  if (option?.longueur_unitaire && option.longueur_unitaire > 0) {
    return Math.max(1, Math.round(besoin.quantite / option.longueur_unitaire));
  }
  return besoin.unite === "m" ? Math.ceil(besoin.quantite) : besoin.quantite;
}

// ─── Ligne d'un besoin ───────────────────────────────────────────────────────

function BesoinRow({ besoin, etat, onChange, prestations }: {
  besoin: BesoinApparie; etat: EtatChoix; onChange: (e: EtatChoix) => void; prestations: Prestation[];
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
        </div>
        {besoin.options.length === 0 && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            <AlertTriangle size={12} /> Non identifié au catalogue
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
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
    if (etat.mode === "option") {
      const opt = besoin.options[etat.optionIndex];
      if (!opt) return 0;
      return quantiteApprox(besoin, opt) * opt.prix_unitaire;
    }
    if (etat.mode === "autre") {
      const p = prestations.find(x => x.id === etat.autrePrestationId);
      if (!p) return 0;
      return quantiteApprox(besoin, { longueur_unitaire: p.longueur_unitaire ?? null }) * p.prix_unitaire;
    }
    const prix = parseFloat(etat.librePrix) || 0;
    return (besoin.unite === "m" ? Math.ceil(besoin.quantite) : besoin.quantite) * prix;
  }

  const heures = parseFloat(mainOeuvreHeures) || 0;
  const tauxHoraire = optionsMainOeuvre[mainOeuvreIndex]?.prix_unitaire ?? profil?.taux_horaire ?? 0;
  const totalMainOeuvre = heures * tauxHoraire;

  const totalConsommablesApprox = resultat
    ? Object.values(resultat.parPiece).flat().reduce((s, b) => s + totalLigneApprox(b, choix[b.cle] ?? etatParDefaut(b)), 0)
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

      const tousLesBesoins = Object.values(resultat.parPiece).flat();
      const choixLignes: ChoixLigne[] = tousLesBesoins.map(besoin => {
        const etat = choix[besoin.cle] ?? etatParDefaut(besoin);
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
            },
          };
        }
        const prix = parseFloat(etat.librePrix) || 0;
        if (!etat.libreNom.trim() || prix <= 0) return { besoin };
        return { besoin, libre: { nom: etat.libreNom, prixUnitaire: prix, unite: etat.libreUnite, typeBranche: etat.libreBranche } };
      });

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

      if (lignesFinales.length > 0) {
        await supabase.from("devis_lignes").insert(lignesFinales.map((l, i) => ({ ...l, devis_id: devis.id, ordre: i })));
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

        {resultat && resultat.nonIdentifies.length > 0 && (
          <div className="card card-inner mb-4 bg-red-50 border-red-200">
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1 flex items-center gap-1.5">
              <AlertTriangle size={13} /> {resultat.nonIdentifies.length} besoin{resultat.nonIdentifies.length > 1 ? "s" : ""} non identifié{resultat.nonIdentifies.length > 1 ? "s" : ""} au catalogue
            </p>
            <p className="text-xs text-red-600">Choisis un article existant, cherche-en un autre ou saisis un prix libre pour chacun ci-dessous.</p>
          </div>
        )}

        {resultat && Object.entries(resultat.parPiece).sort(([a], [b]) => a.localeCompare(b)).map(([piece, besoins]) => (
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

        {resultat && Object.keys(resultat.parPiece).length === 0 && (
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
