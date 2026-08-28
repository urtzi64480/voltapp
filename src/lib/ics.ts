// src/lib/ics.ts
// Logique de parsing ICS partagée (lecture seule) — utilisée par /api/apple/ics
// (planning privé) et /api/public/disponibilites (page RDV publique).

export type ICSEvent = {
  id: string;
  title: string;
  start: string; // ISO
  end: string;   // ISO
  allDay: boolean;
  calUrl: string;
};

export function parseICSDate(val: string, tzid?: string): Date {
  // All-day event : date seule
  if (val.length === 8) {
    return new Date(`${val.slice(0,4)}-${val.slice(4,6)}-${val.slice(6,8)}T00:00:00`);
  }
  const y = val.slice(0,4), mo = val.slice(4,6), d = val.slice(6,8);
  const h = val.slice(9,11), mi = val.slice(11,13), s = val.slice(13,15);
  // UTC explicite
  if (val.endsWith("Z")) return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  // Heure locale (TZID présent ou absent) - on interprète comme Europe/Paris
  const localStr = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  const utcDate = new Date(localStr + "Z"); // parse as UTC first
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(utcDate);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "0";
  const parisDate = new Date(`${get("year")}-${get("month")}-${get("day")}T${get("hour").padStart(2,"0")}:${get("minute")}:${get("second")}Z`);
  const offsetMs = utcDate.getTime() - parisDate.getTime();
  return new Date(utcDate.getTime() + offsetMs);
}

export function parseICS(icsText: string, timeMin: Date, timeMax: Date, calUrl: string): ICSEvent[] {
  const events: ICSEvent[] = [];
  const blocks = icsText.split("BEGIN:VEVENT");
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const uid = block.match(/^UID:(.+)$/m)?.[1]?.trim() ?? `ev-${i}`;
    const summary = block.match(/^SUMMARY:(.+)$/m)?.[1]?.trim() ?? "(Sans titre)";
    const dtstart = block.match(/^DTSTART(?:;[^:]*)?:(.+)$/m)?.[1]?.trim();
    const dtend = block.match(/^DTEND(?:;[^:]*)?:(.+)$/m)?.[1]?.trim();
    const tzid = block.match(/^DTSTART;TZID=([^:]+):/m)?.[1]?.trim();
    if (!dtstart) continue;
    const allDay = dtstart.length === 8;
    const startDate = parseICSDate(dtstart, tzid);
    const endDate = dtend ? parseICSDate(dtend, tzid) : startDate;
    if (endDate < timeMin || startDate > timeMax) continue;
    events.push({ id: uid, title: summary, start: startDate.toISOString(), end: endDate.toISOString(), allDay, calUrl });
  }
  return events;
}

// Construit une Date UTC correspondant à une heure locale Europe/Paris donnée
// (ex: 8h00 le 2026-09-01 à Paris, quel que soit l'horaire été/hiver).
export function parisDateTime(year: number, month: number, day: number, hour: number, minute: number): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(utcGuess);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "0";
  const parisAsUtc = new Date(Date.UTC(+get("year"), +get("month") - 1, +get("day"), +get("hour"), +get("minute"), +get("second")));
  const offsetMs = utcGuess.getTime() - parisAsUtc.getTime();
  return new Date(utcGuess.getTime() + offsetMs);
}
