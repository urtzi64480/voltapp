"use client";
// src/components/plan/TableauReelVisuels.tsx
//
// Dessins du panneau « Tableau réaliste » (plein écran) :
//  · GtlElevation  — la GTL vue de face, À L'ÉCHELLE (mm) : coffret, coffret de communication, gaines, repères de hauteur ;
//  · TableauDetail — le tableau tel qu'on l'ouvre : rails DIN, différentiels, disjoncteurs avec manette, peignes, borniers N / PE, étiquettes ;
//  · GainesPlan    — le plan du niveau avec l'arbre de gaines (tronc commun + branches).
// Composants purement visuels : aucun calcul métier ici (voir lib/tableau-reel.ts, lib/gtl-agencement.ts, lib/gaines-optimisees.ts).
import { useMemo, useState, type ReactNode } from "react";
import type { Point } from "@/lib/maison-types";
import type { ParamsTableauReel, ResultatTableauReel } from "@/lib/tableau-reel";
import { agencerGtl } from "@/lib/gtl-agencement";
import { couleurGroupe, type BoiteGaine, type GroupeGaines } from "@/lib/gaines-optimisees";

export const COULEUR_ID: Record<string, string> = { AC: "#64748b", A: "#2563eb", F: "#7c3aed" };
export const COULEURS_PHASE: Record<string, string> = { rouge: "#dc2626", marron: "#92400e", noir: "#1c1917", gris: "#94a3b8", bleu: "#2563eb", "vert/jaune": "#16a34a" };
const fmt = (v: number, d = 1) => v.toFixed(d).replace(".", ",");

