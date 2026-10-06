// Altitude (m) du sol de chaque niveau, pour la vue 3D de toute la maison. Fonction pure.
//
// Les niveaux de la maison (hors annexes) sont empilés par ordre croissant : l'écart entre deux niveaux successifs est la
// hauteur à franchir par l'escalier qui les relie s'il existe (même valeur que celle de l'escalier, donc il se raccorde
// exactement au plancher), sinon hauteur sous plafond du niveau du dessous + épaisseur de plancher par défaut.
// L'altitude 0 est celle du RDC (à défaut, du niveau le plus bas) : un sous-sol est donc négatif. Une annexe est une
// construction à part, posée au sol (altitude 0).

import { Niveau, estAnnexe } from "@/lib/maison-types";
import { hauteurTotaleEscalierCm, EPAISSEUR_PLANCHER_DEFAUT_CM } from "@/lib/escaliers";

export function altitudesNiveaux(niveaux: Niveau[]): Map<number, number> {
  const maison = niveaux.filter(n => !estAnnexe(n)).sort((a, b) => a.ordre - b.ordre);
  const alt = new Map<number, number>();
  let cumul = 0;
  maison.forEach((n, i) => {
    if (i > 0) {
      const dessous = maison[i - 1];
      const esc = (dessous.escaliers ?? []).find(e => e.niveauDestId === n.id);
      const hCm = esc ? hauteurTotaleEscalierCm(esc, dessous) : Math.round((dessous.hauteurPlafond ?? 2.5) * 100 + EPAISSEUR_PLANCHER_DEFAUT_CM);
      cumul += hCm / 100;
    }
    alt.set(n.id, cumul);
  });
  const reference = maison.find(n => n.type === "rdc") ?? maison[0];
  const base = reference ? (alt.get(reference.id) ?? 0) : 0;
  maison.forEach(n => alt.set(n.id, (alt.get(n.id) ?? 0) - base));
  niveaux.filter(estAnnexe).forEach(n => alt.set(n.id, 0));
  return alt;
}
