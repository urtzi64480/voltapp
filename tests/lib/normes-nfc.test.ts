import { describe, expect, it } from "vitest";
import * as normes from "@/lib/normes-nfc";
import { IZ_CUIVRE, K2_GROUPEMENT_PAROI, K3_TEMPERATURE, SECTIONS_NORMALISEES, sectionPE } from "@/lib/normes-nfc";

describe("structure de la table des normes", () => {
  it("chaque règle a une valeur, une source non vide et un statut valide", () => {
    let nb = 0;
    const visiter = (obj: unknown, chemin: string) => {
      if (!obj || typeof obj !== "object") return;
      const o = obj as Record<string, unknown>;
      if ("statut" in o && "source" in o && "valeur" in o) {
        nb++;
        expect(["verifie", "a_verifier"], chemin).toContain(o.statut);
        expect(String(o.source).length, chemin).toBeGreaterThan(5);
        expect(o.valeur, chemin).not.toBeUndefined();
        return;
      }
      Object.entries(o).forEach(([k, v]) => visiter(v, `${chemin}.${k}`));
    };
    Object.entries(normes).forEach(([k, v]) => visiter(v, k));
    expect(nb).toBeGreaterThan(30);
  });
});

describe("courants admissibles Iz", () => {
  const sections = Object.keys(IZ_CUIVRE.valeur).map(Number).sort((a, b) => a - b);
  it("couvre exactement les sections normalisées", () => {
    expect(sections).toEqual([...SECTIONS_NORMALISEES]);
  });
  it("Iz croît avec la section, pour chaque mode de pose et isolant", () => {
    const cles = Object.keys(IZ_CUIVRE.valeur[1.5]) as (keyof typeof IZ_CUIVRE.valeur[1.5])[];
    expect(cles).toHaveLength(8);
    for (const c of cles) for (let i = 1; i < sections.length; i++) {
      expect(IZ_CUIVRE.valeur[sections[i]][c], `${c} ${sections[i]} mm²`).toBeGreaterThan(IZ_CUIVRE.valeur[sections[i - 1]][c]);
    }
  });
  it("à section égale : 2 conducteurs chargés ≥ 3, PR ≥ PVC, mode C (fixé) ≥ mode B (encastré)", () => {
    for (const s of sections) {
      const z = IZ_CUIVRE.valeur[s];
      expect(z.BPVC2).toBeGreaterThanOrEqual(z.BPVC3); expect(z.CPVC2).toBeGreaterThanOrEqual(z.CPVC3);
      expect(z.BPR2).toBeGreaterThanOrEqual(z.BPR3); expect(z.CPR2).toBeGreaterThanOrEqual(z.CPR3);
      expect(z.BPR3).toBeGreaterThanOrEqual(z.BPVC3); expect(z.CPR3).toBeGreaterThanOrEqual(z.CPVC3);
      expect(z.CPVC3).toBeGreaterThan(z.BPVC3); expect(z.CPR2).toBeGreaterThan(z.BPR2);
    }
  });
  it("valeurs de référence connues (2,5 mm² PVC3 mode B = 21 A ; 1,5 mm² = 15,5 A)", () => {
    expect(IZ_CUIVRE.valeur[2.5].BPVC3).toBe(21);
    expect(IZ_CUIVRE.valeur[1.5].BPVC3).toBe(15.5);
  });
});

describe("coefficients de correction", () => {
  it("K3 : 1 à 30 °C, décroissant avec la température", () => {
    const t = Object.keys(K3_TEMPERATURE.valeur).map(Number).sort((a, b) => a - b);
    expect(K3_TEMPERATURE.valeur[30]).toEqual({ PVC: 1, PR: 1 });
    for (let i = 1; i < t.length; i++) for (const iso of ["PVC", "PR"] as const) {
      expect(K3_TEMPERATURE.valeur[t[i]][iso]).toBeLessThan(K3_TEMPERATURE.valeur[t[i - 1]][iso]);
    }
  });
  it("K2 : 1 pour un circuit, décroissant avec le groupement, dans ]0 ; 1]", () => {
    const n = Object.keys(K2_GROUPEMENT_PAROI.valeur).map(Number).sort((a, b) => a - b);
    expect(K2_GROUPEMENT_PAROI.valeur[1]).toBe(1);
    for (let i = 1; i < n.length; i++) expect(K2_GROUPEMENT_PAROI.valeur[n[i]]).toBeLessThanOrEqual(K2_GROUPEMENT_PAROI.valeur[n[i - 1]]);
    n.forEach(k => { expect(K2_GROUPEMENT_PAROI.valeur[k]).toBeGreaterThan(0); expect(K2_GROUPEMENT_PAROI.valeur[k]).toBeLessThanOrEqual(1); });
  });
});

describe("sectionPE (CEI 60364-5-54)", () => {
  it("≤ 16 mm² : même section ; 25–35 : 16 ; au-delà : moitié", () => {
    expect([1.5, 2.5, 6, 16].map(sectionPE)).toEqual([1.5, 2.5, 6, 16]);
    expect([25, 35].map(sectionPE)).toEqual([16, 16]);
    expect([50, 70, 95, 120].map(sectionPE)).toEqual([25, 35, 47.5, 60]);
  });
});

describe("valeurs réglementaires usuelles", () => {
  it("chute de tension : 3 % éclairage, 5 % autres usages ; 230/400 V", () => {
    expect(normes.NORME_CHUTE.maxEclairagePct.valeur).toBe(3);
    expect(normes.NORME_CHUTE.maxAutresPct.valeur).toBe(5);
    expect(normes.NORME_CHUTE.tensionMonoV.valeur).toBe(230);
    expect(normes.NORME_CHUTE.tensionTriV.valeur).toBe(400);
  });
  it("tableau : 8 circuits max par différentiel, 2 différentiels mini, GTL 60 × 25 cm", () => {
    expect(normes.NORME_TABLEAU.circuitsMaxParId.valeur).toBe(8);
    expect(normes.NORME_TABLEAU.idMiniParLogement.valeur).toBe(2);
    expect(normes.NORME_GTL.largeurMiniMm.valeur).toBe(600);
    expect(normes.NORME_GTL.profondeurMiniMm.valeur).toBe(250);
  });
  it("AGCP monophasé : 3/6/9/12 kVA = 15/30/45/60 A", () => {
    const mono = normes.CALIBRES_AGCP.valeur.filter(c => c.phase === "mono");
    for (const c of mono) expect(c.calibreA).toBeCloseTo((c.kva * 1000) / 200, 5);
  });
  // Le document « normes-valeurs-a-verifier » du projet classe ces valeurs « à vérifier » alors que le code les marque
  // « verifie ». Aucune des deux n'est modifiée ici : à trancher par lecture du texte de la norme.
  it.todo("NORME_CHUTE.maxEclairagePct / maxAutresPct : statut « verifie » dans le code, « à vérifier » dans le document du projet");
  it.todo("IZ_CUIVRE : statut « verifie » dans le code, sections ≥ 25 mm² déduites d'une séquence — à confirmer");
});
