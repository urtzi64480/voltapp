// src/app/api/public/track/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type TrackTable = "demande_visites" | "demande_clics";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Route publique sans authentification : on borne la taille de chaque champ stocké.
const borne = (v: unknown, max: number): string | null =>
  typeof v === "string" && v ? v.slice(0, max) : null;

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

  if (!table || (table !== "demande_visites" && table !== "demande_clics") || typeof user_id !== "string" || !UUID_RE.test(user_id)) {
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
  let ville: string | null = null;
  if (villeRaw) {
    try { ville = decodeURIComponent(villeRaw); } catch { ville = villeRaw; } // en-tête mal encodé → valeur brute
  }

  const row: Record<string, unknown> = {
    user_id,
    referrer: borne(referrer, 500),
    user_agent: borne(user_agent, 500),
    device_type: borne(device_type, 50),
    navigateur: borne(navigateur, 100),
    os: borne(os, 100),
    langue: borne(langue, 35),
    pays,
    region,
    ville,
  };

  if (table === "demande_visites") {
    row.page = borne(page, 300);
    row.mode = borne(mode, 50);
  }

  if (table === "demande_clics") {
    row.type_clic = borne(type_clic, 80) ?? "ajout_contact";
  }

  const { error } = await supabase.from(table).insert(row);
  if (error) {
    console.error(`Erreur tracking (${table}):`, error);
    return NextResponse.json({ error: "Erreur d'enregistrement." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
