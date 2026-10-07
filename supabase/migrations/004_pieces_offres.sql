-- ─────────────────────────────────────────────────────────────────
-- FICHIER : 004_pieces_offres.sql
-- À coller dans Supabase → SQL Editor → Run
-- Un article « fini » peut nécessiter l'achat de plusieurs pièces chez un fournisseur :
-- chaque offre fournisseur porte la liste de ses pièces (nom, référence, quantité, prix d'achat).
-- Le prix d'achat de l'offre = somme des pièces (calculé par l'application).
-- ─────────────────────────────────────────────────────────────────
alter table prestation_fournisseurs
  add column if not exists pieces jsonb;
