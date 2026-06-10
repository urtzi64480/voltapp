"use client";
import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Shell from "@/components/layout/Shell";
import { ArrowLeft, Save, Camera, X } from "lucide-react";
import Link from "next/link";

// ── Composants champs définis HORS du composant principal ──────────────────
// (sinon React les recrée à chaque frappe → perte de focus)

const F = ({ label, k, type = "text", placeholder = "", col2 = false, form, set }: any) => (
  <div className={col2 ? "col-span-2" : ""}>
    <label className="label">{label}</label>
    <input
      className="input"
      type={type}
      placeholder={placeholder}
      value={form[k]}
      onChange={e => set(k, e.target.value)}
    />
  </div>
);

const S = ({ label, k, options, form, set }: { label: string; k: string; options: [string, string][]; form: any; set: any }) => (
  <div>
    <label className="label">{label}</label>
    <select className="input" value={form[k]} onChange={e => set(k, e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────

export default function NouveauClientPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    nom: "", prenom: "", telephone: "", email: "", adresse: "",
    code_postal: "", ville: "",
    type_logement: "maison", annee_construction: "", surface_m2: "",
    tableau_marque: "", tableau_config: "", code_acces: "",
    contact_prefere: "telephone", disponibilites: "", notes: "",
    statut: "actif", source: "",
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const newFiles = Array.from(files);
    setPhotos(p => [...p, ...newFiles]);
    newFiles.forEach(f => {
      const reader = new FileReader();
      reader.onload = e => setPreviews(p => [...p, e.target?.result as string]);
      reader.readAsDataURL(f);
    });
  }

  function removePhoto(i: number) {
    setPhotos(p => p.filter((_, idx) => idx !== i));
    setPreviews(p => p.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!form.nom.trim()) return alert("Le nom est obligatoire.");
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const photoUrls: string[] = [];
    for (const photo of photos) {
      const path = `${user.id}/${Date.now()}-${photo.name}`;
      const { data } = await supabase.storage.from("client-photos").upload(path, photo);
      if (data) {
        const { data: urlData } = supabase.storage.from("client-photos").getPublicUrl(path);
        photoUrls.push(urlData.publicUrl);
      }
    }

    const { data, error } = await supabase.from("clients").insert({
      ...form,
      user_id: user.id,
      annee_construction: form.annee_construction ? parseInt(form.annee_construction) : null,
      surface_m2: form.surface_m2 ? parseInt(form.surface_m2) : null,
      photos: photoUrls,
    }).select().single();

    if (error) { alert("Erreur : " + error.message); setSaving(false); return; }
    router.push(`/clients/${data.id}`);
  }

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/clients" className="btn-ghost !px-2.5 !py-2"><ArrowLeft size={16} /></Link>
          <h1 className="font-display text-2xl text-ink-900">Nouveau client</h1>
        </div>

        <div className="space-y-4">
          {/* Coordonnées */}
          <div className="card card-inner">
            <h2 className="font-semibold text-ink-800 mb-4">Coordonnées</h2>
            <div className="grid grid-cols-2 gap-3">
              <F label="Prénom" k="prenom" form={form} set={set} />
              <F label="Nom *" k="nom" form={form} set={set} />
              <F label="Téléphone" k="telephone" type="tel" form={form} set={set} />
              <F label="Email" k="email" type="email" form={form} set={set} />
              <F label="Adresse" k="adresse" col2 form={form} set={set} />
              <F label="Code postal" k="code_postal" form={form} set={set} />
              <F label="Ville" k="ville" form={form} set={set} />
            </div>
          </div>

          {/* Logement */}
          <div className="card card-inner">
            <h2 className="font-semibold text-ink-800 mb-4">Logement</h2>
            <div className="grid grid-cols-2 gap-3">
              <S label="Type" k="type_logement" form={form} set={set} options={[["maison","Maison individuelle"],["appartement","Appartement"],["local","Local commercial"]]} />
              <F label="Année de construction" k="annee_construction" type="number" placeholder="1985" form={form} set={set} />
              <F label="Surface (m²)" k="surface_m2" type="number" form={form} set={set} />
              <F label="Marque tableau" k="tableau_marque" placeholder="Schneider" form={form} set={set} />
              <F label="Config tableau" k="tableau_config" col2 placeholder="Mono 30A, 14 disj." form={form} set={set} />
              <F label="Code d'accès" k="code_acces" col2 placeholder="Digicode, badge…" form={form} set={set} />
            </div>
          </div>

          {/* Préférences */}
          <div className="card card-inner">
            <h2 className="font-semibold text-ink-800 mb-4">Préférences & notes</h2>
            <div className="grid grid-cols-2 gap-3">
              <S label="Contact préféré" k="contact_prefere" form={form} set={set} options={[["telephone","Téléphone"],["sms","SMS"],["email","Email"]]} />
              <S label="Statut" k="statut" form={form} set={set} options={[["actif","Actif"],["vip","VIP"],["inactif","Inactif"]]} />
              <F label="Disponibilités" k="disponibilites" col2 placeholder="Ex : matin uniquement" form={form} set={set} />
              <F label="Source" k="source" col2 placeholder="Bouche-à-oreille, Google…" form={form} set={set} />
              <div className="col-span-2">
                <label className="label">Notes privées</label>
                <textarea
                  className="input min-h-[80px] resize-none"
                  value={form.notes}
                  placeholder="Chien dans le jardin, préférer sonner…"
                  onChange={e => set("notes", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Photos */}
          <div className="card card-inner">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-ink-800">Photos</h2>
              <button onClick={() => fileRef.current?.click()} className="btn-ghost text-xs !py-1.5">
                <Camera size={14} /> Ajouter
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple capture="environment"
                className="hidden" onChange={e => addPhotos(e.target.files)} />
            </div>
            {previews.length === 0 ? (
              <button onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-ink-200 rounded-xl py-8 flex flex-col items-center gap-2 text-ink-400 hover:border-volt-400 hover:text-volt-600 transition-colors">
                <Camera size={28} />
                <span className="text-sm">Prendre ou importer des photos</span>
                <span className="text-xs">Tableau électrique, installations, accès…</span>
              </button>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {previews.map((src, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-ink-100">
                    <img src={src} alt="" className="w-full h-full object-cover" />
                    <button onClick={() => removePhoto(i)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70">
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button onClick={() => fileRef.current?.click()}
                  className="aspect-square rounded-xl border-2 border-dashed border-ink-200 flex items-center justify-center text-ink-400 hover:border-volt-400 hover:text-volt-600 transition-colors">
                  <Camera size={20} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <Link href="/clients" className="btn-ghost flex-1 justify-center">Annuler</Link>
          <button onClick={save} disabled={saving} className="btn-volt flex-1 justify-center">
            <Save size={15} /> {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </Shell>
  );
}
