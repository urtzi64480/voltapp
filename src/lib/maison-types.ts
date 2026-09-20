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

export interface Piece {
  id: number;
  nom: string;
  type: PieceType;
  contour: Point[]; // polygone fermé, mètres
  appareillages: AppareillagePlace[];
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
