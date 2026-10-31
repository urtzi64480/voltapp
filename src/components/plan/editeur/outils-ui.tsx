"use client";

// Extrait mécaniquement de src/app/plan/[clientId]/page.tsx (aucun changement de comportement).
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useState, useEffect } from "react";
import { Magnet } from "lucide-react";
import { Point, Piece } from "@/lib/maison-types";
import { geometrieMurs, epaisseurTotaleM } from "@/lib/murs";
import { geometrieCote, Cote, GeoCote, RepereCotes } from "@/lib/appareillage-mur";

// Couche qui suit le curseur : possède elle-même la position (état local) et se redessine seule quand elle bouge.
// `rendu` est recréé à chaque rendu de l'éditeur, donc toujours à jour de son état ; seul le mouvement de souris ne le déclenche pas.
export function CurseurAbonne({ abonnes, initial, rendu }: {
  abonnes: { current: Set<(p: Point | null) => void> };
  initial: Point | null;
  rendu: (cursorPx: Point | null) => ReactNode;
}) {
  const [cursorPx, setCursorLocal] = useState<Point | null>(initial);
  useEffect(() => {
    const ensemble = abonnes.current;
    ensemble.add(setCursorLocal);
    return () => { ensemble.delete(setCursorLocal); };
  }, [abonnes]);
  return <>{rendu(cursorPx)}</>;
}

// Bouton d'outil « icône seule » : le nom complet (et l'aide) s'affiche au survol / au focus clavier dans une infobulle.
export function Outil({ label, aide, actif, primaire, disabled, onClick, badge, children, className = "" }: {
  label: string; aide?: string; actif?: boolean; primaire?: boolean; disabled?: boolean; onClick?: () => void; badge?: number; children: ReactNode; className?: string;
}) {
  const [bulle, setBulle] = useState<{ x: number; y: number } | null>(null);
  const montrer = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    // centré sous le bouton, sans sortir de l'écran (la bulle fait au plus 16 rem ≈ 256 px)
    setBulle({ x: Math.max(136, Math.min(window.innerWidth - 136, r.left + r.width / 2)), y: r.bottom + 8 });
  };
  const etat = primaire ? "bg-volt-500 border-volt-500 text-ink-900 shadow-sm hover:bg-volt-400"
    : actif ? "bg-ink-900 border-ink-900 text-volt-400 shadow-inner"
    : "bg-white border-ink-200 text-ink-600 hover:border-ink-300 hover:text-ink-900 hover:-translate-y-px hover:shadow-md";
  return (
    <button type="button" onClick={() => { setBulle(null); onClick?.(); }} disabled={disabled} aria-label={label} aria-pressed={actif}
      onMouseEnter={e => montrer(e.currentTarget)} onMouseLeave={() => setBulle(null)} onFocus={e => montrer(e.currentTarget)} onBlur={() => setBulle(null)}
      className={`relative inline-flex h-9 min-w-[2.25rem] items-center justify-center gap-0.5 rounded-xl border px-2 transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-35 ${etat} ${className}`}>
      {children}
      {badge != null && <span className="absolute -right-1.5 -top-1.5 grid h-[1.1rem] min-w-[1.1rem] place-items-center rounded-full bg-volt-500 px-1 text-[10px] font-bold text-ink-900">{badge}</span>}
      {/* Infobulle dans <body> (portail) en position fixe : aucun parent (barre, panneaux, plan) ne peut la recouvrir ni la rogner. */}
      {bulle && typeof document !== "undefined" && createPortal(
        <div role="tooltip" popover="manual"
          ref={el => { try { el?.showPopover?.(); } catch { /* déjà ouvert / non supporté : le z-index très haut prend le relais */ } }}
          style={{ position: "fixed", inset: "auto", margin: 0, left: bulle.x, top: bulle.y, transform: "translateX(-50%)", zIndex: 2147483647, backgroundColor: "#1c1917", color: "#fff", pointerEvents: "none", overflow: "visible", border: 0 }}
          className="w-max max-w-[16rem] rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium leading-snug shadow-xl ring-1 ring-black/20">
          {label}{aide && <span className="mt-0.5 block text-[10px] font-normal" style={{ color: "#d6d3d1" }}>{aide}</span>}
        </div>, document.body)}
    </button>
  );
}

export function ReglageAimant({ pasCm, setPasCm, aimant, setAimant, murs, setMurs }: { pasCm: number; setPasCm: (v: number) => void; aimant: boolean; setAimant: (v: boolean) => void; murs: boolean; setMurs: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => setAimant(!aimant)} className={`btn-ghost !px-2 !py-1 !text-xs ${aimant ? "!bg-ink-900 !text-volt-400" : ""}`}
        title="Aimant : aimanter aux sommets des autres pièces (maintenir Alt pour désactiver momentanément)" aria-label="Aimant"><Magnet size={13} /></button>
      <button onClick={() => setMurs(!murs)} className={`btn-ghost !px-2 !py-1 !text-xs ${murs ? "!bg-ink-900 !text-volt-400" : ""}`}
        title="Aligner automatiquement les segments créés ou déplacés sur les murs adjacents : horizontal/vertical, parallèle, perpendiculaire, prolongement (maintenir Alt pour désactiver momentanément)" aria-label="Alignement sur les murs"><span className="font-bold leading-none">∥</span></button>
      <select value={pasCm} onChange={e => setPasCm(Number(e.target.value))} title="Pas de placement"
        className="rounded-lg border border-ink-200 bg-white px-1 py-1 text-xs text-ink-900">
        <option value={1}>1 cm</option>
        <option value={5}>5 cm</option>
        <option value={10}>10 cm</option>
      </select>
    </div>
  );
}

