"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Devis, DevisLigne, Prestation, Client, Profil } from "@/types";
import { fmt, fmtDate, fmtDatetime, STATUT_LABELS, STATUT_COLORS, cn } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, CheckCircle, Receipt, Trash2, Pencil, Save, X, Plus, ChevronDown, Eye, PenLine, RotateCcw, Check, Tag, Upload, Gift, CalendarDays, MessageSquare, Copy } from "lucide-react";

type Mode = "view" | "edit";
type Tab = "edition" | "apercu" | "signature";
type RemiseType = "pct" | "eur";
type SigMode = "draw" | "upload";

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
      <input type="number" min="0" step="0.5" placeholder="0" value={val}
        onChange={e => onVal(e.target.value)}
        className="w-20 text-right text-xs border border-ink-200 rounded-lg py-1 px-2 bg-white" />
      {montant > 0 && <span className="text-xs text-red-500 shrink-0">− {fmt(montant)}</span>}
    </div>
  );
}

function calcRemise(total: number, type: RemiseType, val: string): number {
  const v = parseFloat(val) || 0;
  if (type === "pct") return Math.min(total, total * v / 100);
  return Math.min(total, v);
}

function ApercuDocument({
  devis, lignes, profil, sigData, sigDate,
  totServiceBrut, totMateriauBrut, remiseService, remiseMateriau,
  remiseFideliteEur, remiseFidelitePct, totTTC,
}: {
  devis: Devis;
  lignes: DevisLigne[];
  profil: Profil | null;
  sigData: string | null;
  sigDate: string | null;
  totServiceBrut: number;
  totMateriauBrut: number;
  remiseService: number;
  remiseMateriau: number;
  remiseFideliteEur: number;
  remiseFidelitePct: number;
  totTTC: number;
}) {
  const client = devis.client as any;
  const artisan = [
    profil?.nom_entreprise ?? `${profil?.prenom ?? ""} ${profil?.nom ?? ""}`.trim(),
    profil?.siret ? `SIRET ${profil.siret}` : "",
    profil?.telephone ?? "",
    profil?.email ?? "",
    [profil?.adresse, profil?.code_postal, profil?.ville].filter(Boolean).join(" "),
  ].filter(Boolean);
  const hasRemise = remiseService > 0.01 || remiseMateriau > 0.01;

  return (
    <div className="bg-white rounded-2xl overflow-hidden border border-ink-200 shadow-sm text-sm font-sans">
      <div className="bg-ink-900 px-6 py-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-volt-400 font-bold text-xl tracking-wide">DEVIS</p>
          <p className="text-ink-400 text-xs mt-1">N° {devis.numero}</p>
          <p className="text-ink-400 text-xs">
            Émis le {fmtDate(devis.date_emission)}
            {devis.date_validite ? ` · Valable jusqu'au ${fmtDate(devis.date_validite)}` : ""}
          </p>
        </div>
        {artisan.length > 0 && (
          <div className="text-right">
            {artisan.map((l, i) => (
              <p key={i} className={cn("text-xs leading-5", i === 0 ? "text-white font-semibold" : "text-ink-400")}>{l}</p>
            ))}
          </div>
        )}
      </div>

      <div className="p-6 space-y-5">
        <div className="flex gap-4 flex-wrap">
          {client && (
            <div className="bg-ink-50 rounded-xl px-4 py-3 min-w-[180px] flex-1">
              <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-1">Client</p>
              <p className="font-semibold text-ink-900">{client.prenom ? `${client.prenom} ${client.nom}` : client.nom}</p>
              {client.adresse && <p className="text-xs text-ink-500 mt-0.5">{client.adresse}</p>}
              {(client.code_postal || client.ville) && (
                <p className="text-xs text-ink-500">{[client.code_postal, client.ville].filter(Boolean).join(" ")}</p>
              )}
              {client.telephone && <p className="text-xs text-ink-400 mt-0.5">{client.telephone}</p>}
            </div>
          )}
          {devis.objet && (
            <div className="bg-ink-50 rounded-xl px-4 py-3 flex-1 min-w-[140px]">
              <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-1">Objet</p>
              <p className="text-ink-900 font-medium">{devis.objet}</p>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-ink-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink-900 text-volt-400 text-xs font-semibold uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Désignation</th>
                <th className="text-left px-3 py-2.5 hidden md:table-cell">Type</th>
                <th className="text-center px-3 py-2.5">Qté</th>
                <th className="text-right px-3 py-2.5">P.U.</th>
                <th className="text-right px-4 py-2.5">Total</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={i} className={cn("border-t border-ink-100", i % 2 === 1 ? "bg-ink-50/50" : "bg-white")}>
                  <td className="px-4 py-2.5 text-ink-900">
                    <span className="font-medium">{l.nom}</span>
                    {(l as any).kit_description && (
                      <p className="text-xs text-ink-400 italic mt-0.5">{(l as any).kit_description}</p>
                    )}
                    {!(l as any).kit_description && l.description && (
                      <p className="text-xs text-ink-400 italic mt-0.5">{l.description}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-ink-500 text-xs hidden md:table-cell">{l.type_branche === "service" ? "Service" : "Matériau"}</td>
                  <td className="px-3 py-2.5 text-center text-ink-700">{l.quantite}</td>
                  <td className="px-3 py-2.5 text-right text-ink-500">{fmt(l.prix_unitaire)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-ink-900">{fmt(l.prix_unitaire * l.quantite)}</td>
                </tr>
              ))}
              {lignes.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-300 italic">Aucune ligne</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <div className="w-64 bg-ink-50 rounded-xl px-4 py-3 space-y-1.5">
            <div className="flex justify-between text-xs text-ink-500"><span>Prestation service</span><span>{fmt(totServiceBrut)}</span></div>
            {remiseService > 0.01 && <div className="flex justify-between text-xs text-red-500"><span>Remise service</span><span>− {fmt(remiseService)}</span></div>}
            <div className="flex justify-between text-xs text-ink-500"><span>Achat / revente</span><span>{fmt(totMateriauBrut)}</span></div>
            {remiseMateriau > 0.01 && <div className="flex justify-between text-xs text-red-500"><span>Remise matériaux</span><span>− {fmt(remiseMateriau)}</span></div>}
            {remiseFideliteEur > 0.01 && (
              <div className="flex justify-between text-xs text-emerald-600 font-medium">
                <span>🎁 Fidélité ({remiseFidelitePct}%)</span><span>− {fmt(remiseFideliteEur)}</span>
              </div>
            )}
            {(hasRemise || remiseFideliteEur > 0.01) && (
              <div className="flex justify-between text-xs text-red-600 font-medium pt-1 border-t border-ink-200">
                <span>Total remises</span><span>− {fmt(remiseService + remiseMateriau + remiseFideliteEur)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-volt-600 text-base pt-2 border-t border-ink-200">
              <span>Total net à payer</span><span>{fmt(totTTC)}</span>
            </div>
          </div>
        </div>

        <p className="text-xs text-ink-300 italic">{profil?.mention_tva ?? "TVA non applicable — Art. 293 B du CGI"}</p>

        <div className="border-t border-ink-100 pt-4">
          <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-3">Bon pour accord — Signature du client</p>
          {sigData ? (
            <div className="space-y-1">
              <img src={sigData} alt="Signature" className="h-20 border border-ink-100 rounded-xl p-2 bg-white" />
              {sigDate && <p className="text-xs text-ink-400">Signé le {sigDate}</p>}
            </div>
          ) : devis.signature_data ? (
            <div className="space-y-1">
              <img src={devis.signature_data} alt="Signature" className="h-20 border border-ink-100 rounded-xl p-2 bg-white" />
              {devis.signe_le && <p className="text-xs text-ink-400">Signé le {fmtDatetime(devis.signe_le)}</p>}
            </div>
          ) : (
            <div className="h-20 border-2 border-dashed border-ink-200 rounded-xl bg-ink-50 flex items-center justify-center">
              <p className="text-xs text-ink-300 italic">Signature à apposer</p>
            </div>
          )}
        </div>

        {profil?.conditions_paiement && (
          <div className="bg-ink-900 rounded-xl px-4 py-2.5 text-center">
            <p className="text-xs text-ink-400">{profil.conditions_paiement}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DevisDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [devis, setDevis] = useState<Devis | null>(null);
  const [profil, setProfil] = useState<Profil | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [tab, setTab] = useState<Tab>("edition");
  const [clients, setClients] = useState<Client[]>([]);
  const [prestations, setPrestations] = useState<Prestation[]>([]);
  const [paliers, setPaliers] = useState<Palier[]>([]);
  const [apporteurs, setApporteurs] = useState<Apporteur[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCat, setActiveCat] = useState("Tous");
  const [clientId, setClientId] = useState("");
  const [apporteurId, setApporteurId] = useState("");
  const [objet, setObjet] = useState("");
  const [validite, setValidite] = useState(60);
  const [lignes, setLignes] = useState<DevisLigne[]>([]);
  const [remise, setRemise] = useState<Remise>({ service_type: "pct", service_val: "", materiau_type: "pct", materiau_val: "" });
  const [showRemise, setShowRemise] = useState(false);
  const [remiseFidelitePct, setRemiseFidelitePct] = useState<number>(0);
  const [caClientPayé, setCaClientPayé] = useState<number>(0);
  const [showLibre, setShowLibre] = useState(false);
  const [libre, setLibre] = useState({ nom: "", prix_unitaire: "", unite: "forfait", type_branche: "service" });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sigData, setSigData] = useState<string | null>(null);
  const [sigDate, setSigDate] = useState<string | null>(null);
  const [sigMode, setSigMode] = useState<SigMode>("draw");
  const [generatingLink, setGeneratingLink] = useState(false);
  const [factureAssociee, setFactureAssociee] = useState<{ id: string; numero: string; statut: string } | null>(null);
  const [sigLink, setSigLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [viewSigMode, setViewSigMode] = useState<"direct" | "sms">("direct");
  const [viewSigInputMode, setViewSigInputMode] = useState<"draw" | "upload">("draw");
  const [viewSigData, setViewSigData] = useState<string | null>(null);
  const [viewSigDate, setViewSigDate] = useState<string | null>(null);
  const viewCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewFileInputRef = useRef<HTMLInputElement>(null);
  const viewDrawing = useRef(false);
  const viewLast = useRef({ x: 0, y: 0 });
  const viewSigCtx = useRef<CanvasRenderingContext2D | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const sigCtx = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    supabase.from("devis").select("*, client:clients(*), lignes:devis_lignes(*)")
      .eq("id", id).single().then(({ data }) => {
        if (!data) return;
        const d = data as any;
        setDevis(d);
        setClientId(d.client_id ?? "");
        setApporteurId(d.apporteur_id ?? "");
        setObjet(d.objet ?? "");
        setLignes(d.lignes ?? []);
        setRemiseFidelitePct(d.remise_fidelite_pct ?? 0);
        if (d.remise_valeur > 0 && d.remise_type) {
          try {
            const rt = JSON.parse(d.remise_type);
            const totSBrut = (d.lignes ?? []).filter((l: any) => l.type_branche === "service").reduce((a: number, l: any) => a + l.prix_unitaire * l.quantite, 0);
            const totMBrut = (d.lignes ?? []).filter((l: any) => l.type_branche === "materiau").reduce((a: number, l: any) => a + l.prix_unitaire * l.quantite, 0);
            const remS = totSBrut - d.total_service - (d.remise_fidelite_pct ? totSBrut * d.remise_fidelite_pct / 100 : 0);
            const remM = totMBrut - d.total_materiau;
            setRemise({
              service_type: rt.service ?? "eur",
              service_val: remS > 0 ? (rt.service === "pct" ? String(Math.round(remS / totSBrut * 100 * 100) / 100) : String(remS)) : "",
              materiau_type: rt.materiau ?? "eur",
              materiau_val: remM > 0 ? (rt.materiau === "pct" ? String(Math.round(remM / totMBrut * 100 * 100) / 100) : String(remM)) : "",
            });
            if (remS > 0 || remM > 0) setShowRemise(true);
          } catch {}
        }
        if (d.client_id) {
          supabase.from("factures").select("total_ttc, statut").eq("client_id", d.client_id).eq("statut", "payee")
            .then(({ data: facs }) => setCaClientPayé((facs ?? []).reduce((a, f) => a + (f.total_ttc ?? 0), 0)));
        }
      });

    supabase.from("factures").select("id, numero, statut").eq("devis_id", id).maybeSingle()
      .then(({ data: f }) => { if (f) setFactureAssociee(f as any); });

    Promise.all([
      supabase.from("clients").select("id, nom, prenom, email, telephone, adresse, code_postal, ville, statut").order("nom"),
      supabase.from("prestations").select("*").eq("actif", true).order("categorie").order("nom"),
      supabase.from("paliers_fidelite").select("*").order("seuil_min"),
      supabase.from("apporteurs").select("id,nom,entreprise").eq("actif", true).order("nom"),
      supabase.from("profil").select("*").eq("id", "d506c94e-40c7-4bcd-a48c-97e86f4ea7c0").single(),
    ]).then(([{ data: cls }, { data: pre }, { data: pal }, { data: ap }, { data: p }]) => {
      setClients((cls ?? []) as any);
      setPrestations(pre ?? []);
      setPaliers(pal ?? []);
      setApporteurs(ap ?? []);
      setCategories([...new Set((pre ?? []).map((p: any) => p.categorie))].sort() as string[]);
      if (p) setProfil(p as Profil);
    });
  }, [id]);

  useEffect(() => {
    if (!clientId) { setCaClientPayé(0); return; }
    supabase.from("factures").select("total_ttc, statut").eq("client_id", clientId).eq("statut", "payee")
      .then(({ data }) => setCaClientPayé((data ?? []).reduce((a, f) => a + (f.total_ttc ?? 0), 0)));
  }, [clientId]);

  useEffect(() => {
    if (tab !== "signature" || sigMode !== "draw" || !canvasRef.current) return;
    const c = canvasRef.current;
    c.width = c.offsetWidth * window.devicePixelRatio;
    c.height = c.offsetHeight * window.devicePixelRatio;
    const ctx = c.getContext("2d")!;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.strokeStyle = "#1C1917"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    sigCtx.current = ctx;
  }, [tab, mode, sigMode]);

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

  useEffect(() => {
    if (viewSigMode !== "direct" || viewSigInputMode !== "draw" || !viewCanvasRef.current) return;
    const c = viewCanvasRef.current;
    c.width = c.offsetWidth * window.devicePixelRatio;
    c.height = c.offsetHeight * window.devicePixelRatio;
    const ctx = c.getContext("2d")!;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.strokeStyle = "#1C1917"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    viewSigCtx.current = ctx;
  }, [viewSigMode, viewSigInputMode]);

  function getViewPos(e: any) {
    const c = viewCanvasRef.current!; const r = c.getBoundingClientRect();
    if (e.touches) return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function startViewDraw(e: any) { e.preventDefault(); viewDrawing.current = true; viewLast.current = getViewPos(e); }
  function moveViewDraw(e: any) {
    e.preventDefault();
    if (!viewDrawing.current || !viewSigCtx.current) return;
    const p = getViewPos(e);
    viewSigCtx.current.beginPath(); viewSigCtx.current.moveTo(viewLast.current.x, viewLast.current.y);
    viewSigCtx.current.lineTo(p.x, p.y); viewSigCtx.current.stroke(); viewLast.current = p;
  }
  function stopViewDraw() { viewDrawing.current = false; }
  function clearViewSig() {
    if (!viewCanvasRef.current || !viewSigCtx.current) return;
    viewSigCtx.current.clearRect(0, 0, viewCanvasRef.current.offsetWidth, viewCanvasRef.current.offsetHeight);
  }
  function validerViewCanvas() {
    const c = viewCanvasRef.current!;
    const px = viewSigCtx.current!.getImageData(0, 0, c.width, c.height).data;
    if (!px.some(v => v !== 0)) { alert("Veuillez signer."); return; }
    setViewSigData(c.toDataURL("image/png"));
    setViewSigDate(new Date().toLocaleString("fr-FR"));
  }
  function handleViewUploadSig(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setViewSigData(ev.target?.result as string); setViewSigDate(new Date().toLocaleString("fr-FR")); };
    reader.readAsDataURL(file);
  }
  async function validerSignatureDirecte() {
    if (!viewSigData || !devis) return;
    await supabase.from("devis").update({
      signature_data: viewSigData,
      signe_le: new Date().toISOString(),
      statut: "signe",
    }).eq("id", id);
    setDevis(d => d ? { ...d, signature_data: viewSigData, signe_le: new Date().toISOString(), statut: "signe" } : d);
    setViewSigData(null); setViewSigDate(null);
  }
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
  function handleUploadSig(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setSigData(ev.target?.result as string); setSigDate(new Date().toLocaleString("fr-FR")); };
    reader.readAsDataURL(file);
  }

  async function envoyerParSMS() {
    if (!devis) return;
    setGeneratingLink(true);
    try {
      const res = await fetch("/api/devis/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devis_id: id }),
      });
      const { token } = await res.json();
      const link = `${window.location.origin}/devis/signer/${token}`;
      setSigLink(link);
      const client = devis.client as any;
      const tel = client?.telephone?.replace(/\s/g, "") ?? "";
      const msg = `Bonjour ${client?.prenom ?? ""}, veuillez signer votre devis ${devis.numero} ici : ${link}`;
      window.location.href = `sms:${tel}?body=${encodeURIComponent(msg)}`;
    } catch {}
    setGeneratingLink(false);
  }

  async function copyLink() {
    if (!sigLink) return;
    await navigator.clipboard.writeText(sigLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  function addPrestation(p: Prestation) {
    setLignes(prev => {
      const ex = prev.findIndex(l => l.nom === p.nom && l.type_branche === p.type_branche);
      if (ex >= 0) { const n = [...prev]; n[ex] = { ...n[ex], quantite: n[ex].quantite + 1 }; return n; }
      return [...prev, {
        nom: p.nom,
        kit_description: p.description,
        prix_unitaire: p.prix_unitaire,
        quantite: 1,
        unite: p.unite,
        type_branche: p.type_branche,
        prestation_id: p.id,
      }];
    });
  }

  function addLibre() {
    if (!libre.nom.trim() || !libre.prix_unitaire) return;
    setLignes(prev => [...prev, { nom: libre.nom, prix_unitaire: parseFloat(libre.prix_unitaire), quantite: 1, unite: libre.unite, type_branche: libre.type_branche as any }]);
    setLibre({ nom: "", prix_unitaire: "", unite: "forfait", type_branche: "service" });
    setShowLibre(false);
  }

  const totServiceBrut = lignes.filter(l => l.type_branche === "service").reduce((a, l) => a + l.prix_unitaire * l.quantite, 0);
  const totMateriauBrut = lignes.filter(l => l.type_branche === "materiau").reduce((a, l) => a + l.prix_unitaire * l.quantite, 0);
  const remiseService = calcRemise(totServiceBrut, remise.service_type, remise.service_val);
  const remiseMateriau = calcRemise(totMateriauBrut, remise.materiau_type, remise.materiau_val);
  const totServiceApresRemise = totServiceBrut - remiseService;
  const remiseFideliteEur = remiseFidelitePct > 0 ? Math.round(totServiceApresRemise * remiseFidelitePct / 100 * 100) / 100 : 0;
  const totService = totServiceApresRemise - remiseFideliteEur;
  const totMateriau = totMateriauBrut - remiseMateriau;
  const totTTC = totService + totMateriau;
  const hasRemise = remiseService > 0 || remiseMateriau > 0;

  const palierActuelClient = [...paliers].reverse().find(p => caClientPayé >= p.seuil_min) ?? null;
  const filteredPrests = activeCat === "Tous" ? prestations : prestations.filter(p => p.categorie === activeCat);

  async function saveEdit() {
    if (!devis) return;
    setSaving(true);
    const dateV = new Date(); dateV.setDate(dateV.getDate() + validite);
    await supabase.from("devis_lignes").delete().eq("devis_id", id);
    await supabase.from("devis").update({
      client_id: clientId || null,
      apporteur_id: apporteurId || null,
      objet,
      date_validite: dateV.toISOString().split("T")[0],
      total_service: totService, total_materiau: totMateriau, total_ttc: totTTC,
      remise_type: hasRemise ? JSON.stringify({ service: remise.service_type, materiau: remise.materiau_type }) : null,
      remise_valeur: remiseService + remiseMateriau,
      remise_fidelite_pct: remiseFidelitePct > 0 ? remiseFidelitePct : null,
      signature_data: sigData ?? devis.signature_data,
      signe_le: sigData ? new Date().toISOString() : devis.signe_le,
      statut: sigData ? "signe" : devis.statut,
    }).eq("id", id);
    if (lignes.length > 0) {
  console.log("LIGNES A SAUVEGARDER:", JSON.stringify(lignes.map(l => ({ nom: l.nom, kit_description: (l as any).kit_description, description: (l as any).description }))));
      await supabase.from("devis_lignes").insert(lignes.map((l, i) => ({
        devis_id: id,
        ordre: i,
        nom: l.nom,
        kit_description: (l as any).kit_description ?? null,
        quantite: l.quantite,
        prix_unitaire: l.prix_unitaire,
        unite: l.unite,
        type_branche: l.type_branche,
        prestation_id: (l as any).prestation_id ?? null,
        kit_groupe: (l as any).kit_groupe ?? null,
        kit_ratio_service: (l as any).kit_ratio_service ?? null,
      })));
    }
    const { data } = await supabase.from("devis").select("*, client:clients(*), lignes:devis_lignes(*)").eq("id", id).single();
    setDevis(data as any);
    setMode("view");
    setSaving(false);
  }

  async function deleteDevis() {
    await supabase.from("devis_lignes").delete().eq("devis_id", id);
    await supabase.from("devis").delete().eq("id", id);
    router.push("/devis");
  }

  async function dl() {
    if (!devis) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: p } = await supabase.from("profil").select("*").eq("id", user.id).single();
    const { genPDFDevis } = await import("@/lib/pdf");
    await genPDFDevis(devis, p ?? { id: user.id, prefixe_devis: "DEV", prefixe_facture: "FAC", compteur_devis: 0, compteur_facture: 0, mention_tva: "TVA non applicable — Art. 293 B du CGI", conditions_paiement: "Paiement à réception", taux_horaire: 55, created_at: "", updated_at: "" });
  }

  async function convertirFacture() {
    if (!devis || devis.statut !== "signe") { alert("Ce devis n'est pas encore signé."); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: p } = await supabase.from("profil").select("*").eq("id", user.id).single();
    const num = `${p?.prefixe_facture ?? "FAC"}-${new Date().getFullYear()}-${String((p?.compteur_facture ?? 0) + 1).padStart(3, "0")}`;
    const ech = new Date(); ech.setDate(ech.getDate() + 30);
    const { data: f } = await supabase.from("factures").insert({
      user_id: user.id, devis_id: devis.id, client_id: devis.client_id,
      apporteur_id: (devis as any).apporteur_id ?? null,
      numero: num, objet: devis.objet, statut: "a_envoyer",
      total_service: devis.total_service, total_materiau: devis.total_materiau, total_ttc: devis.total_ttc,
      remise_fidelite_pct: devis.remise_fidelite_pct ?? null,
      date_echeance: ech.toISOString().split("T")[0],
    }).select().single();
    if (f && devis.lignes) {
      await supabase.from("facture_lignes").insert(devis.lignes.map((l: any, i: number) => ({
        facture_id: f.id,
        nom: l.nom,
        kit_description: l.kit_description ?? null,
        quantite: l.quantite,
        prix_unitaire: l.prix_unitaire,
        unite: l.unite,
        type_branche: l.type_branche,
        ordre: i,
      })));
      await supabase.from("profil").update({ compteur_facture: (p?.compteur_facture ?? 0) + 1 }).eq("id", user.id);
      await supabase.from("devis").update({ statut: "signe" }).eq("id", devis.id);
      try {
        const { genPDFDevisBlob } = await import("@/lib/pdf");
        const profilFallback = p ?? { id: user.id, prefixe_devis: "DEV", prefixe_facture: "FAC", compteur_devis: 0, compteur_facture: 0, mention_tva: "TVA non applicable — Art. 293 B du CGI", conditions_paiement: "Paiement à réception", taux_horaire: 55, created_at: "", updated_at: "" };
        const blob = await genPDFDevisBlob(devis, profilFallback);
        const fileName = `devis/${devis.numero}.pdf`;
        await supabase.storage.from("documents").upload(fileName, blob, { contentType: "application/pdf", upsert: true });
        const { data: urlData } = supabase.storage.from("documents").getPublicUrl(fileName);
        const pdfUrl = urlData.publicUrl;
        const clientObj = devis.client as any;
        const email = clientObj?.email ?? "";
        const prenom = clientObj?.prenom ?? "";
        const sujet = encodeURIComponent(`Votre devis signé ${devis.numero}`);
        const corps = encodeURIComponent(`Bonjour ${prenom},\n\nVeuillez trouver ci-dessous le lien vers votre devis signé ${devis.numero} d'un montant de ${devis.total_ttc.toFixed(2).replace(".", ",")} €.\n\n👉 Télécharger le devis : ${pdfUrl}\n\nCordialement`);
        window.open(`mailto:${email}?subject=${sujet}&body=${corps}`);
        window.location.href = `/factures/${f.id}`;
      } catch {
        window.location.href = `/factures/${f.id}`;
      }
    }
  }

  function planifierIntervention() {
    if (!devis) return;
    const params = new URLSearchParams({
      devis_id: devis.id,
      client_id: devis.client_id ?? "",
      titre: devis.objet ?? devis.numero,
      adresse: [(devis.client as any)?.adresse, (devis.client as any)?.code_postal, (devis.client as any)?.ville].filter(Boolean).join(" "),
    });
    router.push(`/planning?planifier=1&${params.toString()}`);
  }

  if (!devis) return <Shell><div className="p-8 text-center text-ink-400">Chargement…</div></Shell>;

  const viewLignes = (devis.lignes ?? []) as any[];
  const viewTotSBrut = viewLignes.filter((l: any) => l.type_branche === "service").reduce((a: number, l: any) => a + l.prix_unitaire * l.quantite, 0);
  const viewTotMBrut = viewLignes.filter((l: any) => l.type_branche === "materiau").reduce((a: number, l: any) => a + l.prix_unitaire * l.quantite, 0);
  const viewRemiseS = (devis as any).remise_valeur > 0.01 ? Math.max(0, Math.round((viewTotSBrut - devis.total_service - (devis.remise_fidelite_pct ? viewTotSBrut * devis.remise_fidelite_pct / 100 : 0)) * 100) / 100) : 0;
  const viewRemiseM = (devis as any).remise_valeur > 0.01 ? Math.max(0, Math.round((viewTotMBrut - devis.total_materiau) * 100) / 100) : 0;
  const viewRemiseFideliteEur = devis.remise_fidelite_pct
    ? Math.round((viewTotSBrut - Math.max(0, viewRemiseS)) * devis.remise_fidelite_pct / 100 * 100) / 100 : 0;
  const viewHasRemise = viewRemiseS > 0.01 || viewRemiseM > 0.01;
  const client = devis.client as any;
  const peutModifier = devis.statut !== "signe";
  const apporteurActuel = apporteurs.find(a => a.id === (devis as any).apporteur_id);

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "edition", label: "Composition", icon: Plus },
    { id: "apercu", label: "Aperçu", icon: Eye },
    { id: "signature", label: "Signature", icon: PenLine },
  ];

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-3xl mx-auto">

        {confirmDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
              <h3 className="font-semibold text-ink-900 text-lg mb-2">Supprimer ce devis ?</h3>
              <p className="text-sm text-ink-500 mb-5">Cette action est irréversible. Le devis <strong>{devis.numero}</strong> sera définitivement supprimé.</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDelete(false)} className="btn-ghost flex-1 justify-center">Annuler</button>
                <button onClick={deleteDevis} className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl px-4 py-2.5 text-sm transition-colors">
                  <Trash2 size={14} /> Supprimer
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 mb-6">
          <Link href="/devis" className="btn-ghost !px-2.5 !py-2"><ArrowLeft size={16} /></Link>
          <h1 className="font-display text-2xl flex-1">{devis.numero}</h1>
          <span className={cn("badge", STATUT_COLORS[devis.statut])}>{STATUT_LABELS[devis.statut]}</span>
          <button onClick={() => setConfirmDelete(true)} className="btn-ghost !px-2.5 !py-2 text-red-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={16} /></button>
          {peutModifier && mode === "view" && (
            <button onClick={() => setMode("edit")} className="btn-ghost !px-2.5 !py-2"><Pencil size={16} /></button>
          )}
        </div>

        {mode === "view" && (
          <>
            <div className="card card-inner mb-4 flex flex-wrap gap-4 text-sm">
              {client && <div><p className="label">Client</p><p className="font-semibold">{client.prenom ? `${client.prenom} ${client.nom}` : client.nom}</p></div>}
              {devis.objet && <div><p className="label">Objet</p><p>{devis.objet}</p></div>}
              <div><p className="label">Date</p><p>{fmtDate(devis.date_emission)}</p></div>
              {devis.date_validite && <div><p className="label">Validité</p><p>{fmtDate(devis.date_validite)}</p></div>}
              {apporteurActuel && (
                <div><p className="label">Apporteur <span className="text-ink-300">(interne)</span></p><p className="text-ink-600">{apporteurActuel.nom}</p></div>
              )}
            </div>

            <div className="card card-inner mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-xs text-ink-400">
                    <th className="text-left pb-2">Désignation</th>
                    <th className="text-left pb-2 hidden md:table-cell">Type</th>
                    <th className="text-right pb-2">Qté</th>
                    <th className="text-right pb-2">P.U.</th>
                    <th className="text-right pb-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {viewLignes.map((l: any, i: number) => (
                    <tr key={i} className="border-b border-ink-50">
                      <td className="py-2.5 pr-2">
                        <span className={cn("badge text-xs mr-1.5", l.type_branche === "service" ? "bg-volt-100 text-volt-700" : "bg-emerald-100 text-emerald-700")}>
                          {l.type_branche === "service" ? "S" : "M"}
                        </span>
                        <span className="font-medium">{l.nom}</span>
                        {l.kit_description && (
                          <p className="text-xs text-ink-400 italic mt-0.5 ml-6">{l.kit_description}</p>
                        )}
                      </td>
                      <td className="py-2.5 hidden md:table-cell text-ink-500 text-xs">{l.type_branche === "service" ? "Service" : "Matériau"}</td>
                      <td className="py-2.5 text-right">{l.quantite}</td>
                      <td className="py-2.5 text-right text-ink-500">{fmt(l.prix_unitaire)}</td>
                      <td className="py-2.5 text-right font-semibold">{fmt(l.prix_unitaire * l.quantite)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-end mt-4">
                <div className="w-56 space-y-1 text-sm">
                  <div className="flex justify-between text-ink-500"><span>Service</span><span>{fmt(devis.total_service + viewRemiseS)}</span></div>
                  {viewRemiseS > 0.01 && <div className="flex justify-between text-red-500"><span>Remise service</span><span>− {fmt(viewRemiseS)}</span></div>}
                  <div className="flex justify-between text-ink-500"><span>Matériaux</span><span>{fmt(devis.total_materiau + viewRemiseM)}</span></div>
                  {viewRemiseM > 0.01 && <div className="flex justify-between text-red-500"><span>Remise matériaux</span><span>− {fmt(viewRemiseM)}</span></div>}
                  {viewRemiseFideliteEur > 0.01 && (
                    <div className="flex justify-between text-emerald-600 font-medium">
                      <span>🎁 Fidélité ({devis.remise_fidelite_pct}%)</span><span>− {fmt(viewRemiseFideliteEur)}</span>
                    </div>
                  )}
                  {(viewHasRemise || viewRemiseFideliteEur > 0.01) && (
                    <div className="flex justify-between text-red-600 font-medium text-xs pt-1">
                      <span>Total remises</span><span>− {fmt(viewRemiseS + viewRemiseM + viewRemiseFideliteEur)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-volt-600 text-base pt-2 border-t border-ink-200"><span>Total</span><span>{fmt(devis.total_ttc)}</span></div>
                </div>
              </div>
            </div>

            {devis.signature_data && (
              <div className="card card-inner mb-4">
                <p className="label mb-2">Signature client</p>
                <img src={devis.signature_data} alt="Signature" className="h-20 border border-ink-100 rounded-xl p-2" />
                {devis.signe_le && <p className="text-xs text-ink-400 mt-1">Signé le {fmtDatetime(devis.signe_le)}</p>}
              </div>
            )}

            {factureAssociee && (
              <div className="card card-inner mb-4 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                  <Receipt size={16} className="text-emerald-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-ink-400">Facture générée</p>
                  <p className="font-semibold text-ink-900 text-sm">{factureAssociee.numero}</p>
                </div>
                <Link href={`/factures/${factureAssociee.id}`} className="btn-ghost !px-3 text-xs shrink-0">Voir →</Link>
              </div>
            )}

            {devis.statut !== "signe" && (
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-4 py-3 text-sm mb-3">
                <PenLine size={16} className="shrink-0" />
                <p>Ce devis doit être signé avant de pouvoir être converti en facture.</p>
              </div>
            )}

            {devis.statut !== "signe" && (
              <div className="card card-inner mb-4 space-y-4">
                <div className="flex gap-1 bg-ink-100 p-1 rounded-xl">
                  <button onClick={() => setViewSigMode("direct")}
                    className={cn("flex items-center gap-1.5 flex-1 justify-center px-3 py-2 rounded-lg text-sm font-medium transition-all",
                      viewSigMode === "direct" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700")}>
                    <PenLine size={14} /> Signer en face à face
                  </button>
                  <button onClick={() => setViewSigMode("sms")}
                    className={cn("flex items-center gap-1.5 flex-1 justify-center px-3 py-2 rounded-lg text-sm font-medium transition-all",
                      viewSigMode === "sms" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700")}>
                    <MessageSquare size={14} /> Signature à distance
                  </button>
                </div>

                {viewSigMode === "direct" && (
                  <div className="space-y-3">
                    {viewSigData ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 text-emerald-600">
                          <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0"><Check size={16} /></div>
                          <div><p className="font-semibold text-sm">Signature capturée</p><p className="text-xs text-emerald-500">{viewSigDate}</p></div>
                        </div>
                        <img src={viewSigData} alt="Signature" className="h-16 border border-ink-100 rounded-xl p-2 bg-white" />
                        <div className="flex gap-2">
                          <button onClick={() => { setViewSigData(null); setViewSigDate(null); }} className="btn-ghost flex-1 justify-center text-sm"><RotateCcw size={13} /> Recommencer</button>
                          <button onClick={validerSignatureDirecte} className="btn-volt flex-1 justify-center text-sm"><Check size={13} /> Confirmer & signer</button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex gap-1 bg-ink-100 p-1 rounded-xl">
                          <button onClick={() => setViewSigInputMode("draw")}
                            className={cn("flex items-center gap-1.5 flex-1 justify-center px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                              viewSigInputMode === "draw" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500")}>
                            <PenLine size={12} /> Dessiner
                          </button>
                          <button onClick={() => setViewSigInputMode("upload")}
                            className={cn("flex items-center gap-1.5 flex-1 justify-center px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                              viewSigInputMode === "upload" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500")}>
                            <Upload size={12} /> Importer
                          </button>
                        </div>
                        {viewSigInputMode === "draw" && (
                          <>
                            <canvas ref={viewCanvasRef}
                              className="w-full border-2 border-dashed border-ink-200 rounded-2xl bg-white cursor-crosshair touch-none"
                              style={{ height: "160px" }}
                              onMouseDown={startViewDraw} onMouseMove={moveViewDraw} onMouseUp={stopViewDraw} onMouseLeave={stopViewDraw}
                              onTouchStart={startViewDraw} onTouchMove={moveViewDraw} onTouchEnd={stopViewDraw} />
                            <div className="flex gap-2">
                              <button onClick={clearViewSig} className="btn-ghost flex-1 justify-center text-sm"><RotateCcw size={13} /> Effacer</button>
                              <button onClick={validerViewCanvas} className="btn-volt flex-1 justify-center text-sm"><Check size={13} /> Valider</button>
                            </div>
                          </>
                        )}
                        {viewSigInputMode === "upload" && (
                          <>
                            <input ref={viewFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleViewUploadSig} />
                            <button onClick={() => viewFileInputRef.current?.click()}
                              className="w-full flex flex-col items-center justify-center gap-2 border-2 border-dashed border-ink-200 rounded-2xl bg-white py-8 hover:border-volt-400 hover:bg-volt-50 transition-all">
                              <Upload size={20} className="text-ink-300" />
                              <span className="text-sm text-ink-500">Cliquez pour choisir une image</span>
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {viewSigMode === "sms" && (
                  <div className="space-y-3">
                    <p className="text-xs text-ink-400">Envoyez un lien sécurisé au client pour qu'il signe depuis son téléphone.</p>
                    <div className="flex gap-2">
                      <button onClick={envoyerParSMS} disabled={generatingLink}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-ink-900 text-volt-400 text-sm font-semibold hover:bg-ink-800 disabled:opacity-40">
                        <MessageSquare size={15} />
                        {generatingLink ? "Génération…" : "Envoyer par SMS"}
                      </button>
                      {sigLink && (
                        <button onClick={copyLink} className="px-3 py-2.5 rounded-xl border border-ink-200 text-ink-600 hover:bg-ink-50 flex items-center gap-1.5 text-sm">
                          <Copy size={14} />{linkCopied ? "Copié !" : "Copier"}
                        </button>
                      )}
                    </div>
                    {sigLink && <p className="text-xs text-ink-400 font-mono break-all bg-ink-50 rounded-lg px-3 py-2">{sigLink}</p>}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button onClick={dl} className="btn-ghost flex-1 justify-center"><Download size={15} /> Télécharger PDF</button>
              <button onClick={planifierIntervention} className="btn-ghost flex-1 justify-center"><CalendarDays size={15} /> Planifier</button>
              {devis.statut !== "signe" && (
                <button className="flex-1 flex items-center justify-center gap-2 bg-ink-200 text-ink-400 font-semibold rounded-xl px-4 py-2.5 text-sm cursor-not-allowed">
                  <Receipt size={15} /> Convertir en facture
                </button>
              )}
              {devis.statut === "signe" && (
                <button onClick={convertirFacture} className="btn-volt flex-1 justify-center"><CheckCircle size={15} /> Créer la facture</button>
              )}
            </div>
          </>
        )}

        {mode === "edit" && (
          <>
            <div className="flex gap-1 mb-6 bg-ink-100 p-1 rounded-xl">
              {TABS.map(({ id: tid, label, icon: Icon }) => (
                <button key={tid} onClick={() => setTab(tid)}
                  className={cn("flex items-center gap-1.5 flex-1 justify-center px-3 py-2 rounded-lg text-sm font-medium transition-all",
                    tab === tid ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700")}>
                  <Icon size={14} />{label}
                  {tid === "signature" && sigData && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
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
                      </div>
                      {apporteurs.length > 0 && (
                        <div>
                          <label className="label">Apporteur d'affaires <span className="text-ink-300 font-normal">(usage interne)</span></label>
                          <select className="input" value={apporteurId} onChange={e => setApporteurId(e.target.value)}>
                            <option value="">— Aucun apporteur —</option>
                            {apporteurs.map(a => <option key={a.id} value={a.id}>{a.nom}{a.entreprise ? ` — ${a.entreprise}` : ""}</option>)}
                          </select>
                        </div>
                      )}
                      {palierActuelClient && lignes.length > 0 && totServiceApresRemise > 0 && (
                        <div className={cn("rounded-xl border px-3 py-2.5 text-sm transition-all",
                          remiseFidelitePct > 0 ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300")}>
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
                          {remiseFidelitePct > 0 && <p className="text-xs text-emerald-600 mt-1 pl-5">− {fmt(remiseFideliteEur)} appliqué sur la branche service</p>}
                        </div>
                      )}
                      <div>
                        <label className="label">Objet</label>
                        <input className="input" value={objet} onChange={e => setObjet(e.target.value)} placeholder="Ex : Pose borne IRVE" />
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
                      <p className="text-ink-400 text-sm text-center py-4">Catalogue vide.</p>
                    ) : (
                      <>
                        <div className="flex gap-1.5 flex-wrap mb-3">
                          {["Tous", ...categories].map(cat => (
                            <button key={cat} onClick={() => setActiveCat(cat)}
                              className={cn("px-2.5 py-1 rounded-lg text-xs font-medium border transition-all",
                                activeCat === cat ? "bg-ink-900 text-volt-400 border-ink-900" : "bg-white border-ink-200 text-ink-500 hover:bg-ink-50")}>
                              {cat}
                            </button>
                          ))}
                        </div>
                        <div className="space-y-1 max-h-56 overflow-y-auto">
                          {filteredPrests.map(p => (
                            <button key={p.id} onClick={() => addPrestation(p)}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-ink-100 hover:border-volt-400 hover:bg-volt-50 bg-white transition-all text-left">
                              <span className={cn("badge text-xs shrink-0", p.type_branche === "service" ? "bg-volt-100 text-volt-700" : "bg-emerald-100 text-emerald-700")}>
                                {p.type_branche === "service" ? "S" : "M"}
                              </span>
                              <span className="flex-1 text-sm text-ink-800 truncate">{p.nom}</span>
                              <span className="text-sm font-semibold text-ink-900 shrink-0">{fmt(p.prix_unitaire)}</span>
                              <Plus size={14} className="text-ink-300 shrink-0" />
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    <button onClick={() => setShowLibre(!showLibre)} className="mt-3 w-full flex items-center gap-2 text-xs text-ink-500 hover:text-ink-700 py-1.5">
                      <Plus size={13} /> Ligne personnalisée
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
                    <h2 className="font-semibold text-ink-800 mb-3 text-sm uppercase tracking-wide">Lignes</h2>
                    {lignes.length === 0 ? (
                      <p className="text-sm text-ink-400 text-center py-8">Ajoutez des prestations</p>
                    ) : (
                      <div className="space-y-2">
                        {lignes.map((l, i) => (
                          <div key={i} className="flex items-center gap-2 p-2.5 rounded-xl bg-ink-50 border border-ink-100">
                            <span className={cn("badge text-xs shrink-0", l.type_branche === "service" ? "bg-volt-100 text-volt-700" : "bg-emerald-100 text-emerald-700")}>
                              {l.type_branche === "service" ? "S" : "M"}
                            </span>
                            <span className="text-xs text-ink-800 flex-1 min-w-0 truncate">{l.nom}</span>
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
                        ))}
                      </div>
                    )}
                    {lignes.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-ink-100 space-y-2">
                        <div className="flex justify-between text-xs text-ink-500"><span>Service</span><span>{fmt(totServiceBrut)}</span></div>
                        <div className="flex justify-between text-xs text-ink-500"><span>Matériaux</span><span>{fmt(totMateriauBrut)}</span></div>
                        <button onClick={() => setShowRemise(!showRemise)} className="w-full flex items-center gap-2 text-xs text-ink-500 hover:text-ink-700 py-1">
                          <Tag size={12} /><span>Remise</span>
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
                            <span>🎁 Fidélité ({remiseFidelitePct}% service)</span><span>− {fmt(remiseFideliteEur)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-bold text-volt-600 pt-2 border-t border-ink-200"><span>Total</span><span>{fmt(totTTC)}</span></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === "apercu" && (
              <ApercuDocument
                devis={devis} lignes={lignes} profil={profil} sigData={sigData} sigDate={sigDate}
                totServiceBrut={totServiceBrut} totMateriauBrut={totMateriauBrut}
                remiseService={remiseService} remiseMateriau={remiseMateriau}
                remiseFideliteEur={remiseFideliteEur} remiseFidelitePct={remiseFidelitePct} totTTC={totTTC}
              />
            )}

            {tab === "signature" && (
              <div className="max-w-xl mx-auto space-y-4">
                {sigData ? (
                  <div className="card card-inner">
                    <div className="flex items-center gap-3 mb-4 text-emerald-600">
                      <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center"><Check size={20} /></div>
                      <div><p className="font-semibold">Signé</p><p className="text-xs text-emerald-500">{sigDate}</p></div>
                    </div>
                    <img src={sigData} alt="Signature" className="max-h-24 border border-ink-100 rounded-xl p-3" />
                    <button onClick={() => { setSigData(null); setSigDate(null); }} className="btn-ghost mt-3 w-full justify-center text-sm">
                      <RotateCcw size={14} /> Signer à nouveau
                    </button>
                  </div>
                ) : (
                  <div className="card card-inner">
                    <p className="font-semibold text-ink-800 mb-3">Signature du client</p>
                    <div className="flex gap-1 mb-4 bg-ink-100 p-1 rounded-xl">
                      <button onClick={() => setSigMode("draw")} className={cn("flex items-center gap-1.5 flex-1 justify-center px-3 py-2 rounded-lg text-sm font-medium transition-all", sigMode === "draw" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700")}>
                        <PenLine size={14} /> Signer en direct
                      </button>
                      <button onClick={() => setSigMode("upload")} className={cn("flex items-center gap-1.5 flex-1 justify-center px-3 py-2 rounded-lg text-sm font-medium transition-all", sigMode === "upload" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700")}>
                        <Upload size={14} /> Importer une image
                      </button>
                    </div>
                    {sigMode === "draw" && (
                      <>
                        <p className="text-sm text-ink-500 mb-3">Signez dans la zone ci-dessous.</p>
                        <canvas ref={canvasRef} className="w-full border-2 border-dashed border-ink-200 rounded-2xl bg-white cursor-crosshair touch-none" style={{ height: "200px" }}
                          onMouseDown={startDraw} onMouseMove={moveDraw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                          onTouchStart={startDraw} onTouchMove={moveDraw} onTouchEnd={stopDraw} />
                        <div className="flex gap-3 mt-4">
                          <button onClick={clearSig} className="btn-ghost flex-1 justify-center"><RotateCcw size={14} /> Effacer</button>
                          <button onClick={validerSig} className="btn-volt flex-1 justify-center"><Check size={14} /> Valider</button>
                        </div>
                      </>
                    )}
                    {sigMode === "upload" && (
                      <>
                        <p className="text-sm text-ink-500 mb-3">Importez une photo ou image de la signature du client.</p>
                        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUploadSig} />
                        <button onClick={() => fileInputRef.current?.click()} className="w-full flex flex-col items-center justify-center gap-3 border-2 border-dashed border-ink-200 rounded-2xl bg-white py-10 hover:border-volt-400 hover:bg-volt-50 transition-all">
                          <Upload size={24} className="text-ink-300" />
                          <span className="text-sm text-ink-500">Cliquez pour choisir une image</span>
                          <span className="text-xs text-ink-300">JPG, PNG, WEBP…</span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button onClick={() => { setMode("view"); setLignes((devis.lignes ?? []) as any); }} className="btn-ghost flex-1 justify-center">Annuler</button>
              <button onClick={saveEdit} disabled={saving} className="btn-volt flex-1 justify-center">
                <Save size={15} /> {saving ? "Enregistrement…" : "Sauvegarder"}
              </button>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
