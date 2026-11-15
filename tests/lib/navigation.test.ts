import { describe, it, expect } from "vitest";
import { RUBRIQUES, estActif, lireOuvertes, rubriqueDe, rubriquesVisibles, HREFS_PAGE_PUBLIQUE } from "@/lib/navigation";

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
  it("les étiquettes sont dans la rubrique Chantier", () => {
    expect(rubriqueDe("/etiquettes")).toBe("Chantier");
    expect(estActif("/etiquettes", "/etiquettes")).toBe(true);
  });
  it("chaque page du menu n'apparaît qu'une fois", () => {
    const hrefs = RUBRIQUES.flatMap(r => r.items.map(i => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toHaveLength(20);
  });
  it("le suivi de chantier est dans la rubrique Chantier et s'allume sur ses sous-pages", () => {
    expect(rubriqueDe("/suivi")).toBe("Chantier");
    expect(RUBRIQUES.find(r => r.nom === "Chantier")?.items.some(i => i.href === "/suivi")).toBe(true);
  });
  it("mémoire tolérante", () => {
    expect(lireOuvertes(null)).toBeNull(); expect(lireOuvertes("pas du json")).toBeNull(); expect(lireOuvertes("{}")).toBeNull();
    expect(lireOuvertes('["Ventes","Pirate",3]')).toEqual(["Ventes"]);
  });
});

describe("menu sans page publique", () => {
  const hrefs = (r: typeof RUBRIQUES) => r.flatMap(x => x.items.map(i => i.href));
  it("avec page publique : menu inchangé", () => {
    expect(rubriquesVisibles(true)).toEqual(RUBRIQUES);
  });
  it("sans page publique : plus de Leads web, RDV ni Réalisations, le reste est conservé", () => {
    const visibles = hrefs(rubriquesVisibles(false));
    for (const h of ["/leads", "/rdv", "/realisations"]) expect(visibles).not.toContain(h);
    expect(HREFS_PAGE_PUBLIQUE).toEqual(["/leads", "/rdv", "/realisations"]);
    expect(visibles).toEqual(hrefs(RUBRIQUES).filter(h => !HREFS_PAGE_PUBLIQUE.includes(h)));
    for (const h of ["/clients", "/demandes", "/devis", "/factures", "/planning", "/catalogue", "/parametres"]) expect(visibles).toContain(h);
  });
});
