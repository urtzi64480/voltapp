-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 019_devis_achats_article.sql
--
-- Achat rattaché à un article de la liste de courses d'un devis (saisie du prix payé article par article, dans la liste de courses).
--   article : nom de l'article de la liste de courses ; NULL = achat global du devis (« j'ai tout acheté »).
-- À lancer après la 018. Rejouable sans risque ; les achats existants restent des achats globaux.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

alter table devis_achats add column if not exists article text;
