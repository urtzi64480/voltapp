// src/lib/courses-prix.ts
//
// VUE PRIVÉE « prix et marge » de la liste de courses d'un devis (page artisan /devis/[id]/courses, à l'écran uniquement).
// Pour chaque matériau du devis : le prix de vente annoncé au client, mon prix d'achat (TTC et HT) et le prix d'achat MAXIMUM
// (TTC et HT) au-delà duquel la ligne est vendue à perte une fois les cotisations déduites.
//
// CONFIDENTIALITÉ : ces chiffres révèlent la marge. Ce module n'est importé que par la page privée — jamais par la liste publique
// /liste/[token] ni par les exports (courseExport.ts : texte / PDF de la liste, sans aucun prix).
//
// TVA : le prix d'achat est stocké en TTC (prestations.prix_achat / prestation_fournisseurs.prix_achat) ; en franchise en base de TVA
// cette TVA n'est pas récupérable, c'est le vrai coût. Le HT s'en déduit avec la TVA à 20 % utilisée partout dans l'app (éditeur
// d'article du catalogue : HT × 1,2 = TTC). Le plafond est calculé en TTC (comme la rentabilité du devis), puis converti en HT.
//
// Module PUR (aucun accès réseau).
import { prixAchatMax, type TauxRentabilite } from "@/lib/rentabilite";

export const TVA_ACHAT_PCT = 20;
const COEF_TVA = 1 + TVA_ACHAT_PCT / 100;

const arrondi2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
// Plafond : toujours arrondi vers le BAS (jamais affiché trop haut).
const plancher2 = (n: number) => Math.floor(n * 100 + 1e-9) / 100;
const nombre = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Prix HT d'un prix d'achat TTC (TVA 20 %), au centime. */
export const achatHtDepuisTtc = (ttc: number) => arrondi2(ttc / COEF_TVA);

export interface LignePrix {
  cle: string;
  nom: string;
  offreId: string | null;           // offre fournisseur retenue sur la ligne (pour son lien produit)
  prestationId: string | null;      // produit du catalogue (lien de repli quand la ligne n'a pas d'offre)
  qty: number;
  unite?: string;
  reference?: string;
  venteUnitaire: number;            // prix annoncé au client sur le devis
  venteTotal: number;
  achatTtcUnitaire: number | null;  // null = prix d'achat non renseigné
  achatHtUnitaire: number | null;
  achatTtcTotal: number | null;
  achatHtTotal: number | null;
  maxTtcUnitaire: number;           // plafond d'achat sans vente à perte
  maxHtUnitaire: number;
  maxTtcTotal: number;
  maxHtTotal: number;
  aPerte: boolean;                  // prix d'achat renseigné au-dessus du plafond
}

export interface TotauxPrix { vente: number; achatTtc: number; achatHt: number; maxTtc: number; maxHt: number }

export interface GroupePrix {
  fournisseur: string | null;
  lignes: LignePrix[];
  totaux: TotauxPrix;   // lignes qui ont un prix d'achat uniquement (périmètre égal entre vente, achat et plafond)
  sansPrix: number;     // lignes sans prix d'achat, exclues des totaux
}

export interface VuePrix {
  groupes: GroupePrix[];
  totaux: TotauxPrix;
  nbAPerte: number;
  nbSansPrix: number;
  nbKitsIgnores: number; // lignes kit : pas de prix d'achat par composant, non chiffrables
}

/** Clé de regroupement d'une ligne de devis dans la vue prix (même nom, mêmes prix) — aussi utilisée pour rattacher un prix à une case. */
export function clePrixLigne(l: any): string {
  const achat = l.prix_achat != null ? nombre(l.prix_achat) : null;
  return `${String(l.nom).toLowerCase()}|${achat ?? "?"}|${nombre(l.prix_unitaire)}`;
}

/** Lien produit utilisable : http(s) uniquement (un lien saisi sans protocole reçoit https://). Tout autre schéma (javascript:, data:…) est refusé. */
export function urlProduitSure(brut: unknown): string | null {
  const t = String(brut ?? "").trim();
  if (!t) return null;
  const avecProtocole = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(avecProtocole);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch { return null; }
}

