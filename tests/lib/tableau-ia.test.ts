import { describe, expect, it } from "vitest";
import {
  analyserManques, appliquerAuTableau, calibreConforme, circuitsDepuisReleve, construireProposition, CONTEXTE_DEFAUT, decider, normaliserReleve,
  nouveauCircuit, usageDepuisEtiquette, type ReleveTableau,
} from "@/lib/tableau-ia";
import type { BreakerRow } from "@/lib/electrical-constants";

const app = (o: Record<string, unknown>) => ({ nature: "disjoncteur", confiance: "haute", ...o });
const releveBrut = (rangees: unknown[], extra: Record<string, unknown> = {}) => ({ photos_exploitables: true, rangees, ...extra });

describe("usageDepuisEtiquette", () => {
  it("reconnaît les étiquettes courantes, accents et abréviations compris", () => {
    expect(usageDepuisEtiquette("Plaque cuisson")).toBe("plaque");
    expect(usageDepuisEtiquette("LL")).toBe("lave_linge");
    expect(usageDepuisEtiquette("Lave-vaisselle")).toBe("lave_vaisselle");
    expect(usageDepuisEtiquette("Sèche-serviette SDB")).toBe("seche_serviette");
    expect(usageDepuisEtiquette("Sèche linge")).toBe("seche_linge");
    expect(usageDepuisEtiquette("Chauffe-eau")).toBe("chauffe_eau");
    expect(usageDepuisEtiquette("Éclairage RDC")).toBe("lumiere");
    expect(usageDepuisEtiquette("Prises salon")).toBe("prises");
    expect(usageDepuisEtiquette("Convecteurs chambres")).toBe("chauffage");
  });
  it("renvoie null quand rien n'est reconnaissable", () => {
    expect(usageDepuisEtiquette("")).toBeNull();
    expect(usageDepuisEtiquette("???")).toBeNull();
  });
});

describe("calibre et section", () => {
  it("garde un calibre conforme, abaisse un calibre trop fort, met le défaut si illisible", () => {
    expect(calibreConforme("lumiere", 10)).toMatchObject({ calibre: 10, modifie: false });
    expect(calibreConforme("lumiere", 20)).toMatchObject({ calibre: 16, modifie: true });
    expect(calibreConforme("four", null)).toMatchObject({ calibre: 20, illisible: true });
  });
  it("abaisse le calibre si le câble observé est trop petit, sinon demande un câble neuf", () => {
    expect(decider("prises", 20, 1.5)).toMatchObject({ calibreA: 16, calibreAbaisseParCable: true, cableANeuf: false });
    expect(decider("lumiere", 16, 1.5)).toMatchObject({ calibreA: 16, cableANeuf: false });
    expect(decider("plaque", 32, 2.5).cableANeuf).toBe(true);
  });
});

describe("normaliserReleve", () => {
  it("ne plante jamais sur une entrée invalide", () => {
    for (const x of [null, undefined, 42, "x", [], {}, { rangees: "oups" }, { rangees: [null, 3, { appareils: "z" }] }]) {
      expect(() => normaliserReleve(x)).not.toThrow();
    }
    expect(normaliserReleve(null).rangees).toEqual([]);
    expect(normaliserReleve(null).photosExploitables).toBe(false);
  });
  it("borne les nombres et remplace les énumérations inconnues", () => {
    const r = normaliserReleve(releveBrut([{ nom: "R1", appareils: [app({ calibre_a: 9999, usage: "fusée", confiance: "sûre", etiquette: "x".repeat(500) })] }]));
    const a = r.rangees[0].appareils[0];
    expect(a.calibreA).toBeNull();
    expect(a.usage).toBe("inconnu");
    expect(a.confiance).toBe("moyenne");
    expect(a.etiquette.length).toBeLessThanOrEqual(120);
  });
  it("un différentiel au milieu d'un rail coupe la rangée en deux", () => {
    const r = normaliserReleve(releveBrut([{ nom: "R1", appareils: [
      app({ nature: "differentiel", calibre_a: 40, sensibilite_ma: 30, type_diff: "AC" }),
      app({ calibre_a: 10, etiquette: "Lumière" }),
      app({ nature: "differentiel", calibre_a: 40, sensibilite_ma: 30, type_diff: "A" }),
      app({ calibre_a: 20, etiquette: "Four" }),
    ] }]));
    expect(r.rangees).toHaveLength(2);
    expect(r.rangees[0].differentiel?.type).toBe("AC");
    expect(r.rangees[1].differentiel?.type).toBe("A");
    expect(r.rangees[1].appareils).toHaveLength(1);
  });
  it("limite le nombre de rangées", () => {
    const r = normaliserReleve(releveBrut(Array.from({ length: 50 }, (_, i) => ({ nom: `R${i}`, appareils: [app({ calibre_a: 16 })] }))));
    expect(r.rangees.length).toBeLessThanOrEqual(12);
  });
});

