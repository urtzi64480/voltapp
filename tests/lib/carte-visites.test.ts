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
