import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Parse un fichier ICS et retourne les événements du mois demandé
function parseICS(icsText: string, year: number, month: number) {
  const events: {
    id: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
  }[] = [];

  const lines = icsText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  // Unfold les lignes continuées
  const unfolded: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  let inEvent = false;
  let current: Record<string, string> = {};

  for (const line of unfolded) {
    if (line === "BEGIN:VEVENT") { inEvent = true; current = {}; continue; }
    if (line === "END:VEVENT") {
      inEvent = false;
      if (current["DTSTART"] && current["DTEND"]) {
        const parseDate = (val: string): { iso: string; allDay: boolean } => {
          if (val.length === 8) {
            // DATE only → journée entière
            const y = val.slice(0, 4);
            const mo = val.slice(4, 6);
            const d = val.slice(6, 8);
            return { iso: `${y}-${mo}-${d}T00:00:00`, allDay: true };
          }
          // DATETIME
          const y = val.slice(0, 4);
          const mo = val.slice(4, 6);
          const d = val.slice(6, 8);
          const h = val.slice(9, 11);
          const mi = val.slice(11, 13);
          const s = val.slice(13, 15) || "00";
          return { iso: `${y}-${mo}-${d}T${h}:${mi}:${s}`, allDay: false };
        };

        // Extraire la valeur brute (après éventuel ;TZID=... ou ;VALUE=DATE)
        const rawStart = (current["DTSTART"] || "").split(":").pop() ?? "";
        const rawEnd = (current["DTEND"] || "").split(":").pop() ?? "";
        const { iso: startIso, allDay } = parseDate(rawStart);
        const { iso: endIso } = parseDate(rawEnd);

        const startDate = new Date(startIso);
        // Filtrer sur le mois demandé ± 1 mois pour couvrir les vues
        const targetFrom = new Date(year, month - 1, 1);
        const targetTo = new Date(year, month + 2, 0);
        if (startDate >= targetFrom && startDate <= targetTo) {
          events.push({
            id: current["UID"] ?? `${startIso}-${Math.random()}`,
            title: current["SUMMARY"] ?? "(Sans titre)",
            start: startIso,
            end: endIso,
            allDay,
          });
        }
      }
      continue;
    }
    if (!inEvent) continue;

    // Stocker les propriétés — on garde la clé de base (avant ;)
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).split(";")[0].trim();
    const val = line.slice(colonIdx + 1).trim();
    // Pour DTSTART/DTEND on garde la ligne entière pour pouvoir extraire TZID si besoin
    if (key === "DTSTART" || key === "DTEND") {
      current[key] = line.slice(colonIdx - (line.slice(0, colonIdx).length - key.length));
    } else {
      current[key] = val;
    }
  }

  return events;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const year = parseInt(searchParams.get("year") ?? String(new Date().getFullYear()));
    const month = parseInt(searchParams.get("month") ?? String(new Date().getMonth()));

    // Récupérer le user_id depuis le header ou cookie Supabase
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    let userId: string | null = null;

    if (token) {
      const { data } = await supabaseAdmin.auth.getUser(token);
      userId = data.user?.id ?? null;
    }

    // Fallback : lire le cookie de session Supabase
    if (!userId) {
      const cookieHeader = req.headers.get("cookie") ?? "";
      const match = cookieHeader.match(/sb-[^-]+-auth-token=([^;]+)/);
      if (match) {
        try {
          const decoded = decodeURIComponent(match[1]);
          const parsed = JSON.parse(decoded);
          const accessToken = parsed?.access_token ?? parsed?.[0]?.access_token;
          if (accessToken) {
            const { data } = await supabaseAdmin.auth.getUser(accessToken);
            userId = data.user?.id ?? null;
          }
        } catch {}
      }
    }

    if (!userId) {
      return NextResponse.json({ connected: false, events: [], cals: [] }, { status: 401 });
    }

    // Lire google_cals depuis profil
    const { data: profil } = await supabaseAdmin
      .from("profil")
      .select("google_cals")
      .eq("user_id", userId)
      .single();

    const googleCals: { url: string; nom: string; couleur: string }[] =
      profil?.google_cals ?? [];

    if (!googleCals.length) {
      return NextResponse.json({ connected: false, events: [], cals: [] });
    }

    // Fetch + parse chaque calendrier
    const allEvents: (ReturnType<typeof parseICS>[number] & { calUrl: string })[] = [];

    await Promise.all(
      googleCals.map(async (cal) => {
        try {
          const res = await fetch(cal.url, {
            headers: { "User-Agent": "VoltApp/1.0" },
            next: { revalidate: 300 }, // cache 5 min
          });
          if (!res.ok) return;
          const text = await res.text();
          const events = parseICS(text, year, month);
          events.forEach((ev) => allEvents.push({ ...ev, calUrl: cal.url }));
        } catch (err) {
          console.error(`Erreur fetch Google cal ${cal.url}:`, err);
        }
      })
    );

    return NextResponse.json({
      connected: true,
      cals: googleCals,
      events: allEvents,
    });
  } catch (err) {
    console.error("Google ICS route error:", err);
    return NextResponse.json({ connected: false, events: [], cals: [], error: String(err) });
  }
}
