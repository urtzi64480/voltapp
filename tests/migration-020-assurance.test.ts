import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/020_assurance_decennale.sql", "utf8");
describe("migration 020 — assurance décennale", () => {
  it("colonnes du profil, rejouables", () => {
    for (const c of ["assureur", "adresse", "contrat", "zone", "debut", "fin", "fichier", "fichier_nom"]) expect(sql).toContain(`add column if not exists assurance_${c}`);
  });
  it("bucket privé et policies limitées au dossier de l'utilisateur", () => {
    expect(sql).toMatch(/'documents-pro', 'documents-pro', false\)/);
    for (const op of ["select", "insert", "update", "delete"]) expect(sql).toContain(`docspro_${op}`);
    expect((sql.match(/split_part\(name, '\/', 1\) = auth\.uid\(\)::text/g) ?? []).length).toBe(4);
    expect(sql).toContain("on conflict (id) do nothing");
    expect(sql).toMatch(/drop policy if exists "docspro_select"/);
  });
});
