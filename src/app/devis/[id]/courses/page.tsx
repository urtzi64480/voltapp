"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import Shell from "@/components/layout/Shell";
import LigneImage from "@/components/devis/LigneImage";
import Link from "next/link";
import { ArrowLeft, Check, ShoppingCart, Plus, RotateCcw, Share2, Link2, MessageSquare, Mail, Copy, FileDown, Store, Euro, AlertTriangle, ExternalLink } from "lucide-react";
import { cn, dateLocale } from "@/lib/utils";
import { buildCourseItems, buildCourseItemsParFournisseur, CourseItem } from "@/lib/courseItems";
import { facteurRemiseMateriau, tauxDepuisProfil, type TauxRentabilite } from "@/lib/rentabilite";
import { associerPrixAuxCases, buildVuePrix, prevuParCase, siteDeUrl, TVA_ACHAT_PCT, urlProduitSure, type LignePrix } from "@/lib/courses-prix";
import { bilanAchats, tonEcart } from "@/lib/courses-achats";
import { buildCourseText, genPDFListeCourses, courseFileName } from "@/lib/courseExport";
import { FormulaireAchat, LigneAchat } from "@/components/devis/AchatsMateriel";
import { chargerAchats } from "@/lib/achats-db";
import { estHorsDevis, htDepuisTtc, lireAchat, SQL_MIGRATION_ACHATS, SQL_MIGRATION_ARTICLE, type AchatLigne } from "@/lib/depenses-materiel";

const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const qteLabel = (qty: number, unite?: string) => (unite && unite !== "u" && unite !== "forfait" ? `${qty} ${unite}` : `${qty}×`);

interface ValeursPrix { vente: number; achatTtc: number | null; achatHt: number | null; maxTtc: number; maxHt: number }

function Cellule({ titre, total, unite, ton }: { titre: string; total: string; unite?: string; ton?: "ok" | "perte" }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-ink-400 leading-tight">{titre}</p>
      <p className={cn("text-sm font-semibold tabular-nums leading-snug", ton === "perte" ? "text-red-600" : ton === "ok" ? "text-emerald-700" : "text-ink-900")}>{total}</p>
      {unite && <p className="text-[11px] text-ink-400 tabular-nums leading-tight">{unite}</p>}
    </div>
  );
}

// Cinq valeurs : vente annoncée, achat TTC, achat HT, achat max TTC, achat max HT. 3 colonnes sur téléphone (2 lignes), 5 sur grand écran.
// u = valeurs à l'unité (affichées sous le total de la ligne) ; absent pour les totaux.
function GrillePrix({ v, u, aPerte }: { v: ValeursPrix; u?: ValeursPrix; aPerte?: boolean }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-x-3 gap-y-2.5">
      <Cellule titre="Vente client" total={eur(v.vente)} unite={u ? `${eur(u.vente)} / u.` : undefined} />
      {v.achatTtc != null && v.achatHt != null ? (
        <>
          <Cellule titre="Achat TTC" total={eur(v.achatTtc)} unite={u && u.achatTtc != null ? `${eur(u.achatTtc)} / u.` : undefined} ton={aPerte ? "perte" : undefined} />
          <Cellule titre="Achat HT" total={eur(v.achatHt)} unite={u && u.achatHt != null ? `${eur(u.achatHt)} / u.` : undefined} ton={aPerte ? "perte" : undefined} />
        </>
      ) : (
        <p className="col-span-2 self-center text-xs text-amber-700">Prix d'achat non renseigné</p>
      )}
      <Cellule titre="Achat max TTC" total={eur(v.maxTtc)} unite={u ? `${eur(u.maxTtc)} / u.` : undefined} ton="ok" />
      <Cellule titre="Achat max HT" total={eur(v.maxHt)} unite={u ? `${eur(u.maxHt)} / u.` : undefined} ton="ok" />
    </div>
  );
}

