// Garde anti-SSRF : refuse toute URL qui pointerait vers le réseau interne du serveur
// (localhost, adresses privées / link-local / métadonnées cloud) quand le serveur télécharge
// une URL fournie par un utilisateur. https uniquement.
import { lookup } from "dns/promises";
import { isIP } from "net";

export function ipPrivee(ip: string): boolean {
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

export async function hoteAutorise(url: URL): Promise<boolean> {
  if (url.protocol !== "https:") return false;
  const h = url.hostname;
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  // Les adresses IPv6 littérales sont entre crochets dans `hostname`
  const brut = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
  if (isIP(brut)) return !ipPrivee(brut);
  try {
    const adresses = await lookup(brut, { all: true });
    return adresses.length > 0 && adresses.every(a => !ipPrivee(a.address));
  } catch {
    return false;
  }
}

/** webcal:// → https:// puis vérifie l'hôte. Renvoie l'URL à télécharger, ou null si refusée. */
export async function urlCalendrierSure(brut: string): Promise<string | null> {
  try {
    const url = new URL(brut.trim().replace(/^webcal:\/\//i, "https://"));
    return (await hoteAutorise(url)) ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * fetch qui revérifie l'hôte à CHAQUE redirection (un hôte public peut rediriger vers une
 * adresse interne). Lève une erreur si l'hôte est refusé ou si les redirections sont trop nombreuses.
 */
export async function fetchSur(brut: string, init: RequestInit = {}, maxRedirections = 3): Promise<Response> {
  let courante = new URL(brut.trim().replace(/^webcal:\/\//i, "https://"));
  for (let saut = 0; saut <= maxRedirections; saut++) {
    if (!(await hoteAutorise(courante))) throw new Error("URL refusée (adresse non publique)");
    const res = await fetch(courante.toString(), { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const suite = res.headers.get("location");
      if (!suite) throw new Error("Redirection invalide");
      courante = new URL(suite, courante);
      continue;
    }
    return res;
  }
  throw new Error("Trop de redirections");
}
