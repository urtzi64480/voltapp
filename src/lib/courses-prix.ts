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
    const cle = `${String(l.nom).toLowerCase()}|${achatTtcUnitaire ?? "?"}|${venteUnitaire}`;
    const groupe = parFournisseur.get(fournisseur) ?? new Map<string, LignePrix>();
    const existante = groupe.get(cle);
    if (existante) {
      existante.qty += qty;
    } else {
      const maxTtcUnitaire = prixAchatMax(venteUnitaire, taux, facteurRemise);
      groupe.set(cle, {
        cle, nom: String(l.nom), qty, unite: l.unite, reference: String(l.reference_fournisseur ?? "").trim() || undefined,
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
