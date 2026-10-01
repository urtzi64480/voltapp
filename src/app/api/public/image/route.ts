import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { lookup } from "dns/promises";
import { isIP } from "net";

// Relais d'images produit pour les PDF (devis, facture) : le navigateur ne peut pas lire une image
// d'un site tiers (blocage CORS), le serveur si. Route publique car le client qui signe son devis
// télécharge aussi un PDF — mais verrouillée :
//  - seules les URLs d'images DÉJÀ enregistrées par l'artisan (produits, lignes de devis/facture)
//    sont servies : ce n'est pas un proxy ouvert ;
//  - https uniquement, adresses privées/locales refusées (anti-SSRF), 3 redirections max ;
//  - image/* uniquement (pas de SVG), 4 Mo max, délai 6 s.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_OCTETS = 4 * 1024 * 1024;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTIONS = 3;

function ipPrivee(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || a >= 224
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return ipPrivee(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function hoteAutorise(url: URL): Promise<boolean> {
  if (url.protocol !== "https:") return false;
  const h = url.hostname;
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (isIP(h)) return !ipPrivee(h);
  try {
    const adresses = await lookup(h, { all: true });
    return adresses.length > 0 && adresses.every(a => !ipPrivee(a.address));
  } catch {
    return false;
  }
}

async function urlConnue(url: string): Promise<boolean> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !cle) return false;
  const admin = createClient(base, cle, { auth: { persistSession: false } });
  for (const table of ["prestations", "devis_lignes", "facture_lignes"]) {
    const { data, error } = await admin.from(table).select("image_url").eq("image_url", url).limit(1);
    if (!error && data && data.length > 0) return true;
  }
  return false;
}

async function lireBorne(res: Response): Promise<Uint8Array | null> {
  const annonce = Number(res.headers.get("content-length") ?? "0");
  if (annonce > MAX_OCTETS) return null;
  const reader = res.body?.getReader();
  if (!reader) return null;
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_OCTETS) { await reader.cancel(); return null; }
    morceaux.push(value);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  morceaux.forEach(m => { out.set(m, pos); pos += m.length; });
  return out;
}

export async function GET(req: NextRequest) {
  const brut = req.nextUrl.searchParams.get("u") ?? "";
  if (!brut || brut.length > 2000) return new NextResponse("Requête invalide", { status: 400 });

  let courante: URL;
  try { courante = new URL(brut); } catch { return new NextResponse("URL invalide", { status: 400 }); }

  if (!(await urlConnue(brut))) return new NextResponse("Image inconnue", { status: 404 });

  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    for (let saut = 0; saut <= MAX_REDIRECTIONS; saut++) {
      if (!(await hoteAutorise(courante))) return new NextResponse("Adresse refusée", { status: 403 });
      const res = await fetch(courante.toString(), {
        redirect: "manual", signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; VoltApp/1.0)", Accept: "image/*" },
      });
      if (res.status >= 300 && res.status < 400) {
        const suite = res.headers.get("location");
        if (!suite) return new NextResponse("Redirection invalide", { status: 502 });
        courante = new URL(suite, courante);
        continue;
      }
      if (!res.ok) return new NextResponse("Image indisponible", { status: 502 });
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!type.startsWith("image/") || type.includes("svg")) return new NextResponse("Format refusé", { status: 415 });
      const octets = await lireBorne(res);
      if (!octets) return new NextResponse("Image trop volumineuse", { status: 413 });
      return new NextResponse(octets as unknown as BodyInit, {
        status: 200,
        headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400, s-maxage=604800" },
      });
    }
    return new NextResponse("Trop de redirections", { status: 502 });
  } catch {
    return new NextResponse("Image indisponible", { status: 504 });
  } finally {
    clearTimeout(minuteur);
  }
}
