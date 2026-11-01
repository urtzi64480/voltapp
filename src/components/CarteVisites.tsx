"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Carte des visites (statistiques de la page demande) : Leaflet + OpenStreetMap, un cercle par ville dont la taille suit
// le nombre de visites. Position approximative (ville), jamais l'adresse du visiteur.
import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { loadLeaflet } from "@/lib/leaflet-cdn";
import { grouperVisites, rayonPoint, type VisiteCarte } from "@/lib/carte-visites";
import { COORDONNEES } from "@/lib/seo-zone";

export default function CarteVisites({ visites }: { visites: VisiteCarte[] }) {
  const { points, sansPosition } = useMemo(() => grouperVisites(visites), [visites]);
  const conteneur = useRef<HTMLDivElement | null>(null);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    if (points.length === 0) return;
    let annule = false;
    let carte: any = null;
    loadLeaflet().then(L => {
      if (annule || !conteneur.current) return;
      carte = L.map(conteneur.current, { scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 18,
      }).addTo(carte);
      const max = Math.max(...points.map(p => p.nb));
      const bornes = L.latLngBounds([[COORDONNEES.lat, COORDONNEES.lng]]);
      points.forEach(p => {
        L.circleMarker([p.lat, p.lng], { radius: rayonPoint(p.nb, max), color: "#fff", weight: 1.5, fillColor: "#D97706", fillOpacity: 0.7 })
          .addTo(carte)
          .bindTooltip(`${p.libelle} · ${p.nb} visite${p.nb > 1 ? "s" : ""}`, { direction: "top" });
        bornes.extend([p.lat, p.lng]);
      });
      carte.fitBounds(bornes, { padding: [30, 30], maxZoom: 11 });
      window.setTimeout(() => carte?.invalidateSize(), 150);
    }).catch(() => { if (!annule) setErreur(true); });
    return () => { annule = true; if (carte) carte.remove(); };
  }, [points]);

  return (
    <div>
      <p className="text-xs font-semibold text-ink-600 mb-2 flex items-center gap-1.5"><MapPin size={14} /> D&apos;où viennent les visiteurs</p>
      {points.length === 0 ? (
        <p className="text-ink-300 text-sm">Aucune visite localisable pour le moment.</p>
      ) : erreur ? (
        <p className="text-sm text-ink-500">La carte n&apos;a pas pu se charger (réseau). Villes : {points.slice(0, 8).map(p => `${p.libelle} (${p.nb})`).join(", ")}.</p>
      ) : (
        <div ref={conteneur} className="h-64 w-full rounded-xl overflow-hidden border border-ink-200" role="img" aria-label="Carte des villes d'où viennent les visiteurs" />
      )}
      <p className="text-[11px] text-ink-400 mt-1.5">
        Position approximative (ville), d&apos;après l&apos;adresse réseau du visiteur.
        {sansPosition > 0 ? ` ${sansPosition} visite${sansPosition > 1 ? "s" : ""} non localisable${sansPosition > 1 ? "s" : ""} (ville inconnue ou hors zone, sans coordonnées).` : ""}
      </p>
    </div>
  );
}
