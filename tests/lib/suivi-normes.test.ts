import { describe, expect, it } from "vitest";
import { ORDRE_GROUPES, cleEtapeNorme, etapesNormatives, grouperEtapes, type DescripteurNorme } from "@/lib/suivi-normes";

const DESCRIPTEURS: DescripteurNorme[] = [
  { kind: "disjoncteur", amperes: 16, sectionMm2: "1,5", nom: "Prises salon", diffType: "A", maxPar: 8, nbPoints: 6, eclairage: false },
  { kind: "disjoncteur", amperes: 10, sectionMm2: "1,5", nom: "Éclairage", nbPoints: 4, eclairage: true },
  { kind: "boite", eclairage: true },
  { kind: "lampe", type: "lumiere", sdb: false, plafond: true, hauteurCm: 250, commandee: true },
  { kind: "lampe", type: "applique", sdb: true, plafond: false, hauteurCm: 180, commandee: false },
  { kind: "commande", type: "interrupteur", hauteurCm: 105, domotique: false, double: false, detecteur: false, interieur: true },
  { kind: "commande", type: "interrupteur", hauteurCm: 105, domotique: true, double: true, detecteur: false, interieur: true },
  { kind: "commande_service", type: "inter_volet", hauteurCm: 105 },
  { kind: "prise", type: "prise", hauteurCm: 30, amperes: 16, sectionMm2: "1,5", sdb: false },
  { kind: "prise", type: "prise_exterieure", hauteurCm: 30, amperes: 16, sectionMm2: "1,5", sdb: false },
  { kind: "communication", type: "rj45", hauteurCm: 30 },
  { kind: "volet_roulant" },
  { kind: "chauffage", puissanceW: 1500 },
  { kind: "autre", amperes: 20, sectionMm2: "2,5", hauteurCm: 100 },
  { kind: "liaison", communication: false, cable: "H07V-U", gaine: "ICTA", pose: "encastre", sectionMm2: "1,5", amperes: 16 },
  { kind: "liaison", communication: true, cable: "Cat 6", gaine: "ICTA", pose: "encastre", sectionMm2: "", amperes: 0 },
  { kind: "controle", communication: false, eclairage: false, aPrises: true, sdb: true, irve: false },
  { kind: "controle", communication: true, eclairage: false, aPrises: false, sdb: false, irve: false },
] as unknown as DescripteurNorme[];

describe("etapesNormatives", () => {
  it.each(DESCRIPTEURS.map((d, i) => [i, d] as const))("descripteur #%i : étapes valides, slugs uniques", (_i, d) => {
    const etapes = etapesNormatives(d);
    expect(etapes.length).toBeGreaterThan(0);
    const slugs = etapes.map(x => x.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const x of etapes) {
      expect(ORDRE_GROUPES).toContain(x.groupe);
      expect(x.libelle.trim().length).toBeGreaterThan(0);
      expect(x.slug).toMatch(/^[a-z0-9_-]+$/);
    }
  });
  it("déterministe : mêmes entrées → mêmes slugs (les coches restent valables)", () => {
    for (const d of DESCRIPTEURS) expect(etapesNormatives(d).map(x => x.slug)).toEqual(etapesNormatives(d).map(x => x.slug));
  });
  it("le disjoncteur cite son calibre et sa section", () => {
    const t = etapesNormatives(DESCRIPTEURS[0]).map(x => x.libelle).join(" ");
    expect(t).toContain("16 A");
    expect(t).toContain("1,5");
  });
});

describe("clés et groupes", () => {
  it("cleEtapeNorme ne peut pas entrer en collision avec une clé principale", () => {
    expect(cleEtapeNorme("a|3|pose", "terre")).toBe("a|3|pose|n:terre");
    expect(cleEtapeNorme("a|3|pose", "terre")).not.toBe("a|3|pose");
  });
  it("grouperEtapes respecte l'ordre des groupes et ignore les groupes vides", () => {
    const g = grouperEtapes([{ groupe: "controle" as const }, { groupe: "preparation" as const }, { groupe: "controle" as const }]);
    expect(g.map(x => x.groupe)).toEqual(["preparation", "controle"]);
    expect(g[1].etapes).toHaveLength(2);
  });
});
