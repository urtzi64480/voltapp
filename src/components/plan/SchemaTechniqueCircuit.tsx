"use client";
// src/components/plan/SchemaTechniqueCircuit.tsx
//
// SCHÉMA TECHNIQUE d'un circuit : du tableau jusqu'à chaque appareillage, sous forme de schéma (pas de plan), avec UN trait par
// conducteur aux couleurs normalisées (lib/couleurs-fils.ts) : phase rouge, neutre bleu, terre vert/jaune, retour violet, navette orange.
// La composition de chaque câble vient de conducteursSegment() — la même source que le plan, la 3D, le pré-devis et le suivi.
import { useMemo, useRef } from "react";
import { X, Printer, Download, AlertTriangle } from "lucide-react";
import type { SegmentCircuit } from "@/lib/maison-types";
import { COULEUR_FIL, LEGENDE_FILS, conducteursSegment, couleurConducteur, libelleLiaison } from "@/lib/couleurs-fils";
import type { GenreNoeud, NoeudSchema } from "@/lib/schema-technique";

interface Props {
  titre: string;
  couleurCircuit: string;
  /** Ex. « Disjoncteur 10 A · câble 1,5 mm² » */
  descriptionTableau: string;
  section: string;
  segments: SegmentCircuit[];
  noeuds: Record<string, NoeudSchema>;
  avertissements?: string[];
  /** Longueur réelle par clé « aId->bId » (m), si connue. */
  longueurs?: Record<string, number>;
  onClose: () => void;
}

const LARG = 156, COL = 340, LIGNE = 112, MARGE = 28, ECART = 6;
const fmtSection = (s: string) => s.replace(".", ",");
const hauteurNoeud = (n: NoeudSchema | undefined) => 58 + Math.max(0, (n?.lignes?.length ?? 0) - 0) * 12;
const ROLE_COURT: Record<string, string> = { Neutre: "N", Phase: "Ph", Terre: "PE" };
const court = (libelle: string) => ROLE_COURT[libelle]
  ?? libelle.replace("Navette 1", "Nav1").replace("Navette 2", "Nav2").replace("Retour", "Ret").replace(" (voie ", " ").replace(")", "");

interface Place { id: string; x: number; y: number; h: number }

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
  const amont = (id: string) => noeuds[id]?.genre === "externe" && id.startsWith("ext-amont");
  // Racines : le tableau d'abord, puis tout nœud sans parent (lampe alimentée en bout de chaîne…) ; les sources d'un autre circuit sont posées à part.
  const racines = ids.filter(id => !cibles.has(id) && !amont(id)).sort((a, b) => (a === "tableau" ? -1 : b === "tableau" ? 1 : 0));
  if (racines.length === 0 && ids.some(id => !amont(id))) racines.push(ids.find(id => !amont(id))!);
  const pos = new Map<string, Place>();
  let ligne = 0;
  const poser = (id: string, prof: number): number => {
    if (pos.has(id)) return pos.get(id)!.y + pos.get(id)!.h / 2;
    const h = hauteurNoeud(noeuds[id]);
    const p: Place = { id, x: MARGE + prof * COL, y: 0, h };
    pos.set(id, p);
    const fils = (enfants.get(id) ?? []).filter(f => !pos.has(f));
    let centre: number;
    if (fils.length === 0) { centre = MARGE + ligne * LIGNE + 40; ligne++; }
    else {
      const cs = fils.map(f => poser(f, prof + 1));
      centre = (cs[0] + cs[cs.length - 1]) / 2;
    }
    p.y = centre - h / 2;
    return centre;
  };
  racines.forEach(r => poser(r, 0));
  ids.filter(id => !amont(id)).forEach(id => { if (!pos.has(id)) poser(id, 0); });
  // Sources d'un autre circuit : sur leur propre rangée, une colonne avant la lampe qu'elles commandent.
  const sources = ids.filter(amont);
  sources.forEach(id => {
    const enfant = pos.get((enfants.get(id) ?? [])[0]);
    const h = hauteurNoeud(noeuds[id]);
    pos.set(id, { id, x: (enfant?.x ?? MARGE + COL) - COL, y: MARGE + ligne * LIGNE + 40 - h / 2, h });
    ligne++;
  });
  const minX = Math.min(MARGE, ...Array.from(pos.values()).map(p => p.x));
  if (minX < MARGE) pos.forEach(p => { p.x += MARGE - minX; });
  const maxX = Math.max(...Array.from(pos.values()).map(p => p.x + LARG), 0);
  return { pos, largeur: maxX + MARGE, hauteur: MARGE * 2 + Math.max(1, ligne) * LIGNE };
}

