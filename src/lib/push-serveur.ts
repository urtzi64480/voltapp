// Clés VAPID dérivées de SUPABASE_SERVICE_ROLE_KEY (déjà secrète côté serveur) : aucune variable d'environnement à ajouter.
// Même clé de service → mêmes clés VAPID à chaque déploiement ; changer la clé de service invalide les abonnements (ils se recréent).
import { createECDH, createHmac } from "crypto";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const b64u = (b: Buffer) => b.toString("base64url");

export function clesVapid(secret: string): { publique: string; privee: string } {
  for (let i = 0; i < 8; i++) {
    const privee = createHmac("sha256", secret).update(`voltapp-vapid-v1:${i}`).digest();
    try {
      const ecdh = createECDH("prime256v1");
      ecdh.setPrivateKey(privee);
      return { publique: b64u(ecdh.getPublicKey()), privee: b64u(privee) };
    } catch { /* scalaire invalide (probabilité ~2^-32) : on réessaie */ }
  }
  throw new Error("Clés VAPID impossibles à dériver");
}

export function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

export function configurerWebPush() {
  const k = clesVapid(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");
  webpush.setVapidDetails("mailto:contact@elektron-electricite.fr", k.publique, k.privee);
  return { webpush, ...k };
}
