import { describe, expect, it } from "vitest";
import { extraireReference } from "@/lib/extraire-reference";

describe("extraireReference", () => {
  it("JSON-LD : mpn prioritaire sur sku, nom et EAN récupérés", () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"Prise 2P+T","mpn":"MPN-1","sku":"SKU-9","gtin13":"3245060000000"}</script>`;
    const r = extraireReference(html);
    expect(r.reference).toBe("MPN-1");
    expect(r.candidats.map(c => c.valeur)).toEqual(expect.arrayContaining(["MPN-1", "SKU-9"]));
    expect(r.nomProduit).toBe("Prise 2P+T");
    expect(r.ean).toBe("3245060000000");
  });
  it("JSON-LD dans un @graph", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":"Product","sku":"G-1"}]}</script>`;
    expect(extraireReference(html).reference).toBe("G-1");
  });
  it("JSON-LD invalide ignoré sans lever d'exception", () => {
    expect(() => extraireReference(`<script type="application/ld+json">{oups</script>`)).not.toThrow();
  });
  it("microdonnées et balises meta", () => {
    expect(extraireReference(`<meta itemprop="sku" content="MS-5">`).reference).toBe("MS-5");
    expect(extraireReference(`<meta property="product:retailer_item_id" content="RT-7">`).reference).toBe("RT-7");
  });
  it("valeurs vides, « null », trop longues : écartées", () => {
    const html = `<script type="application/ld+json">{"@type":"Product","mpn":"N/A","sku":"${"x".repeat(80)}"}</script>`;
    expect(extraireReference(html)).toMatchObject({ reference: null, candidats: [] });
  });
  it("page vide → aucun résultat", () => {
    expect(extraireReference("")).toMatchObject({ reference: null, candidats: [], nomProduit: null, ean: null });
  });
});
