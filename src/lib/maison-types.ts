// src/lib/maison-types.ts
//
// Types partagés entre l'éditeur de plan (/plan/[clientId]) et le moteur de
// génération de circuits (maison-engine.ts). Source unique — ne pas dupliquer
// ces interfaces ailleurs.

export type NiveauType = "sous_sol" | "rdc" | "etage" | "combles" | "garage";
export type PieceType = "sejour" | "chambre" | "cuisine" | "sdb" | "wc" | "circulation" | "exterieur" | "garage" | "autre";

export type AppareillageType =
  | "prise" | "prise_commandee"
  | "point_lumineux" | "applique"
  | "interrupteur" | "va_et_vient" | "telerupteur"
  | "four" | "plaque" | "lave_linge" | "lave_vaisselle" | "seche_linge"
  | "chauffe_eau" | "chauffage" | "clim" | "seche_serviette" | "congelateur"
  | "irve" | "piscine" | "vmc" | "alarme";

export interface Point { x: number; y: number; }

export interface AppareillagePlace {
  id: number;
  type: AppareillageType;
  x: number; // mètres
  y: number; // mètres
  nom?: string;      // libellé (ex: nom du point lumineux)
  hauteur?: number;  // hauteur d'installation en cm depuis le sol
  // Pour interrupteur / va_et_vient / telerupteur : ids des point_lumineux (ou applique)
  // commandés — un interrupteur peut commander plusieurs points lumineux.
  commandePourIds?: number[];
  // Rempli par genererCircuits() — id du Breaker (electrical-constants.ts) qui dessert ce point.
  circuitId?: number;
  // Rattachement manuel à un CircuitManuel (id stable, voir plus bas) — prioritaire sur le
  // clustering automatique de genererCircuits() pour ce point, tant que le CircuitManuel visé
  // existe toujours et correspond à la bonne famille (prises/cuisine/extérieur/éclairage).
  circuitManuelId?: number;
}

// Porte, porte coulissante, fenêtre, ou simple ouverture murale (sans porte, entièrement
// dimensionnée à la main) placée sur un mur (segment du contour) d'une pièce — pas un
// objet libre comme un appareillage : contrainte à glisser le long du mur qui la porte.
export type OuvertureType = "porte" | "porte_coulissante" | "fenetre" | "ouverture";

export interface Ouverture {
  id: number;
  type: OuvertureType;
  segIndex: number;   // quel mur du contour (même indexation que "Mur 1/2/3…" affiché sur le plan)
  position: number;   // 0..1 — position du centre le long de ce mur
  largeur: number;    // cm
  hauteur?: number;   // cm — hauteur de l'ouverture au-dessus de l'allège (0 pour une porte : va jusqu'au sol)
  allege?: number;    // cm — hauteur du bas de l'ouverture depuis le sol (0 = au ras du sol)
  // Porte battante uniquement — sens d'ouverture : "gauche" = charnière du côté du premier
  // sommet du mur (segIndex), "droite" = côté du second sommet. ouvreVersInterieur détermine
  // si le vantail (symbole du plan) bat vers l'intérieur (défaut) ou l'extérieur de la pièce.
  charniere?: "gauche" | "droite";
  ouvreVersInterieur?: boolean;
  // Porte coulissante uniquement — côté du mur vers lequel le panneau coulisse (et se "gare").
  coulisseVers?: "gauche" | "droite";
}

export function nouvelleOuverture(type: OuvertureType, segIndex: number, position: number): Ouverture {
  switch (type) {
    case "porte":
      return { id: uidMaison(), type, segIndex, position, largeur: 90, hauteur: 204, allege: 0, charniere: "gauche", ouvreVersInterieur: true };
    case "porte_coulissante":
      return { id: uidMaison(), type, segIndex, position, largeur: 90, hauteur: 204, allege: 0, coulisseVers: "droite" };
    case "fenetre":
      return { id: uidMaison(), type, segIndex, position, largeur: 100, hauteur: 120, allege: 90 };
    case "ouverture":
    default:
      return { id: uidMaison(), type, segIndex, position, largeur: 100, hauteur: 100, allege: 0 };
  }
}

