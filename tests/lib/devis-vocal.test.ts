import { describe, expect, it } from "vitest";
import { analyserDictee, chiffrer, chercherArticles, decouperDictee, detecterClient, lignesDepuisDictee, motsCles } from "@/lib/devis-vocal";
import type { Prestation } from "@/types";

let n = 0;
const p = (nom: string, prix: number, o: Partial<Prestation> = {}): Prestation => ({
  id: `p${++n}`, user_id: "u", nom, prix_unitaire: prix, unite: "u", type_branche: "materiau", categorie: "Matériel", actif: true, created_at: "", ...o,
});
const catalogue: Prestation[] = [
  p("Prise 2P+T 16A", 6), p("Prise 2P+T 20A", 8), p("Spot LED encastrable", 12), p("Interrupteur va-et-vient", 7), p("Interrupteur simple", 5),
  p("Disjoncteur 16A", 9), p("Disjoncteur 20A", 10), p("Disjoncteur différentiel 40A type A", 38), p("Câble R2V 3G2,5", 2, { unite: "m" }),
  p("Main d'œuvre électricien", 55, { type_branche: "service", unite: "heure", sous_categorie: "main_oeuvre" }),
];
const clients = [{ id: "c1", nom: "Dupont", prenom: "Jean" }, { id: "c2", nom: "Martin", prenom: "Luc" }, { id: "c3", nom: "Martin", prenom: "Anne" }];
const nom = (id: string | null) => catalogue.find(x => x.id === id)?.nom;

describe("chiffrer", () => {
  it("convertit les nombres en lettres, pas les articles « un/une » en milieu de phrase", () => {
    expect(chiffrer("cinq prises")).toBe("5 prises");
    expect(chiffrer("vingt et un spots")).toBe("21 spots");
    expect(chiffrer("quatre-vingt-dix mètres")).toBe("90 mètres");
    expect(chiffrer("dix-huit")).toBe("18");
    expect(chiffrer("deux cent trente prises")).toBe("230 prises");
    expect(chiffrer("pour une cuisine")).toBe("pour une cuisine");
    expect(chiffrer("une prise")).toBe("1 prise");
  });
});

describe("decouperDictee", () => {
  it("sépare les articles et lit les quantités", () => {
    const s = decouperDictee("5 prises 16 A, trois spots et un disjoncteur différentiel 40 A");
    expect(s.map(x => [x.quantite, x.libelle])).toEqual([[5, "prises 16 A"], [3, "spots"], [1, "disjoncteur différentiel 40 A"]]);
  });
  it("ne coupe pas « va-et-vient » ni « fourniture et pose »", () => {
    const s = decouperDictee("fourniture et pose de 2 interrupteurs va et vient");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ quantite: 2 });
    expect(s[0].libelle).toMatch(/va et vient/);
  });
  it("reconnaît la main d'œuvre en heures, y compris « et demie »", () => {
    expect(decouperDictee("2 heures de main d'oeuvre")[0]).toMatchObject({ heures: true, quantite: 2 });
    expect(decouperDictee("trois heures et demie de main d'oeuvre")[0]).toMatchObject({ heures: true, quantite: 3.5 });
    expect(decouperDictee("une demi-heure de main d'oeuvre")[0]).toMatchObject({ heures: true, quantite: 0.5 });
  });
  it("retire les mots de remplissage et gère le vide", () => {
    expect(decouperDictee("ajoute 4 prises")[0]).toMatchObject({ quantite: 4, libelle: "prises" });
    expect(decouperDictee("")).toEqual([]);
    expect(decouperDictee("  ,  . ")).toEqual([]);
  });
  it("20 mètres de câble : la quantité est 20, l'unité parlée est retirée du libellé", () => {
    expect(decouperDictee("20 mètres de câble 2,5")[0]).toMatchObject({ quantite: 20, libelle: "câble 2,5" });
  });
});

describe("detecterClient", () => {
  it("reconnaît « pour Monsieur Dupont » et le retire de la dictée", () => {
    const r = detecterClient("Devis pour Monsieur Dupont, 5 prises", clients);
    expect(r.client?.id).toBe("c1");
    expect(r.reste).not.toMatch(/dupont/i);
    expect(r.reste).toMatch(/5 prises/);
  });
  it("prénom + nom lève l'ambiguïté ; sinon aucun client", () => {
    expect(detecterClient("pour Anne Martin 3 spots", clients).client?.id).toBe("c3");
    expect(detecterClient("pour Martin 3 spots", clients).client).toBeNull();
    expect(detecterClient("5 prises", clients).client).toBeNull();
  });
});

