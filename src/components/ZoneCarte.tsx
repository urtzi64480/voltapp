// src/components/ZoneCarte.tsx
"use client";
//
// Carte de la zone d'intervention : Leaflet + tuiles OpenStreetMap, chargés
// dynamiquement depuis un CDN (unpkg) au moment où le visiteur ouvre le bloc
// — pas de dépendance npm à ajouter à package.json, pas de clé d'API.
//
// Affiche : un cercle représentant le rayon de RAYON_KM autour de la base,
// un marqueur pour la base (Jatxou), et un petit marqueur par commune
// desservie (VILLES_COORDS). Pour rester lisible malgré la cinquantaine de
// communes, seules les "villes phares" (VILLES_PHARES) portent une étiquette
// affichée en permanence ; les autres restent visibles comme points et
// affichent leur nom au survol/clic.
//
// Le résumé + les badges de villes (texte) restent TOUJOURS dans le DOM,
// juste masqués en CSS quand replié — donc toujours indexables par les
// moteurs de recherche, contrairement au contenu de la carte elle-même
// (tuiles/canvas, non indexable de toute façon).
import { useEffect, useRef, useState } from "react";
import { MapPin, ChevronDown } from "lucide-react";
import {
  VILLE_PRINCIPALE,
  RAYON_KM,
  COORDONNEES,
  ZONES,
  VILLES_COORDS,
  VILLES_PHARES,
} from "@/lib/seo-zone";

const LEAFLET_VERSION = "1.9.4";

declare global {
  interface Window {
    L?: any;
    __leafletLoadPromise?: Promise<any>;
  }
}

// Charge Leaflet (CSS + JS) une seule fois, même si plusieurs instances du
// composant tentent de l'ouvrir en même temps.
function loadLeaflet(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.L) return Promise.resolve(window.L);
  if (window.__leafletLoadPromise) return window.__leafletLoadPromise;

  window.__leafletLoadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet-css="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
      link.setAttribute("data-leaflet-css", "true");
      document.head.appendChild(link);
    }

    const script = document.createElement("script");
    script.src = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("Échec du chargement de Leaflet"));
    document.head.appendChild(script);
  });

  return window.__leafletLoadPromise;
}

export default function ZoneCarte() {
  const [open, setOpen] = useState(false);
  const [erreurCarte, setErreurCarte] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (!open) return;
    let annule = false;

    loadLeaflet()
      .then((L) => {
        if (annule || !mapContainerRef.current || mapInstanceRef.current) return;

        const map = L.map(mapContainerRef.current, {
          center: [COORDONNEES.lat, COORDONNEES.lng],
          zoom: 9,
          scrollWheelZoom: false,
        });
        mapInstanceRef.current = map;

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 18,
        }).addTo(map);

        // Rayon d'intervention
        L.circle([COORDONNEES.lat, COORDONNEES.lng], {
          radius: RAYON_KM * 1000,
          color: "#D97706",
          weight: 1.5,
          fillColor: "#F59E0B",
          fillOpacity: 0.07,
          dashArray: "6 6",
        }).addTo(map);

        // Base — Jatxou
        L.circleMarker([COORDONNEES.lat, COORDONNEES.lng], {
          radius: 7,
          color: "#fff",
          weight: 2,
          fillColor: "#1C1917",
          fillOpacity: 1,
        })
          .addTo(map)
          .bindTooltip(`${VILLE_PRINCIPALE} · Elektron`, {
            permanent: true,
            direction: "top",
            offset: [0, -8],
            className: "carte-label carte-label-centre",
          });

        // Communes desservies
        Object.entries(VILLES_COORDS).forEach(([nom, coord]) => {
          const marker = L.circleMarker([coord.lat, coord.lng], {
            radius: 4,
            color: "#fff",
            weight: 1.5,
            fillColor: "#57534E",
            fillOpacity: 0.9,
          }).addTo(map);

          if (VILLES_PHARES.includes(nom)) {
            marker.bindTooltip(nom, {
              permanent: true,
              direction: "right",
              offset: [6, 0],
              className: "carte-label",
            });
          } else {
            marker.bindTooltip(nom, { direction: "top" });
          }
        });

        // La carte est montée dans un conteneur déjà visible (pas de display:none
        // au moment du montage), mais un invalidateSize() différé évite tout
        // souci de dimensions mal calculées juste après la transition d'ouverture.
        setTimeout(() => map.invalidateSize(), 150);
      })
      .catch(() => {
        if (!annule) setErreurCarte(true);
      });

    return () => {
      annule = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [open]);

  return (
    <div className="card card-inner">
      <div className="flex items-center gap-2 mb-1">
        <MapPin size={18} className="text-volt-600 shrink-0" />
        <h2 className="section-title mb-0">Zone d'intervention</h2>
      </div>
      <p className="text-sm text-ink-500">
        Basé à {VILLE_PRINCIPALE}, j'interviens dans un rayon d'environ{" "}
        {RAYON_KM}&nbsp;km : Bayonne, Anglet, Biarritz, Saint-Jean-de-Luz,
        Cambo-les-Bains, Hasparren, et tout le Pays Basque.
      </p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-volt-600 hover:text-volt-700 select-none cursor-pointer"
      >
        {open ? "Masquer la carte et les communes" : "Voir la carte et toutes les communes desservies"}
        <ChevronDown
          size={16}
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Carte : montée uniquement à l'ouverture (pas de coût réseau tant que fermé) */}
      {open && (
        <div className="mt-6 rounded-xl overflow-hidden border border-ink-200">
          {erreurCarte ? (
            <p className="p-4 text-sm text-ink-500">
              La carte n'a pas pu se charger. Les communes desservies restent
              listées ci-dessous.
            </p>
          ) : (
            <div ref={mapContainerRef} className="w-full h-72 sm:h-96" />
          )}
        </div>
      )}

      {/* Résumé + badges de villes : toujours dans le DOM, juste masqués en CSS quand replié
          (donc toujours lus par les moteurs de recherche, peu importe l'état du toggle) */}
      <div className={open ? "mt-6" : "hidden"}>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-5">
          {ZONES.map((zone) => (
            <div key={zone.label}>
              <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-2">
                {zone.label}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {zone.villes.map((ville) => (
                  <span
                    key={ville}
                    className="badge bg-ink-50 text-ink-700 border border-ink-200"
                  >
                    {ville}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-ink-400 mt-6">
          Votre commune n'apparaît pas dans la liste ? Contactez-moi quand même,
          il y a de bonnes chances que je puisse me déplacer.
        </p>
      </div>
    </div>
  );
}
