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

const estPageSuivi = (url) => /^\/(plan|devis)\/[^/]+\/suivi\/?$/.test(url.pathname);

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
