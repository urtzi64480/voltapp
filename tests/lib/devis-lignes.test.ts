import { describe, expect, it } from "vitest";
import {
  colonnesFournisseur, colonnesImage, changerFournisseurLigne, estLigneACompleter, fusionnerLigne, ligneDepuisArticle,
  nbLignesACompleter, PREFIXE_A_COMPLETER, remplacerProduitLigne, type LigneEdition,
} from "@/lib/devis-lignes";
import type { DevisLigne } from "@/types";
import { offre, prestation } from "../helpers/fixtures";

const rexel = offre({ id: "o-rexel", fournisseur: "Rexel", prix_achat: 6, prix_vente: 10, principal: true, marque: "Legrand" });
const cged = offre({ id: "o-cged", fournisseur: "Cged", prix_achat: 7, prix_vente: 12, marque: "Schneider" });
const produit = prestation({ id: "p1", nom: "Prise 2P+T", prix_unitaire: 9, marque: "Legrand", fournisseurs: [rexel, cged], description: "Prise confort" });

describe("ligneDepuisArticle", () => {
  it("utilise l'offre désignée : prix de vente, fournisseur et prix d'achat", () => {
    const l = ligneDepuisArticle(produit, cged, "Salon");
    expect(l).toMatchObject({ prestation_id: "p1", quantite: 1, prix_unitaire: 12, fournisseur_id: "o-cged", fournisseur_nom: "Cged", prix_achat: 7, poste: "Salon" });
    expect(l.nom).toContain("Schneider");
  });
  it("sans offre désignée : offre principale", () => {
    expect(ligneDepuisArticle(produit, undefined, null)).toMatchObject({ fournisseur_id: "o-rexel", prix_unitaire: 10, prix_achat: 6 });
  });
  it("produit sans offre : prix du catalogue, champs fournisseur à null", () => {
    const l = ligneDepuisArticle(prestation({ prix_unitaire: 9 }), null, null);
    expect(l).toMatchObject({ prix_unitaire: 9, fournisseur_id: null, fournisseur_nom: null, prix_achat: null });
  });
  it("conditionnement ajouté au nom pour un câble au rouleau", () => {
    const cable = prestation({ nom: "Câble 3G2.5", longueur_unitaire: 100, sous_categorie: "cablage_3g25" });
    expect(ligneDepuisArticle(cable, null, null).nom).toBe("Câble 3G2.5 (bobine 100m)");
  });
});

describe("fusionnerLigne", () => {
  const base = ligneDepuisArticle(produit, rexel, "Salon");
  it("même article, même poste, même fournisseur → quantités additionnées, sans mutation", () => {
    const prev = [base];
    const res = fusionnerLigne(prev, { ...base, quantite: 2 });
    expect(res).toHaveLength(1);
    expect(res[0].quantite).toBe(3);
    expect(prev[0].quantite).toBe(1);
  });
  it("poste, fournisseur ou nature (kit) différents → nouvelle ligne", () => {
    expect(fusionnerLigne([base], { ...base, poste: "Cuisine" })).toHaveLength(2);
    expect(fusionnerLigne([base], ligneDepuisArticle(produit, cged, "Salon"))).toHaveLength(2);
    expect(fusionnerLigne([base], { ...base, kit_ratio_service: 0.5 })).toHaveLength(2);
  });
  it("poste vide et poste absent sont le même poste (hors poste)", () => {
    const a: LigneEdition = { ...base, poste: "" }, b: LigneEdition = { ...base, poste: null };
    expect(fusionnerLigne([a], b)).toHaveLength(1);
  });
  it("une ligne sans prestation_id (saisie libre) n'est jamais fusionnée", () => {
    const libre: LigneEdition = { nom: "Libre", prix_unitaire: 5, quantite: 1, unite: "u", type_branche: "service" };
    expect(fusionnerLigne([libre], libre)).toHaveLength(2);
  });
});

