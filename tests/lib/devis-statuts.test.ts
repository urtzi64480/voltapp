import { describe, expect, it } from "vitest";
import { reponseDuStatut, statutApresReponse, statutModifiable, tauxConversion } from "@/lib/devis-statuts";
import { STATUT_COLORS, STATUT_LABELS, STATUTS_DEVIS } from "@/lib/utils";
import { prixProposable, champsSynchronisables } from "@/lib/devis-lignes";

describe("réponse du client", () => {
  it("statut → réponse", () => {
    expect(["brouillon", "envoye", "expire", undefined, null, "signe"].map(reponseDuStatut)).toEqual(Array(6).fill("attente"));
    expect(reponseDuStatut("refuse")).toBe("refuse"); expect(reponseDuStatut("a_refaire")).toBe("a_refaire");
  });
  it("jamais de modification d'un devis signé ou d'un statut inconnu", () => {
    for (const r of ["attente", "refuse", "a_refaire"] as const) { expect(statutApresReponse("signe", r)).toBeNull(); expect(statutApresReponse("zzz", r)).toBeNull(); expect(statutApresReponse(undefined, r)).toBeNull(); }
    expect(statutModifiable("signe")).toBe(false); expect(statutModifiable("a_refaire")).toBe(true);
  });
  it("refusé / à refaire depuis n'importe quel statut modifiable ; « pas de réponse » ramène à envoyé", () => {
    for (const s of ["brouillon", "envoye", "refuse", "a_refaire", "expire"]) { expect(statutApresReponse(s, "refuse")).toBe("refuse"); expect(statutApresReponse(s, "a_refaire")).toBe("a_refaire"); }
    expect(statutApresReponse("refuse", "attente")).toBe("envoye"); expect(statutApresReponse("a_refaire", "attente")).toBe("envoye");
    expect(statutApresReponse("brouillon", "attente")).toBe("brouillon"); expect(statutApresReponse("envoye", "attente")).toBe("envoye");
  });
  it("« à refaire » : statut connu, libellé, couleur, prix et champs du catalogue suivent comme pour un devis en cours", () => {
    expect(STATUTS_DEVIS).toContain("a_refaire"); expect(STATUT_LABELS.a_refaire).toBe("À refaire"); expect(STATUT_COLORS.a_refaire).toBeTruthy();
    expect(prixProposable("a_refaire")).toBe(true); expect(champsSynchronisables("a_refaire").length).toBeGreaterThan(0); expect(prixProposable("refuse")).toBe(false);
  });
});

describe("tauxConversion", () => {
  it("signés / devis parvenus au client (envoyés + signés + refusés + à refaire)", () => {
    expect(tauxConversion({ envoye: 2, signe: 3, refuse: 4, a_refaire: 1 })).toEqual({ pourcent: 30, acceptes: 3, sortis: 10 });
    expect(tauxConversion({ envoye: 0, signe: 1, refuse: 2, a_refaire: 0 }).pourcent).toBe(33);
    expect(tauxConversion({ envoye: 0, signe: 2, refuse: 1, a_refaire: 0 }).pourcent).toBe(67);
  });
  it("aucun devis sorti → null (pas de 0 % trompeur) ; tout signé → 100", () => {
    expect(tauxConversion({ envoye: 0, signe: 0, refuse: 0, a_refaire: 0 }).pourcent).toBeNull();
    expect(tauxConversion({ envoye: 0, signe: 5, refuse: 0, a_refaire: 0 }).pourcent).toBe(100);
    expect(tauxConversion({ envoye: 4, signe: 0, refuse: 0, a_refaire: 0 }).pourcent).toBe(0);
  });
});
