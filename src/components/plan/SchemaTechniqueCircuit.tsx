"use client";
// src/components/plan/SchemaTechniqueCircuit.tsx
//
// SCHÉMA TECHNIQUE d'un circuit : du tableau jusqu'à chaque appareillage, sous forme de schéma (pas de plan), avec UN trait par
// conducteur aux couleurs normalisées (lib/couleurs-fils.ts) : phase rouge, neutre bleu, terre vert/jaune, retour violet, navette orange.
// La composition de chaque câble vient de conducteursSegment() — la même source que le plan, la 3D, le pré-devis et le suivi.
import { useMemo, useRef, useState } from "react";
import { X, Printer, Download, AlertTriangle, Camera } from "lucide-react";
import type { SegmentCircuit } from "@/lib/maison-types";
import { COULEUR_FIL, LEGENDE_FILS, conducteursSegment, couleurConducteur, libelleLiaison } from "@/lib/couleurs-fils";
import type { GenreNoeud, NoeudSchema } from "@/lib/schema-technique";
import type { VueAppareil } from "@/lib/bornier-appareillage";
import VueAppareilBranchement from "@/components/plan/VueAppareilBranchement";
import { fondModal } from "@/lib/fond-modal";

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
  /** Vue détaillée (bornes) d'un appareil du schéma — un clic sur l'appareil l'ouvre. */
  vueAppareil?: (id: string) => VueAppareil | null;
  /** Photos de chantier du circuit (miniatures cliquables) + ouverture de la galerie. */
  photos?: { id: number; url: string; legende?: string; cle: string; troncon: string; coordonnees?: string }[];
  onPhoto?: (id: number) => void;
  onPhotos?: () => void;
  onClose: () => void;
}

const LARG = 172, COL = 372, MARGE = 28, ECART = 6, GAP_SORTIE = 12, PLACE_ETIQUETTE = 42;
const fmtSection = (s: string) => s.replace(".", ",");
const ROLE_COURT: Record<string, string> = { Neutre: "N", Phase: "Ph", Terre: "PE" };
const HALO = { paintOrder: "stroke", stroke: "#fff", strokeWidth: 3.5, strokeLinejoin: "round" } as const;
const court = (libelle: string) => ROLE_COURT[libelle]
  ?? libelle.replace("Navette 1", "Nav1").replace("Navette 2", "Nav2").replace("Retour", "Ret").replace(" (voie ", " ").replace(")", "");

interface Place { id: string; x: number; y: number; h: number }
/** Emplacement d'un câble sur le bord d'un nœud : décalage du centre de son faisceau par rapport au centre du nœud. */
interface Fente { idx: number; decal: number }

