const pH = doc.internal.pageSize.getHeight();
  doc.setFillColor(28, 25, 23);
  doc.rect(0, pH - 18, W, 18, "F");

  // Coordonnées bancaires (gauche)
  if (profil.iban || profil.bic) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(180, 180, 170);
    doc.text("RÈGLEMENT PAR VIREMENT", M, pH - 13);
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
      doc.text(l, M, pH - 9 + i * 4);
    });
  }

  // Conditions de paiement (droite)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(120, 113, 108);
  doc.text(profil.conditions_paiement ?? "", W - M, pH - 4, { align: "right" });