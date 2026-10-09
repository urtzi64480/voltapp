"use client";
// Regroupement de produits du catalogue qui sont le même article saisi une fois par marque.
//
//  - « Doublons détectés » : produits qui ne diffèrent que par la marque, regroupés automatiquement
//    avec un aperçu (produit à garder, nom générique, produits inclus) avant de valider ;
//  - « Regrouper à la main » : pour ceux que la détection ne voit pas (noms différents).
//
// Les offres (marque + fournisseur + prix) des produits regroupés sont rattachées au produit gardé ;
// les autres sont masqués, pas supprimés. La logique est dans src/lib/fusion-produits.ts.

import { useMemo, useState } from "react";
import { X, Search, AlertCircle, CheckCircle2, Layers, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmt, cn } from "@/lib/utils";
import { libelleOffre, marquesDe, normTexte, offresTriees } from "@/lib/fournisseurs";
import {
  detecterDoublons, fusionnerProduits, nomGenerique, produitDeReference, type GroupeDoublons,
} from "@/lib/fusion-produits";
import type { Prestation } from "@/types";
import { sousCategoriesDe, aSousCategorie, sousCategoriePrincipale, libelleSousCategories } from "@/lib/sous-categories";

type Produit = Prestation & { est_kit?: boolean };
interface EtatGroupe { reference: string; nom: string; exclus: string[] }

function etatParDefaut(g: GroupeDoublons): EtatGroupe {
  const ref = produitDeReference(g.produits);
  return { reference: ref.id, nom: nomGenerique(g.produits, ref), exclus: [] };
}

