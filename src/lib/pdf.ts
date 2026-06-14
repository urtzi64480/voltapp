"use client";
import { Devis, Profil, Facture } from "@/types";
import { fmt, fmtDate, fmtDatetime } from "./utils";

interface Acompte {
  id: string;
  facture_id: string;
  montant: number;
  date_versement: string;
  notes?: string;
  created_at: string;
}

async function loadLogoBase64(): Promise<string | null> {
  try {
    const res = await fetch("/logo.png");
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function buildDevisDoc(devis: Devis, profil: Profil, sigData?: string) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 18;

  const logoBase64 = await loadLogoBase64();

  doc.setFillColor(28, 25, 23);
  doc.rect(0, 0, W, 38, "F");

  if (logoBase64) {
    doc.addImage(logoBase64, "PNG", M, 6, 24, 24);
  }

  const textX = logoBase64 ? M + 28 : M;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(251, 191, 36);
  doc.text("DEVIS", textX, 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(200, 200, 190);
  doc.text(`N° ${devis.numero}`, textX, 23);
  doc.text(`Émis le ${fmtDate(devis.date_emission)}${devis.date_validite ? ` · Valable jusqu'au ${fmtDate(devis.date_validite)}` : ""}`, textX, 28);

  const artisan = [
    profil.nom_entreprise ?? `${profil.prenom ?? ""} ${profil.nom ?? ""}`.trim(),
    profil.siret ? `SIRET ${profil.siret}` : "",
    profil.telephone ?? "",
    profil.email ?? "",
    [profil.adresse, profil.code_postal, profil.ville].filter(Boolean).join(" "),
  ].filter(Boolean);
  artisan.forEach((l, i) => {
    if (i === 0) { doc.setFont("helvetica", "bold"); doc.setTextColor(255, 255, 255); }
    else { doc.setFont("helvetica", "normal"); doc.setTextColor(200, 200, 190); }
    doc.setFontSize(8);
    doc.text(l, W - M, 13 + i * 5.5, { align: "right" });
  });

  doc.setFillColor(245, 245, 244);
  doc.rect(M, 44, 80, 28, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(120, 113, 108);
  doc.text("CLIENT", M + 4, 51);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(28, 25, 23);
  const clientNom = devis.client ? `${devis.client.prenom ?? ""} ${devis.client.nom}`.trim() : "—";
  doc.text(clientNom, M + 4, 58);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(87, 83, 78);
  if (devis.client?.adresse) doc.text(devis.client.adresse, M + 4, 64);
  if (devis.client?.telephone) doc.text(devis.client.telephone, M + 4, 69);

  if (devis.objet) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(120, 113, 108);
    doc.text("OBJET", W / 2 + 4, 51);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(28, 25, 23);
    doc.text(devis.objet, W / 2 + 4, 58);
  }

  const lignes = devis.lignes ?? [];
  autoTable(doc, {
    startY: 80,
    head: [["Désignation", "Type", "Unité", "Qté", "P.U.", "Total"]],
    body: lignes.map(l => [
      l.nom,
      l.type_branche === "service" ? "Service" : "Matériau",
      l.unite,
      l.quantite,
      fmt(l.prix_unitaire),
      fmt(l.prix_unitaire * l.quantite),
    ]),
    headStyles: { fillColor: [28, 25, 23], textColor: [251, 191, 36], fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 8.5, textColor: [44, 38, 34] },
    alternateRowStyles: { fillColor: [250, 250, 249] },
    columnStyles: {
      0: { cellWidth: 65 }, 1: { cellWidth: 22 }, 2: { cellWidth: 18 },
      3: { cellWidth: 12, halign: "center" }, 4: { cellWidth: 25, halign: "right" },
      5: { cellWidth: 25, halign: "right" },
    },
    margin: { left: M, right: M },
  });

  const finalY = (doc as any).lastAutoTable.finalY + 6;

  const totSBrut = lignes.filter(l => l.type_branche === "service").reduce((a, l) => a + l.prix_unitaire * l.quantite, 0);
  const totMBrut = lignes.filter(l => l.type_branche === "materiau").reduce((a, l) => a + l.prix_unitaire * l.quantite, 0);
  const remiseFideliteEur = devis.remise_fidelite_pct
    ? Math.round(devis.total_service / (1 - devis.remise_fidelite_pct / 100) * devis.remise_fidelite_pct / 100 * 100) / 100
    : 0;
  const remiseS = totSBrut - devis.total_service - remiseFideliteEur;
  const remiseM = totMBrut - devis.total_materiau;

  const lignesTotal: { label: string; value: string; bold?: boolean; color?: [number, number, number] }[] = [
    { label: "Prestation service :", value: fmt(totSBrut) },
  ];
  if (remiseS > 0.01) lignesTotal.push({ label: "Remise service :", value: `- ${fmt(remiseS)}`, color: [220, 50, 50] });
  lignesTotal.push({ label: "Achat / revente :", value: fmt(totMBrut) });
  if (remiseM > 0.01) lignesTotal.push({ label: "Remise matériaux :", value: `- ${fmt(remiseM)}`, color: [220, 50, 50] });
  if (remiseFideliteEur > 0.01) lignesTotal.push({ label: `Remise fidélité ${devis.remise_fidelite_pct}% :`, value: `- ${fmt(remiseFideliteEur)}`, color: [22, 163, 74] });
  lignesTotal.push({ label: "Total net à payer :", value: fmt(devis.total_ttc), bold: true, color: [217, 119, 6] });

  const boxH = 8 + lignesTotal.length * 7;
  const bx = W - M - 72;
  doc.setFillColor(245, 245, 244);
  doc.rect(bx, finalY, 72, boxH, "F");

  lignesTotal.forEach((row, i) => {
    const y = finalY + 9 + i * 7;
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    doc.setFontSize(row.bold ? 11 : 8.5);
    const color = row.color ?? [87, 83, 78];
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(row.label, bx + 4, y);
    doc.text(row.value, bx + 68, y, { align: "right" });
  });

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(163, 163, 163);
  doc.text(profil.mention_tva ?? "TVA non applicable — Art. 293 B du CGI", M, finalY + 16);

  const sigY = finalY + boxH + 10;
  const sig = sigData ?? devis.signature_data;
  doc.setDrawColor(210, 210, 200);
  doc.line(M, sigY, W - M, sigY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120, 113, 108);
  doc.text("Bon pour accord — Signature du client :", M, sigY + 7);
  if (sig) {
    doc.addImage(sig, "PNG", M, sigY + 10, 70, 24);
    if (devis.signe_le) doc.text(`Signé le ${fmtDatetime(devis.signe_le)}`, M, sigY + 38);
  } else {
    doc.rect(M, sigY + 10, 70, 24);
  }

  const pH = doc.internal.pageSize.getHeight();
  doc.setFillColor(28, 25, 23);
  doc.rect(0, pH - 10, W, 10, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(120, 113, 108);
  doc.text(profil.conditions_paiement ?? "", W / 2, pH - 4, { align: "center" });

  return doc;
}

async function buildFactureDoc(facture: Facture, profil: Profil, acomptes: Acompte[] = []) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 18;

  const logoBase64 = await loadLogoBase64();

  doc.setFillColor(28, 25, 23);
  doc.rect(0, 0, W, 38, "F");

  if (logoBase64) {
    doc.addImage(logoBase64, "PNG", M, 6, 24, 24);
  }

  const textX = logoBase64 ? M + 28 : M;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(251, 191, 36);
  doc.text("FACTURE", textX, 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(200, 200, 190);
  doc.text(`N° ${facture.numero} · Émise le ${fmtDate(facture.date_emission)}`, textX, 23);
  if (facture.date_echeance) doc.text(`Échéance : ${fmtDate(facture.date_echeance)}`, textX, 28);

  const artisan = [
    profil.nom_entreprise ?? `${profil.prenom ?? ""} ${profil.nom ?? ""}`.trim(),
    profil.siret ? `SIRET ${profil.siret}` : "",
    profil.telephone ?? "",
    profil.email ?? "",
    [profil.adresse, profil.code_postal, profil.ville].filter(Boolean).join(" "),
  ].filter(Boolean);
  artisan.forEach((l, i) => {
    if (i === 0) { doc.setFont("helvetica", "bold"); doc.setTextColor(255, 255, 255); }
    else { doc.setFont("helvetica", "normal"); doc.setTextColor(200, 200, 190); }
    doc.setFontSize(8);
    doc.text(l, W - M, 13 + i * 5.5, { align: "right" });
  });

  if (facture.client) {
    doc.setFillColor(245, 245, 244);
    doc.rect(M, 44, 80, 24, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(28, 25, 23);
    doc.text(`${facture.client.prenom ?? ""} ${facture.client.nom}`.trim(), M + 4, 54);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(87, 83, 78);
    if (facture.client.adresse) doc.text(facture.client.adresse, M + 4, 60);
    if (facture.client.telephone) doc.text(facture.client.telephone, M + 4, 65);
  }

  autoTable(doc, {
    startY: 78,
    head: [["Désignation", "Type", "Unité", "Qté", "P.U.", "Total"]],
    body: (facture.lignes ?? []).map(l => [
      l.nom, l.type_branche === "service" ? "Service" : "Matériau",
      l.unite, l.quantite, fmt(l.prix_unitaire), fmt(l.prix_unitaire * l.quantite),
    ]),
    headStyles: { fillColor: [28, 25, 23], textColor: [251, 191, 36], fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 8.5 },
    alternateRowStyles: { fillColor: [250, 250, 249] },
    margin: { left: M, right: M },
  });

  const fy = (doc as any).lastAutoTable.finalY + 6;

  const lignes = facture.lignes ?? [];
  const totSBrut = lignes.filter(l => l.type_branche === "service").reduce((a, l) => a + l.prix_unitaire * l.quantite, 0);
  const totMBrut = lignes.filter(l => l.type_branche === "materiau").reduce((a, l) => a + l.prix_unitaire * l.quantite, 0);
  const remiseFideliteEur = facture.remise_fidelite_pct
    ? Math.round(facture.total_service / (1 - facture.remise_fidelite_pct / 100) * facture.remise_fidelite_pct / 100 * 100) / 100
    : 0;
  const remiseS = totSBrut - facture.total_service - remiseFideliteEur;
  const remiseM = totMBrut - facture.total_materiau;
  const totalAcomptes = acomptes.reduce((a, ac) => a + ac.montant, 0);
  const soldeRestant = facture.total_ttc - totalAcomptes;

  const lignesTotal: { label: string; value: string; bold?: boolean; color?: [number, number, number] }[] = [
    { label: "Prestation service :", value: fmt(totSBrut) },
  ];
  if (remiseS > 0.01) lignesTotal.push({ label: "Remise service :", value: `- ${fmt(remiseS)}`, color: [220, 50, 50] });
  lignesTotal.push({ label: "Achat / revente :", value: fmt(totMBrut) });
  if (remiseM > 0.01) lignesTotal.push({ label: "Remise matériaux :", value: `- ${fmt(remiseM)}`, color: [220, 50, 50] });
  if (remiseFideliteEur > 0.01) lignesTotal.push({ label: `Remise fidélité ${facture.remise_fidelite_pct}% :`, value: `- ${fmt(remiseFideliteEur)}`, color: [22, 163, 74] });
  lignesTotal.push({ label: "Total TTC :", value: fmt(facture.total_ttc), bold: true, color: [251, 191, 36] });
  if (acomptes.length > 0) {
    acomptes.forEach((ac, i) => {
      lignesTotal.push({
        label: `Acompte ${i + 1} (${fmtDate(ac.date_versement)})${ac.notes ? ` · ${ac.notes}` : ""} :`,
        value: `- ${fmt(ac.montant)}`,
        color: [37, 99, 235],
      });
    });
    lignesTotal.push({
      label: "Solde restant dû :",
      value: soldeRestant <= 0.01 ? "Soldé" : fmt(soldeRestant),
      bold: true,
      color: soldeRestant <= 0.01 ? [22, 163, 74] : [217, 119, 6],
    });
  }

  const boxH = 8 + lignesTotal.length * 7;
  const bx = W - M - 80;
  doc.setFillColor(28, 25, 23);
  doc.rect(bx, fy, 80, boxH, "F");

  lignesTotal.forEach((row, i) => {
    const y = fy + 9 + i * 7;
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    doc.setFontSize(row.bold ? 10 : 8);
    const color = row.color ?? [200, 200, 190];
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(row.label, bx + 4, y);
    doc.text(row.value, bx + 76, y, { align: "right" });
  });

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(163, 163, 163);
  doc.text(profil.mention_tva ?? "TVA non applicable — Art. 293 B du CGI", M, fy + 11);

  // ── Pied de page avec coordonnées bancaires ──
  const pH = doc.internal.pageSize.getHeight();
  doc.setFillColor(28, 25, 23);
  doc.rect(0, pH - 22, W, 22, "F");

  if (profil.iban || profil.bic) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(180, 180, 170);
    doc.text("RÈGLEMENT PAR VIREMENT", M, pH - 17);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(140, 140, 130);
    const lignesBanque = [
      profil.banque_titulaire ? `Titulaire : ${profil.banque_titulaire}` : null,
      profil.banque_nom ? `Banque : ${profil.banque_nom}` : null,
      profil.iban ? `IBAN : ${profil.iban}` : null,
      profil.bic ? `BIC : ${profil.bic}` : null,
    ].filter(Boolean) as string[];
    lignesBanque.forEach((l, i) => {
      doc.text(l, M, pH - 12 + i * 4);
    });
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(120, 113, 108);
  doc.text(profil.conditions_paiement ?? "", W - M, pH - 4, { align: "right" });

  return doc;
}

// ── API publique ─────────────────────────────────────────────────────────────

export async function genPDFDevis(devis: Devis, profil: Profil, sigData?: string) {
  const doc = await buildDevisDoc(devis, profil, sigData);
  doc.save(`Devis-${devis.numero}.pdf`);
}

export async function genPDFDevisBlob(devis: Devis, profil: Profil, sigData?: string): Promise<Blob> {
  const doc = await buildDevisDoc(devis, profil, sigData);
  return doc.output("blob");
}

export async function genPDFFacture(facture: Facture, profil: Profil, acomptes: Acompte[] = []) {
  const doc = await buildFactureDoc(facture, profil, acomptes);
  doc.save(`Facture-${facture.numero}.pdf`);
}

export async function genPDFFactureBlob(facture: Facture, profil: Profil, acomptes: Acompte[] = []): Promise<Blob> {
  const doc = await buildFactureDoc(facture, profil, acomptes);
  return doc.output("blob");
}
