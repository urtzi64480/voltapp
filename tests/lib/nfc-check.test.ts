import { describe, expect, it } from "vitest";
import { checkNFC, scoreNFC } from "@/lib/nfc-check";
import type { Breaker, BreakerRow } from "@/lib/electrical-constants";

const b = (id: number, o: Partial<Breaker>): Breaker => ({ id, label: "", circuit: "prise_16", amperes: 16, type: "1P", customSection: "1.5", pieces: [], ...o });
const diff = (id: number, type = "diff-A"): Breaker => b(id, { circuit: "general", amperes: 40, type, customSection: "10.0" });
const rows: BreakerRow[] = [
  { id: 1, name: "R1", slots: [diff(1), b(2, { circuit: "lumiere", amperes: 10 }), b(3, { circuit: "plaque", amperes: 32, type: "2P", customSection: "6.0" }), null, null, null, null, null, null] },
  { id: 2, name: "R2", slots: [diff(4, "diff-AC"), b(5, {}), b(6, { circuit: "lave_linge", amperes: 16 }), null, null, null, null, null, null] },
];

describe("scoreNFC", () => {
  it("donne exactement le score du tableau ouvert", () => {
    expect(scoreNFC(rows)).toBe(checkNFC(rows).score);
  });
  it("compte les mêmes alertes que le tableau ouvert (ex. un différentiel AC sous un lave-linge exigeant un type A)", () => {
    const r = checkNFC(rows);
    expect(r.errors.some(e => e.id.startsWith("difftype-"))).toBe(true);
    expect(scoreNFC(rows)).toBeLessThan(100);
  });
  it("ne plante pas sur des données anciennes ou illisibles", () => {
    expect(scoreNFC(null)).toBe(100);
    expect(scoreNFC([])).toBe(100);
    expect(() => scoreNFC([null, 3, { slots: "x" }, { id: 1, name: "R", slots: [{ id: 9, type: "1P", circuit: "lumiere", amperes: 10 }, null] }])).not.toThrow();
  });
});
