"use client";
// src/app/plan/[clientId]/suivi/page.tsx
//
// SUIVI DE RÉALISATION d'un plan de circuits : pour chaque circuit généré, la liste précise de tout ce qui doit être posé
// et raccordé sur le chantier (disjoncteur, boîtes, points lumineux, commandes, câbles départ / alimentation / navettes /
// retours), des cases à cocher, et le guide de branchement de chaque commande (simple, va-et-vient, 3 points et plus,
// télérupteur, détecteur, doubles). Les circuits sont recalculés depuis le plan ENREGISTRÉ (lib/suivi-realisation.ts) ;
// les coches sont stockées à part (projets.suivi_realisation, migration 008).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Check, ChevronDown, ChevronRight, AlertTriangle, Copy, RotateCcw, RefreshCw, LayoutTemplate, ListChecks, BookOpen, Search, X, Info,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Client, Projet } from "@/types";
import { useProjets, qsProjet } from "@/lib/projets";
import Shell from "@/components/layout/Shell";
import ConfirmDialog from "@/components/ConfirmDialog";
import SchemaCommande from "@/components/plan/SchemaCommande";
import { migrerModeleMurs } from "@/lib/murs";
import { migrerBoitesDerivation, reamorcerCompteurId, dedupliquerIds } from "@/lib/maison-types";
import {
  construireSuivi, progressionElements, progressionPlan, clesDuCircuit, cochesOrphelines,
  SuiviPlan, CircuitSuivi, ElementSuivi, GuideCommande, CategorieElement, Progression,
} from "@/lib/suivi-realisation";
import { Coches, lireCoches, appliquerCoches, retirerCoches, relireCoches } from "@/lib/suivi-persistance";
import { cn } from "@/lib/utils";

const SQL_MIGRATION =
  "ALTER TABLE projets\n  ADD COLUMN IF NOT EXISTS suivi_realisation TEXT;";

const TITRES_CATEGORIE: Record<CategorieElement, string> = {
  tableau: "Au tableau", boite: "Boîtes de dérivation", lampe: "Points lumineux", commande: "Commandes (interrupteurs, va-et-vient…)",
  appareil: "Appareillage", liaison: "Câbles à tirer",
};
const ORDRE_CATEGORIES: CategorieElement[] = ["tableau", "boite", "lampe", "commande", "appareil", "liaison"];

const dateCourte = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
};

// ─── Sous-composants (définis hors du composant principal : pas de remontage à chaque rendu) ─────────────────

function BarreProgression({ p, grande }: { p: Progression; grande?: boolean }) {
  const termine = p.total > 0 && p.fait === p.total;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className={cn("flex-1 rounded-full bg-ink-100 overflow-hidden", grande ? "h-3" : "h-2")}>
        <div className={cn("h-full rounded-full transition-all duration-300", termine ? "bg-emerald-500" : "bg-volt-500")} style={{ width: `${p.pct}%` }} />
      </div>
      <span className={cn("shrink-0 font-semibold tabular-nums", grande ? "text-sm" : "text-xs", termine ? "text-emerald-700" : "text-ink-600")}>
        {p.fait}/{p.total}
      </span>
    </div>
  );
}

function PuceEtape({ libelle, fait, date, onToggle }: { libelle: string; fait: boolean; date?: string; onToggle: () => void }) {
  return (
    <button
      type="button" onClick={onToggle} aria-pressed={fait}
      title={fait && date ? `Fait le ${dateCourte(date)}` : undefined}
      className={cn(
        "flex items-center gap-2 min-h-[42px] px-3 py-1.5 rounded-xl border text-left text-xs font-medium transition-colors select-none active:scale-[0.98]",
        fait ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-white border-ink-200 text-ink-600 hover:border-volt-400",
      )}
    >
      <span className={cn("w-5 h-5 shrink-0 rounded-md border flex items-center justify-center", fait ? "bg-emerald-500 border-emerald-500 text-white" : "border-ink-300 bg-white")}>
        {fait && <Check size={14} strokeWidth={3} />}
      </span>
      <span className="leading-tight">
        {libelle}
        {fait && date && <span className="block text-[10px] font-normal text-emerald-700/80">{dateCourte(date)}</span>}
      </span>
    </button>
  );
}

