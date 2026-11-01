// src/lib/leaflet-cdn.ts
// Chargement unique de Leaflet (CSS + JS) depuis un CDN, sans dépendance npm ni clé d'API.
/* eslint-disable @typescript-eslint/no-explicit-any */
const LEAFLET_VERSION = "1.9.4";

declare global {
  interface Window {
    L?: any;
    __leafletLoadPromise?: Promise<any>;
  }
}

// Charge Leaflet (CSS + JS) une seule fois, même si plusieurs instances du
// composant tentent de l'ouvrir en même temps.
export function loadLeaflet(): Promise<any> {
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

