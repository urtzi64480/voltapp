import { describe, it, expect } from "vitest";
import { bornesPeriode, construireLivre, genererCsv, recapMensuel, repartir, totaux, texteCsv, nomFichier } from "@/lib/export-comptable";

const f = (numero: string, paye: string, s: number, m: number, ttc: number, extra = {}) =>
  ({ numero, paye_le: paye, total_service: s, total_materiau: m, total_ttc: ttc, objet: "Obj", client: { nom: "Dupont", prenom: "Jean" }, ...extra });

describe("export comptable", () => {
  it("répartition sans remise", () => { expect(repartir({ total_service: 100, total_materiau: 50, total_ttc: 150 })).toEqual({ service: 100, materiau: 50, total: 150 }); });
  it("remise répartie au prorata, somme exacte", () => {
    const r = repartir({ total_service: 100, total_materiau: 50, total_ttc: 135 });
    expect(r.service + r.materiau).toBeCloseTo(135, 10); expect(r.service).toBe(90); expect(r.materiau).toBe(45);
    const x = repartir({ total_service: 33.33, total_materiau: 66.67, total_ttc: 99.99 });
    expect(Math.round((x.service + x.materiau) * 100)).toBe(9999);
  });
  it("sans ventilation : services par défaut ; valeurs invalides ignorées", () => {
    expect(repartir({ total_service: 0, total_materiau: 0, total_ttc: 80 })).toEqual({ service: 80, materiau: 0, total: 80 });
    expect(repartir({ total_service: NaN as unknown as number, total_materiau: null, total_ttc: null })).toEqual({ service: 0, materiau: 0, total: 0 });
  });
  it("livre trié par date, nature, factures sans date ignorées", () => {
    const l = construireLivre([f("F2", "2026-03-15T12:00:00", 0, 100, 100), f("F1", "2026-02-10T12:00:00", 200, 0, 200), f("F3", "2026-03-20T12:00:00", 50, 50, 100), { numero: "X", paye_le: null }]);
    expect(l.map(x => x.numero)).toEqual(["F1", "F2", "F3"]);
    expect(l.map(x => x.nature)).toEqual(["Services", "Marchandises", "Mixte"]);
  });
  it("récap mensuel et totaux", () => {
    const l = construireLivre([f("F1", "2026-02-10T12:00:00", 200, 0, 200), f("F2", "2026-03-15T12:00:00", 0, 100, 100), f("F3", "2026-03-20T12:00:00", 50, 50, 100)]);
    const r = recapMensuel(l);
    expect(r.map(x => [x.cle, x.nb, x.total])).toEqual([["2026-02", 1, 200], ["2026-03", 2, 200]]);
    expect(totaux(l)).toEqual({ nb: 3, service: 250, materiau: 150, total: 400 });
  });
  it("bornes de période", () => {
    expect(new Date(bornesPeriode({ type: "annee", annee: 2026 }).fin).getFullYear()).toBe(2027);
    const t = bornesPeriode({ type: "trimestre", annee: 2026, trimestre: 4 });
    expect(new Date(t.debut).getMonth()).toBe(9); expect(new Date(t.fin).getFullYear()).toBe(2027);
    const d = bornesPeriode({ type: "mois", annee: 2026, mois: 12 });
    expect(new Date(d.fin).getMonth()).toBe(0);
  });
  it("CSV : BOM géré par l'appelant, injection neutralisée, virgule décimale", () => {
    expect(texteCsv("=1+1")).toBe("'=1+1"); expect(texteCsv("@x")).toBe("'@x"); expect(texteCsv("ok")).toBe("ok");
    const l = construireLivre([f("F1", "2026-02-10T12:00:00", 10.5, 0, 10.5, { client: { nom: "=cmd", prenom: null }, objet: 'a"b' })]);
    const csv = genererCsv(l, { type: "mois", annee: 2026, mois: 2 });
    expect(csv).toContain('"10,50"'); expect(csv).toContain('"\'=cmd"'); expect(csv).toContain('"a""b"');
    expect(csv).toContain("Livre des recettes — Février 2026"); expect(csv).toContain("Récapitulatif mensuel");
    expect(csv).toContain('"10/02/2026"');
  });
  it("nom de fichier", () => { expect(nomFichier({ type: "mois", annee: 2026, mois: 3 })).toBe("livre-des-recettes-2026-03.csv"); });
});
