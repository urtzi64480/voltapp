// Géocodage de villes (nom → coordonnées) pour la carte des visiteurs, réservé à l'électricien connecté.
// Service : Nominatim (OpenStreetMap), ≤ 1 requête/seconde, identifié par User-Agent. Seul le NOM de la ville est envoyé.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const MAX_PAR_APPEL = 5; // 5 × ~1,1 s : reste sous la durée maximale d'une fonction serverless
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non connecté." }, { status: 401 });

  const body = await req.json().catch(() => null) as { lieux?: { cle?: unknown; ville?: unknown; pays?: unknown }[] } | null;
  const lieux = Array.isArray(body?.lieux) ? body!.lieux.slice(0, MAX_PAR_APPEL) : [];
  // resultats[cle] = coordonnées, ou null si le service ne connaît pas ce lieu ; une clé absente = échec temporaire (à réessayer).
  const resultats: Record<string, { lat: number; lng: number } | null> = {};
  let premier = true;
  for (const l of lieux) {
    if (typeof l.cle !== "string" || typeof l.ville !== "string" || !l.ville.trim() || l.ville.length > 100) continue;
    if (!premier) await pause(1100);
    premier = false;
    const q = [l.ville, typeof l.pays === "string" ? l.pays.slice(0, 2) : ""].filter(Boolean).join(", ");
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q); url.searchParams.set("format", "json"); url.searchParams.set("limit", "1");
    if (typeof l.pays === "string" && /^[A-Za-z]{2}$/.test(l.pays)) url.searchParams.set("countrycodes", l.pays.toLowerCase());
    try {
      const r = await fetch(url, { headers: { "User-Agent": "VoltApp/1.0 (statistiques de visite)", "Accept-Language": "fr" }, signal: AbortSignal.timeout(4000) });
      if (!r.ok) continue;
      const data = await r.json() as { lat?: string; lon?: string }[];
      const lat = Number(data?.[0]?.lat), lng = Number(data?.[0]?.lon);
      resultats[l.cle] = Number.isFinite(lat) && Number.isFinite(lng) ? { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 } : null;
    } catch { /* échec réseau : on ne met rien, la ville sera retentée plus tard */ }
  }
  return NextResponse.json({ resultats });
}
