"use client";
// Sur-fenêtre de choix d'un produit : barre de recherche + tous les filtres (type, catégorie,
// marque, fournisseur, gamme, sous-catégorie) + choix du fournisseur produit par produit.
//
// Deux usages :
//  - ajout (par défaut) : la fenêtre reste ouverte, on peut ajouter plusieurs produits d'affilée ;
//  - remplacement : on choisit UN produit (et son fournisseur) puis la fenêtre se ferme — sert à
//    changer le produit d'une ligne de devis / d'un besoin du pré-devis.
//
// Les prestations doivent porter leurs offres (prestation.fournisseurs — voir attacherFournisseurs).

import { useEffect, useMemo, useState } from "react";
import { Search, X, Plus, Package, Wrench, Layers, ChevronDown, ChevronUp, Check, SlidersHorizontal, RotateCcw, ExternalLink } from "lucide-react";
import { fmt, cn } from "@/lib/utils";
import { libelleOffre, offresTriees, offrePourFournisseur, offrePrincipale, prixVenteOffre, fourchettePrix, margePct } from "@/lib/fournisseurs";
import type { Prestation, PrestationFournisseur } from "@/types";

export type PrestationPicker = Prestation & { kit_description?: string | null };

type TypeFiltre = "" | "materiau" | "service" | "kit";
export interface FiltresPicker {
  q: string; type: TypeFiltre; cat: string; marque: string; fournisseur: string; gamme: string; sousCat: string;
}
const FILTRES_VIDES: FiltresPicker = { q: "", type: "", cat: "", marque: "", fournisseur: "", gamme: "", sousCat: "" };
const LABEL_GAMME: Record<string, string> = { entree: "Entrée de gamme", moyenne: "Moyenne gamme", haut: "Haut de gamme" };
const PAS_PAGE = 50;

function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function typeDe(p: PrestationPicker): Exclude<TypeFiltre, ""> {
  return p.est_kit ? "kit" : p.type_branche;
}

function passe(p: PrestationPicker, f: FiltresPicker, texte: string, ignorer?: keyof FiltresPicker): boolean {
  if (ignorer !== "type" && f.type && typeDe(p) !== f.type) return false;
  if (ignorer !== "cat" && f.cat && p.categorie !== f.cat) return false;
  if (ignorer !== "marque" && f.marque && (p.marque ?? "") !== f.marque) return false;
  if (ignorer !== "fournisseur" && f.fournisseur && !(p.fournisseurs ?? []).some(o => libelleOffre(o) === f.fournisseur)) return false;
  if (ignorer !== "gamme" && f.gamme && p.gamme !== f.gamme) return false;
  if (ignorer !== "sousCat" && f.sousCat && p.sous_categorie !== f.sousCat) return false;
  if (ignorer !== "q" && f.q.trim()) {
    const tokens = norm(f.q).split(/\s+/).filter(Boolean);
    if (!tokens.every(t => texte.includes(t))) return false;
  }
  return true;
}

function compter(valeurs: (string | null | undefined)[]): { valeur: string; n: number }[] {
  const m = new Map<string, number>();
  valeurs.forEach(v => { if (v) m.set(v, (m.get(v) ?? 0) + 1); });
  return Array.from(m.entries()).map(([valeur, n]) => ({ valeur, n })).sort((a, b) => a.valeur.localeCompare(b.valeur, "fr"));
}

// ─── Sous-composants (définis hors du parent : pas de remontage à chaque frappe) ────────────

