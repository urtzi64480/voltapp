// src/lib/predevis-mode.ts
// Changement de mode du pré-devis (par pièce ↔ par circuit) : les clés de besoin et les noms de postes changent, mais les quantités de matériel
// sont les mêmes. Pour ne pas perdre les articles déjà choisis, on les reporte par sous-catégorie quand tous les besoins concernés
// avaient fait le même choix. Fonctions pures.

export interface BesoinCle { cle: string; sousCategorie: string }

/**
 * Pour chaque nouveau besoin, l'état choisi dans l'ancien mode si TOUS les anciens besoins de la même sous-catégorie avaient exactement le même état
 * (sinon rien : mieux vaut le choix par défaut qu'un choix arbitraire). Les besoins sans équivalent sont absents du résultat.
 */
export function reporterChoix<E>(anciensBesoins: BesoinCle[], anciensChoix: Record<string, E>, nouveauxBesoins: BesoinCle[]): Record<string, E> {
  const parSousCat = new Map<string, { json: string; etat: E; unique: boolean }>();
  anciensBesoins.forEach(b => {
    const etat = anciensChoix[b.cle];
    if (etat === undefined) return;
    const json = JSON.stringify(etat);
    const e = parSousCat.get(b.sousCategorie);
    if (!e) parSousCat.set(b.sousCategorie, { json, etat, unique: true });
    else if (e.json !== json) e.unique = false;
  });
  const out: Record<string, E> = {};
  nouveauxBesoins.forEach(b => {
    const e = parSousCat.get(b.sousCategorie);
    if (e && e.unique) out[b.cle] = e.etat;
  });
  return out;
}
