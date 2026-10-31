import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { nouvelleBase, appliquerMigrations, fichiersMigrations, lireMigration } from "./helpers/pg";
import { genererAuditSql, RPC_PUBLICS } from "./helpers/audit";
import { tablesUtiliseesParLeCode, rpcUtilisesParLeCode } from "./helpers/code";

const FICHIER_AUDIT = join(process.cwd(), "supabase", "audit", "audit_schema.sql");
const FICHIER_RLS = join(process.cwd(), "supabase", "optionnel", "rls_proprietaire_securisee.sql");

const colonnes = async (db: PGlite) =>
  (await db.query<{ table: string; colonne: string; type: string }>(
    `select table_name as "table", column_name as colonne, data_type as type
       from information_schema.columns where table_schema = 'public' order by 1, 2`)).rows;

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

async function creerFonctionsPubliques(db: PGlite, securisees = true) {
  for (const nom of RPC_PUBLICS) {
    if (nom === "get_devis_public_liste_refs") continue; // déjà créée (securisée) par 009
    await db.exec(`create or replace function public.${nom}() returns int language sql ${securisees ? "security definer" : ""} as $$ select 1 $$`);
  }
}

describe("migrations SQL — base neuve", () => {
  let db: PGlite;
  beforeAll(async () => { db = await nouvelleBase(); await appliquerMigrations(db); });

  it("la chaîne complète 001 → 012 s'applique sans erreur", () => {
    expect(fichiersMigrations()).toEqual(expect.arrayContaining(["001_schema.sql", "003_reconstruction_schema.sql", "012_remise_type_json.sql"]));
  });

  it("toutes les tables lues par le code existent après migration", async () => {
    const reelles = (await db.query<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public'`)).rows.map(r => r.t);
    const manquantes = tablesUtiliseesParLeCode().filter(t => !reelles.includes(t));
    expect(manquantes).toEqual([]);
  });

  it("le code appelle exactement les fonctions RPC listées dans l'audit et le script RLS", () => {
    expect(rpcUtilisesParLeCode()).toEqual([...RPC_PUBLICS].sort());
    const rls = readFileSync(FICHIER_RLS, "utf8");
    for (const nom of RPC_PUBLICS) expect(rls).toContain(`'${nom}'`);
  });

  it("003 est indispensable : sans elle, 009 échoue (colonnes liste_courses_token / fournisseur_id absentes)", async () => {
    const sans = await nouvelleBase();
    const sans003 = fichiersMigrations().filter(f => !f.startsWith("003_"));
    await expect(appliquerMigrations(sans, sans003)).rejects.toThrow(/Migration 004|Migration 009|Migration 008|Migration 006|Migration 007/);
  });

  it("insert d'une intervention SANS user_id (comme le fait le planning) : user_id vient d'auth.uid()", async () => {
    await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@test.fr') on conflict do nothing`);
    await db.exec(`select set_config('request.jwt.claim.sub', '${A}', false)`);
    await db.exec(`insert into interventions (titre, date_debut, date_fin) values ('Pose tableau', now(), now() + interval '2 hours')`);
    const r = await db.query<{ user_id: string }>(`select user_id from interventions where titre = 'Pose tableau'`);
    expect(r.rows[0].user_id).toBe(A);
    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
  });

  it("une remise de devis au format JSON (comme l'écrit l'application) est acceptée (012)", async () => {
    await db.exec(`insert into auth.users (id, email) values ('${B}', 'b@test.fr') on conflict do nothing`);
    await db.exec(`insert into devis (user_id, numero, remise_type, remise_valeur) values ('${B}', 'DEV-1', '{"service":"pct","materiau":"euro"}', 10)`);
    const r = await db.query<{ n: number }>(`select count(*)::int as n from devis where numero = 'DEV-1'`);
    expect(r.rows[0].n).toBe(1);
  });

  it("003 et 012 sont idempotentes : les rejouer ne change rien", async () => {
    const avant = await colonnes(db);
    await db.exec(lireMigration("003_reconstruction_schema.sql"));
    await db.exec(lireMigration("012_remise_type_json.sql"));
    expect(await colonnes(db)).toEqual(avant);
  });
});

describe("migrations SQL — base de production existante", () => {
  it("003 ne modifie ni la structure ni les données d'une table déjà présente (même de forme différente)", async () => {
    const db = await nouvelleBase();
    await appliquerMigrations(db, ["001_schema.sql"]);
    // La production a sa propre forme : user_id nullable, colonne en plus, type différent.
    await db.exec(`
      create table interventions (id uuid primary key default gen_random_uuid(), user_id uuid, titre text, spécifique_prod text, date_debut text, date_fin text);
      insert into interventions (titre, spécifique_prod, date_debut, date_fin) values ('Existant', 'garde-moi', '2026-10-01', '2026-10-02');
    `);
    const avant = (await colonnes(db)).filter(c => c.table === "interventions");
    await appliquerMigrations(db, fichiersMigrations().filter(f => f !== "001_schema.sql"));
    const apres = (await colonnes(db)).filter(c => c.table === "interventions");
    expect(apres).toEqual(avant);
    const r = await db.query<{ titre: string; p: string }>(`select titre, "spécifique_prod" as p from interventions`);
    expect(r.rows).toEqual([{ titre: "Existant", p: "garde-moi" }]);
  });
});

describe("audit_schema.sql", () => {
  let db: PGlite;
  beforeAll(async () => { db = await nouvelleBase(); await appliquerMigrations(db); });

  it("est à jour avec les migrations (régénérer avec MAJ_AUDIT=1 npm test)", async () => {
    const cols = (await colonnes(db)).map(c => ({ table: c.table, colonne: c.colonne }));
    const attendu = genererAuditSql(cols);
    if (process.env.MAJ_AUDIT === "1" || !existsSync(FICHIER_AUDIT)) writeFileSync(FICHIER_AUDIT, attendu);
    expect(readFileSync(FICHIER_AUDIT, "utf8")).toBe(attendu);
  });

  const lancerAudit = async (d: PGlite) =>
    (await d.query<{ gravite: string; controle: string; objet: string; detail: string }>(readFileSync(FICHIER_AUDIT, "utf8"))).rows;

  it("ne signale aucune table ni colonne manquante sur une base conforme", async () => {
    const rows = await lancerAudit(db);
    expect(rows.filter(r => r.controle === "TABLE MANQUANTE" || r.controle === "COLONNE MANQUANTE")).toEqual([]);
    expect(rows.some(r => r.controle === "RÉSUMÉ")).toBe(true);
  });

  it("signale les tables ouvertes (RLS désactivée) et ne signale pas celles protégées par 001", async () => {
    const rows = await lancerAudit(db);
    const ouvertes = rows.filter(r => r.controle === "RLS DÉSACTIVÉE").map(r => r.objet);
    expect(ouvertes).toEqual(expect.arrayContaining(["interventions", "projets", "rdv", "apple_ics"]));
    expect(ouvertes).not.toContain("devis");
    expect(ouvertes).not.toContain("factures");
    expect(rows.find(r => r.controle === "RLS DÉSACTIVÉE")?.gravite).toBe("CRITIQUE");
  });

  it("détecte une colonne et une table manquantes", async () => {
    const d = await nouvelleBase();
    await appliquerMigrations(d);
    await d.exec(`alter table devis drop column apporteur_id; drop table kit_composants;`);
    const rows = await lancerAudit(d);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ controle: "COLONNE MANQUANTE", objet: "devis.apporteur_id" }),
      expect.objectContaining({ controle: "TABLE MANQUANTE", objet: "kit_composants" }),
    ]));
  });

  it("détecte une fonction publique non SECURITY DEFINER, et accepte une fonction sécurisée", async () => {
    const d = await nouvelleBase();
    await appliquerMigrations(d);
    await d.exec(`create function public.sign_devis() returns int language sql as $$ select 1 $$`);
    await d.exec(`create function public.get_devis_signature() returns int language sql security definer as $$ select 1 $$`);
    const rows = await lancerAudit(d);
    expect(rows).toContainEqual(expect.objectContaining({ gravite: "CRITIQUE", controle: "FONCTION NON SÉCURISÉE", objet: "sign_devis()" }));
    expect(rows.find(r => r.objet === "get_devis_signature()" && r.controle === "FONCTION NON SÉCURISÉE")).toBeUndefined();
  });
});

