import { describe, expect, it } from "vitest";
import {
  groupesDeRangee, largeurAppareil, modulesRangee, nbCasesRangee, poserAppareil, redimensionnerRangee, emplacementsLibresRangee, agencerAppareils,
  type Breaker, type BreakerRow,
} from "@/lib/electrical-constants";
import { checkNFC } from "@/lib/nfc-check";
import { calculerTableauReel } from "@/lib/tableau-reel";
import { CONTEXTE_DEFAUT, construireProposition, emballerEnRails, normaliserReleve, type ContexteTableau } from "@/lib/tableau-ia";

let n = 1;
const diff = (type: "diff-AC" | "diff-A" = "diff-A", amperes = 40): Breaker => ({ id: n++, label: "", circuit: "general", amperes, type, customSection: "10.0", pieces: [] });
const disj = (circuit = "prise_16", amperes = 16, label = ""): Breaker => ({ id: n++, label, circuit, amperes, type: "1P", customSection: "1.5", pieces: [] });
const rangee = (cases: number, poses: [number, Breaker][], modules?: number): BreakerRow => {
  const slots: (Breaker | null)[] = Array(cases).fill(null);
  poses.forEach(([i, b]) => { slots[i] = b; });
  return { id: n++, name: "R1", slots, ...(modules ? { modules } : {}) };
};

describe("largeur d'un différentiel", () => {
  it("2 emplacements hors case de tête ; disjoncteur : 1", () => {
    expect(largeurAppareil(diff())).toBe(2);
    expect(largeurAppareil(disj())).toBe(1);
  });
  it("un 2e différentiel se pose s'il y a 2 emplacements libres côte à côte, pas sinon", () => {
    const r = rangee(12, [[0, diff()], [1, disj()], [11, disj()]], 13);
    expect(poserAppareil(r.slots, 4, diff("diff-AC"), false)).not.toBeNull();
    expect(poserAppareil(r.slots, 10, diff("diff-AC"), false)).toBeNull();     // 10 + 11 : 11 est pris
    expect(poserAppareil(r.slots, 11, diff("diff-AC"), false)).toBeNull();     // déborde du rail
  });
  it("les rangées historiques (9 cases) gardent leurs 8 emplacements", () => {
    const r = rangee(9, [[0, diff()]]);
    expect(emplacementsLibresRangee(r.slots)).toBe(8);
    expect(modulesRangee(r.slots)).toBe(10);
  });
});

describe("rails de 13, 18 et 24 modules", () => {
  it("nombre de cases : 1 de tête + (modules − 2) emplacements", () => {
    expect([13, 18, 24].map(nbCasesRangee)).toEqual([12, 17, 23]);
    expect(nbCasesRangee(undefined)).toBe(9);
  });
  it("agrandir ajoute des emplacements libres ; réduire n'est permis que s'ils sont vides", () => {
    const r = rangee(9, [[0, diff()], [1, disj()], [8, disj()]]);
    const g = redimensionnerRangee(r, 24)!;
    expect(g.modules).toBe(24);
    expect(g.slots).toHaveLength(23);
    expect(g.slots[8]).toBe(r.slots[8]);
    expect(redimensionnerRangee(g, 13)!.slots).toHaveLength(12);                  // le disjoncteur en case 8 tient encore dans 13 modules (11 emplacements)
  });
  it("réduction refusée si un appareil occupe un emplacement retiré, acceptée sinon", () => {
    const plein = rangee(23, [[0, diff()], [20, disj()]], 24);
    expect(redimensionnerRangee(plein, 13)).toBeNull();
    const vide = rangee(23, [[0, diff()], [3, disj()]], 24);
    const petit = redimensionnerRangee(vide, 13)!;
    expect(petit.slots).toHaveLength(12);
    expect(petit.slots[3]).toBe(vide.slots[3]);
  });
  it("valeur hors 13/18/24 et coffret de communication : null", () => {
    expect(redimensionnerRangee(rangee(9, [[0, diff()]]), 15)).toBeNull();
    expect(redimensionnerRangee({ ...rangee(8, []), kind: "multimedia" }, 13)).toBeNull();
  });
});

