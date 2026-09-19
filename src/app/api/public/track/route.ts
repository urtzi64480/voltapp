// src/app/api/public/track/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type TrackTable = "demande_visites" | "demande_clics";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  const {
    table, user_id, type_clic,
    referrer, user_agent, device_type, navigateur, os, langue,
    page, mode,
  } = body as {
    table?: TrackTable;
    user_id?: string;
    type_clic?: string;
    referrer?: string | null;
    user_agent?: string;
    device_type?: string;
    navigateur?: string;
    os?: string;
    langue?: string;
    page?: string;
    mode?: string | null;
  };

  if (!table || (table !== "demande_visites" && table !== "demande_clics") || !user_id) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Géolocalisation approximative — headers injectés automatiquement par le edge
  // network Vercel sur chaque requête, aucun appel externe ni dépendance nécessaire.
  // Absents en local (dev), présents une fois déployé sur Vercel.
  const pays = req.headers.get("x-vercel-ip-country") || null;
  const region = req.headers.get("x-vercel-ip-country-region") || null;
  const villeRaw = req.headers.get("x-vercel-ip-city");
  const ville = villeRaw ? decodeURIComponent(villeRaw) : null;

  const row: Record<string, unknown> = {
    user_id,
    referrer: referrer || null,
    user_agent: user_agent || null,
    device_type: device_type || null,
    navigateur: navigateur || null,
    os: os || null,
    langue: langue || null,
    pays,
    region,
    ville,
  };

  if (table === "demande_visites") {
    row.page = page || null;
    row.mode = mode || null;
  }

  if (table === "demande_clics") {
    row.type_clic = type_clic || "ajout_contact";
  }

  const { error } = await supabase.from(table).insert(row);
  if (error) {
    console.error(`Erreur tracking (${table}):`, error);
    return NextResponse.json({ error: "Erreur d'enregistrement." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
