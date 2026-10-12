"use client";
// src/components/plan/VueAppareilBranchement.tsx
//
// VUE DE L'APPAREIL (face arrière) : les bornes du mécanisme au centre, les câbles qui ARRIVENT à gauche et ceux qui REPARTENT à droite,
// chaque fil tracé dans sa couleur jusqu'à SA borne. Sous le mécanisme : ce qui se relie dans la boîte (neutre, terre, retour qui traverse…).
// Les raccordements viennent de bornier-appareillage.ts.
import { X, AlertTriangle } from "lucide-react";
import { COULEUR_FIL, couleurFil } from "@/lib/couleurs-fils";
import type { Cond, Mecanisme, VueAppareil } from "@/lib/bornier-appareillage";
import { fondModal } from "@/lib/fond-modal";

const W = 980, X_G = 16, XB = 366, WB = 248, XC = XB + WB / 2;
const ROND = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];

function Fil({ pts, c }: { pts: [number, number][]; c: Cond }) {
  const d = pts.map(p => p.join(",")).join(" ");
  const couleur = couleurFil(c);
  return (<g>
    <polyline points={d} fill="none" stroke={couleur} strokeWidth={3.4} strokeLinejoin="round" strokeLinecap="round" />
    {c.role === "terre" && <polyline points={d} fill="none" stroke={COULEUR_FIL.terreJaune} strokeWidth={3.4} strokeDasharray="6 6" strokeLinejoin="round" />}
    {c.rayure && <polyline points={d} fill="none" stroke={c.rayure} strokeWidth={3.4} strokeDasharray="6 6" strokeLinejoin="round" />}
  </g>);
}

