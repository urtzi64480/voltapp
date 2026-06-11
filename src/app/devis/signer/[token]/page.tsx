"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Check, RotateCcw, PenLine } from "lucide-react";

function fmt(n: number) { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n); }

export default function SignerPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [devis, setDevis] = useState<any>(null);
  const [profil, setProfil] = useState<any>(null);
  const [error, setError] = useState("");
  const [signed, setSigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const sigCtx = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    async function load() {
      const { data, error: err } = await supabase
        .from("devis")
        .select("*, client:clients(*), lignes:devis_lignes(*)")
        .eq("signature_token", token)
        .single();

      if (err || !data) { setError("Lien invalide ou expiré."); return; }
      if (data.signature_token_expires_at && new Date(data.signature_token_expires_at) < new Date()) {
        setError("Ce lien a expiré."); return;
      }
      if (data.statut === "signe") { setSigned(true); setDevis(data); return; }

      setDevis(data);

      // Charge le profil via user_id du devis
      const { data: p } = await supabase.from("profil").select("*").eq("id", data.user_id).single();
      setProfil(p);
    }
    load();
  }, [token]);

  useEffect(() => {
    if (!devis || signed || !canvasRef.current) return;
    const c = canvasRef.current;
    c.width = c.offsetWidth * window.devicePixelRatio;
    c.height = c.offsetHeight * window.devicePixelRatio;
    const ctx = c.getContext("2d")!;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.strokeStyle = "#1C1917"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    sigCtx.current = ctx;
  }, [devis, signed]);

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
  }

  async function valider() {
    const c = canvasRef.current!;
    const px = sigCtx.current!.getImageData(0, 0, c.width, c.height).data;
    if (!px.some(v => v !== 0)) { alert("Veuillez signer avant de valider."); return; }
    setSaving(true);
    const sigData = c.toDataURL("image/png");
    await supabase.from("devis").update({
      signature_data: sigData,
      signe_le: new Date().toISOString(),
      statut: "signe",
      signature_token: null,
      signature_token_expires_at: null,
    }).eq("signature_token", token);
    setSigned(true);
    setSaving(false);
  }

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-lg">
        <p className="text-4xl mb-4">⛔</p>
        <p className="font-semibold text-gray-800 mb-2">Lien invalide</p>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    </div>
  );

  if (!devis) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400">Chargement…</p>
    </div>
  );

  if (signed) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-lg">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
          <Check size={32} className="text-emerald-600" />
        </div>
        <p className="font-semibold text-gray-800 text-lg mb-2">Devis signé !</p>
        <p className="text-sm text-gray-500">Le devis <strong>{devis.numero}</strong> a bien été signé. Vous pouvez fermer cette page.</p>
      </div>
    </div>
  );

  const lignes = devis.lignes ?? [];
  const client = devis.client;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto p-4 pb-24">
        {/* En-tête entreprise */}
        <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm">
          <p className="font-bold text-gray-900 text-lg">{profil?.nom_entreprise ?? "Votre électricien"}</p>
          {profil?.siret && <p className="text-xs text-gray-400 mt-0.5">SIRET : {profil.siret}</p>}
          {profil?.telephone && <p className="text-xs text-gray-500 mt-1">{profil.telephone}</p>}
        </div>

        {/* Devis */}
        <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="font-bold text-gray-900">{devis.numero}</p>
              {devis.objet && <p className="text-sm text-gray-500 mt-0.5">{devis.objet}</p>}
            </div>
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">À signer</span>
          </div>
          {client && (
            <p className="text-sm text-gray-600 mb-3">Client : <span className="font-medium">{client.prenom} {client.nom}</span></p>
          )}

          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400">
                <th className="text-left pb-2">Désignation</th>
                <th className="text-right pb-2">Qté</th>
                <th className="text-right pb-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l: any, i: number) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 text-gray-700">{l.nom}</td>
                  <td className="py-2 text-right text-gray-500">{l.quantite}</td>
                  <td className="py-2 text-right font-medium">{fmt(l.prix_unitaire * l.quantite)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-between font-bold text-lg border-t border-gray-100 pt-3">
            <span>Total TTC</span>
            <span className="text-amber-600">{fmt(devis.total_ttc)}</span>
          </div>

          {profil?.mention_tva && (
            <p className="text-xs text-gray-400 mt-2">{profil.mention_tva}</p>
          )}
          {profil?.conditions_paiement && (
            <p className="text-xs text-gray-400">{profil.conditions_paiement}</p>
          )}
        </div>

        {/* Zone de signature */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <PenLine size={16} className="text-gray-500" />
            <p className="font-semibold text-gray-800">Signez pour accepter le devis</p>
          </div>
          <p className="text-xs text-gray-400 mb-3">En signant, vous acceptez les conditions ci-dessus.</p>
          <canvas ref={canvasRef}
            className="w-full border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50 cursor-crosshair touch-none"
            style={{ height: "180px" }}
            onMouseDown={startDraw} onMouseMove={moveDraw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
            onTouchStart={startDraw} onTouchMove={moveDraw} onTouchEnd={stopDraw} />
          <div className="flex gap-3 mt-4">
            <button onClick={clearSig} className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-2">
              <RotateCcw size={14} /> Effacer
            </button>
            <button onClick={valider} disabled={saving}
              className="flex-1 py-3 rounded-xl bg-gray-900 text-amber-400 text-sm font-bold hover:bg-gray-800 disabled:opacity-40 flex items-center justify-center gap-2">
              <Check size={14} /> {saving ? "Enregistrement…" : "Valider et signer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
