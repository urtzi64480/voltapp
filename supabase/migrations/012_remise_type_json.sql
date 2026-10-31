-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 012_remise_type_json.sql
--
-- 002 a créé devis.remise_type avec CHECK (remise_type IN ('percent', 'euro')), mais l'application y écrit un JSON
-- { service: "...", materiau: "..." } (devis/nouveau et devis/[id]) : sur une base neuve, enregistrer un devis avec
-- remise échouerait sur cette contrainte. On la supprime ; la validation du contenu est faite côté application.
--
-- Sans effet si la contrainte n'existe déjà plus (cas de la production : elle a forcément été retirée, sinon
-- les remises ne s'enregistreraient pas). Élargir une contrainte ne peut pas invalider de donnée existante.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

alter table devis drop constraint if exists devis_remise_type_check;
