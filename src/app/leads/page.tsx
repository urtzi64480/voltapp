"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/layout/Shell";
import { supabase } from "@/lib/supabase";
import { DemandeClient, StatutDemande } from "@/types";
import {
  Inbox, UserPlus, ChevronDown, ChevronUp,
  Phone, Mail, MapPin, Clock, Wrench, Image as ImageIcon,
  CheckCircle, Loader2, ExternalLink, X, Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const STATUT_LABEL: Record<StatutDemande, string> = {
  nouveau: "Nouveau",
  vu: "Vu",
  converti: "Converti",
};

const STATUT_COLOR: Record<StatutDemande, string> = {
  nouveau: "bg-red-100 text-red-700",
  vu: "bg-amber-100 text-amber-700",
  converti: "bg-green-100 text-green-700",
};

function PhotoModal({ urls, onClose }: { urls: string[]; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-10 right-0 text-white/70 hover:text-white">
          <X size={24} />
        </button>
        <img src={urls[idx]} alt="" className="w-full rounded-xl object-contain max-h-[70vh]" />
        {urls.length > 1 && (
          <div className="flex justify-center gap-2 mt-3">
            {urls.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)}
                className={`w-2 h-2 rounded-full transition-colors ${i === idx ? "bg-volt-500" : "bg-white/40"}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmDelete({ onConfirm, onCancel, loading }: {
  onConfirm: () => void; onCancel: () => void; loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <h3 className="font-semibold text-ink-900 text-base mb-2">Supprimer ce lead ?</h3>
        <p className="text-sm text-ink-500 mb-5">Les photos associées seront également supprimées de Supabase. Cette action est irréversible.</p>
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-ink-200 text-ink-700 text-sm font-medium hover:bg-ink-50 disabled:opacity-40">
            Annuler
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-60">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}

function LeadCard({ demande, onRefresh }: { demande: DemandeClient; onRefresh: () => void }) {
  const [open, setOpen] = useState(demande.statut === "nouveau");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photoModal, setPhotoModal] = useState(false);
  const router = useRouter();

  const marquerVu = async () => {
    if (demande.statut !== "nouveau") return;
    await supabase.from("demandes_client").update({ statut: "vu" }).eq("id", demande.id);
    onRefresh();
  };

  const convertirEnClient = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Non connecté");

      const { data: client, error: clientErr } = await supabase
        .from("clients")
        .insert({
          user_id: session.user.id,
          nom: demande.nom,
          telephone: demande.telephone,
          email: demande.email ?? null,
          adresse: demande.adresse_chantier ?? null,
          disponibilites: demande.disponibilites ?? null,
          notes: demande.description ?? null,
          source: "demande_en_ligne",
          statut: "prospect",
        })
        .select("id")
        .single();

      if (clientErr || !client) throw clientErr ?? new Error("Erreur création client");

      await supabase.from("demandes_client").update({
        statut: "converti",
        client_id: client.id,
      }).eq("id", demande.id);

      onRefresh();
      router.push(`/devis/nouveau?client_id=${client.id}&objet=${encodeURIComponent(demande.type_travaux.join(", "))}`);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const supprimerLead = async () => {
    setDeleting(true);
    try {
      if (demande.photos.length > 0) {
        const paths = demande.photos.map((url) => {
          const parts = url.split("/demande-photos/");
          return parts[1] ?? null;
        }).filter(Boolean) as string[];

        if (paths.length > 0) {
          await supabase.storage.from("demande-photos").remove(paths);
        }
      }
      await supabase.from("demandes_client").delete().eq("id", demande.id);
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const date = new Date(demande.created_at).toLocaleDateString("fr-FR", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <>
      {confirmDelete && (
        <ConfirmDelete
          onConfirm={supprimerLead}
          onCancel={() => setConfirmDelete(false)}
          loading={deleting}
        />
      )}

      <div className={cn("card overflow-hidden transition-all", demande.statut === "nouveau" && "ring-2 ring-red-400")}>
        <div
          className="flex items-center gap-3 cursor-pointer select-none"
          onClick={() => { setOpen((o) => !o); if (demande.statut === "nouveau") marquerVu(); }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-ink-900 text-sm">{demande.nom}</span>
              <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUT_COLOR[demande.statut])}>
                {STATUT_LABEL[demande.statut]}
              </span>
              {demande.statut === "nouveau" && (
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              <span className="text-xs text-ink-400">{date}</span>
              {demande.type_travaux.length > 0 && (
                <span className="text-xs text-ink-500 truncate">{demande.type_travaux.join(" · ")}</span>
              )}
            </div>
          </div>
          <div className="shrink-0 text-ink-400">
            {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </div>
        </div>

        {open && (
          <div className="mt-4 pt-4 border-t border-ink-100 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <a href={`tel:${demande.telephone}`} className="flex items-center gap-2 text-sm text-ink-700 hover:text-volt-600">
                <Phone size={14} className="text-ink-400 shrink-0" />
                {demande.telephone}
              </a>
              {demande.email && (
                <a href={`mailto:${demande.email}`} className="flex items-center gap-2 text-sm text-ink-700 hover:text-volt-600">
                  <Mail size={14} className="text-ink-400 shrink-0" />
                  <span className="truncate">{demande.email}</span>
                </a>
              )}
              <div className="flex items-center gap-2 text-sm text-ink-700 sm:col-span-2">
                <MapPin size={14} className="text-ink-400 shrink-0" />
                {demande.adresse_chantier}
              </div>
            </div>

            {demande.type_travaux.length > 0 && (
              <div className="flex items-start gap-2">
                <Wrench size={14} className="text-ink-400 shrink-0 mt-0.5" />
                <div className="flex flex-wrap gap-1.5">
                  {demande.type_travaux.map((t) => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-volt-100 text-volt-700 font-medium">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {demande.description && (
              <div className="bg-ink-50 rounded-xl px-3 py-2.5 text-sm text-ink-700 leading-relaxed">
                {demande.description}
              </div>
            )}

            {demande.disponibilites && (
              <div className="flex items-center gap-2 text-sm text-ink-600">
                <Clock size={14} className="text-ink-400 shrink-0" />
                {demande.disponibilites}
              </div>
            )}

            {demande.photos.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-ink-500 mb-2">
                  <ImageIcon size={13} /> {demande.photos.length} photo{demande.photos.length > 1 ? "s" : ""}
                </div>
                <div className="flex gap-2 flex-wrap">
                  {demande.photos.map((url, i) => (
                    <button key={i} onClick={() => setPhotoModal(true)}>
                      <img src={url} alt="" className="w-16 h-16 object-cover rounded-lg border border-ink-200 hover:opacity-80 transition-opacity" />
                    </button>
                  ))}
                </div>
                {photoModal && <PhotoModal urls={demande.photos} onClose={() => setPhotoModal(false)} />}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              {demande.statut === "converti" && demande.client_id ? (
                <div className="flex items-center gap-2 text-green-600 text-sm font-medium flex-1">
                  <CheckCircle size={16} />
                  Client créé —{" "}
                  <a href={`/clients/${demande.client_id}`} className="underline flex items-center gap-1 hover:text-green-700">
                    Voir la fiche <ExternalLink size={12} />
                  </a>
                </div>
              ) : (
                <button
                  onClick={convertirEnClient}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-volt-500 text-ink-900 text-sm font-semibold hover:bg-volt-400 transition-colors disabled:opacity-60 flex-1 justify-center">
                  {loading
                    ? <><Loader2 size={15} className="animate-spin" /> Conversion…</>
                    : <><UserPlus size={15} /> Créer le client + devis</>}
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                className="p-2.5 rounded-xl border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors shrink-0">
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<DemandeClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtre, setFiltre] = useState<StatutDemande | "tous">("tous");
  const [userId, setUserId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("demandes_client")
      .select("*")
      .order("created_at", { ascending: false });
    setLeads((data as DemandeClient[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
    load();
  }, []);

  const filtered = filtre === "tous" ? leads : leads.filter((d) => d.statut === filtre);
  const nbNouveau = leads.filter((d) => d.statut === "nouveau").length;

  return (
    <Shell>
      <div className="px-4 py-6 max-w-2xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl text-ink-900 flex items-center gap-2">
              <Inbox size={22} className="text-volt-500" />
              Leads web
            </h1>
            {nbNouveau > 0 && (
              <p className="text-sm text-red-600 font-medium mt-0.5">
                {nbNouveau} nouveau{nbNouveau > 1 ? "x" : ""} lead{nbNouveau > 1 ? "s" : ""}
              </p>
            )}
          </div>
          
            href={userId ? `/demande/${userId}` : "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-700 border border-ink-200 rounded-lg px-3 py-1.5 transition-colors">
            <ExternalLink size={12} /> Lien public
          </a>
        </div>

        <div className="flex gap-2 flex-wrap">
          {(["tous", "nouveau", "vu", "converti"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFiltre(f)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                filtre === f
                  ? "bg-ink-900 text-white border-ink-900"
                  : "bg-white text-ink-600 border-ink-200 hover:border-ink-400"
              )}>
              {f === "tous" ? "Tous" : STATUT_LABEL[f]}
              {f === "nouveau" && nbNouveau > 0 && (
                <span className="ml-1.5 bg-red-500 text-white rounded-full px-1.5 py-0 text-xs">{nbNouveau}</span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-ink-300" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-ink-400">
            <Inbox size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {filtre === "tous" ? "Aucun lead reçu pour l'instant." : `Aucun lead "${STATUT_LABEL[filtre as StatutDemande]}".`}
            </p>
            {filtre === "tous" && (
              <p className="text-xs mt-1 text-ink-300">
                Partagez le lien public sur votre Google Business.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((d) => (
              <LeadCard key={d.id} demande={d} onRefresh={load} />
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}