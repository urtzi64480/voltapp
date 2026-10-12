// src/lib/ics.ts
// Logique de parsing ICS partagée (lecture seule) — utilisée par /api/apple/ics et
// /api/google/ics (planning privé), /api/public/disponibilites et /api/public/rdv
// (page RDV publique).
//
// Particularités gérées :
//  - lignes « pliées » (RFC 5545 §3.1), paramètres de propriété (SUMMARY;LANGUAGE=fr:…),
//    échappements de texte (\, \; \n) ;
//  - heures UTC (Z), heures locales avec TZID (Europe/Paris par défaut si absent ou inconnu) ;
//  - événements « journée entière » = minuit → minuit, heure de Paris (jamais décalés d'un jour,
//    quel que soit le fuseau du serveur) ;
//  - événements récurrents (RRULE FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, COUNT, UNTIL,
//    BYDAY, BYMONTHDAY, BYMONTH, EXDATE, RECURRENCE-ID). Une règle non gérée retombe sur
//    l'occurrence de base seule (comportement historique) ;
//  - événements annulés (STATUS:CANCELLED) ignorés.

export type ICSEvent = {
  id: string;
  title: string;
  start: string; // ISO
  end: string;   // ISO
  allDay: boolean;
  calUrl: string;
};

const TZ_DEFAUT = "Europe/Paris";
const DAY_MS = 86_400_000;
const MAX_ITERATIONS = 20000; // ~55 ans de série quotidienne ; chaque itération hors fenêtre est très bon marché

// ── Fuseaux horaires ────────────────────────────────────────────────────────

const formatteurs = new Map<string, Intl.DateTimeFormat | null>();

function formatteur(tz: string): Intl.DateTimeFormat | null {
  if (formatteurs.has(tz)) return formatteurs.get(tz)!;
  let f: Intl.DateTimeFormat | null = null;
  try {
    // hourCycle h23 : `hour12: false` renvoie « 24 » à minuit avec certaines versions d'ICU,
    // ce qui décalait tous les calculs d'un jour.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    f = null; // TZID inconnu (ex. noms Windows) → l'appelant retombe sur Europe/Paris
  }
  formatteurs.set(tz, f);
  return f;
}

function fuseauValide(tz?: string | null): string {
  const t = (tz ?? "").trim().replace(/^"|"$/g, "");
  if (!t) return TZ_DEFAUT;
  if (t.toUpperCase() === "UTC" || t.toUpperCase() === "GMT") return "UTC";
  return formatteur(t) ? t : TZ_DEFAUT;
}

type Parties = { y: number; m: number; d: number; h: number; mi: number; s: number };

function partiesDans(instantMs: number, tz: string): Parties {
  const f = formatteur(tz) ?? formatteur(TZ_DEFAUT)!;
  const p = f.formatToParts(new Date(instantMs));
  const get = (t: string) => Number(p.find(x => x.type === t)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

function decalageMs(instantMs: number, tz: string): number {
  const p = partiesDans(instantMs, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(instantMs / 1000) * 1000;
}

/** Instant UTC correspondant à une heure « murale » dans le fuseau donné. */
function muralVersUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date {
  if (tz === "UTC") return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const devine = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = decalageMs(devine, tz);
  let t = devine - off1;
  const off2 = decalageMs(t, tz); // 2e passe : autour d'un changement d'heure
  if (off2 !== off1) t = devine - off2;
  return new Date(t);
}

// Construit une Date UTC correspondant à une heure locale Europe/Paris donnée
// (ex: 8h00 le 2026-09-01 à Paris, quel que soit l'horaire été/hiver).
export function parisDateTime(year: number, month: number, day: number, hour: number, minute: number): Date {
  return muralVersUtc(year, month, day, hour, minute, 0, TZ_DEFAUT);
}

/** Année / mois / jour d'un instant, vus depuis Paris (indépendant du fuseau du serveur). */
export function parisYMD(instant: Date = new Date()): { y: number; m: number; d: number } {
  const p = partiesDans(instant.getTime(), TZ_DEFAUT);
  return { y: p.y, m: p.m, d: p.d };
}

// ── Dates ICS ───────────────────────────────────────────────────────────────

export function parseICSDate(val: string, tzid?: string): Date {
  const v = val.trim();
  // Journée entière : date seule → minuit heure de Paris
  if (/^\d{8}$/.test(v)) {
    return parisDateTime(+v.slice(0, 4), +v.slice(4, 6), +v.slice(6, 8), 0, 0);
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i);
  if (!m) return new Date(NaN);
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? "0")));
  return muralVersUtc(+y, +mo, +d, +h, +mi, +(s ?? "0"), fuseauValide(tzid));
}