function releveType(): ReleveTableau {
  return normaliserReleve(releveBrut([
    { nom: "R1", differentiel: { calibre_a: 40, sensibilite_ma: 30, type: "AC" }, appareils: [
      app({ calibre_a: 10, etiquette: "Éclairage" }),
      app({ nature: "fusible", calibre_a: 16, etiquette: "Prises salon" }),
      app({ calibre_a: 25, etiquette: "Lave-linge" }),
    ] },
    { nom: "R2", differentiel: { calibre_a: 40, sensibilite_ma: 300, type: "AC" }, appareils: [
      app({ calibre_a: 32, etiquette: "Plaque" }),
      app({ nature: "telerupteur", etiquette: "Télé" }),
    ] },
  ]));
}

describe("construireProposition", () => {
  it("produit un tableau déterministe, sans étiquette « plan » et avec ids uniques", () => {
    const p = construireProposition(releveType(), [], CONTEXTE_DEFAUT);
    expect(p.nbCircuits).toBe(4);
    const ids = new Set<number>();
    p.rows.forEach(r => { expect(r.origine).toBeUndefined(); expect(ids.has(r.id)).toBe(false); ids.add(r.id); });
    const noms = p.rows.flatMap(r => r.slots.filter(Boolean).map(b => b!.label));
    expect(noms).toEqual(expect.arrayContaining(["Éclairage", "Prises salon", "Lave-linge", "Plaque"]));
    const p2 = construireProposition(releveType(), [], CONTEXTE_DEFAUT);
    expect(p2.rows.map(r => r.slots.map(b => b && [b.circuit, b.amperes]))).toEqual(p.rows.map(r => r.slots.map(b => b && [b.circuit, b.amperes])));
  });
  it("remplace le fusible, corrige le calibre, signale le différentiel 300 mA et le télérupteur", () => {
    const p = construireProposition(releveType(), [], CONTEXTE_DEFAUT);
    const t = p.ecarts.map(e => e.texte).join("\n");
    expect(t).toMatch(/fusible remplacé/i);
    expect(t).toMatch(/25 A → 20 A/);
    expect(t).toMatch(/300 mA/);
    expect(p.nonRepris.join(" ")).toMatch(/télérupteur/i);
    expect(p.aVerifierSurPlace.length).toBeGreaterThan(0);
  });
  it("contient au moins un différentiel de type A (plaque)", () => {
    const p = construireProposition(releveType(), [], CONTEXTE_DEFAUT);
    const types = p.rows.map(r => r.slots[0]?.type);
    expect(types).toContain("diff-A");
  });
  it("pose le parafoudre demandé sans le compter deux fois", () => {
    const p = construireProposition(releveType(), [], { ...CONTEXTE_DEFAUT, parafoudreRequis: true });
    const nb = p.rows.flatMap(r => r.slots).filter(b => b?.circuit === "parafoudre").length;
    expect(nb).toBe(1);
  });
  it("un relevé sans circuit ne plante pas", () => {
    expect(() => construireProposition(normaliserReleve(null), [], CONTEXTE_DEFAUT)).not.toThrow();
  });
  it("écarter un appareil le retire du tableau refait", () => {
    const r = releveType();
    r.rangees[0].appareils[0].ecarte = true;
    expect(circuitsDepuisReleve(r)).toHaveLength(3);
  });
});

describe("analyserManques", () => {
  it("propose l'ajout d'un circuit d'éclairage, mais jamais d'appareil spécialisé", () => {
    const m = analyserManques([{ usage: "prises" }], CONTEXTE_DEFAUT);
    expect(m.find(x => x.id === "eclairage")?.ajout?.usage).toBe("lumiere");
    expect(m.find(x => x.id === "specialises")?.ajout).toBeUndefined();
  });
  it("un studio n'a besoin que d'un circuit d'éclairage", () => {
    expect(analyserManques([{ usage: "lumiere" }], { ...CONTEXTE_DEFAUT, surfaceM2: 25 }).some(x => x.id === "eclairage")).toBe(false);
  });
  it("un ajout manuel est repris dans le tableau", () => {
    const p = construireProposition(releveType(), [{ ...nouveauCircuit("lumiere", "Éclairage 2"), id: 99 }], CONTEXTE_DEFAUT);
    expect(p.nbCircuits).toBe(5);
    expect(p.ecarts.some(e => e.niveau === "ajout")).toBe(true);
  });
});

describe("appliquerAuTableau", () => {
  it("garde le coffret de communication et évite toute collision d'ids", () => {
    const multi: BreakerRow = { id: 7, name: "Communication", kind: "multimedia", slots: [null, null] } as BreakerRow;
    const p = construireProposition(releveType(), [], CONTEXTE_DEFAUT);
    const res = appliquerAuTableau([multi, { id: 8, name: "Ancienne", slots: [null] } as BreakerRow], p.rows);
    expect(res.filter(r => r.kind === "multimedia")).toHaveLength(1);
    expect(res.some(r => r.name === "Ancienne")).toBe(false);
    const ids = res.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    res.forEach(r => expect(r.origine).toBeUndefined());
  });
});
