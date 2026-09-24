"use client";
// ─────────────────────────────────────────────────────────────────────────────
// Facture électronique — Factur-X profil EN 16931 (PDF/A-3 + XML CII embarqué)
// Réforme française : émission obligatoire pour les micro-entreprises au 01/09/2027.
// Le fichier produit est accepté par toutes les plateformes agréées (format socle).
// ─────────────────────────────────────────────────────────────────────────────
import { Facture, Profil } from "@/types";

export interface AcompteFX {
  montant: number;
  date_versement: string;
}

export const FACTURX_FILENAME = "factur-x.xml";

// ── Utilitaires ─────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const amt = (n: number) => r2(n).toFixed(2);
const qty = (n: number) => String(Math.round(n * 10000) / 10000);
const digits = (s?: string | null) => (s ?? "").replace(/\D/g, "");

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // caractères de contrôle interdits en XML 1.0
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

// "2026-09-23" | "2026-09-23T10:00:00+00:00" → "20260923"
function d102(d?: string | null): string {
  const s = d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : new Date().toISOString().slice(0, 10);
  return s.replace(/-/g, "");
}

// Unités VoltApp → codes UN/ECE Recommandation 20 (obligatoires en EN 16931)
const UNIT_CODES: Record<string, string> = {
  forfait: "LS",
  heure: "HUR",
  h: "HUR",
  u: "C62",
  unite: "C62",
  "unité": "C62",
  ml: "MTR",
  m: "MTR",
  m2: "MTK",
  "m²": "MTK",
};
const unitCode = (u?: string | null) => UNIT_CODES[(u ?? "").trim().toLowerCase()] ?? "C62";

export function sirenFromSiret(siret?: string | null): string {
  const d = digits(siret);
  return d.length >= 9 ? d.slice(0, 9) : "";
}

function cleanVat(v?: string | null): string {
  return (v ?? "").replace(/[\s.-]/g, "").toUpperCase();
}

/** Nature des opérations (mention obligatoire réforme) : S1 services, B1 biens, M1 mixte */
export function natureOperations(facture: Facture): { code: "S1" | "B1" | "M1"; libelle: string } {
  const lignes = facture.lignes ?? [];
  const hasS = lignes.some(l => l.type_branche === "service") || (lignes.length === 0 && facture.total_service > 0);
  const hasM = lignes.some(l => l.type_branche === "materiau") || (lignes.length === 0 && facture.total_materiau > 0);
  if (hasS && hasM) return { code: "M1", libelle: "Mixte (prestations de services et livraison de biens)" };
  if (hasM) return { code: "B1", libelle: "Livraison de biens" };
  return { code: "S1", libelle: "Prestation de services" };
}

export const MENTION_RETARD_PRO =
  "En cas de retard de paiement : pénalités au taux égal à 3 fois le taux d'intérêt légal et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 du Code de commerce).";
export const MENTION_ESCOMPTE = "Pas d'escompte pour paiement anticipé.";

// ── Contrôles de conformité (non bloquants) ─────────────────────────────────

export function verifierConformiteFacture(facture: Facture, profil: Profil | null): string[] {
  const w: string[] = [];
  const p = profil ?? ({} as Profil);
  if (!cleanVat(p.numero_tva)) {
    w.push("N° de TVA intracommunautaire absent (Paramètres) : sans lui, le fichier électronique sera rejeté par les plateformes (règle EN 16931 BR-E-02, même en franchise de TVA). Il se demande gratuitement à ton SIE via ta messagerie impots.gouv.fr.");
  }
  if (digits(p.siret).length !== 14) w.push("Ton SIRET (14 chiffres) est absent ou invalide — Paramètres › Informations de l'entreprise.");
  if (!p.adresse || !p.code_postal || !p.ville) w.push("Ton adresse complète (adresse, code postal, ville) est incomplète — Paramètres.");
  if (!p.nom_entreprise && !p.nom) w.push("Le nom de l'entreprise est vide — Paramètres.");
  const c = facture.client;
  if (!c) {
    w.push("Aucun client rattaché à cette facture.");
  } else {
    if (!c.adresse || !c.code_postal || !c.ville) w.push("L'adresse du client est incomplète (adresse, code postal, ville).");
    if (c.type_client === "professionnel") {
      const s = digits(c.siret_client);
      if (s.length !== 14 && s.length !== 9) w.push("Client professionnel sans SIRET/SIREN valide : obligatoire pour la facture électronique B2B.");
    }
  }
  if (!(facture.lignes ?? []).length) w.push("La facture ne contient aucune ligne.");
  return w;
}

