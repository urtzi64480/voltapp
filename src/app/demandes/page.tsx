"use client";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Client } from "@/types";
import { cn, fmtDate } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus, X, Save, Trash2, Camera, ChevronRight,
  User, Calendar, FileText, CheckCircle, Clock, ArrowLeft,
} from "lucide-react";

interface Demande {
  id: string;
  user_id: string;
  client_id: string | null;
  date_visite: string;
  description: string | null;
  photos: string[];
  statut: "nouveau" | "devis_en_cours" | "devis_fait";
  devis_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  client?: Client;
}

const STATUT_CONFIG: Record<Demande["statut"], { label: string; color: string; bg: string; icon: any }> = {
  nouveau:        { label: "Nouveau",        color: "text-blue-700",   bg: "bg-blue-100",   icon: Clock },
  devis_en_cours: { label: "Devis en cours", color: "text-amber-700",  bg: "bg-amber-100",  icon: FileText },
  devis_fait:     { label: "Devis fait",     color: "text-emerald-700", bg: "bg-emerald-100", icon: CheckCircle },
};

// ── Sous-composants définis HORS du parent ────────────────────────────────

function StatutBadge({ statut }: { statut: Demande["statut"] }) {
  const cfg = STATUT_CONFIG[statut];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium", cfg.bg, cfg.color)}>
      <Icon size={11} /> {cfg.label}
    </span>
  );
}

function PhotoGrid({ photos, onAdd, onRemove, uploading }: {
  photos: string[]; onAdd: (file: File) => void; onRemove: (path: string) => void; uploading: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  function getUrl(path: string) {
    return supabase.storage.from("intervention-photos").getPublicUrl(path).data.publicUrl;
  }

  return (
    <div>
      {lightbox && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center" onClick={() => setLightbox(null)}>
          <button onClick={e => { e.stopPropagation(); onRemove(lightbox); setLightbox(null); }}
            className="absolute top-4 left-4 w-10 h-10 rounded-full bg-red-500/80 flex items-center justify-center text-white hover:bg-red-600 z-10">
            <Trash2 size={16} />
          </button>
          <button onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 z-10">
            <X size={20} />
          </button>
          <img src={getUrl(lightbox)} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" onClick={e => e.stopPropagation()} />
        </div>
      )}
      <div className="flex items-center justify-between mb-2">
        <label className="label">Photos</label>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex items-center gap-1.5 text-xs text-volt-700 font-medium hover:text-volt-600 disabled:opacity-40">
          <Camera size={13} /> {uploading ? "Upload…" : "Ajouter"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) { onAdd(f); e.target.value = ""; } }} />
      </div>
      {photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <div key={i} className="relative group aspect-square cursor-pointer" onClick={() => setLightbox(p)}>
              <img src={getUrl(p)} alt={`Photo ${i + 1}`} className="w-full h-full object-cover rounded-lg" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg transition-colors" />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-400 italic">Aucune photo</p>
      )}
    </div>
  );
}

