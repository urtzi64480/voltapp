import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientIp, isRateLimited, isTooFast, MIN_SUBMIT_DELAY_MS, RATE_LIMIT_MAX_REQUESTS, recordAttempt } from "@/lib/rate-limit";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const clientCount = (count: number | null, error: unknown = null) => {
  const chaine: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte"]) chaine[m] = vi.fn(() => chaine);
  chaine.then = (res: (v: unknown) => unknown) => res({ count, error });
  return { sb: { from: vi.fn(() => chaine) } as unknown as SupabaseClient, chaine };
};

describe("getClientIp", () => {
  const req = (h: Record<string, string>) => new Request("https://x.test", { headers: h });
  it("première IP de x-forwarded-for, sinon x-real-ip, sinon unknown", () => {
    expect(getClientIp(req({ "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" }))).toBe("1.2.3.4");
    expect(getClientIp(req({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(getClientIp(req({}))).toBe("unknown");
  });
});

describe("isTooFast", () => {
  it("bloque sous 2,5 s, accepte au-delà, ne bloque pas sans horodatage valide", () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    expect(isTooFast(100_000 - 1000)).toBe(true);
    expect(isTooFast(100_000 - MIN_SUBMIT_DELAY_MS)).toBe(false);
    expect(isTooFast(0)).toBe(false);
    for (const v of [undefined, null, "123", NaN]) expect(isTooFast(v)).toBe(false);
  });
});

describe("isRateLimited", () => {
  it("limité à partir du quota, pas avant", async () => {
    expect(await isRateLimited(clientCount(RATE_LIMIT_MAX_REQUESTS).sb, "1.1.1.1", "devis")).toBe(true);
    expect(await isRateLimited(clientCount(RATE_LIMIT_MAX_REQUESTS - 1).sb, "1.1.1.1", "devis")).toBe(false);
    expect(await isRateLimited(clientCount(null).sb, "1.1.1.1", "rdv")).toBe(false);
  });
  it("IP inconnue ou vide : jamais bloqué, sans requête", async () => {
    const { sb } = clientCount(99);
    expect(await isRateLimited(sb, "unknown", "devis")).toBe(false);
    expect(await isRateLimited(sb, "", "devis")).toBe(false);
    expect(sb.from).not.toHaveBeenCalled();
  });
  it("erreur base : fail open (journalisé)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await isRateLimited(clientCount(99, { message: "x" }).sb, "1.1.1.1", "devis")).toBe(false);
    expect(spy).toHaveBeenCalled();
  });
  it("fenêtre glissante de 15 min sur la bonne IP et le bon type", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
    const { sb, chaine } = clientCount(0);
    await isRateLimited(sb, "1.1.1.1", "rdv");
    expect(chaine.gte).toHaveBeenCalledWith("created_at", "2026-10-31T11:45:00.000Z");
    expect(chaine.eq).toHaveBeenCalledWith("ip", "1.1.1.1");
    expect(chaine.eq).toHaveBeenCalledWith("type", "rdv");
  });
});

describe("recordAttempt", () => {
  it("insère ip + type ; ignore l'IP inconnue ; ne lève pas sur erreur", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const sb = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient;
    await recordAttempt(sb, "1.1.1.1", "devis");
    expect(insert).toHaveBeenCalledWith({ ip: "1.1.1.1", type: "devis" });
    await recordAttempt(sb, "unknown", "devis");
    expect(insert).toHaveBeenCalledTimes(1);
    vi.spyOn(console, "error").mockImplementation(() => {});
    insert.mockResolvedValueOnce({ error: { message: "x" } });
    await expect(recordAttempt(sb, "2.2.2.2", "rdv")).resolves.toBeUndefined();
  });
});
