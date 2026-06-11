"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  ChevronLeft, ChevronRight, Plus, X, MapPin, FileText,
  Receipt, Camera, Trash2, Clock, User, ExternalLink,
  Calendar, Unlink,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Intervention, Client, Devis, StatutIntervention } from "@/types";
import Shell from "@/components/layout/Shell";

// ── Helpers ────────────────────────────────────────────────────────────────

const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MOIS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const HEURES = Array.from({ length: 14 }, (_, i) => i + 7); // 7h → 20h

const CLIENT_COLORS = [
  { bg: "bg-violet-100", color: "text-violet-700", border: "border-violet-300" },
  { bg: "bg-orange-100", color: "text-orange-700", border: "border-orange-300" },
  { bg: "bg-teal-100",   color: "text-teal-700",   border: "border-teal-300" },
  { bg: "bg-pink-100",   color: "text-pink-700",   border: "border-pink-300" },
  { bg: "bg-indigo-100", color: "text-indigo-700", border: "border-indigo-300" },
  { bg: "bg-lime-100",   color: "text-lime-700",   border: "border-lime-300" },
  { bg: "bg-cyan-100",   color: "text-cyan-700",   border: "border-cyan-300" },
  { bg: "bg-rose-100",   color: "text-rose-700",   border: "border-rose-300" },
];

function getClientColor(clientId?: string) {
  if (!clientId) return CLIENT_COLORS[0];
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) hash = clientId.charCodeAt(i) + ((hash << 5) - hash);
  return CLIENT_COLORS[Math.abs(hash) % CLIENT_COLORS.length];
}

const STATUT_CONFIG: Record<StatutIntervention, { label: string; color: string; bg: string }> = {
  planifie: { label: "Planifié",  color: "text-blue-700",  bg: "bg-blue-100" },
  en_cours: { label: "En cours",  color: "text-amber-700", bg: "bg-amber-100" },
  termine:  { label: "Terminé",   color: "text-green-700", bg: "bg-green-100" },
  annule:   { label: "Annulé",    color: "text-red-700",   bg: "bg-red-100" },
};

type CalSource = "google" | "apple";
type GCalEvent = { id: string; title: string; start: string; end: string; allDay: boolean; source?: CalSource };

function startOfMonth(y: number, m: number) { return new Date(y, m, 1); }
function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
function dayOfWeekMon(d: Date) { return (d.getDay() + 6) % 7; }
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmt(s: string) { return new Date(s).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }
function fmtDate(s: string) { return new Date(s).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }); }

function SourceBadge({ source }: { source?: CalSource }) {
  if (!source) return null;
  if (source === "google") return <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-500 text-white text-[9px] font-bold shrink-0">G</span>;
  return <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-600 text-white text-[9px] font-bold shrink-0">A</span>;
}

function VoltBadge() {
  return <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-volt-500 text-ink-900 text-[9px] font-bold shrink-0">V</span>;
}

// ── DocBadge ──────────────────────────────────────────────────────────────

function DocBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium",
      ok ? "bg-green-100 text-green-700" : "bg-ink-100 text-ink-400")}>
      {ok ? "✓" : "—"} {label}
    </span>
  );
}

// ── Formulaire ────────────────────────────────────────────────────────────

type FormData = {
  client_id: string; devis_id: string; titre: string; description: string;
  adresse_chantier: string; date_debut: string; date_fin: string;
  statut: StatutIntervention; notes: string;
};

const EMPTY_FORM: FormData = {
  client_id: "", devis_id: "", titre: "", description: "",
  adresse_chantier: "", date_debut: "", date_fin: "", statut: "planifie", notes: "",
};

