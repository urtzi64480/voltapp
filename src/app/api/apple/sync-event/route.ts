// src/app/api/apple/sync-event/route.ts
// Route authentifiée (cookie de session) qui crée/modifie/supprime un
// événement dans le calendrier iCloud "Personnel" de l'utilisateur connecté.
// Utilisée par le planning (interventions) et la page RDV (suppression).

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { discoverCalendarUrl, createCalDAVEvent, updateCalDAVEvent, deleteCalDAVEvent } from "@/lib/caldav";

const CALENDRIER_ECRITURE = "Personnel";

async function getCreds(supabase: any, userId: string) {
  const { data: token } = await supabase
    .from("apple_ics").select("apple_id, app_password").eq("user_id", userId).single();
  if (!token?.apple_id || !token?.app_password) {
    throw new Error("Identifiants iCloud non configurés.");
  }
  return { appleId: token.apple_id as string, appPassword: token.app_password as string };
}

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  const { action, eventUrl, summary, description, start, end } = body as {
    action: "create" | "update" | "delete";
    eventUrl?: string;
    summary?: string;
    description?: string;
    start?: string;
    end?: string;
  };

  try {
    const creds = await getCreds(supabase, user.id);

    if (action === "delete") {
      if (!eventUrl) return NextResponse.json({ error: "eventUrl manquant." }, { status: 400 });
      await deleteCalDAVEvent({ ...creds, eventUrl });
      return NextResponse.json({ success: true });
    }

    if (!summary || !start || !end) {
      return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
    }

    if (action === "update") {
      if (!eventUrl) return NextResponse.json({ error: "eventUrl manquant." }, { status: 400 });
      await updateCalDAVEvent({
        ...creds, eventUrl, summary, description,
        start: new Date(start), end: new Date(end),
      });
      return NextResponse.json({ success: true, eventUrl });
    }

    // action === "create"
    const calendarUrl = await discoverCalendarUrl(creds.appleId, creds.appPassword, CALENDRIER_ECRITURE);
    const newUrl = await createCalDAVEvent({
      ...creds, calendarUrl, summary, description,
      start: new Date(start), end: new Date(end),
    });
    return NextResponse.json({ success: true, eventUrl: newUrl });
  } catch (e: any) {
    console.error("Erreur sync-event:", e);
    return NextResponse.json({ error: e.message || "Erreur de synchronisation iCloud." }, { status: 500 });
  }
}
