-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 013_devis_suivi_realisation.sql
--
-- Suivi de chantier rattaché directement à un devis (avec ou sans plan) : coches des lignes, temps passé par poste,
-- validation finale. Même format JSON que projets.suivi_realisation (migration 008). Colonne nullable, sans effet sur
-- l'existant : un devis sans suivi garde NULL.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

alter table devis add column if not exists suivi_realisation text;
