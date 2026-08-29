// src/lib/caldav.ts
// Client CalDAV minimal pour iCloud — utilisé uniquement côté serveur
// (jamais exposé au client, credentials sensibles).

const CALDAV_ROOT = "https://caldav.icloud.com";

function authHeader(appleId: string, appPassword: string) {
  const basic = Buffer.from(`${appleId}:${appPassword}`).toString("base64");
  return `Basic ${basic}`;
}

async function propfind(url: string, body: string, depth: string, appleId: string, appPassword: string): Promise<string> {
  const res = await fetch(url, {
    method: "PROPFIND",
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Depth": depth,
      "Authorization": authHeader(appleId, appPassword),
    },
    body,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Identifiants iCloud invalides (Apple ID ou mot de passe d'application incorrect).");
  }
  if (!res.ok && res.status !== 207) {
    throw new Error(`Erreur de connexion iCloud (${res.status}).`);
  }
  return res.text();
}

function extractHref(xml: string, tag: string): string | null {
  const re = new RegExp(`<[^:>]*:?${tag}[^>]*>[\\s\\S]*?<[^:>]*:?href[^>]*>([^<]+)</[^:>]*:?href>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function resolveUrl(href: string): string {
  return href.startsWith("http") ? href : `${CALDAV_ROOT}${href}`;
}

// Trouve l'URL de la collection CalDAV correspondant au nom d'un calendrier iCloud
// (ex: "Personnel"). Nécessaire uniquement pour l'écriture — la lecture passe
// par les flux ICS publics existants.
export async function discoverCalendarUrl(appleId: string, appPassword: string, calendarName: string): Promise<string> {
  // 1. Principal
  const principalBody = `<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:">
  <prop><current-user-principal/></prop>
</propfind>`;
  const rootXml = await propfind(`${CALDAV_ROOT}/`, principalBody, "0", appleId, appPassword);
  const principalHref = extractHref(rootXml, "current-user-principal");
  if (!principalHref) throw new Error("Impossible de trouver le compte iCloud (identifiants invalides ?).");
  const principalUrl = resolveUrl(principalHref);

  // 2. Calendar home set
  const homeBody = `<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <prop><c:calendar-home-set/></prop>
</propfind>`;
  const principalXml = await propfind(principalUrl, homeBody, "0", appleId, appPassword);
  const homeHref = extractHref(principalXml, "calendar-home-set");
  if (!homeHref) throw new Error("Impossible de trouver les calendriers iCloud.");
  const homeUrl = resolveUrl(homeHref);

  // 3. Liste des calendriers, on cherche celui qui correspond au nom demandé
  const listBody = `<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:">
  <prop><displayname/><resourcetype/></prop>
</propfind>`;
  const homeXml = await propfind(homeUrl, listBody, "1", appleId, appPassword);
  const responses = homeXml.split(/<[^:>]*:?response[^>]*>/i).slice(1);
  for (const block of responses) {
    const hrefMatch = block.match(/<[^:>]*:?href[^>]*>([^<]+)<\/[^:>]*:?href>/i);
    const nameMatch = block.match(/<[^:>]*:?displayname[^>]*>([^<]*)<\/[^:>]*:?displayname>/i);
    if (hrefMatch && nameMatch && nameMatch[1].trim().toLowerCase() === calendarName.trim().toLowerCase()) {
      return resolveUrl(hrefMatch[1].trim());
    }
  }
  throw new Error(`Calendrier "${calendarName}" introuvable dans iCloud.`);
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function toICSUTC(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function buildICS(params: { uid: string; summary: string; description?: string; start: Date; end: Date }): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const partsFor = (d: Date) => {
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? "0";
    return `${get("year")}${get("month")}${get("day")}T${get("hour").padStart(2,"0")}${get("minute")}${get("second")}`;
  };

  const dtstart = partsFor(params.start);
  const dtend = partsFor(params.end);
  const dtstamp = toICSUTC(new Date());

  const descLine = params.description
    ? `DESCRIPTION:${params.description.replace(/\\/g, "\\\\").replace(/\n/g, "\\n")}\r\n`
    : "";

  return (
    "BEGIN:VCALENDAR\r\n" +
    "VERSION:2.0\r\n" +
    "PRODID:-//VoltApp//Events//FR\r\n" +
    "BEGIN:VEVENT\r\n" +
    `UID:${params.uid}\r\n` +
    `DTSTAMP:${dtstamp}\r\n` +
    `DTSTART;TZID=Europe/Paris:${dtstart}\r\n` +
    `DTEND;TZID=Europe/Paris:${dtend}\r\n` +
    `SUMMARY:${params.summary}\r\n` +
    descLine +
    "END:VEVENT\r\n" +
    "END:VCALENDAR\r\n"
  );
}

// Crée un événement dans le calendrier iCloud donné. Retourne l'URL de
// l'événement créé (à conserver en base pour permettre modification/suppression).
export async function createCalDAVEvent(params: {
  appleId: string;
  appPassword: string;
  calendarUrl: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
}): Promise<string> {
  const uid = `voltapp-${Date.now()}-${Math.random().toString(36).slice(2)}@voltapp`;
  const ics = buildICS({ uid, summary: params.summary, description: params.description, start: params.start, end: params.end });

  const base = params.calendarUrl.endsWith("/") ? params.calendarUrl : `${params.calendarUrl}/`;
  const eventUrl = `${base}${uid}.ics`;

  const res = await fetch(eventUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Authorization": authHeader(params.appleId, params.appPassword),
    },
    body: ics,
  });

  if (!res.ok) {
    throw new Error(`Échec de l'écriture dans iCloud (${res.status}).`);
  }
  return eventUrl;
}

// Met à jour un événement existant (même UID/URL, nouveau contenu).
export async function updateCalDAVEvent(params: {
  appleId: string;
  appPassword: string;
  eventUrl: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
}): Promise<void> {
  // On extrait l'UID depuis l'URL (dernier segment sans .ics) pour garder le même UID
  const uid = params.eventUrl.split("/").pop()?.replace(/\.ics$/, "") ?? `voltapp-${Date.now()}@voltapp`;
  const ics = buildICS({ uid, summary: params.summary, description: params.description, start: params.start, end: params.end });

  const res = await fetch(params.eventUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Authorization": authHeader(params.appleId, params.appPassword),
    },
    body: ics,
  });

  if (!res.ok) {
    throw new Error(`Échec de la mise à jour dans iCloud (${res.status}).`);
  }
}

// Supprime un événement iCloud existant.
export async function deleteCalDAVEvent(params: {
  appleId: string;
  appPassword: string;
  eventUrl: string;
}): Promise<void> {
  const res = await fetch(params.eventUrl, {
    method: "DELETE",
    headers: { "Authorization": authHeader(params.appleId, params.appPassword) },
  });
  // 404 = déjà supprimé côté iCloud, on considère ça comme un succès (idempotent)
  if (!res.ok && res.status !== 404) {
    throw new Error(`Échec de la suppression dans iCloud (${res.status}).`);
  }
}
