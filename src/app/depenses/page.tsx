"use client";
// Achats matériel (privé) : ce qui a été payé pour le matériel des devis, rangé par mois de PAIEMENT (= ce qu'il faut virer en fin de mois).
// Un devis peut avoir plusieurs achats (migration 018). Les devis signés sans achat saisi attendent dans « À saisir ». Un mois terminé se replie.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, ShoppingCart } from "lucide-react";
import Shell from "@/components/layout/Shell";
import { FormulaireAchat, LigneAchat } from "@/components/devis/AchatsMateriel";
import { supabase } from "@/lib/supabase";
import { cn, dateLocale, fmt } from "@/lib/utils";
import { coutAchatLignes, construirePrixAchatMap, type InfoPrestation, type LigneRentab } from "@/lib/rentabilite";
import { estAAcheter, grouperAchatsParMois, lireAchat, SQL_MIGRATION_ACHATS, type AchatDuMois, type AchatLigne } from "@/lib/depenses-materiel";

interface DevisBrut {
  id: string; numero: string; objet: string | null; statut: string; total_materiau: number | null;
  client: { nom?: string | null; prenom?: string | null } | null; devis_lignes: LigneRentab[] | null;
}
interface InfoDevis { id: string; numero: string; objet: string; client: string; statut: string; prevu: number; eligible: boolean }

const COLONNES_DEVIS = "id,numero,objet,statut,total_materiau,client:clients(nom,prenom),devis_lignes(*)";

