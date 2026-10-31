import { afterEach, describe, expect, it } from "vitest";
import { reglageAimant } from "@/components/plan/editeur/constantes";
import { alignerSurMurs, arrondiGrille, rectangleDepuis, snapAvecAlignement } from "@/components/plan/editeur/geometrie";

const init = { ...reglageAimant };
afterEach(() => Object.assign(reglageAimant, init));

describe("rectangleDepuis / arrondiGrille", () => {
  it("rectangle à partir de deux coins opposés (quel que soit l'ordre)", () => {
    const attendu = rectangleDepuis({ x: 0, y: 0 }, { x: 4, y: 3 });
    expect(attendu).toHaveLength(4);
    expect(rectangleDepuis({ x: 4, y: 3 }, { x: 0, y: 0 }).map(p => `${p.x},${p.y}`).sort()).toEqual(attendu.map(p => `${p.x},${p.y}`).sort());
  });
  it("grille au centimètre par défaut, pas réglable via l'état partagé du module", () => {
    expect(arrondiGrille(1.2349)).toBe(1.23);
    reglageAimant.pasM = 0.1;
    expect(arrondiGrille(1.26)).toBeCloseTo(1.3, 10);
    expect(arrondiGrille(1.26, 0.5)).toBe(1.5);
  });
});

describe("alignement", () => {
  it("sans mur de référence ni voisin : aucune contrainte", () => {
    expect(alignerSurMurs({ x: 1, y: 1 }, [], [], 0.2)).toBeNull();
  });
  it("aimant désactivé : simple arrondi à la grille, sans guide", () => {
    reglageAimant.aimant = false;
    expect(snapAvecAlignement({ x: 1.003, y: 2 }, [{ x: 1, y: 5 }], 0.2)).toEqual({ point: { x: 1, y: 2 } });
  });
  it("aimant actif : le point s'aligne sur un sommet voisin et expose le guide ; Alt le désactive", () => {
    reglageAimant.aimant = true; reglageAimant.alt = false;
    const r = snapAvecAlignement({ x: 1.05, y: 2 }, [{ x: 1, y: 5 }], 0.2);
    expect(r.point.x).toBe(1);
    expect(r.guideX).toBe(1);
    reglageAimant.alt = true;
    expect(snapAvecAlignement({ x: 1.05, y: 2 }, [{ x: 1, y: 5 }], 0.2).point).toEqual({ x: 1.05, y: 2 }); // Alt : grille au cm seulement, pas d'alignement
  });
});