// ─── PERÇAGE AUTOMATIQUE DES MURS MITOYENS ─────────────────────────────────────
// Deux pièces dessinées côte à côte n'ont, dans ce modèle, aucun mur "partagé" — chacune
// a son propre contour indépendant. Une ouverture posée sur le mur de l'une ne perce donc
// pas, en soi, le mur (géométriquement confondu) de l'autre. Les fonctions ci-dessous
// détectent ces murs mitoyens (même droite, portion commune) et projettent les ouvertures
// de l'un vers l'autre — utilisé en lecture seule par le rendu 2D et par la vue 3D, jamais
// par la donnée elle-même : une ouverture n'a qu'un seul propriétaire, toujours.

function projectionSurDroite(p: Point, origine: Point, dirX: number, dirY: number): number {
  return (p.x - origine.x) * dirX + (p.y - origine.y) * dirY;
}
function distancePerpendiculaire(p: Point, origine: Point, dirX: number, dirY: number): number {
  const t = projectionSurDroite(p, origine, dirX, dirY);
  return distance(p, { x: origine.x + dirX * t, y: origine.y + dirY * t });
}

interface MurJumeau { piece: Piece; segIndex: number; loM: number; hiM: number; }

// Cherche, parmi les AUTRES pièces, tous les murs géométriquement confondus (même droite,
// à toleranceM près) avec le mur (a,b) donné, et qui recouvrent au moins 10cm de sa longueur.
function trouverMursJumeaux(pieces: Piece[], pieceCourante: Piece, segIndex: number, toleranceM = 0.15): MurJumeau[] {
  const a = pieceCourante.contour[segIndex], b = pieceCourante.contour[(segIndex + 1) % pieceCourante.contour.length];
  const dx = b.x - a.x, dy = b.y - a.y;
  const longueur = Math.hypot(dx, dy);
  if (longueur < 0.01) return [];
  const dirX = dx / longueur, dirY = dy / longueur;
  const resultats: MurJumeau[] = [];
  pieces.forEach(piece => {
    if (piece.id === pieceCourante.id) return;
    piece.contour.forEach((c, i) => {
      const d = piece.contour[(i + 1) % piece.contour.length];
      if (distancePerpendiculaire(c, a, dirX, dirY) > toleranceM || distancePerpendiculaire(d, a, dirX, dirY) > toleranceM) return;
      const tC = projectionSurDroite(c, a, dirX, dirY), tD = projectionSurDroite(d, a, dirX, dirY);
      const lo = Math.max(0, Math.min(tC, tD)), hi = Math.min(longueur, Math.max(tC, tD));
      if (hi - lo > 0.1) resultats.push({ piece, segIndex: i, loM: lo, hiM: hi });
    });
  });
  return resultats;
}

// Une ouverture "effective" pour le rendu d'un mur donné — soit une ouverture posée
// directement sur ce mur (proprietaire: true), soit une ouverture posée sur le mur
// mitoyen d'une autre pièce et projetée ici (proprietaire: false, pour percer la vue
// des deux côtés sans dupliquer la donnée).
export interface OuvertureEffective {
  type: OuvertureType;
  position: number; // 0..1 sur CE segment
  largeur: number;
  hauteur?: number;
  allege?: number;
  coulisseVers?: "gauche" | "droite";
  proprietaire: boolean;
}

export function ouverturesEffectivesMur(pieces: Piece[], piece: Piece, segIndex: number): OuvertureEffective[] {
  const a = piece.contour[segIndex], b = piece.contour[(segIndex + 1) % piece.contour.length];
  const longueur = distance(a, b) || 1;
  const propres: OuvertureEffective[] = (piece.ouvertures ?? [])
    .filter(o => o.segIndex === segIndex)
    .map(o => ({ type: o.type, position: o.position, largeur: o.largeur, hauteur: o.hauteur, allege: o.allege, coulisseVers: o.coulisseVers, proprietaire: true }));

  const projetees: OuvertureEffective[] = [];
  trouverMursJumeaux(pieces, piece, segIndex).forEach(j => {
    const aJ = j.piece.contour[j.segIndex], bJ = j.piece.contour[(j.segIndex + 1) % j.piece.contour.length];
    (j.piece.ouvertures ?? []).filter(o => o.segIndex === j.segIndex).forEach(o => {
      const centreM = { x: aJ.x + (bJ.x - aJ.x) * o.position, y: aJ.y + (bJ.y - aJ.y) * o.position };
      const t = positionSurSegment(centreM, a, b);
      const tM = t * longueur;
      if (tM < j.loM - 0.01 || tM > j.hiM + 0.01) return; // hors du recouvrement réel — pas vraiment mitoyen ici
      projetees.push({ type: o.type, position: t, largeur: o.largeur, hauteur: o.hauteur, allege: o.allege, coulisseVers: o.coulisseVers, proprietaire: false });
    });
  });
  return [...propres, ...projetees];
}

