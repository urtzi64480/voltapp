"use client";
// Pré-devis d'un tableau électrique, indépendant des plans d'intervention et de l'outil IA : les besoins viennent des rangées du tableau
// affiché, les articles du catalogue de l'utilisateur. Rien n'est créé sans clic ; un besoin sans article devient une ligne « À compléter » à 0 €.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fondModal } from "@/lib/fond-modal";
import type { BreakerRow } from "@/lib/electrical-constants";
import type { Prestation, Profil } from "@/types";
import { chargerCatalogueEtTaux } from "@/lib/tableau-catalogue";
import { lignesDevisTableau, preparerPredevisTableau, type LignePredevisTableau } from "@/lib/tableau-predevis";
import { calculerBesoinsTableau, optionsPourSousCategorie } from "@/lib/predevis-engine";
import { creerDevisBrouillon } from "@/lib/devis-creation";
import { PanneauPredevis } from "@/components/tableau/TableauIAModal";

export default function PredevisTableauModal({ clientId, rows, nomTableau, onClose }: {
  clientId: string; rows: BreakerRow[]; nomTableau?: string; onClose: () => void;
}) {
  const router = useRouter();
  const [prestations, setPrestations] = useState<Prestation[] | null>(null);
  const [profil, setProfil] = useState<Pick<Profil, "taux_horaire"> | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [lignes, setLignes] = useState<LignePredevisTableau[]>([]);
  const [heures, setHeures] = useState("");
  const [creation, setCreation] = useState(false);

  // Instantané des rangées à l'ouverture : le pré-devis ne bouge pas si le tableau change en arrière-plan.
  const [rowsFigees] = useState(rows);
  const alertes = useMemo(() => calculerBesoinsTableau(rowsFigees).alertes, [rowsFigees]);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const r = await chargerCatalogueEtTaux();
        if (annule) return;
        setPrestations(r.prestations); setProfil(r.profil);
        setLignes(preparerPredevisTableau(rowsFigees, r.prestations).lignes);
      } catch (e) {
        if (!annule) setErreur(`Catalogue indisponible : ${(e as Error).message}`);
      }
    })();
    return () => { annule = true; };
  }, [rowsFigees]);

  const optionMO = useMemo(() => optionsPourSousCategorie("main_oeuvre", prestations ?? [])[0] ?? null, [prestations]);
  const tauxHoraire = optionMO?.prix_unitaire ?? profil?.taux_horaire ?? 0;
  const nbSansArticle = lignes.filter(l => l.besoin.options.length === 0).length;

  async function creerDevis() {
    if (creation || !prestations) return;
    setCreation(true); setErreur(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) { setErreur("Session expirée : reconnectez-vous."); return; }
      const h = parseFloat(heures.replace(",", ".")) || 0;
      const l = lignesDevisTableau(lignes, prestations, h > 0 ? { heures: h, tauxHoraire, option: optionMO ? { nom: optionMO.nom, prestation_id: optionMO.prestation_id } : null } : undefined);
      const res = await creerDevisBrouillon(supabase, uid, clientId, `Pré-devis — ${nomTableau ? `tableau « ${nomTableau} »` : "tableau électrique"}`, l);
      if (res.erreur || !res.id) { setErreur(res.erreur ?? "Création impossible."); return; }
      router.push(`/devis/${res.id}`);
    } finally {
      setCreation(false);
    }
  }

  const vide = !lignes.length && !!prestations;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex" {...fondModal(onClose)} role="dialog" aria-modal="true" aria-label="Pré-devis du tableau">
      <div className="m-0 md:m-3 flex-1 bg-ink-50 md:rounded-2xl shadow-2xl flex flex-col min-h-0" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ink-200 bg-white md:rounded-t-2xl shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={18} className="text-volt-600 shrink-0" />
            <h2 className="font-semibold text-ink-900 truncate">Pré-devis{nomTableau ? ` — ${nomTableau}` : " du tableau"}</h2>
          </div>
          <button className="btn-ghost !px-2" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>
        <div className="flex-1 min-h-0 p-3 md:p-4 flex flex-col gap-3">
          {alertes.length > 0 && (
            <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-0.5 shrink-0">{alertes.map((a, i) => <li key={i}>{a}</li>)}</ul>
          )}
          {vide ? (
            <div className="flex-1 grid place-items-center text-sm text-ink-500 text-center">Ce tableau ne contient encore aucun appareil à chiffrer.</div>
          ) : (
            <div className="flex-1 min-h-0">
              <PanneauPredevis lignes={lignes} setLignes={setLignes} prestations={prestations} chargement={!prestations && !erreur} erreur={erreur}
                heures={heures} setHeures={setHeures} taux={tauxHoraire} nbSansArticle={nbSansArticle} onCreer={creerDevis} creation={creation} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
