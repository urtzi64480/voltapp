import { describe, expect, it } from "vitest";
import { reporterChoix } from "@/lib/predevis-mode";

describe("reporterChoix", () => {
  const anciens = [{ cle: "prise@p1", sousCategorie: "prise" }, { cle: "prise@p2", sousCategorie: "prise" }, { cle: "spot@p1", sousCategorie: "spot" }, { cle: "spot@p2", sousCategorie: "spot" }];
  const nouveaux = [{ cle: "prise@c1", sousCategorie: "prise" }, { cle: "spot@c1", sousCategorie: "spot" }, { cle: "dcl@c1", sousCategorie: "dcl" }];
  it("reporte le choix commun à tous les anciens besoins d'une sous-catégorie", () => {
    const choix = { "prise@p1": { a: 2 }, "prise@p2": { a: 2 }, "spot@p1": { a: 1 }, "spot@p2": { a: 3 } };
    const r = reporterChoix(anciens, choix, nouveaux);
    expect(r["prise@c1"]).toEqual({ a: 2 });
    expect(r["spot@c1"]).toBeUndefined();   // choix différents selon la pièce : on ne devine pas
    expect(r["dcl@c1"]).toBeUndefined();    // aucun équivalent
  });
  it("ne plante pas sur des entrées vides", () => {
    expect(reporterChoix([], {}, nouveaux)).toEqual({});
    expect(reporterChoix(anciens, {}, [])).toEqual({});
  });
});
