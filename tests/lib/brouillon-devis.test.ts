import { describe, expect, it } from "vitest";
import { brouillonVide, ecrireBrouillon, lireBrouillon } from "@/lib/brouillon-devis";

const base = {
  clientId: "c1", apporteurId: "", objet: "Rénovation", validite: 30, postes: ["Salon"],
  lignes: [{ nom: "Prise", prix_unitaire: 12.5, quantite: 3, poste: "Salon" }],
  remise: { service_type: "pct" as const, service_val: "5", materiau_type: "eur" as const, materiau_val: "" }, remiseFidelitePct: 0,
};

describe("brouillon de devis", () => {
  it("aller-retour sans perte", () => {
    const r = lireBrouillon(ecrireBrouillon(base, new Date("2026-11-09T13:00:00Z")))!;
    expect(r).toMatchObject({ clientId: "c1", objet: "Rénovation", validite: 30, postes: ["Salon"], remiseFidelitePct: 0 });
    expect(r.lignes).toEqual(base.lignes);
    expect(r.remise).toEqual(base.remise);
    expect(r.le).toBe("2026-11-09T13:00:00.000Z");
  });
  it("brouillon vide, absent, illisible ou d'une autre version → null (jamais d'erreur)", () => {
    for (const x of [null, undefined, "", "pas du json", "null", "42", "[]", JSON.stringify({ v: 2, objet: "x" })]) expect(lireBrouillon(x as string)).toBeNull();
    expect(lireBrouillon(ecrireBrouillon({ ...base, lignes: [], postes: [], objet: "  " }))).toBeNull();
  });
  it("écarte les lignes invalides et corrige les valeurs aberrantes", () => {
    const brut = JSON.stringify({ v: 1, le: "x", objet: "o", validite: -5, remiseFidelitePct: -3, postes: ["A", "", 3],
      lignes: [{ nom: "ok", prix_unitaire: 1, quantite: 1 }, { nom: 5 }, null, { nom: "sans prix", quantite: 1, prix_unitaire: "abc" }], remise: { service_type: "bizarre" } });
    const r = lireBrouillon(brut)!;
    expect(r.lignes).toHaveLength(1);
    expect(r.validite).toBe(1);
    expect(r.remiseFidelitePct).toBe(0);
    expect(r.postes).toEqual(["A"]);
    expect(r.remise.service_type).toBe("pct");
  });
  it("brouillonVide", () => {
    expect(brouillonVide({ lignes: [], postes: [], objet: "" })).toBe(true);
    expect(brouillonVide({ lignes: [], postes: ["P"], objet: "" })).toBe(false);
  });
});
