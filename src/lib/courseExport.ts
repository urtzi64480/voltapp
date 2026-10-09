import type { CourseItem, ComparatifAchat } from "@/lib/courseItems";

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

// ─── Courses faites par le client : prix fournisseurs TTC (sans marge) et comparatif avec le prix du devis ───
// Exports déclenchés à la main par l'artisan, depuis sa page privée. Le lien public de la liste n'en reprend rien.


const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const qtyTexte = (l: { qty: number; unite?: string }) =>
  l.unite && l.unite !== "u" && l.unite !== "forfait" ? `${l.qty} ${l.unite}` : `${l.qty}×`;

export function comparatifFileName(numero: string, avecComparatif: boolean): string {
  const safe = String(numero || "devis").replace(/[^A-Za-z0-9_-]+/g, "-");
  return `${avecComparatif ? "comparatif-courses" : "courses-prix-fournisseurs"}-${safe}.pdf`;
}

// avecComparatif = false : liste d'achat chez les fournisseurs (prix TTC unitaires et totaux, sans mon prix).
// avecComparatif = true  : ajoute, ligne par ligne et en total, ce que le même matériel coûte sur le devis.
export function buildPrixFournisseursText(c: ComparatifAchat, meta: CourseExportMeta, avecComparatif: boolean): string {
  const lines: string[] = [avecComparatif ? `Comparatif courses — Devis ${meta.numero}` : `Courses chez les fournisseurs (prix TTC) — Devis ${meta.numero}`];
  if (meta.clientNom) lines.push(meta.clientNom);
  if (meta.objet) lines.push(meta.objet);
  lines.push("");
  c.groupes.forEach(g => {
    lines.push(`${g.fournisseur ?? "Fournisseur non précisé"} — ${eur(g.achat)} TTC`);
    g.lignes.forEach(l => {
      const achat = l.achatUnitaire != null ? `${eur(l.achatUnitaire)} → ${eur(l.achatTotal ?? 0)}` : "prix non renseigné";
      lines.push(`  • ${qtyTexte(l)} ${l.nom} : ${achat}${avecComparatif && l.achatUnitaire != null ? ` (devis : ${eur(l.venteTotal)})` : ""}`);
    });
    lines.push("");
  });
  lines.push(`Total en achetant soi-même (TTC) : ${eur(c.totalAchat)}`);
  if (avecComparatif) {
    lines.push(`Même matériel sur le devis : ${eur(c.totalVente)}`);
    lines.push(`Écart : ${eur(c.ecart)}${c.economiePct != null ? ` (${c.economiePct.toLocaleString("fr-FR")} % du prix devis)` : ""}`);
  }
  if (c.nbSansPrix > 0) lines.push(`${c.nbSansPrix} ligne(s) sans prix d'achat renseigné, exclue(s) des totaux.`);
  return lines.join("\n");
}

export async function genPDFPrixFournisseurs(c: ComparatifAchat, meta: CourseExportMeta, avecComparatif: boolean): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const MARGIN = 15, RIGHT = 195, BOTTOM = 297 - 18;
  // Colonnes (alignées à droite) : sans comparatif = unitaire + total ; avec = + prix devis.
  const COL_TOTAL = avecComparatif ? 150 : RIGHT, COL_UNIT = avecComparatif ? 125 : 160, COL_VENTE = RIGHT;
  const NAME_W = avecComparatif ? 80 : 110;
  let y = MARGIN + 6;
  const saut = (h: number) => { if (y + h > BOTTOM) { doc.addPage(); y = MARGIN + 6; } };

  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(20, 20, 20);
  doc.text(avecComparatif ? "Comparatif des courses" : "Courses chez les fournisseurs", MARGIN, y);
  y += 7; doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(110, 110, 110);
  doc.text(`Devis ${meta.numero}${meta.clientNom ? ` · ${meta.clientNom}` : ""} · prix TTC · édité le ${new Date().toLocaleDateString("fr-FR")}`, MARGIN, y);
  y += 4; doc.setDrawColor(210, 210, 210); doc.line(MARGIN, y, RIGHT, y); y += 8;

  c.groupes.forEach(g => {
    saut(20);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20, 20, 20);
    doc.text(g.fournisseur ?? "Fournisseur non précisé", MARGIN, y);
    doc.text(eur(g.achat), COL_TOTAL, y, { align: "right" });
    y += 5;
    doc.setFontSize(8); doc.setTextColor(120, 120, 120);
    doc.text("Article", MARGIN, y); doc.text("Prix unitaire", COL_UNIT, y, { align: "right" }); doc.text("Total TTC", COL_TOTAL, y, { align: "right" });
    if (avecComparatif) doc.text("Sur le devis", COL_VENTE, y, { align: "right" });
    y += 4; doc.setFontSize(10); doc.setFont("helvetica", "normal");
    g.lignes.forEach(l => {
      const nom: string[] = doc.splitTextToSize(`${qtyTexte(l)} ${l.nom}`, NAME_W);
      const h = Math.max(6, nom.length * 4.6 + 1.5);
      saut(h);
      doc.setTextColor(20, 20, 20); doc.text(nom, MARGIN, y);
      if (l.achatUnitaire != null) {
        doc.text(eur(l.achatUnitaire), COL_UNIT, y, { align: "right" });
        doc.text(eur(l.achatTotal ?? 0), COL_TOTAL, y, { align: "right" });
        if (avecComparatif) doc.text(eur(l.venteTotal), COL_VENTE, y, { align: "right" });
      } else {
        doc.setTextColor(180, 110, 20); doc.text("prix non renseigné", COL_TOTAL, y, { align: "right" });
      }
      y += h;
    });
    y += 4;
  });

  saut(26);
  doc.setDrawColor(210, 210, 210); doc.line(MARGIN, y, RIGHT, y); y += 7;
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(20, 20, 20);
  doc.text("Total en achetant soi-même (TTC)", MARGIN, y); doc.text(eur(c.totalAchat), RIGHT, y, { align: "right" });
  if (avecComparatif) {
    y += 6; doc.text("Même matériel sur le devis", MARGIN, y); doc.text(eur(c.totalVente), RIGHT, y, { align: "right" });
    y += 6; doc.text("Écart", MARGIN, y);
    doc.text(`${eur(c.ecart)}${c.economiePct != null ? ` (${c.economiePct.toLocaleString("fr-FR")} %)` : ""}`, RIGHT, y, { align: "right" });
  }
  if (c.nbSansPrix > 0) {
    y += 7; doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(180, 110, 20);
    doc.text(`${c.nbSansPrix} ligne(s) sans prix d'achat renseigné, exclue(s) des totaux.`, MARGIN, y);
  }
  return doc.output("blob");
}
