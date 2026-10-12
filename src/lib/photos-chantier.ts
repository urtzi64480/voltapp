// src/lib/photos-chantier.ts
//
// PHOTOS DE CHANTIER D'UN CIRCUIT. Une photo est rattachée à un circuit (son label) et à un POINT de son tracé : on photographie les câbles avant que les
// plaquistes ne referment les cloisons, puis on retrouve la photo en cliquant sur le repère posé sur le plan. Les fichiers vont dans le stockage Supabase ;
// le plan n'en garde que le chemin, la position, la date et une légende (Niveau.photosChantier).
import type { AppareillagePlace, Niveau, PhotoChantier, Point, SegmentCircuit } from "@/lib/maison-types";
import { origineCircuits, distanceAuSegment } from "@/lib/maison-types";
import type { Breaker } from "@/lib/electrical-constants";
import { segmentsPourCircuit } from "@/lib/maison-engine";
import { coudesSegment } from "@/lib/routage-circuits";

export const BUCKET_PHOTOS = "intervention-photos";
/** Deux photos à moins de cette distance (m) partagent le même repère sur le plan. */
export const RAYON_GROUPE_PHOTOS = 0.25;

/** Réduit une photo de téléphone (plusieurs Mo) à ~1600 px / JPEG avant l'envoi. En cas d'échec (format non décodable), renvoie le fichier tel quel. */
export async function compresserImage(file: File, max = 1600, qualite = 0.82): Promise<{ blob: Blob; ext: string; type: string }> {
  const brut = { blob: file as Blob, ext: (file.name.split(".").pop() || "jpg").toLowerCase(), type: file.type || "image/jpeg" };
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, "image/jpeg", qualite));
    return blob ? { blob, ext: "jpg", type: "image/jpeg" } : brut;
  } catch { return brut; }
}

