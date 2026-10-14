"use client";
// src/components/plan/TableauReelPanel.tsx
//
// PANNEAU « TABLEAU RÉALISTE » du module Plan : le tableau tel qu'on l'aurait devant soi (rails, modules, différentiels, réserve), la GTL et
// ses composants, la liaison disjoncteur d'abonné → tableau (section + abaque de chute de tension), les connexions phase / neutre / terre,
// les contrôles NF C 15-100 (alertes, jamais bloquantes) et les gaines optimisées au départ du tableau. Tous les paramètres sont modifiables ;
// les calculs viennent de lib/tableau-reel.ts, lib/raccordement-agcp.ts et lib/gaines-optimisees.ts (fonctions pures, testées).
import { useEffect, useMemo, useRef, useState } from "react";
import type { BreakerRow } from "@/lib/electrical-constants";
import { calculerTableauReel, fusionnerParamsTableau, type ControleNF, type ParamsGtl, type ParamsTableauReel, type ResultatTableauReel } from "@/lib/tableau-reel";
import { PARAMS_RACCORDEMENT_DEFAUT, SECTIONS_ABAQUE, LONGUEURS_ABAQUE, type ParamsRaccordement } from "@/lib/raccordement-agcp";
import { CALIBRES_AGCP } from "@/lib/normes-nfc";
import { couleurGroupe, deplacerCircuitGaine, fusionnerForcages, fusionnerParamsGaines, FORCAGES_VIDES, type ForcagesGaines, type ParamsGainesOptimisees } from "@/lib/gaines-optimisees";
import type { GainesNiveau, SyntheseGaines } from "@/lib/gaines-optimisees-plan";
import type { ReglagesGaines, ReglagesTableauReel } from "@/lib/maison-types";

export type Onglet = "tableau" | "connexions" | "gtl" | "raccordement" | "controles" | "gaines";
const ONGLETS: { id: Onglet; label: string }[] = [
  { id: "tableau", label: "Tableau" }, { id: "connexions", label: "Connexions" }, { id: "gtl", label: "GTL" },
  { id: "raccordement", label: "Raccordement" }, { id: "controles", label: "Contrôles NF" }, { id: "gaines", label: "Gaines" },
];

const COULEUR_ID: Record<string, string> = { AC: "#64748b", A: "#2563eb", F: "#7c3aed" };
const COULEURS_PHASE: Record<string, string> = { rouge: "#dc2626", marron: "#92400e", noir: "#1c1917", gris: "#94a3b8", bleu: "#2563eb", "vert/jaune": "#16a34a" };
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
      className={`${largeur} rounded border border-ink-200 px-1.5 py-0.5 text-[11px] text-right font-mono`} />
  );
}
function Champ({ label, children, aide }: { label: string; children: React.ReactNode; aide?: string }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-ink-700 py-0.5" title={aide}>
      <span>{label}</span><span className="flex items-center gap-1">{children}</span>
    </label>
  );
}
function Case({ label, valeur, onChange, aide }: { label: string; valeur: boolean; onChange: (v: boolean) => void; aide?: string }) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-ink-700 py-0.5 cursor-pointer" title={aide}>
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
}

