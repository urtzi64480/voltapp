// Distance atelier → chantier (réservé à l'électricien connecté). Adresses géocodées par Nominatim (OpenStreetMap),
// distance à vol d'oiseau puis estimation routière (× 1,3). Seules les deux adresses sont transmises au service.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { distanceKm, kmRoute } from "@/lib/deplacement";

export const dynamic = "force-dynamic";
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

async function geocoder(adresse: string): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", adresse); url.searchParams.set("format", "json"); url.searchParams.set("limit", "1");
  const r = await fetch(url, { headers: { "User-Agent": "VoltApp/1.0 (calcul de déplacement)", "Accept-Language": "fr" }, signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error("service indisponible");
  const d = await r.json() as { lat?: string; lon?: string }[];
  const lat = Number(d?.[0]?.lat), lng = Number(d?.[0]?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  const b = await req.json().catch(() => null) as { depart?: unknown; arrivee?: unknown } | null;
  const depart = typeof b?.depart === "string" ? b.depart.trim().slice(0, 200) : "";
  const arrivee = typeof b?.arrivee === "string" ? b.arrivee.trim().slice(0, 200) : "";
  if (!depart || !arrivee) return NextResponse.json({ error: "Adresse de départ ou d'arrivée manquante." }, { status: 400 });
  try {
    const a = await geocoder(depart);
    await pause(1100);
    const c = await geocoder(arrivee);
    if (!a) return NextResponse.json({ error: "Adresse de l'atelier introuvable (renseigne-la dans Paramètres)." }, { status: 422 });
    if (!c) return NextResponse.json({ error: "Adresse du client introuvable." }, { status: 422 });
    const vol = distanceKm(a, c);
    return NextResponse.json({ km: kmRoute(vol), kmVolOiseau: Math.round(vol * 10) / 10 });
  } catch {
    return NextResponse.json({ error: "Service de localisation indisponible, réessaie." }, { status: 503 });
  }
}
