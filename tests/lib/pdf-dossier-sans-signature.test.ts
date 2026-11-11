import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { genPDFDossierBlob } from "@/lib/pdf-dossier";
import type { Profil } from "@/types";

const profil = { id: "u", nom_entreprise: "Elec Ben", email: "b@x.fr" } as unknown as Profil;
const infos = { numeroDevis: "DEV-0001", objet: "Rénovation", client: { nom: "Dupont", prenom: "Jean" }, contexte: "", lignes: [{ nom: "Prise", quantite: 3, unite: "u", type_branche: "materiau" }] } as never;

describe("rapport de fin de chantier sans signature du client", () => {
  it("se génère sans réception signée", async () => {
    const pdf = await PDFDocument.load(await (await genPDFDossierBlob("dossier", undefined, profil, infos)).arrayBuffer());
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  }, 30000);
  it("le procès-verbal, lui, reste « non signé » sans réception (l'appli le bloque en amont)", async () => {
    const pdf = await PDFDocument.load(await (await genPDFDossierBlob("pv", undefined, profil, infos)).arrayBuffer());
    expect(pdf.getPageCount()).toBe(1);
  }, 30000);
});
