"use client";
import { useState } from "react";

// Vignette d'un produit sur une ligne (devis, facture, liste de courses). Rien n'est affiché si la
// ligne n'a pas d'image ou si l'image ne se charge pas (lien mort, site qui bloque l'affichage).
export default function LigneImage({ url, taille = 36, className = "" }: { url?: string | null; taille?: number; className?: string }) {
  const [erreur, setErreur] = useState(false);
  if (!url || erreur) return null;
  return (
    <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer"
      onError={() => setErreur(true)}
      style={{ width: taille, height: taille }}
      className={`rounded-lg border border-ink-100 bg-white object-contain p-0.5 shrink-0 ${className}`} />
  );
}
