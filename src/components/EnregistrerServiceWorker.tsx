"use client";
// Enregistre le service worker (public/sw.js) — uniquement en production, jamais en développement (cache gênant).
import { useEffect } from "react";

export default function EnregistrerServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => { /* indisponible (navigation privée…) : l'application fonctionne comme avant */ });
  }, []);
  return null;
}
