"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { ArrowLeft, Check, ShoppingCart, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface CourseItem {
  key: string;
  nom: string;
  qty: number;
  unite?: string;
}

// Termes désignant une prestation (main d'œuvre, déplacement, étude...) à exclure de la liste d'achat
const SERVICE_REGEX = /main\s*d.?[oœ]uvre|heure(s)?(\s*suppl(émentaire)?)?|d[ée]placement|mise\s+en\s+service|intervention|diagnostic|[ée]tude|forfait\s*d[ée]placement|conseil/i;

// Retire le préfixe "Contient :" (ou variantes) placé avant la liste des composants
function stripKitPrefix(text: string): string {
  return text.replace(/^\s*contient\s*:?\s*/i, "").trim();
}

function parseKitPart(part: string): { qty: number; nom: string } {
  const m = part.trim().match(/^(\d+)\s*×\s*(.+)$/);
  if (m) return { qty: parseInt(m[1], 10), nom: m[2].trim() };
  return { qty: 1, nom: part.trim() };
}

function buildCourseItems(lignes: any[]): CourseItem[] {
  const map = new Map<string, CourseItem>();

  for (const l of lignes) {
    if (l.kit_description) {
      const cleaned = stripKitPrefix(String(l.kit_description));
      const parts = cleaned.split(",").map((s: string) => s.trim()).filter(Boolean);
      for (const part of parts) {
        const { qty: qtyUnit, nom } = parseKitPart(part);
        if (SERVICE_REGEX.test(nom)) continue;
        const qty = qtyUnit * (l.quantite || 1);
        const key = nom.toLowerCase();
        if (map.has(key)) {
          map.get(key)!.qty += qty;
        } else {
          map.set(key, { key, nom, qty });
        }
      }
    } else if (l.type_branche === "materiau") {
      const key = l.nom.toLowerCase();
      const qty = l.quantite || 1;
      if (map.has(key)) {
        map.get(key)!.qty += qty;
      } else {
        map.set(key, { key, nom: l.nom, qty, unite: l.unite });
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.nom.localeCompare(b.nom));
}

export default function ListeCoursesPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [loading, setLoading] = useState(true);
  const [devisInfo, setDevisInfo] = useState<{ numero: string; statut: string; objet?: string; client?: any } | null>(null);
  const [items, setItems] = useState<CourseItem[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    supabase
      .from("devis")
      .select("numero, statut, objet, client:clients(nom, prenom), lignes:devis_lignes(*)")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (data) {
          setDevisInfo(data as any);
          setItems(buildCourseItems((data as any).lignes ?? []));
        }
        setLoading(false);
      });
  }, [id]);

  function toggle(key: string) {
    setChecked(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleAll(value: boolean) {
    const next: Record<string, boolean> = {};
    items.forEach(it => { next[it.key] = value; });
    setChecked(next);
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
