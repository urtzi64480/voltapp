-- ============================================================
-- VOLTAPP — Schéma Supabase
-- Coller intégralement dans Supabase > SQL Editor > Run
-- ============================================================

create extension if not exists "uuid-ossp";

-- ── PROFIL ARTISAN ──────────────────────────────────────────
create table if not exists profil (
  id              uuid primary key references auth.users(id) on delete cascade,
  nom_entreprise  text,
  prenom          text,
  nom             text,
  siret           text,
  telephone       text,
  email           text,
  adresse         text,
  code_postal     text,
  ville           text,
  prefixe_devis   text default 'DEV',
  prefixe_facture text default 'FAC',
  compteur_devis  int  default 0,
  compteur_facture int default 0,
  mention_tva     text default 'TVA non applicable — Art. 293 B du CGI',
  conditions_paiement text default 'Paiement à réception de facture',
  taux_horaire    numeric(10,2) default 55,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── CLIENTS ─────────────────────────────────────────────────
create table if not exists clients (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  nom             text not null,
  prenom          text,
  email           text,
  telephone       text,
  adresse         text,
  code_postal     text,
  ville            text,
  -- Logement
  type_logement   text,
  annee_construction int,
  surface_m2      int,
  tableau_marque  text,
  tableau_config  text,
  code_acces      text,
  -- Préférences
  contact_prefere text default 'telephone',
  disponibilites  text,
  notes           text,
  tags            text[],
  statut          text default 'actif',
  source          text,
  -- Photos (URLs Supabase Storage)
  photos          text[],
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── CATALOGUE PRESTATIONS ───────────────────────────────────
create table if not exists prestations (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  nom             text not null,
  description     text,
  prix_unitaire   numeric(10,2) not null default 0,
  unite           text default 'forfait',   -- forfait | heure | u | ml | m2
  type_branche    text not null default 'service',  -- service | materiau
  categorie       text not null default 'Divers',
  actif           boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── DEVIS ───────────────────────────────────────────────────
create table if not exists devis (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  client_id       uuid references clients(id) on delete set null,
  numero          text not null,
  objet           text,
  date_emission   date default current_date,
  date_validite   date,
  statut          text default 'brouillon',  -- brouillon | envoye | signe | refuse | expire
  total_service   numeric(10,2) default 0,
  total_materiau  numeric(10,2) default 0,
  total_ttc       numeric(10,2) default 0,
  signe_le        timestamptz,
  signature_data  text,
  acompte_pct     int default 0,
  acompte_paye    boolean default false,
  notes_internes  text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── LIGNES DEVIS ────────────────────────────────────────────
create table if not exists devis_lignes (
  id              uuid primary key default uuid_generate_v4(),
  devis_id        uuid references devis(id) on delete cascade not null,
  prestation_id   uuid references prestations(id) on delete set null,
  nom             text not null,
  description     text,
  quantite        numeric(10,2) default 1,
  prix_unitaire   numeric(10,2) not null,
  unite           text default 'forfait',
  type_branche    text not null default 'service',
  ordre           int default 0
);

-- ── FACTURES ────────────────────────────────────────────────
create table if not exists factures (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  devis_id        uuid references devis(id) on delete set null,
  client_id       uuid references clients(id) on delete set null,
  numero          text not null,
  objet           text,
  date_emission   date default current_date,
  date_echeance   date,
  statut          text default 'envoyee',  -- envoyee | payee | relance | impayee
  total_service   numeric(10,2) default 0,
  total_materiau  numeric(10,2) default 0,
  total_ttc       numeric(10,2) default 0,
  paye_le         timestamptz,
  moyen_paiement  text,
  notes_internes  text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── LIGNES FACTURES ─────────────────────────────────────────
create table if not exists facture_lignes (
  id              uuid primary key default uuid_generate_v4(),
  facture_id      uuid references factures(id) on delete cascade not null,
  nom             text not null,
  quantite        numeric(10,2) default 1,
  prix_unitaire   numeric(10,2) not null,
  unite           text default 'forfait',
  type_branche    text not null default 'service',
  ordre           int default 0
);

-- ── STORAGE PHOTOS CLIENTS ──────────────────────────────────
insert into storage.buckets (id, name, public)
values ('client-photos', 'client-photos', true)
on conflict do nothing;

create policy "photos_select" on storage.objects for select using (bucket_id = 'client-photos');
create policy "photos_insert" on storage.objects for insert with check (bucket_id = 'client-photos' and auth.role() = 'authenticated');
create policy "photos_delete" on storage.objects for delete using (bucket_id = 'client-photos' and auth.role() = 'authenticated');

-- ── ROW LEVEL SECURITY ──────────────────────────────────────
alter table profil      enable row level security;
alter table clients     enable row level security;
alter table prestations enable row level security;
alter table devis       enable row level security;
alter table devis_lignes enable row level security;
alter table factures    enable row level security;
alter table facture_lignes enable row level security;

create policy "own_profil"      on profil      for all using (auth.uid() = id);
create policy "own_clients"     on clients     for all using (auth.uid() = user_id);
create policy "own_prestations" on prestations for all using (auth.uid() = user_id);
create policy "own_devis"       on devis       for all using (auth.uid() = user_id);
create policy "own_devis_lignes" on devis_lignes for all
  using (exists (select 1 from devis d where d.id = devis_id and d.user_id = auth.uid()));
create policy "own_factures"    on factures    for all using (auth.uid() = user_id);
create policy "own_facture_lignes" on facture_lignes for all
  using (exists (select 1 from factures f where f.id = facture_id and f.user_id = auth.uid()));

-- ── TRIGGERS updated_at ─────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trg_profil_upd      before update on profil      for each row execute function set_updated_at();
create trigger trg_clients_upd     before update on clients     for each row execute function set_updated_at();
create trigger trg_prestations_upd before update on prestations for each row execute function set_updated_at();
create trigger trg_devis_upd       before update on devis       for each row execute function set_updated_at();
create trigger trg_factures_upd    before update on factures    for each row execute function set_updated_at();

-- ── AUTO-CRÉER PROFIL À L'INSCRIPTION ──────────────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profil (id, email) values (new.id, new.email) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
