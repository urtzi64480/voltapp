// src/app/api/fournisseurs/reference/route.ts
//
// POST { url } → lit la fiche produit chez le fournisseur et renvoie sa référence (voir lib/extraire-reference.ts).
// Réservé aux utilisateurs connectés (middleware : tout ce qui n'est pas /api/public exige une session).
// Le serveur va chercher une URL fournie par l'utilisateur : protections anti-SSRF (http/https seulement, ports usuels,
// adresses privées / locales refusées — y compris après résolution DNS et à chaque redirection), délai et taille bornés.
import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extraireReference } from "@/lib/extraire-reference";

export const runtime = "nodejs";
export const maxDuration = 20;

const DELAI_MS = 10_000;
const TAILLE_MAX = 2_500_000;
const REDIRECTIONS_MAX = 4;

function ipPrivee(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return ipPrivee(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function urlAutorisee(brut: string): Promise<URL> {
  let u: URL;
  try { u = new URL(brut); } catch { throw new Error("Lien invalide."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Seuls les liens http(s) sont acceptés.");
  if (u.username || u.password) throw new Error("Lien invalide.");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error("Port non autorisé.");
  const hote = u.hostname.replace(/^\[|\]$/g, "");
  if (!hote.includes(".") && isIP(hote) === 0) throw new Error("Lien invalide.");
  const adresses = isIP(hote) ? [{ address: hote }] : await lookup(hote, { all: true }).catch(() => { throw new Error("Site introuvable."); });
  if (adresses.length === 0 || adresses.some(a => ipPrivee(a.address))) throw new Error("Adresse non autorisée.");
  return u;
}

async function lirePage(depart: string): Promise<{ html: string; urlFinale: string }> {
  let courante = await urlAutorisee(depart);
  for (let saut = 0; saut <= REDIRECTIONS_MAX; saut++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), DELAI_MS);
    let rep: Response;
    try {
      rep = await fetch(courante.toString(), {
        redirect: "manual", signal: ctrl.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "fr-FR,fr;q=0.9",
        },
      });
    } catch { throw new Error("Le site ne répond pas (délai dépassé ou connexion refusée)."); }
    finally { clearTimeout(t); }
    if (rep.status >= 300 && rep.status < 400 && rep.headers.get("location")) {
      courante = await urlAutorisee(new URL(rep.headers.get("location") as string, courante).toString());
      continue;
    }
    if (rep.status === 401 || rep.status === 403 || rep.status === 429 || rep.status === 503)
      throw new Error(`Le site refuse la lecture automatique (code ${rep.status}) : copie la référence à la main.`);
    if (!rep.ok) throw new Error(`Page introuvable (code ${rep.status}).`);
    const type = rep.headers.get("content-type") ?? "";
    if (type && !/html|xml|text/i.test(type)) throw new Error("Le lien ne pointe pas vers une page web.");
    const lecteur = rep.body?.getReader();
    if (!lecteur) return { html: await rep.text(), urlFinale: courante.toString() };
    const morceaux: Uint8Array[] = []; let total = 0;
    while (total < TAILLE_MAX) {
      const { done, value } = await lecteur.read();
      if (done) break;
      morceaux.push(value); total += value.length;
    }
    lecteur.cancel().catch(() => {});
    return { html: new TextDecoder("utf-8").decode(Buffer.concat(morceaux)), urlFinale: courante.toString() };
  }
  throw new Error("Trop de redirections.");
}

export async function POST(req: NextRequest) {
  const corps = await req.json().catch(() => null) as { url?: unknown } | null;
  const url = typeof corps?.url === "string" ? corps.url.trim() : "";
  if (!url || url.length > 2000) return NextResponse.json({ error: "Colle d'abord le lien du produit." }, { status: 400 });
  try {
    const { html, urlFinale } = await lirePage(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const r = extraireReference(html);
    if (!r.reference) {
      const bloque = /captcha|datadome|cloudflare|access denied|robot/i.test(html.slice(0, 20000)) && html.length < 60000;
      return NextResponse.json({ ...r, urlFinale, error: bloque ? "Le site affiche une protection anti-robot : copie la référence à la main." : "Aucune référence trouvée sur cette page." });
    }
    return NextResponse.json({ ...r, urlFinale });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lecture impossible." });
  }
}
