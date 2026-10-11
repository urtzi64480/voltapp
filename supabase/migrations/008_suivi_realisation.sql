-- ─────────────────────────────────────────────────────────────────
-- FICHIER : 008_suivi_realisation.sql
-- À coller dans Supabase → SQL Editor → Run
-- Suivi de réalisation d'un plan de circuits : coches posées sur le
-- chantier (disjoncteurs, boîtes, points lumineux, commandes, câbles).
-- Colonne séparée de maison_config pour que la sauvegarde automatique
-- de l'éditeur de plan ne puisse jamais l'écraser.
-- Les droits (RLS) de la table projets s'appliquent déjà à cette colonne.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE projets
  ADD COLUMN IF NOT EXISTS suivi_realisation TEXT;

COMMENT ON COLUMN projets.suivi_realisation IS 'JSON {v:1, coches:{clé: date ISO}} — suivi de pose du plan de circuits';
