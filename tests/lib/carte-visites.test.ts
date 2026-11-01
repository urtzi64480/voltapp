import { describe, it, expect } from "vitest";
import { grouperVisites, normaliser, positionVisite, rayonPoint } from "@/lib/carte-visites";

describe("carte des visites", () => {
  it("coordonnées enregistrées prioritaires, sinon ville connue (accents/casse ignorés)", () => {
    expect(positionVisite({ latitude: 43.5, longitude: -1.4, ville: "Paris" })).toEqual({ lat: 43.5, lng: -1.4 });
    expect(positionVisite({ latitude: "43.49", longitude: "-1.47" })).toEqual({ lat: 43.49, lng: -1.47 });
    expect(positionVisite({ ville: "BAYONNE" })).not.toBeNull();
    expect(positionVisite({ ville: "saint jean de luz" })).not.toBeNull();
  });
  it("positions invalides ou inconnues → null", () => {
    expect(positionVisite({ latitude: 0, longitude: 0 })).toBeNull();
    expect(positionVisite({ latitude: 95, longitude: 10 })).toBeNull();
    expect(positionVisite({ latitude: "abc", longitude: 1, ville: "Atlantide" })).toBeNull();
    expect(positionVisite({ ville: null })).toBeNull();
  });
  it("regroupe par ville, compte les visites non localisables", () => {
    const { points, sansPosition } = grouperVisites([
      { ville: "Bayonne" }, { ville: "bayonne", latitude: 43.49, longitude: -1.47 }, { ville: "Anglet" },
      { ville: "Lyon" }, { pays: "FR" }, { latitude: 48.85, longitude: 2.35 },
    ]);
    expect(points[0]).toMatchObject({ libelle: "Bayonne", nb: 2 });
    expect(points.find(p => p.libelle === "Position approximative")?.nb).toBe(1);
    expect(points.reduce((a, p) => a + p.nb, 0) + sansPosition).toBe(6);
    expect(sansPosition).toBe(2);
  });
  it("rayon borné", () => {
    expect(rayonPoint(1, 100)).toBeGreaterThanOrEqual(6);
    expect(rayonPoint(100, 100)).toBe(20);
    expect(rayonPoint(0, 0)).toBe(6);
  });
  it("normaliser", () => { expect(normaliser("Saint-Jean-de-Luz")).toBe("saint jean de luz"); expect(normaliser("Cambo-les-Bains")).toBe("cambo les bains"); });
});
