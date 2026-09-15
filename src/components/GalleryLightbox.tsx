// src/components/GalleryLightbox.tsx
"use client";
import { useState, useEffect } from "react";
import { X } from "lucide-react";

interface Photo {
  id: string;
  photo_url: string;
}

export default function GalleryLightbox({ photos }: { photos: Photo[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIndex(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex]);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {photos.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setOpenIndex(i)}
            className="aspect-square rounded-xl overflow-hidden border border-ink-200 hover:border-volt-500 transition-colors"
          >
            <img
              src={p.photo_url}
              alt="Réalisation Elektron"
              className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
            />
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center px-4"
          onClick={() => setOpenIndex(null)}
        >
          <button
            onClick={() => setOpenIndex(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
            aria-label="Fermer"
          >
            <X size={20} />
          </button>
          <img
            src={photos[openIndex].photo_url}
            alt="Réalisation Elektron"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </>
  );
}
