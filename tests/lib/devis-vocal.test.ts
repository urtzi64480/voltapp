import { describe, expect, it } from "vitest";
import { analyserDictee, auMetreDisponible, chiffrer, chercherArticles, cleAlias, cleSon, corrigerReconnaissance, decouperDictee, detecterClient, lignesDeLaLigne, lignesDepuisDictee, motsCles, sonProche } from "@/lib/devis-vocal";
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

describe("erreurs de reconnaissance vocale", () => {
  it("corrige les transcriptions fréquentes", () => {
    expect(corrigerReconnaissance("2 virgule 5")).toBe("2,5");
    expect(corrigerReconnaissance("des joncteurs 16 ampères")).toBe("disjoncteur 16 ampères");
    expect(corrigerReconnaissance("disque joncteur")).toBe("disjoncteur");
    expect(corrigerReconnaissance("interrupteur va et viens")).toBe("interrupteur va et vient");
    expect(corrigerReconnaissance("RJ 45")).toBe("rj45");
    expect(corrigerReconnaissance("2,5 mm carré")).toBe("2,5 mm");
  });
  it("trouve le bon article malgré une transcription approximative", () => {
    expect(nom(analyserDictee("5 prisent 16 A", catalogue, []).lignes[0].choixAuto)).toBe("Prise 2P+T 16A");
    expect(nom(analyserDictee("3 spotte", catalogue, []).lignes[0].choixAuto)).toBe("Spot LED encastrable");
    expect(nom(analyserDictee("2 des joncteurs 20 ampères", catalogue, []).lignes[0].choixAuto)).toBe("Disjoncteur 20A");
    expect(nom(analyserDictee("20 mètres de câble 2 virgule 5", catalogue, []).lignes[0].choixAuto)).toBe("Câble R2V 3G2,5");
  });
  it("proximité phonétique prudente : pas de faux amis évidents", () => {
    expect(sonProche("prises", "prisent")).toBe(true);
    expect(sonProche("prise", "pile")).toBe(false);
    expect(sonProche("cable", "table")).toBe(false);
    expect(cleSon("")).toBe("");
  });
  it("« main d'œuvre » du catalogue est retrouvée même sans sous-catégorie", () => {
    const cat = [p("Main d'œuvre électricien", 50, { type_branche: "service", unite: "heure" })];
    expect(analyserDictee("2 heures de main d'oeuvre", cat, []).lignes[0].choixAuto).toBe(cat[0].id);
  });
  it("retient une correction de l'électricien (alias) et la réapplique", () => {
    const cible = catalogue.find(x => x.nom === "Interrupteur simple")!;
    const alias = { [cleAlias("bouton lumière")]: cible.id };
    expect(analyserDictee("2 bouton lumière", catalogue, [], alias).lignes[0]).toMatchObject({ choixAuto: cible.id, confiance: "haute" });
    expect(analyserDictee("2 bouton lumière", catalogue, [], {}).lignes[0].choixAuto).not.toBe(cible.id);
  });
});

describe("dictée naturelle (sans dire « plus »)", () => {
  const lib = (t: string) => decouperDictee(t).map(s => [s.quantite, s.libelle]);
  it("coupe à chaque nouvelle quantité", () => {
    expect(lib("5 prises 16 ampères 3 spots 1 disjoncteur différentiel 40 A 2 heures de main d'oeuvre")).toEqual([
      [5, "prises 16 ampères"], [3, "spots"], [1, "disjoncteur différentiel 40 A"], [2, "main d'oeuvre"],
    ]);
    expect(lib("cinq prises seize ampères trois spots un disjoncteur différentiel quarante ampères deux heures de main d'oeuvre")).toEqual([
      [5, "prises 16 ampères"], [3, "spots"], [1, "disjoncteur différentiel 40 ampères"], [2, "main d'oeuvre"],
    ]);
  });
  it("« un / une » après une préposition reste un article ; un nombre après « type » est une caractéristique", () => {
    expect(lib("deux prises pour une cuisine trois spots")).toEqual([[2, "prises pour une cuisine"], [3, "spots"]]);
    expect(lib("un parafoudre type 2 trois spots")).toEqual([[1, "parafoudre type 2"], [3, "spots"]]);
  });
  it("les nombres nus du libellé (section, calibre) ne coupent pas", () => {
    expect(lib("20 mètres de câble 2,5 trois spots")).toEqual([[20, "câble 2,5"], [3, "spots"]]);
    expect(lib("disjoncteur 16 trois prises")).toEqual([[1, "disjoncteur 16"], [3, "prises"]]);
    expect(lib("disjoncteur 16 un spot")).toEqual([[1, "disjoncteur 16"], [1, "spot"]]);
  });
  it("accepte aussi « + » (transcription de « plus ») et les anciens séparateurs", () => {
    expect(lib("5 prises + 3 spots")).toEqual([[5, "prises"], [3, "spots"]]);
    expect(lib("5 prises plus 3 spots et 2 interrupteurs")).toEqual([[5, "prises"], [3, "spots"], [2, "interrupteurs"]]);
  });
  it("dictée complète avec client, sans aucun séparateur", () => {
    const a = analyserDictee("devis pour Monsieur Dupont cinq prises seize ampères trois spots un disjoncteur différentiel quarante ampères deux heures de main d'oeuvre", catalogue, clients);
    expect(a.client?.id).toBe("c1");
    expect(a.lignes.map(l => nom(l.choixAuto))).toEqual(["Prise 2P+T 16A", "Spot LED encastrable", "Disjoncteur différentiel 40A type A", "Main d'œuvre électricien"]);
  });
});

