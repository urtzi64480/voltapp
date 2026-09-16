// src/lib/rate-limit.ts
import { SupabaseClient } from "@supabase/supabase-js";

// Fenêtre et quota de la limitation par IP — ajustables selon le niveau de flood constaté
export const RATE_LIMIT_WINDOW_MINUTES = 15;
export const RATE_LIMIT_MAX_REQUESTS = 3;

// Délai minimum entre le chargement de la page et la soumission du formulaire.
// En dessous, on considère qu'il s'agit très probablement d'un bot (remplissage instantané).
export const MIN_SUBMIT_DELAY_MS = 2500;

/**
 * Indique si une IP a déjà atteint son quota de demandes ABOUTIES (type "devis" ou "rdv")
 * sur la fenêtre glissante. À appeler avant tout traitement, pour rejeter tôt.
 * Ne prend en compte que les tentatives enregistrées via recordAttempt (voir plus bas) —
 * un échec serveur, un créneau déjà pris, etc. ne consomment pas le quota, pour ne pas
 * pénaliser un client qui corrige une erreur et recommence.
 * "Fail open" en cas d'erreur DB (ex: table pas encore migrée) : on ne bloque pas
 * un vrai client par erreur, on se contente de logger.
 */
export async function isRateLimited(
  supabase: SupabaseClient,
  ip: string,
  type: "devis" | "rdv"
): Promise<boolean> {
  if (!ip || ip === "unknown") return false; // pas d'IP exploitable, on ne bloque pas

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("demande_rate_limit")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .eq("type", type)
    .gte("created_at", since);

  if (error) {
    console.error("Erreur vérification rate limit:", error);
    return false;
  }

  return (count ?? 0) >= RATE_LIMIT_MAX_REQUESTS;
}

/**
 * Enregistre une tentative comptant pour le quota — à appeler UNIQUEMENT après que la
 * demande/le RDV a réellement abouti (jamais avant, jamais en cas d'échec), pour que
 * seuls les envois qui produisent effectivement une donnée en base soient comptabilisés.
 */
export async function recordAttempt(
  supabase: SupabaseClient,
  ip: string,
  type: "devis" | "rdv"
): Promise<void> {
  if (!ip || ip === "unknown") return;
  const { error } = await supabase.from("demande_rate_limit").insert({ ip, type });
  if (error) console.error("Erreur insertion rate limit:", error);
}

/** Extrait l'IP du visiteur depuis les headers (Vercel renseigne x-forwarded-for). */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** true si la soumission est trop rapide après le chargement de la page (probable bot). */
export function isTooFast(loadedAt: unknown): boolean {
  if (typeof loadedAt !== "number") return false; // pas de timestamp fourni : on ne bloque pas
  return Date.now() - loadedAt < MIN_SUBMIT_DELAY_MS;
}
