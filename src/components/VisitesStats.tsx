// src/components/VisitesStats.tsx
"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2, Smartphone, Monitor, Globe, Clock, UserPlus, FileSearch, X, ChevronRight } from "lucide-react";

interface Visite {
  [colonne: string]: unknown;
  created_at: string;
  referrer: string | null;
  device_type: string | null;
  navigateur: string | null;
  os: string | null;
  pays: string | null;
  ville: string | null;
  page: string | null;
  mode: string | null;
}

interface Clic {
  created_at: string;
  type_clic: string;
}

// Codes pays ISO (headers Vercel) vers libellé lisible — complété au besoin.
const PAYS_LABELS: Record<string, string> = {
  FR: "France", ES: "Espagne", PT: "Portugal", DE: "Allemagne", IT: "Italie",
  GB: "Royaume-Uni", BE: "Belgique", CH: "Suisse", NL: "Pays-Bas", US: "États-Unis",
  CA: "Canada", LU: "Luxembourg", MC: "Monaco", AD: "Andorre",
};
function paysLabel(code: string | null): string {
  if (!code) return "Inconnu";
  return PAYS_LABELS[code.toUpperCase()] ?? code.toUpperCase();
}

function referrerLabel(referrer: string | null): string {
  if (!referrer) return "Lien direct / inconnu";
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    if (host.includes("google")) return "Google";
    if (host.includes("facebook")) return "Facebook";
    if (host.includes("instagram")) return "Instagram";
    if (host.includes("bing")) return "Bing";
    return host;
  } catch {
    return "Lien direct / inconnu";
  }
}

// Traduit le libellé d'un écran de la page /demande (mode SPA) en texte lisible.
function ecranLabel(screenKey: string): string {
  if (screenKey === "devis") return "Demande de devis";
  if (screenKey === "rdv") return "Prise de rendez-vous";
  if (screenKey === "urgence") return "Urgence électrique";
  return "Écran d'accueil (choix)";
}

const CHAMPS_LABELS: Record<string, string> = {
  id: "Identifiant", user_id: "Identifiant électricien", created_at: "Date et heure",
  referrer: "Référent (URL complète)", user_agent: "User-agent", device_type: "Appareil",
  navigateur: "Navigateur", os: "Système", langue: "Langue", pays: "Pays",
  region: "Région", ville: "Ville", page: "Page", mode: "Mode / écran",
};
const CHAMPS_ORDRE = ["created_at", "ville", "region", "pays", "device_type", "navigateur", "os", "langue", "referrer", "page", "mode", "user_agent", "id", "user_id"];

function valeurChamp(cle: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (cle === "created_at") {
    return new Date(String(v)).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "medium" });
  }
  if (cle === "pays") return `${paysLabel(String(v))} (${String(v).toUpperCase()})`;
  if (cle === "device_type") return String(v) === "desktop" ? "PC" : "Mobile";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function dateVisite(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).replace(",", " ·");
}

function topEntries(counts: Record<string, number>, max = 5) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, max);
}