describe("plusieurs différentiels sur une rangée", () => {
  const deuxId = () => {
    const d1 = diff("diff-A"), d2 = diff("diff-AC");
    const r = rangee(23, [[0, d1], [1, disj("lumiere", 10)], [2, disj("plaque", 32)], [3, d2], [5, disj("prise_16")], [6, disj("prise_16")]], 24);
    return { r, d1, d2 };
  };
  it("groupesDeRangee : chaque ID protège les départs à sa droite", () => {
    const { r, d1, d2 } = deuxId();
    const g = groupesDeRangee(r.slots);
    expect(g).toHaveLength(2);
    expect(g[0].diff).toBe(d1); expect(g[0].departs.map(d => d.idx)).toEqual([1, 2]);
    expect(g[1].diff).toBe(d2); expect(g[1].diffIdx).toBe(3); expect(g[1].departs.map(d => d.idx)).toEqual([5, 6]);
  });
  it("une rangée sans différentiel de tête : premier groupe sans ID", () => {
    const g = groupesDeRangee(rangee(12, [[1, disj()]]).slots);
    expect(g[0].diff).toBeNull();
    expect(g[0].departs).toHaveLength(1);
  });
  it("checkNFC : 2 ID sur une rangée comptent (pas d'erreur « un seul différentiel »), 8 circuits maxi par ID", () => {
    const { r } = deuxId();
    const res = checkNFC([r]);
    expect(res.errors.map(e => e.id)).not.toContain("one-diff");
    expect(res.errors.map(e => e.id)).not.toContain("no-diff");
    // 9 départs sous le 2e ID → erreur propre à ce groupe
    const lourd = rangee(23, [[0, diff()], [1, disj()], [3, diff("diff-AC")], ...Array.from({ length: 9 }, (_, k) => [5 + k, disj()] as [number, Breaker])], 24);
    const ids = checkNFC([lourd]).errors.map(e => e.id);
    expect(ids.some(i => i.startsWith("max8-") && i.endsWith("-g1"))).toBe(true);
    expect(ids.some(i => i.startsWith("max8-") && !i.endsWith("-g1"))).toBe(false);
  });
  it("checkNFC : un différentiel supplémentaire n'est jamais pris pour un circuit ni pour une rangée « équipée »", () => {
    const seul = rangee(12, [[0, diff()], [1, diff("diff-AC")]], 13);
    expect(checkNFC([seul]).warnings.map(w => w.id)).toContain("rangee-vide");
  });
  it("checkNFC : la réserve se calcule sur les emplacements du rail choisi", () => {
    const plein = rangee(12, [[0, diff()], ...Array.from({ length: 8 }, (_, k) => [1 + k, disj()] as [number, Breaker])], 13);   // 8/11 utilisés → 3 libres (27 %)
    expect(checkNFC([plein, { ...plein, id: n++ }]).warnings.map(w => w.id)).not.toContain("reserve");
  });
  it("calculerTableauReel : modules de chaque ID comptés, capacité = largeur du rail, coffret = rail le plus large", () => {
    const { r } = deuxId();
    const petite = rangee(12, [[0, diff()], [1, disj()]], 13);
    const res = calculerTableauReel([r, petite], {});
    const rail = res.rails[0];
    expect(rail.capaciteModules).toBe(24);
    expect(rail.idsSupplementaires).toHaveLength(1);
    expect(rail.idsSupplementaires[0]).toMatchObject({ positionModule: 2 + 2, modules: 2 });   // après tête (2) + 2 départs
    expect(rail.modulesUtilises).toBe(2 + 2 + 2 + 2);
    expect(res.rails[1].capaciteModules).toBe(13);
    expect(res.coffret.modulesParRail).toBe(24);
    expect(res.totaux.differentiels).toBe(3);
  });
  it("calculerTableauReel : le type exigé se contrôle sur l'ID qui protège le départ, et les 8 circuits par ID", () => {
    const plaque = disj("plaque", 32);
    const r = rangee(23, [[0, diff("diff-A")], [1, disj("lumiere", 10)], [2, diff("diff-AC")], [4, plaque]], 24);
    const ids = calculerTableauReel([r], {}).controles.map(c => c.id);
    expect(ids).toContain(`type-${plaque.id}`);                 // plaque (type A) sous l'ID AC
    const ok = rangee(23, [[0, diff("diff-AC")], [1, disj("lumiere", 10)], [2, diff("diff-A")], [4, plaque]], 24);
    expect(calculerTableauReel([ok], {}).controles.map(c => c.id)).not.toContain(`type-${plaque.id}`);
  });
  it("une rangée enregistrée sans modules garde le réglage général du coffret", () => {
    const res = calculerTableauReel([rangee(9, [[0, diff()], [1, disj()]])], { params: { modulesParRail: 18 } });
    expect(res.rails[0].capaciteModules).toBe(18);
  });
  it("agencerAppareils : un différentiel posé à l'étroit (ancienne donnée) est poussé sans rien perdre", () => {
    const d = diff("diff-AC");
    const slots: (Breaker | null)[] = [diff(), disj(), d, disj(), null, null, null, null, null];
    const { slots: out, debordement } = agencerAppareils(slots, false);
    expect(debordement).toHaveLength(0);
    expect(out.filter(Boolean)).toHaveLength(4);
    expect(out.indexOf(d)).toBe(2);
    expect(out[3]).toBeNull();                       // 2e module du différentiel
  });
});

