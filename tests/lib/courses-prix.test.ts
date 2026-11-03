import { describe, expect, it } from "vitest";
import { achatHtDepuisTtc, associerPrixAuxCases, buildVuePrix, clePrixLigne, siteDeUrl, TVA_ACHAT_PCT, urlProduitSure } from "@/lib/courses-prix";
import { TAUX_PAR_DEFAUT } from "@/lib/rentabilite";

const mat = (o: Record<string, unknown> = {}) => ({ nom: "Prise", quantite: 1, prix_unitaire: 10, type_branche: "materiau", unite: "u", fournisseur_nom: "Rexel", ...o });
const taux = TAUX_PAR_DEFAUT; // 12,3 % de cotisations matériau, 0 % d'impôt

describe("TVA", () => {
  it("TVA d'achat à 20 % comme le catalogue ; HT = TTC ÷ 1,2 au centime", () => {
    expect(TVA_ACHAT_PCT).toBe(20);
    expect(achatHtDepuisTtc(12)).toBe(10);
    expect(achatHtDepuisTtc(6)).toBe(5);
    expect(achatHtDepuisTtc(7.5)).toBe(6.25);
    expect(achatHtDepuisTtc(0)).toBe(0);
  });
});

describe("buildVuePrix — une ligne", () => {
  it("vente annoncée, achat TTC/HT, plafond TTC/HT (40 prises vendues 10 €, achetées 6 € TTC)", () => {
    const v = buildVuePrix([mat({ nom: "Prise 16 A", quantite: 40, prix_achat: 6 })], taux);
    const l = v.groupes[0].lignes[0];
    expect(l).toMatchObject({
      qty: 40, venteUnitaire: 10, venteTotal: 400,
      achatTtcUnitaire: 6, achatHtUnitaire: 5, achatTtcTotal: 240, achatHtTotal: 200,
      maxTtcUnitaire: 8.77, maxHtUnitaire: 7.30, maxTtcTotal: 350.8, maxHtTotal: 292.33,
      aPerte: false,
    });
  });

  it("le plafond HT, remonté en TTC, ne dépasse jamais le plafond TTC (arrondi vers le bas)", () => {
    for (const vente of [0.99, 1.37, 3.33, 7.5, 12.9, 19.99, 45.45, 123.456]) {
      const l = buildVuePrix([mat({ prix_unitaire: vente, prix_achat: 1 })], taux).groupes[0].lignes[0];
      expect(l.maxHtUnitaire * 1.2).toBeLessThanOrEqual(l.maxTtcUnitaire + 0.0051);
      // et c'est le plus grand centime HT qui respecte le plafond TTC
      expect((l.maxHtUnitaire + 0.01) * 1.2).toBeGreaterThan(l.maxTtcUnitaire - 1e-9);
    }
  });

  it("à perte dès que l'achat TTC dépasse le plafond TTC d'un centime ; pile au plafond → pas à perte", () => {
    const g = buildVuePrix([
      mat({ nom: "A", prix_achat: 8.78 }), mat({ nom: "B", prix_achat: 8.77 }), mat({ nom: "C", prix_achat: 3 }),
    ], taux);
    expect(Object.fromEntries(g.groupes[0].lignes.map(l => [l.nom, l.aPerte]))).toEqual({ A: true, B: false, C: false });
    expect(g.nbAPerte).toBe(1);
  });

  it("ligne sans prix d'achat : plafond affiché, achat à null, comptée à part et exclue des totaux", () => {
    const v = buildVuePrix([mat({ nom: "A", prix_unitaire: 10, prix_achat: 5 }), mat({ nom: "B", prix_unitaire: 100 })], taux);
    const b = v.groupes[0].lignes.find(l => l.nom === "B")!;
    expect(b).toMatchObject({ achatTtcUnitaire: null, achatHtUnitaire: null, achatTtcTotal: null, achatHtTotal: null, maxTtcUnitaire: 87.7, aPerte: false });
    expect(v.nbSansPrix).toBe(1);
    expect(v.totaux).toMatchObject({ vente: 10, achatTtc: 5, maxTtc: 8.77 });
  });

  it("achat à 0 € renseigné (offert) : pas à perte, HT 0", () => {
    const l = buildVuePrix([mat({ prix_achat: 0 })], taux).groupes[0].lignes[0];
    expect(l).toMatchObject({ achatTtcUnitaire: 0, achatHtUnitaire: 0, aPerte: false });
  });
});

