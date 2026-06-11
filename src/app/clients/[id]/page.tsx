"use client";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Client, Devis, Facture } from "@/types";
import { fmt, fmtDate, fmtDatetime, initiales, STATUT_LABELS, STATUT_COLORS, cn } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Phone, Mail, MapPin, Home, Key, FileText, Camera, X, Plus, Pencil, Save, Trash2, ChevronLeft, ChevronRight, Receipt, CalendarDays } from "lucide-react";
import TableauClientWidget from "@/components/tableau/TableauClientWidget";

interface Palier {
  id: string; label: string; seuil_min: number; seuil_max: number | null;
  remise_pct: number; couleur: string;
}

interface Intervention {
  id: string; titre: string; description?: string; adresse_chantier?: string;
  date_debut: string; date_fin: string; statut: string; devis_id?: string;
}

const STATUT_IV_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  planifie: { label: "Planifié",  color: "text-blue-700",  bg: "bg-blue-100" },
  en_cours: { label: "En cours",  color: "text-amber-700", bg: "bg-amber-100" },
  termine:  { label: "Terminé",   color: "text-green-700", bg: "bg-green-100" },
  annule:   { label: "Annulé",    color: "text-red-700",   bg: "bg-red-100" },
};

const F = ({ label, k, type = "text", placeholder = "", col2 = false, form, set }: any) => (
  <div className={col2 ? "col-span-2" : ""}>
    <label className="label">{label}</label>
    <input className="input" type={type} placeholder={placeholder} value={form[k] ?? ""} onChange={e => set(k, e.target.value)} />
  </div>
);
const S = ({ label, k, options, form, set }: { label: string; k: string; options: [string, string][]; form: any; set: any }) => (
  <div>
    <label className="label">{label}</label>
    <select className="input" value={form[k] ?? ""} onChange={e => set(k, e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </div>
);

function MedailleBadge({ palier }: { palier: Palier | null }) {
  if (!palier) return null;
  const emoji = palier.id === "gold" ? "🥇" : palier.id === "silver" ? "🥈" : "🥉";
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border"
      style={{ borderColor: palier.couleur, color: palier.couleur, backgroundColor: palier.couleur + "18" }}>
      {emoji} {palier.label}
    </span>
  );
}

function BarreFidelite({ ca, paliers }: { ca: number; paliers: Palier[] }) {
  if (paliers.length === 0) return null;
  const palierActuel = [...paliers].reverse().find(p => ca >= p.seuil_min) ?? null;
  const palierSuivant = paliers.find(p => p.seuil_min > ca) ?? null;
  const pct = palierSuivant
    ? Math.min(100, ((ca - (palierActuel?.seuil_min ?? 0)) / (palierSuivant.seuil_min - (palierActuel?.seuil_min ?? 0))) * 100)
    : 100;
  return (
    <div className="card card-inner mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-ink-600 uppercase tracking-wide">Fidélité</p>
          {palierActuel && <MedailleBadge palier={palierActuel} />}
        </div>
        <p className="text-xs text-ink-400">{fmt(ca)} CA payé</p>
      </div>
      <div className="w-full h-2.5 bg-ink-100 rounded-full overflow-hidden mb-1.5">
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: palierActuel?.couleur ?? "#e5e7eb" }} />
      </div>
      <div className="flex justify-between text-xs text-ink-400">
        {palierActuel
          ? <span>{palierActuel.label} — remise {palierActuel.remise_pct}%</span>
          : <span>Aucun palier atteint</span>}
        {palierSuivant
          ? <span>Prochain : {palierSuivant.label} à {fmt(palierSuivant.seuil_min)} ({fmt(Math.max(0, palierSuivant.seuil_min - ca))} restants)</span>
          : <span className="text-amber-500">🏆 Palier maximum atteint</span>}
      </div>
    </div>
  );
}