function DemandeCard({ demande, onClick }: { demande: Demande; onClick: () => void }) {
  const client = demande.client;
  return (
    <button onClick={onClick}
      className="w-full card card-inner text-left hover:border-volt-300 hover:shadow-sm transition-all flex items-start gap-3">
      <div className="w-9 h-9 rounded-full bg-ink-900 flex items-center justify-center text-volt-400 text-sm font-bold shrink-0">
        {client ? (client.prenom?.[0] ?? client.nom[0]).toUpperCase() : "?"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <p className="font-semibold text-ink-900 text-sm truncate">
            {client ? `${client.prenom ?? ""} ${client.nom}`.trim() : "Sans client"}
          </p>
          <StatutBadge statut={demande.statut} />
        </div>
        {demande.description && (
          <p className="text-xs text-ink-500 line-clamp-2">{demande.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1.5">
          <span className="flex items-center gap-1 text-xs text-ink-400">
            <Calendar size={11} /> {fmtDate(demande.date_visite)}
          </span>
          {demande.photos.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-ink-400">
              <Camera size={11} /> {demande.photos.length}
            </span>
          )}
          {demande.devis_id && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
              <FileText size={11} /> Devis lié
            </span>
          )}
        </div>
      </div>
      <ChevronRight size={16} className="text-ink-300 shrink-0 mt-1" />
    </button>
  );
}

// ── Page principale ───────────────────────────────────────────────────────

export default function DemandesPage() {
  const router = useRouter();
  const [demandes, setDemandes] = useState<Demande[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Demande | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [filtreStatut, setFiltreStatut] = useState<Demande["statut"] | "tous">("tous");

  // Form state
  const [formClientId, setFormClientId] = useState("");
  const [formDateVisite, setFormDateVisite] = useState(new Date().toISOString().split("T")[0]);
  const [formDescription, setFormDescription] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formStatut, setFormStatut] = useState<Demande["statut"]>("nouveau");
  const [formPhotos, setFormPhotos] = useState<string[]>([]);
  const [formId, setFormId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("demandes")
      .select("*, client:clients(id, nom, prenom, telephone, email, adresse, code_postal, ville)")
      .order("date_visite", { ascending: false });
    setDemandes((data ?? []) as Demande[]);
    setLoading(false);
  }

  useEffect(() => {
    Promise.all([
      load(),
      supabase.from("clients").select("id, nom, prenom").order("nom").then(({ data }) => setClients((data ?? []) as any)),
    ]);
  }, []);

  function resetForm() {
    setFormClientId(""); setFormDateVisite(new Date().toISOString().split("T")[0]);
    setFormDescription(""); setFormNotes(""); setFormStatut("nouveau");
    setFormPhotos([]); setFormId(null);
  }

  function openCreate() {
    resetForm();
    setShowForm(true);
    setSelected(null);
  }

  function openEdit(d: Demande) {
    setFormId(d.id);
    setFormClientId(d.client_id ?? "");
    setFormDateVisite(d.date_visite);
    setFormDescription(d.description ?? "");
    setFormNotes(d.notes ?? "");
    setFormStatut(d.statut);
    setFormPhotos(d.photos ?? []);
    setSelected(null);
    setShowForm(true);
  }

  async function save() {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const payload = {
      user_id: user.id,
      client_id: formClientId || null,
      date_visite: formDateVisite,
      description: formDescription || null,
      notes: formNotes || null,
      statut: formStatut,
      photos: formPhotos,
    };

    if (formId) {
      await supabase.from("demandes").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", formId);
    } else {
      await supabase.from("demandes").insert(payload);
    }

    await load();
    setShowForm(false);
    resetForm();
    setSaving(false);
  }

  async function deleteDemande() {
    if (!selected) return;
    // Supprimer les photos du storage
    if (selected.photos.length > 0) {
      await supabase.storage.from("intervention-photos").remove(selected.photos);
    }
    await supabase.from("demandes").delete().eq("id", selected.id);
    setSelected(null);
    setConfirmDelete(false);
    await load();
  }

  async function handlePhotoAdd(file: File) {
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `demandes/${formId ?? "new-" + Date.now()}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("intervention-photos").upload(path, file);
    if (!error) setFormPhotos(prev => [...prev, path]);
    setUploading(false);
  }

  async function handlePhotoRemove(path: string) {
    try { await supabase.storage.from("intervention-photos").remove([path]); } catch {}
    setFormPhotos(prev => prev.filter(p => p !== path));
    if (formId) {
      const newPhotos = formPhotos.filter(p => p !== path);
      await supabase.from("demandes").update({ photos: newPhotos }).eq("id", formId);
      await load();
    }
  }

  function creerDevis(d: Demande) {
    const client = d.client;
    const params = new URLSearchParams();
    if (d.client_id) params.set("client", d.client_id);
    if (d.description) params.set("objet", d.description.slice(0, 80));
    router.push(`/devis/nouveau?${params.toString()}`);
  }

  const filtered = filtreStatut === "tous"
    ? demandes
    : demandes.filter(d => d.statut === filtreStatut);

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-3xl mx-auto">

        {/* Confirm delete */}
        {confirmDelete && selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
              <h3 className="font-semibold text-ink-900 text-lg mb-2">Supprimer cette demande ?</h3>
              <p className="text-sm text-ink-500 mb-5">Les photos associées seront également supprimées.</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDelete(false)} className="btn-ghost flex-1 justify-center">Annuler</button>
                <button onClick={deleteDemande}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl px-4 py-2.5 text-sm transition-colors">
                  <Trash2 size={14} /> Supprimer
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-3xl text-ink-900">Demandes</h1>
            <p className="text-ink-500 text-sm mt-1">
              {demandes.length} demande{demandes.length > 1 ? "s" : ""}
            </p>
          </div>
          <button onClick={openCreate} className="btn-volt">
            <Plus size={16} /> Nouvelle
          </button>
        </div>

        {/* Filtres statut */}
        <div className="flex gap-2 flex-wrap mb-5">
          {([["tous", "Toutes"], ["nouveau", "Nouvelles"], ["devis_en_cours", "En cours"], ["devis_fait", "Devis fait"]] as const).map(([val, label]) => (
            <button key={val} onClick={() => setFiltreStatut(val)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                filtreStatut === val ? "bg-ink-900 text-volt-400 border-ink-900" : "bg-white border-ink-200 text-ink-500 hover:bg-ink-50")}>
              {label}
            </button>
          ))}
        </div>

        {/* Liste */}
        {loading && <div className="text-center py-10 text-ink-400">Chargement…</div>}

        {!loading && demandes.length === 0 && (
          <div className="card card-inner text-center py-16">
            <p className="text-ink-400 mb-2">Aucune demande</p>
            <p className="text-ink-300 text-sm mb-6">Enregistrez les demandes clients avant de créer les devis.</p>
            <button onClick={openCreate} className="btn-volt inline-flex"><Plus size={15} /> Nouvelle demande</button>
          </div>
        )}

        {!loading && demandes.length > 0 && filtered.length === 0 && (
          <div className="card card-inner text-center py-10">
            <p className="text-ink-400">Aucune demande dans cette catégorie</p>
          </div>
        )}

        <div className="space-y-3">
          {filtered.map(d => (
            <DemandeCard key={d.id} demande={d} onClick={() => setSelected(d)} />
          ))}
        </div>

        {/* Drawer détail */}
        {selected && !showForm && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/40" onClick={() => setSelected(null)} />
            <aside className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col">
              {/* Header drawer */}
              <div className="flex items-start justify-between p-5 border-b border-ink-100 shrink-0">
                <div className="flex-1 pr-4">
                  <StatutBadge statut={selected.statut} />
                  <h2 className="text-base font-semibold text-ink-900 mt-1">
                    {selected.client
                      ? `${selected.client.prenom ?? ""} ${selected.client.nom}`.trim()
                      : "Sans client"}
                  </h2>
                  <p className="text-xs text-ink-400 mt-0.5 flex items-center gap-1">
                    <Calendar size={11} /> {fmtDate(selected.date_visite)}
                  </p>
                </div>
                <button onClick={() => setSelected(null)} className="text-ink-400 hover:text-ink-700 p-1">
                  <X size={20} />
                </button>
              </div>

              {/* Corps drawer */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5">

                {/* Client */}
                {selected.client && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <User size={14} className="text-ink-400" />
                      <span className="text-sm font-medium text-ink-800">
                        {selected.client.prenom ?? ""} {selected.client.nom}
                      </span>
                    </div>
                    <Link href={`/clients/${selected.client_id}`}
                      className="text-xs text-volt-600 hover:underline">
                      Voir la fiche →
                    </Link>
                  </div>
                )}

                {/* Description */}
                {selected.description && (
                  <div className="bg-ink-50 rounded-xl p-3 text-sm text-ink-700 leading-relaxed">
                    {selected.description}
                  </div>
                )}

                {/* Notes */}
                {selected.notes && (
                  <div>
                    <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-1">Notes internes</p>
                    <p className="text-sm text-ink-600">{selected.notes}</p>
                  </div>
                )}

                {/* Photos */}
                <div>
                  <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-2">Photos</p>
                  {selected.photos.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {selected.photos.map((p, i) => (
                        <div key={i} className="aspect-square">
                          <img
                            src={supabase.storage.from("intervention-photos").getPublicUrl(p).data.publicUrl}
                            alt={`Photo ${i + 1}`}
                            className="w-full h-full object-cover rounded-lg"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-ink-400 italic">Aucune photo</p>
                  )}
                </div>

                {/* Devis lié */}
                {selected.devis_id && (
                  <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-emerald-600" />
                      <span className="text-sm font-medium text-emerald-800">Devis généré</span>
                    </div>
                    <Link href={`/devis/${selected.devis_id}`} className="text-xs text-emerald-700 font-semibold hover:underline">
                      Voir le devis →
                    </Link>
                  </div>
                )}
              </div>

              {/* Footer drawer */}
              <div className="p-4 pb-24 md:pb-4 border-t border-ink-100 flex gap-3 shrink-0 bg-white">
                <button onClick={() => { setConfirmDelete(true); }}
                  className="p-2.5 rounded-xl border border-red-200 text-red-500 hover:bg-red-50">
                  <Trash2 size={16} />
                </button>
                <button onClick={() => openEdit(selected)}
                  className="flex-1 py-2.5 rounded-xl border border-ink-200 text-ink-700 text-sm font-semibold hover:bg-ink-50">
                  Modifier
                </button>
                {!selected.devis_id && (
                  <button onClick={() => creerDevis(selected)}
                    className="flex-1 py-2.5 rounded-xl bg-volt-500 text-ink-900 text-sm font-semibold hover:bg-volt-400">
                    <FileText size={14} className="inline mr-1" /> Créer un devis
                  </button>
                )}
              </div>
            </aside>
          </div>
        )}

        {/* Modal formulaire */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40" onClick={() => { setShowForm(false); resetForm(); }} />
            <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100 shrink-0">
                <h3 className="font-semibold text-ink-900">
                  {formId ? "Modifier la demande" : "Nouvelle demande"}
                </h3>
                <button onClick={() => { setShowForm(false); resetForm(); }} className="text-ink-400 hover:text-ink-700">
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4">

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Client</label>
                    <select className="input" value={formClientId} onChange={e => setFormClientId(e.target.value)}>
                      <option value="">— Sans client —</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.prenom ? `${c.prenom} ${c.nom}` : c.nom}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Date de visite</label>
                    <input type="date" className="input" value={formDateVisite}
                      onChange={e => setFormDateVisite(e.target.value)} />
                  </div>
                </div>

                <div>
                  <label className="label">Description de la demande</label>
                  <textarea className="input resize-none" rows={5}
                    placeholder="Décrivez la demande du client, les travaux à réaliser, les contraintes…"
                    value={formDescription} onChange={e => setFormDescription(e.target.value)} />
                </div>

                <div>
                  <label className="label">Notes internes</label>
                  <textarea className="input resize-none" rows={2}
                    placeholder="Notes pour vous uniquement…"
                    value={formNotes} onChange={e => setFormNotes(e.target.value)} />
                </div>

                <div>
                  <label className="label">Statut</label>
                  <div className="flex gap-2 flex-wrap">
                    {(Object.keys(STATUT_CONFIG) as Demande["statut"][]).map(s => (
                      <button key={s} onClick={() => setFormStatut(s)}
                        className={cn("px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                          formStatut === s
                            ? cn(STATUT_CONFIG[s].bg, STATUT_CONFIG[s].color, "border-current")
                            : "bg-white border-ink-200 text-ink-500 hover:bg-ink-50")}>
                        {STATUT_CONFIG[s].label}
                      </button>
                    ))}
                  </div>
                </div>

                <PhotoGrid
                  photos={formPhotos}
                  onAdd={handlePhotoAdd}
                  onRemove={handlePhotoRemove}
                  uploading={uploading}
                />
              </div>

              <div className="flex gap-3 px-5 py-4 border-t border-ink-100 shrink-0">
                <button onClick={() => { setShowForm(false); resetForm(); }}
                  className="btn-ghost flex-1 justify-center">Annuler</button>
                <button onClick={save} disabled={saving || uploading}
                  className="btn-volt flex-1 justify-center">
                  <Save size={15} /> {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
