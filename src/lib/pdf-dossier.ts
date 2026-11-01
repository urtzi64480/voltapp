// PDF « Procès-verbal de réception » (une page) et « Dossier de fin de chantier » (PV + travaux + contrôles + garanties + photos).
import type { Profil } from "@/types";
import { fmtDate } from "./utils";
import { loadLogoBase64 } from "./pdf";
import { controlesRemis, type Controles } from "./checklist-fin-chantier";
import { garanties } from "./garanties";

export interface LigneTravaux { nom: string; quantite: number; unite?: string | null; type_branche?: string | null }
export interface InfosDossier {
  numeroDevis: string;
  objet?: string | null;
  client?: { nom: string; prenom?: string | null; adresse?: string | null; code_postal?: string | null; ville?: string | null } | null;
  lignes: LigneTravaux[];
  contexte?: string; // texte du devis (contrôles proposés)
}

export const nomFichierDossier = (numero: string, type: "pv" | "dossier") =>
  `${type === "pv" ? "pv-reception" : "dossier-fin-chantier"}-${numero.replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`;

async function imageEnDataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise<string | null>(ok => { const f = new FileReader(); f.onload = () => ok(typeof f.result === "string" ? f.result : null); f.onerror = () => ok(null); f.readAsDataURL(blob); });
  } catch { return null; }
}

