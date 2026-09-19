// src/components/VisitesStats.tsx
"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2, Smartphone, Monitor, Globe, Link2, AppWindow, Cpu, MapPin, UserPlus, FileSearch } from "lucide-react";

interface Visite {
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

function topEntries(counts: Record<string, number>, max = 5) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, max);
}

// userId = l'id de l'électricien connecté (auth.uid()), pour ne voir que ses propres visites.
export default function VisitesStats({ userId }: { userId: string }) {
  const [visites, setVisites] = useState<Visite[]>([]);
  const [clics, setClics] = useState<Clic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [visitesRes, clicsRes] = await Promise.all([
        supabase
          .from("demande_visites")
          .select("created_at, referrer, device_type, navigateur, os, pays, ville, page, mode")
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
      setVisites(visitesRes.data ?? []);
      setClics(clicsRes.data ?? []);
      setLoading(false);
    }
    load();
  }, [userId]);

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

  const referrerCounts = visites.reduce<Record<string, number>>((acc, v) => {
    const r = referrerLabel(v.referrer);
    acc[r] = (acc[r] ?? 0) + 1;
    return acc;
  }, {});
  const topReferrers = topEntries(referrerCounts);

  const browserCounts = visites.reduce<Record<string, number>>((acc, v) => {
    const b = v.navigateur ?? "Inconnu";
    acc[b] = (acc[b] ?? 0) + 1;
    return acc;
  }, {});
  const topBrowsers = topEntries(browserCounts);

  const osCounts = visites.reduce<Record<string, number>>((acc, v) => {
    const o = v.os ?? "Inconnu";
    acc[o] = (acc[o] ?? 0) + 1;
    return acc;
  }, {});
  const topOS = topEntries(osCounts);

  const locationCounts = visites.reduce<Record<string, number>>((acc, v) => {
    const label = v.ville ? `${v.ville} · ${paysLabel(v.pays)}` : paysLabel(v.pays);
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
  const topLocations = topEntries(locationCounts);

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <p className="text-xs font-semibold text-ink-600 mb-2 flex items-center gap-1.5">
            <Link2 size={14} /> Sources principales
          </p>
          <div className="space-y-1.5">
            {topReferrers.map(([label, count]) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-ink-700 truncate">{label}</span>
                <span className="text-ink-400 shrink-0 ml-2">{count} ({pct(count)}%)</span>
              </div>
            ))}
            {topReferrers.length === 0 && <p className="text-ink-300 text-sm">Aucune donnée pour le moment.</p>}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-ink-600 mb-2 flex items-center gap-1.5">
            <MapPin size={14} /> Localisation
          </p>
          <div className="space-y-1.5">
            {topLocations.map(([label, count]) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-ink-700 truncate">{label}</span>
                <span className="text-ink-400 shrink-0 ml-2">{count} ({pct(count)}%)</span>
              </div>
            ))}
            {topLocations.length === 0 && <p className="text-ink-300 text-sm">Aucune donnée pour le moment.</p>}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-ink-600 mb-2 flex items-center gap-1.5">
            <AppWindow size={14} /> Navigateurs
          </p>
          <div className="space-y-1.5">
            {topBrowsers.map(([label, count]) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-ink-700 truncate">{label}</span>
                <span className="text-ink-400 shrink-0 ml-2">{count} ({pct(count)}%)</span>
              </div>
            ))}
            {topBrowsers.length === 0 && <p className="text-ink-300 text-sm">Aucune donnée pour le moment.</p>}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-ink-600 mb-2 flex items-center gap-1.5">
            <Cpu size={14} /> Système
          </p>
          <div className="space-y-1.5">
            {topOS.map(([label, count]) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-ink-700 truncate">{label}</span>
                <span className="text-ink-400 shrink-0 ml-2">{count} ({pct(count)}%)</span>
              </div>
            ))}
            {topOS.length === 0 && <p className="text-ink-300 text-sm">Aucune donnée pour le moment.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