export interface Piece {
  id: number;
  nom: string;
  type: PieceType;
  contour: Point[]; // polygone fermé, mètres
  appareillages: AppareillagePlace[];
  ouvertures?: Ouverture[];
  hauteurPlafond?: number; // mètres — remplace la hauteur du niveau pour cette pièce si définie (vue 3D)
}

// Points de coude manuels sur le tracé d'un circuit (pour le faire passer dans un mur,
// par ex.) — clé stable indépendante du circuitId (qui change à chaque génération),
// construite à partir des ids des deux ancres reliées ("tableau" ou id d'appareillage).
// Un segment peut avoir plusieurs coudes, dans l'ordre, pour contourner un obstacle
// (une pièce, par exemple) — pas seulement un simple détour à un point.
export interface LiaisonWaypoint {
  id: number;
  point: Point;
  hauteur?: number; // cm — hauteur d'implantation du câble à ce point (plinthe, gaine technique, plafond…)
}
export type LiaisonWaypoints = Record<string, LiaisonWaypoint[]>;

// ─── CIRCUITS MANUELS ────────────────────────────────────────────────────────
// Un circuit créé et nommé à la main par l'utilisateur (au lieu de laisser le
// clustering spatial de genererCircuits() décider). Id stable (uidMaison), donc
// résiste aux régénérations — contrairement au Breaker.id, réattribué à chaque
// clic sur "Générer les circuits". Scope : par niveau (un circuit ne traverse
// jamais deux niveaux). "famille" reprend les seules familles regroupables de
// CIRCUITS (electrical-constants.ts) — les appareils dédiés ont toujours leur
// propre circuit et ne sont pas concernés par l'assignation manuelle.
export type FamilleCircuitManuel = "prise_16" | "cuisine_prises" | "exterieur" | "lumiere";

export const FAMILLES_CIRCUIT_MANUEL: Record<FamilleCircuitManuel, string> = {
  prise_16: "Prises",
  cuisine_prises: "Prises cuisine",
  exterieur: "Prises extérieur / garage",
  lumiere: "Éclairage",
};

export interface CircuitManuel {
  id: number;
  nom: string;
  famille: FamilleCircuitManuel;
  couleur?: string; // couleur imposée sur le plan/l'impression/la vue 3D — sinon couleur procédurale
}

// Détermine à quelle famille de circuit manuel un appareillage donné (dans une pièce
// donnée) est éligible, ou null s'il n'est jamais regroupable à la main (interrupteurs —
// rattachés automatiquement au circuit de leur(s) point(s) lumineux commandé(s) — et
// appareils dédiés, qui ont toujours leur propre circuit individuel).
export function familleCircuitManuelAppareillage(type: AppareillageType, pieceType: PieceType): FamilleCircuitManuel | null {
  if (type === "prise" || type === "prise_commandee") {
    if (pieceType === "cuisine") return "cuisine_prises";
    if (pieceType === "exterieur" || pieceType === "garage") return "exterieur";
    return "prise_16";
  }
  if (type === "point_lumineux" || type === "applique") return "lumiere";
  return null;
}

export interface Niveau {
  id: number;
  nom: string;
  type: NiveauType;
  ordre: number;
  pieces: Piece[];
  tableauPos?: Point; // position du tableau électrique / GTL sur ce niveau
  tableauHauteur?: number; // cm — hauteur d'installation du tableau (vue 3D), 150 par défaut
  tableauRotation?: number; // degrés — orientation du tableau (aligné sur le mur porteur), 0 par défaut
  hauteurPlafond?: number; // mètres — pour la vue 3D (2.5 par défaut)
  liaisonWaypoints?: LiaisonWaypoints;
  circuitsManuels?: CircuitManuel[];
  // Couleur imposée par circuit AUTOMATIQUE (non manuel), indexée par le label généré
  // (déterministe tant que la composition du plan ne change pas) — les circuits manuels
  // utilisent CircuitManuel.couleur à la place (voir construireColorMap, maison-engine.ts).
  couleursCircuits?: Record<string, string>;
}

export interface Maison {
  niveaux: Niveau[];
}

