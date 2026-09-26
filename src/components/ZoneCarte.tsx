// src/components/ZoneCarte.tsx
//
// Visuel "carte" pour la zone d'intervention : un schéma en cercles concentriques
// (façon radar) centré sur la base, avec le rayon d'action affiché, puis les
// communes desservies présentées en badges groupés par secteur.
//
// Replié par défaut derrière un <details>/<summary> natif : un résumé court
// reste visible en permanence (ville, rayon, quelques villes phares), et la
// carte + la liste complète des communes ne s'affichent qu'au clic — pour ne
// pas allonger inutilement la page. <details> garde le contenu dans le HTML
// même fermé (contrairement à un `{open && ...}` React), donc rien n'est
// perdu pour le référencement, juste visuellement replié par défaut.
//
// Schéma stylisé plutôt qu'un vrai fond de carte géographique (Google Maps/
// Leaflet) : pas de dépendance externe, pas de clé d'API, aucun script tiers.
// Le rayon et les distances sont indicatifs, pas à l'échelle au pixel près.
import { MapPin, ChevronDown } from "lucide-react";
import { VILLE_PRINCIPALE, RAYON_KM, ZONES } from "@/lib/seo-zone";

export default function ZoneCarte() {
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

      <details className="group mt-3">
        <summary className="list-none flex items-center gap-1.5 cursor-pointer text-sm font-semibold text-volt-600 hover:text-volt-700 select-none">
          Voir la carte et toutes les communes desservies
          <ChevronDown
            size={16}
            className="transition-transform duration-150 group-open:rotate-180"
          />
        </summary>

        <div className="mt-6 grid md:grid-cols-[260px_1fr] gap-8 items-start">
          {/* Schéma "radar" : cercles concentriques + rayon d'action */}
          <div className="relative w-full max-w-[260px] mx-auto aspect-square shrink-0">
            <svg viewBox="0 0 260 260" className="w-full h-full" role="img" aria-label={`Rayon d'intervention de ${RAYON_KM} km autour de ${VILLE_PRINCIPALE}`}>
              {/* Cercle extérieur : rayon 40 km */}
              <circle
                cx="130"
                cy="130"
                r="122"
                fill="none"
                stroke="currentColor"
                className="text-ink-200"
                strokeWidth="1.5"
                strokeDasharray="5 5"
              />
              {/* Cercle intermédiaire : rayon 20 km */}
              <circle
                cx="130"
                cy="130"
                r="72"
                fill="none"
                stroke="currentColor"
                className="text-ink-200"
                strokeWidth="1.5"
                strokeDasharray="3 5"
              />
              {/* Léger halo autour du centre */}
              <circle cx="130" cy="130" r="28" className="fill-volt-500/10" />

              {/* Repères de distance */}
              <text x="130" y="14" textAnchor="middle" className="fill-ink-400 text-[10px] font-semibold">
                {RAYON_KM}&nbsp;km
              </text>
              <text x="130" y="64" textAnchor="middle" className="fill-ink-400 text-[10px] font-semibold">
                {Math.round(RAYON_KM / 2)}&nbsp;km
              </text>

              {/* Repère central */}
              <circle cx="130" cy="130" r="6" className="fill-volt-500 stroke-white" strokeWidth="2" />
            </svg>

            {/* Libellé du centre, en HTML par-dessus le SVG (plus simple à mettre en forme qu'un <text> multi-lignes) */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="mt-1 px-2.5 py-1 rounded-full bg-ink-900 text-white text-xs font-semibold shadow-sm">
                {VILLE_PRINCIPALE}
              </span>
              <span className="mt-1 text-[11px] text-ink-400">Elektron</span>
            </div>
          </div>

          {/* Communes desservies, groupées par secteur, en badges plutôt qu'en liste */}
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
        </div>

        <p className="text-xs text-ink-400 mt-6">
          Votre commune n'apparaît pas dans la liste ? Contactez-moi quand même,
          il y a de bonnes chances que je puisse me déplacer.
        </p>
      </details>
    </div>
  );
}
