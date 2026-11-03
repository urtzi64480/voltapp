import { describe, expect, it } from "vitest";
import { buildComparatifAchat, buildCourseItems, buildCourseItemsParFournisseur } from "@/lib/courseItems";

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

describe("buildComparatifAchat", () => {
  it("totaux à périmètre égal ; économie en % du prix devis (1 décimale)", () => {
    const c = buildComparatifAchat([
      mat({ nom: "A", quantite: 2, prix_unitaire: 10, prix_achat: 6, fournisseur_nom: "Rexel" }),
      mat({ nom: "B", quantite: 1, prix_unitaire: 20, prix_achat: 15, fournisseur_nom: "Rexel" }),
    ]);
    expect(c).toMatchObject({ totalAchat: 27, totalVente: 40, ecart: 13, economiePct: 32.5, nbSansPrix: 0, nbKitsIgnores: 0 });
  });
  it("ligne sans prix d'achat : listée, comptée à part, exclue des deux totaux", () => {
    const c = buildComparatifAchat([mat({ nom: "A", prix_achat: 5, fournisseur_nom: "R" }), mat({ nom: "B", prix_unitaire: 99, fournisseur_nom: "R" })]);
    expect(c.nbSansPrix).toBe(1);
    expect(c.totalVente).toBe(10);
    expect(c.groupes[0].lignes).toHaveLength(2);
  });
  it("kits ignorés et comptés ; services ignorés", () => {
    const c = buildComparatifAchat([mat({ kit_ratio_service: 0.5 }), { nom: "Pose", type_branche: "service", prix_unitaire: 50, quantite: 1 }]);
    expect(c).toMatchObject({ nbKitsIgnores: 1, totalAchat: 0, totalVente: 0, economiePct: null, groupes: [] });
  });
  it("arrondis au centime, sans dérive flottante", () => {
    const c = buildComparatifAchat([mat({ quantite: 3, prix_unitaire: 0.1, prix_achat: 0.07 })]);
    expect(c.totalVente).toBe(0.3);
    expect(c.totalAchat).toBe(0.21);
  });
  it("entrée nulle → comparatif vide", () => {
    expect(buildComparatifAchat(null as unknown as [])).toMatchObject({ groupes: [], totalAchat: 0, economiePct: null });
  });
});

describe("prix d'achat maximum (vue privée)", () => {
  // Plafond injecté : 87,7 % du prix de vente, au centime inférieur (12,3 % de cotisations matériau).
  const opts = { achatMax: (v: number) => Math.floor(v * 0.877 * 100 + 1e-9) / 100 };

  it("sans calcul demandé : aucun champ de plafond rempli (rien ne fuit par défaut)", () => {
    const c = buildComparatifAchat([mat({ prix_achat: 5, fournisseur_nom: "R" })]);
    expect(c.totalAchatMax).toBeNull();
    expect(c.groupes[0].achatMax).toBeNull();
    expect(c.groupes[0].lignes[0].achatMaxUnitaire).toBeNull();
    expect(c.groupes[0].lignes[0].aPerte).toBe(false);
    expect(buildCourseItemsParFournisseur([mat({ prix_achat: 5, fournisseur_nom: "R" })])[0].achatMax).toBeNull();
  });

  it("40 prises à 10 € : plafond unitaire 8,77 €, total 350,80 €", () => {
    const c = buildComparatifAchat([mat({ nom: "Prise 16 A", quantite: 40, prix_unitaire: 10, prix_achat: 6, fournisseur_nom: "Rexel" })], opts);
    const l = c.groupes[0].lignes[0];
    expect(l).toMatchObject({ achatMaxUnitaire: 8.77, aPerte: false });
    expect(c.totalAchatMax).toBe(350.8);
    expect(c.nbAPerte).toBe(0);
  });

  it("achat au-dessus du plafond → ligne à perte, comptée ; au plafond exact → pas à perte", () => {
    const c = buildComparatifAchat([
      mat({ nom: "A", prix_unitaire: 10, prix_achat: 8.78, fournisseur_nom: "R" }),
      mat({ nom: "B", prix_unitaire: 10, prix_achat: 8.77, fournisseur_nom: "R" }),
      mat({ nom: "C", prix_unitaire: 10, prix_achat: 3, fournisseur_nom: "R" }),
    ], opts);
    const parNom = Object.fromEntries(c.groupes[0].lignes.map(l => [l.nom, l.aPerte]));
    expect(parNom).toEqual({ A: true, B: false, C: false });
    expect(c.nbAPerte).toBe(1);
  });

  it("ligne sans prix d'achat : plafond affiché mais exclu du total (même périmètre que l'achat)", () => {
    const c = buildComparatifAchat([mat({ nom: "A", prix_unitaire: 10, prix_achat: 5, fournisseur_nom: "R" }), mat({ nom: "B", prix_unitaire: 100, fournisseur_nom: "R" })], opts);
    const b = c.groupes[0].lignes.find(l => l.nom === "B")!;
    expect(b.achatMaxUnitaire).toBe(87.7);
    expect(b.aPerte).toBe(false);
    expect(c.totalAchatMax).toBe(8.77);
    expect(c.groupes[0].achatMax).toBe(8.77);
  });

  it("kits et services : pas de plafond", () => {
    const c = buildComparatifAchat([mat({ kit_ratio_service: 0.5 }), { nom: "Pose", type_branche: "service", prix_unitaire: 50, quantite: 1 }], opts);
    expect(c.groupes).toEqual([]);
    expect(c.totalAchatMax).toBe(0);
  });

  it("groupe fournisseur de la liste privée : plafond = Σ plafond unitaire × quantité (même périmètre que l'achat, kits exclus)", () => {
    const g = buildCourseItemsParFournisseur([
      mat({ nom: "A", quantite: 4, prix_unitaire: 10, prix_achat: 5, fournisseur_nom: "Rexel" }),
      mat({ nom: "B", quantite: 1, prix_unitaire: 20, prix_achat: 9, fournisseur_nom: "Rexel" }),
      mat({ nom: "Kit", kit_ratio_service: 0.5, prix_unitaire: 99, kit_description: "2 × X", fournisseur_nom: "Rexel" }),
    ], undefined, opts);
    expect(g[0]).toMatchObject({ fournisseur: "Rexel", achat: 29 });
    expect(g[0].achatMax).toBe(52.62); // 4 × 8,77 + 17,54
  });

  it("le plafond ne modifie ni les totaux d'achat/vente ni l'écart existants", () => {
    const lignes = [mat({ nom: "A", quantite: 2, prix_unitaire: 10, prix_achat: 6, fournisseur_nom: "Rexel" }), mat({ nom: "B", prix_unitaire: 20, prix_achat: 15, fournisseur_nom: "Rexel" })];
    const sans = buildComparatifAchat(lignes), avec = buildComparatifAchat(lignes, opts);
    expect(avec).toMatchObject({ totalAchat: sans.totalAchat, totalVente: sans.totalVente, ecart: sans.ecart, economiePct: sans.economiePct });
  });
});
