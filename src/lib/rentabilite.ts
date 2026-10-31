// src/lib/rentabilite.ts
//
// Rentabilité GLOBALE (tous les devis signés), calculée avec exactement les mêmes formules que la page de rentabilité
// d'un devis (src/app/devis/[id]/rentabilite) : net = CA − cotisations − impôt − coût d'achat des matériaux.
// Pur (sans réseau) : la page charge les données et appelle ces fonctions.
//
// Type de chantier = catégorie du catalogue qui pèse le plus lourd dans le devis (en euros). Aucun champ « type de
// chantier » n'existe en base : on ne l'invente pas, on le déduit des lignes ; sans catégorie exploitable → « Autre ».
// Temps réel = minutes saisies dans le suivi de chantier des projets liés au devis (chantier.devis_id).
// Temps estimé = heures vendues sur le devis (lignes de service facturées à l'heure).
import { lireSuivi } from "@/lib/suivi-persistance";

export interface TauxRentabilite { cotisService: number; cotisMateriau: number; irService: number; irMateriau: number }
export const TAUX_PAR_DEFAUT: TauxRentabilite = { cotisService: 21.2, cotisMateriau: 12.3, irService: 0, irMateriau: 0 };

export function tauxDepuisProfil(p: { taux_cotisations_service?: number | null; taux_cotisations_materiau?: number | null; taux_ir_service?: number | null; taux_ir_materiau?: number | null } | null | undefined): TauxRentabilite {
  return {
    cotisService: p?.taux_cotisations_service ?? TAUX_PAR_DEFAUT.cotisService,
    cotisMateriau: p?.taux_cotisations_materiau ?? TAUX_PAR_DEFAUT.cotisMateriau,
    irService: p?.taux_ir_service ?? TAUX_PAR_DEFAUT.irService,
    irMateriau: p?.taux_ir_materiau ?? TAUX_PAR_DEFAUT.irMateriau,
  };
}

export const TYPE_AUTRE = "Autre";
const arrondi = (n: number, d = 2) => { const f = 10 ** d; return Math.round((n + Number.EPSILON) * f) / f; };
const nombre = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export interface LigneRentab {
  prestation_id?: string | null;
  quantite?: number | null;
  prix_unitaire?: number | null;
  type_branche?: string | null;
  unite?: string | null;
  fournisseur_id?: string | null;
  prix_achat?: number | null;
}
export interface DevisRentab { id: string; numero?: string; objet?: string | null; total_service?: number | null; total_materiau?: number | null; total_ttc?: number | null }
export interface InfoPrestation { categorie?: string | null; prix_achat?: number | null; est_kit?: boolean | null }

/** Coût d'achat unitaire par prestation : article = prix_achat ; kit = Σ quantité × prix d'achat du composant. */
export function construirePrixAchatMap(
  prestations: ({ id: string } & InfoPrestation)[],
  composants: { kit_id: string; composant_id: string; quantite?: number | null }[],
): Record<string, number> {
  const map: Record<string, number> = {};
  const parId = new Map(prestations.map(p => [p.id, p]));
  prestations.forEach(p => { if (!p.est_kit) map[p.id] = nombre(p.prix_achat); });
  composants.forEach(c => {
    const kit = parId.get(c.kit_id);
    if (!kit?.est_kit) return;
    map[c.kit_id] = (map[c.kit_id] ?? 0) + nombre(c.quantite) * nombre(parId.get(c.composant_id)?.prix_achat);
  });
  return map;
}

/** Heures vendues : somme des quantités des lignes de SERVICE à l'heure. */
export function heuresEstimees(lignes: LigneRentab[]): number {
  const h = lignes
    .filter(l => l.type_branche === "service" && /^(h|heure|heures)$/i.test((l.unite ?? "").trim()))
    .reduce((a, l) => a + nombre(l.quantite), 0);
  return arrondi(h, 2);
}

/** Minutes saisies sur le chantier (circuits + postes) pour les projets rattachés à ce devis. */
export function minutesReelles(devisId: string, projets: { suivi_realisation?: string | null }[]): number {
  let total = 0;
  for (const p of projets) {
    const s = lireSuivi(p.suivi_realisation);
    if (s.chantier.devis_id !== devisId) continue;
    total += Object.values(s.temps).reduce((a, m) => a + m, 0) + Object.values(s.tempsPostes).reduce((a, m) => a + m, 0);
  }
  return total;
}

