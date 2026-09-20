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
  // Pour interrupteur / va_et_vient / telerupteur : id du point_lumineux (ou applique) commandé.
  commandePourId?: number;
  // Rempli par genererCircuits() — id du Breaker (electrical-constants.ts) qui dessert ce point.
  circuitId?: number;
}

export interface Piece {
  id: number;
  nom: string;
  type: PieceType;
  contour: Point[]; // polygone fermé, mètres
  appareillages: AppareillagePlace[];
}

export interface Niveau {
  id: number;
  nom: string;
  type: NiveauType;
  ordre: number;
  pieces: Piece[];
  tableauPos?: Point; // position du tableau électrique / GTL sur ce niveau
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

// Ordonne une liste de points par plus-proche-voisin à partir d'un point de départ
// (utilisé pour le tracé visuel des circuits sur le plan — pas un routage réel).
export function ordonnerParProximite(depart: Point, points: Point[]): Point[] {
  const remaining = [...points];
  const ordered: Point[] = [];
  let last = depart;
  while (remaining.length > 0) {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = (remaining[i].x - last.x) ** 2 + (remaining[i].y - last.y) ** 2;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    last = remaining.splice(bestIdx, 1)[0];
    ordered.push(last);
  }
  return ordered;
}

// Palette de couleurs procédurale pour distinguer les circuits sur le plan/l'impression.
const TEINTES = [0, 210, 140, 280, 40, 320, 170, 60, 250, 10, 190, 95];
export function couleurCircuit(index: number): string {
  return `hsl(${TEINTES[index % TEINTES.length]}, 70%, 42%)`;
}