function Facette({ titre, valeurs, courant, onChoisir }: {
  titre: string; valeurs: { valeur: string; label?: string; n: number }[]; courant: string; onChoisir: (v: string) => void;
}) {
  if (valeurs.length === 0 && !courant) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-1.5">{titre}</p>
      <div className="space-y-0.5 max-h-44 overflow-y-auto pr-1">
        {valeurs.map(v => (
          <button key={v.valeur} type="button" onClick={() => onChoisir(courant === v.valeur ? "" : v.valeur)}
            className={cn("w-full flex items-center justify-between gap-2 px-2 py-1 rounded-lg text-xs text-left transition-colors",
              courant === v.valeur ? "bg-ink-900 text-volt-400 font-semibold" : "text-ink-600 hover:bg-ink-100")}>
            <span className="truncate">{v.label ?? v.valeur}</span>
            <span className={cn("shrink-0", courant === v.valeur ? "text-volt-400" : "text-ink-300")}>{v.n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Vignette({ url, type }: { url?: string | null; type: string }) {
  const Icone = type === "kit" ? Layers : type === "service" ? Wrench : Package;
  if (!url) return (
    <div className="w-10 h-10 rounded-lg bg-ink-50 border border-ink-100 flex items-center justify-center shrink-0">
      <Icone size={14} className="text-ink-300" />
    </div>
  );
  return (
    <div className="w-10 h-10 rounded-lg border border-ink-100 overflow-hidden shrink-0 bg-white">
      <img src={url} alt="" className="w-full h-full object-contain p-0.5"
        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
    </div>
  );
}

function BadgeType({ type }: { type: string }) {
  if (type === "kit") return <span className="inline-flex items-center gap-1 badge text-xs shrink-0 bg-purple-100 text-purple-700"><Layers size={10} /> KIT</span>;
  return (
    <span className={cn("badge text-xs shrink-0", type === "service" ? "bg-volt-100 text-volt-700" : "bg-emerald-100 text-emerald-700")}>
      {type === "service" ? "S" : "M"}
    </span>
  );
}

function BoutonChoix({ remplacement, ajoutes, onClick, petit }: { remplacement: boolean; ajoutes: number; onClick: () => void; petit?: boolean }) {
  const [flash, setFlash] = useState(false);
  return (
    <button type="button"
      onClick={() => { onClick(); if (!remplacement) { setFlash(true); setTimeout(() => setFlash(false), 1100); } }}
      className={cn("inline-flex items-center justify-center gap-1 rounded-lg font-semibold transition-colors shrink-0",
        petit ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-xs",
        flash ? "bg-emerald-500 text-white" : "bg-ink-900 text-volt-400 hover:bg-ink-800")}>
      {flash ? <><Check size={12} /> Ajouté</> : remplacement ? "Choisir" : <><Plus size={12} /> Ajouter</>}
      {!flash && ajoutes > 0 && <span className="ml-0.5 text-emerald-300">×{ajoutes}</span>}
    </button>
  );
}

function ProduitLigne({ p, remplacement, filtreFournisseur, preference, actuel, ajoutes, onChoisir }: {
  p: PrestationPicker; remplacement: boolean; filtreFournisseur: string; preference: string | null; actuel: boolean;
  ajoutes: number; onChoisir: (offre: PrestationFournisseur | null) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const offres = offresTriees(p.fournisseurs);
  const type = typeDe(p);
  // Offre mise en avant : celle du fournisseur filtré, sinon celle du fournisseur « préféré »
  // (celui de la ligne qu'on remplace), sinon l'offre principale.
  const offreDefaut: PrestationFournisseur | null =
    (filtreFournisseur ? offres.find(o => libelleOffre(o) === filtreFournisseur) : undefined)
    ?? offrePourFournisseur(p, preference)
    ?? offrePrincipale(offres) ?? null;
  const prix = type === "kit" ? p.prix_unitaire : prixVenteOffre(p, offreDefaut);
  const { min, max } = fourchettePrix(p);
  const margeDefaut = offreDefaut ? margePct(offreDefaut.prix_achat, prixVenteOffre(p, offreDefaut)) : null;

  return (
    <div className={cn("rounded-xl border bg-white transition-colors", actuel ? "border-volt-400" : "border-ink-100 hover:border-ink-300")}>
      <div className="flex items-center gap-3 p-2.5">
        <Vignette url={p.image_url} type={type} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <BadgeType type={type} />
            <p className="text-sm font-medium text-ink-900 break-words min-w-0">{p.nom}</p>
            {actuel && <span className="badge text-xs bg-volt-100 text-volt-700">Actuel</span>}
          </div>
          <p className="text-xs text-ink-400 truncate mt-0.5">
            {[p.marque, p.categorie, p.sous_categorie, p.gamme ? LABEL_GAMME[p.gamme] : null].filter(Boolean).join(" · ")}
          </p>
          {type === "kit" && p.kit_description && <p className="text-xs text-ink-400 italic truncate">{p.kit_description}</p>}
          {offres.length >= 2 ? (
            <button type="button" onClick={() => setOuvert(o => !o)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-volt-600 font-medium hover:underline">
              {offres.length} fournisseurs · {min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`}
              {ouvert ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          ) : offreDefaut ? (
            <p className="text-xs text-ink-400 mt-0.5">
              {libelleOffre(offreDefaut)}{offreDefaut.reference ? ` · réf. ${offreDefaut.reference}` : ""}
            </p>
          ) : null}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-ink-900">{fmt(prix)}</p>
          <p className="text-xs text-ink-400">/ {p.unite}</p>
          {margeDefaut !== null && (
            <p className={cn("text-[10px] font-medium", margeDefaut < 0 ? "text-red-500" : "text-emerald-600")}>
              marge {margeDefaut > 0 ? "+" : ""}{margeDefaut}%
            </p>
          )}
        </div>
        <BoutonChoix remplacement={remplacement} ajoutes={ajoutes} onClick={() => onChoisir(type === "kit" ? null : offreDefaut)} />
      </div>

      {ouvert && offres.length >= 2 && (
        <div className="border-t border-ink-100 bg-ink-50/60 rounded-b-xl divide-y divide-ink-100">
          {offres.map(o => {
            const pv = prixVenteOffre(p, o);
            const m = margePct(o.prix_achat, pv);
            return (
              <div key={o.id} className="flex items-center gap-3 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-ink-800 truncate">
                    {libelleOffre(o)}
                    {o.principal && <span className="ml-1.5 badge text-[10px] bg-volt-100 text-volt-700">Principal</span>}
                  </p>
                  <p className="text-[11px] text-ink-400 truncate">
                    {o.reference ? `réf. ${o.reference} · ` : ""}
                    {o.prix_achat != null ? `achat ${fmt(o.prix_achat)}` : "achat non renseigné"}
                  </p>
                </div>
                {o.url && (
                  <a href={o.url} target="_blank" rel="noopener noreferrer" title="Ouvrir la page du fournisseur"
                    className="text-ink-300 hover:text-volt-600 shrink-0"><ExternalLink size={13} /></a>
                )}
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-ink-900">{fmt(pv)}</p>
                  {m !== null && <p className={cn("text-[10px] font-medium", m < 0 ? "text-red-500" : "text-emerald-600")}>{m > 0 ? "+" : ""}{m}%</p>}
                </div>
                <BoutonChoix petit remplacement={remplacement} ajoutes={0} onClick={() => onChoisir(o)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Composant principal ────────────────────────────────────────────────────

interface Props {
  prestations: PrestationPicker[];
  titre: string;
  sousTitre?: string;
  // true : on choisit UN produit puis la fenêtre se ferme (changer le produit d'une ligne).
  remplacement?: boolean;
  produitActuelId?: string | null;
  // Fournisseur à privilégier pour le bouton principal (ex. celui de la ligne qu'on remplace).
  fournisseurPrefere?: string | null;
  filtreInitial?: Partial<FiltresPicker>;
  inclureKits?: boolean;
  onChoisir: (p: PrestationPicker, offre: PrestationFournisseur | null) => void | Promise<void>;
  onFermer: () => void;
}

export default function ProduitPicker({
  prestations, titre, sousTitre, remplacement = false, produitActuelId = null, fournisseurPrefere = null,
  filtreInitial, inclureKits = true, onChoisir, onFermer,
}: Props) {
  const [f, setF] = useState<FiltresPicker>({ ...FILTRES_VIDES, ...filtreInitial });
  const [tri, setTri] = useState<"nom" | "prix_asc" | "prix_desc">("nom");
  const [limite, setLimite] = useState(PAS_PAGE);
  const [filtresMobile, setFiltresMobile] = useState(false);
  const [ajoutes, setAjoutes] = useState<Record<string, number>>({});

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onFermer(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFermer]);

  useEffect(() => { setLimite(PAS_PAGE); }, [f, tri]);

  const base = useMemo(() => prestations.filter(p => inclureKits || !p.est_kit), [prestations, inclureKits]);

  // Texte indexé (accents/casse neutralisés) : nom, description, marque, catégories, et pour
  // chaque offre le nom du fournisseur et sa référence.
  const textes = useMemo(() => {
    const m = new Map<string, string>();
    base.forEach(p => m.set(p.id, norm([
      p.nom, p.description, p.kit_description, p.marque, p.categorie, p.sous_categorie,
      ...(p.fournisseurs ?? []).flatMap(o => [libelleOffre(o), o.reference]),
    ].filter(Boolean).join(" "))));
    return m;
  }, [base]);

  const resultats = useMemo(() => {
    const l = base.filter(p => passe(p, f, textes.get(p.id) ?? ""));
    const prixMin = (p: PrestationPicker) => (p.est_kit ? p.prix_unitaire : fourchettePrix(p).min);
    l.sort((a, b) => {
      if (tri === "prix_asc") return prixMin(a) - prixMin(b) || a.nom.localeCompare(b.nom, "fr");
      if (tri === "prix_desc") return prixMin(b) - prixMin(a) || a.nom.localeCompare(b.nom, "fr");
      return a.nom.localeCompare(b.nom, "fr");
    });
    return l;
  }, [base, f, tri, textes]);

  // Facettes : chaque liste est comptée avec TOUS les autres filtres appliqués (pas le sien).
  const facettes = useMemo(() => {
    const pour = (cle: keyof FiltresPicker) => base.filter(p => passe(p, f, textes.get(p.id) ?? "", cle));
    const parType = pour("type");
    return {
      types: {
        materiau: parType.filter(p => typeDe(p) === "materiau").length,
        service: parType.filter(p => typeDe(p) === "service").length,
        kit: parType.filter(p => typeDe(p) === "kit").length,
      },
      cats: compter(pour("cat").map(p => p.categorie)),
      marques: compter(pour("marque").map(p => p.marque)),
      fournisseurs: compter(pour("fournisseur").flatMap(p => Array.from(new Set((p.fournisseurs ?? []).map(libelleOffre))))),
      gammes: compter(pour("gamme").map(p => p.gamme)),
      sousCats: compter(pour("sousCat").map(p => p.sous_categorie)),
    };
  }, [base, f, textes]);

  function maj<K extends keyof FiltresPicker>(cle: K, v: FiltresPicker[K]) { setF(prev => ({ ...prev, [cle]: v })); }
  const nbFiltres = (Object.keys(f) as (keyof FiltresPicker)[]).filter(k => k !== "q" && f[k]).length;
  const totalAjoutes = Object.values(ajoutes).reduce((a, b) => a + b, 0);

  async function choisir(p: PrestationPicker, offre: PrestationFournisseur | null) {
    await onChoisir(p, offre);
    if (remplacement) onFermer();
    else setAjoutes(prev => ({ ...prev, [p.id]: (prev[p.id] ?? 0) + 1 }));
  }

  const pastilles: { cle: keyof FiltresPicker; label: string }[] = [];
  if (f.type) pastilles.push({ cle: "type", label: f.type === "materiau" ? "Matériaux" : f.type === "service" ? "Services" : "Kits" });
  if (f.cat) pastilles.push({ cle: "cat", label: f.cat });
  if (f.sousCat) pastilles.push({ cle: "sousCat", label: `Type : ${f.sousCat}` });
  if (f.marque) pastilles.push({ cle: "marque", label: f.marque });
  if (f.fournisseur) pastilles.push({ cle: "fournisseur", label: `Fournisseur : ${f.fournisseur}` });
  if (f.gamme) pastilles.push({ cle: "gamme", label: LABEL_GAMME[f.gamme] ?? f.gamme });

  const typesDispo: { v: TypeFiltre; label: string; n: number }[] = [
    { v: "", label: "Tous", n: facettes.types.materiau + facettes.types.service + (inclureKits ? facettes.types.kit : 0) },
    { v: "materiau", label: "Matériaux", n: facettes.types.materiau },
    { v: "service", label: "Services", n: facettes.types.service },
    ...(inclureKits ? [{ v: "kit" as TypeFiltre, label: "Kits", n: facettes.types.kit }] : []),
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-2 md:p-6"
      onMouseDown={e => { if (e.target === e.currentTarget) onFermer(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden">
        {/* En-tête + recherche */}
        <div className="px-4 md:px-6 pt-4 pb-3 border-b border-ink-100 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold text-ink-900 text-lg leading-tight">{titre}</h2>
              {sousTitre && <p className="text-xs text-ink-400 truncate">{sousTitre}</p>}
            </div>
            <button type="button" onClick={onFermer} className="p-2 rounded-lg hover:bg-ink-100 text-ink-400 shrink-0"><X size={18} /></button>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              <input autoFocus className="input pl-9 w-full" placeholder="Rechercher : nom, marque, fournisseur, référence…"
                value={f.q} onChange={e => maj("q", e.target.value)} />
              {f.q && (
                <button type="button" onClick={() => maj("q", "")} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-700"><X size={14} /></button>
              )}
            </div>
            <button type="button" onClick={() => setFiltresMobile(o => !o)}
              className="md:hidden btn-ghost !px-3 shrink-0 relative">
              <SlidersHorizontal size={15} />
              {nbFiltres > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-volt-500 text-white text-[10px] flex items-center justify-center">{nbFiltres}</span>}
            </button>
            <select className="input !w-auto text-sm shrink-0 hidden sm:block" value={tri} onChange={e => setTri(e.target.value as typeof tri)}>
              <option value="nom">Tri : nom</option>
              <option value="prix_asc">Prix croissant</option>
              <option value="prix_desc">Prix décroissant</option>
            </select>
          </div>
          {pastilles.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {pastilles.map(pa => (
                <button key={pa.cle} type="button" onClick={() => maj(pa.cle, "" as never)}
                  className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-ink-900 text-volt-400 text-xs font-medium">
                  {pa.label} <X size={11} />
                </button>
              ))}
              <button type="button" onClick={() => setF(prev => ({ ...FILTRES_VIDES, q: prev.q }))}
                className="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-700 ml-1">
                <RotateCcw size={11} /> Tout effacer
              </button>
            </div>
          )}
        </div>

        {/* Corps : filtres + résultats */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          <aside className={cn("md:w-60 shrink-0 overflow-y-auto border-b md:border-b-0 md:border-r border-ink-100 p-4 space-y-4 max-h-[45vh] md:max-h-none bg-ink-50/40",
            filtresMobile ? "block" : "hidden md:block")}>
            <div>
              <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Type</p>
              <div className="grid grid-cols-2 gap-1">
                {typesDispo.map(t => (
                  <button key={t.v || "tous"} type="button" onClick={() => maj("type", t.v)}
                    className={cn("px-2 py-1.5 rounded-lg text-xs font-medium border transition-all",
                      f.type === t.v ? "bg-ink-900 text-volt-400 border-ink-900" : "bg-white border-ink-200 text-ink-600 hover:bg-ink-50")}>
                    {t.label} <span className={f.type === t.v ? "text-volt-400" : "text-ink-300"}>{t.n}</span>
                  </button>
                ))}
              </div>
            </div>
            <Facette titre="Catégorie" valeurs={facettes.cats} courant={f.cat} onChoisir={v => maj("cat", v)} />
            <Facette titre="Fournisseur" valeurs={facettes.fournisseurs} courant={f.fournisseur} onChoisir={v => maj("fournisseur", v)} />
            <Facette titre="Marque" valeurs={facettes.marques} courant={f.marque} onChoisir={v => maj("marque", v)} />
            <Facette titre="Gamme" valeurs={facettes.gammes.map(g => ({ ...g, label: LABEL_GAMME[g.valeur] ?? g.valeur }))} courant={f.gamme} onChoisir={v => maj("gamme", v)} />
            <Facette titre="Type d'article" valeurs={facettes.sousCats} courant={f.sousCat} onChoisir={v => maj("sousCat", v)} />
          </aside>

          <div className="flex-1 min-w-0 overflow-y-auto p-3 md:p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-ink-400 px-1">
              <span>{resultats.length} résultat{resultats.length > 1 ? "s" : ""}</span>
              <select className="sm:hidden text-xs border border-ink-200 rounded-lg py-1 px-1.5 bg-white" value={tri} onChange={e => setTri(e.target.value as typeof tri)}>
                <option value="nom">Tri : nom</option>
                <option value="prix_asc">Prix ↑</option>
                <option value="prix_desc">Prix ↓</option>
              </select>
            </div>
            {resultats.length === 0 ? (
              <div className="text-center py-16 text-ink-400">
                <Search size={28} className="mx-auto mb-2 text-ink-200" />
                <p className="text-sm">Aucun produit ne correspond.</p>
                {(nbFiltres > 0 || f.q) && (
                  <button type="button" onClick={() => setF(FILTRES_VIDES)} className="mt-2 text-xs text-volt-600 font-medium hover:underline">Réinitialiser la recherche</button>
                )}
              </div>
            ) : (
              <>
                {resultats.slice(0, limite).map(p => (
                  <ProduitLigne key={p.id} p={p} remplacement={remplacement}
                    filtreFournisseur={f.fournisseur} preference={fournisseurPrefere}
                    actuel={!!produitActuelId && p.id === produitActuelId}
                    ajoutes={ajoutes[p.id] ?? 0}
                    onChoisir={offre => choisir(p, offre)} />
                ))}
                {resultats.length > limite && (
                  <button type="button" onClick={() => setLimite(l => l + PAS_PAGE)}
                    className="w-full btn-ghost justify-center text-sm">
                    Afficher {Math.min(PAS_PAGE, resultats.length - limite)} de plus ({resultats.length - limite} restants)
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Pied */}
        {!remplacement && (
          <div className="px-4 md:px-6 py-3 border-t border-ink-100 flex items-center justify-between gap-3">
            <p className="text-sm text-ink-500">
              {totalAjoutes > 0
                ? <><span className="font-semibold text-emerald-600">{totalAjoutes}</span> produit{totalAjoutes > 1 ? "s" : ""} ajouté{totalAjoutes > 1 ? "s" : ""} au devis</>
                : "Clique sur « Ajouter » : la fenêtre reste ouverte pour en ajouter plusieurs."}
            </p>
            <button type="button" onClick={onFermer} className="btn-volt shrink-0"><Check size={15} /> Terminer</button>
          </div>
        )}
      </div>
    </div>
  );
}
