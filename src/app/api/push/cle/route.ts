import { NextResponse } from "next/server";
import { clesVapid } from "@/lib/push-serveur";

export const dynamic = "force-dynamic";
export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "Serveur non configuré." }, { status: 503 });
  return NextResponse.json({ publicKey: clesVapid(process.env.SUPABASE_SERVICE_ROLE_KEY).publique });
}
