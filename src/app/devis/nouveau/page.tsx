"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Client, DevisLigne, Prestation } from "@/types";
import { fmt, genNumero, cn } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Save, Eye, PenLine, Plus, X, RotateCcw, Check, Download, ChevronDown, Tag, Gift, Search, Layers } from "lucide-react";
import Link from "next/link";

type Tab = "edition" | "apercu" | "signature";
type RemiseType = "pct" | "eur";

interface Remise {
  service_type: RemiseType;
  service_val: string;
  materiau_type: RemiseType;
  materiau_val: string;
}

interface Palier {
  id: string;
  label: string;
  seuil_min: number;
  seuil_max: number | null;
  remise_pct: number;
  couleur: string;
}

interface Apporteur {
  id: string;
  nom: string;
  entreprise?: string;
}

type PrestationExt = Prestation & { est_kit?: boolean; kit_description?: string | null };

// kit_ratio_service : ratio [0-1] de la part service dans le kit (calculé à l'ajout)
type DevisLigneExt = DevisLigne & { kit_description?: string | null; kit_ratio_service?: number | null };

function calcRemise(total: number, type: RemiseType, val: string): number {
  const v = parseFloat(val) || 0;
  if (type === "pct") return Math.min(total, total * v / 100);
  return Math.min(total, v);
}

function RemiseLine({ label, type, val, onType, onVal, base }: {
  label: string; type: RemiseType; val: string;
  onType: (t: RemiseType) => void; onVal: (v: string) => void; base: number;
}) {
  const montant = calcRemise(base, type, val);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-ink-500 w-20 shrink-0">{label}</span>
      <div className="flex rounded-lg border border-ink-200 overflow-hidden shrink-0">
        <button onClick={() => onType("pct")} className={cn("px-2 py-1 text-xs font-medium transition-colors", type === "pct" ? "bg-ink-900 text-volt-400" : "bg-white text-ink-500 hover:bg-ink-50")}>%</button>
        <button onClick={() => onType("eur")} className={cn("px-2 py-1 text-xs font-medium transition-colors border-l border-ink-200", type === "eur" ? "bg-ink-900 text-volt-400" : "bg-white text-ink-500 hover:bg-ink-50")}>€</button>
      </div>
      <input type="number" min="0" step="0.5" placeholder="0"
        value={val} onChange={e => onVal(e.target.value)}
        className="w-20 text-right text-xs border border-ink-200 rounded-lg py-1 px-2 bg-white" />
      {montant > 0 && <span className="text-xs text-red-500 shrink-0">− {fmt(montant)}</span>}
    </div>
  );
}