export default function AchatsMaterielPage() {
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [tableAbsente, setTableAbsente] = useState(false);
  const [devis, setDevis] = useState<InfoDevis[]>([]);
  const [achats, setAchats] = useState<AchatLigne[]>([]);
  const [annee, setAnnee] = useState("toutes");
  // Mois ouverts / repliés par l'utilisateur ; sans choix, un mois terminé est replié et les autres sont ouverts.
  const [choix, setChoix] = useState<Record<string, boolean>>({});
  const moisCourant = dateLocale().slice(0, 7);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const [devisR, achatsR, prestR, compR] = await Promise.all([
          supabase.from("devis").select(COLONNES_DEVIS).order("created_at", { ascending: false }),
          supabase.from("devis_achats").select("id,devis_id,montant,date_achat,fournisseur"),
          supabase.from("prestations").select("id,categorie,prix_achat"),
          supabase.from("kit_composants").select("kit_id,composant_id,quantite"),
        ]);
        if (devisR.error) throw new Error(`Devis : ${devisR.error.message}`);
        if (prestR.error) throw new Error(`Catalogue : ${prestR.error.message}`);
        if (compR.error) throw new Error(`Kits : ${compR.error.message}`);
        // Sans la migration 018 : la page s'affiche quand même (rien de saisi), avec le SQL à lancer.
        const absente = !!achatsR.error && /devis_achats/i.test(achatsR.error.message);
        if (achatsR.error && !absente) throw new Error(`Achats : ${achatsR.error.message}`);
        const composants = (compR.data ?? []) as { kit_id: string; composant_id: string; quantite?: number | null }[];
        const idsKits = new Set(composants.map(c => c.kit_id));
        const prestations = ((prestR.data ?? []) as ({ id: string } & InfoPrestation)[]).map(p => ({ ...p, est_kit: idsKits.has(p.id) }));
        const prixAchat = construirePrixAchatMap(prestations, composants);
        const liste: AchatLigne[] = absente ? [] : ((achatsR.data ?? []) as unknown[]).map(lireAchat).filter((a): a is AchatLigne => a != null);
        const avecAchat = new Set(liste.map(a => a.devisId));
        const infos: InfoDevis[] = [];
        ((devisR.data ?? []) as unknown as DevisBrut[]).forEach(d => {
          const lignes = d.devis_lignes ?? [];
          const eligible = estAAcheter({ statut: d.statut, total_materiau: d.total_materiau, nbAchats: avecAchat.has(d.id) ? 1 : 0, aLigneMateriau: lignes.some(l => l.type_branche === "materiau") });
          if (!eligible) return;
          const c = d.client;
          infos.push({
            id: d.id, numero: d.numero, objet: d.objet ?? "", statut: d.statut, eligible,
            client: [c?.prenom, c?.nom].filter(Boolean).join(" "),
            prevu: Math.round(coutAchatLignes(lignes, prixAchat).coutAchat * 100) / 100,
          });
        });
        if (annule) return;
        setTableAbsente(absente);
        setDevis(infos);
        setAchats(liste);
      } catch (e) {
        if (!annule) setErreur(e instanceof Error ? e.message : String(e));
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => { annule = true; };
  }, []);

  const parId = useMemo(() => new Map(devis.map(d => [d.id, d])), [devis]);
  const aSaisir = useMemo(() => {
    const avec = new Set(achats.map(a => a.devisId));
    return devis.filter(d => !avec.has(d.id)).sort((a, b) => a.numero.localeCompare(b.numero, "fr", { numeric: true }));
  }, [devis, achats]);
  const duMois = useMemo<AchatDuMois[]>(() => achats.flatMap(a => {
    const d = parId.get(a.devisId);
    return d ? [{ ...a, numero: d.numero, client: d.client, objet: d.objet }] : [];
  }), [achats, parId]);
  const annees = useMemo(() => Array.from(new Set(duMois.map(a => a.date.slice(0, 4)).filter(Boolean))).sort().reverse(), [duMois]);
  const filtres = useMemo(() => annee === "toutes" ? duMois : duMois.filter(a => a.date.startsWith(annee)), [duMois, annee]);
  const groupes = useMemo(() => grouperAchatsParMois(filtres, moisCourant), [filtres, moisCourant]);
  const totalReel = Math.round(groupes.reduce((t, g) => t + g.total, 0) * 100) / 100;

  const ajouter = (a: AchatLigne) => setAchats(l => [...l, a]);
  const modifier = (a: AchatLigne) => setAchats(l => l.map(x => (x.id === a.id ? a : x)));
  const supprimer = (id: string) => setAchats(l => l.filter(x => x.id !== id));

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
        <p className="text-sm text-ink-400">Ce que tu as payé pour le matériel de tes devis, classé par mois de paiement : le total d&apos;un mois est ce que tu as avancé ce mois-là (à virer sur le compte commun en fin de mois). Un devis peut avoir plusieurs achats. Tu saisis chaque achat en TTC ou HT, toujours enregistré en TTC : la TVA payée aux fournisseurs n&apos;est pas récupérable en franchise. Tous les montants affichés sont TTC. Un mois terminé se replie.</p>

        {tableAbsente && (
          <div className="card p-3 border-amber-300 text-sm flex gap-2"><AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <div>Pour enregistrer les achats, lance d&apos;abord dans Supabase (SQL Editor) la migration 018 (fichier <code>supabase/migrations/018_devis_achats.sql</code>), ou au minimum :<pre className="mt-1 text-xs whitespace-pre-wrap">{SQL_MIGRATION_ACHATS}</pre></div>
          </div>
        )}
        {erreur && <div className="card p-3 text-sm text-red-600">{erreur}</div>}
        {chargement && <p className="text-ink-400 text-sm">Chargement…</p>}

        {!chargement && !erreur && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-3"><div className="text-xs text-ink-400">Dépensé TTC{annee !== "toutes" ? ` en ${annee}` : ""}</div><div className="text-xl font-bold">{fmt(totalReel)}</div></div>
              <div className="card p-3"><div className="text-xs text-ink-400">Devis à saisir</div><div className={cn("text-xl font-bold", aSaisir.length > 0 && "text-amber-600")}>{aSaisir.length}</div></div>
            </div>
            {devis.length === 0 && <p className="card p-4 text-sm text-ink-400">Aucun devis signé avec du matériel pour l&apos;instant.</p>}
            {aSaisir.length > 0 && (
              <section className="card overflow-hidden border-amber-300">
                <div className="p-3">
                  <div className="font-semibold">À saisir <span className="text-amber-600">({aSaisir.length})</span></div>
                  <div className="text-xs text-ink-400">Dès que tu ajoutes un achat, le devis passe dans le mois du jour payé.</div>
                </div>
                <ul className="divide-y divide-ink-100 border-t border-ink-100">
                  {aSaisir.map(d => (
                    <li key={d.id} className="p-3 flex flex-col gap-2">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <Link href={`/devis/${d.id}`} className="font-semibold hover:text-volt-600">{d.numero}</Link>
                        <span className="text-sm text-ink-500 truncate">{[d.client, d.objet].filter(Boolean).join(" — ")}</span>
                        <span className="ml-auto text-xs text-ink-400">{d.prevu > 0 ? `prévu ≈ ${fmt(d.prevu)} TTC` : "prévu : prix d'achat inconnu"}</span>
                      </div>
                      <FormulaireAchat compact devisId={d.id} onSaved={ajouter} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {groupes.map(g => {
              const ouvert = choix[g.cle] ?? !g.termine;
              return (
                <section key={g.cle} className="card overflow-hidden">
                  <button type="button" onClick={() => setChoix(c => ({ ...c, [g.cle]: !ouvert }))} aria-expanded={ouvert}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-ink-50/50">
                    {ouvert ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <div className="min-w-0">
                      <div className="font-semibold capitalize">{g.libelle}{g.termine && <span className="ml-2 text-[11px] font-normal text-ink-400 normal-case">terminé</span>}</div>
                      <div className="text-xs text-ink-400">{g.nbAchats} achat{g.nbAchats > 1 ? "s" : ""} · {g.nbDevis} devis</div>
                    </div>
                    <div className="ml-auto text-right">
                      <div className="font-bold">{fmt(g.total)}</div>
                      <div className="text-[11px] text-ink-400">à virer</div>
                    </div>
                  </button>
                  {ouvert && (
                    <ul className="divide-y divide-ink-100 border-t border-ink-100">
                      {g.achats.map(a => (
                        <li key={a.id} className="p-3">
                          <LigneAchat compact achat={a} onUpdated={modifier} onDeleted={supprimer} onAdded={ajouter}
                            detail={<><Link href={`/devis/${a.devisId}`} className="font-semibold hover:text-volt-600">{a.numero}</Link><span className="text-ink-500 truncate max-w-[14rem]">{[a.client, a.objet].filter(Boolean).join(" — ")}</span></>} />
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
