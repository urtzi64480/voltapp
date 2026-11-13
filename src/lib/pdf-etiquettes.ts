// src/lib/pdf-etiquettes.ts — PDF A4 des planches d'étiquettes (jsPDF, millimètres, échelle 100 % : imprimer « taille réelle »).

import type { jsPDF } from "jspdf";
import { composerEtiquette, composerPicto, pageDe, pictoDeEtiquette, type FormatPlanche, type GroupePlanches, type Mesure } from "./etiquettes";
import { BOITE_PICTO, PICTOS, TRAIT_PICTO } from "./pictogrammes";

export interface OptionsPdfEtiquettes { guides: boolean }

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

/** Construit le PDF : une ou plusieurs planches par sorte d'étiquette (pictogrammes seuls, textes seuls). Les cases vides (planche entamée) ne sont ni imprimées ni encadrées. */
export async function genererPdfEtiquettes(groupes: GroupePlanches[], opt: OptionsPdfEtiquettes): Promise<{ blob: Blob; nom: string }> {
  if (groupes.length === 0 || groupes.every(g => g.planches.length === 0)) throw new Error("Aucune planche à imprimer.");
  const { default: JsPdf } = await import("jspdf");
  const taille = (f: FormatPlanche): [number, number] => { const p = pageDe(f); return [Math.min(p.largeur, p.hauteur), Math.max(p.largeur, p.hauteur)]; };
  const orient = (f: FormatPlanche) => (f.paysage ? "landscape" : "portrait") as "landscape" | "portrait";
  const premier = groupes[0].format;
  const doc = new JsPdf({ unit: "mm", format: taille(premier), orientation: orient(premier), compress: true });
  doc.setProperties({ title: "Étiquettes tableau électrique", creator: "VoltApp" });

  const mesure: Mesure = (texte, pt, gras) => {
    doc.setFont("helvetica", gras ? "bold" : "normal");
    doc.setFontSize(pt);
    return doc.getTextWidth(texte);
  };

  let premiere = true;
  for (const groupe of groupes) {
    for (const planche of groupe.planches) {
      if (!premiere) doc.addPage(taille(groupe.format), orient(groupe.format));
      premiere = false;
      for (const c of planche) {
        if (!c.etiquette) continue;
        if (opt.guides) {
          doc.setDrawColor(170, 170, 170);
          doc.setLineWidth(0.15);
          doc.setLineCap("butt");
          doc.rect(c.x, c.y, c.largeur, c.hauteur);
        }
        const e = c.etiquette;
        if (groupe.genre === "picto") {
          const p = composerPicto(c.largeur, c.hauteur, pictoDeEtiquette(e, true));
          if (p) dessinerPicto(doc, p.id, c.x + p.x, c.y + p.y, p.taille);
          continue;
        }
        const mise = composerEtiquette(e.texte, e.ligne2, c.largeur, c.hauteur, null, mesure);
        doc.setTextColor(0, 0, 0);
        for (const l of mise.lignes) {
          doc.setFont("helvetica", l.gras ? "bold" : "normal");
          doc.setFontSize(l.pt);
          doc.text(l.texte, c.x + l.x, c.y + l.y, { align: "center" });
        }
      }
    }
  }
  const nom = groupes.length > 1 ? "etiquettes-pictos-et-textes.pdf" : groupes[0].genre === "picto" ? "etiquettes-pictogrammes.pdf" : "etiquettes-textes.pdf";
  return { blob: doc.output("blob"), nom };
}
