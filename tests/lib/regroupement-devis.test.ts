import { describe, expect, it } from "vitest";
import { appliquerRegroupement, cleProduit, libellePresentation, regrouperParProduit, type LigneGeneree } from "@/lib/regroupement-devis";
import { PREFIXE_A_COMPLETER } from "@/lib/devis-lignes";
import { arrondi2 } from "@/lib/utils";

const ligne = (o: Partial<LigneGeneree> = {}): LigneGeneree => ({
  nom: "Prise 2P+T", quantite: 1, prix_unitaire: 10, unite: "u", type_branche: "materiau", prestation_id: "p-prise",
  fournisseur_id: "o-rexel", fournisseur_nom: "Rexel", prix_achat: 6, poste: "Salon", description: "Salon", ...o,
});
const totalLignes = (ls: LigneGeneree[]) => ls.reduce((s, l) => s + arrondi2(l.quantite * l.prix_unitaire), 0);

describe("regrouperParProduit", () => {
  it("fusionne le même produit présent dans plusieurs pièces : quantités additionnées, poste retiré", () => {
    const res = regrouperParProduit([
      ligne({ quantite: 3, poste: "Salon", description: "Salon" }),
      ligne({ quantite: 2, poste: "Chambre", description: "Chambre" }),
      ligne({ quantite: 4, poste: "Cuisine", description: "Cuisine" }),
    ]);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ nom: "Prise 2P+T", quantite: 9, prix_unitaire: 10, prestation_id: "p-prise", fournisseur_id: "o-rexel", prix_achat: 6, poste: null });
  });

  it("ne porte aucune description : les pièces / circuits d'origine ne surchargent pas le devis", () => {
    const res = regrouperParProduit([
      ligne({ description: "Salon" }), ligne({ description: "Chambre" }), ligne({ description: "Salon" }), ligne({ nom: "Boîte", prestation_id: "p-boite", description: "Cuisine" }),
    ]);
    expect(res).toHaveLength(2);
    expect(res[0].quantite).toBe(3);
    res.forEach(l => expect("description" in l).toBe(false));
  });

  it("40 prises 16 A réparties dans plusieurs pièces : une seule ligne « 40 u » au prix unitaire", () => {
    const pieces = ["Salon", "Cuisine", "Chambre 1", "Chambre 2", "Bureau"];
    const entree = pieces.map(p => ligne({ nom: "Prise 2P+T 16 A", quantite: 8, poste: p, description: p, prix_unitaire: 7.5 }));
    const res = regrouperParProduit(entree);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ nom: "Prise 2P+T 16 A", quantite: 40, prix_unitaire: 7.5, unite: "u", poste: null });
    expect(totalLignes(res)).toBe(300);
  });

  it("ne fusionne jamais deux lignes qui diffèrent par le prix, le fournisseur, l'unité, la branche ou la désignation", () => {
    const base = ligne();
    const differentes = [
      ligne({ prix_unitaire: 12 }), ligne({ fournisseur_id: "o-cged", fournisseur_nom: "Cged", prix_achat: 7 }),
      ligne({ prix_achat: 5 }), ligne({ unite: "m" }), ligne({ type_branche: "service" }), ligne({ nom: "Prise 2P+T Schneider" }),
      ligne({ prestation_id: "autre" }),
    ];
    const res = regrouperParProduit([base, ...differentes]);
    expect(res).toHaveLength(1 + differentes.length);
    res.forEach(l => expect(l.quantite).toBe(1));
  });

  it("conserve l'ordre de première apparition", () => {
    const res = regrouperParProduit([
      ligne({ nom: "A", prestation_id: "a" }), ligne({ nom: "B", prestation_id: "b" }),
      ligne({ nom: "A", prestation_id: "a" }), ligne({ nom: "C", prestation_id: "c" }), ligne({ nom: "B", prestation_id: "b" }),
    ]);
    expect(res.map(l => l.nom)).toEqual(["A", "B", "C"]);
    expect(res.map(l => l.quantite)).toEqual([2, 2, 1]);
  });

  it("regroupe aussi la main d'œuvre rattachée aux postes (heures additionnées, sans résidu de virgule)", () => {
    const mo = (poste: string, h: number) => ligne({
      nom: "Main d'œuvre — câblage", unite: "heure", type_branche: "service", prestation_id: "p-mo",
      fournisseur_id: undefined, fournisseur_nom: undefined, prix_achat: undefined, quantite: h, prix_unitaire: 45, poste, description: undefined,
    });
    const res = regrouperParProduit([mo("Salon", 0.1), mo("Chambre", 0.2), mo("Cuisine", 1.5)]);
    expect(res).toHaveLength(1);
    expect(res[0].quantite).toBe(1.8);
    expect(res[0].poste).toBeNull();
  });

  it("les lignes « À compléter » restent détectables et à 0 €", () => {
    const manque = (piece: string) => ligne({
      nom: `${PREFIXE_A_COMPLETER}Prise 2P+T`, prix_unitaire: 0, prestation_id: undefined, fournisseur_id: undefined,
      fournisseur_nom: undefined, prix_achat: undefined, description: piece,
    });
    const res = regrouperParProduit([manque("Salon"), manque("Chambre")]);
    expect(res).toHaveLength(1);
    expect(res[0].nom.startsWith(PREFIXE_A_COMPLETER)).toBe(true);
    expect(res[0]).toMatchObject({ prix_unitaire: 0, quantite: 2 });
  });

  it("une ligne unique (frais, déplacement) passe sans changement de montant, hors poste", () => {
    const frais = ligne({ nom: "Frais généraux", unite: "forfait", type_branche: "service", prestation_id: undefined, fournisseur_id: undefined, fournisseur_nom: undefined, prix_achat: undefined, prix_unitaire: 123.45, poste: "Main d'œuvre et frais", description: undefined });
    const res = regrouperParProduit([frais]);
    expect(res).toEqual([{ ...frais, poste: null }]);
  });

  it("conserve les quantités et le montant total (prix à 2 décimales, quantités entières)", () => {
    const entree = [
      ligne({ quantite: 7, prix_unitaire: 9.9 }), ligne({ quantite: 5, prix_unitaire: 9.9, poste: "Chambre" }),
      ligne({ nom: "Boîte", prestation_id: "p-boite", quantite: 11, prix_unitaire: 1.35 }), ligne({ nom: "Boîte", prestation_id: "p-boite", quantite: 4, prix_unitaire: 1.35, poste: "Cuisine" }),
    ];
    const res = regrouperParProduit(entree);
    expect(res.reduce((s, l) => s + l.quantite, 0)).toBe(entree.reduce((s, l) => s + l.quantite, 0));
    expect(totalLignes(res)).toBeCloseTo(totalLignes(entree), 2);
  });

  it("ne modifie pas les lignes d'entrée", () => {
    const entree = [ligne({ quantite: 1 }), ligne({ quantite: 2, poste: "Chambre", description: "Chambre" })];
    const copie = JSON.parse(JSON.stringify(entree));
    regrouperParProduit(entree);
    expect(entree).toEqual(copie);
  });

  it("liste vide → liste vide", () => {
    expect(regrouperParProduit([])).toEqual([]);
  });
});

