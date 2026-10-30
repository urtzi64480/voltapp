-- ─────────────────────────────────────────────────────────────────────────────
-- 010_remise_facture.sql
-- Remise appliquée sur une facture générée, AVANT son envoi au client.
--   remise_facture_type    : 'pct' (pourcentage) | 'eur' (montant fixe) — saisie de l'utilisateur
--   remise_facture_valeur  : valeur saisie (% ou €)
--   remise_facture_montant : montant effectif de la remise, en € (déjà déduit de total_ttc)
-- total_service / total_materiau restent les totaux nets AVANT cette remise ;
-- total_ttc = total_service + total_materiau - remise_facture_montant.
-- ─────────────────────────────────────────────────────────────────────────────
alter table factures
  add column if not exists remise_facture_type    text check (remise_facture_type in ('pct', 'eur')),
  add column if not exists remise_facture_valeur  numeric(10,2) default 0,
  add column if not exists remise_facture_montant numeric(10,2) default 0;

comment on column factures.remise_facture_montant is 'Remise (€) accordée sur la facture avant envoi ; déjà déduite de total_ttc';
