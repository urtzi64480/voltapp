"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Facture } from "@/types";
import { fmt, fmtDate, STATUT_LABELS, STATUT_COLORS, cn } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, CheckCircle, Clock, Trash2 } from "lucide-react";

interface Apporteur {
  id: string;
  nom: string;
  entreprise?: string;
}

export default function FactureDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [facture, setFacture] = useState<Facture | null>(null);
  const [apporteurs, setApporteurs] = useState<Apporteur[]>([]);
  const [apporteurId, setApporteurId] = useState("");
  const [savingApporteur, setSavingApporteur] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("factures").select("*, client:clients(*), lignes:facture_lignes(*)").eq("id", id).single(),
      supabase.from("apporteurs").select("id,nom,entreprise").eq("actif", true).order("nom"),
    ]).then(([{ data: f }, { data: ap }]) => {
      setFacture(f as any);
      setApporteurs(ap ?? []);
      setApporteurId((f as any)?.apporteur_id ?? "");
    });
  }, [id]);

  async function saveApporteur() {
    setSavingApporteur(true);
    await supabase.from("factures").update({ apporteur_id: apporteurId || null }).eq("id", id);
    setSavingApporteur(false);
  }

  async function marquerPayee() {
    await supabase.from("factures").update({ statut: "payee", paye_le: new Date().toISOString() }).eq("id", id);
    setFacture(f => f ? { ...f, statut: "payee", paye_le: new Date().toISOString() } : f);
  }

  async function marquerRelance() {
    await supabase.from("factures").update({ statut: "relance" }).eq("id", id);
    setFacture(f => f ? { ...f, statut: "relance" } : f);
  }

  async function deleteFacture() {
    await supabase.from("facture_lignes").delete().eq("facture_id", id);
    await supabase.from("factures").delete().eq("id", id);
    router.push("/factures");
  }

  async function dl() {
    if (!facture) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: p } = await supabase.from("profil").select("*").eq("id", user.id).single();
    const { genPDFFacture } = await import("@/lib/pdf");
    await genPDFFacture(facture, p ?? { id: user.id, prefixe_devis: "DEV", prefixe_facture: "FAC", compteur_devis: 0, compteur_facture: 0, mention_tva: "TVA non applicable — Art. 293 B du CGI", conditions_paiement: "Paiement à réception", taux_horaire: 55, created_at: "", updated_at: "" });
  }

  if (!facture) return <Shell><div className="p-8 text-center text-ink-400">Chargement…</div></Shell>;

  const lignes = (facture.lignes ?? []) as any[];
  const client = facture.client as any;
  const apporteurActuel = apporteurs.find(a => a.id === apporteurId);

  const lignesSBrut = lignes.filter((l: any) => l.type_branche === "service").reduce((a: number, l: any) => a + l.prix_unitaire * l.quantite, 0);
  const lignesMBrut = lignes.filter((l: any) => l.type_branche === "materiau").reduce((a: number, l: any) => a + l.prix_unitaire * l.quantite, 0);
  const remiseFideliteEur = facture.remise_fidelite_pct
    ? Math.round(facture.total_service / (1 - facture.remise_fidelite_pct / 100) * facture.remise_fidelite_pct / 100 * 100) / 100 : 0;
  const remiseS = lignesSBrut - facture.total_service - remiseFideliteEur;
  const remiseM = lignesMBrut - facture.total_materiau;
  const hasRemise = remiseS > 0.01 || remiseM > 0.01;

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-3xl mx-auto">

        {confirmDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
              <h3 className="font-semibold text-ink-900 text-lg mb-2">Supprimer cette facture ?</h3>
              <p className="text-sm text-ink-500 mb-5">Cette action est irréversible. La facture <strong>{facture.numero}</strong> sera définitivement supprimée.</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDelete(false)} className="btn-ghost flex-1 justify-center">Annuler</button>
                <button onClick={deleteFacture} className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl px-4 py-2.5 text-sm transition-colors">
                  <Trash2 size={14} /> Supprimer
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 mb-6">
          <Link href="/factures" className="btn-ghost !px-2.5 !py-2"><ArrowLeft size={16} /></Link>
          <h1 className="font-display text-2xl flex-1">{facture.numero}</h1>
          <span className={cn("badge", STATUT_COLORS[facture.statut])}>{STATUT_LABELS[facture.statut]}</span>
          <button onClick={() => setConfirmDelete(true)} className="btn-ghost !px-2.5 !py-2 text-red-400 hover:text-red-600 hover:bg-red-50">
            <Trash2 size={16} />
          </button>
        </div>

        <div className="card card-inner mb-4 flex flex-wrap gap-4 text-sm">
          {client && <div><p className="label">Client</p><p className="font-semibold">{client.prenom ? `${client.prenom} ${client.nom}` : client.nom}</p></div>}
          <div><p className="label">Date</p><p>{fmtDate(facture.date_emission)}</p></div>
          {facture.date_echeance && <div><p className="label">Échéance</p><p>{fmtDate(facture.date_echeance)}</p></div>}
          {facture.paye_le && <div><p className="label">Payée le</p><p className="text-emerald-600 font-semibold">{fmtDate(facture.paye_le)}</p></div>}
          {facture.moyen_paiement && <div><p className="label">Moyen</p><p>{facture.moyen_paiement}</p></div>}
          {facture.remise_fidelite_pct && <div><p className="label">Remise fidélité</p><p className="text-emerald-600 font-semibold">🎁 {facture.remise_fidelite_pct}% service</p></div>}
        </div>

        {/* Apporteur — usage interne */}
        {apporteurs.length > 0 && (
          <div className="card card-inner mb-4">
            <p className="label mb-2">Apporteur d'affaires <span className="text-ink-300 font-normal">(usage interne — n'apparaît pas sur le PDF)</span></p>
            <div className="flex gap-2">
              <select className="input flex-1" value={apporteurId} onChange={e => setApporteurId(e.target.value)}>
                <option value="">— Aucun apporteur —</option>
                {apporteurs.map(a => (
                  <option key={a.id} value={a.id}>{a.nom}{a.entreprise ? ` — ${a.entreprise}` : ""}</option>
                ))}
              </select>
              <button onClick={saveApporteur} disabled={savingApporteur}
                className="btn-ghost text-sm shrink-0">
                {savingApporteur ? "…" : "Enregistrer"}
              </button>
            </div>
            {apporteurActuel && (
              <p className="text-xs text-ink-400 mt-1.5">Commission calculée dans le CRM → Commissions apporteurs</p>
            )}
          </div>
        )}

        <div className="card card-inner mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-xs text-ink-400">
                <th className="text-left pb-2">Désignation</th>
                <th className="text-right pb-2">Qté</th>
                <th className="text-right pb-2">P.U.</th>
                <th className="text-right pb-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l: any, i: number) => (
                <tr key={i} className="border-b border-ink-50">
                  <td className="py-2.5 pr-2">
                    <span className={cn("badge text-xs mr-1.5", l.type_branche === "service" ? "bg-volt-100 text-volt-700" : "bg-emerald-100 text-emerald-700")}>
                      {l.type_branche === "service" ? "S" : "M"}
                    </span>{l.nom}
                  </td>
                  <td className="py-2.5 text-right">{l.quantite}</td>
                  <td className="py-2.5 text-right text-ink-500">{fmt(l.prix_unitaire)}</td>
                  <td className="py-2.5 text-right font-semibold">{fmt(l.prix_unitaire * l.quantite)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end mt-4">
            <div className="w-56 space-y-1 text-sm">
              <div className="flex justify-between text-ink-500"><span>Service</span><span>{fmt(lignesSBrut)}</span></div>
              {remiseS > 0.01 && <div className="flex justify-between text-red-500"><span>Remise service</span><span>− {fmt(remiseS)}</span></div>}
              <div className="flex justify-between text-ink-500"><span>Matériaux</span><span>{fmt(lignesMBrut)}</span></div>
              {remiseM > 0.01 && <div className="flex justify-between text-red-500"><span>Remise matériaux</span><span>− {fmt(remiseM)}</span></div>}
              {remiseFideliteEur > 0.01 && (
                <div className="flex justify-between text-emerald-600 font-medium">
                  <span>🎁 Fidélité ({facture.remise_fidelite_pct}%)</span><span>− {fmt(remiseFideliteEur)}</span>
                </div>
              )}
              {(hasRemise || remiseFideliteEur > 0.01) && (
                <div className="flex justify-between text-red-600 font-medium text-xs pt-1">
                  <span>Total remises</span><span>− {fmt(remiseS + remiseM + remiseFideliteEur)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-emerald-600 text-base pt-2 border-t border-ink-200"><span>Total TTC</span><span>{fmt(facture.total_ttc)}</span></div>
            </div>
          </div>
          <p className="text-xs text-ink-300 mt-3">TVA non applicable — Art. 293 B du CGI</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button onClick={dl} className="btn-ghost flex-1 justify-center"><Download size={15} /> PDF</button>
          {facture.statut !== "payee" && (
            <>
              {facture.statut === "envoyee" && (
                <button onClick={marquerRelance} className="btn-ghost flex-1 justify-center"><Clock size={15} /> Marquer relancée</button>
              )}
              <button onClick={marquerPayee} className="btn-success flex-1 justify-center"><CheckCircle size={15} /> Marquer payée</button>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}