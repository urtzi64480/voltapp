// src/components/ZoneCarte.tsx
"use client";
//
// Visuel "carte" pour la zone d'intervention : une vraie carte OpenStreetMap
// (pas d'API key, embed public gratuit), cadrée sur le Pays Basque autour de
// la base, plus les communes desservies en badges groupés par secteur.
//
// Toggle contrôlé en React (useState), pas un <details> natif : le contenu
// texte (résumé, badges de villes) reste TOUJOURS dans le DOM, juste masqué
// visuellement via la classe "hidden" quand replié — donc toujours indexable
// par les moteurs de recherche, quel que soit l'état du toggle. La carte
// (iframe) est en revanche montée/démontée par React : elle ne charge (et ne
// consomme de bande passante) qu'au moment où le visiteur clique pour l'ouvrir
// — un iframe n'apporte de toute façon aucun contenu indexable pour cette
// page (contenu cross-origin), donc rien à perdre à ne pas le garder monté.
import { useState } from "react";
import { MapPin, ChevronDown } from "lucide-react";
import { VILLE_PRINCIPALE, RAYON_KM, COORDONNEES, ZONES } from "@/lib/seo-zone";

// Construit un bbox (emprise) centré sur les coordonnées données, assez large
// pour montrer confortablement le rayon d'intervention avec un peu de marge.
function buildBbox(lat: number, lng: number, rayonKm: number) {
  const kmParDegreLat = 111.03;
  const kmParDegreLng = 111.32 * Math.cos((lat * Math.PI) / 180);
  const margeKm = rayonKm * 1.4; // marge de confort autour du rayon affiché
  const dLat = margeKm / kmParDegreLat;
  const dLng = margeKm / kmParDegreLng;
  return {
    left: lng - dLng,
    right: lng + dLng,
    bottom: lat - dLat,
    top: lat + dLat,
  };
}

export default function ZoneCarte() {
  const [open, setOpen] = useState(false);

  const bbox = buildBbox(COORDONNEES.lat, COORDONNEES.lng, RAYON_KM);
  const mapSrc =
    `https://www.openstreetmap.org/export/embed.html` +
    `?bbox=${bbox.left},${bbox.bottom},${bbox.right},${bbox.top}` +
    `&layer=mapnik&marker=${COORDONNEES.lat},${COORDONNEES.lng}`;

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
          <iframe
            title={`Carte de la zone d'intervention Elektron autour de ${VILLE_PRINCIPALE}`}
            src={mapSrc}
            className="w-full h-72 sm:h-96"
            loading="lazy"
          />
        </div>
      )}

      {/* Résumé + badges de villes : toujours dans le DOM, juste masqués en CSS quand replié
          (donc toujours lus par les moteurs de recherche, peu importe l'état du toggle) */}
      <div className={open ? "mt-6" : "hidden"}>
        <p className="text-xs text-ink-400 text-center mb-6">
          Rayon d'intervention d'environ {RAYON_KM}&nbsp;km autour de {VILLE_PRINCIPALE}
        </p>

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