// ── XML CII (Factur-X EN 16931) ─────────────────────────────────────────────

export function buildFacturXml(facture: Facture, profil: Profil, acomptes: AcompteFX[] = []): string {
  const client = facture.client;
  const estPro = client?.type_client === "professionnel";
  const nature = natureOperations(facture);
  const mentionTva = (profil.mention_tva || "TVA non applicable, art. 293 B du CGI").trim();

  // Lignes
  const lignes = (facture.lignes ?? []).slice().sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
  const lineAmounts = lignes.map(l => r2((Number(l.quantite) || 0) * (Number(l.prix_unitaire) || 0)));
  const lineTotal = r2(lineAmounts.reduce((a, b) => a + b, 0));

  // Totaux de la base = référence. L'écart avec la somme des lignes = remises (ou majoration).
  const grandTotal = r2(Number(facture.total_ttc) || 0);
  const ecart = r2(lineTotal - grandTotal);
  const allowance = ecart > 0 ? ecart : 0;
  const charge = ecart < 0 ? -ecart : 0;

  const prepaid = r2(Math.min(grandTotal, acomptes.reduce((a, ac) => a + (Number(ac.montant) || 0), 0)));
  const due = r2(grandTotal - prepaid);

  // Vendeur
  const sellerName = (profil.nom_entreprise || `${profil.prenom ?? ""} ${profil.nom ?? ""}`.trim() || "Entreprise").trim();
  const sellerSiren = sirenFromSiret(profil.siret);
  const sellerVat = cleanVat(profil.numero_tva);

  // Acheteur
  const buyerName = client ? `${client.prenom ?? ""} ${client.nom ?? ""}`.trim() || client.nom : "Client";
  const buyerDigits = digits(client?.siret_client);
  const buyerSiren = estPro ? (buyerDigits.length >= 9 ? buyerDigits.slice(0, 9) : "") : "";

  const taxLine = `<ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>E</ram:CategoryCode><ram:RateApplicablePercent>0</ram:RateApplicablePercent></ram:ApplicableTradeTax>`;
  const taxCat = `<ram:CategoryTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>E</ram:CategoryCode><ram:RateApplicablePercent>0</ram:RateApplicablePercent></ram:CategoryTradeTax>`;

  const address = (cp?: string | null, l1?: string | null, ville?: string | null) =>
    `<ram:PostalTradeAddress>` +
    (cp ? `<ram:PostcodeCode>${esc(cp.trim())}</ram:PostcodeCode>` : "") +
    (l1 ? `<ram:LineOne>${esc(l1.trim())}</ram:LineOne>` : "") +
    (ville ? `<ram:CityName>${esc(ville.trim())}</ram:CityName>` : "") +
    `<ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>`;

  // Notes PMD / PMT / AAB obligatoires dans le flux français (règle BR-FR-05)
  const notes: string[] = [];
  notes.push(`<ram:IncludedNote><ram:Content>Pénalités de retard : 3 fois le taux d'intérêt légal (applicable entre professionnels).</ram:Content><ram:SubjectCode>PMD</ram:SubjectCode></ram:IncludedNote>`);
  notes.push(`<ram:IncludedNote><ram:Content>Indemnité forfaitaire pour frais de recouvrement : 40 € (applicable entre professionnels, art. L441-10 du Code de commerce).</ram:Content><ram:SubjectCode>PMT</ram:SubjectCode></ram:IncludedNote>`);
  notes.push(`<ram:IncludedNote><ram:Content>${esc(MENTION_ESCOMPTE)}</ram:Content><ram:SubjectCode>AAB</ram:SubjectCode></ram:IncludedNote>`);
  notes.push(`<ram:IncludedNote><ram:Content>${esc(mentionTva)}</ram:Content><ram:SubjectCode>REG</ram:SubjectCode></ram:IncludedNote>`);
  if (facture.objet) notes.push(`<ram:IncludedNote><ram:Content>${esc(`Objet : ${facture.objet}`)}</ram:Content></ram:IncludedNote>`);

  const lineItems = lignes.map((l, i) => {
    const desc = (l.kit_description ?? l.description ?? "").trim();
    return (
      `<ram:IncludedSupplyChainTradeLineItem>` +
      `<ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>` +
      `<ram:SpecifiedTradeProduct><ram:Name>${esc((l.nom || "Article").trim())}</ram:Name>` +
      (desc ? `<ram:Description>${esc(desc)}</ram:Description>` : "") +
      `</ram:SpecifiedTradeProduct>` +
      `<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${amt(Number(l.prix_unitaire) || 0)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>` +
      `<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${unitCode(l.unite)}">${qty(Number(l.quantite) || 0)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>` +
      `<ram:SpecifiedLineTradeSettlement>${taxLine}` +
      `<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amt(lineAmounts[i])}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>` +
      `</ram:SpecifiedLineTradeSettlement>` +
      `</ram:IncludedSupplyChainTradeLineItem>`
    );
  }).join("");

  const contactNom = `${profil.prenom ?? ""} ${profil.nom ?? ""}`.trim();
  const sellerContact = contactNom || profil.telephone || profil.email
    ? `<ram:DefinedTradeContact>` +
      (contactNom ? `<ram:PersonName>${esc(contactNom)}</ram:PersonName>` : "") +
      (profil.telephone ? `<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${esc(profil.telephone.trim())}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>` : "") +
      (profil.email ? `<ram:EmailURIUniversalCommunication><ram:URIID>${esc(profil.email.trim())}</ram:URIID></ram:EmailURIUniversalCommunication>` : "") +
      `</ram:DefinedTradeContact>`
    : "";

  // Adresse électronique acheteur (BT-49) : SIREN pour un pro, email pour un particulier
  const buyerEmail = (client?.email ?? "").trim();
  const buyerEndpoint = buyerSiren
    ? `<ram:URIUniversalCommunication><ram:URIID schemeID="0225">${buyerSiren}</ram:URIID></ram:URIUniversalCommunication>`
    : buyerEmail
      ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(buyerEmail)}</ram:URIID></ram:URIUniversalCommunication>`
      : "";

  const seller =
    `<ram:SellerTradeParty><ram:Name>${esc(sellerName)}</ram:Name>` +
    (sellerSiren ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${sellerSiren}</ram:ID></ram:SpecifiedLegalOrganization>` : "") +
    sellerContact +
    address(profil.code_postal, profil.adresse, profil.ville) +
    (sellerSiren ? `<ram:URIUniversalCommunication><ram:URIID schemeID="0225">${sellerSiren}</ram:URIID></ram:URIUniversalCommunication>` : "") +
    (sellerVat ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(sellerVat)}</ram:ID></ram:SpecifiedTaxRegistration>` : "") +
    `</ram:SellerTradeParty>`;

  const buyer =
    `<ram:BuyerTradeParty><ram:Name>${esc(buyerName)}</ram:Name>` +
    (buyerSiren ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${buyerSiren}</ram:ID></ram:SpecifiedLegalOrganization>` : "") +
    address(client?.code_postal, client?.adresse, client?.ville) +
    buyerEndpoint +
    `</ram:BuyerTradeParty>`;

  const iban = (profil.iban ?? "").replace(/\s/g, "").toUpperCase();
  const bic = (profil.bic ?? "").replace(/\s/g, "").toUpperCase();
  const paymentMeans = iban
    ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode>` +
      `<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${esc(iban)}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>` +
      (bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${esc(bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : "") +
      `</ram:SpecifiedTradeSettlementPaymentMeans>`
    : "";

  const headerTax =
    `<ram:ApplicableTradeTax><ram:CalculatedAmount>0.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>` +
    `<ram:ExemptionReason>${esc(mentionTva)}</ram:ExemptionReason>` +
    `<ram:BasisAmount>${amt(grandTotal)}</ram:BasisAmount><ram:CategoryCode>E</ram:CategoryCode>` +
    `<ram:ExemptionReasonCode>VATEX-FR-FRANCHISE</ram:ExemptionReasonCode>` +
    `<ram:RateApplicablePercent>0</ram:RateApplicablePercent></ram:ApplicableTradeTax>`;

  const allowanceCharge =
    (allowance > 0
      ? `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator>` +
        `<ram:ActualAmount>${amt(allowance)}</ram:ActualAmount><ram:Reason>Remise commerciale</ram:Reason>${taxCat}</ram:SpecifiedTradeAllowanceCharge>`
      : "") +
    (charge > 0
      ? `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>true</udt:Indicator></ram:ChargeIndicator>` +
        `<ram:ActualAmount>${amt(charge)}</ram:ActualAmount><ram:Reason>Ajustement</ram:Reason>${taxCat}</ram:SpecifiedTradeAllowanceCharge>`
      : "");

  const conditions = (profil.conditions_paiement || "Paiement à réception de facture").trim();
  const paymentTerms =
    `<ram:SpecifiedTradePaymentTerms><ram:Description>${esc(conditions)}</ram:Description>` +
    (facture.date_echeance ? `<ram:DueDateDateTime><udt:DateTimeString format="102">${d102(facture.date_echeance)}</udt:DateTimeString></ram:DueDateDateTime>` : "") +
    `</ram:SpecifiedTradePaymentTerms>`;

  const summation =
    `<ram:SpecifiedTradeSettlementHeaderMonetarySummation>` +
    `<ram:LineTotalAmount>${amt(lineTotal)}</ram:LineTotalAmount>` +
    (charge > 0 ? `<ram:ChargeTotalAmount>${amt(charge)}</ram:ChargeTotalAmount>` : "") +
    (allowance > 0 ? `<ram:AllowanceTotalAmount>${amt(allowance)}</ram:AllowanceTotalAmount>` : "") +
    `<ram:TaxBasisTotalAmount>${amt(grandTotal)}</ram:TaxBasisTotalAmount>` +
    `<ram:TaxTotalAmount currencyID="EUR">0.00</ram:TaxTotalAmount>` +
    `<ram:GrandTotalAmount>${amt(grandTotal)}</ram:GrandTotalAmount>` +
    (prepaid > 0 ? `<ram:TotalPrepaidAmount>${amt(prepaid)}</ram:TotalPrepaidAmount>` : "") +
    `<ram:DuePayableAmount>${amt(due)}</ram:DuePayableAmount>` +
    `</ram:SpecifiedTradeSettlementHeaderMonetarySummation>`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" ` +
    `xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" ` +
    `xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" ` +
    `xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">` +
    `<rsm:ExchangedDocumentContext>` +
    `<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${nature.code}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>` +
    `<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>` +
    `</rsm:ExchangedDocumentContext>` +
    `<rsm:ExchangedDocument><ram:ID>${esc(facture.numero)}</ram:ID><ram:TypeCode>380</ram:TypeCode>` +
    `<ram:IssueDateTime><udt:DateTimeString format="102">${d102(facture.date_emission)}</udt:DateTimeString></ram:IssueDateTime>` +
    notes.join("") +
    `</rsm:ExchangedDocument>` +
    `<rsm:SupplyChainTradeTransaction>` +
    lineItems +
    `<ram:ApplicableHeaderTradeAgreement>${seller}${buyer}</ram:ApplicableHeaderTradeAgreement>` +
    `<ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime>` +
    `<udt:DateTimeString format="102">${d102(facture.date_emission)}</udt:DateTimeString>` +
    `</ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>` +
    `<ram:ApplicableHeaderTradeSettlement>` +
    `<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>` +
    paymentMeans +
    headerTax +
    allowanceCharge +
    paymentTerms +
    summation +
    `</ram:ApplicableHeaderTradeSettlement>` +
    `</rsm:SupplyChainTradeTransaction>` +
    `</rsm:CrossIndustryInvoice>\n`
  );
}

