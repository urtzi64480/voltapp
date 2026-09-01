// src/app/api/public/rdv/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseICS, ICSEvent } from "@/lib/ics";
import { discoverCalendarUrl, createCalDAVEvent } from "@/lib/caldav";

const MATIN_START = 8, MATIN_END = 12;
const APREM_START = 13, APREM_END = 17;
const CALENDRIER_ECRITURE = "Personnel";
const CALENDRIER_EXCLU = "Ninou";

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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  const { userId, date, periode, nom, telephone, email, adresse, description } = body as {
    userId?: string; date?: string; periode?: "matin" | "aprem";
    nom?: string; telephone?: string; email?: string; adresse?: string; description?: string;
  };

  if (!userId || !date || !periode || !nom?.trim() || !telephone?.trim()) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }
  if (periode !== "matin" && periode !== "aprem") {
    return NextResponse.json({ error: "Période invalide." }, { status: 400 });
  }
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NextResponse.json({ error: "Date invalide." }, { status: 400 });
  const [, ys, ms, ds] = m;
  const y = +ys, mo = +ms, d = +ds;

  const dow = new Date(y, mo - 1, d).getDay();
  if (dow === 0 || dow === 6) {
    return NextResponse.json({ error: "Les rendez-vous en ligne ne sont disponibles que du lundi au vendredi." }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: token } = await supabase
    .from("apple_ics").select("calendars, ics_urls, apple_id, app_password").eq("user_id", userId).single();

  if (!token) {
    return NextResponse.json({ error: "Prise de rendez-vous non configurée." }, { status: 400 });
  }
  if (!token.apple_id || !token.app_password) {
    return NextResponse.json({ error: "Écriture calendrier non configurée. Contactez-nous par téléphone." }, { status: 400 });
  }

  let cals: { url: string; nom?: string }[] = [];
  try {
    cals = JSON.parse(token.calendars ?? "[]");
  } catch { cals = []; }

  // Cohérent avec /api/public/disponibilites : on exclut le calendrier de ta femme
  cals = cals.filter(c => c.nom?.trim().toLowerCase() !== CALENDRIER_EXCLU.toLowerCase());

  const blockStart = parisDateTime(y, mo, d, periode === "matin" ? MATIN_START : APREM_START, 0);
  const blockEnd = parisDateTime(y, mo, d, periode === "matin" ? MATIN_END : APREM_END, 0);

  // Revérification anti-conflit (double réservation simultanée)
  const timeMin = new Date(y, mo - 1, d, 0, 0);
  const timeMax = new Date(y, mo - 1, d, 23, 59);
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
  const conflit = allEvents.some(ev => {
    const evStart = new Date(ev.start).getTime();
    const evEnd = new Date(ev.end).getTime();
    return evStart < blockEnd.getTime() && evEnd > blockStart.getTime();
  });
  if (conflit) {
    return NextResponse.json({ error: "Ce créneau vient d'être réservé. Merci d'en choisir un autre." }, { status: 409 });
  }

  // Écriture dans iCloud
  let caldavUrl: string;
  try {
    const calendarUrl = await discoverCalendarUrl(token.apple_id, token.app_password, CALENDRIER_ECRITURE);
    const descriptionLines = [
      `Tél: ${telephone.trim()}`,
      email?.trim() ? `Email: ${email.trim()}` : null,
      adresse?.trim() ? `Adresse: ${adresse.trim()}` : null,
      description?.trim() ? `Notes: ${description.trim()}` : null,
    ].filter(Boolean).join("\n");

    caldavUrl = await createCalDAVEvent({
      appleId: token.apple_id,
      appPassword: token.app_password,
      calendarUrl,
      summary: `RDV - ${nom.trim()}`,
      description: descriptionLines,
      start: blockStart,
      end: blockEnd,
    });
  } catch (e: any) {
    console.error("Erreur CalDAV:", e);
    return NextResponse.json({ error: "Impossible d'écrire dans le calendrier. Contactez-nous par téléphone." }, { status: 500 });
  }

  // Enregistrement en base
  const { error: insErr } = await supabase.from("rdv").insert({
    user_id: userId,
    date,
    periode,
    nom: nom.trim(),
    telephone: telephone.trim(),
    email: email?.trim() || null,
    adresse: adresse?.trim() || null,
    description: description?.trim() || null,
    statut: "confirme",
    caldav_url: caldavUrl,
  });
  if (insErr) console.error("Erreur insertion rdv:", insErr);

  return NextResponse.json({ success: true });
}
