"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Check, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildCourseItems, CourseItem } from "@/lib/courseItems";

interface PublicListeRow {
  numero: string;
  statut: string;
  objet: string | null;
  client_nom: string | null;
  client_prenom: string | null;
  lignes: any[] | null;
  checked: Record<string, boolean> | null;
}

export default function PublicListeCoursesPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [info, setInfo] = useState<PublicListeRow | null>(null);
  const [items, setItems] = useState<CourseItem[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    supabase
      .rpc("get_devis_public_liste", { p_token: token })
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setNotFound(true);
        } else {
          const row = data as PublicListeRow;
          setInfo(row);
          setItems(buildCourseItems(row.lignes ?? []));
          setChecked(row.checked || {});
        }
        setLoading(false);
      });
  }, [token]);

  async function toggle(key: string) {
    const next = { ...checked, [key]: !checked[key] };
    setChecked(next);
    await supabase.rpc("update_devis_public_liste_checked", { p_token: token, p_checked: next });
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-ink-400">Chargement…</div>;
  }

  if (notFound || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 text-center">
        <p className="text-ink-400 text-sm">Cette liste de courses n'est plus disponible.</p>
      </div>
    );
  }

  const totalChecked = items.filter(it => checked[it.key]).length;

  return (
    <div className="min-h-screen bg-ink-50/40 p-4 md:p-8">
      <div className="max-w-xl mx-auto">
        <div className="mb-6">
          <h1 className="font-display text-2xl">Liste de courses</h1>
          <p className="text-xs text-ink-400">
            Devis {info.numero}
            {(info.client_prenom || info.client_nom) && ` · ${info.client_prenom ? `${info.client_prenom} ${info.client_nom}` : info.client_nom}`}
          </p>
        </div>

        {items.length === 0 ? (
          <div className="card card-inner text-center py-8">
            <ShoppingCart size={24} className="mx-auto text-ink-300 mb-2" />
            <p className="text-ink-400 text-sm">Aucun matériel identifié sur ce devis.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-ink-500 mb-3">{totalChecked} / {items.length} coché{totalChecked > 1 ? "s" : ""}</p>
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
    </div>
  );
}
