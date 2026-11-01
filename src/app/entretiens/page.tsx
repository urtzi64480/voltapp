"use client";
// Rappels d'entretien annuel : clients dont le chantier date d'environ un an. Un SMS / e-mail prêt à envoyer, et on garde la date d'envoi.
import { useEffect, useMemo, useState } from "react";
import { BellRing, Mail, MessageSquare } from "lucide-react";
import Shell from "@/components/layout/Shell";
import { supabase } from "@/lib/supabase";
import { dateLocale, fmtDate } from "@/lib/utils";
import { lireSuivi } from "@/lib/suivi-persistance";
import { cleSuiviDevis, ecrireControles } from "@/lib/suivi-hors-ligne";
import { dateReference, echeanceEntretien, etatEntretien, type EtatEntretien } from "@/lib/entretien";

interface Brut {
  id: string; numero: string; objet?: string | null; suivi_realisation?: string | null;
  client?: { nom: string; prenom?: string | null; telephone?: string | null; email?: string | null } | null;
  factures?: { statut: string; paye_le?: string | null }[] | null;
}
interface Ligne { id: string; numero: string; objet: string; client: string; prenom: string; tel: string; email: string; ref: string; etat: EtatEntretien; envoye: string | null }

export default function EntretiensPage() {
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [entreprise, setEntreprise] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const SEL = "id, numero, objet, client:clients(nom, prenom, telephone, email), factures(statut, paye_le)";
      let res = await supabase.from("devis").select(`${SEL}, suivi_realisation`).eq("statut", "signe");
      if (res.error && /suivi_realisation/i.test(res.error.message)) res = await supabase.from("devis").select(SEL).eq("statut", "signe") as typeof res;
      if (res.error) { setErreur(res.error.message); setLignes([]); return; }
      const { data: { user } } = await supabase.auth.getUser();
      const { data: p } = user ? await supabase.from("profil").select("nom_entreprise, nom, prenom").eq("id", user.id).maybeSingle() : { data: null };
      setEntreprise(p?.nom_entreprise || `${p?.prenom ?? ""} ${p?.nom ?? ""}`.trim());
      const auj = dateLocale();
      const out: Ligne[] = [];
      ((res.data ?? []) as unknown as Brut[]).forEach(d => {
        const s = lireSuivi(d.suivi_realisation);
        const ref = dateReference({ reception: s.controles?.reception?.le, valideLe: s.chantier.valide_le, paiements: (d.factures ?? []).filter(f => f.statut === "payee").map(f => f.paye_le) });
        if (!ref || !d.client) return;
        const etat = etatEntretien(ref, s.controles?.entretienEnvoyeLe, auj);
        if (etat === "trop_tot") return;
        out.push({ id: d.id, numero: d.numero, objet: d.objet ?? "", client: `${d.client.prenom ?? ""} ${d.client.nom}`.trim(), prenom: d.client.prenom || d.client.nom,
          tel: d.client.telephone ?? "", email: d.client.email ?? "", ref, etat, envoye: s.controles?.entretienEnvoyeLe ?? null });
      });
      out.sort((a, b) => a.ref.localeCompare(b.ref));
      setLignes(out);
    })();
  }, []);

  const groupes = useMemo(() => ({
    a: (lignes ?? []).filter(l => l.etat === "a_contacter"), v: (lignes ?? []).filter(l => l.etat === "a_venir"), f: (lignes ?? []).filter(l => l.etat === "fait"),
  }), [lignes]);

  const message = (l: Ligne) =>
    `Bonjour ${l.prenom}, ici ${entreprise || "votre électricien"}. Il y a environ un an, nous avons réalisé ${l.objet || "des travaux d'électricité"} chez vous. ` +
    `Un contrôle annuel (test des différentiels, détecteurs de fumée, état du tableau) est conseillé : souhaitez-vous que nous fixions un passage ?`;

  async function envoyer(l: Ligne, canal: "sms" | "mail") {
    const corps = message(l);
    await ecrireControles(cleSuiviDevis(l.id), { action: "entretien", id: l.id, le: new Date().toISOString() });
    setLignes(prev => (prev ?? []).map(x => (x.id === l.id ? { ...x, etat: "fait", envoye: new Date().toISOString() } : x)));
    if (canal === "sms") window.location.href = `sms:${l.tel.replace(/[^\d+]/g, "")}${/iPad|iPhone|iPod/.test(navigator.userAgent) ? "&" : "?"}body=${encodeURIComponent(corps)}`;
    else window.location.href = `mailto:${l.email}?subject=${encodeURIComponent("Contrôle annuel de votre installation électrique")}&body=${encodeURIComponent(corps)}`;
  }

  const bloc = (titre: string, items: Ligne[], actif: boolean) => items.length > 0 && (
    <section className="card card-inner">
      <h2 className="font-semibold text-ink-800 mb-2">{titre} ({items.length})</h2>
      <ul className="divide-y divide-ink-100">
        {items.map(l => (
          <li key={l.id} className="py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-900 truncate">{l.client}</p>
              <p className="text-xs text-ink-400 truncate">{l.numero}{l.objet ? ` · ${l.objet}` : ""} · chantier du {fmtDate(l.ref)} · échéance {fmtDate(echeanceEntretien(l.ref))}{l.envoye ? ` · rappel envoyé le ${fmtDate(l.envoye)}` : ""}</p>
            </div>
            {actif && (
              <div className="flex gap-1.5 shrink-0">
                <button type="button" className="btn-ghost !py-1.5 !px-2.5 !text-xs" disabled={!l.tel} title={l.tel ? "" : "Pas de téléphone"} onClick={() => void envoyer(l, "sms")}><MessageSquare size={13} /> SMS</button>
                <button type="button" className="btn-ghost !py-1.5 !px-2.5 !text-xs" disabled={!l.email} title={l.email ? "" : "Pas d'e-mail"} onClick={() => void envoyer(l, "mail")}><Mail size={13} /> E-mail</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <Shell>
      <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-4">
        <div>
          <h1 className="font-display text-3xl text-ink-900 flex items-center gap-2"><BellRing size={26} /> Rappels d&apos;entretien</h1>
          <p className="text-ink-500 text-sm mt-1">Un an après un chantier, propose au client un contrôle de son installation. Date de référence : réception signée, sinon validation du chantier, sinon dernier paiement.</p>
        </div>
        {erreur && <div className="card card-inner border-red-300 bg-red-50 text-sm text-red-800" role="alert">Chargement impossible : {erreur}</div>}
        {lignes === null && <p className="text-ink-400">Chargement…</p>}
        {lignes !== null && lignes.length === 0 && !erreur && <div className="card card-inner text-sm text-ink-500">Aucun rappel à prévoir pour le moment (aucun chantier de plus de 9 mois avec une date de fin connue).</div>}
        {bloc("À contacter", groupes.a, true)}
        {bloc("Bientôt (dans les 3 mois)", groupes.v, true)}
        {bloc("Rappel déjà envoyé", groupes.f, false)}
      </div>
    </Shell>
  );
}
