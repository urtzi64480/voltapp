import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function parseICSDate(val: string): Date {
  if (val.length === 8) {
    return new Date(`${val.slice(0,4)}-${val.slice(4,6)}-${val.slice(6,8)}`);
  }
  const y = val.slice(0,4), mo = val.slice(4,6), d = val.slice(6,8);
  const h = val.slice(9,11), mi = val.slice(11,13), s = val.slice(13,15);
  if (val.endsWith("Z")) return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
}

function parseICS(icsText: string, timeMin: Date, timeMax: Date) {
  const events: { id: string; title: string; start: string; end: string; allDay: boolean }[] = [];
  const blocks = icsText.split("BEGIN:VEVENT");
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const uid = block.match(/^UID:(.+)$/m)?.[1]?.trim() ?? `ev-${i}`;
    const summary = block.match(/^SUMMARY:(.+)$/m)?.[1]?.trim() ?? "(Sans titre)";
    const dtstart = block.match(/^DTSTART(?:;[^:]*)?:(.+)$/m)?.[1]?.trim();
    const dtend = block.match(/^DTEND(?:;[^:]*)?:(.+)$/m)?.[1]?.trim();
    if (!dtstart) continue;
    const allDay = dtstart.length === 8;
    const startDate = parseICSDate(dtstart);
    const endDate = dtend ? parseICSDate(dtend) : startDate;
    if (endDate < timeMin || startDate > timeMax) continue;
    events.push({ id: uid, title: summary, start: startDate.toISOString(), end: endDate.toISOString(), allDay });
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
  if (!user) return NextResponse.json({ events: [], connected: false });

  const { data: token } = await supabase
    .from("apple_ics").select("*").eq("user_id", user.id).single();

  if (!token) return NextResponse.json({ events: [], connected: false });

  const urls: string[] = JSON.parse(token.ics_urls ?? "[]");
  if (urls.length === 0) return NextResponse.json({ events: [], connected: true });

  const url = req.nextUrl;
  const year = parseInt(url.searchParams.get("year") ?? String(new Date().getFullYear()));
  const month = parseInt(url.searchParams.get("month") ?? String(new Date().getMonth()));
  const timeMin = new Date(year, month - 1, 1);
  const timeMax = new Date(year, month + 2, 0, 23, 59, 59);

  const allEvents: { id: string; title: string; start: string; end: string; allDay: boolean }[] = [];

  for (const icsUrl of urls) {
    try {
      // Convertir webcal:// en https://
      const fetchUrl = icsUrl.replace(/^webcal:\/\//i, "https://");
      const res = await fetch(fetchUrl, {
        headers: { "Accept": "text/calendar" },
        next: { revalidate: 0 },
      } as any);
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = parseICS(text, timeMin, timeMax);
      allEvents.push(...parsed);
    } catch { continue; }
  }

  return NextResponse.json({ events: allEvents, connected: true });
}