// ─── Zone zoomable ────────────────────────────────────────────────────────────────────────────────────────────────
/** Conteneur plein cadre avec zoom (− / + / Ajuster) : le dessin SVG enfant remplit la zone, ou s'agrandit avec défilement. */
export function ZoneZoom({ children, ratio, className = "" }: { children: ReactNode; ratio: number; className?: string }) {
  const [zoom, setZoom] = useState(1);
  const bornes = (z: number) => Math.min(4, Math.max(0.5, z));
  return (
    <div className={`relative flex flex-col min-h-0 ${className}`}>
      <div className="absolute bottom-2 right-3 z-10 flex items-center gap-1 rounded-lg bg-white/95 border border-ink-200 shadow px-1 py-0.5 text-[11px]">
        <button className="btn-ghost !px-2 !py-0.5" onClick={() => setZoom(z => bornes(z / 1.25))} aria-label="Zoom arrière">−</button>
        <span className="font-mono w-9 text-center text-ink-500">{Math.round(zoom * 100)}%</span>
        <button className="btn-ghost !px-2 !py-0.5" onClick={() => setZoom(z => bornes(z * 1.25))} aria-label="Zoom avant">+</button>
        <button className="btn-ghost !px-2 !py-0.5" onClick={() => setZoom(1)}>Ajuster</button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-ink-200 bg-[#f7f6f3]">
        <div style={{ width: `${zoom * 100}%`, height: zoom === 1 ? "100%" : undefined, aspectRatio: zoom === 1 ? undefined : String(ratio) }} className="mx-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Élévation de la GTL ──────────────────────────────────────────────────────────────────────────────────────────
export interface GtlElevationProps {
  res: ResultatTableauReel;
  params: ParamsTableauReel;
  /** Couleur d'une gaine (par identifiant) — gris si inconnue. */
  couleurGaine: (id: string) => string;
}
const T = 44; // taille de texte (mm) dans le repère de l'élévation

export function GtlElevation({ res, params, couleurGaine }: GtlElevationProps) {
  const ag = useMemo(() => agencerGtl(res, params), [res, params]);
  const g = res.gtl;
  const H = ag.hauteurMm, W = ag.largeurMm;
  const mg = { g: 330, d: 560, h: 60, b: 270 };           // marges pour les cotes
  const VW = W + mg.g + mg.d, VH = H + mg.h + mg.b;
  const X = (x: number) => mg.g + x;                       // x GTL → x dessin
  const Y = (y: number) => mg.h + H - y;                    // hauteur depuis le sol → y dessin
  const cof = ag.elements.find(e => e.id === "coffret");
  const comm = ag.elements.find(e => e.id === "comm");
  const phase = COULEURS_PHASE[params.couleurPhase] ?? "#dc2626";
  const repères = [0.5, 0.9, 1.3, 1.8];
  const ns = { vectorEffect: "non-scaling-stroke" } as const;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full h-full" preserveAspectRatio="xMidYMin meet" role="img" aria-label="GTL vue de face à l'échelle">
      {/* sol et plafond */}
      <rect x={X(-150)} y={Y(0)} width={W + 300} height={60} fill="#d6d3d1" />
      <rect x={X(-150)} y={Y(H) - 40} width={W + 300} height={40} fill="#d6d3d1" />
      <text x={X(W + 160)} y={Y(H) - 8} fontSize={T} fill="#78716c">Plafond — {fmt(H / 1000, 2)} m</text>
      <text x={X(W + 160)} y={Y(0) + 40} fontSize={T} fill="#78716c">Sol</text>
      {/* zone de manœuvre 0,90 – 1,80 m */}
      <rect x={X(0)} y={Y(1800)} width={W} height={900} fill="#16a34a" opacity={0.07} />
      {/* ETEL */}
      {ag.largeurEtelMm != null && <rect x={X(0)} y={Y(H)} width={ag.largeurEtelMm} height={H} fill="none" stroke="#2563eb" strokeDasharray="14 8" strokeWidth={2} {...ns} />}
      {/* GTL */}
      <rect x={X(0)} y={Y(H)} width={W} height={H} fill="#fdfcfa" stroke="#1c1917" strokeWidth={2.5} {...ns} />
      <text x={X(14)} y={Y(H) + 55} textAnchor="start" fontSize={T * 0.85} fontWeight={700} fill="#44403c">GTL {Math.round(W)}{ag.largeurEtelMm != null ? ` · ETEL ${Math.round(ag.largeurEtelMm)}` : ""} mm</text>
      {g.largeurRequiseMm > g.largeurRetenueMm && (
        <rect x={X(W)} y={Y(H)} width={g.largeurRequiseMm - W} height={H} fill="#fee2e2" stroke="#dc2626" strokeDasharray="10 6" strokeWidth={1.5} {...ns} opacity={0.8} />
      )}

      {/* repères de hauteur */}
      {repères.map(h => (
        <g key={h}>
          <line x1={X(-20)} x2={X(W)} y1={Y(h * 1000)} y2={Y(h * 1000)} stroke="#a8a29e" strokeDasharray="8 8" strokeWidth={1} {...ns} />
          <text x={X(-30)} y={Y(h * 1000) + T / 3} textAnchor="end" fontSize={T} fill="#78716c">{fmt(h, 2)} m</text>
        </g>
      ))}

      {/* gaines (zone de passage) : vue de face — les couches se recouvrent, la coupe à droite les sépare */}
      {ag.zoneGaines.w > 0 && (
        <g>
          <rect x={X(ag.zoneGaines.x)} y={Y(H)} width={ag.zoneGaines.w} height={H} fill="#dbeafe" opacity={0.35} />
          {[...res.gaines].sort((a, b) => b.couche - a.couche).map((ga, i) => {
            const cx = ag.zoneGaines.x + ga.xMm + ga.diametreMm / 2;
            const y0 = cof ? cof.y + cof.h / 2 : H * 0.4;
            const coul = ga.depart ? couleurGaine(ga.id) : "#64748b";
            return (
              <g key={`${ga.id}-${i}`} opacity={ga.couche === 0 ? 1 : 0.65}>
                <title>{`${ga.depart ? "Gaine" : "Montée"} ⌀ ${ga.diametreMm} mm${ga.nbCircuits ? ` — ${ga.nbCircuits} circuit(s)` : ""}`}</title>
                <rect x={X(cx - ga.diametreMm / 2)} y={Y(H)} width={ga.diametreMm} height={H - y0} fill={coul} stroke="#1c1917" strokeWidth={1} {...ns} />
              </g>
            );
          })}
        </g>
      )}

      {/* coupe horizontale du passage des gaines (vue de dessus, grossie ×2,2) */}
      {ag.zoneGaines.w > 0 && (() => {
        const k = 2.6, dMax = Math.max(20, ...res.gaines.map(x => x.diametreMm));
        const nbC = Math.max(1, ...res.gaines.map(x => x.couche + 1));
        const prof = Math.max(params.gtl.profondeurMm, nbC * dMax + 20);
        const x0 = X(W + 40), y0 = Y(H) + 130;
        const ww = ag.zoneGaines.w * k, hh = prof * k;
        return (
          <g>
            <text x={x0} y={y0 - 44} fontSize={T * 0.9} fontWeight={700} fill="#1c1917">Coupe des gaines (dessus)</text>
            <rect x={x0} y={y0} width={Math.max(ww, 140)} height={hh} fill="#fafaf9" stroke="#1c1917" strokeWidth={1.5} {...ns} />
            <rect x={x0} y={y0 - 14} width={Math.max(ww, 140)} height={14} fill="#a8a29e" />
            <text x={x0 + Math.max(ww, 140) + 14} y={y0 - 2} fontSize={T * 0.75} fill="#78716c">mur du fond</text>
            {res.gaines.map((ga, i) => {
              const coul = ga.depart ? couleurGaine(ga.id) : "#64748b";
              const cx = x0 + (ga.xMm + ga.diametreMm / 2) * k, cy = y0 + (ga.couche * dMax + ga.diametreMm / 2 + 6) * k;
              return (
                <g key={`${ga.id}-${i}`}>
                  <title>{`⌀ ${ga.diametreMm} mm${ga.nbCircuits ? ` — ${ga.nbCircuits} circuit(s)` : " — montée vers un autre niveau"}`}</title>
                  <circle cx={cx} cy={cy} r={(ga.diametreMm / 2) * k} fill={coul} stroke="#1c1917" strokeWidth={1.5} {...ns} />
                  <text x={cx} y={cy + 11} textAnchor="middle" fontSize={32} fontWeight={700} fill="#fff" stroke="#1c1917" strokeWidth={4} paintOrder="stroke">{ga.nbCircuits || "↑"}</text>
                </g>
              );
            })}
            <text x={x0} y={y0 + hh + 50} fontSize={T * 0.8} fill="#57534e">⌀ en mm · chiffre = nb de circuits</text>
            {res.gaines.map((ga, i) => (
              <g key={i}>
                <circle cx={x0 + 12} cy={y0 + hh + 88 + i * 44} r={12} fill={ga.depart ? couleurGaine(ga.id) : "#64748b"} stroke="#1c1917" strokeWidth={1} {...ns} />
                <text x={x0 + 34} y={y0 + hh + 96 + i * 44} fontSize={T * 0.8} fill="#1c1917">⌀{ga.diametreMm} — {ga.nbCircuits ? `${ga.nbCircuits} circuit(s)` : "montée"}</text>
              </g>
            ))}
          </g>
        );
      })()}

      {/* départs : chaque rangée envoie son faisceau vers la zone des gaines */}
      {cof && ag.zoneGaines.w > 0 && res.rails.map((r, i) => {
        const yr = Y(cof.y + cof.h - 50 - params.pasRangeeMm / 2 - i * params.pasRangeeMm);
        return <path key={r.rangeeId} d={`M ${X(cof.x + cof.w)} ${yr} H ${X(ag.zoneGaines.x - 10)}`} stroke="#57534e" strokeWidth={3} fill="none" {...ns} />;
      })}

      {/* coffret de communication */}
      {comm && (
        <g>
          <title>{`Coffret de communication ${comm.w} × ${comm.h} mm`}</title>
          <rect x={X(comm.x)} y={Y(comm.y + comm.h)} width={comm.w} height={comm.h} rx={6} fill="#bbf7d0" stroke={comm.conflit ? "#dc2626" : "#14532d"} strokeWidth={2} {...ns} />
          <rect x={X(comm.x) + 12} y={Y(comm.y + comm.h) + 12} width={comm.w - 24} height={comm.h * 0.4} rx={3} fill="#166534" opacity={0.25} />
          {[0, 1, 2, 3].map(i => <rect key={i} x={X(comm.x) + 16 + i * ((comm.w - 32) / 4)} y={Y(comm.y) - comm.h * 0.3} width={(comm.w - 32) / 4 - 8} height={comm.h * 0.18} rx={2} fill="#14532d" />)}
          <text x={X(comm.x + comm.w / 2)} y={Y(comm.y + comm.h) + comm.h * 0.62} textAnchor="middle" fontSize={T} fill="#14532d" fontWeight={700}>Com. / VDI</text>
          <text x={X(comm.x + comm.w + 14)} y={Y(comm.y + comm.h / 2)} fontSize={T * 0.85} fill="#78716c">{comm.w}×{comm.h}</text>
          {comm.conflit && <text x={X(comm.x)} y={Y(comm.y) + 46} fontSize={T * 0.85} fill="#dc2626" fontWeight={700}>⚠</text>}
        </g>
      )}

      {/* coffret de distribution : rangées en miniature */}
      {cof && (
        <g>
          <title>{`Coffret ${cof.w} × ${cof.h} mm — ${res.coffret.nbRangees} rangée(s) de ${res.coffret.modulesParRail} modules`}</title>
          <rect x={X(cof.x)} y={Y(cof.y + cof.h)} width={cof.w} height={cof.h} rx={8} fill="#e7e5e4" stroke={cof.conflit ? "#dc2626" : "#1c1917"} strokeWidth={2.5} {...ns} />
          {res.rails.map((r, i) => {
            const yTop = Y(cof.y + cof.h - 50 - i * params.pasRangeeMm);
            const mod = (cof.w - 100) / res.coffret.modulesParRail;
            return (
              <g key={r.rangeeId}>
                <rect x={X(cof.x) + 50} y={yTop + 8} width={cof.w - 100} height={params.pasRangeeMm - 22} fill="#fafaf9" stroke="#a8a29e" strokeWidth={1} {...ns} />
                {r.calibreId != null && <rect x={X(cof.x) + 50} y={yTop + 8} width={mod * r.modulesId} height={params.pasRangeeMm - 22} fill={COULEUR_ID[r.diffType] ?? "#64748b"} />}
                {r.departs.map(d => <rect key={`${d.breakerId}-${d.positionModule}`} x={X(cof.x) + 50 + d.positionModule * mod + 1} y={yTop + 14} width={Math.max(2, d.modules * mod - 2)} height={params.pasRangeeMm - 34} fill={d.accessoire ? "#a8a29e" : couleurGaine(d.gaineId)} stroke="#1c1917" strokeWidth={0.6} {...ns} />)}
              </g>
            );
          })}
          <text x={X(cof.x + cof.w / 2)} y={Y(cof.y) + 44} textAnchor="middle" fontSize={T * 0.75} fill="#44403c" fontWeight={700}>Tableau {cof.w}×{cof.h} mm · manettes</text>
          {cof.conflit && <text x={X(cof.x)} y={Y(cof.y + cof.h) - 14} fontSize={T * 0.85} fill="#dc2626" fontWeight={700}>⚠</text>}
          {/* hauteur des manettes, dans chaque rangée */}
          {res.rails.map(r => (
            <text key={`m${r.rangeeId}`} x={X(cof.x + cof.w) - 56} y={Y(r.hauteurManetteM * 1000) + T / 3} textAnchor="end" fontSize={T * 0.8} fill="#44403c" fontWeight={600}>{fmt(r.hauteurManetteM, 2)} m</text>
          ))}
        </g>
      )}

      {/* cotes */}
      <g stroke="#57534e" strokeWidth={1} fill="none" {...ns}>
        <line x1={X(0)} x2={X(W)} y1={Y(0) + 120} y2={Y(0) + 120} />
        <line x1={X(0)} x2={X(0)} y1={Y(0) + 104} y2={Y(0) + 136} />
        <line x1={X(W)} x2={X(W)} y1={Y(0) + 104} y2={Y(0) + 136} />
      </g>
      <text x={X(W / 2)} y={Y(0) + 120 + T} textAnchor="middle" fontSize={T} fill="#1c1917">{Math.round(W)} mm</text>
      {ag.debordeLargeur && <text x={X(W / 2)} y={Y(0) + 120 + 2 * T + 12} textAnchor="middle" fontSize={T} fontWeight={700} fill="#dc2626">⚠ composants + gaines : {g.largeurRequiseMm} mm &gt; {Math.round(W)} mm</text>}
    </svg>
  );
}

// ─── Tableau (détail) ─────────────────────────────────────────────────────────────────────────────────────────────
export interface TableauDetailProps {
  res: ResultatTableauReel;
  params: ParamsTableauReel;
  couleurGaine: (id: string) => string;
  selectionne: number | null;
  onSelect: (id: number | null) => void;
}
const MOD = 27;            // largeur d'un module (17,5 mm)
const RANGEE = 232;        // pas entre rangées
const DEV_H = 132;         // hauteur d'un appareil (≈ 90 mm)

const court = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function TableauDetail({ res, params, couleurGaine, selectionne, onSelect }: TableauDetailProps) {
  const nbMod = res.coffret.modulesParRail;
  const x0 = 78;                                   // début des rails (après la goulotte de liaison)
  const largeurRail = nbMod * MOD;
  const W = x0 + largeurRail + 150;
  const yH = 118;                                  // bandeau d'en-tête : départ de toutes les gaines (à l'échelle)
  const H = yH + res.rails.length * RANGEE + 60;
  const phase = COULEURS_PHASE[params.couleurPhase] ?? "#dc2626";
  const ns = { vectorEffect: "non-scaling-stroke" } as const;
  if (res.rails.length === 0) return <div className="h-full grid place-items-center text-sm text-ink-500">Aucun circuit : génère les circuits du plan pour voir le tableau.</div>;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMin meet" role="img" aria-label="Tableau électrique ouvert">
      {/* coffret */}
      <rect x={6} y={yH - 4} width={W - 12} height={H - yH - 2} rx={10} fill="#d6d3d1" stroke="#44403c" strokeWidth={3} {...ns} />
      <rect x={14} y={yH + 4} width={W - 28} height={H - yH - 18} rx={6} fill="#efeeeb" stroke="#a8a29e" strokeWidth={1} {...ns} />

      {/* départ de TOUTES les gaines présentes sur le plan, à l'échelle (diamètre réel : 1 module = 17,5 mm) */}
      {(() => {
        const px = MOD / 17.5;                                    // px par mm
        const liste = res.gaines;
        const gap = 14;
        const total = liste.reduce((t, g) => t + g.diametreMm * px + gap, 0);
        const dispo = W - 28 - 20;
        const k = total > dispo ? dispo / total : 1;
        let x = 24;
        return (
          <g>
            <text x={16} y={12} fontSize={12} fontWeight={700} fill="#44403c">Gaines au départ du tableau ({liste.length}) — diamètres à l&apos;échelle</text>
            {liste.map(g => {
              const d = g.diametreMm * px * k, cx = x + d / 2, cy = yH - 14 - d / 2;
              x += d + gap * k;
              const coul = couleurGaine(g.id);
              return (
                <g key={g.id}>
                  <title>{`Gaine ø${g.diametreMm} mm${g.depart ? ` — ${g.nbCircuits} circuit(s)` : " — montée / attente / courants faibles"}`}</title>
                  <line x1={cx} x2={cx} y1={cy + d / 2} y2={yH - 4} stroke={coul} strokeWidth={Math.max(3, d * 0.35)} strokeLinecap="round" opacity={0.55} />
                  <circle cx={cx} cy={cy} r={d / 2} fill="#fff" stroke={coul} strokeWidth={4} />
                  <circle cx={cx} cy={cy} r={Math.max(2, d / 2 - 7)} fill={coul} opacity={0.25} />
                  <text x={cx} y={cy + 4} textAnchor="middle" fontSize={Math.max(9, Math.min(13, d * 0.38))} fontWeight={800} fill="#1c1917">{g.depart && g.nbCircuits > 0 ? g.nbCircuits : ""}</text>
                  <text x={cx} y={cy - d / 2 - 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1c1917">ø{g.diametreMm}</text>
                </g>
              );
            })}
          </g>
        );
      })()}
      {[phase, "#2563eb", "#16a34a"].map((c, i) => <line key={c + i} x1={26 + i * 8} x2={26 + i * 8} y1={yH} y2={H - 30} stroke={c} strokeWidth={5} {...ns} />)}
      {[phase, "#2563eb", "#16a34a"].map((c, i) => <line key={c + "h" + i} x1={26 + i * 8} x2={x0 - 8} y1={yH + 10 + i * 5} y2={yH + 10 + i * 5} stroke={c} strokeWidth={4} {...ns} />)}

      {res.rails.map((r, ri) => {
        const y = yH + 14 + ri * RANGEE;
        const yDev = y + 44;
        const xr = (m: number) => x0 + m * MOD;
        const libres = r.capaciteModules - r.modulesUtilises;
        const nbT = Math.max(r.nbCircuits, 1);
        return (
          <g key={r.rangeeId}>
            {/* plastron de rangée + rail DIN */}
            <rect x={x0 - 6} y={y} width={largeurRail + 12} height={RANGEE - 30} rx={4} fill="#f5f5f4" stroke="#d6d3d1" strokeWidth={1} {...ns} />
            <rect x={x0 - 6} y={yDev + DEV_H / 2 - 7} width={largeurRail + 12} height={14} fill="#a8a29e" />
            <rect x={x0 - 6} y={yDev + DEV_H / 2 - 3} width={largeurRail + 12} height={6} fill="#78716c" />
            {/* peigne (phase) au-dessus des appareils */}
            <rect x={xr(0) + 2} y={yDev - 10} width={Math.max(0, r.modulesUtilises * MOD - 4)} height={8} rx={2} fill="#d4a017" stroke="#92400e" strokeWidth={0.8} {...ns} />
            {Array.from({ length: r.modulesUtilises }).map((_, i) => <line key={i} x1={xr(i) + MOD / 2} x2={xr(i) + MOD / 2} y1={yDev - 10} y2={yDev} stroke="#92400e" strokeWidth={1} {...ns} />)}
            {/* obturateurs sur les modules libres */}
            {Array.from({ length: Math.max(0, libres) }).map((_, i) => (
              <rect key={i} x={xr(r.modulesUtilises + i) + 1.5} y={yDev + 10} width={MOD - 3} height={DEV_H - 20} rx={2} fill="#fafaf9" stroke="#a8a29e" strokeDasharray="4 3" strokeWidth={1} {...ns} />
            ))}
            {/* différentiel */}
            {r.calibreId != null && (
              <g onClick={() => onSelect(null)}>
                <title>{`Interrupteur différentiel ${r.calibreId} A 30 mA type ${r.diffType} — ${r.nbCircuits} circuit(s)`}</title>
                <rect x={xr(0) + 1} y={yDev} width={r.modulesId * MOD - 2} height={DEV_H} rx={4} fill={COULEUR_ID[r.diffType] ?? "#64748b"} stroke="#1c1917" strokeWidth={1.2} {...ns} />
                <circle cx={xr(0) + (r.modulesId * MOD) / 2} cy={yDev + 20} r={7} fill="#fbbf24" stroke="#1c1917" strokeWidth={1} {...ns} />
                <text x={xr(0) + (r.modulesId * MOD) / 2} y={yDev + 24} textAnchor="middle" fontSize={9} fontWeight={700} fill="#1c1917">T</text>
                <rect x={xr(0) + (r.modulesId * MOD) / 2 - 11} y={yDev + 36} width={22} height={34} rx={3} fill="#1c1917" />
                <rect x={xr(0) + (r.modulesId * MOD) / 2 - 8} y={yDev + 38} width={16} height={14} rx={2} fill="#f5f5f4" />
                <text x={xr(0) + (r.modulesId * MOD) / 2} y={yDev + 88} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{r.calibreId} A</text>
                <text x={xr(0) + (r.modulesId * MOD) / 2} y={yDev + 101} textAnchor="middle" fontSize={9} fill="#fff">30 mA</text>
                <text x={xr(0) + (r.modulesId * MOD) / 2} y={yDev + 118} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">type {r.diffType}</text>
              </g>
            )}
            {/* départs */}
            {r.departs.map(d => {
              const x = xr(d.positionModule), w = d.modules * MOD;
              const sel = d.breakerId === selectionne;
              const coul = d.accessoire ? "#a8a29e" : couleurGaine(d.gaineId);
              return (
                <g key={`${d.breakerId}-${d.positionModule}`} onClick={() => onSelect(d.accessoire ? null : (sel ? null : d.breakerId))} style={{ cursor: d.accessoire ? "default" : "pointer" }}>
                  <title>{`${d.label} — ${d.amperes} A · ${d.sectionMm2} mm²${d.accessoire ? "" : ` · gaine ${d.gaineId}`}`}</title>
                  <rect x={x + 1} y={yDev} width={w - 2} height={DEV_H} rx={4} fill="#fafaf9" stroke={sel ? "#f59e0b" : "#1c1917"} strokeWidth={sel ? 3.5 : 1.2} {...ns} />
                  <rect x={x + 1} y={yDev} width={w - 2} height={9} rx={3} fill={coul} />
                  <rect x={x + w / 2 - 8} y={yDev + 22} width={16} height={38} rx={3} fill="#1c1917" />
                  <rect x={x + w / 2 - 6} y={yDev + 24} width={12} height={16} rx={2} fill="#e7e5e4" />
                  <text x={x + w / 2} y={yDev + 82} textAnchor="middle" fontSize={d.modules > 1 ? 13 : 11} fontWeight={700} fill="#1c1917">{d.amperes || ""}</text>
                  <text x={x + w / 2} y={yDev + 96} textAnchor="middle" fontSize={8} fill="#57534e">{d.amperes ? "A" : ""}</text>
                  <text x={x + w / 2} y={yDev + 118} textAnchor="middle" fontSize={8} fill="#78716c">{d.accessoire ? "" : d.sectionMm2}</text>
                  {/* étiquette sous l'appareil */}
                  <rect x={x + 2} y={yDev + DEV_H + 6} width={w - 4} height={52} rx={2} fill="#fff" stroke={sel ? "#f59e0b" : "#d6d3d1"} strokeWidth={sel ? 2 : 1} {...ns} />
                  <text transform={`translate(${x + w / 2 + 3.5}, ${yDev + DEV_H + 56}) rotate(-90)`} fontSize={10} fill="#1c1917">{court(d.label, 11)}</text>
                </g>
              );
            })}
            {/* borniers neutre / terre de la rangée */}
            <g>
              <rect x={x0 + largeurRail + 22} y={yDev + 6} width={96} height={22} rx={3} fill="#2563eb" stroke="#1e3a8a" strokeWidth={1} {...ns} />
              {Array.from({ length: Math.min(nbT + 1, 10) }).map((_, i) => <circle key={i} cx={x0 + largeurRail + 31 + i * 9} cy={yDev + 17} r={2.6} fill="#dbeafe" />)}
              <text x={x0 + largeurRail + 22} y={yDev + 44} fontSize={10} fill="#1e3a8a" fontWeight={700}>Neutre (N)</text>
              <rect x={x0 + largeurRail + 22} y={yDev + 54} width={96} height={22} rx={3} fill="#16a34a" stroke="#14532d" strokeWidth={1} {...ns} />
              <rect x={x0 + largeurRail + 22} y={yDev + 54} width={96} height={11} rx={3} fill="#facc15" opacity={0.85} />
              {Array.from({ length: Math.min(nbT + 1, 10) }).map((_, i) => <circle key={i} cx={x0 + largeurRail + 31 + i * 9} cy={yDev + 65} r={2.6} fill="#f0fdf4" />)}
              <text x={x0 + largeurRail + 22} y={yDev + 92} fontSize={10} fill="#14532d" fontWeight={700}>Terre (PE)</text>
            </g>
            {/* légende de la rangée */}
            <text x={x0 + largeurRail + 22} y={yDev + 112} fontSize={11} fontWeight={700} fill="#1c1917">{r.nom}</text>
            <text x={x0 + largeurRail + 22} y={yDev + 126} fontSize={9.5} fill="#78716c">manettes {fmt(r.hauteurManetteM, 2)} m</text>
            <text x={x0 + largeurRail + 22} y={yDev + 140} fontSize={9.5} fill={r.depassement ? "#dc2626" : "#78716c"}>{r.modulesUtilises}/{r.capaciteModules} mod. · {r.modulesLibres} libres</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Plan du niveau avec l'arbre de gaines ────────────────────────────────────────────────────────────────────────
export interface PieceDessin { id: number; nom: string; contour: Point[] }
export interface GainesPlanProps {
  pieces: PieceDessin[];
  origine: Point;
  groupes: GroupeGaines[];
  boites: BoiteGaine[];
  selectionBreakerId: number | null;
  groupeSurvole: string | null;
  boiteActive: string | null;
  onSurvol: (id: string | null) => void;
  onSelectBreaker: (id: number | null) => void;
  onBoite: (id: string | null) => void;
}
export function GainesPlan({ pieces, origine, groupes, boites, selectionBreakerId, groupeSurvole, boiteActive, onSurvol, onSelectBreaker, onBoite }: GainesPlanProps) {
  const pts: Point[] = [origine, ...pieces.flatMap(p => p.contour), ...groupes.flatMap(g => g.troncons.flatMap(t => [t.de, t.vers]))];
  const minX = Math.min(...pts.map(p => p.x)) - 1, maxX = Math.max(...pts.map(p => p.x)) + 3;
  const minY = Math.min(...pts.map(p => p.y)) - 1, maxY = Math.max(...pts.map(p => p.y)) + 0.8;
  const W = Math.max(1, maxX - minX), H = Math.max(1, maxY - minY);
  const fs = Math.max(W, H) / 60;                  // taille de texte relative à l'emprise du plan
  const ns = { vectorEffect: "non-scaling-stroke" } as const;
  const centre = (c: Point[]): Point => ({ x: c.reduce((s, p) => s + p.x, 0) / Math.max(1, c.length), y: c.reduce((s, p) => s + p.y, 0) / Math.max(1, c.length) });
  const indexDe = new Map(groupes.map((g, i) => [g.id, i]));
  const grActif = (id: string) => groupeSurvole === id || (boiteActive != null && boites.find(b => b.id === boiteActive)?.groupeId === id);
  const filtre = groupeSurvole != null || boiteActive != null;
  return (
    <svg viewBox={`${minX} ${minY} ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Plan des gaines optimisées">
      {pieces.map(p => {
        const c = centre(p.contour);
        return (
          <g key={p.id}>
            <polygon points={p.contour.map(q => `${q.x},${q.y}`).join(" ")} fill="#fffdf8" stroke="#a8a29e" strokeWidth={1.5} {...ns} />
            <text x={c.x} y={c.y} textAnchor="middle" fontSize={fs} fill="#c7c3bd">{p.nom}</text>
          </g>
        );
      })}
      {groupes.map((gr, gi) => {
        const coul = couleurGroupe(gi, gr.courantFaible);
        const actif = grActif(gr.id);
        const dim = filtre && !actif;
        return (
          <g key={gr.id} opacity={dim ? 0.2 : 1} onMouseEnter={() => onSurvol(gr.id)} onMouseLeave={() => onSurvol(null)}>
            {gr.troncons.map(t => {
              const w = 2 + Math.min(2.5, t.circuits.length * 0.3);
              return (
                <g key={t.id}>
                  <line x1={t.de.x} y1={t.de.y} x2={t.vers.x} y2={t.vers.y} stroke="#fff" strokeWidth={w + 2.5} strokeLinecap="round" {...ns} />
                  <line x1={t.de.x} y1={t.de.y} x2={t.vers.x} y2={t.vers.y} stroke={coul} strokeWidth={actif ? w + 1.5 : w} strokeLinecap="round" strokeDasharray={gr.courantFaible ? "8 5" : undefined} {...ns} />
                  {actif && (
                    <text x={(t.de.x + t.vers.x) / 2} y={(t.de.y + t.vers.y) / 2 - fs * 0.5} textAnchor="middle" fontSize={fs * 0.9} fontWeight={700} fill={coul} stroke="#fff" strokeWidth={fs * 0.25} paintOrder="stroke">
                      {t.gaine.replace(/ verte.*/, "")}
                    </text>
                  )}
                </g>
              );
            })}
            {gr.circuits.map(c => {
              const sel = c.breakerId === selectionBreakerId;
              return (
                <g key={c.cle} onClick={() => onSelectBreaker(sel ? null : c.breakerId)} style={{ cursor: "pointer" }}>
                  <circle cx={c.entree.x} cy={c.entree.y} r={fs * (sel ? 0.8 : 0.4)} fill={sel ? "#f59e0b" : "#fff"} stroke={coul} strokeWidth={2} {...ns} />
                  {(sel || actif) && <text x={c.entree.x + fs * 0.7} y={c.entree.y + fs * 0.3} fontSize={fs * 0.8} fill="#1c1917" stroke="#fff" strokeWidth={fs * 0.2} paintOrder="stroke">{court(c.label, 22)}</text>}
                </g>
              );
            })}
          </g>
        );
      })}
      {boites.map(b => {
        const coul = couleurGroupe(indexDe.get(b.groupeId) ?? 0, b.courantFaible);
        const act = boiteActive === b.id;
        const dim = filtre && !grActif(b.groupeId);
        return (
          <g key={b.id} opacity={dim ? 0.25 : 1} onClick={() => onBoite(act ? null : b.id)} style={{ cursor: "pointer" }}>
            <title>{`${b.nom} — boîte de dérivation : ${b.entrant.gaine} → ${b.sorties.map(x => x.gaine).join(" + ")}`}</title>
            <rect x={b.point.x - fs * 0.8} y={b.point.y - fs * 0.8} width={fs * 1.6} height={fs * 1.6} rx={fs * 0.2} fill={act ? "#fde68a" : "#fff"} stroke={coul} strokeWidth={act ? 4 : 2.5} {...ns} />
            <text x={b.point.x} y={b.point.y + fs * 0.3} textAnchor="middle" fontSize={fs * 0.9} fontWeight={800} fill="#1c1917">B</text>
            <text x={b.point.x + fs} y={b.point.y - fs * 0.9} fontSize={fs * 0.95} fontWeight={700} fill="#1c1917" stroke="#fff" strokeWidth={fs * 0.25} paintOrder="stroke">{b.nom}</text>
          </g>
        );
      })}
      <g>
        <rect x={origine.x - fs * 0.9} y={origine.y - fs * 0.9} width={fs * 1.8} height={fs * 1.8} rx={fs * 0.3} fill="#1c1917" />
        <text x={origine.x} y={origine.y + fs * 0.5} textAnchor="middle" fontSize={fs * 1.4} fill="#fbbf24">⚡</text>
        <text x={origine.x + fs * 1.2} y={origine.y - fs * 1.1} textAnchor="start" fontSize={fs} fontWeight={700} fill="#1c1917" stroke="#fff" strokeWidth={fs * 0.25} paintOrder="stroke">Tableau</text>
      </g>
    </svg>
  );
}

// ─── Rapports largeur / hauteur (pour le zoom) ────────────────────────────────────────────────────────────────────
export function ratioElevation(res: ResultatTableauReel, params: ParamsTableauReel): number {
  const ag = agencerGtl(res, params);
  return (ag.largeurMm + 890) / (ag.hauteurMm + 330);
}
export function ratioTableau(res: ResultatTableauReel): number {
  return (78 + res.coffret.modulesParRail * MOD + 150) / (96 + Math.max(1, res.rails.length) * RANGEE + 60);
}
