// Génère supabase/audit/audit_schema.sql : un SELECT unique (lecture seule) à coller dans le SQL Editor de Supabase, qui compare la
// base RÉELLE au schéma attendu par le code (colonnes issues des migrations 001 → 012 rejouées sur un Postgres de test).
export interface ColonneAttendue { table: string; colonne: string }

export const RPC_PUBLICS = [
  "get_devis_public_liste", "get_devis_public_liste_refs", "get_devis_signature", "get_devis_signature_apercu",
  "get_public_profil_by_devis_token", "get_tableau_public_projet", "sign_devis", "update_devis_public_liste_checked",
];

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function genererAuditSql(colonnes: ColonneAttendue[]): string {
  const valeurs = colonnes.map(c => `    (${q(c.table)}, ${q(c.colonne)})`).join(",\n");
  const rpc = RPC_PUBLICS.map(n => `    (${q(n)})`).join(",\n");
  return `-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- audit_schema.sql — LECTURE SEULE (aucune écriture). À coller dans Supabase → SQL Editor → Run.
-- GÉNÉRÉ par tests/migrations.test.ts (\`MAJ_AUDIT=1 npm test\`) à partir des migrations : ne pas éditer à la main.
--
-- Compare la base réelle au schéma attendu par le code et signale :
--   · CRITIQUE  : table ouverte (RLS désactivée) contenant des données par utilisateur ; fonction publique non SECURITY DEFINER
--   · ATTENTION : table / colonne attendue absente ; RLS active sans aucune policy ; table de \`public\` inconnue du code
--   · INFO      : résumé
-- Tri : CRITIQUE d'abord. Un résultat sans CRITIQUE ni ATTENTION = base conforme.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

with attendues(t, c) as (values
${valeurs}
),
rpc_attendues(nom) as (values
${rpc}
),
tables_attendues as (select distinct t from attendues),
tables_reelles as (
  select c.oid, c.relname as t, c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
policies as (
  select tablename as t, count(*) as nb from pg_policies where schemaname = 'public' group by tablename
),
avec_user_id as (
  select table_name as t from information_schema.columns where table_schema = 'public' and column_name = 'user_id'
),
resultats as (
  select 'ATTENTION' as gravite, 'TABLE MANQUANTE' as controle, ta.t as objet, 'Table attendue par le code, absente de la base' as detail
    from tables_attendues ta where not exists (select 1 from tables_reelles r where r.t = ta.t)
  union all
  select 'ATTENTION', 'COLONNE MANQUANTE', a.t || '.' || a.c, 'Colonne attendue par le code, absente de la table'
    from attendues a
   where exists (select 1 from tables_reelles r where r.t = a.t)
     and not exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = a.t and k.column_name = a.c)
  union all
  select 'CRITIQUE', 'RLS DÉSACTIVÉE', r.t,
         'Table ouverte : toute personne ayant la clé anon (publique dans le navigateur) peut la lire et la modifier'
    from tables_reelles r where not r.rls and r.t in (select t from avec_user_id)
  union all
  select 'ATTENTION', 'RLS DÉSACTIVÉE (sans user_id)', r.t, 'Table sans colonne user_id et sans RLS : à vérifier à la main'
    from tables_reelles r where not r.rls and r.t not in (select t from avec_user_id)
  union all
  select 'ATTENTION', 'RLS SANS POLICY', r.t, 'RLS active mais aucune policy : seule la clé service-role y accède (normal pour une table technique)'
    from tables_reelles r where r.rls and not exists (select 1 from policies p where p.t = r.t)
  union all
  select 'ATTENTION', 'TABLE INCONNUE DU CODE', r.t, 'Table présente en base mais jamais utilisée par l''application'
    from tables_reelles r where r.t not in (select t from tables_attendues)
  union all
  select 'CRITIQUE', 'FONCTION NON SÉCURISÉE', ra.nom || '()', 'Fonction publique sans SECURITY DEFINER : elle dépend des policies de l''appelant (anon)'
    from rpc_attendues ra
   where exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = ra.nom and not p.prosecdef)
  union all
  select 'ATTENTION', 'FONCTION MANQUANTE', ra.nom || '()', 'Fonction appelée par les pages publiques, absente de la base'
    from rpc_attendues ra
   where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = ra.nom)
  union all
  select 'INFO', 'RÉSUMÉ', (select count(*) from tables_reelles)::text || ' table(s) en base',
         (select count(*) from tables_attendues)::text || ' attendue(s) · '
         || (select count(*) from tables_reelles where rls)::text || ' avec RLS active'
)
select gravite, controle, objet, detail
  from resultats
 order by case gravite when 'CRITIQUE' then 0 when 'ATTENTION' then 1 else 2 end, controle, objet;
`;
}
