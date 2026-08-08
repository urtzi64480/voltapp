"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { ArrowLeft, Check, ShoppingCart, RotateCcw, Share2, Check as CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildCourseItems, CourseItem } from "@/lib/courseItems";

export default function ListeCoursesPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [loading, setLoading] = useState(true);
  const [devisInfo, setDevisInfo] = useState<{ numero: string; statut: string; objet?: string; client?: any; liste_courses_token?: string } | null>(null);
  const [items, setItems] = useState<CourseItem[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase
      .from("devis")
      .select("numero, statut, objet, liste_courses_token, liste_courses_checked, client:clients(nom, prenom), lignes:devis_lignes(*)")
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

  async function handleShare() {
    let token = devisInfo?.liste_courses_token;
    if (!token) {
      token = crypto.randomUUID();
      const { error } = await supabase.from("devis").update({ liste_courses_token: token }).eq("id", id);
      if (error) return;
      setDevisInfo(prev => prev ? { ...prev, liste_courses_token: token } : prev);
    }
    const url = `${window.location.origin}/liste/${token}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          <button
            onClick={handleShare}
            className="btn-ghost !px-3 !py-2 inline-flex items-center gap-1.5 text-xs shrink-0"
          >
            {copied ? <CheckIcon size={14} className="text-emerald-500" /> : <Share2 size={14} />}
            {copied ? "Lien copié" : "Partager"}
          </button>
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
