"use client";
// src/components/plan/PhotosChantier.tsx
//
// PHOTOS DE CHANTIER D'UN CIRCUIT : galerie (vignettes) et visionneuse (grande photo, légende, date, déplacer / rattacher / supprimer).
// Les données sont dans Niveau.photosChantier ; l'envoi et le stockage sont gérés par la page du plan (voir lib/photos-chantier.ts).
import { useRef, useState } from "react";
import { X, Camera, Trash2, MapPin, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { PhotoChantier } from "@/lib/maison-types";

interface Props {
  titre: string;
  photos: PhotoChantier[];
  /** Circuits du niveau (pour rattacher une photo dont le circuit a changé de nom). */
  circuits: { label: string; nom: string }[];
  /** Libellé du circuit auquel appartient la galerie (null = toutes les photos du niveau). */
  labelCircuit: string | null;
  url: (chemin: string) => string;
  /** Photo à ouvrir d'emblée (clic sur un repère du plan). */
  ouvrirId?: number;
  enCours?: string | null;
  onClose: () => void;
  onAjouter?: (fichiers: File[]) => void;
  onSupprimer: (id: number) => void;
  onLegende: (id: number, texte: string) => void;
  onDeplacer: (ids: number[]) => void;
  onRattacher: (id: number, label: string) => void;
}

const dateFr = (iso: string) => { try { return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };

export default function PhotosChantier(p: Props) {
  const [idx, setIdx] = useState<number | null>(() => { const i = p.ouvrirId != null ? p.photos.findIndex(x => x.id === p.ouvrirId) : -1; return i >= 0 ? i : null; });
  const [confirmer, setConfirmer] = useState<number | null>(null);
  const entree = useRef<HTMLInputElement>(null);
  const courante = idx != null ? p.photos[idx] : null;
  const nomCircuit = (label: string) => p.circuits.find(c => c.label === label)?.nom ?? null;

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-3" onClick={p.onClose}>
      <div className="card w-full max-w-3xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-ink-200 shrink-0">
          <div className="min-w-0">
            <p className="font-semibold text-ink-900 flex items-center gap-1.5 truncate"><Camera size={15} className="text-volt-600 shrink-0" /> Photos de chantier · {p.titre}</p>
            <p className="text-[11px] text-ink-500">{p.photos.length} photo{p.photos.length > 1 ? "s" : ""} — à retrouver sur le plan, sur le tracé du circuit</p>
          </div>
          <button onClick={p.onClose} className="btn-ghost !px-2 !py-1 text-ink-400" aria-label="Fermer"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-3">
          {courante ? (
            <div className="flex flex-col gap-2">
              <div className="relative bg-ink-900 rounded-lg overflow-hidden flex items-center justify-center" style={{ minHeight: 240 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url(courante.chemin)} alt={courante.legende || "Photo de chantier"} className="max-h-[56vh] w-auto object-contain" />
                {p.photos.length > 1 && (<>
                  <button className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/80 rounded-full p-1.5" aria-label="Précédente" onClick={() => setIdx(((idx as number) - 1 + p.photos.length) % p.photos.length)}><ChevronLeft size={18} /></button>
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/80 rounded-full p-1.5" aria-label="Suivante" onClick={() => setIdx(((idx as number) + 1) % p.photos.length)}><ChevronRight size={18} /></button>
                </>)}
              </div>
              <input className="input" placeholder="Légende (ex. : passage de gaine derrière le placard, avant doublage)" value={courante.legende ?? ""} onChange={e => p.onLegende(courante.id, e.target.value)} />
              <p className="text-[11px] text-ink-500">Prise le {dateFr(courante.date)} · position sur le plan : {courante.point.x.toFixed(2)} m, {courante.point.y.toFixed(2)} m · photo {(idx as number) + 1} / {p.photos.length}</p>
              {p.labelCircuit == null && nomCircuit(courante.circuit) == null && (
                <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                  <span className="text-amber-800">Le circuit « {courante.circuit} » n&apos;existe plus sous ce nom. Rattacher cette photo à :</span>
                  <select className="input !py-1 !text-xs flex-1" defaultValue="" onChange={e => { if (e.target.value) p.onRattacher(courante.id, e.target.value); }}>
                    <option value="">— choisir un circuit —</option>
                    {p.circuits.map(c => <option key={c.label} value={c.label}>{c.nom}</option>)}
                  </select>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost !text-xs" onClick={() => setIdx(null)}>← Toutes les photos</button>
                <button className="btn-ghost !text-xs" onClick={() => p.onDeplacer([courante.id])}><MapPin size={13} /> Changer l&apos;emplacement sur le plan</button>
                {confirmer === courante.id
                  ? <button className="btn-ghost !text-xs !text-red-600 !border-red-300" onClick={() => { p.onSupprimer(courante.id); setConfirmer(null); setIdx(p.photos.length > 1 ? Math.max(0, (idx as number) - 1) : null); }}>Confirmer la suppression</button>
                  : <button className="btn-ghost !text-xs !text-red-500" onClick={() => setConfirmer(courante.id)}><Trash2 size={13} /> Supprimer</button>}
              </div>
            </div>
          ) : (
            <>
              {p.photos.length === 0 && <p className="text-sm text-ink-500">Aucune photo pour l&apos;instant. Ajoute-en autant que tu veux : tu choisis ensuite, sur le plan, où elles ont été prises sur le tracé du circuit.</p>}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {p.photos.map((ph, i) => (
                  <button key={ph.id} className="relative aspect-square rounded-lg overflow-hidden border border-ink-200 bg-ink-50 text-left" onClick={() => setIdx(i)} title={ph.legende || dateFr(ph.date)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url(ph.chemin)} alt={ph.legende || "Photo de chantier"} className="w-full h-full object-cover" loading="lazy" />
                    {(ph.legende || p.labelCircuit == null) && <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] px-1.5 py-0.5 truncate">{ph.legende || nomCircuit(ph.circuit) || ph.circuit}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {p.onAjouter && (
          <div className="flex items-center gap-2 p-3 border-t border-ink-200 shrink-0">
            <input ref={entree} type="file" accept="image/*" multiple className="hidden"
              onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length > 0) p.onAjouter!(f); }} />
            <button className="btn-volt flex-1 justify-center" disabled={!!p.enCours} onClick={() => entree.current?.click()}>
              {p.enCours ? <><Loader2 size={14} className="animate-spin" /> {p.enCours}</> : <><Camera size={14} /> Ajouter des photos</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
