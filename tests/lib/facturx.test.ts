import { describe, expect, it } from "vitest";
import { buildFacturXml, natureOperations, sirenFromSiret, verifierConformiteFacture } from "@/lib/facturx";
import { clientComplet, facture, ligneFacture, profilComplet } from "../helpers/fixtures";
import { verifierXmlBienForme } from "../helpers/xml";

const balise = (xml: string, nom: string) => xml.match(new RegExp(`<${nom}[^>]*>([^<]*)</${nom}>`))?.[1];

describe("sirenFromSiret / natureOperations", () => {
  it("SIREN = 9 premiers chiffres du SIRET, espaces ignorés", () => {
    expect(sirenFromSiret("123 456 789 00012")).toBe("123456789");
    expect(sirenFromSiret("12345")).toBe("");
    expect(sirenFromSiret(null)).toBe("");
  });
  it("S1 services / B1 biens / M1 mixte, y compris sans lignes (d'après les totaux)", () => {
    expect(natureOperations(facture({ lignes: [ligneFacture({ type_branche: "service" })] })).code).toBe("S1");
    expect(natureOperations(facture({ lignes: [ligneFacture({ type_branche: "materiau" })] })).code).toBe("B1");
    expect(natureOperations(facture({ lignes: [ligneFacture({ type_branche: "service" }), ligneFacture({ type_branche: "materiau" })] })).code).toBe("M1");
    expect(natureOperations(facture({ lignes: [], total_materiau: 10 })).code).toBe("B1");
    expect(natureOperations(facture({ lignes: [], total_service: 10, total_materiau: 5 })).code).toBe("M1");
  });
});

describe("verifierConformiteFacture", () => {
  const ok = facture({ lignes: [ligneFacture()] });
  it("dossier complet → aucun avertissement", () => {
    expect(verifierConformiteFacture(ok, profilComplet())).toEqual([]);
  });
  it("signale TVA intracom, SIRET, adresse, nom, client, lignes", () => {
    const w = verifierConformiteFacture(facture({ client: undefined, lignes: [] }), profilComplet({ numero_tva: "", siret: "123", adresse: "", nom_entreprise: "", nom: "" }));
    expect(w).toHaveLength(6);
  });
  it("client professionnel : SIRET/SIREN de 9 ou 14 chiffres exigé", () => {
    const pro = (siret: string) => facture({ lignes: [ligneFacture()], client: clientComplet({ type_client: "professionnel", siret_client: siret }) });
    expect(verifierConformiteFacture(pro(""), profilComplet())).toHaveLength(1);
    expect(verifierConformiteFacture(pro("123456789"), profilComplet())).toEqual([]);
    expect(verifierConformiteFacture(pro("123 456 789 00012"), profilComplet())).toEqual([]);
    expect(verifierConformiteFacture(pro("1234"), profilComplet())).toHaveLength(1);
  });
  it("profil null toléré", () => {
    expect(verifierConformiteFacture(ok, null).length).toBeGreaterThan(0);
  });
});