// ── Lecture des propriétés ──────────────────────────────────────────────────

function deplier(texte: string): string {
  return texte.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
}

function lire(bloc: string, nom: string): { params: string; valeur: string } | null {
  const m = bloc.match(new RegExp(`^${nom}((?:;[^:\\n]*)?):(.*)$`, "m"));
  return m ? { params: m[1], valeur: m[2].trim() } : null;
}

function lireTout(bloc: string, nom: string): { params: string; valeur: string }[] {
  const re = new RegExp(`^${nom}((?:;[^:\\n]*)?):(.*)$`, "gm");
  const out: { params: string; valeur: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(bloc))) out.push({ params: m[1], valeur: m[2].trim() });
  return out;
}

function tzidDe(params: string): string | undefined {
  return params.match(/;TZID=([^;:]+)/i)?.[1];
}

function texte(valeur: string | undefined, defaut: string): string {
  if (!valeur) return defaut;
  const t = valeur.replace(/\\[nN]/g, " ").replace(/\\([,;\\])/g, "$1").trim();
  return t || defaut;
}

function dureeMs(valeur: string): number | null {
  const m = valeur.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const n = (x?: string) => Number(x ?? 0);
  const ms = ((n(m[2]) * 7 + n(m[3])) * 86400 + n(m[4]) * 3600 + n(m[5]) * 60 + n(m[6])) * 1000;
  return m[1] === "-" ? -ms : ms;
}

// ── Récurrence ──────────────────────────────────────────────────────────────

type Regle = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: string | null;
  byDay: { n: number | null; wd: number }[]; // wd : 0 = lundi … 6 = dimanche
  byMonthDay: number[];
  byMonth: number[];
};

const JOURS: Record<string, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };

function lireRegle(valeur: string): Regle | null {
  const kv: Record<string, string> = {};
  for (const part of valeur.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) kv[part.slice(0, i).trim().toUpperCase()] = part.slice(i + 1).trim();
  }
  // Parties non gérées : on renonce à l'expansion (occurrence de base seule)
  for (const k of ["BYSETPOS", "BYWEEKNO", "BYYEARDAY", "BYHOUR", "BYMINUTE", "BYSECOND"]) if (kv[k]) return null;
  const freq = kv.FREQ as Regle["freq"];
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;

  const byDay: Regle["byDay"] = [];
  if (kv.BYDAY) {
    for (const t of kv.BYDAY.split(",")) {
      const m = t.trim().toUpperCase().match(/^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/);
      if (!m) return null;
      byDay.push({ n: m[1] ? Number(m[1]) : null, wd: JOURS[m[2]] });
    }
  }
  const nums = (s?: string) => (s ? s.split(",").map(Number) : []);
  const regle: Regle = {
    freq,
    interval: Math.max(1, Number(kv.INTERVAL ?? "1") || 1),
    count: kv.COUNT ? Number(kv.COUNT) : null,
    until: kv.UNTIL ?? null,
    byDay,
    byMonthDay: nums(kv.BYMONTHDAY),
    byMonth: nums(kv.BYMONTH),
  };
  if (regle.byMonthDay.some(n => !Number.isInteger(n) || n === 0) || regle.byMonth.some(n => !Number.isInteger(n))) return null;
  if (freq === "WEEKLY" && byDay.some(b => b.n !== null)) return null;
  if (freq === "MONTHLY" && byDay.length > 0 && byDay.some(b => b.n === null)) return null;
  if (freq === "MONTHLY" && byDay.length > 0 && regle.byMonthDay.length > 0) return null;
  if (freq === "YEARLY" && (byDay.length > 0)) return null;
  if (freq === "DAILY" && byDay.length > 0) return null;
  return regle;
}

type Jour = { y: number; m: number; d: number };

