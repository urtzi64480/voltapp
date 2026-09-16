// src/app/realisations/page.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import Shell from "@/components/layout/Shell";
import { ImagePlus, Trash2, Loader2, Camera } from "lucide-react";

interface RealisationPhoto {
  id: string;
  photo_url: string;
  chantier: string | null;
  description: string | null;
}

export default function RealisationsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<RealisationPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [chantierInput, setChantierInput] = useState("");
  // état local des descriptions en cours d'édition, indexé par id de photo —
  // évite de re-fetch/re-render toute la liste à chaque frappe
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
    }
    init();
  }, []);

  useEffect(() => {
    if (!userId) return;
    load();
  }, [userId]);

  async function load() {
    if (!userId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("realisations")
      .select("id, photo_url, chantier, description")
      .eq("user_id", userId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) console.error("Erreur chargement réalisations :", error);
    const list = data ?? [];
    setPhotos(list);
    setDescriptions(
      Object.fromEntries(list.map((p) => [p.id, p.description ?? ""]))
    );
    setLoading(false);
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0 || !userId) return;
    if (!chantierInput.trim()) {
      alert("Indique d'abord le nom du chantier avant d'ajouter des photos.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop();
        const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("realisations-photos")
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("realisations-photos").getPublicUrl(path);
        const { error: insErr } = await supabase.from("realisations").insert({
          user_id: userId,
          photo_url: pub.publicUrl,
          chantier: chantierInput.trim(),
          position: photos.length,
        });
        if (insErr) throw insErr;
      }
      await load();
    } catch (e) {
      console.error("Erreur upload réalisation :", e);
      alert("Une erreur est survenue pendant l'upload d'une photo.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDelete(id: string, photoUrl: string) {
    if (!confirm("Supprimer cette photo de la galerie ?")) return;
    try {
      const marker = "/realisations-photos/";
      const idx = photoUrl.indexOf(marker);
      if (idx !== -1) {
        const path = photoUrl.slice(idx + marker.length);
        await supabase.storage.from("realisations-photos").remove([path]);
      }
      // .select() est indispensable ici : sans lui, une suppression bloquée par
      // la RLS (ex. session expirée, user_id qui ne correspond plus) renvoie
      // error: null avec 0 ligne supprimée — succès silencieux trompeur.
      const { data: deleted, error } = await supabase
        .from("realisations")
        .delete()
        .eq("id", id)
        .select();
      if (error) throw error;
      if (!deleted || deleted.length === 0) {
        throw new Error("Aucune ligne supprimée (probable blocage RLS) — la photo est peut-être toujours visible sur /a-propos.");
      }
      // la description est une colonne de la même ligne "realisations" :
      // elle disparaît automatiquement avec la suppression ci-dessus
      setPhotos((prev) => prev.filter((p) => p.id !== id));
      setDescriptions((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (e) {
      console.error("Erreur suppression réalisation :", e);
      alert("Une erreur est survenue pendant la suppression.");
    }
  }

  function handleDescriptionChange(id: string, value: string) {
    setDescriptions((prev) => ({ ...prev, [id]: value }));
  }

  async function handleDescriptionBlur(id: string) {
    const original = photos.find((p) => p.id === id)?.description ?? "";
    const value = (descriptions[id] ?? "").trim();
    if (value === (original ?? "").trim()) return; // rien à sauvegarder

    setSavingId(id);
    try {
      const { error } = await supabase
        .from("realisations")
        .update({ description: value || null })
        .eq("id", id);
      if (error) throw error;
      setPhotos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, description: value || null } : p))
      );
    } catch (e) {
      console.error("Erreur sauvegarde description :", e);
      alert("La description n'a pas pu être enregistrée.");
    } finally {
      setSavingId(null);
    }
  }

  const grouped = photos.reduce((acc: Record<string, RealisationPhoto[]>, p) => {
    const key = (p.chantier ?? "").trim() || "Sans chantier";
    (acc[key] ??= []).push(p);
    return acc;
  }, {});

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="font-display text-3xl text-ink-900 flex items-center gap-2">
            <Camera size={28} className="text-volt-600" /> Réalisations
          </h1>
          <p className="text-ink-500 text-sm mt-1">
            Photos de chantiers, groupées par chantier — visibles publiquement sur la page « À propos ».
          </p>
        </div>

        <div className="card card-inner mb-5">
          <div className="flex items-end gap-3 flex-wrap mb-2">
            <div className="flex-1 min-w-[240px]">
              <label className="label">Nom du chantier</label>
              <input
                type="text"
                value={chantierInput}
                onChange={(e) => setChantierInput(e.target.value)}
                placeholder="Ex : Rénovation tableau — Bayonne"
                className="input w-full"
              />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading || !userId || !chantierInput.trim()}
              className="btn-volt flex items-center gap-2 disabled:opacity-50">
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
              {uploading ? "Envoi…" : "Ajouter des photos"}
            </button>
          </div>
          {!chantierInput.trim() && (
            <p className="text-xs text-amber-600">Renseigne le nom du chantier avant d'ajouter des photos.</p>
          )}
        </div>

        {loading ? (
          <div className="text-center py-16 text-ink-400">Chargement…</div>
        ) : photos.length === 0 ? (
          <div className="card card-inner text-center py-12">
            <p className="text-ink-400 text-sm">
              Aucune photo pour l'instant. Renseigne un nom de chantier ci-dessus puis ajoute tes premières photos.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {Object.entries(grouped).map(([nom, photosChantier]) => (
              <div key={nom} className="card card-inner">
                <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-3">{nom}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {photosChantier.map((p) => (
                    <div key={p.id} className="relative group">
                      <div className="relative aspect-square">
                        <img
                          src={p.photo_url}
                          alt="Réalisation"
                          className="w-full h-full object-cover rounded-xl border border-ink-200"
                        />
                        <button
                          onClick={() => handleDelete(p.id, p.photo_url)}
                          className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Supprimer">
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <textarea
                        value={descriptions[p.id] ?? ""}
                        onChange={(e) => handleDescriptionChange(p.id, e.target.value)}
                        onBlur={() => handleDescriptionBlur(p.id)}
                        placeholder="Petite description (visible sur la page publique)…"
                        rows={2}
                        className="input w-full mt-1.5 text-xs resize-none"
                      />
                      {savingId === p.id && (
                        <p className="text-[10px] text-ink-400 mt-0.5">Enregistrement…</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
