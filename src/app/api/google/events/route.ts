import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_at: string } | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) return null;
  return {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { get: (n) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ events: [], connected: false });

  // Récupère le token stocké
  const { data: tokenRow } = await supabase
    .from("google_tokens")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!tokenRow) return NextResponse.json({ events: [], connected: false });

  let accessToken = tokenRow.access_token;

  // Refresh si expiré (avec 60s de marge)
  if (new Date(tokenRow.expires_at).getTime() < Date.now() + 60_000) {
    if (!tokenRow.refresh_token) {
      return NextResponse.json({ events: [], connected: false, expired: true });
    }
    const refreshed = await refreshAccessToken(tokenRow.refresh_token);
    if (!refreshed) return NextResponse.json({ events: [], connected: false, expired: true });

    accessToken = refreshed.access_token;
    await supabase.from("google_tokens").update({
      access_token: refreshed.access_token,
      expires_at: refreshed.expires_at,
    }).eq("user_id", user.id);
  }

  // Paramètres de la requête : year & month
  const url = req.nextUrl;
  const year = parseInt(url.searchParams.get("year") ?? String(new Date().getFullYear()));
  const month = parseInt(url.searchParams.get("month") ?? String(new Date().getMonth()));

  const timeMin = new Date(year, month - 1, 1).toISOString();
  const timeMax = new Date(year, month + 2, 0, 23, 59, 59).toISOString();

  // Appel Google Calendar API
  const gcalRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
    new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    }),
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!gcalRes.ok) {
    return NextResponse.json({ events: [], connected: true, error: "gcal_fetch_failed" });
  }

  const gcalData = await gcalRes.json();

  // Normalise les events pour le front
  const events = (gcalData.items ?? []).map((ev: any) => ({
    id: ev.id,
    title: ev.summary ?? "(Sans titre)",
    start: ev.start?.dateTime ?? ev.start?.date,
    end: ev.end?.dateTime ?? ev.end?.date,
    allDay: !ev.start?.dateTime,
  }));

  return NextResponse.json({ events, connected: true });
}
