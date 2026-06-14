"use client";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Prestation } from "@/types";
import { fmt, UNITES, cn } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import {
  Plus, Trash2, Save, Pencil, X, ChevronDown, ChevronUp,
  Link, Wrench, Package, Search, Download, Upload, AlertCircle,
  CheckCircle2, TrendingUp, Gift
} from "lucide-react";

// ─── Types internes ──────────────────────────────────────────────────────────

type PrestationExt = Prestation & { prix_achat?: number | null };

// ─── Helpers ────────────────────────────────────────────────────────────────

function getFavicon(url: string) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`; }
  catch { return null; }
}

function getLinkLabel(url: string) {
  try { return new URL(url).hostname.replace("www.", ""); }
  catch { return url; }
}

function calcMarge(prixAchat: number, prixVente: number): number | null {
  if (!prixAchat || prixAchat <= 0) return null;
  return Math.round(((prixVente - prixAchat) / prixAchat) * 1000) / 10;
}

function prixVenteFromMarge(prixAchat: number, margePct: number): number {
  return Math.round(prixAchat * (1 + margePct / 100) * 100) / 100;
}

function matchSearch(p: PrestationExt, q: string): boolean {
  if (!q.trim()) return true;
  const lower = q.toLowerCase();
  return [p.nom, p.description, p.marque, p.sous_categorie, p.categorie]
    .some(v => v?.toLowerCase().includes(lower));
}

// ─── Sous-composants ────────────────────────────────────────────────────────

function FournisseurLogo({ url }: { url: string }) {
  const favicon = getFavicon(url);
  const label = getLinkLabel(url);
  if (!favicon) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      onClick={e => e.stopPropagation()} title={`Vérifier le prix sur ${label}`}
      className="flex items-center justify-center w-8 h-8 rounded-lg border border-ink-100 bg-white hover:border-volt-400 hover:shadow-sm transition-all overflow-hidden shrink-0">
      <img src={favicon} alt={label} className="w-5 h-5 object-contain" />
    </a>
  );
}

function ProduitThumb({ imageUrl }: { imageUrl: string | null }) {
  if (!imageUrl) return (
    <div className="w-10 h-10 rounded-lg bg-ink-50 border border-ink-100 flex items-center justify-center shrink-0">
      <Package size={14} className="text-ink-300" />
    </div>
  );
  return (
    <div className="w-10 h-10 rounded-lg border border-ink-100 overflow-hidden shrink-0 bg-white">
      <img src={imageUrl} alt="" className="w-full h-full object-contain p-0.5"
        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
    </div>
  );
}

function MargeTag({ prixAchat, prixVente }: { prixAchat?: number | null; prixVente: number }) {
  if (!prixAchat || prixAchat <= 0) return null;
  const marge = calcMarge(prixAchat, prixVente);
  if (marge === null) return null;
  if (marge === 0) return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600 font-medium">
      <Gift size={10} /> Cadeau
    </span>
  );
  const color = marge < 0 ? "text-red-600 bg-red-50" : "text-emerald-700 bg-emerald-50";
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium", color)}>
      <TrendingUp size={10} /> {marge > 0 ? "+" : ""}{marge}%
    </span>
  );
}

function MargeFields({
  prixAchat, prixVente,
  onPrixAchatChange, onPrixVenteChange,
}: {
  prixAchat: string; prixVente: string;
  onPrixAchatChange: (v: string) => void;
  onPrixVenteChange: (v: string) => void;
}) {
  const [margePct, setMargePct] = useState("");

  function handlePrixAchat(v: string) {
    onPrixAchatChange(v);
    if (margePct !== "" && parseFloat(v) > 0) {
      const pv = prixVenteFromMarge(parseFloat(v), parseFloat(margePct) || 0);
      onPrixVenteChange(String(pv));
    }
  }

  function handleMarge(v: string) {
    setMargePct(v);
    if (parseFloat(prixAchat) > 0) {
      const pv = prixVenteFromMarge(parseFloat(prixAchat), parseFloat(v) || 0);
      onPrixVenteChange(String(pv));
    }
  }

  function handlePrixVente(v: string) {
    onPrixVenteChange(v);
    if (parseFloat(prixAchat) > 0 && parseFloat(v) >= 0) {
      const m = calcMarge(parseFloat(prixAchat), parseFloat(v));
      setMargePct(m !== null ? String(m) : "");
    }
  }

  const pa = parseFloat(prixAchat);
  const pv = parseFloat(prixVente);
  const margeCalc = pa > 0 && pv >= 0 ? calcMarge(pa, pv) : null;

  return (
    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
      <div>
        <label className="label text-emerald-800">Prix d'achat HT (€)</label>
        <input className="input text-sm text-right" type="number" step="0.01" placeholder="0.00"
          value={prixAchat} onChange={e => handlePrixAchat(e.target.value)} />
      </div>
      <div>
        <label className="label text-emerald-800">Marge (%)</label>
        <input className="input text-sm text-right" type="number" step="0.5" placeholder="Ex : 30"
          value={margePct} onChange={e => handleMarge(e.target.value)} />
        <p className="text-xs text-emerald-600 mt-1">0% = cadeau client</p>
      </div>
      <div>
        <label className="label text-emerald-800">Prix de vente HT (€) *</label>
        <input className="input text-sm text-right font-semibold" type="number" step="0.01" placeholder="0.00"
          value={prixVente} onChange={e => handlePrixVente(e.target.value)} />
        {margeCalc !== null && (
          <p className={cn("text-xs mt-1 font-medium",
            margeCalc === 0 ? "text-blue-600" : margeCalc < 0 ? "text-red-500" : "text-emerald-700")}>
            {margeCalc === 0 ? "Offert au client" : `Marge : ${margeCalc > 0 ? "+" : ""}${margeCalc}% · Gain : ${fmt(pv - pa)}`}
          </p>
        )}
      </div>
    </div>
  );
}

function LiensFournisseurs({ liens, setLiens }: { liens: string[]; setLiens: (l: string[]) => void }) {
  const [newLien, setNewLien] = useState("");
  function addLien() {
    if (!newLien.trim()) return;
    let url = newLien.trim();
    if (!url.startsWith("http")) url = "https://" + url;
    setLiens([...liens, url]);
    setNewLien("");
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {liens.map((url, i) => {
          const favicon = getFavicon(url);
          const label = getLinkLabel(url);
          return (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-ink-50 border border-ink-200 rounded-lg">
              {favicon && <img src={favicon} alt={label} className="w-4 h-4 object-contain" />}
              <span className="text-xs text-ink-600">{label}</span>
              <button onClick={() => setLiens(liens.filter((_, idx) => idx !== i))}
                className="text-ink-300 hover:text-red-500 transition-colors ml-1">
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input className="input text-sm flex-1" placeholder="https://www.leroymerlin.fr/…"
          value={newLien} onChange={e => setNewLien(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addLien()} />
        <button onClick={addLien} className="btn-ghost !px-3 text-xs shrink-0">
          <Plus size={13} /> Ajouter
        </button>
      </div>
    </div>
  );
}

function FormMarque({ value, onChange, marques }: { value: string; onChange: (v: string) => void; marques: string[] }) {
  const [mode, setMode] = useState<"select" | "new">(marques.length === 0 ? "new" : "select");
  return (
    <div>
      {mode === "select" ? (
        <div className="flex gap-2">
          <select className="input flex-1" value={value} onChange={e => onChange(e.target.value)}>
            <option value="">— Choisir —</option>
            {marques.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={() => { setMode("new"); onChange(""); }} className="btn-ghost !px-3 text-xs shrink-0">Nouvelle</button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Ex : Schneider, Legrand…"
            value={value} onChange={e => onChange(e.target.value)} autoFocus />
          {marques.length > 0 && (
            <button onClick={() => setMode("select")} className="btn-ghost !px-3 text-xs shrink-0">Existante</button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  "nom", "description", "type_branche", "categorie", "sous_categorie",
  "marque", "unite", "prix_achat", "prix_unitaire", "image_url", "liens_fournisseurs"
];

function exportCSV(prestations: PrestationExt[]) {
  const rows = [
    CSV_HEADERS.join(";"),
    ...prestations.map(p => [
      p.nom,
      p.description ?? "",
      p.type_branche,
      p.categorie,
      p.sous_categorie ?? "",
      p.marque ?? "",
      p.unite,
      p.prix_achat ?? "",
      p.prix_unitaire,
      p.image_url ?? "",
      (p.liens_fournisseurs ?? []).join("|"),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(";"))
  ];
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `catalogue_voltapp_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

