import { afterEach, describe, expect, it, vi } from "vitest";
import {
  arrondi2, conditionnementLabel, dateLocale, echecSupabase, fmt, fmtDate, genNumero, initiales, nomAvecConditionnement,
  PLAFOND_MATERIAU, PLAFOND_SERVICE, STATUT_COLORS, STATUT_LABELS, STATUTS_DEVIS, STATUTS_FACTURE,
} from "@/lib/utils";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const espaces = (s: string) => s.replace(/[  ]/g, " ");

describe("arrondi2", () => {
  it("arrondit au centime", () => {
    expect(arrondi2(1.234)).toBe(1.23);
    expect(arrondi2(1.236)).toBe(1.24);
    expect(arrondi2(10)).toBe(10);
  });
  it("neutralise les erreurs de flottant (0,1 + 0,2)", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(arrondi2(0.1 + 0.2)).toBe(0.3);
  });
  it("arrondit 1,005 à 1,01 (sans EPSILON on obtiendrait 1,00)", () => {
    expect(arrondi2(1.005)).toBe(1.01);
  });
});

describe("formats", () => {
  it("fmt : euros, virgule, sans séparateur de milliers", () => {
    expect(espaces(fmt(1234.5))).toBe("1234,50 €");
    expect(espaces(fmt(0))).toBe("0,00 €");
    expect(espaces(fmt(1234567.891))).toBe("1234567,89 €");
  });
  it("fmtDate : jj/mm/aaaa", () => {
    expect(fmtDate("2026-10-31T12:00:00Z")).toBe("31/10/2026");
  });
  it("dateLocale : date LOCALE (pas UTC), y compris juste après minuit", () => {
    expect(dateLocale(new Date(2026, 0, 5, 0, 0))).toBe("2026-01-05");
    expect(dateLocale(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
    expect(dateLocale(new Date(2026, 2, 1, 0, 30))).toBe("2026-03-01");
  });
});

describe("numérotation", () => {
  it("genNumero : préfixe-année-compteur+1 sur 3 chiffres", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 31, 12, 0));
    expect(genNumero("DEV", 0)).toBe("DEV-2026-001");
    expect(genNumero("DEV", 4)).toBe("DEV-2026-005");
    expect(genNumero("FAC", 998)).toBe("FAC-2026-999");
    expect(genNumero("FAC", 999)).toBe("FAC-2026-1000");
  });
});

describe("initiales", () => {
  it("prénom + nom, sinon nom seul", () => {
    expect(initiales("Dupont", "Jean")).toBe("JD");
    expect(initiales("dupont")).toBe("D");
    expect(initiales("  martin ", null)).toBe("M");
    expect(initiales("")).toBe("");
  });
});

describe("echecSupabase", () => {
  it("false sans erreur, true avec erreur (et journalise)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(echecSupabase(null, "Action")).toBe(false);
    expect(echecSupabase(undefined, "Action")).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(echecSupabase({ message: "boom" }, "Action")).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("conditionnement des câbles / gaines", () => {
  it("câble ou fil → bobine ; gaine ou moulure → rouleau", () => {
    expect(nomAvecConditionnement("Câble 3G2.5", 100, "cablage_3g25")).toBe("Câble 3G2.5 (bobine 100m)");
    expect(nomAvecConditionnement("Gaine ICTA 20", 50, "gaine_icta20")).toBe("Gaine ICTA 20 (rouleau 50m)");
    expect(nomAvecConditionnement("Moulure", 2, "moulure")).toBe("Moulure (rouleau 2m)");
  });
  it("un article à plusieurs sous-catégories est un rouleau dès que l'une l'est", () => {
    expect(nomAvecConditionnement("X", 25, "fil_h07|gaine_irl16")).toBe("X (rouleau 25m)");
  });
  it("sans longueur fixe : nom inchangé", () => {
    for (const l of [null, undefined, 0, -5]) expect(nomAvecConditionnement("Câble", l as number, "cablage_x")).toBe("Câble");
  });
  it("conditionnementLabel : libellé court ou null", () => {
    expect(conditionnementLabel(100, "fil_x")).toBe("bobine 100 m");
    expect(conditionnementLabel(50, "moulure")).toBe("rouleau 50 m");
    expect(conditionnementLabel(null, "moulure")).toBeNull();
    expect(conditionnementLabel(0, "moulure")).toBeNull();
  });
});

describe("constantes métier", () => {
  it("plafonds micro-entreprise 2026-2028 : vente > services", () => {
    expect(PLAFOND_SERVICE).toBe(83600);
    expect(PLAFOND_MATERIAU).toBe(203100);
    expect(PLAFOND_MATERIAU).toBeGreaterThan(PLAFOND_SERVICE);
  });
  it("chaque statut de devis et de facture a un libellé ET une couleur", () => {
    for (const s of [...STATUTS_DEVIS, ...STATUTS_FACTURE]) {
      expect(STATUT_LABELS[s], `libellé de ${s}`).toBeTruthy();
      expect(STATUT_COLORS[s], `couleur de ${s}`).toBeTruthy();
    }
  });
});
