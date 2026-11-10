-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 020_assurance_decennale.sql
--
-- Assurance décennale de l'entreprise : mentions imprimées sur les devis et factures (assureur, n° de contrat, couverture géographique),
-- dates de validité (alerte avant l'échéance, jamais de document expiré joint à un client) et fichier de l'attestation, joint à chaque
-- dossier de fin de chantier. Le fichier est dans un bucket PRIVÉ « documents-pro » : un dossier par utilisateur (<user_id>/...).
-- Rejouable sans risque.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

alter table profil add column if not exists assurance_assureur     text;
alter table profil add column if not exists assurance_adresse      text;
alter table profil add column if not exists assurance_contrat      text;
alter table profil add column if not exists assurance_zone         text;
alter table profil add column if not exists assurance_debut        date;
alter table profil add column if not exists assurance_fin          date;
alter table profil add column if not exists assurance_fichier      text;  -- chemin dans le bucket documents-pro
alter table profil add column if not exists assurance_fichier_nom  text;

insert into storage.buckets (id, name, public) values ('documents-pro', 'documents-pro', false)
on conflict (id) do nothing;

drop policy if exists "docspro_select" on storage.objects;
drop policy if exists "docspro_insert" on storage.objects;
drop policy if exists "docspro_update" on storage.objects;
drop policy if exists "docspro_delete" on storage.objects;
create policy "docspro_select" on storage.objects for select to authenticated
  using (bucket_id = 'documents-pro' and split_part(name, '/', 1) = auth.uid()::text);
create policy "docspro_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents-pro' and split_part(name, '/', 1) = auth.uid()::text);
create policy "docspro_update" on storage.objects for update to authenticated
  using (bucket_id = 'documents-pro' and split_part(name, '/', 1) = auth.uid()::text);
create policy "docspro_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documents-pro' and split_part(name, '/', 1) = auth.uid()::text);
