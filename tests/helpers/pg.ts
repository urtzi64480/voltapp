// Harnais Postgres (PGlite = vrai Postgres compilé en WASM) pour valider les migrations SQL sans toucher à Supabase.
// Les schémas `auth` et `storage` de Supabase sont simulés au strict nécessaire pour exécuter les migrations.
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const DOSSIER_MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const STUBS_SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create or replace function auth.role() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
`;

export async function nouvelleBase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(STUBS_SUPABASE);
  return db;
}

/** Fichiers de migration, dans l'ordre d'exécution (tri alphabétique = ordre de numérotation). */
export function fichiersMigrations(): string[] {
  return readdirSync(DOSSIER_MIGRATIONS).filter(f => f.endsWith(".sql")).sort();
}

export function lireMigration(nom: string): string {
  return readFileSync(join(DOSSIER_MIGRATIONS, nom), "utf8");
}

export async function appliquerMigrations(db: PGlite, fichiers = fichiersMigrations()): Promise<void> {
  for (const f of fichiers) {
    try {
      await db.exec(lireMigration(f));
    } catch (e) {
      throw new Error(`Migration ${f} en échec : ${(e as Error).message}`);
    }
  }
}

/** Exécute un bloc SQL en simulant un utilisateur connecté (rôle `authenticated`, auth.uid() = userId) ou anonyme. */
export async function enTantQue<T>(db: PGlite, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId ?? ""}', false)`);
  await db.exec(`set role ${userId ? "authenticated" : "anon"}`);
  try { return await fn(); } finally { await db.exec("reset role"); await db.exec(`select set_config('request.jwt.claim.sub', '', false)`); }
}
