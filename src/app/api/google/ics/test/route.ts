import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ ok: false, error: "Paramètre url manquant" }, { status: 400 });
  }

  // Validation basique
  if (!url.startsWith("https://") && !url.startsWith("webcal://")) {
    return NextResponse.json({ ok: false, error: "URL invalide" });
  }

  // Normaliser webcal:// → https://
  const fetchUrl = url.replace(/^webcal:\/\//, "https://");

  try {
    const res = await fetch(fetchUrl, {
      headers: { "User-Agent": "VoltApp/1.0" },
      signal: AbortSignal.timeout(8000), // timeout 8 secondes
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `HTTP ${res.status}` });
    }

    const text = await res.text();

    // Vérification minimale que c'est bien un fichier ICS
    if (!text.includes("BEGIN:VCALENDAR")) {
      return NextResponse.json({ ok: false, error: "Le fichier ne semble pas être un calendrier ICS valide" });
    }

    // Compter les événements pour info
    const eventCount = (text.match(/BEGIN:VEVENT/g) ?? []).length;

    return NextResponse.json({ ok: true, eventCount });
  } catch (err: any) {
    const message = err?.name === "TimeoutError"
      ? "Délai d'attente dépassé (8s)"
      : String(err?.message ?? err);
    return NextResponse.json({ ok: false, error: message });
  }
}
