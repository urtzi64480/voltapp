import type { CourseItem } from "@/lib/courseItems";

export interface CourseExportMeta {
  numero: string;
  clientNom?: string;
  objet?: string;
}

function qtyLabel(it: CourseItem): string {
  const hasUnit = it.unite && it.unite !== "u" && it.unite !== "forfait";
  return hasUnit ? `${it.qty} ${it.unite}` : `${it.qty}×`;
}

export function courseFileName(numero: string): string {
  const safe = String(numero || "devis").replace(/[^A-Za-z0-9_-]+/g, "-");
  return `liste-courses-${safe}.pdf`;
}

// Version texte (copier / partager / coller dans Notes, WhatsApp, Rappels...)
export function buildCourseText(
  items: CourseItem[],
  checked: Record<string, boolean>,
  meta: CourseExportMeta
): string {
  const lines: string[] = [`Liste de courses — Devis ${meta.numero}`];
  if (meta.clientNom) lines.push(meta.clientNom);
  if (meta.objet) lines.push(meta.objet);
  lines.push("");
  for (const it of items) {
    lines.push(`${checked[it.key] ? "☑" : "☐"} ${qtyLabel(it)} ${it.nom}`);
  }
  return lines.join("\n");
}

// Version PDF (A4, cases à cocher dessinées, pagination automatique)
export async function genPDFListeCourses(
  items: CourseItem[],
  checked: Record<string, boolean>,
  meta: CourseExportMeta
): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const PAGE_H = 297;
  const MARGIN = 15;
  const RIGHT = 195;
  const NAME_W = 140;
  const BOTTOM = PAGE_H - 18;

  let y = MARGIN + 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(20, 20, 20);
  doc.text("Liste de courses", MARGIN, y);

  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110, 110, 110);
  doc.text(`Devis ${meta.numero}${meta.clientNom ? ` · ${meta.clientNom}` : ""}`, MARGIN, y);

  if (meta.objet) {
    y += 5;
    const objLines: string[] = doc.splitTextToSize(meta.objet, RIGHT - MARGIN);
    doc.text(objLines.slice(0, 2), MARGIN, y);
    y += (Math.min(objLines.length, 2) - 1) * 4.5;
  }

  const done = items.filter(it => checked[it.key]).length;
  y += 5;
  doc.text(
    `${done} / ${items.length} coché${done > 1 ? "s" : ""} · édité le ${new Date().toLocaleDateString("fr-FR")}`,
    MARGIN,
    y
  );

  y += 4;
  doc.setDrawColor(210, 210, 210);
  doc.line(MARGIN, y, RIGHT, y);
  y += 8;

  doc.setFontSize(11);

  for (const it of items) {
    const isChecked = !!checked[it.key];
    const nameLines: string[] = doc.splitTextToSize(it.nom, NAME_W);
    const rowH = Math.max(8, nameLines.length * 5 + 3);

    if (y + rowH > BOTTOM) {
      doc.addPage();
      y = MARGIN + 6;
    }

    // Case à cocher
    doc.setDrawColor(90, 90, 90);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN, y - 3.6, 4.6, 4.6);
    if (isChecked) {
      doc.setDrawColor(16, 150, 100);
      doc.setLineWidth(0.6);
      doc.line(MARGIN + 0.9, y - 1.2, MARGIN + 2.1, y + 0.3);
      doc.line(MARGIN + 2.1, y + 0.3, MARGIN + 4, y - 2.9);
      doc.setLineWidth(0.2);
    }

    // Nom + quantité
    if (isChecked) doc.setTextColor(150, 150, 150);
    else doc.setTextColor(20, 20, 20);
    doc.setFont("helvetica", "normal");
    doc.text(nameLines, MARGIN + 9, y);
    doc.setFont("helvetica", "bold");
    doc.text(qtyLabel(it), RIGHT, y, { align: "right" });

    y += rowH;
  }

  return doc.output("blob");
}