describe("buildVuePrix — taux, remise, kits", () => {
  it("l'impôt (versement libératoire) réduit le plafond", () => {
    const l = buildVuePrix([mat({ prix_unitaire: 100, prix_achat: 1 })], { ...taux, irMateriau: 1 }).groupes[0].lignes[0];
    expect(l.maxTtcUnitaire).toBe(86.7);
  });
  it("remise sur le devis : le plafond baisse, le prix annoncé reste celui du devis", () => {
    const l = buildVuePrix([mat({ prix_unitaire: 100, prix_achat: 80 })], taux, 0.9).groupes[0].lignes[0];
    expect(l.venteUnitaire).toBe(100);
    expect(l.maxTtcUnitaire).toBe(78.93);
    expect(l.aPerte).toBe(true); // 80 > 78,93 : sans la remise (plafond 87,70) ce ne l'était pas
  });
  it("kits comptés et ignorés ; services ignorés", () => {
    const v = buildVuePrix([mat({ kit_ratio_service: 0.5 }), { nom: "Pose", type_branche: "service", prix_unitaire: 50, quantite: 1 }], taux);
    expect(v).toMatchObject({ groupes: [], nbKitsIgnores: 1, nbSansPrix: 0, nbAPerte: 0 });
    expect(v.totaux).toEqual({ vente: 0, achatTtc: 0, achatHt: 0, maxTtc: 0, maxHt: 0 });
  });
  it("entrée nulle ou vide → vue vide", () => {
    expect(buildVuePrix(null as unknown as [], taux).groupes).toEqual([]);
    expect(buildVuePrix([], taux).nbAPerte).toBe(0);
  });
});

describe("buildVuePrix — regroupement et totaux", () => {
  it("même produit, mêmes prix : quantités additionnées ; prix différents : lignes séparées", () => {
    const v = buildVuePrix([
      mat({ nom: "Prise", quantite: 3, prix_achat: 6 }), mat({ nom: "prise", quantite: 2, prix_achat: 6 }), mat({ nom: "Prise", quantite: 1, prix_achat: 7 }),
    ], taux);
    expect(v.groupes[0].lignes.map(l => [l.qty, l.achatTtcUnitaire]).sort()).toEqual([[1, 7], [5, 6]]);
  });
  it("totaux par fournisseur et global = somme des lignes qui ont un prix d'achat", () => {
    const v = buildVuePrix([
      mat({ nom: "A", quantite: 4, prix_unitaire: 10, prix_achat: 6, fournisseur_nom: "Rexel" }),
      mat({ nom: "B", quantite: 1, prix_unitaire: 20, prix_achat: 12, fournisseur_nom: "Rexel" }),
      mat({ nom: "C", quantite: 2, prix_unitaire: 50, prix_achat: 30, fournisseur_nom: "Cged" }),
    ], taux);
    const rexel = v.groupes.find(g => g.fournisseur === "Rexel")!.totaux;
    expect(rexel).toEqual({ vente: 60, achatTtc: 36, achatHt: 30, maxTtc: 52.62, maxHt: 43.84 });
    const cged = v.groupes.find(g => g.fournisseur === "Cged")!.totaux;
    expect(cged).toEqual({ vente: 100, achatTtc: 60, achatHt: 50, maxTtc: 87.7, maxHt: 73.08 });
    expect(v.totaux).toEqual({ vente: 160, achatTtc: 96, achatHt: 80, maxTtc: 140.32, maxHt: 116.92 });
  });
  it("fournisseurs triés, « non précisé » en dernier", () => {
    const v = buildVuePrix([mat({ fournisseur_nom: "" }), mat({ fournisseur_nom: "Rexel" }), mat({ fournisseur_nom: "Cged" })], taux);
    expect(v.groupes.map(g => g.fournisseur)).toEqual(["Cged", "Rexel", null]);
  });
  it("arrondis au centime, sans dérive flottante", () => {
    const l = buildVuePrix([mat({ quantite: 3, prix_unitaire: 0.1, prix_achat: 0.07 })], taux).groupes[0].lignes[0];
    expect(l.venteTotal).toBe(0.3);
    expect(l.achatTtcTotal).toBe(0.21);
  });
});