// ── Assemblage PDF/A-3 + XML (Factur-X) ─────────────────────────────────────

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function xmpEsc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildXmp(title: string, author: string, isoDate: string): string {
  const producer = "VoltApp";
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
<pdfaid:part>3</pdfaid:part>
<pdfaid:conformance>B</pdfaid:conformance>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:format>application/pdf</dc:format>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmpEsc(title)}</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>${xmpEsc(author)}</rdf:li></rdf:Seq></dc:creator>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
<pdf:Producer>${producer}</pdf:Producer>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
<xmp:CreatorTool>${producer}</xmp:CreatorTool>
<xmp:CreateDate>${isoDate}</xmp:CreateDate>
<xmp:ModifyDate>${isoDate}</xmp:ModifyDate>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
<pdfaExtension:schemas>
<rdf:Bag>
<rdf:li rdf:parseType="Resource">
<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
<pdfaSchema:prefix>fx</pdfaSchema:prefix>
<pdfaSchema:property>
<rdf:Seq>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The name of the embedded XML document</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The type of the hybrid document in capital letters, e.g. INVOICE or ORDER</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the standard applying to the embedded XML document</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded XML document</pdfaProperty:description></rdf:li>
</rdf:Seq>
</pdfaSchema:property>
</rdf:li>
</rdf:Bag>
</pdfaExtension:schemas>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
<fx:DocumentType>INVOICE</fx:DocumentType>
<fx:DocumentFileName>${FACTURX_FILENAME}</fx:DocumentFileName>
<fx:Version>1.0</fx:Version>
<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Transforme un PDF (généré par jsPDF avec polices embarquées) en Factur-X :
 * métadonnées XMP PDF/A-3B, OutputIntent sRGB, XML CII embarqué (AFRelationship).
 */
