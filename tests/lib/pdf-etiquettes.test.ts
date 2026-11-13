import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { DIMS_STANDARD, composerGroupes, nouvelleEtiquette, type ModeEtiquettes } from "@/lib/etiquettes";
import { genererPdfEtiquettes } from "@/lib/pdf-etiquettes";
import { LISTE_PICTOS } from "@/lib/pictogrammes";

const groupes = (liste: ReturnType<typeof nouvelleEtiquette>[], mode: ModeEtiquettes = "les-deux", opt: Partial<{ debut: number; paysage: boolean; dims: typeof DIMS_STANDARD }> = {}) => {
  const r = composerGroupes(liste, { mode, dims: opt.dims ?? DIMS_STANDARD, paysage: opt.paysage ?? false, debut: opt.debut ?? 0, ligneParRangee: true });
  if ("erreur" in r) throw new Error(r.erreur);
  return r.groupes;
};
const pages = async (blob: Blob) => PDFDocument.load(await blob.arrayBuffer());

describe("genererPdfEtiquettes", () => {
  it("une étiquette seule, textes : un PDF A4 d'une page, nom de fichier explicite", async () => {
    const { blob, nom } = await genererPdfEtiquettes(groupes([nouvelleEtiquette("Four", "20 A")], "tableau"), { guides: true });
    expect(nom).toBe("etiquettes-tableau.pdf");
    const d = await pages(blob);
    expect(d.getPageCount()).toBe(1);
    const t = d.getPage(0).getSize();
    expect(Math.round(t.width)).toBe(595); expect(Math.round(t.height)).toBe(842);
  });
  it("pictogrammes seuls : nom de fichier dédié", async () => {
    expect((await genererPdfEtiquettes(groupes([nouvelleEtiquette("Four", "20 A")], "picto"), { guides: true })).nom).toBe("etiquettes-pictogrammes.pdf");
  });
  it("« les deux » : une page pour les pictogrammes puis une pour les textes, dans le même PDF", async () => {
    const { blob, nom } = await genererPdfEtiquettes(groupes([nouvelleEtiquette("Four", "20 A"), nouvelleEtiquette("Salon", "10 A")]), { guides: true });
    expect(nom).toBe("etiquettes-pictos-et-tableau.pdf");
    expect((await pages(blob)).getPageCount()).toBe(2);
  });
  it("plusieurs pages, caractères spéciaux sans erreur", async () => {
    const liste = [nouvelleEtiquette("Lave-vaisselle « éco » – 2 000 W 🔥", "20 A", 100), nouvelleEtiquette("Prises cuisine plan de travail", "", 100), nouvelleEtiquette("Four", "", 100), nouvelleEtiquette("Hotte", "", 100)];
    const g = groupes(liste, "tableau");
    const d = await pages((await genererPdfEtiquettes(g, { guides: false })).blob);
    expect(d.getPageCount()).toBe(g[0].planches.length); expect(d.getPageCount()).toBeGreaterThan(1);
  });
  it("planche entamée avec guides : cases vides non dessinées (PDF plus léger qu'une planche pleine)", async () => {
    const a = await genererPdfEtiquettes(groupes([nouvelleEtiquette("A", "", 1)], "tableau", { debut: 5 }), { guides: true });
    const b = await genererPdfEtiquettes(groupes([nouvelleEtiquette("A", "", 20)], "tableau"), { guides: true });
    expect(a.blob.size).toBeLessThan(b.blob.size);
  });
  it("pictogrammes dessinés : planche de pictos plus lourde qu'une planche de textes vides de pictos, PDF valide", async () => {
    const liste = [nouvelleEtiquette("Lave-linge", "", 6), nouvelleEtiquette("Prises", "", 6)];
    const p = await genererPdfEtiquettes(groupes(liste, "picto"), { guides: false });
    expect(p.blob.size).toBeGreaterThan(900); expect((await pages(p.blob)).getPageCount()).toBe(1);
  });
  it("chaque pictogramme se dessine sans erreur dans le PDF", async () => {
    const g = groupes(LISTE_PICTOS.map(p => ({ ...nouvelleEtiquette(p.nom, "20 A", 1), icone: p.id })), "picto");
    expect((await pages((await genererPdfEtiquettes(g, { guides: false })).blob)).getPageCount()).toBe(1);
  });
  it("page paysage : PDF A4 297 × 210 mm pour les deux planches", async () => {
    const liste = [{ ...nouvelleEtiquette("ID A", "40 A", 1), rangee: 0 }, { ...nouvelleEtiquette("Lave-linge", "20 A", 1), rangee: 0 }, { ...nouvelleEtiquette("Four", "20 A", 1), rangee: 1 }];
    const d = await pages((await genererPdfEtiquettes(groupes(liste, "les-deux", { paysage: true }), { guides: true })).blob);
    expect(d.getPageCount()).toBe(2);
    for (let i = 0; i < 2; i++) { const t = d.getPage(i).getSize(); expect(Math.round(t.width)).toBe(842); expect(Math.round(t.height)).toBe(595); }
  });
  it("zone personnalisée acceptée ; aucun groupe → erreur claire", async () => {
    const perso = { ...DIMS_STANDARD, tableau: { largeur: 30, hauteur: 12, marge: 5, ecart: 1 } };
    expect((await pages((await genererPdfEtiquettes(groupes([nouvelleEtiquette("Four", "20 A")], "tableau", { dims: perso }), { guides: true })).blob)).getPageCount()).toBe(1);
    await expect(genererPdfEtiquettes([], { guides: true })).rejects.toThrow(/Aucune planche/);
  });
});
