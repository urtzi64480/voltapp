import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// UUID Elektron — même exception que demande/page.tsx (hardcodé volontairement).
const USER_ID = "d506c94e-40c7-4bcd-a48c-97e86f4ea7c0";

// Ancienne URL Vercel affichée sur les cartes de visite imprimées — à rediriger en permanence.
const OLD_VERCEL_HOST = "voltapp-ten.vercel.app";
const NEW_DOMAIN = "elektron-electricite.fr";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = request.headers.get("host") || "";

  // ── 1. Ancien host Vercel → nouveau domaine, chemin et paramètres conservés (301). ──
  //    DOIT être vérifié avant le routage de la racine "/", sinon une visite sur
  //    l'ancien host atterrit sur /demande en gardant l'ancien hostname, sans jamais
  //    être redirigée vers le nouveau domaine.
  if (hostname === OLD_VERCEL_HOST) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.hostname = NEW_DOMAIN;
    url.port = "";
    return NextResponse.redirect(url, 301);
  }

  // ── 2. Racine du site (sur le nouveau domaine) = page publique de demande client. ──
  if (pathname === "/") {
    return NextResponse.redirect(new URL(`/demande/${USER_ID}`, request.url));
  }

  // ── 3. Routes publiques — pas d'auth requise ──
  if (pathname.startsWith("/login") || pathname.startsWith("/demande")) {
    return NextResponse.next();
  }

  // ── 4. Tout le reste nécessite une session ──
  const response = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|apple-touch-icon.png).*)",],
};
