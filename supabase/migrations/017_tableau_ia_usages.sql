-- 017 — Journal des analyses IA de tableau (quota par utilisateur). Rejouable.
create table if not exists tableau_ia_usages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nb_photos int not null default 0,
  modele text,
  created_at timestamptz not null default now()
);
create index if not exists tableau_ia_usages_user_date_idx on tableau_ia_usages (user_id, created_at desc);
alter table tableau_ia_usages enable row level security;
drop policy if exists "tableau_ia_usages_select_proprietaire" on tableau_ia_usages;
create policy "tableau_ia_usages_select_proprietaire" on tableau_ia_usages for select using (user_id = auth.uid());
drop policy if exists "tableau_ia_usages_insert_proprietaire" on tableau_ia_usages;
create policy "tableau_ia_usages_insert_proprietaire" on tableau_ia_usages for insert with check (user_id = auth.uid());
