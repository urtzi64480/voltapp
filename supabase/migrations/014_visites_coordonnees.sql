-- 014 — Coordonnées approximatives (ville, arrondies à ~1 km) des visites de la page demande, pour la carte des statistiques.
-- Sans effet sur l'existant : colonnes facultatives. Tant qu'elle n'est pas lancée, la carte place les anciennes visites
-- d'après le nom de la ville (communes du Pays Basque connues) et l'enregistrement des visites continue normalement.
ALTER TABLE demande_visites
  ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
