import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

async function fetchCalDAV(username: string, password: string, url: string, method: string, body?: string) {
  const headers: Record<string, string> = {
    "Authorization": "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
    "Content-Type": "application/xml",
    "Depth": "1",
  };
  return fetch(url, { method, headers, body });
}

function extractTag(xml: string, tag: string): string | null {
  const cleaned = xml.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const start = cleaned.indexOf(`<${tag}>`);
  const startAlt = cleaned.indexOf(`<${tag} `);
  const pos = start !== -1 ? start : startAlt;
  if (pos === -1) return null;
  const hrefStart = cleaned.indexOf("<href>", pos);
  const hrefEnd = cleaned.indexOf("</href>", hrefStart);
  if (hrefStart === -1 || hrefEnd === -1) return null;
  return cleaned.slice(hrefStart + 6, hrefEnd).trim();
}

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
  );

  const { username, password } = await req.json();
  if (!username || !password) return NextResponse.json({ error: "Credentials manquants" }, { status: 400 });

  // Discover principal URL
  const principalRes = await fetchCalDAV(
    username, password,
    "https://caldav.icloud.com/.well-known/caldav",
    "PROPFIND",
    `<?xml version="1.0"?><propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>`
  );

  if (!principalRes.ok) {
    return NextResponse.json({ error: "Identifiants invalides ou accès refusé" }, { status: 401 });
  }

  const principalText = await principalRes.text();
  const principalHref = extractTag(principalText, "current-user-principal");
  if (!principalHref) return NextResponse.json({ error: "Principal introuvable" }, { status: 400 });

  const principalUrl = `https://caldav.icloud.com${principalHref}`;

  // Get calendar home
  const homeRes = await fetchCalDAV(
    username, password, principalUrl, "PROPFIND",
    `<?xml version="1.0"?><propfind xmlns="DAV:" xmlns:cd="urn:ietf:params:xml:ns:caldav"><prop><cd:calendar-home-set/></prop></propfind>`
  );
  const homeText = await homeRes.text();
  const homeHref = extractTag(homeText, "calendar-home-set");
  if (!homeHref) return NextResponse.json({ error: "Calendar home introuvable" }, { status: 400 });

  const calHomeUrl = `https://caldav.icloud.com${homeHref}`;

  // List calendars
  const calRes = await fetchCalDAV(
    username, password, calHomeUrl, "PROPFIND",
    `<?xml version="1.0"?><propfind xmlns="DAV:" xmlns:cd="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"><prop><displayname/><resourcetype/><cs:getctag/></prop></propfind>`
  );
  const calText = await calRes.text();

  // Parse calendars — split by response blocks without dotAll flag
  const calendars: { url: string; name: string }[] = [];
  const parts = calText.split("<response>");
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    if (!block.includes("calendar/>") && !block.includes("<calendar />")) continue;
    const hrefMatch = block.match(/<href>([^<]+)<\/href>/);
    const nameMatch = block.match(/<displayname>([^<]*)<\/displayname>/);
    if (hrefMatch && nameMatch && nameMatch[1]) {
      calendars.push({ url: hrefMatch[1], name: nameMatch[1] });
    }
  }

  return NextResponse.json({ calendars, calHomeUrl });
}
