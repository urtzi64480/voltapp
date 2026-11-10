import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { joindreAttestation, typeDepuisOctets } from "@/lib/attestation-pdf";

const PNG_1PX = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
async function pdfDe(n: number) { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage(); return d.save(); }

describe("attestation-pdf", () => {
  it("reconnaît le type par le contenu", async () => {
    expect(typeDepuisOctets(await pdfDe(1))).toBe("pdf");
    expect(typeDepuisOctets(PNG_1PX)).toBe("png");
    expect(typeDepuisOctets(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("jpeg");
    expect(typeDepuisOctets(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
  it("PDF : ses pages sont ajoutées après celles du rapport", async () => {
    const r = await PDFDocument.load(await joindreAttestation(await pdfDe(3), await pdfDe(2)));
    expect(r.getPageCount()).toBe(5);
  });
  it("image : une page A4 ajoutée", async () => {
    const r = await PDFDocument.load(await joindreAttestation(await pdfDe(2), PNG_1PX));
    expect(r.getPageCount()).toBe(3);
    const p = r.getPage(2).getSize();
    expect(Math.round(p.width)).toBe(595); expect(Math.round(p.height)).toBe(842);
  });
  it("format inconnu ou fichier corrompu : erreur explicite, jamais un rapport faussement complet", async () => {
    await expect(joindreAttestation(await pdfDe(1), Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]))).rejects.toThrow(/Format/);
    await expect(joindreAttestation(await pdfDe(1), Uint8Array.from(Buffer.from("%PDF-1.4 corrompu")))).rejects.toThrow();
  });
});
