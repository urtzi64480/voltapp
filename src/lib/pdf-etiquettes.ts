// src/lib/pdf-etiquettes.ts — PDF A4 des planches d'étiquettes (jsPDF, millimètres, échelle 100 % : imprimer « taille réelle »).

import { PAGE_A4, mettreEnPage, type FormatPlanche, type Mesure, type Planche } from "./etiquettes";

export interface OptionsPdfEtiquettes { guides: boolean }

/** Construit le PDF d'une ou plusieurs planches. Les cases vides (planche entamée) ne sont ni imprimées ni encadrées. */
export async function genererPdfEtiquettes(planches: Planche[], f: FormatPlanche, opt: OptionsPdfEtiquettes): Promise<{ blob: Blob; nom: string }> {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: [PAGE_A4.largeur, PAGE_A4.hauteur], orientation: "portrait", compress: true });
  doc.setProperties({ title: "Étiquettes tableau électrique", creator: "VoltApp" });

  const mesure: Mesure = (texte, pt, gras) => {
    doc.setFont("helvetica", gras ? "bold" : "normal");
    doc.setFontSize(pt);
    return doc.getTextWidth(texte);
  };

  planches.forEach((planche, p) => {
    if (p > 0) doc.addPage([PAGE_A4.largeur, PAGE_A4.hauteur], "portrait");
    for (const c of planche) {
      if (!c.etiquette) continue;
      if (opt.guides) {
        doc.setDrawColor(170, 170, 170);
        doc.setLineWidth(0.15);
        doc.rect(c.x, c.y, f.largeur, f.hauteur);
      }
      doc.setTextColor(0, 0, 0);
      for (const l of mettreEnPage(c.etiquette.texte, c.etiquette.ligne2, f.largeur, f.hauteur, mesure)) {
        doc.setFont("helvetica", l.gras ? "bold" : "normal");
        doc.setFontSize(l.pt);
        doc.text(l.texte, c.x + f.largeur / 2, c.y + l.y, { align: "center" });
      }
    }
  });
  return { blob: doc.output("blob"), nom: "etiquettes-tableau.pdf" };
}
