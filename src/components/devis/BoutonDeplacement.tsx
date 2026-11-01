"use client";
// Ajoute au devis une ligne « Déplacement » calculée d'après la distance atelier → chantier.
// Les réglages (tarif au km, km offerts, aller-retour, minimum) sont gardés sur cet appareil.
import { useEffect, useState } from "react";
import { Car } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmt } from "@/lib/utils";
import { fraisDeplacement, lireReglage, REGLAGE_DEPLACEMENT_DEFAUT, type ReglageDeplacement } from "@/lib/deplacement";
import { ecrireStockage, lireStockage } from "@/lib/safe-storage";
import type { DevisLigne } from "@/types";

const CLE = "voltapp:reglage-deplacement";
export interface AdresseClient { adresse?: string | null; code_postal?: string | null; ville?: string | null }

export default function BoutonDeplacement({ client, onAjouter }: { client: AdresseClient | null; onAjouter: (l: DevisLigne) => void }) {
  const [reglage, setReglage] = useState<ReglageDeplacement>(REGLAGE_DEPLACEMENT_DEFAUT);
  const [ouvert, setOuvert] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { try { const b = lireStockage("local", CLE); if (b) setReglage(lireReglage(JSON.parse(b))); } catch { /* réglages par défaut */ } }, []);
  const maj = (r: ReglageDeplacement) => { setReglage(r); ecrireStockage("local", CLE, JSON.stringify(r)); };
  const adresseClient = [client?.adresse, client?.code_postal, client?.ville].filter(Boolean).join(" ");

  async function ajouter() {
    setMessage(null);
    if (!adresseClient) { setMessage("Le client n'a pas d'adresse : renseigne-la sur sa fiche."); return; }
    setOccupe(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: p } = user ? await supabase.from("profil").select("adresse, code_postal, ville").eq("id", user.id).maybeSingle() : { data: null };
      const depart = [p?.adresse, p?.code_postal, p?.ville].filter(Boolean).join(" ");
      if (!depart) { setMessage("Renseigne l'adresse de ton atelier dans Paramètres."); return; }
      const r = await fetch("/api/distance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ depart, arrivee: adresseClient }) });
      const d = await r.json().catch(() => ({})) as { km?: number; error?: string };
      if (!r.ok || typeof d.km !== "number") { setMessage(d.error ?? "Distance introuvable."); return; }
      const f = fraisDeplacement(d.km, reglage);
      if (f.montant <= 0) { setMessage(`${d.km} km : dans les km offerts, rien à facturer.`); return; }
      onAjouter({ nom: f.libelle, quantite: 1, prix_unitaire: f.montant, unite: "forfait", type_branche: "service" });
      setMessage(`Ligne ajoutée : ${fmt(f.montant)} (${d.km} km estimés, aller simple).`);
    } catch { setMessage("Calcul impossible (réseau)."); } finally { setOccupe(false); }
  }

  return (
    <div className="mt-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost !py-1.5 !text-xs" onClick={() => void ajouter()} disabled={occupe}><Car size={13} /> {occupe ? "Calcul…" : "Ajouter le déplacement"}</button>
        <button type="button" className="text-ink-500 underline" onClick={() => setOuvert(o => !o)}>Réglages</button>
        {message && <span className="text-ink-600" role="status">{message}</span>}
      </div>
      {ouvert && (
        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
          <label>€ / km<input className="input !py-1" inputMode="decimal" value={reglage.tarifKm} onChange={e => maj({ ...reglage, tarifKm: Math.max(0, parseFloat(e.target.value.replace(",", ".")) || 0) })} /></label>
          <label>Km offerts<input className="input !py-1" inputMode="decimal" value={reglage.kmOfferts} onChange={e => maj({ ...reglage, kmOfferts: Math.max(0, parseFloat(e.target.value.replace(",", ".")) || 0) })} /></label>
          <label>Minimum (€)<input className="input !py-1" inputMode="decimal" value={reglage.minimum} onChange={e => maj({ ...reglage, minimum: Math.max(0, parseFloat(e.target.value.replace(",", ".")) || 0) })} /></label>
          <label className="flex items-center gap-1.5 pb-1.5"><input type="checkbox" checked={reglage.allerRetour} onChange={e => maj({ ...reglage, allerRetour: e.target.checked })} /> Aller-retour</label>
        </div>
      )}
    </div>
  );
}
