-- ─────────────────────────────────────────────────────────────────────────────
-- 011_remise_facture_motif.sql
-- Motif de la remise accordée sur une facture (affiché sur le PDF et repris dans le Factur-X).
-- À exécuter après 010_remise_facture.sql.
-- ─────────────────────────────────────────────────────────────────────────────
alter table factures
  add column if not exists remise_facture_motif text;

comment on column factures.remise_facture_motif is 'Motif de la remise de facture (texte libre, imprimé sur la facture)';
