"use client";
// Étiquettes à la demande pour les tableaux électriques : une seule ou plusieurs sur la même planche A4, en PDF à imprimer à l'échelle 100 %.
import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Plus, Printer, Tag, Trash2, Upload } from "lucide-react";
import Shell from "@/components/layout/Shell";
import { supabase } from "@/lib/supabase";
import { CIRCUITS } from "@/lib/electrical-constants";
import { lireStockage, ecrireStockage } from "@/lib/safe-storage";
import { rowsTableauProjet } from "@/lib/projets";
import { genererPdfEtiquettes } from "@/lib/pdf-etiquettes";
import {
  CLE_BROUILLON_ETIQUETTES, FORMATS, ID_PERSONNALISE, LIMITES, PAGE_A4, PT_EN_MM,
  brouillonVide, composerEtiquette, composerPlanches, estImprimable, etiquettesDepuisRangees, formatChoisi, grille, lireBrouillon, nouvelleEtiquette,
  pictoDeEtiquette, quantiteValide, serialiserBrouillon, type BrouillonEtiquettes, type Etiquette, type FormatPlanche, type Mesure,
} from "@/lib/etiquettes";
import { BOITE_PICTO, LISTE_PICTOS, PICTOS, PICTO_AUCUN, TRAIT_PICTO, detecterPicto, type Primitive } from "@/lib/pictogrammes";

interface ClientLigne { id: string; nom: string; prenom?: string | null }
interface ProjetLigne { id: string; nom: string; tableau_config?: string | null; tableaux_annexes?: string | null }

/** Mesure du texte pour l'aperçu : Helvetica/Arial du navigateur (le PDF mesure avec jsPDF, mêmes proportions à très peu près). */
function creerMesureApercu(): Mesure {
  const ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  return (t, pt, gras) => {
    if (!ctx) return t.length * pt * PT_EN_MM * (gras ? 0.56 : 0.52);
    ctx.font = `${gras ? "bold " : ""}100px Helvetica, Arial, sans-serif`;
    return (ctx.measureText(t).width / 100) * pt * PT_EN_MM;
  };
}

/** Primitives d'un pictogramme en SVG (même dessin que dans le PDF). À placer dans un groupe fill="none" stroke="#000". */
function Prims({ prims }: { prims: Primitive[] }) {
  return (
    <>
      {prims.map((pr, i) => {
        const v = pr.v;
        switch (pr.t) {
          case "l": return <line key={i} x1={v[0]} y1={v[1]} x2={v[2]} y2={v[3]} />;
          case "r": return <rect key={i} x={v[0]} y={v[1]} width={v[2]} height={v[3]} rx={v[4]} />;
          case "c": return <circle key={i} cx={v[0]} cy={v[1]} r={v[2]} />;
          case "d": return <circle key={i} cx={v[0]} cy={v[1]} r={v[2]} fill="#000" stroke="none" />;
          default: {
            const pts = v.reduce((a, n, k) => a + (k % 2 ? "," : k ? " " : "") + n, "");
            return pr.t === "p" ? <polyline key={i} points={pts} /> : <polygon key={i} points={pts} />;
          }
        }
      })}
    </>
  );
}

function PictoMini({ id }: { id: string | null }) {
  return (
    <svg viewBox={`0 0 ${BOITE_PICTO} ${BOITE_PICTO}`} width={28} height={28} aria-hidden="true" className="shrink-0 rounded bg-ink-50">
      {id && PICTOS[id] && <g fill="none" stroke="#111" strokeWidth={TRAIT_PICTO} strokeLinecap="round" strokeLinejoin="round"><Prims prims={PICTOS[id].prims} /></g>}
    </svg>
  );
}

const num = (v: string): number => (v.trim() === "" ? NaN : Number(v.replace(",", ".")));
const affiche = (v: number): string | number => (Number.isFinite(v) ? v : "");