/** Nom court du site d'un lien (« rexel.fr »), pour l'afficher à la place de l'adresse complète. */
export function siteDeUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

const totauxVides = (): TotauxPrix => ({ vente: 0, achatTtc: 0, achatHt: 0, maxTtc: 0, maxHt: 0 });

/**
 * lignes : lignes du devis (devis_lignes). taux : cotisations / IR du profil. facteurRemise : part du prix réellement encaissée quand
 * le devis a une remise matériaux (voir rentabilite.facteurRemiseMateriau) — elle ne joue que sur le plafond, pas sur le prix annoncé.
 */
export function buildVuePrix(lignes: any[], taux: TauxRentabilite, facteurRemise = 1): VuePrix {
  const parFournisseur = new Map<string, Map<string, LignePrix>>();
  let nbKitsIgnores = 0;
  for (const l of lignes ?? []) {
    if (l.type_branche !== "materiau") continue;
    if (l.kit_ratio_service != null) { nbKitsIgnores++; continue; }
    const fournisseur = String(l.fournisseur_nom ?? "").trim();
    const qty = l.quantite || 1;
    const achatTtcUnitaire: number | null = l.prix_achat != null ? nombre(l.prix_achat) : null;
    const venteUnitaire = nombre(l.prix_unitaire);
    const cle = clePrixLigne(l);
    const groupe = parFournisseur.get(fournisseur) ?? new Map<string, LignePrix>();
    const existante = groupe.get(cle);
    if (existante) {
      existante.qty += qty;
    } else {
      const maxTtcUnitaire = prixAchatMax(venteUnitaire, taux, facteurRemise);
      groupe.set(cle, {
        cle, nom: String(l.nom), offreId: l.fournisseur_id ? String(l.fournisseur_id) : null, prestationId: l.prestation_id ? String(l.prestation_id) : null,
        qty, unite: l.unite, reference: String(l.reference_fournisseur ?? "").trim() || undefined,
        venteUnitaire, venteTotal: 0,
        achatTtcUnitaire, achatHtUnitaire: achatTtcUnitaire == null ? null : achatHtDepuisTtc(achatTtcUnitaire), achatTtcTotal: null, achatHtTotal: null,
        maxTtcUnitaire, maxHtUnitaire: plancher2(maxTtcUnitaire / COEF_TVA), maxTtcTotal: 0, maxHtTotal: 0,
        aPerte: achatTtcUnitaire != null && achatTtcUnitaire > maxTtcUnitaire + 1e-9,
      });
    }
    parFournisseur.set(fournisseur, groupe);
  }

  const groupes: GroupePrix[] = [];
  const total = totauxVides();
  let nbAPerte = 0, nbSansPrix = 0;
  parFournisseur.forEach((map, nom) => {
    const lignesGroupe = Array.from(map.values()).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    const t = totauxVides();
    let sansPrix = 0;
    lignesGroupe.forEach(l => {
      l.venteTotal = arrondi2(l.venteUnitaire * l.qty);
      l.maxTtcTotal = arrondi2(l.maxTtcUnitaire * l.qty);
      l.maxHtTotal = plancher2((l.maxTtcUnitaire * l.qty) / COEF_TVA);
      if (l.achatTtcUnitaire == null) { sansPrix++; return; }
      l.achatTtcTotal = arrondi2(l.achatTtcUnitaire * l.qty);
      l.achatHtTotal = arrondi2((l.achatTtcUnitaire * l.qty) / COEF_TVA);
      t.vente += l.venteTotal; t.achatTtc += l.achatTtcTotal; t.achatHt += l.achatHtTotal; t.maxTtc += l.maxTtcTotal; t.maxHt += l.maxHtTotal;
      if (l.aPerte) nbAPerte++;
    });
    (Object.keys(t) as (keyof TotauxPrix)[]).forEach(k => { total[k] += t[k]; t[k] = arrondi2(t[k]); });
    nbSansPrix += sansPrix;
    groupes.push({ fournisseur: nom || null, lignes: lignesGroupe, totaux: t, sansPrix });
  });
  groupes.sort((a, b) => {
    if (a.fournisseur === null) return 1;
    if (b.fournisseur === null) return -1;
    return a.fournisseur.localeCompare(b.fournisseur, "fr");
  });
  (Object.keys(total) as (keyof TotauxPrix)[]).forEach(k => { total[k] = arrondi2(total[k]); });
  return { groupes, totaux: total, nbAPerte, nbSansPrix, nbKitsIgnores };
}

