// src/lib/pdf-etiquettes.ts — PDF A4 des planches d'étiquettes (jsPDF, millimètres, échelle 100 % : imprimer « taille réelle »).

import type { jsPDF } from "jspdf";
import { composerEtiquette, pageDe, pictoDeEtiquette, type FormatPlanche, type Mesure, type Planche } from "./etiquettes";
import { BOITE_PICTO, PICTOS, TRAIT_PICTO } from "./pictogrammes";

export interface OptionsPdfEtiquettes { guides: boolean; pictos: boolean }

/** Dessine un pictogramme (primitives vectorielles, boîte 24 × 24) dans le carré de côté `taille` dont le coin haut-gauche est (x, y), en mm. */
export function dessinerPicto(doc: jsPDF, id: string, x: number, y: number, taille: number): void {
  const p = PICTOS[id];
  if (!p) return;
  const k = taille / BOITE_PICTO;
  doc.setDrawColor(0, 0, 0);
  doc.setFillColor(0, 0, 0);
  doc.setLineWidth(Math.max(0.2, TRAIT_PICTO * k));
  doc.setLineCap("round");
  doc.setLineJoin("round");
  for (const pr of p.prims) {
    const v = pr.v;
    switch (pr.t) {
      case "l": doc.line(x + v[0] * k, y + v[1] * k, x + v[2] * k, y + v[3] * k); break;
      case "r":
        if (v[4] > 0) doc.roundedRect(x + v[0] * k, y + v[1] * k, v[2] * k, v[3] * k, v[4] * k, v[4] * k, "S");
        else doc.rect(x + v[0] * k, y + v[1] * k, v[2] * k, v[3] * k, "S");
        break;
      case "c": doc.circle(x + v[0] * k, y + v[1] * k, v[2] * k, "S"); break;
      case "d": doc.circle(x + v[0] * k, y + v[1] * k, v[2] * k, "F"); break;
      case "p":
      case "z": {
        const pts: [number, number][] = [];
        for (let i = 0; i + 1 < v.length; i += 2) pts.push([x + v[i] * k, y + v[i + 1] * k]);
        const segments = pts.slice(1).map((q, i) => [q[0] - pts[i][0], q[1] - pts[i][1]]);
        doc.lines(segments, pts[0][0], pts[0][1], [1, 1], "S", pr.t === "z");
        break;
      }
    }
  }
}

/** Construit le PDF d'une ou plusieurs planches. Les cases vides (planche entamée) ne sont ni imprimées ni encadrées. */
export async function genererPdfEtiquettes(planches: Planche[], f: FormatPlanche, opt: OptionsPdfEtiquettes): Promise<{ blob: Blob; nom: string }> {
  const { default: JsPdf } = await import("jspdf");
  const page = pageDe(f);
  const orientation = f.paysage ? "landscape" : "portrait";
  const doc = new JsPdf({ unit: "mm", format: [Math.min(page.largeur, page.hauteur), Math.max(page.largeur, page.hauteur)], orientation, compress: true });
  doc.setProperties({ title: "Étiquettes tableau électrique", creator: "VoltApp" });

  const mesure: Mesure = (texte, pt, gras) => {
    doc.setFont("helvetica", gras ? "bold" : "normal");
    doc.setFontSize(pt);
    return doc.getTextWidth(texte);
  };

  planches.forEach((planche, p) => {
    if (p > 0) doc.addPage([Math.min(page.largeur, page.hauteur), Math.max(page.largeur, page.hauteur)], orientation);
    for (const c of planche) {
      if (!c.etiquette) continue;
      if (opt.guides) {
        doc.setDrawColor(170, 170, 170);
        doc.setLineWidth(0.15);
        doc.setLineCap("butt");
        doc.rect(c.x, c.y, c.largeur, c.hauteur);
      }
      const e = c.etiquette;
      const mise = composerEtiquette(e.texte, e.ligne2, c.largeur, c.hauteur, pictoDeEtiquette(e, opt.pictos), mesure);
      if (mise.picto) dessinerPicto(doc, mise.picto.id, c.x + mise.picto.x, c.y + mise.picto.y, mise.picto.taille);
      doc.setTextColor(0, 0, 0);
      for (const l of mise.lignes) {
        doc.setFont("helvetica", l.gras ? "bold" : "normal");
        doc.setFontSize(l.pt);
        doc.text(l.texte, c.x + l.x, c.y + l.y, { align: "center" });
      }
    }
  });
  return { blob: doc.output("blob"), nom: "etiquettes-tableau.pdf" };
}
