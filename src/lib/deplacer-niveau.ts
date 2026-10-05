// Déplacement d'un niveau entier : translation (dx, dy) en mètres de TOUT ce qui porte une coordonnée sur le plan — pièces
// (contour, appareillages, meubles, personne, voiture), zones, tableau, point d'arrivée des gaines, boîtes de dérivation,
// coudes de liaison, escaliers. Les portes / fenêtres (index de côté + position relative), l'étiquette des pièces
// (décalage relatif au centre) et les épaisseurs de murs ne dépendent pas de la position : ils suivent sans rien faire.
//
// Fonction pure : renvoie un NOUVEAU niveau et ne modifie jamais celui qu'on lui donne — on peut donc toujours repartir du
// niveau d'origine pour appliquer un décalage absolu (et annuler en le restituant).

import type { Niveau, Point } from "@/lib/maison-types";

const arrondi = (v: number) => Math.round(v * 10000) / 10000;   // 0,1 mm : pas de dérive de virgule flottante

export function decalerNiveau(n: Niveau, dx: number, dy: number): Niveau {
  const pt = (p: Point): Point => ({ ...p, x: arrondi(p.x + dx), y: arrondi(p.y + dy) });
  const xy = <T extends { x: number; y: number }>(o: T): T => ({ ...o, x: arrondi(o.x + dx), y: arrondi(o.y + dy) });

  const res: Niveau = {
    ...n,
    pieces: n.pieces.map(p => ({
      ...p,
      contour: p.contour.map(pt),
      appareillages: p.appareillages.map(xy),
      ...(p.meubles ? { meubles: p.meubles.map(xy) } : {}),
      ...(p.personne ? { personne: xy(p.personne) } : {}),
      ...(p.voiture ? { voiture: xy(p.voiture) } : {}),
    })),
  };
  if (n.zones) res.zones = n.zones.map(z => ({ ...z, contour: z.contour.map(pt) }));
  if (n.tableauPos) res.tableauPos = pt(n.tableauPos);
  if (n.pointArriveeGaines) res.pointArriveeGaines = pt(n.pointArriveeGaines);
  if (n.escaliers) res.escaliers = n.escaliers.map(xy);
  if (n.boitesDerivation) {
    res.boitesDerivation = Object.fromEntries(Object.entries(n.boitesDerivation).map(([label, liste]) => [
      label, Array.isArray(liste) ? liste.map(b => ({ ...b, point: pt(b.point) })) : liste,
    ]));
  }
  if (n.liaisonWaypoints) {
    res.liaisonWaypoints = Object.fromEntries(Object.entries(n.liaisonWaypoints).map(([cle, liste]) => [
      cle, Array.isArray(liste) ? liste.map(w => ({ ...w, point: pt(w.point) })) : liste,
    ]));
  }
  return res;
}
