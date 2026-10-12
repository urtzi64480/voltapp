// Lecture des calendriers ICS d'un utilisateur pour les routes publiques (disponibilités, RDV).
// Factorisé pour que les deux routes appliquent exactement les mêmes règles :
// - repli sur l'ancienne colonne `ics_urls` quand `calendars` est vide (comme /api/apple/ics) ;
// - calendrier exclu (agenda personnel d'un proche) ignoré ;
// - lecture protégée contre le SSRF ;
// - un calendrier illisible est SIGNALÉ (sinon ses événements disparaissent et des créneaux
//   occupés sont proposés comme libres).
import { parseICS, ICSEvent } from "@/lib/ics";
import { fetchSur } from "@/lib/ssrf";

export type CalendrierSource = { url: string; nom?: string };

export function listerCalendriers(
  token: { calendars?: string | null; ics_urls?: string | null },
  nomExclu: string
): CalendrierSource[] {
  let cals: CalendrierSource[] = [];
  try { cals = JSON.parse(token.calendars ?? "[]"); } catch { cals = []; }
  if (!Array.isArray(cals)) cals = [];
  if (cals.length === 0) {
    try {
      const urls = JSON.parse(token.ics_urls ?? "[]");
      if (Array.isArray(urls)) cals = urls.filter((u): u is string => typeof u === "string").map(u => ({ url: u }));
    } catch { /* aucune URL exploitable */ }
  }
  return cals.filter(c => c && typeof c.url === "string" && c.url.trim() !== "" &&
    c.nom?.trim().toLowerCase() !== nomExclu.toLowerCase());
}

export async function chargerEvenements(
  cals: CalendrierSource[], timeMin: Date, timeMax: Date
): Promise<{ events: ICSEvent[]; echecs: number }> {
  const events: ICSEvent[] = [];
  let echecs = 0;
  await Promise.all(cals.map(async (cal) => {
    try {
      const res = await fetchSur(cal.url, { headers: { Accept: "text/calendar" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) { echecs++; return; }
      events.push(...parseICS(await res.text(), timeMin, timeMax, cal.url));
    } catch { echecs++; }
  }));
  return { events, echecs };
}