export async function assemblerFacturX(
  pdfBytes: ArrayBuffer | Uint8Array,
  xml: string,
  meta: { title: string; author: string },
): Promise<Uint8Array> {
  const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFDict } = await import("pdf-lib");
  const { ICC_SRGB } = await import("./facturx-assets");

  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const ctx = pdf.context;
  const catalog = pdf.catalog;

  const now = new Date();
  now.setMilliseconds(0);
  const iso = now.toISOString().replace(".000Z", "Z");

  // Dictionnaire Info — doit correspondre exactement au XMP
  pdf.setTitle(meta.title);
  pdf.setAuthor(meta.author);
  pdf.setCreator("VoltApp");
  pdf.setProducer("VoltApp");
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  const info = ctx.lookup(ctx.trailerInfo.Info, PDFDict);
  info.delete(PDFName.of("Subject"));
  info.delete(PDFName.of("Keywords"));

  // XMP (flux non compressé, exigé par PDF/A)
  const xmpStream = ctx.stream(new TextEncoder().encode(buildXmp(meta.title, meta.author, iso)), {
    Type: "Metadata",
    Subtype: "XML",
  });
  catalog.set(PDFName.of("Metadata"), ctx.register(xmpStream));

  // OutputIntent sRGB
  const icc = b64ToBytes(ICC_SRGB);
  const iccRef = ctx.register(ctx.flateStream(icc, { N: 3 }));
  const outputIntent = ctx.obj({
    Type: "OutputIntent",
    S: "GTS_PDFA1",
    OutputConditionIdentifier: PDFString.of("sRGB IEC61966-2.1"),
    Info: PDFString.of("sRGB IEC61966-2.1"),
    DestOutputProfile: iccRef,
  });
  catalog.set(PDFName.of("OutputIntents"), ctx.obj([ctx.register(outputIntent)]));

  // Fichier XML embarqué
  const xmlBytes = new TextEncoder().encode(xml);
  const pdfDate = PDFString.fromDate(now);
  const efStream = ctx.flateStream(xmlBytes, {
    Type: "EmbeddedFile",
    Subtype: "text/xml",
    Params: { ModDate: pdfDate, Size: xmlBytes.length },
  });
  const efRef = ctx.register(efStream);
  const fileSpec = ctx.obj({
    Type: "Filespec",
    F: PDFString.of(FACTURX_FILENAME),
    UF: PDFHexString.fromText(FACTURX_FILENAME),
    Desc: PDFString.of("Factur-X"),
    AFRelationship: "Data",
    EF: { F: efRef, UF: efRef },
  });
  const fsRef = ctx.register(fileSpec);
  const names = ctx.obj({ EmbeddedFiles: ctx.obj({ Names: [PDFString.of(FACTURX_FILENAME), fsRef] }) });
  catalog.set(PDFName.of("Names"), names);
  const af = PDFArray.withContext(ctx);
  af.push(fsRef);
  catalog.set(PDFName.of("AF"), af);

  // Retire tout ce qui pourrait casser PDF/A
  catalog.delete(PDFName.of("OpenAction"));

  return pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