function Symbole({ genre, x, y, h, couleur }: { genre: GenreNoeud; x: number; y: number; h: number; couleur: string }) {
  const cy = y + h / 2;
  if (genre === "lampe") {
    return (<g>
      <rect x={x} y={y} width={LARG} height={h} rx={10} fill="#fff" stroke={couleur} strokeWidth={2.4} />
      <circle cx={x + 22} cy={cy} r={12} fill="#fff" stroke="#44403c" strokeWidth={1.6} />
      <path d={`M${x + 14},${cy - 8} L${x + 30},${cy + 8} M${x + 30},${cy - 8} L${x + 14},${cy + 8}`} stroke="#44403c" strokeWidth={1.6} />
    </g>);
  }
  if (genre === "commande") {
    return (<g>
      <rect x={x} y={y} width={LARG} height={h} rx={6} fill="#fff" stroke={couleur} strokeWidth={2.4} />
      <circle cx={x + 20} cy={cy + 4} r={4.5} fill="#44403c" />
      <path d={`M${x + 20},${cy + 4} L${x + 32},${cy - 9}`} stroke="#44403c" strokeWidth={2} />
    </g>);
  }
  if (genre === "boite") {
    return (<g>
      <rect x={x} y={y} width={LARG} height={h} rx={4} fill="#f5f5f4" stroke="#44403c" strokeWidth={1.8} strokeDasharray="5 3" />
      <circle cx={x + 20} cy={cy} r={9} fill="#fff" stroke="#44403c" strokeWidth={1.4} />
    </g>);
  }
  if (genre === "tableau") {
    return (<g>
      <rect x={x} y={y} width={LARG} height={h} rx={4} fill="#1c1917" stroke={couleur} strokeWidth={3} />
      <rect x={x + 12} y={cy - 17} width={14} height={34} rx={2} fill="#e7e5e4" /><rect x={x + 14} y={cy - 15} width={10} height={14} rx={1} fill="#44403c" />
    </g>);
  }
  if (genre === "externe") {
    return <rect x={x} y={y} width={LARG} height={h} rx={8} fill="#faf5ff" stroke="#7e22ce" strokeWidth={1.8} strokeDasharray="2 4" />;
  }
  return <rect x={x} y={y} width={LARG} height={h} rx={6} fill="#fff" stroke={couleur} strokeWidth={2.4} />;
}

