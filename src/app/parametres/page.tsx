"use client";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Profil } from "@/types";
import Shell from "@/components/layout/Shell";
import { Save, Settings, Users, Plus, Trash2, Pencil, X, Check, Calendar, Smartphone, CreditCard, RefreshCw, CheckCircle, AlertCircle, ExternalLink, Upload, ImageIcon } from "lucide-react";

interface Palier {
  id: string; label: string; seuil_min: number; seuil_max: number | null;
  remise_pct: number; couleur: string;
}
interface Apporteur {
  id: string; nom: string; entreprise?: string; telephone?: string; email?: string; actif: boolean;
}
interface PalierApporteur {
  id?: string; label: string; seuil_min: number; seuil_max: number | null; commission_pct: number; ordre: number;
}
interface AppleCal { url: string; nom: string; couleur: string; }
interface GoogleCal { url: string; nom: string; couleur: string; }

const PALIER_EMOJI: Record<string, string> = { bronze: "🥉", silver: "🥈", gold: "🥇" };

const COULEURS_PRESET = [
  "#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
];

const COULEURS_GOOGLE = [
  { label: "Bleu",   value: "#1a73e8" },
  { label: "Vert",   value: "#0f9d58" },
  { label: "Rouge",  value: "#d93025" },
  { label: "Jaune",  value: "#f9ab00" },
  { label: "Violet", value: "#7b5ea7" },
  { label: "Cyan",   value: "#00acc1" },
  { label: "Orange", value: "#e8710a" },
  { label: "Rose",   value: "#e91e8c" },
];

const F = ({ label, type = "text", placeholder = "", full = false, value, onChange }: {
  label: string; type?: string; placeholder?: string; full?: boolean;
  value: string; onChange: (v: string) => void;
}) => (
  <div className={full ? "col-span-2" : ""}>
    <label className="label">{label}</label>
    <input className="input" type={type} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
  </div>
);

type Tab = "profil" | "apporteurs" | "calendriers";