export default function ClientDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [devis, setDevis] = useState<Devis[]>([]);
  const [factures, setFactures] = useState<Facture[]>([]);
  const [paliers, setPaliers] = useState<Palier[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [tab, setTab] = useState<"infos" | "logement" | "tableau" | "documents" | "interventions" | "photos" | "notes">("infos");
  const [editInfos, setEditInfos] = useState(false);
  const [editLogement, setEditLogement] = useState(false);
  const [editNotes, setEditNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [form, setForm] = useState<Partial<Client>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadData() {
    const [{ data: c }, { data: d }, { data: f }, { data: p }, { data: iv }] = await Promise.all([
      supabase.from("clients").select("*").eq("id", id).single(),
      supabase.from("devis").select("*").eq("client_id", id).order("created_at", { ascending: false }),
      supabase.from("factures").select("*").eq("client_id", id).order("created_at", { ascending: false }),
      supabase.from("paliers_fidelite").select("*").order("seuil_min"),
      supabase.from("interventions").select("*").eq("client_id", id).order("date_debut", { ascending: false }),
    ]);
    if (c) { setClient(c); setNotes(c.notes ?? ""); setForm(c); }
    setDevis(d ?? []);
    setFactures(f ?? []);
    setPaliers(p ?? []);
    setInterventions((iv ?? []) as Intervention[]);
  }

  useEffect(() => {
    loadData();
    window.addEventListener("focus", loadData);
    return () => window.removeEventListener("focus", loadData);
  }, [id]);

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const caPayé = factures.filter(f => f.statut === "payee").reduce((a, f) => a + f.total_ttc, 0);
  const palierActuel = [...paliers].reverse().find(p => caPayé >= p.seuil_min) ?? null;

  async function saveInfos() {
    setSaving(true);
    await supabase.from("clients").update({
      nom: form.nom, prenom: form.prenom, telephone: form.telephone,
      email: form.email, adresse: form.adresse, code_postal: form.code_postal,
      ville: form.ville, contact_prefere: form.contact_prefere,
      disponibilites: form.disponibilites, source: form.source, statut: form.statut,
    }).eq("id", id);
    setClient(c => c ? { ...c, ...form } : c);
    setEditInfos(false); setSaving(false);
  }

  async function saveLogement() {
    setSaving(true);
    await supabase.from("clients").update({
      type_logement: form.type_logement,
      annee_construction: form.annee_construction ? parseInt(String(form.annee_construction)) : null,
      surface_m2: form.surface_m2 ? parseInt(String(form.surface_m2)) : null,
      tableau_marque: form.tableau_marque,
      code_acces: form.code_acces,
    }).eq("id", id);
    setClient(c => c ? { ...c, ...form } : c);
    setEditLogement(false); setSaving(false);
  }

  async function saveNotes() {
    await supabase.from("clients").update({ notes }).eq("id", id);
    setClient(c => c ? { ...c, notes } : c);
    setEditNotes(false);
  }

  async function deleteClient() {
    await supabase.from("clients").delete().eq("id", id);
    router.push("/clients");
  }

  async function addPhotos(files: FileList | null) {
    if (!files || !client) return;
    setUploading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const newUrls: string[] = [];
    for (const file of Array.from(files)) {
      const path = `${user.id}/${Date.now()}-${file.name}`;
      const { data } = await supabase.storage.from("client-photos").upload(path, file);
      if (data) {
        const { data: u } = supabase.storage.from("client-photos").getPublicUrl(path);
        newUrls.push(u.publicUrl);
      }
    }
    const updated = [...(client.photos ?? []), ...newUrls];
    await supabase.from("clients").update({ photos: updated }).eq("id", id);
    setClient(c => c ? { ...c, photos: updated } : c);
    setUploading(false);
  }

  async function removePhoto(url: string) {
    if (!client) return;
    try {
      const bucketUrl = url.split("/storage/v1/object/public/client-photos/")[1];
      if (bucketUrl) await supabase.storage.from("client-photos").remove([decodeURIComponent(bucketUrl)]);
    } catch (e) { console.error(e); }
    const updated = (client.photos ?? []).filter(p => p !== url);
    await supabase.from("clients").update({ photos: updated }).eq("id", id);
    setClient(c => c ? { ...c, photos: updated } : c);
    if (lightbox !== null) setLightbox(null);
  }

  function prevPhoto() {
    if (!client?.photos || lightbox === null) return;
    setLightbox((lightbox - 1 + client.photos.length) % client.photos.length);
  }
  function nextPhoto() {
    if (!client?.photos || lightbox === null) return;
    setLightbox((lightbox + 1) % client.photos.length);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (lightbox === null) return;
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowLeft") prevPhoto();
      if (e.key === "ArrowRight") nextPhoto();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, client]);

  if (!client) return <Shell><div className="p-8 text-center text-ink-400">Chargement…</div></Shell>;

  const tabs = [
    { id: "infos",         label: "Infos" },
    { id: "logement",      label: "Logement" },
    { id: "tableau",       label: "⚡ Tableau" },
    { id: "documents",     label: `Documents (${devis.length + factures.length})` },
    { id: "interventions", label: `Interventions (${interventions.length})` },
    { id: "photos",        label: `Photos (${client.photos?.length ?? 0})` },
    { id: "notes",         label: "Notes" },
  ] as const;

  const photos = client.photos ?? [];

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-3xl mx-auto">

        {lightbox !== null && photos.length > 0 && (
          <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center" onClick={() => setLightbox(null)}>
            <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 z-10"><X size={20} /></button>
            <button onClick={e => { e.stopPropagation(); removePhoto(photos[lightbox]); }} className="absolute top-4 left-4 w-10 h-10 rounded-full bg-red-500/80 flex items-center justify-center text-white hover:bg-red-600 z-10"><Trash2 size={16} /></button>
            {photos.length > 1 && <button onClick={e => { e.stopPropagation(); prevPhoto(); }} className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 z-10"><ChevronLeft size={20} /></button>}
            <img src={photos[lightbox]} alt="" className="max-w-full max-h-full object-contain rounded-lg select-none" style={{ maxWidth: "90vw", maxHeight: "90vh" }} onClick={e => e.stopPropagation()} />
            {photos.length > 1 && <button onClick={e => { e.stopPropagation(); nextPhoto(); }} className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 z-10"><ChevronRight size={20} /></button>}
            <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-sm">{lightbox + 1} / {photos.length}</p>
          </div>
        )}

        {confirmDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
              <h3 className="font-semibold text-ink-900 text-lg mb-2">Supprimer ce client ?</h3>
              <p className="text-sm text-ink-500 mb-5">Cette action est irréversible. Toutes les données de <strong>{client.prenom ? `${client.prenom} ${client.nom}` : client.nom}</strong> seront supprimées.</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDelete(false)} className="btn-ghost flex-1 justify-center">Annuler</button>
                <button onClick={deleteClient} className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl px-4 py-2.5 text-sm transition-colors"><Trash2 size={14} /> Supprimer</button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 mb-6">
          <Link href="/clients" className="btn-ghost !px-2.5 !py-2"><ArrowLeft size={16} /></Link>
          <div className="w-12 h-12 rounded-full bg-ink-900 flex items-center justify-center text-volt-400 font-semibold shrink-0">
            {initiales(client.nom, client.prenom)}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-2xl text-ink-900">{client.prenom ? `${client.prenom} ${client.nom}` : client.nom}</h1>
              {palierActuel && <MedailleBadge palier={palierActuel} />}
            </div>
            {client.statut && <span className={cn("badge text-xs", STATUT_COLORS[client.statut])}>{STATUT_LABELS[client.statut]}</span>}
          </div>
          <button onClick={() => setConfirmDelete(true)} className="btn-ghost !px-2.5 !py-2 text-red-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={16} /></button>
          <Link href={`/devis/nouveau?client=${id}`} className="btn-volt text-xs !py-2"><Plus size={14} /> Devis</Link>
        </div>

        <BarreFidelite ca={caPayé} paliers={paliers} />

        <div className="grid grid-cols-4 gap-3 mb-5">
          <div className="card card-inner text-center !py-4">
            <p className="text-xs text-ink-400 mb-1">CA payé</p>
            <p className="text-lg font-bold text-volt-600">{fmt(caPayé)}</p>
          </div>
          <div className="card card-inner text-center !py-4">
            <p className="text-xs text-ink-400 mb-1">Devis</p>
            <p className="text-lg font-bold text-ink-900">{devis.length}</p>
          </div>
          <div className="card card-inner text-center !py-4">
            <p className="text-xs text-ink-400 mb-1">Factures</p>
            <p className="text-lg font-bold text-ink-900">{factures.length}</p>
          </div>
          <div className="card card-inner text-center !py-4">
            <p className="text-xs text-ink-400 mb-1">Interventions</p>
            <p className="text-lg font-bold text-ink-900">{interventions.length}</p>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto mb-5 pb-1">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={cn("px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-all font-medium",
                tab === t.id ? "bg-ink-900 text-volt-400" : "text-ink-500 hover:bg-ink-100")}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "infos" && (
          <div className="card card-inner">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-ink-800 text-sm uppercase tracking-wide">Coordonnées</h2>
              {editInfos ? (
                <div className="flex gap-2">
                  <button onClick={() => { setEditInfos(false); setForm(client); }} className="btn-ghost text-xs !py-1">Annuler</button>
                  <button onClick={saveInfos} disabled={saving} className="btn-volt text-xs !py-1"><Save size={12} /> {saving ? "…" : "Sauvegarder"}</button>
                </div>
              ) : (
                <button onClick={() => setEditInfos(true)} className="btn-ghost text-xs !py-1"><Pencil size={12} /> Modifier</button>
              )}
            </div>
            {editInfos ? (
              <div className="grid grid-cols-2 gap-3">
                <F label="Prénom" k="prenom" form={form} set={setF} />
                <F label="Nom *" k="nom" form={form} set={setF} />
                <F label="Téléphone" k="telephone" type="tel" form={form} set={setF} />
                <F label="Email" k="email" type="email" form={form} set={setF} />
                <F label="Adresse" k="adresse" col2 form={form} set={setF} />
                <F label="Code postal" k="code_postal" form={form} set={setF} />
                <F label="Ville" k="ville" form={form} set={setF} />
                <S label="Contact préféré" k="contact_prefere" form={form} set={setF} options={[["telephone","Téléphone"],["sms","SMS"],["email","Email"]]} />
                <S label="Statut" k="statut" form={form} set={setF} options={[["actif","Actif"],["vip","VIP"],["inactif","Inactif"]]} />
                <F label="Disponibilités" k="disponibilites" col2 placeholder="Ex : matin uniquement" form={form} set={setF} />
                <F label="Source" k="source" col2 placeholder="Bouche-à-oreille, Google…" form={form} set={setF} />
              </div>
            ) : (
              <div className="space-y-3">
                {client.telephone && (
                  <div className="flex items-center gap-3">
                    <Phone size={15} className="text-ink-400 shrink-0" />
                    <a href={`tel:${client.telephone}`} className="text-sm text-emerald-600 font-semibold hover:underline">{client.telephone}</a>
                  </div>
                )}
                {client.email && <div className="flex items-center gap-3"><Mail size={15} className="text-ink-400" /><span className="text-sm">{client.email}</span></div>}
                {(client.adresse || client.ville) && (
                  <div className="flex items-center gap-3">
                    <MapPin size={15} className="text-ink-400 shrink-0" />
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([client.adresse, client.code_postal, client.ville].filter(Boolean).join(", "))}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-sm text-volt-600 hover:underline">
                      {[client.adresse, client.code_postal, client.ville].filter(Boolean).join(", ")}
                    </a>
                  </div>
                )}
                {client.contact_prefere && <div className="flex items-center gap-3 text-sm"><span className="text-ink-400 w-28 text-xs">Contact préféré</span>{client.contact_prefere}</div>}
                {client.disponibilites && <div className="flex items-start gap-3 text-sm"><span className="text-ink-400 w-28 text-xs shrink-0">Disponibilités</span>{client.disponibilites}</div>}
                {client.source && <div className="flex items-center gap-3 text-sm"><span className="text-ink-400 w-28 text-xs">Source</span>{client.source}</div>}
                {!client.telephone && !client.email && !client.adresse && <p className="text-ink-400 text-sm text-center py-4">Aucune coordonnée. Cliquez sur Modifier.</p>}
              </div>
            )}
          </div>
        )}

        {tab === "logement" && (
          <div className="card card-inner">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-ink-800 text-sm uppercase tracking-wide">Logement</h2>
              {editLogement ? (
                <div className="flex gap-2">
                  <button onClick={() => { setEditLogement(false); setForm(client); }} className="btn-ghost text-xs !py-1">Annuler</button>
                  <button onClick={saveLogement} disabled={saving} className="btn-volt text-xs !py-1"><Save size={12} /> {saving ? "…" : "Sauvegarder"}</button>
                </div>
              ) : (
                <button onClick={() => setEditLogement(true)} className="btn-ghost text-xs !py-1"><Pencil size={12} /> Modifier</button>
              )}
            </div>
            {editLogement ? (
              <div className="grid grid-cols-2 gap-3">
                <S label="Type" k="type_logement" form={form} set={setF} options={[["maison","Maison individuelle"],["appartement","Appartement"],["local","Local commercial"]]} />
                <F label="Année construction" k="annee_construction" type="number" placeholder="1985" form={form} set={setF} />
                <F label="Surface (m²)" k="surface_m2" type="number" form={form} set={setF} />
                <F label="Marque tableau" k="tableau_marque" placeholder="Schneider" form={form} set={setF} />
                <F label="Code d'accès" k="code_acces" col2 placeholder="Digicode, badge…" form={form} set={setF} />
              </div>
            ) : (
              <div className="space-y-3">
                {client.type_logement && <div className="flex items-center gap-3"><Home size={15} className="text-ink-400" /><span className="text-sm">{client.type_logement}{client.annee_construction ? ` · ${client.annee_construction}` : ""}{client.surface_m2 ? ` · ${client.surface_m2} m²` : ""}</span></div>}
                {client.tableau_marque && <div className="text-sm"><span className="text-ink-400 text-xs mr-2">Marque tableau</span>{client.tableau_marque}</div>}
                {client.code_acces && <div className="flex items-center gap-3"><Key size={15} className="text-ink-400" /><span className="text-sm font-mono bg-ink-100 px-2 py-0.5 rounded">{client.code_acces}</span></div>}
                {!client.type_logement && !client.tableau_marque && !client.code_acces && <p className="text-ink-400 text-sm text-center py-4">Aucune info logement. Cliquez sur Modifier.</p>}
              </div>
            )}
          </div>
        )}

        {tab === "tableau" && (
          <div className="space-y-3">
            <TableauClientWidget clientId={id} />
          </div>
        )}

        {tab === "documents" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-2 px-1">Devis ({devis.length})</h3>
              {devis.length === 0 ? (
                <div className="card card-inner text-center py-6">
                  <p className="text-ink-400 text-sm mb-3">Aucun devis</p>
                  <Link href={`/devis/nouveau?client=${id}`} className="btn-volt inline-flex text-xs"><Plus size={13} /> Créer un devis</Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {devis.map(d => (
                    <Link key={d.id} href={`/devis/${d.id}`} className="card card-inner flex items-center gap-3 hover:border-volt-400 transition-colors">
                      <FileText size={15} className="text-ink-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{d.numero}</p>
                        <p className="text-xs text-ink-400 truncate">{d.objet ? `${d.objet} · ` : ""}{fmtDate(d.date_emission)}</p>
                      </div>
                      <span className={cn("badge shrink-0", STATUT_COLORS[d.statut])}>{STATUT_LABELS[d.statut]}</span>
                      <span className="font-bold text-volt-600 shrink-0">{fmt(d.total_ttc)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-2 px-1">Factures ({factures.length})</h3>
              {factures.length === 0 ? (
                <div className="card card-inner text-center py-6">
                  <p className="text-ink-400 text-sm">Aucune facture — convertissez un devis signé.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {factures.map(f => (
                    <Link key={f.id} href={`/factures/${f.id}`} className="card card-inner flex items-center gap-3 hover:border-volt-400 transition-colors">
                      <Receipt size={15} className="text-ink-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{f.numero}</p>
                        <p className="text-xs text-ink-400 truncate">{f.objet ? `${f.objet} · ` : ""}{fmtDate(f.date_emission)}</p>
                      </div>
                      <span className={cn("badge shrink-0", STATUT_COLORS[f.statut])}>{STATUT_LABELS[f.statut]}</span>
                      <span className={cn("font-bold shrink-0", ["impayee","relance"].includes(f.statut) ? "text-red-600" : "text-emerald-600")}>{fmt(f.total_ttc)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "interventions" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-ink-400">{interventions.length} intervention{interventions.length > 1 ? "s" : ""}</p>
              <Link
                href={`/planning?planifier=1&client_id=${id}&titre=&adresse=${encodeURIComponent([client.adresse, client.code_postal, client.ville].filter(Boolean).join(" "))}`}
                className="btn-ghost text-xs !py-1.5">
                <CalendarDays size={13} /> Planifier
              </Link>
            </div>
            {interventions.length === 0 ? (
              <div className="card card-inner text-center py-10">
                <CalendarDays size={32} className="mx-auto mb-3 text-ink-200" />
                <p className="text-ink-400 text-sm mb-3">Aucune intervention</p>
                <Link
                  href={`/planning?planifier=1&client_id=${id}&titre=&adresse=${encodeURIComponent([client.adresse, client.code_postal, client.ville].filter(Boolean).join(" "))}`}
                  className="btn-volt inline-flex text-xs">
                  <CalendarDays size={13} /> Planifier une intervention
                </Link>
              </div>
            ) : (
              interventions.map(iv => {
                const cfg = STATUT_IV_CONFIG[iv.statut] ?? STATUT_IV_CONFIG.planifie;
                return (
                  <div key={iv.id} className="card card-inner">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", cfg.bg, cfg.color)}>
                            {cfg.label}
                          </span>
                          <span className="font-semibold text-sm text-ink-900 truncate">{iv.titre}</span>
                        </div>
                        <p className="text-xs text-ink-500 capitalize">
                          {fmtDate(iv.date_debut)}
                        </p>
                        {iv.adresse_chantier && (
                          <p className="text-xs text-ink-400 mt-0.5">{iv.adresse_chantier}</p>
                        )}
                        {iv.description && (
                          <p className="text-xs text-ink-500 mt-1 line-clamp-2">{iv.description}</p>
                        )}
                      </div>
                      <Link href={`/planning`} className="text-ink-300 hover:text-volt-500 shrink-0 mt-0.5">
                        <CalendarDays size={15} />
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === "photos" && (
          <div>
            <div className="flex justify-between items-center mb-3">
              <p className="text-sm text-ink-500">Photos du chantier / logement</p>
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-ghost text-xs !py-1.5">
                <Camera size={14} /> {uploading ? "Upload…" : "Ajouter"}
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={e => addPhotos(e.target.files)} />
            </div>
            {photos.length === 0 ? (
              <button onClick={() => fileRef.current?.click()} className="w-full border-2 border-dashed border-ink-200 rounded-2xl py-12 flex flex-col items-center gap-2 text-ink-400 hover:border-volt-400 transition-colors">
                <Camera size={32} /><span className="text-sm">Prendre ou importer des photos</span>
              </button>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {photos.map((url, i) => (
                  <div key={i} className="relative aspect-square rounded-2xl overflow-hidden bg-ink-100 group cursor-pointer" onClick={() => setLightbox(i)}>
                    <img src={url} alt="" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-2xl" />
                  </div>
                ))}
                <button onClick={() => fileRef.current?.click()} className="aspect-square rounded-2xl border-2 border-dashed border-ink-200 flex items-center justify-center text-ink-400 hover:border-volt-400 transition-colors">
                  <Camera size={24} />
                </button>
              </div>
            )}
          </div>
        )}

        {tab === "notes" && (
          <div className="card card-inner">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-ink-400 uppercase tracking-wide font-semibold">Notes privées</p>
              {editNotes ? (
                <div className="flex gap-2">
                  <button onClick={() => { setEditNotes(false); setNotes(client.notes ?? ""); }} className="btn-ghost text-xs !py-1">Annuler</button>
                  <button onClick={saveNotes} className="btn-volt text-xs !py-1"><Save size={12} /> Sauvegarder</button>
                </div>
              ) : (
                <button onClick={() => setEditNotes(true)} className="btn-ghost text-xs !py-1"><Pencil size={12} /> Modifier</button>
              )}
            </div>
            {editNotes ? (
              <textarea className="input min-h-[160px] resize-none" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes sur le client, travaux futurs, préférences…" />
            ) : (
              <p className="text-sm text-ink-700 whitespace-pre-wrap min-h-[80px]">
                {client.notes || <span className="text-ink-400 italic">Aucune note. Cliquez sur Modifier pour en ajouter.</span>}
              </p>
            )}
          </div>
        )}

      </div>
    </Shell>
  );
}
