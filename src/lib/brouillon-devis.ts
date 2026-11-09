// src/lib/brouillon-devis.ts — brouillon local d'un NOUVEAU devis (pas encore créé en base, donc pas de numéro consommé).
// Enregistré sur l'appareil à chaque modification, proposé à la reprise au retour sur « Nouveau devis ». Pur, testé ; lecture tolérante :
// un brouillon illisible ou d'une autre version est ignoré, jamais une erreur.
export const CLE_BROUILLON_DEVIS = "voltapp:brouillon-devis";
const VERSION = 1;

export interface BrouillonDevis {
  v: number; le: string; clientId: string; apporteurId: string; objet: string; validite: number;
  lignes: Record<string, unknown>[]; postes: string[];
  remise: { service_type: "pct" | "eur"; service_val: string; materiau_type: "pct" | "eur"; materiau_val: string };
  remiseFidelitePct: number;
}

const txt = (x: unknown): string => (typeof x === "string" ? x : "");
const nb = (x: unknown, defaut: number): number => (typeof x === "number" && Number.isFinite(x) ? x : defaut);
const typeRemise = (x: unknown): "pct" | "eur" => (x === "eur" ? "eur" : "pct");

/** Rien d'utile à garder : ni ligne, ni poste, ni objet. */
export const brouillonVide = (b: Pick<BrouillonDevis, "lignes" | "postes" | "objet">): boolean =>
  b.lignes.length === 0 && b.postes.length === 0 && b.objet.trim() === "";

export function lireBrouillon(brut: string | null | undefined): BrouillonDevis | null {
  if (!brut) return null;
  try {
    const o = JSON.parse(brut) as Record<string, unknown>;
    if (!o || typeof o !== "object" || o.v !== VERSION) return null;
    const lignes = (Array.isArray(o.lignes) ? o.lignes : []).filter((l): l is Record<string, unknown> =>
      !!l && typeof l === "object" && typeof (l as Record<string, unknown>).nom === "string"
      && Number.isFinite(Number((l as Record<string, unknown>).prix_unitaire)) && Number.isFinite(Number((l as Record<string, unknown>).quantite)));
    const r = (o.remise && typeof o.remise === "object" ? o.remise : {}) as Record<string, unknown>;
    const b: BrouillonDevis = {
      v: VERSION, le: txt(o.le), clientId: txt(o.clientId), apporteurId: txt(o.apporteurId), objet: txt(o.objet),
      validite: Math.max(1, nb(o.validite, 60)),
      lignes, postes: (Array.isArray(o.postes) ? o.postes : []).filter((p): p is string => typeof p === "string" && p.trim() !== ""),
      remise: { service_type: typeRemise(r.service_type), service_val: txt(r.service_val), materiau_type: typeRemise(r.materiau_type), materiau_val: txt(r.materiau_val) },
      remiseFidelitePct: Math.max(0, nb(o.remiseFidelitePct, 0)),
    };
    return brouillonVide(b) ? null : b;
  } catch { return null; }
}

export function ecrireBrouillon(b: Omit<BrouillonDevis, "v" | "le">, maintenant: Date = new Date()): string {
  return JSON.stringify({ ...b, v: VERSION, le: maintenant.toISOString() });
}
