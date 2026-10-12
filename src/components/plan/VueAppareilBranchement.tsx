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
    if (m.modele === "odace-inter") {
      // ── Face arrière réelle d'un mécanisme Odace (simple / va-et-vient / poussoir) ──────────────────────────────────────
      // Trois bornes automatiques à DEUX entrées chacune (2 câbles par pôle) : « 1 » en haut à gauche, « L » (commun) en haut à droite,
      // « 2 » en bas à gauche ; en bas à droite, deux emplacements sans borne. Un levier blanc libère chaque paire d'entrées. Les fils
      // arrivent par le HAUT (1, L) ou par le BAS (2) et se piquent sans vis (dénudage 4 mm).
      const HAUT = 20 + 11 * Math.max(1, vue.raccords.filter(r => r.mecanisme === m.id).length), BAS = 20 + 11 * Math.max(1, vue.raccords.filter(r => r.mecanisme === m.id).length), HC = 236, bx = XB + 8, bw = WB - 16, by = y + 12 + HAUT, bh = HC;
      const hx: Record<string, number[]> = { "1": [bx + 34, bx + 64], L: [bx + bw - 64, bx + bw - 34], "2": [bx + 34, bx + 64] };
      const hy = (lib: string) => (lib === "2" ? by + bh - 34 : by + 34);
      const dessus = (lib: string) => lib !== "2";
      type It = { c: Cond; lib: string; gauche: boolean; cible: number };
      const items: It[] = [];
      m.bornes.forEach(b => {
        const cs = vue.raccords.filter(r => r.mecanisme === m.id && r.borne === b.id).map(r => r.conducteur);
        cs.forEach((c, i) => items.push({ c, lib: b.libelle, gauche: cote(c) === "amont", cible: hx[b.libelle]?.[Math.min(i, 1)] ?? bx }));
      });
      const lanes = (haut: boolean, gauche: boolean) => {
        const l = items.filter(t => dessus(t.lib) === haut && t.gauche === gauche);
        // le fil dont la borne est la plus lointaine passe par la voie extérieure : aucun croisement avec les autres descentes
        l.sort((a, b) => (gauche ? b.cible - a.cible : a.cible - b.cible));
        return l;
      };
      els.push(<text key="od-t" x={XC} y={y + 14} fontSize={12} fontWeight={800} textAnchor="middle" fill="#1c1917">{m.titre} — vue arrière</text>);
      els.push(<rect key="od-b" x={bx} y={by} width={bw} height={bh} rx={14} fill="#f5f5f4" stroke="#44403c" strokeWidth={2} />);
      // leviers de libération
      (["1", "L"] as const).forEach(lib => els.push(<rect key={`od-lv-${lib}`} x={hx[lib][0] - 12} y={by - 9} width={hx[lib][1] - hx[lib][0] + 24} height={11} rx={3} fill="#fff" stroke="#a8a29e" strokeWidth={1.4} />));
      els.push(<rect key="od-lv-2" x={hx["2"][0] - 12} y={by + bh - 2} width={hx["2"][1] - hx["2"][0] + 24} height={11} rx={3} fill="#fff" stroke="#a8a29e" strokeWidth={1.4} />);
      // entrées de câble (2 par borne) + emplacements sans borne
      (["1", "L", "2"] as const).forEach(lib => hx[lib].forEach((x, i) => {
        const occupe = items.some(t => t.lib === lib && t.cible === x);
        els.push(<circle key={`od-h-${lib}-${i}`} cx={x} cy={hy(lib)} r={8.5} fill={occupe ? "#1c1917" : "#44403c"} stroke="#fff" strokeWidth={2} />);
      }));
      [bx + bw - 64, bx + bw - 34].forEach((x, i) => els.push(<circle key={`od-v-${i}`} cx={x} cy={by + bh - 34} r={8} fill="#e7e5e4" stroke="#a8a29e" strokeWidth={1.6} />));
      // symbole du contact inverseur : L commun, bascule entre 1 et 2
      const yp = by + bh / 2 + 4;
      els.push(<g key="od-sym" stroke="#44403c" strokeWidth={1.6} fill="none">
        <circle cx={bx + 30} cy={by + 78} r={10} fill="#fff" /><circle cx={bx + 30} cy={by + bh - 78} r={10} fill="#fff" /><circle cx={bx + bw - 30} cy={by + 78} r={10} fill="#fff" />
        <polyline points={`${bx + bw - 40},${by + 78} ${bx + 92},${by + 78} ${bx + 92},${yp}`} />
        <line x1={bx + 92} y1={yp} x2={bx + 44} y2={yp + 22} />
        <line x1={bx + 30} y1={by + 88} x2={bx + 30} y2={yp - 22} /><line x1={bx + 30} y1={by + bh - 88} x2={bx + 30} y2={yp + 30} />
        <circle cx={bx + 30} cy={yp - 22} r={2.5} fill="#fff" /><circle cx={bx + 44} cy={yp + 22} r={2.5} fill="#fff" /><circle cx={bx + 92} cy={yp} r={2.5} fill="#44403c" />
      </g>);
      els.push(<g key="od-lab" fontSize={11} fontWeight={800} fill="#1c1917" textAnchor="middle">
        <text x={bx + 30} y={by + 82}>1</text><text x={bx + 30} y={by + bh - 74}>2</text><text x={bx + bw - 30} y={by + 82}>L</text>
      </g>);
      // fils
      ([[true, true], [true, false], [false, true], [false, false]] as const).forEach(([haut, gauche]) => {
        const decalage = gauche ? 0 : lanes(haut, true).length;   // voies distinctes à gauche et à droite : jamais deux fils superposés
        lanes(haut, gauche).forEach((t, k0) => {
          const k = k0 + decalage;
          const yi = haut ? by - 20 - k * 11 : by + bh + 22 + k * 11;
          const x0 = gauche ? X_G + 168 : W - X_G - 168;
          const yh = hy(t.lib);
          els.push(<Fil key={`od-f-${haut}-${gauche}-${k}`} c={t.c} pts={[[x0, yi], [t.cible, yi], [t.cible, yh]]} />);
          els.push(<text key={`od-ft-${haut}-${gauche}-${k}`} x={gauche ? x0 - 6 : x0 + 6} y={yi + 3.5} fontSize={10.5} fontWeight={700} textAnchor={gauche ? "end" : "start"} fill={couleurTexte(t.c)}>{`${t.c.libelle} ${marque(t.c)}`}</text>);
        });
      });
      const surcharge = ["1", "L", "2"].filter(lib => items.filter(t => t.lib === lib).length > 2);
      if (surcharge.length > 0) els.push(<text key="od-warn" x={XC} y={by + bh + BAS + 40} fontSize={10} textAnchor="middle" fill="#b45309">{`Plus de 2 fils sur la borne ${surcharge.join(", ")} : relier l'excédent dans une borne Wago`}</text>);
      y = by + bh + BAS + (surcharge.length > 0 ? 52 : 36);
      return;
    }
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
      els.push(<text key={`ep-n${k}`} x={XC} y={cy + 4} fontSize={10.5} fontWeight={700} textAnchor="middle" fill="#1c1917">{`Wago · ${ep.titre}`.slice(0, 24)}</text>);
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
