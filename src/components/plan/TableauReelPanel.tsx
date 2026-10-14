"use client";
// src/components/plan/TableauReelPanel.tsx
//
// PANNEAU « TABLEAU RÉALISTE » du module Plan : le tableau tel qu'on l'aurait devant soi (rails, modules, différentiels, réserve), la GTL et
// ses composants, les connexions phase / neutre / terre,
// les contrôles NF C 15-100 (alertes, jamais bloquantes) et les gaines optimisées au départ du tableau. Tous les paramètres sont modifiables ;
// les calculs viennent de lib/tableau-reel.ts, lib/gaines-optimisees.ts (fonctions pures, testées).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BreakerRow } from "@/lib/electrical-constants";
import { calculerTableauReel, fusionnerParamsTableau, type ControleNF, type ParamsGtl, type ParamsTableauReel, type ResultatTableauReel } from "@/lib/tableau-reel";
import { couleurGroupe, deplacerCircuitGaine, fusionnerForcages, fusionnerParamsGaines, FORCAGES_VIDES, type ForcagesGaines, type GroupeGaines, type ParamsGainesOptimisees, type TronconArbre } from "@/lib/gaines-optimisees";
import type { GainesNiveau, SyntheseGaines } from "@/lib/gaines-optimisees-plan";
import type { ReglagesGaines, ReglagesTableauReel } from "@/lib/maison-types";
import { agencerGtl } from "@/lib/gtl-agencement";
import { SchemaGaines } from "./SchemaGaines";
import { GainesPlan, GtlElevation, TableauDetail, ZoneZoom, COULEURS_PHASE, ratioElevation, ratioTableau, type PieceDessin } from "./TableauReelVisuels";

export type Onglet = "ensemble" | "tableau" | "gtl" | "connexions" | "controles" | "gaines" | "schema";
const ONGLETS: { id: Onglet; label: string; icone: string }[] = [
  { id: "ensemble", label: "Vue d'ensemble", icone: "▦" }, { id: "tableau", label: "Tableau", icone: "⚡" }, { id: "gtl", label: "GTL", icone: "▥" },
  { id: "connexions", label: "Connexions", icone: "⤳" },
  { id: "controles", label: "Contrôles NF", icone: "✓" }, { id: "gaines", label: "Gaines", icone: "⑂" }, { id: "schema", label: "Schéma technique", icone: "⌘" },
];

const fmt = (v: number, d = 1) => v.toFixed(d).replace(".", ",");

// ─── Champs ───────────────────────────────────────────────────────────────────────────────────────────────────────
function Num({ valeur, onChange, pas = 1, min, max, largeur = "w-16" }: { valeur: number; onChange: (v: number) => void; pas?: number; min?: number; max?: number; largeur?: string }) {
  const [texte, setTexte] = useState(String(valeur));
  const focus = useRef(false);
  useEffect(() => { if (!focus.current) setTexte(String(valeur)); }, [valeur]);
  return (
    <input type="text" inputMode="decimal" value={texte} step={pas}
      onFocus={() => { focus.current = true; }}
      onBlur={() => { focus.current = false; setTexte(String(valeur)); }}
      onChange={e => {
        setTexte(e.target.value);
        const v = parseFloat(e.target.value.replace(",", "."));
        if (Number.isFinite(v)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)));
      }}
      className={`${largeur} rounded border border-ink-200 px-1.5 py-0.5 text-xs text-right font-mono`} />
  );
}
function Champ({ label, children, aide }: { label: string; children: React.ReactNode; aide?: string }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-ink-700 py-0.5" title={aide}>
      <span>{label}</span><span className="flex items-center gap-1">{children}</span>
    </label>
  );
}
function Case({ label, valeur, onChange, aide }: { label: string; valeur: boolean; onChange: (v: boolean) => void; aide?: string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-700 py-0.5 cursor-pointer" title={aide}>
      <input type="checkbox" checked={valeur} onChange={e => onChange(e.target.checked)} /> {label}
    </label>
  );
}
function Pastille({ statut }: { statut: "verifie" | "a_verifier" }) {
  return statut === "verifie"
    ? <span className="text-[9px] px-1 rounded bg-emerald-100 text-emerald-800" title="Valeur retrouvée dans plusieurs sources concordantes">vérifié</span>
    : <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-800" title="Usage courant ou source unique : à confirmer dans le texte de la norme avant chantier">à vérifier</span>;
}

// ─── Props ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TableauReelPanelProps {
  rows: BreakerRow[];
  tableaux: { id: string; nom: string }[];
  tableauId: string;
  onTableau: (id: string) => void;
  source: "plan" | "enregistre";
  onSource: (s: "plan" | "enregistre") => void;
  reglages: ReglagesTableauReel;
  onReglages: (patch: Partial<ReglagesTableauReel>) => void;
  reglagesGaines: ReglagesGaines;
  onReglagesGaines: (patch: Partial<ReglagesGaines>) => void;
  gaines: GainesNiveau | null;
  /** Gaines optimisées de tous les niveaux (schéma technique). */
  gainesNiveaux?: { nom: string; gaines: GainesNiveau }[];
  niveauNom: string;
  synthese: SyntheseGaines | null;
  /** breakerId → id de gaine (gaines optimisées actives), sinon undefined. */
  gaineDeBreaker?: Record<number, string>;
  diametreGaines?: Record<string, number>;
  gainesSupplementairesMm?: number[];
  couleurDe: (breakerId: number) => string;
  breakerSelectionneId: number | null;
  onSelectBreaker: (id: number | null) => void;
  onRecalculerGaines: () => void;
  onFermer: () => void;
  ongletInitial?: Onglet;
  /** Pièces du niveau actif (contours en mètres) pour dessiner le plan des gaines. */
  pieces?: PieceDessin[];
  /** Couleur d'une gaine par identifiant (gaines optimisées) ; gris si inconnue. */
  couleurGaine?: (gaineId: string) => string;
}

