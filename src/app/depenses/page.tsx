"use client";
// Achats matériel (privé) : dépenses de matériel par mois, d'après les devis signés. Le « prévu » est le coût d'achat estimé du devis ;
// le « réel » est saisi à la main sur chaque devis (ici ou sur la fiche du devis). Un mois terminé se replie.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, ShoppingCart } from "lucide-react";
import Shell from "@/components/layout/Shell";
import AchatMaterielReel from "@/components/devis/AchatMaterielReel";
import { supabase } from "@/lib/supabase";
import { cn, dateLocale, fmt } from "@/lib/utils";
import { coutAchatLignes, construirePrixAchatMap, type InfoPrestation, type LigneRentab } from "@/lib/rentabilite";
import { ecartPct, estAAcheter, grouperParMois, lireDate, lireMontant, SQL_MIGRATION_ACHATS, type EntreeAchat } from "@/lib/depenses-materiel";

interface DevisBrut {
  id: string; numero: string; objet: string | null; statut: string; date_emission: string | null; signe_le: string | null; created_at: string | null;
  total_materiau: number | null; achat_materiel_reel?: number | string | null; achat_materiel_date?: string | null;
  client: { nom?: string | null; prenom?: string | null } | null; devis_lignes: LigneRentab[] | null;
}

const COLONNES_BASE = "id,numero,objet,statut,date_emission,signe_le,created_at,total_materiau,client:clients(nom,prenom),devis_lignes(*)";
const COLONNES_ACHATS = "achat_materiel_reel,achat_materiel_date";

