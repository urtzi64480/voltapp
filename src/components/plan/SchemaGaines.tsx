"use client";
// Schéma technique des gaines optimisées : tableau → gaines → boîtes de dérivation → TOUS les circuits, niveau par niveau.
// Lecture de gauche à droite ; chaque circuit est une ligne à droite (disjoncteur, section, longueur de câble).

import { couleurGroupe, type BoiteGaine, type CircuitGaine, type GroupeGaines, type TronconArbre } from "@/lib/gaines-optimisees";
import type { GainesNiveau } from "@/lib/gaines-optimisees-plan";

const fmt = (v: number, d = 1) => v.toFixed(d).replace(".", ",");
const LIGNE = 38, X_TABLEAU = 8, W_TABLEAU = 74, X_ARBRE = 110, DX = 200, X_FEUILLE_MINI = 380, W_LABEL = 300, ENTETE = 30;

interface Noeud { id: string; t: TronconArbre; enfants: Noeud[]; y: number; x: number; feuille?: CircuitGaine; boite?: BoiteGaine }

function profondeur(n: Noeud): number { return n.enfants.length === 0 ? 0 : 1 + Math.max(...n.enfants.map(profondeur)); }

function construire(gr: GroupeGaines, boites: BoiteGaine[]): Noeud {
  const parParent = new Map<string | null, TronconArbre[]>();
  gr.troncons.forEach(t => parParent.set(t.parent, [...(parParent.get(t.parent) ?? []), t]));
  const noeud = (t: TronconArbre): Noeud => {
    const enfants = (parParent.get(t.id) ?? []).map(noeud);
    return {
      id: t.id, t, enfants, x: 0, y: 0,
      feuille: enfants.length === 0 ? gr.circuits.find(c => c.cle === t.circuits[0]) : undefined,
      boite: boites.find(b => b.id === t.boiteVers),
    };
  };
  return noeud(gr.tronc);
}

interface Props {
  niveaux: { nom: string; gaines: GainesNiveau }[];
  couleurDe: (breakerId: number) => string;
  breakerSelectionneId: number | null;
  onSelectBreaker: (id: number | null) => void;
}