export const NIVEAU_TYPES: Record<NiveauType, string> = {
  sous_sol: "Sous-sol", rdc: "RDC", etage: "Étage", combles: "Combles", garage: "Garage",
};

export const PIECE_TYPES: Record<PieceType, { label: string; color: string; stroke: string }> = {
  sejour:      { label: "Séjour",        color: "#DBEAFE", stroke: "#60A5FA" },
  chambre:     { label: "Chambre",       color: "#FCE7F3", stroke: "#F472B6" },
  cuisine:     { label: "Cuisine",       color: "#FEF3C7", stroke: "#FBBF24" },
  sdb:         { label: "Salle de bain", color: "#CFFAFE", stroke: "#22D3EE" },
  wc:          { label: "WC",            color: "#E0E7FF", stroke: "#818CF8" },
  circulation: { label: "Circulation",   color: "#F3F4F6", stroke: "#9CA3AF" },
  exterieur:   { label: "Extérieur",     color: "#D1FAE5", stroke: "#34D399" },
  garage:      { label: "Garage",        color: "#E5E7EB", stroke: "#9CA3AF" },
  autre:       { label: "Autre",         color: "#EDE9FE", stroke: "#A78BFA" },
};

let _uidM = 0;
export const uidMaison = (): number => ++_uidM;

// Ré-amorce le compteur d'id global (partagé entre niveaux, pièces, appareillages,
// coudes de liaison et circuits manuels) après le chargement d'un plan existant.
// Sans ça, uidMaison() redémarre à 1 à chaque rechargement de page et rentre en
// collision avec des id déjà présents dans les données sauvegardées : deux objets
// différents finissent avec le même id, et supprimer/déplacer l'un affecte l'autre
// de façon imprévisible (React les traite comme un seul et même élément).
export function reamorcerCompteurId(niveaux: Niveau[]): void {
  let max = 0;
  niveaux.forEach(n => {
    max = Math.max(max, n.id);
    n.pieces.forEach(p => {
      max = Math.max(max, p.id);
      p.appareillages.forEach(a => { max = Math.max(max, a.id); });
      (p.ouvertures ?? []).forEach(o => { max = Math.max(max, o.id); });
    });
    (n.circuitsManuels ?? []).forEach(m => { max = Math.max(max, m.id); });
    Object.values(n.liaisonWaypoints ?? {}).forEach(liste => liste.forEach(w => { max = Math.max(max, w.id); }));
  });
  if (max >= _uidM) _uidM = max;
}

// Corrige les id en double (voir reamorcerCompteurId ci-dessus pour la cause) déjà
// présents dans un plan sauvegardé : réattribue un id neuf à chaque doublon rencontré
// (le premier exemplaire garde le sien) et met à jour les références qui pointent
// dessus (commandePourIds, circuitManuelId). N'y touche pas si tout est déjà propre.
export function dedupliquerIds(niveaux: Niveau[]): { niveaux: Niveau[]; corrections: number } {
  const vus = new Set<number>();
  const remapApp = new Map<number, number>();
  const remapManuel = new Map<number, number>();
  let corrections = 0;

  const prendre = (id: number): number => {
    if (!vus.has(id)) { vus.add(id); return id; }
    let nouveau = uidMaison();
    while (vus.has(nouveau)) nouveau = uidMaison();
    vus.add(nouveau);
    corrections++;
    return nouveau;
  };

  // Passe 1 : id définitifs pour chaque objet + table de correspondance ancien -> nouveau.
  const niveauxV1 = niveaux.map(n => {
    const nouvId = prendre(n.id);
    const pieces = n.pieces.map(p => {
      const nouvPId = prendre(p.id);
      const appareillages = p.appareillages.map(a => {
        const nouvAId = prendre(a.id);
        if (nouvAId !== a.id) remapApp.set(a.id, nouvAId);
        return { ...a, id: nouvAId };
      });
      const ouvertures = (p.ouvertures ?? []).map(o => ({ ...o, id: prendre(o.id) }));
      return { ...p, id: nouvPId, appareillages, ouvertures: p.ouvertures ? ouvertures : p.ouvertures };
    });
    const circuitsManuels = (n.circuitsManuels ?? []).map(m => {
      const nouvMId = prendre(m.id);
      if (nouvMId !== m.id) remapManuel.set(m.id, nouvMId);
      return { ...m, id: nouvMId };
    });
    return { ...n, id: nouvId, pieces, circuitsManuels: n.circuitsManuels ? circuitsManuels : n.circuitsManuels };
  });

  if (corrections === 0) return { niveaux, corrections: 0 };

  // Passe 2 : réécrit les références vers les id qui ont changé.
  const niveauxV2 = niveauxV1.map(n => ({
    ...n,
    pieces: n.pieces.map(p => ({
      ...p,
      appareillages: p.appareillages.map(a => ({
        ...a,
        commandePourIds: a.commandePourIds?.map(id => remapApp.get(id) ?? id),
        circuitManuelId: a.circuitManuelId != null ? (remapManuel.get(a.circuitManuelId) ?? a.circuitManuelId) : a.circuitManuelId,
      })),
    })),
  }));

  return { niveaux: niveauxV2, corrections };
}

