-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 003_reconstruction_schema.sql
--
-- RECONSTRUCTION du schéma réellement utilisé par l'application. Les migrations d'origine ne créaient que 7 tables
-- (profil, clients, prestations, devis, devis_lignes, factures, facture_lignes) alors que le code en utilise bien plus.
-- Ce fichier complète les migrations pour qu'une base NEUVE soit utilisable (001 → 003 → 004 … 011 → 012).
--
-- ⚠ SANS EFFET SUR UNE BASE EXISTANTE (production) :
--   · uniquement « create table if not exists » et « add column if not exists » : une table / colonne déjà présente
--     n'est ni modifiée, ni recréée, ni retypée ;
--   · aucune suppression, aucun update, aucun changement de policy RLS, aucun déclencheur.
--   Les colonnes ajoutées par 002, 004, 006, 007, 008, 010 et 011 sont volontairement ABSENTES ici : ces fichiers
--   les ajoutent eux-mêmes (avec leurs contraintes), et doivent le faire sur une base neuve.
--
-- Reconstruit à partir du code (insert / update / select, src/types/index.ts) : si la production diffère, c'est
-- la production qui fait foi. Lancer d'abord supabase/audit/audit_schema.sql pour comparer.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

create extension if not exists "uuid-ossp";

-- ── Colonnes ajoutées aux tables de 001 ─────────────────────────────────────────────────────

alter table profil
  add column if not exists logo_url                  text,
  add column if not exists numero_tva                text,
  add column if not exists taux_cotisations_service  numeric(5,2),
  add column if not exists taux_cotisations_materiau numeric(5,2),
  add column if not exists taux_ir_service           numeric(5,2),
  add column if not exists taux_ir_materiau          numeric(5,2),
  add column if not exists iban                      text,
  add column if not exists bic                       text,
  add column if not exists banque_nom                text,
  add column if not exists banque_titulaire          text;

alter table clients
  add column if not exists type_client     text default 'particulier',
  add column if not exists siret_client    text,
  add column if not exists maison_config   text,
  add column if not exists predevis_config text;

alter table prestations
  add column if not exists sous_categorie     text,
  add column if not exists marque             text,
  add column if not exists image_url          text,
  add column if not exists liens_fournisseurs text[],
  add column if not exists prix_achat         numeric(10,2),
  add column if not exists gamme              text,
  add column if not exists longueur_unitaire  numeric(10,2);

-- ── Tables absentes des migrations d'origine ────────────────────────────────────────────────

create table if not exists apporteurs (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom         text not null,
  entreprise  text,
  telephone   text,
  email       text,
  actif       boolean not null default true,
  created_at  timestamptz default now()
);

create table if not exists paliers_fidelite (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label       text not null default '',
  seuil_min   numeric(10,2) not null default 0,
  seuil_max   numeric(10,2),
  remise_pct  numeric(5,2) not null default 0,
  couleur     text,
  created_at  timestamptz default now()
);

create table if not exists paliers_apporteur (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label          text not null default '',
  seuil_min      numeric(10,2) not null default 0,
  seuil_max      numeric(10,2),
  commission_pct numeric(5,2) not null default 0,
  ordre          int default 0,
  created_at     timestamptz default now()
);

