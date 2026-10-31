import { describe, expect, it } from "vitest";
import { parisDateTime, parisYMD, parseICS, parseICSDate } from "@/lib/ics";

describe("fuseau Europe/Paris (heure d'été / d'hiver)", () => {
  it("parisDateTime : 8 h Paris = 7 h UTC en hiver, 6 h UTC en été", () => {
    expect(parisDateTime(2026, 1, 15, 8, 0).toISOString()).toBe("2026-01-15T07:00:00.000Z");
    expect(parisDateTime(2026, 7, 15, 8, 0).toISOString()).toBe("2026-07-15T06:00:00.000Z");
  });
  it("changement d'heure d'automne (25 oct. 2026) : le jour même, 8 h = 7 h UTC", () => {
    expect(parisDateTime(2026, 10, 24, 8, 0).toISOString()).toBe("2026-10-24T06:00:00.000Z");
    expect(parisDateTime(2026, 10, 26, 8, 0).toISOString()).toBe("2026-10-26T07:00:00.000Z");
  });
  it("parisYMD : la date vue de Paris, pas d'UTC", () => {
    expect(parisYMD(new Date("2026-12-31T23:30:00Z"))).toEqual({ y: 2027, m: 1, d: 1 });
    expect(parisYMD(new Date("2026-06-30T21:59:00Z"))).toEqual({ y: 2026, m: 6, d: 30 });
  });
});

describe("parseICSDate", () => {
  it("UTC (Z), flottante (Paris), TZID, journée entière", () => {
    expect(parseICSDate("20260715T080000Z").toISOString()).toBe("2026-07-15T08:00:00.000Z");
    expect(parseICSDate("20260715T080000").toISOString()).toBe("2026-07-15T06:00:00.000Z");
    expect(parseICSDate("20260715T080000", "America/New_York").toISOString()).toBe("2026-07-15T12:00:00.000Z");
    expect(parseICSDate("20260715").toISOString()).toBe("2026-07-14T22:00:00.000Z");
  });
  it("fuseau inconnu → repli sur Paris ; texte illisible → Date invalide", () => {
    expect(parseICSDate("20260715T080000", "Mars/Olympus").toISOString()).toBe("2026-07-15T06:00:00.000Z");
    expect(Number.isNaN(parseICSDate("n'importe quoi").getTime())).toBe(true);
  });
});

const ics = (corps: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${corps}\r\nEND:VCALENDAR\r\n`;
const fenetre = [new Date("2026-07-01T00:00:00Z"), new Date("2026-07-31T23:59:59Z")] as const;

describe("parseICS", () => {
  it("événement simple dans la fenêtre", () => {
    const ev = parseICS(ics("BEGIN:VEVENT\r\nUID:a1\r\nSUMMARY:Chantier Dupont\r\nDTSTART:20260715T080000Z\r\nDTEND:20260715T100000Z\r\nEND:VEVENT"), ...fenetre, "cal1");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ title: "Chantier Dupont", start: "2026-07-15T08:00:00.000Z", end: "2026-07-15T10:00:00.000Z", allDay: false, calUrl: "cal1" });
  });
  it("événement hors fenêtre ignoré ; lignes repliées dépliées", () => {
    const hors = ics("BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Hors\r\nDTSTART:20260901T080000Z\r\nDTEND:20260901T090000Z\r\nEND:VEVENT");
    expect(parseICS(hors, ...fenetre, "c")).toEqual([]);
    const replie = ics("BEGIN:VEVENT\r\nUID:c\r\nSUMMARY:Titre très\r\n  long\r\nDTSTART:20260715T080000Z\r\nDTEND:20260715T090000Z\r\nEND:VEVENT");
    expect(parseICS(replie, ...fenetre, "c")[0].title).toBe("Titre très long");
  });
  it("journée entière", () => {
    const ev = parseICS(ics("BEGIN:VEVENT\r\nUID:d\r\nSUMMARY:Congé\r\nDTSTART;VALUE=DATE:20260715\r\nDTEND;VALUE=DATE:20260716\r\nEND:VEVENT"), ...fenetre, "c");
    expect(ev[0].allDay).toBe(true);
  });
  it("récurrence quotidienne avec COUNT : 3 occurrences", () => {
    const ev = parseICS(ics("BEGIN:VEVENT\r\nUID:e\r\nSUMMARY:Daily\r\nDTSTART:20260710T080000Z\r\nDTEND:20260710T090000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT"), ...fenetre, "c");
    expect(ev.map(e => e.start.slice(0, 10))).toEqual(["2026-07-10", "2026-07-11", "2026-07-12"]);
  });
  it("entrée vide ou sans événement → []", () => {
    expect(parseICS("", ...fenetre, "c")).toEqual([]);
    expect(parseICS(ics(""), ...fenetre, "c")).toEqual([]);
  });
});
