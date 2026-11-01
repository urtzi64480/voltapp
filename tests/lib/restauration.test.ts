import { describe, it, expect } from "vitest";
import { joursDepuis, lireSauvegarde, preparerLignes, restaurer } from "@/lib/restauration";
import { composerResume } from "@/lib/resume-quotidien";

const fichier = (tables: Record<string, unknown[]>) => JSON.stringify({ version: 1, genere_le: "2026-11-01T10:00:00Z", tables, erreurs: {}, comptes: {} });

describe("restauration", () => {
  it("refuse ce qui n'est pas une sauvegarde", () => {
    expect(lireSauvegarde("pas du json").ok).toBe(false);
    expect(lireSauvegarde("[]").ok).toBe(false);
    expect(lireSauvegarde(JSON.stringify({ version: 2, tables: {} })).ok).toBe(false);
    expect(lireSauvegarde(fichier({ inconnue: [{ id: 1 }] })).ok).toBe(false);
  });
  it("ignore les tables inconnues et les lignes invalides", () => {
    const r = lireSauvegarde(fichier({ clients: [{ id: "a" }, null, 3, { id: "b" }], pirate: [{ x: 1 }] }));
    expect(r.ok && r.fichier.comptes).toEqual({ clients: 2 });
    expect(r.ok && Object.keys(r.fichier.tables)).toEqual(["clients"]);
  });
  it("les compteurs du profil ne reculent jamais", () => {
    expect(preparerLignes("profil", [{ id: "u", compteur_devis: 3, compteur_facture: 2, adresse: "x" }])).toEqual([{ id: "u", adresse: "x" }]);
    expect(preparerLignes("clients", [{ id: "a", compteur_devis: 3 }])).toEqual([{ id: "a", compteur_devis: 3 }]);
  });
  it("ordre parents → enfants, lots de 200, erreur isolée par table", async () => {
    const lu = lireSauvegarde(fichier({ devis_lignes: [{ id: 1 }], clients: Array.from({ length: 450 }, (_, i) => ({ id: i })), devis: [{ id: "d" }] }));
    if (!lu.ok) throw new Error("lecture");
    const appels: string[] = [];
    const r = await restaurer(lu.fichier, async (t, lignes) => {
      appels.push(`${t}:${lignes.length}`);
      return { error: t === "devis" ? { message: "refusé" } : null };
    });
    expect(appels).toEqual(["clients:200", "clients:200", "clients:50", "devis:1", "devis_lignes:1"]);
    expect(r.restaurees).toEqual({ clients: 450, devis_lignes: 1 }); expect(r.erreurs.devis).toContain("refusé");
  });
  it("jours depuis la dernière sauvegarde", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    expect(joursDepuis(null, now)).toBeNull(); expect(joursDepuis("n'importe quoi", now)).toBeNull();
    expect(joursDepuis("2026-10-01T12:00:00Z", now)).toBe(31); expect(joursDepuis("2026-11-01T11:00:00Z", now)).toBe(0);
  });
  it("rappel mensuel dans la notification", () => {
    expect(composerResume({ interventions: [], payees: [], enRetard: 0 })).toBeNull();
    const r = composerResume({ interventions: [], payees: [], enRetard: 0, rappelSauvegarde: true })!;
    expect(r.corps).toContain("sauvegarder"); expect(r.url).toBe("/sauvegarde");
  });
});