const CIRCUITS_RAPIDES = (() => {
  const vus = new Set<string>();
  return Object.values(CIRCUITS).flatMap(c => {
    const cle = `${c.label}|${c.ampMax}`;
    if (vus.has(cle)) return [];
    vus.add(cle);
    return [{ cle, texte: c.label, ligne2: `${c.ampMax} A` }];
  });
})();

export default function EtiquettesPage() {
  const [b, setB] = useState<BrouillonEtiquettes>(brouillonVide);
  const [charge, setCharge] = useState(false);
  const [pageApercu, setPageApercu] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<{ type: "erreur" | "info"; texte: string } | null>(null);

  const [importOuvert, setImportOuvert] = useState(false);
  const [clients, setClients] = useState<ClientLigne[] | null>(null);
  const [clientId, setClientId] = useState("");
  const [projets, setProjets] = useState<ProjetLigne[] | null>(null);
  const [projetId, setProjetId] = useState("");
  const [importErreur, setImportErreur] = useState<string | null>(null);
  const [importOccupe, setImportOccupe] = useState(false);
  const derniereDemande = useRef(0);

  // Brouillon : relu au montage, réécrit à chaque modification (tout reste sur cet appareil).
  useEffect(() => { setB(lireBrouillon(lireStockage("local", CLE_BROUILLON_ETIQUETTES))); setCharge(true); }, []);
  useEffect(() => { if (charge) ecrireStockage("local", CLE_BROUILLON_ETIQUETTES, serialiserBrouillon(b)); }, [b, charge]);

  const format = useMemo(() => formatChoisi(b), [b]);
  const g = useMemo(() => grille(format), [format]);
  const resultat = useMemo(() => composerPlanches(b.etiquettes, format, b.debut), [b.etiquettes, format, b.debut]);
  const mesure = useMemo(() => creerMesureApercu(), []);
  const planches = "erreur" in resultat ? [] : resultat.planches;
  const page = Math.min(pageApercu, Math.max(0, planches.length - 1));
  const nbAImprimer = b.etiquettes.filter(estImprimable).length;

  const miseEnPage = useMemo(() => {
    const m = new Map<string, ReturnType<typeof composerEtiquette>>();
    for (const e of b.etiquettes) m.set(e.id, composerEtiquette(e.texte, e.ligne2, format.largeur, format.hauteur, pictoDeEtiquette(e, b.pictos), mesure));
    return m;
  }, [b.etiquettes, b.pictos, format.largeur, format.hauteur, mesure]);
  // Le pictogramme n'est omis que si l'étiquette est vraiment trop basse (moins de ~6,5 mm de haut).
  const pictoPossible = useMemo(() => !!g && composerEtiquette("x", "", format.largeur, format.hauteur, "four", mesure).picto !== null, [g, format.largeur, format.hauteur, mesure]);

  const maj = (patch: Partial<BrouillonEtiquettes>) => { setMessage(null); setB(x => ({ ...x, ...patch })); };
  const majEtiquette = (id: string, patch: Partial<Etiquette>) => maj({ etiquettes: b.etiquettes.map(e => (e.id === id ? { ...e, ...patch } : e)) });
  const ajouter = (e: Etiquette) => maj({ etiquettes: [...b.etiquettes, e] });
  const supprimer = (id: string) => { const reste = b.etiquettes.filter(e => e.id !== id); maj({ etiquettes: reste.length > 0 ? reste : [nouvelleEtiquette()] }); };
  const dupliquer = (e: Etiquette) => { const i = b.etiquettes.findIndex(x => x.id === e.id); const copie = nouvelleEtiquette(e.texte, e.ligne2, e.quantite); const l = [...b.etiquettes]; l.splice(i + 1, 0, copie); maj({ etiquettes: l }); };
  const majPerso = (patch: Partial<FormatPlanche>) => maj({ perso: { ...b.perso, ...patch } });

  /** Les lignes vides (celle de départ) sont remplacées par ce qu'on importe ; le reste est conservé. */
  const ajouterPlusieurs = (nouvelles: Etiquette[]) => maj({ etiquettes: [...b.etiquettes.filter(e => e.texte.trim() !== "" || e.ligne2.trim() !== ""), ...nouvelles] });

  async function ouvrirImport() {
    setImportOuvert(o => !o);
    if (clients !== null) return;
    const { data, error } = await supabase.from("clients").select("id, nom, prenom").order("nom");
    if (error) { setImportErreur("Impossible de lire les clients."); setClients([]); return; }
    setClients((data ?? []) as ClientLigne[]);
  }

  async function choisirClient(id: string) {
    setClientId(id); setProjetId(""); setProjets(null); setImportErreur(null);
    if (!id) return;
    const demande = ++derniereDemande.current;
    // Lecture simple : « listerProjets » crée un projet par défaut quand il n'y en a pas, ce qu'on ne veut pas ici.
    const { data, error } = await supabase.from("projets").select("id, nom, tableau_config, tableaux_annexes").eq("client_id", id).order("created_at", { ascending: true });
    if (demande !== derniereDemande.current) return;   // un autre client a été choisi entre-temps
    if (error) { setImportErreur("Impossible de lire les tableaux de ce client."); setProjets([]); return; }
    const l = (data ?? []) as ProjetLigne[];
    setProjets(l);
    if (l.length === 1) setProjetId(l[0].id);
  }

  const projet = projets?.find(p => p.id === projetId) ?? null;
  const aImporter = useMemo(() => (projet ? etiquettesDepuisRangees(rowsTableauProjet(projet)) : []), [projet]);

  function importer() {
    if (aImporter.length === 0) return;
    ajouterPlusieurs(aImporter);
    setMessage({ type: "info", texte: `${aImporter.length} étiquette${aImporter.length > 1 ? "s" : ""} ajoutée${aImporter.length > 1 ? "s" : ""} depuis le tableau : corrige les textes si besoin.` });
    setImportOuvert(false);
  }

  async function telecharger() {
    setMessage(null);
    if ("erreur" in resultat) { setMessage({ type: "erreur", texte: resultat.erreur }); return; }
    setOccupe(true);
    try {
      const pdf = await genererPdfEtiquettes(resultat.planches, format, { guides: b.guides, pictos: b.pictos });
      const url = URL.createObjectURL(pdf.blob);
      const a = document.createElement("a"); a.href = url; a.download = pdf.nom; document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      setMessage({ type: "info", texte: `PDF prêt : ${resultat.total} étiquette${resultat.total > 1 ? "s" : ""} sur ${resultat.planches.length} page${resultat.planches.length > 1 ? "s" : ""}. Imprime à 100 % (taille réelle), sans « ajuster à la page ».` });
    } catch (e) { setMessage({ type: "erreur", texte: `PDF impossible : ${e instanceof Error ? e.message : "erreur inconnue"}` }); }
    finally { setOccupe(false); }
  }

  const formatInvalide = g === null;

  return (
    <Shell>
      <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-4">
        <div>
          <h1 className="font-display text-3xl text-ink-900 flex items-center gap-2"><Tag size={26} /> Étiquettes</h1>
          <p className="text-ink-500 text-sm mt-1">Crée tes étiquettes de repérage (disjoncteurs, différentiels, rangées, coffret) à la demande : une seule ou plusieurs sur la même planche, prêtes à imprimer ou à coller.</p>
        </div>

        {/* ── Liste ── */}
        <div className="card card-inner space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-ink-800">Étiquettes à imprimer</h2>
            <p className="text-xs text-ink-400" aria-live="polite">{"erreur" in resultat ? "" : `${resultat.total} au total`}</p>
          </div>

          <ul className="space-y-2">
            {b.etiquettes.map((e, i) => (
              <li key={e.id} className="rounded-lg border border-ink-200 p-2 grid gap-2 md:grid-cols-[1fr_9rem_5rem_auto] md:items-center">
                <input className="input !py-2 text-sm" aria-label={`Texte de l'étiquette ${i + 1}`} placeholder="Texte (ex. Lave-linge)" maxLength={LIMITES.texte}
                  value={e.texte} onChange={ev => majEtiquette(e.id, { texte: ev.target.value })} />
                <input className="input !py-2 text-sm" aria-label={`Deuxième ligne de l'étiquette ${i + 1}`} placeholder="2ᵉ ligne (ex. 20 A)" maxLength={LIMITES.ligne2}
                  value={e.ligne2} onChange={ev => majEtiquette(e.id, { ligne2: ev.target.value })} />
                <label className="flex items-center gap-1 text-xs text-ink-500">
                  <span>Qté</span>
                  <input className="input !py-2 text-sm w-full" type="number" inputMode="numeric" min={1} max={LIMITES.quantiteMax} aria-label={`Quantité de l'étiquette ${i + 1}`}
                    value={e.quantite === 0 ? "" : e.quantite}
                    onChange={ev => majEtiquette(e.id, { quantite: ev.target.value === "" ? 0 : Math.min(LIMITES.quantiteMax, Math.max(0, Math.round(Number(ev.target.value)) || 0)) })}
                    onBlur={() => majEtiquette(e.id, { quantite: quantiteValide(e.quantite) })} />
                </label>
                <div className="flex gap-1 justify-end">
                  <button type="button" className="btn-ghost !px-2 !py-1 text-ink-500" title="Dupliquer" aria-label={`Dupliquer l'étiquette ${i + 1}`} onClick={() => dupliquer(e)}><Copy size={15} /></button>
                  <button type="button" className="btn-ghost !px-2 !py-1 text-red-600" title="Supprimer" aria-label={`Supprimer l'étiquette ${i + 1}`} onClick={() => supprimer(e.id)}><Trash2 size={15} /></button>
                </div>
                <div className="md:col-span-4 flex items-center gap-2 text-xs text-ink-500">
                  <PictoMini id={pictoDeEtiquette(e, b.pictos)} />
                  <label className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0">Pictogramme</span>
                    <select className="input !py-1 text-xs !w-auto min-w-0 max-w-full" aria-label={`Pictogramme de l'étiquette ${i + 1}`} disabled={!b.pictos}
                      value={e.icone ?? "auto"} onChange={ev => majEtiquette(e.id, { icone: ev.target.value === "auto" ? undefined : ev.target.value })}>
                      <option value="auto">{(() => { const d = detecterPicto(e.texte); return d ? `Auto : ${PICTOS[d].nom}` : "Auto (aucun reconnu)"; })()}</option>
                      <option value={PICTO_AUCUN}>Aucun</option>
                      {LISTE_PICTOS.map(pi => <option key={pi.id} value={pi.id}>{pi.nom}</option>)}
                    </select>
                  </label>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost" onClick={() => ajouter(nouvelleEtiquette())}><Plus size={14} /> Ajouter une étiquette</button>
            <select className="input !py-2 text-sm !w-auto" aria-label="Ajout rapide d'un circuit courant" value="" onChange={ev => {
              const c = CIRCUITS_RAPIDES.find(x => x.cle === ev.target.value);
              if (c) ajouterPlusieurs([nouvelleEtiquette(c.texte, c.ligne2)]);
            }}>
              <option value="">Ajout rapide : circuit courant…</option>
              {CIRCUITS_RAPIDES.map(c => <option key={c.cle} value={c.cle}>{c.texte} ({c.ligne2})</option>)}
            </select>
            <button type="button" className="btn-ghost" aria-expanded={importOuvert} onClick={() => void ouvrirImport()}><Upload size={14} /> Importer d&apos;un tableau</button>
            <button type="button" className="btn-ghost text-red-600 ml-auto" onClick={() => { if (window.confirm("Vider toute la liste d'étiquettes ?")) maj({ etiquettes: [nouvelleEtiquette()], debut: 0 }); }}>Tout vider</button>
          </div>

          {importOuvert && (
            <div className="rounded-lg bg-ink-50 border border-ink-200 p-3 space-y-2">
              <p className="text-xs text-ink-500">Reprend les noms et calibres des appareils d&apos;un tableau déjà créé dans VoltApp (tableau principal et annexes).</p>
              <div className="grid gap-2 md:grid-cols-2">
                <select className="input !py-2 text-sm" aria-label="Client" value={clientId} onChange={ev => void choisirClient(ev.target.value)}>
                  <option value="">{clients === null ? "Chargement des clients…" : "Choisir un client…"}</option>
                  {(clients ?? []).map(c => <option key={c.id} value={c.id}>{[c.nom, c.prenom].filter(Boolean).join(" ")}</option>)}
                </select>
                <select className="input !py-2 text-sm" aria-label="Chantier / tableau" value={projetId} disabled={!projets || projets.length === 0} onChange={ev => setProjetId(ev.target.value)}>
                  <option value="">{!clientId ? "Choisis d'abord un client" : projets === null ? "Chargement…" : projets.length === 0 ? "Aucun tableau pour ce client" : "Choisir le chantier…"}</option>
                  {(projets ?? []).map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
                </select>
              </div>
              {projet && aImporter.length === 0 && <p className="text-xs text-amber-700">Ce chantier n&apos;a pas encore d&apos;appareil dans son tableau.</p>}
              {importErreur && <p className="text-xs text-red-700" role="alert">{importErreur}</p>}
              <button type="button" className="btn-volt" disabled={aImporter.length === 0} onClick={importer}>
                {aImporter.length > 0 ? `Ajouter ${aImporter.length} étiquette${aImporter.length > 1 ? "s" : ""}` : "Ajouter"}
              </button>
            </div>
          )}
        </div>

        {/* ── Planche ── */}
        <div className="card card-inner space-y-3">
          <h2 className="font-semibold text-ink-800">Format de la planche (A4)</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block"><span className="label">Taille des étiquettes</span>
              <select className="input" value={b.formatId} onChange={ev => maj({ formatId: ev.target.value, debut: 0 })}>
                {FORMATS.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
                <option value={ID_PERSONNALISE}>Personnalisé…</option>
              </select>
            </label>
            <label className="block"><span className="label">Commencer à la case n°</span>
              <input className="input" type="number" inputMode="numeric" min={1} max={g?.parPage ?? 1} disabled={!g} value={b.debut + 1}
                onChange={ev => maj({ debut: Math.max(0, (Math.round(Number(ev.target.value)) || 1) - 1) })} />
              <span className="text-[11px] text-ink-400">Pour réutiliser une planche adhésive déjà entamée.</span>
            </label>
          </div>

          {b.formatId === ID_PERSONNALISE && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {([["largeur", "Largeur (mm)"], ["hauteur", "Hauteur (mm)"], ["marge", "Marge page (mm)"], ["ecart", "Écart (mm)"]] as const).map(([k, nom]) => (
                <label key={k} className="block"><span className="label">{nom}</span>
                  <input className="input" type="number" inputMode="decimal" step="0.5" min={0} value={affiche(b.perso[k])} onChange={ev => majPerso({ [k]: num(ev.target.value) })} />
                </label>
              ))}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={b.guides} onChange={ev => maj({ guides: ev.target.checked })} /> Traits de découpe autour des étiquettes
            <span className="text-[11px] text-ink-400">(à décocher sur une planche adhésive prédécoupée)</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={b.pictos} onChange={ev => maj({ pictos: ev.target.checked })} /> Pictogrammes reconnus automatiquement
            <span className="text-[11px] text-ink-400">(lave-linge, four, prise, VMC…)</span>
          </label>
          {b.pictos && g && !pictoPossible && <p className="text-xs text-amber-700">Cette étiquette est trop basse pour afficher un pictogramme : elles sont imprimées avec le texte seul. Choisis un format d'au moins 7 mm de haut pour avoir les pictogrammes.</p>}

          {formatInvalide
            ? <p className="text-sm text-red-700" role="alert">{"erreur" in resultat ? resultat.erreur : "Format invalide."}</p>
            : <p className="text-xs text-ink-500">{g.colonnes} × {g.lignes} = {g.parPage} étiquettes par page{b.debut >= g.parPage ? ` — la case ${b.debut + 1} n'existe pas, elle sera ramenée à ${g.parPage}` : ""}.</p>}
        </div>

        {/* ── Aperçu + PDF ── */}
        <div className="card card-inner space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-ink-800">Aperçu</h2>
            {planches.length > 1 && (
              <div className="flex items-center gap-2 text-xs text-ink-500">
                <button type="button" className="btn-ghost !px-2 !py-1" disabled={page === 0} onClick={() => setPageApercu(page - 1)}>‹</button>
                <span>Page {page + 1} / {planches.length}</span>
                <button type="button" className="btn-ghost !px-2 !py-1" disabled={page >= planches.length - 1} onClick={() => setPageApercu(page + 1)}>›</button>
              </div>
            )}
          </div>

          {"erreur" in resultat ? (
            <p className="text-sm text-ink-500" role="status">{resultat.erreur}</p>
          ) : (
            <svg viewBox={`0 0 ${PAGE_A4.largeur} ${PAGE_A4.hauteur}`} className="w-full max-w-sm mx-auto border border-ink-200 bg-white rounded shadow-sm" role="img"
              aria-label={`Aperçu de la page ${page + 1} : ${planches[page]?.filter(c => c.etiquette).length ?? 0} étiquettes`}>
              {(planches[page] ?? []).map(c => (
                <g key={c.index}>
                  <rect x={c.x} y={c.y} width={format.largeur} height={format.hauteur}
                    fill={c.etiquette ? "none" : "#f3f4f6"} stroke={c.etiquette ? (b.guides ? "#aaa" : "#e5e7eb") : "#e5e7eb"} strokeWidth={c.etiquette && b.guides ? 0.15 : 0.1} strokeDasharray={c.etiquette ? undefined : "1 1"} />
                  {c.etiquette && miseEnPage.get(c.etiquette.id)?.picto && (() => {
                    const pi = miseEnPage.get(c.etiquette!.id)!.picto!;
                    return (
                      <g transform={`translate(${c.x + pi.x} ${c.y + pi.y}) scale(${pi.taille / BOITE_PICTO})`} fill="none" stroke="#000" strokeWidth={Math.max(TRAIT_PICTO, 0.2 / (pi.taille / BOITE_PICTO))} strokeLinecap="round" strokeLinejoin="round">
                        <Prims prims={PICTOS[pi.id].prims} />
                      </g>
                    );
                  })()}
                  {c.etiquette && (miseEnPage.get(c.etiquette.id)?.lignes ?? []).map((l, i) => (
                    <text key={i} x={c.x + l.x} y={c.y + l.y} textAnchor="middle" fontSize={l.pt * PT_EN_MM} fontWeight={l.gras ? 700 : 400}
                      fontFamily="Helvetica, Arial, sans-serif" fill="#000">{l.texte}</text>
                  ))}
                </g>
              ))}
            </svg>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-volt" disabled={occupe || nbAImprimer === 0 || formatInvalide} onClick={() => void telecharger()}>
              {occupe ? <><Printer size={14} /> Création du PDF…</> : <><Download size={14} /> Télécharger le PDF</>}
            </button>
            <p className="text-[11px] text-ink-400">Imprime à 100 % (taille réelle), sans « ajuster à la page », pour que les étiquettes gardent leurs dimensions.</p>
          </div>
          {message && <p className={`text-sm ${message.type === "erreur" ? "text-red-700" : "text-emerald-700"}`} role={message.type === "erreur" ? "alert" : "status"}>{message.texte}</p>}
          <p className="text-[11px] text-ink-400">Ton brouillon est gardé sur cet appareil : tu retrouves ta liste et ton format à la prochaine visite.</p>
        </div>
      </div>
    </Shell>
  );
}