describe("articles au mètre, comme dans le pré-devis", () => {
  const bobine = p("Câble 2,5 bobine", 90, { sous_categorie: "cable_2.5", longueur_unitaire: 50, unite: "u" });
  const auMetre = p("Câble 2,5 au mètre", 2, { sous_categorie: "cable_2.5", unite: "m" });
  const cat = [bobine, auMetre];
  const ligne = (t: string) => analyserDictee(t, cat, []).lignes[0];
  const choix = (q: number, id: string, cond?: "auto" | "metre") => ({ inclus: true, quantite: q, prestationId: id, conditionnement: cond });
  it("repère la longueur dictée", () => {
    expect(decouperDictee("20 mètres de câble 2,5")[0]).toMatchObject({ quantite: 20, metres: true, libelle: "câble 2,5" });
    expect(decouperDictee("2 bobines de câble 2,5")[0]).toMatchObject({ quantite: 2, bobines: true, libelle: "câble 2,5" });
  });
  it("bobines entières + reliquat au mètre (défaut du pré-devis)", () => {
    const l = lignesDeLaLigne(ligne("120 mètres de câble 2,5"), choix(120, bobine.id), cat, 0);
    expect(l.map(x => [x.quantite, x.prix_unitaire, x.prestation_id])).toEqual([[2, 90, bobine.id], [20, 2, auMetre.id]]);
    expect(l.every(x => x.poste === null)).toBe(true);
  });
  it("moins d'une bobine : tout le reliquat au mètre", () => {
    const l = lignesDeLaLigne(ligne("20 mètres de câble 2,5"), choix(20, bobine.id), cat, 0);
    expect(l.map(x => [x.quantite, x.prestation_id])).toEqual([[20, auMetre.id]]);
  });
  it("« tout au mètre » remplace les bobines", () => {
    const l = lignesDeLaLigne(ligne("120 mètres de câble 2,5"), choix(120, bobine.id, "metre"), cat, 0);
    expect(l.map(x => [x.quantite, x.prestation_id])).toEqual([[120, auMetre.id]]);
    expect(auMetreDisponible(bobine, cat)).toBe(true);
    expect(auMetreDisponible(bobine, [bobine])).toBe(false);
  });
  it("sans reliquat disponible : une bobine de plus, comme le pré-devis", () => {
    const l = lignesDeLaLigne(ligne("20 mètres de câble 2,5"), choix(20, bobine.id), [bobine], 0);
    expect(l.map(x => [x.quantite, x.prestation_id])).toEqual([[1, bobine.id]]);
  });
  it("« 2 bobines » : pas de découpage en mètres ; article ordinaire : ligne simple", () => {
    const l = lignesDeLaLigne(ligne("2 bobines de câble 2,5"), choix(2, bobine.id), cat, 0);
    expect(l.map(x => [x.quantite, x.prix_unitaire])).toEqual([[2, 90]]);
    const prise = catalogue[0];
    const lp = lignesDeLaLigne(analyserDictee("5 prises 16 A", catalogue, []).lignes[0], choix(5, prise.id), catalogue, 0);
    expect(lp).toHaveLength(1);
    expect(lp[0]).toMatchObject({ quantite: 5, prix_unitaire: 6 });
  });
  it("un câble dicté sans unité est compté en mètres", () => {
    const l = lignesDeLaLigne(ligne("30 câble 2,5"), choix(30, bobine.id), cat, 0);
    expect(l.map(x => [x.quantite, x.prestation_id])).toEqual([[30, auMetre.id]]);
  });
});

describe("découpage guidé par le catalogue", () => {
  const lib = (t: string) => decouperDictee(t, catalogue).map(x => [x.quantite, x.libelle]);
  it("coupe une dictée sans virgule ni quantité entre les articles reconnus", () => {
    expect(decouperDictee("prises 16 A spots interrupteur simple", catalogue)).toHaveLength(3);
    expect(decouperDictee("5 prises 16 A prises 20 A", catalogue)).toHaveLength(2);
  });
  it("ne coupe pas un article dont le nom contient plusieurs mots", () => {
    expect(lib("disjoncteur différentiel 40 A type A")).toHaveLength(1);
    expect(lib("interrupteur va et vient")).toHaveLength(1);
  });
  it("un texte inconnu reste entier", () => {
    expect(decouperDictee("machin truc bidule chose", catalogue)).toHaveLength(1);
  });
  it("sans catalogue, comportement inchangé", () => {
    expect(decouperDictee("prises 16 A spots interrupteur simple")).toHaveLength(1);
  });
  it("coupe avant « main d'oeuvre » mais pas dans « 3 heures de main d'oeuvre »", () => {
    expect(decouperDictee("5 spots main d'oeuvre").length).toBe(2);
    expect(decouperDictee("3 heures de main d'oeuvre")).toHaveLength(1);
  });
  it("ignore une mention de client non reconnue", () => {
    const l = analyserDictee("5 prises 16 A pour monsieur Zorglub", catalogue, clients).lignes;
    expect(l).toHaveLength(1);
    expect(nom(l[0].choixAuto)).toBe("Prise 2P+T 16A");
  });
  it("reste rapide sur un gros catalogue", () => {
    const gros = Array.from({ length: 400 }, (_, i) => p(`Article ${i} réf ${i * 7} modèle ${i % 13}`, 10));
    const t0 = Date.now();
    decouperDictee(Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? "prise" : i % 3 === 1 ? "spot" : "article")).join(" "), [...catalogue, ...gros]);
    expect(Date.now() - t0).toBeLessThan(300);
  });
});
