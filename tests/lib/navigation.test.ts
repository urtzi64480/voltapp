import { describe, it, expect } from "vitest";
import { RUBRIQUES, estActif, lireOuvertes, rubriqueDe } from "@/lib/navigation";

describe("navigation", () => {
  it("« /plan » ne s'allume pas sur « /planning »", () => {
    expect(estActif("/planning", "/plan")).toBe(false);
    expect(estActif("/plan/abc/suivi", "/plan")).toBe(true);
    expect(estActif("/plan", "/plan")).toBe(true);
    expect(estActif("/devis/nouveau", "/devis")).toBe(true);
  });
  it("rubrique de la page active", () => {
    expect(rubriqueDe("/devis/abc/fin-chantier")).toBe("Ventes");
    expect(rubriqueDe("/planning")).toBe("Chantier");
    expect(rubriqueDe("/export-comptable")).toBe("Pilotage");
    expect(rubriqueDe("/parametres")).toBe("Outils");
    expect(rubriqueDe("/dashboard")).toBeNull();
  });
  it("chaque page du menu n'apparaît qu'une fois", () => {
    const hrefs = RUBRIQUES.flatMap(r => r.items.map(i => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toHaveLength(17);
  });
  it("mémoire tolérante", () => {
    expect(lireOuvertes(null)).toBeNull(); expect(lireOuvertes("pas du json")).toBeNull(); expect(lireOuvertes("{}")).toBeNull();
    expect(lireOuvertes('["Ventes","Pirate",3]')).toEqual(["Ventes"]);
  });
});
