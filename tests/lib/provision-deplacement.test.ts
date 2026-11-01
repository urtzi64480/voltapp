import { describe, it, expect } from "vitest";
import { provisionFactures } from "@/lib/provision";
import { distanceKm, fraisDeplacement, kmRoute, lireReglage, REGLAGE_DEPLACEMENT_DEFAUT } from "@/lib/deplacement";
import { TAUX_PAR_DEFAUT } from "@/lib/rentabilite";

describe("provision", () => {
  it("cotisations sur services et marchandises, remise comprise", () => {
    const r = provisionFactures([{ total_service: 1000, total_materiau: 0, total_ttc: 1000 }], { cotisService: 21.2, cotisMateriau: 12.3, irService: 1.7, irMateriau: 1 });
    expect(r).toEqual({ encaisse: 1000, cotisations: 212, impots: 17, provision: 229, disponible: 771 });
    const m = provisionFactures([{ total_service: 100, total_materiau: 100, total_ttc: 100 }], TAUX_PAR_DEFAUT);
    expect(m.encaisse).toBe(100); expect(m.provision).toBeCloseTo(16.75, 2);
  });
  it("aucune facture", () => { expect(provisionFactures([], TAUX_PAR_DEFAUT).provision).toBe(0); });
});

describe("déplacement", () => {
  it("distance Bayonne ↔ Jatxou environ 11 km à vol d'oiseau", () => {
    const d = distanceKm({ lat: 43.4933, lng: -1.4748 }, { lat: 43.3994, lng: -1.4127 });
    expect(d).toBeGreaterThan(9); expect(d).toBeLessThan(14);
    expect(kmRoute(10)).toBe(13);
  });
  it("aller-retour, km offerts, minimum", () => {
    const f = fraisDeplacement(20, { tarifKm: 0.6, kmOfferts: 10, allerRetour: true, minimum: 0 });
    expect(f.kmFactures).toBe(30); expect(f.montant).toBe(18); expect(f.libelle).toContain("40 km aller-retour");
    expect(fraisDeplacement(3, REGLAGE_DEPLACEMENT_DEFAUT).montant).toBe(0);
    expect(fraisDeplacement(3, { ...REGLAGE_DEPLACEMENT_DEFAUT, minimum: 15 }).montant).toBe(15);
    expect(fraisDeplacement(20, { tarifKm: 1, kmOfferts: 0, allerRetour: false, minimum: 0 }).montant).toBe(20);
  });
  it("réglage tolérant", () => { expect(lireReglage({ tarifKm: -1, kmOfferts: "x", allerRetour: 3 })).toEqual(REGLAGE_DEPLACEMENT_DEFAUT); expect(lireReglage(null)).toEqual(REGLAGE_DEPLACEMENT_DEFAUT); });
});

import { ajouterAnnees, garanties } from "@/lib/garanties";
import { dateReference, etatEntretien, moisEcoules } from "@/lib/entretien";
import { collecter } from "@/lib/sauvegarde";

describe("garanties", () => {
  it("échéances, 29 février", () => {
    expect(garanties("2026-11-01").map(g => g.fin)).toEqual(["2027-11-01", "2028-11-01", "2036-11-01"]);
    expect(ajouterAnnees("2024-02-29", 1)).toBe("2025-02-28"); expect(ajouterAnnees("2024-02-29", 4)).toBe("2028-02-29");
  });
});
describe("entretien annuel", () => {
  it("mois écoulés", () => { expect(moisEcoules("2025-01-15", "2026-01-14")).toBe(11); expect(moisEcoules("2025-01-15", "2026-01-15")).toBe(12); });
  it("référence : réception > validation > dernier paiement", () => {
    expect(dateReference({ reception: "2025-03-01", valideLe: "2025-02-01", paiements: ["2025-04-01T10:00:00Z"] })).toBe("2025-03-01");
    expect(dateReference({ valideLe: "2025-02-01", paiements: ["2025-04-01T10:00:00Z"] })).toBe("2025-02-01");
    expect(dateReference({ paiements: ["2025-04-01T10:00:00Z", null, "2025-05-02T08:00:00Z"] })).toBe("2025-05-02");
    expect(dateReference({})).toBeNull();
  });
  it("états", () => {
    expect(etatEntretien("2025-11-01", null, "2026-11-01")).toBe("a_contacter");
    expect(etatEntretien("2025-11-01", null, "2026-08-15")).toBe("a_venir");
    expect(etatEntretien("2025-11-01", null, "2026-03-01")).toBe("trop_tot");
    expect(etatEntretien("2025-11-01", "2026-10-20T10:00:00Z", "2026-11-01")).toBe("fait");
    expect(etatEntretien("2025-11-01", "2025-11-05T10:00:00Z", "2026-11-01")).toBe("a_contacter"); // rappel d'un cycle précédent
  });
});
describe("sauvegarde", () => {
  it("pagination, erreurs isolées", async () => {
    const lire = async (t: string, de: number) => {
      if (t === "mauvaise") return { data: null, error: { message: "refusé" } };
      const n = t === "grosse" ? (de === 0 ? 1000 : 3) : 2;
      return { data: Array.from({ length: n }, (_, i) => ({ i: de + i })), error: null };
    };
    const f = await collecter(lire, ["grosse", "petite", "mauvaise"], new Date("2026-11-01T10:00:00Z"));
    expect(f.comptes).toEqual({ grosse: 1003, petite: 2 }); expect(f.erreurs).toEqual({ mauvaise: "refusé" }); expect(f.tables.mauvaise).toBeUndefined();
  });
});

import { composerResume } from "@/lib/resume-quotidien";
import { clesVapid } from "@/lib/push-serveur";
describe("notifications", () => {
  it("résumé : rien à dire → null ; sinon lignes utiles", () => {
    expect(composerResume({ interventions: [], payees: [], enRetard: 0 })).toBeNull();
    const r = composerResume({ interventions: [{ titre: "Tableau Dupont", date_debut: "2026-11-02T08:00:00Z" }], payees: [{ numero: "F1", total_ttc: 120 }], enRetard: 2 })!;
    expect(r.corps).toContain("1 intervention aujourd'hui"); expect(r.corps).toContain("120,00 €"); expect(r.corps).toContain("2 factures en retard"); expect(r.url).toBe("/planning");
  });
  it("clés VAPID : déterministes, au bon format (clé publique P-256 = 65 octets)", () => {
    const a = clesVapid("secret"), b = clesVapid("secret"), c = clesVapid("autre");
    expect(a).toEqual(b); expect(a.publique).not.toBe(c.publique);
    expect(Buffer.from(a.publique, "base64url")).toHaveLength(65); expect(Buffer.from(a.privee, "base64url")).toHaveLength(32);
  });
});
