"use client";
// SUIVI DE CHANTIER D'UN DEVIS — fonctionne avec ou sans plan : chaque ligne du devis est une étape à cocher, le temps passé se
// note par poste, et le bilan compare les heures réelles aux heures chiffrées (c'est ce qui alimente la page Rentabilité).
// Stockage : devis.suivi_realisation (migration 013), même format que le suivi d'un plan. Utilisable hors ligne (file locale).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CalendarCheck, Check, Clock, Copy, Euro, RefreshCw, WifiOff, X } from "lucide-react";
import Shell from "@/components/layout/Shell";
import { SaisieTemps } from "@/components/plan/SuiviChantier";
import { supabase } from "@/lib/supabase";
import { cn, fmt } from "@/lib/utils";
import { lireSuivi, formaterMinutes, type SuiviStocke } from "@/lib/suivi-persistance";
import {
  appliquerFile, cleSuiviDevis, ecrireChantier, ecrireCoches, ecrireTemps, enLigne, estErreurReseau, lireDevisMemorise, memoriserDevis,
  nbEnAttente, synchroniser, type ResultatEcritureSuivi,
} from "@/lib/suivi-hors-ligne";
import { avancement, bilanDevis, groupesDevis, type LigneDevisSuivi } from "@/lib/suivi-devis";

const SQL_MIGRATION = "ALTER TABLE devis\n  ADD COLUMN IF NOT EXISTS suivi_realisation TEXT;";

interface DevisSuivi {
  id: string; numero: string; objet?: string | null; statut?: string | null; total_ttc?: number | null;
  suivi_realisation?: string | null; client?: { nom: string; prenom?: string | null } | null; lignes?: LigneDevisSuivi[] | null;
}

const aujourdhui = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dateCourte = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }); };

export default function SuiviDevisPage() {
  const { id } = useParams() as { id: string };
  const [devis, setDevis] = useState<DevisSuivi | null>(null);
  const [copieLocale, setCopieLocale] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [colonneAbsente, setColonneAbsente] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      const SELECT = "id, numero, objet, statut, total_ttc, client:clients(nom, prenom), lignes:devis_lignes(*)";
      let res = await supabase.from("devis").select(`${SELECT}, suivi_realisation`).eq("id", id).single();
      let absente = false;
      if (res.error && /suivi_realisation/i.test(res.error.message)) {
        absente = true; // migration 013 pas encore lancée : on affiche quand même le devis
        res = await supabase.from("devis").select(SELECT).eq("id", id).single() as typeof res;
      }
      if (annule) return;
      if (res.data) {
        const d = res.data as unknown as DevisSuivi;
        setDevis(d); setColonneAbsente(absente);
        if (!absente) memoriserDevis(d);
      } else {
        const copie = lireDevisMemorise<DevisSuivi>(id);
        if (copie) { setDevis(copie.devis); setCopieLocale(copie.le); }
      }
      setChargement(false);
    })();
    return () => { annule = true; };
  }, [id]);

  if (chargement) return <Shell><div className="p-8 text-center text-ink-400">Chargement…</div></Shell>;
  if (!devis) return <Shell><div className="p-8 text-center text-ink-500">Devis introuvable{!enLigne() ? " — tu es hors ligne : ouvre ce suivi une première fois avec du réseau pour le retrouver ensuite sans connexion." : "."}</div></Shell>;
  return <Suivi devis={devis} colonneAbsente={colonneAbsente} copieLocale={copieLocale} />;
}

