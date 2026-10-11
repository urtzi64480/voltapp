"use client";
// src/components/plan/SuiviChantier.tsx
//
// Pièces d'interface du suivi de réalisation liées au CHANTIER : carte « Chantier » (nom, validation finale, devis lié),
// saisie du temps passé sur un circuit, et bilan temps chiffré / temps passé. Rien ici n'est bloquant : sans devis, sans
// heures chiffrées ou sans temps saisi, tout reste simplement vide.
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarCheck, Clock, ExternalLink, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formaterMinutes, minutesDepuisTexte, InfosChantier } from "@/lib/suivi-persistance";
import { Bilan, LigneBilan, ecartPourcent } from "@/lib/suivi-bilan";

export interface DevisResume { id: string; numero: string; objet?: string | null; statut?: string | null; date_emission?: string | null }

const dateFr = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
};
const aujourdhui = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ─── Carte « Chantier » ──────────────────────────────────────────────────────────────────────────────────────

export function CarteChantier({ nom, chantier, devisListe, pctAvancement, onRenommer, onChangerChantier }: {
  nom: string; chantier: InfosChantier; devisListe: DevisResume[]; pctAvancement: number;
  onRenommer: (nom: string) => void; onChangerChantier: (patch: InfosChantier) => void;
}) {
  const [brouillon, setBrouillon] = useState(nom);
  useEffect(() => setBrouillon(nom), [nom]);
  const valider = () => {
    const n = brouillon.trim();
    if (!n) { setBrouillon(nom); return; }
    if (n !== nom) onRenommer(n);
  };
  const devis = devisListe.find(d => d.id === chantier.devis_id);
  const devisIntrouvable = !!chantier.devis_id && devisListe.length > 0 && !devis;

  return (
    <div className="card card-inner mb-4">
      <p className="font-semibold text-ink-900 mb-3">Chantier</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="label" htmlFor="chantier-nom">Nom du chantier en cours</label>
          <input id="chantier-nom" className="input" value={brouillon} maxLength={80}
            onChange={e => setBrouillon(e.target.value)} onBlur={valider}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </div>
        <div>
          <label className="label" htmlFor="chantier-valide">Validation finale</label>
          <div className="flex gap-1.5">
            <input id="chantier-valide" type="date" className="input" value={chantier.valide_le ?? ""}
              onChange={e => onChangerChantier({ valide_le: e.target.value || undefined })} />
            {chantier.valide_le ? (
              <button type="button" className="btn-ghost !px-2" title="Retirer la validation" aria-label="Retirer la validation"
                onClick={() => onChangerChantier({ valide_le: undefined })}><X size={14} /></button>
            ) : (
              <button type="button" className="btn-ghost !px-2.5 !text-xs whitespace-nowrap" onClick={() => onChangerChantier({ valide_le: aujourdhui() })}>
                <CalendarCheck size={13} /> Aujourd'hui
              </button>
            )}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="chantier-devis">Devis du chantier</label>
          <select id="chantier-devis" className="input" value={chantier.devis_id ?? ""}
            onChange={e => onChangerChantier({ devis_id: e.target.value || undefined })}>
            <option value="">{devisListe.length === 0 ? "Aucun devis pour ce client" : "— Aucun —"}</option>
            {devisListe.map(d => (
              <option key={d.id} value={d.id}>{d.numero}{d.objet ? ` · ${d.objet}` : ""}{d.statut ? ` (${d.statut})` : ""}</option>
            ))}
          </select>
        </div>
      </div>
      {chantier.valide_le && (
        <p className={cn("mt-3 text-xs flex gap-1.5", pctAvancement < 100 ? "text-amber-800" : "text-emerald-700")}>
          {pctAvancement < 100 ? <AlertTriangle size={13} className="shrink-0 mt-0.5" /> : <CalendarCheck size={13} className="shrink-0 mt-0.5" />}
          <span>
            Chantier validé le {dateFr(chantier.valide_le)}
            {pctAvancement < 100 ? ` — attention, il reste des étapes non cochées (${pctAvancement} % réalisé).` : "."}
          </span>
        </p>
      )}
      {devis && (
        <Link href={`/devis/${devis.id}`} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-volt-700 hover:text-volt-800">
          <FileText size={13} /> Ouvrir le devis {devis.numero} <ExternalLink size={11} />
        </Link>
      )}
      {devisIntrouvable && <p className="mt-3 text-xs text-amber-800">Le devis lié n'existe plus : choisis-en un autre.</p>}
      <p className="text-[11px] text-ink-400 mt-3 leading-relaxed">
        Le nom du chantier est le nom du projet. Un nouveau chantier chez le même client = un nouveau projet (bouton + à côté du sélecteur de projet, en haut de la page), avec son propre plan, son suivi et son devis.
      </p>
    </div>
  );
}

// ─── Temps passé sur un circuit / un poste ───────────────────────────────────────────────────────────────────

export function SaisieTemps({ minutes, chiffreMin, onChange, compact }: {
  minutes: number; chiffreMin?: number; onChange: (min: number) => void; compact?: boolean;
}) {
  const [texte, setTexte] = useState(minutes > 0 ? String(Math.round((minutes / 60) * 100) / 100).replace(".", ",") : "");
  useEffect(() => setTexte(minutes > 0 ? String(Math.round((minutes / 60) * 100) / 100).replace(".", ",") : ""), [minutes]);
  const [invalide, setInvalide] = useState(false);

  const valider = () => {
    const m = minutesDepuisTexte(texte);
    if (m === null) { setInvalide(true); return; }
    setInvalide(false);
    if (m !== minutes) onChange(m);
  };
  const ajouter = (plus: number) => { setInvalide(false); onChange(Math.max(0, minutes + plus)); };
  const ecart = chiffreMin ? ecartPourcent(chiffreMin, minutes) : null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", compact ? "" : "rounded-xl border border-ink-200 bg-ink-50/60 px-3 py-2.5")}>
      {!compact && <Clock size={15} className="text-ink-400 shrink-0" />}
      {!compact && <span className="text-xs font-semibold text-ink-700">Temps passé</span>}
      <input className={cn("input !py-1 !px-2 !w-20 text-right text-sm", invalide && "!border-red-400")} inputMode="decimal"
        placeholder="0" aria-label="Temps passé en heures" value={texte} onChange={e => setTexte(e.target.value)}
        onBlur={valider} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      <span className="text-xs text-ink-500">h</span>
      {[15, 30, 60].map(p => (
        <button key={p} type="button" onClick={() => ajouter(p)} className="px-2 py-1 rounded-lg border border-ink-200 bg-white text-[11px] font-semibold text-ink-600 hover:border-volt-400">
          +{p === 60 ? "1 h" : `${p} min`}
        </button>
      ))}
      {minutes > 0 && <span className="text-xs font-semibold text-ink-900 tabular-nums">{formaterMinutes(minutes)}</span>}
      {chiffreMin ? (
        <span className="text-xs text-ink-500">
          · chiffré {formaterMinutes(chiffreMin)}
          {ecart !== null && <span className={cn("ml-1 font-semibold", ecart > 10 ? "text-red-700" : ecart < -10 ? "text-sky-700" : "text-emerald-700")}>({ecart > 0 ? "+" : ""}{ecart} %)</span>}
        </span>
      ) : null}
      {invalide && <span className="text-xs text-red-700 w-full">Format non reconnu : écris 2,5 ou 2h30 ou 45min.</span>}
    </div>
  );
}

