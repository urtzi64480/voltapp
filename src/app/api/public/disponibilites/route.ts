// src/app/api/public/disponibilites/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseICS, ICSEvent } from "@/lib/ics";

const MATIN_START = 8, MATIN_END = 12;
const APREM_START = 13, APREM_END = 17;
const NB_JOURS_OUVRES = 20; // ~4 semaines de lundi à vendredi

function pad(n: number) { return String(n).padStart(2, "0"); }
function toDateKey(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// Construit une Date UTC pour une heure locale Europe/Paris donnée
function parisDateTime(year: number, month: number, day: number, hour: number, minute: number): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(utcGuess);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "0";
  const parisAsUtc = new Date(Date.UTC(+get("year"), +get("month") - 1, +get("day"), +get("hour"), +get("minute"), +get("second")));
  const offsetMs = utcGuess.getTime() - parisAsUtc.getTime();
  return new Date(utcGuess.getTime() + offsetMs);
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId manquant" }, { status: 400 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: token } = await supabase
    .from("apple_ics").select("calendars, ics_urls").eq("user_id", userId).single();

  if (!token) {
    return NextResponse.json({ available: false, days: [] });
  }

  const CALENDRIER_EXCLU = "Ninou";

  let cals: { url: string; nom?: string }[] = [];
  try {
    cals = JSON.parse(token.calendars ?? "[]");
  } catch { cals = []; }

  // On exclut le calendrier de ta femme ("Ninou") de la disponibilité client —
  // tous tes autres calendriers connectés comptent normalement.
  cals = cals.filter(c => c.nom?.trim().toLowerCase() !== CALENDRIER_EXCLU.toLowerCase());

  if (cals.length === 0) {
    return NextResponse.json({ available: false, days: [] });
  }

  // Fenêtre de recherche : demain -> +8 semaines calendaires (large pour couvrir 20 jours ouvrés)
  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 60);

  const allEvents: ICSEvent[] = [];
  for (const cal of cals) {
    if (!cal.url?.trim()) continue;
    try {
      const fetchUrl = cal.url.replace(/^webcal:\/\//i, "https://");
      const res = await fetch(fetchUrl, { headers: { "Accept": "text/calendar" } });
      if (!res.ok) continue;
      const text = await res.text();
      allEvents.push(...parseICS(text, timeMin, timeMax, cal.url));
    } catch { continue; }
  }

  const days: { date: string; matin: boolean; aprem: boolean }[] = [];
  const cursor = new Date(timeMin);
  let found = 0;

  while (found < NB_JOURS_OUVRES && cursor <= timeMax) {
    const dow = cursor.getDay(); // 0 = dimanche, 6 = samedi
    if (dow >= 1 && dow <= 5) {
      const y = cursor.getFullYear(), m = cursor.getMonth() + 1, d = cursor.getDate();
      const matinStart = parisDateTime(y, m, d, MATIN_START, 0);
      const matinEnd = parisDateTime(y, m, d, MATIN_END, 0);
      const apremStart = parisDateTime(y, m, d, APREM_START, 0);
      const apremEnd = parisDateTime(y, m, d, APREM_END, 0);

      let matinLibre = true, apremLibre = true;
      for (const ev of allEvents) {
        const evStart = new Date(ev.start).getTime();
        const evEnd = new Date(ev.end).getTime();
        if (ev.allDay) {
          // Un événement journée entière bloque toute la journée
          const dayStart = parisDateTime(y, m, d, 0, 0).getTime();
          const dayEnd = parisDateTime(y, m, d, 23, 59).getTime();
          if (evStart < dayEnd && evEnd > dayStart) { matinLibre = false; apremLibre = false; }
          continue;
        }
        if (evStart < matinEnd.getTime() && evEnd > matinStart.getTime()) matinLibre = false;
        if (evStart < apremEnd.getTime() && evEnd > apremStart.getTime()) apremLibre = false;
      }

      days.push({ date: toDateKey(cursor), matin: matinLibre, aprem: apremLibre });
      found++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return NextResponse.json({ available: true, days });
}