export async function genPDFDossierBlob(type: "pv" | "dossier", controles: Controles | undefined, profil: Profil, infos: InfosDossier): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 18;
  const reception = controles?.reception;

  let logo = await loadLogoBase64((profil as { logo_url?: string | null }).logo_url);
  doc.setFillColor(28, 25, 23); doc.rect(0, 0, W, 38, "F");
  if (logo) { try { doc.addImage(logo, "PNG", M, 6, 24, 24); } catch { logo = null; } }
  const tx = logo ? M + 28 : M;
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(251, 191, 36);
  doc.text(type === "pv" ? "PROCÈS-VERBAL DE RÉCEPTION" : "DOSSIER DE FIN DE CHANTIER", tx, 16);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(200, 200, 190);
  doc.text(`Devis N° ${infos.numeroDevis}`, tx, 23);
  if (reception) doc.text(`Réception du ${fmtDate(reception.le)}`, tx, 28);
  [profil.nom_entreprise || `${profil.prenom ?? ""} ${profil.nom ?? ""}`.trim(), profil.siret ? `SIRET ${profil.siret}` : "", profil.telephone ?? "", profil.email ?? ""]
    .filter(Boolean).forEach((l, i) => {
      doc.setFont("helvetica", i === 0 ? "bold" : "normal"); doc.setFontSize(8);
      doc.setTextColor(i === 0 ? 255 : 200, i === 0 ? 255 : 200, i === 0 ? 255 : 190);
      doc.text(l, W - M, 13 + i * 5.5, { align: "right" });
    });

  const titre = (t: string, y: number) => { doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(120, 113, 108); doc.text(t.toUpperCase(), M, y); doc.setTextColor(28, 25, 23); };
  const fin = () => ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 0);
  const place = (y: number, besoin: number) => { if (y + besoin > H - 22) { doc.addPage(); return 20; } return y; };

  // Client et chantier
  let y = 48;
  titre("Client et chantier", y); y += 6;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text(infos.client ? `${infos.client.prenom ?? ""} ${infos.client.nom}`.trim() : "—", M, y); y += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(87, 83, 78);
  const adr = [infos.client?.adresse, infos.client?.code_postal, infos.client?.ville].filter(Boolean).join(" ");
  if (adr) { doc.text(adr, M, y); y += 5; }
  if (infos.objet) { doc.text(`Objet : ${infos.objet}`, M, y, { maxWidth: W - 2 * M }); y += 5; }

  // Réception
  y += 3; titre("Réception des travaux", y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(44, 38, 34);
  if (reception) {
    doc.text(`Les travaux ont été réceptionnés le ${fmtDate(reception.le)} par ${reception.nom}.`, M, y, { maxWidth: W - 2 * M }); y += 6;
    doc.text(reception.reserves ? `Réserves : ${reception.reserves}` : "Sans réserve.", M, y, { maxWidth: W - 2 * M });
    y += reception.reserves ? Math.ceil(reception.reserves.length / 95) * 4.5 + 3 : 8;
    y = place(y, 40);
    try { doc.addImage(reception.signature, "PNG", M, y, 60, 22); } catch { /* signature illisible : on garde le texte */ }
    doc.setFontSize(7.5); doc.setTextColor(120, 113, 108);
    doc.text(`Signature de ${reception.nom}`, M, y + 26);
    y += 32;
  } else { doc.text("Réception non encore signée.", M, y); y += 8; }

  // Garanties
  if (reception) {
    y = place(y, 40);
    autoTable(doc, {
      startY: y, margin: { left: M, right: M, bottom: 24 },
      head: [["Garantie", "Durée", "Jusqu'au", "Objet"]],
      body: garanties(reception.le).map(g => [g.nom, `${g.annees} an${g.annees > 1 ? "s" : ""}`, fmtDate(g.fin), g.detail]),
      headStyles: { fillColor: [28, 25, 23], textColor: [251, 191, 36], fontSize: 8 }, bodyStyles: { fontSize: 8 },
      columnStyles: { 0: { cellWidth: 34 }, 1: { cellWidth: 16 }, 2: { cellWidth: 26 }, 3: { cellWidth: 98 } },
    });
    y = fin() + 3;
    doc.setFont("helvetica", "italic"); doc.setFontSize(7); doc.setTextColor(120, 113, 108);
    doc.text("Les durées légales courent à compter de la réception ; leur application dépend de la nature des travaux.", M, y, { maxWidth: W - 2 * M }); y += 8;
  }

  if (type === "dossier") {
    // Travaux réalisés
    y = place(y, 30); titre("Travaux et équipements posés", y);
    autoTable(doc, {
      startY: y + 3, margin: { left: M, right: M, bottom: 24 },
      head: [["Désignation", "Quantité"]],
      body: infos.lignes.length === 0 ? [[{ content: "—", colSpan: 2 }]] : infos.lignes.map(l => [l.nom, `${l.quantite}${l.unite ? ` ${l.unite}` : ""}`]),
      headStyles: { fillColor: [28, 25, 23], textColor: [251, 191, 36], fontSize: 8 }, bodyStyles: { fontSize: 8 }, alternateRowStyles: { fillColor: [250, 250, 249] },
      columnStyles: { 0: { cellWidth: 130 }, 1: { cellWidth: 44, halign: "center" } },
    });
    y = fin() + 8;

    // Contrôles réalisés
    const remis = controlesRemis(controles, infos.contexte ?? "");
    y = place(y, 30); titre("Contrôles réalisés en fin de chantier", y);
    autoTable(doc, {
      startY: y + 3, margin: { left: M, right: M, bottom: 24 },
      head: [["Contrôle", "Mesure / commentaire", "Date"]],
      body: remis.length === 0 ? [[{ content: "Aucun contrôle consigné.", colSpan: 3, styles: { halign: "center" } }]]
        : remis.map(c => [c.libelle, [c.fait?.valeur ? `${c.fait.valeur}${c.mesure && !c.fait.valeur.includes(c.mesure) ? ` ${c.mesure}` : ""}` : "", c.commentaire ?? ""].filter(Boolean).join("\n") || "—", c.fait ? fmtDate(c.fait.le) : ""]),
      headStyles: { fillColor: [28, 25, 23], textColor: [251, 191, 36], fontSize: 8 }, bodyStyles: { fontSize: 8 }, alternateRowStyles: { fillColor: [250, 250, 249] },
      columnStyles: { 0: { cellWidth: 82 }, 1: { cellWidth: 56 }, 2: { cellWidth: 36, halign: "center" } },
    });
    y = fin() + 4;
    doc.setFont("helvetica", "italic"); doc.setFontSize(7); doc.setTextColor(120, 113, 108);
    doc.text("Récapitulatif des contrôles effectués par l'installateur : ne constitue ni une attestation Consuel ni un rapport de vérification réglementaire.", M, y, { maxWidth: W - 2 * M });

    // Photos
    const photos = controles?.photos ?? [];
    if (photos.length > 0) {
      doc.addPage(); let py = 20; titre("Photos du chantier", py); py += 6;
      const larg = (W - 2 * M - 6) / 2;
      let col = 0, hLigne = 0;
      for (const p of photos) {
        const data = await imageEnDataUrl(p.url);
        if (!data) continue;
        let w = larg, h = larg * 0.75;
        try { const pr = doc.getImageProperties(data); h = Math.min(larg * 1.1, (larg * pr.height) / pr.width); } catch { continue; }
        if (col === 0 && py + h + 10 > H - 22) { doc.addPage(); py = 20; }
        const x = M + col * (larg + 6);
        try { doc.addImage(data, "JPEG", x, py, w, h); } catch { continue; }
        if (p.legende) { doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(87, 83, 78); doc.text(p.legende, x, py + h + 4, { maxWidth: larg }); }
        hLigne = Math.max(hLigne, h + (p.legende ? 8 : 4));
        if (col === 1) { py += hLigne; col = 0; hLigne = 0; if (py + 40 > H - 22) { doc.addPage(); py = 20; } } else col = 1;
      }
    }
  }

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(120, 113, 108);
    doc.text(`${profil.nom_entreprise || ""} · Devis ${infos.numeroDevis}`, M, H - 8);
    doc.text(`Page ${p}/${total}`, W - M, H - 8, { align: "right" });
  }
  return doc.output("blob");
}