function SchemaNiveau({ nom, g, couleurDe, breakerSelectionneId, onSelectBreaker }: { nom: string; g: GainesNiveau } & Omit<Props, "niveaux">) {
  // Disposition : un bandeau par gaine ; dans chaque bandeau les circuits sont des lignes, les boîtes sont placées à la moyenne de leurs enfants.
  let y0 = 0;
  const bandeaux = g.groupes.map((gr, gi) => {
    const racine = construire(gr, g.boites.filter(b => b.groupeId === gr.id));
    const prof = profondeur(racine);
    let ligne = 0;
    const place = (n: Noeud, niv: number) => {
      n.x = n.enfants.length === 0 ? -1 : X_ARBRE + niv * DX;
      if (n.enfants.length === 0) { n.y = ENTETE + ligne * LIGNE + LIGNE / 2; ligne++; }
      else { n.enfants.forEach(e => place(e, niv + 1)); n.y = (n.enfants[0].y + n.enfants[n.enfants.length - 1].y) / 2; }
    };
    place(racine, 0);
    const hauteur = ENTETE + Math.max(1, ligne) * LIGNE + 10;
    const b = { gr, gi, racine, prof, hauteur, y0 };
    y0 += hauteur + 12;
    return b;
  });
  const profMax = Math.max(1, ...bandeaux.map(b => b.prof));
  const xFeuille = Math.max(X_FEUILLE_MINI, X_ARBRE + profMax * DX + 60);
  const largeur = xFeuille + W_LABEL;
  const hauteurTotale = Math.max(60, y0);

  return (
    <section className="mb-6">
      <h3 className="text-sm font-bold text-ink-900 mb-1">Niveau « {nom} » — {g.groupes.length} gaine{g.groupes.length > 1 ? "s" : ""} · {g.groupes.reduce((n, x) => n + x.circuits.length, 0)} circuits · {g.boites.length} boîte{g.boites.length > 1 ? "s" : ""} de dérivation</h3>
      <svg viewBox={`0 0 ${largeur} ${hauteurTotale}`} className="w-full h-auto bg-white border border-ink-200 rounded-lg" style={{ minWidth: 720 }} role="img" aria-label={`Schéma technique des gaines du niveau ${nom}`}>
        {/* Tableau */}
        <rect x={X_TABLEAU} y={4} width={W_TABLEAU} height={Math.max(40, hauteurTotale - 8)} rx={6} fill="#1c1917" />
        <text x={X_TABLEAU + W_TABLEAU / 2} y={24} textAnchor="middle" fontSize={13} fontWeight={800} fill="#FBBF24">⚡ Tableau</text>
        {bandeaux.map(({ gr, gi, racine, hauteur, y0: by }) => {
          const coul = couleurGroupe(gi, gr.courantFaible);
          const parcours: JSX.Element[] = [];
          const tube = (n: Noeud, parent: Noeud | null) => {
            const t = n.t;
            const xp = parent ? parent.x : X_TABLEAU + W_TABLEAU, yp = (parent ? parent.y : racine.y) + by;
            const xc = n.x < 0 ? xFeuille : n.x, yc = n.y + by;
            const xm = parent ? xp + 22 : xp + 18;
            const epais = 3 + Math.min(7, t.circuits.length * 0.7);
            const pts = `${xp},${yp} ${xm},${yp} ${xm},${yc} ${xc},${yc}`;
            parcours.push(<polyline key={`t-${t.id}`} points={pts} fill="none" stroke="#fff" strokeWidth={epais + 3} strokeLinejoin="round" strokeLinecap="round" />);
            parcours.push(<polyline key={`c-${t.id}`} points={pts} fill="none" stroke={coul} strokeWidth={epais} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={gr.courantFaible ? "8 4" : undefined} opacity={0.85} />);
            const sansLabel = !parent; // le tronc est décrit dans l'en-tête de la gaine
            const lx = n.enfants.length > 0 ? xc - 18 : xc - 8;
            if (!sansLabel) parcours.push(
              <text key={`l-${t.id}`} x={lx} y={yc - epais / 2 - 4} textAnchor="end" fontSize={10} fill="#44403c" stroke="#fff" strokeWidth={3} paintOrder="stroke">
                {t.gaine.replace(/ verte.*/, "")} · {t.longueurM < 0.05 ? "sur place" : `${fmt(t.longueurM)} m`}{t.circuits.length > 1 ? ` · ${t.circuits.length} circuits` : ""}
              </text>,
            );
            n.enfants.forEach(e => tube(e, n));
            if (n.boite && n.enfants.length > 0) {
              parcours.push(
                <g key={`b-${t.id}`}>
                  <rect x={n.x - 11} y={yc - 11} width={22} height={22} rx={3} fill="#fff" stroke={coul} strokeWidth={3} />
                  <text x={n.x} y={yc + 4} textAnchor="middle" fontSize={11} fontWeight={800} fill="#1c1917">B</text>
                  <text x={n.x} y={yc - 16} textAnchor="middle" fontSize={11} fontWeight={800} fill="#1c1917" stroke="#fff" strokeWidth={3} paintOrder="stroke">{n.boite.nom}</text>
                </g>,
              );
            }
          };
          tube(racine, null);
          const feuilles: JSX.Element[] = [];
          const collecte = (n: Noeud) => {
            if (n.enfants.length === 0 && n.feuille) {
              const c = n.feuille, yc = n.y + by;
              // longueur de câble depuis le tableau : somme des tronçons du tronc jusqu'à la feuille (à vol d'oiseau)
              let lg = 0; let cur: TronconArbre | undefined = n.t;
              while (cur) { lg += cur.longueurM; const par: string | null = cur.parent; cur = par ? gr.troncons.find(x => x.id === par) : undefined; }
              const sel = c.breakerId === breakerSelectionneId;
              feuilles.push(
                <g key={`f-${c.cle}`} style={{ cursor: "pointer" }} onClick={() => onSelectBreaker(sel ? null : c.breakerId)}>
                  <rect x={xFeuille + 6} y={yc - LIGNE / 2 + 3} width={W_LABEL - 10} height={LIGNE - 6} rx={5} fill={sel ? "#FEF3C7" : "#fafaf9"} stroke={sel ? "#F59E0B" : "#d6d3d1"} strokeWidth={sel ? 2 : 1} />
                  <circle cx={xFeuille + 20} cy={yc} r={6} fill={couleurDe(c.breakerId)} stroke="#44403c" strokeWidth={0.8} />
                  <text x={xFeuille + 32} y={yc - 2} fontSize={11.5} fontWeight={700} fill="#1c1917">{c.label.length > 34 ? `${c.label.slice(0, 33)}…` : c.label}</text>
                  <text x={xFeuille + 32} y={yc + 11} fontSize={10} fill="#57534e">{c.courantFaible ? "courants faibles" : `${c.amperes} A`} · {c.section} mm² · câble ≈ {fmt(lg)} m</text>
                </g>,
              );
            }
            n.enfants.forEach(collecte);
          };
          collecte(racine);
          return (
            <g key={gr.id}>
              <rect x={X_ARBRE - 12} y={by} width={largeur - X_ARBRE + 4} height={hauteur} rx={6} fill={coul} opacity={0.07} />
              <text x={X_ARBRE - 4} y={by + 18} fontSize={12} fontWeight={800} fill="#1c1917">
                {gr.nom}{gr.circuits.length > 1 ? ` — ${gr.circuits.length} circuits · ${gr.tronc.gaine.replace(/ verte.*/, "")} (${gr.tronc.tauxPct} %) · tronc ${fmt(gr.tronc.longueurM)} m` : ` — départ individuel · ${gr.tronc.gaine.replace(/ verte.*/, "")} · ${fmt(gr.tronc.longueurM)} m`}
              </text>
              {parcours}{feuilles}
            </g>
          );
        })}
      </svg>
      {g.ignores.length > 0 && <p className="text-xs text-ink-500 mt-1">Non raccordés au tableau (absents du schéma) : {g.ignores.join(", ")}.</p>}
    </section>
  );
}

export function SchemaGaines({ niveaux, couleurDe, breakerSelectionneId, onSelectBreaker }: Props) {
  if (niveaux.length === 0) return <p className="text-sm text-ink-500">Rien à dessiner : active les gaines optimisées, place le tableau (ou l&apos;arrivée des gaines) et génère les circuits.</p>;
  return (
    <div>
      <p className="text-xs text-ink-600 mb-2">
        Lecture de gauche à droite : <b>tableau → gaine → boîte de dérivation (B) → circuit</b>. L&apos;épaisseur d&apos;une gaine suit le nombre de circuits qu&apos;elle porte ; tireté = courants faibles.
        Clique un circuit pour le retrouver sur le plan. Longueurs à vol d&apos;oiseau, hors montées verticales.
      </p>
      {niveaux.map(n => <SchemaNiveau key={n.nom} nom={n.nom} g={n.gaines} couleurDe={couleurDe} breakerSelectionneId={breakerSelectionneId} onSelectBreaker={onSelectBreaker} />)}
    </div>
  );
}
