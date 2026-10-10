// Pièce RÉELLE d'un appareillage : celle où il se trouve physiquement, pas forcément celle dont il touche le mur.
//
// Un appareillage est rattaché (Piece.appareillages) à la pièce dont il longe le mur. Posé sur la FAÇADE extérieure de ce
// mur (une prise contre le mur des WC, mais dehors), il reste rattaché aux WC alors qu'il est dehors — ou dans la pièce voisine.
// Pour tout ce qui se compte « par pièce » (pré-devis, minimum de prises, famille de circuit : une prise dehors est
// une prise extérieure), on lui donne donc la pièce qui le CONTIENT, et à défaut une pièce « Extérieur ».
import { AppareillagePlace, Niveau, Piece, pointDansPolygone, EXTERIEUR_PIECE_ID } from "@/lib/maison-types";
import { estMural } from "@/lib/appareillage-mur";
import { ancrageMural } from "@/lib/zones";

export const NOM_EXTERIEUR = "Extérieur";

// Pièce virtuelle « Extérieur » d'un niveau (jamais enregistrée dans le plan) : sans contour, id négatif propre au niveau.
export function pieceExterieureVirtuelle(niveau: Niveau): Piece {
  return { id: -Math.abs(niveau.id) - 1, nom: NOM_EXTERIEUR, type: "exterieur", contour: [], appareillages: [] } as Piece;
}

// Pièce par défaut (automatique) : celle dont l'appareillage longe le mur — sauf s'il est posé sur la FAÇADE d'un mur et qu'aucune
// pièce ne le contient : il est alors dehors (« Extérieur »). Une prise dans un placard ou une pièce imbriquée reste dans sa pièce.
export function pieceAutoDe(a: AppareillagePlace, proprietaire: Piece, niveau: Niveau, exterieur?: Piece): Piece {
  if (!estMural(a.type) || proprietaire.type === "exterieur") return proprietaire;
  const pt = { x: a.x, y: a.y };
  const anc = ancrageMural(pt, proprietaire, niveau.zones ?? []);
  if (!anc || !anc.facade || anc.cloison) return proprietaire;
  const contenue = niveau.pieces.some(p => p.contour.length >= 3 && pointDansPolygone(pt, p.contour));
  return contenue ? proprietaire : (exterieur ?? pieceExterieureVirtuelle(niveau));
}

// Pièce réelle : le choix manuel (pieceAttribueeId) l'emporte sur l'automatique.
export function pieceReelleDe(a: AppareillagePlace, proprietaire: Piece, niveau: Niveau, exterieur?: Piece): Piece {
  if (a.pieceAttribueeId != null) {
    if (a.pieceAttribueeId === EXTERIEUR_PIECE_ID) return exterieur ?? pieceExterieureVirtuelle(niveau);
    const choisie = niveau.pieces.find(p => p.id === a.pieceAttribueeId);
    if (choisie) return choisie;      // pièce supprimée entre-temps : on retombe sur l'automatique
  }
  return pieceAutoDe(a, proprietaire, niveau, exterieur);
}

// Appareillages de chaque pièce RÉELLE du niveau (clé = id de pièce ; la pièce virtuelle « Extérieur » y figure si elle sert).
export function appareillagesParPieceReelle(niveau: Niveau): { pieces: Map<number, { piece: Piece; apps: AppareillagePlace[] }>; vers: Map<number, Piece> } {
  const exterieur = pieceExterieureVirtuelle(niveau);
  const pieces = new Map<number, { piece: Piece; apps: AppareillagePlace[] }>();
  const vers = new Map<number, Piece>();
  niveau.pieces.forEach(p => pieces.set(p.id, { piece: p, apps: [] }));
  niveau.pieces.forEach(p => p.appareillages.forEach(a => {
    const r = pieceReelleDe(a, p, niveau, exterieur);
    if (!pieces.has(r.id)) pieces.set(r.id, { piece: r, apps: [] });
    pieces.get(r.id)!.apps.push(a);
    vers.set(a.id, r);
  }));
  return { pieces, vers };
}
