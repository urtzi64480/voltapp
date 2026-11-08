import { describe, expect, it } from "vitest";
import { bilanAchats, ecartArticle, tonEcart, type ArticleListe } from "@/lib/courses-achats";
import { buildVuePrix, prevuParCase } from "@/lib/courses-prix";
import { buildCourseItems, buildCourseItemsParFournisseur } from "@/lib/courseItems";
import { tauxDepuisProfil } from "@/lib/rentabilite";

const art = (key: string, prevuTtc: number | null, coche = false): ArticleListe => ({ key, prevuTtc, coche });

describe("bilanAchats : dépensé vs prévu, en direct", () => {
  const liste = [art("a", 120), art("b", 60), art("c", 30), art("d", null)];

  it("rien d'acheté : tout est « reste à acheter », aucun écart", () => {
    const b = bilanAchats(liste, []);
    expect(b).toMatchObject({ reelTtc: 0, prevuTtc: 0, ecartTtc: 0, resteTtc: 210, nbAchetes: 0, ecartPct: null });
    expect(b.resteHt).toBe(175);
  });
  it("article coché au prix prévu (achat créé au prévu) : dépensé = prévu, écart 0", () => {
    const b = bilanAchats([art("a", 120, true), ...liste.slice(1)], [{ article: "a", montant: 120 }]);
    expect(b).toMatchObject({ reelTtc: 120, reelHt: 100, prevuTtc: 120, prevuHt: 100, ecartTtc: 0, ecartHt: 0, resteTtc: 90, nbAchetes: 1 });
    expect(tonEcart(b.ecartTtc)).toBe("neutre");
  });
  it("prix modifié à la baisse : économie en TTC et en HT", () => {
    const b = bilanAchats([art("a", 120, true)], [{ article: "A", montant: 108 }]);       // casse de l'article ignorée
    expect(b).toMatchObject({ ecartTtc: -12, ecartHt: -10, ecartPct: -10 });
    expect(tonEcart(b.ecartTtc)).toBe("economie");
  });
  it("prix modifié à la hausse : surcoût", () => {
    const b = bilanAchats([art("a", 120, true), art("b", 60, true)], [{ article: "a", montant: 120 }, { article: "b", montant: 72 }]);
    expect(b).toMatchObject({ reelTtc: 192, prevuTtc: 180, ecartTtc: 12, ecartHt: 10, ecartPct: 6.7 });
    expect(tonEcart(b.ecartTtc)).toBe("surcout");
  });
  it("article avec un prix mais pas coché : compté comme acheté", () => {
    const b = bilanAchats(liste, [{ article: "b", montant: 50 }]);
    expect(b).toMatchObject({ reelTtc: 50, prevuTtc: 60, ecartTtc: -10, nbAchetes: 1, resteTtc: 150 });
  });
  it("achat global : tous les articles sont achetés, l'écart se mesure sur la liste entière", () => {
    const b = bilanAchats(liste, [{ article: "", montant: 190 }]);
    expect(b).toMatchObject({ reelTtc: 190, prevuTtc: 210, ecartTtc: -20, resteTtc: 0, nbAchetes: 4, nbSansPrevu: 1 });
  });
  it("article sans prix prévu : son prix compte dans le dépensé mais pas dans l'écart", () => {
    const b = bilanAchats([art("a", 100, true), art("d", null, true)], [{ article: "a", montant: 100 }, { article: "d", montant: 40 }]);
    expect(b).toMatchObject({ reelTtc: 140, prevuTtc: 100, ecartTtc: 0, nbSansPrevu: 1 });
  });
  it("article coché sans prix prévu ni prix saisi : rien n'est ajouté", () => {
    const b = bilanAchats([art("d", null, true)], []);
    expect(b).toMatchObject({ reelTtc: 0, prevuTtc: 0, nbAchetes: 1, nbSansPrevu: 1 });
  });
  it("même article deux fois dans la liste : compté une fois", () => {
    expect(bilanAchats([art("a", 120, true), art("a", 120, true)], [{ article: "a", montant: 120 }]).nbArticles).toBe(1);
  });
  it("arrondis au centime", () => {
    const b = bilanAchats([art("a", 0.1, true), art("b", 0.2, true)], [{ article: "a", montant: 0.1 }, { article: "b", montant: 0.2 }]);
    expect(b.reelTtc).toBe(0.3);
    expect(b.prevuTtc).toBe(0.3);
  });
});

describe("ecartArticle / tonEcart", () => {
  it("payé − prévu en TTC et HT", () => expect(ecartArticle(108, 120)).toEqual({ ttc: -12, ht: -10 }));
  it("tons", () => { expect(tonEcart(-0.01)).toBe("economie"); expect(tonEcart(0.01)).toBe("surcout"); expect(tonEcart(0.001)).toBe("neutre"); });
});

describe("prevuParCase : prix prévu de chaque case de la liste", () => {
  const taux = tauxDepuisProfil(null);
  const ligne = (o: any) => ({ type_branche: "materiau", quantite: 1, prix_unitaire: 50, prix_achat: 12, fournisseur_nom: "", ...o });
  const lignes = [
    ligne({ nom: "Disjoncteur 20A", quantite: 3, prix_achat: 10, fournisseur_nom: "Rexel" }),
    ligne({ nom: "Câble 3G2.5", quantite: 2, prix_achat: 24, fournisseur_nom: "Rexel" }),
    ligne({ nom: "Vis", prix_achat: null, fournisseur_nom: "Leroy" }),
    ligne({ nom: "Gaine", prix_achat: 5, fournisseur_nom: "" }),
  ];
  const vue = buildVuePrix(lignes, taux);

  it("vue par fournisseur : prévu = prix d'achat × quantité ; prix inconnu = case absente", () => {
    const groupes = buildCourseItemsParFournisseur(lignes);
    const m = prevuParCase(vue, groupes, []);
    expect(m.get("disjoncteur 20a")).toBe(30);
    expect(m.get("câble 3g2.5")).toBe(48);
    expect(m.get("gaine")).toBe(5);
    expect(m.has("vis")).toBe(false);
  });
  it("vue à plat : mêmes prix, tous fournisseurs confondus", () => {
    const m = prevuParCase(vue, null, buildCourseItems(lignes));
    expect(m.get("disjoncteur 20a")).toBe(30);
    expect(m.get("gaine")).toBe(5);
    expect(m.has("vis")).toBe(false);
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBe(vue.totaux.achatTtc);
  });
  it("sans vue : table vide", () => expect(prevuParCase(null, null, buildCourseItems(lignes)).size).toBe(0));
  it("article en plusieurs pièces : le prix est sur la première case, les autres valent 0 (inclus)", () => {
    const l = ligne({ nom: "Kit sonnette", prix_achat: 40, fournisseur_nom: "Rexel", fournisseur_id: "o1" });
    const v = buildVuePrix([l], taux);
    const groupes = buildCourseItemsParFournisseur([l], { o1: [{ nom: "Bouton", quantite: 1 }, { nom: "Carillon", quantite: 1 }] });
    const m = prevuParCase(v, groupes, []);
    expect([...m.values()].sort((a, b) => b - a)).toEqual([40, 0]);
  });
});
