// Enregistre (POST) ou supprime (DELETE) l'abonnement push de l'appareil de l'électricien connecté.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { admin } from "@/lib/push-serveur";

export const dynamic = "force-dynamic";

async function utilisateur() {
  const c = cookies();
  const s = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n: string) => c.get(n)?.value, set: () => {}, remove: () => {} } });
  return (await s.auth.getUser()).data.user;
}

export async function POST(req: NextRequest) {
  const user = await utilisateur();
  if (!user) return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  const b = await req.json().catch(() => null) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = b?.endpoint, p256dh = b?.keys?.p256dh, auth = b?.keys?.auth;
  if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint) || endpoint.length > 600 || typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 200 || auth.length > 100)
    return NextResponse.json({ error: "Abonnement invalide." }, { status: 400 });
  const { error } = await admin().from("push_abonnements").upsert({ user_id: user.id, endpoint, p256dh, auth }, { onConflict: "endpoint" });
  if (error) return NextResponse.json({ error: error.message, tableAbsente: /push_abonnements/i.test(error.message) }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await utilisateur();
  if (!user) return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  const b = await req.json().catch(() => null) as { endpoint?: unknown } | null;
  if (typeof b?.endpoint !== "string") return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  await admin().from("push_abonnements").delete().eq("user_id", user.id).eq("endpoint", b.endpoint);
  return NextResponse.json({ ok: true });
}
