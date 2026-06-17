"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, FileText, BookOpen,
  TrendingUp, Settings, Zap, Menu, X, Receipt, CalendarDays, AlertTriangle, ClipboardList, Inbox,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

const NAV = [
  { href: "/dashboard",  label: "Dashboard",  icon: LayoutDashboard },
  { href: "/clients",    label: "Clients",     icon: Users },
  { href: "/leads",      label: "Leads web",   icon: Inbox },
  { href: "/demandes",   label: "Demandes",    icon: ClipboardList },
  { href: "/devis",      label: "Devis",       icon: FileText },
  { href: "/planning",   label: "Planning",    icon: CalendarDays },
  { href: "/factures",   label: "Factures",    icon: Receipt },
  { href: "/catalogue",  label: "Catalogue",   icon: BookOpen },
  { href: "/tableau",    label: "Tableaux",    icon: Zap },
  { href: "/crm",        label: "CRM",         icon: TrendingUp },
  { href: "/parametres", label: "Paramètres",  icon: Settings },
];

const BOTTOM_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients",   label: "Clients",   icon: Users },
  { href: "/leads",     label: "Leads",     icon: Inbox },
  { href: "/devis",     label: "Devis",     icon: FileText },
  { href: "/crm",       label: "CRM",       icon: TrendingUp },
];

function NavLink({ href, label, Icon, active, onClick, badge }: {
  href: string; label: string; Icon: any; active: boolean; onClick?: () => void; badge?: number;
}) {
  return (
    <Link href={href} onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 relative",
        active
          ? "bg-volt-500 text-ink-900"
          : "text-ink-400 hover:bg-ink-800 hover:text-white"
      )}>
      <Icon size={17} />
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold shrink-0">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Link>
  );
}