function NouveauDevisPage() {
  const router = useRouter();
  const params = useSearchParams();
  const clientIdParam = params.get("client");

  const [tab, setTab] = useState<Tab>("edition");
  const [clients, setClients] = useState<Client[]>([]);
  const [prestations, setPrestations] = useState<PrestationExt[]>([]);
  const [paliers, setPaliers] = useState<Palier[]>([]);
  const [apporteurs, setApporteurs] = useState<Apporteur[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCat, setActiveCat] = useState("Tous");
  const [searchCatalogue, setSearchCatalogue] = useState("");
  const [clientId, setClientId] = useState(clientIdParam ?? "");
  const [apporteurId, setApporteurId] = useState("");
  const [objet, setObjet] = useState("");
  const [validite, setValidite] = useState(60);
  const [lignes, setLignes] = useState<DevisLigneExt[]>([]);
  const [remise, setRemise] = useState<Remise>({ service_type: "pct", service_val: "", materiau_type: "pct", materiau_val: "" });
  const [showRemise, setShowRemise] = useState(false);
  const [remiseFidelitePct, setRemiseFidelitePct] = useState<number>(0);
  const [caClientPayé, setCaClientPayé] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [sigData, setSigData] = useState<string | null>(null);
  const [sigDate, setSigDate] = useState<string | null>(null);
  const [showLibre, setShowLibre] = useState(false);
  const [libre, setLibre] = useState({ nom: "", prix_unitaire: "", unite: "forfait", type_branche: "service" });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const sigCtx = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("clients").select("id, nom, prenom, email, telephone, adresse, code_postal, ville, statut, tableau_marque, code_acces").order("nom"),
      supabase.from("prestations").select("*").eq("actif", true).order("categorie").order("nom"),
      supabase.from("paliers_fidelite").select("*").order("seuil_min"),
      supabase.from("apporteurs").select("id,nom,entreprise").eq("actif", true).order("nom"),
    ]).then(([{ data: cls }, { data: pre }, { data: pal }, { data: ap }]) => {
      setClients((cls ?? []) as any);
      setPrestations((pre ?? []) as PrestationExt[]);
      setPaliers(pal ?? []);
      setApporteurs(ap ?? []);
      const cats = [...new Set((pre ?? []).filter((p: any) => !p.est_kit).map((p: any) => p.categorie))].sort();
      setCategories(cats);
    });
  }, []);

  useEffect(() => {
    if (tab !== "signature" || !canvasRef.current) return;
    const c = canvasRef.current;
    c.width = c.offsetWidth * window.devicePixelRatio;
    c.height = c.offsetHeight * window.devicePixelRatio;
    const ctx = c.getContext("2d")!;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.strokeStyle = "#1C1917"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    sigCtx.current = ctx;
  }, [tab]);

  useEffect(() => {
    if (!clientId) { setCaClientPayé(0); setRemiseFidelitePct(0); return; }
    supabase.from("factures").select("total_ttc, statut").eq("client_id", clientId).eq("statut", "payee")
      .then(({ data }) => setCaClientPayé((data ?? []).reduce((a, f) => a + (f.total_ttc ?? 0), 0)));
    setRemiseFidelitePct(0);
  }, [clientId]);

  function getPos(e: any) {
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    if (e.touches) return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function startDraw(e: any) { e.preventDefault(); drawing.current = true; last.current = getPos(e); }
  function moveDraw(e: any) {
    e.preventDefault();
    if (!drawing.current || !sigCtx.current) return;
    const p = getPos(e);
    sigCtx.current.beginPath(); sigCtx.current.moveTo(last.current.x, last.current.y);
    sigCtx.current.lineTo(p.x, p.y); sigCtx.current.stroke(); last.current = p;
  }
  function stopDraw() { drawing.current = false; }
  function clearSig() {
    if (!canvasRef.current || !sigCtx.current) return;
    sigCtx.current.clearRect(0, 0, canvasRef.current.offsetWidth, canvasRef.current.offsetHeight);
    setSigData(null); setSigDate(null);
  }
  function validerSig() {
    const c = canvasRef.current!;
    const px = sigCtx.current!.getImageData(0, 0, c.width, c.height).data;
    if (!px.some(v => v !== 0)) { alert("Veuillez signer."); return; }
    setSigData(c.toDataURL("image/png")); setSigDate(new Date().toLocaleString("fr-FR"));
  }

  async function addPrestation(p: PrestationExt) {
    if (p.est_kit) {
      const { data: composants } = await supabase
        .from("kit_composants")
        .select("*, prestation:composant_id(*)")
        .eq("kit_id", p.id)
        .order("ordre");

      const comps = composants ?? [];
      const totalComposants = comps.reduce((s: number, c: any) => s + (c.prestation?.prix_unitaire ?? 0) * c.quantite, 0);
      const totalService = comps.filter((c: any) => c.prestation?.type_branche === "service")
        .reduce((s: number, c: any) => s + (c.prestation?.prix_unitaire ?? 0) * c.quantite, 0);
      const ratioService = totalComposants > 0 ? totalService / totalComposants : 0;

      setLignes(prev => {
        const ex = prev.findIndex(l => l.prestation_id === p.id);
        if (ex >= 0) {
          const n = [...prev];
          n[ex] = { ...n[ex], quantite: n[ex].quantite + 1 };
          return n;
        }
        return [...prev, {
          nom: p.nom,
          prix_unitaire: totalComposants,
          quantite: 1,
          unite: "forfait",
          type_branche: ratioService >= 0.5 ? "service" : "materiau",
          prestation_id: p.id,
          kit_description: p.kit_description ?? null,
          kit_ratio_service: ratioService,
        }];
      });
      return;
    }

    setLignes(prev => {
      const ex = prev.findIndex(l => l.nom === p.nom && l.type_branche === p.type_branche && !l.kit_description);
      if (ex >= 0) { const n = [...prev]; n[ex] = { ...n[ex], quantite: n[ex].quantite + 1 }; return n; }
      return [...prev, { nom: p.nom, prix_unitaire: p.prix_unitaire, quantite: 1, unite: p.unite, type_branche: p.type_branche, prestation_id: p.id }];
    });
  }

  function addLibre() {
    if (!libre.nom.trim() || !libre.prix_unitaire) return;
    setLignes(prev => [...prev, { nom: libre.nom, prix_unitaire: parseFloat(libre.prix_unitaire), quantite: 1, unite: libre.unite, type_branche: libre.type_branche as any }]);
    setLibre({ nom: "", prix_unitaire: "", unite: "forfait", type_branche: "service" });
    setShowLibre(false);
  }

  // Calcul ventilé : les lignes kit utilisent kit_ratio_service pour ventiler
  const totServiceBrut = lignes.reduce((a, l) => {
    const total = l.prix_unitaire * l.quantite;
    if (l.kit_ratio_service != null) return a + total * l.kit_ratio_service;
    return l.type_branche === "service" ? a + total : a;
  }, 0);

  const totMateriauBrut = lignes.reduce((a, l) => {
    const total = l.prix_unitaire * l.quantite;
    if (l.kit_ratio_service != null) return a + total * (1 - l.kit_ratio_service);
    return l.type_branche === "materiau" ? a + total : a;
  }, 0);

  const remiseService = calcRemise(totServiceBrut, remise.service_type, remise.service_val);
  const remiseMateriau = calcRemise(totMateriauBrut, remise.materiau_type, remise.materiau_val);
  const totServiceApresRemise = totServiceBrut - remiseService;
  const remiseFideliteEur = remiseFidelitePct > 0 ? Math.round(totServiceApresRemise * remiseFidelitePct / 100 * 100) / 100 : 0;
  const totService = totServiceApresRemise - remiseFideliteEur;
  const totMateriau = totMateriauBrut - remiseMateriau;
  const totTTC = totService + totMateriau;
  const hasRemise = remiseService > 0 || remiseMateriau > 0;

  const selectedClient = clients.find(c => c.id === clientId) ?? null;
  const palierActuelClient = [...paliers].reverse().find(p => caClientPayé >= p.seuil_min) ?? null;

  const kitsFiltered = prestations.filter(p => {
    if (!p.est_kit) return false;
    const q = searchCatalogue.trim().toLowerCase();
    return !q || p.nom.toLowerCase().includes(q) || (p.kit_description ?? "").toLowerCase().includes(q);
  });

  const prestsFiltered = prestations.filter(p => {
    if (p.est_kit) return false;
    const matchCat = activeCat === "Tous" || p.categorie === activeCat;
    const q = searchCatalogue.trim().toLowerCase();
    const matchSearch = !q || p.nom.toLowerCase().includes(q) || p.categorie.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const filteredAll = [...kitsFiltered, ...prestsFiltered];

  async function enregistrer(statut = "brouillon") {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profil } = await supabase.from("profil").select("*").eq("id", user.id).single();
    const numero = genNumero(profil?.prefixe_devis ?? "DEV", profil?.compteur_devis ?? 0);
    const dateV = new Date(); dateV.setDate(dateV.getDate() + validite);

    const { data: dv, error } = await supabase.from("devis").insert({
      user_id: user.id, client_id: clientId || null,
      apporteur_id: apporteurId || null,
      numero, objet,
      date_validite: dateV.toISOString().split("T")[0],
      statut: sigData ? "signe" : statut,
      total_service: totService, total_materiau: totMateriau, total_ttc: totTTC,
      remise_type: hasRemise ? JSON.stringify({ service: remise.service_type, materiau: remise.materiau_type }) : null,
      remise_valeur: hasRemise ? (remiseService + remiseMateriau) : 0,
      remise_fidelite_pct: remiseFidelitePct > 0 ? remiseFidelitePct : null,
      signature_data: sigData, signe_le: sigData ? new Date().toISOString() : null,
    }).select().single();

    if (error || !dv) { alert("Erreur : " + error?.message); setSaving(false); return; }
    if (lignes.length > 0) {
      await supabase.from("devis_lignes").insert(
        lignes.map((l, i) => {
          const { kit_description, kit_ratio_service, ...rest } = l;
          return { ...rest, devis_id: dv.id, ordre: i };
        })
      );
    }
    await supabase.from("profil").update({ compteur_devis: (profil?.compteur_devis ?? 0) + 1 }).eq("id", user.id);
    router.push(`/devis/${dv.id}`);
  }

  async function telechargerPDF() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profil } = await supabase.from("profil").select("*").eq("id", user.id).single();
    const { genPDFDevis } = await import("@/lib/pdf");
    await genPDFDevis({
      id: "preview", user_id: user.id, numero: "DEV-PREVIEW", objet, statut: "brouillon",
      date_emission: new Date().toISOString().split("T")[0],
      total_service: totService, total_materiau: totMateriau, total_ttc: totTTC,
      remise_fidelite_pct: remiseFidelitePct > 0 ? remiseFidelitePct : undefined,
      created_at: "", updated_at: "",
      client: selectedClient ?? undefined, lignes,
      signature_data: sigData ?? undefined,
      signe_le: sigData ? new Date().toISOString() : undefined,
    }, profil ?? { id: user.id, prefixe_devis: "DEV", prefixe_facture: "FAC", compteur_devis: 0, compteur_facture: 0, mention_tva: "TVA non applicable — Art. 293 B du CGI", conditions_paiement: "Paiement à réception", taux_horaire: 55, created_at: "", updated_at: "" },
    sigData ?? undefined);
  }

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "edition", label: "Composition", icon: Plus },
    { id: "apercu", label: "Aperçu PDF", icon: Eye },
    { id: "signature", label: "Signature", icon: PenLine },
  ];

  return (
    <Shell>
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/devis" className="btn-ghost !px-2.5 !py-2"><ArrowLeft size={16} /></Link>
          <h1 className="font-display text-2xl text-ink-900 flex-1">Nouveau devis</h1>
          <button onClick={() => enregistrer("brouillon")} disabled={saving} className="btn-ghost">
            <Save size={15} /> {saving ? "…" : "Sauvegarder"}
          </button>
        </div>

        <div className="flex gap-1 mb-6 bg-ink-100 p-1 rounded-xl">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={cn("flex items-center gap-1.5 flex-1 justify-center px-3 py-2 rounded-lg text-sm font-medium transition-all",
                tab === id ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700")}>
              <Icon size={14} />{label}
              {id === "signature" && sigData && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
            </button>
          ))}
        </div>

        {tab === "edition" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="card card-inner">
                <h2 className="font-semibold text-ink-800 mb-3 text-sm uppercase tracking-wide">Client & objet</h2>
                <div className="space-y-3">
                  <div>
                    <label className="label">Client</label>
                    <select className="input" value={clientId} onChange={e => setClientId(e.target.value)}>
                      <option value="">— Sans client —</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.prenom ? `${c.prenom} ${c.nom}` : c.nom}</option>)}
                    </select>
                    {selectedClient && (
                      <div className="mt-2 text-xs text-ink-500 space-y-0.5">
                        {selectedClient.adresse && <p>📍 {selectedClient.adresse} {selectedClient.ville}</p>}
                        {selectedClient.tableau_marque && <p>⚡ Tableau : {selectedClient.tableau_marque}</p>}
                        {selectedClient.code_acces && <p>🔑 {selectedClient.code_acces}</p>}
                      </div>
                    )}
                  </div>

                  {apporteurs.length > 0 && (
                    <div>
                      <label className="label">Apporteur d'affaires <span className="text-ink-300 font-normal">(usage interne)</span></label>
                      <select className="input" value={apporteurId} onChange={e => setApporteurId(e.target.value)}>
                        <option value="">— Aucun apporteur —</option>
                        {apporteurs.map(a => (
                          <option key={a.id} value={a.id}>{a.nom}{a.entreprise ? ` — ${a.entreprise}` : ""}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {palierActuelClient && lignes.length > 0 && totServiceApresRemise > 0 && (
                    <div className={cn(
                      "rounded-xl border px-3 py-2.5 text-sm transition-all",
                      remiseFidelitePct > 0 ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"
                    )}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Gift size={14} className={remiseFidelitePct > 0 ? "text-emerald-600" : "text-amber-600"} />
                          <span className={cn("text-xs font-semibold", remiseFidelitePct > 0 ? "text-emerald-700" : "text-amber-700")}>
                            Remise fidélité {palierActuelClient.label} — {palierActuelClient.remise_pct}% sur services
                          </span>
                        </div>
                        {remiseFidelitePct > 0 ? (
                          <button onClick={() => setRemiseFidelitePct(0)} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium underline shrink-0">Retirer</button>
                        ) : (
                          <button onClick={() => setRemiseFidelitePct(palierActuelClient.remise_pct)} className="text-xs bg-amber-600 hover:bg-amber-700 text-white font-semibold px-2.5 py-1 rounded-lg transition-colors shrink-0">Appliquer</button>
                        )}
                      </div>
                      {remiseFidelitePct > 0 && (
                        <p className="text-xs text-emerald-600 mt-1 pl-5">− {fmt(remiseFideliteEur)} appliqué sur la branche service</p>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="label">Objet</label>
                    <input className="input" placeholder="Ex : Pose borne de recharge IRVE" value={objet} onChange={e => setObjet(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Validité</label>
                    <select className="input" value={validite} onChange={e => setValidite(parseInt(e.target.value))}>
                      <option value={30}>30 jours</option>
                      <option value={60}>60 jours</option>
                      <option value={90}>90 jours</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="card card-inner">
                <h2 className="font-semibold text-ink-800 mb-3 text-sm uppercase tracking-wide">Catalogue</h2>
                {prestations.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-ink-400 text-sm">Catalogue vide.</p>
                    <Link href="/catalogue" className="text-volt-600 text-sm hover:underline">Alimenter le catalogue →</Link>
                  </div>
                ) : (
                  <>
                    <div className="relative mb-3">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
                      <input type="text" placeholder="Rechercher une prestation ou un kit…"
                        value={searchCatalogue}
                        onChange={e => { setSearchCatalogue(e.target.value); if (e.target.value) setActiveCat("Tous"); }}
                        className="input pl-8 text-sm py-1.5" />
                      {searchCatalogue && (
                        <button onClick={() => setSearchCatalogue("")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-600 transition-colors">
                          <X size={13} />
                        </button>
                      )}
                    </div>

                    {!searchCatalogue && (
                      <div className="flex gap-1.5 flex-wrap mb-3">
                        {["Tous", ...categories].map(cat => (
                          <button key={cat} onClick={() => setActiveCat(cat)}
                            className={cn("px-2.5 py-1 rounded-lg text-xs font-medium border transition-all",
                              activeCat === cat ? "bg-ink-900 text-volt-400 border-ink-900" : "bg-white border-ink-200 text-ink-500 hover:bg-ink-50")}>
                            {cat}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {filteredAll.length === 0 ? (
                        <p className="text-center text-xs text-ink-400 py-6">Aucune prestation trouvée pour « {searchCatalogue} »</p>
                      ) : filteredAll.map(p => (
                        <button key={p.id} onClick={() => addPrestation(p)}
                          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-ink-100 hover:border-volt-400 hover:bg-volt-50 bg-white transition-all group text-left">
                          {p.est_kit ? (
                            <span className="inline-flex items-center gap-1 badge text-xs shrink-0 bg-purple-100 text-purple-700">
                              <Layers size={10} /> KIT
                            </span>
                          ) : (
                            <span className={cn("badge text-xs shrink-0", p.type_branche === "service" ? "bg-volt-100 text-volt-700" : "bg-emerald-100 text-emerald-700")}>
                              {p.type_branche === "service" ? "S" : "M"}
                            </span>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-ink-800 truncate">{p.nom}</p>
                            {p.est_kit && p.kit_description && (
                              <p className="text-xs text-ink-400 italic truncate">{p.kit_description}</p>
                            )}
                          </div>
                          <span className="text-xs text-ink-400 shrink-0">{p.unite}</span>
                          <span className="text-sm font-semibold text-ink-900 shrink-0">{fmt(p.prix_unitaire)}</span>
                          <Plus size={14} className="text-ink-300 group-hover:text-volt-500 shrink-0" />
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <button onClick={() => setShowLibre(!showLibre)} className="mt-3 w-full flex items-center gap-2 text-xs text-ink-500 hover:text-ink-700 py-1.5">
                  <Plus size={13} /> Ajouter une ligne personnalisée
                  <ChevronDown size={12} className={cn("ml-auto transition-transform", showLibre && "rotate-180")} />
                </button>
                {showLibre && (
                  <div className="mt-2 p-3 bg-ink-50 rounded-xl border border-ink-100 space-y-2">
                    <input className="input text-sm" placeholder="Désignation" value={libre.nom} onChange={e => setLibre(l => ({ ...l, nom: e.target.value }))} />
                    <div className="grid grid-cols-3 gap-2">
                      <input className="input text-sm" type="number" placeholder="Prix €" value={libre.prix_unitaire} onChange={e => setLibre(l => ({ ...l, prix_unitaire: e.target.value }))} />
                      <select className="input text-sm" value={libre.unite} onChange={e => setLibre(l => ({ ...l, unite: e.target.value }))}>
                        {["forfait","heure","u","ml","m2"].map(u => <option key={u}>{u}</option>)}
                      </select>
                      <select className="input text-sm" value={libre.type_branche} onChange={e => setLibre(l => ({ ...l, type_branche: e.target.value }))}>
                        <option value="service">Service</option>
                        <option value="materiau">Matériau</option>
                      </select>
                    </div>
                    <button onClick={addLibre} className="btn-volt w-full justify-center text-sm"><Plus size={14} /> Ajouter</button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="card card-inner">
                <h2 className="font-semibold text-ink-800 mb-3 text-sm uppercase tracking-wide">Lignes du devis</h2>
                {lignes.length === 0 ? (
                  <p className="text-sm text-ink-400 text-center py-10">Ajoutez des prestations depuis le catalogue</p>
                ) : (
                  <div className="space-y-2">
                    {lignes.map((l, i) => (
                      <div key={i} className="flex flex-col gap-0.5 p-2.5 rounded-xl bg-ink-50 border border-ink-100">
                        <div className="flex items-center gap-2">
                          {l.kit_ratio_service != null ? (
                            <span className="inline-flex items-center gap-1 badge text-xs shrink-0 bg-purple-100 text-purple-700">
                              <Layers size={10} /> KIT
                            </span>
                          ) : (
                            <span className={cn("badge text-xs shrink-0", l.type_branche === "service" ? "bg-volt-100 text-volt-700" : "bg-emerald-100 text-emerald-700")}>
                              {l.type_branche === "service" ? "S" : "M"}
                            </span>
                          )}
                          <span className="text-xs text-ink-800 flex-1 min-w-0 truncate">{l.nom}</span>
                          <span className="text-xs text-ink-400 shrink-0">{l.unite}</span>
                          <input type="number" min="1" step="0.5" value={l.quantite}
                            onChange={e => setLignes(prev => { const n = [...prev]; n[i] = { ...n[i], quantite: parseFloat(e.target.value) || 1 }; return n; })}
                            className="w-14 text-center text-xs border border-ink-200 rounded-lg py-1 bg-white" />
                          <span className="text-xs text-ink-400">×</span>
                          <input type="number" min="0" step="0.5" value={l.prix_unitaire}
                            onChange={e => setLignes(prev => { const n = [...prev]; n[i] = { ...n[i], prix_unitaire: parseFloat(e.target.value) || 0 }; return n; })}
                            className="w-16 text-right text-xs border border-ink-200 rounded-lg py-1 bg-white" />
                          <span className="text-xs font-semibold text-ink-900 w-14 text-right shrink-0">{fmt(l.prix_unitaire * l.quantite)}</span>
                          <button onClick={() => setLignes(p => p.filter((_, idx) => idx !== i))} className="text-ink-300 hover:text-red-500 transition-colors"><X size={14} /></button>
                        </div>
                        {l.kit_description && (
                          <p className="text-xs text-ink-400 italic pl-7 truncate">{l.kit_description}</p>
                        )}
                        {l.kit_ratio_service != null && (
                          <p className="text-xs text-purple-400 pl-7">
                            Ventilation : {fmt(l.prix_unitaire * l.quantite * l.kit_ratio_service)} service · {fmt(l.prix_unitaire * l.quantite * (1 - l.kit_ratio_service))} matériaux
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {lignes.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-ink-100 space-y-2">
                    <div className="flex justify-between text-xs text-ink-500"><span>Prestation service</span><span>{fmt(totServiceBrut)}</span></div>
                    <div className="flex justify-between text-xs text-ink-500"><span>Achat / revente matériaux</span><span>{fmt(totMateriauBrut)}</span></div>
                    <button onClick={() => setShowRemise(!showRemise)} className="w-full flex items-center gap-2 text-xs text-ink-500 hover:text-ink-700 py-1 mt-1">
                      <Tag size={12} /><span>Appliquer une remise</span>
                      {hasRemise && <span className="ml-1 px-1.5 py-0.5 rounded-md bg-red-100 text-red-600 text-xs font-medium">− {fmt(remiseService + remiseMateriau)}</span>}
                      <ChevronDown size={12} className={cn("ml-auto transition-transform", showRemise && "rotate-180")} />
                    </button>
                    {showRemise && (
                      <div className="p-3 bg-ink-50 rounded-xl border border-ink-100 space-y-2">
                        <RemiseLine label="Sur services" type={remise.service_type} val={remise.service_val}
                          onType={t => setRemise(r => ({ ...r, service_type: t }))}
                          onVal={v => setRemise(r => ({ ...r, service_val: v }))} base={totServiceBrut} />
                        <RemiseLine label="Sur matériaux" type={remise.materiau_type} val={remise.materiau_val}
                          onType={t => setRemise(r => ({ ...r, materiau_type: t }))}
                          onVal={v => setRemise(r => ({ ...r, materiau_val: v }))} base={totMateriauBrut} />
                      </div>
                    )}
                    {remiseService > 0 && <div className="flex justify-between text-xs text-red-500"><span>Remise services</span><span>− {fmt(remiseService)}</span></div>}
                    {remiseMateriau > 0 && <div className="flex justify-between text-xs text-red-500"><span>Remise matériaux</span><span>− {fmt(remiseMateriau)}</span></div>}
                    {remiseFideliteEur > 0 && (
                      <div className="flex justify-between text-xs text-emerald-600 font-medium">
                        <span>🎁 Remise fidélité ({remiseFidelitePct}% service)</span>
                        <span>− {fmt(remiseFideliteEur)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-bold text-ink-900 pt-2 border-t border-ink-200">
                      <span>Total net à payer</span><span className="text-volt-600">{fmt(totTTC)}</span>
                    </div>
                    <div className="flex justify-between text-xs mt-1">
                      <span className="text-volt-600">CA service : {fmt(totService)}</span>
                      <span className="text-emerald-600">CA matériaux : {fmt(totMateriau)}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setTab("apercu")} className="btn-ghost flex-1 justify-center"><Eye size={15} /> Aperçu PDF</button>
                <button onClick={() => setTab("signature")} className="btn-primary flex-1 justify-center"><PenLine size={15} /> Faire signer</button>
              </div>
            </div>
          </div>
        )}

        {tab === "apercu" && (
          <div>
            <div className="card overflow-hidden mb-5">
              <div className="bg-ink-900 px-6 py-5 flex justify-between items-start">
                <div>
                  <p className="text-volt-400 font-display text-2xl">DEVIS</p>
                  <p className="text-ink-400 text-xs mt-1">N° DEV-{new Date().getFullYear()}-XXX · Émis le {new Date().toLocaleDateString("fr-FR")}</p>
                </div>
                <div className="text-right text-xs text-ink-400">
                  <p className="text-white font-semibold text-sm">Votre Entreprise</p>
                  <p>Auto-entrepreneur</p>
                </div>
              </div>
              <div className="p-6">
                {selectedClient && (
                  <div className="mb-6 grid grid-cols-2 gap-4">
                    <div className="bg-ink-50 rounded-xl p-3">
                      <p className="text-xs text-ink-400 font-semibold uppercase mb-1">Client</p>
                      <p className="font-semibold text-ink-900">{selectedClient.prenom ? `${selectedClient.prenom} ${selectedClient.nom}` : selectedClient.nom}</p>
                      {selectedClient.adresse && <p className="text-xs text-ink-500">{selectedClient.adresse}</p>}
                    </div>
                    {objet && (
                      <div className="bg-ink-50 rounded-xl p-3">
                        <p className="text-xs text-ink-400 font-semibold uppercase mb-1">Objet</p>
                        <p className="text-ink-900">{objet}</p>
                      </div>
                    )}
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ink-200 text-xs text-ink-400">
                        <th className="text-left pb-2">Désignation</th><th className="text-left pb-2">Type</th>
                        <th className="text-left pb-2">Unité</th><th className="text-right pb-2">Qté</th>
                        <th className="text-right pb-2">P.U.</th><th className="text-right pb-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lignes.length === 0 ? (
                        <tr><td colSpan={6} className="text-center py-8 text-ink-400">Aucune ligne</td></tr>
                      ) : lignes.map((l, i) => (
                        <tr key={i} className="border-b border-ink-100">
                          <td className="py-2.5 pr-2">
                            <p>{l.nom}</p>
                            {l.kit_description && (
                              <p className="text-xs text-ink-400 italic mt-0.5">{l.kit_description}</p>
                            )}
                          </td>
                          <td className="py-2.5">
                            {l.kit_ratio_service != null ? (
                              <span className="inline-flex items-center gap-1 badge text-xs bg-purple-100 text-purple-700">
                                <Layers size={10} /> Kit
                              </span>
                            ) : (
                              <span className={cn("badge text-xs", l.type_branche === "service" ? "bg-volt-100 text-volt-700" : "bg-emerald-100 text-emerald-700")}>
                                {l.type_branche === "service" ? "Service" : "Matériau"}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 text-ink-500 text-xs">{l.unite}</td>
                          <td className="py-2.5 text-right">{l.quantite}</td>
                          <td className="py-2.5 text-right text-ink-500">{fmt(l.prix_unitaire)}</td>
                          <td className="py-2.5 text-right font-semibold">{fmt(l.prix_unitaire * l.quantite)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end mt-4">
                  <div className="w-56 space-y-1">
                    <div className="flex justify-between text-sm text-ink-500"><span>Service</span><span>{fmt(totServiceBrut)}</span></div>
                    {remiseService > 0 && <div className="flex justify-between text-sm text-red-500"><span>Remise service</span><span>− {fmt(remiseService)}</span></div>}
                    <div className="flex justify-between text-sm text-ink-500"><span>Matériaux</span><span>{fmt(totMateriauBrut)}</span></div>
                    {remiseMateriau > 0 && <div className="flex justify-between text-sm text-red-500"><span>Remise matériaux</span><span>− {fmt(remiseMateriau)}</span></div>}
                    {remiseFideliteEur > 0 && <div className="flex justify-between text-sm text-emerald-600"><span>🎁 Fidélité ({remiseFidelitePct}%)</span><span>− {fmt(remiseFideliteEur)}</span></div>}
                    <div className="flex justify-between font-bold text-base text-volt-600 pt-2 border-t border-ink-200"><span>Total TTC</span><span>{fmt(totTTC)}</span></div>
                  </div>
                </div>
                <p className="text-xs text-ink-300 mt-4">TVA non applicable — Art. 293 B du CGI</p>
                {sigData && (
                  <div className="mt-4 pt-4 border-t border-ink-100">
                    <p className="text-xs text-ink-400 mb-2">Bon pour accord — Signature client</p>
                    <img src={sigData} alt="Signature" className="h-16 border border-ink-200 rounded-lg p-2" />
                    <p className="text-xs text-ink-400 mt-1">Signé le {sigDate}</p>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setTab("edition")} className="btn-ghost flex-1 justify-center"><ArrowLeft size={15} /> Modifier</button>
              <button onClick={telechargerPDF} className="btn-primary flex-1 justify-center"><Download size={15} /> Télécharger PDF</button>
              <button onClick={() => enregistrer("brouillon")} disabled={saving} className="btn-volt flex-1 justify-center"><Save size={15} /> Enregistrer</button>
            </div>
          </div>
        )}

        {tab === "signature" && (
          <div className="max-w-xl mx-auto space-y-4">
            <div className="card card-inner">
              <p className="font-semibold text-ink-800 mb-1">{selectedClient ? (selectedClient.prenom ? `${selectedClient.prenom} ${selectedClient.nom}` : selectedClient.nom) : "Client non sélectionné"}</p>
              {objet && <p className="text-sm text-ink-500">{objet}</p>}
              <p className="text-2xl font-bold text-volt-600 mt-2">{fmt(totTTC)}</p>
              {(hasRemise || remiseFideliteEur > 0) && (
                <p className="text-xs text-red-500 mt-0.5">Remise incluse : − {fmt(remiseService + remiseMateriau + remiseFideliteEur)}</p>
              )}
            </div>
            {sigData ? (
              <div className="space-y-4">
                <div className="card card-inner">
                  <div className="flex items-center gap-3 mb-4 text-emerald-600">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center"><Check size={20} /></div>
                    <div><p className="font-semibold">Devis signé</p><p className="text-xs text-emerald-500">{sigDate}</p></div>
                  </div>
                  <img src={sigData} alt="Signature" className="max-h-24 border border-ink-100 rounded-xl p-3" />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => { setSigData(null); setSigDate(null); }} className="btn-ghost flex-1 justify-center"><RotateCcw size={14} /> Signer à nouveau</button>
                  <button onClick={telechargerPDF} className="btn-primary flex-1 justify-center"><Download size={14} /> PDF signé</button>
                  <button onClick={() => enregistrer("signe")} disabled={saving} className="btn-volt flex-1 justify-center"><Save size={14} /> Enregistrer</button>
                </div>
              </div>
            ) : (
              <div className="card card-inner">
                <p className="font-semibold text-ink-800 mb-1">Signature du client</p>
                <p className="text-sm text-ink-500 mb-4">Tendez le téléphone — signez dans la zone ci-dessous.</p>
                <canvas ref={canvasRef} className="w-full border-2 border-dashed border-ink-200 rounded-2xl bg-white cursor-crosshair touch-none" style={{ height: "200px" }}
                  onMouseDown={startDraw} onMouseMove={moveDraw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                  onTouchStart={startDraw} onTouchMove={moveDraw} onTouchEnd={stopDraw} />
                <div className="flex gap-3 mt-4">
                  <button onClick={clearSig} className="btn-ghost flex-1 justify-center"><RotateCcw size={14} /> Effacer</button>
                  <button onClick={validerSig} className="btn-success flex-1 justify-center"><Check size={14} /> Valider la signature</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}

import { Suspense } from "react";
export default function Page() {
  return <Suspense><NouveauDevisPage /></Suspense>;
}
