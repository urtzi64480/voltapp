import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { analyserPhotosTableau, ErreurVision, TYPES_IMAGE, type ImageEntree, type TypeImage } from "@/lib/tableau-ia-vision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_IMAGES = 6;
const MAX_CAR_IMAGE = 1_800_000;   // ≈ 1,35 Mo binaire par image
const MAX_CAR_TOTAL = 4_000_000;   // la limite de corps de requête Vercel est de 4,5 Mo
const QUOTA_DEFAUT = 25;           // analyses par utilisateur et par 24 h
const RE_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const err = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => { /* session en lecture seule ici */ },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return err("Non authentifié", 401);

  const cleApi = process.env.ANTHROPIC_API_KEY;
  if (!cleApi) return err("Analyse IA non activée : la clé ANTHROPIC_API_KEY n'est pas configurée sur le serveur.", 503);

  const taille = Number(req.headers.get("content-length") ?? 0);
  if (taille > 4_400_000) return err("Photos trop volumineuses. Réduisez leur nombre ou leur taille.", 413);

  let corps: unknown;
  try { corps = await req.json(); } catch { return err("Requête invalide.", 400); }
  const brut = (corps && typeof corps === "object" ? (corps as { images?: unknown; contexte?: unknown }) : {});
  if (!Array.isArray(brut.images) || brut.images.length < 1) return err("Ajoutez au moins une photo.", 400);
  if (brut.images.length > MAX_IMAGES) return err(`${MAX_IMAGES} photos maximum.`, 400);

  const images: ImageEntree[] = [];
  let total = 0;
  for (const im of brut.images as unknown[]) {
    const o = im && typeof im === "object" ? (im as { type?: unknown; base64?: unknown }) : {};
    if (typeof o.type !== "string" || !(TYPES_IMAGE as readonly string[]).includes(o.type)) return err("Format de photo non pris en charge (JPEG, PNG ou WebP).", 400);
    if (typeof o.base64 !== "string" || o.base64.length < 100 || !RE_BASE64.test(o.base64)) return err("Photo illisible.", 400);
    if (o.base64.length > MAX_CAR_IMAGE) return err("Une photo est trop volumineuse.", 413);
    total += o.base64.length;
    if (total > MAX_CAR_TOTAL) return err("Photos trop volumineuses. Réduisez leur nombre ou leur taille.", 413);
    images.push({ type: o.type as TypeImage, base64: o.base64 });
  }
  const contexte = typeof brut.contexte === "string" ? brut.contexte.slice(0, 300) : "";

  // Quota par utilisateur (protège la clé API). Si la table n'existe pas encore (migration 017 non passée), on ne bloque pas.
  const quota = Math.max(1, parseInt(process.env.TABLEAU_IA_QUOTA_JOUR ?? "", 10) || QUOTA_DEFAUT);
  try {
    const depuis = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count, error } = await supabase.from("tableau_ia_usages").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", depuis);
    if (!error && (count ?? 0) >= quota) return err(`Limite de ${quota} analyses par 24 h atteinte.`, 429);
  } catch { /* quota indisponible : on laisse passer */ }

  try {
    const { releve, modele } = await analyserPhotosTableau(images, contexte, { cleApi, modele: process.env.TABLEAU_IA_MODEL || undefined });
    try { await supabase.from("tableau_ia_usages").insert({ user_id: user.id, nb_photos: images.length, modele }); } catch { /* comptage best-effort */ }
    return NextResponse.json({ releve, modele });
  } catch (e) {
    if (e instanceof ErreurVision) return err(e.message, e.statut);
    return err("Analyse impossible. Réessayez.", 500);
  }
}
