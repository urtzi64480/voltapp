import { describe, expect, it } from "vitest";
import { ajouterVersion, detecterMode, reconstruireDepuisDevis, type LigneDevisLue } from "@/lib/predevis-depuis-devis";
import { POSTE_CABLAGE, POSTE_MAIN_OEUVRE, type BesoinApparie, type OptionArticle } from "@/lib/predevis-engine";
import type { Prestation } from "@/types";

const opt = (id: string, nom: string, extra: Partial<OptionArticle> = {}): OptionArticle => ({ prestation_id: id, nom, prix_unitaire: 5, unite: "u", type_branche: "materiau", gamme: null, longueur_unitaire: null, ...extra });
const besoin = (cle: string, piece: string, options: OptionArticle[], extra: Partial<BesoinApparie> = {}): BesoinApparie =>
  ({ cle, sousCategorie: cle.split("@")[0], label: cle.split("@")[0], piece, quantite: 1, unite: "u", options, ...extra });
const l = (nom: string, poste: string | null, o: Partial<LigneDevisLue> = {}): LigneDevisLue => ({ nom, poste, quantite: 1, prix_unitaire: 10, unite: "u", type_branche: "materiau", ...o });

describe("detecterMode", () => {
  it("circuit / pièce / inconnu", () => {
    expect(detecterMode([{ poste: "Circuit · Prises (RDC)" }, { poste: POSTE_MAIN_OEUVRE }])).toBe("circuit");
    expect(detecterMode([{ poste: "Salon" }, { poste: POSTE_CABLAGE }])).toBe("piece");
    expect(detecterMode([{ poste: null }, { poste: POSTE_MAIN_OEUVRE }])).toBeNull();
  });
});

describe("reconstruireDepuisDevis", () => {
  const prise = [opt("a", "Prise éco"), opt("b", "Prise std"), opt("c", "Prise haut")];
  const besoins = [besoin("prise@1", "Salon", prise), besoin("spot@1", "Salon", [opt("s", "Spot")]), besoin("prise@2", "Cuisine", prise)];
  const lignes: LigneDevisLue[] = [
    l("Prise haut", "Salon", { prestation_id: "c" }),
    l("Prise std", "Cuisine", { prestation_id: "b" }),
    l("Main d'œuvre — câblage", "Salon", { unite: "heure", quantite: 2.5, type_branche: "service" }),
    l("Main d'œuvre — appareillage", "Salon", { unite: "heure", quantite: 1, type_branche: "service" }),
    l("Main d'œuvre", POSTE_MAIN_OEUVRE, { unite: "heure", quantite: 3, type_branche: "service" }),
    l("Frais généraux", POSTE_MAIN_OEUVRE, { prix_unitaire: 20, type_branche: "service" }),
    l("Déplacement", POSTE_MAIN_OEUVRE, { prix_unitaire: 35, type_branche: "service" }),
  ];
  it("retrouve mode, articles choisis, exclusions, heures, frais et déplacement", () => {
    const r = reconstruireDepuisDevis(lignes, besoins, [] as Prestation[]);
    expect(r.mode).toBe("piece");
    expect(r.choix["prise@1"]).toMatchObject({ mode: "option", optionIndex: 2 });
    expect(r.choix["prise@2"]).toMatchObject({ mode: "option", optionIndex: 1 });
    expect(r.choix["spot@1"]).toMatchObject({ mode: "exclu" });   // poste « Salon » présent, mais aucun spot dans le devis
    expect(r.hCablage).toEqual({ Salon: "2.5" });
    expect(r.hAppareils).toEqual({ Salon: "1" });
    expect(r.mainOeuvreHeures).toBe("3");
    expect(r.deplacementEur).toBe("35");
    expect(Number(r.fraisGenerauxPct)).toBeGreaterThan(0);
  });
  it("devis sans postes : heures reprises en main d'œuvre générale, avec avertissement", () => {
    const r = reconstruireDepuisDevis([l("Prise std", null, { prestation_id: "b" }), l("Main d'œuvre", null, { unite: "heure", quantite: 6, type_branche: "service" })], besoins, []);
    expect(r.mainOeuvreHeures).toBe("6");
    expect(r.hCablage).toEqual({});
    expect(r.avertissements.join(" ")).toMatch(/regroup/i);
    expect(r.choix["prise@1"]).toMatchObject({ mode: "option", optionIndex: 1 });
  });
  it("câbles agrégés : bobine → auto, article au mètre seul → tout au mètre", () => {
    const bobine = opt("bob", "Câble bobine", { longueur_unitaire: 100, sousCategorieArticle: "cable_2.5" });
    const agr = besoin("AGREGE_cablage_2.5", POSTE_CABLAGE, [bobine], { sousCategorie: "cablage_2.5", unite: "m", quantite: 150 });
    const metre = { id: "met", actif: true, sous_categorie: "cable_2.5", gamme: null } as unknown as Prestation;
    expect(reconstruireDepuisDevis([l("Câble", POSTE_CABLAGE, { prestation_id: "bob" })], [agr], [metre]).choixAgrege[agr.cle]).toMatchObject({ optionIndex: 0, conditionnement: "auto" });
    expect(reconstruireDepuisDevis([l("Câble au mètre", POSTE_CABLAGE, { prestation_id: "met" })], [agr], [metre]).choixAgrege[agr.cle]).toMatchObject({ optionIndex: 0, conditionnement: "metre" });
  });
});

describe("ajouterVersion", () => {
  it("remplace l'instantané d'un même devis et borne le nombre de versions", () => {
    let v = ajouterVersion([], { id: "1", date: "", label: "a", devisId: "d1", contenu: "{}" });
    v = ajouterVersion(v, { id: "2", date: "", label: "b", devisId: "d1", contenu: "{}" });
    expect(v.map(x => x.id)).toEqual(["2"]);
    for (let i = 0; i < 10; i++) v = ajouterVersion(v, { id: `x${i}`, date: "", label: "", contenu: "{}" });
    expect(v).toHaveLength(6);
  });
});
