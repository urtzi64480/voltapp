import { describe, expect, it } from "vitest";
import { buildCourseItems, buildCourseItemsParFournisseur } from "@/lib/courseItems";

const mat = (o: Record<string, unknown> = {}) => ({ nom: "Prise", quantite: 1, prix_unitaire: 10, type_branche: "materiau", unite: "u", ...o });

describe("buildCourseItems", () => {
  it("ne garde que le matériel, fusionne les doublons (casse ignorée), trie par nom", () => {
    const r = buildCourseItems([mat({ nom: "Prise", quantite: 2 }), mat({ nom: "prise", quantite: 3 }), mat({ nom: "Disjoncteur" }), { nom: "Pose", type_branche: "service", quantite: 1 }]);
    expect(r.map(x => [x.nom, x.qty])).toEqual([["Disjoncteur", 1], ["Prise", 5]]);
  });
  it("quantité absente ou 0 → 1", () => {
    expect(buildCourseItems([mat({ quantite: 0 })])[0].qty).toBe(1);
  });
  it("entrée nulle ou vide → liste vide", () => {
    expect(buildCourseItems(null as unknown as [])).toEqual([]);
    expect(buildCourseItems([])).toEqual([]);
  });
  it("kit : « Contient : » retiré, quantités « 2 × » multipliées par la ligne, services exclus", () => {
    const kit = { type_branche: "materiau", quantite: 2, kit_ratio_service: 0.4, kit_description: "Contient : 3 × Prise 2P+T, Disjoncteur 16A, Main d'œuvre pose, Déplacement" };
    const r = buildCourseItems([kit]);
    expect(r.map(x => [x.nom, x.qty])).toEqual([["Disjoncteur 16A", 2], ["Prise 2P+T", 6]]);
  });
  it("image et référence : première valeur non vide conservée", () => {
    const r = buildCourseItems([mat({ image_url: "" }), mat({ image_url: "a.jpg", reference_fournisseur: " R1 " }), mat({ image_url: "b.jpg", reference_fournisseur: "R2" })]);
    expect(r[0]).toMatchObject({ image: "a.jpg", reference: "R1", qty: 3 });
  });
  it("l'image d'une ligne kit n'est pas propagée à ses composants", () => {
    const r = buildCourseItems([{ type_branche: "materiau", quantite: 1, kit_ratio_service: 0.5, image_url: "k.jpg", kit_description: "Prise" }]);
    expect(r[0].image).toBeUndefined();
  });
});

describe("buildCourseItemsParFournisseur", () => {
  it("groupe par fournisseur, « non précisé » en dernier, achat total si tous les prix d'achat sont connus", () => {
    const g = buildCourseItemsParFournisseur([
      mat({ nom: "A", fournisseur_nom: "Rexel", prix_achat: 2, quantite: 3 }),
      mat({ nom: "B", fournisseur_nom: "Cged", prix_achat: 5 }),
      mat({ nom: "C" }),
      mat({ nom: "D", fournisseur_nom: "Rexel", prix_achat: 1.5 }),
    ]);
    expect(g.map(x => x.fournisseur)).toEqual(["Cged", "Rexel", null]);
    expect(g[1].achat).toBe(7.5);
    expect(g[2].achat).toBeNull();
  });
  it("un seul prix d'achat manquant → achat null (pas de total faussement bas)", () => {
    const g = buildCourseItemsParFournisseur([mat({ nom: "A", fournisseur_nom: "Rexel", prix_achat: 2 }), mat({ nom: "B", fournisseur_nom: "Rexel" })]);
    expect(g[0].achat).toBeNull();
  });
  it("un groupe sans matériel (services seuls) est omis", () => {
    expect(buildCourseItemsParFournisseur([{ nom: "Pose", type_branche: "service", fournisseur_nom: "X", quantite: 1 }])).toEqual([]);
  });
  it("offre en plusieurs pièces : la ligne est remplacée par ses pièces × quantité", () => {
    const g = buildCourseItemsParFournisseur(
      [mat({ nom: "Kit visserie", quantite: 2, fournisseur_id: "o1", fournisseur_nom: "Rexel", prix_achat: 4 })],
      { o1: [{ nom: "Vis", quantite: 10 }, { nom: "Cheville", quantite: 0, reference: "CH1" }] },
    );
    expect(g[0].items.map(i => [i.nom, i.qty, i.reference])).toEqual([["Cheville — Kit visserie", 2, "CH1"], ["Vis — Kit visserie", 20, undefined]]);
  });
});
