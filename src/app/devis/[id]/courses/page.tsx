"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import Shell from "@/components/layout/Shell";
import LigneImage from "@/components/devis/LigneImage";
import Link from "next/link";
import { ArrowLeft, Check, ShoppingCart, RotateCcw, Share2, Link2, MessageSquare, Mail, Copy, FileDown, Store, Euro, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildCourseItems, buildCourseItemsParFournisseur, CourseItem } from "@/lib/courseItems";
import { facteurRemiseMateriau, tauxDepuisProfil, type TauxRentabilite } from "@/lib/rentabilite";
import { buildVuePrix, TVA_ACHAT_PCT } from "@/lib/courses-prix";
import { buildCourseText, genPDFListeCourses, courseFileName } from "@/lib/courseExport";

export default function ListeCoursesPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [loading, setLoading] = useState(true);
  const [devisInfo, setDevisInfo] = useState<{ numero: string; statut: string; objet?: string; client?: any; liste_courses_token?: string } | null>(null);
  const [items, setItems] = useState<CourseItem[]>([]);
  const [lignesBrutes, setLignesBrutes] = useState<any[]>([]);
  const [parFournisseur, setParFournisseur] = useState(false);
  // Pièces à acheter par offre fournisseur retenue sur les lignes (vue privée par fournisseur uniquement).
  const [piecesParOffre, setPiecesParOffre] = useState<Record<string, { nom: string; quantite: number; reference?: string | null }[]>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [textCopied, setTextCopied] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [canShare, setCanShare] = useState(false);
  // Vue privée « prix et marge » (vente annoncée, achat TTC/HT, achat max TTC/HT) : repliée par défaut. Écran uniquement — ni les
  // exports (texte / PDF de la liste, sans prix) ni le lien public n'en reprennent rien.
  const [vuePrixOuverte, setVuePrixOuverte] = useState(false);
  // Taux de cotisations / IR du profil (branche matériau) et part du prix réellement encaissée (remise du devis) : servent au prix d'achat
  // MAXIMUM sans vente à perte (vue privée). null tant que le profil n'est pas chargé → rien n'est affiché plutôt qu'un chiffre avec de faux taux.
  const [taux, setTaux] = useState<TauxRentabilite | null>(null);
  const [facteurRemise, setFacteurRemise] = useState(1);

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof (navigator as any).share === "function");
  }, []);

  useEffect(() => {
    supabase
      .from("devis")
      .select("numero, statut, objet, total_materiau, remise_valeur, liste_courses_token, liste_courses_checked, client:clients(nom, prenom, email, telephone), lignes:devis_lignes(*)")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (data) {
          setDevisInfo(data as any);
          const lignes = (data as any).lignes ?? [];
          setItems(buildCourseItems(lignes));
          setLignesBrutes(lignes);
          setFacteurRemise(facteurRemiseMateriau(lignes, (data as any).total_materiau, (data as any).remise_valeur));
          // Vue par fournisseur proposée (et activée) dès qu'une ligne en porte un.
          setParFournisseur(lignes.some((l: any) => String(l.fournisseur_nom ?? "").trim() !== ""));
          setChecked(((data as any).liste_courses_checked as Record<string, boolean>) || {});
          // Offres en plusieurs pièces : chargées à part ; si la colonne n'existe pas encore (migration 004),
          // l'erreur est ignorée et la liste reste celle des articles finis.
          const idsOffres = Array.from(new Set(lignes.map((l: any) => l.fournisseur_id).filter(Boolean))) as string[];
          if (idsOffres.length > 0) {
            // Référence fournisseur de l'offre retenue sur chaque ligne (colonne `reference`), requête à part pour ne rien casser si `pieces` manque.
            supabase.from("prestation_fournisseurs").select("id, reference").in("id", idsOffres).then(({ data: refs, error }) => {
              if (error || !refs) return;
              const parOffre = new Map<string, string>();
              (refs as any[]).forEach(o => { if (String(o.reference ?? "").trim()) parOffre.set(o.id, String(o.reference).trim()); });
              if (parOffre.size === 0) return;
              const enrichies = lignes.map((l: any) => ({ ...l, reference_fournisseur: l.fournisseur_id ? parOffre.get(String(l.fournisseur_id)) : undefined }));
              setLignesBrutes(enrichies);
              setItems(buildCourseItems(enrichies));
            });
            supabase.from("prestation_fournisseurs").select("id, pieces").in("id", idsOffres).then(({ data: offres, error }) => {
              if (error || !offres) return;
              const m: Record<string, { nom: string; quantite: number; reference?: string | null }[]> = {};
              (offres as any[]).forEach(o => { if (Array.isArray(o.pieces) && o.pieces.length > 0) m[o.id] = o.pieces; });
              setPiecesParOffre(m);
            });
          }
        }
        setLoading(false);
      });
  }, [id]);

  // Profil de l'utilisateur connecté (taux de cotisations / IR) — mêmes taux, mêmes défauts que la page de rentabilité.
  useEffect(() => {
    let annule = false;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return;
      const { data } = await supabase.from("profil").select("taux_cotisations_materiau, taux_ir_materiau, taux_cotisations_service, taux_ir_service").eq("id", session.user.id).maybeSingle();
      if (!annule) setTaux(tauxDepuisProfil(data as any));
    });
    return () => { annule = true; };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  async function persistChecked(next: Record<string, boolean>) {
    const precedent = checked;
    setChecked(next);
    const { error } = await supabase.from("devis").update({ liste_courses_checked: next }).eq("id", id);
    if (error) {
      console.error("Enregistrement de la liste de courses :", error);
      setChecked(precedent);
    }
  }

  function toggle(key: string) {
    persistChecked({ ...checked, [key]: !checked[key] });
  }

  function toggleAll(value: boolean) {
    const next: Record<string, boolean> = {};
    items.forEach(it => { next[it.key] = value; });
    persistChecked(next);
  }

  async function ensureToken(): Promise<string | null> {
    let token = devisInfo?.liste_courses_token;
    if (!token) {
      token = crypto.randomUUID();
      const { error } = await supabase.from("devis").update({ liste_courses_token: token }).eq("id", id);
      if (error) return null;
      setDevisInfo(prev => prev ? { ...prev, liste_courses_token: token } : prev);
    }
    return token;
  }

  function shareMessage(url: string) {
    const client = devisInfo?.client as any;
    const prenom = client?.prenom ? `${client.prenom}, ` : "";
    return `${prenom}voici la liste de courses pour le devis ${devisInfo?.numero} : ${url}`;
  }

  async function handleOpenMenu() {
    const token = await ensureToken();
    if (!token) return;
    setMenuOpen(true);
  }

  async function handleCopy() {
    const token = devisInfo?.liste_courses_token;
    if (!token) return;
    const url = `${window.location.origin}/liste/${token}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setMenuOpen(false);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSendSms() {
    const token = devisInfo?.liste_courses_token;
    const client = devisInfo?.client as any;
    if (!token || !client?.telephone) return;
    const url = `${window.location.origin}/liste/${token}`;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const sep = isIos ? "&" : "?";
    window.location.href = `sms:${client.telephone}${sep}body=${encodeURIComponent(shareMessage(url))}`;
    setMenuOpen(false);
  }

  function handleSendEmail() {
    const token = devisInfo?.liste_courses_token;
    const client = devisInfo?.client as any;
    if (!token || !client?.email) return;
    const url = `${window.location.origin}/liste/${token}`;
    const subject = `Liste de courses — Devis ${devisInfo?.numero}`;
    window.location.href = `mailto:${client.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(shareMessage(url))}`;
    setMenuOpen(false);
  }


  // ── Export personnel (uniquement côté artisan, jamais exposé aux clients) ──
  function exportMeta() {
    const c = devisInfo?.client as any;
    const clientNom = c ? (c.prenom ? `${c.prenom} ${c.nom}` : c.nom) : undefined;
    return { numero: devisInfo?.numero ?? "", clientNom, objet: devisInfo?.objet };
  }

  async function handleCopyText() {
    const text = buildCourseText(items, checked, exportMeta());
    try {
      await navigator.clipboard.writeText(text);
      setTextCopied(true);
      setTimeout(() => setTextCopied(false), 2000);
    } catch {
      window.prompt("Copie la liste :", text);
    }
  }

  async function handleShareText() {
    const meta = exportMeta();
    const text = buildCourseText(items, checked, meta);
    try {
      await (navigator as any).share({ title: `Liste de courses — Devis ${meta.numero}`, text });
    } catch (e: any) {
      if (e?.name !== "AbortError") handleCopyText();
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function handlePdf() {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const meta = exportMeta();
      const blob = await genPDFListeCourses(items, checked, meta);
      const filename = courseFileName(meta.numero);
      const nav = navigator as any;
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
      if (isMobile && typeof nav.share === "function" && typeof nav.canShare === "function") {
        const file = new File([blob], filename, { type: "application/pdf" });
        if (nav.canShare({ files: [file] })) {
          try {
            await nav.share({ files: [file], title: `Liste de courses — Devis ${meta.numero}` });
            return;
          } catch (e: any) {
            if (e?.name === "AbortError") return;
          }
        }
      }
      downloadBlob(blob, filename);
    } finally {
      setPdfBusy(false);
    }
  }

  const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
  // Vue prix et marge : seulement une fois les taux du profil connus (jamais de plafond calculé avec de faux taux).
  const vuePrix = taux ? buildVuePrix(lignesBrutes, taux, facteurRemise) : null;

  const totalChecked = items.filter(it => checked[it.key]).length;
  const aDesFournisseurs = lignesBrutes.some(l => String(l.fournisseur_nom ?? "").trim() !== "");
  const groupes = parFournisseur && aDesFournisseurs ? buildCourseItemsParFournisseur(lignesBrutes, piecesParOffre) : null;

  function renderItem(it: CourseItem, cle: string) {
    const isChecked = !!checked[it.key];
    return (
      <button
        key={cle}
        onClick={() => toggle(it.key)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left",
          isChecked ? "bg-emerald-50 border-emerald-200" : "bg-white border-ink-100 hover:border-ink-200"
        )}
      >
        <div className={cn(
          "w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors",
          isChecked ? "bg-emerald-500 border-emerald-500" : "border-ink-300 bg-white"
        )}>
          {isChecked && <Check size={13} className="text-white" />}
        </div>
        <LigneImage url={it.image} taille={36} />
        <span className={cn("flex-1 text-sm", isChecked ? "text-ink-400 line-through" : "text-ink-800")}>
          {it.nom}
          {it.reference && <span className="block text-[11px] text-ink-400 no-underline">Réf. {it.reference}</span>}
        </span>
        <span className={cn("text-sm font-semibold shrink-0", isChecked ? "text-ink-300" : "text-ink-900")}>
          {it.qty}{it.unite && it.unite !== "u" && it.unite !== "forfait" ? ` ${it.unite}` : "×"}
        </span>
      </button>
    );
  }

  if (loading) {
    return <Shell><div className="p-8 text-center text-ink-400">Chargement…</div></Shell>;
  }

  if (!devisInfo) {
    return <Shell><div className="p-8 text-center text-ink-400">Devis introuvable.</div></Shell>;
  }

  const client = devisInfo.client as any;

  return (
    <Shell>
      <div className={cn("p-4 md:p-8 mx-auto", vuePrixOuverte ? "max-w-3xl" : "max-w-xl")}>
        <div className="flex items-center gap-3 mb-6">
          <Link href={`/devis/${id}`} className="btn-ghost !px-2.5 !py-2"><ArrowLeft size={16} /></Link>
          <div className="flex-1">
            <h1 className="font-display text-2xl">Liste de courses</h1>
            <p className="text-xs text-ink-400">
              Devis {devisInfo.numero}
              {client && ` · ${client.prenom ? `${client.prenom} ${client.nom}` : client.nom}`}
            </p>
          </div>
          <div className="relative shrink-0" ref={menuRef}>
            <button
              onClick={handleOpenMenu}
              className="btn-ghost !px-3 !py-2 inline-flex items-center gap-1.5 text-xs"
            >
              {copied ? <Check size={14} className="text-emerald-500" /> : <Share2 size={14} />}
              {copied ? "Lien copié" : "Partager"}
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-ink-100 rounded-xl shadow-lg py-1 z-10">
                <button
                  onClick={handleCopy}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 text-left"
                >
                  <Link2 size={15} className="text-ink-400" /> Copier le lien
                </button>
                <button
                  onClick={handleSendSms}
                  disabled={!(devisInfo?.client as any)?.telephone}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <MessageSquare size={15} className="text-ink-400" />
                  {(devisInfo?.client as any)?.telephone ? "Envoyer par SMS" : "Envoyer par SMS (pas de tél.)"}
                </button>
                <button
                  onClick={handleSendEmail}
                  disabled={!(devisInfo?.client as any)?.email}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Mail size={15} className="text-ink-400" />
                  {(devisInfo?.client as any)?.email ? "Envoyer par email" : "Envoyer par email (pas d'adresse)"}
                </button>
              </div>
            )}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="card card-inner text-center py-8">
            <ShoppingCart size={24} className="mx-auto text-ink-300 mb-2" />
            <p className="text-ink-400 text-sm">Aucun matériel identifié sur ce devis.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="text-xs text-ink-400 mr-1">Export perso :</span>
              <button onClick={handleCopyText} className="btn-ghost !px-3 !py-2 inline-flex items-center gap-1.5 text-xs">
                {textCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                {textCopied ? "Copié" : "Copier"}
              </button>
              <button onClick={handlePdf} disabled={pdfBusy} className="btn-ghost !px-3 !py-2 inline-flex items-center gap-1.5 text-xs disabled:opacity-50">
                <FileDown size={14} />
                {pdfBusy ? "Création…" : "PDF"}
              </button>
              {canShare && (
                <button onClick={handleShareText} className="btn-ghost !px-3 !py-2 inline-flex items-center gap-1.5 text-xs">
                  <Share2 size={14} /> Envoyer le texte
                </button>
              )}
            </div>

            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-ink-500">{totalChecked} / {items.length} coché{totalChecked > 1 ? "s" : ""}</p>
              <div className="flex gap-2">
                <button onClick={() => toggleAll(true)} className="text-xs text-ink-500 hover:text-ink-700 underline">Tout cocher</button>
                <button onClick={() => toggleAll(false)} className="text-xs text-ink-500 hover:text-ink-700 underline flex items-center gap-1">
                  <RotateCcw size={11} /> Réinitialiser
                </button>
              </div>
            </div>

            {aDesFournisseurs && (
              <div className="flex items-center gap-2 mb-3">
                <button onClick={() => setParFournisseur(v => !v)}
                  className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                    parFournisseur ? "bg-ink-900 text-volt-400 border-ink-900" : "bg-white border-ink-200 text-ink-600 hover:bg-ink-50")}>
                  <Store size={13} /> Par fournisseur
                </button>
                {parFournisseur && <span className="text-[11px] text-ink-400">Vue perso — le lien et les exports envoyés au client restent sans fournisseur.</span>}
              </div>
            )}

            {vuePrix && vuePrix.groupes.length > 0 && (
              <div className="mb-4">
                <button onClick={() => setVuePrixOuverte(v => !v)}
                  className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                    vuePrixOuverte ? "bg-ink-900 text-volt-400 border-ink-900" : "bg-white border-ink-200 text-ink-600 hover:bg-ink-50")}>
                  <Euro size={13} /> Prix et marge (perso)
                </button>

                {vuePrixOuverte && taux && (
                  <div className="card card-inner mt-3 border-sky-200">
                    <p className="text-[11px] text-ink-400 mb-1">
                      Vue perso, à l'écran uniquement : rien de tout ça n'est dans les exports de la liste ni dans le lien envoyé au client.
                    </p>
                    <p className="text-[11px] text-ink-400 mb-3">
                      <strong className="text-ink-600">Achat max TTC</strong> = prix de vente × (1 − cotisations {taux.cotisMateriau.toLocaleString("fr-FR")} %{taux.irMateriau > 0 ? ` − impôt ${taux.irMateriau.toLocaleString("fr-FR")} %` : ""})
                      {facteurRemise < 1 ? `, après la remise du devis (tu encaisses ${(facteurRemise * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % du prix affiché)` : ""}.
                      {" "}<strong className="text-ink-600">HT</strong> = TTC ÷ {(1 + TVA_ACHAT_PCT / 100).toLocaleString("fr-FR")} (TVA {TVA_ACHAT_PCT} %, comme le catalogue). Au-dessus du max, la ligne est vendue à perte.
                    </p>

                    {vuePrix.nbAPerte > 0 && (
                      <p className="text-xs text-red-600 font-semibold mb-3 flex items-center gap-1.5">
                        <AlertTriangle size={14} className="shrink-0" />
                        {vuePrix.nbAPerte} ligne{vuePrix.nbAPerte > 1 ? "s" : ""} vendue{vuePrix.nbAPerte > 1 ? "s" : ""} à perte : prix d'achat au-dessus du maximum.
                      </p>
                    )}

                    <div className="space-y-5">
                      {vuePrix.groupes.map(g => (
                        <div key={g.fournisseur ?? "__sans"}>
                          <h3 className="font-semibold text-ink-900 text-sm mb-1">{g.fournisseur ?? "Fournisseur non précisé"}</h3>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[640px] text-sm tabular-nums">
                              <thead>
                                <tr className="text-[11px] text-ink-400 border-b border-ink-100">
                                  <th className="text-left font-medium pb-1">Produit</th>
                                  <th className="text-right font-medium pb-1 px-1.5">Vente client</th>
                                  <th className="text-right font-medium pb-1 px-1.5">Achat TTC</th>
                                  <th className="text-right font-medium pb-1 px-1.5">Achat HT</th>
                                  <th className="text-right font-medium pb-1 px-1.5">Achat max TTC</th>
                                  <th className="text-right font-medium pb-1 pl-1.5">Achat max HT</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.lignes.map(l => (
                                  <tr key={l.cle} className={cn("border-b border-ink-50 align-top", l.aPerte && "bg-red-50")}>
                                    <td className="py-1.5 pr-2 text-ink-800">
                                      <span className="font-semibold">{l.unite && l.unite !== "u" && l.unite !== "forfait" ? `${l.qty} ${l.unite}` : `${l.qty}×`}</span> {l.nom}
                                      {l.reference && <span className="block text-[11px] text-ink-400">Réf. {l.reference}</span>}
                                    </td>
                                    <td className="py-1.5 px-1.5 text-right">
                                      <span className="block font-medium text-ink-900">{eur(l.venteTotal)}</span>
                                      <span className="block text-[11px] text-ink-400">{eur(l.venteUnitaire)} / u.</span>
                                    </td>
                                    {l.achatTtcUnitaire != null ? (
                                      <>
                                        <td className="py-1.5 px-1.5 text-right">
                                          <span className={cn("block font-medium", l.aPerte ? "text-red-600" : "text-ink-900")}>{l.aPerte ? "⚠ " : ""}{eur(l.achatTtcTotal ?? 0)}</span>
                                          <span className="block text-[11px] text-ink-400">{eur(l.achatTtcUnitaire)} / u.</span>
                                        </td>
                                        <td className="py-1.5 px-1.5 text-right">
                                          <span className="block font-medium text-ink-900">{eur(l.achatHtTotal ?? 0)}</span>
                                          <span className="block text-[11px] text-ink-400">{eur(l.achatHtUnitaire ?? 0)} / u.</span>
                                        </td>
                                      </>
                                    ) : (
                                      <td colSpan={2} className="py-1.5 px-1.5 text-right text-xs text-amber-700">prix d'achat non renseigné</td>
                                    )}
                                    <td className="py-1.5 px-1.5 text-right">
                                      <span className="block font-medium text-emerald-700">{eur(l.maxTtcTotal)}</span>
                                      <span className="block text-[11px] text-ink-400">{eur(l.maxTtcUnitaire)} / u.</span>
                                    </td>
                                    <td className="py-1.5 pl-1.5 text-right">
                                      <span className="block font-medium text-emerald-700">{eur(l.maxHtTotal)}</span>
                                      <span className="block text-[11px] text-ink-400">{eur(l.maxHtUnitaire)} / u.</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="font-semibold text-ink-900">
                                  <td className="pt-2 pr-2 text-xs text-ink-600">Total {g.fournisseur ?? "non précisé"}</td>
                                  <td className="pt-2 px-1.5 text-right">{eur(g.totaux.vente)}</td>
                                  <td className="pt-2 px-1.5 text-right">{eur(g.totaux.achatTtc)}</td>
                                  <td className="pt-2 px-1.5 text-right">{eur(g.totaux.achatHt)}</td>
                                  <td className={cn("pt-2 px-1.5 text-right", g.totaux.achatTtc > g.totaux.maxTtc + 0.005 ? "text-red-600" : "text-emerald-700")}>{eur(g.totaux.maxTtc)}</td>
                                  <td className={cn("pt-2 pl-1.5 text-right", g.totaux.achatHt > g.totaux.maxHt + 0.005 ? "text-red-600" : "text-emerald-700")}>{eur(g.totaux.maxHt)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>

                    {vuePrix.groupes.length > 1 && (
                      <div className="mt-4 pt-3 border-t border-ink-200 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                        <span className="text-ink-600">Vente client (total)</span><span className="text-right font-semibold text-ink-900">{eur(vuePrix.totaux.vente)}</span>
                        <span className="text-ink-600">Achat (total TTC · HT)</span><span className="text-right font-semibold text-ink-900">{eur(vuePrix.totaux.achatTtc)} · {eur(vuePrix.totaux.achatHt)}</span>
                        <span className="text-ink-600">Achat max (total TTC · HT)</span><span className="text-right font-semibold text-emerald-700">{eur(vuePrix.totaux.maxTtc)} · {eur(vuePrix.totaux.maxHt)}</span>
                      </div>
                    )}
                    {(vuePrix.nbSansPrix > 0 || vuePrix.nbKitsIgnores > 0) && (
                      <p className="text-[11px] text-amber-700 mt-2">
                        {vuePrix.nbSansPrix > 0 && `${vuePrix.nbSansPrix} ligne${vuePrix.nbSansPrix > 1 ? "s" : ""} sans prix d'achat renseigné : exclue${vuePrix.nbSansPrix > 1 ? "s" : ""} des totaux (à compléter dans le catalogue). `}
                        {vuePrix.nbKitsIgnores > 0 && `${vuePrix.nbKitsIgnores} kit${vuePrix.nbKitsIgnores > 1 ? "s" : ""} non chiffrable${vuePrix.nbKitsIgnores > 1 ? "s" : ""} (pas de prix d'achat par composant).`}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {groupes ? (
              <div className="space-y-4">
                {groupes.map(g => (
                  <div key={g.fournisseur ?? "__sans"} className="card card-inner">
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                      <h2 className="font-semibold text-ink-900 text-sm">{g.fournisseur ?? "Fournisseur non précisé"}</h2>
                      <span className="text-xs text-ink-400 shrink-0">
                        {g.items.filter(it => checked[it.key]).length} / {g.items.length}
                        {g.achat !== null && ` · achat ${eur(g.achat)}`}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {g.items.map(it => renderItem(it, `${g.fournisseur ?? "_"}-${it.key}`))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="card card-inner">
                <div className="space-y-1">
                  {items.map(it => renderItem(it, it.key))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