describe("changerFournisseurLigne", () => {
  it("le prix de vente, le prix d'achat et le fournisseur suivent l'offre ; quantité et poste inchangés", () => {
    const l = { ...ligneDepuisArticle(produit, rexel, "Salon"), quantite: 4 };
    const r = changerFournisseurLigne(l, produit, cged);
    expect(r).toMatchObject({ quantite: 4, poste: "Salon", prix_unitaire: 12, fournisseur_id: "o-cged", prix_achat: 7 });
    expect(l.prix_unitaire).toBe(10);
  });
  it("le nom change avec la marque s'il n'a pas été retouché à la main, sinon il est conservé", () => {
    const auto = ligneDepuisArticle(produit, rexel, null);
    expect(changerFournisseurLigne(auto, produit, cged).nom).toContain("Schneider");
    const retouchee = { ...auto, nom: "Ma prise perso" };
    expect(changerFournisseurLigne(retouchee, produit, cged).nom).toBe("Ma prise perso");
  });
  it("offre = null → fournisseur non précisé, prix du catalogue", () => {
    const r = changerFournisseurLigne(ligneDepuisArticle(produit, rexel, null), produit, null);
    expect(r).toMatchObject({ fournisseur_id: null, fournisseur_nom: null, prix_achat: null, prix_unitaire: 9 });
  });
});

describe("remplacerProduitLigne", () => {
  it("remplace le produit en gardant quantité et poste, et sort du statut « kit »", () => {
    const autre = prestation({ id: "p2", nom: "Interrupteur", prix_unitaire: 5, unite: "u", type_branche: "materiau", description: "VV" });
    const l: LigneEdition = { ...ligneDepuisArticle(produit, rexel, "Salon"), quantite: 3, kit_ratio_service: 0.3 };
    const r = remplacerProduitLigne(l, autre, null);
    expect(r).toMatchObject({ nom: "Interrupteur", quantite: 3, poste: "Salon", prestation_id: "p2", prix_unitaire: 5, kit_ratio_service: null, kit_description: "VV", fournisseur_id: null });
  });
});

describe("lignes « à compléter »", () => {
  it("détection par préfixe", () => {
    expect(estLigneACompleter({ nom: `${PREFIXE_A_COMPLETER}Spot` })).toBe(true);
    expect(estLigneACompleter({ nom: "Spot" })).toBe(false);
    expect(estLigneACompleter({ nom: null })).toBe(false);
    expect(nbLignesACompleter([{ nom: `${PREFIXE_A_COMPLETER}A` }, { nom: "B" }, { nom: `${PREFIXE_A_COMPLETER}C` }])).toBe(2);
  });
});

describe("colonnes optionnelles (compatibilité base sans migration 003)", () => {
  const sans = [{ nom: "x" }] as DevisLigne[];
  it("colonnesFournisseur : rien d'envoyé si aucune ligne n'en porte ; sinon 3 colonnes sur TOUTES les lignes", () => {
    expect(colonnesFournisseur(sans)(sans[0])).toEqual({});
    const avec = [{ nom: "a", fournisseur_nom: "Rexel" }, { nom: "b" }] as DevisLigne[];
    const f = colonnesFournisseur(avec);
    expect(f(avec[0])).toEqual({ fournisseur_id: null, fournisseur_nom: "Rexel", prix_achat: null });
    expect(f(avec[1])).toEqual({ fournisseur_id: null, fournisseur_nom: null, prix_achat: null });
    const achat0 = [{ nom: "a", prix_achat: 0 }] as DevisLigne[];
    expect(colonnesFournisseur(achat0)(achat0[0])).toHaveProperty("prix_achat", 0);
  });
  it("colonnesImage : idem pour image_url", () => {
    expect(colonnesImage([{}])({})).toEqual({});
    const f = colonnesImage([{ image_url: "a.jpg" }, {}]);
    expect(f({ image_url: "a.jpg" })).toEqual({ image_url: "a.jpg" });
    expect(f({})).toEqual({ image_url: null });
  });
});
