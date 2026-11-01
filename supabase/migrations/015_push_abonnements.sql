-- 015 — Abonnements aux notifications push (une ligne par appareil). Lus et écrits uniquement par le serveur (clé service) :
-- RLS activée SANS policy = aucun accès avec la clé publique.
CREATE TABLE IF NOT EXISTS push_abonnements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint      text NOT NULL UNIQUE,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  derniere_envoi date,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE push_abonnements ENABLE ROW LEVEL SECURITY;
