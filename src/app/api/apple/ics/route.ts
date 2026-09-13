import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { parseICS } from "@/lib/ics";

// Certains événements iCloud sont créés par VoltApp lui-même. Deux cas :
// 1. Interventions (src/app/planning/page.tsx) : déjà affichées dans le
//    Planning via la table `interventions` (badge "V") -> il faut les
//    exclure de cette lecture Apple pour éviter le doublon visuel.
// 2. Demandes de RDV client (src/app/api/public/rdv/route.ts) : PAS
//    affichées dans le Planning (seulement sur la page /rdv), donc leur
//    événement Apple doit rester visible ici, sinon elles disparaissent
//    complètement du calendrier VoltApp.
// On ne peut donc pas filtrer par simple motif d'UID "@voltapp" (ça retirait
// aussi les RDV) : on exclut uniquement les événements dont l'URL correspond
// à une intervention déjà chargée en base (caldav_url), au cas par cas.
function extractUidFromCaldavUrl(url: string | null): string | null {
  if (!url) return null;
  const last = url.split("/").pop();
  if (!last) return null;
  return last.replace(/\.ics$/i, "");
}

export async function GET(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ events: [], connected: false, cals: [] });

  const { data: token } = await supabase
    .from("apple_ics").select("*").eq("user_id", user.id).single();

  if (!token) return NextResponse.json({ events: [], connected: false, cals: [] });

  // Charge les calendriers avec nom+couleur
  let cals: { url: string; nom: string; couleur: string }[] = [];
  try {
    cals = JSON.parse(token.calendars ?? "[]");
    if (cals.length === 0) {
      const urls = JSON.parse(token.ics_urls ?? "[]");
      cals = urls.map((u: string, i: number) => ({ url: u, nom: `Calendrier ${i + 1}`, couleur: "#9ca3af" }));
    }
  } catch { cals = []; }

  if (cals.length === 0) return NextResponse.json({ events: [], connected: true, cals: [] });

  const url = req.nextUrl;
  const year = parseInt(url.searchParams.get("year") ?? String(new Date().getFullYear()));
  const month = parseInt(url.searchParams.get("month") ?? String(new Date().getMonth()));
  const timeMin = new Date(year, month - 1, 1);
  const timeMax = new Date(year, month + 2, 0, 23, 59, 59);

  // UID des interventions déjà écrites dans iCloud, pour ce user et cette
  // période affichée dans le Planning : seuls ceux-là doivent être exclus
  // de la relecture Apple (RLS bypassée par la service role key -> filtre
  // explicite par user_id obligatoire).
  const { data: ivRows } = await supabase
    .from("interventions")
    .select("caldav_url")
    .eq("user_id", user.id)
    .not("caldav_url", "is", null)
    .gte("date_debut", timeMin.toISOString())
    .lte("date_debut", timeMax.toISOString());

  const interventionUids = new Set(
    (ivRows ?? [])
      .map(r => extractUidFromCaldavUrl((r as { caldav_url: string | null }).caldav_url))
      .filter((uid): uid is string => !!uid)
  );

  const allEvents: ReturnType<typeof parseICS> = [];

  for (const cal of cals) {
    if (!cal.url.trim()) continue;
    try {
      const fetchUrl = cal.url.replace(/^webcal:\/\//i, "https://");
      const res = await fetch(fetchUrl, { headers: { "Accept": "text/calendar" } });
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = parseICS(text, timeMin, timeMax, cal.url);
      const parsedSansDoublonsIntervention = parsed.filter(ev => !interventionUids.has((ev as { id: string }).id));
      allEvents.push(...parsedSansDoublonsIntervention);
    } catch { continue; }
  }

  return NextResponse.json({ events: allEvents, connected: true, cals });
}