// ─── Tableau (SVG) ────────────────────────────────────────────────────────────────────────────────────────────────
const MOD = 15;           // px par module de 17,5 mm
const RANGEE_H = 74;
function TableauSvg({ res, couleurDe, selectionne, onSelect }: { res: ResultatTableauReel; couleurDe: (id: number) => string; selectionne: number | null; onSelect: (id: number | null) => void }) {
  const nbMod = res.coffret.modulesParRail;
  const W = nbMod * MOD + 80, H = res.rails.length * RANGEE_H + 20;
  return (
    <svg viewBox={`0 0 ${W + 70} ${H}`} className="w-full max-w-[640px]" role="img" aria-label="Tableau électrique">
      <rect x={4} y={4} width={nbMod * MOD + 36} height={H - 8} rx={5} fill="#f5f5f4" stroke="#78716c" strokeWidth={1.5} />
      {res.rails.map((r, ri) => {
        const y = 14 + ri * RANGEE_H;
        const x0 = 22;
        return (
          <g key={r.rangeeId}>
            <rect x={x0 - 4} y={y + 30} width={nbMod * MOD + 8} height={4} fill="#a8a29e" />
            {/* modules libres */}
            {Array.from({ length: Math.max(0, r.capaciteModules - r.modulesUtilises) }).map((_, i) => (
              <rect key={i} x={x0 + (r.modulesUtilises + i) * MOD + 1} y={y + 6} width={MOD - 2} height={58} rx={2} fill="none" stroke="#a8a29e" strokeDasharray="3 3" />
            ))}
            {/* différentiel */}
            {r.calibreId != null && (
              <g onClick={() => onSelect(null)} style={{ cursor: "default" }}>
                <title>{`Différentiel ${r.calibreId} A 30 mA type ${r.diffType} — ${r.nbCircuits} circuit(s)`}</title>
                <rect x={x0 + 1} y={y + 4} width={r.modulesId * MOD - 2} height={62} rx={3} fill={COULEUR_ID[r.diffType] ?? "#64748b"} stroke="#1c1917" />
                <text x={x0 + (r.modulesId * MOD) / 2} y={y + 22} textAnchor="middle" fontSize={8} fontWeight={700} fill="#fff">ID</text>
                <text x={x0 + (r.modulesId * MOD) / 2} y={y + 33} textAnchor="middle" fontSize={8} fill="#fff">{r.calibreId}A</text>
                <text x={x0 + (r.modulesId * MOD) / 2} y={y + 44} textAnchor="middle" fontSize={7} fill="#fff">30mA</text>
                <text x={x0 + (r.modulesId * MOD) / 2} y={y + 55} textAnchor="middle" fontSize={8} fontWeight={700} fill="#fff">{r.diffType}</text>
              </g>
            )}
            {r.departs.map(d => {
              const x = x0 + d.positionModule * MOD;
              const sel = d.breakerId === selectionne;
              const coul = couleurDe(d.breakerId);
              return (
                <g key={`${d.breakerId}-${d.positionModule}`} onClick={() => onSelect(d.accessoire ? null : (sel ? null : d.breakerId))} style={{ cursor: d.accessoire ? "default" : "pointer" }}>
                  <title>{`${d.label} — ${d.amperes} A · ${d.sectionMm2} mm²${d.accessoire ? "" : ` · gaine ${d.gaineId}`}`}</title>
                  <rect x={x + 1} y={y + 4} width={d.modules * MOD - 2} height={62} rx={3} fill="#fafaf9" stroke={sel ? "#f59e0b" : "#1c1917"} strokeWidth={sel ? 2.5 : 1} />
                  <rect x={x + 1} y={y + 4} width={d.modules * MOD - 2} height={9} rx={3} fill={coul} />
                  <rect x={x + 4} y={y + 18} width={d.modules * MOD - 8} height={12} rx={2} fill="#1c1917" />
                  <text x={x + (d.modules * MOD) / 2} y={y + 27} textAnchor="middle" fontSize={7} fontWeight={700} fill="#fbbf24">{d.amperes || ""}</text>
                  <text transform={`translate(${x + (d.modules * MOD) / 2 + 3}, ${y + 62}) rotate(-90)`} fontSize={7.5} fill="#1c1917">{d.label.length > 13 ? d.label.slice(0, 12) + "…" : d.label}</text>
                </g>
              );
            })}
            <text x={nbMod * MOD + 30} y={y + 24} fontSize={8} fill="#44403c">{r.nom}</text>
            <text x={nbMod * MOD + 30} y={y + 36} fontSize={7.5} fill="#78716c">manettes {fmt(r.hauteurManetteM, 2)} m</text>
            <text x={nbMod * MOD + 30} y={y + 48} fontSize={7.5} fill={r.depassement ? "#dc2626" : "#78716c"}>{r.modulesUtilises}/{r.capaciteModules} mod.</text>
          </g>
        );
      })}
    </svg>
  );
}

