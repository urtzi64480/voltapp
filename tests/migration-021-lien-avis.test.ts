import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { lienAvisValide } from "@/components/QrAvis";

describe("migration 021 — lien d'avis Google par entreprise", () => {
  it("colonne du profil, rejouable", () => {
    const sql = readFileSync("supabase/migrations/021_lien_avis_google.sql", "utf8");
    expect(sql).toContain("add column if not exists lien_avis_google");
  });
});

describe("lienAvisValide", () => {
  it("accepte une adresse web et la nettoie", () => {
    expect(lienAvisValide("  https://g.page/r/abc/review ")).toBe("https://g.page/r/abc/review");
  });
  it("refuse le vide, un texte libre ou un schéma non web", () => {
    expect(lienAvisValide("")).toBeNull();
    expect(lienAvisValide(null)).toBeNull();
    expect(lienAvisValide("mon avis google")).toBeNull();
    expect(lienAvisValide("javascript:alert(1)")).toBeNull();
  });
});
