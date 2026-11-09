import { describe, expect, it } from "vitest";
import { estTermine, separerChantiers, type ChantierListe } from "@/lib/suivi-liste";

const c = (key: string, fait: number, total: number, date: string, valideLe: string | null = null): ChantierListe => ({
  key, type: "plan", href: "/x", titre: key, sousTitre: "", valideLe, date,
  progression: total === 0 && fait === 0 && key === "vide" ? null : { fait, total, pct: total ? Math.round((fait / total) * 100) : 0 },
});

describe("suivi-liste", () => {
  it("terminé = validé ou 100 % (jamais un chantier sans étape)", () => {
    expect(estTermine(c("a", 5, 5, "2026-01-01"))).toBe(true);
    expect(estTermine(c("b", 2, 5, "2026-01-01", "2026-02-01"))).toBe(true);
    expect(estTermine(c("c", 0, 0, "2026-01-01"))).toBe(false);
    expect(estTermine(c("vide", 0, 0, "2026-01-01"))).toBe(false);
  });
  it("en cours : le plus avancé d'abord ; terminés : le plus récent d'abord", () => {
    const { enCours, termines } = separerChantiers([
      c("peu", 1, 10, "2026-03-01"), c("beaucoup", 8, 10, "2026-01-01"), c("vide", 0, 0, "2026-05-01"),
      c("fini-vieux", 4, 4, "2026-01-01"), c("fini-recent", 4, 4, "2026-06-01"),
    ]);
    expect(enCours.map(x => x.key)).toEqual(["beaucoup", "peu", "vide"]);
    expect(termines.map(x => x.key)).toEqual(["fini-recent", "fini-vieux"]);
  });
  it("liste vide", () => { expect(separerChantiers([])).toEqual({ enCours: [], termines: [] }); });
});
