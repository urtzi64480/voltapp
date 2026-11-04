"use client";
// Outil IA du module Tableau : photos du tableau existant → relevé (corrigeable) → tableau refait à la norme → écarts → pré-devis.
// Rien n'est appliqué sans clic explicite ; la NF C 15-100 alerte, elle ne bloque jamais.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ClipboardCopy, ClipboardPaste, FileText, Info, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { consigneReleve, lireReponseClaude } from "@/lib/tableau-ia-import";
import { chargerCatalogueEtTaux } from "@/lib/tableau-catalogue";
import { fondModal } from "@/lib/fond-modal";
import type { BreakerRow } from "@/lib/electrical-constants";
import type { Client, Prestation, Profil } from "@/types";
import { TableauDetail, ZoneZoom } from "@/components/plan/TableauReelVisuels";
import {
  CONTEXTE_DEFAUT, LIBELLE_NATURE, NATURES, OPTIONS_USAGE, appliquerAuTableau, construireProposition, nouveauCircuit,
  type AppareilReleve, type CircuitReleve, type ContexteTableau, type ManqueNorme, type Nature, type Proposition, type RangeeReleve, type ReleveTableau, type UsageReleve,
} from "@/lib/tableau-ia";
import { lignesDevisTableau, preparerPredevisTableau, totauxLignesDevis, type LignePredevisTableau } from "@/lib/tableau-predevis";
import { optionsPourSousCategorie } from "@/lib/predevis-engine";
import { creerDevisBrouillon } from "@/lib/devis-creation";

const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const GRIS = () => "#64748b";

// ─── Sous-composants (hors du composant parent) ───────────────────────────────────────────────────────────────────

