"use client";
// src/components/plan/SchemaTechniqueCircuit.tsx
//
// SCHÉMA TECHNIQUE d'un circuit : du tableau jusqu'à chaque appareillage, sous forme de schéma (pas de plan), avec UN trait par
// conducteur aux couleurs normalisées (lib/couleurs-fils.ts) : phase rouge, neutre bleu, terre vert/jaune, retour violet, navette orange.
// Les segments viennent de segmentsPourCircuit : c'est exactement le câblage du plan, présenté en arbre de gauche à droite.
import { useMemo, useRef } from "react";
import { X, Printer, Download } from "lucide-react";
import type { SegmentCircuit } from "@/lib/maison-types";
import { CONDUCTEURS, COULEUR_FIL, LEGENDE_FILS, couleurConducteur, natureLiaison } from "@/lib/couleurs-fils";

export type GenreNoeud = "tableau" | "boite" | "lampe" | "commande" | "autre";
export interface NoeudSchema { titre: string; sous?: string; genre: GenreNoeud }

interface Props {
  titre: string;
  couleurCircuit: string;
  /** Ex. « Disjoncteur 10 A · section 1,5 mm² » */
  descriptionTableau: string;
  section: string;
  segments: SegmentCircuit[];
  noeuds: Record<string, NoeudSchema>;
  /** Longueur réelle par clé « aId->bId » (m), si connue. */
  longueurs?: Record<string, number>;
  onClose: () => void;
}

const LARG = 150, HAUT = 58, COL = 330, LIGNE = 104, MARGE = 28, ECART = 6;
const NATURE_COURTE = { alimentation: "Alimentation", retour: "Retour commande → lampe", retour_phase: "Phase + retour", navette: "Navette", navette_neutre: "Navette + neutre", navette_neutre_double: "2 navettes + neutre" } as const;
const ROLE_COURT: Record<string, string> = { "Navette 1": "Nav.1", "Navette 2": "Nav.2", "Navette 1 (voie A)": "A1", "Navette 2 (voie A)": "A2", "Navette 1 (voie B)": "B1", "Navette 2 (voie B)": "B2" };
const fmtSection = (s: string) => s.replace(".", ",");

interface Place { id: string; x: number; y: number }