function LigneElement({ e, coches, onToggle, onVoirGuide }: {
  e: ElementSuivi; coches: Coches; onToggle: (cle: string) => void; onVoirGuide: (guideId: string) => void;
}) {
  const toutFait = e.etapes.length > 0 && e.etapes.every(et => coches[et.cle]);
  return (
    <div className={cn("py-3 border-t border-ink-100 flex flex-col sm:flex-row gap-3", toutFait && "bg-emerald-50/40")}>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className={cn("text-sm font-semibold break-words", toutFait ? "text-ink-500" : "text-ink-900")}>{e.titre}</p>
          {e.badges.filter(Boolean).map((b, i) => (
            <span key={i} className="badge bg-ink-100 text-ink-600 !text-[10px] !px-2">{b}</span>
          ))}
        </div>
        {e.sousTitre && <p className="text-xs text-ink-500 mt-0.5 break-words">{e.sousTitre}</p>}
        {e.details.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {e.details.map((d, i) => <li key={i} className="text-xs text-ink-600 leading-relaxed break-words">• {d}</li>)}
          </ul>
        )}
        {e.alertes.map((a, i) => (
          <p key={i} className="mt-1.5 flex gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" /><span>{a}</span>
          </p>
        ))}
        {e.guideIds && e.guideIds.length > 0 && (
          <button type="button" onClick={() => onVoirGuide(e.guideIds![0])}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-volt-700 hover:text-volt-800">
            <BookOpen size={13} /> Comment la câbler ({e.guideIds.length > 1 ? `${e.guideIds.length} guides` : "guide de câblage"})
          </button>
        )}
      </div>
      {e.etapes.length > 0 ? (
        <div className="flex sm:flex-col gap-1.5 flex-wrap sm:w-52 shrink-0">
          {e.etapes.map(et => (
            <PuceEtape key={et.cle} libelle={et.libelle} fait={!!coches[et.cle]} date={coches[et.cle]} onToggle={() => onToggle(et.cle)} />
          ))}
        </div>
      ) : (
        <span className="text-xs text-ink-400 italic sm:w-52 shrink-0">Rien à poser</span>
      )}
    </div>
  );
}