function Controles({ liste, onSelect }: { liste: ControleNF[]; onSelect: (id: number | null) => void }) {
  if (liste.length === 0) return <p className="text-[11px] text-emerald-700">Aucune alerte : le tableau respecte les contrôles implémentés.</p>;
  const ordre = { erreur: 0, avertissement: 1, info: 2 } as const;
  return (
    <ul className="flex flex-col gap-1">
      {[...liste].sort((a, b) => ordre[a.niveau] - ordre[b.niveau]).map(c => (
        <li key={c.id} className={`rounded border px-2 py-1 ${c.niveau === "erreur" ? "border-red-300 bg-red-50" : c.niveau === "avertissement" ? "border-amber-300 bg-amber-50" : "border-ink-200 bg-ink-50"}`}>
          <button className="text-left w-full" onClick={() => onSelect(c.breakerId ?? null)}>
            <span className="text-[11px] font-semibold text-ink-900">{c.niveau === "erreur" ? "⛔ " : c.niveau === "avertissement" ? "⚠️ " : "ℹ️ "}{c.titre}</span> <Pastille statut={c.statut} />
            <span className="block text-[10.5px] text-ink-700">{c.detail}</span>
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

// ─── Panneau ──────────────────────────────────────────────────────────────────────────────────────────────────────
export default function TableauReelPanel(p: TableauReelPanelProps) {
  const [onglet, setOnglet] = useState<Onglet>(p.ongletInitial ?? "tableau");
  const [coteDroit, setCoteDroit] = useState(false);
  const zoneImpression = useRef<HTMLDivElement>(null);
  const params = useMemo(() => fusionnerParamsTableau(p.reglages.params), [p.reglages.params]);
  const rac = useMemo<ParamsRaccordement>(() => ({ ...PARAMS_RACCORDEMENT_DEFAUT, ...(p.reglages.raccordement ?? {}) }), [p.reglages.raccordement]);
  const res = useMemo(() => calculerTableauReel(p.rows, {
    params, raccordement: rac, gaineDeBreaker: p.gaineDeBreaker, diametreGaines: p.diametreGaines, gainesSupplementairesMm: p.gainesSupplementairesMm,
  }), [p.rows, params, rac, p.gaineDeBreaker, p.diametreGaines, p.gainesSupplementairesMm]);
  const majParams = (patch: Partial<ParamsTableauReel>) => p.onReglages({ params: { ...p.reglages.params, ...patch } });
  const majGtl = (patch: Partial<ParamsGtl>) => majParams({ gtl: { ...params.gtl, ...patch } });
  const majRac = (patch: Partial<ParamsRaccordement>) => p.onReglages({ raccordement: { ...p.reglages.raccordement, ...patch } });
  const nbAlertes = res.controles.filter(c => c.niveau !== "info").length;

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

  return (
    <div className={`absolute z-[60] top-2 ${coteDroit ? "right-2" : "left-2"} bottom-2 w-[min(760px,96%)] card flex flex-col shadow-xl border border-ink-300 bg-white overflow-hidden`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-200">
        <span className="text-sm font-semibold text-ink-900">⚡ Tableau réaliste</span>
        {p.tableaux.length > 1 && (
          <select value={p.tableauId} onChange={e => p.onTableau(e.target.value)} className="text-[11px] border border-ink-200 rounded px-1 py-0.5">
            {p.tableaux.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
        )}
        <select value={p.source} onChange={e => p.onSource(e.target.value as "plan" | "enregistre")} className="text-[11px] border border-ink-200 rounded px-1 py-0.5"
          title="Circuits du plan : le tableau virtuel se met à jour avec le plan. Enregistré : le tableau du module Tableau, tel qu'édité.">
          <option value="plan">Circuits du plan</option><option value="enregistre">Tableau enregistré</option>
        </select>
        <span className={`text-[11px] ${nbAlertes > 0 ? "text-amber-700" : "text-emerald-700"}`}>{nbAlertes > 0 ? `${nbAlertes} alerte(s)` : "✓ conforme"}</span>
        <button onClick={() => setCoteDroit(c => !c)} className="btn-ghost !text-[11px] ml-auto" title="Placer le panneau de l'autre côté du plan">↔</button>
        <button onClick={imprimer} className="btn-ghost !text-[11px]" title="Imprimer l'onglet affiché">🖨️</button>
        <button onClick={p.onFermer} className="btn-ghost !text-[11px]" aria-label="Fermer">✕</button>
      </div>
      <div className="flex gap-0.5 px-2 pt-1 border-b border-ink-200 overflow-x-auto">
        {ONGLETS.map(o => (
          <button key={o.id} onClick={() => setOnglet(o.id)}
            className={`px-2.5 py-1 text-[11px] rounded-t-md whitespace-nowrap ${onglet === o.id ? "bg-ink-900 text-volt-400 font-semibold" : "text-ink-600 hover:bg-ink-50"}`}>
            {o.label}{o.id === "controles" && nbAlertes > 0 ? ` (${nbAlertes})` : ""}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3" ref={zoneImpression}>
        {onglet === "tableau" && (
          <div className="flex flex-col gap-3">
            {res.rails.length === 0 ? <p className="text-[11px] text-ink-500">Aucun circuit : génère les circuits du plan pour voir le tableau.</p> : (
              <TableauSvg res={res} couleurDe={p.couleurDe} selectionne={p.breakerSelectionneId} onSelect={p.onSelectBreaker} />
            )}
            <p className="text-[10.5px] text-ink-500">Clique un disjoncteur pour surligner son circuit sur le plan. Pointillés = modules libres (réserve).</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0">
              <Champ label="Modules par rail" aide="13, 18 ou 24 selon le coffret"><select value={params.modulesParRail} onChange={e => majParams({ modulesParRail: parseInt(e.target.value, 10) })} className="text-[11px] border border-ink-200 rounded px-1 py-0.5">{[13, 18, 24].map(n => <option key={n} value={n}>{n}</option>)}{![13, 18, 24].includes(params.modulesParRail) && <option value={params.modulesParRail}>{params.modulesParRail}</option>}</select></Champ>
              <Champ label="Pas entre rangées (mm)"><Num valeur={params.pasRangeeMm} onChange={v => majParams({ pasRangeeMm: v })} min={50} /></Champ>
              <Champ label="Surface habitable (m²)" aide="Sert au conseil sur le nombre de rangées"><Num valeur={params.surfaceM2 ?? 0} onChange={v => majParams({ surfaceM2: v > 0 ? v : undefined })} min={0} /></Champ>
              <Champ label="Manette la plus basse (m)"><Num valeur={params.basManetteM} onChange={v => majParams({ basManetteM: v })} pas={0.05} /></Champ>
              <Case label="Tableau derrière une porte" valeur={params.porte} onChange={v => majParams({ porte: v })} aide="Manettes 0,50 m mini avec porte, 0,90 m sans" />
              <Case label="Logement accessible (PMR)" valeur={params.pmr} onChange={v => majParams({ pmr: v })} />
              <Case label="Logement collectif" valeur={params.collectif} onChange={v => majParams({ collectif: v })} aide="Réserve de 6 modules au lieu de 20 %" />
              <Case label="Coupure générale" valeur={params.coupureGenerale} onChange={v => majParams({ coupureGenerale: v })} />
              <Case label="Parafoudre posé" valeur={params.parafoudre} onChange={v => majParams({ parafoudre: v })} />
              <Case label="Parafoudre exigé (AQ2, paratonnerre…)" valeur={params.parafoudreRequis} onChange={v => majParams({ parafoudreRequis: v })} />
            </div>
            <p className="text-[11px] text-ink-700">
              {res.totaux.circuits} circuit(s) · {res.totaux.differentiels} différentiel(s) · {res.totaux.modulesUtilises}/{res.totaux.capacite} modules · réserve {fmt(res.totaux.reservePct, 0)} % (exigé {fmt(res.totaux.reserveRequisePct, 0)} %)
              {res.nbRangeesConseille != null && ` · conseil : ${res.nbRangeesConseille} rangées`}
            </p>
          </div>
        )}

        {onglet === "connexions" && (
          <div className="flex flex-col gap-2">
            <Champ label="Couleur de la phase"><select value={params.couleurPhase} onChange={e => majParams({ couleurPhase: e.target.value })} className="text-[11px] border border-ink-200 rounded px-1 py-0.5">{["rouge", "marron", "noir", "gris"].map(c => <option key={c}>{c}</option>)}</select></Champ>
            <table className="w-full text-[11px]">
              <thead><tr className="text-left text-ink-500"><th className="font-normal">De</th><th className="font-normal">Vers</th><th className="font-normal">Calibre</th><th className="font-normal">Phase / Neutre / Terre</th></tr></thead>
              <tbody>
                {res.liaisons.map(l => (
                  <tr key={l.id} className={`border-t border-ink-100 ${l.breakerId != null ? "cursor-pointer hover:bg-ink-50" : ""} ${l.breakerId != null && l.breakerId === p.breakerSelectionneId ? "bg-amber-50" : ""}`}
                    onClick={() => l.breakerId != null && p.onSelectBreaker(l.breakerId === p.breakerSelectionneId ? null : l.breakerId)}>
                    <td className="py-0.5 pr-2">{l.de}</td><td className="pr-2">{l.vers}</td><td className="pr-2">{l.calibreA != null ? `${l.calibreA} A` : "—"}</td>
                    <td><span className="inline-flex items-center gap-1.5">{l.conducteurs.map(c => <span key={c.role} className="inline-flex items-center gap-0.5"><Pastilles couleur={c.couleur} />{c.sectionMm2}</span>)}</span>{l.longueurM != null ? <span className="text-ink-400"> · {l.longueurM} m</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10.5px] text-ink-500">Sections en mm². Bleu = neutre, vert/jaune = terre. Clique un départ pour surligner son circuit sur le plan.</p>
          </div>
        )}

        {onglet === "gtl" && <GtlOnglet res={res} params={params} majGtl={majGtl} majParams={majParams} />}

        {onglet === "raccordement" && <RaccordementOnglet res={res} rac={rac} majRac={majRac} />}

        {onglet === "controles" && <Controles liste={res.controles} onSelect={p.onSelectBreaker} />}

        {onglet === "gaines" && <GainesOnglet {...p} />}
      </div>
    </div>
  );
}

// ─── GTL ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function GtlOnglet({ res, params, majGtl, majParams }: { res: ResultatTableauReel; params: ParamsTableauReel; majGtl: (p: Partial<ParamsGtl>) => void; majParams: (p: Partial<ParamsTableauReel>) => void }) {
  const g = res.gtl, pg = params.gtl;
  const hMm = Math.max(1800, pg.hauteurSousPlafondM * 1000);
  const k = 0.17;
  const W = Math.max(g.largeurRetenueMm, g.largeurRequiseMm) * k, H = hMm * k;
  const cof = res.coffret;
  const manetteBas = params.basManetteM * 1000;
  const yDe = (hauteurMm: number) => H - hauteurMm * k;
  const coffretBas = Math.max(0, manetteBas - 60), coffretHaut = coffretBas + cof.hauteurMm;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-4 flex-wrap">
        <svg width={W + 80} height={H + 10} viewBox={`-4 -4 ${W + 84} ${H + 14}`} role="img" aria-label="Gaine technique du logement">
          <rect x={0} y={0} width={g.largeurRetenueMm * k} height={H} fill="#fafaf9" stroke="#1c1917" strokeWidth={2} />
          {g.largeurRequiseMm > g.largeurRetenueMm && <rect x={g.largeurRetenueMm * k} y={0} width={(g.largeurRequiseMm - g.largeurRetenueMm) * k} height={H} fill="#fee2e2" stroke="#dc2626" strokeDasharray="4 3" />}
          {g.largeurEtelMm != null && <rect x={-4} y={-4} width={g.largeurEtelMm * k + 8} height={H + 8} fill="none" stroke="#2563eb" strokeDasharray="6 3" />}
          {/* passage des gaines (à droite) */}
          <rect x={(g.largeurRetenueMm - g.largeurGainesMm) * k} y={0} width={g.largeurGainesMm * k} height={H} fill="#dbeafe" opacity={0.7} />
          {/* coffret */}
          <rect x={6} y={yDe(coffretHaut)} width={cof.largeurMm * k} height={cof.hauteurMm * k} fill="#e7e5e4" stroke="#1c1917" />
          <text x={8} y={yDe(coffretHaut) + 10} fontSize={7}>Tableau</text>
          {pg.largeurAgcpMm > 0 && <><rect x={6} y={yDe(params.hauteurAgcpM * 1000 + pg.hauteurAgcpMm / 2)} width={pg.largeurAgcpMm * k} height={pg.hauteurAgcpMm * k} fill="#fde68a" stroke="#1c1917" /><text x={8} y={yDe(params.hauteurAgcpM * 1000 + pg.hauteurAgcpMm / 2) + 9} fontSize={6.5}>AGCP</text></>}
          {pg.largeurCoffretCommMm > 0 && <><rect x={6} y={yDe(Math.max(pg.hauteurCoffretCommMm + 100, coffretBas - 30))} width={pg.largeurCoffretCommMm * k} height={pg.hauteurCoffretCommMm * k} fill="#bbf7d0" stroke="#1c1917" /><text x={8} y={yDe(Math.max(pg.hauteurCoffretCommMm + 100, coffretBas - 30)) + 9} fontSize={6.5}>Com.</text></>}
          {/* repères de hauteur */}
          {[0.9, 1.3, 1.8].map(h => <g key={h}><line x1={0} x2={W + 6} y1={yDe(h * 1000)} y2={yDe(h * 1000)} stroke="#a8a29e" strokeDasharray="2 3" /><text x={W + 8} y={yDe(h * 1000) + 3} fontSize={7} fill="#78716c">{fmt(h, 2)} m</text></g>)}
        </svg>
        <div className="flex-1 min-w-[230px]">
          <table className="w-full text-[11px]">
            <tbody>
              {g.composants.map(c => <tr key={c.nom} className="border-t border-ink-100"><td className="py-0.5">{c.nom}</td><td className="text-right font-mono">{Math.round(c.largeurMm)} mm</td><td className="text-right font-mono text-ink-400">{c.hauteurMm > 0 ? `${Math.round(c.hauteurMm)} mm` : ""}</td></tr>)}
              <tr className="border-t border-ink-300 font-semibold"><td>Largeur nécessaire</td><td className={`text-right font-mono ${g.largeurRequiseMm > g.largeurRetenueMm ? "text-red-700" : "text-emerald-700"}`}>{g.largeurRequiseMm} mm</td><td /></tr>
              <tr><td>Largeur de la GTL</td><td className="text-right font-mono">{g.largeurRetenueMm} mm</td><td /></tr>
              {g.largeurEtelMm != null && <tr><td>Largeur de l&apos;ETEL (+100 mm)</td><td className="text-right font-mono">{g.largeurEtelMm} mm</td><td /></tr>}
              <tr><td>Hauteur nécessaire / utile</td><td className={`text-right font-mono ${g.hauteurRequiseMm > g.hauteurDisponibleMm ? "text-red-700" : ""}`}>{g.hauteurRequiseMm} / {g.hauteurDisponibleMm} mm</td><td /></tr>
            </tbody>
          </table>
          <p className="text-[10px] text-ink-400 mt-1">Zone bleue : passage des {g.nbGaines} gaine(s). Pointillés gris : 0,90 · 1,30 · 1,80 m.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6">
        <Champ label="Largeur GTL (mm)" aide="60 cm mini"><Num valeur={pg.largeurMm} onChange={v => majGtl({ largeurMm: v })} min={0} largeur="w-20" /></Champ>
        <Champ label="Profondeur (mm)" aide="25 cm mini"><Num valeur={pg.profondeurMm} onChange={v => majGtl({ profondeurMm: v })} min={0} largeur="w-20" /></Champ>
        <Champ label="Hauteur sous plafond (m)"><Num valeur={pg.hauteurSousPlafondM} onChange={v => majGtl({ hauteurSousPlafondM: v })} pas={0.05} min={1} /></Champ>
        <Champ label="Disjoncteur d'abonné à (m)" aide="0,90 à 1,80 m"><Num valeur={params.hauteurAgcpM} onChange={v => majParams({ hauteurAgcpM: v })} pas={0.05} /></Champ>
        <Champ label="Agencement"><select value={pg.agencement} onChange={e => majGtl({ agencement: e.target.value as ParamsGtl["agencement"] })} className="text-[11px] border border-ink-200 rounded px-1 py-0.5"><option value="empile">Empilé</option><option value="cote_a_cote">Côte à côte</option></select></Champ>
        <Case label="ETEL (largeur GTL + 100 mm)" valeur={pg.etel} onChange={v => majGtl({ etel: v })} />
        <Champ label="Largeur coffret com. (mm)" aide="0 = coffret de communication ailleurs"><Num valeur={pg.largeurCoffretCommMm} onChange={v => majGtl({ largeurCoffretCommMm: v })} min={0} largeur="w-20" /></Champ>
        <Champ label="Haut. coffret com. (mm)"><Num valeur={pg.hauteurCoffretCommMm} onChange={v => majGtl({ hauteurCoffretCommMm: v })} min={0} largeur="w-20" /></Champ>
        <Champ label="Largeur AGCP (mm)"><Num valeur={pg.largeurAgcpMm} onChange={v => majGtl({ largeurAgcpMm: v })} min={0} largeur="w-20" /></Champ>
        <Champ label="Haut. AGCP (mm)"><Num valeur={pg.hauteurAgcpMm} onChange={v => majGtl({ hauteurAgcpMm: v })} min={0} largeur="w-20" /></Champ>
        <Champ label="Diamètre gaine par défaut (mm)"><Num valeur={pg.diametreGaineMm} onChange={v => majGtl({ diametreGaineMm: v })} min={8} /></Champ>
        <Champ label="Couches de gaines"><Num valeur={pg.couchesGaines} onChange={v => majGtl({ couchesGaines: Math.round(v) })} min={1} max={4} /></Champ>
        <Champ label="Jeu entre éléments (mm)"><Num valeur={pg.jeuMm} onChange={v => majGtl({ jeuMm: v })} min={0} /></Champ>
      </div>
      <Controles liste={res.controles.filter(c => c.id.startsWith("gtl") || c.id.startsWith("agcp"))} onSelect={() => undefined} />
    </div>
  );
}

// ─── Raccordement ─────────────────────────────────────────────────────────────────────────────────────────────────
function RaccordementOnglet({ res, rac, majRac }: { res: ResultatTableauReel; rac: ParamsRaccordement; majRac: (p: Partial<ParamsRaccordement>) => void }) {
  const r = res.raccordement;
  const calibres = CALIBRES_AGCP.valeur.filter(c => c.phase === rac.phase);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-x-6">
        <Champ label="Réseau"><select value={rac.phase} onChange={e => { const ph = e.target.value as ParamsRaccordement["phase"]; majRac({ phase: ph, calibreAgcpA: CALIBRES_AGCP.valeur.filter(c => c.phase === ph).slice(-1)[0]?.calibreA ?? rac.calibreAgcpA }); }} className="text-[11px] border border-ink-200 rounded px-1 py-0.5"><option value="mono">Monophasé</option><option value="tri">Triphasé</option></select></Champ>
        <Champ label="Disjoncteur d'abonné"><select value={rac.calibreAgcpA} onChange={e => majRac({ calibreAgcpA: parseInt(e.target.value, 10) })} className="text-[11px] border border-ink-200 rounded px-1 py-0.5">{calibres.map(c => <option key={c.calibreA} value={c.calibreA}>{c.libelle}</option>)}</select></Champ>
        <Champ label="Distance AGCP → tableau (m)"><Num valeur={rac.longueurM} onChange={v => majRac({ longueurM: v })} pas={0.5} min={0} /></Champ>
        <Champ label="Mode de pose"><select value={rac.pose} onChange={e => majRac({ pose: e.target.value as ParamsRaccordement["pose"] })} className="text-[11px] border border-ink-200 rounded px-1 py-0.5"><option value="B">B — sous conduit en paroi</option><option value="C">C — sur paroi / goulotte</option></select></Champ>
        <Champ label="Isolant"><select value={rac.isolant} onChange={e => majRac({ isolant: e.target.value as ParamsRaccordement["isolant"] })} className="text-[11px] border border-ink-200 rounded px-1 py-0.5"><option value="PVC">PVC</option><option value="PR">PR / PRC</option></select></Champ>
        <Champ label="Température ambiante (°C)"><Num valeur={rac.temperatureC} onChange={v => majRac({ temperatureC: v })} /></Champ>
        <Champ label="Circuits jointifs (K2)"><Num valeur={rac.nbCircuitsGroupes} onChange={v => majRac({ nbCircuitsGroupes: Math.max(1, Math.round(v)) })} min={1} /></Champ>
        <Champ label="K1 (mode de pose)" aide="1 = cas général ; 0,7 à 0,95 si paroi isolée thermiquement"><Num valeur={rac.coefK1} onChange={v => majRac({ coefK1: v })} pas={0.05} min={0.1} max={1.5} /></Champ>
        <Champ label="cos φ"><Num valeur={rac.cosPhi} onChange={v => majRac({ cosPhi: v })} pas={0.05} min={0.1} max={1} /></Champ>
        <Champ label="Chute admise sur la liaison (%)" aide="Le reste de 3 % (éclairage) / 5 % (autres) est laissé aux circuits terminaux"><Num valeur={rac.budgetChutePct} onChange={v => majRac({ budgetChutePct: v })} pas={0.1} min={0.1} /></Champ>
        <Champ label="Section mini (mm²)"><Num valeur={rac.sectionMiniMm2} onChange={v => majRac({ sectionMiniMm2: v })} /></Champ>
        <Champ label="Chute calculée sur"><select value={rac.baseChute} onChange={e => majRac({ baseChute: e.target.value as ParamsRaccordement["baseChute"] })} className="text-[11px] border border-ink-200 rounded px-1 py-0.5"><option value="demande">Courant d&apos;emploi</option><option value="calibre">Calibre de l&apos;AGCP</option></select></Champ>
        <Champ label="Courant d'emploi imposé (A)" aide="0 = déduit des disjoncteurs installés"><Num valeur={rac.courantEmploiForceA ?? 0} onChange={v => majRac({ courantEmploiForceA: v > 0 ? v : undefined })} min={0} /></Champ>
      </div>
      <div className="rounded border border-ink-200 p-2 bg-ink-50 text-[11px] grid grid-cols-2 gap-x-6 gap-y-0.5">
        <span>Courant d&apos;emploi estimé</span><b className="text-right">{fmt(r.courantEmploiA)} A ({fmt(r.puissanceDemandeeKva)} kVA)</b>
        <span>AGCP choisi</span><b className="text-right">{rac.calibreAgcpA} A{r.puissanceAgcpKva != null ? ` (${r.puissanceAgcpKva} kVA)` : ""}</b>
        <span>Calibre d&apos;AGCP conseillé</span><b className="text-right">{r.calibreAgcpConseilleA != null ? `${r.calibreAgcpConseilleA} A` : "au-delà du standard"}</b>
        <span>K total (K1 × K2 × K3)</span><b className="text-right">{fmt(r.kTotal, 2)}</b>
        <span>Section par courant admissible</span><b className="text-right">{r.sectionIzMm2 ?? "—"} mm²</b>
        <span>Section par chute de tension</span><b className="text-right">{r.sectionChuteMm2 ?? "—"} mm²</b>
        <span className="font-semibold">Section retenue (cuivre)</span><b className="text-right text-emerald-800">{r.sectionRetenueMm2} mm² — imposée par : {r.imposePar}</b>
        <span>Neutre / terre</span><b className="text-right">{r.sectionNeutreMm2} / {r.sectionPEMm2} mm²</b>
        <span>Iz corrigé</span><b className="text-right">{fmt(r.izCorrigeRetenueA, 0)} A</b>
        <span>Chute de tension de la liaison</span><b className="text-right">{fmt(r.chuteV, 2)} V — {fmt(r.chutePct, 2)} %</b>
        <span>Reste pour les circuits terminaux</span><b className="text-right">{fmt(r.resteEclairagePct, 2)} % éclairage · {fmt(r.resteAutresPct, 2)} % autres</b>
        <span>Pertes Joule dans la liaison</span><b className="text-right">{fmt(r.pertesW, 0)} W</b>
      </div>
      {r.demande && <p className="text-[10.5px] text-ink-500">Courant d&apos;emploi : {fmt(r.demande.pleineChargeA, 0)} A à 100 % (chauffage, chauffe-eau, recharge VE) + {fmt(r.demande.autresA, 0)} A × 50 % ({r.demande.nbDisjoncteurs} disjoncteurs).</p>}
      <div>
        <p className="text-[11px] font-semibold text-ink-700 mb-1">Abaque de chute de tension (% de 230 V, I = {fmt(r.courantChuteA, 0)} A) — vert : ≤ {rac.budgetChutePct} %</p>
        <div className="overflow-x-auto">
          <table className="text-[10px] border-collapse">
            <thead><tr><th className="px-1 text-left font-normal text-ink-500">mm² \ m</th>{LONGUEURS_ABAQUE.map(l => <th key={l} className={`px-1 font-normal ${l === Math.round(rac.longueurM) ? "text-ink-900 font-bold" : "text-ink-500"}`}>{l}</th>)}</tr></thead>
            <tbody>
              {r.abaque.map((ligne, i) => (
                <tr key={SECTIONS_ABAQUE[i]}>
                  <th className={`px-1 text-left ${SECTIONS_ABAQUE[i] === r.sectionRetenueMm2 ? "text-ink-900 font-bold" : "font-normal text-ink-500"}`}>{SECTIONS_ABAQUE[i]}</th>
                  {ligne.map(c => <td key={c.longueurM} className={`px-1 text-right font-mono ${c.ok ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-800"} ${c.sectionMm2 === r.sectionRetenueMm2 && c.longueurM === Math.round(rac.longueurM) ? "outline outline-2 outline-ink-900" : ""}`}>{fmt(c.chutePct, 2)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Controles liste={res.controles.filter(c => c.id.startsWith("rac"))} onSelect={() => undefined} />
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
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Case label="Gaines optimisées au départ du tableau" valeur={params.actif} onChange={v => maj({ actif: v })} aide="Désactivé : une gaine par circuit, comme avant" />
        <Case label="Afficher sur le plan" valeur={p.reglagesGaines.calque ?? true} onChange={v => p.onReglagesGaines({ calque: v })} />
        <button className="btn-ghost !text-[11px]" onClick={p.onRecalculerGaines} disabled={!params.actif}>↻ Recalculer</button>
        <button className="btn-ghost !text-[11px]" onClick={() => majForcages(FORCAGES_VIDES)} disabled={forcages.departsSeuls.length + forcages.ensembles.length === 0}>Libérer tout</button>
      </div>
      <div className="grid grid-cols-2 gap-x-6">
        <Champ label="Circuits maxi par gaine" aide="Avertissement au-delà, jamais un blocage"><Num valeur={params.maxCircuitsParGaine} onChange={v => maj({ maxCircuitsParGaine: Math.round(v) })} min={1} /></Champ>
        <Champ label="Remplissage maxi (%)" aide="33 % : règle des conduits"><Num valeur={params.tauxMaxPct} onChange={v => maj({ tauxMaxPct: v })} min={5} max={100} /></Champ>
        <Champ label="Pénalité par départ (m)" aide="Plus elle est haute, plus on regroupe"><Num valeur={params.penaliteDepartM} onChange={v => maj({ penaliteDepartM: v })} pas={0.5} min={0} /></Champ>
        <Case label="Plaque, IRVE, chauffe-eau, ≥ 32 A : gaine à part" valeur={params.grandsCircuitsSeuls} onChange={v => maj({ grandsCircuitsSeuls: v })} />
        <Case label="Pose apparente (IRL)" valeur={params.poseApparente} onChange={v => maj({ poseApparente: v })} />
        <Champ label="Prix gaine (€/m)"><Num valeur={prixGaine} onChange={v => p.onReglagesGaines({ prixGaineEuroM: v })} pas={0.1} min={0} /></Champ>
        <Champ label="Prix câble (€/m)"><Num valeur={prixCable} onChange={v => p.onReglagesGaines({ prixCableEuroM: v })} pas={0.1} min={0} /></Champ>
      </div>
      {s && (
        <table className="w-full text-[11px] border border-ink-200">
          <thead className="bg-ink-50 text-ink-500"><tr><th className="text-left px-2 font-normal" /><th className="font-normal text-right px-2">Avant</th><th className="font-normal text-right px-2">Après</th><th className="font-normal text-right px-2">Écart</th></tr></thead>
          <tbody>
            <tr><td className="px-2">Départs au tableau</td><td className="text-right px-2 font-mono">{s.departsAvant}</td><td className="text-right px-2 font-mono">{params.actif ? s.departsApres : s.departsAvant}</td><td className="text-right px-2 font-mono">{params.actif ? s.departsApres - s.departsAvant : 0}</td></tr>
            <tr><td className="px-2">Gaine (m, à vol d&apos;oiseau)</td><td className="text-right px-2 font-mono">{fmt(s.gaineAvantM, 0)}</td><td className="text-right px-2 font-mono">{fmt(params.actif ? s.gaineApresM : s.gaineAvantM, 0)}</td><td className="text-right px-2 font-mono">{fmt(params.actif ? s.gaineApresM - s.gaineAvantM : 0, 0)}</td></tr>
            <tr><td className="px-2">Câble (m, à vol d&apos;oiseau)</td><td className="text-right px-2 font-mono">{fmt(s.cableAvantM, 0)}</td><td className="text-right px-2 font-mono">{fmt(params.actif ? s.cableApresM : s.cableAvantM, 0)}</td><td className="text-right px-2 font-mono">{fmt(params.actif ? s.cableApresM - s.cableAvantM : 0, 0)}</td></tr>
            <tr className="font-semibold"><td className="px-2">Estimation gaine + câble (€ HT)</td><td className="text-right px-2 font-mono">{fmt(cout(s.gaineAvantM, s.cableAvantM), 0)}</td><td className="text-right px-2 font-mono">{fmt(params.actif ? cout(s.gaineApresM, s.cableApresM) : cout(s.gaineAvantM, s.cableAvantM), 0)}</td><td className="text-right px-2 font-mono">{fmt(params.actif ? cout(s.gaineApresM, s.cableApresM) - cout(s.gaineAvantM, s.cableAvantM) : 0, 0)}</td></tr>
          </tbody>
        </table>
      )}
      {s && s.montees.length > 0 && <p className="text-[10.5px] text-ink-500">Montées vers les autres niveaux (inchangées) : {s.montees.map(m => `${m.nbGaines > 1 ? `${m.nbGaines} × ` : ""}${m.gaine} → ${m.niveau}`).join(" · ")}.</p>}
      <p className="text-[10px] text-ink-400">Longueurs à vol d&apos;oiseau depuis le tableau / point d&apos;arrivée des gaines : le câble suit le tronc puis sa branche, donc un peu plus long qu&apos;en ligne droite ; la gaine commune est plus courte. Estimation indicative, hors montées verticales.</p>

      {!params.actif && <p className="text-[11px] text-ink-600">Option désactivée : active-la pour regrouper les circuits qui partent dans la même direction (niveau « {p.niveauNom} »).</p>}
      {params.actif && !g && <p className="text-[11px] text-ink-600">Aucun circuit à regrouper sur le niveau « {p.niveauNom} » (tableau ou point d&apos;arrivée des gaines à placer, circuits à générer).</p>}
      {params.actif && g && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] font-semibold text-ink-700">Niveau « {p.niveauNom} » : {g.groupes.length} gaine(s) pour {g.groupes.reduce((n, x) => n + x.circuits.length, 0)} circuit(s)</p>
          {g.avertissements.map((w, i) => <p key={i} className="text-[10.5px] text-amber-700">⚠️ {w}</p>)}
          {g.ignores.length > 0 && <p className="text-[10.5px] text-ink-500">Non raccordés (ignorés) : {g.ignores.join(", ")}.</p>}
          {g.groupes.map((gr, gi) => {
            const coul = couleurGroupe(gi, gr.courantFaible);
            const fige = forcages.ensembles.some(e => e.length > 1 && gr.circuits.every(c => e.includes(c.cle)));
            return (
              <div key={gr.id} className="rounded border border-ink-200 p-1.5">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ background: coul }} />
                  <b>{gr.nom}</b><span className="text-ink-600">{gr.tronc.gaine} · {gr.tronc.tauxPct} % · {fmt(gr.longueurM, 1)} m</span>
                  {gr.circuits.length > 1 && !fige && <button className="ml-auto text-[10px] underline" title="Garde ces circuits ensemble lors des prochains recalculs" onClick={() => majForcages({ ...forcages, ensembles: [...forcages.ensembles, gr.circuits.map(c => c.cle)] })}>🔒 Figer</button>}
                  {fige && <span className="ml-auto text-[10px] text-ink-500">🔒 figée</span>}
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {gr.circuits.map(c => (
                    <span key={c.cle} className={`inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] ${c.breakerId === p.breakerSelectionneId ? "border-amber-400 bg-amber-50" : "border-ink-200"}`}>
                      <button onClick={() => p.onSelectBreaker(c.breakerId === p.breakerSelectionneId ? null : c.breakerId)} className="hover:underline">{c.label}</button>
                      <select value="" title="Déplacer ce circuit" onChange={e => {
                        const v = e.target.value; if (!v) return;
                        if (v === "__seul") majForcages(deplacerCircuitGaine(forcages, c.cle, null));
                        else { const cible = g.groupes.find(x => x.id === v); if (cible) majForcages(deplacerCircuitGaine(forcages, c.cle, cible.circuits[0].cle, cible.circuits.map(x => x.cle))); }
                      }} className="w-4 text-[10px] border-0 bg-transparent cursor-pointer">
                        <option value="">⇄</option>
                        {!gr.seul && <option value="__seul">Départ individuel</option>}
                        {g.groupes.filter(x => x.id !== gr.id && x.courantFaible === gr.courantFaible).map(x => <option key={x.id} value={x.id}>→ {x.nom}</option>)}
                      </select>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
