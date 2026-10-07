// Fournisseurs multiples par produit.
//
// Un produit (table `prestations`) peut avoir plusieurs « offres » (table
// `prestation_fournisseurs`) : un fournisseur, un prix d'achat TTC, un prix de vente HT.
// Une seule offre est « principale » : elle est recopiée dans prestations.prix_achat /
// prix_unitaire / liens_fournisseurs (voir miroirPrestation) — tout le code historique qui lit
// ces colonnes (CRM, rentabilité, moteur pré-devis, catalogue) reste donc valide sans changement.
//
// Tolérance à la migration : si la table n'existe pas encore (003_fournisseurs_produits.sql non
// exécuté), chargerOffres() renvoie ok=false et aucune offre — l'application fonctionne comme avant.

import { supabase } from "@/lib/supabase";
import type { PieceOffre, Prestation, PrestationFournisseur } from "@/types";

// ─── Libellés & prix ────────────────────────────────────────────────────────

export function nomDepuisUrl(url?: string | null): string {
  if (!url) return "";
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

export function libelleOffre(o: Pick<PrestationFournisseur, "fournisseur" | "url">): string {
  return (o.fournisseur ?? "").trim() || nomDepuisUrl(o.url) || "Fournisseur";
}

export function offrePrincipale(offres?: PrestationFournisseur[] | null): PrestationFournisseur | undefined {
  if (!offres || offres.length === 0) return undefined;
  return offres.find(o => o.principal) ?? offres[0];
}

// Offre d'un produit chez un fournisseur donné (comparaison insensible à la casse) — sert à
// garder le même fournisseur quand on change de produit, ou pour le reliquat « au mètre ».
export function offrePourFournisseur(p: Pick<Prestation, "fournisseurs">, nom?: string | null): PrestationFournisseur | undefined {
  const n = (nom ?? "").trim().toLowerCase();
  if (!n || !p.fournisseurs) return undefined;
  return p.fournisseurs.find(o => libelleOffre(o).toLowerCase() === n);
}

// Prix de vente HT effectif d'une offre : celui de l'offre, sinon celui du produit.
export function prixVenteOffre(p: Pick<Prestation, "prix_unitaire">, o?: Pick<PrestationFournisseur, "prix_vente"> | null): number {
  return o && o.prix_vente != null ? o.prix_vente : p.prix_unitaire;
}

export function margePct(prixAchat?: number | null, prixVente?: number | null): number | null {
  if (!prixAchat || prixAchat <= 0 || prixVente == null) return null;
  return Math.round(((prixVente - prixAchat) / prixAchat) * 1000) / 10;
}

// Fourchette de prix de vente d'un produit selon ses offres (ou son prix seul).
export function fourchettePrix(p: Prestation): { min: number; max: number } {
  const prix = (p.fournisseurs ?? []).map(o => prixVenteOffre(p, o));
  if (prix.length === 0) return { min: p.prix_unitaire, max: p.prix_unitaire };
  return { min: Math.min(...prix), max: Math.max(...prix) };
}

export function offresTriees(offres?: PrestationFournisseur[] | null): PrestationFournisseur[] {
  return [...(offres ?? [])].sort((a, b) =>
    Number(b.principal) - Number(a.principal) || (a.ordre ?? 0) - (b.ordre ?? 0));
}

// ─── Chargement ─────────────────────────────────────────────────────────────

// Toutes les offres de l'utilisateur (RLS), paginées par 1000 (limite Supabase par requête).
export async function chargerOffres(): Promise<{ offres: PrestationFournisseur[]; ok: boolean }> {
  const offres: PrestationFournisseur[] = [];
  const TAILLE = 1000;
  for (let page = 0; page < 20; page++) {
    const { data, error } = await supabase
      .from("prestation_fournisseurs")
      .select("*")
      .order("id")
      .range(page * TAILLE, page * TAILLE + TAILLE - 1);
    if (error) {
      console.error("Fournisseurs indisponibles (migration 003 exécutée ?) :", error.message);
      return { offres: [], ok: false };
    }
    const lot = (data ?? []) as PrestationFournisseur[];
    offres.push(...lot);
    if (lot.length < TAILLE) break;
  }
  return { offres, ok: true };
}

export function attacherOffres<T extends Prestation>(prestations: T[], offres: PrestationFournisseur[]): T[] {
  const parPrestation = new Map<string, PrestationFournisseur[]>();
  offres.forEach(o => {
    const l = parPrestation.get(o.prestation_id) ?? [];
    l.push(o);
    parPrestation.set(o.prestation_id, l);
  });
  return prestations.map(p => ({ ...p, fournisseurs: offresTriees(parPrestation.get(p.id)) }));
}

// Raccourci : charge les offres et les attache aux prestations déjà chargées.
export async function attacherFournisseurs<T extends Prestation>(prestations: T[]): Promise<T[]> {
  const { offres } = await chargerOffres();
  return attacherOffres(prestations, offres);
}

export async function offresDe(prestationId: string): Promise<PrestationFournisseur[]> {
  const { data, error } = await supabase.from("prestation_fournisseurs").select("*").eq("prestation_id", prestationId);
  if (error) { console.error("Erreur lecture offres :", error.message); return []; }
  return offresTriees((data ?? []) as PrestationFournisseur[]);
}

// ─── Édition (brouillons de formulaire) ─────────────────────────────────────

// Représentation « formulaire » : tout en chaînes pour les <input>.
export interface OffreDraft {
  cle: string;            // identifiant local stable (clé React)
  id?: string;            // id en base si l'offre existe déjà
  fournisseur: string;
  reference: string;
  url: string;
  prixAchat: string;
  prixVente: string;
  principal: boolean;
  // Pièces à acheter pour constituer l'article fini chez ce fournisseur (vide = article acheté tel quel).
  pieces: PieceDraft[];
  // L'offre avait des pièces en base : si on les retire toutes, il faut les effacer explicitement.
  piecesEnBase?: boolean;
}

export interface PieceDraft {
  cle: string;
  nom: string;
  reference: string;
  quantite: string;
  prixAchat: string;   // prix d'achat TTC unitaire
}

let compteurCle = 0;
function nouvelleCle(): string {
  compteurCle += 1;
  return `o${Date.now().toString(36)}${compteurCle}`;
}

export function nouvelleOffreDraft(principal = false): OffreDraft {
  return { cle: nouvelleCle(), fournisseur: "", reference: "", url: "", prixAchat: "", prixVente: "", principal, pieces: [] };
}

export function nouvellePieceDraft(): PieceDraft {
  return { cle: nouvelleCle(), nom: "", reference: "", quantite: "1", prixAchat: "" };
}

function arrondi2(n: number): number { return Math.round(n * 100) / 100; }

// Prix d'achat total (TTC) d'un article fini = somme quantité × prix de chaque pièce. null si aucune
// pièce, ou si une pièce n'a pas de prix (un total partiel sous-estimerait le coût réel).
export function totalPieces(pieces: { quantite: number; prix_achat?: number | null }[]): number | null {
  if (pieces.length === 0) return null;
  let total = 0;
  for (const p of pieces) {
    if (p.prix_achat == null) return null;
    total += (p.quantite > 0 ? p.quantite : 1) * p.prix_achat;
  }
  return arrondi2(total);
}

// Même calcul sur les champs texte du formulaire (affichage en direct du total des pièces).
export function totalPiecesDrafts(pieces: PieceDraft[]): number | null {
  const n = normaliserPieces(pieces);
  return totalPieces(n);
}

// Écarte les pièces entièrement vides ; quantité par défaut 1.
export function normaliserPieces(pieces: PieceDraft[]): PieceOffre[] {
  return (pieces ?? [])
    .filter(p => p.nom.trim() || p.reference.trim() || p.prixAchat.trim())
    .map((p, i) => {
      const q = nombreOuNull(p.quantite);
      return {
        nom: p.nom.trim() || `Pièce ${i + 1}`,
        reference: p.reference.trim() || null,
        quantite: q != null && q > 0 ? q : 1,
        prix_achat: nombreOuNull(p.prixAchat),
      };
    });
}

export function draftsDepuisOffres(offres: PrestationFournisseur[]): OffreDraft[] {
  return offresTriees(offres).map(o => ({
    cle: nouvelleCle(), id: o.id,
    fournisseur: o.fournisseur ?? "", reference: o.reference ?? "", url: o.url ?? "",
    prixAchat: o.prix_achat != null ? String(o.prix_achat) : "",
    prixVente: o.prix_vente != null ? String(o.prix_vente) : "",
    principal: o.principal,
    pieces: (o.pieces ?? []).map(p => ({
      cle: nouvelleCle(), nom: p.nom ?? "", reference: p.reference ?? "",
      quantite: String(p.quantite ?? 1), prixAchat: p.prix_achat != null ? String(p.prix_achat) : "",
    })),
    piecesEnBase: (o.pieces ?? []).length > 0,
  }));
}

// Produit pas encore migré (ou table absente) : on reconstruit les offres depuis les anciennes
// colonnes (prix_achat, prix_unitaire, liens_fournisseurs) pour ne rien perdre à l'édition.
export function draftsDepuisLegacy(p: Prestation): OffreDraft[] {
  const liens = (p.liens_fournisseurs ?? []).filter(l => l && l.trim());
  if (liens.length === 0) {
    if (p.prix_achat == null && !(p.prix_unitaire > 0)) return [nouvelleOffreDraft(true)];
    return [{
      ...nouvelleOffreDraft(true),
      prixAchat: p.prix_achat != null ? String(p.prix_achat) : "",
      prixVente: String(p.prix_unitaire),
    }];
  }
  return liens.map((url, i) => ({
    ...nouvelleOffreDraft(i === 0),
    fournisseur: nomDepuisUrl(url), url,
    prixAchat: i === 0 && p.prix_achat != null ? String(p.prix_achat) : "",
    prixVente: i === 0 ? String(p.prix_unitaire) : "",
  }));
}

export function draftsPourProduit(p: Prestation): OffreDraft[] {
  return p.fournisseurs && p.fournisseurs.length > 0 ? draftsDepuisOffres(p.fournisseurs) : draftsDepuisLegacy(p);
}

// Offre prête à écrire en base.
export interface OffreNormalisee {
  id?: string;
  fournisseur: string;
  reference: string | null;
  url: string | null;
  prix_achat: number | null;
  prix_vente: number | null;
  principal: boolean;
  ordre: number;
  // Pièces de l'offre. Absent/vide : article acheté tel quel. `effacerPieces` : l'offre en avait en base
  // et on les a toutes retirées (la colonne n'est écrite que dans ces deux cas, pour rester compatible
  // tant que la migration 004 n'est pas exécutée).
  pieces?: PieceOffre[];
  effacerPieces?: boolean;
}

function nombreOuNull(s: string): number | null {
  if (s == null || String(s).trim() === "") return null;
  const n = parseFloat(String(s).replace(",", "."));
  return isNaN(n) ? null : n;
}

export function normaliserUrl(u: string): string | null {
  const t = (u ?? "").trim();
  if (!t) return null;
  return t.startsWith("http") ? t : `https://${t}`;
}

// Écarte les offres entièrement vides, donne un nom à chacune et garantit UNE offre principale.
export function normaliserDrafts(drafts: OffreDraft[]): OffreNormalisee[] {
  const gardees = drafts.filter(d =>
    d.fournisseur.trim() || d.reference.trim() || d.url.trim() || d.prixAchat.trim() || d.prixVente.trim()
    || normaliserPieces(d.pieces).length > 0);
  if (gardees.length === 0) return [];
  let idxPrincipal = gardees.findIndex(d => d.principal);
  if (idxPrincipal < 0) idxPrincipal = 0;
  return gardees.map((d, i) => {
    const url = normaliserUrl(d.url);
    const estPrincipale = i === idxPrincipal;
    const nom = d.fournisseur.trim() || nomDepuisUrl(url) || (estPrincipale ? "Fournisseur principal" : `Fournisseur ${i + 1}`);
    // Avec des pièces, le prix d'achat de l'offre EST la somme des pièces : tout le reste de l'application
    // (miroir du produit, rentabilité du devis, marges) continue de lire un simple prix_achat.
    const pieces = normaliserPieces(d.pieces);
    const total = totalPieces(pieces);
    return {
      id: d.id, fournisseur: nom, reference: d.reference.trim() || null, url,
      prix_achat: pieces.length > 0 ? total : nombreOuNull(d.prixAchat), prix_vente: nombreOuNull(d.prixVente),
      principal: estPrincipale, ordre: i,
      ...(pieces.length > 0 ? { pieces } : {}),
      ...(pieces.length === 0 && d.piecesEnBase ? { effacerPieces: true } : {}),
    };
  }).sort((a, b) => Number(b.principal) - Number(a.principal)).map((o, i) => ({ ...o, ordre: i }));
}

// Valeurs à recopier dans la ligne `prestations` à partir de l'offre principale.
export function miroirPrestation(offres: OffreNormalisee[], prixUnitaireParDefaut: number): {
  prix_achat: number | null; prix_unitaire: number; liens_fournisseurs: string[];
} {
  const principale = offres.find(o => o.principal);
  const urls: string[] = [];
  offres.forEach(o => { if (o.url && !urls.includes(o.url)) urls.push(o.url); });
  return {
    prix_achat: principale?.prix_achat ?? null,
    prix_unitaire: principale && principale.prix_vente != null ? principale.prix_vente : prixUnitaireParDefaut,
    liens_fournisseurs: urls,
  };
}

// Rattache les offres importées/saisies à celles déjà en base quand le nom de fournisseur est
// le même : l'id est conservé (les lignes de devis qui y renvoient ne sont pas détachées).
export function rattacherParNom(existantes: PrestationFournisseur[], offres: OffreNormalisee[]): OffreNormalisee[] {
  const libres = new Map<string, PrestationFournisseur>();
  existantes.forEach(e => libres.set(libelleOffre(e).toLowerCase(), e));
  return offres.map(o => {
    if (o.id) return o;
    const e = libres.get(o.fournisseur.toLowerCase());
    if (!e) return o;
    libres.delete(o.fournisseur.toLowerCase());
    return { ...o, id: e.id };
  });
}

export function messageErreurOffres(message: string): string {
  if (/pieces/i.test(message) && /(column|colonne|schema cache)/i.test(message)) {
    return "La colonne des pièces est introuvable : exécute d'abord la migration 004_pieces_offres.sql dans Supabase.";
  }
  if (/prestation_fournisseurs/i.test(message) && /(exist|schema cache|relation)/i.test(message)) {
    return "La table des fournisseurs est introuvable : exécute d'abord la migration 003_fournisseurs_produits.sql dans Supabase.";
  }
  return message;
}

// Écrit l'état voulu des offres d'un produit : met à jour celles qui ont un id, insère les
// nouvelles, supprime celles qui ne sont plus là. Renvoie un message d'erreur ou null.
export async function synchroniserOffres(userId: string, prestationId: string, voulues: OffreNormalisee[]): Promise<string | null> {
  const { data: enBase, error: errLecture } = await supabase
    .from("prestation_fournisseurs").select("id").eq("prestation_id", prestationId);
  if (errLecture) return messageErreurOffres(errLecture.message);

  const idsEnBase = new Set((enBase ?? []).map((r: any) => r.id as string));
  const idsVoulus = new Set(voulues.map(o => o.id).filter((x): x is string => !!x && idsEnBase.has(x)));

  const aSupprimer = Array.from(idsEnBase).filter(id => !idsVoulus.has(id));
  if (aSupprimer.length > 0) {
    const { error } = await supabase.from("prestation_fournisseurs").delete().in("id", aSupprimer);
    if (error) return messageErreurOffres(error.message);
  }

  const aInserer: object[] = [];
  for (const o of voulues) {
    const champs = {
      fournisseur: o.fournisseur, reference: o.reference, url: o.url,
      prix_achat: o.prix_achat, prix_vente: o.prix_vente, principal: o.principal, ordre: o.ordre,
      updated_at: new Date().toISOString(),
      ...(o.pieces && o.pieces.length > 0 ? { pieces: o.pieces } : {}),
      ...(o.effacerPieces ? { pieces: null } : {}),
    };
    if (o.id && idsEnBase.has(o.id)) {
      const { error } = await supabase.from("prestation_fournisseurs").update(champs).eq("id", o.id);
      if (error) return messageErreurOffres(error.message);
    } else {
      aInserer.push({ ...champs, user_id: userId, prestation_id: prestationId });
    }
  }
  if (aInserer.length > 0) {
    const { error } = await supabase.from("prestation_fournisseurs").insert(aInserer);
    if (error) return messageErreurOffres(error.message);
  }
  return null;
}
