import { describe, expect, it } from "vitest";
import { tarifHoraire } from "@/lib/rentabilite";

describe("tarifHoraire", () => {
  it("brut avant cotisations, net après cotisations et IR, matériel déduit", () => {
    // CA 1000, matériel 200, cotisations 150, IR 20, 10 h
    expect(tarifHoraire({ ca: 1000, coutAchat: 200, cotisations: 150, impots: 20, heures: 10 })).toEqual({ heures: 10, brut: 80, net: 63 });
  });
  it("arrondi au centime", () => { expect(tarifHoraire({ ca: 100, coutAchat: 0, cotisations: 21.2, impots: 0, heures: 3 })).toMatchObject({ brut: 33.33, net: 26.27 }); });
  it("heures absentes, nulles ou invalides → null (pas de division par zéro)", () => {
    for (const heures of [null, undefined, 0, -2, NaN]) expect(tarifHoraire({ ca: 100, coutAchat: 0, cotisations: 0, impots: 0, heures })).toBeNull();
  });
  it("devis déficitaire : tarif négatif conservé", () => {
    expect(tarifHoraire({ ca: 100, coutAchat: 300, cotisations: 10, impots: 0, heures: 4 })).toMatchObject({ brut: -50, net: -52.5 });
  });
});
