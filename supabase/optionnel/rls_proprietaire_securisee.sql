-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- rls_proprietaire_securisee.sql — OPTIONNEL, à lancer À LA MAIN (SQL Editor), jamais automatiquement.
--
-- Objectif : fermer les tables « ouvertes » (RLS désactivée = lisibles / modifiables par n'importe qui possédant la clé
-- anon, qui est publique dans le navigateur). Pour chaque table de `public` qui a une colonne user_id, ce script active
-- la RLS et ajoute UNE policy « le propriétaire accède à ses lignes » (auth.uid() = user_id).
--
-- ÉTAPE 1 — lancer d'abord supabase/audit/audit_schema.sql pour voir l'état réel de la base.
-- ÉTAPE 2 — lancer CE script tel quel : v_appliquer = false → SIMULATION, il n'écrit rien et liste (onglet « Messages »)
--           ce qu'il ferait pour chaque table.
-- ÉTAPE 3 — si la simulation te convient, passer v_appliquer à true et relancer.
--
-- GARDE-FOUS (une table qui ne les respecte pas est ignorée, jamais modifiée) :
--   · la RLS est déjà active, ou la table a déjà au moins une policy → on n'y touche pas ;
--   · aucune colonne user_id → ignorée ; au moins une ligne avec user_id NULL → ignorée (le propriétaire perdrait l'accès) ;
--   · `profil` et `realisations` sont exclues : les pages publiques (/demande/…, /a-propos) les lisent avec la clé anon ;
--   · ABANDON COMPLET si une des fonctions publiques appelées par les liens clients (signature de devis, liste de
--     courses, tableau partagé) n'est pas SECURITY DEFINER : activer la RLS la casserait.
-- Les routes /api/public/* utilisent la clé service-role, qui ignore la RLS : elles ne sont pas affectées.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_appliquer     boolean := false;   -- ← passer à true pour appliquer réellement
  v_exclues       text[]  := array['profil', 'realisations'];
  v_rpc_publics   text[]  := array[
    'get_devis_public_liste', 'get_devis_public_liste_refs', 'get_devis_signature', 'get_devis_signature_apercu',
    'get_public_profil_by_devis_token', 'get_tableau_public_projet', 'sign_devis', 'update_devis_public_liste_checked'
  ];
  v_non_securisees text;
  t               text;
  v_oid           regclass;
  v_nb_null       bigint;
  v_nb_policies   int;
  v_nb_traitees   int := 0;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_non_securisees
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any (v_rpc_publics) and not p.prosecdef;

  if v_non_securisees is not null then
    raise exception 'ABANDON : ces fonctions publiques ne sont pas SECURITY DEFINER (%) — activer la RLS casserait les liens envoyés aux clients. Rien n''a été modifié.', v_non_securisees;
  end if;

  raise notice '=== % ===', case when v_appliquer then 'APPLICATION RÉELLE' else 'SIMULATION (aucune écriture) — passer v_appliquer à true pour appliquer' end;

  for t in
    select c.table_name from information_schema.columns c
      join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'user_id'
     order by c.table_name
  loop
    if t = any (v_exclues) then
      raise notice '% : exclue (lue par une page publique avec la clé anon)', t; continue;
    end if;

    v_oid := to_regclass(format('public.%I', t));

    if exists (select 1 from pg_class where oid = v_oid and relrowsecurity) then
      raise notice '% : RLS déjà active → inchangée', t; continue;
    end if;

    select count(*) into v_nb_policies from pg_policies where schemaname = 'public' and tablename = t;
    if v_nb_policies > 0 then
      raise notice '% : % policy(ies) existante(s) → inchangée', t, v_nb_policies; continue;
    end if;

    execute format('select count(*) from public.%I where user_id is null', t) into v_nb_null;
    if v_nb_null > 0 then
      raise notice '% : % ligne(s) sans user_id → IGNORÉE (le propriétaire perdrait l''accès) — à corriger d''abord', t, v_nb_null; continue;
    end if;

    if v_appliquer then
      execute format('alter table public.%I enable row level security', t);
      execute format('create policy %I on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', 'own_' || t, t);
      raise notice '% : RLS ACTIVÉE + policy propriétaire créée', t;
    else
      raise notice '% : serait fermée (RLS + policy propriétaire)', t;
    end if;
    v_nb_traitees := v_nb_traitees + 1;
  end loop;

  -- Table technique sans user_id, utilisée uniquement par la clé service-role (limitation de débit des formulaires publics) :
  -- RLS sans aucune policy = inaccessible aux clés anon / utilisateurs, la clé service-role continue de fonctionner.
  v_oid := to_regclass('public.demande_rate_limit');
  if v_oid is not null and not exists (select 1 from pg_class where oid = v_oid and relrowsecurity) then
    if v_appliquer then
      alter table public.demande_rate_limit enable row level security;
      raise notice 'demande_rate_limit : RLS ACTIVÉE (service-role uniquement)';
    else
      raise notice 'demande_rate_limit : serait fermée (RLS, service-role uniquement)';
    end if;
    v_nb_traitees := v_nb_traitees + 1;
  end if;

  raise notice '=== % table(s) % ===', v_nb_traitees, case when v_appliquer then 'fermée(s)' else 'à fermer (simulation)' end;
end $$;
