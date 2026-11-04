import { describe, expect, it } from "vitest";
import { lignesDevisTableau, preparerPredevisTableau, totauxLignesDevis } from "@/lib/tableau-predevis";
import { construireProposition, CONTEXTE_DEFAUT, normaliserReleve } from "@/lib/tableau-ia";
import type { Prestation } from "@/types";

const presta = (o: Partial<Prestation> & { sous_categorie: string }): Prestation => ({
  id: o.sous_categorie, user_id: "u", nom: `Article ${o.sous_categorie}`, prix_unitaire: 10, unite: "u", type_branche: "materiau", categorie: "Tableau", actif: true, created_at: "", ...o,
});
const rows = () => construireProposition(normaliserReleve({ photos_exploitables: true, rangees: [{ nom: "R1", differentiel: { calibre_a: 40, sensibilite_ma: 30, type: "A" }, appareils: [
  { nature: "disjoncteur", calibre_a: 16, etiquette: "Prises", confiance: "haute" }, { nature: "disjoncteur", calibre_a: 10, etiquette: "Éclairage", confiance: "haute" }] }] }), [], CONTEXTE_DEFAUT).rows;

describe("pré-devis du tableau", () => {
  it("chiffre les disjoncteurs depuis le catalogue et laisse « À compléter » ce qui n'y est pas", () => {
    const p = preparerPredevisTableau(rows(), [presta({ sous_categorie: "disjoncteur_16A", prix_unitaire: 8 })]);
    expect(p.lignes.length).toBeGreaterThan(3);
    expect(p.nbSansArticle).toBeGreaterThan(0);
    const l = lignesDevisTableau(p.lignes, []);
    const d16 = l.find(x => x.nom === "Article disjoncteur_16A");
    expect(d16?.quantite).toBe(1);
    expect(d16?.prix_unitaire).toBe(8);
    expect(l.some(x => x.nom.startsWith("À compléter") && x.prix_unitaire === 0)).toBe(true);
    expect(l.every(x => x.poste === "Tableau électrique")).toBe(true);
  });
  it("une ligne décochée n'est pas reprise ; la main d'œuvre est ajoutée dans son poste", () => {
    const p = preparerPredevisTableau(rows(), []);
    p.lignes.forEach(l => { l.inclus = false; });
    expect(lignesDevisTableau(p.lignes, [])).toEqual([]);
    const l = lignesDevisTableau(p.lignes, [], { heures: 3, tauxHoraire: 50 });
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ quantite: 3, prix_unitaire: 50, type_branche: "service", poste: "Main d'œuvre et frais" });
    expect(totauxLignesDevis(l)).toEqual({ service: 150, materiau: 0, total: 150 });
  });
  it("un tableau vide ne plante pas", () => {
    expect(() => preparerPredevisTableau([], [])).not.toThrow();
  });
});