export const nouveauNiveau = (type: NiveauType = "rdc", ordre = 0): Niveau => ({
  id: uidMaison(), nom: "", type, ordre, pieces: [],
});
export const nouvellePiece = (contour: Point[], nom = "", type: PieceType = "autre"): Piece => ({
  id: uidMaison(), nom, type, contour, appareillages: [],
});
export const nouvelAppareillage = (type: AppareillageType, x: number, y: number): AppareillagePlace => ({
  id: uidMaison(), type, x, y,
});

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Déplace le point d'arrivée d'un segment (contour[segIndex+1]) le long de sa direction
// actuelle pour lui donner la longueur voulue, en gardant contour[segIndex] fixe.
export function ajusterLongueurContour(contour: Point[], segIndex: number, nouvelleLongueur: number): Point[] {
  const n = contour.length;
  const a = contour[segIndex];
  const b = contour[(segIndex + 1) % n];
  if (!a || !b) return contour;
  const dx = b.x - a.x, dy = b.y - a.y;
  const longueurActuelle = Math.hypot(dx, dy);
  if (longueurActuelle < 0.001) return contour;
  const ratio = nouvelleLongueur / longueurActuelle;
  const nouveauB: Point = { x: a.x + dx * ratio, y: a.y + dy * ratio };
  return contour.map((pt, i) => (i === (segIndex + 1) % n ? nouveauB : pt));
}

export function aireDuPolygone(points: Point[]): number {
  if (points.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i], p2 = points[(i + 1) % points.length];
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(a / 2);
}

export function centroide(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const s = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / points.length, y: s.y / points.length };
}

export function pointDansPolygone(pt: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function trouverPiece(pt: Point, pieces: Piece[]): Piece | null {
  for (const p of pieces) {
    if (pointDansPolygone(pt, p.contour)) return p;
  }
  return null;
}

export function distanceAuSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

// Distance (mètres) au mur le plus proche du contour — dérivée de la position,
// pas saisie manuellement : bouge l'appareillage et elle se recalcule seule.
export function distanceAuMurLePlusProche(point: Point, contour: Point[]): number {
  let min = Infinity;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length];
    min = Math.min(min, distanceAuSegment(point, a, b));
  }
  return min;
}

// Distance (mètres) de point à CHAQUE mur du contour, dans l'ordre des segments —
// utilisé pour permettre de caler un appareillage par rapport à n'importe quel mur
// de la pièce (pas seulement le plus proche).
export function distancesTousLesMurs(point: Point, contour: Point[]): number[] {
  return contour.map((a, i) => distanceAuSegment(point, a, contour[(i + 1) % contour.length]));
}

function segmentLePlusProche(point: Point, contour: Point[]): number {
  let bestIdx = 0, bestD = Infinity;
  for (let i = 0; i < contour.length; i++) {
    const d = distanceAuSegment(point, contour[i], contour[(i + 1) % contour.length]);
    if (d < bestD) { bestD = d; bestIdx = i; }
  }
  return bestIdx;
}

// Point le plus proche de p sur le segment [a, b] (projection bornée au segment).
function pointLePlusProcheSurSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return a;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// Position (0..1) du point le plus proche de p sur le segment [a, b] — utilisé pour
// glisser une porte/fenêtre le long du mur qui la porte (placement et drag).
export function positionSurSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  return Math.max(0, Math.min(1, t));
}