// Bloc de prix d'une ligne de devis, sous sa case à cocher. `titreArticle` : la case est une pièce (ou une partie de description) de cet
// article — on rappelle de quel article viennent les prix.
function BlocPrix({ l, titreArticle, url }: { l: LignePrix; titreArticle: boolean; url: string | null }) {
  return (
    <div className={cn("border-t border-ink-100 px-3 py-2.5", l.aPerte && "bg-red-50 rounded-b-xl")}>
      {titreArticle && <p className="text-[11px] text-ink-500 mb-1.5">Prix de l'article « <span className="font-medium">{l.nom}</span> » ({qteLabel(l.qty, l.unite)})</p>}
      <GrillePrix
        v={{ vente: l.venteTotal, achatTtc: l.achatTtcTotal, achatHt: l.achatHtTotal, maxTtc: l.maxTtcTotal, maxHt: l.maxHtTotal }}
        u={{ vente: l.venteUnitaire, achatTtc: l.achatTtcUnitaire, achatHt: l.achatHtUnitaire, maxTtc: l.maxTtcUnitaire, maxHt: l.maxHtUnitaire }}
        aPerte={l.aPerte}
      />
      {l.aPerte && <p className="text-xs text-red-600 font-semibold mt-2 flex items-center gap-1.5"><AlertTriangle size={13} className="shrink-0" /> Vendu à perte : achat au-dessus du maximum</p>}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1.5 py-2.5 text-sm font-medium text-sky-700 hover:underline">
          <ExternalLink size={13} className="shrink-0" /> Voir le produit · {siteDeUrl(url)}
        </a>
      )}
    </div>
  );
}

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
  // Liens des produits (vue privée uniquement) : par offre fournisseur retenue, et — pour un produit sans offre — lien du catalogue.
  const [urlsOffres, setUrlsOffres] = useState<Record<string, string>>({});
  const [liensProduits, setLiensProduits] = useState<Record<string, string>>({});
  // Achats réels de ce devis (privé, table devis_achats). Un achat « d'article » porte le nom de l'article de la liste ; sans nom = achat global.
  const [achats, setAchats] = useState<AchatLigne[]>([]);
  const [tableAchatsAbsente, setTableAchatsAbsente] = useState(false);
  const [colonneArticleAbsente, setColonneArticleAbsente] = useState(false);
  const [articleOuvert, setArticleOuvert] = useState<string | null>(null);
  const [erreurAchat, setErreurAchat] = useState<string | null>(null);
  const [confirmDecocher, setConfirmDecocher] = useState<string | null>(null);
  const [reinitConfirm, setReinitConfirm] = useState(false);
  const [globalOuvert, setGlobalOuvert] = useState(false);
  const [horsOuvert, setHorsOuvert] = useState(false);

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
            // Lien produit de chaque offre retenue (requête à part : ne casse ni les références ni les pièces si elle échoue).
            supabase.from("prestation_fournisseurs").select("id, url").in("id", idsOffres).then(({ data: liens, error }) => {
              if (error || !liens) return;
              const m: Record<string, string> = {};
              (liens as any[]).forEach(o => { if (String(o.url ?? "").trim()) m[o.id] = String(o.url).trim(); });
              setUrlsOffres(m);
            });
            supabase.from("prestation_fournisseurs").select("id, pieces").in("id", idsOffres).then(({ data: offres, error }) => {
              if (error || !offres) return;
              const m: Record<string, { nom: string; quantite: number; reference?: string | null }[]> = {};
              (offres as any[]).forEach(o => { if (Array.isArray(o.pieces) && o.pieces.length > 0) m[o.id] = o.pieces; });
              setPiecesParOffre(m);
            });
          }
          // Produits sans offre fournisseur : lien du catalogue (le 1er renseigné).
          const idsProduits = Array.from(new Set(lignes.filter((l: any) => !l.fournisseur_id && l.prestation_id).map((l: any) => l.prestation_id))) as string[];
          if (idsProduits.length > 0) {
            supabase.from("prestations").select("id, liens_fournisseurs").in("id", idsProduits).then(({ data: prods, error }) => {
              if (error || !prods) return;
              const m: Record<string, string> = {};
              (prods as any[]).forEach(p => {
                const premier = (Array.isArray(p.liens_fournisseurs) ? p.liens_fournisseurs : []).find((x: unknown) => urlProduitSure(x));
                if (premier) m[p.id] = String(premier).trim();
              });
              setLiensProduits(m);
            });
          }
        }
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    let annule = false;
    chargerAchats(id).then(r => {
      if (annule) return;
      setAchats(r.achats); setTableAchatsAbsente(r.tableAbsente); setColonneArticleAbsente(r.colonneArticleAbsente);
    });
    return () => { annule = true; };
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

  const ajouterAchat = (a: AchatLigne) => setAchats(l => [...l, a]);
  const modifierAchat = (a: AchatLigne) => setAchats(l => l.map(x => (x.id === a.id ? a : x)));
  const supprimerAchat = (idAchat: string) => setAchats(l => l.filter(x => x.id !== idAchat));
  // Un article saisi est coché d'office : on l'a acheté.
  function cocherSiBesoin(key: string) { if (!checked[key]) persistChecked({ ...checked, [key]: true }); }

  const messageErreurAchat = (m?: string) =>
    /article/i.test(m ?? "") ? `Lance d'abord dans Supabase (SQL Editor) la migration 019 :\n${SQL_MIGRATION_ARTICLE}`
      : /devis_achats/i.test(m ?? "") ? `Lance d'abord dans Supabase (SQL Editor) la migration 018 :\n${SQL_MIGRATION_ACHATS}` : (m ?? "Enregistrement impossible.");
  const lignesArticle = (it: CourseItem) => achats.filter(a => a.article !== "" && a.article.toLowerCase() === it.key);

  // Création d'achats au prix PRÉVU (article coché sans toucher au prix) : affichés tout de suite, confirmés ensuite par le serveur.
  async function creerAchats(liste: { it: CourseItem; fournisseur: string | null; montant: number }[]) {
    if (liste.length === 0) return;
    const date = dateLocale();
    const horodatage = Date.now();
    const temps: AchatLigne[] = liste.map((x, i) => ({ id: `tmp-${horodatage}-${i}`, devisId: id, montant: x.montant, date, fournisseur: x.fournisseur ?? "", article: x.it.nom }));
    const idsTemps = new Set(temps.map(t => t.id));
    setErreurAchat(null);
    setAchats(l => [...l, ...temps]);
    const { data, error } = await supabase.from("devis_achats")
      .insert(liste.map(x => ({ devis_id: id, montant: x.montant, date_achat: date, fournisseur: x.fournisseur || null, article: x.it.nom })))
      .select("id,devis_id,montant,date_achat,fournisseur,article");
    if (error || !data) {
      setAchats(l => l.filter(a => !idsTemps.has(a.id)));
      setErreurAchat(messageErreurAchat(error?.message));
      return;
    }
    const lus = (data as unknown[]).map(lireAchat).filter((a): a is AchatLigne => a != null);
    setAchats(l => [...l.filter(a => !idsTemps.has(a.id)), ...lus]);
  }

  async function retirerAchats(rows: AchatLigne[]) {
    if (rows.length === 0) return;
    const ids = rows.map(r => r.id).filter(i => !i.startsWith("tmp-"));
    setAchats(l => l.filter(a => !rows.some(r => r.id === a.id)));
    if (ids.length === 0) return;
    const { error } = await supabase.from("devis_achats").delete().in("id", ids);
    if (error) { setAchats(l => [...l, ...rows]); setErreurAchat(error.message); }
  }

  // Cocher = « acheté au prix prévu » : l'achat est créé au prévu (modifiable). Décocher le retire ; un prix que tu as modifié demande confirmation.
  async function basculer(it: CourseItem, fournisseur: string | null) {
    const rows = lignesArticle(it);
    if (rows.some(r => r.id.startsWith("tmp-"))) return;        // enregistrement en cours
    const estCoche = !!checked[it.key];
    const prevu = prevuMap.get(it.key) ?? null;
    if (!estCoche) {
      persistChecked({ ...checked, [it.key]: true });
      if (!tableAchatsAbsente && rows.length === 0 && prevu != null && prevu > 0) await creerAchats([{ it, fournisseur, montant: prevu }]);
      return;
    }
    const perso = prevu == null || rows.some(r => Math.abs(r.montant - prevu) > 0.009);
    if (rows.length > 0 && perso && confirmDecocher !== it.key) { setConfirmDecocher(it.key); return; }
    setConfirmDecocher(null);
    persistChecked({ ...checked, [it.key]: false });
    await retirerAchats(rows);
  }

  async function toutCocher() {
    const aCreer = articlesAffiches.flatMap(({ it, fournisseur }) => {
      const prevu = prevuMap.get(it.key) ?? null;
      return !checked[it.key] && lignesArticle(it).length === 0 && prevu != null && prevu > 0 ? [{ it, fournisseur, montant: prevu }] : [];
    });
    toggleAll(true);
    if (!tableAchatsAbsente) await creerAchats(aCreer.filter((x, i, l) => l.findIndex(y => y.it.key === x.it.key) === i));
  }

  // Réinitialiser décoche tout ET retire les prix saisis par article : demande confirmation s'il y en a (les achats globaux restent).
  async function reinitialiser() {
    const rows = achats.filter(a => a.article !== "" && !estHorsDevis(a.article));   // les produits hors devis restent
    if (rows.length > 0 && !reinitConfirm) { setReinitConfirm(true); return; }
    setReinitConfirm(false);
    toggleAll(false);
    await retirerAchats(rows);
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

  // Vue prix et marge : seulement une fois les taux du profil connus (jamais de plafond calculé avec de faux taux).
  const vuePrix = taux ? buildVuePrix(lignesBrutes, taux, facteurRemise) : null;
  // Prix d'achat PRÉVU des articles (bilan en direct) : ne dépend pas des taux du profil (réservés au plafond), donc calculé même s'ils manquent.
  const vuePrevu = useMemo(() => buildVuePrix(lignesBrutes, taux ?? tauxDepuisProfil(null), facteurRemise), [lignesBrutes, taux, facteurRemise]);

  const totalChecked = items.filter(it => checked[it.key]).length;
  const aDesFournisseurs = lignesBrutes.some(l => String(l.fournisseur_nom ?? "").trim() !== "");
  const groupes = parFournisseur && aDesFournisseurs ? buildCourseItemsParFournisseur(lignesBrutes, piecesParOffre) : null;
  // En vue « Prix et marge », les prix sont rattachés fournisseur par fournisseur : la liste est donc groupée même sans fournisseur renseigné.
  const groupesAffiches = groupes ?? (vuePrixOuverte && vuePrix ? buildCourseItemsParFournisseur(lignesBrutes, piecesParOffre) : null);
  const articlesAffiches = groupesAffiches
    ? groupesAffiches.flatMap(g => g.items.map(it => ({ it, fournisseur: g.fournisseur })))
    : items.map(it => ({ it, fournisseur: null as string | null }));
  const prevuMap = prevuParCase(vuePrevu, groupesAffiches, items);

  // Lien du produit pour une ligne de prix : celui de l'offre retenue ; sans offre, celui du catalogue. Jamais le lien d'un AUTRE fournisseur.
  function lienDe(l: LignePrix): string | null {
    if (l.offreId) return urlProduitSure(urlsOffres[l.offreId]);
    return l.prestationId ? urlProduitSure(liensProduits[l.prestationId]) : null;
  }

  // prix : blocs de prix rattachés à cette case (vue « Prix et marge ») — la case reste cochable d'un appui sur toute sa ligne.
  function renderItem(it: CourseItem, cle: string, prix?: LignePrix[], fournisseur?: string | null) {
    const isChecked = !!checked[it.key];
    const achatsArticle = lignesArticle(it);
    const formOuvert = articleOuvert === cle;
    const prevu = prevuMap.get(it.key) ?? null;
    return (
      <div
        key={cle}
        className={cn("rounded-xl border transition-all", isChecked ? "bg-emerald-50 border-emerald-200" : "bg-white border-ink-100 hover:border-ink-200")}
      >
        <button onClick={() => basculer(it, fournisseur ?? null)} className="w-full flex items-center gap-3 px-3 py-2.5 min-h-[48px] rounded-xl text-left">
          <div className={cn(
            "w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors",
            isChecked ? "bg-emerald-500 border-emerald-500" : "border-ink-300 bg-white"
          )}>
            {isChecked && <Check size={13} className="text-white" />}
          </div>
          <LigneImage url={it.image} taille={36} />
          <span className={cn("flex-1 min-w-0 text-sm", isChecked ? "text-ink-400 line-through" : "text-ink-800")}>
            {it.nom}
            {it.reference && <span className="block text-[11px] text-ink-400 no-underline">Réf. {it.reference}</span>}
          </span>
          <span className={cn("text-sm font-semibold shrink-0", isChecked ? "text-ink-300" : "text-ink-900")}>
            {it.qty}{it.unite && it.unite !== "u" && it.unite !== "forfait" ? ` ${it.unite}` : "×"}
          </span>
        </button>
        {!tableAchatsAbsente && prevu !== 0 && (
          <div className="border-t border-ink-100 px-3 py-2 flex flex-col gap-1.5">
            {achatsArticle.map(a => (
              <LigneAchat key={a.id} simple compact achat={a} prevuTtc={prevu}
                onUpdated={x => { modifierAchat(x); cocherSiBesoin(it.key); }}
                onDeleted={idA => { supprimerAchat(idA); persistChecked({ ...checked, [it.key]: false }); }} />
            ))}
            {achatsArticle.length === 0 && !formOuvert && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-400">
                <span className="tabular-nums">{prevu != null ? `Prévu ${eur(prevu)} TTC · ${eur(htDepuisTtc(prevu))} HT` : "Prix d'achat prévu non renseigné"}</span>
                <button type="button" onClick={() => setArticleOuvert(cle)} className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline py-1">
                  <Plus size={13} /> Prix payé
                </button>
              </div>
            )}
            {formOuvert && achatsArticle.length === 0 && (
              <FormulaireAchat simple compact devisId={id} article={it.nom} fournisseurFixe={fournisseur ?? ""} libelle="Enregistrer le prix"
                onSaved={a => { ajouterAchat(a); cocherSiBesoin(it.key); setArticleOuvert(null); }} onCancel={() => setArticleOuvert(null)} />
            )}
            {confirmDecocher === it.key && (
              <div className="flex flex-wrap items-center gap-2 text-xs rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5">
                <span className="text-amber-800">Décocher retire le prix saisi. Continuer ?</span>
                <button type="button" onClick={() => basculer(it, fournisseur ?? null)} className="btn-ghost !px-2 !py-1 text-xs text-red-600">Oui, décocher</button>
                <button type="button" onClick={() => setConfirmDecocher(null)} className="btn-ghost !px-2 !py-1 text-xs">Non</button>
              </div>
            )}
          </div>
        )}
        {prix?.map(l => (
          <div key={l.cle} className={cn(isChecked && "opacity-60")}>
            <BlocPrix l={l} titreArticle={it.nom.toLowerCase() !== l.nom.toLowerCase()} url={lienDe(l)} />
          </div>
        ))}
      </div>
    );
  }

  // Une carte par fournisseur. En vue « Prix et marge », chaque case porte ses prix et l'en-tête le total du fournisseur.
  function renderGroupe(g: { fournisseur: string | null; items: CourseItem[]; achat: number | null }, avecTitre: boolean) {
    const vg = vuePrixOuverte && vuePrix ? vuePrix.groupes.find(x => x.fournisseur === g.fournisseur) : undefined;
    const assoc = vg ? associerPrixAuxCases(vg, g.items) : null;
    return (
      <div key={g.fournisseur ?? "__sans"} className="card card-inner">
        {avecTitre && (
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h2 className="font-semibold text-ink-900 text-sm">{g.fournisseur ?? "Fournisseur non précisé"}</h2>
            <span className="text-xs text-ink-400 shrink-0">
              {g.items.filter(it => checked[it.key]).length} / {g.items.length}
              {g.achat !== null && ` · achat ${eur(g.achat)}`}
            </span>
          </div>
        )}
        {vg && (
          <div className="mb-3 pb-3 border-b border-ink-100">
            <p className="text-[11px] text-ink-400 mb-1.5">Total {g.fournisseur ?? "fournisseur non précisé"} (lignes avec prix d'achat)</p>
            <GrillePrix v={vg.totaux} aPerte={vg.totaux.achatTtc > vg.totaux.maxTtc + 0.005} />
          </div>
        )}
        <div className="space-y-1.5">
          {g.items.map(it => renderItem(it, `${g.fournisseur ?? "_"}-${it.key}`, assoc?.parCase.get(it.key), g.fournisseur))}
        </div>
        {assoc && assoc.orphelines.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-[11px] text-ink-400">Autres lignes du devis (hors liste à cocher)</p>
            {assoc.orphelines.map(l => (
              <div key={l.cle} className="rounded-xl border border-ink-100 bg-white">
                <p className="px-3 pt-2.5 text-sm text-ink-800"><span className="font-semibold">{qteLabel(l.qty, l.unite)}</span> {l.nom}</p>
                <BlocPrix l={l} titreArticle={false} url={lienDe(l)} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return <Shell><div className="p-8 text-center text-ink-400">Chargement…</div></Shell>;
  }

  if (!devisInfo) {
    return <Shell><div className="p-8 text-center text-ink-400">Devis introuvable.</div></Shell>;
  }

  const client = devisInfo.client as any;

  // ── Achats réels (privé) : bilan en direct (dépensé vs prévu), achat global « j'ai tout acheté », prix payé article par article ──
  const globaux = achats.filter(a => a.article === "");
  const horsDevis = achats.filter(a => estHorsDevis(a.article));
  const nbArticlesSaisis = new Set(achats.filter(a => a.article !== "" && !estHorsDevis(a.article)).map(a => a.article.toLowerCase())).size;
  const bilan = bilanAchats(
    articlesAffiches.map(({ it }) => ({ key: it.key, prevuTtc: prevuMap.get(it.key) ?? null, coche: !!checked[it.key] })),
    achats.map(a => ({ article: a.article, montant: a.montant })),
  );
  const ton = tonEcart(bilan.ecartTtc);
  const signe = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${eur(Math.abs(n))}`;
  const couleurEcart = ton === "economie" ? "text-emerald-700" : ton === "surcout" ? "text-red-600" : "text-ink-900";
  // Produit acheté qui n'est pas sur le devis (oubli) : compte dans le dépensé et l'écart, n'est jamais ajouté au devis.
  const blocHorsDevis = tableAchatsAbsente ? null : (
    <div className="card card-inner mt-4 border-amber-200">
      <h2 className="text-sm font-semibold text-ink-900 mb-0.5">Produits supplémentaires (hors devis)</h2>
      <p className="text-xs text-ink-400 mb-2">Un produit oublié ou imprévu : il compte dans le total dépensé et dans l&apos;écart, mais n&apos;est pas ajouté au devis ni à la liste du client.</p>
      {horsDevis.length > 0 && (
        <ul className="flex flex-col gap-2 divide-y divide-ink-100 mb-2">
          {horsDevis.map(a => <li key={a.id} className="pt-2 first:pt-0"><LigneAchat simple compact achat={a} onUpdated={modifierAchat} onDeleted={supprimerAchat} /></li>)}
        </ul>
      )}
      {!horsOuvert ? (
        <button type="button" onClick={() => setHorsOuvert(true)} className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline py-1"><Plus size={13} /> Ajouter un produit supplémentaire</button>
      ) : (
        <FormulaireAchat simple compact nomLibre devisId={id} fournisseurFixe="" libelle="Ajouter" onSaved={a => { ajouterAchat(a); setHorsOuvert(false); }} onCancel={() => setHorsOuvert(false)} />
      )}
    </div>
  );
  const resume = tableAchatsAbsente ? null : (
    <div className="sticky top-14 md:top-0 z-30 mb-3">
      <div className={cn("rounded-xl border bg-white shadow-sm px-3 py-2.5", ton === "economie" ? "border-emerald-300" : ton === "surcout" ? "border-red-300" : "border-ink-200")}>
        <div className="grid grid-cols-3 gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-ink-400">Dépensé</p>
            <p className="text-base font-bold tabular-nums leading-tight">{eur(bilan.reelTtc)} <span className="text-[10px] font-normal text-ink-400">TTC</span></p>
            <p className="text-xs text-ink-500 tabular-nums">{eur(bilan.reelHt)} HT</p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-ink-400">Prévu{bilan.nbAchetes > 0 ? " (achetés)" : ""}</p>
            <p className="text-base font-bold tabular-nums leading-tight">{eur(bilan.prevuTtc)} <span className="text-[10px] font-normal text-ink-400">TTC</span></p>
            <p className="text-xs text-ink-500 tabular-nums">{eur(bilan.prevuHt)} HT</p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-ink-400">{ton === "economie" ? "Économie" : ton === "surcout" ? "Surcoût" : "Écart"}</p>
            <p className={cn("text-base font-bold tabular-nums leading-tight", couleurEcart)}>{ton === "neutre" ? eur(0) : signe(bilan.ecartTtc)} <span className="text-[10px] font-normal opacity-70">TTC</span></p>
            <p className={cn("text-xs tabular-nums", couleurEcart)}>{ton === "neutre" ? eur(0) : signe(bilan.ecartHt)} HT{bilan.ecartPct != null && ton !== "neutre" ? ` · ${bilan.ecartPct > 0 ? "+" : "−"}${Math.abs(bilan.ecartPct).toLocaleString("fr-FR")} %` : ""}</p>
          </div>
        </div>
        <p className="mt-1.5 pt-1.5 border-t border-ink-100 text-[11px] text-ink-400 tabular-nums">
          {bilan.nbAchetes}/{bilan.nbArticles} article{bilan.nbArticles > 1 ? "s" : ""} acheté{bilan.nbAchetes > 1 ? "s" : ""}
          {bilan.resteTtc > 0 && ` · reste à acheter ≈ ${eur(bilan.resteTtc)} TTC · ${eur(bilan.resteHt)} HT (prévu)`}
          {bilan.nbSansPrevu > 0 && ` · ${bilan.nbSansPrevu} sans prix prévu (hors écart)`}
          {bilan.nbHorsDevis > 0 && ` · dont hors devis ${eur(bilan.horsDevisTtc)} TTC · ${eur(bilan.horsDevisHt)} HT`}
        </p>
        {erreurAchat && <p className="mt-1 text-xs text-red-600 whitespace-pre-wrap">{erreurAchat}</p>}
      </div>
    </div>
  );
  const blocAchats = (
    <div className="card card-inner mb-4 border-emerald-200">
      <h2 className="text-sm font-semibold text-ink-900 mb-0.5">Achats de ce devis (privé)</h2>
      {tableAchatsAbsente ? (
        <div className="text-xs text-amber-700">Lance d&apos;abord dans Supabase (SQL Editor) les migrations 018 et 019 (dossier <code>supabase/migrations</code>), ou au minimum :<pre className="mt-1 whitespace-pre-wrap">{SQL_MIGRATION_ACHATS}{"\n"}{SQL_MIGRATION_ARTICLE}</pre></div>
      ) : (
        <>
          <p className="text-xs text-ink-400 mb-2">Coche un article : il est compté au prix prévu. Pour un autre prix, « Prix payé » (ou le crayon). Tout est enregistré en TTC, saisie en HT ou TTC, et alimente <Link href="/depenses" className="underline">Achats matériel</Link> et la rentabilité.</p>
          {colonneArticleAbsente && <p className="text-xs text-amber-700 mb-2 whitespace-pre-wrap">Pour saisir article par article, lance dans Supabase (SQL Editor) la migration 019 :{"\n"}{SQL_MIGRATION_ARTICLE}</p>}
          {globaux.length > 0 && (
            <ul className="flex flex-col gap-2 divide-y divide-ink-100 mb-2">
              {globaux.map(a => <li key={a.id} className="pt-2 first:pt-0"><LigneAchat compact achat={a} onUpdated={modifierAchat} onDeleted={supprimerAchat} detail={<span className="font-medium text-ink-700">Achat global</span>} /></li>)}
            </ul>
          )}
          {!globalOuvert ? (
            <button type="button" onClick={() => setGlobalOuvert(true)} className="text-xs font-medium text-sky-700 hover:underline py-1">J&apos;ai tout acheté d&apos;un coup : saisir un montant global</button>
          ) : (
            <div className="rounded-lg bg-ink-50/70 p-2.5">
              <p className="text-xs font-medium text-ink-700 mb-1.5">J&apos;ai tout acheté sur la liste{nbArticlesSaisis > 0 ? " (le reste, hors articles déjà saisis un par un)" : ""}</p>
              <FormulaireAchat compact devisId={id} libelle="Tout acheté" onSaved={a => { ajouterAchat(a); toggleAll(true); setGlobalOuvert(false); }} onCancel={() => setGlobalOuvert(false)} />
            </div>
          )}
          {globaux.length > 0 && nbArticlesSaisis > 0 && <p className="text-[11px] text-amber-700 mt-1">Les achats globaux et ceux par article s&apos;additionnent : mets dans l&apos;achat global uniquement ce qui n&apos;est pas déjà saisi article par article.</p>}
        </>
      )}
    </div>
  );

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
            {resume}
            {blocAchats}

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
                <button onClick={toutCocher} className="text-xs text-ink-500 hover:text-ink-700 underline">Tout cocher</button>
                <button onClick={reinitialiser} onBlur={() => setReinitConfirm(false)} className={cn("text-xs underline flex items-center gap-1", reinitConfirm ? "text-red-600 font-semibold" : "text-ink-500 hover:text-ink-700")}>
                  <RotateCcw size={11} /> {reinitConfirm ? `Confirmer (retire ${achats.filter(a => a.article !== "" && !estHorsDevis(a.article)).length} prix saisis)` : "Réinitialiser"}
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
                  className={cn("inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all",
                    vuePrixOuverte ? "bg-ink-900 text-volt-400 border-ink-900" : "bg-white border-ink-200 text-ink-600 hover:bg-ink-50")}>
                  <Euro size={13} /> Prix et marge (perso)
                </button>

                {vuePrixOuverte && taux && (
                  <div className="card card-inner mt-3 border-sky-200">
                    <p className="text-[11px] text-ink-400 mb-1">
                      Vue perso, à l'écran uniquement : prix et liens ne figurent ni dans les exports de la liste ni dans le lien envoyé au client. Tu peux cocher les produits comme d'habitude.
                    </p>
                    <p className="text-[11px] text-ink-400">
                      <strong className="text-ink-600">Achat max TTC</strong> = prix de vente × (1 − cotisations {taux.cotisMateriau.toLocaleString("fr-FR")} %{taux.irMateriau > 0 ? ` − impôt ${taux.irMateriau.toLocaleString("fr-FR")} %` : ""})
                      {facteurRemise < 1 ? `, après la remise du devis (tu encaisses ${(facteurRemise * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % du prix affiché)` : ""}.
                      {" "}<strong className="text-ink-600">HT</strong> = TTC ÷ {(1 + TVA_ACHAT_PCT / 100).toLocaleString("fr-FR")} (TVA {TVA_ACHAT_PCT} %, comme le catalogue). Au-dessus du max, la ligne est vendue à perte.
                    </p>
                    {vuePrix.nbAPerte > 0 && (
                      <p className="text-xs text-red-600 font-semibold mt-3 flex items-center gap-1.5">
                        <AlertTriangle size={14} className="shrink-0" />
                        {vuePrix.nbAPerte} ligne{vuePrix.nbAPerte > 1 ? "s" : ""} vendue{vuePrix.nbAPerte > 1 ? "s" : ""} à perte : prix d'achat au-dessus du maximum.
                      </p>
                    )}
                    {vuePrix.groupes.length > 1 && (
                      <div className="mt-3 pt-3 border-t border-ink-100">
                        <p className="text-[11px] text-ink-400 mb-1.5">Total général (lignes avec prix d'achat)</p>
                        <GrillePrix v={vuePrix.totaux} aPerte={vuePrix.totaux.achatTtc > vuePrix.totaux.maxTtc + 0.005} />
                      </div>
                    )}
                    {(vuePrix.nbSansPrix > 0 || vuePrix.nbKitsIgnores > 0) && (
                      <p className="text-[11px] text-amber-700 mt-3">
                        {vuePrix.nbSansPrix > 0 && `${vuePrix.nbSansPrix} ligne${vuePrix.nbSansPrix > 1 ? "s" : ""} sans prix d'achat renseigné : exclue${vuePrix.nbSansPrix > 1 ? "s" : ""} des totaux (à compléter dans le catalogue). `}
                        {vuePrix.nbKitsIgnores > 0 && `${vuePrix.nbKitsIgnores} kit${vuePrix.nbKitsIgnores > 1 ? "s" : ""} non chiffrable${vuePrix.nbKitsIgnores > 1 ? "s" : ""} (pas de prix d'achat par composant).`}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {groupesAffiches ? (
              <div className="space-y-4">
                {groupesAffiches.map(g => renderGroupe(g, g.fournisseur !== null || groupesAffiches.length > 1))}
              </div>
            ) : (
              <div className="card card-inner">
                <div className="space-y-1.5">
                  {items.map(it => renderItem(it, it.key))}
                </div>
              </div>
            )}
            {blocHorsDevis}
          </>
        )}
      </div>
    </Shell>
  );
}