function CarteGuide({ g, ouvert, onToggleOuvert }: { g: GuideCommande; ouvert: boolean; onToggleOuvert: () => void }) {
  return (
    <div id={`guide-${g.id}`} className="rounded-xl border border-ink-200 bg-ink-50/60 scroll-mt-24">
      <button type="button" onClick={onToggleOuvert} className="w-full flex items-start gap-2 px-3.5 py-3 text-left">
        {ouvert ? <ChevronDown size={16} className="mt-0.5 shrink-0 text-ink-500" /> : <ChevronRight size={16} className="mt-0.5 shrink-0 text-ink-500" />}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-ink-900 break-words">{g.titre}</span>
          {g.alertes.length > 0 && <span className="text-xs text-amber-700 font-medium">⚠ {g.alertes.length} point{g.alertes.length > 1 ? "s" : ""} à vérifier</span>}
        </span>
      </button>
      {ouvert && (
        <div className="px-3.5 pb-4 space-y-4">
          {g.alertes.map((a, i) => (
            <p key={i} className="flex gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /><span>{a}</span>
            </p>
          ))}
          {g.schema && <SchemaCommande schema={g.schema} />}

          <div>
            <p className="label">Raccordement mécanisme par mécanisme</p>
            <div className="space-y-2.5">
              {g.mecanismes.map(m => (
                <div key={`${m.id}-${m.position}`} className="bg-white border border-ink-200 rounded-xl p-3">
                  <p className="text-sm font-semibold text-ink-900 break-words">
                    <span className="inline-flex items-center justify-center w-5 h-5 mr-1.5 rounded-full bg-ink-900 text-volt-400 text-[11px]">{m.position}</span>
                    {m.titre}
                  </p>
                  <p className="text-xs text-volt-700 font-semibold mt-0.5">{m.roleLibelle}</p>
                  {(m.repere || m.hauteurCm > 0) && (
                    <p className="text-[11px] text-ink-400 mt-0.5">{m.hauteurCm > 0 ? `${m.hauteurCm} cm du sol · ` : ""}{m.repere}</p>
                  )}
                  {m.plaque && <p className="text-[11px] text-ink-500 mt-0.5">{m.plaque}</p>}
                  <table className="w-full mt-2 text-xs">
                    <tbody>
                      {m.bornes.map((b, i) => (
                        <tr key={i} className="border-t border-ink-100 align-top">
                          <td className="py-1.5 pr-3 font-mono font-semibold text-ink-900 whitespace-nowrap w-[34%]">{b.borne}</td>
                          <td className="py-1.5 text-ink-600 break-words">{b.fil}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="label">Pas à pas</p>
            <ol className="space-y-1.5">
              {g.etapes.map((e, i) => (
                <li key={i} className="flex gap-2 text-xs text-ink-700 leading-relaxed">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-volt-100 text-volt-800 text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                  <span className="break-words">{e}</span>
                </li>
              ))}
            </ol>
          </div>

          {g.attention.length > 0 && (
            <div>
              <p className="label">À ne pas faire</p>
              <ul className="space-y-1.5">
                {g.attention.map((a, i) => (
                  <li key={i} className="flex gap-1.5 text-xs text-red-800 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5 leading-relaxed">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" /><span className="break-words">{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CarteCircuit({ c, coches, ouvert, onToggleOuvert, onToggle, onToggleGroupe, onReinitialiser }: {
  c: CircuitSuivi; coches: Coches; ouvert: boolean; onToggleOuvert: () => void;
  onToggle: (cle: string) => void; onToggleGroupe: (cles: string[], fait: boolean) => void; onReinitialiser: () => void;
}) {
  const [guidesOuverts, setGuidesOuverts] = useState<Set<string>>(new Set());
  const p = progressionElements(c.elements, coches);
  const termine = p.total > 0 && p.fait === p.total;
  const nbProblemes = c.alertes.length + c.problemes.length;

  const basculerGuide = (id: string) => setGuidesOuverts(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const voirGuide = (id: string) => {
    setGuidesOuverts(s => new Set(s).add(id));
    window.setTimeout(() => document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  return (
    <div className={cn("card overflow-hidden", termine && "border-emerald-300")}>
      <button type="button" onClick={onToggleOuvert} className="w-full text-left p-4 flex items-start gap-3">
        <span className="w-1.5 self-stretch rounded-full shrink-0" style={{ background: c.couleur }} />
        <span className="flex-1 min-w-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-base">{c.icone}</span>
            <span className="font-semibold text-ink-900 break-words">{c.nom}</span>
            {termine && <span className="badge bg-emerald-100 text-emerald-700">Terminé</span>}
            {nbProblemes > 0 && <span className="badge bg-amber-100 text-amber-800">⚠ {nbProblemes}</span>}
          </span>
          <span className="block text-xs text-ink-500 mt-0.5">{c.niveauNom} · {c.resume.join(" · ")}</span>
          <span className="block mt-2"><BarreProgression p={p} /></span>
        </span>
        {ouvert ? <ChevronDown size={18} className="shrink-0 text-ink-400 mt-1" /> : <ChevronRight size={18} className="shrink-0 text-ink-400 mt-1" />}
      </button>

      {ouvert && (
        <div className="px-4 pb-4 border-t border-ink-100">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-4">
            {c.caracteristiques.map(k => (
              <div key={k.libelle} className={cn("rounded-xl px-3 py-2 border", k.alerte ? "bg-red-50 border-red-200" : "bg-ink-50 border-ink-100")}>
                <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-400">{k.libelle}</p>
                <p className={cn("text-sm font-semibold break-words", k.alerte ? "text-red-700" : "text-ink-900")}>{k.valeur}</p>
              </div>
            ))}
          </div>

          {(c.alertes.length > 0 || c.problemes.length > 0) && (
            <div className="mt-3 space-y-1.5">
              {c.problemes.map((pb, i) => (
                <p key={`p${i}`} className={cn("flex gap-1.5 text-xs rounded-lg px-2.5 py-1.5 border", pb.gravite === "erreur" ? "text-red-800 bg-red-50 border-red-200" : "text-amber-800 bg-amber-50 border-amber-200")}>
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" /><span>{pb.message}</span>
                </p>
              ))}
              {c.alertes.map((a, i) => (
                <p key={`a${i}`} className="flex gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" /><span>{a}</span>
                </p>
              ))}
            </div>
          )}

          {ORDRE_CATEGORIES.map(cat => {
            const els = c.elements.filter(e => e.categorie === cat);
            if (els.length === 0) return null;
            const cles = els.flatMap(e => e.etapes.map(et => et.cle));
            const toutFait = cles.length > 0 && cles.every(k => coches[k]);
            const pc = progressionElements(els, coches);
            return (
              <div key={cat} className="mt-5">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <p className="label !mb-0">{TITRES_CATEGORIE[cat]} <span className="text-ink-400 normal-case font-medium">· {pc.fait}/{pc.total}</span></p>
                  {cles.length > 1 && (
                    <button type="button" onClick={() => onToggleGroupe(cles, !toutFait)} className="text-xs font-semibold text-volt-700 hover:text-volt-800">
                      {toutFait ? "Tout décocher" : "Tout cocher"}
                    </button>
                  )}
                </div>
                {els.map(e => <LigneElement key={e.id} e={e} coches={coches} onToggle={onToggle} onVoirGuide={voirGuide} />)}
              </div>
            );
          })}

          {c.guides.length > 0 && (
            <div className="mt-6">
              <p className="label">Guides de câblage des commandes ({c.guides.length})</p>
              <div className="space-y-2">
                {c.guides.map(g => (
                  <CarteGuide key={g.id} g={g} ouvert={guidesOuverts.has(g.id)} onToggleOuvert={() => basculerGuide(g.id)} />
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <button type="button" onClick={onReinitialiser} className="btn-ghost !py-1.5 !text-xs">
              <RotateCcw size={12} /> Remettre ce circuit à zéro
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function SuiviPage() {
  const params = useParams();
  const clientId = params.clientId as string;
  const { projets, projet, loading, changerProjet } = useProjets(clientId);
  if (loading) return <Shell><div className="flex items-center justify-center h-64 text-ink-400">Chargement…</div></Shell>;
  if (!projet) return <Shell><div className="p-8 text-center text-ink-500">Impossible de charger le projet de ce client.</div></Shell>;
  return <Suivi key={projet.id} clientId={clientId} projet={projet} projets={projets} onSelect={changerProjet} />;
}

type Calcul = { vide: true } | { erreur: string } | { suivi: SuiviPlan };

function Suivi({ clientId, projet, projets, onSelect }: { clientId: string; projet: Projet; projets: Projet[]; onSelect: (id: string) => void }) {
  const [client, setClient] = useState<Client | null>(null);
  const [coches, setCoches] = useState<Coches>(() => lireCoches(projet.suivi_realisation));
  const [colonneAbsente, setColonneAbsente] = useState<boolean>(!("suivi_realisation" in projet));
  const [erreur, setErreur] = useState<string | null>(null);
  const [niveauFiltre, setNiveauFiltre] = useState<number | "tous">("tous");
  const [masquerTermines, setMasquerTermines] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [ouverts, setOuverts] = useState<Set<string>>(new Set());
  const [anomaliesOuvertes, setAnomaliesOuvertes] = useState(false);
  const [aReinitialiser, setAReinitialiser] = useState<CircuitSuivi | null>(null);
  const [copie, setCopie] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const pendingRef = useRef(0);
  const fileRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    supabase.from("clients").select("*").eq("id", clientId).single().then(({ data }) => { if (data) setClient(data as Client); });
  }, [clientId]);

  // Circuits recalculés depuis le plan enregistré — mêmes migrations que l'éditeur de plan, dans le même ordre.
  const calcul: Calcul = useMemo(() => {
    const raw = projet.maison_config;
    if (!raw) return { vide: true };
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed?.niveaux) || parsed.niveaux.length === 0) return { vide: true };
      const { niveaux: apresMurs } = migrerModeleMurs(parsed.niveaux);
      migrerBoitesDerivation(apresMurs);
      reamorcerCompteurId(apresMurs);
      const { niveaux } = dedupliquerIds(apresMurs);
      return { suivi: construireSuivi(niveaux) };
    } catch (e) {
      return { erreur: e instanceof Error ? e.message : String(e) };
    }
  }, [projet.maison_config]);

  const suivi = "suivi" in calcul ? calcul.suivi : null;

  // Ouvre d'office quand il n'y a qu'un ou deux circuits.
  useEffect(() => {
    if (suivi && suivi.circuits.length <= 2) setOuverts(new Set(suivi.circuits.map(c => c.cle)));
  }, [suivi]);

  const signalerEchec = useCallback((message: string, colonne: boolean) => {
    if (colonne) setColonneAbsente(true);
    setErreur(colonne ? null : `Enregistrement impossible : ${message}`);
  }, []);

  // Coche / décoche : mise à jour immédiate à l'écran, puis écriture en file (une à la fois) qui relit la base avant d'écrire.
  const modifier = useCallback((cles: string[], fait: boolean) => {
    if (cles.length === 0) return;
    const dateIso = new Date().toISOString();
    setCoches(prev => {
      const n = { ...prev };
      cles.forEach(k => { if (fait) { if (!n[k]) n[k] = dateIso; } else delete n[k]; });
      return n;
    });
    pendingRef.current += 1;
    fileRef.current = fileRef.current.then(async () => {
      const res = await appliquerCoches(projet.id, cles, fait, dateIso);
      pendingRef.current -= 1;
      if (res.ok) {
        setErreur(null);
        if (pendingRef.current === 0) setCoches(res.coches);
      } else {
        signalerEchec(res.message, res.colonneAbsente);
        const relu = await relireCoches(projet.id);
        if (relu && pendingRef.current === 0) setCoches(relu);
        else if (!relu && pendingRef.current === 0) setCoches(lireCoches(projet.suivi_realisation));
      }
    });
  }, [projet.id, projet.suivi_realisation, signalerEchec]);

  const basculer = useCallback((cle: string) => modifier([cle], !coches[cle]), [modifier, coches]);

  const actualiser = useCallback(async () => {
    if (pendingRef.current > 0) return;
    setEnCours(true);
    const relu = await relireCoches(projet.id);
    if (relu && pendingRef.current === 0) setCoches(relu);
    setEnCours(false);
  }, [projet.id]);

  // Retour sur l'onglet (ex. après avoir coché depuis un autre appareil) : coches relues.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") void actualiser(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [actualiser]);

  const reinitialiser = async () => {
    if (!aReinitialiser) return;
    const res = await retirerCoches(projet.id, clesDuCircuit(aReinitialiser));
    if (res.ok) { setCoches(res.coches); setErreur(null); } else signalerEchec(res.message, res.colonneAbsente);
    setAReinitialiser(null);
  };

  const orphelines = useMemo(() => (suivi ? cochesOrphelines(suivi, coches) : []), [suivi, coches]);
  const nettoyer = async () => {
    const res = await retirerCoches(projet.id, orphelines);
    if (res.ok) { setCoches(res.coches); setErreur(null); } else signalerEchec(res.message, res.colonneAbsente);
  };

  const global = suivi ? progressionPlan(suivi, coches) : { fait: 0, total: 0, pct: 0 };
  const niveaux = useMemo(() => {
    const m = new Map<number, string>();
    suivi?.circuits.forEach(c => { if (!m.has(c.niveauId)) m.set(c.niveauId, c.niveauNom); });
    return [...m.entries()].map(([id, nom]) => ({ id, nom }));
  }, [suivi]);

  const requete = recherche.trim().toLowerCase();
  const circuitsAffiches = useMemo(() => {
    if (!suivi) return [];
    return suivi.circuits.filter(c => {
      if (niveauFiltre !== "tous" && c.niveauId !== niveauFiltre) return false;
      if (masquerTermines) { const p = progressionElements(c.elements, coches); if (p.total > 0 && p.fait === p.total) return false; }
      if (requete) {
        const texte = `${c.nom} ${c.label} ${c.niveauNom} ${c.elements.map(e => `${e.titre} ${e.sousTitre ?? ""}`).join(" ")}`.toLowerCase();
        if (!requete.split(/\s+/).every(m => texte.includes(m))) return false;
      }
      return true;
    });
  }, [suivi, niveauFiltre, masquerTermines, requete, coches]);

  const nomClient = client ? (client.prenom ? `${client.prenom} ${client.nom}` : client.nom) : "";
  const nbAnomalies = suivi ? suivi.avertissements.length + suivi.alertesPlan.length + suivi.problemesHorsCircuit.length : 0;
  const lienPlan = `/plan/${clientId}${qsProjet(projet.id)}`;

  const copierSql = async () => {
    try { await navigator.clipboard.writeText(SQL_MIGRATION); setCopie(true); window.setTimeout(() => setCopie(false), 2000); } catch { /* presse-papiers indisponible */ }
  };

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        <Link href="/plan" className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-800 mb-3">
          <ArrowLeft size={13} /> Plans de circuits
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div className="min-w-0">
            <h1 className="font-display text-3xl text-ink-900">Suivi de réalisation</h1>
            <p className="text-ink-500 text-sm mt-1">
              {nomClient}{projets.length > 1 ? ` · ${projet.nom}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {projets.length > 1 && (
              <select className="input !w-auto !py-2" value={projet.id} onChange={e => onSelect(e.target.value)} aria-label="Projet">
                {projets.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
              </select>
            )}
            <button type="button" onClick={() => void actualiser()} className="btn-ghost !py-2" title="Relire les coches enregistrées">
              <RefreshCw size={14} className={enCours ? "animate-spin" : ""} /> Actualiser
            </button>
            <Link href={lienPlan} className="btn-ghost !py-2"><LayoutTemplate size={14} /> Ouvrir le plan</Link>
          </div>
        </div>

        {colonneAbsente && (
          <div className="card card-inner border-red-300 bg-red-50 mb-5">
            <p className="font-semibold text-red-800 text-sm">Une étape de mise en place est nécessaire avant de pouvoir enregistrer les coches</p>
            <p className="text-xs text-red-700 mt-1">Colle ce SQL dans Supabase → SQL Editor → Run (fichier <span className="font-mono">supabase/migrations/008_suivi_realisation.sql</span>), puis recharge cette page.</p>
            <pre className="mt-2 text-xs bg-white border border-red-200 rounded-lg p-3 overflow-x-auto font-mono text-ink-800">{SQL_MIGRATION}</pre>
            <button type="button" onClick={() => void copierSql()} className="btn-ghost !py-1.5 !text-xs mt-2"><Copy size={12} /> {copie ? "Copié ✓" : "Copier le SQL"}</button>
          </div>
        )}
        {erreur && (
          <div className="card card-inner border-red-300 bg-red-50 mb-5 flex items-start gap-2 text-sm text-red-800">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" /><span className="flex-1">{erreur}</span>
            <button type="button" onClick={() => setErreur(null)} aria-label="Fermer"><X size={15} /></button>
          </div>
        )}

        {"vide" in calcul && (
          <div className="card card-inner text-center py-14">
            <ListChecks size={30} className="mx-auto text-ink-300 mb-3" />
            <p className="text-ink-600 font-medium">Ce projet n'a pas encore de plan enregistré</p>
            <p className="text-ink-400 text-sm mt-1 mb-4">Dessine le plan et pose les appareillages, puis reviens ici.</p>
            <Link href={lienPlan} className="btn-volt inline-flex"><LayoutTemplate size={14} /> Ouvrir le plan</Link>
          </div>
        )}
        {"erreur" in calcul && (
          <div className="card card-inner border-red-300 bg-red-50 text-sm text-red-800">
            Impossible de calculer les circuits de ce plan : {calcul.erreur}
          </div>
        )}

        {suivi && (
          <>
            <div className="card card-inner mb-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <p className="font-semibold text-ink-900">Avancement du chantier</p>
                <p className="text-xs text-ink-500">{suivi.circuits.length} circuit{suivi.circuits.length > 1 ? "s" : ""} · {global.total} étapes à cocher</p>
              </div>
              <BarreProgression p={global} grande />
              <p className="flex gap-1.5 text-[11px] text-ink-400 mt-3 leading-relaxed">
                <Info size={13} className="shrink-0 mt-0.5" />
                <span>Les circuits sont recalculés à partir du plan enregistré. Si tu modifies le plan, rouvre cette page : les coches des éléments inchangés sont conservées, un circuit dont la composition change repasse « à faire » (une coche fausse serait plus dangereuse qu'une coche perdue).</span>
              </p>
            </div>

            {nbAnomalies > 0 && (
              <div className="card mb-4 overflow-hidden border-amber-300">
                <button type="button" onClick={() => setAnomaliesOuvertes(o => !o)} className="w-full flex items-center gap-2 p-4 text-left bg-amber-50">
                  <AlertTriangle size={16} className="text-amber-700 shrink-0" />
                  <span className="flex-1 font-semibold text-amber-900 text-sm">{nbAnomalies} point{nbAnomalies > 1 ? "s" : ""} à vérifier dans le plan avant de câbler</span>
                  {anomaliesOuvertes ? <ChevronDown size={16} className="text-amber-700" /> : <ChevronRight size={16} className="text-amber-700" />}
                </button>
                {anomaliesOuvertes && (
                  <ul className="p-4 space-y-1.5">
                    {suivi.avertissements.map((a, i) => <li key={`v${i}`} className="text-xs text-amber-900">• {a}</li>)}
                    {suivi.problemesHorsCircuit.map((p, i) => (
                      <li key={`p${i}`} className={cn("text-xs", p.gravite === "erreur" ? "text-red-800 font-medium" : "text-amber-900")}>• {p.message}</li>
                    ))}
                    {suivi.alertesPlan.map((a, i) => <li key={`a${i}`} className="text-xs text-amber-900">• {a}</li>)}
                  </ul>
                )}
              </div>
            )}

            {orphelines.length > 0 && (
              <div className="card card-inner mb-4 flex flex-wrap items-center gap-3 text-xs text-ink-600">
                <span className="flex-1 min-w-[200px]">{orphelines.length} coche{orphelines.length > 1 ? "s" : ""} enregistrée{orphelines.length > 1 ? "s" : ""} ne corresponde{orphelines.length > 1 ? "nt" : ""} plus à aucun élément du plan (élément supprimé ou circuit recomposé).</span>
                <button type="button" onClick={() => void nettoyer()} className="btn-ghost !py-1.5 !text-xs">Nettoyer</button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="input pl-9 !py-2" placeholder="Chercher un circuit, une pièce, un appareil…" value={recherche} onChange={e => setRecherche(e.target.value)} />
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-ink-600 select-none cursor-pointer">
                <input type="checkbox" checked={masquerTermines} onChange={e => setMasquerTermines(e.target.checked)} className="w-4 h-4 accent-amber-500" />
                Masquer les circuits terminés
              </label>
              <button type="button" className="btn-ghost !py-1.5 !text-xs"
                onClick={() => setOuverts(ouverts.size > 0 ? new Set() : new Set(circuitsAffiches.map(c => c.cle)))}>
                {ouverts.size > 0 ? "Tout fermer" : "Tout ouvrir"}
              </button>
            </div>

            {niveaux.length > 1 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {[{ id: "tous" as const, nom: "Tous les niveaux" }, ...niveaux].map(n => {
                  const cs = suivi.circuits.filter(c => n.id === "tous" || c.niveauId === n.id);
                  const p = progressionElements(cs.flatMap(c => c.elements), coches);
                  const actif = niveauFiltre === n.id;
                  return (
                    <button key={String(n.id)} type="button" onClick={() => setNiveauFiltre(n.id)}
                      className={cn("px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors", actif ? "bg-ink-900 text-volt-400 border-ink-900" : "bg-white text-ink-600 border-ink-200 hover:border-volt-400")}>
                      {n.nom} <span className={cn("ml-1 tabular-nums", actif ? "text-volt-300" : "text-ink-400")}>{p.fait}/{p.total}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="space-y-3">
              {circuitsAffiches.length === 0 ? (
                <div className="card card-inner text-center text-sm text-ink-400 py-8">Aucun circuit ne correspond.</div>
              ) : circuitsAffiches.map(c => (
                <CarteCircuit
                  key={c.cle} c={c} coches={coches} ouvert={ouverts.has(c.cle)}
                  onToggleOuvert={() => setOuverts(s => { const n = new Set(s); if (n.has(c.cle)) n.delete(c.cle); else n.add(c.cle); return n; })}
                  onToggle={basculer} onToggleGroupe={modifier} onReinitialiser={() => setAReinitialiser(c)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!aReinitialiser}
        title="Remettre ce circuit à zéro ?"
        message={aReinitialiser ? `Toutes les coches du circuit « ${aReinitialiser.nom} » (${aReinitialiser.niveauNom}) seront effacées. Le plan n'est pas modifié.` : ""}
        confirmLabel="Remettre à zéro"
        onConfirm={() => void reinitialiser()}
        onCancel={() => setAReinitialiser(null)}
      />
    </Shell>
  );
}
