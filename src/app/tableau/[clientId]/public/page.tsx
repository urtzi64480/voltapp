"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ─── TYPES (copie légère des types du tableau) ────────────────────────────────

type CommandeType = "simple" | "vav" | "telerupteur";

interface GroupeLumineux {
  nbPoints: number;
  typeCommande: CommandeType;
  nbCommandes: number;
}

interface PieceConfig {
  nom: string;
  groupes: GroupeLumineux[];
  nbPrises: number;
}

interface Breaker {
  id: number;
  label: string;
  circuit: string;
  amperes: number;
  type: string;
  pieces: PieceConfig[];
}

interface BreakerRow {
  id: number;
  name: string;
  slots: (Breaker | null)[];
}

interface Profil {
  nom_entreprise: string;
  prenom: string;
  nom: string;
  telephone: string;
  email: string;
  adresse: string;
  siret: string;
}

interface Client {
  id: string;
  nom: string;
  prenom: string | null;
  adresse: string | null;
  ville: string | null;
  telephone: string | null;
  email: string | null;
  tableau_config: string | null;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const BREAKER_TYPES: Record<string, { isDiff?: boolean; diffType?: string; label: string }> = {
  "1P":      { label: "1P" },
  "2P":      { label: "2P" },
  "diff-AC": { label: "ID AC", isDiff: true, diffType: "AC" },
  "diff-A":  { label: "ID A",  isDiff: true, diffType: "A"  },
  "diff-F":  { label: "ID F",  isDiff: true, diffType: "F"  },
};

const CIRCUITS: Record<string, { label: string; icon: string; section: string | null }> = {
  lumiere:         { label: "Lumière",          icon: "💡", section: "1.5" },
  prise_16:        { label: "Prises 16A",       icon: "🔌", section: "1.5" },
  prise_20:        { label: "Prises 20A",       icon: "🔌", section: "2.5" },
  cuisine_prises:  { label: "Prises cuisine",   icon: "🍳", section: "2.5" },
  plaque:          { label: "Plaque cuisson",   icon: "🔥", section: "6.0" },
  four:            { label: "Four",             icon: "🥘", section: "2.5" },
  lave_linge:      { label: "Lave-linge",       icon: "🧺", section: "2.5" },
  lave_vaisselle:  { label: "Lave-vaisselle",   icon: "🍽️", section: "2.5" },
  seche_linge:     { label: "Sèche-linge",      icon: "👕", section: "2.5" },
  chauffe_eau:     { label: "Chauffe-eau",      icon: "🚿", section: "2.5" },
  chauffage:       { label: "Chauffage élec.",  icon: "🌡️", section: "2.5" },
  clim:            { label: "Climatisation",    icon: "❄️", section: "2.5" },
  seche_serviette: { label: "Sèche-serviette",  icon: "🛁", section: "1.5" },
  congelateur:     { label: "Congélateur",      icon: "🧊", section: "2.5" },
  irve:            { label: "IRVE (recharge)",  icon: "🔋", section: "6.0" },
  piscine:         { label: "Piscine/PAC",      icon: "🏊", section: "2.5" },
  vmc:             { label: "VMC",              icon: "💨", section: "1.5" },
  alarme:          { label: "Alarme",           icon: "🔔", section: "1.5" },
  exterieur:       { label: "Extérieur",        icon: "🌿", section: "1.5" },
  garage:          { label: "Garage",           icon: "🏠", section: "1.5" },
  general:         { label: "Général / Arrivée",icon: "⚡", section: "10.0" },
  parafoudre:      { label: "Parafoudre",       icon: "⛈️", section: null  },
  autre:           { label: "Autre",            icon: "⚙️", section: "2.5" },
};

function labelCommande(g: GroupeLumineux): string {
  if (g.typeCommande === "simple") return "Simple allumage";
  if (g.typeCommande === "vav") return `Va-et-vient (${g.nbCommandes} inter.)`;
  return `Télérupteur (${g.nbCommandes} BP)`;
}

function safeBreakers(slots: (Breaker | null)[] | undefined): Breaker[] {
  if (!Array.isArray(slots)) return [];
  return slots.filter((b): b is Breaker =>
    b != null && typeof b === "object" && typeof b.type === "string" && b.type.length > 0
  );
}

function parseRows(config: string): BreakerRow[] {
  try {
    const parsed = JSON.parse(config);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row: any) => {
      if (!row || typeof row !== "object") return null;
      const slots: (Breaker | null)[] = Array(9).fill(null);
      const rawSlots = Array.isArray(row.slots) ? row.slots : (Array.isArray(row.breakers) ? row.breakers : []);
      rawSlots.forEach((b: any, i: number) => {
        if (i >= 9 || b == null || typeof b !== "object" || typeof b.type !== "string") return;
        let pieces: PieceConfig[] = [];
        if (Array.isArray(b.pieces)) {
          pieces = b.pieces.map((p: any) => ({
            nom: p.nom ?? "",
            nbPrises: p.nbPrises ?? 1,
            groupes: Array.isArray(p.groupes) && p.groupes.length > 0
              ? p.groupes
              : [{ nbPoints: p.pointsLumineux ?? 1, typeCommande: (p.typeCommande ?? "simple") as CommandeType, nbCommandes: p.nbCommandes ?? 1 }],
          }));
        }
        slots[i] = { id: b.id ?? i, label: b.label ?? "", circuit: b.circuit ?? "autre", amperes: b.amperes ?? 16, type: b.type, pieces };
      });
      return { id: row.id ?? Math.random(), name: row.name ?? "Rangée", slots };
    }).filter(Boolean) as BreakerRow[];
  } catch { return []; }
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function TableauPublicPage() {
  const params   = useParams();
  const clientId = params.clientId as string;

  const [client, setClient] = useState<Client | null>(null);
  const [profil,  setProfil] = useState<Profil | null>(null);
  const [rows,    setRows]   = useState<BreakerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("clients").select("*").eq("id", clientId).single(),
      supabase.from("profil").select("*").single(),
    ]).then(([{ data: c }, { data: p }]) => {
      if (!c || !c.tableau_config) { setNotFound(true); setLoading(false); return; }
      setClient(c);
      setProfil(p as Profil | null);
      setRows(parseRows(c.tableau_config));
      setLoading(false);
    });
  }, [clientId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm font-mono">Chargement…</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-2xl mb-2">⚡</p>
          <p className="text-gray-600 font-medium">Tableau non trouvé</p>
          <p className="text-gray-400 text-sm mt-1">Ce tableau n'existe pas ou n'est pas disponible.</p>
        </div>
      </div>
    );
  }

  const dateExport = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  const totalCircuits = rows.flatMap(r => safeBreakers(r.slots)).filter(b => !BREAKER_TYPES[b.type]?.isDiff).length;

  return (
    <div className="min-h-screen bg-gray-50 font-sans">

      {/* Header artisan */}
      <div className="bg-gray-900 text-white">
        <div className="max-w-2xl mx-auto px-5 py-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-amber-400 font-bold text-lg leading-tight">
                {profil?.nom_entreprise || `${profil?.prenom ?? ""} ${profil?.nom ?? ""}`.trim() || "Électricien"}
              </p>
              {profil?.nom_entreprise && (
                <p className="text-gray-300 text-sm mt-0.5">{profil.prenom} {profil.nom}</p>
              )}
              <div className="flex flex-col gap-0.5 mt-2">
                {profil?.telephone && (
                  <a href={`tel:${profil.telephone}`} className="text-gray-300 text-sm hover:text-amber-400 transition-colors">
                    📞 {profil.telephone}
                  </a>
                )}
                {profil?.email && (
                  <a href={`mailto:${profil.email}`} className="text-gray-300 text-sm hover:text-amber-400 transition-colors">
                    ✉️ {profil.email}
                  </a>
                )}
                {profil?.adresse && (
                  <p className="text-gray-400 text-xs mt-1">{profil.adresse}</p>
                )}
                {profil?.siret && (
                  <p className="text-gray-500 text-xs font-mono">SIRET {profil.siret}</p>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-500 font-mono">Tableau électrique</p>
              <p className="text-xs text-gray-500 font-mono mt-0.5">{dateExport}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Client info */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-5 py-4">
          <p className="text-xs text-gray-400 font-mono uppercase tracking-wide mb-1">Installation</p>
          <p className="font-semibold text-gray-900 text-lg">
            {client?.prenom ? `${client.prenom} ${client.nom}` : client?.nom}
          </p>
          {client?.adresse && <p className="text-gray-500 text-sm">{client.adresse}{client.ville ? `, ${client.ville}` : ""}</p>}
          <div className="flex gap-4 mt-2">
            <p className="text-xs text-gray-400 font-mono">{rows.length} rangée{rows.length > 1 ? "s" : ""}</p>
            <p className="text-xs text-gray-400 font-mono">{totalCircuits} circuit{totalCircuits > 1 ? "s" : ""}</p>
          </div>
        </div>
      </div>

      {/* Tableau — rangées */}
      <div className="max-w-2xl mx-auto px-5 py-6 flex flex-col gap-6">
        {rows.map((row, ri) => {
          const diff = row.slots[0];
          const breakers = safeBreakers(row.slots.slice(1));
          const isDiff = diff && !!BREAKER_TYPES[diff.type]?.isDiff;

          return (
            <div key={row.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              {/* Rangée header */}
              <div className="flex items-center justify-between px-4 py-3 bg-gray-900">
                <span className="text-amber-400 font-mono font-bold text-sm">{row.name}</span>
                {isDiff && diff && (
                  <span className="text-xs font-mono text-gray-400">
                    ID {BREAKER_TYPES[diff.type]?.diffType ?? ""} · 30mA
                  </span>
                )}
              </div>

              {/* Circuits */}
              <div className="divide-y divide-gray-100">
                {breakers.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-gray-400 italic">Aucun circuit configuré</p>
                ) : (
                  breakers.map((b, bi) => {
                    const spec = CIRCUITS[b.circuit] || CIRCUITS.autre;
                    const label = b.label || spec.label;
                    const isLight = b.circuit === "lumiere";
                    const isPrise = ["prise_16","prise_20","cuisine_prises","exterieur","garage"].includes(b.circuit);

                    return (
                      <div key={b.id} className="px-4 py-3">
                        {/* Circuit header */}
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-base">{spec.icon}</span>
                          <span className="font-semibold text-gray-900 text-sm flex-1">{label}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{b.amperes}A</span>
                            {spec.section && (
                              <span className="text-xs font-mono text-gray-400">{spec.section}mm²</span>
                            )}
                          </div>
                        </div>

                        {/* Pièces */}
                        {b.pieces.length > 0 && (
                          <div className="ml-6 flex flex-col gap-2 mt-2">
                            {b.pieces.map((piece, pi) => (
                              <div key={pi} className="bg-gray-50 rounded-lg p-2.5">
                                <p className="text-xs font-semibold text-gray-600 mb-1.5">
                                  {piece.nom || `Zone ${pi + 1}`}
                                </p>
                                {isLight && piece.groupes.map((g, gi) => (
                                  <div key={gi} className="flex items-center gap-2 text-xs text-gray-500 mb-0.5">
                                    <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0"></span>
                                    <span>
                                      {g.nbPoints} pt{g.nbPoints > 1 ? "s" : ""} lumineux · {labelCommande(g)}
                                    </span>
                                  </div>
                                ))}
                                {isPrise && (
                                  <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <span className="w-1 h-1 rounded-full bg-blue-400 shrink-0"></span>
                                    <span>{piece.nbPrises} prise{piece.nbPrises > 1 ? "s" : ""}</span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="max-w-2xl mx-auto px-5 pb-10">
        <div className="border-t border-gray-200 pt-4 flex items-center justify-between">
          <p className="text-xs text-gray-400 font-mono">
            Document généré par VoltApp · {dateExport}
          </p>
          {profil?.telephone && (
            <a href={`tel:${profil.telephone}`}
              className="text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors">
              {profil.telephone}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
