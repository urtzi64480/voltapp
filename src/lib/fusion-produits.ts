// Fusion de produits du catalogue qui sont le même article saisi plusieurs fois (une fois par marque).
//
// Le produit de référence garde tout : les offres (marque + fournisseur + prix) des autres produits
// lui sont rattachées — leurs ids ne changent pas, donc les lignes de devis qui y renvoient
// (devis_lignes.fournisseur_id) restent valides. Les produits fusionnés sont MASQUÉS (actif = false,
// comme la suppression du catalogue), jamais effacés : rien n'est perdu.
//
// Références reportées sur le produit de référence : lignes de devis (prestation_id), composants de
// kits (kit_composants) et brouillons de pré-devis des clients (predevis_config).
//
// Ordre des opérations : d'abord les simples renvois (kits, devis, brouillons), puis, produit après
// produit, le rattachement de ses offres suivi IMMÉDIATEMENT de son masquage, et enfin la mise à jour
// du produit de référence. Un produit masqué n'est jamais retraité : si une étape échoue, relancer la
// fusion reprend là où elle s'est arrêtée, sans doublonner d'offres.

import { supabase } from "@/lib/supabase";
import {
  draftsDepuisLegacy, marqueOffre, marquesDe, messageErreurOffres, normaliserDrafts, normTexte,
  offresTriees, type OffreNormalisee,
} from "@/lib/fournisseurs";
import type { Prestation } from "@/types";

type Produit = Prestation & { est_kit?: boolean };

export interface GroupeDoublons {
  cle: string;
  produits: Produit[];
}

export interface ResultatFusion {
  ok: boolean;
  erreur?: string;
  avertissements: string[];
  nbOffres: number;
}

// ─── Détection ──────────────────────────────────────────────────────────────

// Toutes les marques du catalogue, normalisées (produits et offres), des plus longues aux plus courtes.
function marquesConnuesNorm(prestations: Produit[]): string[] {
  const set = new Set<string>();
  prestations.forEach(p => marquesDe(p).forEach(m => { const k = normTexte(m); if (k.length >= 2) set.add(k); }));
  return Array.from(set).sort((a, b) => b.length - a.length);
}

// Nom normalisé sans les noms de marques : « Prise 2P+T Legrand » et « Prise 2P+T Schneider »
// donnent la même chaîne.
function nomSansMarques(nom: string, marquesNorm: string[]): string {
  let t = ` ${normTexte(nom)} `;
  marquesNorm.forEach(m => { t = t.split(` ${m} `).join(" "); });
  return t.replace(/\s+/g, " ").trim();
}

// Produits qui ne diffèrent que par la marque : même nom (marques retirées), même catégorie, même
// sous-catégorie, même unité, même gamme et même conditionnement. Matériaux uniquement (les services
// n'ont pas de marque), kits et produits masqués exclus.
export function detecterDoublons(prestations: Produit[]): GroupeDoublons[] {
  const marques = marquesConnuesNorm(prestations);
  const groupes = new Map<string, Produit[]>();
  prestations.forEach(p => {
    if (p.est_kit || p.type_branche !== "materiau" || p.actif === false) return;
    const nom = nomSansMarques(p.nom, marques);
    if (!nom) return;
    const cle = [
      nom, normTexte(p.categorie), (p.sous_categorie ?? "").trim(), normTexte(p.unite),
      p.gamme ?? "", p.longueur_unitaire && p.longueur_unitaire > 0 ? String(p.longueur_unitaire) : "0",
    ].join("|");
    groupes.set(cle, [...(groupes.get(cle) ?? []), p]);
  });
  return Array.from(groupes.entries())
    .filter(([, l]) => l.length >= 2)
    .map(([cle, produits]) => ({ cle, produits }))
    .sort((a, b) => a.produits[0].nom.localeCompare(b.produits[0].nom, "fr"));
}

// Produit à garder par défaut : celui qui a le plus d'offres, puis le plus ancien.
export function produitDeReference(produits: Produit[]): Produit {
  return [...produits].sort((a, b) =>
    (b.fournisseurs ?? []).length - (a.fournisseurs ?? []).length
    || (a.created_at ?? "").localeCompare(b.created_at ?? "")
    || a.id.localeCompare(b.id))[0];
}

// Nom générique proposé : celui du produit de référence sans les noms de marques (modifiable).
export function nomGenerique(produits: Produit[], reference: Produit): string {
  const marques = marquesConnuesNorm(produits);
  const jetons = reference.nom.split(/\s+/).filter(Boolean);
  const gardes: string[] = [];
  for (let i = 0; i < jetons.length;) {
    let saut = 0;
    for (const m of marques) {
      const k = m.split(" ").length;
      if (normTexte(jetons.slice(i, i + k).join(" ")) === m) { saut = Math.max(saut, k); }
    }
    if (saut > 0) i += saut; else { gardes.push(jetons[i]); i += 1; }
  }
  const nom = gardes.join(" ")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+[-–—:,;/]+\s*$/, "").replace(/^[-–—:,;/]+\s+/, "")
    .replace(/\s{2,}/g, " ").trim();
  return nom || reference.nom;
}

