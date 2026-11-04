"use client";
// Devis rapide par dictée : on parle (ou on tape), VoltApp reconnaît le client et rapproche chaque ligne du catalogue. Rien n'est inventé :
// une ligne sans article du catalogue reste « À compléter » à 0 €. Le devis est créé en brouillon, à relire avant envoi.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText, Loader2, Mic, MicOff, Search, Trash2, X } from "lucide-react";
import Shell from "@/components/layout/Shell";
import { supabase } from "@/lib/supabase";
import { attacherFournisseurs } from "@/lib/fournisseurs";
import { creerDevisBrouillon } from "@/lib/devis-creation";
import { totauxLignesDevis } from "@/lib/tableau-predevis";
import { analyserDictee, chercherArticles, libelleClient, lignesDepuisDictee, type ChoixLigneVocale, type ClientCourt, type LigneVocale } from "@/lib/devis-vocal";
import type { Prestation } from "@/types";

const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

// ─── Reconnaissance vocale du navigateur (gratuite ; Chrome / Edge / Safari — sinon, micro du clavier du téléphone) ───

interface ReconnaissanceVocale {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type FabriqueReconnaissance = new () => ReconnaissanceVocale;

function fabrique(): FabriqueReconnaissance | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: FabriqueReconnaissance; webkitSpeechRecognition?: FabriqueReconnaissance };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function useDictee(surPhrase: (t: string) => void) {
  const [supporte, setSupporte] = useState(false);
  const [ecoute, setEcoute] = useState(false);
  const [interim, setInterim] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const rec = useRef<ReconnaissanceVocale | null>(null);
  const voulu = useRef(false);
  const redemarrages = useRef(0);
  const surPhraseRef = useRef(surPhrase);
  surPhraseRef.current = surPhrase;

  useEffect(() => {
    setSupporte(fabrique() !== null);
    return () => { voulu.current = false; try { rec.current?.abort(); } catch { /* déjà arrêtée */ } };
  }, []);

  function lancer() {
    const F = fabrique();
    if (!F) return;
    const r = new F();
    r.lang = "fr-FR"; r.continuous = true; r.interimResults = true;
    r.onresult = e => {
      let provisoire = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0]?.transcript ?? "";
        if (res.isFinal) { if (t.trim()) surPhraseRef.current(t.trim()); redemarrages.current = 0; } else provisoire += t;
      }
      setInterim(provisoire);
    };
    r.onerror = e => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      voulu.current = false;
      setErreur(
        e.error === "not-allowed" || e.error === "service-not-allowed" ? "Micro refusé : autorise-le dans les réglages du navigateur (cadenas à côté de l'adresse)."
        : e.error === "audio-capture" ? "Aucun micro détecté."
        : e.error === "network" ? "Dictée indisponible sans connexion. Tape le texte, ou utilise le micro du clavier."
        : `Dictée interrompue (${e.error}).`);
    };
    r.onend = () => {
      setInterim("");
      if (!voulu.current) { setEcoute(false); return; }
      // Le navigateur coupe l'écoute après un silence : on relance, sauf boucle d'échecs.
      if (++redemarrages.current > 6) { voulu.current = false; setEcoute(false); setErreur("La dictée s'est arrêtée. Appuie de nouveau sur le micro."); return; }
      setTimeout(() => { if (voulu.current) { try { r.start(); } catch { voulu.current = false; setEcoute(false); } } }, 250);
    };
    rec.current = r;
    try { r.start(); setEcoute(true); } catch { voulu.current = false; setEcoute(false); setErreur("Impossible de démarrer le micro."); }
  }

  return {
    supporte, ecoute, interim, erreur,
    basculer() {
      setErreur(null);
      if (voulu.current) { voulu.current = false; try { rec.current?.stop(); } catch { /* déjà arrêtée */ } setEcoute(false); return; }
      voulu.current = true; redemarrages.current = 0; lancer();
    },
  };
}

