"use client";
import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ChevronRight, ChevronLeft, CheckCircle, Upload, X, Loader2, FileText, CalendarDays, Phone, UserPlus, Zap } from "lucide-react";

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

type Step = 1 | 2 | 3;
type Mode = "devis" | "rdv" | "urgence" | null;

interface FormData {
  nom: string;
  telephone: string;
  email: string;
  adresse_chantier: string;
  type_travaux: string[];
  description: string;
  disponibilites: string;
  honeypot: string;
}

interface Profil {
  nom_entreprise: string | null;
  logo_url: string | null;
}

interface DispoDay {
  date: string; // YYYY-MM-DD
  matin: boolean;
  aprem: boolean;
}

interface RdvSlot {
  date: string;
  periode: "matin" | "aprem";
}

interface RdvFormData {
  nom: string;
  telephone: string;
  email: string;
  adresse: string;
  description: string;
  honeypot: string;
}

const EMPTY_RDV_FORM: RdvFormData = { nom: "", telephone: "", email: "", adresse: "", description: "", honeypot: "" };

// URL de la carte de contact (vCard) — fichier statique servi depuis public/carte-nfc/
const VCARD_URL = "/carte-nfc/index.html";

// Numéro d'urgence — affiché en clair et cliquable (tel:)
const URGENCE_TEL_AFFICHE = "07 69 99 52 22";
const URGENCE_TEL_LIEN = "tel:+33769995222";

function fmtDateLabel(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Déduit le type d'appareil à partir du user-agent — seulement mobile ou desktop
// (les tablettes sont regroupées avec mobile, usage tactile similaire).
function detectDeviceType(ua: string): "mobile" | "desktop" {
  const s = ua.toLowerCase();
  if (/mobi|android|iphone|ipad|ipod|tablet|nexus 7|nexus 9|nexus 10|kfapwi/.test(s)) return "mobile";
  return "desktop";
}

// Détection simple du navigateur à partir du user-agent (sans dépendance externe).
// L'ordre des tests compte : Edge et Opera embarquent "Chrome" dans leur UA.
function detectBrowser(ua: string): string {
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/chrome|crios/i.test(ua)) return "Chrome";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  return "Autre";
}

// Détection simple du système d'exploitation à partir du user-agent.
function detectOS(ua: string): string {
  if (/windows/i.test(ua)) return "Windows";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/android/i.test(ua)) return "Android";
  if (/mac os/i.test(ua)) return "macOS";
  if (/linux/i.test(ua)) return "Linux";
  return "Autre";
}