// ─── Fusion ─────────────────────────────────────────────────────────────────

function nombre(v: unknown): number | null { return v == null ? null : Number(v); }

// Une offre synthétisée depuis les anciens champs d'un produit (prix, lien) existe-t-elle déjà ?
function offreEquivalente(existantes: { marque: string | null; prix_achat: number | null; prix_vente: number | null; url: string | null }[], o: OffreNormalisee): boolean {
  return existantes.some(e =>
    normTexte(e.marque) === normTexte(o.marque)
    && nombre(e.prix_achat) === nombre(o.prix_achat)
    && nombre(e.prix_vente) === nombre(o.prix_vente)
    && (e.url ?? "") === (o.url ?? ""));
}

// Kits : chaque composant d'un doublon pointe désormais vers le produit de référence. Si un kit
// contient plusieurs de ces produits, les lignes sont regroupées (quantités additionnées).
async function reprendreKits(refId: string, idsAutres: string[]): Promise<string | null> {
  const { data, error } = await supabase.from("kit_composants")
    .select("id, kit_id, composant_id, quantite").in("composant_id", [refId, ...idsAutres]);
  if (error) return error.message;
  const lignes = (data ?? []) as { id: string; kit_id: string; composant_id: string; quantite: number }[];
  const parKit = new Map<string, typeof lignes>();
  lignes.forEach(l => parKit.set(l.kit_id, [...(parKit.get(l.kit_id) ?? []), l]));
  for (const rows of Array.from(parKit.values())) {
    if (!rows.some(r => r.composant_id !== refId)) continue;
    const garde = rows.find(r => r.composant_id === refId) ?? rows[0];
    const total = rows.reduce((s, r) => s + (Number(r.quantite) || 0), 0);
    const maj = await supabase.from("kit_composants").update({ composant_id: refId, quantite: total }).eq("id", garde.id);
    if (maj.error) return maj.error.message;
    const aSupprimer = rows.filter(r => r.id !== garde.id).map(r => r.id);
    if (aSupprimer.length > 0) {
      const sup = await supabase.from("kit_composants").delete().in("id", aSupprimer);
      if (sup.error) return sup.error.message;
    }
  }
  return null;
}

// Brouillons de pré-devis (clients.predevis_config) : les identifiants de produits fusionnés y sont
// remplacés par celui du produit de référence (les ids d'offres, eux, ne changent pas).
async function reprendreBrouillons(refId: string, idsAutres: string[]): Promise<string | null> {
  const { data, error } = await supabase.from("clients").select("id, predevis_config").not("predevis_config", "is", null);
  if (error) return error.message;
  for (const c of (data ?? []) as { id: string; predevis_config: string | null }[]) {
    let texte = c.predevis_config ?? "";
    let change = false;
    // Les ids figurent dans le JSON comme valeurs entre guillemets : on ne remplace que ces valeurs exactes.
    for (const id of idsAutres) {
      const cible = `"${id}"`;
      if (texte.includes(cible)) { texte = texte.split(cible).join(`"${refId}"`); change = true; }
    }
    if (!change) continue;
    const maj = await supabase.from("clients").update({ predevis_config: texte }).eq("id", c.id);
    if (maj.error) return maj.error.message;
  }
  return null;
}

