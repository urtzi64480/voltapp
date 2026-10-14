// src/lib/gtl-agencement.ts
//
// AGENCEMENT PHYSIQUE de la GTL en élévation (vue de face, à l'échelle) : où se posent le coffret de distribution et
// le coffret de communication, et où passent les gaines. Fonction pure. Les coordonnées sont en mm : x depuis le bord gauche de la GTL,
// y = hauteur depuis le sol (le dessin inverse l'axe). La norme alerte, elle ne bloque jamais : un conflit est signalé, jamais refusé.

import type { ParamsTableauReel, ResultatTableauReel } from "./tableau-reel";
import { NORME_GTL } from "./normes-nfc";

export type IdElementGtl = "coffret" | "comm";
export interface ElementGtl {
  id: IdElementGtl;
  nom: string;
  x: number;
  /** Hauteur du bas de l'élément depuis le sol (mm). */
  y: number;
  w: number;
  h: number;
  /** Problème réel : chevauchement impossible à résoudre, dépasse du sol / du plafond, hors plage de hauteur. */
  conflit?: string;
  /** Information : l'élément a été décalé pour ne pas chevaucher un autre. */
  note?: string;
}

export interface AgencementGtl {
  largeurMm: number;
  hauteurMm: number;
  /** Largeur de la GTL + ETEL (null si pas d'ETEL). */
  largeurEtelMm: number | null;
  elements: ElementGtl[];
  /** Passage des gaines : elles arrivent par le plafond, au-dessus du coffret (x = bord gauche de la rangée, w = largeur de la rangée la plus large). */
  zoneGaines: { x: number; w: number };
  /** Vrai si les éléments + gaines dépassent la largeur de la GTL. */
  debordeLargeur: boolean;
}

const chevauche = (a: { y: number; h: number }, b: { y: number; h: number }, jeu: number) => a.y < b.y + b.h + jeu && b.y < a.y + a.h + jeu;

export function agencerGtl(res: ResultatTableauReel, p: ParamsTableauReel): AgencementGtl {
  const g = res.gtl, pg = p.gtl;
  const H = Math.max(1000, pg.hauteurSousPlafondM * 1000);
  const jeu = pg.jeuMm;
  const cof = res.coffret;
  const pas = p.pasRangeeMm;
  const coffretY = Math.max(0, p.basManetteM * 1000 - pas / 2 - 50);
  const largeurGtl = Math.max(g.largeurRetenueMm, 1);
  const zoneW = g.largeurGainesMm;
  const zoneX = Math.max(0, largeurGtl - zoneW);
  const empile = pg.agencement === "empile";
  const els: ElementGtl[] = [];

  const coffret: ElementGtl = { id: "coffret", nom: "Tableau de distribution", x: jeu, y: coffretY, w: cof.largeurMm, h: cof.hauteurMm };
  const comm: ElementGtl | null = pg.largeurCoffretCommMm > 0 ? { id: "comm", nom: "Coffret de communication", x: jeu, y: 300, w: pg.largeurCoffretCommMm, h: pg.hauteurCoffretCommMm } : null;

  if (empile) {
    // même colonne : on pose le coffret à la hauteur de ses manettes, puis la communication au-dessous
    if (comm) {
      comm.y = Math.max(0, Math.min(comm.y, coffret.y - jeu - comm.h));
      if (chevauche(comm, coffret, jeu)) {
        comm.conflit = "Pas la place sous le coffret : chevauchement";
      } else if (comm.y + comm.h > coffret.y - jeu + 1e-9) comm.conflit = "Pas la place sous le coffret";
    }
  } else {
    // côte à côte : de gauche à droite coffret de distribution, coffret de communication
    let x = jeu;
    [coffret, comm].forEach(e => { if (e) { e.x = x; x += e.w + jeu; } });
  }
  [coffret, comm].forEach(e => {
    if (!e) return;
    if (e.y + e.h > H + 1e-9) e.conflit = e.conflit ?? "Dépasse du plafond";
    els.push(e);
  });
  const xMax = els.reduce((m, e) => Math.max(m, e.x + e.w), 0);
  return {
    largeurMm: largeurGtl, hauteurMm: H, largeurEtelMm: g.largeurEtelMm, elements: els,
    zoneGaines: { x: zoneX, w: zoneW }, debordeLargeur: Math.max(xMax + jeu, zoneW) > largeurGtl + 1e-9,
  };
}
