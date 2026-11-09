import { describe, expect, it } from "vitest";
import { deplacerElement, grouperParPoste, ordonnerLignes, placerLigne } from "@/lib/postes";

type L = { nom: string; poste?: string | null };
const L = (nom: string, poste: string | null = null): L => ({ nom, poste });
const noms = (t: L[]) => t.map(x => x.nom);

describe("deplacerElement", () => {
  it("déplace et garde tous les éléments", () => {
    expect(deplacerElement(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(deplacerElement(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
  });
  it("cas limites : même référence", () => {
    const t = ["a", "b"];
    expect(deplacerElement(t, 1, 1)).toBe(t);
    expect(deplacerElement(t, -1, 0)).toBe(t);
    expect(deplacerElement(t, 0, 5)).toBe(t);
    expect(deplacerElement([], 0, 0)).toEqual([]);
  });
});

describe("placerLigne", () => {
  const base = [L("a1", "A"), L("a2", "A"), L("b1", "B"), L("b2", "B"), L("h1")];
  it("réordonne dans le poste", () => {
    expect(noms(placerLigne(base, 0, "A", 1))).toEqual(["a2", "a1", "b1", "b2", "h1"]);
    expect(noms(placerLigne(base, 1, "A", 0))).toEqual(["a2", "a1", "b1", "b2", "h1"]);
  });
  it("change de poste à la position voulue, met à jour le poste", () => {
    const r = placerLigne(base, 0, "B", 1);
    expect(noms(r)).toEqual(["a2", "b1", "a1", "b2", "h1"]);
    expect(r.find(x => x.nom === "a1")?.poste).toBe("B");
    expect(noms(placerLigne(base, 0, "B", 0))).toEqual(["a2", "a1", "b1", "b2", "h1"]);
  });
  it("à la fin d'un poste (position au-delà) et vers un poste vide", () => {
    expect(noms(placerLigne(base, 0, "B", 99))).toEqual(["a2", "b1", "b2", "a1", "h1"]);
    const r = placerLigne(base, 4, "C", 0);
    expect(r.find(x => x.nom === "h1")?.poste).toBe("C");
    expect(r).toHaveLength(5);
  });
  it("vers « hors poste »", () => {
    const r = placerLigne(base, 2, null, 0);
    expect(r.find(x => x.nom === "b1")?.poste).toBeNull();
    expect(grouperParPoste(r).map(b => [b.poste, b.items.map(x => x.l.nom)])).toEqual([["A", ["a1", "a2"]], ["B", ["b2"]], [null, ["b1", "h1"]]]);
  });
  it("nom de poste insensible à la casse / espaces ; index invalide ; non mutation", () => {
    const copie = JSON.parse(JSON.stringify(base));
    const r = placerLigne(base, 0, " b ", 0);
    expect(r.find(x => x.nom === "a1")?.poste).toBe("b");
    expect(grouperParPoste(r).map(b => b.poste)).toEqual(["A", "b", null]); // « b » et « B » = même poste (nom de la première occurrence)
    expect(grouperParPoste(r).find(b => b.poste === "b")?.items.map(x => x.l.nom)).toEqual(["a1", "b1", "b2"]);
    expect(placerLigne(base, 9, "A", 0)).toBe(base);
    expect(base).toEqual(copie);
  });
  it("l'ordre enregistré (ordonnerLignes) suit le glisser-déposer", () => {
    const r = placerLigne(base, 2, "A", 0); // b1 en tête de A
    expect(noms(ordonnerLignes(r, ["B", "A"]))).toEqual(["b2", "b1", "a1", "a2", "h1"]);
  });
});

import { clePoste } from "@/lib/postes";
describe("clePoste", () => {
  it("insensible à la casse et aux espaces", () => { expect(clePoste("  Pose  Prise ")).toBe(clePoste("pose prise")); expect(clePoste("A")).not.toBe(clePoste("B")); });
});
