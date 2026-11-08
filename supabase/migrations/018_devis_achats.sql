-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 018_devis_achats.sql
--
-- Achats de matériel RÉELS, plusieurs par devis (un devis peut être acheté en plusieurs fois, chez plusieurs fournisseurs,
-- sur plusieurs mois). Remplace la saisie unique de la migration 017 (devis.achat_materiel_reel / achat_materiel_date).
--   montant     : TTC (en franchise en base de TVA, la TVA payée au fournisseur n'est pas récupérable : c'est la vraie dépense).
--   date_achat  : jour où l'achat a été payé ; il décide du mois dans la page « Achats matériel » (= ce qu'il faut virer en fin de mois).
--   fournisseur : libre, facultatif.
-- Rejouable sans risque. Les montants déjà saisis avec la 017 sont repris (une ligne par devis) puis les anciennes colonnes sont vidées.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

alter table devis add column if not exists achat_materiel_reel numeric(12,2);
alter table devis add column if not exists achat_materiel_date date;

create table if not exists devis_achats (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  devis_id     uuid not null references devis(id) on delete cascade,
  montant      numeric(12,2) not null check (montant >= 0),
  date_achat   date not null default current_date,
  fournisseur  text,
  created_at   timestamptz default now()
);

create index if not exists devis_achats_devis_idx on devis_achats (devis_id);
create index if not exists devis_achats_date_idx  on devis_achats (user_id, date_achat);

alter table devis_achats enable row level security;
drop policy if exists "own_devis_achats" on devis_achats;
create policy "own_devis_achats" on devis_achats for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Reprise des saisies de la 017 (date : date d'achat saisie, sinon jour de signature, sinon création du devis).
insert into devis_achats (user_id, devis_id, montant, date_achat)
select d.user_id, d.id, d.achat_materiel_reel,
       coalesce(d.achat_materiel_date, d.signe_le::date, d.created_at::date, current_date)
  from devis d
 where d.achat_materiel_reel is not null
   and not exists (select 1 from devis_achats a where a.devis_id = d.id);

update devis set achat_materiel_reel = null, achat_materiel_date = null
 where achat_materiel_reel is not null
   and exists (select 1 from devis_achats a where a.devis_id = devis.id);