type ImportRow = {
  nom: string; description: string; type_branche: string; categorie: string;
  sous_categorie: string; marque: string; unite: string;
  prix_achat: string; prix_unitaire: string; image_url: string; liens_fournisseurs: string;
  _valid: boolean; _errors: string[];
};

function parseCSV(text: string): ImportRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(";").map(h => h.replace(/^"|"$/g, "").trim());
  return lines.slice(1).map(line => {
    const values: string[] = [];
    let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (ch === ";" && !inQ) { values.push(cur); cur = ""; }
      else cur += ch;
    }
    values.push(cur);

    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (values[i] ?? "").trim(); });

    const errors: string[] = [];
    if (!row.nom?.trim()) errors.push("Nom manquant");
    if (!row.prix_unitaire || isNaN(parseFloat(row.prix_unitaire))) errors.push("Prix de vente invalide");
    if (!["service", "materiau"].includes(row.type_branche)) errors.push("Branche invalide (service/materiau)");

    return {
      nom: row.nom ?? "",
      description: row.description ?? "",
      type_branche: row.type_branche ?? "service",
      categorie: row.categorie || "Divers",
      sous_categorie: row.sous_categorie ?? "",
      marque: row.marque ?? "",
      unite: row.unite || "forfait",
      prix_achat: row.prix_achat ?? "",
      prix_unitaire: row.prix_unitaire ?? "",
      image_url: row.image_url ?? "",
      liens_fournisseurs: row.liens_fournisseurs ?? "",
      _valid: errors.length === 0,
      _errors: errors,
    };
  });
}

// ─── Import Modal ─────────────────────────────────────────────────────────────