function Suivi({ devis, colonneAbsente: absenteInitial, copieLocale }: { devis: DevisSuivi; colonneAbsente: boolean; copieLocale: string | null }) {
  const cle = cleSuiviDevis(devis.id);
  const lignes = useMemo(() => devis.lignes ?? [], [devis.lignes]);
  const groupes = useMemo(() => groupesDevis(lignes), [lignes]);
  const initial = useMemo(() => appliquerFile(lireSuivi(devis.suivi_realisation), cle), [devis.suivi_realisation, cle]);

  const [coches, setCoches] = useState(initial.coches);
  const [chantier, setChantier] = useState(initial.chantier);
  const [tempsPostes, setTempsPostes] = useState(initial.tempsPostes);
  const [colonneAbsente, setColonneAbsente] = useState(absenteInitial);
  const [erreur, setErreur] = useState<string | null>(null);
  const [attente, setAttente] = useState(() => nbEnAttente(cle));
  const [horsLigne, setHorsLigne] = useState(() => !enLigne());
  const [enCours, setEnCours] = useState(false);
  const [copie, setCopie] = useState(false);
  const pendingRef = useRef(0);
  const fileRef = useRef<Promise<void>>(Promise.resolve());

  const appliquer = useCallback((brut: SuiviStocke) => {
    const r = appliquerFile(brut, cle);
    setCoches(r.coches); setChantier(r.chantier); setTempsPostes(r.tempsPostes);
  }, [cle]);

  const signaler = useCallback((message: string, colonne: boolean) => {
    if (colonne) setColonneAbsente(true);
    setErreur(colonne ? null : `Enregistrement impossible : ${message}`);
  }, []);

  // Mise à jour immédiate à l'écran, puis écriture en file (une à la fois) qui relit la base avant d'écrire.
  const enregistrer = useCallback((optimiste: () => void, ecrire: () => Promise<ResultatEcritureSuivi>) => {
    optimiste();
    pendingRef.current += 1;
    fileRef.current = fileRef.current.then(async () => {
      const res = await ecrire();
      pendingRef.current -= 1;
      if (res.ok && "enAttente" in res) { setErreur(null); setAttente(res.nbEnAttente); }
      else if (res.ok) { setErreur(null); setAttente(nbEnAttente(cle)); if (pendingRef.current === 0) appliquer(res.suivi); }
      else signaler(res.message, res.colonneAbsente);
    });
  }, [cle, appliquer, signaler]);

  const basculer = (etapeCle: string) => {
    const fait = !coches[etapeCle];
    const dateIso = new Date().toISOString();
    enregistrer(
      () => setCoches(prev => { const n = { ...prev }; if (fait) { if (!n[etapeCle]) n[etapeCle] = dateIso; } else delete n[etapeCle]; return n; }),
      () => ecrireCoches(cle, [etapeCle], fait, dateIso),
    );
  };
  const cocherGroupe = (etapes: string[], fait: boolean) => {
    const dateIso = new Date().toISOString();
    enregistrer(
      () => setCoches(prev => { const n = { ...prev }; etapes.forEach(k => { if (fait) { if (!n[k]) n[k] = dateIso; } else delete n[k]; }); return n; }),
      () => ecrireCoches(cle, etapes, fait, dateIso),
    );
  };
  const changerTemps = (poste: string, minutes: number) => enregistrer(
    () => setTempsPostes(prev => { const n = { ...prev }; if (minutes > 0) n[poste] = Math.round(minutes); else delete n[poste]; return n; }),
    () => ecrireTemps(cle, "tempsPostes", poste, minutes),
  );
  const valider = (date: string | undefined) => enregistrer(
    () => setChantier(prev => { const n = { ...prev, valide_le: date }; if (!n.valide_le) delete n.valide_le; return n; }),
    () => ecrireChantier(cle, { valide_le: date }),
  );

  const envoyerFile = useCallback(async () => {
    if (pendingRef.current > 0 || nbEnAttente(cle) === 0) return;
    setEnCours(true);
    const res = await synchroniser(cle);
    if (res?.ok) { setErreur(null); if (pendingRef.current === 0) appliquer(res.suivi); }
    else if (res && !estErreurReseau(res.message)) signaler(res.message, res.colonneAbsente);
    setAttente(nbEnAttente(cle));
    setEnCours(false);
  }, [cle, appliquer, signaler]);

  const actualiser = useCallback(async () => {
    if (pendingRef.current > 0) return;
    setEnCours(true);
    const { data, error } = await supabase.from("devis").select("suivi_realisation").eq("id", devis.id).single();
    if (!error && data && pendingRef.current === 0) appliquer(lireSuivi((data as { suivi_realisation?: string | null }).suivi_realisation));
    setEnCours(false);
  }, [devis.id, appliquer]);

  useEffect(() => {
    void envoyerFile();
    const retour = () => { setHorsLigne(false); void envoyerFile(); };
    const coupe = () => setHorsLigne(true);
    const visible = () => { if (document.visibilityState === "visible") void actualiser(); };
    window.addEventListener("online", retour); window.addEventListener("offline", coupe);
    document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("online", retour); window.removeEventListener("offline", coupe); document.removeEventListener("visibilitychange", visible); };
  }, [envoyerFile, actualiser]);

  const toutes = useMemo(() => groupes.flatMap(g => g.etapes), [groupes]);
  const global = avancement(toutes, coches);
  const bilan = useMemo(() => bilanDevis(lignes, tempsPostes), [lignes, tempsPostes]);
  const chiffreParPoste = useMemo(() => new Map(bilan.postes.map(p => [p.poste, p.chiffreMin])), [bilan]);
  const client = devis.client ? `${devis.client.prenom ? `${devis.client.prenom} ` : ""}${devis.client.nom}` : "";

  const copierSql = async () => {
    try { await navigator.clipboard.writeText(SQL_MIGRATION); setCopie(true); window.setTimeout(() => setCopie(false), 2000); } catch { /* presse-papiers indisponible */ }
  };

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <Link href={`/devis/${devis.id}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-800 mb-3">
          <ArrowLeft size={13} /> Devis {devis.numero}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div className="min-w-0">
            <h1 className="font-display text-3xl text-ink-900">Suivi de chantier</h1>
            <p className="text-ink-500 text-sm mt-1">{devis.numero}{devis.objet ? ` · ${devis.objet}` : ""}{client ? ` · ${client}` : ""}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void actualiser()} className="btn-ghost !py-2" title="Relire l'enregistrement">
              <RefreshCw size={14} className={enCours ? "animate-spin" : ""} /> Actualiser
            </button>
            <Link href={`/devis/${devis.id}/rentabilite`} className="btn-ghost !py-2"><Euro size={14} /> Rentabilité</Link>
          </div>
        </div>

        {(horsLigne || attente > 0 || copieLocale) && (
          <div className="card card-inner border-amber-300 bg-amber-50 mb-4 flex flex-wrap items-center gap-2 text-sm text-amber-900" role="status">
            <WifiOff size={16} className="shrink-0" />
            <span className="flex-1 min-w-0">
              {horsLigne ? "Hors ligne" : "Connexion rétablie"}
              {attente > 0 ? ` — ${attente} modification${attente > 1 ? "s" : ""} enregistrée${attente > 1 ? "s" : ""} sur cet appareil, envoyée${attente > 1 ? "s" : ""} dès que le réseau revient.` : horsLigne ? " — les modifications seront gardées sur cet appareil." : "."}
              {copieLocale && ` Devis affiché d'après la copie du ${dateCourte(copieLocale)}.`}
            </span>
            {attente > 0 && !horsLigne && <button type="button" onClick={() => void envoyerFile()} className="btn-ghost !py-1.5 !text-xs">Envoyer maintenant</button>}
          </div>
        )}
        {colonneAbsente && (
          <div className="card card-inner border-red-300 bg-red-50 mb-4">
            <p className="font-semibold text-red-800 text-sm">Une étape de mise en place est nécessaire avant de pouvoir enregistrer ce suivi</p>
            <p className="text-xs text-red-700 mt-1">Colle ce SQL dans Supabase → SQL Editor → Run (fichier <span className="font-mono">supabase/migrations/013_devis_suivi_realisation.sql</span>), puis recharge cette page.</p>
            <pre className="mt-2 text-xs bg-white border border-red-200 rounded-lg p-3 overflow-x-auto font-mono text-ink-800">{SQL_MIGRATION}</pre>
            <button type="button" onClick={() => void copierSql()} className="btn-ghost !py-1.5 !text-xs mt-2"><Copy size={12} /> {copie ? "Copié ✓" : "Copier le SQL"}</button>
          </div>
        )}
        {erreur && (
          <div className="card card-inner border-red-300 bg-red-50 mb-4 flex items-start gap-2 text-sm text-red-800">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" /><span className="flex-1">{erreur}</span>
            <button type="button" onClick={() => setErreur(null)} aria-label="Fermer"><X size={15} /></button>
          </div>
        )}

        {/* Synthèse : avancement + heures chiffrées / passées */}
        <div className="card card-inner mb-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="font-semibold text-ink-900">Avancement</p>
            <span className="text-sm font-semibold tabular-nums text-ink-700">{global.fait}/{global.total} · {global.pct} %</span>
          </div>
          <div className="h-2.5 bg-ink-100 rounded-full overflow-hidden mb-4">
            <div className={cn("h-full rounded-full transition-all", global.pct === 100 ? "bg-emerald-500" : "bg-volt-500")} style={{ width: `${global.pct}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div><p className="text-ink-400">Heures chiffrées</p><p className="font-semibold text-ink-900">{bilan.totalChiffreMin > 0 ? formaterMinutes(bilan.totalChiffreMin) : "—"}</p></div>
            <div><p className="text-ink-400">Heures passées</p><p className="font-semibold text-ink-900">{bilan.totalPasseMin > 0 ? formaterMinutes(bilan.totalPasseMin) : "—"}</p></div>
            <div>
              <p className="text-ink-400">Écart</p>
              <p className={cn("font-semibold", bilan.ecartPct === null ? "text-ink-300" : bilan.ecartPct > 10 ? "text-red-700" : bilan.ecartPct < -10 ? "text-sky-700" : "text-emerald-700")}>
                {bilan.ecartPct === null ? "—" : `${bilan.ecartPct > 0 ? "+" : ""}${bilan.ecartPct} %`}
              </p>
            </div>
          </div>
          {bilan.tauxReel !== null && (
            <p className="text-xs text-ink-600 mt-3">Main d&apos;œuvre facturée {fmt(bilan.montantMO)} pour {formaterMinutes(bilan.totalPasseMin)} passées : <span className="font-semibold">{fmt(bilan.tauxReel)}/h réel</span>.</p>
          )}
          {bilan.totalChiffreMin === 0 && <p className="text-[11px] text-ink-400 mt-3">Ce devis n&apos;a aucune ligne de main d&apos;œuvre en heures : le temps passé est enregistré, mais il n&apos;y a rien à comparer.</p>}
          <div className="mt-4 pt-3 border-t border-ink-100 flex flex-wrap items-center gap-2 text-sm">
            <CalendarCheck size={15} className="text-ink-500" />
            {chantier.valide_le ? (
              <>
                <span className="text-ink-800">Chantier validé le {new Date(`${chantier.valide_le}T12:00:00`).toLocaleDateString("fr-FR")}</span>
                {global.pct < 100 && <span className="text-xs text-amber-800">— il reste des étapes non cochées</span>}
                <button type="button" className="btn-ghost !px-2 !py-1 ml-auto" onClick={() => valider(undefined)} aria-label="Retirer la validation"><X size={13} /></button>
              </>
            ) : (
              <button type="button" className="btn-ghost !py-1.5 !text-xs" onClick={() => valider(aujourdhui())}>Valider le chantier aujourd&apos;hui</button>
            )}
          </div>
        </div>

        {groupes.length === 0 && <div className="card card-inner text-ink-500 text-sm">Ce devis ne contient aucune ligne.</div>}

        {groupes.map(g => {
          const av = avancement(g.etapes, coches);
          const cles = g.etapes.map(e => e.cle);
          return (
            <div key={g.poste} className="card card-inner mb-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="font-semibold text-ink-900 min-w-0 break-words">{g.poste}</p>
                <button type="button" className="text-[11px] font-semibold text-volt-700 shrink-0" onClick={() => cocherGroupe(cles, av.fait < av.total)}>
                  {av.fait < av.total ? "Tout cocher" : "Tout décocher"} ({av.fait}/{av.total})
                </button>
              </div>
              <ul className="divide-y divide-ink-100">
                {g.etapes.map(({ cle: k, ligne: l }) => (
                  <li key={k}>
                    <button type="button" onClick={() => basculer(k)} className="w-full flex items-center gap-3 py-2.5 text-left" aria-pressed={!!coches[k]}>
                      <span className={cn("h-6 w-6 rounded-md border-2 flex items-center justify-center shrink-0", coches[k] ? "bg-emerald-500 border-emerald-500 text-white" : "border-ink-300 bg-white")}>
                        {coches[k] && <Check size={15} />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className={cn("block text-sm break-words", coches[k] ? "text-ink-400 line-through" : "text-ink-900")}>{l.nom}</span>
                        <span className="block text-[11px] text-ink-400">{l.quantite ?? 1} {l.unite ?? ""}{coches[k] ? ` · fait le ${dateCourte(coches[k])}` : ""}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 pt-3 border-t border-ink-100">
                <p className="text-[11px] text-ink-400 mb-1.5 flex items-center gap-1"><Clock size={11} /> Temps passé sur ce poste</p>
                <SaisieTemps compact minutes={tempsPostes[g.poste] ?? 0} chiffreMin={chiffreParPoste.get(g.poste) || undefined} onChange={m => changerTemps(g.poste, m)} />
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
