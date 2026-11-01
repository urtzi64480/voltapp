/* VoltApp — service worker (mode hors-ligne du suivi de chantier).
 *
 * Périmètre volontairement étroit :
 *   · /_next/static/*          → cache d'abord (fichiers à empreinte : immuables) ;
 *   · pages /plan/<client>/suivi et /devis/<id>/suivi → réseau d'abord, copie du cache si le réseau est coupé ;
 *   · TOUT LE RESTE (API, Supabase, autres pages, POST…) passe sans toucher au réseau ni au cache.
 * Aucune donnée de l'utilisateur n'est mise en cache ici : la page est une coquille, les données viennent de Supabase
 * (copie locale gérée par l'application, dans localStorage).
 * Pour changer la stratégie : incrémenter VERSION, les anciens caches sont supprimés à l'activation. */
const VERSION = "v1";
const CACHE_STATIC = "voltapp-static-" + VERSION;
const CACHE_PAGES = "voltapp-pages-" + VERSION;

const estPageSuivi = (url) => /^\/(plan|devis)\/[^/]+\/(suivi|fin-chantier|reception)\/?$/.test(url.pathname);

self.addEventListener("install", () => { self.skipWaiting(); });

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.filter((n) => n.startsWith("voltapp-") && n !== CACHE_STATIC && n !== CACHE_PAGES).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_STATIC);
      const trouve = await cache.match(req);
      if (trouve) return trouve;
      const rep = await fetch(req);
      if (rep.ok) cache.put(req, rep.clone()).catch(() => {});
      return rep;
    })());
    return;
  }

  if (req.mode === "navigate" && estPageSuivi(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_PAGES);
      try {
        const rep = await fetch(req);
        // On ne garde que la vraie page (pas une redirection vers /login, pas une erreur).
        if (rep.ok && !rep.redirected && rep.type === "basic") cache.put(url.pathname, rep.clone()).catch(() => {});
        return rep;
      } catch (e) {
        const copie = await cache.match(url.pathname);
        if (copie) return copie;
        throw e;
      }
    })());
  }
});

/* Notifications push (résumé du matin). Le contenu est un petit JSON { titre, corps, url } envoyé par /api/public/push-cron. */
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const titre = typeof d.titre === "string" && d.titre ? d.titre : "VoltApp";
  const url = typeof d.url === "string" && d.url.startsWith("/") ? d.url : "/dashboard";
  event.waitUntil(self.registration.showNotification(titre, {
    body: typeof d.corps === "string" ? d.corps : "", icon: "/icon-192.png", badge: "/icon-192.png", data: { url }, tag: "voltapp-resume",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const f of fenetres) { if ("focus" in f) { await f.focus(); if ("navigate" in f) { try { await f.navigate(url); } catch (e) { /* page d'une autre origine */ } } return; } }
    await self.clients.openWindow(url);
  })());
});
