import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function parseICSDate(val: string, tzid?: string): Date {
  // All-day event : date seule
  if (val.length === 8) {
    return new Date(`${val.slice(0,4)}-${val.slice(4,6)}-${val.slice(6,8)}T00:00:00`);
  }
  const y = val.slice(0,4), mo = val.slice(4,6), d = val.slice(6,8);
  const h = val.slice(9,11), mi = val.slice(11,13), s = val.slice(13,15);
  // UTC explicite
  if (val.endsWith("Z")) return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  // Heure locale (TZID présent ou absent) - on interprète comme Europe/Paris
  // En construisant la date ISO sans Z, JS l'interprète en local du serveur (UTC sur Vercel)
  // On doit donc ajouter l'offset Europe/Paris (+1h hiver, +2h été)
  const localStr = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  const utcDate = new Date(localStr + "Z"); // parse as UTC first
  // Calcule l'offset Paris pour cette date
  const parisStr = utcDate.toLocaleString("fr-FR", { timeZone: "Europe/Paris", hour12: false });
  // On utilise Intl pour trouver l'offset
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(utcDate);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "0";
  const parisDate = new Date(`${get("year")}-${get("month")}-${get("day")}T${get("hour").padStart(2,"0")}:${get("minute")}:${get("second")}Z`);
  const offsetMs = utcDate.getTime() - parisDate.getTime();
  return new Date(utcDate.getTime() + offsetMs);
}

function parseICS(icsText: string, timeMin: Date, timeMax: Date, calUrl: string) {
  const events: { id: string; title: string; start: string; end: string; allDay: boolean; calUrl: string }[] = [];
  const blocks = icsText.split("BEGIN:VEVENT");
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const uid = block.match(/^UID:(.+)$/m)?.[1]?.trim() ?? `ev-${i}`;
    const summary = block.match(/^SUMMARY:(.+)$/m)?.[1]?.trim() ?? "(Sans titre)";
    const dtstart = block.match(/^DTSTART(?:;[^:]*)?:(.+)$/m)?.[1]?.trim();
    const dtend = block.match(/^DTEND(?:;[^:]*)?:(.+)$/m)?.[1]?.trim();
    const tzid = block.match(/^DTSTART;TZID=([^:]+):/m)?.[1]?.trim();
    if (!dtstart) continue;
    const allDay = dtstart.length === 8;
    const startDate = parseICSDate(dtstart, tzid);
    const endDate = dtend ? parseICSDate(dtend, tzid) : startDate;
    if (endDate < timeMin || startDate > timeMax) continue;
    events.push({ id: uid, title: summary, start: startDate.toISOString(), end: endDate.toISOString(), allDay, calUrl });
  }
  return events;
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

  const allEvents: { id: string; title: string; start: string; end: string; allDay: boolean; calUrl: string }[] = [];

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
