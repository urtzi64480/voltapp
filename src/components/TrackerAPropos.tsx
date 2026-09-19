// src/components/TrackerAPropos.tsx
"use client";
import { useEffect } from "react";

// Déduit le type d'appareil à partir du user-agent — seulement mobile ou desktop
// (les tablettes sont regroupées avec mobile, usage tactile similaire).
function detectDeviceType(ua: string): "mobile" | "desktop" {
  const s = ua.toLowerCase();
  if (/mobi|android|iphone|ipad|ipod|tablet|nexus 7|nexus 9|nexus 10|kfapwi/.test(s)) return "mobile";
  return "desktop";
}

// Détection simple du navigateur à partir du user-agent (sans dépendance externe).
// L'ordre des tests compte : Edge et Opera embarquent "Chrome" dans leur UA.
function detectBrowser(ua: string): string {
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/chrome|crios/i.test(ua)) return "Chrome";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  return "Autre";
}

// Détection simple du système d'exploitation à partir du user-agent.
function detectOS(ua: string): string {
  if (/windows/i.test(ua)) return "Windows";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/android/i.test(ua)) return "Android";
  if (/mac os/i.test(ua)) return "macOS";
  if (/linux/i.test(ua)) return "Linux";
  return "Autre";
}

/**
 * Tracking de visite pour /a-propos, rendu depuis le Server Component de la
 * page (qui ne peut pas lui-même accéder à navigator/localStorage).
 *
 * Même clé et même fenêtre de 30 minutes que /demande/[userId] (voir ce
 * fichier) : demande + a-propos visités à quelques minutes d'écart comptent
 * pour UNE seule visite au total, quel que soit l'onglet ou un F5/retour.
 */
export default function TrackerAPropos({ userId }: { userId: string }) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const FENETRE_SESSION_MS = 30 * 60 * 1000; // 30 minutes
    const storageKey = `voltapp_derniere_visite_${userId}`;
    const derniere = localStorage.getItem(storageKey);
    const maintenant = Date.now();
    if (derniere && maintenant - Number(derniere) < FENETRE_SESSION_MS) return;
    localStorage.setItem(storageKey, String(maintenant));

    const ua = navigator.userAgent;
    fetch("/api/public/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        table: "demande_visites",
        user_id: userId,
        referrer: document.referrer || null,
        user_agent: ua,
        device_type: detectDeviceType(ua),
        navigateur: detectBrowser(ua),
        os: detectOS(ua),
        langue: navigator.language || null,
        page: window.location.pathname,
        mode: null,
      }),
    }).catch((err) => console.error("Erreur tracking visite /a-propos :", err));
  }, [userId]);

  return null;
}
