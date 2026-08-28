"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CalendarCheck, Phone, Mail, MapPin, Clock, MessageSquare } from "lucide-react";
import Shell from "@/components/layout/Shell";

interface Rdv {
  id: string;
  date: string; // YYYY-MM-DD
  periode: "matin" | "aprem";
  nom: string;
  telephone: string;
  email: string | null;
  adresse: string | null;
  description: string | null;
  statut: string;
  consulte: boolean;
  created_at: string;
}

function fmtDateLabel(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function isPast(rdv: Rdv) {
  const [y, m, d] = rdv.date.split("-").map(Number);
  const end = new Date(y, m - 1, d, rdv.periode === "matin" ? 12 : 17, 0);
  return end < new Date();
}

export default function RdvPage() {
  const [rdvs, setRdvs] = useState<Rdv[]>([]);
  const [loading, setLoading] = useState(true);
  const [nomEntreprise, setNomEntreprise] = useState("Urtzi Électricien");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      const { data: profil } = await supabase
        .from("profil").select("nom_entreprise").eq("id", session.user.id).single();
      if (profil?.nom_entreprise) setNomEntreprise(profil.nom_entreprise);

      const { data } = await supabase
        .from("rdv").select("*")
        .order("date", { ascending: true })
        .order("periode", { ascending: true });
      setRdvs((data as Rdv[]) ?? []);
      setLoading(false);

      // Marque tous les RDV non consultés comme vus
      await supabase.from("rdv").update({ consulte: true }).eq("consulte", false);
    }
    load();
  }, []);

  const aVenir = rdvs.filter(r => !isPast(r));
  const passes = rdvs.filter(r => isPast(r));

  const smsHref = (rdv: Rdv) => {
    const msg = `Bonjour ${rdv.nom}, votre rendez-vous avec ${nomEntreprise} est confirmé le ${fmtDateLabel(rdv.date).toLowerCase()}, ${rdv.periode === "matin" ? "le matin (8h-12h)" : "l'après-midi (13h-17h)"}. À bientôt !`;
    return `sms:${rdv.telephone.replace(/\s/g, "")}&body=${encodeURIComponent(msg)}`;
  };

  const mailHref = (rdv: Rdv) => {
    const subject = `Confirmation de rendez-vous - ${nomEntreprise}`;
    const msg = `Bonjour ${rdv.nom},\n\nVotre rendez-vous avec ${nomEntreprise} est confirmé le ${fmtDateLabel(rdv.date).toLowerCase()}, ${rdv.periode === "matin" ? "le matin (8h-12h)" : "l'après-midi (13h-17h)"}.\n\nÀ bientôt !`;
    return `mailto:${rdv.email ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}`;
  };

  const RdvCard = ({ rdv }: { rdv: Rdv }) => (
    <div className="bg-white rounded-2xl border border-ink-100 p-4 space-y-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink-900">{rdv.nom}</p>
          <div className="flex items-center gap-1.5 text-sm text-ink-500 mt-0.5">
            <Clock size={13} className="text-ink-400" />
            <span className="capitalize">{fmtDateLabel(rdv.date)}</span>
            <span className="text-ink-300">·</span>
            <span>{rdv.periode === "matin" ? "Matin (8h-12h)" : "Après-midi (13h-17h)"}</span>
          </div>
        </div>
        {!rdv.consulte && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium shrink-0">Nouveau</span>
        )}
      </div>

      <div className="flex flex-col gap-1 text-sm text-ink-600">
        <a href={`tel:${rdv.telephone}`} className="flex items-center gap-2 hover:text-volt-600">
          <Phone size={13} className="text-ink-400" /> {rdv.telephone}
        </a>
        {rdv.email && (
          <a href={`mailto:${rdv.email}`} className="flex items-center gap-2 hover:text-volt-600">
            <Mail size={13} className="text-ink-400" /> {rdv.email}
          </a>
        )}
        {rdv.adresse && (
          <span className="flex items-center gap-2">
            <MapPin size={13} className="text-ink-400 shrink-0" /> {rdv.adresse}
          </span>
        )}
      </div>

      {rdv.description && (
        <div className="bg-ink-50 rounded-xl p-3 text-sm text-ink-700 leading-relaxed">{rdv.description}</div>
      )}

      <div className="flex gap-2 pt-1">
        <a href={smsHref(rdv)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-ink-200 text-ink-700 text-xs font-semibold hover:bg-ink-50 transition-colors">
          <MessageSquare size={13} /> Confirmation SMS
        </a>
        <a href={rdv.email ? mailHref(rdv) : undefined}
          aria-disabled={!rdv.email}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border text-xs font-semibold transition-colors ${
            rdv.email ? "border-ink-200 text-ink-700 hover:bg-ink-50" : "border-ink-100 text-ink-300 cursor-not-allowed pointer-events-none"
          }`}>
          <Mail size={13} /> Confirmation mail
        </a>
      </div>
    </div>
  );

  return (
    <Shell>
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="text-2xl font-display font-bold text-ink-900 flex items-center gap-2">
            <CalendarCheck size={22} className="text-volt-600" /> Rendez-vous
          </h1>
          <p className="text-sm text-ink-400 mt-0.5">Réservés en ligne par vos clients</p>
        </div>

        {loading ? (
          <p className="text-ink-400 text-sm">Chargement…</p>
        ) : rdvs.length === 0 ? (
          <div className="bg-white rounded-2xl border border-ink-100 p-8 text-center">
            <CalendarCheck size={28} className="text-ink-300 mx-auto mb-2" />
            <p className="text-ink-500 text-sm">Aucun rendez-vous réservé pour le moment.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {aVenir.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide">À venir</p>
                {aVenir.map(rdv => <RdvCard key={rdv.id} rdv={rdv} />)}
              </div>
            )}
            {passes.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide">Passés</p>
                {passes.map(rdv => <RdvCard key={rdv.id} rdv={rdv} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