/**
 * Rattache les lignes de prix d'un fournisseur aux cases à cocher de la liste : chaque prix est affiché UNE seule fois, sur la première
 * case (dans l'ordre d'affichage) qui provient de cette ligne de devis — un article en plusieurs pièces a plusieurs cases, un seul prix.
 * Les lignes de prix qu'aucune case ne porte sont rendues dans `orphelines` : aucun prix n'est jamais perdu.
 */
export function associerPrixAuxCases(
  groupe: GroupePrix | undefined,
  cases: { key: string; sources?: any[] }[],
): { parCase: Map<string, LignePrix[]>; orphelines: LignePrix[] } {
  const parCase = new Map<string, LignePrix[]>();
  if (!groupe) return { parCase, orphelines: [] };
  const parCle = new Map(groupe.lignes.map(l => [l.cle, l] as const));
  const affichees = new Set<string>();
  for (const c of cases) {
    for (const src of c.sources ?? []) {
      if (!src || src.type_branche !== "materiau" || src.kit_ratio_service != null) continue;
      const cle = clePrixLigne(src);
      const ligne = parCle.get(cle);
      if (!ligne || affichees.has(cle)) continue;
      affichees.add(cle);
      parCase.set(c.key, [...(parCase.get(c.key) ?? []), ligne]);
    }
  }
  return { parCase, orphelines: groupe.lignes.filter(l => !affichees.has(l.cle)) };
}

/**
 * Prix d'achat PRÉVU (TTC, quantité comprise) de chaque case de la liste : somme des lignes de devis dont elle porte le prix. Sert au bilan
 * en direct (dépensé vs prévu). `groupes` = groupes affichés (vue par fournisseur) ; null = vue à plat, où chaque ligne de prix est
 * rattachée à la première case qui la contient, tous fournisseurs confondus.
 * Absent de la table = prix d'achat inconnu. 0 = case qui accompagne un autre article (pièce d'un article en plusieurs pièces) : son prix est
 * porté par la première case de l'article.
 */
export function prevuParCase(
  vue: VuePrix | null,
  groupes: { fournisseur: string | null; items: { key: string; sources?: any[] }[] }[] | null,
  itemsPlats: { key: string; sources?: any[] }[],
): Map<string, number> {
  const resultat = new Map<string, number>();
  if (!vue) return resultat;
  const ajouter = (groupe: GroupePrix | undefined, cases: { key: string; sources?: any[] }[]) => {
    if (!groupe) return;
    const parCle = new Map(groupe.lignes.map(l => [l.cle, l] as const));
    const attribuees = new Set<string>();
    for (const c of cases) {
      for (const src of c.sources ?? []) {
        if (!src || src.type_branche !== "materiau" || src.kit_ratio_service != null) continue;
        const ligne = parCle.get(clePrixLigne(src));
        if (!ligne || ligne.achatTtcTotal == null) continue;       // prix d'achat inconnu : la case reste absente
        const deja = attribuees.has(ligne.cle);
        attribuees.add(ligne.cle);
        resultat.set(c.key, arrondi2((resultat.get(c.key) ?? 0) + (deja ? 0 : ligne.achatTtcTotal)));
      }
    }
  };
  if (groupes) groupes.forEach(g => ajouter(vue.groupes.find(x => x.fournisseur === g.fournisseur), g.items));
  else vue.groupes.forEach(g => ajouter(g, itemsPlats));
  return resultat;
}
