import { describe, expect, it } from "vitest";
import { calculerBesoinsTableau } from "@/lib/predevis-engine";
import { type Breaker, type BreakerRow } from "@/lib/electrical-constants";

let n = 9000;
const brk = (circuit: string, amperes: number, type = "1P"): Breaker => ({ id: n++, label: `${circuit}${n}`, circuit, amperes, type, customSection: "1.5", pieces: [] });
const diff = (): Breaker => brk("general", 40, "diff-A");
const rail = (nbDepartsSurRail: number, modules?: number): BreakerRow => {
  const slots: (Breaker | null)[] = Array(modules ? modules - 1 : 9).fill(null);
  slots[0] = diff();
  for (let i = 0; i < nbDepartsSurRail; i++) slots[1 + i] = brk("prise_16", 16);
  return { id: n++, name: "R", slots, ...(modules ? { modules } : {}) };
};
const parCode = (rows: BreakerRow[]) => Object.fromEntries(calculerBesoinsTableau(rows).besoins.map(b => [b.cle, b.quantite]));
const CODES_SUPPRIMES = ["kit_gtl", "panneau_controle_gtl", "moulure_gtl", "boitier_derivation_gtl", "plastron_tableau", "peigne_tableau", "bornier_terre_tableau",
  "bornier_neutre_tableau", "obturateur_module", "liaison_abonne_10mm", "etiquettes_tableau", "barrette_terre_principale", "liaison_equipotentielle_6mm", "visserie_gtl"];

describe("pré-devis GTL / tableau : coffret, porte, goulotte GTL", () => {
  it("rangées historiques (13 modules) : codes d'avant, porte à part, une goulotte par rangée", () => {
    const q = parCode([rail(4), rail(3), rail(2)]);
    expect(q["coffret_tableau_3r"]).toBe(1);
    expect(q["porte_tableau_3r"]).toBe(1);
    expect(q["goulotte_tableau"]).toBe(3);
    CODES_SUPPRIMES.forEach(c => expect(q[c]).toBeUndefined());
  });
  it("plus de 4 rangées : blocs de 4 + reste, la porte suit chaque coffret", () => {
    const q = parCode(Array.from({ length: 6 }, () => rail(2)));
    expect(q["coffret_tableau_4r"]).toBe(1);
    expect(q["coffret_tableau_2r"]).toBe(1);
    expect(q["porte_tableau_4r"]).toBe(1);
    expect(q["porte_tableau_2r"]).toBe(1);
    expect(q["goulotte_tableau"]).toBe(6);
    const huit = parCode(Array.from({ length: 8 }, () => rail(1)));
    expect(huit["coffret_tableau_4r"]).toBe(2);
    expect(huit["porte_tableau_4r"]).toBe(2);
  });
  it("rails de 18 ou 24 modules : références à la bonne largeur (le rail le plus large décide)", () => {
    const q24 = parCode([rail(6, 24), rail(3, 13)]);
    expect(q24["coffret_tableau_2r_24m"]).toBe(1);
    expect(q24["porte_tableau_2r_24m"]).toBe(1);
    expect(q24["coffret_tableau_2r"]).toBeUndefined();
    const q18 = parCode([rail(5, 18)]);
    expect(q18["coffret_tableau_1r_18m"]).toBe(1);
    expect(q18["porte_tableau_1r_18m"]).toBe(1);
  });
  it("plusieurs différentiels sur un rail : une seule rangée de coffret, tous les différentiels chiffrés", () => {
    const r = rail(2, 24);
    r.slots[5] = brk("general", 40, "diff-AC");
    r.slots[7] = brk("prise_16", 16);
    const q = parCode([r]);
    expect(q["coffret_tableau_1r_24m"]).toBe(1);
    expect(q["goulotte_tableau"]).toBe(1);
    expect(q["differentiel_40A_A"]).toBe(1);
    expect(q["differentiel_40A_AC"]).toBe(1);
    expect(q["disjoncteur_16A"]).toBe(3);
  });
  it("le coffret de communication ne compte pas comme une rangée de tableau", () => {
    const com: BreakerRow = { id: n++, name: "Communication", kind: "multimedia", slots: [brk("rj45", 0, "rj45"), null, null, null, null, null, null, null] };
    const q = parCode([rail(3), com]);
    expect(q["coffret_tableau_1r"]).toBe(1);
    expect(q["goulotte_tableau"]).toBe(1);
    expect(q["coffret_communication"]).toBe(1);
  });
  it("tableau vide : rien d'inventé", () => {
    expect(calculerBesoinsTableau([]).besoins).toEqual([]);
  });
});
