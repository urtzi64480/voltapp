import { describe, expect, it } from "vitest";
import {
  designationProduit, fourchettePrix, imageOffre, libelleOffre, libelleOffreMarque, margePct, marqueOffre, marquesDe, marqueVariable,
  nomAvecMarque, nomDepuisUrl, normTexte, offrePourFournisseur, offrePrincipale, offresDeMarque, offresTriees, prixVenteOffre,
} from "@/lib/fournisseurs";
import { offre, prestation } from "../helpers/fixtures";

describe("libellés", () => {
  it("nomDepuisUrl", () => {
    expect(nomDepuisUrl("https://www.rexel.fr/produit/1")).toBe("rexel.fr");
    expect(nomDepuisUrl("leroymerlin.fr/x")).toBe("leroymerlin.fr");
    expect(nomDepuisUrl("")).toBe("");
    expect(nomDepuisUrl(null)).toBe("");
    expect(nomDepuisUrl("http://[invalide")).toBe("");
  });
  it("libelleOffre : fournisseur, sinon domaine de l'URL, sinon « Fournisseur »", () => {
    expect(libelleOffre({ fournisseur: " Rexel ", url: null })).toBe("Rexel");
    expect(libelleOffre({ fournisseur: "", url: "https://www.x.com/a" })).toBe("x.com");
    expect(libelleOffre({ fournisseur: "", url: null })).toBe("Fournisseur");
  });
});

describe("offres", () => {
  const a = offre({ id: "a", fournisseur: "Rexel", ordre: 2 });
  const b = offre({ id: "b", fournisseur: "Cged", principal: true, ordre: 5 });
  const c = offre({ id: "c", fournisseur: "Leroy Merlin", ordre: 1 });
  it("offrePrincipale : l'offre marquée principale, sinon la première", () => {
    expect(offrePrincipale([a, b, c])?.id).toBe("b");
    expect(offrePrincipale([a, c])?.id).toBe("a");
    expect(offrePrincipale([])).toBeUndefined();
    expect(offrePrincipale(null)).toBeUndefined();
  });
  it("offresTriees : principale d'abord, puis par ordre — sans modifier l'entrée", () => {
    const entree = [a, b, c];
    expect(offresTriees(entree).map(o => o.id)).toEqual(["b", "c", "a"]);
    expect(entree.map(o => o.id)).toEqual(["a", "b", "c"]);
  });
  it("offrePourFournisseur : insensible à la casse", () => {
    expect(offrePourFournisseur({ fournisseurs: [a, b] }, " rexel ")?.id).toBe("a");
    expect(offrePourFournisseur({ fournisseurs: [a, b] }, "inconnu")).toBeUndefined();
    expect(offrePourFournisseur({ fournisseurs: [a, b] }, "")).toBeUndefined();
    expect(offrePourFournisseur({}, "rexel")).toBeUndefined();
  });
});

describe("prix", () => {
  it("prixVenteOffre : prix de l'offre, sinon prix du produit", () => {
    expect(prixVenteOffre({ prix_unitaire: 10 }, { prix_vente: 12 })).toBe(12);
    expect(prixVenteOffre({ prix_unitaire: 10 }, { prix_vente: null })).toBe(10);
    expect(prixVenteOffre({ prix_unitaire: 10 }, null)).toBe(10);
    expect(prixVenteOffre({ prix_unitaire: 10 })).toBe(10);
  });
  it("margePct : (vente − achat) / achat, 1 décimale ; null si non calculable", () => {
    expect(margePct(10, 15)).toBe(50);
    expect(margePct(3, 4)).toBe(33.3);
    expect(margePct(10, 8)).toBe(-20);
    expect(margePct(0, 15)).toBeNull();
    expect(margePct(null, 15)).toBeNull();
    expect(margePct(10, null)).toBeNull();
  });
  it("fourchettePrix", () => {
    expect(fourchettePrix(prestation({ prix_unitaire: 25 }))).toEqual({ min: 25, max: 25 });
    const p = prestation({ prix_unitaire: 25, fournisseurs: [offre({ prix_vente: 20 }), offre({ id: "x", prix_vente: 30 }), offre({ id: "y", prix_vente: null })] });
    expect(fourchettePrix(p)).toEqual({ min: 20, max: 30 });
  });
});

describe("marques", () => {
  const p = prestation({
    nom: "Prise 2P+T", marque: "Legrand",
    fournisseurs: [offre({ id: "1", marque: "Legrand" }), offre({ id: "2", marque: "Schneider", fournisseur: "Cged" }), offre({ id: "3", marque: "legrand" })],
  });
  it("normTexte : sans accents ni ponctuation", () => {
    expect(normTexte("Câble  3G2,5 – Réf.")).toBe("cable 3g2 5 ref");
    expect(normTexte(null)).toBe("");
  });
  it("marquesDe : distinctes (casse ignorée) ; marqueVariable dès 2 marques", () => {
    expect(marquesDe(p)).toEqual(["Legrand", "Schneider"]);
    expect(marqueVariable(p)).toBe(true);
    expect(marqueVariable(prestation({ marque: "Legrand" }))).toBe(false);
    expect(marquesDe(prestation({ marque: " " }))).toEqual([]);
  });
  it("marqueOffre : celle de l'offre, sinon celle du produit", () => {
    expect(marqueOffre({ marque: "Legrand" }, { marque: "Schneider" })).toBe("Schneider");
    expect(marqueOffre({ marque: "Legrand" }, { marque: "" })).toBe("Legrand");
    expect(marqueOffre({ marque: undefined }, null)).toBe("");
  });
  it("nomAvecMarque : n'ajoute pas une marque déjà présente", () => {
    expect(nomAvecMarque("Prise 2P+T", "Schneider")).toBe("Prise 2P+T Schneider");
    expect(nomAvecMarque("Prise Legrand 2P+T", "Legrand")).toBe("Prise Legrand 2P+T");
    expect(nomAvecMarque("Prise", "")).toBe("Prise");
  });
  it("designationProduit : marque ajoutée seulement si le produit existe en plusieurs marques", () => {
    expect(designationProduit(p, p.fournisseurs![1])).toBe("Prise 2P+T Schneider");
    expect(designationProduit(p, null)).toBe("Prise 2P+T");
    const mono = prestation({ marque: "Legrand", fournisseurs: [offre({ marque: "Legrand" })] });
    expect(designationProduit(mono, mono.fournisseurs![0])).toBe("Prise 2P+T");
  });
  it("libelleOffreMarque / offresDeMarque", () => {
    expect(libelleOffreMarque(p, p.fournisseurs![1])).toBe("Schneider · Cged");
    expect(offresDeMarque(p, "LEGRAND").map(o => o.id)).toEqual(["1", "3"]);
  });
  it("imageOffre : image de l'offre, sinon celle du produit, sinon null", () => {
    expect(imageOffre({ image_url: "p.jpg" }, { image_url: "o.jpg" })).toBe("o.jpg");
    expect(imageOffre({ image_url: "p.jpg" }, { image_url: " " })).toBe("p.jpg");
    expect(imageOffre({ image_url: undefined }, null)).toBeNull();
  });
});