function InterventionForm({ initial, clients, devis, gcalEvents, onSave, onCancel }: {
  initial: FormData; clients: Client[]; devis: Devis[]; gcalEvents: GCalEvent[];
  onSave: (data: FormData) => Promise<void>; onCancel: () => void;
}) {
  const [form, setForm] = useState<FormData>(initial);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<GCalEvent | null>(null);
  const set = (k: keyof FormData, v: string) => { setConflict(null); setForm(f => ({ ...f, [k]: v })); };
  const clientDevis = devis.filter(d => d.client_id === form.client_id);

  useEffect(() => {
    if (form.client_id && !form.adresse_chantier) {
      const c = clients.find(c => c.id === form.client_id);
      if (c) setForm(f => ({ ...f, adresse_chantier: [c.adresse, c.code_postal, c.ville].filter(Boolean).join(" ") }));
    }
  }, [form.client_id]);

  const handleSave = async () => {
    if (!form.titre || !form.date_debut || !form.date_fin) return;
    const debut = new Date(form.date_debut).getTime();
    const fin = new Date(form.date_fin).getTime();
    const conflictingEvent = gcalEvents.find(ev => {
      if (ev.allDay) return false;
      return debut < new Date(ev.end).getTime() && fin > new Date(ev.start).getTime();
    });
    if (conflictingEvent) { setConflict(conflictingEvent); return; }
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-ink-500 mb-1">Titre *</label>
        <input value={form.titre} onChange={e => set("titre", e.target.value)} placeholder="Ex: Remplacement tableau électrique"
          className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-volt-400" />
      </div>
      <div>
        <label className="block text-xs font-medium text-ink-500 mb-1">Client</label>
        <select value={form.client_id} onChange={e => set("client_id", e.target.value)}
          className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-volt-400">
          <option value="">— Aucun client —</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.prenom} {c.nom}</option>)}
        </select>
      </div>
      {form.client_id && (
        <div>
          <label className="block text-xs font-medium text-ink-500 mb-1">Devis lié</label>
          <select value={form.devis_id} onChange={e => set("devis_id", e.target.value)}
            className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-volt-400">
            <option value="">— Aucun —</option>
            {clientDevis.map(d => <option key={d.id} value={d.id}>{d.numero} — {d.objet || "Sans objet"}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-ink-500 mb-1">Adresse du chantier</label>
        <input value={form.adresse_chantier} onChange={e => set("adresse_chantier", e.target.value)} placeholder="Adresse du chantier"
          className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-volt-400" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink-500 mb-1">Début *</label>
          <input type="datetime-local" value={form.date_debut} onChange={e => set("date_debut", e.target.value)}
            className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-volt-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-500 mb-1">Fin *</label>
          <input type="datetime-local" value={form.date_fin} onChange={e => set("date_fin", e.target.value)}
            className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-volt-400" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-ink-500 mb-1">Description</label>
        <textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} placeholder="Détails de l'intervention…"
          className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-volt-400 resize-none" />
      </div>
      <div>
        <label className="block text-xs font-medium text-ink-500 mb-1">Statut</label>
        <select value={form.statut} onChange={e => set("statut", e.target.value as StatutIntervention)}
          className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-volt-400">
          {(Object.keys(STATUT_CONFIG) as StatutIntervention[]).map(s => (
            <option key={s} value={s}>{STATUT_CONFIG[s].label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-ink-500 mb-1">Notes internes</label>
        <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} placeholder="Notes internes…"
          className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-volt-400 resize-none" />
      </div>
      {conflict && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-sm font-semibold text-red-700 mb-1">⛔ Conflit calendrier</p>
          <div className="flex items-center gap-1.5">
            <SourceBadge source={conflict.source} />
            <span className="text-xs text-red-600 font-medium">{conflict.title}</span>
            <span className="text-xs text-red-500">· {fmt(conflict.start)} → {fmt(conflict.end)}</span>
          </div>
          <p className="text-xs text-red-500 mt-1">Modifiez les horaires pour continuer.</p>
        </div>
      )}
      <div className="flex gap-3 pt-2">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-ink-200 text-sm font-medium text-ink-600 hover:bg-ink-50">Annuler</button>
        <button onClick={handleSave} disabled={saving || !form.titre || !form.date_debut || !form.date_fin}
          className="flex-1 py-2.5 rounded-xl bg-volt-500 text-ink-900 text-sm font-semibold hover:bg-volt-400 disabled:opacity-40">
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

// ── Drawer intervention ───────────────────────────────────────────────────

function InterventionDrawer({ intervention, onClose, onEdit, onDelete, onMarkTermine, onPhotoUpload, getPhotoUrl }: {
  intervention: Intervention; onClose: () => void; onEdit: () => void; onDelete: () => void;
  onMarkTermine: () => void; onPhotoUpload: (file: File) => Promise<void>; getPhotoUrl: (path: string) => string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const devis = intervention.devis;
  const facture = devis?.factures?.[0];
  const cfg = STATUT_CONFIG[intervention.statut];

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true); await onPhotoUpload(file); setUploading(false); e.target.value = "";
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-ink-100 sticky top-0 bg-white z-10">
          <div className="flex-1 pr-4">
            <div className="flex items-center gap-2 mb-1">
              <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", cfg.bg, cfg.color)}>{cfg.label}</span>
              <VoltBadge />
            </div>
            <h2 className="text-base font-semibold text-ink-900 leading-snug">{intervention.titre}</h2>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 p-1"><X size={20} /></button>
        </div>
        <div className="flex-1 p-5 space-y-5">
          <div className="flex items-center gap-2 text-sm text-ink-600">
            <Clock size={14} className="text-ink-400" />
            <span className="capitalize">{fmtDate(intervention.date_debut)}</span>
            <span className="text-ink-400">·</span>
            <span>{fmt(intervention.date_debut)} → {fmt(intervention.date_fin)}</span>
          </div>
          {intervention.client && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-ink-700">
                <User size={14} className="text-ink-400" />
                <span className="font-medium">{intervention.client.prenom} {intervention.client.nom}</span>
              </div>
              <Link href={`/clients/${intervention.client_id}`} className="text-xs text-volt-600 hover:underline flex items-center gap-1">
                Voir fiche <ExternalLink size={11} />
              </Link>
            </div>
          )}
          {intervention.adresse_chantier && (
            <div className="flex items-start gap-2 text-sm">
              <MapPin size={14} className="text-ink-400 mt-0.5 shrink-0" />
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(intervention.adresse_chantier)}`}
                target="_blank" rel="noopener noreferrer" className="text-volt-600 hover:underline">
                {intervention.adresse_chantier}
              </a>
            </div>
          )}
          {intervention.description && (
            <div className="bg-ink-50 rounded-xl p-3 text-sm text-ink-700 leading-relaxed">{intervention.description}</div>
          )}
          {devis && (
            <div className="border border-ink-100 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide">Documents</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><FileText size={14} className="text-ink-400" /><span className="text-sm text-ink-700">{devis.numero}</span></div>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  <DocBadge ok={true} label="Fait" />
                  <DocBadge ok={!!devis.signature_data} label="Signé" />
                  <Link href={`/devis/${devis.id}`} className="ml-1"><ExternalLink size={13} className="text-ink-400 hover:text-volt-600" /></Link>
                </div>
              </div>
              {facture && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><Receipt size={14} className="text-ink-400" /><span className="text-sm text-ink-700">{facture.numero}</span></div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    <DocBadge ok={true} label="Envoyée" />
                    <DocBadge ok={!!facture.paye_le} label="Payée" />
                    <Link href={`/factures/${facture.id}`} className="ml-1"><ExternalLink size={13} className="text-ink-400 hover:text-volt-600" /></Link>
                  </div>
                </div>
              )}
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide">Photos</p>
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="flex items-center gap-1.5 text-xs text-volt-700 font-medium hover:text-volt-600 disabled:opacity-40">
                <Camera size={13} /> {uploading ? "Upload…" : "Ajouter"}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
            </div>
            {intervention.photos && intervention.photos.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {intervention.photos.map((p, i) => (
                  <img key={i} src={getPhotoUrl(p)} alt={`Photo ${i + 1}`} className="aspect-square object-cover rounded-lg" />
                ))}
              </div>
            ) : <p className="text-sm text-ink-400 italic">Aucune photo</p>}
          </div>
          {intervention.notes && (
            <div>
              <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm text-ink-600">{intervention.notes}</p>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-ink-100 flex gap-3 sticky bottom-0 bg-white">
          <button onClick={onDelete} className="p-2.5 rounded-xl border border-red-200 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
          {intervention.statut !== "termine" && new Date(intervention.date_fin) < new Date() && (
            <button onClick={onMarkTermine} className="flex-1 py-2.5 rounded-xl bg-green-500 text-white text-sm font-semibold hover:bg-green-600">✓ Marquer terminé</button>
          )}
          <button onClick={onEdit} className="flex-1 py-2.5 rounded-xl bg-volt-500 text-ink-900 text-sm font-semibold hover:bg-volt-400">Modifier</button>
        </div>
      </aside>
    </div>
  );
}

// ── Drawer event calendrier ───────────────────────────────────────────────

function CalDrawer({ event, onClose }: { event: GCalEvent; onClose: () => void }) {
  const isGoogle = event.source === "google";
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-ink-100">
          <div className="flex-1 pr-4">
            <div className="flex items-center gap-1.5 mb-1.5">
              <SourceBadge source={event.source} />
              <span className="text-xs text-ink-500">{isGoogle ? "Google Calendar" : "Apple Calendar"}</span>
            </div>
            <h2 className="text-base font-semibold text-ink-900">{event.title}</h2>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 p-1"><X size={20} /></button>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-2 text-sm text-ink-600">
            <Clock size={14} className="text-ink-400" />
            {event.allDay ? <span>Journée entière — {fmtDate(event.start)}</span>
              : <span className="capitalize">{fmtDate(event.start)} · {fmt(event.start)} → {fmt(event.end)}</span>}
          </div>
          <p className="text-xs text-ink-400 mt-4 italic">Événement en lecture seule.</p>
        </div>
      </aside>
    </div>
  );
}

// ── Vue Jour ─────────────────────────────────────────────────────────────

function DayView({
  year, month, day, interventions, calEvents, onBack, onCreateAt,
  onSelectIv, onSelectCal, onDropToTime,
}: {
  year: number; month: number; day: number;
  interventions: Intervention[]; calEvents: GCalEvent[];
  onBack: () => void; onCreateAt: (h: number, m: number) => void;
  onSelectIv: (iv: Intervention) => void; onSelectCal: (ev: GCalEvent) => void;
  onDropToTime: (ivId: string, h: number, m: number) => void;
}) {
  const date = new Date(year, month, day);
  const dayIvs = interventions.filter(iv => isSameDay(new Date(iv.date_debut), date))
    .sort((a, b) => new Date(a.date_debut).getTime() - new Date(b.date_debut).getTime());
  const dayEvs = calEvents.filter(ev => !ev.allDay && isSameDay(new Date(ev.start), date))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const allDayEvs = calEvents.filter(ev => ev.allDay && isSameDay(new Date(ev.start), date));

  const HOUR_PX = 60; // pixels par heure

  function topPx(dateStr: string) {
    const d = new Date(dateStr);
    return (d.getHours() - 7 + d.getMinutes() / 60) * HOUR_PX;
  }
  function heightPx(start: string, end: string) {
    const s = new Date(start), e = new Date(end);
    return Math.max(20, (e.getTime() - s.getTime()) / 3600000 * HOUR_PX);
  }

  const handleRowDragOver = (e: React.DragEvent, h: number) => { e.preventDefault(); };
  const handleRowDrop = (e: React.DragEvent, h: number) => {
    e.preventDefault();
    const ivId = e.dataTransfer.getData("intervention_id");
    if (!ivId) return;
    // Calculer la minute précise à partir de la position Y dans la cellule
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const minuteInHour = Math.round((relY / HOUR_PX) * 60);
    const totalMinutes = h * 60 + Math.max(0, Math.min(59, minuteInHour));
    onDropToTime(ivId, Math.floor(totalMinutes / 60), totalMinutes % 60);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-ink-100 text-ink-600">
          <ChevronLeft size={18} />
        </button>
        <h2 className="text-lg font-semibold text-ink-800 capitalize flex-1">{fmtDate(date.toISOString())}</h2>
        <button onClick={() => onCreateAt(8, 0)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-volt-500 text-ink-900 text-sm font-semibold hover:bg-volt-400">
          <Plus size={15} /> Intervention
        </button>
      </div>

      {/* Events journée entière */}
      {allDayEvs.length > 0 && (
        <div className="mb-3 space-y-1">
          {allDayEvs.map(ev => (
            <button key={ev.id} onClick={() => onSelectCal(ev)}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-medium text-left">
              <SourceBadge source={ev.source} /> {ev.title} <span className="text-gray-400">— Journée entière</span>
            </button>
          ))}
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto bg-white rounded-2xl border border-ink-100 shadow-sm">
        <div className="relative" style={{ minHeight: `${HOUR_PX * HEURES.length}px` }}>
          {/* Lignes heures */}
          {HEURES.map(h => (
            <div key={h}
              className="absolute w-full border-t border-ink-100 flex items-start"
              style={{ top: `${(h - 7) * HOUR_PX}px`, height: `${HOUR_PX}px` }}
              onDragOver={e => handleRowDragOver(e, h)}
              onDrop={e => handleRowDrop(e, h)}
              onClick={() => onCreateAt(h, 0)}>
              <span className="text-xs text-ink-400 w-12 shrink-0 pt-1 pl-2 select-none">{String(h).padStart(2, "0")}:00</span>
              <div className="flex-1 h-full cursor-pointer hover:bg-ink-50/50 transition-colors" />
            </div>
          ))}

          {/* Events Google/Apple */}
          {dayEvs.map(ev => (
            <button key={ev.id}
              onClick={e => { e.stopPropagation(); onSelectCal(ev); }}
              className="absolute left-14 right-2 rounded-lg px-2 py-1 text-xs bg-gray-100 text-gray-600 border border-gray-300 text-left overflow-hidden z-10 flex items-start gap-1.5"
              style={{ top: `${topPx(ev.start)}px`, height: `${heightPx(ev.start, ev.end)}px` }}>
              <SourceBadge source={ev.source} />
              <div className="min-w-0">
                <p className="font-medium truncate">{ev.title}</p>
                <p className="text-gray-400">{fmt(ev.start)} → {fmt(ev.end)}</p>
              </div>
            </button>
          ))}

          {/* Interventions VoltApp */}
          {dayIvs.map(iv => {
            const clientColor = getClientColor(iv.client_id);
            return (
              <button key={iv.id}
                onClick={e => { e.stopPropagation(); onSelectIv(iv); }}
                draggable
                onDragStart={e => { e.dataTransfer.setData("intervention_id", iv.id); e.stopPropagation(); }}
                className={cn(
                  "absolute left-14 right-2 rounded-lg px-2 py-1 text-xs text-left overflow-hidden z-20 flex items-start gap-1.5 border cursor-grab active:cursor-grabbing",
                  clientColor.bg, clientColor.color, clientColor.border
                )}
                style={{ top: `${topPx(iv.date_debut)}px`, height: `${heightPx(iv.date_debut, iv.date_fin)}px` }}>
                <VoltBadge />
                <div className="min-w-0">
                  <p className="font-medium truncate">{iv.titre}</p>
                  <p className="opacity-70">{fmt(iv.date_debut)} → {fmt(iv.date_fin)}</p>
                  {iv.client && <p className="opacity-60 truncate">{iv.client.nom}</p>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────

export default function PlanningPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [devis, setDevis] = useState<Devis[]>([]);
  const [loading, setLoading] = useState(true);
  const [dayView, setDayView] = useState<number | null>(null);

  // Calendriers externes
  const [gcalEvents, setGcalEvents] = useState<GCalEvent[]>([]);
  const [appleEvents, setAppleEvents] = useState<GCalEvent[]>([]);
  const [gcalConnected, setGcalConnected] = useState(false);
  const [appleConnected, setAppleConnected] = useState(false);
  const [gcalLoading, setGcalLoading] = useState(false);

  // Tous les events externes avec source
  const allCalEvents: GCalEvent[] = [
    ...gcalEvents.map(ev => ({ ...ev, source: "google" as CalSource })),
    ...appleEvents.map(ev => ({ ...ev, source: "apple" as CalSource })),
  ];

  // Drawers
  const [selected, setSelected] = useState<Intervention | null>(null);
  const [selectedCal, setSelectedCal] = useState<GCalEvent | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [formInit, setFormInit] = useState<FormData>(EMPTY_FORM);

  const fetchAll = async () => {
    setLoading(true);
    const from = new Date(year, month - 1, 1).toISOString();
    const to = new Date(year, month + 2, 0).toISOString();
    const [{ data: ivs }, { data: cls }, { data: dvs }] = await Promise.all([
      supabase.from("interventions").select(`*, client:clients(*), devis:devis(*, factures(*))`).gte("date_debut", from).lte("date_debut", to).order("date_debut"),
      supabase.from("clients").select("*").order("nom"),
      supabase.from("devis").select("*, factures(*)"),
    ]);
    setInterventions((ivs as Intervention[]) || []);
    setClients((cls as Client[]) || []);
    setDevis((dvs as Devis[]) || []);
    setLoading(false);
  };

  const fetchGcal = useCallback(async () => {
    setGcalLoading(true);
    try {
      const res = await fetch(`/api/google/events?year=${year}&month=${month}`);
      const data = await res.json();
      setGcalConnected(data.connected);
      setGcalEvents(data.events ?? []);
    } catch { setGcalConnected(false); }
    setGcalLoading(false);
  }, [year, month]);

  const fetchApple = useCallback(async () => {
    try {
      const res = await fetch(`/api/apple/events?year=${year}&month=${month}`);
      const data = await res.json();
      setAppleConnected(data.connected);
      setAppleEvents(data.events ?? []);
    } catch { setAppleConnected(false); }
  }, [year, month]);

  useEffect(() => { fetchAll(); fetchGcal(); fetchApple(); }, [year, month]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google") === "ok") { window.history.replaceState({}, "", "/planning"); fetchGcal(); }
    if (params.get("planifier") === "1") {
      const toLocal = (d: Date) => {
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      const base = new Date(); base.setHours(8, 0, 0, 0);
      const end = new Date(base); end.setHours(10, 0, 0, 0);
      setFormInit({
        client_id: params.get("client_id") ?? "", devis_id: params.get("devis_id") ?? "",
        titre: params.get("titre") ?? "", description: "",
        adresse_chantier: params.get("adresse") ?? "",
        date_debut: toLocal(base), date_fin: toLocal(end), statut: "planifie", notes: "",
      });
      setShowForm(true);
      window.history.replaceState({}, "", "/planning");
    }
  }, []);

  const connectGoogle = () => {
    const oauthParams = new URLSearchParams({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
      redirect_uri: `${window.location.origin}/api/google/callback`,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.readonly",
      access_type: "offline",
      prompt: "select_account consent",
    });
    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${oauthParams}`;
    window.location.href = `https://accounts.google.com/logout?continue=${encodeURIComponent(oauthUrl)}`;
  };

  const disconnectGoogle = async () => {
    await fetch("/api/google/disconnect", { method: "POST" });
    setGcalConnected(false); setGcalEvents([]);
  };

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  const firstDay = startOfMonth(year, month);
  const totalDays = daysInMonth(year, month);
  const startOffset = dayOfWeekMon(firstDay);
  const totalCells = Math.ceil((startOffset + totalDays) / 7) * 7;

  const cells: (number | null)[] = Array.from({ length: totalCells }, (_, i) => {
    const d = i - startOffset + 1;
    return d >= 1 && d <= totalDays ? d : null;
  });

  const ivsForDay = (day: number) => {
    const target = new Date(year, month, day);
    return interventions.filter(iv => isSameDay(new Date(iv.date_debut), target));
  };

  const calForDay = (day: number) => {
    const target = new Date(year, month, day);
    return allCalEvents.filter(ev => isSameDay(new Date(ev.start), target));
  };

  const handleCreate = async (form: FormData) => {
    await supabase.from("interventions").insert({
      client_id: form.client_id || null, devis_id: form.devis_id || null,
      titre: form.titre, description: form.description || null,
      adresse_chantier: form.adresse_chantier || null,
      date_debut: new Date(form.date_debut).toISOString(),
      date_fin: new Date(form.date_fin).toISOString(),
      statut: form.statut, notes: form.notes || null,
    });
    setShowForm(false); await fetchAll();
  };

  const handleUpdate = async (form: FormData) => {
    if (!selected) return;
    await supabase.from("interventions").update({
      client_id: form.client_id || null, devis_id: form.devis_id || null,
      titre: form.titre, description: form.description || null,
      adresse_chantier: form.adresse_chantier || null,
      date_debut: new Date(form.date_debut).toISOString(),
      date_fin: new Date(form.date_fin).toISOString(),
      statut: form.statut, notes: form.notes || null,
    }).eq("id", selected.id);
    setEditMode(false); setSelected(null); await fetchAll();
  };

  const handleDelete = async () => {
    if (!selected || !confirm("Supprimer cette intervention ?")) return;
    await supabase.from("interventions").delete().eq("id", selected.id);
    setSelected(null); await fetchAll();
  };

  const handleMarkTermine = async () => {
    if (!selected) return;
    await supabase.from("interventions").update({ statut: "termine" }).eq("id", selected.id);
    setSelected(null); await fetchAll();
  };

  const handleDrop = async (e: React.DragEvent, day: number) => {
    e.preventDefault();
    const ivId = e.dataTransfer.getData("intervention_id");
    if (!ivId) return;
    const iv = interventions.find(i => i.id === ivId);
    if (!iv) return;
    const oldDebut = new Date(iv.date_debut);
    const dureeMs = new Date(iv.date_fin).getTime() - oldDebut.getTime();
    const newDebut = new Date(year, month, day, oldDebut.getHours(), oldDebut.getMinutes());
    const newFin = new Date(newDebut.getTime() + dureeMs);
    const conflict = allCalEvents.find(ev => {
      if (ev.allDay) return false;
      return newDebut.getTime() < new Date(ev.end).getTime() && newFin.getTime() > new Date(ev.start).getTime();
    });
    if (conflict) { alert(`Impossible : conflit avec "${conflict.title}" dans votre calendrier.`); return; }
    await supabase.from("interventions").update({ date_debut: newDebut.toISOString(), date_fin: newFin.toISOString() }).eq("id", ivId);
    await fetchAll();
  };

  const handleDropToTime = async (ivId: string, h: number, m: number) => {
    const iv = interventions.find(i => i.id === ivId);
    if (!iv) return;
    const dureeMs = new Date(iv.date_fin).getTime() - new Date(iv.date_debut).getTime();
    const newDebut = new Date(year, month, dayView!, h, m, 0);
    const newFin = new Date(newDebut.getTime() + dureeMs);
    const conflict = allCalEvents.find(ev => {
      if (ev.allDay) return false;
      return newDebut.getTime() < new Date(ev.end).getTime() && newFin.getTime() > new Date(ev.start).getTime();
    });
    if (conflict) { alert(`Impossible : conflit avec "${conflict.title}".`); return; }
    await supabase.from("interventions").update({ date_debut: newDebut.toISOString(), date_fin: newFin.toISOString() }).eq("id", ivId);
    await fetchAll();
  };

  const handlePhotoUpload = async (file: File) => {
    if (!selected) return;
    const ext = file.name.split(".").pop();
    const path = `${selected.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("intervention-photos").upload(path, file);
    if (error) return;
    const current = selected.photos || [];
    await supabase.from("interventions").update({ photos: [...current, path] }).eq("id", selected.id);
    await fetchAll();
    const { data } = await supabase.from("interventions").select("*, client:clients(*), devis:devis(*, factures(*))").eq("id", selected.id).single();
    if (data) setSelected(data as Intervention);
  };

  const getPhotoUrl = (path: string) => {
    const { data } = supabase.storage.from("intervention-photos").getPublicUrl(path);
    return data.publicUrl;
  };

  const openCreate = (day?: number, h?: number, m?: number) => {
    const base = day ? new Date(year, month, day, h ?? 8, m ?? 0) : new Date();
    if (!day) base.setHours(8, 0, 0, 0);
    const end = new Date(base.getTime() + 2 * 3600000);
    const toLocal = (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    setFormInit({ ...EMPTY_FORM, date_debut: toLocal(base), date_fin: toLocal(end) });
    setShowForm(true);
  };

  const openEdit = () => {
    if (!selected) return;
    const toLocal = (iso: string) => {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    setFormInit({
      client_id: selected.client_id || "", devis_id: selected.devis_id || "",
      titre: selected.titre, description: selected.description || "",
      adresse_chantier: selected.adresse_chantier || "",
      date_debut: toLocal(selected.date_debut), date_fin: toLocal(selected.date_fin),
      statut: selected.statut, notes: selected.notes || "",
    });
    setEditMode(true);
  };

  const anyCalConnected = gcalConnected || appleConnected;

  return (
    <Shell>
      <div className="p-4 md:p-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-ink-900">Planning</h1>
            <p className="text-sm text-ink-400 mt-0.5">Interventions & chantiers</p>
          </div>
          {!dayView && (
            <button onClick={() => openCreate()} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-volt-500 text-ink-900 text-sm font-semibold hover:bg-volt-400">
              <Plus size={16} /> Intervention
            </button>
          )}
        </div>

        {/* Bandeau calendriers */}
        <div className="flex flex-wrap gap-2 mb-4">
          {/* Google */}
          <div className={cn("flex items-center gap-2 px-3 py-2 rounded-xl text-sm flex-1 min-w-0",
            gcalConnected ? "bg-green-50 border border-green-200" : "bg-ink-50 border border-ink-200")}>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-500 text-white text-[10px] font-bold shrink-0">G</span>
            {gcalConnected ? (
              <>
                <span className="text-green-700 font-medium text-xs flex-1">Google connecté{gcalLoading ? " · Sync…" : ""}</span>
                <button onClick={disconnectGoogle} className="text-xs text-red-500 hover:text-red-700 shrink-0 flex items-center gap-1"><Unlink size={11} /></button>
              </>
            ) : (
              <>
                <span className="text-ink-500 text-xs flex-1 truncate">Google Calendar</span>
                <button onClick={connectGoogle} className="text-xs text-volt-700 font-semibold shrink-0 bg-white border border-volt-300 px-2 py-0.5 rounded-lg">Connecter</button>
              </>
            )}
          </div>
          {/* Apple */}
          <div className={cn("flex items-center gap-2 px-3 py-2 rounded-xl text-sm flex-1 min-w-0",
            appleConnected ? "bg-gray-50 border border-gray-300" : "bg-ink-50 border border-ink-200")}>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-700 text-white text-[10px] font-bold shrink-0">A</span>
            {appleConnected ? (
              <span className="text-gray-700 font-medium text-xs flex-1">Apple connecté</span>
            ) : (
              <>
                <span className="text-ink-500 text-xs flex-1 truncate">Apple Calendar</span>
                <Link href="/parametres" className="text-xs text-volt-700 font-semibold shrink-0 bg-white border border-volt-300 px-2 py-0.5 rounded-lg">Connecter</Link>
              </>
            )}
          </div>
        </div>

        {/* Vue jour ou vue mois */}
        {dayView ? (
          <DayView
            year={year} month={month} day={dayView}
            interventions={interventions} calEvents={allCalEvents}
            onBack={() => setDayView(null)}
            onCreateAt={(h, m) => openCreate(dayView, h, m)}
            onSelectIv={setSelected}
            onSelectCal={setSelectedCal}
            onDropToTime={handleDropToTime}
          />
        ) : (
          <>
            {/* Navigation mois */}
            <div className="flex items-center justify-between mb-4">
              <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-ink-100 text-ink-600"><ChevronLeft size={18} /></button>
              <h2 className="text-lg font-semibold text-ink-800 capitalize">{MOIS[month]} {year}</h2>
              <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-ink-100 text-ink-600"><ChevronRight size={18} /></button>
            </div>

            {/* Grille mois */}
            <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden shadow-sm">
              <div className="grid grid-cols-7 border-b border-ink-100">
                {JOURS.map(j => <div key={j} className="text-center text-xs font-semibold text-ink-400 py-2.5">{j}</div>)}
              </div>
              <div className="grid grid-cols-7 divide-x divide-y divide-ink-100">
                {cells.map((day, idx) => {
                  const isToday = day !== null && isSameDay(new Date(year, month, day), today);
                  const dayIvs = day ? ivsForDay(day) : [];
                  const dayEvs = day ? calForDay(day) : [];
                  return (
                    <div key={idx}
                      className={cn("min-h-[80px] md:min-h-[100px] p-1.5 relative",
                        day ? "cursor-pointer hover:bg-ink-50 transition-colors" : "bg-ink-50/50",
                        day && dayEvs.length > 0 && dayIvs.length === 0 ? "bg-gray-50" : "",
                        day && dayEvs.length > 0 && dayIvs.length > 0 ? "bg-blue-50/30" : "",
                      )}
                      onClick={() => day && openCreate(day)}
                      onDragOver={e => { if (day) e.preventDefault(); }}
                      onDrop={e => { if (day) handleDrop(e, day); }}>
                      {day && (
                        <>
                          <button
                            onClick={e => { e.stopPropagation(); setDayView(day); }}
                            className={cn("text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full hover:bg-volt-200 transition-colors",
                              isToday ? "bg-volt-500 text-ink-900" : "text-ink-500")}>
                            {day}
                          </button>
                          <div className="mt-1 space-y-0.5">
                            {dayEvs.slice(0, 2).map(ev => (
                              <button key={ev.id} onClick={e => { e.stopPropagation(); setSelectedCal(ev); }}
                                className="w-full text-left text-xs px-1.5 py-0.5 rounded-md truncate font-medium bg-gray-100 text-gray-500 border border-gray-200 flex items-center gap-1">
                                <SourceBadge source={ev.source} />
                                <span className="truncate">{ev.allDay ? "↔ " : ""}{ev.title}</span>
                              </button>
                            ))}
                            {dayIvs.slice(0, 3).map(iv => {
                              const cc = getClientColor(iv.client_id);
                              return (
                                <button key={iv.id} onClick={e => { e.stopPropagation(); setSelected(iv); }}
                                  draggable onDragStart={e => { e.dataTransfer.setData("intervention_id", iv.id); e.stopPropagation(); }}
                                  className={cn("w-full text-left text-xs px-1.5 py-0.5 rounded-md truncate font-medium border flex items-center gap-1", cc.bg, cc.color, cc.border)}>
                                  <VoltBadge />
                                  <span className="truncate hidden md:inline">{fmt(iv.date_debut)} · {iv.client?.nom || "—"} · </span>
                                  <span className="truncate">{iv.titre}</span>
                                </button>
                              );
                            })}
                            {(dayIvs.length + dayEvs.length) > 5 && (
                              <p className="text-xs text-ink-400 pl-1">+{dayIvs.length + dayEvs.length - 5}</p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Légende */}
            <div className="flex flex-wrap gap-3 mt-4">
              {(Object.entries(STATUT_CONFIG) as [StatutIntervention, typeof STATUT_CONFIG[StatutIntervention]][]).map(([, cfg]) => (
                <span key={cfg.label} className={cn("text-xs px-2.5 py-1 rounded-full font-medium", cfg.bg, cfg.color)}>{cfg.label}</span>
              ))}
              {gcalConnected && <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700 flex items-center gap-1"><SourceBadge source="google" /> Google</span>}
              {appleConnected && <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-600 flex items-center gap-1"><SourceBadge source="apple" /> Apple</span>}
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-volt-100 text-volt-700 flex items-center gap-1"><VoltBadge /> VoltApp</span>
            </div>
          </>
        )}

        {/* Drawers */}
        {selected && !editMode && (
          <InterventionDrawer intervention={selected} onClose={() => setSelected(null)}
            onEdit={openEdit} onDelete={handleDelete} onMarkTermine={handleMarkTermine}
            onPhotoUpload={handlePhotoUpload} getPhotoUrl={getPhotoUrl} />
        )}
        {selectedCal && <CalDrawer event={selectedCal} onClose={() => setSelectedCal(null)} />}

        {/* Modal formulaire */}
        {(showForm || editMode) && (
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40" onClick={() => { setShowForm(false); setEditMode(false); }} />
            <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100">
                <h3 className="font-semibold text-ink-900">{editMode ? "Modifier l'intervention" : "Nouvelle intervention"}</h3>
                <button onClick={() => { setShowForm(false); setEditMode(false); }} className="text-ink-400 hover:text-ink-700"><X size={20} /></button>
              </div>
              <div className="p-5">
                <InterventionForm initial={formInit} clients={clients} devis={devis} gcalEvents={allCalEvents}
                  onSave={editMode ? handleUpdate : handleCreate}
                  onCancel={() => { setShowForm(false); setEditMode(false); }} />
              </div>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