function Pastille({ ton, children }: { ton: "ok" | "warn" | "info" | "ajout"; children: React.ReactNode }) {
  const c = { ok: "bg-emerald-50 text-emerald-700 border-emerald-200", warn: "bg-amber-50 text-amber-800 border-amber-200", info: "bg-ink-100 text-ink-600 border-ink-200", ajout: "bg-volt-100 text-volt-800 border-volt-200" }[ton];
  return <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border ${c}`}>{children}</span>;
}

async function copier(texte: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texte); return true; } catch { /* repli ci-dessous (anciens navigateurs, http) */ }
  try {
    const t = document.createElement("textarea");
    t.value = texte; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(t);
    return ok;
  } catch { return false; }
}

function EtapeConsigne({ contexte, setContexte, notes, setNotes, reponse, setReponse, erreur, onLire }: {
  contexte: ContexteTableau; setContexte: (c: ContexteTableau) => void; notes: string; setNotes: (s: string) => void;
  reponse: string; setReponse: (s: string) => void; erreur: string | null; onLire: () => void;
}) {
  const [copie, setCopie] = useState<"non" | "oui" | "echec">("non");
  const [avisColler, setAvisColler] = useState<string | null>(null);
  const consigne = useMemo(() => consigneReleve(notes), [notes]);
  async function copierConsigne() { setCopie((await copier(consigne)) ? "oui" : "echec"); }
  async function coller() {
    setAvisColler(null);
    try { setReponse(await navigator.clipboard.readText()); } catch { setAvisColler("Collage automatique refusé par le navigateur : appuyez longuement dans la zone et choisissez « Coller »."); }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] h-full min-h-0 overflow-auto lg:overflow-visible content-start">
      <div className="card card-inner lg:overflow-auto space-y-4">
        <div>
          <h3 className="font-semibold text-ink-900">Lire les photos avec Claude (compris dans ton abonnement)</h3>
          <p className="text-xs text-ink-500 mt-1">Aucune clé ni coût en plus : tu envoies les photos à Claude, puis tu rapportes sa réponse ici. Fonctionne pareil sur PC et sur téléphone.</p>
        </div>
        <ol className="space-y-4 text-sm">
          <li className="space-y-2">
            <p><strong>1.</strong> Copie la consigne.</p>
            <button className="btn-volt" onClick={copierConsigne}><ClipboardCopy size={15} />{copie === "oui" ? "Consigne copiée" : "Copier la consigne"}</button>
            {copie === "echec" && <div><p className="text-xs text-amber-800 mb-1">Copie automatique impossible : sélectionnez le texte ci-dessous et copiez-le.</p><textarea readOnly className="input !text-xs" rows={6} value={consigne} onFocus={e => e.currentTarget.select()} /></div>}
          </li>
          <li><strong>2.</strong> Ouvre <strong>Claude</strong> (appli ou claude.ai), démarre une conversation, joins tes <strong>photos du tableau</strong> (une vue d&apos;ensemble, puis un gros plan par rangée si les étiquettes sont petites, capot ouvert), colle la consigne et envoie.</li>
          <li><strong>3.</strong> Copie <strong>toute la réponse</strong> de Claude (bouton « copier » sous la réponse).</li>
          <li className="space-y-2">
            <p><strong>4.</strong> Colle-la ici.</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={coller}><ClipboardPaste size={15} />Coller depuis le presse-papiers</button>
              {reponse && <button className="btn-ghost" onClick={() => setReponse("")}><X size={14} />Effacer</button>}
            </div>
            <textarea className="input !text-xs font-mono" rows={8} value={reponse} onChange={e => setReponse(e.target.value)} placeholder="Réponse de Claude (JSON)…" aria-label="Réponse de Claude" />
            {avisColler && <p className="text-xs text-amber-800">{avisColler}</p>}
            {erreur && <p className="text-sm text-red-700" role="alert">{erreur}</p>}
          </li>
        </ol>
      </div>
      <div className="card card-inner lg:overflow-auto space-y-3">
        <h3 className="font-semibold text-ink-900">Contexte du logement</h3>
        <label className="block"><span className="label">Surface habitable (m²)</span>
          <input className="input" type="number" min={0} inputMode="decimal" value={contexte.surfaceM2 ?? ""} onChange={e => { const v = parseFloat(e.target.value); setContexte({ ...contexte, surfaceM2: Number.isFinite(v) && v > 0 ? v : null }); }} />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={contexte.collectif} onChange={e => setContexte({ ...contexte, collectif: e.target.checked })} />Logement collectif</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={contexte.parafoudreRequis} onChange={e => setContexte({ ...contexte, parafoudreRequis: e.target.checked })} />Parafoudre requis (zone AQ2, paratonnerre, ligne aérienne…)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={contexte.porte} onChange={e => setContexte({ ...contexte, porte: e.target.checked })} />Tableau derrière une porte</label>
        <label className="block"><span className="label">Précisions pour Claude (facultatif)</span>
          <textarea className="input" rows={3} maxLength={300} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex. maison de 1975, tableau 2 rangées Legrand" />
        </label>
        <button className="btn-volt w-full" disabled={reponse.trim().length === 0} onClick={onLire}><Sparkles size={15} />Lire la réponse</button>
      </div>
    </div>
  );
}

const NATURES_EDITABLES: Nature[] = NATURES.filter(n => n !== "vide" && n !== "differentiel");

function LigneAppareil({ a, onChange, onSupprimer }: { a: AppareilReleve; onChange: (p: Partial<AppareilReleve>) => void; onSupprimer: () => void }) {
  const incertain = a.confiance === "basse" || (a.calibreA == null && ["disjoncteur", "disjoncteur_differentiel", "fusible"].includes(a.nature));
  return (
    <div className={`grid grid-cols-[auto_minmax(0,1.2fr)_70px_minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-2 items-center py-1.5 border-b border-ink-100 ${a.ecarte ? "opacity-40" : ""}`}>
      <input type="checkbox" checked={!a.ecarte} onChange={e => onChange({ ecarte: !e.target.checked })} aria-label="Reprendre cet appareil" />
      <input className="input !py-1 !text-xs" value={a.etiquette} maxLength={120} placeholder="Étiquette" onChange={e => onChange({ etiquette: e.target.value })} />
      <input className={`input !py-1 !text-xs ${incertain ? "!border-amber-400" : ""}`} type="number" min={1} max={160} placeholder="A" value={a.calibreA ?? ""}
        onChange={e => { const v = parseFloat(e.target.value); onChange({ calibreA: Number.isFinite(v) && v > 0 ? v : null }); }} aria-label="Calibre (A)" />
      <select className="input !py-1 !text-xs" value={a.nature} onChange={e => onChange({ nature: e.target.value as Nature })} aria-label="Nature">
        {NATURES_EDITABLES.map(n => <option key={n} value={n}>{LIBELLE_NATURE[n]}</option>)}
      </select>
      <select className="input !py-1 !text-xs" value={a.usage} onChange={e => onChange({ usage: e.target.value as UsageReleve })} aria-label="Usage">
        <option value="inconnu">Usage : à déduire</option>
        {OPTIONS_USAGE.map(o => <option key={o.usage} value={o.usage}>{o.label}</option>)}
      </select>
      <button className="btn-ghost !px-1.5" onClick={onSupprimer} aria-label="Supprimer la ligne"><Trash2 size={14} /></button>
    </div>
  );
}

function BlocRangee({ r, onChange }: { r: RangeeReleve; onChange: (r: RangeeReleve) => void }) {
  const d = r.differentiel;
  const majApp = (i: number, p: Partial<AppareilReleve>) => onChange({ ...r, appareils: r.appareils.map((a, k) => (k === i ? { ...a, ...p } : a)) });
  const ajouter = () => onChange({ ...r, appareils: [...r.appareils, { nature: "disjoncteur", calibreA: null, poles: null, etiquette: "", usage: "inconnu", confiance: "moyenne", sensibiliteMa: null, typeDiff: "inconnu", sectionMm2: null }] });
  return (
    <div className="card card-inner">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input className="input !py-1 !text-sm font-semibold max-w-[220px]" value={r.nom} maxLength={40} onChange={e => onChange({ ...r, nom: e.target.value })} aria-label="Nom de la rangée" />
        {d ? (
          <span className="flex items-center gap-1.5 text-xs text-ink-600">
            Différentiel
            <input className="input !py-1 !text-xs w-16" type="number" min={1} placeholder="A" value={d.calibreA ?? ""} onChange={e => { const v = parseFloat(e.target.value); onChange({ ...r, differentiel: { ...d, calibreA: Number.isFinite(v) && v > 0 ? v : null } }); }} aria-label="Calibre du différentiel (A)" />
            <input className="input !py-1 !text-xs w-20" type="number" min={1} placeholder="mA" value={d.sensibiliteMa ?? ""} onChange={e => { const v = parseFloat(e.target.value); onChange({ ...r, differentiel: { ...d, sensibiliteMa: Number.isFinite(v) && v > 0 ? v : null } }); }} aria-label="Sensibilité (mA)" />
            <select className="input !py-1 !text-xs w-24" value={d.type} onChange={e => onChange({ ...r, differentiel: { ...d, type: e.target.value as typeof d.type } })} aria-label="Type du différentiel">
              {(["AC", "A", "F", "B", "inconnu"] as const).map(t => <option key={t} value={t}>{t === "inconnu" ? "Type ?" : `Type ${t}`}</option>)}
            </select>
          </span>
        ) : <Pastille ton="warn">Pas de différentiel de tête relevé</Pastille>}
      </div>
      {r.appareils.map((a, i) => (
        <LigneAppareil key={i} a={a} onChange={p => majApp(i, p)} onSupprimer={() => onChange({ ...r, appareils: r.appareils.filter((_, k) => k !== i) })} />
      ))}
      <button className="btn-ghost !text-xs mt-2" onClick={ajouter}><Plus size={13} />Ajouter un appareil lu</button>
    </div>
  );
}

function EtapeReleve({ releve, setReleve, onSuite, onRetour }: { releve: ReleveTableau; setReleve: (r: ReleveTableau) => void; onSuite: () => void; onRetour: () => void }) {
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="flex-1 min-h-0 overflow-auto space-y-3">
        {!releve.photosExploitables && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm p-3 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" />Les photos n&apos;ont pas permis de lire un tableau. Reprenez des photos plus nettes, ou saisissez les appareils à la main ci-dessous.</div>
        )}
        <div className="card card-inner">
          <h3 className="font-semibold text-ink-900">Relevé lu sur les photos — vérifiez et corrigez</h3>
          <p className="text-xs text-ink-500 mt-1">Cases décochées = non reprises. Les champs en orange sont illisibles ou incertains.{releve.marque ? ` Marque : ${releve.marque}.` : ""}{releve.disjoncteurAbonne.present ? ` Disjoncteur d'abonné${releve.disjoncteurAbonne.calibreA ? ` ${releve.disjoncteurAbonne.calibreA} A` : ""}.` : ""}</p>
        </div>
        {releve.rangees.map((r, i) => (
          <BlocRangee key={i} r={r} onChange={nr => setReleve({ ...releve, rangees: releve.rangees.map((x, k) => (k === i ? nr : x)) })} />
        ))}
        <button className="btn-ghost" onClick={() => setReleve({ ...releve, rangees: [...releve.rangees, { nom: `Rangée ${releve.rangees.length + 1}`, differentiel: null, appareils: [] }] })}><Plus size={14} />Ajouter une rangée</button>
        {releve.observations.length > 0 && (
          <div className="card card-inner">
            <h4 className="font-semibold text-sm mb-2">Observations sur les photos</h4>
            <ul className="space-y-1">{releve.observations.map((o, i) => (
              <li key={i} className="text-sm flex gap-2"><Pastille ton={o.gravite === "securite" ? "warn" : "info"}>{o.gravite}</Pastille><span>{o.texte}</span></li>
            ))}</ul>
          </div>
        )}
        {releve.questions.length > 0 && (
          <div className="card card-inner"><h4 className="font-semibold text-sm mb-2">À vérifier sur place</h4><ul className="list-disc pl-5 text-sm space-y-0.5">{releve.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>
        )}
      </div>
      <div className="flex justify-between shrink-0">
        <button className="btn-ghost" onClick={onRetour}>Réponse de Claude</button>
        <button className="btn-volt" onClick={onSuite} disabled={releve.rangees.every(r => r.appareils.length === 0)}><Sparkles size={15} />Refaire le tableau à la norme</button>
      </div>
    </div>
  );
}

function ListeEcarts({ p, onAjouter }: { p: Proposition; onAjouter: (m: ManqueNorme) => void }) {
  const ton = { modif: "warn", ajout: "ajout", alerte: "warn", info: "info" } as const;
  const lib = { modif: "Modifié", ajout: "Ajouté", alerte: "À vérifier", info: "Info" } as const;
  return (
    <div className="space-y-3 overflow-auto h-full">
      <div className="card card-inner flex flex-wrap gap-4 text-sm">
        <span>Alertes avant : <strong>{p.nbNonConformesAvant}</strong></span>
        <span>Alertes après : <strong className={p.nbNonConformesApres === 0 ? "text-emerald-700" : "text-amber-700"}>{p.nbNonConformesApres}</strong></span>
        <span>Circuits : <strong>{p.nbCircuits}</strong></span>
        <span>Différentiels 30 mA : <strong>{p.resAvant.totaux.differentiels} → {p.resApres.totaux.differentiels}</strong></span>
      </div>
      {p.manques.length > 0 && (
        <div className="card card-inner">
          <h4 className="font-semibold text-sm mb-2">Minima de la norme non atteints</h4>
          <ul className="space-y-2">{p.manques.map(m => (
            <li key={m.id} className="text-sm flex items-start gap-2">
              <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
              <span className="flex-1">{m.texte} <span className="text-[11px] text-ink-400">{m.source}{m.statut === "a_verifier" ? " — à vérifier" : ""}</span></span>
              {m.ajout && <button className="btn-ghost !text-xs shrink-0" onClick={() => onAjouter(m)}><Plus size={13} />Ajouter</button>}
            </li>
          ))}</ul>
        </div>
      )}
      <div className="card card-inner">
        <h4 className="font-semibold text-sm mb-2">Ce qui change par rapport à l&apos;existant</h4>
        {p.ecarts.length === 0 ? <p className="text-sm text-ink-500">Aucun écart : le tableau relevé est déjà conforme aux règles contrôlées.</p> : (
          <ul className="space-y-1.5">{p.ecarts.map((e, i) => (
            <li key={i} className="text-sm flex gap-2 items-start"><Pastille ton={ton[e.niveau]}>{lib[e.niveau]}</Pastille><span>{e.texte}{e.source && <span className="text-[11px] text-ink-400"> — {e.source}{e.statut === "a_verifier" ? " (à vérifier)" : ""}</span>}</span></li>
          ))}</ul>
        )}
      </div>
      {(p.nonRepris.length > 0 || p.aVerifierSurPlace.length > 0) && (
        <div className="card card-inner">
          <h4 className="font-semibold text-sm mb-2">À contrôler sur place</h4>
          <ul className="space-y-1">{[...p.nonRepris, ...p.aVerifierSurPlace].map((t, i) => <li key={i} className="text-sm flex gap-2"><Info size={14} className="text-ink-400 shrink-0 mt-0.5" />{t}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function ListeControles({ p }: { p: Proposition }) {
  const c = p.resApres.controles;
  return (
    <div className="card card-inner overflow-auto h-full">
      <h4 className="font-semibold text-sm mb-2">Contrôles NF C 15-100 du tableau refait</h4>
      {c.length === 0 ? <p className="text-sm text-emerald-700 flex items-center gap-1.5"><Check size={15} />Aucune alerte.</p> : (
        <ul className="space-y-2">{c.map(x => (
          <li key={x.id} className="text-sm">
            <div className="flex items-center gap-2"><Pastille ton={x.niveau === "info" ? "info" : "warn"}>{x.niveau}</Pastille><strong>{x.titre}</strong>{x.statut === "a_verifier" && <Pastille ton="info">à vérifier</Pastille>}</div>
            <p className="text-ink-600 ml-1 mt-0.5">{x.detail} <span className="text-[11px] text-ink-400">{x.source}</span></p>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

export function PanneauPredevis({ lignes, setLignes, prestations, chargement, erreur, heures, setHeures, taux, nbSansArticle, onCreer, creation }: {
  lignes: LignePredevisTableau[]; setLignes: (l: LignePredevisTableau[]) => void; prestations: Prestation[] | null; chargement: boolean; erreur: string | null;
  heures: string; setHeures: (s: string) => void; taux: number; nbSansArticle: number; onCreer: () => void; creation: boolean;
}) {
  const h = parseFloat(heures.replace(",", ".")) || 0;
  const lignesDevis = useMemo(() => lignesDevisTableau(lignes, prestations ?? [], h > 0 ? { heures: h, tauxHoraire: taux } : undefined), [lignes, prestations, h, taux]);
  const t = totauxLignesDevis(lignesDevis);
  const maj = (i: number, p: Partial<LignePredevisTableau>) => setLignes(lignes.map((l, k) => (k === i ? { ...l, ...p } : l)));
  if (chargement) return <div className="h-full grid place-items-center text-ink-500 text-sm"><Loader2 className="animate-spin" /></div>;
  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      {erreur && <p className="text-sm text-red-700" role="alert">{erreur}</p>}
      {nbSansArticle > 0 && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">{nbSansArticle} ligne(s) sans article au catalogue : elles seront créées « À compléter » à 0 € (le devis ne pourra pas être envoyé tant qu&apos;elles ne sont pas chiffrées).</p>}
      <div className="card card-inner flex-1 min-h-0 overflow-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] text-ink-500"><th className="w-8"></th><th>Besoin</th><th className="text-right w-12">Qté</th><th>Article du catalogue</th><th className="text-right w-24">Total</th></tr></thead>
          <tbody>{lignes.map((l, i) => {
            const opt = l.besoin.options[l.indexOption];
            return (
              <tr key={l.besoin.cle} className={`border-t border-ink-100 ${l.inclus ? "" : "opacity-40"}`}>
                <td><input type="checkbox" checked={l.inclus} onChange={e => maj(i, { inclus: e.target.checked })} aria-label="Inclure cette ligne" /></td>
                <td className="py-1.5 pr-2">{l.besoin.label}</td>
                <td className="text-right">{Math.round(l.besoin.quantite * 100) / 100}{l.besoin.unite === "m" ? " m" : ""}</td>
                <td className="px-2">{l.besoin.options.length === 0 ? <Pastille ton="warn">À compléter</Pastille> : (
                  <select className="input !py-1 !text-xs" value={l.indexOption} onChange={e => maj(i, { indexOption: parseInt(e.target.value, 10) })}>
                    {l.besoin.options.map((o, k) => <option key={o.prestation_id + k} value={k}>{o.nom} — {eur(o.prix_unitaire)}</option>)}
                  </select>
                )}</td>
                <td className="text-right font-mono text-xs">{opt ? eur(opt.prix_unitaire * l.besoin.quantite * (opt.quantiteMultiplicateur ?? 1)) : "—"}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <div className="card card-inner shrink-0 flex flex-wrap items-end gap-4 justify-between">
        <label className="block"><span className="label">Main d&apos;œuvre (heures, à {eur(taux)}/h)</span>
          <input className="input w-28" inputMode="decimal" value={heures} onChange={e => setHeures(e.target.value)} placeholder="0" />
        </label>
        <div className="text-sm text-right">
          <div>Matériel {eur(t.materiau)} · Main d&apos;œuvre {eur(t.service)}</div>
          <div className="font-semibold text-ink-900">Total {eur(t.total)}</div>
        </div>
        <button className="btn-volt" disabled={creation || lignesDevis.length === 0} onClick={onCreer}>
          {creation ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}Créer le devis brouillon
        </button>
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────────────────────────────────────────

type Etape = "consigne" | "releve" | "proposition";
type Onglet = "tableau" | "ecarts" | "controles" | "predevis";

export default function TableauIAModal({ clientId, client, rowsActuelles, onAppliquer, onClose }: {
  clientId: string; client: Client | null; rowsActuelles: BreakerRow[]; onAppliquer: (rows: BreakerRow[]) => void; onClose: () => void;
}) {
  const router = useRouter();
  const [etape, setEtape] = useState<Etape>("consigne");
  const [onglet, setOnglet] = useState<Onglet>("tableau");
  const [reponse, setReponse] = useState("");
  const [contexte, setContexte] = useState<ContexteTableau>({ ...CONTEXTE_DEFAUT, surfaceM2: client?.surface_m2 && client.surface_m2 > 0 ? client.surface_m2 : null });
  const [notes, setNotes] = useState(client?.tableau_marque ? `Marque : ${client.tableau_marque}` : "");
  const [erreur, setErreur] = useState<string | null>(null);
  const [releve, setReleve] = useState<ReleveTableau | null>(null);
  const [ajouts, setAjouts] = useState<CircuitReleve[]>([]);
  const [prestations, setPrestations] = useState<Prestation[] | null>(null);
  const [profil, setProfil] = useState<Pick<Profil, "taux_horaire"> | null>(null);
  const [chargementCatalogue, setChargementCatalogue] = useState(false);
  const [erreurCatalogue, setErreurCatalogue] = useState<string | null>(null);
  const [lignes, setLignes] = useState<LignePredevisTableau[]>([]);
  const [heures, setHeures] = useState("");
  const [creation, setCreation] = useState(false);
  const [confirmation, setConfirmation] = useState(false);

  function lireReponse() {
    const r = lireReponseClaude(reponse);
    if (!r.releve) { setErreur(r.erreur ?? "Réponse illisible."); return; }
    setErreur(null); setReleve(r.releve); setAjouts([]); setEtape("releve");
  }

  const proposition = useMemo<Proposition | null>(() => (releve && etape === "proposition" ? construireProposition(releve, ajouts, contexte) : null), [releve, ajouts, contexte, etape]);

  // Catalogue chargé à la première ouverture de l'onglet pré-devis.
  useEffect(() => {
    if (onglet !== "predevis" || prestations || chargementCatalogue) return;
    let annule = false;
    setChargementCatalogue(true); setErreurCatalogue(null);
    (async () => {
      try {
        const r = await chargerCatalogueEtTaux();
        if (!annule) { setPrestations(r.prestations); setProfil(r.profil); }
      } catch (e) {
        if (!annule) setErreurCatalogue(`Catalogue indisponible : ${(e as Error).message}`);
      } finally {
        if (!annule) setChargementCatalogue(false);
      }
    })();
    return () => { annule = true; };
  }, [onglet, prestations, chargementCatalogue]);

  // Les lignes du pré-devis sont recalculées quand le tableau (ou le catalogue) change ; les choix manuels se perdent alors, volontairement.
  const rowsProposees = proposition?.rows;
  const [signature, setSignature] = useState("");
  useEffect(() => {
    if (!rowsProposees || !prestations) return;
    const sig = JSON.stringify(rowsProposees.map(r => r.slots.map(b => b && [b.circuit, b.amperes, b.type]))) + prestations.length;
    if (sig === signature) return;
    setSignature(sig);
    setLignes(preparerPredevisTableau(rowsProposees, prestations).lignes);
  }, [rowsProposees, prestations, signature]);

  const nbSansArticle = lignes.filter(l => l.besoin.options.length === 0).length;
  const optionMO = useMemo(() => optionsPourSousCategorie("main_oeuvre", prestations ?? [])[0] ?? null, [prestations]);
  const tauxHoraire = optionMO?.prix_unitaire ?? profil?.taux_horaire ?? 0;

  const ajouterManque = (m: ManqueNorme) => {
    if (!m.ajout) return;
    setAjouts(a => [...a, { ...nouveauCircuit(m.ajout!.usage, m.ajout!.etiquette), id: 1000 + a.length }]);
  };

  async function creerDevis() {
    if (creation || !prestations) return;
    setCreation(true); setErreurCatalogue(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) { setErreurCatalogue("Session expirée : reconnectez-vous."); return; }
      const h = parseFloat(heures.replace(",", ".")) || 0;
      const l = lignesDevisTableau(lignes, prestations, h > 0 ? { heures: h, tauxHoraire, option: optionMO ? { nom: optionMO.nom, prestation_id: optionMO.prestation_id } : null } : undefined);
      const res = await creerDevisBrouillon(supabase, uid, clientId, "Pré-devis — remplacement du tableau électrique", l);
      if (res.erreur || !res.id) { setErreurCatalogue(res.erreur ?? "Création impossible."); return; }
      router.push(`/devis/${res.id}`);
    } finally {
      setCreation(false);
    }
  }

  const ratio = useMemo(() => {
    if (!proposition) return 1.4;
    const r = proposition.resApres;
    return (78 + r.coffret.modulesParRail * 27 + 150) / (118 + r.rails.length * 232 + 60);
  }, [proposition]);

  const titres: Record<Etape, string> = { consigne: "1 · Lecture", releve: "2 · Relevé", proposition: "3 · Tableau à la norme" };
  const appliquer = () => {
    if (!proposition) return;
    onAppliquer(appliquerAuTableau(rowsActuelles, proposition.rows));
    setConfirmation(true);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex" {...fondModal(onClose)} role="dialog" aria-modal="true" aria-label="Tableau refait par l'IA">
      <div className="m-0 md:m-3 flex-1 bg-ink-50 md:rounded-2xl shadow-2xl flex flex-col min-h-0" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ink-200 bg-white md:rounded-t-2xl shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={18} className="text-volt-600 shrink-0" />
            <h2 className="font-semibold text-ink-900 truncate">Tableau refait par l&apos;IA</h2>
            <span className="hidden sm:flex gap-1 ml-2">{(Object.keys(titres) as Etape[]).map(e => <Pastille key={e} ton={e === etape ? "ajout" : "info"}>{titres[e]}</Pastille>)}</span>
          </div>
          <button className="btn-ghost !px-2" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>

        <div className="flex-1 min-h-0 p-3 md:p-4">
          {confirmation ? (
            <div className="h-full grid place-items-center">
              <div className="card card-inner max-w-md text-center space-y-3">
                <Check className="mx-auto text-emerald-600" size={32} />
                <h3 className="font-semibold text-ink-900">Tableau mis à jour</h3>
                <p className="text-sm text-ink-600">Le nouveau tableau remplace les rangées de puissance (le coffret de communication est conservé). Il est enregistré automatiquement ; un bouton « Annuler » reste disponible dans la page.</p>
                <button className="btn-volt" onClick={onClose}>Voir le tableau</button>
              </div>
            </div>
          ) : etape === "consigne" ? (
            <EtapeConsigne contexte={contexte} setContexte={setContexte} notes={notes} setNotes={setNotes} reponse={reponse} setReponse={setReponse} erreur={erreur} onLire={lireReponse} />
          ) : etape === "releve" && releve ? (
            <EtapeReleve releve={releve} setReleve={setReleve} onRetour={() => setEtape("consigne")} onSuite={() => { setOnglet("tableau"); setEtape("proposition"); }} />
          ) : proposition ? (
            <div className="h-full min-h-0 flex flex-col gap-3">
              <div className="flex items-center gap-1 shrink-0 overflow-x-auto">
                {([["tableau", "Tableau refait"], ["ecarts", `Écarts (${proposition.ecarts.length + proposition.manques.length})`], ["controles", `Contrôles (${proposition.resApres.controles.length})`], ["predevis", "Pré-devis"]] as [Onglet, string][]).map(([k, l]) => (
                  <button key={k} onClick={() => setOnglet(k)} className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${onglet === k ? "bg-volt-500 text-ink-900" : "bg-white border border-ink-200 text-ink-600"}`}>{l}</button>
                ))}
              </div>
              <div className="flex-1 min-h-0">
                {onglet === "tableau" && (
                  <div className="h-full grid gap-3 lg:grid-cols-2 min-h-0">
                    <div className="card card-inner flex flex-col min-h-0"><h4 className="font-semibold text-sm mb-2">Avant — tel que relevé</h4>
                      <ZoneZoom ratio={1.4} className="flex-1"><TableauDetail res={proposition.resAvant} params={proposition.params} couleurGaine={GRIS} selectionne={null} onSelect={() => {}} /></ZoneZoom></div>
                    <div className="card card-inner flex flex-col min-h-0"><h4 className="font-semibold text-sm mb-2">Après — à la norme</h4>
                      <ZoneZoom ratio={ratio} className="flex-1"><TableauDetail res={proposition.resApres} params={proposition.params} couleurGaine={GRIS} selectionne={null} onSelect={() => {}} /></ZoneZoom></div>
                  </div>
                )}
                {onglet === "ecarts" && <ListeEcarts p={proposition} onAjouter={ajouterManque} />}
                {onglet === "controles" && <ListeControles p={proposition} />}
                {onglet === "predevis" && (
                  <PanneauPredevis lignes={lignes} setLignes={setLignes} prestations={prestations} chargement={chargementCatalogue || !prestations && !erreurCatalogue} erreur={erreurCatalogue}
                    heures={heures} setHeures={setHeures} taux={tauxHoraire} nbSansArticle={nbSansArticle} onCreer={creerDevis} creation={creation} />
                )}
              </div>
              <div className="flex flex-wrap justify-between items-center gap-2 shrink-0">
                <button className="btn-ghost" onClick={() => setEtape("releve")}>Corriger le relevé</button>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-500 hidden md:inline">Remplace les rangées de puissance du tableau actif (annulable).</span>
                  <button className="btn-volt" onClick={appliquer} disabled={proposition.nbCircuits === 0}><Check size={15} />Appliquer au tableau</button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

