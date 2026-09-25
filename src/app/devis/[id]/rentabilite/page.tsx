"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { ArrowLeft, Euro, AlertTriangle } from "lucide-react";
import { fmt, cn } from "@/lib/utils";

function margeColor(pct: number) {
  if (pct < 0) return "text-red-600";
  if (pct < 20) return "text-amber-600";
  return "text-emerald-600";
}

interface DevisInfo {
  numero: string;
  total_service: number;
  total_materiau: number;
  total_ttc: number;
  lignes: any[];
  client?: { nom: string; prenom?: string } | null;
}

export default function RentabiliteDevisPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [devis, setDevis] = useState<DevisInfo | null>(null);
  const [profil, setProfil] = useState<any>(null);
  const [prixAchatMap, setPrixAchatMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // Coût d'achat par prestation vendue dans le devis (clé = prestation_id de la ligne) —
  // reproduit exactement loadPrixAchatMap() de la page devis/[id] : cas simple (prix_achat
  // direct) + cas kit (somme quantite_composant × prix_achat_composant via kit_composants).
  async function loadPrixAchatMap(lignesArr: any[]) {
    const prestationIds = Array.from(new Set((lignesArr ?? []).map((l: any) => l.prestation_id).filter(Boolean)));
    if (prestationIds.length === 0) { setPrixAchatMap({}); return; }

    const { data: prestInfo, error: errPrest } = await supabase
      .from("prestations").select("id,prix_achat,est_kit").in("id", prestationIds);
    if (errPrest) { console.error("Erreur récupération prestations (prix_achat) :", errPrest); setPrixAchatMap({}); return; }

    const map: Record<string, number> = {};
    (prestInfo ?? []).forEach((p: any) => { if (!p.est_kit) map[p.id] = p.prix_achat ?? 0; });

    const kitIds = (prestInfo ?? []).filter((p: any) => p.est_kit).map((p: any) => p.id);
    if (kitIds.length > 0) {
      const { data: composants, error: errComp } = await supabase
        .from("kit_composants").select("kit_id,composant_id,quantite").in("kit_id", kitIds);
      if (errComp) console.error("Erreur récupération kit_composants (rentabilité) :", errComp);

      const composantIds = Array.from(new Set((composants ?? []).map((c: any) => c.composant_id).filter(Boolean)));
      const prixComposantMap: Record<string, number> = {};
      if (composantIds.length > 0) {
        const { data: composantPrest, error: errCompPrest } = await supabase
          .from("prestations").select("id,prix_achat").in("id", composantIds);
        if (errCompPrest) console.error("Erreur récupération prix_achat composants de kit :", errCompPrest);
        (composantPrest ?? []).forEach((c: any) => { prixComposantMap[c.id] = c.prix_achat ?? 0; });
      }

      (composants ?? []).forEach((c: any) => {
        const prixAchatComposant = prixComposantMap[c.composant_id] ?? 0;
        map[c.kit_id] = (map[c.kit_id] ?? 0) + (c.quantite ?? 0) * prixAchatComposant;
      });
    }

    setPrixAchatMap(map);
  }

  useEffect(() => {
    supabase.from("devis")
      .select("numero, total_service, total_materiau, total_ttc, client:clients(nom, prenom), lignes:devis_lignes(*)")
      .eq("id", id).single().then(({ data, error }) => {
        if (error) console.error("Erreur récupération devis (rentabilité) :", error);
        if (data) {
          setDevis(data as any);
          loadPrixAchatMap((data as any).lignes ?? []);
        }
        setLoading(false);
      });

    // Même UUID profil codé en dur qu'ailleurs dans le module devis (multi-tenant non
    // requis ici — voir devis/[id]/page.tsx).
    supabase.from("profil").select("*").eq("id", "d506c94e-40c7-4bcd-a48c-97e86f4ea7c0").single()
      .then(({ data }) => { if (data) setProfil(data); });
  }, [id]);

  if (loading) return <Shell><div className="p-8 text-center text-ink-400">Chargement…</div></Shell>;
  if (!devis) return <Shell><div className="p-8 text-center text-ink-400">Devis introuvable.</div></Shell>;

  const client = devis.client as any;
  const viewLignes = devis.lignes ?? [];

  // ── Rentabilité du devis ──
  // Cotisations URSSAF par branche issues du profil (mêmes taux et mêmes clés que dans le
  // CRM et l'ancien bloc de devis/[id]/page.tsx). Coût d'achat calculé ligne par ligne à
  // partir du prix_achat catalogue actuel de chaque prestation liée. Les lignes libres ou
  // dont la prestation n'a pas de prix d'achat renseigné ne contribuent pas au coût
  // d'achat et sont signalées individuellement.
  const tauxCotisService = profil?.taux_cotisations_service ?? 21.2;
  const tauxCotisMateriau = profil?.taux_cotisations_materiau ?? 12.3;
  const tauxIrService = profil?.taux_ir_service ?? 0;
  const tauxIrMateriau = profil?.taux_ir_materiau ?? 0;

  const lignesRentab = viewLignes.map((l: any) => {
    const prixAchatUnitaire: number | null = l.prestation_id ? (prixAchatMap[l.prestation_id] ?? null) : null;
    const coutAchat = prixAchatUnitaire && prixAchatUnitaire > 0 ? prixAchatUnitaire * l.quantite : 0;
    const venteLigne = l.prix_unitaire * l.quantite;
    const margeLigne = coutAchat > 0 ? venteLigne - coutAchat : null;
    const sansCoutAchat = l.type_branche === "materiau" && coutAchat === 0;
    return { ...l, coutAchat, venteLigne, margeLigne, sansCoutAchat };
  });
  const coutAchatTotal = lignesRentab.reduce((a: number, l: any) => a + l.coutAchat, 0);
  const cotisationService = devis.total_service * tauxCotisService / 100;
  const cotisationMateriau = devis.total_materiau * tauxCotisMateriau / 100;
  const irService = devis.total_service * tauxIrService / 100;
  const irMateriau = devis.total_materiau * tauxIrMateriau / 100;
  const netService = devis.total_service - cotisationService - irService;
  const netMateriau = devis.total_materiau - cotisationMateriau - irMateriau - coutAchatTotal;
  const netGlobal = netService + netMateriau;
  const margeGlobalePct = devis.total_ttc > 0 ? Math.round(netGlobal / devis.total_ttc * 1000) / 10 : 0;
  const hasLigneSansCoutAchat = lignesRentab.some((l: any) => l.sansCoutAchat);

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href={`/devis/${id}`} className="btn-ghost !px-2.5 !py-2"><ArrowLeft size={16} /></Link>
          <div className="flex-1">
            <h1 className="font-display text-2xl">Rentabilité</h1>
            <p className="text-xs text-ink-400">
              Devis {devis.numero}
              {client && ` · ${client.prenom ? `${client.prenom} ${client.nom}` : client.nom}`}
            </p>
          </div>
        </div>

        <div className="card card-inner mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Euro size={17} className="text-volt-600" />
            <h2 className="font-semibold text-ink-800 flex-1">Rentabilité de ce devis</h2>
            <span className={cn("text-sm font-bold", margeColor(margeGlobalePct))}>{fmt(netGlobal)} ({margeGlobalePct}%)</span>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="bg-ink-50 rounded-xl p-3">
                <p className="text-xs text-ink-400 mb-0.5">Vente TTC</p>
                <p className="text-base font-bold text-ink-900">{fmt(devis.total_ttc)}</p>
              </div>
              <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                <p className="text-xs text-red-400 mb-0.5">Achat matériel</p>
                <p className="text-base font-bold text-red-700">− {fmt(coutAchatTotal)}</p>
              </div>
              <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                <p className="text-xs text-red-400 mb-0.5">Cotisations{tauxIrService > 0 || tauxIrMateriau > 0 ? " + IR" : ""}</p>
                <p className="text-base font-bold text-red-700">− {fmt(cotisationService + cotisationMateriau + irService + irMateriau)}</p>
              </div>
              <div className={cn("rounded-xl p-3 border", margeGlobalePct < 0 ? "bg-red-50 border-red-100" : "bg-emerald-50 border-emerald-200")}>
                <p className="text-xs text-ink-400 mb-0.5">Marge nette</p>
                <p className={cn("text-base font-bold", margeColor(margeGlobalePct))}>{fmt(netGlobal)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-3 rounded-xl bg-volt-50 border border-volt-100">
                <p className="text-xs font-semibold text-volt-700 mb-1">⚡ Service</p>
                <div className="space-y-0.5 text-xs text-ink-600">
                  <div className="flex justify-between"><span>CA</span><span className="font-semibold">{fmt(devis.total_service)}</span></div>
                  <div className="flex justify-between text-red-500"><span>Cotisations ({tauxCotisService}%)</span><span>− {fmt(cotisationService)}</span></div>
                  {irService > 0 && <div className="flex justify-between text-red-500"><span>IR ({tauxIrService}%)</span><span>− {fmt(irService)}</span></div>}
                  <div className="flex justify-between font-semibold pt-1 border-t border-volt-200"><span>Net</span><span className={margeColor(devis.total_service > 0 ? Math.round(netService / devis.total_service * 100) : 0)}>{fmt(netService)}</span></div>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                <p className="text-xs font-semibold text-emerald-700 mb-1">📦 Matériaux</p>
                <div className="space-y-0.5 text-xs text-ink-600">
                  <div className="flex justify-between"><span>CA</span><span className="font-semibold">{fmt(devis.total_materiau)}</span></div>
                  <div className="flex justify-between text-red-500"><span>Achat</span><span>− {fmt(coutAchatTotal)}</span></div>
                  <div className="flex justify-between text-red-500"><span>Cotisations ({tauxCotisMateriau}%)</span><span>− {fmt(cotisationMateriau)}</span></div>
                  {irMateriau > 0 && <div className="flex justify-between text-red-500"><span>IR ({tauxIrMateriau}%)</span><span>− {fmt(irMateriau)}</span></div>}
                  <div className="flex justify-between font-semibold pt-1 border-t border-emerald-200"><span>Net</span><span className={margeColor(devis.total_materiau > 0 ? Math.round(netMateriau / devis.total_materiau * 100) : 0)}>{fmt(netMateriau)}</span></div>
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-2">Détail par ligne</p>
              <div className="space-y-1">
                {lignesRentab.map((l: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-ink-50 text-xs">
                    <span className={cn("badge shrink-0", l.type_branche === "service" ? "bg-volt-100 text-volt-700" : "bg-emerald-100 text-emerald-700")}>
                      {l.type_branche === "service" ? "S" : "M"}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-ink-800">{l.nom}</span>
                    {l.coutAchat > 0 ? (
                      <>
                        <span className="text-ink-400 shrink-0">Vente {fmt(l.venteLigne)}</span>
                        <span className="text-red-500 shrink-0">Achat {fmt(l.coutAchat)}</span>
                        <span className={cn("font-semibold shrink-0", margeColor(l.venteLigne > 0 ? (l.margeLigne / l.venteLigne * 100) : 0))}>{fmt(l.margeLigne)}</span>
                      </>
                    ) : l.sansCoutAchat ? (
                      <span className="text-amber-600 flex items-center gap-1 shrink-0"><AlertTriangle size={11} /> Coût d'achat inconnu</span>
                    ) : (
                      <span className="text-ink-400 shrink-0">{fmt(l.venteLigne)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {hasLigneSansCoutAchat && (
              <p className="text-xs text-amber-600 flex items-center gap-1.5">
                <AlertTriangle size={12} className="shrink-0" /> Certaines lignes matériau n'ont pas de prix d'achat renseigné dans le catalogue (ligne libre, kit, ou fiche non complétée) — la marge de ce devis est donc probablement surestimée.
              </p>
            )}
            <p className="text-xs text-ink-400">
              Cotisations et coût d'achat calculés sur les totaux du devis, cotisations URSSAF par branche du profil, prix d'achat catalogue actuel.
            </p>
          </div>
        </div>
      </div>
    </Shell>
  );
}