describe("rls_proprietaire_securisee.sql", () => {
  const sql = readFileSync(FICHIER_RLS, "utf8");
  const appliquer = sql.replace("v_appliquer     boolean := false;", "v_appliquer     boolean := true; ");

  const rlsActive = async (d: PGlite, t: string) =>
    (await d.query<{ r: boolean }>(`select relrowsecurity as r from pg_class where oid = 'public.${t}'::regclass`)).rows[0].r;

  async function baseProd(): Promise<PGlite> {
    const d = await nouvelleBase();
    await appliquerMigrations(d);
    await creerFonctionsPubliques(d);
    await d.exec(`
      grant usage on schema public to anon, authenticated;
      grant all on all tables in schema public to anon, authenticated;
      insert into auth.users (id, email) values ('${A}', 'a@test.fr'), ('${B}', 'b@test.fr') on conflict do nothing;
      insert into interventions (user_id, titre, date_debut, date_fin) values
        ('${A}', 'Chantier A', now(), now()), ('${B}', 'Chantier B', now(), now());
      insert into realisations (user_id, photo_url) values ('${A}', 'http://x/y.jpg');
    `);
    return d;
  }

  it("le script de remplacement cible bien la variable v_appliquer (garde contre une dérive du fichier)", () => {
    expect(sql).toContain("v_appliquer     boolean := false;");
    expect(appliquer).toContain("v_appliquer     boolean := true; ");
  });

  it("par défaut : SIMULATION — aucune écriture", async () => {
    const d = await baseProd();
    await d.exec(sql);
    for (const t of ["interventions", "projets", "rdv", "apple_ics", "demande_rate_limit"]) expect(await rlsActive(d, t)).toBe(false);
    expect((await d.query(`select 1 from pg_policies where tablename = 'interventions'`)).rows).toHaveLength(0);
  });

  it("application : ferme les tables ouvertes, isole les utilisateurs, épargne profil / realisations", async () => {
    const d = await baseProd();
    await d.exec(appliquer);
    for (const t of ["interventions", "projets", "rdv", "apple_ics", "apporteurs", "acomptes", "demande_rate_limit"]) expect(await rlsActive(d, t)).toBe(true);
    expect(await rlsActive(d, "realisations")).toBe(false);   // lue par /a-propos avec la clé anon
    // Isolation entre utilisateurs
    const titres = async (uid: string | null) => {
      await d.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
      await d.exec(`set role ${uid ? "authenticated" : "anon"}`);
      try { return (await d.query<{ titre: string }>(`select titre from interventions order by titre`)).rows.map(r => r.titre); }
      finally { await d.exec("reset role"); }
    };
    expect(await titres(A)).toEqual(["Chantier A"]);
    expect(await titres(B)).toEqual(["Chantier B"]);
    expect(await titres(null)).toEqual([]);
    // La clé service-role (superutilisateur ici) continue de tout voir : les routes /api/public ne sont pas affectées.
    expect((await d.query(`select 1 from interventions`)).rows).toHaveLength(2);
    // Un utilisateur peut toujours insérer SANS user_id (valeur par défaut auth.uid()) mais pas écrire pour autrui.
    await d.exec(`select set_config('request.jwt.claim.sub', '${A}', false)`);
    await d.exec(`set role authenticated`);
    await d.exec(`insert into interventions (titre, date_debut, date_fin) values ('Nouveau A', now(), now())`);
    await expect(d.exec(`insert into interventions (user_id, titre, date_debut, date_fin) values ('${B}', 'Intrus', now(), now())`)).rejects.toThrow();
    await d.exec("reset role");
  });

  it("n'altère pas une table qui a déjà une policy, ni une table avec des user_id NULL", async () => {
    const d = await baseProd();
    await d.exec(`
      create policy "policy_prod" on rdv for all using (true);
      alter table projets alter column user_id drop not null;
      insert into clients (id, user_id, nom) values ('33333333-3333-3333-3333-333333333333', '${A}', 'Client');
      insert into projets (user_id, client_id, nom) values (null, '33333333-3333-3333-3333-333333333333', 'Orphelin');
    `);
    await d.exec(appliquer);
    expect(await rlsActive(d, "rdv")).toBe(false);          // policy existante → on n'y touche pas
    expect((await d.query(`select policyname from pg_policies where tablename = 'rdv'`)).rows).toEqual([{ policyname: "policy_prod" }]);
    expect(await rlsActive(d, "projets")).toBe(false);      // user_id NULL → ignorée
    expect(await rlsActive(d, "interventions")).toBe(true); // les autres sont bien traitées
  });

  it("ABANDONNE sans rien modifier si une fonction publique n'est pas SECURITY DEFINER", async () => {
    const d = await baseProd();
    await d.exec(`create or replace function public.sign_devis() returns int language sql security invoker as $$ select 1 $$`);
    await expect(d.exec(appliquer)).rejects.toThrow(/sign_devis/);
    expect(await rlsActive(d, "interventions")).toBe(false);
  });

  it("est rejouable (idempotent) : deuxième exécution sans erreur ni doublon de policy", async () => {
    const d = await baseProd();
    await d.exec(appliquer);
    await d.exec(appliquer);
    const n = (await d.query<{ n: number }>(`select count(*)::int as n from pg_policies where tablename = 'interventions'`)).rows[0].n;
    expect(n).toBe(1);
  });
});
