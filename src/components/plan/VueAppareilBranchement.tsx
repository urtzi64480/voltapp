"use client";
// src/components/plan/VueAppareilBranchement.tsx
//
// VUE DE L'APPAREIL (face arrière) : les bornes du mécanisme au centre, les câbles qui ARRIVENT à gauche et ceux qui REPARTENT à droite,
// chaque fil tracé dans sa couleur jusqu'à SA borne. Sous le mécanisme : ce qui se relie dans la boîte (neutre, terre, retour qui traverse…).
// Les raccordements viennent de bornier-appareillage.ts.
import { X, AlertTriangle } from "lucide-react";
import { COULEUR_FIL, couleurConducteur } from "@/lib/couleurs-fils";
import type { Cond, VueAppareil } from "@/lib/bornier-appareillage";

const W = 980, X_G = 16, XB = 366, WB = 248, XC = XB + WB / 2;
const ROND = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];

function Fil({ pts, c }: { pts: [number, number][]; c: Cond }) {
  const d = pts.map(p => p.join(",")).join(" ");
  const couleur = couleurConducteur(c.role);
  return (<g>
    <polyline points={d} fill="none" stroke={couleur} strokeWidth={3.4} strokeLinejoin="round" strokeLinecap="round" />
    {c.role === "terre" && <polyline points={d} fill="none" stroke={COULEUR_FIL.terreJaune} strokeWidth={3.4} strokeDasharray="6 6" strokeLinejoin="round" />}
  </g>);
}

