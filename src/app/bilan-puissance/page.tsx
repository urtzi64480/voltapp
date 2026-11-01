"use client";
// Bilan de puissance INDICATIF : choisir la puissance de l'abonnement (kVA) à partir des appareils. Peut être pré-rempli
// depuis un devis (?devis=<id>). Ce n'est pas le calcul réglementaire : coefficients modifiables et à vérifier.
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Gauge, Plus, Trash2 } from "lucide-react";
import Shell from "@/components/layout/Shell";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { APPAREILS, lignesDepuisDevis, palierRecommande, totalInstalle, wattsAppeles, type LignePuissance } from "@/lib/puissance";

const nombre = (v: string, d = 0) => { const n = parseFloat(v.replace(",", ".")); return Number.isFinite(n) && n >= 0 ? n : d; };

function Bilan() {
  const devisId = useSearchParams().get("devis");
  const [lignes, setLignes] = useState<LignePuissance[]>([]);
  const [triphase, setTriphase] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!devisId) return;
    let annule = false;
    supabase.from("devis").select("objet, lignes:devis_lignes(nom, description, poste)").eq("id", devisId).single().then(({ data }) => {
      if (annule || !data) return;
      const d = data as unknown as { objet?: string | null; lignes?: { nom?: string; description?: string; poste?: string | null }[] };
      const l = lignesDepuisDevis([d.objet, ...(d.lignes ?? []).flatMap(x => [x.nom, x.description, x.poste])]);
      setLignes(l);
      setInfo(l.length > 0 ? `${l.length} appareil${l.length > 1 ? "s" : ""} repéré${l.length > 1 ? "s" : ""} dans le devis : ajuste les quantités.` : "Aucun appareil reconnu dans ce devis : ajoute-les à la main.");
    });
    return () => { annule = true; };
  }, [devisId]);

  const appele = useMemo(() => wattsAppeles(lignes), [lignes]);
  const installe = useMemo(() => totalInstalle(lignes), [lignes]);
  const palier = palierRecommande(appele, triphase);
  const maj = (i: number, p: Partial<LignePuissance>) => setLignes(prev => prev.map((l, j) => (j === i ? { ...l, ...p } : l)));

  return (
    <Shell>
      <div className="max-w-3xl mx-auto p-4 md:p-8">
        <h1 className="font-display text-3xl text-ink-900 flex items-center gap-2"><Gauge size={26} /> Bilan de puissance</h1>
        <p className="text-ink-500 text-sm mt-1">Estimation de la puissance d&apos;abonnement à partir des appareils. Indicatif : ce n&apos;est pas le calcul réglementaire, vérifie les coefficients.</p>
        {info && <p className="text-xs text-ink-600 mt-3" role="status">{info}</p>}

        <div className="card card-inner mt-4 space-y-2">
          {lignes.length === 0 && <p className="text-sm text-ink-400">Ajoute des appareils ci-dessous.</p>}
          {lignes.map((l, i) => (
            <div key={`${l.id}-${i}`} className="grid grid-cols-12 gap-2 items-end text-xs">
              <p className="col-span-12 md:col-span-4 text-sm text-ink-800 self-center">{l.libelle}</p>
              <label className="col-span-4 md:col-span-2">Watts<input className="input !py-1" inputMode="decimal" value={l.watts} onChange={e => maj(i, { watts: nombre(e.target.value) })} /></label>
              <label className="col-span-3 md:col-span-2">Quantité<input className="input !py-1" inputMode="numeric" value={l.quantite} onChange={e => maj(i, { quantite: Math.round(nombre(e.target.value)) })} /></label>
              <label className="col-span-4 md:col-span-3">Simultanéité %<input className="input !py-1" inputMode="decimal" value={Math.round(l.coef * 100)} onChange={e => maj(i, { coef: Math.min(100, nombre(e.target.value)) / 100 })} /></label>
              <button type="button" className="col-span-1 text-ink-300 hover:text-red-600 pb-2" aria-label="Retirer" onClick={() => setLignes(prev => prev.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="pt-2 flex flex-wrap gap-1.5">
            {APPAREILS.map(a => (
              <button key={a.id} type="button" className="btn-ghost !py-1 !px-2 !text-xs" onClick={() => setLignes(prev => [...prev, { id: a.id, libelle: a.libelle, watts: a.watts, quantite: 1, coef: a.coef }])}>
                <Plus size={12} /> {a.libelle}
              </button>
            ))}
          </div>
        </div>

        <div className="card card-inner mt-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={triphase} onChange={e => setTriphase(e.target.checked)} /> Alimentation triphasée</label>
          <p className="text-sm text-ink-600 mt-3">Puissance installée : <b>{(installe / 1000).toFixed(1)} kVA</b> · appelée estimée : <b>{(appele / 1000).toFixed(1)} kVA</b></p>
          <p className={cn("text-lg font-semibold mt-1", palier ? "text-ink-900" : "text-red-600")}>
            {lignes.length === 0 ? "—" : palier ? `Abonnement conseillé : ${palier} kVA${triphase ? " (triphasé)" : ""}` : "Au-delà des paliers courants : étude spécifique avec le distributeur."}
          </p>
          <p className="text-[11px] text-ink-400 mt-2">Cos φ = 1, puissance appelée = Σ (watts × quantité × simultanéité). Paliers courants : 3, 6, 9, 12, 15, 18, 24, 30, 36 kVA.</p>
        </div>
      </div>
    </Shell>
  );
}

export default function BilanPuissancePage() { return <Suspense fallback={null}><Bilan /></Suspense>; }
