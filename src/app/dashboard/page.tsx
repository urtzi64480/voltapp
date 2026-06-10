"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmt, PLAFOND_SERVICE, PLAFOND_MATERIAU } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { Zap, TrendingUp, FileText, Receipt, AlertTriangle, Users } from "lucide-react";

export default function DashboardPage() {
  const [stats, setStats] = useState({
    ca_service_mois: 0, ca_materiau_mois: 0, ca_total_mois: 0,
    ca_service_annee: 0, ca_materiau_annee: 0,
    devis_attente: 0, factures_impayees: 0, nb_clients: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const now = new Date();
      const debutMois = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      const debutAnnee = `${now.getFullYear()}-01-01`;

      const [{ data: fM }, { data: fA }, { data: dA }, { data: fI }, { data: cls }] = await Promise.all([
        // CA mois : factures payées ce mois, filtré sur paye_le
        supabase.from("factures").select("total_service,total_materiau,total_ttc")
          .eq("statut", "payee").gte("paye_le", debutMois),
        // CA année : factures payées cette année, filtré sur paye_le
        supabase.from("factures").select("total_service,total_materiau")
          .eq("statut", "payee").gte("paye_le", debutAnnee),
        supabase.from("devis").select("id").in("statut", ["brouillon", "envoye"]),
        supabase.from("factures").select("id").in("statut", ["impayee", "relance", "envoyee"]),
        supabase.from("clients").select("id"),
      ]);

      const sum = (rows: any[], k: string) => (rows ?? []).reduce((a, r) => a + (r[k] ?? 0), 0);
      setStats({
        ca_service_mois: sum(fM ?? [], "total_service"),
        ca_materiau_mois: sum(fM ?? [], "total_materiau"),
        ca_total_mois: sum(fM ?? [], "total_ttc"),
        ca_service_annee: sum(fA ?? [], "total_service"),
        ca_materiau_annee: sum(fA ?? [], "total_materiau"),
        devis_attente: dA?.length ?? 0,
        factures_impayees: fI?.length ?? 0,
        nb_clients: cls?.length ?? 0,
      });
      setLoading(false);
    }
    load();
  }, []);

  const pS = Math.min(100, Math.round(stats.ca_service_annee / PLAFOND_SERVICE * 100));
  const pM = Math.min(100, Math.round(stats.ca_materiau_annee / PLAFOND_MATERIAU * 100));

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-5xl mx-auto">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 className="font-display text-3xl text-ink-900">Bonjour 👋</h1>
            <p className="text-ink-500 mt-1">Voici l'état de votre activité</p>
          </div>
          <Link href="/devis/nouveau" className="btn-volt hidden md:inline-flex">
            <Zap size={16} /> Nouveau devis
          </Link>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "CA ce mois", value: loading ? "…" : fmt(stats.ca_total_mois), sub: `S ${fmt(stats.ca_service_mois)} · M ${fmt(stats.ca_materiau_mois)}`, icon: TrendingUp, color: "text-volt-600" },
            { label: "Clients", value: loading ? "…" : stats.nb_clients, sub: "enregistrés", icon: Users, color: "text-sky-600" },
            { label: "Devis en attente", value: loading ? "…" : stats.devis_attente, sub: "brouillon / envoyé", icon: FileText, color: "text-amber-600" },
            { label: "Factures impayées", value: loading ? "…" : stats.factures_impayees, sub: "envoyée / relancée", icon: Receipt, color: "text-red-600" },
          ].map(({ label, value, sub, icon: Icon, color }) => (
            <div key={label} className="card card-inner">
              <div className={`mb-2 ${color}`}><Icon size={20} /></div>
              <p className="text-xs text-ink-500 mb-0.5">{label}</p>
              <p className="text-2xl font-semibold text-ink-900">{String(value)}</p>
              <p className="text-xs text-ink-400 mt-0.5">{sub}</p>
            </div>
          ))}
        </div>

        {/* Plafonds AE */}
        <div className="card card-inner mb-6">
          <h2 className="font-semibold text-ink-800 mb-5 flex items-center gap-2">
            <TrendingUp size={17} className="text-volt-600" />
            Plafonds auto-entrepreneur {new Date().getFullYear()}
          </h2>
          <div className="space-y-4">
            {[
              { label: "Branche service", plafond: PLAFOND_SERVICE, val: stats.ca_service_annee, pct: pS, color: "bg-volt-500" },
              { label: "Branche achat/revente", plafond: PLAFOND_MATERIAU, val: stats.ca_materiau_annee, pct: pM, color: "bg-emerald-500" },
            ].map(({ label, plafond, val, pct, color }) => (
              <div key={label}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-ink-600">{label} <span className="text-ink-400">/ {fmt(plafond)}</span></span>
                  <span className="font-semibold text-ink-800">{fmt(val)} <span className="text-ink-400">({pct} %)</span></span>
                </div>
                <div className="h-2.5 bg-ink-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${pct > 80 ? "bg-red-500" : color}`} style={{ width: `${pct}%` }} />
                </div>
                {pct > 80 && (
                  <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                    <AlertTriangle size={11} /> Attention — proche du plafond
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Accès rapides */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: "/devis/nouveau", label: "Nouveau devis", icon: Zap, bg: "bg-volt-500 text-ink-900" },
            { href: "/clients/nouveau", label: "Nouveau client", icon: Users, bg: "bg-ink-900 text-white" },
            { href: "/catalogue", label: "Catalogue", icon: BookOpen, bg: "bg-white text-ink-700 border border-ink-200" },
            { href: "/crm", label: "CRM", icon: TrendingUp, bg: "bg-white text-ink-700 border border-ink-200" },
          ].map(({ href, label, icon: Icon, bg }) => (
            <Link key={href} href={href} className={`flex flex-col items-center gap-2 py-5 rounded-2xl font-medium text-sm transition-all hover:scale-105 active:scale-95 ${bg}`}>
              <Icon size={22} />
              {label}
            </Link>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function BookOpen({ size, className }: { size: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>;
}
