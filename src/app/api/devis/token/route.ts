import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
  );

  // Session obligatoire : seul le propriétaire du devis peut générer un lien de signature
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  let devis_id: string | undefined;
  try {
    ({ devis_id } = await req.json());
  } catch {
    /* corps invalide → traité ci-dessous */
  }
  if (!devis_id) return NextResponse.json({ error: "devis_id requis" }, { status: 400 });

  const { data: devis } = await supabase
    .from("devis")
    .select("id, statut")
    .eq("id", devis_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

  const token = randomBytes(32).toString("hex");
  const expires = new Date();
  expires.setDate(expires.getDate() + 30);

  const update: Record<string, unknown> = {
    signature_token: token,
    signature_token_expires_at: expires.toISOString(),
  };
  // Marque comme envoyé, mais ne repasse jamais un devis déjà signé en "envoyé"
  if (devis.statut !== "signe") update.statut = "envoye";

  const { data: updated, error } = await supabase
    .from("devis")
    .update(update)
    .eq("id", devis_id)
    .eq("user_id", user.id)
    .select("id");
  if (error || !updated || updated.length === 0) {
    return NextResponse.json({ error: "Impossible de générer le lien" }, { status: 500 });
  }

  return NextResponse.json({ token });
}