function LogoBlock({ nomEntreprise, logoUrl, size = "md" }: { nomEntreprise: string; logoUrl?: string | null; size?: "sm" | "md" }) {
  const parts = nomEntreprise.trim().split(" ");
  const first = parts[0] ?? "";
  const rest = parts.slice(1).join(" ");

  if (size === "sm") {
    return (
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-volt-500 flex items-center justify-center shrink-0 overflow-hidden">
          {logoUrl
            ? <img src={logoUrl} alt="logo" className="w-full h-full object-contain p-0.5" />
            : <Zap size={14} className="text-ink-900" />}
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-white text-sm leading-none">{first}</span>
          {rest && <span className="text-ink-400 text-[10px] tracking-widest uppercase">{rest}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-volt-500 flex items-center justify-center shrink-0 overflow-hidden">
        {logoUrl
          ? <img src={logoUrl} alt="logo" className="w-full h-full object-contain p-0.5" />
          : <Zap size={18} className="text-ink-900" />}
      </div>
      <div className="flex flex-col leading-tight">
        <span className="font-display text-white text-base leading-none">{first}</span>
        {rest && <span className="text-ink-400 text-xs tracking-widest uppercase">{rest}</span>}
      </div>
    </div>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [facturesEnRetard, setFacturesEnRetard] = useState(0);
  const [leadsNouveaux, setLeadsNouveaux] = useState(0);
  const [nomEntreprise, setNomEntreprise] = useState("VoltApp");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const isActive = (href: string) =>
    href === "/dashboard" ? path === href : path.startsWith(href);

  useEffect(() => {
    async function loadProfil() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase
        .from("profil")
        .select("nom_entreprise, prenom, nom, logo_url")
        .eq("id", session.user.id)
        .single();
      if (data) {
        const name = data.nom_entreprise?.trim()
          || [data.prenom, data.nom].filter(Boolean).join(" ")
          || "VoltApp";
        setNomEntreprise(name);
        if ((data as any).logo_url) setLogoUrl((data as any).logo_url);
      }
    }
    loadProfil();
  }, []);

  useEffect(() => {
    const seuilDate = new Date();
    seuilDate.setDate(seuilDate.getDate() - 15);
    const seuil = seuilDate.toISOString().split("T")[0];

    supabase
      .from("factures")
      .select("id", { count: "exact" })
      .in("statut", ["envoyee", "relance"])
      .lt("date_echeance", seuil)
      .then(({ count }) => setFacturesEnRetard(count ?? 0));

    supabase
      .from("demandes_client")
      .select("id", { count: "exact" })
      .eq("statut", "nouveau")
      .then(({ count }) => setLeadsNouveaux(count ?? 0));
  }, [path]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar desktop ── */}
      <aside className="hidden md:flex flex-col w-56 bg-ink-900 shrink-0">
        <div className="flex items-center gap-3 px-4 py-4 border-b border-ink-700">
          <LogoBlock nomEntreprise={nomEntreprise} logoUrl={logoUrl} size="md" />
        </div>

        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, label, icon: Icon }) => (
            <NavLink
              key={href} href={href} label={label} Icon={Icon}
              active={isActive(href)}
              badge={
                href === "/factures" ? facturesEnRetard :
                href === "/leads" ? leadsNouveaux :
                undefined
              }
            />
          ))}
        </nav>

        <div className="p-3 border-t border-ink-700">
          <Link href="/devis/nouveau"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-volt-500 text-ink-900 text-sm font-semibold hover:bg-volt-400 transition-colors">
            <Zap size={15} />
            Nouveau devis
          </Link>
        </div>
      </aside>

      {/* ── Mobile header ── */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 bg-ink-900 border-b border-ink-700 flex items-center justify-between px-4 py-3">
        <LogoBlock nomEntreprise={nomEntreprise} logoUrl={logoUrl} size="sm" />
        <div className="flex items-center gap-2">
          {facturesEnRetard > 0 && (
            <Link href="/factures" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500 text-white text-xs font-semibold">
              <AlertTriangle size={12} /> {facturesEnRetard}
            </Link>
          )}
          {leadsNouveaux > 0 && (
            <Link href="/leads" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500 text-white text-xs font-semibold">
              <Inbox size={12} /> {leadsNouveaux}
            </Link>
          )}
          <Link href="/devis/nouveau"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-volt-500 text-ink-900 text-xs font-semibold">
            <Zap size={12} /> Devis
          </Link>
          <button onClick={() => setDrawer(true)} className="p-1.5 rounded-lg text-ink-400 hover:text-white">
            <Menu size={20} />
          </button>
        </div>
      </div>

      {/* ── Mobile drawer ── */}
      {drawer && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <aside className="relative w-64 bg-ink-900 flex flex-col h-full shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-ink-700">
              <LogoBlock nomEntreprise={nomEntreprise} logoUrl={logoUrl} size="sm" />
              <button onClick={() => setDrawer(false)} className="text-ink-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
              {NAV.map(({ href, label, icon: Icon }) => (
                <NavLink
                  key={href} href={href} label={label} Icon={Icon}
                  active={isActive(href)}
                  onClick={() => setDrawer(false)}
                  badge={
                    href === "/factures" ? facturesEnRetard :
                    href === "/leads" ? leadsNouveaux :
                    undefined
                  }
                />
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* ── Main ── */}
      <main className="flex-1 overflow-y-auto md:pt-0 pt-14 pb-20 md:pb-0 bg-ink-50">
        {children}
      </main>

      {/* ── Bottom nav mobile ── */}
      <nav className="bottom-nav">
        {BOTTOM_NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}
            className={cn("bottom-nav-item relative", isActive(href) && "active")}>
            <Icon size={20} />
            {href === "/factures" && facturesEnRetard > 0 && (
              <span className="absolute top-0 right-3 w-4 h-4 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center">
                {facturesEnRetard > 9 ? "9+" : facturesEnRetard}
              </span>
            )}
            {href === "/leads" && leadsNouveaux > 0 && (
              <span className="absolute top-0 right-3 w-4 h-4 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center">
                {leadsNouveaux > 9 ? "9+" : leadsNouveaux}
              </span>
            )}
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
