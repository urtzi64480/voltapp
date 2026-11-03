-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 016_devis_afficher_photos.sql
--
-- Option par devis : afficher ou non les photos des produits (PDF, aperçu, page de signature).
-- Colonne avec valeur par défaut true : tous les devis existants gardent leurs photos.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

alter table devis add column if not exists afficher_photos boolean not null default true;
