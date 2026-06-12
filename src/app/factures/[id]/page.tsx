"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Facture } from "@/types";
import { fmt, fmtDate, STATUT_LABELS, STATUT_COLORS, cn } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, CheckCircle, Clock, Trash2, Plus, Save, X } from "lucide-react";

interface Apporteur {
  id: string;
  nom: string;
  entreprise?: string;
}

interface Acompte {
  id: string;
  facture_id: string;
  montant: number;
  date_versement: string;
  notes?: string;
  created_at: string;
}

type AcompteInputMode = "eur" | "pct";

export default function FactureDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [facture, setFacture] = useState<Facture | null>(null);
  const [apporteurs, setApporteurs] = useState<Apporteur[]>([]);
  const [apporteurId, setApporteurId] = useState("");
  const [savingApporteur, setSavingApporteur] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [acomptes, setAcomptes] = useState<Acompte[]>([]);
  const [showAcompteForm, setShowAcompteForm] = useState(false);
  const [acompteMode, setAcompteMode] = useState<AcompteInputMode>("eur");
  const [acompteValeur, setAcompteValeur] = useState("");
  const [acompteDate, setAcompteDate] = useState(new Date().toISOString().split("T")[0]);
  const [acompteNotes, setAcompteNotes] = useState("");
  const [savingAcompte, setSavingAcompte] = useState(false);
  const [confirmDeleteAcompte, setConfirmDeleteAcompte] = useState<string | null>(null);
  const [devisAssocie, setDevisAssocie] = useState<{ id: string; numero: string; statut: string } | null>(null);

  useEffect(() => {
    // Chercher le devis associé
    supabase.from("factures").select("devis_id").eq("id", id).single()
      .then(({ data: f }) => {
        if ((f as any)?.devis_id) {
          supabase.from("devis").select("id, numero, statut").eq("id", (f as any).devis_id).single()
            .then(({ data: d }) => { if (d) setDevisAssocie(d as any); });
        }
      });

    Promise.all([
      supabase.from("factures").select("*, client:clients(*), lignes:facture_lignes(*)").eq("id", id).single(),
      supabase.from("apporteurs").select("id,nom,entreprise").eq("actif", true).order("nom"),
      supabase.from("acomptes").select("*").eq("facture_id", id).order("date_versement"),
    ]).then(([{ data: f }, { data: ap }, { data: ac }]) => {
      setFacture(f as any);
      setApporteurs(ap ?? []);
      setApporteurId((f as any)?.apporteur_id ?? "");
      setAcomptes(ac ?? []);
    });
  }, [id]);

  function montantFromValeur(valeur: string, mode: AcompteInputMode, total: number): number {
    const v = parseFloat(valeur) || 0;
    if (mode === "pct") return Math.round(total * v / 100 * 100) / 100;
    return v;
  }

  function pctFromMontant(montant: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round(montant / total * 1000) / 10;
  }

  const totalAcomptes = acomptes.reduce((a, ac) => a + ac.montant, 0);
  const soldeRestant = (facture?.total_ttc ?? 0) - totalAcomptes;

  const montantSaisi = facture ? montantFromValeur(acompteValeur, acompteMode, facture.total_ttc) : 0;
  const pctSaisi = facture && montantSaisi > 0 ? pctFromMontant(montantSaisi, facture.total_ttc) : 0;

  async function saveApporteur() {
    setSavingApporteur(true);
    await supabase.from("factures").update({ apporteur_id: apporteurId || null }).eq("id", id);
    setSavingApporteur(false);
  }

  async function marquerPayee() {
    await supabase.from("factures").update({ statut: "payee", paye_le: new Date().toISOString() }).eq("id", id);
    setFacture(f => f ? { ...f, statut: "payee", paye_le: new Date().toISOString() } : f);
  }

  async function marquerEnvoyee() {
    await supabase.from("factures").update({ statut: "envoyee" }).eq("id", id);
    setFacture(f => f ? { ...f, statut: "envoyee" } : f);
  }

  async function marquerRelance() {
    await supabase.from("factures").update({ statut: "relance" }).eq("id", id);
    setFacture(f => f ? { ...f, statut: "relance" } : f);
  }

  async function deleteFacture() {
    await supabase.from("acomptes").delete().eq("facture_id", id);
    await supabase.from("facture_lignes").delete().eq("facture_id", id);
    await supabase.from("factures").delete().eq("id", id);
    router.push("/factures");
  }

  async function ajouterAcompte() {
    if (!facture || !acompteValeur) return;
    const montant = montantFromValeur(acompteValeur, acompteMode, facture.total_ttc);
    if (montant <= 0) return;
    if (montant > soldeRestant + 0.01) {
      alert("Le montant dépasse le solde restant (" + fmt(soldeRestant) + ")");
      return;
    }
    setSavingAcompte(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingAcompte(false); return; }
    const { data } = await supabase.from("acomptes").insert({
      facture_id: id,
      user_id: user.id,
      montant,
      date_versement: acompteDate,
      notes: acompteNotes || null,
    }).select().single();
    if (data) {
      const newList = [...acomptes, data as Acompte].sort((a, b) => a.date_versement.localeCompare(b.date_versement));
      setAcomptes(newList);
      const nouveauSolde = soldeRestant - montant;
      if (nouveauSolde <= 0.01 && facture.statut !== "payee") {
        await supabase.from("factures").update({ statut: "payee", paye_le: new Date().toISOString() }).eq("id", id);
        setFacture(f => f ? { ...f, statut: "payee", paye_le: new Date().toISOString() } : f);
      }
    }
    setAcompteValeur(""); setAcompteNotes(""); setAcompteDate(new Date().toISOString().split("T")[0]);
    setShowAcompteForm(false);
    setSavingAcompte(false);
  }

  async function supprimerAcompte(acId: string) {
    await supabase.from("acomptes").delete().eq("id", acId);
    setAcomptes(prev => prev.filter(a => a.id !== acId));
    setConfirmDeleteAcompte(null);
  }

  async function dl() {
    if (!facture) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: p } = await supabase.from("profil").select("*").eq("id", user.id).single();
    const { genPDFFacture } = await import("@/lib/pdf");
    await genPDFFacture(
      facture,
      p ?? { id: user.id, prefixe_devis: "DEV", prefixe_facture: "FAC", compteur_devis: 0, compteur_facture: 0, mention_tva: "TVA non applicable — Art. 293 B du CGI", conditions_paiement: "Paiement à réception", taux_horaire: 55, created_at: "", updated_at: "" },
      acomptes,
    );
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
              <p className="text-sm text-ink-500 mb-5">Cette action est irréversible. La facture <strong>{facture.numero}</strong> et ses acomptes seront définitivement supprimés.</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDelete(false)} className="btn-ghost flex-1 justify-center">Annuler</button>
                <button onClick={deleteFacture} className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl px-4 py-2.5 text-sm transition-colors">
                  <Trash2 size={14} /> Supprimer
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmDeleteAcompte && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
              <h3 className="font-semibold text-ink-900 text-lg mb-2">Supprimer cet acompte ?</h3>
              <p className="text-sm text-ink-500 mb-5">Le versement sera retiré de l'historique.</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDeleteAcompte(null)} className="btn-ghost flex-1 justify-center">Annuler</button>
                <button onClick={() => supprimerAcompte(confirmDeleteAcompte)} className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl px-4 py-2.5 text-sm transition-colors">
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

        {devisAssocie && (
          <div className="card card-inner mb-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-volt-100 flex items-center justify-center shrink-0">
              <Download size={16} className="text-volt-700" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-ink-400">Devis d'origine</p>
              <p className="font-semibold text-ink-900 text-sm">{devisAssocie.numero}</p>
            </div>
            <Link href={`/devis/${devisAssocie.id}`} className="btn-ghost !px-3 text-xs shrink-0">
              Voir →
            </Link>
          </div>
        )}

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
              <button onClick={saveApporteur} disabled={savingApporteur} className="btn-ghost text-sm shrink-0">
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
            <div className="w-64 space-y-1 text-sm">
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
                <div className="flex justify-between text-red-600 font-medium text-xs pt-1 border-t border-ink-100">
                  <span>Total remises</span><span>− {fmt(remiseS + remiseM + remiseFideliteEur)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-emerald-600 text-base pt-2 border-t border-ink-200">
                <span>Total TTC</span><span>{fmt(facture.total_ttc)}</span>
              </div>
              {acomptes.length > 0 && (
                <>
                  <div className="pt-2 border-t border-ink-100 space-y-1">
                    {acomptes.map(ac => (
                      <div key={ac.id} className="flex justify-between text-xs text-blue-600">
                        <span>Acompte {fmtDate(ac.date_versement)}{ac.notes ? " · " + ac.notes : ""}</span>
                        <span>− {fmt(ac.montant)}</span>
                      </div>
                    ))}
                  </div>
                  <div className={cn("flex justify-between font-bold text-base pt-2 border-t border-ink-200",
                    soldeRestant <= 0.01 ? "text-emerald-600" : "text-volt-600")}>
                    <span>Solde restant dû</span>
                    <span>{soldeRestant <= 0.01 ? "Soldé ✓" : fmt(soldeRestant)}</span>
                  </div>
                </>
              )}
            </div>
          </div>
          <p className="text-xs text-ink-300 mt-3">TVA non applicable — Art. 293 B du CGI</p>
        </div>

        {/* Bloc acomptes */}
        {facture.statut !== "payee" && facture.statut !== "envoyee" && (
        <div className="card card-inner mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-semibold text-ink-900 text-sm">Acomptes versés</p>
              {acomptes.length > 0 && (
                <p className="text-xs text-ink-400 mt-0.5">{fmt(totalAcomptes)} encaissé · Solde {soldeRestant <= 0.01 ? "soldé" : fmt(soldeRestant)}</p>
              )}
            </div>
            {soldeRestant > 0.01 && (
              <button onClick={() => setShowAcompteForm(!showAcompteForm)}
                className="btn-ghost !px-3 text-xs flex items-center gap-1.5">
                <Plus size={13} /> Ajouter
              </button>
            )}
          </div>

          {acomptes.length === 0 && !showAcompteForm && (
            <p className="text-sm text-ink-400 italic text-center py-3">Aucun acompte enregistré</p>
          )}

          {acomptes.length > 0 && (
            <div className="space-y-2 mb-3">
              {acomptes.map((ac, i) => (
                <div key={ac.id} className="flex items-center gap-3 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-xl">
                  <div className="w-6 h-6 rounded-full bg-blue-200 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink-900">{fmt(ac.montant)}</p>
                    <p className="text-xs text-ink-400">
                      {fmtDate(ac.date_versement)}
                      {ac.notes ? " · " + ac.notes : ""}
                      <span className="text-blue-400 ml-1">({pctFromMontant(ac.montant, facture.total_ttc)}%)</span>
                    </p>
                  </div>
                  <button onClick={() => setConfirmDeleteAcompte(ac.id)}
                    className="p-1.5 rounded-lg text-ink-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {showAcompteForm && (
            <div className="p-3 bg-ink-50 rounded-xl border border-ink-100 space-y-3">
              <p className="text-xs font-semibold text-ink-600 uppercase tracking-wide">Nouveau versement</p>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="label">Montant</label>
                  <div className="flex rounded-xl border border-ink-200 overflow-hidden">
                    <button onClick={() => setAcompteMode("eur")}
                      className={cn("px-3 py-2 text-xs font-semibold transition-colors",
                        acompteMode === "eur" ? "bg-ink-900 text-volt-400" : "bg-white text-ink-500 hover:bg-ink-50")}>
                      €
                    </button>
                    <button onClick={() => setAcompteMode("pct")}
                      className={cn("px-3 py-2 text-xs font-semibold transition-colors border-l border-ink-200",
                        acompteMode === "pct" ? "bg-ink-900 text-volt-400" : "bg-white text-ink-500 hover:bg-ink-50")}>
                      %
                    </button>
                    <input type="number" min="0" step="0.01"
                      placeholder={acompteMode === "eur" ? "Ex : 450" : "Ex : 30"}
                      value={acompteValeur}
                      onChange={e => setAcompteValeur(e.target.value)}
                      className="flex-1 px-3 py-2 text-sm text-right bg-white border-l border-ink-200 focus:outline-none" />
                  </div>
                  {acompteValeur && montantSaisi > 0 && (
                    <p className="text-xs text-ink-400 mt-1">
                      {acompteMode === "eur" ? "soit " + pctSaisi + "% du total" : "soit " + fmt(montantSaisi)}
                      {montantSaisi > soldeRestant + 0.01 && (
                        <span className="text-red-500 ml-1">· dépasse le solde ({fmt(soldeRestant)})</span>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex-1">
                  <label className="label">Date</label>
                  <input type="date" className="input text-sm" value={acompteDate}
                    onChange={e => setAcompteDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Note (optionnel)</label>
                <input className="input text-sm" placeholder="Ex : Virement, chèque, espèces…"
                  value={acompteNotes} onChange={e => setAcompteNotes(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setShowAcompteForm(false); setAcompteValeur(""); setAcompteNotes(""); }}
                  className="btn-ghost flex-1 justify-center text-sm"><X size={13} /> Annuler</button>
                <button onClick={ajouterAcompte}
                  disabled={savingAcompte || !acompteValeur || montantSaisi <= 0 || montantSaisi > soldeRestant + 0.01}
                  className="btn-volt flex-1 justify-center text-sm">
                  <Save size={13} /> {savingAcompte ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </div>
          )}
        </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button onClick={dl} className="btn-ghost flex-1 justify-center"><Download size={15} /> PDF</button>
          {facture.statut === "a_envoyer" && (
            <button onClick={marquerEnvoyee}
              className="btn-volt flex-1 justify-center">
              <CheckCircle size={15} /> Marquer comme envoyée
            </button>
          )}
          {facture.statut !== "payee" && facture.statut !== "a_envoyer" && (
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
