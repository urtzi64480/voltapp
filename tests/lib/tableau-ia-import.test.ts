import { describe, expect, it } from "vitest";
import { consigneReleve, lireReponseClaude } from "@/lib/tableau-ia-import";

const json = { photos_exploitables: true, rangees: [{ nom: "R1", differentiel: { calibre_a: 40, sensibilite_ma: 30, type: "A" }, appareils: [{ nature: "disjoncteur", calibre_a: 16, etiquette: "Prises", confiance: "haute" }] }] };

describe("consigneReleve", () => {
  it("contient le format attendu, les valeurs admises et les précisions tronquées", () => {
    const c = consigneReleve("x".repeat(500));
    expect(c).toMatch(/```json/);
    expect(c).toMatch(/disjoncteur_differentiel/);
    expect(c).toMatch(/lave_linge/);
    expect(c.split("Précisions de l'électricien : ")[1].split("\n")[0].length).toBe(300);
    expect(consigneReleve()).not.toMatch(/Précisions de l'électricien/);
  });
});

describe("lireReponseClaude", () => {
  it("lit un bloc json entouré de texte", () => {
    const r = lireReponseClaude("Voici le relevé :\n```json\n" + JSON.stringify(json, null, 2) + "\n```\nBonne journée");
    expect(r.releve?.rangees[0].appareils[0].calibreA).toBe(16);
  });
  it("lit un JSON brut, des guillemets typographiques et des virgules finales", () => {
    expect(lireReponseClaude(JSON.stringify(json)).releve).toBeTruthy();
    expect(lireReponseClaude(`{“photos_exploitables”: true, “rangees”: [{“nom”: “R”, “appareils”: [{“nature”: “disjoncteur”, “calibre_a”: 10,},],},]}`).releve?.rangees).toHaveLength(1);
  });
  it("renvoie un message clair sinon, sans jamais planter", () => {
    for (const x of ["", "   ", "bonjour", "{pas du json", "[1,2]", "x".repeat(300_000)]) {
      const r = lireReponseClaude(x);
      expect(r.releve).toBeUndefined();
      expect(r.erreur).toBeTruthy();
    }
    expect(lireReponseClaude('{"photos_exploitables": true, "rangees": []}').erreur).toMatch(/aucune rangée/);
  });
  it("des photos non exploitables passent, pour saisie manuelle", () => {
    expect(lireReponseClaude('{"photos_exploitables": false, "rangees": []}').releve?.photosExploitables).toBe(false);
  });
});