describe("buildFacturXml", () => {
  const f = facture({
    numero: "FAC-2026-007", total_ttc: 25, objet: "Remplacement <tableau> & prises",
    lignes: [ligneFacture({ nom: "Prise & \"cadre\"", quantite: 2, prix_unitaire: 10, unite: "u", ordre: 1 }), ligneFacture({ nom: "Main d'œuvre", quantite: 1.5, prix_unitaire: 10, unite: "heure", type_branche: "service", ordre: 0 })],
  });
  const xml = buildFacturXml(f, profilComplet());

  it("XML bien formé, caractères spéciaux échappés", () => {
    expect(verifierXmlBienForme(xml)).toEqual([]);
    expect(xml).toContain("Remplacement &lt;tableau&gt; &amp; prises");
    expect(xml).toContain("Prise &amp; &quot;cadre&quot;");
  });
  it("profil EN 16931, type 380, numéro, devise EUR", () => {
    expect(xml).toContain("urn:cen.eu:en16931:2017");
    expect(balise(xml, "ram:TypeCode")).toBe("380");
    expect(xml).toContain("<ram:ID>FAC-2026-007</ram:ID>");
    expect(xml).toContain("<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>");
    expect(xml).toContain('format="102">20261031<');
  });
  it("lignes triées par ordre, codes unité UN/ECE, quantités", () => {
    expect(xml.indexOf("Main d&apos;œuvre")).toBeLessThan(xml.indexOf("Prise &amp;"));
    expect(xml).toContain('unitCode="HUR">1.5<');
    expect(xml).toContain('unitCode="C62">2<');
  });
  it("sans remise : total lignes = TaxBasis = GrandTotal = DuePayable, pas d'AllowanceTotal", () => {
    const x = buildFacturXml(facture({ total_ttc: 35, lignes: f.lignes }), profilComplet());
    expect(balise(x, "ram:LineTotalAmount")).toBeDefined();
    expect(x).not.toContain("AllowanceTotalAmount");
    expect(x).not.toContain("ChargeTotalAmount");
    expect(balise(x, "ram:GrandTotalAmount")).toBe("35.00");
    expect(balise(x, "ram:DuePayableAmount")).toBe("35.00");
  });
  it("remise = écart entre lignes (35) et total (25) : AllowanceTotalAmount 10.00 et motif", () => {
    expect(xml).toContain("<ram:AllowanceTotalAmount>10.00</ram:AllowanceTotalAmount>");
    expect(xml).toContain("Remise commerciale");
    expect(balise(xml, "ram:GrandTotalAmount")).toBe("25.00");
    const motif = buildFacturXml({ ...f, remise_facture_montant: 10, remise_facture_motif: "Fidélité" }, profilComplet());
    expect(motif).toContain("Remise commerciale : Fidélité");
  });
  it("majoration (total > lignes) : ChargeTotalAmount", () => {
    const x = buildFacturXml(facture({ total_ttc: 50, lignes: f.lignes }), profilComplet());
    expect(x).toContain("<ram:ChargeTotalAmount>15.00</ram:ChargeTotalAmount>");
  });
  it("acomptes : TotalPrepaid plafonné au total, reste à payer jamais négatif", () => {
    const x = buildFacturXml(f, profilComplet(), [{ montant: 10, date_versement: "2026-10-01" }]);
    expect(x).toContain("<ram:TotalPrepaidAmount>10.00</ram:TotalPrepaidAmount>");
    expect(balise(x, "ram:DuePayableAmount")).toBe("15.00");
    const trop = buildFacturXml(f, profilComplet(), [{ montant: 999, date_versement: "2026-10-01" }]);
    expect(balise(trop, "ram:DuePayableAmount")).toBe("0.00");
    expect(balise(trop, "ram:TotalPrepaidAmount")).toBe("25.00");
  });
  it("vendeur : SIREN, TVA nettoyée ; acheteur pro identifié par SIREN, particulier par e-mail", () => {
    expect(xml).toContain('<ram:ID schemeID="0002">123456789</ram:ID>');
    expect(xml).toContain('schemeID="VA">FR12345678901<');
    expect(xml).toContain('schemeID="EM">jean@test.fr<');
    const pro = buildFacturXml({ ...f, client: clientComplet({ type_client: "professionnel", siret_client: "987 654 321 00019" }) }, profilComplet());
    expect(pro).toContain('schemeID="0225">987654321<');
  });
  it("robuste aux données incomplètes (aucun plantage, XML valide)", () => {
    const vide = buildFacturXml(facture({ client: undefined, lignes: undefined, total_ttc: undefined as unknown as number, date_emission: "n'importe quoi" }), profilComplet({ nom_entreprise: "", prenom: "", nom: "", siret: "", numero_tva: "" }));
    expect(verifierXmlBienForme(vide)).toEqual([]);
  });
  it("supprime les caractères de contrôle interdits en XML 1.0", () => {
    const x = buildFacturXml(facture({ total_ttc: 10, lignes: [ligneFacture({ nom: "A\u0001B\u0008C" })] }), profilComplet());
    expect(x).toContain("ABC");
    expect(verifierXmlBienForme(x)).toEqual([]);
  });
});
