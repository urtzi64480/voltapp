-- ─────────────────────────────────────────────────────────────────
-- FICHIER : 006_marques_offres.sql
-- À coller dans Supabase → SQL Editor → Run (un bloc à la fois)
-- Un même produit peut être proposé en plusieurs MARQUES : chaque offre (prestation_fournisseurs)
-- porte désormais sa marque, en plus de son fournisseur, de son prix d'achat et de son prix de vente.
-- ─────────────────────────────────────────────────────────────────

-- Bloc 1 — colonne marque sur les offres
alter table prestation_fournisseurs
  add column if not exists marque text;

-- Bloc 2 — reprise de l'existant : chaque offre sans marque hérite de la marque de son produit
update prestation_fournisseurs pf
   set marque = btrim(p.marque)
  from prestations p
 where pf.prestation_id = p.id
   and (pf.marque is null or btrim(pf.marque) = '')
   and p.marque is not null
   and btrim(p.marque) <> '';
