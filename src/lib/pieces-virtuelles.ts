// src/lib/pieces-virtuelles.ts
//
// PIÈCES VIRTUELLES d'un niveau : « Salle à manger », « Bureau »… créées à la main dans la liste des pièces d'un appareillage, pour
// les grands volumes dessinés d'un seul tenant (un séjour ouvert qui regroupe en fait plusieurs pièces). Elles sont enregistrées avec
// le niveau (Niveau.piecesVirtuelles) et proposées dans la liste, mais n'ont ni contour ni murs : elles n'apparaissent JAMAIS sur le plan.
// Un appareillage leur est rattaché par AppareillagePlace.pieceAttribueeId, comme à une pièce dessinée (voir piece-reelle.ts) ; pré-devis,
// circuits et suivi de chantier comptent alors ses appareils dans cette pièce. Fonctions pures, sans état : chacune renvoie un NOUVEAU niveau.

import { EXTERIEUR_PIECE_ID, PIECE_TYPES, type Niveau, type Piece, type PieceType, type PieceVirtuelle } from "./maison-types";

export const NOM_PIECE_VIRTUELLE_MAX = 40;
const NOM_EXTERIEUR = "Extérieur";

/** Nom propre : espaces multiples réduits, bords retirés, longueur bornée. */
export const nettoyerNomPiece = (nom: unknown): string =>
  typeof nom === "string" ? nom.replace(/\s+/g, " ").trim().slice(0, NOM_PIECE_VIRTUELLE_MAX) : "";

/** Clé de comparaison de deux noms : sans accent, sans casse (« Salle à manger » = « salle a manger »). */
const cleNom = (nom: string): string => nom.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const typeValide = (t: unknown): t is PieceType => typeof t === "string" && Object.prototype.hasOwnProperty.call(PIECE_TYPES, t);

/** Pièces virtuelles lisibles d'un niveau (une donnée enregistrée abîmée est ignorée, jamais une cause de plantage). */
export function piecesVirtuellesDe(niveau: Pick<Niveau, "piecesVirtuelles"> | null | undefined): PieceVirtuelle[] {
  const liste = niveau?.piecesVirtuelles;
  if (!Array.isArray(liste)) return [];
  return liste
    .filter((v): v is PieceVirtuelle => !!v && typeof v === "object" && Number.isFinite(v.id) && typeof v.nom === "string" && v.nom.trim().length > 0)
    .map(v => ({ id: v.id, nom: v.nom, type: typeValide(v.type) ? v.type : "autre" }));
}

/** Une pièce virtuelle sous la forme d'une Piece (sans contour ni appareillage propre), pour les calculs qui comptent « par pièce ». */
export const pieceDepuisVirtuelle = (v: PieceVirtuelle): Piece =>
  ({ id: v.id, nom: v.nom, type: v.type, contour: [], appareillages: [] } as Piece);

/** Nom d'affichage d'une pièce dessinée : son nom, sinon le libellé de son type (comme la liste des pièces du plan). */
const nomAffichePiece = (p: Pick<Piece, "nom" | "type">): string => p.nom?.trim() || PIECE_TYPES[p.type]?.label || "";

/** Une autre pièce du niveau (dessinée, virtuelle ou « Extérieur ») porte-t-elle déjà ce nom ? Renvoie son id. */
function idPieceNommee(niveau: Niveau, nom: string, sauf?: number): number | null {
  const k = cleNom(nom);
  if (k === cleNom(NOM_EXTERIEUR)) return EXTERIEUR_PIECE_ID;
  const dessinee = niveau.pieces.find(p => p.id !== sauf && cleNom(nomAffichePiece(p)) === k);
  if (dessinee) return dessinee.id;
  const virtuelle = piecesVirtuellesDe(niveau).find(v => v.id !== sauf && cleNom(v.nom) === k);
  return virtuelle ? virtuelle.id : null;
}

/**
 * Crée la pièce `nom` (de type `type`) sur le niveau, ou retrouve celle qui porte déjà ce nom — pièce dessinée, pièce virtuelle ou « Extérieur » :
 * jamais de doublon, l'appareillage est alors simplement rattaché à la pièce existante. Renvoie null si le nom est vide.
 * `nouvelId` fournit l'identifiant d'une pièce créée (compteur global du plan, uidMaison).
 */
export function trouverOuCreerPieceVirtuelle(niveau: Niveau, nom: string, type: PieceType, nouvelId: () => number): { niveau: Niveau; id: number; creee: boolean } | null {
  const propre = nettoyerNomPiece(nom);
  if (!propre) return null;
  const existante = idPieceNommee(niveau, propre);
  if (existante != null) return { niveau, id: existante, creee: false };
  const id = nouvelId();
  const piece: PieceVirtuelle = { id, nom: propre, type: typeValide(type) ? type : "autre" };
  return { niveau: { ...niveau, piecesVirtuelles: [...piecesVirtuellesDe(niveau), piece] }, id, creee: true };
}

/** Renomme une pièce virtuelle. Null si le nom est vide, identique à celui d'une autre pièce du niveau, ou si la pièce n'existe pas. */
export function renommerPieceVirtuelle(niveau: Niveau, id: number, nom: string): Niveau | null {
  const propre = nettoyerNomPiece(nom);
  const liste = piecesVirtuellesDe(niveau);
  if (!propre || !liste.some(v => v.id === id)) return null;
  if (idPieceNommee(niveau, propre, id) != null) return null;
  return { ...niveau, piecesVirtuelles: liste.map(v => (v.id === id ? { ...v, nom: propre } : v)) };
}

/**
 * Supprime une pièce virtuelle. Les appareillages qui lui étaient attribués retombent en attribution automatique (rien d'autre n'est
 * touché : aucun appareillage, circuit ni contour n'est supprimé).
 */
export function supprimerPieceVirtuelle(niveau: Niveau, id: number): Niveau {
  const liste = piecesVirtuellesDe(niveau);
  if (!liste.some(v => v.id === id)) return niveau;
  const reste = liste.filter(v => v.id !== id);
  return {
    ...niveau,
    piecesVirtuelles: reste.length > 0 ? reste : undefined,
    pieces: niveau.pieces.map(p => (p.appareillages.some(a => a.pieceAttribueeId === id)
      ? { ...p, appareillages: p.appareillages.map(a => (a.pieceAttribueeId === id ? { ...a, pieceAttribueeId: undefined } : a)) }
      : p)),
  };
}
