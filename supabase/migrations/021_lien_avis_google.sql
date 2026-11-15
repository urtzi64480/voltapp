-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 021_lien_avis_google.sql
--
-- Lien « laisser un avis » de la fiche Google de CHAQUE entreprise : il alimente le QR code du dashboard.
-- Avant, le lien d'un seul électricien était écrit dans le code ; chaque compte renseigne maintenant le sien dans Paramètres.
-- Rejouable sans risque.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

alter table profil add column if not exists lien_avis_google text;
