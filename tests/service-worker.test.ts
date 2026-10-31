import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Exécute public/sw.js avec de faux caches / fetch pour vérifier la stratégie (aucun navigateur nécessaire).
function monter(reseau: (url: string) => Promise<unknown>) {
  const ecouteurs: Record<string, (e: any) => void> = {};
  const stores = new Map<string, Map<string, unknown>>();
  const cle = (r: unknown) => typeof r === "string" ? r : (r as { url: string }).url.replace(/^https:\/\/app\.test/, "");
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
    open: async (n: string) => {
      if (!stores.has(n)) stores.set(n, new Map());
      const m = stores.get(n)!;
      return { match: async (r: unknown) => m.get(cle(r)), put: async (r: unknown, v: unknown) => { m.set(cle(r), v); } };
    },
  };
  const appels: string[] = [];
  const self = { location: { origin: "https://app.test" }, addEventListener: (t: string, f: (e: any) => void) => { ecouteurs[t] = f; }, skipWaiting: () => {}, clients: { claim: async () => {} } };
  runInNewContext(readFileSync("public/sw.js", "utf8"), { self, caches, URL, fetch: async (r: { url: string }) => { appels.push(r.url); return reseau(r.url); } });
  const requete = (url: string, o: { method?: string; mode?: string } = {}) => ({ url, method: o.method ?? "GET", mode: o.mode ?? "no-cors" });
  const traiter = async (req: ReturnType<typeof requete>) => {
    let reponse: Promise<unknown> | undefined;
    ecouteurs.fetch({ request: req, respondWith: (p: Promise<unknown>) => { reponse = p; } });
    return reponse ? await reponse : undefined;
  };
  return { traiter, requete, stores, appels, ecouteurs };
}
const rep = (o: Partial<{ ok: boolean; redirected: boolean; type: string }> = {}) => ({ ok: true, redirected: false, type: "basic", clone() { return this; }, ...o });
const SUIVI = "https://app.test/plan/abc/suivi?projet=1";

describe("service worker", () => {
  it("ne touche ni aux POST, ni aux autres origines (Supabase), ni aux autres pages ni à l'API", async () => {
    const sw = monter(async () => rep());
    for (const r of [
      sw.requete(SUIVI, { method: "POST", mode: "navigate" }),
      sw.requete("https://xyz.supabase.co/rest/v1/projets"),
      sw.requete("https://app.test/devis", { mode: "navigate" }),
      sw.requete("https://app.test/api/public/demande"),
      sw.requete("https://app.test/plan/abc", { mode: "navigate" }),
    ]) expect(await sw.traiter(r), r.url).toBeUndefined();
    expect(sw.appels).toEqual([]);
  });

  it("fichiers statiques : cache d'abord (une seule requête réseau)", async () => {
    const sw = monter(async () => rep());
    const r = sw.requete("https://app.test/_next/static/chunks/a.js");
    await sw.traiter(r); await sw.traiter(r);
    expect(sw.appels).toHaveLength(1);
  });

  it("page de suivi : réseau d'abord, copie gardée, servie quand le réseau est coupé", async () => {
    let enLigne = true;
    const page = rep();
    const sw = monter(async () => { if (!enLigne) throw new TypeError("Failed to fetch"); return page; });
    const nav = sw.requete(SUIVI, { mode: "navigate" });
    expect(await sw.traiter(nav)).toBe(page);
    enLigne = false;
    expect(await sw.traiter(nav)).toBe(page);                       // copie du cache
    expect(await sw.traiter(sw.requete("https://app.test/plan/abc/suivi?projet=2", { mode: "navigate" }))).toBe(page); // autre ?projet= : même coquille
  });

  it("hors ligne sans copie : l'erreur réseau est laissée telle quelle (comportement habituel du navigateur)", async () => {
    const sw = monter(async () => { throw new TypeError("Failed to fetch"); });
    await expect(sw.traiter(sw.requete(SUIVI, { mode: "navigate" }))).rejects.toThrow("Failed to fetch");
  });

  it("une redirection (vers /login) ou une erreur n'est JAMAIS mise en cache", async () => {
    for (const mauvaise of [rep({ redirected: true }), rep({ ok: false }), rep({ type: "opaque" })]) {
      const sw = monter(async () => mauvaise);
      await sw.traiter(sw.requete(SUIVI, { mode: "navigate" }));
      expect([...sw.stores.get("voltapp-pages-v1")!.keys()]).toEqual([]);
    }
  });

  it("l'activation supprime les anciens caches voltapp-* seulement", async () => {
    const sw = monter(async () => rep());
    sw.stores.set("voltapp-static-v0", new Map()); sw.stores.set("autre-site", new Map()); sw.stores.set("voltapp-static-v1", new Map());
    let fini: Promise<unknown> = Promise.resolve();
    sw.ecouteurs.activate({ waitUntil: (p: Promise<unknown>) => { fini = p; } });
    await fini;
    expect([...sw.stores.keys()].sort()).toEqual(["autre-site", "voltapp-static-v1"]);
  });
});