export default function VueAppareilBranchement({ vue, onClose }: { vue: VueAppareil; onClose: () => void }) {
  const idxCable = new Map(vue.cables.map((c, i) => [c.cle, i] as const));
  const coteDe = new Map(vue.cables.map(c => [c.cle, c.cote] as const));
  const cote = (c: Cond) => coteDe.get(c.cable) ?? "amont";
  const marque = (c: Cond) => ROND[idxCable.get(c.cable) ?? 0] ?? "";
  const couleurTexte = (c: Cond) => (c.role === "terre" ? COULEUR_FIL.terreVert : couleurFil(c));

  const els: JSX.Element[] = [];
  let y = 14;
  let odaceFait = false;

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
    if (m.modele) {
      if (odaceFait) return;
      odaceFait = true;
      // ── Face arrière réelle des mécanismes Odace (photos Schneider) ───────────────────────────────────────────────────
      // Bornes automatiques à DEUX entrées chacune (2 câbles par pôle), levier de libération par paire, fils piqués sans vis.
      // Plusieurs mécanismes de même rang (plaque double : deux mécanismes S9-214 indépendants) sont dessinés côte à côte.
      type Geo = { w: number; h: number; bornes: Record<string, { trous: { x: number; y: number }[]; haut: boolean }>; corps: (bx: number, by: number, pref: string, occ: (lib: string, i: number) => boolean) => JSX.Element[] };
      const ci = (k: string, x: number, yy: number, r: number, f: string, st: string) => <circle key={k} cx={x} cy={yy} r={r} fill={f} stroke={st} strokeWidth={1.6} />;
      const levier = (k: string, x: number, yy: number, w: number, c = "#fff") => <rect key={k} x={x} y={yy} width={w} height={11} rx={3} fill={c} stroke="#a8a29e" strokeWidth={1.4} />;
      const geoInter = (): Geo => {
        const w = 200, h = 236;
        return { w, h, bornes: { "1": { trous: [{ x: 34, y: 34 }, { x: 64, y: 34 }], haut: true }, L: { trous: [{ x: w - 64, y: 34 }, { x: w - 34, y: 34 }], haut: true }, "2": { trous: [{ x: 34, y: h - 34 }, { x: 64, y: h - 34 }], haut: false } },
          corps: (bx, by, pf, occ) => {
            const o: JSX.Element[] = [<rect key={`${pf}b`} x={bx} y={by} width={w} height={h} rx={14} fill="#f5f5f4" stroke="#44403c" strokeWidth={2} />];
            o.push(levier(`${pf}l1`, bx + 22, by - 9, 54), levier(`${pf}l2`, bx + w - 76, by - 9, 54), levier(`${pf}l3`, bx + 22, by + h - 2, 54));
            (["1", "L", "2"] as const).forEach(lib => { const g = lib === "L" ? [{ x: w - 64, y: 34 }, { x: w - 34, y: 34 }] : [{ x: 34, y: lib === "2" ? h - 34 : 34 }, { x: 64, y: lib === "2" ? h - 34 : 34 }]; g.forEach((t, i) => o.push(ci(`${pf}h${lib}${i}`, bx + t.x, by + t.y, 8.5, occ(lib, i) ? "#1c1917" : "#44403c", "#fff"))); });
            [w - 64, w - 34].forEach((x, i) => o.push(ci(`${pf}v${i}`, bx + x, by + h - 34, 8, "#e7e5e4", "#a8a29e")));
            const yp = by + h / 2 + 4;
            o.push(<g key={`${pf}sym`} stroke="#44403c" strokeWidth={1.6} fill="none">
              <circle cx={bx + 30} cy={by + 78} r={10} fill="#fff" /><circle cx={bx + 30} cy={by + h - 78} r={10} fill="#fff" /><circle cx={bx + w - 30} cy={by + 78} r={10} fill="#fff" />
              <polyline points={`${bx + w - 40},${by + 78} ${bx + 92},${by + 78} ${bx + 92},${yp}`} />
              <line x1={bx + 92} y1={yp} x2={bx + 44} y2={yp + 22} />
              <line x1={bx + 30} y1={by + 88} x2={bx + 30} y2={yp - 22} /><line x1={bx + 30} y1={by + h - 88} x2={bx + 30} y2={yp + 30} />
              <circle cx={bx + 30} cy={yp - 22} r={2.5} fill="#fff" /><circle cx={bx + 44} cy={yp + 22} r={2.5} fill="#fff" /><circle cx={bx + 92} cy={yp} r={2.5} fill="#44403c" />
            </g>);
            o.push(<g key={`${pf}lab`} fontSize={11} fontWeight={800} fill="#1c1917" textAnchor="middle"><text x={bx + 30} y={by + 82}>1</text><text x={bx + 30} y={by + h - 74}>2</text><text x={bx + w - 30} y={by + 82}>L</text></g>);
            return o;
          } };
      };
      const geoPerm = (): Geo => {
        // Permutateur S9-205 : 1 / L1 / 2 en haut (L1 sous le levier rouge), L2 en bas (levier rouge) ; inverseur croisé (symétrique : on peut le prendre dans les deux sens).
        const w = 262, h = 226, X1 = [30, 58], XL = [w / 2 - 14, w / 2 + 14], X2 = [w - 58, w - 30];
        return { w, h, bornes: { "1": { trous: X1.map(x => ({ x, y: 34 })), haut: true }, L1: { trous: XL.map(x => ({ x, y: 34 })), haut: true }, "2": { trous: X2.map(x => ({ x, y: 34 })), haut: true }, L2: { trous: XL.map(x => ({ x, y: h - 34 })), haut: false } },
          corps: (bx, by, pf, occ) => {
            const o: JSX.Element[] = [<rect key={`${pf}b`} x={bx} y={by} width={w} height={h} rx={14} fill="#f5f5f4" stroke="#44403c" strokeWidth={2} />];
            o.push(levier(`${pf}la`, bx + 18, by - 9, 52), levier(`${pf}lb`, bx + w / 2 - 28, by - 9, 56, "#ef4444"), levier(`${pf}lc`, bx + w - 70, by - 9, 52), levier(`${pf}ld`, bx + w / 2 - 28, by + h - 2, 56, "#ef4444"));
            const trous: [string, number[], number][] = [["1", X1, 34], ["L1", XL, 34], ["2", X2, 34], ["L2", XL, h - 34]];
            trous.forEach(([lib, xs, yy]) => xs.forEach((x, i) => o.push(ci(`${pf}h${lib}${i}`, bx + x, by + yy, 8.5, occ(lib, i) ? "#1c1917" : "#44403c", "#fff"))));
            [X1, X2].forEach((xs, k) => xs.forEach((x, i) => o.push(ci(`${pf}v${k}${i}`, bx + x, by + h - 34, 8, "#e7e5e4", "#a8a29e"))));
            o.push(<g key={`${pf}sym`} stroke="#44403c" strokeWidth={1.6} fill="none">
              <circle cx={bx + 44} cy={by + 78} r={11} fill="#fff" /><circle cx={bx + w - 44} cy={by + 78} r={11} fill="#fff" />
              <circle cx={bx + w / 2} cy={by + 78} r={12} fill="#fff" /><circle cx={bx + w / 2} cy={by + h - 64} r={12} fill="#fff" />
              <line x1={bx + 60} y1={by + 108} x2={bx + w - 60} y2={by + 136} /><line x1={bx + 60} y1={by + 136} x2={bx + w - 60} y2={by + 108} />
              <circle cx={bx + 60} cy={by + 108} r={2.5} fill="#fff" /><circle cx={bx + 60} cy={by + 136} r={2.5} fill="#fff" /><circle cx={bx + w - 60} cy={by + 108} r={2.5} fill="#fff" /><circle cx={bx + w - 60} cy={by + 136} r={2.5} fill="#fff" />
            </g>);
            o.push(<g key={`${pf}lab`} fontSize={11} fontWeight={800} fill="#1c1917" textAnchor="middle"><text x={bx + 44} y={by + 82}>1</text><text x={bx + w - 44} y={by + 82}>2</text><text x={bx + w / 2} y={by + 82}>L1</text><text x={bx + w / 2} y={by + h - 60}>L2</text></g>);
            return o;
          } };
      };
      const geoPrise = (): Geo => {
        // Prise 2P+T S9-052 : de gauche à droite L (levier rouge), terre (levier vert), N (levier bleu) — 2 connexions rapides par pôle.
        const w = 250, h = 122, XS: Record<string, number[]> = { L: [34, 62], PE: [w / 2 - 14, w / 2 + 14], N: [w - 62, w - 34] };
        const coul: Record<string, string> = { L: "#ef4444", PE: "#22c55e", N: "#3b82f6" };
        return { w, h, bornes: Object.fromEntries(Object.entries(XS).map(([k, xs]) => [k, { trous: xs.map(x => ({ x, y: 34 })), haut: true }])),
          corps: (bx, by, pf, occ) => {
            const o: JSX.Element[] = [<rect key={`${pf}b`} x={bx} y={by} width={w} height={h} rx={14} fill="#f5f5f4" stroke="#44403c" strokeWidth={2} />];
            Object.entries(XS).forEach(([lib, xs]) => {
              o.push(levier(`${pf}l${lib}`, bx + xs[0] - 12, by - 9, xs[1] - xs[0] + 24, coul[lib]));
              xs.forEach((x, i) => o.push(ci(`${pf}h${lib}${i}`, bx + x, by + 34, 8.5, occ(lib, i) ? "#1c1917" : "#44403c", "#fff")));
              o.push(<text key={`${pf}t${lib}`} x={bx + (xs[0] + xs[1]) / 2} y={by + 78} fontSize={13} fontWeight={800} textAnchor="middle" fill="#1c1917">{lib === "PE" ? "⏚" : lib}</text>);
            });
            o.push(<text key={`${pf}n`} x={bx + w / 2} y={by + 106} fontSize={9.5} textAnchor="middle" fill="#78716c">16 A 250 V~ · S9-052</text>);
            return o;
          } };
      };
      const mecs = vue.mecanismes.filter(x => x.modele);
      const geos = mecs.map(x => (x.modele === "odace-perm" ? geoPerm() : x.modele === "odace-prise" ? geoPrise() : geoInter()));
      const ECART = 30;
      const largeurTotale = geos.reduce((t, g) => t + g.w, 0) + ECART * (geos.length - 1);
      const x0b = XC - largeurTotale / 2;
      const hMax = Math.max(...geos.map(g => g.h));
      type It = { c: Cond; haut: boolean; gauche: boolean; cx: number; cy: number };
      const items: It[] = [];
      const posX: number[] = [];
      geos.reduce((acc, g, k) => { posX[k] = acc; return acc + g.w + ECART; }, x0b);
      const nHaut = { g: 0, d: 0 }, nBas = { g: 0, d: 0 };
      mecs.forEach((mm, k) => {
        mm.bornes.forEach(b => {
          const cfg = geos[k].bornes[b.libelle];
          if (!cfg) return;
          vue.raccords.filter(r => r.mecanisme === mm.id && r.borne === b.id).map(r => r.conducteur).forEach((c, i) => {
            const t = cfg.trous[Math.min(i, cfg.trous.length - 1)];
            const gauche = cote(c) === "amont";
            items.push({ c, haut: cfg.haut, gauche, cx: posX[k] + t.x, cy: cfg.haut ? 0 : geos[k].h - 0 });
            (cfg.haut ? nHaut : nBas)[gauche ? "g" : "d"]++;
          });
        });
      });
      const HAUT = 24 + 11 * Math.max(1, nHaut.g + nHaut.d), BAS = 24 + 11 * Math.max(1, nBas.g + nBas.d);
      const by = y + 22 + HAUT;
      els.push(<text key="od-t" x={XC} y={y + 14} fontSize={12} fontWeight={800} textAnchor="middle" fill="#1c1917">{`${vue.titre} — vue arrière`}</text>);
      mecs.forEach((mm, k) => {
        const occ = (lib: string, i: number) => items.some(t => {
          const cfg = geos[k].bornes[lib]; return !!cfg && t.cx === posX[k] + cfg.trous[i]?.x && (t.haut === cfg.haut);
        });
        geos[k].corps(posX[k], by, `od${k}`, occ).forEach(e => els.push(e));
        if (mecs.length > 1) els.push(<text key={`od-v${k}`} x={posX[k] + geos[k].w / 2} y={by + 17} fontSize={10.5} fontWeight={800} textAnchor="middle" fill="#57534e">{mm.titre}</text>);
      });
      // fils : pour chaque terminal, les 2 premiers fils entrent dans les 2 trous, au-delà : alerte
      const hole = (mm: Mecanisme, k: number, lib: string, i: number) => { const cfg = geos[k].bornes[lib]; const t = cfg.trous[Math.min(i, cfg.trous.length - 1)]; return { x: posX[k] + t.x, y: by + t.y, haut: cfg.haut }; };
      type F = { c: Cond; gauche: boolean; x: number; yh: number; haut: boolean };
      const fs: F[] = [];
      mecs.forEach((mm, k) => mm.bornes.forEach(b => {
        if (!geos[k].bornes[b.libelle]) return;
        vue.raccords.filter(r => r.mecanisme === mm.id && r.borne === b.id).map(r => r.conducteur).forEach((c, i) => {
          const h = hole(mm, k, b.libelle, i);
          fs.push({ c, gauche: cote(c) === "amont", x: h.x, yh: h.y, haut: h.haut });
        });
      }));
      let kg = { h: 0, b: 0 };
      ([[true, true], [true, false], [false, true], [false, false]] as const).forEach(([haut, gauche]) => {
        const l = fs.filter(t => t.haut === haut && t.gauche === gauche).sort((a, b) => (gauche ? b.x - a.x : a.x - b.x));
        const dec = gauche ? 0 : fs.filter(t => t.haut === haut && t.gauche).length;
        l.forEach((t, k0) => {
          const k = k0 + dec;
          const yi = haut ? by - 20 - k * 11 : by + hMax + 22 + k * 11;
          const xs = gauche ? X_G + 168 : W - X_G - 168;
          els.push(<Fil key={`od-f-${haut}-${gauche}-${k0}`} c={t.c} pts={[[xs, yi], [t.x, yi], [t.x, t.yh]]} />);
          els.push(<text key={`od-ft-${haut}-${gauche}-${k0}`} x={gauche ? xs - 6 : xs + 6} y={yi + 3.5} fontSize={10.5} fontWeight={700} textAnchor={gauche ? "end" : "start"} fill={couleurTexte(t.c)}>{`${t.c.libelle} ${marque(t.c)}`}</text>);
        });
      });
      void kg;
      const surcharge: string[] = [];
      mecs.forEach(mm => mm.bornes.forEach(b => { if (vue.raccords.filter(r => r.mecanisme === mm.id && r.borne === b.id).length > 2) surcharge.push(b.libelle); }));
      if (surcharge.length > 0) els.push(<text key="od-warn" x={XC} y={by + hMax + BAS + 38} fontSize={10} textAnchor="middle" fill="#b45309">{`Plus de 2 fils sur la borne ${Array.from(new Set(surcharge)).join(", ")} : relier l'excédent dans une borne Wago`}</text>);
      y = by + hMax + BAS + (surcharge.length > 0 ? 52 : 34);
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
    <div className="fixed inset-0 z-[90] bg-black/55 flex items-center justify-center p-3" {...fondModal(onClose)}>
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