describe("urlProduitSure / siteDeUrl", () => {
  it("accepte http(s) ; ajoute https:// à un lien saisi sans protocole", () => {
    expect(urlProduitSure("https://www.rexel.fr/p/123")).toBe("https://www.rexel.fr/p/123");
    expect(urlProduitSure("http://exemple.fr/a?b=1")).toBe("http://exemple.fr/a?b=1");
    expect(urlProduitSure("  cged.fr/produit/9 ")).toBe("https://cged.fr/produit/9");
  });
  it("refuse tout autre schéma (javascript:, data:, file:…), le vide et l'illisible", () => {
    expect(urlProduitSure("javascript:alert(1)")).toBeNull();
    expect(urlProduitSure("JaVaScRiPt:alert(1)")).toBeNull();
    expect(urlProduitSure("data:text/html,<script>1</script>")).toBeNull();
    expect(urlProduitSure("file:///etc/passwd")).toBeNull();
    expect(urlProduitSure("")).toBeNull();
    expect(urlProduitSure(null)).toBeNull();
    expect(urlProduitSure("http://")).toBeNull();
  });
  it("nom court du site sans www", () => {
    expect(siteDeUrl("https://www.rexel.fr/p/123")).toBe("rexel.fr");
    expect(siteDeUrl("https://cged.fr")).toBe("cged.fr");
  });
});

describe("clePrixLigne", () => {
  it("même clé que les lignes de la vue prix (nom en minuscules, achat, vente)", () => {
    const l = mat({ nom: "Prise 2P+T", prix_achat: 6, prix_unitaire: 10 });
    const v = buildVuePrix([l], taux);
    expect(clePrixLigne(l)).toBe(v.groupes[0].lignes[0].cle);
    expect(clePrixLigne(mat({ nom: "PRISE 2P+T", prix_achat: 6, prix_unitaire: 10 }))).toBe(clePrixLigne(l));
    expect(clePrixLigne(mat({ prix_achat: undefined }))).toContain("|?|");
  });
});

describe("associerPrixAuxCases", () => {
  const A = mat({ nom: "Prise", prix_achat: 6, quantite: 4 });
  const B = mat({ nom: "Disjoncteur", prix_achat: 9, prix_unitaire: 20 });
  const groupe = () => buildVuePrix([A, B], taux).groupes[0];

  it("chaque case reçoit le prix de la ligne dont elle provient", () => {
    const r = associerPrixAuxCases(groupe(), [{ key: "disjoncteur", sources: [B] }, { key: "prise", sources: [A] }]);
    expect(r.parCase.get("prise")![0].nom).toBe("Prise");
    expect(r.parCase.get("disjoncteur")![0].nom).toBe("Disjoncteur");
    expect(r.orphelines).toEqual([]);
  });
  it("article en plusieurs pièces : un seul prix, sur la première case ; les autres cases n'en ont pas", () => {
    const r = associerPrixAuxCases(groupe(), [
      { key: "mécanisme — prise", sources: [A] }, { key: "enjoliveur — prise", sources: [A] }, { key: "disjoncteur", sources: [B] },
    ]);
    expect(r.parCase.get("mécanisme — prise")).toHaveLength(1);
    expect(r.parCase.has("enjoliveur — prise")).toBe(false);
    expect(r.parCase.get("disjoncteur")).toHaveLength(1);
  });
  it("une case issue de plusieurs lignes du devis cumule leurs prix", () => {
    const A2 = mat({ nom: "Prise", prix_achat: 7, quantite: 1 });
    const g = buildVuePrix([A, A2], taux).groupes[0];
    const r = associerPrixAuxCases(g, [{ key: "prise", sources: [A, A2] }]);
    expect(r.parCase.get("prise")).toHaveLength(2);
  });
  it("aucun prix perdu : une ligne que nulle case ne porte est rendue en orpheline", () => {
    const r = associerPrixAuxCases(groupe(), [{ key: "prise", sources: [A] }]);
    expect(r.orphelines.map(l => l.nom)).toEqual(["Disjoncteur"]);
  });
  it("kits, services et sources vides ignorés ; groupe absent → rien", () => {
    const kit = mat({ nom: "Kit", kit_ratio_service: 0.5 });
    const r = associerPrixAuxCases(groupe(), [{ key: "kit", sources: [kit, null as unknown as object] }, { key: "x" }]);
    expect(r.parCase.size).toBe(0);
    expect(r.orphelines).toHaveLength(2);
    expect(associerPrixAuxCases(undefined, [{ key: "a", sources: [A] }])).toEqual({ parCase: new Map(), orphelines: [] });
  });
});
