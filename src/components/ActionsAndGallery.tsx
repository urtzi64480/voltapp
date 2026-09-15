// src/components/ActionsAndGallery.tsx
"use client";
import { useState } from "react";
import { FileText, CalendarDays, Zap, Images, ChevronDown, ChevronUp } from "lucide-react";
import ChantierGallery from "@/components/ChantierGallery";

interface Photo {
  id: string;
  photo_url: string;
  chantier: string | null;
}

export default function ActionsAndGallery({
  userId,
  photos,
}: {
  userId: string;
  photos: Photo[];
}) {
  const [showGallery, setShowGallery] = useState(false);

  return (
    <>
      <div className="flex flex-wrap gap-3 mt-6">
        <a
          href={`/demande/${userId}`}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-volt-500 text-ink-900 font-semibold text-sm hover:bg-volt-400 transition-colors"
        >
          <FileText size={16} /> Devis gratuit
        </a>
        <a
          href={`/demande/${userId}`}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-ink-200 text-ink-700 font-semibold text-sm hover:border-volt-500 transition-colors"
        >
          <CalendarDays size={16} /> Prendre RDV
        </a>
        <a
          href="tel:+33769995222"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 text-red-600 font-semibold text-sm hover:border-red-400 transition-colors"
        >
          <Zap size={16} /> Urgence
        </a>
        {photos.length > 0 && (
          <button
            onClick={() => setShowGallery((v) => !v)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-ink-200 text-ink-700 font-semibold text-sm hover:border-volt-500 transition-colors"
          >
            <Images size={16} />
            Mes réalisations
            {showGallery ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        )}
      </div>

      {showGallery && photos.length > 0 && (
        <div className="mt-8 pt-8 border-t border-ink-100">
          <h2 className="font-display text-2xl text-ink-900 mb-1">Mes réalisations</h2>
          <p className="text-ink-500 text-sm mb-6">Par chantier — cliquez pour voir les photos.</p>
          <ChantierGallery photos={photos} />
        </div>
      )}
    </>
  );
}