// ─── Bilan ───────────────────────────────────────────────────────────────────────────────────────────────────

const verdict = (chiffreMin: number, passeMin: number): { texte: string; classe: string } | null => {
  const e = ecartPourcent(chiffreMin, passeMin);
  if (e === null) return null;
  if (e > 10) return { texte: `${e} % de plus que chiffré`, classe: "text-red-700" };
  if (e < -10) return { texte: `${-e} % de moins que chiffré`, classe: "text-sky-700" };
  return { texte: "bien estimé", classe: "text-emerald-700" };
};

export function CarteBilan({ bilan, devisChoisi, chargement, erreur, tempsPostes, onTempsPoste }: {
  bilan: Bilan; devisChoisi: boolean; chargement: boolean; erreur: string | null;
  tempsPostes: Record<string, number>; onTempsPoste: (poste: string, minutes: number) => void;
}) {
  const v = verdict(bilan.totalChiffreMin, bilan.totalPasseMin);
  const tauxReel = bilan.totalPasseMin > 0 && bilan.montantMO > 0 ? bilan.montantMO / (bilan.totalPasseMin / 60) : null;
  return (
    <div className="card card-inner mb-4">
      <div className="flex items-center gap-2 mb-1">
        <Clock size={16} className="text-ink-500" />
        <p className="font-semibold text-ink-900">Bilan du temps : chiffré / passé</p>
      </div>
      <p className="text-xs text-ink-500 mb-3">
        Compare les heures de main d'œuvre chiffrées dans le devis (par poste) au temps passé que tu notes sur chaque circuit. Rien n'est obligatoire : ce bilan se remplit au fil du chantier.
      </p>

      {!devisChoisi && <p className="text-xs text-ink-500 bg-ink-50 border border-ink-100 rounded-lg px-3 py-2">Choisis le devis du chantier (carte « Chantier ») pour voir les heures chiffrées. Le temps passé est enregistré dans tous les cas.</p>}
      {devisChoisi && chargement && <p className="text-xs text-ink-400">Lecture du devis…</p>}
      {erreur && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{erreur}</p>}
      {devisChoisi && !chargement && !erreur && !bilan.aDesHeuresChiffrees && (
        <p className="text-xs text-ink-500 bg-ink-50 border border-ink-100 rounded-lg px-3 py-2">
          Ce devis ne contient aucune ligne de main d'œuvre en heures. Dans le pré-devis, saisis les heures par poste (champ « Main d'œuvre » de chaque carte) pour pouvoir comparer.
        </p>
      )}

      {(bilan.lignes.length > 0 || bilan.generalChiffreMin > 0) && (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-ink-400">
                <th className="py-1.5 pr-3 font-semibold">Poste</th>
                <th className="py-1.5 pr-3 font-semibold text-right">Chiffré</th>
                <th className="py-1.5 pr-3 font-semibold text-right">Passé</th>
                <th className="py-1.5 font-semibold text-right">Écart</th>
              </tr>
            </thead>
            <tbody>
              {bilan.lignes.map((l: LigneBilan) => {
                const e = ecartPourcent(l.chiffreMin, l.passeMin);
                return (
                  <tr key={l.poste} className="border-t border-ink-100 align-middle">
                    <td className="py-2 pr-3 text-ink-800 break-words">
                      {l.poste}
                      {l.circuitCle && <span className="block text-[10px] text-ink-400">saisi sur le circuit</span>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink-700">{formaterMinutes(l.chiffreMin)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {l.circuitCle
                        ? <span className="text-ink-900 font-semibold">{formaterMinutes(l.passeMin)}</span>
                        : <SaisieTemps compact minutes={tempsPostes[l.poste] ?? 0} onChange={m => onTempsPoste(l.poste, m)} />}
                    </td>
                    <td className={cn("py-2 text-right tabular-nums font-semibold", e === null ? "text-ink-300" : e > 10 ? "text-red-700" : e < -10 ? "text-sky-700" : "text-emerald-700")}>
                      {e === null ? "—" : `${e > 0 ? "+" : ""}${e} %`}
                    </td>
                  </tr>
                );
              })}
              {bilan.generalChiffreMin > 0 && (
                <tr className="border-t border-ink-100">
                  <td className="py-2 pr-3 text-ink-600">Heures générales (non rattachées à un poste)</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-700">{formaterMinutes(bilan.generalChiffreMin)}</td>
                  <td className="py-2 pr-3 text-right text-ink-300">—</td>
                  <td className="py-2 text-right text-ink-300">—</td>
                </tr>
              )}
              <tr className="border-t-2 border-ink-200 font-semibold">
                <td className="py-2 pr-3 text-ink-900">Total</td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink-900">{formaterMinutes(bilan.totalChiffreMin)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink-900">{formaterMinutes(bilan.totalPasseMin)}</td>
                <td className={cn("py-2 text-right tabular-nums", v?.classe ?? "text-ink-300")}>
                  {ecartPourcent(bilan.totalChiffreMin, bilan.totalPasseMin) === null ? "—" : `${ecartPourcent(bilan.totalChiffreMin, bilan.totalPasseMin)! > 0 ? "+" : ""}${ecartPourcent(bilan.totalChiffreMin, bilan.totalPasseMin)} %`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {bilan.aDesHeuresChiffrees && bilan.aDuTempsPasse && (
        <div className="mt-3 text-xs text-ink-700 space-y-1">
          {v && <p><span className={cn("font-semibold", v.classe)}>Au total : {v.texte}.</span> Chiffré {formaterMinutes(bilan.totalChiffreMin)}, passé {formaterMinutes(bilan.totalPasseMin)}.</p>}
          {tauxReel !== null && <p>Main d'œuvre facturée {bilan.montantMO.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} pour {formaterMinutes(bilan.totalPasseMin)} passées : <span className="font-semibold">{tauxReel.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}/h réel</span>.</p>}
          <p className="text-ink-400">Le temps passé sur un circuit compte au total même si le devis est découpé par pièce (dans ce cas la comparaison poste par poste n'est possible que pour les postes qui sont des circuits).</p>
        </div>
      )}
    </div>
  );
}