/** Catégorie du catalogue la plus lourde (en euros) du devis, « Autre » si aucune ligne ne peut être rattachée. */
export function typeChantier(lignes: LigneRentab[], prestations: Record<string, InfoPrestation>): string {
  const poids = new Map<string, number>();
  for (const l of lignes) {
    const cat = l.prestation_id ? (prestations[l.prestation_id]?.categorie ?? "").trim() : "";
    if (!cat) continue;
    poids.set(cat, (poids.get(cat) ?? 0) + Math.abs(nombre(l.prix_unitaire) * nombre(l.quantite)));
  }
  let best = TYPE_AUTRE, max = 0;
  poids.forEach((v, k) => { if (v > max || (v === max && max > 0 && k.localeCompare(best, "fr") < 0)) { best = k; max = v; } });
  return best;
}

export interface ResultatDevis {
  id: string; numero: string; objet: string; type: string;
  ca: number; coutAchat: number; cotisations: number; impots: number; net: number; margePct: number | null;
  lignesSansCout: number; heuresEstimees: number; heuresReelles: number | null;
}

export function analyserDevis(
  devis: DevisRentab, lignes: LigneRentab[], prixAchatMap: Record<string, number>,
  prestations: Record<string, InfoPrestation>, taux: TauxRentabilite, minutesReellesChantier: number,
): ResultatDevis {
  let coutAchat = 0, lignesSansCout = 0;
  for (const l of lignes) {
    const aFournisseur = !!l.fournisseur_id || l.prix_achat != null;
    const unit = aFournisseur ? (l.prix_achat ?? null) : (l.prestation_id ? (prixAchatMap[l.prestation_id] ?? null) : null);
    const cout = unit && unit > 0 ? unit * nombre(l.quantite) : 0;
    coutAchat += cout;
    if (l.type_branche === "materiau" && cout === 0) lignesSansCout++;
  }
  const ts = nombre(devis.total_service), tm = nombre(devis.total_materiau), ttc = nombre(devis.total_ttc);
  const cotisations = ts * taux.cotisService / 100 + tm * taux.cotisMateriau / 100;
  const impots = ts * taux.irService / 100 + tm * taux.irMateriau / 100;
  // Identique à la page d'un devis : net = CA − cotisations − impôt − coût d'achat ; marge rapportée au total TTC du devis.
  const net = ts + tm - cotisations - impots - coutAchat;
  return {
    id: devis.id, numero: devis.numero ?? "", objet: devis.objet ?? "", type: typeChantier(lignes, prestations),
    ca: arrondi(ttc), coutAchat: arrondi(coutAchat), cotisations: arrondi(cotisations), impots: arrondi(impots),
    net: arrondi(net), margePct: ttc > 0 ? arrondi((net / ttc) * 100, 1) : null,
    lignesSansCout, heuresEstimees: heuresEstimees(lignes),
    heuresReelles: minutesReellesChantier > 0 ? arrondi(minutesReellesChantier / 60, 2) : null,
  };
}

export interface GroupeType {
  type: string; nbDevis: number; ca: number; net: number; margePct: number | null;
  heuresEstimees: number; heuresReelles: number; nbAvecTempsReel: number;
  /** (réel − estimé) / estimé, sur les seuls devis qui ont un temps réel saisi — null si non comparable. */
  ecartHeuresPct: number | null;
  /** Net par heure réellement passée (sur les devis chronométrés) — null si aucune heure saisie. */
  netParHeure: number | null;
  incomplet: boolean; // au moins une ligne matériau sans prix d'achat : la marge est surestimée
}

export function grouperParType(resultats: ResultatDevis[]): GroupeType[] {
  const map = new Map<string, ResultatDevis[]>();
  resultats.forEach(r => map.set(r.type, [...(map.get(r.type) ?? []), r]));
  const groupes: GroupeType[] = [];
  map.forEach((rs, type) => {
    const ca = rs.reduce((a, r) => a + r.ca, 0), net = rs.reduce((a, r) => a + r.net, 0);
    const chrono = rs.filter(r => r.heuresReelles != null);
    const hReel = chrono.reduce((a, r) => a + (r.heuresReelles ?? 0), 0);
    const hEstChrono = chrono.reduce((a, r) => a + r.heuresEstimees, 0);
    const netChrono = chrono.reduce((a, r) => a + r.net, 0);
    groupes.push({
      type, nbDevis: rs.length, ca: arrondi(ca), net: arrondi(net), margePct: ca > 0 ? arrondi((net / ca) * 100, 1) : null,
      heuresEstimees: arrondi(rs.reduce((a, r) => a + r.heuresEstimees, 0), 2), heuresReelles: arrondi(hReel, 2), nbAvecTempsReel: chrono.length,
      ecartHeuresPct: hEstChrono > 0 && chrono.length > 0 ? arrondi(((hReel - hEstChrono) / hEstChrono) * 100, 1) : null,
      netParHeure: hReel > 0 ? arrondi(netChrono / hReel, 2) : null,
      incomplet: rs.some(r => r.lignesSansCout > 0),
    });
  });
  return groupes.sort((a, b) => b.net - a.net || a.type.localeCompare(b.type, "fr"));
}
