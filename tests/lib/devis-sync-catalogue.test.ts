import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
import { appliquerPrixCatalogue, champsSynchronisables, prixApplicable, synchroniserAvecCatalogue } from "@/lib/devis-lignes";
import type { DevisLigne, Prestation } from "@/types";

const offre = (o: Record<string, unknown> = {}) => ({ id: "o1", prestation_id: "p1", fournisseur: "Rexel", prix_achat: 5, prix_vente: 10, principal: true, ...o });
const produit = (o: Record<string, unknown> = {}) => ({
  id: "p1", nom: "Prise 2P+T", prix_unitaire: 9, unite: "u", type_branche: "materiau", description: "Prise standard", image_url: null,
  updated_at: "2026-11-09T10:00:00Z", fournisseurs: [offre()], ...o,
}) as unknown as Prestation;
const ligne = (o: Record<string, unknown> = {}) => ({
  nom: "Prise 2P+T", quantite: 3, prix_unitaire: 10, unite: "u", type_branche: "materiau", prestation_id: "p1", kit_description: "Prise standard",
  fournisseur_id: "o1", fournisseur_nom: "Rexel", prix_achat: 5, image_url: null, poste: "Salon", ...o,
}) as DevisLigne;
const cat = (...p: Prestation[]) => new Map(p.map(x => [x.id, x]));
const ANCIEN = "2026-11-01T10:00:00Z";

describe("synchroniserAvecCatalogue", () => {
  it("rien à changer : mêmes lignes, aucune alerte", () => {
    const l = [ligne()];
    const r = synchroniserAvecCatalogue(l, cat(produit()), "brouillon", ANCIEN);
    expect(r.changements).toEqual([]); expect(r.prix).toEqual([]);
    expect(r.lignes[0]).toBe(l[0]);
  });
  it("nom, description, photo, fournisseur et prix d'achat suivent le catalogue ; quantité, poste, prix de vente, unité restent", () => {
    const p = produit({ nom: "Prise 2P+T Legrand", description: "Nouvelle", image_url: "http://img/x.png", unite: "boîte", type_branche: "service", fournisseurs: [offre({ fournisseur: "Cedeo", prix_achat: 6 })] });
    const r = synchroniserAvecCatalogue([ligne()], cat(p), "brouillon", ANCIEN);
    const l = r.lignes[0];
    expect(l).toMatchObject({ nom: "Prise 2P+T Legrand", kit_description: "Nouvelle", image_url: "http://img/x.png", fournisseur_nom: "Cedeo", prix_achat: 6 });
    expect(l).toMatchObject({ quantite: 3, poste: "Salon", prix_unitaire: 10, unite: "u", type_branche: "materiau" });
    expect(r.changements[0].champs.sort()).toEqual(["fournisseur_nom", "image_url", "kit_description", "nom", "prix_achat"]);
  });
  it("le prix de vente n'est jamais modifié : il est proposé", () => {
    const r = synchroniserAvecCatalogue([ligne({ prix_unitaire: 8 })], cat(produit()), "brouillon", ANCIEN);
    expect(r.lignes[0].prix_unitaire).toBe(8);
    expect(r.prix).toEqual([{ index: 0, nom: "Prise 2P+T", actuel: 8, catalogue: 10 }]);
    expect(appliquerPrixCatalogue(r.lignes, r.prix)[0].prix_unitaire).toBe(10);
  });
  it("devis envoyé : mêmes champs, prix proposé mais non applicable ; signé / refusé / expiré : rien", () => {
    const p = produit({ nom: "Autre nom" });
    expect(synchroniserAvecCatalogue([ligne({ prix_unitaire: 8 })], cat(p), "envoye", ANCIEN).changements).toHaveLength(1);
    expect(prixApplicable("envoye")).toBe(false); expect(prixApplicable("brouillon")).toBe(true);
    for (const st of ["signe", "refuse", "expire", undefined]) {
      const r = synchroniserAvecCatalogue([ligne({ prix_unitaire: 8 })], cat(p), st, ANCIEN);
      expect(r.changements).toEqual([]); expect(r.prix).toEqual([]); expect(champsSynchronisables(st)).toEqual([]);
    }
  });
  it("nom et description : repris seulement si le produit a été modifié après le dernier enregistrement du devis", () => {
    const p = produit({ nom: "Nom récent" });
    const r = synchroniserAvecCatalogue([ligne({ nom: "Libellé retouché" })], cat(p), "brouillon", "2026-12-01T00:00:00Z");
    expect(r.lignes[0].nom).toBe("Libellé retouché");
    expect(synchroniserAvecCatalogue([ligne({ nom: "Libellé retouché" })], cat(p), "brouillon", ANCIEN).lignes[0].nom).toBe("Nom récent");
  });
  it("produit supprimé du catalogue, ligne libre, ligne « à compléter » : intactes", () => {
    const l = [ligne({ prestation_id: "inconnu" }), ligne({ prestation_id: undefined }), ligne({ nom: "À compléter — Prise", prix_unitaire: 0 })];
    const r = synchroniserAvecCatalogue(l, cat(produit({ nom: "X" })), "brouillon", ANCIEN);
    expect(r.lignes.every((x, i) => x === l[i])).toBe(true);
  });
  it("offre retirée du catalogue : fournisseur, prix d'achat et nom conservés (seule la description suit)", () => {
    const p = produit({ nom: "Nouveau", description: "Neuve", fournisseurs: [offre({ id: "autre" })] });
    const r = synchroniserAvecCatalogue([ligne()], cat(p), "brouillon", ANCIEN);
    expect(r.lignes[0]).toMatchObject({ nom: "Prise 2P+T", fournisseur_nom: "Rexel", prix_achat: 5, kit_description: "Neuve" });
    expect(r.prix).toEqual([]);
  });
  it("ligne sans fournisseur choisi : son fournisseur saisi n'est pas effacé", () => {
    const r = synchroniserAvecCatalogue([ligne({ fournisseur_id: null, fournisseur_nom: "Chez Jean", prix_achat: 4 })], cat(produit()), "brouillon", ANCIEN);
    expect(r.lignes[0]).toMatchObject({ fournisseur_nom: "Chez Jean", prix_achat: 4 });
  });
  it("kit : nom et description suivent, prix et ventilation non", () => {
    const k = ligne({ kit_ratio_service: 0.6, prix_unitaire: 100, nom: "Kit ancien" });
    const r = synchroniserAvecCatalogue([k], cat(produit({ nom: "Kit salon", fournisseurs: [] })), "brouillon", ANCIEN);
    expect(r.lignes[0]).toMatchObject({ nom: "Kit salon", prix_unitaire: 100, kit_ratio_service: 0.6 });
    expect(r.prix).toEqual([]);
  });
  it("ne modifie pas le tableau d'origine", () => {
    const l = [ligne()]; const copie = JSON.stringify(l);
    synchroniserAvecCatalogue(l, cat(produit({ nom: "Z" })), "brouillon", ANCIEN);
    expect(JSON.stringify(l)).toBe(copie);
  });
});