export default function AchatsMaterielPage() {
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [colonnesAbsentes, setColonnesAbsentes] = useState(false);
  const [entrees, setEntrees] = useState<EntreeAchat[]>([]);
  const [annee, setAnnee] = useState("toutes");
  // Mois ouverts / repliés par l'utilisateur ; sans choix, un mois terminé est replié et les autres sont ouverts.
  const [choix, setChoix] = useState<Record<string, boolean>>({});
  const moisCourant = dateLocale().slice(0, 7);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        let devisR: { data: unknown; error: { message: string } | null } = await supabase.from("devis").select(`${COLONNES_BASE},${COLONNES_ACHATS}`).order("created_at", { ascending: false });
        let absentes = false;
        // Sans la migration 017 : la page s'affiche quand même (rien de saisi), avec le SQL à lancer.
        if (devisR.error && /achat_materiel/i.test(devisR.error.message)) {
          absentes = true;
          devisR = await supabase.from("devis").select(COLONNES_BASE).order("created_at", { ascending: false });
        }
        const [prestR, compR] = await Promise.all([
          supabase.from("prestations").select("id,categorie,prix_achat"),
          supabase.from("kit_composants").select("kit_id,composant_id,quantite"),
        ]);
        if (devisR.error) throw new Error(`Devis : ${devisR.error.message}`);
        if (prestR.error) throw new Error(`Catalogue : ${prestR.error.message}`);
        if (compR.error) throw new Error(`Kits : ${compR.error.message}`);
        const composants = (compR.data ?? []) as { kit_id: string; composant_id: string; quantite?: number | null }[];
        const idsKits = new Set(composants.map(c => c.kit_id));
        const prestations = ((prestR.data ?? []) as ({ id: string } & InfoPrestation)[]).map(p => ({ ...p, est_kit: idsKits.has(p.id) }));
        const prixAchat = construirePrixAchatMap(prestations, composants);
        const liste: EntreeAchat[] = [];
        ((devisR.data ?? []) as unknown as DevisBrut[]).forEach(d => {
          const lignes = d.devis_lignes ?? [];
          const reel = lireMontant(d.achat_materiel_reel ?? null);
          if (!estAAcheter({ statut: d.statut, total_materiau: d.total_materiau, reel, aLigneMateriau: lignes.some(l => l.type_branche === "materiau") })) return;
          const c = d.client;
          liste.push({
            devisId: d.id, numero: d.numero, objet: d.objet ?? "", statut: d.statut,
            client: [c?.prenom, c?.nom].filter(Boolean).join(" "),
            prevu: Math.round(coutAchatLignes(lignes, prixAchat).coutAchat * 100) / 100,
            reel, date: lireDate(d.achat_materiel_date ?? null),
            dateRef: lireDate(d.signe_le) ?? lireDate(d.date_emission) ?? lireDate(d.created_at) ?? "",
          });
        });
        if (annule) return;
        setColonnesAbsentes(absentes);
        setEntrees(liste);
      } catch (e) {
        if (!annule) setErreur(e instanceof Error ? e.message : String(e));
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => { annule = true; };
  }, []);

  const annees = useMemo(() => Array.from(new Set(entrees.map(e => (lireDate(e.date) ?? e.dateRef).slice(0, 4)).filter(Boolean))).sort().reverse(), [entrees]);
  const filtrees = useMemo(() => annee === "toutes" ? entrees : entrees.filter(e => (lireDate(e.date) ?? e.dateRef).startsWith(annee)), [entrees, annee]);
  const groupes = useMemo(() => grouperParMois(filtrees, moisCourant), [filtrees, moisCourant]);
  const totalReel = groupes.reduce((a, g) => a + g.totalReel, 0);
  const nbASaisir = groupes.reduce((a, g) => a + g.nbASaisir, 0);

  const majEntree = (devisId: string, v: { reel: number | null; date: string | null }) =>
    setEntrees(es => es.map(e => (e.devisId === devisId ? { ...e, reel: v.reel, date: v.date } : e)));

  return (
    <Shell>
      <div className="max-w-4xl mx-auto p-4 md:p-6 flex flex-col gap-4">
        <header className="flex flex-wrap items-center gap-3">
          <ShoppingCart className="text-volt-500" size={22} />
          <h1 className="text-2xl font-bold">Achats matériel</h1>
          <select className="input !w-auto ml-auto" value={annee} onChange={e => setAnnee(e.target.value)} aria-label="Année">
            <option value="toutes">Toutes les années</option>
            {annees.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </header>
        <p className="text-sm text-ink-400">Matériel à acheter pour tes devis signés, classé par mois d&apos;achat. Le « prévu » est le coût d&apos;achat estimé d&apos;après le devis ; le « réel », c&apos;est toi qui le saisis. Un mois terminé se replie.</p>

        {colonnesAbsentes && (
          <div className="card p-3 border-amber-300 text-sm flex gap-2"><AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <div>Pour enregistrer les montants, lance d&apos;abord dans Supabase (SQL Editor) :<pre className="mt-1 text-xs whitespace-pre-wrap">{SQL_MIGRATION_ACHATS}</pre></div>
          </div>
        )}
        {erreur && <div className="card p-3 text-sm text-red-600">{erreur}</div>}
        {chargement && <p className="text-ink-400 text-sm">Chargement…</p>}

        {!chargement && !erreur && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-3"><div className="text-xs text-ink-400">Dépensé (saisi)</div><div className="text-xl font-bold">{fmt(totalReel)}</div></div>
              <div className="card p-3"><div className="text-xs text-ink-400">Devis à saisir</div><div className={cn("text-xl font-bold", nbASaisir > 0 && "text-amber-600")}>{nbASaisir}</div></div>
            </div>
            {groupes.length === 0 && <p className="card p-4 text-sm text-ink-400">Aucun devis signé avec du matériel pour l&apos;instant.</p>}
            {groupes.map(g => {
              const ouvert = choix[g.cle] ?? !g.termine;
              const ecart = ecartPct(g.totalReel, g.prevuSaisis);
              return (
                <section key={g.cle} className="card overflow-hidden">
                  <button type="button" onClick={() => setChoix(c => ({ ...c, [g.cle]: !ouvert }))} aria-expanded={ouvert}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-ink-50/50">
                    {ouvert ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <div className="min-w-0">
                      <div className="font-semibold capitalize">{g.libelle}{g.termine && <span className="ml-2 text-[11px] font-normal text-ink-400 normal-case">terminé</span>}</div>
                      <div className="text-xs text-ink-400">{g.nbDevis} devis{g.nbASaisir > 0 && <span className="text-amber-600"> · {g.nbASaisir} à saisir</span>}</div>
                    </div>
                    <div className="ml-auto text-right">
                      <div className="font-bold">{fmt(g.totalReel)}</div>
                      {g.prevuSaisis > 0 && <div className="text-[11px] text-ink-400">prévu {fmt(g.prevuSaisis)}{ecart != null && <span className={ecart > 0 ? " text-red-500" : " text-emerald-600"}> ({ecart > 0 ? "+" : ""}{ecart} %)</span>}</div>}
                    </div>
                  </button>
                  {ouvert && (
                    <ul className="divide-y divide-ink-100 border-t border-ink-100">
                      {g.entrees.map(e => (
                        <li key={e.devisId} className="p-3 flex flex-col gap-2">
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                            <Link href={`/devis/${e.devisId}`} className="font-semibold hover:text-volt-600">{e.numero}</Link>
                            <span className="text-sm text-ink-500 truncate">{[e.client, e.objet].filter(Boolean).join(" — ")}</span>
                            <span className="ml-auto text-xs text-ink-400">{e.prevu > 0 ? `prévu ≈ ${fmt(e.prevu)}` : "prévu : prix d'achat inconnu"}</span>
                          </div>
                          <AchatMaterielReel compact devisId={e.devisId} reel={e.reel} date={e.date} dateRef={e.dateRef} onSaved={v => majEntree(e.devisId, v)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </>
        )}
      </div>
    </Shell>
  );
}
