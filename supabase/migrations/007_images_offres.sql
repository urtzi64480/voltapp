-- ─────────────────────────────────────────────────────────────────
-- FICHIER : 007_images_offres.sql
-- À coller dans Supabase → SQL Editor → Run (un bloc à la fois)
-- Chaque offre (marque + fournisseur) peut avoir sa PROPRE image. Sans image d'offre,
-- l'image du produit (prestations.image_url) continue d'être utilisée.
-- ─────────────────────────────────────────────────────────────────

-- Bloc 1 — colonne image sur les offres
alter table prestation_fournisseurs
  add column if not exists image_url text;

-- Bloc 2 — reprise de l'existant : les offres déjà saisies gardent l'image actuelle de leur produit
update prestation_fournisseurs pf
   set image_url = btrim(p.image_url)
  from prestations p
 where pf.prestation_id = p.id
   and (pf.image_url is null or btrim(pf.image_url) = '')
   and p.image_url is not null
   and btrim(p.image_url) <> '';
