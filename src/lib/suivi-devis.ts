// src/lib/suivi-devis.ts
//
// SUIVI DE CHANTIER D'UN DEVIS (avec ou sans plan) : chaque ligne du devis est une étape à cocher, le temps réellement passé
// se note par poste, et le bilan le compare aux heures chiffrées dans le devis. Même format de stockage que le suivi d'un plan
// (colonne suivi_realisation, voir suivi-persistance) : coches = « ligne:<id> » → date, temps passé = tempsPostes[poste].
// Module PUR (aucun accès réseau).
import { posteDe, trierParOrdre } from "@/lib/postes";
import { lireSuivi, type Coches, type Minutes } from "@/lib/suivi-persistance";

export const POSTE_HORS = "Hors poste";

export interface LigneDevisSuivi {
  id?: string; nom: string; quantite?: number | null; prix_unitaire?: number | null; unite?: string | null;
  type_branche?: string | null; poste?: string | null; ordre?: number | null;
}
export interface EtapeDevis { cle: string; ligne: LigneDevisSuivi }
export interface GroupeDevis { poste: string; etapes: EtapeDevis[] }

/** Clé stable d'une ligne : son identifiant en base (sinon sa position, pour un devis pas encore enregistré). */
export const cleLigne = (l: LigneDevisSuivi, index: number): string => l.id ? `ligne:${l.id}` : `ligne#${index}`;

const estHeure = (u?: string | null) => /^(h|heure|heures)$/i.test((u ?? "").trim());

/** Étapes regroupées par poste (ordre du devis), « Hors poste » à la fin. */
export function groupesDevis(lignes: LigneDevisSuivi[]): GroupeDevis[] {
  const ordonnees = trierParOrdre(lignes);
  const groupes: GroupeDevis[] = [];
  const parNom = new Map<string, GroupeDevis>();
  ordonnees.forEach(l => {
    const nom = posteDe(l) ?? POSTE_HORS;
    let g = parNom.get(nom);
    if (!g) { g = { poste: nom, etapes: [] }; parNom.set(nom, g); groupes.push(g); }
    g.etapes.push({ cle: cleLigne(l, lignes.indexOf(l)), ligne: l });
  });
  return groupes.sort((a, b) => (a.poste === POSTE_HORS ? 1 : 0) - (b.poste === POSTE_HORS ? 1 : 0));
}

export interface Avancement { fait: number; total: number; pct: number }
/** Avancement d'un ensemble d'étapes (les coches de lignes supprimées depuis sont ignorées). */
export function avancement(etapes: EtapeDevis[], coches: Coches): Avancement {
  const fait = etapes.filter(e => !!coches[e.cle]).length;
  return { fait, total: etapes.length, pct: etapes.length > 0 ? Math.round((fait / etapes.length) * 100) : 0 };
}

export interface PosteBilan { poste: string; chiffreMin: number; passeMin: number }
export interface BilanDevis {
  postes: PosteBilan[]; totalChiffreMin: number; totalPasseMin: number;
  montantMO: number;          // € de main d'œuvre facturée (lignes en heures)
  tauxReel: number | null;    // €/h réel = montantMO / heures passées
  ecartPct: number | null;    // (passé − chiffré) / chiffré, null si l'un des deux manque
}

/** Heures chiffrées (lignes en heures, par poste) contre temps passé (par poste). Le temps d'un poste disparu compte au total. */
export function bilanDevis(lignes: LigneDevisSuivi[], tempsPostes: Minutes): BilanDevis {
  const chiffre = new Map<string, number>();
  let montant = 0;
  groupesDevis(lignes).forEach(g => {
    chiffre.set(g.poste, 0);
    g.etapes.forEach(({ ligne: l }) => {
      if (!estHeure(l.unite) || !((l.quantite ?? 0) > 0)) return;
      chiffre.set(g.poste, (chiffre.get(g.poste) ?? 0) + Math.round((l.quantite as number) * 60));
      montant += (l.quantite as number) * (l.prix_unitaire ?? 0);
    });
  });
  const postes: PosteBilan[] = [...chiffre.entries()].map(([poste, chiffreMin]) => ({ poste, chiffreMin, passeMin: tempsPostes[poste] ?? 0 }));
  Object.entries(tempsPostes).forEach(([poste, m]) => { if (!chiffre.has(poste) && m > 0) postes.push({ poste, chiffreMin: 0, passeMin: m }); });
  const totalChiffreMin = postes.reduce((a, p) => a + p.chiffreMin, 0);
  const totalPasseMin = postes.reduce((a, p) => a + p.passeMin, 0);
  return {
    postes, totalChiffreMin, totalPasseMin, montantMO: Math.round(montant * 100) / 100,
    tauxReel: totalPasseMin > 0 && montant > 0 ? Math.round((montant / (totalPasseMin / 60)) * 100) / 100 : null,
    ecartPct: totalChiffreMin > 0 && totalPasseMin > 0 ? Math.round(((totalPasseMin - totalChiffreMin) / totalChiffreMin) * 100) : null,
  };
}

/** Minutes de temps passé enregistrées dans un suivi (circuits + postes). */
export function minutesDuSuivi(raw: string | null | undefined): number {
  const s = lireSuivi(raw);
  return Object.values(s.temps).reduce((a, m) => a + m, 0) + Object.values(s.tempsPostes).reduce((a, m) => a + m, 0);
}