describe("chercherArticles", () => {
  it("le calibre dicté départage les articles", () => {
    expect(nom(chercherArticles("prises 16 ampères", catalogue)[0].prestation.id)).toBe("Prise 2P+T 16A");
    expect(nom(chercherArticles("prises 20 A", catalogue)[0].prestation.id)).toBe("Prise 2P+T 20A");
    expect(nom(chercherArticles("disjoncteur 20", catalogue)[0].prestation.id)).toBe("Disjoncteur 20A");
  });
  it("tolère pluriel, accents et jargon", () => {
    expect(motsCles("Disjoncteurs différentiels")).toEqual(["disjoncteur", "differentiel"]);
    expect(nom(chercherArticles("spots", catalogue)[0].prestation.id)).toBe("Spot LED encastrable");
    expect(nom(chercherArticles("diff 40 A", catalogue)[0].prestation.id)).toBe("Disjoncteur différentiel 40A type A");
  });
  it("ne propose rien pour un mot absent du catalogue", () => {
    expect(chercherArticles("jacuzzi", catalogue)).toEqual([]);
  });
});

describe("analyserDictee + lignesDepuisDictee", () => {
  const dictee = "Devis pour Monsieur Dupont, 5 prises 16 A, trois spots, un disjoncteur différentiel 40 A, 2 heures de main d'oeuvre et une baignoire balnéo";
  const a = analyserDictee(dictee, catalogue, clients);
  it("reconnaît le client et choisit les bons articles", () => {
    expect(a.client?.id).toBe("c1");
    expect(a.lignes).toHaveLength(5);
    expect(a.lignes.slice(0, 4).map(l => nom(l.choixAuto))).toEqual(["Prise 2P+T 16A", "Spot LED encastrable", "Disjoncteur différentiel 40A type A", "Main d'œuvre électricien"]);
    expect(a.lignes[4].choixAuto).toBeNull();
  });
  it("génère les lignes avec les prix du catalogue, et « À compléter » à 0 € sans article", () => {
    const l = lignesDepuisDictee(a.lignes, x => ({ inclus: true, quantite: x.segment.quantite, prestationId: x.choixAuto }), catalogue, 50);
    expect(l.map(x => [x.quantite, x.prix_unitaire])).toEqual([[5, 6], [3, 12], [1, 38], [2, 55], [1, 0]]);
    expect(l[4].nom).toMatch(/^À compléter — /);
  });
  it("main d'œuvre sans article au catalogue : taux horaire du profil ; sans taux : « À compléter »", () => {
    const sansMO = catalogue.filter(x => x.sous_categorie !== "main_oeuvre");
    const b = analyserDictee("3 heures de main d'oeuvre", sansMO, []);
    const choix = (x: { segment: { quantite: number } }) => ({ inclus: true, quantite: x.segment.quantite, prestationId: null });
    expect(lignesDepuisDictee(b.lignes, choix, sansMO, 48)[0]).toMatchObject({ nom: "Main d'œuvre", quantite: 3, prix_unitaire: 48, type_branche: "service" });
    expect(lignesDepuisDictee(b.lignes, choix, sansMO, 0)[0].nom).toMatch(/^À compléter/);
  });
  it("une ligne décochée est ignorée, un même article dicté deux fois est additionné", () => {
    const b = analyserDictee("2 spots, 3 spots", catalogue, []);
    const l = lignesDepuisDictee(b.lignes, x => ({ inclus: true, quantite: x.segment.quantite, prestationId: x.choixAuto }), catalogue, 0);
    expect(l).toHaveLength(1);
    expect(l[0].quantite).toBe(5);
    expect(lignesDepuisDictee(b.lignes, () => ({ inclus: false, quantite: 1, prestationId: null }), catalogue, 0)).toEqual([]);
  });
  it("clés stables et uniques pour deux segments identiques", () => {
    const b = analyserDictee("2 spots, 2 spots", catalogue, []);
    expect(new Set(b.lignes.map(x => x.cle)).size).toBe(2);
  });
});
