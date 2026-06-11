import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
  );

  const { devis_id } = await req.json();
  if (!devis_id) return NextResponse.json({ error: "devis_id requis" }, { status: 400 });

  const token = randomBytes(32).toString("hex");
  const expires = new Date();
  expires.setDate(expires.getDate() + 30);

  await supabase.from("devis").update({
    signature_token: token,
    signature_token_expires_at: expires.toISOString(),
  }).eq("id", devis_id);

  return NextResponse.json({ token });
}
