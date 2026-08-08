"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { ArrowLeft, Check, ShoppingCart, RotateCcw, Share2, Link2, MessageSquare, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildCourseItems, CourseItem } from "@/lib/courseItems";

export default function ListeCoursesPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [loading, setLoading] = useState(true);
  const [devisInfo, setDevisInfo] = useState<{ numero: string; statut: string; objet?: string; client?: any; liste_courses_token?: string } | null>(null);
  const [items, setItems] = useState<CourseItem[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase
      .from("devis")
      .select("numero, statut, objet, liste_courses_token, liste_courses_checked, client:clients(nom, prenom, email, telephone), lignes:devis_lignes(*)")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (data) {
          setDevisInfo(data as any);
          setItems(buildCourseItems((data as any).lignes ?? []));
          setChecked(((data as any).liste_courses_checked as Record<string, boolean>) || {});
        }
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  async function persistChecked(next: Record<string, boolean>) {
    setChecked(next);
    await supabase.from("devis").update({ liste_courses_checked: next }).eq("id", id);
  }

  function toggle(key: string) {
    persistChecked({ ...checked, [key]: !checked[key] });
  }

  function toggleAll(value: boolean) {
    const next: Record<string, boolean> = {};
    items.forEach(it => { next[it.key] = value; });
    persistChecked(next);
  }

  async function ensureToken(): Promise<string | null> {
    let token = devisInfo?.liste_courses_token;
    if (!token) {
      token = crypto.randomUUID();
      const { error } = await supabase.from("devis").update({ liste_courses_token: token }).eq("id", id);
      if (error) return null;
      setDevisInfo(prev => prev ? { ...prev, liste_courses_token: token } : prev);
    }
    return token;
  }

  function shareMessage(url: string) {
    const client = devisInfo?.client as any;
    const prenom = client?.prenom ? `${client.prenom}, ` : "";
    return `${prenom}voici la liste de courses pour le devis ${devisInfo?.numero} : ${url}`;
  }

  async function handleOpenMenu() {
    const token = await ensureToken();
    if (!token) return;
    setMenuOpen(true);
  }

  async function handleCopy() {
    const token = devisInfo?.liste_courses_token;
    if (!token) return;
    const url = `${window.location.origin}/liste/${token}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setMenuOpen(false);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSendSms() {
    const token = devisInfo?.liste_courses_token;
    const client = devisInfo?.client as any;
    if (!token || !client?.telephone) return;
    const url = `${window.location.origin}/liste/${token}`;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const sep = isIos ? "&" : "?";
    window.location.href = `sms:${client.telephone}${sep}body=${encodeURIComponent(shareMessage(url))}`;
    setMenuOpen(false);
  }

  function handleSendEmail() {
    const token = devisInfo?.liste_courses_token;
    const client = devisInfo?.client as any;
    if (!token || !client?.email) return;
    const url = `${window.location.origin}/liste/${token}`;
    const subject = `Liste de courses — Devis ${devisInfo?.numero}`;
    window.location.href = `mailto:${client.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(shareMessage(url))}`;
    setMenuOpen(false);
  }

  const totalChecked = items.filter(it => checked[it.key]).length;

  if (loading) {
    return <Shell><div className="p-8 text-center text-ink-400">Chargement…</div></Shell>;
  }

  if (!devisInfo) {
    return <Shell><div className="p-8 text-center text-ink-400">Devis introuvable.</div></Shell>;
  }

  if (devisInfo.statut !== "signe") {
    return (
      <Shell>
        <div className="p-4 md:p-8 max-w-lg mx-auto text-center">
          <Link href={`/devis/${id}`} className="btn-ghost !px-2.5 !py-2 inline-flex mb-4"><ArrowLeft size={16} /></Link>
          <div className="card card-inner">
            <p className="text-ink-500 text-sm">La liste de courses n'est disponible qu'une fois le devis signé.</p>
          </div>
        </div>
      </Shell>
    );
  }

  const client = devisInfo.client as any;

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href={`/devis/${id}`} className="btn-ghost !px-2.5 !py-2"><ArrowLeft size={16} /></Link>
          <div className="flex-1">
            <h1 className="font-display text-2xl">Liste de courses</h1>
            <p className="text-xs text-ink-400">
              Devis {devisInfo.numero}
              {client && ` · ${client.prenom ? `${client.prenom} ${client.nom}` : client.nom}`}
            </p>
          </div>
          <div className="relative shrink-0" ref={menuRef}>
            <button
              onClick={handleOpenMenu}
              className="btn-ghost !px-3 !py-2 inline-flex items-center gap-1.5 text-xs"
            >
              {copied ? <Check size={14} className="text-emerald-500" /> : <Share2 size={14} />}
              {copied ? "Lien copié" : "Partager"}
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-ink-100 rounded-xl shadow-lg py-1 z-10">
                <button
                  onClick={handleCopy}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 text-left"
                >
                  <Link2 size={15} className="text-ink-400" /> Copier le lien
                </button>
                <button
                  onClick={handleSendSms}
                  disabled={!(devisInfo?.client as any)?.telephone}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <MessageSquare size={15} className="text-ink-400" />
                  {(devisInfo?.client as any)?.telephone ? "Envoyer par SMS" : "Envoyer par SMS (pas de tél.)"}
                </button>
                <button
                  onClick={handleSendEmail}
                  disabled={!(devisInfo?.client as any)?.email}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Mail size={15} className="text-ink-400" />
                  {(devisInfo?.client as any)?.email ? "Envoyer par email" : "Envoyer par email (pas d'adresse)"}
                </button>
              </div>
            )}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="card card-inner text-center py-8">
            <ShoppingCart size={24} className="mx-auto text-ink-300 mb-2" />
            <p className="text-ink-400 text-sm">Aucun matériel identifié sur ce devis.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-ink-500">{totalChecked} / {items.length} coché{totalChecked > 1 ? "s" : ""}</p>
              <div className="flex gap-2">
                <button onClick={() => toggleAll(true)} className="text-xs text-ink-500 hover:text-ink-700 underline">Tout cocher</button>
                <button onClick={() => toggleAll(false)} className="text-xs text-ink-500 hover:text-ink-700 underline flex items-center gap-1">
                  <RotateCcw size={11} /> Réinitialiser
                </button>
              </div>
            </div>

            <div className="card card-inner">
              <div className="space-y-1">
                {items.map(it => {
                  const isChecked = !!checked[it.key];
                  return (
                    <button
                      key={it.key}
                      onClick={() => toggle(it.key)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left",
                        isChecked ? "bg-emerald-50 border-emerald-200" : "bg-white border-ink-100 hover:border-ink-200"
                      )}
                    >
                      <div className={cn(
                        "w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors",
                        isChecked ? "bg-emerald-500 border-emerald-500" : "border-ink-300 bg-white"
                      )}>
                        {isChecked && <Check size={13} className="text-white" />}
                      </div>
                      <span className={cn("flex-1 text-sm", isChecked ? "text-ink-400 line-through" : "text-ink-800")}>
                        {it.nom}
                      </span>
                      <span className={cn("text-sm font-semibold shrink-0", isChecked ? "text-ink-300" : "text-ink-900")}>
                        {it.qty}{it.unite && it.unite !== "u" && it.unite !== "forfait" ? ` ${it.unite}` : "×"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