/** Hauteur du faisceau de traits d'un câble (distance entre le premier et le dernier fil). */
const hFaisceau = (sg: SegmentCircuit) => (sg.type === "domotique" ? 0 : (conducteursSegment(sg).length - 1) * ECART);
const hauteurBase = (n: NoeudSchema | undefined) => (n?.genre === "boite" ? 86 : 58 + (n?.lignes?.length ?? 0) * 12);

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
  // Hauteur de chaque nœud : assez haut pour poser côte à côte, sans chevauchement, tous les câbles qui en partent / y arrivent.
  const sortiesDe = (id: string) => segments.map((sg, idx) => ({ sg, idx })).filter(t => t.sg.aId === id);
  const entreesDe = (id: string) => segments.map((sg, idx) => ({ sg, idx })).filter(t => t.sg.bId === id);
  const hNoeud = new Map<string, number>();
  ids.forEach(id => {
    const sorties = sortiesDe(id).reduce((t, x) => t + hFaisceau(x.sg) + GAP_SORTIE, GAP_SORTIE);
    const entrees = entreesDe(id).reduce((t, x) => t + hFaisceau(x.sg) + PLACE_ETIQUETTE, 0) - PLACE_ETIQUETTE + 2 * GAP_SORTIE;
    hNoeud.set(id, Math.max(hauteurBase(noeuds[id]), sorties, entrees));
  });
  const amont = (id: string) => noeuds[id]?.genre === "externe" && id.startsWith("ext-amont");
  // Racines : le tableau d'abord, puis tout nœud sans parent (lampe alimentée en bout de chaîne…) ; les sources d'un autre circuit sont posées à part.
  const racines = ids.filter(id => !cibles.has(id) && !amont(id)).sort((a, b) => (a === "tableau" ? -1 : b === "tableau" ? 1 : 0));
  if (racines.length === 0 && ids.some(id => !amont(id))) racines.push(ids.find(id => !amont(id))!);
  const pos = new Map<string, Place>();
  let curseur = MARGE + 14;
  const prendreLigne = (h: number) => { const c = curseur + h / 2; curseur += h + 56; return c; };
  const poser = (id: string, prof: number): number => {
    if (pos.has(id)) return pos.get(id)!.y + pos.get(id)!.h / 2;
    const h = hNoeud.get(id) ?? 58;
    const p: Place = { id, x: MARGE + prof * COL, y: 0, h };
    pos.set(id, p);
    const fils = (enfants.get(id) ?? []).filter(f => !pos.has(f));
    let centre: number;
    if (fils.length === 0) centre = prendreLigne(h);
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
  ids.filter(amont).forEach(id => {
    const enfant = pos.get((enfants.get(id) ?? [])[0]);
    const h = hNoeud.get(id) ?? 58;
    pos.set(id, { id, x: (enfant?.x ?? MARGE + COL) - COL, y: prendreLigne(h) - h / 2, h });
  });
  const minX = Math.min(MARGE, ...Array.from(pos.values()).map(p => p.x));
  if (minX < MARGE) pos.forEach(p => { p.x += MARGE - minX; });
  const maxX = Math.max(...Array.from(pos.values()).map(p => p.x + LARG), 0);

  // Fentes : chaque câble a SA place sur le bord du nœud (ordre = ordre vertical des nœuds reliés → pas de croisement inutile).
  const centreDe = (id: string) => { const p = pos.get(id); return p ? p.y + p.h / 2 : 0; };
  const fentesSortie = new Map<number, number>();   // idx segment → décalage côté source
  const fentesEntree = new Map<number, number>();   // idx segment → décalage côté cible
  const empiler = (liste: { sg: SegmentCircuit; idx: number }[], reserve: number, table: Map<number, number>) => {
    const total = liste.reduce((t, x) => t + hFaisceau(x.sg) + reserve, 0) - reserve;
    let cur = -total / 2;
    liste.forEach(x => { const hb = hFaisceau(x.sg); table.set(x.idx, cur + hb / 2); cur += hb + reserve; });
  };
  ids.forEach(id => {
    const sorties = sortiesDe(id).sort((u, v) => centreDe(u.sg.bId) - centreDe(v.sg.bId));
    empiler(sorties, GAP_SORTIE, fentesSortie);
    const entrees = entreesDe(id).sort((u, v) => centreDe(u.sg.aId) - centreDe(v.sg.aId));
    empiler(entrees, PLACE_ETIQUETTE, fentesEntree);
  });
  // Colonne verticale (« tronc ») de chaque câble : les câbles qui montent s'emboîtent (le plus bas = le plus à droite), ceux qui descendent aussi.
  const tronc = new Map<number, number>();
  ids.forEach(id => {
    const a = pos.get(id); if (!a) return;
    const sorties = sortiesDe(id).sort((u, v) => centreDe(u.sg.bId) - centreDe(v.sg.bId));
    const yDe = (t: { idx: number }) => a.y + a.h / 2 + (fentesSortie.get(t.idx) ?? 0);
    const yVers = (t: { sg: SegmentCircuit; idx: number }) => centreDe(t.sg.bId) + (fentesEntree.get(t.idx) ?? 0);
    const montent = sorties.filter(t => yVers(t) < yDe(t) - 0.5);
    const descendent = sorties.filter(t => yVers(t) > yDe(t) + 0.5).reverse();
    let x = a.x + LARG + 26;
    const larg = (t: { sg: SegmentCircuit }) => hFaisceau(t.sg) + 12;
    montent.forEach(t => { tronc.set(t.idx, x); x += larg(t); });
    let x2 = a.x + LARG + 26;
    descendent.forEach(t => { tronc.set(t.idx, x2); x2 += larg(t); });
  });
  return { pos, tronc, fentesSortie, fentesEntree, largeur: maxX + MARGE, hauteur: curseur + MARGE - 56 };
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
    // Boîte de dérivation : 3 bornes Wago 221 (levier orange) — une par conducteur commun (phase, neutre, terre).
    const bornes = [{ c: COULEUR_FIL.phase, t: "Ph" }, { c: COULEUR_FIL.neutre, t: "N" }, { c: COULEUR_FIL.terreVert, t: "PE", terre: true }];
    return (<g>
      <rect x={x} y={y} width={LARG} height={h} rx={4} fill="#f5f5f4" stroke="#44403c" strokeWidth={1.8} strokeDasharray="5 3" />
      <rect x={x + 8} y={y + 8} width={22} height={22} rx={3} fill="#fff" stroke="#44403c" strokeWidth={1.2} />
      <circle cx={x + 19} cy={y + 19} r={6} fill="none" stroke="#44403c" strokeWidth={1.2} />
      {bornes.map((b, i) => (
        <g key={b.t} transform={`translate(${x + 40 + i * 42},${y + h - 36})`}>
          <rect x={0} y={4} width={36} height={14} rx={2.5} fill="#e7e5e4" stroke="#a8a29e" strokeWidth={0.8} />
          <rect x={0} y={0} width={36} height={6} rx={2} fill="#f97316" />
          <rect x={4} y={9} width={28} height={4} rx={1} fill={b.c} />
          {b.terre && <rect x={4} y={9} width={28} height={4} rx={1} fill={COULEUR_FIL.terreJaune} opacity={0.9} style={{ clipPath: "inset(0 50% 0 0)" }} />}
          <text x={18} y={29} fontSize={7.5} fontWeight={700} fill="#57534e" textAnchor="middle">{b.t}</text>
        </g>
      ))}
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

/** « Prise salon → Prise cuisine · 3G2,5 mm² » : le tronçon d'un schéma, tel qu'affiché (même règle de section que le dessin). */
export function libelleTroncon(seg: SegmentCircuit, section: string, noeuds: Record<string, NoeudSchema>): string {
  const nom = (id: string) => noeuds[id]?.titre ?? id;
  const n = conducteursSegment(seg).length;
  return `${nom(seg.aId)} → ${nom(seg.bId)} · ${n}G${fmtSection(seg.type || seg.avecRetour ? "1.5" : section)} mm²`;
}

export default function SchemaTechniqueCircuit({ titre, couleurCircuit, descriptionTableau, section, segments, noeuds, avertissements = [], longueurs, vueAppareil, photos = [], onPhoto, onPhotos, onClose }: Props) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = detailId && vueAppareil ? vueAppareil(detailId) : null;
  const svgRef = useRef<SVGSVGElement>(null);
  const { pos, tronc, fentesSortie, fentesEntree, largeur, hauteur } = useMemo(() => disposer(segments, noeuds), [segments, noeuds]);
  const H_LEGENDE = 84;
  const W = Math.max(largeur, 640);
  let yMinPhoto = 0;   // les miniatures de photos peuvent dépasser en haut du dessin : on décale tout pour qu'elles ne soient pas coupées

  const fils: JSX.Element[] = [];
  const etiquettes: JSX.Element[] = [];
  segments.forEach((seg, idx) => {
    const a = pos.get(seg.aId), b = pos.get(seg.bId);
    if (!a || !b) return;
    const cle = `${seg.aId}->${seg.bId}`;
    const x1 = a.x + LARG, x2 = b.x;
    const yc1 = a.y + a.h / 2 + (fentesSortie.get(idx) ?? 0), yc2 = b.y + b.h / 2 + (fentesEntree.get(idx) ?? 0);
    const xmax = Math.max(x1 + 10, x2 - 24);
    const xt = Math.min(tronc.get(idx) ?? x1 + 26, xmax);
    if (seg.type === "domotique") {
      fils.push(<polyline key={`seg-${idx}`} points={`${x1},${yc1} ${xt},${yc1} ${xt},${yc2} ${x2},${yc2}`} fill="none" stroke="#a8a29e" strokeWidth={2} strokeDasharray="3 5" />);
      etiquettes.push(<text key={`lab-${idx}`} x={x2 - 70} y={yc2 - 8} fontSize={10} fill="#78716c" textAnchor="middle" style={HALO}>Liaison sans fil (domotique)</text>);
      return;
    }
    const cond = conducteursSegment(seg);
    const sectionCable = seg.type || seg.avecRetour ? "1.5" : section;
    const descr = `${cond.length}G${fmtSection(sectionCable)}`;
    const lg = longueurs?.[cle];
    const hb = hFaisceau(seg);
    const descendant = yc2 >= yc1;
    cond.forEach((c, i) => {
      const off = (i - (cond.length - 1) / 2) * ECART;
      const xm = xt + (descendant ? -off : off);
      const pts = `${x1},${yc1 + off} ${xm},${yc1 + off} ${xm},${yc2 + off} ${x2},${yc2 + off}`;
      const couleur = couleurConducteur(c.role);
      fils.push(<polyline key={`c-${idx}-${i}`} points={pts} fill="none" stroke={couleur} strokeWidth={3.2} strokeLinejoin="round" />);
      if (c.role === "terre") fils.push(<polyline key={`cj-${idx}-${i}`} points={pts} fill="none" stroke={COULEUR_FIL.terreJaune} strokeWidth={3.2} strokeDasharray="6 6" strokeLinejoin="round" />);
      fils.push(<circle key={`d1-${idx}-${i}`} cx={x1} cy={yc1 + off} r={2.8} fill={couleur} stroke="#fff" strokeWidth={0.8} />);
      fils.push(<circle key={`d2-${idx}-${i}`} cx={x2} cy={yc2 + off} r={2.8} fill={couleur} stroke="#fff" strokeWidth={0.8} />);
    });
    // Étiquette posée au-dessus de la dernière portion horizontale, avec un halo blanc : jamais coupée par un fil voisin.
    const lx = Math.max(xt + 70, (xt + x2) / 2);
    const ly = yc2 - hb / 2 - 26;
    const phs = photos.filter(ph => ph.cle === cle);
    if (phs.length > 0) {
      const TH = 34, vus = phs.slice(0, 3), x0 = lx - (vus.length * (TH + 4) - 4) / 2, y0 = ly - TH - 16;
      yMinPhoto = Math.min(yMinPhoto, y0 - 6);
      etiquettes.push(
        <g key={`ph-${idx}`}>
          <line x1={lx} y1={y0 + TH} x2={lx} y2={ly - 12} stroke={couleurCircuit} strokeWidth={1} strokeDasharray="2 2" />
          {vus.map((ph, i) => (
            <g key={ph.id} style={{ cursor: "pointer" }} onClick={() => onPhoto?.(ph.id)}>
              <title>{`Photo de chantier — ${ph.troncon}${ph.coordonnees ? ` — ${ph.coordonnees}` : ""}`}</title>
              <image href={ph.url} x={x0 + i * (TH + 4)} y={y0} width={TH} height={TH} preserveAspectRatio="xMidYMid slice" />
              <rect x={x0 + i * (TH + 4)} y={y0} width={TH} height={TH} fill="none" stroke={couleurCircuit} strokeWidth={2} rx={3} />
            </g>
          ))}
          {phs.length > 3 && <text x={x0 + 3 * (TH + 4)} y={y0 + TH / 2 + 4} fontSize={11} fontWeight={700} fill="#1c1917">+{phs.length - 3}</text>}
        </g>);
    }
    etiquettes.push(
      <g key={`lab-${idx}`}>
        <text x={lx} y={ly} fontSize={11} fontWeight={700} fill="#1c1917" textAnchor="middle" style={HALO}>{descr}{lg != null ? ` · ${lg.toFixed(1).replace(".", ",")} m` : ""}</text>
        <text x={lx} y={ly + 11} fontSize={8.5} fill="#57534e" textAnchor="middle" style={HALO}>{libelleLiaison(seg)}</text>
        <text x={lx} y={ly + 21} fontSize={7.5} fontWeight={700} textAnchor="middle" style={HALO}>
          {cond.map((c, i) => (
            <tspan key={i} fill={c.role === "terre" ? COULEUR_FIL.terreVert : couleurConducteur(c.role)}>{i > 0 ? " · " : ""}{court(c.libelle)}</tspan>
          ))}
        </text>
      </g>);
  });
  const decalage = -yMinPhoto, Ht = hauteur + H_LEGENDE + decalage;
  const elements = [...fils, ...etiquettes];

  const noeudsDessines = Array.from(pos.values()).map(p => {
    const n = noeuds[p.id] ?? { titre: p.id, genre: "autre" as GenreNoeud };
    const fillTexte = n.genre === "tableau" ? "#fff" : "#1c1917";
    const tx = n.genre === "tableau" ? p.x + 36 : n.genre === "lampe" || n.genre === "commande" ? p.x + 40 : n.genre === "boite" ? p.x + 38 : p.x + 8;
    const maxCar = Math.floor((LARG - (tx - p.x) - 4) / 5.2);
    const coupe = (t: string) => (t.length > maxCar ? t.slice(0, maxCar - 1) + "…" : t);
    const textes = [{ t: n.titre, gras: true }, ...(n.sous ? [{ t: n.sous, gras: false }] : []), ...(n.lignes ?? []).map(t => ({ t, gras: false }))];
    const y0 = n.genre === "boite" ? p.y + 20 : p.y + p.h / 2 - ((textes.length - 1) * 12) / 2 + 3;
    return (
      <g key={`n-${p.id}`} style={n.genre !== "externe" && vueAppareil ? { cursor: "pointer" } : undefined}
        onClick={n.genre !== "externe" && vueAppareil ? () => setDetailId(p.id) : undefined}>
        <title>{n.genre !== "externe" && vueAppareil ? "Cliquer pour voir les branchements borne par borne" : n.titre}</title>
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
    <>
    {detail && <VueAppareilBranchement vue={detail} onClose={() => setDetailId(null)} />}
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-3" {...fondModal(onClose)}>
      <div className="card card-inner !p-0 w-full max-w-[96vw] max-h-[94vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-ink-100">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink-900 truncate">Schéma technique · {titre}</p>
            <p className="text-[11px] text-ink-500 truncate">{descriptionTableau}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onPhotos && <button className="btn-ghost !text-xs" onClick={onPhotos}><Camera size={13} /> Photos{photos.length > 0 ? ` (${photos.length})` : ""}</button>}
            <button className="btn-ghost !text-xs" onClick={imprimer}><Printer size={13} /> Imprimer</button>
            <button className="btn-ghost !text-xs" onClick={telecharger}><Download size={13} /> SVG</button>
            <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="Fermer"><X size={15} /></button>
          </div>
        </div>
        {photos.length > 0 && (
          <div className="flex gap-3 overflow-x-auto px-3 pt-2 pb-1">
            {photos.map(ph => (
              <button key={ph.id} type="button" onClick={() => onPhoto?.(ph.id)} className="flex items-center gap-2 shrink-0 text-left rounded-lg border border-ink-200 pr-2 hover:bg-ink-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ph.url} alt={ph.legende ?? "Photo de chantier"} loading="lazy" className="h-12 w-12 rounded-l-lg object-cover" />
                <span className="text-[10px] leading-tight text-ink-700 max-w-[260px]"><b>{ph.troncon}</b>{ph.coordonnees ? <><br />{ph.coordonnees}</> : null}{ph.legende ? <><br />{ph.legende}</> : null}</span>
              </button>
            ))}
          </div>
        )}
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
              <g transform={`translate(0,${decalage})`}>
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
                <text x={0} y={46} fontSize={9} fill="#78716c">Un trait par conducteur · pastille = point de raccordement · boîte pointillée = 3 bornes Wago 221 (Ph · N · PE) · contour = couleur du circuit · clic sur un appareil = branchements borne par borne · cadre violet pointillé = autre circuit (nom seul) · voie A / B = les deux mécanismes d'une commande double</text>
              </g>
              </g>
            </svg>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