function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (rows: ImportRow[]) => Promise<void> }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      setRows(parseCSV(text));
    };
    reader.readAsText(file, "utf-8");
  }

  async function handleImport() {
    if (!rows) return;
    const valid = rows.filter(r => r._valid);
    setImporting(true);
    await onImport(valid);
    setImporting(false);
    setDone(true);
  }

  const validCount = rows?.filter(r => r._valid).length ?? 0;
  const invalidCount = rows?.filter(r => !r._valid).length ?? 0;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-100">
          <h2 className="font-semibold text-ink-900">Importer un catalogue CSV</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-ink-100 text-ink-400"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {!rows && !done && (
            <div className="space-y-4">
              <div className="p-4 bg-ink-50 rounded-xl text-sm text-ink-600 space-y-1">
                <p className="font-medium text-ink-800">Format attendu (CSV séparé par ;)</p>
                <p>Colonnes : <code className="text-xs bg-ink-200 px-1 rounded">{CSV_HEADERS.join(" · ")}</code></p>
                <p>• <code>type_branche</code> : <strong>service</strong> ou <strong>materiau</strong></p>
                <p>• <code>liens_fournisseurs</code> : URLs séparées par <strong>|</strong></p>
                <p>• Exporter d'abord pour obtenir le bon format</p>
              </div>
              <div>
                <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
                <button onClick={() => fileRef.current?.click()} className="btn-volt w-full justify-center">
                  <Upload size={16} /> Choisir un fichier CSV
                </button>
              </div>
            </div>
          )}

          {done && (
            <div className="text-center py-8">
              <CheckCircle2 size={48} className="text-emerald-500 mx-auto mb-3" />
              <p className="font-semibold text-ink-900">{validCount} prestation{validCount > 1 ? "s" : ""} importée{validCount > 1 ? "s" : ""}</p>
              <p className="text-sm text-ink-400 mt-1">Le catalogue a été mis à jour.</p>
            </div>
          )}

          {rows && !done && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1 p-3 bg-emerald-50 rounded-xl text-center">
                  <p className="text-2xl font-bold text-emerald-700">{validCount}</p>
                  <p className="text-xs text-emerald-600">ligne{validCount > 1 ? "s" : ""} valide{validCount > 1 ? "s" : ""}</p>
                </div>
                {invalidCount > 0 && (
                  <div className="flex-1 p-3 bg-red-50 rounded-xl text-center">
                    <p className="text-2xl font-bold text-red-600">{invalidCount}</p>
                    <p className="text-xs text-red-500">ligne{invalidCount > 1 ? "s" : ""} ignorée{invalidCount > 1 ? "s" : ""}</p>
                  </div>
                )}
              </div>

              <div className="border border-ink-100 rounded-xl overflow-hidden">
                <div className="max-h-64 overflow-y-auto divide-y divide-ink-50">
                  {rows.map((row, i) => (
                    <div key={i} className={cn("px-4 py-2 flex items-start gap-3", row._valid ? "bg-white" : "bg-red-50")}>
                      {row._valid
                        ? <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                        : <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink-800 truncate">{row.nom || "(sans nom)"}</p>
                        {row._errors.length > 0 && (
                          <p className="text-xs text-red-500">{row._errors.join(", ")}</p>
                        )}
                        {row._valid && (
                          <p className="text-xs text-ink-400">
                            {row.type_branche} · {row.categorie} · {fmt(parseFloat(row.prix_unitaire))}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {invalidCount > 0 && (
                <p className="text-xs text-ink-400 flex items-center gap-1">
                  <AlertCircle size={12} /> Les lignes invalides seront ignorées.
                </p>
              )}
            </div>
          )}
        </div>

        {rows && !done && (
          <div className="flex gap-3 px-6 py-4 border-t border-ink-100">
            <button onClick={onClose} className="btn-ghost flex-1 justify-center">Annuler</button>
            <button onClick={handleImport} disabled={validCount === 0 || importing}
              className="btn-volt flex-1 justify-center">
              {importing ? "Import en cours…" : `Importer ${validCount} ligne${validCount > 1 ? "s" : ""}`}
            </button>
          </div>
        )}
        {done && (
          <div className="px-6 py-4 border-t border-ink-100">
            <button onClick={onClose} className="btn-volt w-full justify-center">Fermer</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CategorieBlock ───────────────────────────────────────────────────────────

function CategorieBlock({
  cat, items, branche, editId, editData, editNewCat, editCatMode, editLiens,
  editPrixAchat, editPrixVente,
  categories, marques, collapsed, toggleCollapse, delCategorie, startEdit, saveEdit, del,
  setEditId, setEditData, setEditNewCat, setEditCatMode, setEditLiens,
  setEditPrixAchat, setEditPrixVente,
}: any) {
  const isOpen = !collapsed;
  const [collapsedMarques, setCollapsedMarques] = useState<Record<string, boolean>>({});

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-ink-900">
        <button onClick={toggleCollapse} className="flex items-center gap-3 flex-1 text-left">
          <span className="font-semibold text-white text-sm">{cat}</span>
          <span className="text-ink-400 text-xs">{items.length} prestation{items.length > 1 ? "s" : ""}</span>
        </button>
        <div className="flex items-center gap-2">
          {items.length === 0 && (
            <button onClick={() => delCategorie(cat)}
              className="p-1.5 rounded-lg text-ink-400 hover:text-red-400 hover:bg-white/10 transition-colors">
              <Trash2 size={14} />
            </button>
          )}
          {isOpen ? <ChevronUp size={16} className="text-ink-400" /> : <ChevronDown size={16} className="text-ink-400" />}
        </div>
      </div>

      {isOpen && (
        <div className="divide-y divide-ink-100">
          {/* Headers desktop */}
          {branche === "service" && (
            <div className="hidden md:grid grid-cols-[2fr_90px_90px_80px] gap-4 px-5 py-2 text-xs font-semibold text-ink-400 uppercase tracking-wide bg-ink-50">
              <span>Nom</span><span>Unité</span><span className="text-right">Prix</span><span></span>
            </div>
          )}
          {branche === "materiau" && (
            <div className="hidden md:grid grid-cols-[40px_2fr_90px_90px_120px_minmax(80px,auto)_80px] gap-4 px-5 py-2 text-xs font-semibold text-ink-400 uppercase tracking-wide bg-ink-50">
              <span></span><span>Nom</span><span>Unité</span><span className="text-right">Prix vente</span>
              <span className="text-right">Marge</span><span>Liens</span><span></span>
            </div>
          )}

          {items.length === 0 && (
            <div className="px-5 py-4 text-sm text-ink-400 italic">Aucune prestation — catégorie vide.</div>
          )}

          {/* ── Matériaux groupés par marque ── */}
          {branche === "materiau" && (() => {
            const mqs = [...new Set(items.map((p: PrestationExt) => p.marque || "__sans__"))].sort() as string[];
            return mqs.map((mq: string) => {
              const itemsMq = items.filter((p: PrestationExt) => (p.marque || "__sans__") === mq);
              return (
                <div key={mq}>
                  {mq !== "__sans__" && (
                    <button
                      onClick={() => setCollapsedMarques((c: Record<string, boolean>) => ({ ...c, [mq]: !c[mq] }))}
                      className="w-full px-5 py-1.5 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2 hover:bg-emerald-100 transition-colors text-left">
                      <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide flex-1">{mq}</span>
                      <span className="text-xs text-emerald-400">{itemsMq.length} article{itemsMq.length > 1 ? "s" : ""}</span>
                      {collapsedMarques[mq] ? <ChevronDown size={13} className="text-emerald-500" /> : <ChevronUp size={13} className="text-emerald-500" />}
                    </button>
                  )}
                  {(mq === "__sans__" || !collapsedMarques[mq]) && itemsMq.map((p: PrestationExt) => {
                    const liens: string[] = p.liens_fournisseurs ?? [];
                    const marque: string = p.marque ?? "";
                    const sousCat: string = p.sous_categorie ?? "";
                    return (
                      <div key={p.id} className="px-4 py-3">
                        {editId === p.id ? (
                          /* ── Formulaire édition matériau ── */
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="label">Nom</label>
                                <input className="input text-sm" value={(editData as any).nom ?? p.nom}
                                  onChange={e => setEditData((d: any) => ({ ...d, nom: e.target.value }))} />
                              </div>
                              <div>
                                <label className="label">Description</label>
                                <input className="input text-sm" value={(editData as any).description ?? p.description ?? ""}
                                  onChange={e => setEditData((d: any) => ({ ...d, description: e.target.value }))} />
                              </div>
                              <div>
                                <label className="label">Marque</label>
                                <FormMarque
                                  value={(editData as any).marque ?? marque}
                                  onChange={v => setEditData((d: any) => ({ ...d, marque: v }))}
                                  marques={marques}
                                />
                              </div>
                              <div>
                                <label className="label">Branche</label>
                                <select className="input text-sm" value={(editData as any).type_branche ?? p.type_branche}
                                  onChange={e => setEditData((d: any) => ({ ...d, type_branche: e.target.value }))}>
                                  <option value="service">Service</option>
                                  <option value="materiau">Matériau</option>
                                </select>
                              </div>
                              <div>
                                <label className="label">Unité</label>
                                <select className="input text-sm" value={(editData as any).unite ?? p.unite}
                                  onChange={e => setEditData((d: any) => ({ ...d, unite: e.target.value }))}>
                                  {UNITES.map((u: string) => <option key={u}>{u}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="label">Catégorie</label>
                                {editCatMode === "select" ? (
                                  <div className="flex gap-2">
                                    <select className="input text-sm flex-1" value={(editData as any).categorie ?? p.categorie}
                                      onChange={e => setEditData((d: any) => ({ ...d, categorie: e.target.value }))}>
                                      {categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <button onClick={() => setEditCatMode("new")} className="btn-ghost !px-3 text-xs shrink-0">Nouvelle</button>
                                  </div>
                                ) : (
                                  <div className="flex gap-2">
                                    <input className="input text-sm flex-1" placeholder="Nouvelle catégorie"
                                      value={editNewCat} onChange={e => setEditNewCat(e.target.value)} autoFocus />
                                    <button onClick={() => setEditCatMode("select")} className="btn-ghost !px-3 text-xs shrink-0">Existante</button>
                                  </div>
                                )}
                              </div>
                              <div>
                                <label className="label">Sous-catégorie</label>
                                <input className="input text-sm" placeholder="Ex : Prises, Câblage…"
                                  value={(editData as any).sous_categorie ?? sousCat}
                                  onChange={e => setEditData((d: any) => ({ ...d, sous_categorie: e.target.value }))} />
                              </div>
                            </div>

                            {/* Bloc marge édition */}
                            <MargeFields
                              prixAchat={editPrixAchat}
                              prixVente={editPrixVente}
                              onPrixAchatChange={setEditPrixAchat}
                              onPrixVenteChange={v => {
                                setEditPrixVente(v);
                                setEditData((d: any) => ({ ...d, prix_unitaire: parseFloat(v) || 0 }));
                              }}
                            />

                            <div>
                              <label className="label">Liens fournisseurs</label>
                              <LiensFournisseurs liens={editLiens} setLiens={setEditLiens} />
                            </div>
                            <div>
                              <label className="label">Image du produit (URL)</label>
                              <input className="input text-sm" placeholder="https://…/image-produit.jpg"
                                value={(editData as any).image_url ?? p.image_url ?? ""}
                                onChange={e => setEditData((d: any) => ({ ...d, image_url: e.target.value }))} />
                              {((editData as any).image_url ?? p.image_url) && (
                                <img src={(editData as any).image_url ?? p.image_url} alt=""
                                  className="mt-2 h-16 object-contain rounded-lg border border-ink-100 p-1 bg-white" />
                              )}
                            </div>
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => saveEdit(p.id)} className="btn-volt text-xs"><Save size={13} /> Sauvegarder</button>
                              <button onClick={() => setEditId(null)} className="btn-ghost text-xs"><X size={13} /> Annuler</button>
                            </div>
                          </div>
                        ) : (
                          /* ── Ligne lecture matériau ── */
                          <div className={cn("flex items-center gap-3",
                            "md:grid md:grid-cols-[40px_2fr_90px_90px_120px_minmax(80px,auto)_80px]")}>
                            <div className="hidden md:block">
                              <ProduitThumb imageUrl={p.image_url ?? null} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 md:block">
                                <div className="md:hidden shrink-0">
                                  <ProduitThumb imageUrl={p.image_url ?? null} />
                                </div>
                                <div className="min-w-0">
                                  <p className="font-medium text-ink-900 text-sm truncate">{p.nom}</p>
                                  <p className="text-xs text-ink-400 truncate">
                                    {[marque, sousCat, p.description].filter(Boolean).join(" · ")}
                                  </p>
                                </div>
                              </div>
                              {liens.length > 0 && (
                                <div className="flex items-center gap-1.5 flex-wrap mt-1.5 md:hidden">
                                  {liens.map((url: string, i: number) => <FournisseurLogo key={i} url={url} />)}
                                </div>
                              )}
                            </div>
                            <span className="text-xs text-ink-500 hidden md:block">{p.unite}</span>
                            <span className="font-semibold text-ink-900 text-sm ml-auto md:ml-0 md:text-right">{fmt(p.prix_unitaire)}</span>
                            {/* Marge desktop */}
                            <div className="hidden md:flex items-center justify-end">
                              {p.prix_achat != null && p.prix_achat > 0 ? (
                                <div className="text-right">
                                  <MargeTag prixAchat={p.prix_achat} prixVente={p.prix_unitaire} />
                                  <p className="text-xs text-ink-300 mt-0.5">PA {fmt(p.prix_achat)}</p>
                                </div>
                              ) : (
                                <span className="text-ink-200 text-xs">—</span>
                              )}
                            </div>
                            <div className="hidden md:flex items-center gap-1.5 flex-wrap">
                              {liens.length > 0
                                ? liens.map((url: string, i: number) => <FournisseurLogo key={i} url={url} />)
                                : <span className="text-ink-200"><Link size={14} /></span>}
                            </div>
                            <div className="flex gap-1 shrink-0 justify-end">
                              <button onClick={() => startEdit(p)}
                                className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700"><Pencil size={13} /></button>
                              <button onClick={() => del(p.id)}
                                className="p-1.5 rounded-lg text-ink-300 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}

          {/* ── Services ── */}
          {branche === "service" && items.map((p: PrestationExt) => {
            const sousCat: string = p.sous_categorie ?? "";
            return (
              <div key={p.id} className="px-4 py-3">
                {editId === p.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="label">Nom</label>
                        <input className="input text-sm" value={(editData as any).nom ?? p.nom}
                          onChange={e => setEditData((d: any) => ({ ...d, nom: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Description</label>
                        <input className="input text-sm" value={(editData as any).description ?? p.description ?? ""}
                          onChange={e => setEditData((d: any) => ({ ...d, description: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Prix unitaire (€)</label>
                        <input className="input text-sm text-right" type="number" step="0.5"
                          value={(editData as any).prix_unitaire ?? p.prix_unitaire}
                          onChange={e => setEditData((d: any) => ({ ...d, prix_unitaire: parseFloat(e.target.value) }))} />
                      </div>
                      <div>
                        <label className="label">Branche</label>
                        <select className="input text-sm" value={(editData as any).type_branche ?? p.type_branche}
                          onChange={e => setEditData((d: any) => ({ ...d, type_branche: e.target.value }))}>
                          <option value="service">Service</option>
                          <option value="materiau">Matériau</option>
                        </select>
                      </div>
                      <div>
                        <label className="label">Unité</label>
                        <select className="input text-sm" value={(editData as any).unite ?? p.unite}
                          onChange={e => setEditData((d: any) => ({ ...d, unite: e.target.value }))}>
                          {UNITES.map((u: string) => <option key={u}>{u}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">Catégorie</label>
                        {editCatMode === "select" ? (
                          <div className="flex gap-2">
                            <select className="input text-sm flex-1" value={(editData as any).categorie ?? p.categorie}
                              onChange={e => setEditData((d: any) => ({ ...d, categorie: e.target.value }))}>
                              {categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <button onClick={() => setEditCatMode("new")} className="btn-ghost !px-3 text-xs shrink-0">Nouvelle</button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <input className="input text-sm flex-1" placeholder="Nouvelle catégorie"
                              value={editNewCat} onChange={e => setEditNewCat(e.target.value)} autoFocus />
                            <button onClick={() => setEditCatMode("select")} className="btn-ghost !px-3 text-xs shrink-0">Existante</button>
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="label">Sous-catégorie</label>
                        <input className="input text-sm" placeholder="Ex : Prises, Câblage…"
                          value={(editData as any).sous_categorie ?? sousCat}
                          onChange={e => setEditData((d: any) => ({ ...d, sous_categorie: e.target.value }))} />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => saveEdit(p.id)} className="btn-volt text-xs"><Save size={13} /> Sauvegarder</button>
                      <button onClick={() => setEditId(null)} className="btn-ghost text-xs"><X size={13} /> Annuler</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 md:grid md:grid-cols-[2fr_90px_90px_80px]">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink-900 text-sm truncate">{p.nom}</p>
                      <p className="text-xs text-ink-400 truncate">{[sousCat, p.description].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className="text-xs text-ink-500 hidden md:block">{p.unite}</span>
                    <span className="font-semibold text-ink-900 text-sm ml-auto md:ml-0 md:text-right">{fmt(p.prix_unitaire)}</span>
                    <div className="flex gap-1 shrink-0 justify-end">
                      <button onClick={() => startEdit(p)}
                        className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700"><Pencil size={13} /></button>
                      <button onClick={() => del(p.id)}
                        className="p-1.5 rounded-lg text-ink-300 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function CataloguePage() {
  const [prestations, setPrestations] = useState<PrestationExt[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<PrestationExt>>({});
  const [editNewCat, setEditNewCat] = useState("");
  const [editCatMode, setEditCatMode] = useState<"select" | "new">("select");
  const [editLiens, setEditLiens] = useState<string[]>([]);
  const [editPrixAchat, setEditPrixAchat] = useState("");
  const [editPrixVente, setEditPrixVente] = useState("");

  // Form ajout
  const [showForm, setShowForm] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [formLiens, setFormLiens] = useState<string[]>([]);
  const [formPrixAchat, setFormPrixAchat] = useState("");
  const [formPrixVente, setFormPrixVente] = useState("");
  const [form, setForm] = useState({
    nom: "", description: "", unite: "forfait",
    type_branche: "service", categorie: "",
    sous_categorie: "", marque: "", image_url: "",
  });

  // Collapse
  const [collapsedServices, setCollapsedServices] = useState<Record<string, boolean>>({});
  const [collapsedMateriaux, setCollapsedMateriaux] = useState<Record<string, boolean>>({});
  const [marques, setMarques] = useState<string[]>([]);

  // Import
  const [showImport, setShowImport] = useState(false);

  // ── Load ──
  async function load() {
    const { data } = await supabase
      .from("prestations")
      .select("*")
      .eq("actif", true)
      .order("categorie")
      .order("nom");
    const prests: PrestationExt[] = data ?? [];
    setPrestations(prests);
    const cats = [...new Set(prests.map(p => p.categorie))].sort();
    setCategories(cats);
    const initCollapsed = cats.reduce((acc, c) => ({ ...acc, [c]: true }), {} as Record<string, boolean>);
    setCollapsedServices(initCollapsed);
    setCollapsedMateriaux(initCollapsed);
    const mqs = [...new Set(prests.map((p: any) => p.marque).filter(Boolean))].sort() as string[];
    setMarques(mqs);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // ── Add ──
  async function add() {
    const prixVente = parseFloat(formPrixVente);
    if (!form.nom.trim()) {
      alert("Le nom est obligatoire.");
      return;
    }
    if (isNaN(prixVente) || prixVente < 0) {
      alert("Le prix de vente est obligatoire.");
      return;
    }
    const cat = newCat.trim() || form.categorie || "Divers";
    const prixAchatNum = formPrixAchat !== "" ? parseFloat(formPrixAchat) : null;
    const { data, error } = await supabase.from("prestations").insert({
      nom: form.nom,
      description: form.description || null,
      prix_unitaire: prixVente,
      prix_achat: prixAchatNum,
      unite: form.unite,
      type_branche: form.type_branche,
      categorie: cat,
      actif: true,
      sous_categorie: form.sous_categorie || null,
      marque: form.marque || null,
      liens_fournisseurs: formLiens.filter(l => l.trim()),
      image_url: form.image_url || null,
    }).select().single();
    if (error) { alert("Erreur lors de l'enregistrement : " + error.message); return; }
    if (data) {
      setPrestations(p => [...p, data].sort((a, b) => a.categorie.localeCompare(b.categorie) || a.nom.localeCompare(b.nom)));
      if (!categories.includes(cat)) setCategories(c => [...c, cat].sort());
    }
    if (form.marque && !marques.includes(form.marque)) setMarques(m => [...m, form.marque].sort());
    setForm({ nom: "", description: "", unite: "forfait", type_branche: "service", categorie: "", sous_categorie: "", marque: "", image_url: "" });
    setNewCat(""); setFormLiens([]); setFormPrixAchat(""); setFormPrixVente(""); setShowForm(false);
  }

  // ── Delete ──
  async function del(id: string) {
    if (!confirm("Supprimer cette prestation ?")) return;
    await supabase.from("prestations").update({ actif: false }).eq("id", id);
    setPrestations(p => p.filter(x => x.id !== id));
  }

  async function delCategorie(cat: string) {
    if (!confirm(`Supprimer la catégorie "${cat}" ?`)) return;
    setCategories(c => c.filter(x => x !== cat));
  }

  // ── Save edit ──
  async function saveEdit(id: string) {
    const finalCat = (editCatMode === "new" && editNewCat.trim() ? editNewCat.trim() : editData.categorie) ?? "Divers";
    const prixVenteNum = parseFloat(editPrixVente);
    const prixAchatNum = editPrixAchat !== "" ? parseFloat(editPrixAchat) : null;
    const dataToSave = {
      ...editData,
      categorie: finalCat,
      liens_fournisseurs: editLiens.filter(l => l.trim()),
      prix_unitaire: isNaN(prixVenteNum) ? editData.prix_unitaire : prixVenteNum,
      prix_achat: prixAchatNum,
    };
    await supabase.from("prestations").update(dataToSave as any).eq("id", id);
    setPrestations(p => p.map(x => x.id === id ? { ...x, ...dataToSave } as PrestationExt : x));
    if (finalCat && !categories.includes(finalCat)) setCategories(c => [...c, finalCat].sort());
    const savedMarque = (dataToSave as any).marque as string | undefined;
    if (savedMarque && !marques.includes(savedMarque)) setMarques(m => [...m, savedMarque].sort());
    setEditId(null); setEditNewCat(""); setEditCatMode("select"); setEditLiens([]);
    setEditPrixAchat(""); setEditPrixVente("");
  }

  // ── Start edit ──
  function startEdit(p: PrestationExt) {
    setEditId(p.id);
    setEditData({
      nom: p.nom, description: p.description, prix_unitaire: p.prix_unitaire,
      unite: p.unite, type_branche: p.type_branche, categorie: p.categorie,
      sous_categorie: p.sous_categorie ?? undefined,
      marque: p.marque ?? undefined,
      image_url: p.image_url ?? undefined,
    });
    setEditCatMode("select"); setEditNewCat("");
    setEditLiens(p.liens_fournisseurs ?? []);
    setEditPrixAchat(p.prix_achat != null ? String(p.prix_achat) : "");
    setEditPrixVente(String(p.prix_unitaire));
  }

  // ── Import CSV ──
  async function handleImport(rows: ImportRow[]) {
    const toInsert: object[] = [];
    const toUpdate: { id: string; data: object }[] = [];

    for (const r of rows) {
      const payload = {
        nom: r.nom,
        description: r.description || null,
        type_branche: r.type_branche as "service" | "materiau",
        categorie: r.categorie || "Divers",
        sous_categorie: r.sous_categorie || null,
        marque: r.marque || null,
        unite: r.unite || "forfait",
        prix_achat: r.prix_achat !== "" ? parseFloat(r.prix_achat) : null,
        prix_unitaire: parseFloat(r.prix_unitaire),
        image_url: r.image_url || null,
        liens_fournisseurs: r.liens_fournisseurs ? r.liens_fournisseurs.split("|").filter(Boolean) : [],
        actif: true,
      };
      const existing = prestations.find(
        p => p.nom.trim().toLowerCase() === r.nom.trim().toLowerCase()
          && p.type_branche === r.type_branche
      );
      if (existing) {
        toUpdate.push({ id: existing.id, data: payload });
      } else {
        toInsert.push({ ...payload });
      }
    }

    if (toInsert.length > 0) {
      await supabase.from("prestations").insert(toInsert);
    }
    for (const { id, data } of toUpdate) {
      await supabase.from("prestations").update(data).eq("id", id);
    }
    await load();
  }

  // ── Filtrage recherche ──
  const filtered = prestations.filter(p => matchSearch(p, search));
  const servicesPrests = filtered.filter(p => p.type_branche === "service");
  const materiauxPrests = filtered.filter(p => p.type_branche === "materiau");
  const catServices = [...new Set(servicesPrests.map(p => p.categorie))].sort();
  const catMateriaux = [...new Set(materiauxPrests.map(p => p.categorie))].sort();
  const byCatServices = catServices.reduce((acc, cat) => {
    acc[cat] = servicesPrests.filter(p => p.categorie === cat); return acc;
  }, {} as Record<string, PrestationExt[]>);
  const byCatMateriaux = catMateriaux.reduce((acc, cat) => {
    acc[cat] = materiauxPrests.filter(p => p.categorie === cat); return acc;
  }, {} as Record<string, PrestationExt[]>);

  const sharedProps = {
    editId, editData, editNewCat, editCatMode, editLiens,
    editPrixAchat, editPrixVente,
    categories, marques,
    delCategorie, startEdit, saveEdit, del,
    setEditId, setEditData, setEditNewCat, setEditCatMode, setEditLiens,
    setEditPrixAchat, setEditPrixVente,
  };

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-3xl text-ink-900">Catalogue</h1>
            <p className="text-ink-500 text-sm mt-1">
              {prestations.length} prestation{prestations.length > 1 ? "s" : ""}
              {search && ` · ${filtered.length} résultat${filtered.length > 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => exportCSV(prestations)} title="Exporter CSV"
              className="btn-ghost !px-3">
              <Download size={16} />
            </button>
            <button onClick={() => setShowImport(true)} title="Importer CSV"
              className="btn-ghost !px-3">
              <Upload size={16} />
            </button>
            <button onClick={() => setShowForm(!showForm)} className="btn-volt">
              <Plus size={16} /> Ajouter
            </button>
          </div>
        </div>

        {/* Barre de recherche */}
        <div className="relative mb-6">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
          <input
            className="input pl-9 w-full"
            placeholder="Rechercher dans le catalogue…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Formulaire ajout */}
        {showForm && (
          <div className="card card-inner mb-6 border-volt-400">
            <h2 className="font-semibold text-ink-800 mb-4">Nouvelle prestation</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="label">Nom *</label>
                <input className="input" placeholder="Ex : Pose prise de courant 16A"
                  value={form.nom} onChange={e => setForm(f => ({ ...f, nom: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
                <label className="label">Description (optionnel)</label>
                <input className="input" placeholder="Détail de la prestation…"
                  value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <label className="label">Branche AE</label>
                <select className="input" value={form.type_branche} onChange={e => setForm(f => ({ ...f, type_branche: e.target.value }))}>
                  <option value="service">Service (main d'œuvre)</option>
                  <option value="materiau">Matériau (achat/revente)</option>
                </select>
              </div>
              {form.type_branche === "materiau" && (
                <div>
                  <label className="label">Marque</label>
                  <FormMarque value={form.marque} onChange={v => setForm(f => ({ ...f, marque: v }))} marques={marques} />
                </div>
              )}
              <div>
                <label className="label">Unité</label>
                <select className="input" value={form.unite} onChange={e => setForm(f => ({ ...f, unite: e.target.value }))}>
                  {UNITES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Catégorie</label>
                {categories.length > 0 && !newCat ? (
                  <div className="flex gap-2">
                    <select className="input flex-1" value={form.categorie} onChange={e => setForm(f => ({ ...f, categorie: e.target.value }))}>
                      <option value="">— Choisir —</option>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button onClick={() => setNewCat(" ")} className="btn-ghost !px-3 text-xs">Nouvelle</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input className="input flex-1" placeholder="Nom de la catégorie"
                      value={newCat.trim()} onChange={e => setNewCat(e.target.value)} />
                    {categories.length > 0 && <button onClick={() => setNewCat("")} className="btn-ghost !px-3 text-xs">Existante</button>}
                  </div>
                )}
              </div>
              <div>
                <label className="label">Sous-catégorie</label>
                <input className="input" placeholder="Ex : Prises, Câblage, Éclairage…"
                  value={form.sous_categorie} onChange={e => setForm(f => ({ ...f, sous_categorie: e.target.value }))} />
              </div>

              {/* Prix : service = simple, matériau = bloc marge */}
              {form.type_branche === "service" ? (
                <div>
                  <label className="label">Prix unitaire (€) *</label>
                  <input className="input" type="number" step="0.5" placeholder="0.00"
                    value={formPrixVente} onChange={e => setFormPrixVente(e.target.value)} />
                </div>
              ) : (
                <MargeFields
                  prixAchat={formPrixAchat}
                  prixVente={formPrixVente}
                  onPrixAchatChange={setFormPrixAchat}
                  onPrixVenteChange={setFormPrixVente}
                />
              )}

              {form.type_branche === "materiau" && (
                <>
                  <div className="md:col-span-2">
                    <label className="label">Liens fournisseurs</label>
                    <LiensFournisseurs liens={formLiens} setLiens={setFormLiens} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="label">Image du produit (URL)</label>
                    <input className="input" placeholder="https://…/image-produit.jpg"
                      value={form.image_url ?? ""} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} />
                    {form.image_url && (
                      <img src={form.image_url} alt="" className="mt-2 h-16 object-contain rounded-lg border border-ink-100 p-1 bg-white" />
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => { setShowForm(false); setFormLiens([]); setFormPrixAchat(""); setFormPrixVente(""); }}
                className="btn-ghost flex-1 justify-center">Annuler</button>
              <button onClick={add} className="btn-volt flex-1 justify-center"><Save size={15} /> Enregistrer</button>
            </div>
          </div>
        )}

        {/* Empty states */}
        {!loading && prestations.length === 0 && !showForm && (
          <div className="card card-inner text-center py-16">
            <p className="text-ink-400 mb-2">Catalogue vide</p>
            <p className="text-ink-300 text-sm mb-6">Ajoutez vos prestations et matériaux avec leurs prix, unités et catégories.</p>
            <button onClick={() => setShowForm(true)} className="btn-volt inline-flex"><Plus size={15} /> Ajouter la première prestation</button>
          </div>
        )}

        {!loading && prestations.length > 0 && filtered.length === 0 && (
          <div className="card card-inner text-center py-10">
            <Search size={32} className="text-ink-200 mx-auto mb-2" />
            <p className="text-ink-400">Aucun résultat pour « {search} »</p>
          </div>
        )}

        {loading && <div className="text-center py-10 text-ink-400">Chargement…</div>}

        {/* Section Services */}
        {!loading && servicesPrests.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-volt-100 flex items-center justify-center">
                <Wrench size={16} className="text-volt-700" />
              </div>
              <div>
                <h2 className="font-bold text-ink-900">Services</h2>
                <p className="text-xs text-ink-400">{servicesPrests.length} prestation{servicesPrests.length > 1 ? "s" : ""} · Main d'œuvre</p>
              </div>
            </div>
            <div className="space-y-3">
              {Object.entries(byCatServices).map(([cat, items]) => (
                <CategorieBlock key={`s-${cat}`} cat={cat} items={items} branche="service"
                  collapsed={collapsedServices[cat] ?? true}
                  toggleCollapse={() => setCollapsedServices(c => ({ ...c, [cat]: !c[cat] }))}
                  {...sharedProps} />
              ))}
            </div>
          </div>
        )}

        {/* Section Matériaux */}
        {!loading && materiauxPrests.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Package size={16} className="text-emerald-700" />
              </div>
              <div>
                <h2 className="font-bold text-ink-900">Matériaux</h2>
                <p className="text-xs text-ink-400">{materiauxPrests.length} article{materiauxPrests.length > 1 ? "s" : ""} · Achat / revente</p>
              </div>
            </div>
            <div className="space-y-3">
              {Object.entries(byCatMateriaux).map(([cat, items]) => (
                <CategorieBlock key={`m-${cat}`} cat={cat} items={items} branche="materiau"
                  collapsed={collapsedMateriaux[cat] ?? true}
                  toggleCollapse={() => setCollapsedMateriaux(c => ({ ...c, [cat]: !c[cat] }))}
                  {...sharedProps} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Import Modal */}
      {showImport && (
        <ImportModal
          onClose={() => { setShowImport(false); }}
          onImport={handleImport}
        />
      )}
    </Shell>
  );
}
