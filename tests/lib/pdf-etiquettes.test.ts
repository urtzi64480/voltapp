import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { composerPlanches, nouvelleEtiquette, type FormatPlanche } from "@/lib/etiquettes";
import { genererPdfEtiquettes } from "@/lib/pdf-etiquettes";

const f: FormatPlanche = { id: "x", nom: "x", largeur: 35, hauteur: 12, marge: 10, ecart: 1 };
const planches = (liste: ReturnType<typeof nouvelleEtiquette>[], debut = 0) => {
  const r = composerPlanches(liste, f, debut);
  if ("erreur" in r) throw new Error(r.erreur);
  return r.planches;
};

describe("genererPdfEtiquettes", () => {
  it("une étiquette seule : un PDF A4 d'une page", async () => {
    const { blob, nom } = await genererPdfEtiquettes(planches([nouvelleEtiquette("Four", "20 A")]), f, { guides: true });
    expect(nom).toBe("etiquettes-tableau.pdf");
    const d = await PDFDocument.load(await blob.arrayBuffer());
    expect(d.getPageCount()).toBe(1);
    const t = d.getPage(0).getSize();
    expect(Math.round(t.width)).toBe(595); expect(Math.round(t.height)).toBe(842);
  });
  it("plusieurs planches : une page par planche, caractères spéciaux sans erreur", async () => {
    const liste = [nouvelleEtiquette("Lave-vaisselle « éco » – 2 000 W 🔥", "20 A", 70), nouvelleEtiquette("Prises cuisine plan de travail", "", 40)];
    const { blob } = await genererPdfEtiquettes(planches(liste), f, { guides: false });
    const d = await PDFDocument.load(await blob.arrayBuffer());
    expect(d.getPageCount()).toBe(planches(liste).length);
    expect(d.getPageCount()).toBeGreaterThan(1);
  });
  it("planche entamée avec guides : cases vides non dessinées (PDF plus léger qu'une planche pleine)", async () => {
    const a = await genererPdfEtiquettes(planches([nouvelleEtiquette("A", "", 1)], 5), f, { guides: true });
    const b = await genererPdfEtiquettes(planches([nouvelleEtiquette("A", "", 20)], 0), f, { guides: true });
    expect(a.blob.size).toBeLessThan(b.blob.size);
  });
});
