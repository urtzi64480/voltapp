import { describe, expect, it, vi } from "vitest";
import { analyserPhotosTableau, erreurDepuisStatut, ErreurVision, NOM_OUTIL, SCHEMA_OUTIL } from "@/lib/tableau-ia-vision";

const img = [{ type: "image/jpeg" as const, base64: "QUJD".repeat(40) }];
const rep = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const toolUse = (input: unknown) => ({ content: [{ type: "text", text: "ok" }, { type: "tool_use", name: NOM_OUTIL, input }] });

describe("analyserPhotosTableau", () => {
  it("force l'outil de relevé, envoie les images et renvoie un relevé normalisé", async () => {
    const f = vi.fn().mockResolvedValue(rep(200, toolUse({ photos_exploitables: true, rangees: [{ nom: "R1", appareils: [{ nature: "disjoncteur", calibre_a: 16, etiquette: "Prises", confiance: "haute" }] }] })));
    const { releve, modele } = await analyserPhotosTableau(img, "maison 1970", { cleApi: "k", fetchImpl: f as unknown as typeof fetch });
    expect(releve.rangees[0].appareils[0].calibreA).toBe(16);
    expect(modele).toBeTruthy();
    const [, init] = f.mock.calls[0];
    const corps = JSON.parse(init.body);
    expect(corps.tool_choice).toEqual({ type: "tool", name: NOM_OUTIL });
    expect(corps.tools[0].name).toBe(SCHEMA_OUTIL.name);
    expect(corps.messages[0].content.some((c: { type: string }) => c.type === "image")).toBe(true);
    expect(init.headers["x-api-key"]).toBe("k");
  });
  it("traduit les erreurs HTTP en messages clairs", async () => {
    for (const [s, st] of [[401, 502], [429, 429], [529, 503], [500, 503], [413, 413]] as const) {
      const f = vi.fn().mockResolvedValue(rep(s, {}));
      await expect(analyserPhotosTableau(img, "", { cleApi: "k", fetchImpl: f as unknown as typeof fetch })).rejects.toMatchObject({ statut: st });
    }
    expect(erreurDepuisStatut(400)).toBeInstanceOf(ErreurVision);
  });
  it("erreur si le modèle ne renvoie pas l'outil", async () => {
    const f = vi.fn().mockResolvedValue(rep(200, { content: [{ type: "text", text: "désolé" }] }));
    await expect(analyserPhotosTableau(img, "", { cleApi: "k", fetchImpl: f as unknown as typeof fetch })).rejects.toBeInstanceOf(ErreurVision);
  });
  it("erreur réseau et délai dépassé", async () => {
    const reseau = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(analyserPhotosTableau(img, "", { cleApi: "k", fetchImpl: reseau as unknown as typeof fetch })).rejects.toMatchObject({ statut: 503 });
    const lent = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("abort"), { name: "AbortError" })))));
    await expect(analyserPhotosTableau(img, "", { cleApi: "k", fetchImpl: lent as unknown as typeof fetch, delaiMs: 10 })).rejects.toMatchObject({ statut: 504 });
  });
  it("un relevé aberrant est assaini, pas rejeté", async () => {
    const f = vi.fn().mockResolvedValue(rep(200, toolUse({ rangees: "n'importe quoi" })));
    const { releve } = await analyserPhotosTableau(img, "", { cleApi: "k", fetchImpl: f as unknown as typeof fetch });
    expect(releve.rangees).toEqual([]);
    expect(releve.photosExploitables).toBe(false);
  });
});
