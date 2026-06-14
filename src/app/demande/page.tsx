"use client";
import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { ChevronRight, ChevronLeft, CheckCircle, Upload, X, Loader2 } from "lucide-react";

const TYPES_TRAVAUX = [
  "Dépannage électrique",
  "Mise aux normes",
  "Tableau électrique",
  "Prises / Interrupteurs",
  "Éclairage",
  "IRVE (borne de recharge)",
  "Climatisation / Chauffage",
  "Autre",
];

const USER_ID = "d506c94e-40c7-4bcd-a48c-97e86f4ea7c0";

type Step = 1 | 2 | 3;

interface FormData {
  nom: string;
  telephone: string;
  email: string;
  adresse_chantier: string;
  type_travaux: string[];
  description: string;
  disponibilites: string;
}

export default function DemandePage() {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>({
    nom: "", telephone: "", email: "",
    adresse_chantier: "",
    type_travaux: [],
    description: "",
    disponibilites: "",
  });
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof FormData, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const toggleType = (t: string) =>
    setForm((f) => ({
      ...f,
      type_travaux: f.type_travaux.includes(t)
        ? f.type_travaux.filter((x) => x !== t)
        : [...f.type_travaux, t],
    }));

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).slice(0, 5 - photos.length);
    const newPhotos = [...photos, ...arr];
    const newPreviews = newPhotos.map((f) => URL.createObjectURL(f));
    setPhotos(newPhotos);
    setPhotoPreviews(newPreviews);
  };

  const removePhoto = (i: number) => {
    const np = photos.filter((_, j) => j !== i);
    const nv = photoPreviews.filter((_, j) => j !== i);
    setPhotos(np);
    setPhotoPreviews(nv);
  };

  const canNext1 = form.nom.trim() && form.telephone.trim();
  const canNext2 = form.adresse_chantier.trim() && form.type_travaux.length > 0;

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const photoUrls: string[] = [];
      for (const file of photos) {
        const ext = file.name.split(".").pop();
        const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("demande-photos")
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { data } = supabase.storage.from("demande-photos").getPublicUrl(path);
        photoUrls.push(data.publicUrl);
      }

      const { error: insErr } = await supabase.from("demandes_client").insert({
        user_id: USER_ID,
        statut: "nouveau",
        nom: form.nom.trim(),
        telephone: form.telephone.trim(),
        email: form.email.trim() || null,
        adresse_chantier: form.adresse_chantier.trim(),
        type_travaux: form.type_travaux,
        description: form.description.trim() || null,
        photos: photoUrls,
        disponibilites: form.disponibilites.trim() || null,
      });
      if (insErr) throw insErr;
      setSuccess(true);
    } catch (e: any) {
      setError("Une erreur est survenue. Veuillez réessayer ou nous appeler directement.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-ink-50 flex flex-col items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-ink-200 p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-green-600" />
          </div>
          <h2 className="font-display text-2xl text-ink-900 mb-2">Demande envoyée !</h2>
          <p className="text-ink-500 text-sm leading-relaxed">
            Merci <strong>{form.nom}</strong>, votre demande a bien été reçue.
            Nous vous recontacterons rapidement au <strong>{form.telephone}</strong>.
          </p>
          <div className="mt-6 pt-6 border-t border-ink-100 flex items-center justify-center gap-3">
            <img src="/logo.png" alt="Urtzi Électricien" width={28} height={28} className="opacity-80" />
            <span className="text-ink-400 text-xs">Urtzi Électricien</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Header */}
      <div className="bg-ink-900 px-4 py-4 flex items-center gap-3">
        <img
          src="/logo.png"
          alt="Urtzi Électricien"
          width={36}
          height={36}
          style={{ filter: "invert(1)" }}
          className="shrink-0"
        />
        <div>
          <p className="text-white font-semibold text-sm leading-none">Urtzi Électricien</p>
          <p className="text-ink-400 text-xs mt-0.5">Demande de devis gratuit</p>
        </div>
      </div>

      {/* Progress */}
      <div className="bg-white border-b border-ink-200 px-4 py-3">
        <div className="flex items-center gap-2 max-w-lg mx-auto">
          {([1, 2, 3] as Step[]).map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                step > s ? "bg-volt-500 text-ink-900" :
                step === s ? "bg-ink-900 text-white" :
                "bg-ink-100 text-ink-400"
              }`}>
                {step > s ? "✓" : s}
              </div>
              <span className={`text-xs font-medium hidden sm:block ${step === s ? "text-ink-900" : "text-ink-400"}`}>
                {s === 1 ? "Coordonnées" : s === 2 ? "Chantier" : "Détails"}
              </span>
              {s < 3 && <div className={`h-0.5 flex-1 rounded ${step > s ? "bg-volt-500" : "bg-ink-100"}`} />}
            </div>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className="px-4 py-6 max-w-lg mx-auto">
        {/* ÉTAPE 1 */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h1 className="font-display text-2xl text-ink-900">Vos coordonnées</h1>
              <p className="text-ink-500 text-sm mt-1">Pour vous recontacter rapidement.</p>
            </div>
            <div className="bg-white rounded-2xl border border-ink-200 p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-1.5">Nom complet *</label>
                <input
                  type="text"
                  value={form.nom}
                  onChange={(e) => set("nom", e.target.value)}
                  placeholder="Jean Dupont"
                  className="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-volt-500 focus:ring-2 focus:ring-volt-500/20"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-1.5">Téléphone *</label>
                <input
                  type="tel"
                  value={form.telephone}
                  onChange={(e) => set("telephone", e.target.value)}
                  placeholder="06 00 00 00 00"
                  className="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-volt-500 focus:ring-2 focus:ring-volt-500/20"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-1.5">Email <span className="text-ink-300 font-normal">(optionnel)</span></label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="jean@email.com"
                  className="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-volt-500 focus:ring-2 focus:ring-volt-500/20"
                />
              </div>
            </div>
            <button
              onClick={() => setStep(2)}
              disabled={!canNext1}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-volt-500 text-ink-900 font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-volt-400 transition-colors">
              Suivant <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* ÉTAPE 2 */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h1 className="font-display text-2xl text-ink-900">Le chantier</h1>
              <p className="text-ink-500 text-sm mt-1">Dites-nous où et quoi.</p>
            </div>
            <div className="bg-white rounded-2xl border border-ink-200 p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-1.5">Adresse du chantier *</label>
                <input
                  type="text"
                  value={form.adresse_chantier}
                  onChange={(e) => set("adresse_chantier", e.target.value)}
                  placeholder="12 rue des Fleurs, 64100 Bayonne"
                  className="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-volt-500 focus:ring-2 focus:ring-volt-500/20"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-1.5">Type de travaux * <span className="text-ink-300 font-normal">(plusieurs possibles)</span></label>
                <div className="flex flex-wrap gap-2">
                  {TYPES_TRAVAUX.map((t) => (
                    <button
                      key={t}
                      onClick={() => toggleType(t)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        form.type_travaux.includes(t)
                          ? "bg-volt-500 border-volt-500 text-ink-900"
                          : "bg-white border-ink-200 text-ink-600 hover:border-ink-400"
                      }`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex items-center gap-1.5 px-4 py-3 rounded-xl border border-ink-200 text-ink-600 text-sm font-medium hover:bg-ink-100 transition-colors">
                <ChevronLeft size={16} /> Retour
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!canNext2}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-volt-500 text-ink-900 font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-volt-400 transition-colors">
                Suivant <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ÉTAPE 3 */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h1 className="font-display text-2xl text-ink-900">Détails</h1>
              <p className="text-ink-500 text-sm mt-1">Plus d'infos = devis plus précis.</p>
            </div>
            <div className="bg-white rounded-2xl border border-ink-200 p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-1.5">Description <span className="text-ink-300 font-normal">(optionnel)</span></label>
                <textarea
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Décrivez votre problème ou projet…"
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-volt-500 focus:ring-2 focus:ring-volt-500/20 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-1.5">Disponibilités <span className="text-ink-300 font-normal">(optionnel)</span></label>
                <input
                  type="text"
                  value={form.disponibilites}
                  onChange={(e) => set("disponibilites", e.target.value)}
                  placeholder="Ex : semaine prochaine, matin de préférence"
                  className="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-volt-500 focus:ring-2 focus:ring-volt-500/20"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-600 mb-1.5">
                  Photos <span className="text-ink-300 font-normal">(optionnel, max 5)</span>
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => addPhotos(e.target.files)}
                />
                {photos.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {photoPreviews.map((src, i) => (
                      <div key={i} className="relative">
                        <img src={src} alt="" className="w-16 h-16 object-cover rounded-lg border border-ink-200" />
                        <button
                          onClick={() => removePhoto(i)}
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center">
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {photos.length < 5 && (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-ink-200 text-ink-400 text-sm hover:border-volt-500 hover:text-volt-600 transition-colors w-full justify-center">
                    <Upload size={16} /> Ajouter des photos
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="flex items-center gap-1.5 px-4 py-3 rounded-xl border border-ink-200 text-ink-600 text-sm font-medium hover:bg-ink-100 transition-colors">
                <ChevronLeft size={16} /> Retour
              </button>
              <button
                onClick={submit}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-volt-500 text-ink-900 font-semibold text-sm disabled:opacity-60 hover:bg-volt-400 transition-colors">
                {loading ? <><Loader2 size={16} className="animate-spin" /> Envoi…</> : "Envoyer ma demande"}
              </button>
            </div>

            <p className="text-center text-ink-300 text-xs">
              Devis gratuit · Réponse sous 24h · Sans engagement
            </p>
          </div>
        )}
      </div>
    </div>
  );
}