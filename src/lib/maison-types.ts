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

export interface Niveau {
  id: number;
  nom: string;
  type: NiveauType;
  ordre: number;
  pieces: Piece[];
  tableauPos?: Point; // position du tableau électrique / GTL sur ce niveau
  hauteurPlafond?: number; // mètres — pour la vue 3D (2.5 par défaut)
  liaisonWaypoints?: LiaisonWaypoints;
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

function distancePointSegment(p: Point, a: Point, b: Point): number {
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
    min = Math.min(min, distancePointSegment(point, a, b));
  }
  return min;
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
