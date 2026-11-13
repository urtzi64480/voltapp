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
    const { blob, nom } = await genererPdfEtiquettes(planches([nouvelleEtiquette("Four", "20 A")]), f, { guides: true, pictos: true });
    expect(nom).toBe("etiquettes-tableau.pdf");
    const d = await PDFDocument.load(await blob.arrayBuffer());
    expect(d.getPageCount()).toBe(1);
    const t = d.getPage(0).getSize();
    expect(Math.round(t.width)).toBe(595); expect(Math.round(t.height)).toBe(842);
  });
  it("plusieurs planches : une page par planche, caractères spéciaux sans erreur", async () => {
    const liste = [nouvelleEtiquette("Lave-vaisselle « éco » – 2 000 W 🔥", "20 A", 70), nouvelleEtiquette("Prises cuisine plan de travail", "", 40)];
    const { blob } = await genererPdfEtiquettes(planches(liste), f, { guides: false, pictos: true });
    const d = await PDFDocument.load(await blob.arrayBuffer());
    expect(d.getPageCount()).toBe(planches(liste).length);
    expect(d.getPageCount()).toBeGreaterThan(1);
  });
  it("planche entamée avec guides : cases vides non dessinées (PDF plus léger qu'une planche pleine)", async () => {
    const a = await genererPdfEtiquettes(planches([nouvelleEtiquette("A", "", 1)], 5), f, { guides: true, pictos: true });
    const b = await genererPdfEtiquettes(planches([nouvelleEtiquette("A", "", 20)], 0), f, { guides: true, pictos: true });
    expect(a.blob.size).toBeLessThan(b.blob.size);
  });
  it("pictogrammes : le PDF les dessine (plus lourd qu'en texte seul) et reste valide", async () => {
    const large: FormatPlanche = { ...f, largeur: 60, hauteur: 25 };
    const r = composerPlanches([nouvelleEtiquette("Lave-linge", "20 A", 6), nouvelleEtiquette("Prises", "", 6), nouvelleEtiquette("Salon", "", 2)], large);
    if ("erreur" in r) throw new Error(r.erreur);
    const avec = await genererPdfEtiquettes(r.planches, large, { guides: true, pictos: true });
    const sans = await genererPdfEtiquettes(r.planches, large, { guides: true, pictos: false });
    expect(avec.blob.size).toBeGreaterThan(sans.blob.size);
    expect((await PDFDocument.load(await avec.blob.arrayBuffer())).getPageCount()).toBe(1);
  });
  it("chaque pictogramme se dessine sans erreur dans le PDF", async () => {
    const { LISTE_PICTOS } = await import("@/lib/pictogrammes");
    const grand: FormatPlanche = { ...f, largeur: 60, hauteur: 25 };
    const r = composerPlanches(LISTE_PICTOS.map(p => ({ ...nouvelleEtiquette(p.nom, "20 A", 1), icone: p.id })), grand);
    if ("erreur" in r) throw new Error(r.erreur);
    const { blob } = await genererPdfEtiquettes(r.planches, grand, { guides: false, pictos: true });
    expect((await PDFDocument.load(await blob.arrayBuffer())).getPageCount()).toBe(1);
  });
  it("page paysage : PDF A4 297 × 210 mm, étiquettes de 1 et 2 modules côte à côte", async () => {
    const carre: FormatPlanche = { id: "c", nom: "c", largeur: 17.5, hauteur: 17.5, marge: 8, ecart: 0, paysage: true };
    const liste = [{ ...nouvelleEtiquette("ID A", "40 A", 1), modules: 2, rangee: 0 }, { ...nouvelleEtiquette("Lave-linge", "20 A", 1), rangee: 0 }, { ...nouvelleEtiquette("Four", "20 A", 1), rangee: 1 }];
    const r = composerPlanches(liste, carre, 0, { ligneParRangee: true });
    if ("erreur" in r) throw new Error(r.erreur);
    const { blob } = await genererPdfEtiquettes(r.planches, carre, { guides: true, pictos: true });
    const d = await PDFDocument.load(await blob.arrayBuffer());
    expect(d.getPageCount()).toBe(1);
    const t = d.getPage(0).getSize();
    expect(Math.round(t.width)).toBe(842); expect(Math.round(t.height)).toBe(595);
  });
});
