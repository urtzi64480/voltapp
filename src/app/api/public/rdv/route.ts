// src/app/api/public/rdv/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parisDateTime, parisYMD } from "@/lib/ics";
import { listerCalendriers, chargerEvenements } from "@/lib/calendriers-publics";
import { discoverCalendarUrl, createCalDAVEvent } from "@/lib/caldav";
import { isRateLimited, recordAttempt, getClientIp, isTooFast } from "@/lib/rate-limit";

const MATIN_START = 8, MATIN_END = 12;
const APREM_START = 13, APREM_END = 17;
const CALENDRIER_ECRITURE = "Personnel";
const CALENDRIER_EXCLU = "Ninou";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_JOURS_A_L_AVANCE = 60; // même fenêtre que /api/public/disponibilites
// Bornes des champs saisis par le visiteur (formulaire public)
const MAX_NOM = 200, MAX_TEL = 40, MAX_EMAIL = 200, MAX_ADRESSE = 300, MAX_DESCRIPTION = 2000, MAX_PHOTOS = 10;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  const { userId, date, periode, nom, telephone, email, adresse, description, photos, honeypot, loadedAt } = body as {
    userId?: string; date?: string; periode?: "matin" | "aprem";
    nom?: string; telephone?: string; email?: string; adresse?: string; description?: string;
    photos?: string[]; honeypot?: string; loadedAt?: number;
  };

  if (!userId || !date || !periode || !nom?.trim() || !telephone?.trim()) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }
  if (typeof userId !== "string" || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  for (const v of [nom, telephone, email, adresse, description]) {
    if (v !== undefined && v !== null && typeof v !== "string") {
      return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
    }
  }
  if (nom.trim().length > MAX_NOM || telephone.trim().length > MAX_TEL || (email?.length ?? 0) > MAX_EMAIL
    || (adresse?.length ?? 0) > MAX_ADRESSE || (description?.length ?? 0) > MAX_DESCRIPTION) {
    return NextResponse.json({ error: "Un des champs est trop long." }, { status: 400 });
  }
  if (photos !== undefined && (!Array.isArray(photos) || photos.length > MAX_PHOTOS || photos.some(p => typeof p !== "string" || p.length > 2000))) {
    return NextResponse.json({ error: "Photos invalides." }, { status: 400 });
  }
  if (periode !== "matin" && periode !== "aprem") {
    return NextResponse.json({ error: "Période invalide." }, { status: 400 });
  }
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NextResponse.json({ error: "Date invalide." }, { status: 400 });
  const [, ys, ms, ds] = m;
  const y = +ys, mo = +ms, d = +ds;

  // Date calendaire réelle (refuse le 31 février, que Date.UTC « corrigerait » en mars)
  const civile = new Date(Date.UTC(y, mo - 1, d));
  if (civile.getUTCFullYear() !== y || civile.getUTCMonth() !== mo - 1 || civile.getUTCDate() !== d) {
    return NextResponse.json({ error: "Date invalide." }, { status: 400 });
  }
  // Fenêtre réservable : de demain à +60 jours, calendrier de Paris (comme les disponibilités affichées)
  const auj = parisYMD();
  const jourMs = Date.UTC(y, mo - 1, d);
  if (jourMs < Date.UTC(auj.y, auj.m - 1, auj.d + 1) || jourMs > Date.UTC(auj.y, auj.m - 1, auj.d + MAX_JOURS_A_L_AVANCE)) {
    return NextResponse.json({ error: "Cette date n'est pas réservable." }, { status: 400 });
  }
  const dow = civile.getUTCDay();
  if (dow === 0 || dow === 6) {
    return NextResponse.json({ error: "Les rendez-vous en ligne ne sont disponibles que du lundi au vendredi." }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ── Protection anti-flood — avant tout traitement coûteux (fetch ICS, écriture CalDAV) ──
  // Piège à bots : si le champ caché est rempli, on fait semblant que tout s'est bien passé
  // sans rien enregistrer, pour ne pas indiquer au bot qu'il a été détecté.
  if (honeypot && honeypot.trim() !== "") {
    console.warn("RDV bloqué (honeypot) :", getClientIp(req));
    return NextResponse.json({ success: true });
  }
  // Soumission anormalement rapide après le chargement de la page : probable bot.
  if (isTooFast(loadedAt)) {
    console.warn("RDV bloqué (délai trop court) :", getClientIp(req));
    return NextResponse.json({ success: true });
  }
  const ip = getClientIp(req);
  const limited = await isRateLimited(supabase, ip, "rdv");
  if (limited) {
    return NextResponse.json(
      { error: "Trop de demandes de rendez-vous récemment. Merci de réessayer dans quelques minutes ou de nous appeler directement." },
      { status: 429 }
    );
  }
  // ── fin protection anti-flood ──

  const { data: token } = await supabase
    .from("apple_ics").select("calendars, ics_urls, apple_id, app_password").eq("user_id", userId).single();

  if (!token) {
    return NextResponse.json({ error: "Prise de rendez-vous non configurée." }, { status: 400 });
  }
  if (!token.apple_id || !token.app_password) {
    return NextResponse.json({ error: "Écriture calendrier non configurée. Contactez-nous par téléphone." }, { status: 400 });
  }

  const cals = listerCalendriers(token, CALENDRIER_EXCLU);

  const blockStart = parisDateTime(y, mo, d, periode === "matin" ? MATIN_START : APREM_START, 0);
  const blockEnd = parisDateTime(y, mo, d, periode === "matin" ? MATIN_END : APREM_END, 0);

  // Revérification anti-conflit (double réservation simultanée)
  const timeMin = parisDateTime(y, mo, d, 0, 0);
  const timeMax = parisDateTime(y, mo, d + 1, 0, 0);
  const { events: allEvents, echecs } = await chargerEvenements(cals, timeMin, timeMax);
  if (echecs > 0) {
    return NextResponse.json({ error: "Agenda momentanément indisponible, impossible de vérifier ce créneau. Réessayez dans un instant ou contactez-nous par téléphone." }, { status: 503 });
  }
  const conflit = allEvents.some(ev => {
    const evStart = new Date(ev.start).getTime();
    const evEnd = new Date(ev.end).getTime();
    return evStart < blockEnd.getTime() && evEnd > blockStart.getTime();
  });
  if (conflit) {
    // Créneau pris entre-temps : ce n'est pas un abus, ne pas consommer le quota.
    return NextResponse.json({ error: "Ce créneau vient d'être réservé. Merci d'en choisir un autre." }, { status: 409 });
  }

  // Écriture dans iCloud
  let caldavUrl: string;
  try {
    const calendarUrl = await discoverCalendarUrl(token.apple_id, token.app_password, CALENDRIER_ECRITURE);
    const descriptionLines = [
      `Tél: ${telephone.trim()}`,
      email?.trim() ? `Email: ${email.trim()}` : null,
      adresse?.trim() ? `Adresse: ${adresse.trim()}` : null,
      description?.trim() ? `Notes: ${description.trim()}` : null,
      photos?.length ? `Photos jointes : ${photos.length}` : null,
    ].filter(Boolean).join("\n");

    caldavUrl = await createCalDAVEvent({
      appleId: token.apple_id,
      appPassword: token.app_password,
      calendarUrl,
      summary: `RDV - ${nom.trim()}`,
      description: descriptionLines,
      start: blockStart,
      end: blockEnd,
    });
  } catch (e) {
    console.error("Erreur CalDAV:", e);
    // Échec technique : ne pas consommer le quota, pour permettre une nouvelle tentative.
    return NextResponse.json({ error: "Impossible d'écrire dans le calendrier. Contactez-nous par téléphone." }, { status: 500 });
  }

  // Enregistrement en base
  const { error: insErr } = await supabase.from("rdv").insert({
    user_id: userId,
    date,
    periode,
    nom: nom.trim(),
    telephone: telephone.trim(),
    email: email?.trim() || null,
    adresse: adresse?.trim() || null,
    description: description?.trim() || null,
    photos: photos ?? [],
    statut: "confirme",
    caldav_url: caldavUrl,
  });
  if (insErr) console.error("Erreur insertion rdv:", insErr);

  // Le RDV a réellement été écrit dans le calendrier à ce stade : on consomme le quota.
  await recordAttempt(supabase, ip, "rdv");

  return NextResponse.json({ success: true });
}