const versJour = (ms: number): Jour => {
  const t = new Date(ms);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const jourMs = (j: Jour) => Date.UTC(j.y, j.m - 1, j.d);
const jourSemaine = (ms: number) => (new Date(ms).getUTCDay() + 6) % 7; // 0 = lundi
const joursDansMois = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** n-ième (1..5) ou dernier (-1, -2…) jour de semaine `wd` du mois, ou null s'il n'existe pas. */
function nieme(y: number, m: number, wd: number, n: number): number | null {
  const nb = joursDansMois(y, m);
  if (n > 0) {
    const premier = jourSemaine(Date.UTC(y, m - 1, 1));
    const jour = 1 + ((wd - premier + 7) % 7) + (n - 1) * 7;
    return jour <= nb ? jour : null;
  }
  const dernier = jourSemaine(Date.UTC(y, m - 1, nb));
  const jour = nb - ((dernier - wd + 7) % 7) + (n + 1) * 7;
  return jour >= 1 ? jour : null;
}

/** Jours candidats (ordre croissant) d'une règle, à partir du jour de base. */
function* jours(regle: Regle, base: Jour): Generator<Jour> {
  const baseMs = jourMs(base);
  for (let k = 0; k < MAX_ITERATIONS; k++) {
    if (regle.freq === "DAILY") {
      yield versJour(baseMs + k * regle.interval * DAY_MS);
    } else if (regle.freq === "WEEKLY") {
      const debutSemaine = baseMs - jourSemaine(baseMs) * DAY_MS + k * regle.interval * 7 * DAY_MS;
      const wds = regle.byDay.length ? regle.byDay.map(b => b.wd).sort((a, b) => a - b) : [jourSemaine(baseMs)];
      for (const wd of wds) {
        const ms = debutSemaine + wd * DAY_MS;
        if (ms >= baseMs) yield versJour(ms);
      }
    } else if (regle.freq === "MONTHLY") {
      const idx = base.m - 1 + k * regle.interval;
      const y = base.y + Math.floor(idx / 12);
      const m = (idx % 12) + 1;
      const nb = joursDansMois(y, m);
      let liste: number[] = [];
      if (regle.byDay.length) {
        liste = regle.byDay.map(b => nieme(y, m, b.wd, b.n as number)).filter((x): x is number => x !== null);
      } else if (regle.byMonthDay.length) {
        liste = regle.byMonthDay.map(n => (n > 0 ? n : nb + 1 + n)).filter(n => n >= 1 && n <= nb);
      } else if (base.d <= nb) {
        liste = [base.d];
      }
      for (const d of Array.from(new Set(liste)).sort((a, b) => a - b)) {
        const j = { y, m, d };
        if (jourMs(j) >= baseMs) yield j;
      }
    } else {
      const y = base.y + k * regle.interval;
      const mois = (regle.byMonth.length ? regle.byMonth : [base.m]).slice().sort((a, b) => a - b);
      for (const m of mois) {
        if (m < 1 || m > 12) continue;
        const nb = joursDansMois(y, m);
        const liste = regle.byMonthDay.length
          ? regle.byMonthDay.map(n => (n > 0 ? n : nb + 1 + n)).filter(n => n >= 1 && n <= nb)
          : base.d <= nb ? [base.d] : [];
        for (const d of Array.from(new Set(liste)).sort((a, b) => a - b)) {
          const j = { y, m, d };
          if (jourMs(j) >= baseMs) yield j;
        }
      }
    }
  }
}

// ── Parsing principal ───────────────────────────────────────────────────────

type Occurrence = { start: Date; end: Date };

export function parseICS(icsText: string, timeMin: Date, timeMax: Date, calUrl: string): ICSEvent[] {
  const texteDeplie = deplier(icsText);
  const blocs: string[] = [];
  const re = /BEGIN:VEVENT\n([\s\S]*?)\nEND:VEVENT/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texteDeplie))) blocs.push(m[1].replace(/BEGIN:VALARM[\s\S]*?END:VALARM/g, ""));

  type Brut = {
    uid: string; titre: string; allDay: boolean; start: Date; end: Date; tz: string;
    regle: Regle | null; exdates: number[]; recurrenceId: number | null; annule: boolean; index: number;
  };
  const evenements: Brut[] = [];

  blocs.forEach((bloc, index) => {
    const dtstart = lire(bloc, "DTSTART");
    if (!dtstart) return;
    const uid = lire(bloc, "UID")?.valeur || `ev-${index + 1}`;
    const allDay = /^\d{8}$/.test(dtstart.valeur);
    const tz = fuseauValide(tzidDe(dtstart.params));
    const start = parseICSDate(dtstart.valeur, tzidDe(dtstart.params));
    if (isNaN(start.getTime())) return;

    let end: Date;
    const dtend = lire(bloc, "DTEND");
    const duree = lire(bloc, "DURATION");
    if (dtend) {
      end = parseICSDate(dtend.valeur, tzidDe(dtend.params));
    } else if (duree && dureeMs(duree.valeur) !== null) {
      end = new Date(start.getTime() + (dureeMs(duree.valeur) as number));
    } else if (allDay) {
      // Journée entière sans DTEND : dure un jour (RFC 5545 §3.6.1)
      const j = versJour(Date.UTC(+dtstart.valeur.slice(0, 4), +dtstart.valeur.slice(4, 6) - 1, +dtstart.valeur.slice(6, 8)) + DAY_MS);
      end = parisDateTime(j.y, j.m, j.d, 0, 0);
    } else {
      end = start;
    }
    if (isNaN(end.getTime())) return;

    const rrule = lire(bloc, "RRULE");
    const exdates: number[] = [];
    for (const ex of lireTout(bloc, "EXDATE")) {
      for (const v of ex.valeur.split(",")) {
        const t = parseICSDate(v, tzidDe(ex.params) ?? tzidDe(dtstart.params)).getTime();
        if (!isNaN(t)) exdates.push(t);
      }
    }
    const rid = lire(bloc, "RECURRENCE-ID");
    const ridMs = rid ? parseICSDate(rid.valeur, tzidDe(rid.params) ?? tzidDe(dtstart.params)).getTime() : NaN;

    evenements.push({
      uid,
      titre: texte(lire(bloc, "SUMMARY")?.valeur, "(Sans titre)"),
      allDay, start, end, tz,
      regle: rrule ? lireRegle(rrule.valeur) : null,
      exdates,
      recurrenceId: rid && !isNaN(ridMs) ? ridMs : null,
      annule: /^CANCELLED$/i.test(lire(bloc, "STATUS")?.valeur ?? ""),
      index,
    });
  });

  // Instances remplacées par une exception (RECURRENCE-ID) : on ne les régénère pas.
  const remplacees = new Map<string, Set<number>>();
  for (const e of evenements) {
    if (e.recurrenceId === null) continue;
    if (!remplacees.has(e.uid)) remplacees.set(e.uid, new Set());
    remplacees.get(e.uid)!.add(e.recurrenceId);
  }

  const sortie: ICSEvent[] = [];
  const garde = (o: Occurrence) => o.end.getTime() >= timeMin.getTime() && o.start.getTime() <= timeMax.getTime();

  for (const e of evenements) {
    if (e.annule) continue;
    const dureeEv = e.end.getTime() - e.start.getTime();

    // Occurrences de l'événement
    let occurrences: Occurrence[];
    if (e.regle && e.recurrenceId === null) {
      occurrences = [];
      const pb = partiesDans(e.start.getTime(), e.allDay ? TZ_DEFAUT : e.tz);
      const base: Jour = { y: pb.y, m: pb.m, d: pb.d };
      const tzOcc = e.allDay ? TZ_DEFAUT : e.tz;
      const h = e.allDay ? 0 : pb.h, mi = e.allDay ? 0 : pb.mi, s = e.allDay ? 0 : pb.s;
      const finMs = e.regle.until
        ? (/^\d{8}$/.test(e.regle.until)
            ? parisDateTime(+e.regle.until.slice(0, 4), +e.regle.until.slice(4, 6), +e.regle.until.slice(6, 8), 23, 59).getTime()
            : parseICSDate(e.regle.until, e.tz).getTime())
        : Infinity;
      const ex = new Set(e.exdates);
      const rempl = remplacees.get(e.uid);
      let nb = 0;
      for (const j of jours(e.regle, base)) {
        // Estimation grossière (±2 jours) pour éviter des conversions de fuseau coûteuses sur les
        // occurrences très éloignées de la fenêtre (série ancienne) — on les compte seulement (COUNT).
        const approx = jourMs(j);
        if (approx - 2 * DAY_MS > finMs || approx - 2 * DAY_MS > timeMax.getTime()) break;
        nb++;
        if (e.regle.count !== null && nb > e.regle.count) break;
        if (approx + 2 * DAY_MS + dureeEv < timeMin.getTime()) continue;
        const debut = muralVersUtc(j.y, j.m, j.d, h, mi, s, tzOcc);
        if (debut.getTime() > finMs || debut.getTime() > timeMax.getTime()) break;
        const t = debut.getTime();
        if (ex.has(t) || rempl?.has(t)) continue;
        const occ = { start: debut, end: new Date(t + dureeEv) };
        if (garde(occ)) occurrences.push(occ);
      }
    } else {
      const occ = { start: e.start, end: e.end };
      occurrences = garde(occ) ? [occ] : [];
    }

    const recurrent = !!e.regle && e.recurrenceId === null;
    for (const occ of occurrences) {
      sortie.push({
        id: recurrent ? `${e.uid}@${occ.start.toISOString()}` : e.uid,
        title: e.titre,
        start: occ.start.toISOString(),
        end: occ.end.toISOString(),
        allDay: e.allDay,
        calUrl,
      });
    }
  }
  return sortie;
}
