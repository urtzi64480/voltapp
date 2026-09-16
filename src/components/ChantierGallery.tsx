// src/components/ChantierGallery.tsx
"use client";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import GalleryLightbox from "@/components/GalleryLightbox";

interface Photo {
  id: string;
  photo_url: string;
  chantier: string | null;
  description: string | null;
}

export default function ChantierGallery({ photos }: { photos: Photo[] }) {
  // Regroupe par chantier en conservant l'ordre de la requête (donc les chantiers
  // les plus récents en premier, puisque les photos sont déjà triées côté serveur).
  const grouped: Record<string, Photo[]> = {};
  photos.forEach((p) => {
    const key = (p.chantier ?? "").trim() || "Autres réalisations";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(p);
  });
  const chantiers = Object.keys(grouped);

  const [openChantier, setOpenChantier] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {chantiers.map((nom) => {
        const isOpen = openChantier === nom;
        return (
          <div key={nom} className="border border-ink-200 rounded-xl overflow-hidden bg-white">
            <button
              onClick={() => setOpenChantier(isOpen ? null : nom)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-ink-50 transition-colors text-left"
            >
              <span className="font-semibold text-ink-900 text-sm">{nom}</span>
              <span className="flex items-center gap-2 text-ink-400 text-xs shrink-0">
                {grouped[nom].length} photo{grouped[nom].length > 1 ? "s" : ""}
                {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </span>
            </button>
            {isOpen && (
              <div className="p-4 bg-ink-50 border-t border-ink-200">
                <GalleryLightbox photos={grouped[nom]} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