describe("cleProduit", () => {
  it("ignore le poste, la quantité et la description", () => {
    expect(cleProduit(ligne({ poste: "A", quantite: 1, description: "x" }))).toBe(cleProduit(ligne({ poste: "B", quantite: 9, description: "y" })));
  });
});

describe("appliquerRegroupement", () => {
  const entree = [ligne({ poste: "Salon" }), ligne({ poste: "Chambre", description: "Chambre" })];
  it("« poste » : lignes inchangées (comportement historique), postes conservés", () => {
    const res = appliquerRegroupement(entree, "poste");
    expect(res).toBe(entree);
    expect(res.map(l => l.poste)).toEqual(["Salon", "Chambre"]);
  });
  it("« produit » : une ligne par produit, sans poste", () => {
    const res = appliquerRegroupement(entree, "produit");
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ quantite: 2, poste: null });
  });
});

describe("libellePresentation", () => {
  it("décrit la présentation choisie", () => {
    expect(libellePresentation("produit", "piece")).toBe("regroupé par produits");
    expect(libellePresentation("poste", "circuit")).toBe("un poste par circuit");
    expect(libellePresentation("poste", "piece")).toBe("un poste par pièce");
    expect(libellePresentation("poste", null)).toBe("un poste par pièce");
  });
});
