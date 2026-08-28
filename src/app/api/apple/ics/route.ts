import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { parseICS } from "@/lib/ics";

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

  const allEvents: ReturnType<typeof parseICS> = [];

  for (const cal of cals) {
    if (!cal.url.trim()) continue;
    try {
      const fetchUrl = cal.url.replace(/^webcal:\/\//i, "https://");
      const res = await fetch(fetchUrl, { headers: { "Accept": "text/calendar" } });
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = parseICS(text, timeMin, timeMax, cal.url);
      allEvents.push(...parsed);
    } catch { continue; }
  }

  return NextResponse.json({ events: allEvents, connected: true, cals });
}
