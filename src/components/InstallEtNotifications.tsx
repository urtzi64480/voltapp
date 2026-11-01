"use client";
// Installation de l'application sur l'écran d'accueil + notifications du matin (interventions du jour, factures payées / en retard).
import { useEffect, useState } from "react";
import { BellRing, Download, Smartphone, DatabaseBackup } from "lucide-react";
import Link from "next/link";
import { lireStockage } from "@/lib/safe-storage";
import { CLE_DERNIERE_SAUVEGARDE, joursDepuis } from "@/lib/restauration";

interface EvenementInstall extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const b64vers8 = (b64: string): Uint8Array => {
  const base = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};

export default function InstallEtNotifications() {
  const [installable, setInstallable] = useState<EvenementInstall | null>(null);
  const [installee, setInstallee] = useState(false);
  const [ios, setIos] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "indisponible">("indisponible");
  const [actif, setActif] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [joursSauvegarde, setJoursSauvegarde] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    setJoursSauvegarde(joursDepuis(lireStockage("local", CLE_DERNIERE_SAUVEGARDE)));
    setInstallee(window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent));
    if ("Notification" in window && "serviceWorker" in navigator && "PushManager" in window) {
      setPermission(Notification.permission);
      navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(s => setActif(!!s)).catch(() => {});
    }
    const avant = (e: Event) => { e.preventDefault(); setInstallable(e as EvenementInstall); };
    const apres = () => { setInstallee(true); setInstallable(null); };
    window.addEventListener("beforeinstallprompt", avant); window.addEventListener("appinstalled", apres);
    return () => { window.removeEventListener("beforeinstallprompt", avant); window.removeEventListener("appinstalled", apres); };
  }, []);

  async function activer() {
    setOccupe(true); setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") { setMsg("Notifications refusées : autorise-les dans les réglages du navigateur."); return; }
      const rc = await fetch("/api/push/cle");
      const { publicKey } = await rc.json() as { publicKey?: string };
      if (!rc.ok || !publicKey) { setMsg("Notifications indisponibles sur le serveur."); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64vers8(publicKey) as unknown as BufferSource });
      const r = await fetch("/api/push/abonner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      const d = await r.json().catch(() => ({})) as { error?: string; tableAbsente?: boolean };
      if (!r.ok) { setMsg(d.tableAbsente ? "Il manque une table dans Supabase (migration 015) : voir le message de Claude." : (d.error ?? "Enregistrement impossible.")); return; }
      setActif(true); setMsg("Notifications activées : résumé chaque matin vers 7 h-8 h.");
    } catch (e) { setMsg(`Activation impossible : ${e instanceof Error ? e.message : "erreur"}`); } finally { setOccupe(false); }
  }

  async function desactiver() {
    setOccupe(true);
    try {
      const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
      if (sub) { await fetch("/api/push/abonner", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
      setActif(false); setMsg("Notifications désactivées sur cet appareil.");
    } catch { setMsg("Désactivation impossible."); } finally { setOccupe(false); }
  }

  const sauvegardeAFaire = joursSauvegarde === null || (typeof joursSauvegarde === "number" && joursSauvegarde >= 30);
  return (
    <>
    {sauvegardeAFaire && (
      <div className="card card-inner mb-6 border-amber-300 bg-amber-50 flex items-center gap-3 text-sm text-amber-900" role="status">
        <DatabaseBackup size={18} className="shrink-0" />
        <span className="flex-1">{joursSauvegarde === null ? "Aucune sauvegarde faite sur cet appareil." : `Dernière sauvegarde il y a ${joursSauvegarde} jours.`} Pense à sauvegarder tes données une fois par mois.</span>
        <Link href="/sauvegarde" className="btn-ghost !py-1.5 !text-xs shrink-0">Sauvegarder</Link>
      </div>
    )}
    <div className="card card-inner mb-6">
      <h2 className="font-semibold text-ink-800 mb-3 flex items-center gap-2"><Smartphone size={17} className="text-volt-600" /> Application et notifications</h2>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {installee ? <span className="text-emerald-700">Application installée ✓</span>
          : installable ? <button type="button" className="btn-volt" onClick={() => void installable.prompt()}><Download size={14} /> Installer l&apos;application</button>
          : <span className="text-ink-500">{ios ? "Pour installer : bouton Partager de Safari → « Sur l'écran d'accueil »." : "Installation : menu du navigateur → « Installer l'application »."}</span>}
        {permission === "indisponible" ? <span className="text-ink-400">Notifications indisponibles sur ce navigateur{ios && !installee ? " (installe d'abord l'application sur l'écran d'accueil)" : ""}.</span>
          : actif ? <button type="button" className="btn-ghost" disabled={occupe} onClick={() => void desactiver()}><BellRing size={14} /> Désactiver les notifications</button>
          : <button type="button" className="btn-ghost" disabled={occupe} onClick={() => void activer()}><BellRing size={14} /> {occupe ? "…" : "Activer les notifications"}</button>}
      </div>
      {msg && <p className="text-xs text-ink-600 mt-2" role="status">{msg}</p>}
      <p className="text-[11px] text-ink-400 mt-2">Chaque matin : interventions du jour, factures payées depuis la veille et factures en retard (rien n&apos;est envoyé s&apos;il n&apos;y a rien à signaler).</p>
    </div>
    </>
  );
}