// Repère de lecture des cotes d'une pièce : face intérieure finie des murs (ce qu'on mesure sur place).
export function repereCotes(piece: Piece): RepereCotes {
  const g = geometrieMurs(piece);
  return { utile: g.utile, utileFin: g.utileFin, epaisseurTotaleM: i => epaisseurTotaleM(piece, i) };
}

// Rendu d'une cote sur le plan 2D : ligne de cote décalée hors de la pièce (appareillage au
// mur) avec traits d'attache et repères en bout, ou simple trait appareillage → mur
// (appareillage libre) ; valeur en cm au milieu, jamais à l'envers, sur halo blanc.
export const COULEUR_COTE = "#0369A1";
export function CoteSvg({ g }: { g: GeoCote }) {
  const dx = g.b2.x - g.a2.x, dy = g.b2.y - g.a2.y;
  const l = Math.hypot(dx, dy) || 1;
  const tx = -dy / l * 3, ty = dx / l * 3; // demi-repère perpendiculaire à la ligne de cote
  return (
    <g style={{ pointerEvents: "none" }}>
      {g.kind === "mur" ? (
        <>
          <line x1={g.A.x} y1={g.A.y} x2={g.a2.x} y2={g.a2.y} stroke={COULEUR_COTE} strokeWidth={0.7} opacity={0.6} />
          <line x1={g.B.x} y1={g.B.y} x2={g.b2.x} y2={g.b2.y} stroke={COULEUR_COTE} strokeWidth={0.7} opacity={0.6} />
          <line x1={g.a2.x} y1={g.a2.y} x2={g.b2.x} y2={g.b2.y} stroke={COULEUR_COTE} strokeWidth={1} />
          <line x1={g.a2.x - tx} y1={g.a2.y - ty} x2={g.a2.x + tx} y2={g.a2.y + ty} stroke={COULEUR_COTE} strokeWidth={1.2} />
          <line x1={g.b2.x - tx} y1={g.b2.y - ty} x2={g.b2.x + tx} y2={g.b2.y + ty} stroke={COULEUR_COTE} strokeWidth={1.2} />
        </>
      ) : (
        <>
          <line x1={g.A.x} y1={g.A.y} x2={g.B.x} y2={g.B.y} stroke={COULEUR_COTE} strokeWidth={1} strokeDasharray="3,2" />
          <circle cx={g.A.x} cy={g.A.y} r={1.8} fill={COULEUR_COTE} />
          <circle cx={g.B.x} cy={g.B.y} r={1.8} fill={COULEUR_COTE} />
        </>
      )}
      {/* halo blanc dessiné à part (puis le texte par-dessus) : lisible sur n'importe quel fond, sans dépendre de paint-order */}
      <g transform={`translate(${g.mid.x} ${g.mid.y}) rotate(${g.angle})`} textAnchor="middle" fontSize={9.5} fontWeight={600} fontFamily="monospace">
        <text dominantBaseline="central" fill="none" stroke="#fff" strokeWidth={3.2} strokeLinejoin="round">{g.txt}</text>
        <text dominantBaseline="central" fill={COULEUR_COTE}>{g.txt}</text>
      </g>
    </g>
  );
}

// Même cote pour la fenêtre d'impression (chaîne SVG, hors React).
export function coteSvgString(c: Cote, toS: (p: Point) => Point): string {
  const g = geometrieCote(c, toS, 8);
  if (!g) return "";
  const col = COULEUR_COTE, f = (n: number) => n.toFixed(1);
  let out = "";
  if (g.kind === "mur") {
    const dx = g.b2.x - g.a2.x, dy = g.b2.y - g.a2.y, l = Math.hypot(dx, dy) || 1;
    const tx = -dy / l * 2.2, ty = dx / l * 2.2;
    out += `<line x1="${f(g.A.x)}" y1="${f(g.A.y)}" x2="${f(g.a2.x)}" y2="${f(g.a2.y)}" stroke="${col}" stroke-width="0.4" opacity="0.6"/>`;
    out += `<line x1="${f(g.B.x)}" y1="${f(g.B.y)}" x2="${f(g.b2.x)}" y2="${f(g.b2.y)}" stroke="${col}" stroke-width="0.4" opacity="0.6"/>`;
    out += `<line x1="${f(g.a2.x)}" y1="${f(g.a2.y)}" x2="${f(g.b2.x)}" y2="${f(g.b2.y)}" stroke="${col}" stroke-width="0.6"/>`;
    out += `<line x1="${f(g.a2.x - tx)}" y1="${f(g.a2.y - ty)}" x2="${f(g.a2.x + tx)}" y2="${f(g.a2.y + ty)}" stroke="${col}" stroke-width="0.8"/>`;
    out += `<line x1="${f(g.b2.x - tx)}" y1="${f(g.b2.y - ty)}" x2="${f(g.b2.x + tx)}" y2="${f(g.b2.y + ty)}" stroke="${col}" stroke-width="0.8"/>`;
  } else {
    out += `<line x1="${f(g.A.x)}" y1="${f(g.A.y)}" x2="${f(g.B.x)}" y2="${f(g.B.y)}" stroke="${col}" stroke-width="0.6" stroke-dasharray="2,1.5"/>`;
  }
  const tf = `translate(${f(g.mid.x)} ${f(g.mid.y)}) rotate(${f(g.angle)})`;
  out += `<g transform="${tf}" text-anchor="middle" font-size="5.5" font-weight="bold" font-family="monospace">`
    + `<text dominant-baseline="central" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round">${g.txt}</text>`
    + `<text dominant-baseline="central" fill="${col}">${g.txt}</text></g>`;
  return out;
}

export function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