export default function VueAppareilBranchement({ vue, onClose }: { vue: VueAppareil; onClose: () => void }) {
  const idxCable = new Map(vue.cables.map((c, i) => [c.cle, i] as const));
  const coteDe = new Map(vue.cables.map(c => [c.cle, c.cote] as const));
  const cote = (c: Cond) => coteDe.get(c.cable) ?? "amont";
  const marque = (c: Cond) => ROND[idxCable.get(c.cable) ?? 0] ?? "";
  const couleurTexte = (c: Cond) => (c.role === "terre" ? COULEUR_FIL.terreVert : couleurConducteur(c.role));

  const els: JSX.Element[] = [];
  let y = 14;

  const fils = (liste: Cond[], cy: number, xBout: number, key: string, cible: number) => {
    const n = liste.length;
    liste.forEach((c, i) => {
      const yi = cy + (i - (n - 1) / 2) * 14;
      const gauche = cote(c) === "amont";
      const x0 = gauche ? X_G + 168 : W - X_G - 168;
      const xm = gauche ? XB - 24 : XB + WB + 24;
      els.push(<Fil key={`${key}-${i}`} c={c} pts={[[x0, yi], [xm, yi], [cible, cy]]} />);
      els.push(<text key={`${key}-t${i}`} x={gauche ? x0 - 6 : x0 + 6} y={yi + 3.5} fontSize={10.5} fontWeight={700} textAnchor={gauche ? "end" : "start"} fill={couleurTexte(c)}>{`${c.libelle} ${marque(c)}`}</text>);
    });
    void xBout;
  };

  vue.mecanismes.forEach(m => {
    const rows = m.bornes.map(b => {
      const rs = vue.raccords.filter(r => r.mecanisme === m.id && r.borne === b.id).map(r => r.conducteur);
      const g = rs.filter(c => cote(c) === "amont"), d = rs.filter(c => cote(c) === "aval");
      return { b, g, d, h: Math.max(54, Math.max(g.length, d.length) * 14 + 30) };
    });
    const hBloc = 30 + rows.reduce((s, r) => s + r.h, 0) + 6;
    els.push(<rect key={`b-${m.id}`} x={XB} y={y} width={WB} height={hBloc} rx={12} fill="#fafaf9" stroke="#44403c" strokeWidth={2} />);
    els.push(<text key={`bt-${m.id}`} x={XC} y={y + 19} fontSize={12} fontWeight={800} textAnchor="middle" fill="#1c1917">{m.titre}</text>);
    let yy = y + 30;
    rows.forEach(r => {
      const cy = yy + r.h / 2;
      fils(r.g, cy, XB, `g-${m.id}-${r.b.id}`, XC - 9);
      fils(r.d, cy, XB + WB, `d-${m.id}-${r.b.id}`, XC + 9);
      els.push(<circle key={`c-${m.id}-${r.b.id}`} cx={XC} cy={cy} r={9} fill="#1c1917" stroke="#fff" strokeWidth={2} />);
      els.push(<line key={`cv-${m.id}-${r.b.id}`} x1={XC - 5} y1={cy} x2={XC + 5} y2={cy} stroke="#a8a29e" strokeWidth={2} />);
      els.push(<text key={`cl-${m.id}-${r.b.id}`} x={XC} y={cy - 15} fontSize={12} fontWeight={800} textAnchor="middle" fill="#1c1917">{r.b.libelle}</text>);
      if (r.b.aide) els.push(<text key={`ca-${m.id}-${r.b.id}`} x={XC} y={cy + 25} fontSize={9} textAnchor="middle" fill="#78716c" stroke="#fafaf9" strokeWidth={3} paintOrder="stroke">{r.b.aide}</text>);
      if (r.g.length === 0 && r.d.length === 0) els.push(<text key={`ce-${m.id}-${r.b.id}`} x={XC + 20} y={cy + 4} fontSize={9.5} fill="#b45309">aucun fil</text>);
      yy += r.h;
    });
    y += hBloc + 14;
  });

  if (vue.epissures.length > 0) {
    y += 4;
    els.push(<text key="ep-t" x={XB} y={y + 12} fontSize={11} fontWeight={800} fill="#1c1917">Dans la boîte — reliés entre eux, hors mécanisme</text>);
    y += 22;
    vue.epissures.forEach((ep, k) => {
      const g = ep.conducteurs.filter(c => cote(c) === "amont"), d = ep.conducteurs.filter(c => cote(c) === "aval");
      const h = Math.max(g.length, d.length, 1) * 14 + 26;
      const cy = y + h / 2;
      els.push(<rect key={`ep-r${k}`} x={XC - 62} y={cy - 15} width={124} height={30} rx={8} fill="#f5f5f4" stroke="#44403c" strokeWidth={1.6} strokeDasharray="5 3" />);
      els.push(<text key={`ep-n${k}`} x={XC} y={cy + 4} fontSize={10.5} fontWeight={700} textAnchor="middle" fill="#1c1917">{`domino · ${ep.titre}`.slice(0, 24)}</text>);
      const trace = (liste: Cond[], gauche: boolean, kk: string) => liste.forEach((c, i) => {
        const yi = cy + (i - (liste.length - 1) / 2) * 14;
        const x0 = gauche ? X_G + 168 : W - X_G - 168;
        els.push(<Fil key={`${kk}-${i}`} c={c} pts={[[x0, yi], [gauche ? XB - 24 : XB + WB + 24, yi], [gauche ? XC - 62 : XC + 62, cy]]} />);
        els.push(<text key={`${kk}-t${i}`} x={gauche ? x0 - 6 : x0 + 6} y={yi + 3.5} fontSize={10.5} fontWeight={700} textAnchor={gauche ? "end" : "start"} fill={couleurTexte(c)}>{`${c.libelle} ${marque(c)}`}</text>);
      });
      trace(g, true, `ep-g${k}`); trace(d, false, `ep-d${k}`);
      y += h + 4;
    });
  }
  const H = y + 14;

  return (
    <div className="fixed inset-0 z-[90] bg-black/55 flex items-center justify-center p-3" onClick={onClose}>
      <div className="card card-inner !p-0 w-full max-w-[96vw] max-h-[94vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-ink-100">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink-900 truncate">Branchements · {vue.titre}</p>
            {vue.sous && <p className="text-[11px] text-ink-500 truncate">{vue.sous} — vue de l'arrière de l'appareil (côté fils)</p>}
          </div>
          <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="Fermer"><X size={15} /></button>
        </div>
        <div className="overflow-auto">
          <div className="px-4 pt-3 grid gap-1">
            {vue.cables.map((c, i) => (
              <p key={c.cle} className="text-[11px] text-ink-600">
                <span className="font-bold text-ink-900">{ROND[i]}</span>{" "}
                <span className="font-semibold">{c.cote === "amont" ? "Arrive de" : "Repart vers"}</span> {c.autre} · {c.description}
              </p>
            ))}
          </div>
          <div className="p-3 bg-white">
            {vue.mecanismes.length === 0 && vue.epissures.length === 0 ? (
              <p className="text-sm text-ink-500 p-4">Aucun raccordement à détailler sur cet appareil.</p>
            ) : (
              <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ maxWidth: "none", fontFamily: "system-ui, sans-serif" }} role="img" aria-label={`Branchements de ${vue.titre}`}>
                <rect x={0} y={0} width={W} height={H} fill="#fff" />
                <text x={X_G + 60} y={H - 4} fontSize={9} fill="#a8a29e">ARRIVÉE (amont)</text>
                <text x={W - X_G - 60} y={H - 4} fontSize={9} fill="#a8a29e" textAnchor="end">DÉPART (aval)</text>
                {els}
              </svg>
            )}
          </div>
          {vue.notes.length > 0 && (
            <div className="mx-3 mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 grid gap-1" role="note">
              {vue.notes.map((t, i) => (
                <p key={i} className="text-[11.5px] text-amber-900 flex gap-1.5"><AlertTriangle size={12} className="shrink-0 mt-0.5" />{t}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