function Controles({ liste, onSelect }: { liste: ControleNF[]; onSelect: (id: number | null) => void }) {
  if (liste.length === 0) return <p className="text-xs text-emerald-700">Aucune alerte : le tableau respecte les contrôles implémentés.</p>;
  const ordre = { erreur: 0, avertissement: 1, info: 2 } as const;
  return (
    <ul className="flex flex-col gap-1">
      {[...liste].sort((a, b) => ordre[a.niveau] - ordre[b.niveau]).map(c => (
        <li key={c.id} className={`rounded border px-2 py-1 ${c.niveau === "erreur" ? "border-red-300 bg-red-50" : c.niveau === "avertissement" ? "border-amber-300 bg-amber-50" : "border-ink-200 bg-ink-50"}`}>
          <button className="text-left w-full" onClick={() => onSelect(c.breakerId ?? null)}>
            <span className="text-xs font-semibold text-ink-900">{c.niveau === "erreur" ? "⛔ " : c.niveau === "avertissement" ? "⚠️ " : "ℹ️ "}{c.titre}</span> <Pastille statut={c.statut} />
            <span className="block text-xs text-ink-700">{c.detail}</span>
            <span className="block text-[9.5px] text-ink-400">Source : {c.source}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Pastilles({ couleur }: { couleur: string }) {
  const c = COULEURS_PHASE[couleur] ?? "#a8a29e";
  return couleur === "vert/jaune"
    ? <span className="inline-block w-3 h-3 rounded-full border border-ink-400" style={{ background: "repeating-linear-gradient(45deg,#16a34a 0 3px,#facc15 3px 6px)" }} title={couleur} />
    : <span className="inline-block w-3 h-3 rounded-full border border-ink-400" style={{ background: c }} title={couleur} />;
}


// ─── Mise en page commune ─────────────────────────────────────────────────────────────────────────────────────────
function Carte({ titre, children, className = "", droite }: { titre: string; children: React.ReactNode; className?: string; droite?: React.ReactNode }) {
  return (
    <section className={`flex flex-col min-h-[440px] lg:min-h-0 min-w-0 rounded-xl border border-ink-200 bg-white ${className}`}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-ink-100">
        <h3 className="text-xs font-semibold text-ink-800">{titre}</h3>
        <span className="ml-auto">{droite}</span>
      </div>
      <div className="flex-1 min-h-0 p-2 flex flex-col">{children}</div>
    </section>
  );
}
function Kpi({ label, valeur, sous, ton = "ok", onClick }: { label: string; valeur: string; sous?: string; ton?: "ok" | "warn" | "neutre"; onClick?: () => void }) {
  const cls = ton === "warn" ? "border-amber-300 bg-amber-50" : ton === "ok" ? "border-emerald-200 bg-emerald-50/50" : "border-ink-200 bg-white";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`text-left rounded-lg border px-3 py-1.5 min-w-[120px] ${cls} ${onClick ? "hover:shadow" : ""}`}>
      <div className="text-xs text-ink-500">{label}</div>
      <div className="text-sm font-semibold text-ink-900 leading-tight">{valeur}</div>
      {sous && <div className="text-xs text-ink-500">{sous}</div>}
    </Tag>
  );
}
function Legende({ res, couleurGaine }: { res: ResultatTableauReel; couleurGaine: (id: string) => string }) {
  const gaines = res.gaines.filter(g => g.depart);
  if (gaines.length === 0) return null;
  const optimisees = gaines.some(g => !g.id.startsWith("dep-"));
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1.5 text-xs text-ink-600">
      <span className="font-semibold">{optimisees ? "Gaines (couleur = gaine commune) :" : "Une gaine par circuit :"}</span>
      {optimisees
        ? gaines.map(g => <span key={g.id} className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm border border-ink-400" style={{ background: couleurGaine(g.id) }} />⌀{g.diametreMm} · {g.nbCircuits} circuit(s)</span>)
        : <span>le bandeau coloré de chaque disjoncteur est la couleur de son circuit sur le plan.</span>}
      <span className="ml-auto text-ink-400">Clique un disjoncteur pour le surligner.</span>
    </div>
  );
}

// ─── Panneau plein écran ──────────────────────────────────────────────────────────────────────────────────────────
export default function TableauReelPanel(p: TableauReelPanelProps) {
  const [onglet, setOnglet] = useState<Onglet>(p.ongletInitial ?? "ensemble");
  const [monte, setMonte] = useState(false);
  const zoneImpression = useRef<HTMLDivElement>(null);
  const fermerRef = useRef(p.onFermer);
  fermerRef.current = p.onFermer;
  const params = useMemo(() => fusionnerParamsTableau(p.reglages.params), [p.reglages.params]);
  const res = useMemo(() => calculerTableauReel(p.rows, {
    params, gaineDeBreaker: p.gaineDeBreaker, diametreGaines: p.diametreGaines, gainesSupplementairesMm: p.gainesSupplementairesMm,
  }), [p.rows, params, p.gaineDeBreaker, p.diametreGaines, p.gainesSupplementairesMm]);
  const majParams = (patch: Partial<ParamsTableauReel>) => p.onReglages({ params: { ...p.reglages.params, ...patch } });
  const majGtl = (patch: Partial<ParamsGtl>) => majParams({ gtl: { ...params.gtl, ...patch } });
  const nbAlertes = res.controles.filter(c => c.niveau !== "info").length;
  const couleurGaine = useMemo(() => p.couleurGaine ?? ((id: string) => (id.startsWith("dep-") ? "#a8a29e" : "#64748b")), [p.couleurGaine]);
  // Sans gaines optimisées, le bandeau de chaque disjoncteur reprend la couleur de son circuit sur le plan.
  const couleurBandeau = useMemo(() => {
    const parGaine = new Map<string, number>();
    res.rails.forEach(r => r.departs.forEach(d => { if (d.gaineId.startsWith("dep-")) parGaine.set(d.gaineId, d.breakerId); }));
    return (id: string) => { const b = parGaine.get(id); return b != null ? p.couleurDe(b) : couleurGaine(id); };
  }, [res, p, couleurGaine]);

  useEffect(() => { setMonte(true); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "Escape" && !(t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA"))) fermerRef.current();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const imprimer = () => {
    const el = zoneImpression.current;
    if (!el) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const styles = Array.from(document.querySelectorAll("link[rel=stylesheet],style")).map(n => n.outerHTML).join("");
    w.document.write(`<html><head><title>Tableau réaliste</title>${styles}</head><body style="padding:16px;background:#fff">${el.innerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* impression refusée : la fenêtre reste ouverte */ } }, 500);
  };

  const ratioGtl = ratioElevation(res, params), ratioTab = ratioTableau(res);
  const conflitsGtl = useMemo(() => agencerGtl(res, params).elements.filter(e => e.conflit || e.note), [res, params]);
  const gtlOk = res.gtl.largeurRequiseMm <= res.gtl.largeurRetenueMm && res.gtl.hauteurRequiseMm <= res.gtl.hauteurDisponibleMm;

  const contenu = (
    <div className="fixed inset-0 z-[200] bg-[#f3f2ef] flex flex-col" role="dialog" aria-modal="true" aria-label="Tableau réaliste">
      <header className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 h-12 shrink-0 bg-white border-b border-ink-200 overflow-x-auto">
        <button onClick={p.onFermer} className="btn-ghost !text-xs !px-2 whitespace-nowrap" title="Revenir au plan (Échap)">←<span className="hidden sm:inline"> Retour au plan</span></button>
        <span className="text-sm font-semibold text-ink-900 whitespace-nowrap">⚡<span className="hidden sm:inline"> Tableau réaliste</span></span>
        {p.tableaux.length > 1 && (
          <select value={p.tableauId} onChange={e => p.onTableau(e.target.value)} className="text-xs border border-ink-200 rounded px-1.5 py-1">
            {p.tableaux.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
        )}
        <select value={p.source} onChange={e => p.onSource(e.target.value as "plan" | "enregistre")} className="text-xs border border-ink-200 rounded px-1.5 py-1"
          title="Circuits du plan : le tableau virtuel se met à jour avec le plan. Enregistré : le tableau du module Tableau, tel qu'édité.">
          <option value="plan">Circuits du plan</option><option value="enregistre">Tableau enregistré</option>
        </select>
        <button onClick={() => setOnglet("controles")} className={`text-xs px-2 py-1 rounded-full border whitespace-nowrap ${nbAlertes > 0 ? "border-amber-300 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {nbAlertes > 0 ? `⚠ ${nbAlertes} alerte(s)` : "✓ conforme"}
        </button>
        <span className="ml-auto" />
        <button onClick={imprimer} className="btn-ghost !text-xs" title="Imprimer l'onglet affiché">🖨️<span className="hidden md:inline"> Imprimer</span></button>
        <button onClick={p.onFermer} className="btn-ghost !text-xs" aria-label="Fermer" title="Fermer (Échap)">✕<span className="hidden md:inline"> Fermer</span></button>
      </header>
      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <nav className="shrink-0 md:w-48 flex md:flex-col gap-1 p-2 overflow-x-auto md:overflow-y-auto bg-white border-b md:border-b-0 md:border-r border-ink-200" aria-label="Sections">
          {ONGLETS.map(o => (
            <button key={o.id} onClick={() => setOnglet(o.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap text-left ${onglet === o.id ? "bg-ink-900 text-volt-400 font-semibold" : "text-ink-700 hover:bg-ink-50"}`}>
              <span className="w-4 text-center opacity-80">{o.icone}</span>{o.label}
              {o.id === "controles" && nbAlertes > 0 && <span className="ml-auto text-xs rounded-full bg-amber-200 text-amber-900 px-1.5">{nbAlertes}</span>}
            </button>
          ))}
        </nav>
        <main className="flex-1 min-w-0 min-h-0 p-2 md:p-3 overflow-y-auto lg:overflow-hidden" ref={zoneImpression}>
          {onglet === "ensemble" && (
            <div className="h-full flex flex-col gap-2 min-h-0">
              <div className="flex flex-wrap gap-2 shrink-0">
                <Kpi label="Circuits" valeur={`${res.totaux.circuits}`} sous={`${res.totaux.differentiels} différentiel(s)`} ton="neutre" />
                <Kpi label="Modules" valeur={`${res.totaux.modulesUtilises}/${res.totaux.capacite}`} sous={`réserve ${fmt(res.totaux.reservePct, 0)} % (exigé ${fmt(res.totaux.reserveRequisePct, 0)} %)`} ton={res.totaux.reservePct + 1e-9 >= res.totaux.reserveRequisePct ? "ok" : "warn"} />
                <Kpi label="GTL" valeur={`${res.gtl.largeurRetenueMm} mm`} sous={`besoin ${res.gtl.largeurRequiseMm} mm`} ton={gtlOk ? "ok" : "warn"} onClick={() => setOnglet("gtl")} />
                <Kpi label="Gaines au tableau" valeur={`${res.gtl.nbGaines}`} sous={`${fmt(res.gtl.largeurGainesMm, 0)} mm de passage`} ton="neutre" onClick={() => setOnglet("gaines")} />
                <Kpi label="Alertes NF C 15-100" valeur={nbAlertes > 0 ? `${nbAlertes}` : "aucune"} sous="voir le détail" ton={nbAlertes > 0 ? "warn" : "ok"} onClick={() => setOnglet("controles")} />
              </div>
              <div className="flex-1 min-h-0 grid gap-3 grid-cols-1 lg:grid-cols-[minmax(360px,1fr)_minmax(0,1.6fr)]">
                <Carte titre="GTL vue de face — à l'échelle">
                  <ZoneZoom ratio={ratioGtl} className="flex-1"><GtlElevation res={res} params={params} couleurGaine={couleurBandeau} /></ZoneZoom>
                  {conflitsGtl.length > 0 && <p className={`text-[11px] pt-1 ${conflitsGtl.some(e => e.conflit) ? "text-red-700" : "text-ink-500"}`}>{conflitsGtl.map(e => (e.conflit ? `⚠ ${e.nom} : ${e.conflit}` : `ℹ ${e.nom} : ${e.note}`)).join(" · ")}</p>}
                </Carte>
                <Carte titre="Tableau — rails, différentiels, disjoncteurs, peignes, borniers">
                  <ZoneZoom ratio={ratioTab} className="flex-1"><TableauDetail res={res} params={params} couleurGaine={couleurBandeau} selectionne={p.breakerSelectionneId} onSelect={p.onSelectBreaker} /></ZoneZoom>
                  <Legende res={res} couleurGaine={couleurBandeau} />
                </Carte>
              </div>
            </div>
          )}

          {onglet === "tableau" && (
            <div className="h-full grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
              <Carte titre="Tableau — vue de face, ouvert">
                <ZoneZoom ratio={ratioTab} className="flex-1"><TableauDetail res={res} params={params} couleurGaine={couleurBandeau} selectionne={p.breakerSelectionneId} onSelect={p.onSelectBreaker} /></ZoneZoom>
                <Legende res={res} couleurGaine={couleurBandeau} />
              </Carte>
              <Carte titre="Réglages du tableau" className="overflow-hidden">
                <div className="overflow-y-auto flex flex-col gap-0.5 pr-1">
                  <Champ label="Modules par rail" aide="13, 18 ou 24 selon le coffret"><select value={params.modulesParRail} onChange={e => majParams({ modulesParRail: parseInt(e.target.value, 10) })} className="text-xs border border-ink-200 rounded px-1 py-0.5">{[13, 18, 24].map(n => <option key={n} value={n}>{n}</option>)}{![13, 18, 24].includes(params.modulesParRail) && <option value={params.modulesParRail}>{params.modulesParRail}</option>}</select></Champ>
                  <Champ label="Pas entre rangées (mm)"><Num valeur={params.pasRangeeMm} onChange={v => majParams({ pasRangeeMm: v })} min={50} /></Champ>
                  <Champ label="Surface habitable (m²)" aide="Sert au conseil sur le nombre de rangées"><Num valeur={params.surfaceM2 ?? 0} onChange={v => majParams({ surfaceM2: v > 0 ? v : undefined })} min={0} /></Champ>
                  <Champ label="Manette la plus basse (m)"><Num valeur={params.basManetteM} onChange={v => majParams({ basManetteM: v })} pas={0.05} /></Champ>
                  <Case label="Tableau derrière une porte" valeur={params.porte} onChange={v => majParams({ porte: v })} aide="Manettes 0,50 m mini avec porte, 0,90 m sans" />
                  <Case label="Logement accessible (PMR)" valeur={params.pmr} onChange={v => majParams({ pmr: v })} />
                  <Case label="Logement collectif" valeur={params.collectif} onChange={v => majParams({ collectif: v })} aide="Réserve de 6 modules au lieu de 20 %" />
                  <Case label="Coupure générale" valeur={params.coupureGenerale} onChange={v => majParams({ coupureGenerale: v })} />
                  <Case label="Parafoudre posé" valeur={params.parafoudre} onChange={v => majParams({ parafoudre: v })} />
                  <Case label="Parafoudre exigé (AQ2, paratonnerre…)" valeur={params.parafoudreRequis} onChange={v => majParams({ parafoudreRequis: v })} />
                  <p className="text-xs text-ink-700 mt-2">
                    {res.totaux.circuits} circuit(s) · {res.totaux.differentiels} différentiel(s) · {res.totaux.modulesUtilises}/{res.totaux.capacite} modules · réserve {fmt(res.totaux.reservePct, 0)} % (exigé {fmt(res.totaux.reserveRequisePct, 0)} %)
                    {res.nbRangeesConseille != null && ` · conseil : ${res.nbRangeesConseille} rangées`}
                  </p>
                </div>
              </Carte>
            </div>
          )}

          {onglet === "gtl" && <GtlOnglet res={res} params={params} majGtl={majGtl} majParams={majParams} ratio={ratioGtl} couleurGaine={couleurBandeau} />}

          {onglet === "connexions" && (
            <Carte titre="Liaisons phase / neutre / terre" className="h-full" droite={
              <label className="flex items-center gap-1.5 text-xs text-ink-700">Couleur de la phase
                <select value={params.couleurPhase} onChange={e => majParams({ couleurPhase: e.target.value })} className="text-xs border border-ink-200 rounded px-1 py-0.5">{["rouge", "marron", "noir", "gris"].map(c => <option key={c}>{c}</option>)}</select>
              </label>}>
              <div className="overflow-auto flex-1">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white"><tr className="text-left text-ink-500 border-b border-ink-200"><th className="font-normal py-1">De</th><th className="font-normal">Vers</th><th className="font-normal">Calibre</th><th className="font-normal">Phase / Neutre / Terre (mm²)</th><th className="font-normal">Longueur</th></tr></thead>
                  <tbody>
                    {res.liaisons.map(l => (
                      <tr key={l.id} className={`border-t border-ink-100 ${l.breakerId != null ? "cursor-pointer hover:bg-ink-50" : ""} ${l.breakerId != null && l.breakerId === p.breakerSelectionneId ? "bg-amber-50" : ""}`}
                        onClick={() => l.breakerId != null && p.onSelectBreaker(l.breakerId === p.breakerSelectionneId ? null : l.breakerId)}>
                        <td className="py-1 pr-3">{l.de}</td><td className="pr-3">{l.vers}</td><td className="pr-3">{l.calibreA != null ? `${l.calibreA} A` : "—"}</td>
                        <td><span className="inline-flex items-center gap-2">{l.conducteurs.map(c => <span key={c.role} className="inline-flex items-center gap-1"><Pastilles couleur={c.couleur} />{c.sectionMm2}</span>)}</span></td>
                        <td className="text-ink-500">{l.longueurM != null ? `${l.longueurM} m` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-ink-500 pt-1">Bleu = neutre, vert/jaune = terre. Clique un départ pour le surligner (disjoncteur, plan).</p>
            </Carte>
          )}


          {onglet === "controles" && (
            <Carte titre={`Contrôles NF C 15-100 — ${nbAlertes} alerte(s)`} className="h-full">
              <div className="overflow-y-auto flex-1 max-w-5xl"><Controles liste={res.controles} onSelect={p.onSelectBreaker} /></div>
            </Carte>
          )}

          {onglet === "gaines" && <GainesOnglet {...p} />}

          {onglet === "schema" && (
            <Carte titre="Schéma technique — tous les circuits (gaines optimisées)" className="h-full">
              <div className="overflow-auto flex-1">
                {fusionnerParamsGaines(p.reglagesGaines.params).actif
                  ? <SchemaGaines niveaux={p.gainesNiveaux ?? []} couleurDe={p.couleurDe} breakerSelectionneId={p.breakerSelectionneId} onSelectBreaker={p.onSelectBreaker} />
                  : <p className="text-sm text-ink-600">Le schéma technique décrit les gaines optimisées : active-les dans l&apos;onglet « Gaines ».</p>}
              </div>
            </Carte>
          )}
        </main>
      </div>
    </div>
  );
  return monte ? createPortal(contenu, document.body) : null;
}

// ─── GTL ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function GtlOnglet({ res, params, majGtl, majParams, ratio, couleurGaine }: { res: ResultatTableauReel; params: ParamsTableauReel; majGtl: (p: Partial<ParamsGtl>) => void; majParams: (p: Partial<ParamsTableauReel>) => void; ratio: number; couleurGaine: (id: string) => string }) {
  const g = res.gtl, pg = params.gtl;
  return (
    <div className="h-full grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_440px]">
      <Carte titre="GTL vue de face — à l'échelle (mm)">
        <ZoneZoom ratio={ratio} className="flex-1"><GtlElevation res={res} params={params} couleurGaine={couleurGaine} /></ZoneZoom>
        <p className="text-xs text-ink-500 pt-1">Bande verte : zone de manœuvre 0,90–1,80 m. Zone bleue : passage des {g.nbGaines} gaine(s) (couches décalées). Pointillés : 0,50 · 0,90 · 1,30 · 1,80 m.</p>
      </Carte>
      <Carte titre="Dimensions et réglages" className="overflow-hidden">
        <div className="overflow-y-auto flex flex-col gap-2 pr-1">
          <table className="w-full text-xs">
            <tbody>
              {g.composants.map(c => <tr key={c.nom} className="border-t border-ink-100"><td className="py-1">{c.nom}</td><td className="text-right font-mono">{Math.round(c.largeurMm)} mm</td><td className="text-right font-mono text-ink-400">{c.hauteurMm > 0 ? `${Math.round(c.hauteurMm)} mm` : ""}</td></tr>)}
              <tr className="border-t border-ink-300 font-semibold"><td>Largeur nécessaire</td><td className={`text-right font-mono ${g.largeurRequiseMm > g.largeurRetenueMm ? "text-red-700" : "text-emerald-700"}`}>{g.largeurRequiseMm} mm</td><td /></tr>
              <tr><td>Largeur de la GTL</td><td className="text-right font-mono">{g.largeurRetenueMm} mm</td><td /></tr>
              {g.largeurEtelMm != null && <tr><td>Largeur de l&apos;ETEL (+100 mm)</td><td className="text-right font-mono">{g.largeurEtelMm} mm</td><td /></tr>}
              <tr><td>Hauteur nécessaire / utile</td><td className={`text-right font-mono ${g.hauteurRequiseMm > g.hauteurDisponibleMm ? "text-red-700" : ""}`}>{g.hauteurRequiseMm} / {g.hauteurDisponibleMm} mm</td><td /></tr>
            </tbody>
          </table>
          <div className="grid grid-cols-1 gap-y-0.5">
            <Champ label="Largeur GTL (mm)" aide="60 cm mini"><Num valeur={pg.largeurMm} onChange={v => majGtl({ largeurMm: v })} min={0} largeur="w-20" /></Champ>
            <Champ label="Profondeur (mm)" aide="25 cm mini"><Num valeur={pg.profondeurMm} onChange={v => majGtl({ profondeurMm: v })} min={0} largeur="w-20" /></Champ>
            <Champ label="Hauteur sous plafond (m)"><Num valeur={pg.hauteurSousPlafondM} onChange={v => majGtl({ hauteurSousPlafondM: v })} pas={0.05} min={1} /></Champ>
            <Champ label="Agencement"><select value={pg.agencement} onChange={e => majGtl({ agencement: e.target.value as ParamsGtl["agencement"] })} className="text-xs border border-ink-200 rounded px-1 py-0.5"><option value="empile">Empilé</option><option value="cote_a_cote">Côte à côte</option></select></Champ>
            <Case label="ETEL (largeur GTL + 100 mm)" valeur={pg.etel} onChange={v => majGtl({ etel: v })} />
            <Champ label="Largeur coffret com. (mm)" aide="0 = coffret de communication ailleurs"><Num valeur={pg.largeurCoffretCommMm} onChange={v => majGtl({ largeurCoffretCommMm: v })} min={0} largeur="w-20" /></Champ>
            <Champ label="Haut. coffret com. (mm)"><Num valeur={pg.hauteurCoffretCommMm} onChange={v => majGtl({ hauteurCoffretCommMm: v })} min={0} largeur="w-20" /></Champ>
            <Champ label="Couches de gaines"><Num valeur={pg.couchesGaines} onChange={v => majGtl({ couchesGaines: Math.round(v) })} min={1} max={4} /></Champ>
            <Champ label="Jeu entre éléments (mm)"><Num valeur={pg.jeuMm} onChange={v => majGtl({ jeuMm: v })} min={0} /></Champ>
          </div>
          <Controles liste={res.controles.filter(c => c.id.startsWith("gtl"))} onSelect={() => undefined} />
        </div>
      </Carte>
    </div>
  );
}


// ─── Gaines optimisées ────────────────────────────────────────────────────────────────────────────────────────────
function GainesOnglet(p: TableauReelPanelProps) {
  const params = fusionnerParamsGaines(p.reglagesGaines.params);
  const forcages = fusionnerForcages(p.reglagesGaines.forcages);
  const maj = (patch: Partial<ParamsGainesOptimisees>) => p.onReglagesGaines({ params: { ...p.reglagesGaines.params, ...patch } });
  const majForcages = (f: ForcagesGaines) => p.onReglagesGaines({ forcages: f });
  const prixGaine = p.reglagesGaines.prixGaineEuroM ?? 1.2;
  const prixCable = p.reglagesGaines.prixCableEuroM ?? 0.9;
  const s = p.synthese;
  const cout = (gaineM: number, cableM: number) => gaineM * prixGaine + cableM * prixCable;
  const g = p.gaines;
  const [survol, setSurvol] = useState<string | null>(null);
  const [boiteActive, setBoiteActive] = useState<string | null>(null);
  const peutDessiner = params.actif && !!g && (p.pieces?.length ?? 0) > 0;
  const nbCircuits = g ? g.groupes.reduce((n, x) => n + x.circuits.length, 0) : 0;

  const deplacer = (c: { cle: string }, v: string) => {
    if (!g || !v) return;
    if (v === "__seul") majForcages(deplacerCircuitGaine(forcages, c.cle, null));
    else { const cible = g.groupes.find(x => x.id === v); if (cible) majForcages(deplacerCircuitGaine(forcages, c.cle, cible.circuits[0].cle, cible.circuits.map(x => x.cle))); }
  };

  // Lecture à plat : une ligne « Tableau → gaine → boîte », puis un bloc par boîte qui dit d'où elle reçoit et où elle repart.
  const longueur = (m: number) => (m < 0.05 ? "sur place" : `${fmt(m, 1)} m`);
  const Destination = ({ gr, t }: { gr: GroupeGaines; t: TronconArbre }) => {
    const boite = g?.boites.find(b => b.id === t.boiteVers);
    const circuit = !boite && t.circuits.length === 1 ? gr.circuits.find(c => c.cle === t.circuits[0]) : undefined;
    return (
      <>
        <span className="text-ink-400">→</span>
        {boite && (
          <button onClick={() => setBoiteActive(boiteActive === boite.id ? null : boite.id)}
            className={`rounded border px-1.5 text-xs font-semibold ${boiteActive === boite.id ? "border-amber-400 bg-amber-100" : "border-ink-300 bg-white"}`}
            title="Boîte de dérivation : la gaine se sépare ici">▣ {boite.nom}</button>
        )}
        {circuit && (
          <span className={`inline-flex items-center gap-1 rounded border px-1.5 text-xs ${circuit.breakerId === p.breakerSelectionneId ? "border-amber-400 bg-amber-50" : "border-ink-200"}`}>
            <button onClick={() => p.onSelectBreaker(circuit.breakerId === p.breakerSelectionneId ? null : circuit.breakerId)} className="hover:underline">{circuit.label}</button>
            <select value="" title="Déplacer ce circuit dans une autre gaine" onChange={e => deplacer(circuit, e.target.value)} className="w-4 text-[11px] border-0 bg-transparent cursor-pointer">
              <option value="">⇄</option>
              {!gr.seul && <option value="__seul">Gaine individuelle</option>}
              {g?.groupes.filter(x => x.id !== gr.id && x.courantFaible === gr.courantFaible).map(x => <option key={x.id} value={x.id}>→ {x.nom}</option>)}
            </select>
          </span>
        )}
      </>
    );
  };
  const Ligne = ({ gr, t }: { gr: GroupeGaines; t: TronconArbre }) => (
    <div className="flex flex-wrap items-center gap-1.5 py-0.5">
      <span className="text-[11px] text-ink-600">{t.gaine} · {longueur(t.longueurM)}</span>
      <Destination gr={gr} t={t} />
    </div>
  );

  return (
    <div className="h-full grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_480px]">
      <Carte titre={`Plan du niveau « ${p.niveauNom} »`}>
        {peutDessiner && g ? (
          <>
            <ZoneZoom ratio={1.4} className="flex-1"><GainesPlan pieces={p.pieces ?? []} origine={g.origine} groupes={g.groupes} boites={g.boites} selectionBreakerId={p.breakerSelectionneId} groupeSurvole={survol} boiteActive={boiteActive} onSurvol={setSurvol} onSelectBreaker={p.onSelectBreaker} onBoite={setBoiteActive} /></ZoneZoom>
            <p className="text-xs text-ink-500 pt-1">⚡ Tableau · une couleur par gaine (tireté vert = courants faibles) · <b>B</b> = boîte de dérivation (là où une gaine se sépare). Survole une gaine ou clique une boîte pour l&apos;isoler.</p>
          </>
        ) : (
          <div className="flex-1 grid place-items-center text-sm text-ink-500 text-center px-6">
            {!params.actif ? "Active « Gaines optimisées » à droite pour regrouper les circuits dans des gaines communes." : "Rien à dessiner sur ce niveau (place le tableau ou le point d'arrivée des gaines, et génère les circuits)."}
          </div>
        )}
      </Carte>
      <Carte titre="Gaines optimisées" className="overflow-hidden">
        <div className="overflow-y-auto flex flex-col gap-3 pr-1">
          <div className="flex items-center gap-3 flex-wrap">
            <Case label="Activer les gaines optimisées" valeur={params.actif} onChange={v => maj({ actif: v })} aide="Désactivé : une gaine par circuit depuis le tableau, comme avant" />
            <Case label="Afficher sur le plan" valeur={p.reglagesGaines.calque ?? true} onChange={v => p.onReglagesGaines({ calque: v })} />
            <button className="btn-ghost !text-xs" onClick={p.onRecalculerGaines} disabled={!params.actif}>↻ Recalculer</button>
            <button className="btn-ghost !text-xs" onClick={() => majForcages(FORCAGES_VIDES)} disabled={forcages.departsSeuls.length + forcages.ensembles.length === 0}>Libérer tout</button>
          </div>

          {s && params.actif && g && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2 text-xs text-ink-800">
              <b>{s.departsAvant} départs → {s.departsApres} gaines</b> au tableau (tous niveaux), <b>{s.boites} boîte{s.boites > 1 ? "s" : ""} de dérivation</b> au total.<br />
              Gaine {fmt(s.gaineApresM - s.gaineAvantM, 0)} m · câble {s.cableApresM - s.cableAvantM >= 0 ? "+" : ""}{fmt(s.cableApresM - s.cableAvantM, 0)} m · environ <b>{fmt(cout(s.gaineApresM, s.cableApresM) - cout(s.gaineAvantM, s.cableAvantM), 0)} € HT</b> (boîtes non comptées ici : elles apparaissent au pré-devis).
            </div>
          )}
          {s && s.montees.length > 0 && <p className="text-xs text-ink-500">Montées vers les autres niveaux (inchangées) : {s.montees.map(m => `${m.nbGaines > 1 ? `${m.nbGaines} × ` : ""}${m.gaine} → ${m.niveau}`).join(" · ")}.</p>}
          {!params.actif && <p className="text-xs text-ink-600">Option désactivée : active-la pour regrouper les circuits qui partent dans la même direction (niveau « {p.niveauNom} »).</p>}
          {params.actif && !g && <p className="text-xs text-ink-600">Aucun circuit à regrouper sur le niveau « {p.niveauNom} » (tableau ou point d&apos;arrivée des gaines à placer, circuits à générer).</p>}

          {params.actif && g && (
            <>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-ink-700">Chemin de chaque gaine — {g.groupes.length} gaine(s) pour {nbCircuits} circuit(s)</p>
                {g.avertissements.map((w, i) => <p key={i} className="text-xs text-amber-700">⚠️ {w}</p>)}
                {g.ignores.length > 0 && <p className="text-xs text-ink-500">Non raccordés (ignorés) : {g.ignores.join(", ")}.</p>}
                {g.groupes.map((gr, gi) => {
                  const coul = couleurGroupe(gi, gr.courantFaible);
                  const fige = forcages.ensembles.some(e => e.length > 1 && gr.circuits.every(c => e.includes(c.cle)));
                  return (
                    <div key={gr.id} onMouseEnter={() => setSurvol(gr.id)} onMouseLeave={() => setSurvol(null)} className={`rounded-lg border p-2 ${survol === gr.id ? "border-ink-500 bg-ink-50" : "border-ink-200"}`}>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="inline-block w-3 h-3 rounded-sm" style={{ background: coul }} />
                        <b>{gr.nom}</b><span className="text-ink-600">{gr.circuits.length} circuit{gr.circuits.length > 1 ? "s" : ""} · remplissage {gr.tronc.tauxPct} % · {fmt(gr.longueurM, 1)} m de gaine</span>
                        {gr.circuits.length > 1 && !fige && <button className="ml-auto text-[11px] underline" title="Garde ces circuits ensemble lors des prochains recalculs" onClick={() => majForcages({ ...forcages, ensembles: [...forcages.ensembles, gr.circuits.map(c => c.cle)] })}>🔒 Figer</button>}
                        {fige && <span className="ml-auto text-[11px] text-ink-500">🔒 figée</span>}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        <span className="rounded bg-ink-900 px-1.5 text-xs font-semibold text-volt-400">⚡ Tableau</span>
                        <Ligne gr={gr} t={gr.tronc} />
                      </div>
                      {g.boites.filter(b => b.groupeId === gr.id).map(b => (
                        <div key={b.id} className={`mt-1.5 ml-3 border-l-2 pl-2 ${boiteActive === b.id ? "border-amber-400" : "border-ink-200"}`} style={{ borderLeftColor: boiteActive === b.id ? undefined : coul }}>
                          <div className="text-xs"><b>▣ {b.nom}</b> <span className="text-ink-500">reçoit {b.entrant.gaine} ({b.circuits.length} circuits), repart vers :</span></div>
                          {b.sorties.map(so => { const t = gr.troncons.find(x => x.id === so.tronconId); return t ? <Ligne key={so.tronconId} gr={gr} t={t} /> : null; })}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              <div>
                <p className="text-xs font-semibold text-ink-700 mb-1">Boîtes de dérivation à poser — {g.boites.length}</p>
                {g.boites.length === 0
                  ? <p className="text-xs text-ink-500">Aucune : chaque gaine va directement à son circuit.</p>
                  : (
                    <table className="w-full text-xs border border-ink-200">
                      <thead className="bg-ink-50 text-ink-500"><tr><th className="text-left px-2 font-normal">Boîte</th><th className="text-left font-normal">Arrive</th><th className="text-left font-normal">Repart</th><th className="text-right px-2 font-normal">Circuits</th></tr></thead>
                      <tbody>
                        {g.boites.map(b => (
                          <tr key={b.id} onClick={() => setBoiteActive(boiteActive === b.id ? null : b.id)} className={`border-t border-ink-100 cursor-pointer hover:bg-ink-50 ${boiteActive === b.id ? "bg-amber-50" : ""}`}>
                            <td className="px-2 py-1 font-semibold">▣ {b.nom}</td><td>{b.entrant.gaine}</td><td>{b.sorties.map(x => x.gaine.replace(/ verte.*/, "")).join(" + ")}</td><td className="text-right px-2">{b.circuits.length}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                <p className="text-[11px] text-ink-400 mt-1">Ces boîtes sont comptées au pré-devis (ligne « Boîte de dérivation ») et dessinées en 3D.</p>
              </div>
            </>
          )}

          <details className="rounded-lg border border-ink-200 p-2">
            <summary className="cursor-pointer text-xs font-semibold text-ink-700">Réglages avancés</summary>
            <div className="grid grid-cols-1 gap-y-0.5 mt-1">
              <Champ label="Circuits maxi par gaine" aide="Avertissement au-delà, jamais un blocage"><Num valeur={params.maxCircuitsParGaine} onChange={v => maj({ maxCircuitsParGaine: Math.round(v) })} min={1} /></Champ>
              <Champ label="Remplissage maxi (%)" aide="33 % : règle des conduits"><Num valeur={params.tauxMaxPct} onChange={v => maj({ tauxMaxPct: v })} min={5} max={100} /></Champ>
              <Champ label="Pénalité par départ (m)" aide="Plus elle est haute, plus on regroupe"><Num valeur={params.penaliteDepartM} onChange={v => maj({ penaliteDepartM: v })} pas={0.5} min={0} /></Champ>
              <Case label="Plaque, IRVE, chauffe-eau, ≥ 32 A : gaine à part" valeur={params.grandsCircuitsSeuls} onChange={v => maj({ grandsCircuitsSeuls: v })} />
              <Case label="Pose apparente (IRL)" valeur={params.poseApparente} onChange={v => maj({ poseApparente: v })} />
              <Champ label="Prix gaine (€/m)"><Num valeur={prixGaine} onChange={v => p.onReglagesGaines({ prixGaineEuroM: v })} pas={0.1} min={0} /></Champ>
              <Champ label="Prix câble (€/m)"><Num valeur={prixCable} onChange={v => p.onReglagesGaines({ prixCableEuroM: v })} pas={0.1} min={0} /></Champ>
            </div>
            <p className="text-[11px] text-ink-400 mt-1">Longueurs à vol d&apos;oiseau depuis le tableau ; le câble suit le tronc puis sa branche. Estimation indicative, hors montées verticales.</p>
          </details>
        </div>
      </Carte>
    </div>
  );
}