// Repositionne un appareillage pour qu'il soit exactement à distanceCible (mètres) du
// mur donné (segIndex du contour), en gardant sa position "le long de ce mur" (le pied
// de la perpendiculaire) inchangée — seul l'écart à CE mur change. Si le point est
// confondu avec le mur (distance nulle), utilise la normale du segment orientée vers
// l'intérieur de la pièce (côté du centroïde).
export function positionnerADistanceDuSegment(point: Point, contour: Point[], segIndex: number, distanceCible: number): Point {
  const a = contour[segIndex], b = contour[(segIndex + 1) % contour.length];
  if (!a || !b) return point;
  const pied = pointLePlusProcheSurSegment(point, a, b);
  let dx = point.x - pied.x, dy = point.y - pied.y;
  let norme = Math.hypot(dx, dy);
  if (norme < 0.001) {
    const segDx = b.x - a.x, segDy = b.y - a.y;
    const segLen = Math.hypot(segDx, segDy) || 1;
    let nx = -segDy / segLen, ny = segDx / segLen;
    const c = centroide(contour);
    const versCentre = { x: c.x - pied.x, y: c.y - pied.y };
    if (nx * versCentre.x + ny * versCentre.y < 0) { nx = -nx; ny = -ny; }
    dx = nx; dy = ny; norme = 1;
  }
  const ux = dx / norme, uy = dy / norme;
  return { x: pied.x + ux * distanceCible, y: pied.y + uy * distanceCible };
}

// Même chose mais vis-à-vis du mur le plus proche (raccourci pratique).
export function positionnerADistanceDuMur(point: Point, contour: Point[], distanceCible: number): Point {
  return positionnerADistanceDuSegment(point, contour, segmentLePlusProche(point, contour), distanceCible);
}

// Ordonne une liste de points par plus-proche-voisin à partir d'un point de départ
// ─── TRACÉ DES CIRCUITS AVEC POINTS DE COUDE MANUELS ───────────────────────────
// Une ancre est soit le tableau ("tableau"), soit un appareillage (son id en texte).
// La clé de segment est stable d'une génération de circuits à l'autre (contrairement
// au circuitId, qui change à chaque clic sur "Générer") — les coudes posés à la main
// survivent donc à une regénération.

export interface AncrePoint { id: string; point: Point; }

export function ordonnerAncresParProximite(depart: Point, items: AncrePoint[]): AncrePoint[] {
  const remaining = [...items];
  const ordered: AncrePoint[] = [];
  let last = depart;
  while (remaining.length > 0) {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = (remaining[i].point.x - last.x) ** 2 + (remaining[i].point.y - last.y) ** 2;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    last = next.point;
  }
  return ordered;
}

export function cleSegmentLiaison(idA: string, idB: string): string {
  return `${idA}->${idB}`;
}

// Suite ordonnée des ancres d'un circuit : tableau puis chaque appareillage, par proximité.
export function sequenceAncresCircuit(depart: Point, points: AppareillagePlace[]): AncrePoint[] {
  const ancres: AncrePoint[] = points.map(a => ({ id: String(a.id), point: { x: a.x, y: a.y } }));
  return [{ id: "tableau", point: depart }, ...ordonnerAncresParProximite(depart, ancres)];
}

// Chemin complet (mètres) en insérant les points de coude manuels présents dans waypoints.
export function construireCheminCircuit(depart: Point, points: AppareillagePlace[], waypoints: LiaisonWaypoints | undefined): Point[] {
  const sequence = sequenceAncresCircuit(depart, points);
  const chemin: Point[] = [sequence[0].point];
  for (let i = 0; i < sequence.length - 1; i++) {
    const cle = cleSegmentLiaison(sequence[i].id, sequence[i + 1].id);
    const wps = waypoints?.[cle] ?? [];
    wps.forEach(w => chemin.push(w.point));
    chemin.push(sequence[i + 1].point);
  }
  return chemin;
}

function longueurChemin(chemin: Point[]): number {
  let total = 0;
  for (let i = 0; i < chemin.length - 1; i++) total += distance(chemin[i], chemin[i + 1]);
  return total;
}

export function longueurCircuitAvecWaypoints(depart: Point, points: AppareillagePlace[], waypoints: LiaisonWaypoints | undefined): number {
  return longueurChemin(construireCheminCircuit(depart, points, waypoints));
}

// Palette de couleurs procédurale pour distinguer les circuits sur le plan/l'impression.
const TEINTES = [0, 210, 140, 280, 40, 320, 170, 60, 250, 10, 190, 95];
export function couleurCircuit(index: number): string {
  return `hsl(${TEINTES[index % TEINTES.length]}, 70%, 42%)`;
}
