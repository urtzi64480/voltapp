import { describe, expect, it } from "vitest";
import { CIRCUITS, type Breaker } from "@/lib/electrical-constants";
import { checkNFC } from "@/lib/nfc-check";
import { assemblerTableauDispose, disposerGroupes, proposerDisposition, resoudreChoix } from "@/lib/disposition-tableau";
import { assemblerTableau } from "@/lib/maison-engine";
import { groupesDeRangee } from "@/lib/electrical-constants";

let n = 5000;
const dj = (circuit: string, amperes = 16): Breaker => ({ id: n++, label: `${circuit}-${n}`, circuit, amperes, type: "1P", customSection: CIRCUITS[circuit]?.section ?? "1.5", pieces: [] });
const maison = (nbPrises: number, nbLum: number): Breaker[] => [
  ...Array.from({ length: nbLum }, () => dj("lumiere", 10)), ...Array.from({ length: nbPrises }, () => dj("prise_16")),
  dj("plaque", 32), dj("four", 20), dj("lave_linge", 20), dj("lave_vaisselle", 20), dj("chauffe_eau", 20),
];

describe("disposition du tableau", () => {
  it("proposition automatique : largeur usuelle, sans alerte de réserve ni de répartition, tous les circuits conservés", () => {
    const bs = maison(4, 3);
    const { rows, disposition, proposition } = assemblerTableauDispose(bs);
    expect([13, 18, 24]).toContain(disposition.modules);
    expect(rows.flatMap(r => r.slots).filter(b => b && !b.type.startsWith("diff"))).toHaveLength(bs.length);
    const ids = checkNFC(rows).warnings.concat(checkNFC(rows).errors).map(m => m.id);
    expect(ids.filter(i => /^(reserve|max8-|one-diff|no-diff)/.test(i))).toEqual([]);
    expect(proposition.nbAlertes).toBe(0);
    rows.forEach(r => groupesDeRangee(r.slots).forEach(g => expect(g.departs.length).toBeLessThanOrEqual(8)));
    expect(rows.some(r => r.slots.some(b => b?.type === "diff-A" || b?.type === "diff-F"))).toBe(true);   // au moins un type A
  });
  it("déterministe", () => {
    const bs = maison(6, 4);
    expect(proposerDisposition(assemblerTableau(bs))).toEqual(proposerDisposition(assemblerTableau(bs)));
  });
  it("« historique » rend exactement les rangées d'avant", () => {
    const bs = maison(4, 3);
    const avant = assemblerTableau(bs);
    const { rows } = assemblerTableauDispose(bs, { largeur: "historique", plusieursId: "auto" });
    expect(rows.map(r => r.slots.length)).toEqual(avant.map(r => r.slots.length));
    expect(rows.every(r => r.modules === undefined)).toBe(true);
  });
  it("largeur imposée : respectée même si la proposition automatique est différente", () => {
    const g = assemblerTableau(maison(4, 3));
    const { disposition, proposition } = resoudreChoix(g, { largeur: 24, plusieursId: false });
    expect(disposition).toEqual({ modules: 24, plusieursId: false });
    expect(proposition.modules).not.toBeNull();
    const rows = disposerGroupes(g, disposition);
    expect(rows).toHaveLength(g.length);
    expect(rows.every(r => r.modules === 24)).toBe(true);
  });
  it("plusieurs différentiels par rail imposé : moins de rails, mêmes circuits", () => {
    const g = assemblerTableau(maison(4, 3));
    const seul = disposerGroupes(g, { modules: 24, plusieursId: false });
    const multi = disposerGroupes(g, { modules: 24, plusieursId: true });
    expect(multi.length).toBeLessThan(seul.length);
    const nb = (rs: typeof seul) => rs.flatMap(r => r.slots).filter(Boolean).length;
    expect(nb(multi)).toBe(nb(seul));
  });
  it("aucun circuit : pas d'erreur, tableau vide", () => {
    const r = assemblerTableauDispose([]);
    expect(r.rows).toEqual([]);
  });
  it("le lot garde l'étiquette « origine plan » (re-poussée sans doublon)", () => {
    expect(assemblerTableauDispose(maison(3, 2)).rows.every(r => r.origine === "plan")).toBe(true);
  });
});
