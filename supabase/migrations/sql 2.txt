-- ─────────────────────────────────────────────────────────────────
-- FICHIER : 002_remise_devis.sql
-- À coller dans Supabase → SQL Editor → Run
-- Ajoute les colonnes remise à la table devis
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE devis
  ADD COLUMN IF NOT EXISTS remise_type   TEXT    CHECK (remise_type IN ('percent', 'euro')),
  ADD COLUMN IF NOT EXISTS remise_valeur NUMERIC(10,2) DEFAULT 0;

-- Commentaires pour la lisibilité
COMMENT ON COLUMN devis.remise_type   IS 'Type de remise : percent ou euro';
COMMENT ON COLUMN devis.remise_valeur IS 'Valeur de la remise (% ou €), appliquée sur total services HT uniquement';