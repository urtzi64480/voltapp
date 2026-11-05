import { describe, expect, it } from "vitest";
import { EXTERIEUR_PIECE_ID, nouveauNiveau, nouvelAppareillage, nouvellePiece, reamorcerCompteurId, dedupliquerIds, uidMaison, type Niveau } from "@/lib/maison-types";
import {
  NOM_PIECE_VIRTUELLE_MAX, nettoyerNomPiece, pieceDepuisVirtuelle, piecesVirtuellesDe, renommerPieceVirtuelle, supprimerPieceVirtuelle, trouverOuCreerPieceVirtuelle,
} from "@/lib/pieces-virtuelles";
import { appareillagesParPieceReelle, pieceReelleDe } from "@/lib/piece-reelle";

const carre = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 5 }, { x: 0, y: 5 }];

function niveauTest(): Niveau {
  const sejour = nouvellePiece(carre, "Séjour", "sejour");
  const p1 = nouvelAppareillage("prise", 1, 2.5);
  const p2 = nouvelAppareillage("prise", 3, 2.5);
  sejour.appareillages = [p1, p2];
  const n = nouveauNiveau("rdc", 0);
  return { ...n, pieces: [sejour] };
}
let compteur = 1000;
const nouvelId = () => ++compteur;

describe("nettoyerNomPiece", () => {
  it("réduit les espaces, retire les bords, borne la longueur, tolère les valeurs non texte", () => {
    expect(nettoyerNomPiece("  Salle   à  manger ")).toBe("Salle à manger");
    expect(nettoyerNomPiece("x".repeat(200))).toHaveLength(NOM_PIECE_VIRTUELLE_MAX);
    expect(nettoyerNomPiece(undefined)).toBe("");
    expect(nettoyerNomPiece(42)).toBe("");
  });
});

describe("piecesVirtuellesDe", () => {
  it("ignore une donnée abîmée sans planter", () => {
    const n = { piecesVirtuelles: [null, { id: 1 }, { id: 2, nom: "  " }, { id: 3, nom: "Bureau", type: "inconnu" }, { id: 4, nom: "Cave", type: "garage" }] } as unknown as Niveau;
    expect(piecesVirtuellesDe(n)).toEqual([{ id: 3, nom: "Bureau", type: "autre" }, { id: 4, nom: "Cave", type: "garage" }]);
    expect(piecesVirtuellesDe(undefined)).toEqual([]);
    expect(piecesVirtuellesDe({ piecesVirtuelles: "oups" } as unknown as Niveau)).toEqual([]);
  });
});

describe("trouverOuCreerPieceVirtuelle", () => {
  it("crée une pièce enregistrée dans le niveau, sans toucher aux pièces dessinées", () => {
    const n = niveauTest();
    const r = trouverOuCreerPieceVirtuelle(n, " Salle à manger ", "sejour", nouvelId)!;
    expect(r.creee).toBe(true);
    expect(r.niveau.piecesVirtuelles).toEqual([{ id: r.id, nom: "Salle à manger", type: "sejour" }]);
    expect(r.niveau.pieces).toBe(n.pieces);          // aucune pièce dessinée créée ni modifiée
    expect(n.piecesVirtuelles).toBeUndefined();        // le niveau d'origine n'est pas muté
  });
  it("nom vide : rien n'est créé", () => {
    expect(trouverOuCreerPieceVirtuelle(niveauTest(), "   ", "autre", nouvelId)).toBeNull();
  });
  it("retrouve la pièce de même nom (sans accent ni casse) au lieu de créer un doublon", () => {
    const a = trouverOuCreerPieceVirtuelle(niveauTest(), "Salle à manger", "autre", nouvelId)!;
    const b = trouverOuCreerPieceVirtuelle(a.niveau, "salle a MANGER", "cuisine", nouvelId)!;
    expect(b.creee).toBe(false);
    expect(b.id).toBe(a.id);
    expect(piecesVirtuellesDe(b.niveau)).toHaveLength(1);
  });
  it("un nom déjà porté par une pièce dessinée (nom ou libellé de type) renvoie cette pièce", () => {
    const n = niveauTest();
    expect(trouverOuCreerPieceVirtuelle(n, "séjour", "autre", nouvelId)).toMatchObject({ id: n.pieces[0].id, creee: false });
    const sansNom = { ...n, pieces: [{ ...n.pieces[0], nom: "" }] };
    expect(trouverOuCreerPieceVirtuelle(sansNom, "Séjour", "autre", nouvelId)).toMatchObject({ id: n.pieces[0].id, creee: false });
  });
  it("« Extérieur » renvoie l'extérieur du plan, jamais une pièce virtuelle", () => {
    expect(trouverOuCreerPieceVirtuelle(niveauTest(), "Exterieur", "autre", nouvelId)).toMatchObject({ id: EXTERIEUR_PIECE_ID, creee: false });
  });
  it("type inconnu : « autre »", () => {
    const r = trouverOuCreerPieceVirtuelle(niveauTest(), "Cellier", "nimporte" as never, nouvelId)!;
    expect(r.niveau.piecesVirtuelles![0].type).toBe("autre");
  });
});

