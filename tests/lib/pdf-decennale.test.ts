import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { genPDFDevisBlob } from "@/lib/pdf";
import type { Devis, Profil } from "@/types";

const devis = {
  id: "d1", numero: "DEV-0001", statut: "brouillon", total_service: 100, total_materiau: 50, total_ttc: 150, created_at: "2026-11-10T10:00:00Z",
  lignes: [{ nom: "Prise", quantite: 2, prix_unitaire: 25, unite: "u", type_branche: "materiau" }, { nom: "Pose", quantite: 2, prix_unitaire: 50, unite: "h", type_branche: "service" }],
} as unknown as Devis;
const profil = (extra: Record<string, unknown> = {}) => ({
  id: "u1", prefixe_devis: "DEV", prefixe_facture: "FAC", compteur_devis: 1, compteur_facture: 0, mention_tva: "TVA non applicable — Art. 293 B du CGI",
  conditions_paiement: "Paiement à réception", taux_horaire: 55, created_at: "", updated_at: "", nom_entreprise: "Elec Ben", ...extra,
}) as unknown as Profil;

describe("PDF devis : mention décennale", () => {
  it("se génère (1 page) avec et sans mention, sans erreur", async () => {
    const sans = await PDFDocument.load(await (await genPDFDevisBlob(devis, profil())).arrayBuffer());
    const futur = new Date(); futur.setFullYear(futur.getFullYear() + 1);
    const avec = await PDFDocument.load(await (await genPDFDevisBlob(devis, profil({
      assurance_assureur: "AXA", assurance_contrat: "123", assurance_zone: "France métropolitaine", assurance_fin: futur.toISOString().slice(0, 10),
    }))).arrayBuffer());
    expect(sans.getPageCount()).toBe(1);
    expect(avec.getPageCount()).toBe(1);
  }, 30000);
});