function DemandePageContent({ userId }: { userId: string }) {
  const searchParams = useSearchParams();

  // Horodatage du chargement de la page — sert à détecter les soumissions trop
  // rapides (probable bot) côté serveur, pour les formulaires devis et RDV.
  const pageLoadedAt = useRef(Date.now());

  const [profil, setProfil] = useState<Profil | null>(null);
  const [profilLoading, setProfilLoading] = useState(true);

  // Mode initial déduit du paramètre ?mode= (deep-link depuis /a-propos par ex.)
  // — sans ça les liens externes retombaient toujours sur l'écran de choix.
  const [mode, setMode] = useState<Mode>(() => {
    const m = searchParams.get("mode");
    return m === "devis" || m === "rdv" || m === "urgence" ? (m as Mode) : null;
  });

  // ── Devis ──
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>({
    nom: "", telephone: "", email: "",
    adresse_chantier: "",
    type_travaux: [],
    description: "",
    disponibilites: "",
    honeypot: "",
  });
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── RDV ──
  const [dispoLoading, setDispoLoading] = useState(false);
  const [dispoLoaded, setDispoLoaded] = useState(false);
  const [dispoAvailable, setDispoAvailable] = useState(true);
  const [dispoDays, setDispoDays] = useState<DispoDay[]>([]);
  const [rdvSlot, setRdvSlot] = useState<RdvSlot | null>(null);
  const [rdvForm, setRdvForm] = useState<RdvFormData>(EMPTY_RDV_FORM);
  const [rdvPhotos, setRdvPhotos] = useState<File[]>([]);
  const [rdvPhotoPreviews, setRdvPhotoPreviews] = useState<string[]>([]);
  const rdvFileRef = useRef<HTMLInputElement>(null);
  const [rdvSubmitting, setRdvSubmitting] = useState(false);
  const [rdvSuccess, setRdvSuccess] = useState(false);
  const [rdvError, setRdvError] = useState<string | null>(null);

  // ── Tracking visite (une seule fois par session, pas par écran) ──
  // Passe par /api/public/track (plutôt qu'un insert direct Supabase) pour que le
  // serveur puisse ajouter la géolocalisation via les headers Vercel, indisponible côté client.
  //
  // Déduplication via sessionStorage (propre à l'onglet, effacée à sa fermeture) :
  // une clé PAR SESSION (pas par écran) — un F5, ou naviguer entre devis/rdv/urgence
  // dans la même visite, ne compte qu'une seule fois. Seul le mode capturé au tout
  // premier chargement (via ?mode= en deep-link, ou null pour l'écran d'accueil) est
  // enregistré ; les changements d'écran suivants ne créent plus de nouvelle ligne.
  const visitLoggedRef = useRef(false);
  useEffect(() => {
    if (visitLoggedRef.current) return;
    visitLoggedRef.current = true;
    if (typeof window === "undefined") return;
    const sessionKey = `voltapp_visite_${userId}`;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, "1");

    const ua = navigator.userAgent;
    fetch("/api/public/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        table: "demande_visites",
        user_id: userId,
        referrer: document.referrer || null,
        user_agent: ua,
        device_type: detectDeviceType(ua),
        navigateur: detectBrowser(ua),
        os: detectOS(ua),
        langue: navigator.language || null,
        page: window.location.pathname,
        mode,
      }),
    }).catch((err) => console.error("Erreur tracking visite :", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── Journal des écrans consultés (détail complet, sans gonfler le total de visites) ──
  // Contrairement à la visite ci-dessus (1 ligne par session, table demande_visites),
  // chaque écran distinct consulté est journalisé ici via demande_clics — même table
  // et logique que le clic "Ajouter à mes contacts", avec un type_clic préfixé
  // "ecran_". Ces lignes ne sont jamais comptées dans le total de visites du CRM,
  // seulement affichées dans le détail "Pages / actions demandées".
  useEffect(() => {
    if (typeof window === "undefined") return;
    const screenKey = mode ?? "accueil";
    const sessionKey = `voltapp_ecran_${userId}_${screenKey}`;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, "1");

    fetch("/api/public/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        table: "demande_clics",
        user_id: userId,
        type_clic: `ecran_${screenKey}`,
      }),
    }).catch((err) => console.error("Erreur tracking écran :", err));
  }, [mode, userId]);

  // ── Tracking clic "Ajouter à mes contacts" ──
  // Non-bloquant : la requête part en tâche de fond, le lien vCard s'ouvre normalement
  // dans son nouvel onglet sans attendre la réponse serveur.
  const handleAjoutContact = () => {
    const ua = navigator.userAgent;
    fetch("/api/public/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        table: "demande_clics",
        type_clic: "ajout_contact",
        user_id: userId,
        referrer: document.referrer || null,
        user_agent: ua,
        device_type: detectDeviceType(ua),
        navigateur: detectBrowser(ua),
        os: detectOS(ua),
        langue: navigator.language || null,
      }),
    }).catch((err) => console.error("Erreur tracking clic ajout contact :", err));
  };

  useEffect(() => {
    async function loadProfil() {
      const { data } = await supabase
        .from("profil")
        .select("nom_entreprise, logo_url")
        .eq("id", userId)
        .single();
      setProfil(data ?? { nom_entreprise: null, logo_url: null });
      setProfilLoading(false);
    }
    loadProfil();
  }, [userId]);

  useEffect(() => {
    if (mode !== "rdv" || dispoLoaded) return;
    async function loadDispo() {
      setDispoLoading(true);
      try {
        const res = await fetch(`/api/public/disponibilites?userId=${userId}`);
        const data = await res.json();
        setDispoAvailable(!!data.available);
        setDispoDays(data.days ?? []);
      } catch {
        setDispoAvailable(false);
      } finally {
        setDispoLoading(false);
        setDispoLoaded(true);
      }
    }
    loadDispo();
  }, [mode, userId, dispoLoaded]);

  const nomEntreprise = profil?.nom_entreprise ?? "Électricien";
  const logoUrl = profil?.logo_url ?? null;

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
    setPhotos(photos.filter((_, j) => j !== i));
    setPhotoPreviews(photoPreviews.filter((_, j) => j !== i));
  };

  // ── Photos RDV — même logique que les photos devis, état séparé ──
  const addRdvPhotos = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).slice(0, 5 - rdvPhotos.length);
    const newPhotos = [...rdvPhotos, ...arr];
    const newPreviews = newPhotos.map((f) => URL.createObjectURL(f));
    setRdvPhotos(newPhotos);
    setRdvPhotoPreviews(newPreviews);
  };

  const removeRdvPhoto = (i: number) => {
    setRdvPhotos(rdvPhotos.filter((_, j) => j !== i));
    setRdvPhotoPreviews(rdvPhotoPreviews.filter((_, j) => j !== i));
  };

  const canNext1 = form.nom.trim() && form.telephone.trim();
  const canNext2 = form.adresse_chantier.trim() && form.type_travaux.length > 0;

  const backToChoice = () => {
    setMode(null);
    setStep(1);
    setRdvSlot(null);
    setRdvSuccess(false);
    setRdvError(null);
    setDispoLoaded(false);
    setDispoDays([]);
    setRdvPhotos([]);
    setRdvPhotoPreviews([]);
  };

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

      const res = await fetch("/api/public/demande", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          nom: form.nom.trim(),
          telephone: form.telephone.trim(),
          email: form.email.trim() || undefined,
          adresse_chantier: form.adresse_chantier.trim(),
          type_travaux: form.type_travaux,
          description: form.description.trim() || undefined,
          photos: photoUrls,
          disponibilites: form.disponibilites.trim() || undefined,
          honeypot: form.honeypot,
          loadedAt: pageLoadedAt.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Une erreur est survenue. Veuillez réessayer ou nous appeler directement.");
        return;
      }
      setSuccess(true);
    } catch (e: any) {
      setError("Une erreur est survenue. Veuillez réessayer ou nous appeler directement.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const setRdv = (k: keyof RdvFormData, v: string) =>
    setRdvForm((f) => ({ ...f, [k]: v }));

  const canSubmitRdv = rdvForm.nom.trim() && rdvForm.telephone.trim();

  const submitRdv = async () => {
    if (!rdvSlot) return;
    setRdvSubmitting(true);
    setRdvError(null);
    try {
      const photoUrls: string[] = [];
      for (const file of rdvPhotos) {
        const ext = file.name.split(".").pop();
        const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("demande-photos")
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { data } = supabase.storage.from("demande-photos").getPublicUrl(path);
        photoUrls.push(data.publicUrl);
      }

      const res = await fetch("/api/public/rdv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          date: rdvSlot.date,
          periode: rdvSlot.periode,
          nom: rdvForm.nom.trim(),
          telephone: rdvForm.telephone.trim(),
          email: rdvForm.email.trim() || undefined,
          adresse: rdvForm.adresse.trim() || undefined,
          description: rdvForm.description.trim() || undefined,
          photos: photoUrls,
          honeypot: rdvForm.honeypot,
          loadedAt: pageLoadedAt.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRdvError(data.error || "Une erreur est survenue.");
        if (res.status === 409) {
          // créneau pris entre-temps : on retire ce créneau et on revient à la sélection
          setDispoDays((days) =>
            days.map((d) =>
              d.date === rdvSlot.date
                ? { ...d, [rdvSlot.periode]: false }
                : d
            )
          );
          setRdvSlot(null);
        }
        return;
      }
      setRdvSuccess(true);
    } catch (e) {
      setRdvError("Une erreur est survenue. Veuillez réessayer ou nous appeler directement.");
      console.error(e);
    } finally {
      setRdvSubmitting(false);
    }
  };

  if (profilLoading) {
    return (
      <div className="min-h-screen bg-ink-50 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-ink-400" />
      </div>
    );
  }

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
            {logoUrl ? (
              <img src={logoUrl} alt={nomEntreprise} width={28} height={28} className="opacity-80 object-contain" />
            ) : null}
            <span className="text-ink-400 text-xs">{nomEntreprise}</span>
          </div>
        </div>
      </div>
    );
  }

  if (rdvSuccess && rdvSlot) {
    return (
      <div className="min-h-screen bg-ink-50 flex flex-col items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-ink-200 p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-green-600" />
          </div>
          <h2 className="font-display text-2xl text-ink-900 mb-2">Rendez-vous confirmé !</h2>
          <p className="text-ink-500 text-sm leading-relaxed">
            Merci <strong>{rdvForm.nom}</strong>, votre rendez-vous est fixé le{" "}
            <strong>{fmtDateLabel(rdvSlot.date)}</strong>, {rdvSlot.periode === "matin" ? "le matin (8h-12h)" : "l'après-midi (13h-17h)"}.
          </p>
          <div className="mt-6 pt-6 border-t border-ink-100 flex items-center justify-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt={nomEntreprise} width={28} height={28} className="opacity-80 object-contain" />
            ) : null}
            <span className="text-ink-400 text-xs">{nomEntreprise}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Header */}
      <div className="bg-ink-900 px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={nomEntreprise}
              width={36}
              height={36}
              className="shrink-0 object-contain rounded-lg"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-volt-500 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm leading-none">{nomEntreprise}</p>
            <p className="text-ink-400 text-xs mt-0.5">
              {mode === null
                ? "Que souhaitez-vous faire ?"
                : mode === "devis"
                ? "Demande de devis gratuit"
                : mode === "rdv"
                ? "Prise de rendez-vous"
                : "Urgence électrique"}
            </p>
          </div>
        </div>
        <a
          href={VCARD_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleAjoutContact}
          className="shrink-0 inline-flex items-center justify-center gap-1.5 w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-lg bg-volt-500 text-ink-900 font-semibold text-sm sm:text-xs hover:bg-volt-400 transition-colors sm:ml-auto">
          <UserPlus size={16} className="sm:hidden" />
          <UserPlus size={14} className="hidden sm:block" />
          <span>Ajouter à mes contacts</span>
        </a>
      </div>

      {/* ÉCRAN DE CHOIX */}
      {mode === null && (
        <div className="px-4 py-8 max-w-lg mx-auto space-y-4">
          <a
            href="/a-propos"
            className="w-full bg-white rounded-2xl border border-ink-200 p-5 flex items-center gap-4 text-left hover:border-volt-500 hover:shadow-sm transition-all">
            <div className="w-12 h-12 rounded-xl bg-ink-100 flex items-center justify-center shrink-0 overflow-hidden">
              <img src="/images/ben-elektron-square.jpg" alt="Benoît" className="w-full h-full object-cover" />
            </div>
            <div className="flex-1">
              <p className="font-display text-lg text-ink-900">En savoir plus</p>
              <p className="text-ink-500 text-sm mt-0.5">Qui je suis, mes réalisations.</p>
            </div>
            <ChevronRight size={20} className="text-ink-300 shrink-0" />
          </a>

          <button
            onClick={() => setMode("urgence")}
            className="w-full bg-white rounded-2xl border-2 border-red-200 p-5 flex items-center gap-4 text-left hover:border-red-400 hover:shadow-sm transition-all">
            <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
              <Zap size={22} className="text-red-600" />
            </div>
            <div className="flex-1">
              <p className="font-display text-lg text-ink-900">Urgences électriques</p>
              <p className="text-ink-500 text-sm mt-0.5">Panne, danger : appelez-moi directement.</p>
            </div>
            <ChevronRight size={20} className="text-ink-300 shrink-0" />
          </button>

          <button
            onClick={() => setMode("devis")}
            className="w-full bg-white rounded-2xl border border-ink-200 p-5 flex items-center gap-4 text-left hover:border-volt-500 hover:shadow-sm transition-all">
            <div className="w-12 h-12 rounded-xl bg-volt-500/15 flex items-center justify-center shrink-0">
              <FileText size={22} className="text-volt-600" />
            </div>
            <div className="flex-1">
              <p className="font-display text-lg text-ink-900">Demande de devis</p>
              <p className="text-ink-500 text-sm mt-0.5">Décrivez votre projet, réponse sous 24h.</p>
            </div>
            <ChevronRight size={20} className="text-ink-300 shrink-0" />
          </button>

          <button
            onClick={() => setMode("rdv")}
            className="w-full bg-white rounded-2xl border border-ink-200 p-5 flex items-center gap-4 text-left hover:border-volt-500 hover:shadow-sm transition-all">
            <div className="w-12 h-12 rounded-xl bg-volt-500/15 flex items-center justify-center shrink-0">
              <CalendarDays size={22} className="text-volt-600" />
            </div>
            <div className="flex-1">
              <p className="font-display text-lg text-ink-900">Prise de rendez-vous</p>
              <p className="text-ink-500 text-sm mt-0.5">Choisissez un créneau disponible.</p>
            </div>
            <ChevronRight size={20} className="text-ink-300 shrink-0" />
          </button>
        </div>
      )}

      {/* URGENCE ÉLECTRIQUE */}
      {mode === "urgence" && (
        <div className="px-4 py-8 max-w-lg mx-auto space-y-4">
          <button
            onClick={backToChoice}
            className="flex items-center gap-1.5 text-ink-500 text-sm font-medium hover:text-ink-900 transition-colors">
            <ChevronLeft size={16} /> Retour
          </button>

          <div className="bg-white rounded-2xl border-2 border-red-200 p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <Zap size={28} className="text-red-600" />
            </div>
            <h1 className="font-display text-xl text-ink-900 mb-2">Urgence électrique</h1>
            <p className="text-ink-500 text-sm leading-relaxed mb-6">
              Panne, court-circuit, danger électrique : appelez-moi directement, je vous réponds au plus vite.
            </p>
            <a
              href={URGENCE_TEL_LIEN}
              className="w-full inline-flex items-center justify-center gap-2 py-4 rounded-xl bg-red-600 text-white font-bold text-lg hover:bg-red-500 transition-colors">
              <Phone size={20} />
              {URGENCE_TEL_AFFICHE}
            </a>
            <p className="text-ink-300 text-xs mt-4">Appuyez pour appeler directement</p>
          </div>
        </div>
      )}

      {/* PRISE DE RENDEZ-VOUS */}
      {mode === "rdv" && (
        <div className="px-4 py-6 max-w-lg mx-auto space-y-4">
          <button
            onClick={() => (rdvSlot ? setRdvSlot(null) : backToChoice())}
            className="flex items-center gap-1.5 text-ink-500 text-sm font-medium hover:text-ink-900 transition-colors">
            <ChevronLeft size={16} /> Retour
          </button>

          {/* Chargement */}
          {dispoLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={28} className="animate-spin text-ink-400" />
            </div>
          )}

          {/* Système indisponible (calendrier non connecté) */}
          {!dispoLoading && !dispoAvailable && (
            <div className="bg-white rounded-2xl border border-ink-200 p-6 text-center">
              <div className="w-14 h-14 rounded-full bg-volt-500/15 flex items-center justify-center mx-auto mb-4">
                <Phone size={22} className="text-volt-600" />
              </div>
              <h1 className="font-display text-xl text-ink-900 mb-2">Réservation en ligne indisponible</h1>
              <p className="text-ink-500 text-sm leading-relaxed">
                Contactez-nous directement par téléphone pour fixer un rendez-vous.
              </p>
            </div>
          )}

          {/* Sélection du créneau */}
          {!dispoLoading && dispoAvailable && !rdvSlot && (
            <>
              <div>
                <h1 className="font-display text-2xl text-ink-900">Choisissez un créneau</h1>
                <p className="text-ink-500 text-sm mt-1">Du lundi au vendredi, par demi-journée.</p>
              </div>
              <div className="space-y-2">
                {dispoDays.map((day) => (
                  <div key={day.date} className="bg-white rounded-xl border border-ink-200 p-3 flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-ink-700 capitalize">{fmtDateLabel(day.date)}</span>
                    <div className="flex gap-2 shrink-0">
                      <button
                        disabled={!day.matin}
                        onClick={() => setRdvSlot({ date: day.date, periode: "matin" })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          day.matin
                            ? "bg-volt-500 text-ink-900 hover:bg-volt-400"
                            : "bg-ink-100 text-ink-300 cursor-not-allowed"
                        }`}>
                        {day.matin ? "Matin" : "Indisponible"}
                      </button>
                      <button
                        disabled={!day.aprem}
                        onClick={() => setRdvSlot({ date: day.date, periode: "aprem" })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          day.aprem
                            ? "bg-volt-500 text-ink-900 hover:bg-volt-400"
                            : "bg-ink-100 text-ink-300 cursor-not-allowed"
                        }`}>
                        {day.aprem ? "Après-midi" : "Indisponible"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-center text-ink-300 text-xs pt-2">
                Week-end ? Contactez-nous directement par téléphone.
              </p>
            </>
          )}

          {/* Formulaire de contact pour le créneau choisi */}
          {rdvSlot && (
            <div className="space-y-4">
              <div>
                <h1 className="font-display text-2xl text-ink-900">Vos coordonnées</h1>
                <p className="text-ink-500 text-sm mt-1">
                  Créneau : <strong>{fmtDateLabel(rdvSlot.date)}</strong>,{" "}
                  {rdvSlot.periode === "matin" ? "matin (8h-12h)" : "après-midi (13h-17h)"}
                </p>
              </div>
              <div className="bg-white rounded-2xl border border-ink-200 p-4 space-y-4">
                {/* Honeypot — champ invisible pour un humain, souvent rempli par les bots */}
                <div className="sr-only" aria-hidden="true">
                  <label htmlFor="site_web_rdv">Ne pas remplir ce champ</label>
                  <input
                    id="site_web_rdv"
                    type="text"
                    name="site_web"
                    tabIndex={-1}
                    autoComplete="off"
                    value={rdvForm.honeypot}
                    onChange={(e) => setRdv("honeypot", e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-600 mb-1.5">Nom complet *</label>
                  <input
                    type="text"
                    value={rdvForm.nom}
                    onChange={(e) => setRdv("nom", e.target.value)}
                    placeholder="Jean Dupont"
                    className="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-volt-500 focus:ring-2 focus:ring-volt-500/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-600 mb-1.5">Téléphone *</label>
                  <input
                    type="tel"
                    value={rdvForm.telephone}
                    onChange={(e) => setRdv("telephone", e.target.value)}
                    placeholder="06 00 00 00 00"
                    className="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-volt-500 focus:ring-2 focus:ring-volt-500/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-600 mb-1.5">Email <span className="text-ink-300 font-normal">(optionnel)</span></label>
                  <input
                    type="email"
                    value={rdvForm.email}
                    onChange={(e) => setRdv("email", e.target.value)}
                    placeholder="jean@email.com"
                    className="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-volt-500 focus:ring-2 focus:ring-volt-500/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-600 mb-1.5">Adresse du chantier <span className="text-ink-300 font-normal">(optionnel)</span></label>
                  <input
                    type="text"
                    value={rdvForm.adresse}
                    onChange={(e) => setRdv("adresse", e.target.value)}
                    placeholder="12 rue des Fleurs, 64100 Bayonne"
                    className="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-volt-500 focus:ring-2 focus:ring-volt-500/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-600 mb-1.5">Motif du rendez-vous <span className="text-ink-300 font-normal">(optionnel)</span></label>
                  <textarea
                    value={rdvForm.description}
                    onChange={(e) => setRdv("description", e.target.value)}
                    placeholder="Décrivez brièvement votre besoin…"
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-volt-500 focus:ring-2 focus:ring-volt-500/20 resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-600 mb-1.5">
                    Photos <span className="text-ink-300 font-normal">(optionnel, max 5)</span>
                  </label>
                  <input
                    ref={rdvFileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => addRdvPhotos(e.target.files)}
                  />
                  {rdvPhotos.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {rdvPhotoPreviews.map((src, i) => (
                        <div key={i} className="relative">
                          <img src={src} alt="" className="w-16 h-16 object-cover rounded-lg border border-ink-200" />
                          <button
                            onClick={() => removeRdvPhoto(i)}
                            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center">
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {rdvPhotos.length < 5 && (
                    <button
                      onClick={() => rdvFileRef.current?.click()}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-ink-200 text-ink-400 text-sm hover:border-volt-500 hover:text-volt-600 transition-colors w-full justify-center">
                      <Upload size={16} /> Ajouter des photos
                    </button>
                  )}
                </div>
              </div>

              {rdvError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">
                  {rdvError}
                </div>
              )}

              <button
                onClick={submitRdv}
                disabled={!canSubmitRdv || rdvSubmitting}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-volt-500 text-ink-900 font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-volt-400 transition-colors">
                {rdvSubmitting ? <><Loader2 size={16} className="animate-spin" /> Confirmation…</> : "Confirmer le rendez-vous"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* DEMANDE DE DEVIS (formulaire existant) */}
      {mode === "devis" && (
        <>
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
            <button onClick={backToChoice} className="flex items-center gap-1.5 text-ink-400 text-xs font-medium hover:text-ink-900 transition-colors mb-4">
              <ChevronLeft size={14} /> Retour au choix
            </button>

            {/* ÉTAPE 1 */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <h1 className="font-display text-2xl text-ink-900">Vos coordonnées</h1>
                  <p className="text-ink-500 text-sm mt-1">Pour vous recontacter rapidement.</p>
                </div>
                <div className="bg-white rounded-2xl border border-ink-200 p-4 space-y-4">
                  {/* Honeypot — champ invisible pour un humain, souvent rempli par les bots */}
                  <div className="sr-only" aria-hidden="true">
                    <label htmlFor="site_web_devis">Ne pas remplir ce champ</label>
                    <input
                      id="site_web_devis"
                      type="text"
                      name="site_web"
                      tabIndex={-1}
                      autoComplete="off"
                      value={form.honeypot}
                      onChange={(e) => set("honeypot", e.target.value)}
                    />
                  </div>
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
        </>
      )}
    </div>
  );
}

export default function DemandePage({ params }: { params: { userId: string } }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-ink-50 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-ink-400" />
        </div>
      }
    >
      <DemandePageContent userId={params.userId} />
    </Suspense>
  );
}
