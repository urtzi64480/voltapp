import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSur, hoteAutorise, ipPrivee, urlCalendrierSure } from "@/lib/ssrf";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("ipPrivee", () => {
  it.each(["10.0.0.1", "127.0.0.1", "0.0.0.0", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "224.0.0.1", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3"])("%s est privée", ip => {
    expect(ipPrivee(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.63.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("%s est publique", ip => {
    expect(ipPrivee(ip)).toBe(false);
  });
});

describe("hoteAutorise (IP littérales : aucun DNS)", () => {
  it("https uniquement", async () => {
    expect(await hoteAutorise(new URL("http://8.8.8.8/x"))).toBe(false);
    expect(await hoteAutorise(new URL("https://8.8.8.8/x"))).toBe(true);
  });
  it("refuse localhost, .local, .internal, IP privées et IPv6 littérales privées", async () => {
    for (const u of ["https://localhost/", "https://imprimante.local/", "https://x.internal/", "https://127.0.0.1/", "https://[::1]/", "https://169.254.169.254/latest/meta-data"]) {
      expect(await hoteAutorise(new URL(u)), u).toBe(false);
    }
  });
  it("accepte une IPv6 publique", async () => {
    expect(await hoteAutorise(new URL("https://[2606:4700:4700::1111]/"))).toBe(true);
  });
});

describe("urlCalendrierSure", () => {
  it("webcal:// → https://, refuse le privé et le n'importe quoi", async () => {
    expect(await urlCalendrierSure("webcal://8.8.8.8/cal.ics")).toBe("https://8.8.8.8/cal.ics");
    expect(await urlCalendrierSure("webcal://127.0.0.1/cal.ics")).toBeNull();
    expect(await urlCalendrierSure("pas une url")).toBeNull();
  });
});

describe("fetchSur", () => {
  const rep = (status: number, location?: string) => new Response(null, { status, headers: location ? { location } : {} });
  it("suit une redirection vers un hôte public", async () => {
    const f = vi.fn().mockResolvedValueOnce(rep(302, "https://1.1.1.1/b")).mockResolvedValueOnce(rep(200));
    vi.stubGlobal("fetch", f);
    const res = await fetchSur("https://8.8.8.8/a");
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });
  it("refuse une redirection vers une adresse interne (et ne l'appelle jamais)", async () => {
    const f = vi.fn().mockResolvedValueOnce(rep(302, "https://169.254.169.254/"));
    vi.stubGlobal("fetch", f);
    await expect(fetchSur("https://8.8.8.8/a")).rejects.toThrow(/refusée/);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("redirection sans Location, ou trop nombreuses → erreur", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rep(302)));
    await expect(fetchSur("https://8.8.8.8/a")).rejects.toThrow(/invalide/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rep(302, "https://8.8.4.4/")));
    await expect(fetchSur("https://8.8.8.8/a", {}, 2)).rejects.toThrow(/Trop de redirections/);
  });
  it("URL de départ privée : aucun appel réseau", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(fetchSur("https://10.0.0.1/")).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});
