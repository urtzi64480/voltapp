// src/lib/extraire-reference.ts
//
// Lit le HTML d'une fiche produit fournisseur et en tire la RÉFÉRENCE du produit. Pur (sans réseau) : testable à part.
// Sources par ordre de fiabilité : données structurées schema.org (JSON-LD : mpn > sku > productID), microdonnées
// (itemprop), balises <meta> produit, puis texte visible (« Réf. : … », « Référence fabricant … »).

export type SourceReference = "json-ld" | "microdonnees" | "meta" | "texte";
export interface CandidatReference { valeur: string; source: SourceReference; type: string }
export interface ExtractionReference { reference: string | null; candidats: CandidatReference[]; nomProduit: string | null; ean: string | null }

const decoder = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));

const nettoyer = (v: unknown): string | null => {
  if (v == null) return null;
  const t = decoder(String(v)).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 60 || /^(null|undefined|n\/a|nc|-)$/i.test(t)) return null;
  return t;
};

function produitsJsonLd(html: string): any[] {
  const trouves: any[] = [];
  const visiter = (n: any, profondeur = 0) => {
    if (!n || typeof n !== "object" || profondeur > 6) return;
    if (Array.isArray(n)) { n.forEach(x => visiter(x, profondeur + 1)); return; }
    const t = n["@type"];
    const types = Array.isArray(t) ? t : [t];
    if (types.some(x => typeof x === "string" && /^(Product|ProductGroup|IndividualProduct|Vehicle)$/i.test(x))) trouves.push(n);
    if (n["@graph"]) visiter(n["@graph"], profondeur + 1);
    if (n.mainEntity) visiter(n.mainEntity, profondeur + 1);
    if (n.hasVariant) visiter(n.hasVariant, profondeur + 1);
  };
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try { visiter(JSON.parse(decoder(m[1]).trim())); } catch { try { visiter(JSON.parse(m[1].trim())); } catch { /* JSON-LD invalide : ignoré */ } }
  }
  return trouves;
}

export function extraireReference(html: string): ExtractionReference {
  const candidats: CandidatReference[] = [];
  const ajouter = (valeur: unknown, source: SourceReference, type: string) => {
    const v = nettoyer(valeur);
    if (v && !candidats.some(c => c.valeur.toLowerCase() === v.toLowerCase())) candidats.push({ valeur: v, source, type });
  };
  let nomProduit: string | null = null;
  let ean: string | null = null;

  // 1. JSON-LD
  for (const p of produitsJsonLd(html)) {
    nomProduit ??= nettoyer(p.name) ?? null;
    ajouter(p.mpn, "json-ld", "Réf. fabricant");
    ajouter(p.sku, "json-ld", "SKU / réf. vendeur");
    ajouter(p.productID, "json-ld", "Identifiant produit");
    const offres = Array.isArray(p.offers) ? p.offers : p.offers ? [p.offers] : [];
    offres.forEach((o: any) => { ajouter(o?.mpn, "json-ld", "Réf. fabricant"); ajouter(o?.sku, "json-ld", "SKU / réf. vendeur"); });
    ean ??= nettoyer(p.gtin13 ?? p.gtin ?? p.gtin14 ?? p.gtin12 ?? p.gtin8);
  }

  // 2. Microdonnées itemprop
  const reMicro = /<[^>]*itemprop=["'](mpn|sku|productID)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = reMicro.exec(html))) {
    const balise = m[0];
    const contenu = /content=["']([^"']*)["']/i.exec(balise)?.[1]
      ?? new RegExp(`${balise.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^<]{1,80})<`).exec(html)?.[1];
    ajouter(contenu, "microdonnees", m[1].toLowerCase() === "mpn" ? "Réf. fabricant" : m[1].toLowerCase() === "sku" ? "SKU / réf. vendeur" : "Identifiant produit");
  }

  // 3. Balises <meta>
  const reMeta = /<meta[^>]*>/gi;
  while ((m = reMeta.exec(html))) {
    const b = m[0];
    const cle = (/(?:property|name|itemprop)=["']([^"']+)["']/i.exec(b)?.[1] ?? "").toLowerCase();
    const val = /content=["']([^"']*)["']/i.exec(b)?.[1];
    if (/^(product:retailer_item_id|product:sku|og:sku|sku|mpn|product:mpn|product:model)$/.test(cle)) ajouter(val, "meta", "Réf. (meta)");
    if (/^(product:ean|og:upc|gtin13|gtin|product:gtin)$/.test(cle)) ean ??= nettoyer(val);
    if (cle === "og:title") nomProduit ??= nettoyer(val?.slice(0, 59));
  }

  // 4. Texte visible : « Réf. 12345 », « Référence : ABC-12 », « Réf. fabricant : … »
  const texte = decoder(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
  const reTexte = /\b(?:r[ée]f(?:[ée]rence)?(?:\.| )?\s*(?:fabricant|fournisseur|produit|article|constructeur|marque)?|code article|mpn|sku)\s*[:\-–]?\s*([A-Z0-9][A-Z0-9._\-\/]{2,29})(?=[\s,;)|]|$)/gi;
  let compte = 0;
  while ((m = reTexte.exec(texte)) && compte < 6) {
    const v = m[1];
    if (!/\d/.test(v) || /^\d{1,2}$/.test(v)) continue;           // une référence contient au moins un chiffre
    if (/^(le|la|les|de|du|des|et|pour|avec)$/i.test(v)) continue;
    ajouter(v, "texte", "Réf. (texte de la page)"); compte++;
  }

  return { reference: candidats[0]?.valeur ?? null, candidats: candidats.slice(0, 6), nomProduit, ean };
}
