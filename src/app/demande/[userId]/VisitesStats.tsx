// src/components/VisitesStats.tsx
"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2, Smartphone, Monitor, Tablet, Globe } from "lucide-react";

interface Visite {
  created_at: string;
  referrer: string | null;
  device_type: string | null;
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

// userId = l'id de l'électricien connecté (auth.uid()), pour ne voir que ses propres visites.
export default function VisitesStats({ userId }: { userId: string }) {
  const [visites, setVisites] = useState<Visite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("demande_visites")
        .select("created_at, referrer, device_type")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(500);
      setVisites(data ?? []);
      setLoading(false);
    }
    load();
  }, [userId]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-ink-200 p-5 flex items-center justify-center py-10">
        <Loader2 size={20} className="animate-spin text-ink-400" />
      </div>
    );
  }

  const total = visites.length;

  const deviceCounts = visites.reduce<Record<string, number>>((acc, v) => {
    const d = v.device_type ?? "desktop";
    acc[d] = (acc[d] ?? 0) + 1;
    return acc;
  }, {});

  const referrerCounts = visites.reduce<Record<string, number>>((acc, v) => {
    const r = referrerLabel(v.referrer);
    acc[r] = (acc[r] ?? 0) + 1;
    return acc;
  }, {});
  const topReferrers = Object.entries(referrerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-5 space-y-5">
      <div>
        <h3 className="font-display text-lg text-ink-900">Visiteurs de la page demande</h3>
        <p className="text-ink-400 text-xs mt-0.5">
          {total} visite{total > 1 ? "s" : ""} (500 dernières)
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-ink-50 rounded-xl p-3 text-center">
          <Smartphone size={18} className="mx-auto mb-1 text-ink-500" />
          <p className="text-lg font-bold text-ink-900">{pct(deviceCounts["mobile"] ?? 0)}%</p>
          <p className="text-ink-400 text-xs">Mobile</p>
        </div>
        <div className="bg-ink-50 rounded-xl p-3 text-center">
          <Monitor size={18} className="mx-auto mb-1 text-ink-500" />
          <p className="text-lg font-bold text-ink-900">{pct(deviceCounts["desktop"] ?? 0)}%</p>
          <p className="text-ink-400 text-xs">Desktop</p>
        </div>
        <div className="bg-ink-50 rounded-xl p-3 text-center">
          <Tablet size={18} className="mx-auto mb-1 text-ink-500" />
          <p className="text-lg font-bold text-ink-900">{pct(deviceCounts["tablette"] ?? 0)}%</p>
          <p className="text-ink-400 text-xs">Tablette</p>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-ink-600 mb-2 flex items-center gap-1.5">
          <Globe size={14} /> Sources principales
        </p>
        <div className="space-y-1.5">
          {topReferrers.map(([label, count]) => (
            <div key={label} className="flex items-center justify-between text-sm">
              <span className="text-ink-700">{label}</span>
              <span className="text-ink-400">
                {count} ({pct(count)}%)
              </span>
            </div>
          ))}
          {topReferrers.length === 0 && (
            <p className="text-ink-300 text-sm">Aucune donnée pour le moment.</p>
          )}
        </div>
      </div>
    </div>
  );
}
