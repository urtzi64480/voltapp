import { describe, it, expect } from "vitest";
import { genPDFControlesBlob, nomFichierControles } from "@/lib/pdf-controles";
import { appliquerActionControles, controlesVides } from "@/lib/checklist-fin-chantier";
import type { Profil } from "@/types";

describe("PDF contrôles", () => {
  it("génère un PDF valide, avec et sans contrôle", async () => {
    const profil = { id: "u", nom_entreprise: "Elec Test", prefixe_devis: "D", prefixe_facture: "F", compteur_devis: 1, compteur_facture: 1, mention_tva: "", conditions_paiement: "", taux_horaire: 50 } as Profil;
    const c = controlesVides();
    appliquerActionControles(c, { action: "fait", id: "resistance-terre", fait: true, dateIso: "2026-10-01T10:00:00Z" });
    appliquerActionControles(c, { action: "valeur", id: "resistance-terre", valeur: "35" });
    appliquerActionControles(c, { action: "commentaire", id: "resistance-terre", texte: "Mesure faite par temps sec, piquet accessible dans le jardin" });
    const infos = { numeroDevis: "D-2026/001", objet: "Rénovation", client: { nom: "Dupont", prenom: "Jean", adresse: "1 rue X" }, dateChantier: "2026-10-01" };
    for (const ctl of [c, undefined]) {
      const blob = await genPDFControlesBlob(ctl, profil, infos);
      const txt = Buffer.from(await blob.arrayBuffer()).subarray(0, 5).toString();
      expect(txt).toBe("%PDF-");
    }
    expect(nomFichierControles("D-2026/001")).toBe("controles-D-2026-001.pdf");
  });
});
