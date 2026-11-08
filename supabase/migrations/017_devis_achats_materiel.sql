-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 017_devis_achats_materiel.sql
--
-- Dépenses réelles de matériel par devis (page « Achats matériel », rangées par mois).
--   achat_materiel_reel : montant réellement dépensé pour ce devis (saisi à la main). NULL = pas encore saisi.
--   achat_materiel_date : date de l'achat ; classe la dépense dans son mois. NULL = mois de signature du devis.
-- Aucune valeur par défaut : tous les devis existants restent « à saisir ». Rien n'est calculé ni modifié ailleurs.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

alter table devis add column if not exists achat_materiel_reel numeric(12,2);
alter table devis add column if not exists achat_materiel_date date;