// ─── Sous-composants ──────────────────────────────────────────────────────────────────────────────────────────────

type Correction = Partial<ChoixLigneVocale>;

function LigneRapide({ l, etat, prestations, onChange }: { l: LigneVocale; etat: ChoixLigneVocale; prestations: Prestation[]; onChange: (c: Correction) => void }) {
  const [recherche, setRecherche] = useState<string | null>(null);
  const choisi = etat.prestationId ? prestations.find(p => p.id === etat.prestationId) : undefined;
  const options = useMemo(() => {
    const m = new Map<string, Prestation>();
    l.candidats.forEach(c => m.set(c.prestation.id, c.prestation));
    if (choisi) m.set(choisi.id, choisi);
    return Array.from(m.values());
  }, [l.candidats, choisi]);
  const trouves = useMemo(() => (recherche && recherche.trim().length >= 2 ? chercherArticles(recherche, prestations, 8) : []), [recherche, prestations]);
  const total = choisi ? choisi.prix_unitaire * etat.quantite : 0;

  return (
    <div className={`card card-inner !p-3 ${etat.inclus ? "" : "opacity-50"}`}>
      <div className="flex items-start gap-2">
        <input type="checkbox" className="mt-1.5" checked={etat.inclus} onChange={e => onChange({ inclus: e.target.checked })} aria-label="Garder cette ligne" />
        <div className="flex-1 min-w-0 space-y-2">
          <p className="text-xs text-ink-400 truncate" title={l.segment.brut}>« {l.segment.brut} »</p>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input !py-1 w-20 !text-sm" type="number" min={0} step={l.segment.heures ? 0.5 : 1} inputMode="decimal" value={etat.quantite}
              onChange={e => { const v = parseFloat(e.target.value); onChange({ quantite: Number.isFinite(v) && v >= 0 ? v : 0 }); }} aria-label="Quantité" />
            <select className="input !py-1 flex-1 min-w-[180px] !text-sm" value={etat.prestationId ?? ""} onChange={e => onChange({ prestationId: e.target.value || null })} aria-label="Article du catalogue">
              <option value="">{l.segment.heures ? "Main d'œuvre au taux horaire" : "À compléter (sans article)"}</option>
              {options.map(p => <option key={p.id} value={p.id}>{p.nom} — {eur(p.prix_unitaire)}</option>)}
            </select>
            <button className="btn-ghost !px-2" onClick={() => setRecherche(r => (r === null ? "" : null))} aria-label="Chercher un autre article"><Search size={15} /></button>
            <span className="ml-auto font-mono text-sm text-ink-700 w-24 text-right">{choisi ? eur(total) : "—"}</span>
          </div>
          {!choisi && !l.segment.heures && <p className="text-xs text-amber-700">Aucun article sûr : choisis-en un, ou laisse « À compléter » (ligne à 0 €).</p>}
          {recherche !== null && (
            <div className="space-y-1">
              <input autoFocus className="input !py-1 !text-sm" placeholder="Chercher dans le catalogue…" value={recherche} onChange={e => setRecherche(e.target.value)} />
              {trouves.map(c => (
                <button key={c.prestation.id} className="block w-full text-left text-sm px-2 py-1.5 rounded-lg hover:bg-volt-50 border border-ink-100"
                  onClick={() => { onChange({ prestationId: c.prestation.id }); setRecherche(null); }}>
                  {c.prestation.nom} <span className="text-ink-400">— {eur(c.prestation.prix_unitaire)}</span>
                </button>
              ))}
              {recherche.trim().length >= 2 && trouves.length === 0 && <p className="text-xs text-ink-400">Aucun article trouvé.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export default function DevisRapidePage() {
  const router = useRouter();
  const [texte, setTexte] = useState("");
  const [prestations, setPrestations] = useState<Prestation[] | null>(null);
  const [clients, setClients] = useState<ClientCourt[]>([]);
  const [taux, setTaux] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [clientManuel, setClientManuel] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Record<string, Correction>>({});
  const [creation, setCreation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const dictee = useDictee(t => setTexte(x => (x.trim() ? `${x.trim()}, ${t}` : t)));

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const uid = sess.session?.user.id;
        if (!uid) { if (!annule) setErreurChargement("Session expirée : reconnecte-toi."); return; }
        const [pre, cli, prof] = await Promise.all([
          supabase.from("prestations").select("*").eq("actif", true).order("nom"),
          supabase.from("clients").select("id, nom, prenom").order("nom"),
          supabase.from("profil").select("taux_horaire").eq("id", uid).single(),
        ]);
        if (pre.error) throw new Error(pre.error.message);
        if (cli.error) throw new Error(cli.error.message);
        const avec = await attacherFournisseurs((pre.data ?? []) as Prestation[]);
        if (annule) return;
        setUserId(uid); setPrestations(avec); setClients((cli.data ?? []) as ClientCourt[]); setTaux(Number(prof.data?.taux_horaire) || 0);
      } catch (e) {
        if (!annule) setErreurChargement(`Chargement impossible : ${(e as Error).message}`);
      }
    })();
    return () => { annule = true; };
  }, []);

  const texteDiffere = useDeferredValue(texte);
  const analyse = useMemo(() => (prestations ? analyserDictee(texteDiffere, prestations, clients) : { client: null, lignes: [] as LigneVocale[] }), [texteDiffere, prestations, clients]);
  const clientId = clientManuel ?? analyse.client?.id ?? "";
  const clientDetecte = clientManuel === null && analyse.client !== null;

  const etatDe = (l: LigneVocale): ChoixLigneVocale => {
    const c = corrections[l.cle] ?? {};
    return { inclus: c.inclus ?? true, quantite: c.quantite ?? l.segment.quantite, prestationId: c.prestationId !== undefined ? c.prestationId : l.choixAuto };
  };
  const lignesDevis = useMemo(
    () => lignesDepuisDictee(analyse.lignes, etatDe, prestations ?? [], taux),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analyse.lignes, corrections, prestations, taux],
  );
  const totaux = totauxLignesDevis(lignesDevis);
  const nbACompleter = lignesDevis.filter(l => l.prix_unitaire <= 0).length;

  async function creer() {
    if (creation || !userId || !clientId || lignesDevis.length === 0) return;
    setCreation(true); setErreur(null);
    try {
      const res = await creerDevisBrouillon(supabase, userId, clientId, "Devis", lignesDevis);
      if (res.erreur || !res.id) { setErreur(res.erreur ?? "Création impossible."); return; }
      router.push(`/devis/${res.id}`);
    } finally {
      setCreation(false);
    }
  }

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-3xl mx-auto pb-32">
        <div className="flex items-center gap-2 mb-5">
          <Link href="/devis" className="btn-ghost !px-2" aria-label="Retour aux devis"><ArrowLeft size={16} /></Link>
          <div>
            <h1 className="font-display text-3xl text-ink-900">Devis par dictée</h1>
            <p className="text-ink-500 text-sm">Dis ce qu&apos;il faut chiffrer ; les prix viennent de ton catalogue.</p>
          </div>
        </div>

        {erreurChargement && <p className="text-sm text-red-700 mb-3" role="alert">{erreurChargement}</p>}
        {prestations && prestations.length === 0 && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">Ton catalogue est vide : toutes les lignes resteront « À compléter ».</p>}

        <div className="card card-inner space-y-3 mb-4">
          <div className="flex items-center gap-3">
            {dictee.supporte ? (
              <button onClick={dictee.basculer}
                className={`shrink-0 w-16 h-16 rounded-full grid place-items-center shadow-md transition-all ${dictee.ecoute ? "bg-red-500 text-white animate-pulse" : "bg-volt-500 text-ink-900"}`}
                aria-label={dictee.ecoute ? "Arrêter la dictée" : "Dicter"}>
                {dictee.ecoute ? <MicOff size={26} /> : <Mic size={26} />}
              </button>
            ) : (
              <div className="shrink-0 w-16 h-16 rounded-full grid place-items-center bg-ink-100 text-ink-400"><MicOff size={26} /></div>
            )}
            <p className="text-xs text-ink-500">
              {dictee.supporte
                ? dictee.ecoute ? "Je t'écoute… parle normalement, appuie de nouveau pour arrêter." : "Appuie sur le micro puis dicte. Exemple : « pour Monsieur Dupont, 5 prises 16 ampères, 3 spots et 2 heures de main d'œuvre »."
                : "Ce navigateur n'a pas de dictée intégrée : utilise le micro du clavier de ton téléphone dans la zone de texte, ou tape."}
            </p>
          </div>
          {dictee.erreur && <p className="text-sm text-red-700" role="alert">{dictee.erreur}</p>}
          <div className="relative">
            <textarea className="input !text-sm" rows={5} value={texte} onChange={e => setTexte(e.target.value)} aria-label="Texte de la demande"
              placeholder="Pour Monsieur Dupont, 5 prises 16 A, 3 spots, un disjoncteur différentiel 40 A et 2 heures de main d'œuvre" />
            {dictee.interim && <p className="text-xs text-ink-400 italic mt-1">{dictee.interim}…</p>}
            {texte && <button className="absolute top-2 right-2 btn-ghost !px-1.5 !py-1" onClick={() => { setTexte(""); setCorrections({}); setClientManuel(null); }} aria-label="Tout effacer"><Trash2 size={14} /></button>}
          </div>
        </div>

        <div className="card card-inner mb-4">
          <label className="label" htmlFor="client-rapide">Client</label>
          <div className="flex items-center gap-2">
            <select id="client-rapide" className="input flex-1" value={clientId} onChange={e => setClientManuel(e.target.value || null)}>
              <option value="">— Choisir un client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{libelleClient(c)}</option>)}
            </select>
            {clientManuel !== null && <button className="btn-ghost !px-2" onClick={() => setClientManuel(null)} aria-label="Revenir au client reconnu"><X size={14} /></button>}
          </div>
          {clientDetecte && <p className="text-xs text-emerald-700 mt-1">Reconnu dans ta dictée.</p>}
        </div>

        {!prestations && !erreurChargement && <div className="grid place-items-center py-10 text-ink-400"><Loader2 className="animate-spin" /></div>}
        {prestations && analyse.lignes.length === 0 && texte.trim() !== "" && <p className="text-sm text-ink-500">Je n&apos;ai trouvé aucune ligne dans ce texte.</p>}
        <div className="space-y-2">
          {analyse.lignes.map(l => (
            <LigneRapide key={l.cle} l={l} etat={etatDe(l)} prestations={prestations ?? []}
              onChange={c => setCorrections(x => ({ ...x, [l.cle]: { ...x[l.cle], ...c } }))} />
          ))}
        </div>
        {erreur && <p className="text-sm text-red-700 mt-3" role="alert">{erreur}</p>}
      </div>

      <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-ink-200 px-4 py-3 md:pl-56">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-semibold text-ink-900">{eur(totaux.total)}</div>
            <div className="text-xs text-ink-500">{lignesDevis.length} ligne(s){nbACompleter > 0 ? ` · ${nbACompleter} à compléter` : ""}</div>
          </div>
          <button className="btn-volt" disabled={creation || !clientId || lignesDevis.length === 0 || !userId} onClick={creer}>
            {creation ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}Créer le devis brouillon
          </button>
        </div>
        {!clientId && lignesDevis.length > 0 && <p className="text-xs text-amber-800 max-w-3xl mx-auto mt-1">Choisis un client pour créer le devis.</p>}
      </div>
    </Shell>
  );
}