create table if not exists projets (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id        uuid not null references clients(id) on delete cascade,
  nom              text not null default 'Projet',
  adresse          text,
  maison_config    text,
  tableau_config   text,
  predevis_config  text,
  tableaux_annexes text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create table if not exists interventions (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id         uuid references clients(id) on delete set null,
  devis_id          uuid references devis(id) on delete set null,
  titre             text not null,
  description       text,
  adresse_chantier  text,
  date_debut        timestamptz not null,
  date_fin          timestamptz not null,
  statut            text not null default 'planifie',  -- planifie | en_cours | termine | annule
  photos            text[],
  notes             text,
  caldav_url        text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table if not exists prestation_fournisseurs (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid default auth.uid() references auth.users(id) on delete cascade,
  prestation_id  uuid not null references prestations(id) on delete cascade,
  fournisseur    text not null,
  reference      text,
  url            text,
  prix_achat     numeric(10,2),
  prix_vente     numeric(10,2),
  principal      boolean not null default false,
  ordre          int,
  created_at     timestamptz default now()
  -- pieces (004), marque (006), image_url (007) : ajoutées par ces migrations
);

create table if not exists kit_composants (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid default auth.uid() references auth.users(id) on delete cascade,
  kit_id       uuid not null references prestations(id) on delete cascade,
  composant_id uuid not null references prestations(id) on delete cascade,
  quantite     numeric(10,2) not null default 1,
  ordre        int default 0
);

create table if not exists acomptes (
  id              uuid primary key default uuid_generate_v4(),
  facture_id      uuid not null references factures(id) on delete cascade,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  montant         numeric(10,2) not null,
  date_versement  date not null default current_date,
  notes           text,
  created_at      timestamptz default now()
);

create table if not exists realisations (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  photo_url   text not null,
  chantier    text,
  description text,
  position    int default 0,
  created_at  timestamptz default now()
);

create table if not exists apple_ics (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  ics_urls     text,
  calendars    text,
  apple_id     text,
  app_password text,
  updated_at   timestamptz default now()
);

create table if not exists rdv (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null,
  periode     text not null,                 -- matin | aprem
  nom         text not null,
  telephone   text not null,
  email       text,
  adresse     text,
  description text,
  photos      text[],
  statut      text default 'confirme',
  consulte    boolean not null default false,
  confirme    boolean not null default false,
  caldav_url  text,
  created_at  timestamptz default now()
);

create table if not exists demandes (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id   uuid references clients(id) on delete set null,
  date_visite date,
  description text,
  notes       text,
  statut      text,
  photos      text[],
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists demandes_client (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  client_id         uuid references clients(id) on delete set null,
  statut            text not null default 'nouveau',   -- nouveau | vu | converti
  nom               text not null,
  telephone         text not null,
  email             text,
  adresse_chantier  text not null,
  type_travaux      text[],
  description       text,
  photos            text[],
  disponibilites    text,
  created_at        timestamptz default now()
);

create table if not exists demande_rate_limit (
  id          uuid primary key default uuid_generate_v4(),
  ip          text not null,
  type        text not null,
  created_at  timestamptz default now()
);

create table if not exists demande_visites (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null,
  referrer    text,
  user_agent  text,
  device_type text,
  navigateur  text,
  os          text,
  langue      text,
  pays        text,
  region      text,
  ville       text,
  page        text,
  mode        text,
  created_at  timestamptz default now()
);

create table if not exists demande_clics (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null,
  referrer    text,
  user_agent  text,
  device_type text,
  navigateur  text,
  os          text,
  langue      text,
  pays        text,
  region      text,
  ville       text,
  type_clic   text,
  created_at  timestamptz default now()
);

-- ── Colonnes ajoutées aux tables de 001 qui dépendent des tables ci-dessus ──────────────────

alter table devis
  add column if not exists remise_fidelite_pct          numeric(5,2) default 0,
  add column if not exists apporteur_id                 uuid references apporteurs(id) on delete set null,
  add column if not exists signature_token              text,
  add column if not exists signature_token_expires_at   timestamptz,
  add column if not exists liste_courses_token          text,
  add column if not exists liste_courses_checked        jsonb default '{}'::jsonb;
  -- remise_type / remise_valeur : ajoutées par 002

alter table devis_lignes
  add column if not exists kit_description   text,
  add column if not exists kit_groupe        text,
  add column if not exists kit_ratio_service numeric,
  add column if not exists poste             text,
  add column if not exists fournisseur_id    uuid,
  add column if not exists fournisseur_nom   text,
  add column if not exists prix_achat        numeric(10,2),
  add column if not exists image_url         text;

alter table factures
  add column if not exists remise_fidelite_pct   numeric(5,2) default 0,
  add column if not exists apporteur_id          uuid references apporteurs(id) on delete set null,
  add column if not exists statut_transmission   text,
  add column if not exists id_transmission       text,
  add column if not exists date_transmission     timestamptz;
  -- remise_facture_* : ajoutées par 010 et 011

alter table facture_lignes
  add column if not exists description      text,
  add column if not exists kit_description  text,
  add column if not exists poste            text,
  add column if not exists image_url        text;

-- ── Buckets de stockage utilisés par l'application (no-op s'ils existent déjà) ──────────────
-- Les policies de storage.objects ne sont PAS touchées ici (elles dépendent de la configuration du projet).

insert into storage.buckets (id, name, public) values
  ('demande-photos',      'demande-photos',      true),
  ('documents',           'documents',           true),
  ('intervention-photos', 'intervention-photos', true),
  ('logos',               'logos',               true),
  ('realisations-photos', 'realisations-photos', true)
on conflict do nothing;
