// src/components/ActionsAndGallery.tsx
"use client";
import { useEffect, useState } from "react";
import { FileText, CalendarDays, Zap, Images, X } from "lucide-react";
import ChantierGallery from "@/components/ChantierGallery";

interface Photo {
  id: string;
  photo_url: string;
  chantier: string | null;
  description: string | null;
}

export default function ActionsAndGallery({
  userId,
  photos,
}: {
  userId: string;
  photos: Photo[];
}) {
  const [showGallery, setShowGallery] = useState(false);

  // Empêche le scroll de la page tant que l'overlay galerie est ouvert
  useEffect(() => {
    if (!showGallery) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showGallery]);

  return (
    <>
      {/* Liens d'action — empilés verticalement, le conteneur parent les positionne à droite */}
      <div className="flex flex-col gap-3">
        <a
          href={`/demande/${userId}?mode=devis`}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-volt-500 text-ink-900 font-semibold text-sm hover:bg-volt-400 transition-colors"
        >
          <FileText size={16} /> Devis gratuit
        </a>
        <a
          href={`/demande/${userId}?mode=rdv`}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-ink-200 text-ink-700 font-semibold text-sm hover:border-volt-500 transition-colors"
        >
          <CalendarDays size={16} /> Prendre RDV
        </a>
        <a
          href="tel:+33769995222"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 text-red-600 font-semibold text-sm hover:border-red-400 transition-colors"
        >
          <Zap size={16} /> Urgence
        </a>
        {photos.length > 0 && (
          <button
            onClick={() => setShowGallery(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-ink-200 text-ink-700 font-semibold text-sm hover:border-volt-500 transition-colors"
          >
            <Images size={16} /> Mes réalisations
          </button>
        )}
      </div>

      {/* Galerie en overlay plein écran — toutes les photos visibles sans scroller la page */}
      {showGallery && photos.length > 0 && (
        <div
          className="fixed inset-0 z-50 bg-ink-900/80 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 sm:p-8"
          onClick={() => setShowGallery(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-5 sm:p-8 relative shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowGallery(false)}
              className="absolute top-4 right-4 w-9 h-9 rounded-full bg-ink-100 text-ink-600 flex items-center justify-center hover:bg-ink-200 transition-colors"
              aria-label="Fermer la galerie"
            >
              <X size={18} />
            </button>
            <h2 className="font-display text-2xl text-ink-900 mb-1 pr-12">Mes réalisations</h2>
            <p className="text-ink-500 text-sm mb-6">Par chantier — cliquez pour voir les photos.</p>
            <ChantierGallery photos={photos} />
          </div>
        </div>
      )}
    </>
  );
}
