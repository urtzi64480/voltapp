import { beforeEach, describe, expect, it, vi } from "vitest";

// Faux Supabase en mémoire : une table `projets` avec la colonne suivi_realisation (lecture-modification-écriture).
const base = vi.hoisted(() => ({ projets: {} as Record<string, { suivi_realisation: string | null }>, erreurLecture: null as string | null, erreurEcriture: null as string | null, nbEcritures: 0 }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (_t: string) => ({
      select: () => ({ eq: (_c: string, id: string) => ({ single: async () => base.erreurLecture ? { data: null, error: { message: base.erreurLecture } } : { data: base.projets[id] ?? null, error: base.projets[id] ? null : { message: "introuvable" } } }) }),
      update: (patch: { suivi_realisation: string | null }) => ({ eq: async (_c: string, id: string) => {
        if (base.erreurEcriture) return { error: { message: base.erreurEcriture } };
        base.nbEcritures++; base.projets[id] = { suivi_realisation: patch.suivi_realisation }; return { error: null };
      } }),
    }),
  },
}));

import {
  appliquerCoches, definirChantier, definirTemps, formaterMinutes, lireCoches, lireSuivi, minutesDepuisTexte, modifierSuivi, relireCoches,
  relireSuivi, retirerCoches,
} from "@/lib/suivi-persistance";

beforeEach(() => { base.projets = { p1: { suivi_realisation: null } }; base.erreurLecture = null; base.erreurEcriture = null; base.nbEcritures = 0; });

describe("lireSuivi", () => {
  const vide = { coches: {}, chantier: {}, temps: {}, tempsPostes: {} };
  it("valeurs absentes, JSON invalide ou de mauvais type → suivi vide", () => {
    for (const r of [null, undefined, "", "pas du json", "null", "42", "[]"]) expect(lireSuivi(r as string)).toEqual(vide);
  });
  it("filtre les entrées invalides et arrondit les minutes", () => {
    const raw = JSON.stringify({ v: 1, coches: { a: "2026-10-01", b: 5 }, chantier: { valide_le: "2026-10-02", devis_id: 3 }, temps: { c1: 90.4, c2: -5, c3: "x", c4: 0 }, tempsPostes: { Salon: 30 } });
    expect(lireSuivi(raw)).toEqual({ coches: { a: "2026-10-01" }, chantier: { valide_le: "2026-10-02" }, temps: { c1: 90 }, tempsPostes: { Salon: 30 } });
  });
  it("lireCoches", () => { expect(lireCoches(JSON.stringify({ v: 1, coches: { x: "d" } }))).toEqual({ x: "d" }); });
});

describe("lecture-modification-écriture", () => {
  it("deux appareils : chaque écriture part de la valeur RELUE, rien n'est écrasé", async () => {
    await appliquerCoches("p1", ["a"], true, "2026-10-01");
    // « l'autre appareil » écrit entre-temps directement en base
    base.projets.p1 = { suivi_realisation: JSON.stringify({ v: 1, coches: { a: "2026-10-01", b: "2026-10-02" } }) };
    const r = await appliquerCoches("p1", ["c"], true, "2026-10-03");
    expect(r.ok && r.coches).toEqual({ a: "2026-10-01", b: "2026-10-02", c: "2026-10-03" });
  });
  it("cocher une clé déjà cochée conserve la date d'origine ; décocher la supprime", async () => {
    await appliquerCoches("p1", ["a"], true, "D1");
    await appliquerCoches("p1", ["a", "b"], true, "D2");
    expect(await relireCoches("p1")).toEqual({ a: "D1", b: "D2" });
    await retirerCoches("p1", ["a"]);
    expect(await relireCoches("p1")).toEqual({ b: "D2" });
  });
  it("suivi entièrement vidé → colonne remise à null (pas de JSON vide)", async () => {
    await appliquerCoches("p1", ["a"], true, "D");
    await retirerCoches("p1", ["a"]);
    expect(base.projets.p1.suivi_realisation).toBeNull();
  });
  it("temps : >0 enregistre (arrondi), 0 efface ; circuits et postes séparés", async () => {
    await definirTemps("p1", "temps", "c1", 90.6);
    await definirTemps("p1", "tempsPostes", "Salon", 20);
    expect((await relireSuivi("p1"))).toMatchObject({ temps: { c1: 91 }, tempsPostes: { Salon: 20 } });
    await definirTemps("p1", "temps", "c1", 0);
    expect((await relireSuivi("p1"))?.temps).toEqual({});
  });
  it("chantier : fusion partielle, valeurs vides retirées", async () => {
    await definirChantier("p1", { valide_le: "2026-10-05", devis_id: "d1" });
    await definirChantier("p1", { valide_le: "" });
    expect((await relireSuivi("p1"))?.chantier).toEqual({ devis_id: "d1" });
  });
  it("modifierSuivi est idempotent pour une même opération rejouée", async () => {
    const op = () => modifierSuivi("p1", s => { s.coches.x = "D"; });
    await op(); const apres1 = base.projets.p1.suivi_realisation;
    await op();
    expect(base.projets.p1.suivi_realisation).toBe(apres1);
  });
});

describe("erreurs", () => {
  it("lecture en échec : aucune écriture ; colonne absente détectée", async () => {
    base.erreurLecture = "column projets.suivi_realisation does not exist";
    const r = await appliquerCoches("p1", ["a"], true, "D");
    expect(r).toMatchObject({ ok: false, colonneAbsente: true });
    expect(base.nbEcritures).toBe(0);
    expect(await relireSuivi("p1")).toBeNull();
  });
  it("écriture en échec → ok:false, base inchangée", async () => {
    base.erreurEcriture = "réseau";
    expect(await definirTemps("p1", "temps", "c", 10)).toMatchObject({ ok: false, colonneAbsente: false, message: "réseau" });
    expect(base.projets.p1.suivi_realisation).toBeNull();
  });
});

describe("minutes", () => {
  it.each([
    ["", 0], ["2", 120], ["2,5", 150], ["2.5", 150], ["2h", 120], ["2h30", 150], ["2:30", 150], ["2 h 30 min", 150], ["45min", 45], ["45 min", 45], ["0,5h", 30],
  ])("minutesDepuisTexte(%j) = %j", (t, m) => { expect(minutesDepuisTexte(t as string)).toBe(m); });
  it.each(["abc", "2h3x", "-5", "1:2:3"])("minutesDepuisTexte(%j) = null", t => { expect(minutesDepuisTexte(t)).toBeNull(); });
  it("formaterMinutes", () => {
    expect(formaterMinutes(150)).toBe("2 h 30");
    expect(formaterMinutes(125)).toBe("2 h 05");
    expect(formaterMinutes(120)).toBe("2 h");
    expect(formaterMinutes(45)).toBe("45 min");
    for (const v of [0, -3, NaN]) expect(formaterMinutes(v)).toBe("—");
  });
  it("aller-retour texte → minutes → texte", () => {
    expect(formaterMinutes(minutesDepuisTexte("1h15")!)).toBe("1 h 15");
  });
});