export default function SchemaTechniqueCircuit({ titre, couleurCircuit, descriptionTableau, section, segments, noeuds, avertissements = [], longueurs, onClose }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { pos, largeur, hauteur } = useMemo(() => disposer(segments, noeuds), [segments, noeuds]);
  const H_LEGENDE = 70;
  const W = Math.max(largeur, 640), Ht = hauteur + H_LEGENDE;

  const rangFratrie = new Map<string, number>();
  const compteur = new Map<string, number>();
  segments.forEach(s => { const k = compteur.get(s.aId) ?? 0; rangFratrie.set(`${s.aId}->${s.bId}`, k); compteur.set(s.aId, k + 1); });

  const elements: JSX.Element[] = [];
  segments.forEach((seg, idx) => {
    const a = pos.get(seg.aId), b = pos.get(seg.bId);
    if (!a || !b) return;
    const cle = `${seg.aId}->${seg.bId}`;
    const x1 = a.x + LARG, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
    const rang = rangFratrie.get(cle) ?? 0;
    if (seg.type === "domotique") {
      const xm = x1 + 30 + rang * 10;
      elements.push(
        <g key={`seg-${idx}`}>
          <polyline points={`${x1},${y1} ${xm},${y1} ${xm},${y2} ${x2},${y2}`} fill="none" stroke="#a8a29e" strokeWidth={2} strokeDasharray="3 5" />
          <text x={x2 - 80} y={y2 - 8} fontSize={10} fill="#78716c" textAnchor="middle">Liaison sans fil (domotique)</text>
        </g>);
      return;
    }
    const cond = conducteursSegment(seg);
    const sectionCable = seg.type || seg.avecRetour ? "1.5" : section;
    const descr = `${cond.length}G${fmtSection(sectionCable)}`;
    const lg = longueurs?.[cle];
    const descendant = y2 >= y1;
    const base = x1 + 34 + rang * 12;
    const xmBase = Math.min(base, Math.max(x1 + 10, x2 - 20));
    const hGroupe = ((cond.length - 1) / 2) * ECART;
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
    const lx = x2 - 78;
    const ly = Math.min(y1, y2) - hGroupe - 28;
    elements.push(
      <g key={`lab-${idx}`}>
        <text x={lx} y={ly} fontSize={11} fontWeight={700} fill="#1c1917" textAnchor="middle">{descr}{lg != null ? ` · ${lg.toFixed(1)} m` : ""}</text>
        <text x={lx} y={ly + 10} fontSize={8.5} fill="#57534e" textAnchor="middle">{libelleLiaison(seg)}</text>
        <text x={lx} y={ly + 20} fontSize={7.5} fontWeight={700} textAnchor="middle">
          {cond.map((c, i) => (
            <tspan key={i} fill={c.role === "terre" ? COULEUR_FIL.terreVert : couleurConducteur(c.role)}>{i > 0 ? " · " : ""}{court(c.libelle)}</tspan>
          ))}
        </text>
      </g>);
  });

  const noeudsDessines = Array.from(pos.values()).map(p => {
    const n = noeuds[p.id] ?? { titre: p.id, genre: "autre" as GenreNoeud };
    const fillTexte = n.genre === "tableau" ? "#fff" : "#1c1917";
    const tx = n.genre === "tableau" ? p.x + 36 : n.genre === "lampe" || n.genre === "commande" || n.genre === "boite" ? p.x + 40 : p.x + 8;
    const maxCar = Math.floor((LARG - (tx - p.x) - 4) / 5.2);
    const coupe = (t: string) => (t.length > maxCar ? t.slice(0, maxCar - 1) + "…" : t);
    const textes = [{ t: n.titre, gras: true }, ...(n.sous ? [{ t: n.sous, gras: false }] : []), ...(n.lignes ?? []).map(t => ({ t, gras: false }))];
    const y0 = p.y + p.h / 2 - ((textes.length - 1) * 12) / 2 + 3;
    return (
      <g key={`n-${p.id}`}>
        <Symbole genre={n.genre} x={p.x} y={p.y} h={p.h} couleur={couleurCircuit} />
        {textes.map((tt, i) => (
          <text key={i} x={tx} y={y0 + i * 12} fontSize={i === 0 ? 10.5 : 9} fontWeight={tt.gras ? 700 : 400}
            fill={i === 0 ? fillTexte : n.genre === "tableau" ? "#d6d3d1" : "#57534e"}>{coupe(tt.t)}</text>
        ))}
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
        {avertissements.length > 0 && (
          <div className="mx-3 mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5" role="alert">
            {avertissements.map((t, i) => (
              <p key={i} className="text-[11px] text-amber-900 flex gap-1.5"><AlertTriangle size={12} className="shrink-0 mt-0.5" />{t}</p>
            ))}
          </div>
        )}
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
                <text x={0} y={46} fontSize={9} fill="#78716c">Un trait par conducteur · pastille = point de raccordement · contour = couleur du circuit · cadre violet pointillé = autre circuit (nom seul) · voie A / B = les deux mécanismes d'une commande double</text>
              </g>
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
