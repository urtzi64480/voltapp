import { describe, expect, it } from "vitest";
import {
  calculerRemiseFacture, libelleRemiseFacture, motifRemiseFacture, montantRemiseFacture, MOTIF_REMISE_MAX, nettoyerMotifRemise,
  totalAvantRemiseFacture,
} from "@/lib/remise-facture";

describe("totalAvantRemiseFacture", () => {
  it("somme service + matériau, arrondie au centime", () => {
    expect(totalAvantRemiseFacture({ total_service: 100.1, total_materiau: 50.2 })).toBe(150.3);
  });
  it("tolère des valeurs absentes ou non numériques", () => {
    expect(totalAvantRemiseFacture({ total_service: undefined as unknown as number, total_materiau: 40 })).toBe(40);
    expect(totalAvantRemiseFacture({ total_service: "abc" as unknown as number, total_materiau: 0 })).toBe(0);
  });
});

describe("calculerRemiseFacture", () => {
  it("pourcentage", () => {
    expect(calculerRemiseFacture(200, "pct", 10)).toEqual({ montant: 20, valeurRetenue: 10, totalTtc: 180 });
    expect(calculerRemiseFacture(100, "pct", 33.33)).toEqual({ montant: 33.33, valeurRetenue: 33.33, totalTtc: 66.67 });
  });
  it("montant fixe", () => {
    expect(calculerRemiseFacture(200, "eur", 50)).toEqual({ montant: 50, valeurRetenue: 50, totalTtc: 150 });
  });
  it("le pourcentage est borné à 100 %", () => {
    expect(calculerRemiseFacture(200, "pct", 250)).toEqual({ montant: 200, valeurRetenue: 100, totalTtc: 0 });
  });
  it("le montant fixe est borné au total (jamais de facture négative)", () => {
    expect(calculerRemiseFacture(200, "eur", 500)).toEqual({ montant: 200, valeurRetenue: 200, totalTtc: 0 });
  });
  it("valeur vide, négative ou invalide = pas de remise", () => {
    for (const v of [0, -10, NaN, Infinity]) {
      expect(calculerRemiseFacture(200, "pct", v)).toEqual({ montant: 0, valeurRetenue: 0, totalTtc: 200 });
      expect(calculerRemiseFacture(200, "eur", v)).toEqual({ montant: 0, valeurRetenue: 0, totalTtc: 200 });
    }
  });
  it("base nulle ou négative : aucune remise", () => {
    expect(calculerRemiseFacture(0, "pct", 10).montant).toBe(0);
    expect(calculerRemiseFacture(0, "eur", 10).montant).toBe(0);
    expect(calculerRemiseFacture(-5, "eur", 10).montant).toBe(0);
  });
  it("invariant : total = base − montant, et 0 ≤ montant ≤ base, sur une grille de cas", () => {
    for (const base of [0, 0.01, 19.99, 100, 1234.56]) for (const type of ["pct", "eur"] as const) for (const v of [-1, 0, 0.5, 10, 99.99, 100, 500]) {
      const r = calculerRemiseFacture(base, type, v);
      expect(r.montant).toBeGreaterThanOrEqual(0);
      expect(r.montant).toBeLessThanOrEqual(base + 1e-9);
      expect(r.totalTtc).toBeCloseTo(base - r.montant, 2);
    }
  });
});

describe("remise enregistrée", () => {
  it("montantRemiseFacture ignore les montants nuls ou négligeables", () => {
    expect(montantRemiseFacture({ remise_facture_montant: 12.5 })).toBe(12.5);
    expect(montantRemiseFacture({ remise_facture_montant: 0.004 })).toBe(0);
    expect(montantRemiseFacture({ remise_facture_montant: 0 })).toBe(0);
    expect(montantRemiseFacture({ remise_facture_montant: null })).toBe(0);
    expect(montantRemiseFacture({})).toBe(0);
  });
  it("nettoyerMotifRemise : espaces normalisés, borné à 120 caractères", () => {
    expect(nettoyerMotifRemise("  Geste   commercial\n fidélité ")).toBe("Geste commercial fidélité");
    expect(nettoyerMotifRemise(null)).toBe("");
    expect(nettoyerMotifRemise("x".repeat(500))).toHaveLength(MOTIF_REMISE_MAX);
  });
  it("un motif sans remise n'est jamais affiché", () => {
    expect(motifRemiseFacture({ remise_facture_montant: 0, remise_facture_motif: "Orphelin" })).toBe("");
    expect(motifRemiseFacture({ remise_facture_montant: 10, remise_facture_motif: " Fidélité " })).toBe("Fidélité");
  });
  it("libelleRemiseFacture", () => {
    expect(libelleRemiseFacture({ remise_facture_type: "pct", remise_facture_valeur: 10 })).toBe("Remise exceptionnelle (10 %)");
    expect(libelleRemiseFacture({ remise_facture_type: "pct", remise_facture_valeur: 12.5 })).toBe("Remise exceptionnelle (12,5 %)");
    expect(libelleRemiseFacture({ remise_facture_type: "pct", remise_facture_valeur: 0 })).toBe("Remise exceptionnelle");
    expect(libelleRemiseFacture({ remise_facture_type: "eur", remise_facture_valeur: 25 })).toBe("Remise exceptionnelle");
    expect(libelleRemiseFacture({ remise_facture_type: null, remise_facture_valeur: null })).toBe("Remise exceptionnelle");
  });
});