describe("renommerPieceVirtuelle", () => {
  it("renomme, refuse un nom vide, un nom déjà pris, ou une pièce inconnue", () => {
    const a = trouverOuCreerPieceVirtuelle(niveauTest(), "Bureau", "autre", nouvelId)!;
    const b = trouverOuCreerPieceVirtuelle(a.niveau, "Cellier", "autre", nouvelId)!;
    expect(renommerPieceVirtuelle(b.niveau, b.id, " Arrière-cuisine ")!.piecesVirtuelles!.map(v => v.nom)).toEqual(["Bureau", "Arrière-cuisine"]);
    expect(renommerPieceVirtuelle(b.niveau, b.id, "  ")).toBeNull();
    expect(renommerPieceVirtuelle(b.niveau, b.id, "bureau")).toBeNull();            // déjà pris par une autre pièce virtuelle
    expect(renommerPieceVirtuelle(b.niveau, b.id, "Séjour")).toBeNull();            // déjà pris par une pièce dessinée
    expect(renommerPieceVirtuelle(b.niveau, 999999, "Autre")).toBeNull();
    expect(renommerPieceVirtuelle(b.niveau, b.id, "CELLIER")!.piecesVirtuelles![1].nom).toBe("CELLIER");   // changer la casse de son propre nom reste permis
  });
});

describe("supprimerPieceVirtuelle", () => {
  it("les appareillages attribués repassent en automatique, rien d'autre n'est touché", () => {
    const n = niveauTest();
    const r = trouverOuCreerPieceVirtuelle(n, "Bureau", "autre", nouvelId)!;
    const [p1, p2] = n.pieces[0].appareillages;
    const attribue: Niveau = { ...r.niveau, pieces: [{ ...n.pieces[0], appareillages: [{ ...p1, pieceAttribueeId: r.id }, { ...p2, pieceAttribueeId: n.pieces[0].id }] }] };
    const apres = supprimerPieceVirtuelle(attribue, r.id);
    expect(apres.piecesVirtuelles).toBeUndefined();
    expect(apres.pieces[0].appareillages[0].pieceAttribueeId).toBeUndefined();
    expect(apres.pieces[0].appareillages[1].pieceAttribueeId).toBe(n.pieces[0].id);
    expect(apres.pieces[0].appareillages).toHaveLength(2);
  });
  it("pièce inconnue : le niveau est rendu tel quel", () => {
    const n = niveauTest();
    expect(supprimerPieceVirtuelle(n, 12345)).toBe(n);
  });
  it("garde les autres pièces virtuelles", () => {
    const a = trouverOuCreerPieceVirtuelle(niveauTest(), "Bureau", "autre", nouvelId)!;
    const b = trouverOuCreerPieceVirtuelle(a.niveau, "Cellier", "autre", nouvelId)!;
    expect(supprimerPieceVirtuelle(b.niveau, a.id).piecesVirtuelles!.map(v => v.nom)).toEqual(["Cellier"]);
  });
});

describe("attribution à une pièce virtuelle (piece-reelle)", () => {
  it("l'appareillage est compté dans la pièce virtuelle, qui n'est pas dessinée", () => {
    const n = niveauTest();
    const r = trouverOuCreerPieceVirtuelle(n, "Salle à manger", "sejour", nouvelId)!;
    const [p1, p2] = n.pieces[0].appareillages;
    const niv: Niveau = { ...r.niveau, pieces: [{ ...n.pieces[0], appareillages: [{ ...p1, pieceAttribueeId: r.id }, p2] }] };
    const { pieces, vers } = appareillagesParPieceReelle(niv);
    expect(pieces.get(r.id)!.piece).toMatchObject({ id: r.id, nom: "Salle à manger", type: "sejour", contour: [] });
    expect(pieces.get(r.id)!.apps.map(a => a.id)).toEqual([p1.id]);
    expect(pieces.get(n.pieces[0].id)!.apps.map(a => a.id)).toEqual([p2.id]);
    expect(vers.get(p1.id)!.nom).toBe("Salle à manger");
    expect(niv.pieces).toHaveLength(1);                // aucune pièce ajoutée au plan
    expect(pieceReelleDe({ ...p1, pieceAttribueeId: r.id }, niv.pieces[0], niv)).toEqual(pieceDepuisVirtuelle(r.niveau.piecesVirtuelles![0]));
  });
  it("pièce virtuelle supprimée sans nettoyage : retour à l'attribution automatique, sans erreur", () => {
    const n = niveauTest();
    const [p1] = n.pieces[0].appareillages;
    const niv: Niveau = { ...n, pieces: [{ ...n.pieces[0], appareillages: [{ ...p1, pieceAttribueeId: 424242 }, n.pieces[0].appareillages[1]] }] };
    const { vers } = appareillagesParPieceReelle(niv);
    expect(vers.get(p1.id)!.id).toBe(n.pieces[0].id);
  });
});

describe("identifiants", () => {
  it("reamorcerCompteurId couvre les pièces virtuelles : un nouvel id ne les égale jamais", () => {
    const n: Niveau = { ...niveauTest(), piecesVirtuelles: [{ id: 5_000_000, nom: "Bureau", type: "autre" }] };
    reamorcerCompteurId([n]);
    expect(uidMaison()).toBeGreaterThan(5_000_000);
  });
  it("dedupliquerIds laisse intactes des pièces virtuelles sans collision, et corrige un doublon", () => {
    const n = niveauTest();
    const propre: Niveau = { ...n, piecesVirtuelles: [{ id: 7_000_001, nom: "Bureau", type: "autre" }] };
    expect(dedupliquerIds([propre]).corrections).toBe(0);
    const doublon: Niveau = { ...n, piecesVirtuelles: [{ id: n.pieces[0].id, nom: "Bureau", type: "autre" }] };
    const r = dedupliquerIds([doublon]);
    expect(r.corrections).toBe(1);
    expect(r.niveaux[0].piecesVirtuelles![0].id).not.toBe(n.pieces[0].id);
    expect(r.niveaux[0].pieces[0].id).toBe(n.pieces[0].id);
  });
});