const releve = () => normaliserReleve({
  photos_exploitables: true,
  rangees: [
    { nom: "R1", differentiel: { calibreA: 40, sensibiliteMa: 30, type: "A", confiance: "haute" }, appareils: [
      { nature: "disjoncteur", usage: "lumiere", etiquette: "Lumière", calibreA: 10 }, { nature: "disjoncteur", usage: "plaque", etiquette: "Plaque", calibreA: 32 },
      { nature: "disjoncteur", usage: "prises", etiquette: "Prises", calibreA: 16 }] },
    { nom: "R2", differentiel: { calibreA: 40, sensibiliteMa: 30, type: "AC", confiance: "haute" }, appareils: [
      { nature: "disjoncteur", usage: "prises", etiquette: "Prises 2", calibreA: 16 }, { nature: "disjoncteur", usage: "chauffe_eau", etiquette: "CE", calibreA: 20 }] },
  ],
});

describe("mode IA : rails et plusieurs différentiels", () => {
  const ctx = (o: Partial<ContexteTableau> = {}): ContexteTableau => ({ ...CONTEXTE_DEFAUT, ...o });
  it("par défaut : comportement inchangé (une rangée par différentiel, pas de largeur imposée)", () => {
    const p = construireProposition(releve(), [], ctx());
    expect(p.rows.every(r => r.modules === undefined && r.slots.length === 9)).toBe(true);
  });
  it("largeur imposée : toutes les rangées reçoivent 13/18/24 modules et leurs cases", () => {
    for (const m of [13, 18, 24] as const) {
      const p = construireProposition(releve(), [], ctx({ modulesParRail: m }));
      expect(p.params.modulesParRail).toBe(m);
      expect(p.rows.every(r => r.modules === m && r.slots.length === nbCasesRangee(m))).toBe(true);
      expect(p.rows.flatMap(r => r.slots).filter(b => b && !b.type.startsWith("diff")).length).toBe(5);
    }
  });
  it("plusieurs ID par rangée : les groupes sont rangés côte à côte, sans perdre un appareil ni dépasser 8 départs par ID", () => {
    const sans = construireProposition(releve(), [], ctx({ modulesParRail: 24 }));
    const avec = construireProposition(releve(), [], ctx({ modulesParRail: 24, plusieursDifferentielsParRangee: true }));
    expect(avec.rows.length).toBeLessThan(sans.rows.length);
    const tous = (p: typeof avec) => p.rows.flatMap(r => r.slots).filter(Boolean).map(b => b!.id).length;
    expect(tous(avec)).toBe(tous(sans));
    avec.rows.forEach(r => groupesDeRangee(r.slots).forEach(g => expect(g.departs.length).toBeLessThanOrEqual(8)));
    expect(avec.resApres.totaux.differentiels).toBe(sans.resApres.totaux.differentiels);
    expect(avec.resApres.rails.some(rl => rl.idsSupplementaires.length > 0)).toBe(true);
  });
  it("auto + plusieurs ID : choisit une largeur usuelle et garde la réserve", () => {
    const p = construireProposition(releve(), [], ctx({ plusieursDifferentielsParRangee: true }));
    expect([13, 18, 24]).toContain(p.params.modulesParRail);
    expect(p.rows.every(r => r.modules === p.params.modulesParRail)).toBe(true);
    expect(p.resApres.controles.some(c => c.id === "reserve" || c.id.startsWith("depasse-"))).toBe(false);
  });
  it("emballerEnRails : un groupe qui ne tient pas ouvre un nouveau rail", () => {
    const groupe = (nb: number): BreakerRow => rangee(9, [[0, diff()], ...Array.from({ length: nb }, (_, k) => [1 + k, disj()] as [number, Breaker])]);
    const rails = emballerEnRails([groupe(8), groupe(8), groupe(2)], 24);   // 2+8 = 10 modules ; 10 + 10 = 20 ≤ 24 ; + 4 = 24 → tient aussi
    expect(rails).toHaveLength(1);
    const deux = emballerEnRails([groupe(8), groupe(8), groupe(8)], 24);     // 30 modules > 24
    expect(deux).toHaveLength(2);
    expect(emballerEnRails([groupe(8), groupe(8)], 13)).toHaveLength(2);
  });
  it("un relevé vide ne plante pas avec ces options", () => {
    expect(() => construireProposition(normaliserReleve(null), [], ctx({ modulesParRail: 24, plusieursDifferentielsParRangee: true }))).not.toThrow();
  });
});
