// src/app/api/public/disponibilites/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parisDateTime, parisYMD } from "@/lib/ics";
import { listerCalendriers, chargerEvenements } from "@/lib/calendriers-publics";

const MATIN_START = 8, MATIN_END = 12;
const APREM_START = 13, APREM_END = 17;
const NB_JOURS_OUVRES = 20; // ~4 semaines de lundi à vendredi
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pad(n: number) { return String(n).padStart(2, "0"); }

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId manquant" }, { status: 400 });
  if (!UUID_RE.test(userId)) return NextResponse.json({ error: "userId invalide" }, { status: 400 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: token } = await supabase
    .from("apple_ics").select("calendars, ics_urls").eq("user_id", userId).single();

  if (!token) {
    return NextResponse.json({ available: false, days: [] });
  }

  // On exclut le calendrier de ta femme ("Ninou") de la disponibilité client —
  // tous tes autres calendriers connectés comptent normalement.
  const CALENDRIER_EXCLU = "Ninou";

  const cals = listerCalendriers(token, CALENDRIER_EXCLU);

  if (cals.length === 0) {
    return NextResponse.json({ available: false, days: [] });
  }

  // Fenêtre de recherche : demain -> +60 jours calendaires (large pour couvrir 20 jours ouvrés).
  // Toutes les dates sont calculées en calendrier de Paris, indépendamment du fuseau du serveur.
  const auj = parisYMD();
  const timeMin = parisDateTime(auj.y, auj.m, auj.d + 1, 0, 0);
  const timeMax = parisDateTime(auj.y, auj.m, auj.d + 60, 23, 59);

  const { events: allEvents, echecs } = await chargerEvenements(cals, timeMin, timeMax);
  // Un calendrier illisible = on ne sait pas ce qui est occupé : on ne propose aucun créneau
  // plutôt que de présenter comme libres des plages peut-être prises (la page bascule en saisie libre).
  if (echecs > 0) {
    return NextResponse.json({ available: false, days: [] });
  }

  const days: { date: string; matin: boolean; aprem: boolean }[] = [];
  // Curseur = jour calendaire (midi UTC : jamais ambigu) ; le fuseau n'intervient qu'à la comparaison.
  const cursor = new Date(Date.UTC(auj.y, auj.m - 1, auj.d + 1, 12));
  const dernier = Date.UTC(auj.y, auj.m - 1, auj.d + 60, 12);
  let found = 0;

  while (found < NB_JOURS_OUVRES && cursor.getTime() <= dernier) {
    const dow = cursor.getUTCDay(); // 0 = dimanche, 6 = samedi
    if (dow >= 1 && dow <= 5) {
      const y = cursor.getUTCFullYear(), m = cursor.getUTCMonth() + 1, d = cursor.getUTCDate();
      const matinStart = parisDateTime(y, m, d, MATIN_START, 0);
      const matinEnd = parisDateTime(y, m, d, MATIN_END, 0);
      const apremStart = parisDateTime(y, m, d, APREM_START, 0);
      const apremEnd = parisDateTime(y, m, d, APREM_END, 0);

      let matinLibre = true, apremLibre = true;
      for (const ev of allEvents) {
        const evStart = new Date(ev.start).getTime();
        const evEnd = new Date(ev.end).getTime();
        if (ev.allDay) {
          // Un événement journée entière bloque toute la journée (minuit → minuit, heure de Paris)
          const dayStart = parisDateTime(y, m, d, 0, 0).getTime();
          const dayEnd = parisDateTime(y, m, d + 1, 0, 0).getTime();
          if (evStart < dayEnd && evEnd > dayStart) { matinLibre = false; apremLibre = false; }
          continue;
        }
        if (evStart < matinEnd.getTime() && evEnd > matinStart.getTime()) matinLibre = false;
        if (evStart < apremEnd.getTime() && evEnd > apremStart.getTime()) apremLibre = false;
      }

      days.push({ date: `${y}-${pad(m)}-${pad(d)}`, matin: matinLibre, aprem: apremLibre });
      found++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return NextResponse.json({ available: true, days });
}
