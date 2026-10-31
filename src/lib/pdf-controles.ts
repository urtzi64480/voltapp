// PDF « Contrôles de fin de chantier » remis au client : uniquement les contrôles retenus ET réalisés.
// Ce document n'est PAS une attestation Consuel ni un rapport de vérification réglementaire : il le dit explicitement.
import type { Profil } from "@/types";
import { fmtDate } from "./utils";
import { loadLogoBase64 } from "./pdf";
import { controlesRemis, type Controles } from "./checklist-fin-chantier";

export interface InfosPdfControles {
  numeroDevis: string;
  objet?: string | null;
  client?: { nom: string; prenom?: string | null; adresse?: string | null } | null;
  dateChantier?: string | null; // AAAA-MM-JJ (validation du chantier) ; sinon date du jour
}

export const nomFichierControles = (numero: string) =>
  `controles-${numero.replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`;

export async function genPDFControlesBlob(controles: Controles | undefined, profil: Profil, infos: InfosPdfControles): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 18;

  let logo = await loadLogoBase64((profil as { logo_url?: string | null }).logo_url);
  doc.setFillColor(28, 25, 23); doc.rect(0, 0, W, 38, "F");
  if (logo) { try { doc.addImage(logo, "PNG", M, 6, 24, 24); } catch { logo = null; } }
  const tx = logo ? M + 28 : M;
  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(251, 191, 36);
  doc.text("CONTRÔLES DE FIN DE CHANTIER", tx, 16);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(200, 200, 190);
  doc.text(`Devis N° ${infos.numeroDevis}`, tx, 23);
  const date = infos.dateChantier || new Date().toISOString().slice(0, 10);
  doc.text(`Chantier du ${fmtDate(date)}`, tx, 28);

  [
    profil.nom_entreprise || `${profil.prenom ?? ""} ${profil.nom ?? ""}`.trim(),
    profil.siret ? `SIRET ${profil.siret}` : "",
    profil.telephone ?? "",
    profil.email ?? "",
  ].filter(Boolean).forEach((l, i) => {
    doc.setFont("helvetica", i === 0 ? "bold" : "normal"); doc.setFontSize(8);
    doc.setTextColor(i === 0 ? 255 : 200, i === 0 ? 255 : 200, i === 0 ? 255 : 190);
    doc.text(l, W - M, 13 + i * 5.5, { align: "right" });
  });

  doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(120, 113, 108);
  doc.text("CLIENT", M, 48);
  doc.setFontSize(10); doc.setTextColor(28, 25, 23);
  doc.text(infos.client ? `${infos.client.prenom ?? ""} ${infos.client.nom}`.trim() : "—", M, 54);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(87, 83, 78);
  let y = 59;
  if (infos.client?.adresse) { doc.text(infos.client.adresse, M, y); y += 5; }
  if (infos.objet) { doc.text(`Objet : ${infos.objet}`, M, y, { maxWidth: W - 2 * M }); y += 5; }

  const remis = controlesRemis(controles);
  autoTable(doc, {
    startY: y + 4,
    head: [["Contrôle réalisé", "Catégorie", "Mesure", "Date"]],
    body: remis.length === 0
      ? [[{ content: "Aucun contrôle consigné.", colSpan: 4, styles: { halign: "center" } }]]
      : remis.map(c => [
        c.libelle + (c.aide ? `\n${c.aide}` : ""),
        c.categorie,
        c.fait?.valeur ? `${c.fait.valeur}${c.mesure && !c.fait.valeur.includes(c.mesure) ? ` ${c.mesure}` : ""}` : "—",
        c.fait ? fmtDate(c.fait.le) : "",
      ]),
    headStyles: { fillColor: [28, 25, 23], textColor: [251, 191, 36], fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 8.5, textColor: [44, 38, 34], valign: "middle" },
    alternateRowStyles: { fillColor: [250, 250, 249] },
    columnStyles: { 0: { cellWidth: 74 }, 1: { cellWidth: 30 }, 2: { cellWidth: 34, halign: "center" }, 3: { cellWidth: 36, halign: "center" } },
    margin: { left: M, right: M, bottom: 24 },
  });

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    const H = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "italic"); doc.setFontSize(7); doc.setTextColor(120, 113, 108);
    doc.text(
      "Récapitulatif des contrôles effectués par l'installateur à la fin du chantier. Ce document ne constitue ni une attestation de conformité Consuel, ni un rapport de vérification réglementaire.",
      M, H - 12, { maxWidth: W - 2 * M },
    );
    doc.text(`Page ${p}/${total}`, W - M, H - 6, { align: "right" });
  }
  return doc.output("blob");
}
