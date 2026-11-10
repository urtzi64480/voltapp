import { describe, expect, it } from "vitest";
import { alerteAssurance, attestationUtilisable, etatAssurance, mentionDecennale } from "@/lib/assurance";

const NOW = new Date(2026, 10, 10, 20, 0); // 10/11/2026 20h00 locale
const base = { assurance_assureur: "AXA", assurance_contrat: "123456", assurance_zone: "France métropolitaine", assurance_debut: "2026-01-01", assurance_fin: "2026-12-31" };

describe("etatAssurance", () => {
  it("valide, bientôt, expirée, non commencée, absente", () => {
    expect(etatAssurance(base, NOW)).toMatchObject({ etat: "valide", joursRestants: 51 });
    expect(etatAssurance({ ...base, assurance_fin: "2026-11-25" }, NOW)).toMatchObject({ etat: "bientot", joursRestants: 15 });
    expect(etatAssurance({ ...base, assurance_fin: "2026-11-09" }, NOW).etat).toBe("expiree");
    expect(etatAssurance({ ...base, assurance_debut: "2027-01-01", assurance_fin: "2027-12-31" }, NOW).etat).toBe("non_commencee");
    expect(etatAssurance({}, NOW).etat).toBe("absente");
    expect(etatAssurance(null, NOW).etat).toBe("absente");
    expect(etatAssurance({ ...base, assurance_fin: "n'importe quoi" }, NOW).etat).toBe("absente");
  });
  it("le dernier jour est inclus, le lendemain non", () => {
    expect(etatAssurance({ ...base, assurance_fin: "2026-11-10" }, NOW)).toMatchObject({ etat: "bientot", joursRestants: 0 });
    expect(etatAssurance({ ...base, assurance_fin: "2026-11-10" }, new Date(2026, 10, 11, 0, 5)).etat).toBe("expiree");
  });
  it("utilisable = valide ou bientôt seulement", () => {
    expect(attestationUtilisable(base, NOW)).toBe(true);
    expect(attestationUtilisable({ ...base, assurance_fin: "2026-11-01" }, NOW)).toBe(false);
    expect(attestationUtilisable({}, NOW)).toBe(false);
  });
});

describe("mentionDecennale", () => {
  it("mention complète avec assureur, contrat, zone et validité", () => {
    const m = mentionDecennale({ ...base, assurance_adresse: "313 Terrasses de l'Arche, Nanterre" }, NOW)!;
    expect(m).toContain("AXA (313 Terrasses de l'Arche, Nanterre)");
    expect(m).toContain("contrat n° 123456");
    expect(m).toContain("couverture géographique : France métropolitaine");
    expect(m).toContain("valable jusqu'au 31/12/2026");
  });
  it("zone par défaut ; pas de mention sans assureur, ni si expirée", () => {
    expect(mentionDecennale({ ...base, assurance_zone: "  " }, NOW)).toContain("France métropolitaine");
    expect(mentionDecennale({ ...base, assurance_assureur: " " }, NOW)).toBeNull();
    expect(mentionDecennale({ ...base, assurance_fin: "2026-01-31" }, NOW)).toBeNull();
    expect(mentionDecennale(null, NOW)).toBeNull();
  });
});

describe("alerteAssurance", () => {
  it("alerte seulement quand il y a quelque chose à faire", () => {
    expect(alerteAssurance({}, NOW)).toBeNull();
    expect(alerteAssurance(base, NOW)).toBeNull();
    expect(alerteAssurance({ ...base, assurance_fin: "2026-11-25" }, NOW)).toContain("15 jours");
    expect(alerteAssurance({ ...base, assurance_fin: "2026-11-10" }, NOW)).toContain("aujourd'hui");
    expect(alerteAssurance({ ...base, assurance_fin: "2026-01-01" }, NOW)).toContain("expirée");
    expect(alerteAssurance({ assurance_assureur: "AXA" }, NOW)).toContain("date de fin");
  });
});
