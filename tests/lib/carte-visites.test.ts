import { describe, it, expect } from "vitest";
import { cleLieu, lieuxAGeocoder, normaliser, pointsVisiteurs, positionVisite } from "@/lib/carte-visites";

describe("carte des visiteurs", () => {
  it("priorité : coordonnées enregistrées, ville de la zone, ville géocodée", () => {
    expect(positionVisite({ latitude: 43.5, longitude: -1.4, ville: "Paris" })).toEqual({ lat: 43.5, lng: -1.4 });
    expect(positionVisite({ latitude: "43.49", longitude: "-1.47" })).toEqual({ lat: 43.49, lng: -1.47 });
    expect(positionVisite({ ville: "BAYONNE" })).not.toBeNull();
    expect(positionVisite({ ville: "saint jean de luz" })).not.toBeNull();
    const paris = { ville: "Paris", pays: "FR" };
    expect(positionVisite(paris)).toBeNull();
    expect(positionVisite(paris, { [cleLieu(paris)]: { lat: 48.86, lng: 2.35 } })).toEqual({ lat: 48.86, lng: 2.35 });
  });
  it("positions invalides → null", () => {
    expect(positionVisite({ latitude: 0, longitude: 0 })).toBeNull();
    expect(positionVisite({ latitude: 95, longitude: 10 })).toBeNull();
    expect(positionVisite({ latitude: "abc", longitude: 1, ville: "Atlantide" })).toBeNull();
    expect(positionVisite({ ville: null })).toBeNull();
  });
  it("un point par visiteur, écartés s'ils sont au même endroit, jamais perdus", () => {
    const { points, sansPosition } = pointsVisiteurs([{ ville: "Bayonne" }, { ville: "Bayonne" }, { ville: "bayonne" }, { ville: "Anglet" }, { pays: "FR" }]);
    expect(points).toHaveLength(4); expect(sansPosition).toBe(1);
    const bay = points.filter(p => p.libelle.toLowerCase() === "bayonne");
    expect(new Set(bay.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)).size).toBe(3);
    bay.forEach(p => expect(Math.abs(p.lat - bay[0].lat)).toBeLessThan(0.01));
  });
  it("lieux à géocoder : uniques, seulement ceux sans position", () => {
    const l = lieuxAGeocoder([{ ville: "Paris", pays: "FR" }, { ville: "paris", pays: "fr" }, { ville: "Bayonne" }, { pays: "FR" }, { ville: "Lyon", pays: "FR" }]);
    expect(l.map(x => x.ville)).toEqual(["Paris", "Lyon"]);
    expect(lieuxAGeocoder([{ ville: "Paris", pays: "FR" }], { [cleLieu({ ville: "Paris", pays: "FR" })]: { lat: 1, lng: 1 } })).toEqual([]);
  });
  it("normaliser", () => { expect(normaliser("Saint-Jean-de-Luz")).toBe("saint jean de luz"); });
});

import { ZOOM_VILLE, cibleDeVisite } from "@/lib/carte-visites";
describe("cibleDeVisite (zoom sur la ville d'une visite)", () => {
  const pays = (c: unknown) => (c === "FR" ? "France" : String(c ?? ""));
  it("coordonnées enregistrées : position exacte (non écartée) et libellé « Ville (Pays) »", () => {
    expect(cibleDeVisite({ ville: "Biarritz", pays: "FR", latitude: 43.48, longitude: -1.56 }, {}, pays)).toEqual({ lat: 43.48, lng: -1.56, libelle: "Biarritz (France)" });
  });
  it("sans coordonnées : ville connue de la zone, sinon ville géocodée, sinon null", () => {
    const connue = cibleDeVisite({ ville: "Bayonne", pays: "FR" }, {}, pays); expect(connue).not.toBeNull(); expect(connue?.libelle).toBe("Bayonne (France)");
    const v = { ville: "Zzzville", pays: "FR" };
    expect(cibleDeVisite(v)).toBeNull();
    expect(cibleDeVisite(v, { [cleLieu(v)]: { lat: 10, lng: 20 } }, pays)).toMatchObject({ lat: 10, lng: 20, libelle: "Zzzville (France)" });
  });
  it("ville seule, pays seul, rien : libellés de repli ; visite sans position → null", () => {
    expect(cibleDeVisite({ ville: "Pau", latitude: 43.3, longitude: -0.37 })?.libelle).toBe("Pau");
    expect(cibleDeVisite({ pays: "FR", latitude: 43.3, longitude: -0.37 }, {}, pays)?.libelle).toBe("France");
    expect(cibleDeVisite({ latitude: 43.3, longitude: -0.37 })?.libelle).toBe("Position approximative");
    expect(cibleDeVisite({ pays: "FR" })).toBeNull(); expect(cibleDeVisite({ latitude: 0, longitude: 0 })).toBeNull();
  });
  it("zoom « ville » entre le zoom régional (9) et la rue (16+)", () => { expect(ZOOM_VILLE).toBeGreaterThan(9); expect(ZOOM_VILLE).toBeLessThan(16); });
});