// Définis hors du composant principal : pas de remontage (et de perte de focus) à chaque frappe.
function CarteGroupe({ groupe, etat, setEtat, desactive }: {
  groupe: GroupeDoublons; etat: EtatGroupe; setEtat: (e: EtatGroupe) => void; desactive: boolean;
}) {
  const inclus = groupe.produits.filter(p => !etat.exclus.includes(p.id));
  const refValide = inclus.some(p => p.id === etat.reference);
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-3 space-y-3">
      <div>
        <label className="label">Nom du produit regroupé</label>
        <input className="input text-sm" value={etat.nom} disabled={desactive}
          onChange={e => setEtat({ ...etat, nom: e.target.value })} />
      </div>
      <div className="divide-y divide-ink-100 rounded-lg border border-ink-100">
        {groupe.produits.map(p => {
          const inclusP = !etat.exclus.includes(p.id);
          const offres = offresTriees(p.fournisseurs);
          const marques = marquesDe(p);
          return (
            <div key={p.id} className={cn("flex items-start gap-3 px-3 py-2 text-xs", !inclusP && "opacity-50")}>
              <input type="checkbox" className="mt-1" checked={inclusP} disabled={desactive}
                title="Inclure dans le regroupement"
                onChange={e => setEtat({
                  ...etat,
                  exclus: e.target.checked ? etat.exclus.filter(x => x !== p.id) : [...etat.exclus, p.id],
                })} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-800 break-words">{p.nom}</p>
                <p className="text-ink-400">
                  {[marques.join(" / ") || "sans marque", libelleSousCategories(p), offres.length > 0 ? `${offres.length} offre${offres.length > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ")}
                </p>
                {offres.length > 0 && (
                  <p className="text-ink-400 truncate">{offres.map(libelleOffre).join(", ")}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="font-semibold text-ink-900">{fmt(p.prix_unitaire)}</p>
                {p.prix_achat != null && <p className="text-ink-400">PA {fmt(p.prix_achat)}</p>}
              </div>
              <label className={cn("shrink-0 flex items-center gap-1 cursor-pointer", !inclusP && "pointer-events-none")}
                title="Produit conservé : il reçoit les offres des autres">
                <input type="radio" name={`ref-${groupe.cle}`} checked={refValide && etat.reference === p.id} disabled={desactive || !inclusP}
                  onChange={() => setEtat({ ...etat, reference: p.id })} />
                <span className="text-ink-500">Garder</span>
              </label>
            </div>
          );
        })}
      </div>
      {inclus.length < 2 && <p className="text-xs text-amber-600">Il faut au moins deux produits cochés pour regrouper.</p>}
    </div>
  );
}

export default function FusionDoublons({ prestations, marqueOk, onClose, onFusionne }: {
  prestations: Produit[]; marqueOk: boolean; onClose: () => void; onFusionne: () => void | Promise<void>;
}) {
  const groupes = useMemo(() => detecterDoublons(prestations), [prestations]);
  const [etats, setEtats] = useState<Record<string, EtatGroupe>>({});
  const [manuel, setManuel] = useState<Produit[]>([]);
  const [recherche, setRecherche] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const groupeManuel: GroupeDoublons | null = manuel.length >= 2
    ? { cle: `manuel-${manuel.map(p => p.id).join("-")}`, produits: manuel }
    : null;
  const etatDe = (g: GroupeDoublons): EtatGroupe => etats[g.cle] ?? etatParDefaut(g);
  const majEtat = (g: GroupeDoublons, e: EtatGroupe) => setEtats(prev => ({ ...prev, [g.cle]: e }));

  const candidats = useMemo(() => {
    const q = normTexte(recherche);
    if (!q) return [];
    return prestations
      .filter(p => !p.est_kit && p.type_branche === "materiau" && p.actif !== false && !manuel.some(m => m.id === p.id))
      .filter(p => q.split(" ").every(t => normTexte([p.nom, p.categorie, p.sous_categorie, ...marquesDe(p)].join(" ")).includes(t)))
      .slice(0, 8);
  }, [recherche, prestations, manuel]);

  async function lancer(liste: GroupeDoublons[]) {
    const avecEtat = liste
      .map(g => ({ g, e: etatDe(g) }))
      .map(({ g, e }) => ({ g, e, inclus: g.produits.filter(p => !e.exclus.includes(p.id)) }))
      .filter(x => x.inclus.length >= 2);
    if (avecEtat.length === 0) return;
    const nbProduits = avecEtat.reduce((s, x) => s + x.inclus.length, 0);
    if (!confirm(
      `Regrouper ${nbProduits} produits en ${avecEtat.length} produit${avecEtat.length > 1 ? "s" : ""} ?\n\n` +
      "Les offres (marques, fournisseurs, prix) sont conservées sur le produit gardé ; les autres produits sont masqués du catalogue (pas supprimés).",
    )) return;
    setOccupe(true); setMessage(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setMessage({ ok: false, texte: "Session expirée." }); return; }
      let produitsRegroupes = 0; let offres = 0; let regroupes = 0;
      const alertes: string[] = [];
      for (const { g, e, inclus } of avecEtat) {
        const ref = inclus.find(p => p.id === e.reference) ?? produitDeReference(inclus);
        const r = await fusionnerProduits(session.user.id, ref.id, inclus, e.nom);
        alertes.push(...r.avertissements);
        if (!r.ok) {
          setMessage({ ok: false, texte: `« ${e.nom || g.produits[0].nom} » : ${r.erreur ?? "erreur inconnue"}${regroupes > 0 ? ` (${regroupes} regroupement${regroupes > 1 ? "s" : ""} déjà effectué${regroupes > 1 ? "s" : ""})` : ""}` });
          await onFusionne();
          return;
        }
        regroupes += 1; produitsRegroupes += inclus.length; offres += r.nbOffres;
        if (g.cle.startsWith("manuel-")) setManuel([]);
      }
      setMessage({
        ok: true,
        texte: `${produitsRegroupes} produits regroupés en ${regroupes} (${offres} offre${offres > 1 ? "s" : ""} au total).${alertes.length > 0 ? " " + alertes.join(" ") : ""}`,
      });
      await onFusionne();
    } finally {
      setOccupe(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-100">
          <div>
            <h2 className="font-semibold text-ink-900">Regrouper les doublons</h2>
            <p className="text-xs text-ink-400">Un seul produit pour toutes les marques : chaque marque devient une offre avec ses prix.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-ink-100 text-ink-400"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!marqueOk && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-4 py-3 text-sm">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <p>Exécute d'abord la migration <strong>006_marques_offres.sql</strong> dans Supabase (SQL Editor, un bloc à la fois) : sans elle, les marques ne peuvent pas être enregistrées sur les offres.</p>
            </div>
          )}
          {message && (
            <div className={cn("flex items-start gap-2 rounded-xl px-4 py-3 text-sm border",
              message.ok ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700")}>
              {message.ok ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />}
              <p>{message.texte}</p>
            </div>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-ink-800 text-sm">Doublons détectés ({groupes.length})</h3>
                <p className="text-xs text-ink-400">Même nom (marque mise à part), même catégorie, même type d'article, même unité et même gamme. Vérifie les noms avant de valider.</p>
              </div>
              {groupes.length > 1 && (
                <button disabled={occupe || !marqueOk} onClick={() => lancer(groupes)} className="btn-volt text-xs shrink-0 disabled:opacity-50">
                  <Layers size={13} /> Tout regrouper
                </button>
              )}
            </div>
            {groupes.length === 0 && (
              <p className="text-sm text-ink-400 italic">Aucun doublon évident détecté. Utilise « Regrouper à la main » pour les autres.</p>
            )}
            {groupes.map(g => (
              <div key={g.cle} className="space-y-2">
                <CarteGroupe groupe={g} etat={etatDe(g)} setEtat={e => majEtat(g, e)} desactive={occupe} />
                <div className="flex justify-end">
                  <button disabled={occupe || !marqueOk || g.produits.filter(p => !etatDe(g).exclus.includes(p.id)).length < 2}
                    onClick={() => lancer([g])} className="btn-ghost text-xs disabled:opacity-50">
                    Regrouper ce groupe
                  </button>
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="font-semibold text-ink-800 text-sm">Regrouper à la main</h3>
              <p className="text-xs text-ink-400">Cherche les produits à réunir (au moins deux) : leurs marques et prix deviennent des offres d'un seul produit.</p>
            </div>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              <input className="input pl-9 w-full text-sm" placeholder="Nom, marque, catégorie…"
                value={recherche} onChange={e => setRecherche(e.target.value)} />
            </div>
            {candidats.length > 0 && (
              <div className="rounded-lg border border-ink-100 divide-y divide-ink-100">
                {candidats.map(p => (
                  <button key={p.id} type="button" onClick={() => { setManuel(m => [...m, p]); setRecherche(""); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-volt-50">
                    <Plus size={13} className="text-volt-600 shrink-0" />
                    <span className="flex-1 min-w-0 truncate font-medium text-ink-800">{p.nom}</span>
                    <span className="text-ink-400 shrink-0">{[marquesDe(p).join(" / "), p.categorie].filter(Boolean).join(" · ")}</span>
                    <span className="font-semibold text-ink-700 shrink-0">{fmt(p.prix_unitaire)}</span>
                  </button>
                ))}
              </div>
            )}
            {manuel.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {manuel.map(p => (
                  <button key={p.id} type="button" onClick={() => setManuel(m => m.filter(x => x.id !== p.id))}
                    className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-ink-900 text-volt-400 text-xs font-medium">
                    {p.nom} <X size={11} />
                  </button>
                ))}
              </div>
            )}
            {groupeManuel && (
              <div className="space-y-2">
                <CarteGroupe groupe={groupeManuel} etat={etatDe(groupeManuel)} setEtat={e => majEtat(groupeManuel, e)} desactive={occupe} />
                <div className="flex justify-end">
                  <button disabled={occupe || !marqueOk || groupeManuel.produits.filter(p => !etatDe(groupeManuel).exclus.includes(p.id)).length < 2}
                    onClick={() => lancer([groupeManuel])} className="btn-volt text-xs disabled:opacity-50">
                    <Layers size={13} /> Regrouper ces produits
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="px-6 py-4 border-t border-ink-100">
          <button onClick={onClose} className="btn-ghost w-full justify-center">Fermer</button>
        </div>
      </div>
    </div>
  );
}
