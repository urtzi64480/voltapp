import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function basicAuth(username: string, password: string) {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

function parseICSDate(val: string): Date {
  // Format: 20240115T080000Z or 20240115T080000 or 20240115
  if (val.length === 8) {
    return new Date(`${val.slice(0,4)}-${val.slice(4,6)}-${val.slice(6,8)}`);
  }
  const y = val.slice(0,4), mo = val.slice(4,6), d = val.slice(6,8);
  const h = val.slice(9,11), mi = val.slice(11,13), s = val.slice(13,15);
  const utc = val.endsWith("Z");
  if (utc) return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
}

function parseICS(icsText: string): { id: string; title: string; start: string; end: string; allDay: boolean }[] {
  const events: { id: string; title: string; start: string; end: string; allDay: boolean }[] = [];
  const eventBlocks = icsText.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [];
  for (const block of eventBlocks) {
    const uid = block.match(/^UID:(.+)$/m)?.[1]?.trim() ?? Math.random().toString();
    const summary = block.match(/^SUMMARY:(.+)$/m)?.[1]?.trim() ?? "(Sans titre)";
    const dtstart = block.match(/^DTSTART(?:;[^:]*)?:(.+)$/m)?.[1]?.trim();
    const dtend = block.match(/^DTEND(?:;[^:]*)?:(.+)$/m)?.[1]?.trim();
    if (!dtstart) continue;
    const allDay = dtstart.length === 8;
    const startDate = parseICSDate(dtstart);
    const endDate = dtend ? parseICSDate(dtend) : startDate;
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
    .from("apple_tokens")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!token) return NextResponse.json({ events: [], connected: false });

  const url = req.nextUrl;
  const year = parseInt(url.searchParams.get("year") ?? String(new Date().getFullYear()));
  const month = parseInt(url.searchParams.get("month") ?? String(new Date().getMonth()));

  const timeMin = new Date(year, month - 1, 1).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const timeMax = new Date(year, month + 2, 0, 23, 59, 59).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const calendarUrls: string[] = JSON.parse(token.selected_calendars ?? "[]");
  if (calendarUrls.length === 0) return NextResponse.json({ events: [], connected: true });

  const allEvents: { id: string; title: string; start: string; end: string; allDay: boolean }[] = [];

  for (const calUrl of calendarUrls) {
    const fullUrl = calUrl.startsWith("http") ? calUrl : `https://caldav.icloud.com${calUrl}`;
    const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${timeMin}" end="${timeMax}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

    try {
      const res = await fetch(fullUrl, {
        method: "REPORT",
        headers: {
          "Authorization": basicAuth(token.username, token.password),
          "Content-Type": "application/xml",
          "Depth": "1",
        },
        body,
      });
      if (!res.ok) continue;
      const text = await res.text();
      // Extract calendar-data blocks
      const dataBlocks = text.match(/<cal:calendar-data[^>]*>([\s\S]*?)<\/cal:calendar-data>/g)
        ?? text.match(/<calendar-data[^>]*>([\s\S]*?)<\/calendar-data>/g) ?? [];
      for (const block of dataBlocks) {
        const ics = block.replace(/<[^>]+>/g, "").trim();
        const parsed = parseICS(ics.includes("BEGIN:VEVENT") ? ics : `BEGIN:VCALENDAR\n${ics}\nEND:VCALENDAR`);
        allEvents.push(...parsed);
      }
    } catch { continue; }
  }

  return NextResponse.json({ events: allEvents, connected: true });
}
