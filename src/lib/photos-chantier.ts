// src/lib/photos-chantier.ts
//
// PHOTOS DE CHANTIER D'UN CIRCUIT. Une photo est rattachée à un circuit (son label) et à un POINT de son tracé : on photographie les câbles avant que les
// plaquistes ne referment les cloisons, puis on retrouve la photo en cliquant sur le repère posé sur le plan. Les fichiers vont dans le stockage Supabase ;
// le plan n'en garde que le chemin, la position, la date et une légende (Niveau.photosChantier).
import type { AppareillagePlace, Niveau, PhotoChantier, Point, SegmentCircuit } from "@/lib/maison-types";
import { origineCircuits } from "@/lib/maison-types";
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
