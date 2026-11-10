// src/lib/attestation-pdf.ts — joint l'attestation (PDF, PNG ou JPEG) à la fin d'un PDF existant (pdf-lib). L'original n'est jamais modifié.
import { PDFDocument } from "pdf-lib";

export type TypeAttestation = "pdf" | "png" | "jpeg";

/** Type déduit du contenu (signature binaire), pas de l'extension : un fichier renommé ne doit pas faire échouer l'envoi du rapport. */
export function typeDepuisOctets(b: Uint8Array): TypeAttestation | null {
  if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  return null;
}

/** PDF d'origine + pages de l'attestation. Fichier illisible ou chiffré : l'erreur remonte, l'appelant décide (on n'envoie pas un rapport « complet » sans l'attestation). */
export async function joindreAttestation(pdfOrigine: Uint8Array, attestation: Uint8Array): Promise<Uint8Array> {
  const type = typeDepuisOctets(attestation);
  if (!type) throw new Error("Format d'attestation non reconnu (PDF, PNG ou JPEG attendu).");
  const doc = await PDFDocument.load(pdfOrigine);
  if (type === "pdf") {
    const src = await PDFDocument.load(attestation);
    const pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach(p => doc.addPage(p));
  } else {
    const img = type === "png" ? await doc.embedPng(attestation) : await doc.embedJpg(attestation);
    const [W, H, marge] = [595.28, 841.89, 36]; // A4 en points
    const page = doc.addPage([W, H]);
    const k = Math.min((W - 2 * marge) / img.width, (H - 2 * marge) / img.height, 1.5);
    const w = img.width * k, h = img.height * k;
    page.drawImage(img, { x: (W - w) / 2, y: H - marge - h, width: w, height: h });
  }
  return doc.save();
}