function disposer(segments: SegmentCircuit[], noeuds: Record<string, NoeudSchema>) {
  const enfants = new Map<string, string[]>();
  const cibles = new Set<string>();
  const ids: string[] = [];
  const ajouter = (id: string) => { if (!ids.includes(id)) ids.push(id); };
  segments.forEach(s => {
    ajouter(s.aId); ajouter(s.bId);
    cibles.add(s.bId);
    const l = enfants.get(s.aId) ?? [];
    if (!l.includes(s.bId)) l.push(s.bId);
    enfants.set(s.aId, l);
  });
  // Racines : le tableau d'abord, puis tout nœud sans parent (lampe alimentée en bout de chaîne…).
  const racines = ids.filter(id => !cibles.has(id)).sort((a, b) => (a === "tableau" ? -1 : b === "tableau" ? 1 : 0));
  if (racines.length === 0 && ids.length > 0) racines.push(ids[0]);
  const pos = new Map<string, Place>();
  let ligne = 0;
  const poser = (id: string, prof: number): number => {
    if (pos.has(id)) return pos.get(id)!.y;
    pos.set(id, { id, x: MARGE + prof * COL, y: 0 }); // réserve (évite les boucles)
    const fils = (enfants.get(id) ?? []).filter(f => !pos.has(f));
    let y: number;
    if (fils.length === 0) { y = MARGE + ligne * LIGNE; ligne++; }
    else {
      const ys = fils.map(f => poser(f, prof + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    pos.get(id)!.y = y;
    return y;
  };
  racines.forEach(r => poser(r, 0));
  ids.forEach(id => { if (!pos.has(id)) poser(id, 0); });
  void noeuds;
  const profMax = Math.max(0, ...Array.from(pos.values()).map(p => Math.round((p.x - MARGE) / COL)));
  return { pos, largeur: MARGE * 2 + profMax * COL + LARG, hauteur: MARGE * 2 + Math.max(1, ligne) * LIGNE };
}

function Symbole({ genre, x, y, couleur }: { genre: GenreNoeud; x: number; y: number; couleur: string }) {
  const cx = x + LARG / 2, cy = y + HAUT / 2;
  if (genre === "lampe") {
    return (<g>
      <rect x={x} y={y} width={LARG} height={HAUT} rx={10} fill="#fff" stroke={couleur} strokeWidth={2.4} />
      <circle cx={x + 22} cy={cy} r={12} fill="#fff" stroke="#44403c" strokeWidth={1.6} />
      <path d={`M${x + 14},${cy - 8} L${x + 30},${cy + 8} M${x + 30},${cy - 8} L${x + 14},${cy + 8}`} stroke="#44403c" strokeWidth={1.6} />
    </g>);
  }
  if (genre === "commande") {
    return (<g>
      <rect x={x} y={y} width={LARG} height={HAUT} rx={6} fill="#fff" stroke={couleur} strokeWidth={2.4} />
      <circle cx={x + 22} cy={cy + 3} r={4.5} fill="#44403c" />
      <path d={`M${x + 22},${cy + 3} L${x + 34},${cy - 10}`} stroke="#44403c" strokeWidth={2} />
    </g>);
  }
  if (genre === "boite") {
    return (<g>
      <rect x={x} y={y} width={LARG} height={HAUT} rx={4} fill="#f5f5f4" stroke="#44403c" strokeWidth={1.8} strokeDasharray="5 3" />
      <circle cx={x + 20} cy={cy} r={9} fill="#fff" stroke="#44403c" strokeWidth={1.4} />
    </g>);
  }
  if (genre === "tableau") {
    return (<g>
      <rect x={x} y={y} width={LARG} height={HAUT} rx={4} fill="#1c1917" stroke={couleur} strokeWidth={3} />
      <rect x={x + 12} y={y + 12} width={14} height={34} rx={2} fill="#e7e5e4" /><rect x={x + 14} y={y + 14} width={10} height={14} rx={1} fill="#44403c" />
    </g>);
  }
  return <rect x={x} y={y} width={LARG} height={HAUT} rx={6} fill="#fff" stroke={couleur} strokeWidth={2.4} />;
}

export default function SchemaTechniqueCircuit({ titre, couleurCircuit, descriptionTableau, section, segments, noeuds, longueurs, onClose }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { pos, largeur, hauteur } = useMemo(() => disposer(segments, noeuds), [segments, noeuds]);
  const H_LEGENDE = 70;
  const W = Math.max(largeur, 640), Ht = hauteur + H_LEGENDE;

  // Fratries : décale légèrement les coudes des câbles qui partent d'un même nœud pour qu'ils ne se superposent pas.
  const rangFratrie = new Map<string, number>();
  const compteur = new Map<string, number>();
  segments.forEach(s => { const k = compteur.get(s.aId) ?? 0; rangFratrie.set(`${s.aId}->${s.bId}`, k); compteur.set(s.aId, k + 1); });

  const elements: JSX.Element[] = [];
  segments.forEach((seg, idx) => {
    const a = pos.get(seg.aId), b = pos.get(seg.bId);
    if (!a || !b) return;
    const cle = `${seg.aId}->${seg.bId}`;
    const x1 = a.x + LARG, y1 = a.y + HAUT / 2, x2 = b.x, y2 = b.y + HAUT / 2;
    if (seg.type === "domotique") {
      const xm = x1 + 30 + (rangFratrie.get(cle) ?? 0) * 10;
      elements.push(
        <g key={`seg-${idx}`}>
          <polyline points={`${x1},${y1} ${xm},${y1} ${xm},${y2} ${x2},${y2}`} fill="none" stroke="#a8a29e" strokeWidth={2} strokeDasharray="3 5" />
          <text x={(xm + x2) / 2} y={y2 - 8} fontSize={10} fill="#78716c" textAnchor="middle">Liaison sans fil (domotique)</text>
        </g>);
      return;
    }
    const nature = natureLiaison(seg);
    const cond = CONDUCTEURS[nature];
    const sectionCable = nature === "alimentation" ? section : "1.5";
    const descr = `${cond.length}G${fmtSection(sectionCable)}`;
    const lg = longueurs?.[cle];
    const descendant = y2 >= y1;
    const base = x1 + 34 + (rangFratrie.get(cle) ?? 0) * 12;
    const xmBase = Math.min(base, Math.max(x1 + 10, x2 - 20));
    cond.forEach((c, i) => {
      const off = (i - (cond.length - 1) / 2) * ECART;
      const xm = xmBase + (descendant ? -off : off);
      const pts = `${x1},${y1 + off} ${xm},${y1 + off} ${xm},${y2 + off} ${x2},${y2 + off}`;
      const couleur = couleurConducteur(c.role);
      elements.push(<polyline key={`c-${idx}-${i}`} points={pts} fill="none" stroke={couleur} strokeWidth={3.2} strokeLinejoin="round" />);
      if (c.role === "terre") elements.push(<polyline key={`cj-${idx}-${i}`} points={pts} fill="none" stroke={COULEUR_FIL.terreJaune} strokeWidth={3.2} strokeDasharray="6 6" strokeLinejoin="round" />);
      elements.push(<circle key={`d1-${idx}-${i}`} cx={x1} cy={y1 + off} r={2.8} fill={couleur} stroke="#fff" strokeWidth={0.8} />);
      elements.push(<circle key={`d2-${idx}-${i}`} cx={x2} cy={y2 + off} r={2.8} fill={couleur} stroke="#fff" strokeWidth={0.8} />);
    });
    // Étiquette du câble au-dessus du faisceau, près de l'arrivée : section, longueur, nature, puis rôle de chaque fil (dans sa couleur).
    const lx = x2 - 88;
    const ly = Math.min(y1, y2) - ((cond.length - 1) / 2) * ECART - 26;
    elements.push(
      <g key={`lab-${idx}`}>
        <text x={lx} y={ly} fontSize={11} fontWeight={700} fill="#1c1917" textAnchor="middle">{descr}{lg != null ? ` · ${lg.toFixed(1)} m` : ""}</text>
        <text x={lx} y={ly + 10} fontSize={8.5} fill="#57534e" textAnchor="middle">{NATURE_COURTE[nature]}</text>
        <text x={lx} y={ly + 20} fontSize={8} fontWeight={700} textAnchor="middle">
          {cond.map((c, i) => (
            <tspan key={i} fill={c.role === "terre" ? COULEUR_FIL.terreVert : couleurConducteur(c.role)}>{i > 0 ? " · " : ""}{ROLE_COURT[c.libelle] ?? c.libelle}</tspan>
          ))}
        </text>
      </g>);
  });

  const noeudsDessines = Array.from(pos.values()).map(p => {
    const n = noeuds[p.id] ?? { titre: p.id, genre: "autre" as GenreNoeud };
    const fillTexte = n.genre === "tableau" ? "#fff" : "#1c1917";
    const tx = n.genre === "tableau" ? p.x + 36 : n.genre === "lampe" || n.genre === "commande" ? p.x + 42 : n.genre === "boite" ? p.x + 36 : p.x + 8;
    const maxCar = Math.floor((LARG - (tx - p.x) - 4) / 5.4);
    const coupe = (t: string) => (t.length > maxCar ? t.slice(0, maxCar - 1) + "…" : t);
    return (
      <g key={`n-${p.id}`}>
        <Symbole genre={n.genre} x={p.x} y={p.y} couleur={couleurCircuit} />
        <text x={tx} y={p.y + HAUT / 2 - 2} fontSize={10.5} fontWeight={700} fill={fillTexte}>{coupe(n.titre)}</text>
        {n.sous && <text x={tx} y={p.y + HAUT / 2 + 11} fontSize={9} fill={n.genre === "tableau" ? "#d6d3d1" : "#57534e"}>{coupe(n.sous)}</text>}
      </g>
    );
  });

  const svgTexte = () => svgRef.current ? new XMLSerializer().serializeToString(svgRef.current) : "";
  const imprimer = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><title>${titre.replace(/</g, "&lt;")}</title><style>@page{size:A3 landscape;margin:10mm}body{margin:0;font-family:sans-serif}svg{width:100%;height:auto}</style>${svgTexte()}`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  };
  const telecharger = () => {
    const blob = new Blob([svgTexte()], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `schema-technique-${titre.replace(/[^\w-]+/g, "_")}.svg`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-3" onClick={onClose}>
      <div className="card card-inner !p-0 w-full max-w-[96vw] max-h-[94vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-ink-100">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink-900 truncate">Schéma technique · {titre}</p>
            <p className="text-[11px] text-ink-500 truncate">{descriptionTableau}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button className="btn-ghost !text-xs" onClick={imprimer}><Printer size={13} /> Imprimer</button>
            <button className="btn-ghost !text-xs" onClick={telecharger}><Download size={13} /> SVG</button>
            <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="Fermer"><X size={15} /></button>
          </div>
        </div>
        <div className="overflow-auto p-3 bg-white">
          {segments.length === 0 ? (
            <p className="text-sm text-ink-500 p-6">Ce circuit n'a encore aucune liaison à représenter : place des appareillages sur le circuit.</p>
          ) : (
            <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${Ht}`} width={W} height={Ht} style={{ maxWidth: "none", fontFamily: "system-ui, sans-serif", background: "#fff" }}>
              <rect x={0} y={0} width={W} height={Ht} fill="#fff" />
              {elements}
              {noeudsDessines}
              <g transform={`translate(${MARGE},${hauteur + 6})`}>
                <text x={0} y={10} fontSize={10} fontWeight={700} fill="#1c1917">Couleur des fils</text>
                {LEGENDE_FILS.map((f, i) => (
                  <g key={f.libelle} transform={`translate(${i * 110},24)`}>
                    <line x1={0} y1={0} x2={26} y2={0} stroke={f.terre ? COULEUR_FIL.terreVert : f.couleur} strokeWidth={4} />
                    {f.terre && <line x1={0} y1={0} x2={26} y2={0} stroke={COULEUR_FIL.terreJaune} strokeWidth={4} strokeDasharray="5 5" />}
                    <text x={32} y={3.5} fontSize={10} fill="#44403c">{f.libelle}</text>
                  </g>
                ))}
                <text x={0} y={46} fontSize={9} fill="#78716c">Un trait par conducteur · chaque pastille = point de raccordement · contour des appareils = couleur du circuit</text>
              </g>
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