// Fusionne `produits` (référence comprise, avec leurs offres attachées) dans le produit `referenceId`.
export async function fusionnerProduits(userId: string, referenceId: string, produits: Produit[], nomFinal: string): Promise<ResultatFusion> {
  const avertissements: string[] = [];
  const ref = produits.find(p => p.id === referenceId);
  const autres = produits.filter(p => p.id !== referenceId);
  if (!ref || autres.length === 0) return { ok: false, erreur: "Sélectionne au moins deux produits.", avertissements, nbOffres: 0 };
  const echec = (erreur: string): ResultatFusion => ({ ok: false, erreur: messageErreurOffres(erreur), avertissements, nbOffres: 0 });
  const idsAutres = autres.map(p => p.id);

  // La colonne marque doit exister (migration 006) : on le vérifie avant de toucher à quoi que ce soit.
  const test = await supabase.from("prestation_fournisseurs").select("marque").limit(1);
  if (test.error) return echec(test.error.message);

  const errKits = await reprendreKits(referenceId, idsAutres);
  if (errKits) return echec(`Kits : ${errKits}`);

  const majDevis = await supabase.from("devis_lignes").update({ prestation_id: referenceId }).in("prestation_id", idsAutres);
  if (majDevis.error) return echec(`Lignes de devis : ${majDevis.error.message}`);

  const errBrouillons = await reprendreBrouillons(referenceId, idsAutres);
  if (errBrouillons) avertissements.push(`Brouillons de pré-devis non mis à jour : ${errBrouillons}`);

  // ── Offres ──
  const marqueRef = (ref.marque ?? "").trim();
  const offresRef = offresTriees(ref.fournisseurs);
  // État connu des offres du produit de référence (sert à ne pas recréer une offre déjà là).
  const connues: { marque: string | null; prix_achat: number | null; prix_vente: number | null; url: string | null }[] = [];
  const urls: string[] = [];
  const ajouterUrl = (u?: string | null) => { if (u && !urls.includes(u)) urls.push(u); };
  let ordre = offresRef.length;
  let nbOffres = offresRef.length;

  for (const o of offresRef) {
    ajouterUrl(o.url);
    connues.push({ marque: marqueOffre(ref, o) || null, prix_achat: o.prix_achat ?? null, prix_vente: o.prix_vente ?? null, url: o.url ?? null });
    if (!(o.marque ?? "").trim() && marqueRef) {
      const maj = await supabase.from("prestation_fournisseurs").update({ marque: marqueRef }).eq("id", o.id);
      if (maj.error) return echec(`Offres : ${maj.error.message}`);
    }
  }

  // Offres synthétisées pour un produit encore sans offre (créé avant les fournisseurs multiples) : ses
  // anciens champs (marque, prix d'achat, prix de vente, liens) deviennent des offres. Une offre déjà
  // présente à l'identique n'est pas recréée.
  const offresSynthetiques = (p: Produit, principale: boolean): object[] => {
    const lignes: object[] = [];
    normaliserDrafts(draftsDepuisLegacy(p)).forEach((o, i) => {
      if (offreEquivalente(connues, o)) return;
      connues.push({ marque: o.marque, prix_achat: o.prix_achat, prix_vente: o.prix_vente, url: o.url });
      ajouterUrl(o.url);
      lignes.push({
        user_id: userId, prestation_id: referenceId, fournisseur: o.fournisseur,
        reference: o.reference, url: o.url, prix_achat: o.prix_achat, prix_vente: o.prix_vente,
        principal: principale && i === 0, ordre: ordre++, updated_at: new Date().toISOString(),
        ...(o.marque ? { marque: o.marque } : {}),
      });
    });
    return lignes;
  };
  const inserer = async (lignes: object[]): Promise<string | null> => {
    if (lignes.length === 0) return null;
    const ins = await supabase.from("prestation_fournisseurs").insert(lignes);
    if (ins.error) return ins.error.message;
    nbOffres += lignes.length;
    return null;
  };

  if (offresRef.length === 0) {
    const err = await inserer(offresSynthetiques(ref, true));
    if (err) return echec(`Offres : ${err}`);
  }

  for (const p of autres) {
    const offres = offresTriees(p.fournisseurs);
    if (offres.length === 0) {
      const err = await inserer(offresSynthetiques(p, false));
      if (err) return echec(`Offres : ${err}`);
    }
    for (const o of offres) {
      const marque = marqueOffre(p, o);
      const maj = await supabase.from("prestation_fournisseurs").update({
        prestation_id: referenceId, principal: false, ordre: ordre++, updated_at: new Date().toISOString(),
        ...(marque ? { marque } : {}),
      }).eq("id", o.id);
      if (maj.error) return echec(`Offres : ${maj.error.message}`);
      connues.push({ marque: marque || null, prix_achat: o.prix_achat ?? null, prix_vente: o.prix_vente ?? null, url: o.url ?? null });
      ajouterUrl(o.url);
      nbOffres += 1;
    }
    // Les offres de ce produit sont en place : on le masque tout de suite (il ne sera plus retraité).
    const masque = await supabase.from("prestations").update({ actif: false }).eq("id", p.id);
    if (masque.error) return echec(`« ${p.nom} » : ses offres sont regroupées mais il n'a pas pu être masqué : ${masque.error.message}`);
  }

  // ── Produit de référence ──
  const nom = nomFinal.trim() || ref.nom;
  const image = ref.image_url || autres.find(p => p.image_url)?.image_url || null;
  const description = ref.description || autres.find(p => p.description)?.description || null;
  const majRef = await supabase.from("prestations").update({
    nom, image_url: image, description, liens_fournisseurs: urls,
  }).eq("id", referenceId);
  if (majRef.error) return echec(`Produit : ${majRef.error.message}`);

  return { ok: true, avertissements, nbOffres };
}
