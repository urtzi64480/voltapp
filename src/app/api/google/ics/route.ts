import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { parseICS } from "@/lib/ics";
import { fetchSur } from "@/lib/ssrf";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Client service role créé À LA DEMANDE (et non au chargement du module) : un module qui
    // plante à l'import quand une variable d'environnement manque fait échouer tout le build.
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { searchParams } = new URL(req.url);
    const year = parseInt(searchParams.get("year") ?? "", 10);
    const month = parseInt(searchParams.get("month") ?? "", 10);
    const now = new Date();
    const annee = Number.isFinite(year) ? year : now.getFullYear();
    const mois = Number.isFinite(month) ? month : now.getMonth();

    // Utilisateur : jeton Bearer explicite, sinon session par cookie (même mécanisme que les
    // autres routes — gère aussi les cookies de session découpés en plusieurs morceaux, ce que
    // l'ancienne lecture manuelle du cookie ne faisait pas).
    let userId: string | null = null;
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (token) {
      const { data } = await supabaseAdmin.auth.getUser(token);
      userId = data.user?.id ?? null;
    }
    if (!userId) {
      const cookieStore = cookies();
      const supabaseSession = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
      );
      const { data } = await supabaseSession.auth.getUser();
      userId = data.user?.id ?? null;
    }

    if (!userId) {
      return NextResponse.json({ connected: false, events: [], cals: [] }, { status: 401 });
    }

    // Lire google_cals depuis le profil. La clé primaire de `profil` est `id` (= id utilisateur) :
    // il n'existe pas de colonne `user_id`, la requête précédente ne renvoyait donc jamais rien.
    const { data: profil } = await supabaseAdmin
      .from("profil")
      .select("google_cals")
      .eq("id", userId)
      .maybeSingle();

    const googleCals: { url: string; nom: string; couleur: string }[] =
      profil?.google_cals ?? [];

    if (!googleCals.length) {
      return NextResponse.json({ connected: false, events: [], cals: [] });
    }

    // Même fenêtre que /api/apple/ics : mois précédent → mois suivant
    const timeMin = new Date(annee, mois - 1, 1);
    const timeMax = new Date(annee, mois + 2, 0, 23, 59, 59);

    const allEvents: ReturnType<typeof parseICS> = [];
    await Promise.all(
      googleCals.map(async (cal) => {
        try {
          const res = await fetchSur(cal.url, {
            headers: { "User-Agent": "VoltApp/1.0", Accept: "text/calendar" },
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) return;
          const text = await res.text();
          allEvents.push(...parseICS(text, timeMin, timeMax, cal.url));
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
