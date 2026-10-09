"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import Shell from "@/components/layout/Shell";
import LigneImage from "@/components/devis/LigneImage";
import Link from "next/link";
import { ArrowLeft, Check, ShoppingCart, RotateCcw, Share2, Link2, MessageSquare, Mail, Copy, FileDown, Store, Euro, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildCourseItems, buildCourseItemsParFournisseur, buildComparatifAchat, CourseItem } from "@/lib/courseItems";
import { buildCourseText, genPDFListeCourses, courseFileName, buildPrixFournisseursText, genPDFPrixFournisseurs, comparatifFileName } from "@/lib/courseExport";

export default function ListeCoursesPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [loading, setLoading] = useState(true);
  const [devisInfo, setDevisInfo] = useState<{ numero: string; statut: string; objet?: string; client?: any; liste_courses_token?: string } | null>(null);
  const [items, setItems] = useState<CourseItem[]>([]);
  const [lignesBrutes, setLignesBrutes] = useState<any[]>([]);
  const [parFournisseur, setParFournisseur] = useState(false);
  // Pièces à acheter par offre fournisseur retenue sur les lignes (vue privée par fournisseur uniquement).
  const [piecesParOffre, setPiecesParOffre] = useState<Record<string, { nom: string; quantite: number }[]>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [textCopied, setTextCopied] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [canShare, setCanShare] = useState(false);
  // Prix fournisseurs TTC sans marge (courses faites par le client) : null = masqué ; "achat" = prix fournisseurs seuls ;
  // "comparatif" = prix fournisseurs contre prix du devis (avec ma marge). Vue privée : rien de tout ça n'est dans le lien public.
  const [vuePrix, setVuePrix] = useState<null | "achat" | "comparatif">(null);
  const [prixCopie, setPrixCopie] = useState(false);
  const [prixPdfBusy, setPrixPdfBusy] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof (navigator as any).share === "function");
  }, []);

  useEffect(() => {
    supabase
      .from("devis")
      .select("numero, statut, objet, liste_courses_token, liste_courses_checked, client:clients(nom, prenom, email, telephone), lignes:devis_lignes(*)")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (data) {
          setDevisInfo(data as any);
          const lignes = (data as any).lignes ?? [];
          setItems(buildCourseItems(lignes));
          setLignesBrutes(lignes);
          // Vue par fournisseur proposée (et activée) dès qu'une ligne en porte un.
          setParFournisseur(lignes.some((l: any) => String(l.fournisseur_nom ?? "").trim() !== ""));
          setChecked(((data as any).liste_courses_checked as Record<string, boolean>) || {});
          // Offres en plusieurs pièces : chargées à part ; si la colonne n'existe pas encore (migration 004),
          // l'erreur est ignorée et la liste reste celle des articles finis.
          const idsOffres = Array.from(new Set(lignes.map((l: any) => l.fournisseur_id).filter(Boolean))) as string[];
          if (idsOffres.length > 0) {
            supabase.from("prestation_fournisseurs").select("id, pieces").in("id", idsOffres).then(({ data: offres, error }) => {
              if (error || !offres) return;
              const m: Record<string, { nom: string; quantite: number }[]> = {};
              (offres as any[]).forEach(o => { if (Array.isArray(o.pieces) && o.pieces.length > 0) m[o.id] = o.pieces; });
              setPiecesParOffre(m);
            });
          }
        }
        setLoading(false);
      });
  }, [id]);

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
    setChecked(next);
    await supabase.from("devis").update({ liste_courses_checked: next }).eq("id", id);
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

  const comparatif = buildComparatifAchat(lignesBrutes);
  const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

  async function handleCopyPrix() {
    if (!vuePrix) return;
    const text = buildPrixFournisseursText(comparatif, exportMeta(), vuePrix === "comparatif");
    try {
      await navigator.clipboard.writeText(text);
      setPrixCopie(true);
      setTimeout(() => setPrixCopie(false), 2000);
    } catch {
      window.prompt("Copie le texte :", text);
    }
  }

  async function handlePdfPrix() {
    if (!vuePrix || prixPdfBusy) return;
    setPrixPdfBusy(true);
    try {
      const meta = exportMeta();
      const avecComparatif = vuePrix === "comparatif";
      const blob = await genPDFPrixFournisseurs(comparatif, meta, avecComparatif);
      const filename = comparatifFileName(meta.numero, avecComparatif);
      const nav = navigator as any;
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
      if (isMobile && typeof nav.share === "function" && typeof nav.canShare === "function") {
        const file = new File([blob], filename, { type: "application/pdf" });
        if (nav.canShare({ files: [file] })) {
          try { await nav.share({ files: [file], title: avecComparatif ? `Comparatif courses — Devis ${meta.numero}` : `Courses (prix TTC) — Devis ${meta.numero}` }); return; }
          catch (e: any) { if (e?.name === "AbortError") return; }
        }
      }
      downloadBlob(blob, filename);
    } finally {
      setPrixPdfBusy(false);
    }
  }

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
      <div className="p-4 md:p-8 max-w-xl mx-auto">
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

            {comparatif.groupes.length > 0 && (
              <div className="mb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-ink-400 mr-1">Courses par le client :</span>
                  <button onClick={() => setVuePrix(v => v === "achat" ? null : "achat")}
                    className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                      vuePrix === "achat" ? "bg-ink-900 text-volt-400 border-ink-900" : "bg-white border-ink-200 text-ink-600 hover:bg-ink-50")}>
                    <Euro size={13} /> Prix fournisseurs TTC
                  </button>
                  <button onClick={() => setVuePrix(v => v === "comparatif" ? null : "comparatif")}
                    className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                      vuePrix === "comparatif" ? "bg-ink-900 text-volt-400 border-ink-900" : "bg-white border-ink-200 text-ink-600 hover:bg-ink-50")}>
                    <Scale size={13} /> Comparatif vs mon devis
                  </button>
                </div>

                {vuePrix && (
                  <div className="card card-inner mt-3 border-sky-200">
                    <p className="text-[11px] text-ink-400 mb-3">
                      {vuePrix === "comparatif"
                        ? "Vue perso : prix TTC chez le fournisseur (sans marge) contre le prix du devis. Le lien public de la liste n'en reprend rien — seuls les exports ci-dessous, que tu envoies toi-même, le montrent."
                        : "Prix TTC chez le fournisseur retenu, sans marge — ce que le client paie s'il fait ses courses lui-même. Le lien public de la liste n'en reprend rien."}
                    </p>
                    <div className="space-y-4">
                      {comparatif.groupes.map(g => (
                        <div key={g.fournisseur ?? "__sans"}>
                          <div className="flex items-baseline justify-between gap-3 mb-1">
                            <h3 className="font-semibold text-ink-900 text-sm">{g.fournisseur ?? "Fournisseur non précisé"}</h3>
                            <span className="text-xs font-semibold text-ink-700 shrink-0">{eur(g.achat)}</span>
                          </div>
                          <div className="space-y-1">
                            {g.lignes.map(l => (
                              <div key={l.cle} className="flex items-baseline gap-2 text-sm border-b border-ink-50 pb-1">
                                <span className="flex-1 min-w-0 text-ink-800">
                                  <span className="font-semibold">{l.unite && l.unite !== "u" && l.unite !== "forfait" ? `${l.qty} ${l.unite}` : `${l.qty}×`}</span> {l.nom}
                                </span>
                                {l.achatUnitaire != null ? (
                                  <span className="shrink-0 text-right">
                                    <span className="block text-ink-900 font-medium">{eur(l.achatTotal ?? 0)}</span>
                                    <span className="block text-[11px] text-ink-400">{eur(l.achatUnitaire)} / u.</span>
                                    {vuePrix === "comparatif" && <span className="block text-[11px] text-sky-700">devis : {eur(l.venteTotal)}</span>}
                                  </span>
                                ) : (
                                  <span className="shrink-0 text-xs text-amber-700">prix d'achat non renseigné</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 pt-3 border-t border-ink-200 flex flex-col gap-1 text-sm">
                      <div className="flex justify-between"><span className="text-ink-600">En achetant soi-même (TTC)</span><span className="font-semibold text-ink-900">{eur(comparatif.totalAchat)}</span></div>
                      {vuePrix === "comparatif" && (
                        <>
                          <div className="flex justify-between"><span className="text-ink-600">Même matériel sur le devis (avec ma marge)</span><span className="font-semibold text-ink-900">{eur(comparatif.totalVente)}</span></div>
                          <div className="flex justify-between text-volt-600 font-bold">
                            <span>Écart</span>
                            <span>{eur(comparatif.ecart)}{comparatif.economiePct != null ? ` · ${comparatif.economiePct.toLocaleString("fr-FR")} % du prix devis` : ""}</span>
                          </div>
                        </>
                      )}
                    </div>
                    {(comparatif.nbSansPrix > 0 || comparatif.nbKitsIgnores > 0) && (
                      <p className="text-[11px] text-amber-700 mt-2">
                        {comparatif.nbSansPrix > 0 && `${comparatif.nbSansPrix} ligne${comparatif.nbSansPrix > 1 ? "s" : ""} sans prix d'achat renseigné : exclue${comparatif.nbSansPrix > 1 ? "s" : ""} des totaux (à compléter dans le catalogue). `}
                        {comparatif.nbKitsIgnores > 0 && `${comparatif.nbKitsIgnores} kit${comparatif.nbKitsIgnores > 1 ? "s" : ""} non comparable${comparatif.nbKitsIgnores > 1 ? "s" : ""} (pas de prix d'achat par composant).`}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2 mt-3">
                      <button onClick={handleCopyPrix} className="btn-ghost !px-3 !py-2 inline-flex items-center gap-1.5 text-xs">
                        {prixCopie ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                        {prixCopie ? "Copié" : "Copier le texte"}
                      </button>
                      <button onClick={handlePdfPrix} disabled={prixPdfBusy} className="btn-ghost !px-3 !py-2 inline-flex items-center gap-1.5 text-xs disabled:opacity-50">
                        <FileDown size={14} /> {prixPdfBusy ? "Création…" : "PDF"}
                      </button>
                    </div>
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
                        {g.achat !== null && ` · achat ${g.achat.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}`}
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