// userId = l'id de l'électricien connecté (auth.uid()), pour ne voir que ses propres visites.
export default function VisitesStats({ userId }: { userId: string }) {
  const [visites, setVisites] = useState<Visite[]>([]);
  const [clics, setClics] = useState<Clic[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Visite | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [visitesRes, clicsRes] = await Promise.all([
        supabase
          .from("demande_visites")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("demande_clics")
          .select("created_at, type_clic")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      setVisites((visitesRes.data ?? []) as Visite[]);
      setClics(clicsRes.data ?? []);
      setLoading(false);
    }
    load();
  }, [userId]);

  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelection(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection]);

  if (loading) {
    return (
      <div className="card card-inner flex items-center justify-center py-10">
        <Loader2 size={20} className="animate-spin text-ink-400" />
      </div>
    );
  }

  const total = visites.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  // Mobile / desktop uniquement — toute valeur historique "tablette" est regroupée avec mobile.
  const nbDesktop = visites.filter((v) => v.device_type === "desktop").length;
  const nbMobile = total - nbDesktop;

  // Les 10 visites les plus récentes (visites déjà triées par date décroissante).
  const dernieresVisites = visites.slice(0, 10);

  // Pages/écrans consultés : /a-propos vient des visites (1 ligne/session sur cette
  // page dédiée) ; les écrans de la SPA /demande (accueil/devis/rdv/urgence) viennent
  // du journal demande_clics (type_clic préfixé "ecran_") — détail complet, jamais
  // compté dans le total de visites affiché plus haut.
  const pageCounts: Record<string, number> = {};
  for (const v of visites) {
    if (v.page && v.page.includes("/a-propos")) {
      const label = "Page « En savoir plus »";
      pageCounts[label] = (pageCounts[label] ?? 0) + 1;
    }
  }
  for (const c of clics) {
    if (c.type_clic.startsWith("ecran_")) {
      const label = ecranLabel(c.type_clic.replace("ecran_", ""));
      pageCounts[label] = (pageCounts[label] ?? 0) + 1;
    }
  }
  const topPages = topEntries(pageCounts);

  const totalAjoutsContact = clics.filter((c) => c.type_clic === "ajout_contact").length;
  const tauxConversionContact = total ? Math.round((totalAjoutsContact / total) * 100) : 0;

  return (
    <div className="card card-inner space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Globe size={18} className="text-volt-600" />
          <h2 className="font-semibold text-ink-800">Visiteurs de la page demande</h2>
        </div>
        <p className="text-ink-400 text-xs mt-1">
          {total} visite{total > 1 ? "s" : ""} (500 dernières)
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-ink-50 rounded-xl p-3 text-center">
          <Smartphone size={18} className="mx-auto mb-1 text-ink-500" />
          <p className="text-lg font-bold text-ink-900">{pct(nbMobile)}%</p>
          <p className="text-ink-400 text-xs">Mobile</p>
        </div>
        <div className="bg-ink-50 rounded-xl p-3 text-center">
          <Monitor size={18} className="mx-auto mb-1 text-ink-500" />
          <p className="text-lg font-bold text-ink-900">{pct(nbDesktop)}%</p>
          <p className="text-ink-400 text-xs">PC</p>
        </div>
      </div>

      <div className="bg-volt-500/10 rounded-xl p-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-volt-500/20 flex items-center justify-center shrink-0">
          <UserPlus size={18} className="text-volt-600" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-ink-900">
            {totalAjoutsContact} ajout{totalAjoutsContact > 1 ? "s" : ""} aux contacts
          </p>
          <p className="text-ink-400 text-xs">
            {tauxConversionContact}% des visiteurs ont cliqué sur "Ajouter à mes contacts"
          </p>
        </div>
      </div>

      {topPages.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-ink-600 mb-2 flex items-center gap-1.5">
            <FileSearch size={14} /> Pages / actions demandées
          </p>
          <div className="space-y-1.5">
            {topPages.map(([label, count]) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-ink-700 truncate">{label}</span>
                <span className="text-ink-400 shrink-0 ml-2">{count} ({pct(count)}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-ink-600 mb-2 flex items-center gap-1.5">
          <Clock size={14} /> 10 dernières visites
        </p>
        <div className="space-y-2">
          {dernieresVisites.map((v, i) => {
            const lieu = v.ville ? `${v.ville} · ${paysLabel(v.pays)}` : paysLabel(v.pays);
            const isDesktop = v.device_type === "desktop";
            return (
              <button
                type="button"
                key={`${v.created_at}-${i}`}
                onClick={() => setSelection(v)}
                className="w-full text-left bg-ink-50 hover:bg-ink-100 rounded-xl p-3 text-sm transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ink-800 font-medium flex items-center gap-1.5 min-w-0">
                    {isDesktop ? <Monitor size={14} className="shrink-0 text-ink-500" /> : <Smartphone size={14} className="shrink-0 text-ink-500" />}
                    <span className="truncate">{lieu}</span>
                  </span>
                  <span className="text-ink-400 text-xs shrink-0">{dateVisite(v.created_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <p className="text-ink-400 text-xs truncate">
                    {referrerLabel(v.referrer)} · {v.navigateur ?? "Navigateur inconnu"} / {v.os ?? "OS inconnu"}
                  </p>
                  <ChevronRight size={14} className="shrink-0 text-ink-300" />
                </div>
              </button>
            );
          })}
          {dernieresVisites.length === 0 && <p className="text-ink-300 text-sm">Aucune donnée pour le moment.</p>}
        </div>
      </div>
      {selection && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4"
          onClick={() => setSelection(null)}
        >
          <div className="card w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setSelection(null)}
              className="absolute top-4 right-4 text-ink-300 hover:text-ink-500 transition-colors"
              aria-label="Fermer"
            >
              <X size={18} />
            </button>
            <h3 className="font-display text-lg text-ink-900 mb-4 pr-6">Détail de la visite</h3>
            <dl className="space-y-3">
              {[...CHAMPS_ORDRE.filter((c) => c in selection), ...Object.keys(selection).filter((c) => !CHAMPS_ORDRE.includes(c))].map((cle) => (
                <div key={cle}>
                  <dt className="text-ink-400 text-xs">{CHAMPS_LABELS[cle] ?? cle}</dt>
                  <dd className="text-ink-800 text-sm break-words">{valeurChamp(cle, selection[cle])}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
