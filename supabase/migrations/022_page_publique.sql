-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 022_page_publique.sql
--
-- Un électricien qui n'a pas de page publique (formulaire de demande, RDV en ligne, galerie de réalisations) n'a pas besoin des rubriques
-- « Leads web », « RDV » et « Réalisations » : page_publique = false les retire de son menu. Vrai par défaut : rien ne change pour les comptes existants.
-- Rejouable sans risque.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

alter table profil add column if not exists page_publique boolean not null default true;
