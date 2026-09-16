// src/app/api/public/demande/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isRateLimited, recordAttempt, getClientIp, isTooFast } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  const {
    userId, nom, telephone, email, adresse_chantier,
    type_travaux, description, disponibilites, photos,
    honeypot, loadedAt,
  } = body as {
    userId?: string; nom?: string; telephone?: string; email?: string;
    adresse_chantier?: string; type_travaux?: string[]; description?: string;
    disponibilites?: string; photos?: string[];
    honeypot?: string; loadedAt?: number;
  };

  if (!userId || !nom?.trim() || !telephone?.trim() || !adresse_chantier?.trim() || !type_travaux?.length) {
    return NextResponse.json({ error: "Champs requis manquants." }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Piège à bots : si le champ caché est rempli, on fait semblant que tout s'est bien passé
  // sans rien enregistrer, pour ne pas indiquer au bot qu'il a été détecté.
  if (honeypot && honeypot.trim() !== "") {
    console.warn("Demande devis bloquée (honeypot) :", getClientIp(req));
    return NextResponse.json({ success: true });
  }

  // Soumission anormalement rapide après le chargement de la page : probable bot.
  if (isTooFast(loadedAt)) {
    console.warn("Demande devis bloquée (délai trop court) :", getClientIp(req));
    return NextResponse.json({ success: true });
  }

  const ip = getClientIp(req);
  const limited = await isRateLimited(supabase, ip, "devis");
  if (limited) {
    return NextResponse.json(
      { error: "Trop de demandes envoyées récemment. Merci de réessayer dans quelques minutes ou de nous appeler directement." },
      { status: 429 }
    );
  }

  const { error: insErr } = await supabase.from("demandes_client").insert({
    user_id: userId,
    statut: "nouveau",
    nom: nom.trim(),
    telephone: telephone.trim(),
    email: email?.trim() || null,
    adresse_chantier: adresse_chantier.trim(),
    type_travaux,
    description: description?.trim() || null,
    photos: photos ?? [],
    disponibilites: disponibilites?.trim() || null,
  });

  if (insErr) {
    console.error("Erreur insertion demande:", insErr);
    // Pas de comptage sur le quota ici : un échec serveur ne doit pas pénaliser
    // un client qui retente sa demande.
    return NextResponse.json(
      { error: "Une erreur est survenue. Veuillez réessayer ou nous appeler directement." },
      { status: 500 }
    );
  }

  // Demande réellement enregistrée : on consomme le quota maintenant, pas avant.
  await recordAttempt(supabase, ip, "devis");

  return NextResponse.json({ success: true });
}
