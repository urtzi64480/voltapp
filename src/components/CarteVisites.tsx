"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Carte des visiteurs : un point par visiteur sur OpenStreetMap (Leaflet), sans détail de visite.
// Position approximative (ville). Les villes hors zone sont géocodées à la demande puis gardées dans l'appareil.
import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { loadLeaflet } from "@/lib/leaflet-cdn";
import { lieuxAGeocoder, pointsVisiteurs, type Coord, type VisiteCarte } from "@/lib/carte-visites";
import { COORDONNEES } from "@/lib/seo-zone";
import { ecrireStockage, lireStockage } from "@/lib/safe-storage";

const CLE_CACHE = "voltapp:geo-villes:v1";
type Cache = Record<string, Coord | null>;

const lireCache = (): Cache => {
  try { const b = lireStockage("local", CLE_CACHE); return b ? (JSON.parse(b) as Cache) : {}; } catch { return {}; }
};

export default function CarteVisites({ visites }: { visites: VisiteCarte[] }) {
  const [cache, setCache] = useState<Cache>({});
  const [erreur, setErreur] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const conteneur = useRef<HTMLDivElement | null>(null);
  const carteRef = useRef<any>(null);
  const [tactile, setTactile] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => { setCache(lireCache()); setTactile(typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches); }, []);

  const extra = useMemo(() => {
    const m: Record<string, Coord> = {};
    Object.entries(cache).forEach(([k, v]) => { if (v) m[k] = v; });
    return m;
  }, [cache]);
  const { points, sansPosition } = useMemo(() => pointsVisiteurs(visites, extra), [visites, extra]);

  // Géocodage des villes encore inconnues : 5 par appel, villes déjà tentées (même sans résultat) jamais redemandées.
  useEffect(() => {
    const restants = lieuxAGeocoder(visites, extra).filter(l => !(l.cle in cache));
    if (restants.length === 0) return;
    let annule = false;
    setEnCours(true);
    fetch("/api/visites/geocoder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lieux: restants.slice(0, 5) }) })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { resultats?: Cache } | null) => {
        if (annule) return;
        const res = d?.resultats ?? {};
        if (Object.keys(res).length === 0) { setEnCours(false); return; } // échec : on n'insiste pas pour cette fois
        const suivant = { ...cache, ...res };
        ecrireStockage("local", CLE_CACHE, JSON.stringify(suivant));
        setCache(suivant);
        setEnCours(false);
      })
      .catch(() => { if (!annule) setEnCours(false); });
    return () => { annule = true; };
  }, [visites, extra, cache]);

  useEffect(() => {
    if (points.length === 0) return;
    let annule = false;
    let carte: any = null;
    loadLeaflet().then(L => {
      if (annule || !conteneur.current) return;
      // Sur écran tactile, la carte reste figée tant qu'on ne l'a pas activée : elle ne capte ni le défilement de la page
      // ni les pincements, et ne zoome plus toute seule.
      const figee = window.matchMedia("(pointer: coarse)").matches;
      carte = L.map(conteneur.current, {
        scrollWheelZoom: false, dragging: !figee, touchZoom: !figee, doubleClickZoom: !figee, tap: false, boxZoom: false,
      });
      carteRef.current = carte;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 18,
      }).addTo(carte);
      const bornes = L.latLngBounds([[COORDONNEES.lat, COORDONNEES.lng]]);
      points.forEach(p => {
        L.circleMarker([p.lat, p.lng], { radius: 6, color: "#fff", weight: 1.5, fillColor: "#D97706", fillOpacity: 0.85 })
          .addTo(carte).bindTooltip(p.libelle, { direction: "top" });
        bornes.extend([p.lat, p.lng]);
      });
      carte.fitBounds(bornes, { padding: [30, 30], maxZoom: 9 });
      window.setTimeout(() => carte?.invalidateSize(), 150);
    }).catch(() => { if (!annule) setErreur(true); });
    return () => { annule = true; carteRef.current = null; if (carte) carte.remove(); };
  }, [points]);

  const basculer = () => {
    const c = carteRef.current;
    const suivant = !active;
    setActive(suivant);
    if (!c) return;
    const m = suivant ? "enable" : "disable";
    c.dragging[m](); c.touchZoom[m](); c.doubleClickZoom[m]();
  };

  return (
    <div>
      <p className="text-xs font-semibold text-ink-600 mb-2 flex items-center gap-1.5"><MapPin size={14} /> Localisation des visiteurs</p>
      {points.length === 0 ? (
        <p className="text-ink-300 text-sm">{enCours ? "Localisation en cours…" : "Aucun visiteur localisable pour le moment."}</p>
      ) : erreur ? (
        <p className="text-sm text-ink-500">La carte n&apos;a pas pu se charger (réseau).</p>
      ) : (
        <div className="relative">
          <div ref={conteneur} className="h-72 w-full rounded-xl overflow-hidden border border-ink-200" role="img" aria-label="Carte de localisation des visiteurs" />
          {tactile && (
            <button type="button" onClick={basculer} className="absolute bottom-2 right-2 z-[500] rounded-lg bg-white/95 border border-ink-200 px-2.5 py-1.5 text-xs font-semibold text-ink-700 shadow">
              {active ? "Figer la carte" : "Déplacer / zoomer"}
            </button>
          )}
        </div>
      )}
      <p className="text-[11px] text-ink-400 mt-1.5">
        {points.length} visiteur{points.length > 1 ? "s" : ""} placé{points.length > 1 ? "s" : ""} (position approximative : la ville).
        {sansPosition > 0 ? ` ${sansPosition} sans ville connue.` : ""}{enCours && points.length > 0 ? " Localisation d'autres villes en cours…" : ""}
      </p>
    </div>
  );
}
