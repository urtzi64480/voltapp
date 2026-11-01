// Envoi quotidien (Vercel Cron, voir vercel.json) du résumé du jour aux appareils abonnés. Une seule notification par appareil et par jour.
// Route publique mais sans effet de bord exploitable : elle n'envoie que le résumé du propriétaire à ses propres appareils, une fois par jour.
import { NextRequest, NextResponse } from "next/server";
import { admin, configurerWebPush } from "@/lib/push-serveur";
import { composerResume } from "@/lib/resume-quotidien";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const jourParis = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Interdit." }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "Serveur non configuré." }, { status: 503 });
  const db = admin();
  const aujourdhui = jourParis(new Date());
  const { data: abos, error } = await db.from("push_abonnements").select("id, user_id, endpoint, p256dh, auth, derniere_envoi");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { webpush } = configurerWebPush();

  const parUtilisateur = new Map<string, NonNullable<typeof abos>>();
  (abos ?? []).filter(a => a.derniere_envoi !== aujourdhui).forEach(a => parUtilisateur.set(a.user_id, [...(parUtilisateur.get(a.user_id) ?? []), a]));

  let envoyes = 0;
  for (const [userId, appareils] of parUtilisateur) {
    const debut = new Date(`${aujourdhui}T00:00:00`); // minuit serveur (UTC) : marge d'un jour compensée ci-dessous
    const bornes = [new Date(debut.getTime() - 2 * 3600e3).toISOString(), new Date(debut.getTime() + 26 * 3600e3).toISOString()];
    const [{ data: inter }, { data: pay }, { data: ret }] = await Promise.all([
      db.from("interventions").select("titre, date_debut, statut").eq("user_id", userId).gte("date_debut", bornes[0]).lt("date_debut", bornes[1]).neq("statut", "annule").order("date_debut"),
      db.from("factures").select("numero, total_ttc").eq("user_id", userId).eq("statut", "payee").gte("paye_le", new Date(Date.now() - 24 * 3600e3).toISOString()),
      db.from("factures").select("id").eq("user_id", userId).in("statut", ["envoyee", "relance", "impayee"]).lt("date_echeance", aujourdhui),
    ]);
    const resume = composerResume({
      interventions: (inter ?? []).filter(i => jourParis(new Date(i.date_debut)) === aujourdhui),
      payees: pay ?? [], enRetard: ret?.length ?? 0, rappelSauvegarde: aujourdhui.endsWith("-01"),
    });
    for (const a of appareils) {
      if (resume) {
        try {
          await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, JSON.stringify(resume));
          envoyes++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) { await db.from("push_abonnements").delete().eq("id", a.id); continue; }
        }
      }
      await db.from("push_abonnements").update({ derniere_envoi: aujourdhui }).eq("id", a.id);
    }
  }
  return NextResponse.json({ ok: true, envoyes });
}