export default function ParametresPage() {
  const [activeTab, setActiveTab] = useState<Tab>("profil");
  const [profil, setProfil] = useState<Partial<Profil>>({});
  const [paliers, setPaliers] = useState<Palier[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingPaliers, setSavingPaliers] = useState(false);
  const [savedPaliers, setSavedPaliers] = useState(false);
  const [apporteurs, setApporteurs] = useState<Apporteur[]>([]);
  const [paliersApporteur, setPaliersApporteur] = useState<PalierApporteur[]>([]);
  const [editingApporteur, setEditingApporteur] = useState<string | null>(null);
  const [apporteurForm, setApporteurForm] = useState<Partial<Apporteur>>({});
  const [showNewApporteur, setShowNewApporteur] = useState(false);
  const [newApporteur, setNewApporteur] = useState({ nom: "", entreprise: "", telephone: "", email: "" });
  const [savingPaliersAp, setSavingPaliersAp] = useState(false);
  const [savedPaliersAp, setSavedPaliersAp] = useState(false);

  // Logo
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState("");
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Apple Calendar
  const [appleCals, setAppleCals] = useState<AppleCal[]>([{ url: "", nom: "Mon calendrier", couleur: "#3B82F6" }]);
  const [appleConnected, setAppleConnected] = useState(false);
  const [appleSaving, setAppleSaving] = useState(false);
  const [appleError, setAppleError] = useState("");

  // Google Calendar
  const [googleCals, setGoogleCals] = useState<GoogleCal[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleSaving, setGoogleSaving] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const [showAddGoogle, setShowAddGoogle] = useState(false);
  const [newGoogleUrl, setNewGoogleUrl] = useState("");
  const [newGoogleNom, setNewGoogleNom] = useState("");
  const [newGoogleCouleur, setNewGoogleCouleur] = useState(COULEURS_GOOGLE[0].value);
  const [googleTestResults, setGoogleTestResults] = useState<Record<string, "ok" | "error">>({});
  const [googleTesting, setGoogleTesting] = useState<string | null>(null);
  const [googleNomBuffer, setGoogleNomBuffer] = useState<Record<string, string>>({});

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const userId = session.user.id;
      const [{ data: p }, { data: pal }, { data: ap }, { data: palAp }, { data: appleData }] = await Promise.all([
        supabase.from("profil").select("*").eq("id", userId).single(),
        supabase.from("paliers_fidelite").select("*").order("seuil_min"),
        supabase.from("apporteurs").select("*").order("nom"),
        supabase.from("paliers_apporteur").select("*").order("ordre"),
        supabase.from("apple_ics").select("*").eq("user_id", userId).single(),
      ]);
      if (p) {
        setProfil(p);
        if ((p as any).logo_url) setLogoUrl((p as any).logo_url);
        const gCals: GoogleCal[] = p.google_cals ?? [];
        if (gCals.length > 0) {
          setGoogleCals(gCals);
          setGoogleConnected(true);
          const buf: Record<string, string> = {};
          gCals.forEach(c => { buf[c.url] = c.nom; });
          setGoogleNomBuffer(buf);
        }
      }
      if (pal) setPaliers(pal);
      if (ap) setApporteurs(ap);
      if (palAp) setPaliersApporteur(palAp);

      if (appleData) {
        setAppleConnected(true);
        try {
          const cals = JSON.parse(appleData.calendars ?? "[]");
          if (cals.length > 0) {
            setAppleCals(cals);
          } else {
            const urls = JSON.parse(appleData.ics_urls ?? "[]");
            setAppleCals(urls.map((u: string, i: number) => ({
              url: u, nom: `Calendrier ${i + 1}`,
              couleur: COULEURS_PRESET[i % COULEURS_PRESET.length],
            })));
          }
        } catch {
          setAppleCals([{ url: "", nom: "Mon calendrier", couleur: "#3B82F6" }]);
        }
      }
    }
    load();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab") as Tab | null;
    if (tab && ["profil", "calendriers", "apporteurs"].includes(tab)) setActiveTab(tab);
  }, []);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setLogoError("Fichier image requis (PNG, JPG, SVG)."); return; }
    if (file.size > 2 * 1024 * 1024) { setLogoError("Fichier trop lourd (max 2 Mo)."); return; }
    setLogoError("");
    setLogoUploading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLogoUploading(false); return; }
    const userId = session.user.id;
    const ext = file.name.split(".").pop() ?? "png";
    const path = `${userId}/logo.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("logos")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) { setLogoError("Erreur lors de l'upload."); setLogoUploading(false); return; }
    const { data: { publicUrl } } = supabase.storage.from("logos").getPublicUrl(path);
    const urlWithCacheBust = `${publicUrl}?t=${Date.now()}`;
    await supabase.from("profil").update({ logo_url: publicUrl } as any).eq("id", userId);
    setLogoUrl(urlWithCacheBust);
    setLogoUploading(false);
  }

  async function handleLogoDelete() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const userId = session.user.id;
    await supabase.storage.from("logos").remove([`${userId}/logo.png`, `${userId}/logo.jpg`, `${userId}/logo.jpeg`, `${userId}/logo.svg`, `${userId}/logo.webp`]);
    await supabase.from("profil").update({ logo_url: null } as any).eq("id", userId);
    setLogoUrl(null);
  }

  async function save() {
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSaving(false); return; }
    const { id, created_at, updated_at, ...updateData } = profil as any;
    await supabase.from("profil").update(updateData).eq("id", session.user.id);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function savePaliers() {
    setSavingPaliers(true);
    for (const p of paliers) {
      await supabase.from("paliers_fidelite").update({
        seuil_min: p.seuil_min, seuil_max: p.seuil_max, remise_pct: p.remise_pct,
      }).eq("id", p.id);
    }
    setSavingPaliers(false); setSavedPaliers(true);
    setTimeout(() => setSavedPaliers(false), 2500);
  }

  function setPalier(id: string, field: keyof Palier, value: any) {
    setPaliers(ps => ps.map(p => p.id === id ? { ...p, [field]: value } : p));
  }

  async function addApporteur() {
    if (!newApporteur.nom.trim()) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase.from("apporteurs").insert({
      user_id: session.user.id, nom: newApporteur.nom, entreprise: newApporteur.entreprise || null,
      telephone: newApporteur.telephone || null, email: newApporteur.email || null, actif: true,
    }).select().single();
    if (data) setApporteurs(a => [...a, data]);
    setNewApporteur({ nom: "", entreprise: "", telephone: "", email: "" });
    setShowNewApporteur(false);
  }

  async function saveApporteur(id: string) {
    await supabase.from("apporteurs").update({
      nom: apporteurForm.nom, entreprise: apporteurForm.entreprise || null,
      telephone: apporteurForm.telephone || null, email: apporteurForm.email || null,
    }).eq("id", id);
    setApporteurs(a => a.map(ap => ap.id === id ? { ...ap, ...apporteurForm } as Apporteur : ap));
    setEditingApporteur(null);
  }

  async function toggleApporteur(id: string, actif: boolean) {
    await supabase.from("apporteurs").update({ actif }).eq("id", id);
    setApporteurs(a => a.map(ap => ap.id === id ? { ...ap, actif } : ap));
  }

  async function deleteApporteur(id: string) {
    await supabase.from("apporteurs").delete().eq("id", id);
    setApporteurs(a => a.filter(ap => ap.id !== id));
  }

  async function addPalierApporteur() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const ordre = paliersApporteur.length;
    const { data } = await supabase.from("paliers_apporteur").insert({
      user_id: session.user.id, label: `Palier ${ordre + 1}`, seuil_min: 0, seuil_max: null,
      commission_pct: 5, ordre,
    }).select().single();
    if (data) setPaliersApporteur(p => [...p, data]);
  }

  async function savePaliersApporteur() {
    setSavingPaliersAp(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setSavingPaliersAp(false); return; }
    for (const p of paliersApporteur) {
      if (p.id) {
        await supabase.from("paliers_apporteur").update({
          label: p.label, seuil_min: p.seuil_min, seuil_max: p.seuil_max, commission_pct: p.commission_pct,
        }).eq("id", p.id);
      }
    }
    setSavingPaliersAp(false); setSavedPaliersAp(true);
    setTimeout(() => setSavedPaliersAp(false), 2500);
  }

  async function deletePalierApporteur(id: string) {
    await supabase.from("paliers_apporteur").delete().eq("id", id);
    setPaliersApporteur(p => p.filter(x => x.id !== id));
  }

  function setPalierAp(idx: number, field: keyof PalierApporteur, value: any) {
    setPaliersApporteur(ps => ps.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }

  async function saveApple() {
    const valid = appleCals.filter(c => c.url.trim() !== "");
    if (valid.length === 0) { setAppleError("Ajoutez au moins une URL."); return; }
    setAppleError("");
    setAppleSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setAppleSaving(false); return; }
    await supabase.from("apple_ics").upsert({
      user_id: session.user.id,
      ics_urls: JSON.stringify(valid.map(c => c.url)),
      calendars: JSON.stringify(valid),
    }, { onConflict: "user_id" });
    setAppleConnected(true);
    setAppleSaving(false);
  }

  async function disconnectApple() {
    await fetch("/api/apple/ics-disconnect", { method: "POST" });
    setAppleConnected(false);
    setAppleCals([{ url: "", nom: "Mon calendrier", couleur: "#3B82F6" }]);
  }

  function updateCal(idx: number, field: keyof AppleCal, value: string) {
    setAppleCals(cals => cals.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  }

  async function saveGoogleCals(updated: GoogleCal[]) {
    setGoogleSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setGoogleSaving(false); return; }
    await supabase.from("profil").update({ google_cals: updated }).eq("id", session.user.id);
    setGoogleCals(updated);
    setGoogleConnected(updated.length > 0);
    setGoogleSaving(false);
  }

  async function testGoogleUrl(url: string) {
    setGoogleTesting(url);
    try {
      const res = await fetch(`/api/google/ics/test?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      setGoogleTestResults(r => ({ ...r, [url]: data.ok ? "ok" : "error" }));
    } catch {
      setGoogleTestResults(r => ({ ...r, [url]: "error" }));
    }
    setGoogleTesting(null);
  }

  async function handleAddGoogle() {
    setGoogleError("");
    const url = newGoogleUrl.trim();
    if (!url) { setGoogleError("L'URL ICS est requise."); return; }
    if (!url.includes("calendar.google.com") && !url.endsWith(".ics") && !url.startsWith("webcal://")) {
      setGoogleError("L'URL doit provenir de Google Calendar (ou se terminer par .ics).");
      return;
    }
    if (googleCals.find(c => c.url === url)) { setGoogleError("Ce calendrier est déjà ajouté."); return; }
    const nom = newGoogleNom.trim() || "Mon calendrier Google";
    const updated = [...googleCals, { url, nom, couleur: newGoogleCouleur }];
    await saveGoogleCals(updated);
    await testGoogleUrl(url);
    setGoogleNomBuffer(b => ({ ...b, [url]: nom }));
    setNewGoogleUrl(""); setNewGoogleNom(""); setNewGoogleCouleur(COULEURS_GOOGLE[0].value);
    setShowAddGoogle(false);
  }

  async function removeGoogleCal(url: string) {
    if (!confirm("Supprimer ce calendrier Google ?")) return;
    const updated = googleCals.filter(c => c.url !== url);
    await saveGoogleCals(updated);
    setGoogleTestResults(r => { const n = { ...r }; delete n[url]; return n; });
    setGoogleNomBuffer(b => { const n = { ...b }; delete n[url]; return n; });
  }

  async function updateGoogleCouleur(url: string, couleur: string) {
    const updated = googleCals.map(c => c.url === url ? { ...c, couleur } : c);
    await saveGoogleCals(updated);
  }

  function handleGoogleNomChange(url: string, nom: string) {
    setGoogleNomBuffer(b => ({ ...b, [url]: nom }));
  }
  async function handleGoogleNomBlur(url: string) {
    const nom = (googleNomBuffer[url] ?? "").trim() || "Mon calendrier Google";
    const updated = googleCals.map(c => c.url === url ? { ...c, nom } : c);
    await saveGoogleCals(updated);
  }

  const set = (k: string, v: any) => setProfil(p => ({ ...p, [k]: v }));
  const val = (k: string, fallback = "") => String((profil as any)[k] ?? fallback);
  const numVal = (k: string, fallback: number) => (profil as any)[k] ?? fallback;

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Settings size={22} className="text-volt-600" />
          <h1 className="font-display text-3xl text-ink-900">Paramètres</h1>
        </div>

        <div className="flex gap-1 mb-6 bg-ink-100 p-1 rounded-xl overflow-x-auto">
          {(["profil", "calendriers", "apporteurs"] as Tab[]).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`flex items-center gap-1.5 flex-1 justify-center px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${activeTab === t ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700"}`}>
              {t === "profil" && <><Settings size={14} /> Profil & fiscal</>}
              {t === "calendriers" && <><Calendar size={14} /> Calendriers</>}
              {t === "apporteurs" && <><Users size={14} /> Apporteurs</>}
            </button>
          ))}
        </div>

        {/* ── ONGLET CALENDRIERS ── */}
        {activeTab === "calendriers" && (
          <div className="space-y-4">
            <div className="card card-inner">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-ink-900 flex items-center justify-center">
                  <Smartphone size={16} className="text-white" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-ink-800 text-sm">🍎 Apple Calendar (iCloud)</p>
                  <p className="text-xs text-ink-400">Synchronisation via lien public ICS</p>
                </div>
                {appleConnected && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Connecté</span>
                )}
              </div>
              <div className="space-y-4">
                <div className="bg-ink-50 border border-ink-200 rounded-xl p-3 text-xs text-ink-600 space-y-1.5">
                  <p className="font-semibold text-ink-700">Comment obtenir le lien :</p>
                  <p>Sur iPhone → <strong>Calendrier</strong> → appui long sur le calendrier → <strong>Calendrier public</strong> → activer → <strong>Partager le lien</strong></p>
                  <p>Collez l'URL <code className="bg-ink-200 px-1 rounded">webcal://...</code> ci-dessous.</p>
                </div>
                <div className="space-y-3">
                  {appleCals.map((cal, idx) => (
                    <div key={idx} className="p-3 rounded-xl border border-ink-100 bg-ink-50 space-y-2">
                      <div className="flex items-center gap-2">
                        <input type="color" value={cal.couleur}
                          onChange={e => updateCal(idx, "couleur", e.target.value)}
                          className="w-8 h-8 rounded-lg cursor-pointer border border-ink-200 p-0.5 bg-white shrink-0" />
                        <input value={cal.nom} onChange={e => updateCal(idx, "nom", e.target.value)}
                          placeholder="Nom du calendrier" className="input flex-1 text-sm" />
                        {appleCals.length > 1 && (
                          <button onClick={() => setAppleCals(c => c.filter((_, i) => i !== idx))}
                            className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 shrink-0"><X size={14} /></button>
                        )}
                      </div>
                      <div className="flex gap-1.5 flex-wrap">
                        {COULEURS_PRESET.map(c => (
                          <button key={c} onClick={() => updateCal(idx, "couleur", c)}
                            className={`w-5 h-5 rounded-full border-2 transition-all ${cal.couleur === c ? "border-ink-900 scale-110" : "border-transparent"}`}
                            style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <input value={cal.url} onChange={e => updateCal(idx, "url", e.target.value)}
                        placeholder="webcal://p12-caldav.icloud.com/..."
                        className="input w-full text-xs font-mono" />
                    </div>
                  ))}
                </div>
                <button onClick={() => setAppleCals(c => [...c, { url: "", nom: `Calendrier ${c.length + 1}`, couleur: COULEURS_PRESET[c.length % COULEURS_PRESET.length] }])}
                  className="text-xs text-volt-700 font-medium flex items-center gap-1 hover:text-volt-600">
                  <Plus size={12} /> Ajouter un calendrier
                </button>
                {appleError && <p className="text-xs text-red-600">{appleError}</p>}
                <div className="flex gap-3">
                  {appleConnected && (
                    <button onClick={disconnectApple}
                      className="flex-1 py-2 rounded-xl border border-red-200 text-sm font-medium text-red-500 hover:bg-red-50">
                      Déconnecter
                    </button>
                  )}
                  <button onClick={saveApple} disabled={appleSaving}
                    className="flex-1 py-2.5 rounded-xl bg-ink-900 text-volt-400 text-sm font-semibold hover:bg-ink-800 disabled:opacity-40">
                    {appleSaving ? "Enregistrement…" : appleConnected ? "Mettre à jour" : "Connecter"}
                  </button>
                </div>
              </div>
            </div>

            <div className="card card-inner">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, #4285F4 0%, #34A853 50%, #EA4335 100%)" }}>
                  <Calendar size={16} className="text-white" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-ink-800 text-sm">🗓️ Google Calendar</p>
                  <p className="text-xs text-ink-400">Synchronisation via URL secrète iCal (lecture seule)</p>
                </div>
                {googleConnected && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                    {googleCals.length} connecté{googleCals.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 space-y-1.5 mb-4">
                <p className="font-semibold">Comment obtenir l'URL iCal de votre calendrier Google ?</p>
                <ol className="space-y-1 pl-3 list-decimal">
                  <li>Ouvrez <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer"
                    className="underline font-medium inline-flex items-center gap-0.5">
                    calendar.google.com <ExternalLink size={10} /></a></li>
                  <li>Cliquez sur <strong>⋮</strong> à côté du calendrier → <strong>Paramètres et partage</strong></li>
                  <li>Descendez jusqu'à <strong>«&nbsp;Adresse secrète au format iCal&nbsp;»</strong></li>
                  <li>Copiez l'URL et collez-la ci-dessous</li>
                </ol>
                <p className="text-blue-500 italic">⚠️ Ne partagez jamais cette URL — elle donne accès à votre agenda.</p>
              </div>

              {googleCals.length === 0 && !showAddGoogle ? (
                <div className="text-center py-6 border-2 border-dashed border-ink-200 rounded-xl">
                  <p className="text-sm text-ink-400 mb-3">Aucun calendrier Google connecté</p>
                  <button onClick={() => setShowAddGoogle(true)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-volt-500 text-ink-900 text-sm font-semibold hover:bg-volt-400 mx-auto">
                    <Plus size={15} /> Ajouter un calendrier
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {googleCals.map((cal) => (
                    <div key={cal.url} className="border border-ink-100 rounded-xl p-3 space-y-2 bg-ink-50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <input
                            value={googleNomBuffer[cal.url] ?? cal.nom}
                            onChange={e => handleGoogleNomChange(cal.url, e.target.value)}
                            onBlur={() => handleGoogleNomBlur(cal.url)}
                            placeholder="Nom du calendrier"
                            className="text-sm font-medium text-ink-800 bg-transparent border-b border-transparent hover:border-ink-200 focus:border-volt-400 focus:outline-none w-full" />
                          <p className="text-xs text-ink-400 truncate mt-0.5 font-mono">
                            {cal.url.length > 55 ? cal.url.slice(0, 55) + "…" : cal.url}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {googleTestResults[cal.url] === "ok" && <CheckCircle size={15} className="text-green-500" />}
                          {googleTestResults[cal.url] === "error" && <AlertCircle size={15} className="text-red-500" />}
                          <button onClick={() => testGoogleUrl(cal.url)} disabled={googleTesting === cal.url}
                            title="Tester la connexion"
                            className="p-1.5 rounded-lg hover:bg-ink-200 text-ink-400 hover:text-ink-600 disabled:opacity-40">
                            <RefreshCw size={14} className={googleTesting === cal.url ? "animate-spin" : ""} />
                          </button>
                          <button onClick={() => removeGoogleCal(cal.url)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-ink-400 hover:text-red-500">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs text-ink-400 mr-1">Couleur :</span>
                        {COULEURS_GOOGLE.map(c => (
                          <button key={c.value} onClick={() => updateGoogleCouleur(cal.url, c.value)}
                            className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${cal.couleur === c.value ? "border-ink-900 scale-110" : "border-transparent"}`}
                            style={{ backgroundColor: c.value }} title={c.label} />
                        ))}
                      </div>
                      {googleTestResults[cal.url] === "error" && (
                        <p className="text-xs text-red-500">⚠️ Impossible d'accéder à ce calendrier. Vérifiez l'URL.</p>
                      )}
                      {googleTestResults[cal.url] === "ok" && (
                        <p className="text-xs text-green-600">✓ Calendrier accessible et synchronisé.</p>
                      )}
                    </div>
                  ))}
                  {!showAddGoogle && (
                    <button onClick={() => setShowAddGoogle(true)}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-dashed border-ink-200 text-sm text-ink-500 hover:border-volt-400 hover:text-volt-600 transition-colors">
                      <Plus size={15} /> Ajouter un calendrier
                    </button>
                  )}
                </div>
              )}

              {showAddGoogle && (
                <div className="border border-volt-200 rounded-xl p-4 bg-volt-50 space-y-3 mt-3">
                  <h4 className="text-sm font-semibold text-ink-800">Nouveau calendrier Google</h4>
                  <div>
                    <label className="label">URL iCal *</label>
                    <input value={newGoogleUrl} onChange={e => { setNewGoogleUrl(e.target.value); setGoogleError(""); }}
                      placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                      className="input w-full text-xs font-mono" />
                  </div>
                  <div>
                    <label className="label">Nom affiché</label>
                    <input value={newGoogleNom} onChange={e => setNewGoogleNom(e.target.value)}
                      placeholder="Ex: Perso, Pro, Famille…" className="input w-full" />
                  </div>
                  <div>
                    <label className="label">Couleur</label>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {COULEURS_GOOGLE.map(c => (
                        <button key={c.value} onClick={() => setNewGoogleCouleur(c.value)}
                          className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${newGoogleCouleur === c.value ? "border-ink-900 scale-110" : "border-transparent"}`}
                          style={{ backgroundColor: c.value }} title={c.label} />
                      ))}
                    </div>
                  </div>
                  {googleError && <p className="text-xs text-red-500">{googleError}</p>}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => { setShowAddGoogle(false); setGoogleError(""); setNewGoogleUrl(""); setNewGoogleNom(""); }}
                      className="flex-1 py-2 rounded-lg border border-ink-200 text-sm text-ink-600 hover:bg-ink-50">
                      Annuler
                    </button>
                    <button onClick={handleAddGoogle} disabled={googleSaving || !newGoogleUrl.trim()}
                      className="flex-1 py-2 rounded-lg bg-volt-500 text-ink-900 text-sm font-semibold hover:bg-volt-400 disabled:opacity-40">
                      {googleSaving ? "Ajout…" : "Ajouter"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ONGLET PROFIL ── */}
        {activeTab === "profil" && (
          <div className="space-y-4">

            {/* ── Logo ── */}
            <div className="card card-inner">
              <div className="flex items-center gap-2 mb-4">
                <ImageIcon size={16} className="text-ink-500" />
                <h2 className="font-semibold text-ink-800">Logo de l'entreprise</h2>
              </div>
              <p className="text-xs text-ink-400 mb-4">Affiché dans la barre de navigation et sur vos devis et factures. PNG ou JPG recommandé, fond transparent idéal.</p>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-xl border-2 border-dashed border-ink-200 bg-ink-50 flex items-center justify-center shrink-0 overflow-hidden">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
                  ) : (
                    <ImageIcon size={24} className="text-ink-300" />
                  )}
                </div>
                <div className="flex flex-col gap-2 flex-1">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    disabled={logoUploading}
                    className="flex items-center justify-center gap-2 py-2 px-4 rounded-xl border border-ink-200 bg-white text-ink-700 text-sm font-medium hover:bg-ink-50 disabled:opacity-40 transition-colors">
                    <Upload size={14} />
                    {logoUploading ? "Upload en cours…" : logoUrl ? "Changer le logo" : "Uploader un logo"}
                  </button>
                  {logoUrl && (
                    <button
                      onClick={handleLogoDelete}
                      className="flex items-center justify-center gap-2 py-2 px-4 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors">
                      <Trash2 size={14} /> Supprimer
                    </button>
                  )}
                  {logoError && <p className="text-xs text-red-500">{logoError}</p>}
                </div>
              </div>
            </div>

            <div className="card card-inner">
              <h2 className="font-semibold text-ink-800 mb-4">Informations de l'entreprise</h2>
              <div className="grid grid-cols-2 gap-3">
                <F label="Nom de l'entreprise / Raison sociale" full placeholder="Jean Dupont Électricité"
                  value={val("nom_entreprise")} onChange={v => set("nom_entreprise", v)} />
                <F label="Prénom" value={val("prenom")} onChange={v => set("prenom", v)} />
                <F label="Nom" value={val("nom")} onChange={v => set("nom", v)} />
                <F label="SIRET" placeholder="000 000 000 00000" value={val("siret")} onChange={v => set("siret", v)} />
                <F label="Téléphone" type="tel" value={val("telephone")} onChange={v => set("telephone", v)} />
                <F label="Email" type="email" full value={val("email")} onChange={v => set("email", v)} />
                <F label="Adresse" full value={val("adresse")} onChange={v => set("adresse", v)} />
                <F label="Code postal" value={val("code_postal")} onChange={v => set("code_postal", v)} />
                <F label="Ville" value={val("ville")} onChange={v => set("ville", v)} />
                <div>
                  <label className="label">Taux horaire (€/h)</label>
                  <input className="input" type="number" step="0.5"
                    value={numVal("taux_horaire", 55)}
                    onChange={e => set("taux_horaire", parseFloat(e.target.value))} />
                </div>
              </div>
            </div>

            <div className="card card-inner">
              <div className="flex items-center gap-2 mb-4">
                <CreditCard size={16} className="text-ink-500" />
                <h2 className="font-semibold text-ink-800">Coordonnées bancaires</h2>
              </div>
              <p className="text-xs text-ink-400 mb-4">Ces informations apparaîtront uniquement dans le pied de page de vos factures.</p>
              <div className="grid grid-cols-2 gap-3">
                <F label="Titulaire du compte" full placeholder="Urtzi Électricien"
                  value={val("banque_titulaire")} onChange={v => set("banque_titulaire", v)} />
                <F label="Banque" full placeholder="Crédit Agricole"
                  value={val("banque_nom")} onChange={v => set("banque_nom", v)} />
                <F label="IBAN" full placeholder="FR76 0000 0000 0000 0000 0000 000"
                  value={val("iban")} onChange={v => set("iban", v)} />
                <F label="BIC / SWIFT" placeholder="AGRIFRPP"
                  value={val("bic")} onChange={v => set("bic", v)} />
              </div>
            </div>

            <div className="card card-inner">
              <h2 className="font-semibold text-ink-800 mb-4">Numérotation</h2>
              <div className="grid grid-cols-2 gap-3">
                <F label="Préfixe devis" placeholder="DEV" value={val("prefixe_devis")} onChange={v => set("prefixe_devis", v)} />
                <F label="Préfixe facture" placeholder="FAC" value={val("prefixe_facture")} onChange={v => set("prefixe_facture", v)} />
              </div>
              <p className="text-xs text-ink-400 mt-2">Exemple : DEV-2027-001</p>
            </div>

            <div className="card card-inner">
              <h2 className="font-semibold text-ink-800 mb-4">Mentions légales</h2>
              <div className="space-y-3">
                <div>
                  <label className="label">Mention TVA</label>
                  <input className="input" value={val("mention_tva", "TVA non applicable — Art. 293 B du CGI")}
                    onChange={e => set("mention_tva", e.target.value)} />
                </div>
                <div>
                  <label className="label">Conditions de paiement</label>
                  <input className="input" value={val("conditions_paiement", "Paiement à réception de facture")}
                    onChange={e => set("conditions_paiement", e.target.value)} />
                </div>
              </div>
            </div>

            <div className="card card-inner">
              <h2 className="font-semibold text-ink-800 mb-1">Fiscalité auto-entrepreneur</h2>
              <p className="text-xs text-ink-400 mb-4">Ces taux servent à estimer votre résultat net dans le CRM.</p>
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-volt-200 bg-volt-50 space-y-3">
                  <p className="text-sm font-semibold text-volt-700">⚡ Branche Service (main d'œuvre)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Cotisations sociales (%)</label>
                      <input className="input" type="number" step="0.1" min="0" max="100"
                        value={numVal("taux_cotisations_service", 22)}
                        onChange={e => set("taux_cotisations_service", parseFloat(e.target.value) || 0)} />
                      <p className="text-xs text-ink-400 mt-1">Taux standard AE : 22%</p>
                    </div>
                    <div>
                      <label className="label">Versement libératoire IR (%)</label>
                      <input className="input" type="number" step="0.1" min="0" max="100"
                        value={numVal("taux_ir_service", 0)}
                        onChange={e => set("taux_ir_service", parseFloat(e.target.value) || 0)} />
                      <p className="text-xs text-ink-400 mt-1">0% si régime classique</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 space-y-3">
                  <p className="text-sm font-semibold text-emerald-700">📦 Branche Matériaux (achat/revente)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Cotisations sociales (%)</label>
                      <input className="input" type="number" step="0.1" min="0" max="100"
                        value={numVal("taux_cotisations_materiau", 6)}
                        onChange={e => set("taux_cotisations_materiau", parseFloat(e.target.value) || 0)} />
                      <p className="text-xs text-ink-400 mt-1">Taux standard AE : 6%</p>
                    </div>
                    <div>
                      <label className="label">Versement libératoire IR (%)</label>
                      <input className="input" type="number" step="0.1" min="0" max="100"
                        value={numVal("taux_ir_materiau", 0)}
                        onChange={e => set("taux_ir_materiau", parseFloat(e.target.value) || 0)} />
                      <p className="text-xs text-ink-400 mt-1">0% si régime classique</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card card-inner">
              <h2 className="font-semibold text-ink-800 mb-1">Paliers de fidélité</h2>
              <p className="text-xs text-ink-400 mb-4">La remise s'applique à partir de la facture suivant le passage de palier.</p>
              <div className="space-y-4">
                {paliers.map(p => (
                  <div key={p.id} className="p-4 rounded-xl border border-ink-100 bg-ink-50 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{PALIER_EMOJI[p.id]}</span>
                      <span className="font-semibold text-ink-800">{p.label}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="label">Seuil min (€)</label>
                        <input className="input" type="number" step="100" value={p.seuil_min}
                          onChange={e => setPalier(p.id, "seuil_min", parseFloat(e.target.value) || 0)} />
                      </div>
                      <div>
                        <label className="label">Seuil max (€)</label>
                        <input className="input" type="number" step="100"
                          placeholder={p.id === "gold" ? "Illimité" : ""}
                          value={p.seuil_max ?? ""}
                          onChange={e => setPalier(p.id, "seuil_max", e.target.value ? parseFloat(e.target.value) : null)} />
                      </div>
                      <div>
                        <label className="label">Remise (%)</label>
                        <input className="input" type="number" step="0.5" min="0" max="100" value={p.remise_pct}
                          onChange={e => setPalier(p.id, "remise_pct", parseFloat(e.target.value) || 0)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={savePaliers} disabled={savingPaliers}
                className={`mt-4 w-full justify-center flex items-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all ${savedPaliers ? "bg-emerald-500 text-white" : "bg-ink-900 text-volt-400 hover:bg-ink-800"}`}>
                <Save size={14} />
                {savingPaliers ? "Enregistrement…" : savedPaliers ? "Paliers sauvegardés ✓" : "Enregistrer les paliers"}
              </button>
            </div>

            <button onClick={save} disabled={saving}
              className={`w-full justify-center flex items-center gap-2 py-3 rounded-xl font-semibold transition-all ${saved ? "bg-emerald-500 text-white" : "bg-ink-900 text-volt-400 hover:bg-ink-800"}`}>
              <Save size={16} />
              {saving ? "Enregistrement…" : saved ? "Paramètres sauvegardés ✓" : "Enregistrer les paramètres"}
            </button>
          </div>
        )}

        {/* ── ONGLET APPORTEURS ── */}
        {activeTab === "apporteurs" && (
          <div className="space-y-4">
            <div className="card card-inner">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-ink-800">Apporteurs d'affaires</h2>
                  <p className="text-xs text-ink-400 mt-0.5">Entreprises ou contacts qui vous apportent des clients</p>
                </div>
                <button onClick={() => setShowNewApporteur(!showNewApporteur)}
                  className="btn-volt text-xs !py-1.5"><Plus size={13} /> Ajouter</button>
              </div>
              {showNewApporteur && (
                <div className="mb-4 p-4 bg-volt-50 border border-volt-200 rounded-xl space-y-3">
                  <p className="text-sm font-semibold text-volt-700">Nouvel apporteur</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="label">Nom *</label>
                      <input className="input" placeholder="Martin Dupont" value={newApporteur.nom}
                        onChange={e => setNewApporteur(a => ({ ...a, nom: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">Entreprise</label>
                      <input className="input" placeholder="Dupont SARL" value={newApporteur.entreprise}
                        onChange={e => setNewApporteur(a => ({ ...a, entreprise: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">Téléphone</label>
                      <input className="input" type="tel" value={newApporteur.telephone}
                        onChange={e => setNewApporteur(a => ({ ...a, telephone: e.target.value }))} />
                    </div>
                    <div className="col-span-2">
                      <label className="label">Email</label>
                      <input className="input" type="email" value={newApporteur.email}
                        onChange={e => setNewApporteur(a => ({ ...a, email: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setShowNewApporteur(false)} className="btn-ghost flex-1 justify-center text-sm"><X size={13} /> Annuler</button>
                    <button onClick={addApporteur} className="btn-volt flex-1 justify-center text-sm"><Check size={13} /> Ajouter</button>
                  </div>
                </div>
              )}
              {apporteurs.length === 0 && !showNewApporteur ? (
                <p className="text-sm text-ink-400 text-center py-6">Aucun apporteur. Cliquez sur Ajouter.</p>
              ) : (
                <div className="space-y-2">
                  {apporteurs.map(ap => (
                    <div key={ap.id} className={`rounded-xl border p-3 transition-all ${ap.actif ? "border-ink-200 bg-white" : "border-ink-100 bg-ink-50 opacity-60"}`}>
                      {editingApporteur === ap.id ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="col-span-2">
                              <label className="label">Nom *</label>
                              <input className="input text-sm" value={apporteurForm.nom ?? ""} onChange={e => setApporteurForm(f => ({ ...f, nom: e.target.value }))} />
                            </div>
                            <div>
                              <label className="label">Entreprise</label>
                              <input className="input text-sm" value={apporteurForm.entreprise ?? ""} onChange={e => setApporteurForm(f => ({ ...f, entreprise: e.target.value }))} />
                            </div>
                            <div>
                              <label className="label">Téléphone</label>
                              <input className="input text-sm" value={apporteurForm.telephone ?? ""} onChange={e => setApporteurForm(f => ({ ...f, telephone: e.target.value }))} />
                            </div>
                            <div className="col-span-2">
                              <label className="label">Email</label>
                              <input className="input text-sm" value={apporteurForm.email ?? ""} onChange={e => setApporteurForm(f => ({ ...f, email: e.target.value }))} />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => setEditingApporteur(null)} className="btn-ghost flex-1 justify-center text-xs"><X size={12} /> Annuler</button>
                            <button onClick={() => saveApporteur(ap.id)} className="btn-volt flex-1 justify-center text-xs"><Check size={12} /> Sauvegarder</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-ink-900 flex items-center justify-center text-volt-400 text-sm font-bold shrink-0">
                            {ap.nom.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm text-ink-900">{ap.nom}</p>
                            <p className="text-xs text-ink-400 truncate">
                              {[ap.entreprise, ap.telephone, ap.email].filter(Boolean).join(" · ") || "Aucun contact"}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => toggleApporteur(ap.id, !ap.actif)}
                              className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${ap.actif ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-ink-100 text-ink-500 hover:bg-ink-200"}`}>
                              {ap.actif ? "Actif" : "Inactif"}
                            </button>
                            <button onClick={() => { setEditingApporteur(ap.id); setApporteurForm(ap); }}
                              className="btn-ghost !px-2 !py-1.5"><Pencil size={13} /></button>
                            <button onClick={() => deleteApporteur(ap.id)}
                              className="btn-ghost !px-2 !py-1.5 text-red-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={13} /></button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="card card-inner">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <h2 className="font-semibold text-ink-800">Paliers de commission</h2>
                  <p className="text-xs text-ink-400 mt-0.5">Commission calculée sur le CA apporté par mois</p>
                </div>
                <button onClick={addPalierApporteur} className="btn-ghost text-xs !py-1.5"><Plus size={13} /> Ajouter</button>
              </div>
              {paliersApporteur.length === 0 ? (
                <p className="text-sm text-ink-400 text-center py-6">Aucun palier. Cliquez sur Ajouter.</p>
              ) : (
                <div className="space-y-3 mt-4">
                  {paliersApporteur.map((p, idx) => (
                    <div key={p.id ?? idx} className="p-3 rounded-xl border border-ink-100 bg-ink-50">
                      <div className="grid grid-cols-4 gap-2 items-end">
                        <div>
                          <label className="label">Label</label>
                          <input className="input text-sm" value={p.label} onChange={e => setPalierAp(idx, "label", e.target.value)} />
                        </div>
                        <div>
                          <label className="label">Seuil min (€/mois)</label>
                          <input className="input text-sm" type="number" step="100" value={p.seuil_min}
                            onChange={e => setPalierAp(idx, "seuil_min", parseFloat(e.target.value) || 0)} />
                        </div>
                        <div>
                          <label className="label">Seuil max (€/mois)</label>
                          <input className="input text-sm" type="number" step="100" placeholder="Illimité" value={p.seuil_max ?? ""}
                            onChange={e => setPalierAp(idx, "seuil_max", e.target.value ? parseFloat(e.target.value) : null)} />
                        </div>
                        <div>
                          <label className="label">Commission (%)</label>
                          <div className="flex gap-1">
                            <input className="input text-sm" type="number" step="0.5" min="0" max="100" value={p.commission_pct}
                              onChange={e => setPalierAp(idx, "commission_pct", parseFloat(e.target.value) || 0)} />
                            {p.id && (
                              <button onClick={() => deletePalierApporteur(p.id!)}
                                className="btn-ghost !px-2 text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0"><Trash2 size={13} /></button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {paliersApporteur.length > 0 && (
                <button onClick={savePaliersApporteur} disabled={savingPaliersAp}
                  className={`mt-4 w-full justify-center flex items-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all ${savedPaliersAp ? "bg-emerald-500 text-white" : "bg-ink-900 text-volt-400 hover:bg-ink-800"}`}>
                  <Save size={14} />
                  {savingPaliersAp ? "Enregistrement…" : savedPaliersAp ? "Paliers sauvegardés ✓" : "Enregistrer les paliers"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
