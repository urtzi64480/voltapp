import { describe, expect, it } from "vitest";
import { extrairePostes, grouperParPoste, memeNomPoste, nettoyerNomPoste, ordonnerLignes, posteDe, totalItems, trierParOrdre } from "@/lib/postes";

describe("noms de postes", () => {
  it("nettoyerNomPoste / memeNomPoste ignorent casse et espaces multiples", () => {
    expect(nettoyerNomPoste("  Pose   prise ")).toBe("Pose prise");
    expect(memeNomPoste("Pose prise", "pose  PRISE")).toBe(true);
    expect(memeNomPoste("Pose prise", "Pose interrupteur")).toBe(false);
  });
  it("posteDe : vide = hors poste (null)", () => {
    expect(posteDe({ poste: "   " })).toBeNull();
    expect(posteDe({ poste: null })).toBeNull();
    expect(posteDe({})).toBeNull();
    expect(posteDe({ poste: " Salon " })).toBe("Salon");
  });
  it("extrairePostes : distincts, dans l'ordre d'apparition", () => {
    expect(extrairePostes([{ poste: "A" }, { poste: null }, { poste: "B" }, { poste: "A" }])).toEqual(["A", "B"]);
  });
});

describe("trierParOrdre", () => {
  it("trie par ordre, stable à égalité", () => {
    const l = [{ id: "c", ordre: 2 }, { id: "a", ordre: 0 }, { id: "b", ordre: 0 }];
    expect(trierParOrdre(l).map(x => x.id)).toEqual(["a", "b", "c"]);
  });
  it("sans ordre sur une ligne : l'ordre d'origine est conservé", () => {
    const l = [{ id: "c", ordre: 2 }, { id: "a", ordre: undefined }];
    expect(trierParOrdre(l)).toBe(l);
  });
});

describe("grouperParPoste", () => {
  const lignes = [
    { id: 0, poste: "Pose  prise" }, { id: 1, poste: null }, { id: 2, poste: "pose prise" }, { id: 3, poste: "Autre" },
  ];
  it("regroupe sans tenir compte de la casse ; hors poste à la fin ; garde l'index d'origine", () => {
    const blocs = grouperParPoste(lignes);
    expect(blocs.map(b => b.poste)).toEqual(["Pose  prise", "Autre", null]);
    expect(blocs[0].items.map(x => x.i)).toEqual([0, 2]);
    expect(blocs[2].items.map(x => x.i)).toEqual([1]);
  });
  it("respecte l'ordre des postes fourni, et peut inclure les postes vides", () => {
    const blocs = grouperParPoste(lignes, { postes: ["Autre", "Vide", "Pose prise"], inclureVides: true });
    expect(blocs.map(b => b.poste)).toEqual(["Autre", "Vide", "Pose prise", null]);
    expect(blocs[1].items).toEqual([]);
    expect(grouperParPoste(lignes, { postes: ["Vide"] }).some(b => b.poste === "Vide")).toBe(false);
  });
  it("ne perd ni ne duplique aucune ligne", () => {
    const n = grouperParPoste(lignes).flatMap(b => b.items).length;
    expect(n).toBe(lignes.length);
  });
  it("ordonnerLignes met à plat dans l'ordre d'affichage", () => {
    expect(ordonnerLignes(lignes, ["Autre"]).map(l => l.id)).toEqual([3, 0, 2, 1]);
  });
  it("totalItems = Σ prix × quantité", () => {
    expect(totalItems([{ l: { quantite: 2, prix_unitaire: 5 } }, { l: { quantite: 1, prix_unitaire: 0.5 } }])).toBe(10.5);
  });
});