export const cheminPhoto = (clientId: string, niveauId: number, ext: string): string =>
  `plan/${clientId}/${niveauId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

/** Point du tracé du circuit le plus proche de `p` (projection sur le chemin réel : coudes compris). `p` inchangé si le circuit n'a aucun tracé. */
export function projeterSurCircuit(p: Point, breaker: Breaker | undefined, niveau: Niveau): Point {
  const orig = origineCircuits(niveau);
  if (!breaker || !orig) return p;
  const pts: AppareillagePlace[] = niveau.pieces.flatMap(pc => pc.appareillages).filter(a => a.circuitId === breaker.id);
  let meilleur = Infinity, res = p;
  segmentsPourCircuit(breaker, pts, niveau, orig).forEach(sg => {
    if (sg.type === "domotique") return;
    const chemin = [sg.aPoint, ...coudesSegment(niveau, sg).map(w => w.point), sg.bPoint];
    for (let i = 0; i + 1 < chemin.length; i++) {
      const a = chemin[i], b = chemin[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      const q = { x: a.x + t * dx, y: a.y + t * dy };
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < meilleur) { meilleur = d; res = q; }
    }
  });
  return res;
}

/** Regroupe les photos d'un même circuit prises au même endroit : un seul repère sur le plan, avec le nombre de photos. */
export function grouperPhotos(photos: PhotoChantier[]): { circuit: string; point: Point; photos: PhotoChantier[] }[] {
  const groupes: { circuit: string; point: Point; photos: PhotoChantier[] }[] = [];
  photos.forEach(ph => {
    const g = groupes.find(x => x.circuit === ph.circuit && Math.hypot(x.point.x - ph.point.x, x.point.y - ph.point.y) <= RAYON_GROUPE_PHOTOS);
    if (g) g.photos.push(ph); else groupes.push({ circuit: ph.circuit, point: ph.point, photos: [ph] });
  });
  return groupes;
}

/** Tronçon (liaison entre deux éléments du schéma) le plus proche d'une photo, mesuré sur le chemin réel du câble (coudes compris). */
export function tronconDePhoto(p: Point, segments: SegmentCircuit[], niveau: Niveau): SegmentCircuit | null {
  let meilleur = Infinity, res: SegmentCircuit | null = null;
  segments.forEach(sg => {
    if (sg.type === "domotique") return;
    const chemin = [sg.aPoint, ...coudesSegment(niveau, sg).map(w => w.point), sg.bPoint];
    for (let i = 0; i + 1 < chemin.length; i++) {
      const a = chemin[i], b = chemin[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      if (d < meilleur) { meilleur = d; res = sg; }
    }
  });
  return res;
}

// ─── POSITION PRÉCISE : distances aux murs ─────────────────────────────────────────────────────────────────────────────────────────────
// TOUS les murs du niveau comptent, pas seulement ceux de la pièce de la photo : contours de toutes les pièces + cloisons des zones.
// Les distances sont mesurées à l'AXE du mur (le trait du plan). Un mur mitoyen n'apparaît qu'une fois, nommé par ses deux pièces.
export interface MurNiveau { a: Point; b: Point; nom: string }
export interface MurProche extends MurNiveau { distance: number; cote: string }

export function mursDuNiveau(niveau: Niveau): MurNiveau[] {
  const brut: MurNiveau[] = [];
  niveau.pieces.forEach(pc => pc.contour.forEach((a, i) => brut.push({ a, b: pc.contour[(i + 1) % pc.contour.length], nom: pc.nom || "Pièce" })));
  (niveau.zones ?? []).forEach(z => {
    const n = z.ferme ? z.contour.length : z.contour.length - 1;
    for (let i = 0; i < n; i++) if (z.cotes[i] === "cloison") brut.push({ a: z.contour[i], b: z.contour[(i + 1) % z.contour.length], nom: `Cloison ${z.nom || "zone"}` });
  });
  const cle = (m: MurNiveau) => { const f = (q: Point) => `${Math.round(q.x * 100)},${Math.round(q.y * 100)}`; const u = f(m.a), v = f(m.b); return u < v ? `${u}|${v}` : `${v}|${u}`; };
  const uniques = new Map<string, MurNiveau>();
  brut.forEach(m => { const k = cle(m), e = uniques.get(k); if (!e) uniques.set(k, { ...m }); else if (!e.nom.split(" / ").includes(m.nom)) e.nom += ` / ${m.nom}`; });
  return Array.from(uniques.values());
}

/** Côté du plan où se trouve le mur, vu depuis le point. */
function coteDuMur(p: Point, m: MurNiveau): string {
  const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - m.a.x) * dx + (p.y - m.a.y) * dy) / l2));
  const vx = m.a.x + t * dx - p.x, vy = m.a.y + t * dy - p.y;
  return Math.abs(vx) >= Math.abs(vy) ? (vx < 0 ? "à gauche sur le plan" : "à droite sur le plan") : (vy < 0 ? "en haut du plan" : "en bas du plan");
}

/** Les `n` murs les plus proches (tout le niveau), en écartant les murs alignés et quasi à la même distance (même ligne coupée en morceaux). */
export function mursProches(p: Point, niveau: Niveau, n = 4): MurProche[] {
  const tous = mursDuNiveau(niveau).map(m => ({ ...m, distance: distanceAuSegment(p, m.a, m.b), cote: coteDuMur(p, m) })).sort((x, y) => x.distance - y.distance);
  const dir = (m: MurNiveau) => { const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
  const res: MurProche[] = [];
  for (const m of tous) {
    if (res.length >= n) break;
    const u = dir(m);
    const dl = (q: MurNiveau) => { const v = dir(q); return Math.abs((p.x - q.a.x) * v.y - (p.y - q.a.y) * v.x); };   // distance à la DROITE portant le mur
    const doublon = res.some(r => { const v = dir(r); return Math.abs(u.x * v.y - u.y * v.x) < 0.05 && Math.abs(dl(r) - dl(m)) < 0.03 && r.cote === m.cote; });
    if (!doublon) res.push(m);
  }
  return res;
}

/** Déplace le point perpendiculairement au mur pour qu'il soit à `d` mètres de son axe ; la position le long du mur ne change pas. */
export function deplacerADistanceDuMur(p: Point, m: MurNiveau, d: number): Point {
  const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y, l = Math.hypot(dx, dy);
  if (l === 0) return p;
  const ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
  const t = (p.x - m.a.x) * ux + (p.y - m.a.y) * uy;
  const s = (p.x - m.a.x) * nx + (p.y - m.a.y) * ny;
  const signe = s < 0 ? -1 : 1;
  return { x: m.a.x + t * ux + signe * d * nx, y: m.a.y + t * uy + signe * d * ny };
}

const m2 = (v: number) => v.toFixed(2).replace(".", ",");
/** « h 110 cm · 0,42 m du mur Salon (à gauche sur le plan) · 1,10 m du mur Cuisine (en haut du plan) » : de quoi retrouver l'endroit au mètre. */
export function texteCoordonnees(ph: PhotoChantier, niveau: Niveau): string {
  const murs = mursProches(ph.point, niveau, 6);
  const premier = murs[0];
  const u = premier ? { x: premier.b.x - premier.a.x, y: premier.b.y - premier.a.y } : null;
  const ul = u ? Math.hypot(u.x, u.y) || 1 : 1;
  const second = u ? murs.slice(1).find(m => Math.abs((u.x * (m.b.y - m.a.y) - u.y * (m.b.x - m.a.x)) / (ul * (Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) || 1))) > 0.5) : undefined;
  const parts: string[] = [];
  if (ph.hauteurCm != null) parts.push(`h ${Math.round(ph.hauteurCm)} cm`);
  [premier, second].forEach(m => { if (m) parts.push(`${m2(m.distance)} m du mur ${m.nom} (${m.cote})`); });
  return parts.join(" · ");
}
