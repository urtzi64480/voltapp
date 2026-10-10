// Pièce RÉELLE d'un appareillage : celle où il se trouve physiquement, pas forcément celle dont il touche le mur.
//
// Un appareillage est rattaché (Piece.appareillages) à la pièce dont il longe le mur. Posé sur la FAÇADE extérieure de ce
// mur (une prise contre le mur des WC, mais dehors), il reste rattaché aux WC alors qu'il est dehors — ou dans la pièce voisine.
// Pour tout ce qui se compte « par pièce » (pré-devis, minimum de prises, famille de circuit : une prise dehors est
// une prise extérieure), on lui donne donc la pièce qui le CONTIENT, et à défaut une pièce « Extérieur ».
import { AppareillagePlace, Niveau, Piece, aireDuPolygone, pointDansPolygone } from "@/lib/maison-types";
import { estMural } from "@/lib/appareillage-mur";
import { ancrageMural } from "@/lib/zones";

export const NOM_EXTERIEUR = "Extérieur";

// Pièce virtuelle « Extérieur » d'un niveau (jamais enregistrée dans le plan) : sans contour, id négatif propre au niveau.
export function pieceExterieureVirtuelle(niveau: Niveau): Piece {
  return { id: -Math.abs(niveau.id) - 1, nom: NOM_EXTERIEUR, type: "exterieur", contour: [], appareillages: [] } as Piece;
}

export function pieceReelleDe(a: AppareillagePlace, proprietaire: Piece, niveau: Niveau, exterieur?: Piece): Piece {
  if (!estMural(a.type) || proprietaire.type === "exterieur") return proprietaire;
  const pt = { x: a.x, y: a.y };
  const anc = ancrageMural(pt, proprietaire, niveau.zones ?? []);
  if (!anc || !anc.facade || anc.cloison) return proprietaire;      // contre une face intérieure ou une cloison : dans sa pièce
  const contenant = niveau.pieces
    .filter(p => p.id !== proprietaire.id && p.contour.length >= 3 && pointDansPolygone(pt, p.contour))
    .sort((x, y) => aireDuPolygone(x.contour) - aireDuPolygone(y.contour))[0];
  return contenant ?? exterieur ?? pieceExterieureVirtuelle(niveau);
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
