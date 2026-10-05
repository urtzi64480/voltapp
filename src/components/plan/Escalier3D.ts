// Escalier en 3D (three.js) à partir du calcul de lib/escaliers.ts : marches, contremarches, structure (limons, massif,
// poteau…), garde-corps ; garde-corps de trémie ; sol d'un étage percé de la trémie d'un escalier qui y arrive.
//
// Repère : celui de la scène — x = x du plan, y = vertical (m), z = y du plan. Le groupe renvoyé est posé au sol du niveau
// de DÉPART (y = 0) ; pour l'afficher depuis le niveau desservi, le décaler de −hauteurTotale / 100.

import * as THREE from "three";
import type { Escalier, Point } from "@/lib/maison-types";
import { CalculEscalier, COULEUR_MATERIAU, EPAISSEUR_MARCHE_DEFAUT_CM, EPAISSEUR_STRUCTURE_CM } from "@/lib/escaliers";

const HAUTEUR_GARDE_CORPS = 0.9;   // m, au-dessus du nez de marche

// ─── Géométrie 2D utilitaire (plan, mètres) ─────────────────────────────────────────────────────────────
const aireSignee = (pts: Point[]) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;
const centroidePoly = (pts: Point[]): Point => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

// Garde la partie du polygone où sign × ((b − a) ∧ (p − a)) ≥ 0 (Sutherland-Hodgman sur UN demi-plan : robuste).
function demiPlan(poly: Point[], a: Point, b: Point, sign: 1 | -1): Point[] {
  const val = (p: Point) => sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], vp = val(p), vq = val(q);
    if (vp >= 0) out.push(p);
    if ((vp > 0 && vq < 0) || (vp < 0 && vq > 0)) { const t = vp / (vp - vq); out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }); }
  }
  return out;
}

// poly privé du polygone CONVEXE c : renvoie des polygones convexes qui couvrent exactement poly \ c.
function soustraireConvexe(poly: Point[], c: Point[]): Point[][] {
  const conv = aireSignee(c) >= 0 ? c : [...c].reverse();
  const morceaux: Point[][] = [];
  let reste = poly;
  for (let i = 0; i < conv.length && reste.length >= 3; i++) {
    const a = conv[i], b = conv[(i + 1) % conv.length];
    const dehors = demiPlan(reste, a, b, -1);
    if (dehors.length >= 3 && Math.abs(aireSignee(dehors)) > 1e-9) morceaux.push(dehors);
    reste = demiPlan(reste, a, b, 1);
  }
  return morceaux;
}

// Sol d'une pièce percé des trémies (polygones convexes) qui le recouvrent ; null si aucune trémie ne le touche
// (l'appelant garde alors son sol habituel). Triangulation du contour puis soustraction convexe de chaque triangle :
// pas de dépendance, et ça marche aussi quand la trémie déborde de la pièce ou longe un mur.
export function geometrieSolPercee(contour: Point[], tremies: Point[][]): THREE.BufferGeometry | null {
  const xs = contour.map(p => p.x), ys = contour.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const utiles = tremies.filter(t => t.length >= 3 && Math.max(...t.map(p => p.x)) > minX && Math.min(...t.map(p => p.x)) < maxX
    && Math.max(...t.map(p => p.y)) > minY && Math.min(...t.map(p => p.y)) < maxY);
  if (utiles.length === 0) return null;

  const triangles = THREE.ShapeUtils.triangulateShape(contour.map(p => new THREE.Vector2(p.x, p.y)), []);
  let polys: Point[][] = triangles.map(t => t.map(i => contour[i]));
  utiles.forEach(t => { polys = polys.flatMap(p => soustraireConvexe(p, t)); });

  const positions: number[] = [];
  polys.forEach(poly => {
    for (let i = 1; i < poly.length - 1; i++) [poly[0], poly[i], poly[i + 1]].forEach(p => positions.push(p.x, 0, p.y));
  });
  if (positions.length === 0) return new THREE.BufferGeometry();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return geo;
}

// ─── Primitives 3D ──────────────────────────────────────────────────────────────────────────────────────
function prisme(poly: Point[], zBas: number, zHaut: number, mat: THREE.Material): THREE.Mesh | null {
  const pts = poly.filter((p, i) => { const q = poly[(i + poly.length - 1) % poly.length]; return Math.hypot(p.x - q.x, p.y - q.y) > 1e-5; });
  if (pts.length < 3 || zHaut - zBas < 1e-4 || Math.abs(aireSignee(pts)) < 1e-8) return null;
  // Forme dans (x, −y), extrudée selon z, puis couchée (rotation −90° autour de x) : (X, Y, Z) → (X, Z, −Y) = (x, haut, y du plan).
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, -p.y))), { depth: zHaut - zBas, bevelEnabled: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = zBas;
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// Bande d'épaisseur ep le long du segment a→b, du côté « côté » (+1 : à gauche de a→b dans le repère du plan, −1 : à droite).
function bande(a: Point, b: Point, ep: number, cote: 1 | -1): Point[] {
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * ep * cote, ny = (dx / l) * ep * cote;
  return [a, b, { x: b.x + nx, y: b.y + ny }, { x: a.x + nx, y: a.y + ny }];
}

const cylUnitaire = new THREE.CylinderGeometry(1, 1, 1, 10);
function segment(a: THREE.Vector3, b: THREE.Vector3, rayon: number, mat: THREE.Material): THREE.Mesh | null {
  const d = new THREE.Vector3().subVectors(b, a), l = d.length();
  if (l < 1e-5) return null;
  const m = new THREE.Mesh(cylUnitaire, mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.scale.set(rayon, l, rayon);
  m.castShadow = true;
  return m;
}

// Garde-corps le long d'une polyligne 3D : main courante, rotules aux angles, balustres tous les ~12 cm.
function garde(points: THREE.Vector3[], g: THREE.Group, matMain: THREE.Material, matBalustre: THREE.Material, hauteur = HAUTEUR_GARDE_CORPS) {
  if (points.length < 2) return;
  const haut = (p: THREE.Vector3) => new THREE.Vector3(p.x, p.y + hauteur, p.z);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const s = segment(haut(a), haut(b), 0.022, matMain); if (s) g.add(s);
    const horiz = Math.hypot(b.x - a.x, b.z - a.z);
    const nb = Math.max(1, Math.round(horiz / 0.12));
    for (let k = 0; k < nb; k++) {
      const f = k / nb, p = new THREE.Vector3().lerpVectors(a, b, f);
      const bal = segment(p, haut(p), 0.009, matBalustre); if (bal) g.add(bal);
    }
  }
  points.forEach(p => {
    const rotule = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), matMain);
    rotule.position.copy(haut(p)); g.add(rotule);
    const bal = segment(p, haut(p), 0.012, matBalustre); if (bal) g.add(bal);
  });
}

const teinte = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k);

// ─── Escalier ───────────────────────────────────────────────────────────────────────────────────────────
export function creerEscalier3D(calc: CalculEscalier, e: Escalier): THREE.Group {
  const groupe = new THREE.Group();
  const hex = e.couleur && /^#?[0-9a-f]{6}$/i.test(e.couleur) ? parseInt(e.couleur.replace("#", ""), 16) : COULEUR_MATERIAU[e.materiau];
  const matMarche = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7 });
  const matStruct = new THREE.MeshStandardMaterial({ color: e.materiau === "metal" ? 0x4b5563 : teinte(hex, 0.82), roughness: 0.65, metalness: e.materiau === "metal" ? 0.5 : 0 });
  const matMain = new THREE.MeshStandardMaterial({ color: e.materiau === "bois" ? 0x7a5230 : 0x374151, roughness: 0.5, metalness: e.materiau === "bois" ? 0 : 0.6 });
  const matBalustre = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.4, metalness: 0.6 });

  const ep = (e.epaisseurMarche ?? EPAISSEUR_MARCHE_DEFAUT_CM) / 100;
  const hM = calc.hMarche / 100, paillasse = EPAISSEUR_STRUCTURE_CM / 100;
  const ajouter = (m: THREE.Mesh | null) => { if (m) groupe.add(m); };

  calc.marches.forEach(m => {
    const c = centroidePoly(m.poly);
    if (e.structure === "massif") {
      // Béton : chaque marche est un bloc plein qui descend d'une hauteur de marche + la paillasse (dessous en crémaillère).
      ajouter(prisme(m.poly, Math.max(0, m.z - hM - paillasse), m.z, matMarche));
      return;
    }
    ajouter(prisme(m.poly, m.z - ep, m.z, matMarche));

    if (e.contremarches) {
      const [a, b] = m.entree, dx = b.x - a.x, dy = b.y - a.y;
      const versCentre = (c.x - a.x) * -dy + (c.y - a.y) * dx >= 0 ? 1 : -1;     // la contremarche est posée DANS l'emprise de la marche
      ajouter(prisme(bande(a, b, 0.02, versCentre), Math.max(0, m.zPrec - ep), m.z - ep, matMarche));
    }

    const bas = Math.max(0, m.z - hM - paillasse);
    if (e.structure === "limons_lateraux") {
      // Limon crémaillère : une plaque par côté libre, hors de l'emprise, arasée au dessus de la marche.
      m.bords.forEach(b => {
        const dx = b.b.x - b.a.x, dy = b.b.y - b.a.y;
        const versCentre = (c.x - b.a.x) * -dy + (c.y - b.a.y) * dx >= 0 ? 1 : -1;
        ajouter(prisme(bande(b.a, b.b, 0.04, (versCentre * -1) as 1 | -1), bas, m.z, matStruct));
      });
    } else if (e.structure === "limon_central") {
      // Limon central : on découpe dans chaque marche une bande de 14 cm dans le sens de la montée.
      const nrm = { x: -m.axe.y, y: m.axe.x }, l = Math.hypot(m.axe.x, m.axe.y) || 1;
      const u = { x: m.axe.x / l, y: m.axe.y / l }, v = { x: nrm.x / l, y: nrm.y / l };
      const w = 0.07;
      const p1 = { x: c.x + v.x * w, y: c.y + v.y * w }, p2 = { x: c.x - v.x * w, y: c.y - v.y * w };
      let bandeCentrale = demiPlan(m.poly, p1, { x: p1.x + u.x, y: p1.y + u.y }, -1);      // garde (p − c)·v ≤ w
      bandeCentrale = bandeCentrale.length >= 3 ? demiPlan(bandeCentrale, p2, { x: p2.x + u.x, y: p2.y + u.y }, 1) : bandeCentrale;   // et ≥ −w
      if (bandeCentrale.length >= 3) ajouter(prisme(bandeCentrale, bas, m.z - ep, matStruct));
    }
  });

  // Dernière contremarche : jusqu'au plancher du niveau desservi.
  if (e.structure !== "massif" && e.contremarches && calc.marches.length > 0) {
    const dernier = calc.marches[calc.marches.length - 1], c = centroidePoly(dernier.poly);
    const { a, b, zBas, zHaut } = calc.finRiser, dx = b.x - a.x, dy = b.y - a.y;
    const versCentre = (c.x - a.x) * -dy + (c.y - a.y) * dx >= 0 ? 1 : -1;
    ajouter(prisme(bande(a, b, 0.02, versCentre), Math.max(0, zBas - ep), zHaut, matMarche));
  }
  if (e.structure === "massif" && calc.marches.length > 0) {
    const dernier = calc.marches[calc.marches.length - 1], c = centroidePoly(dernier.poly);
    const { a, b, zBas, zHaut } = calc.finRiser, dx = b.x - a.x, dy = b.y - a.y;
    const versCentre = (c.x - a.x) * -dy + (c.y - a.y) * dx >= 0 ? 1 : -1;
    ajouter(prisme(bande(a, b, 0.06, versCentre), Math.max(0, zBas - hM - paillasse), zHaut, matMarche));
  }

  // Poteau central (hélicoïdal) : du sol au plancher du niveau desservi.
  if (calc.poteau && (e.structure === "poteau_central" || e.structure === "limons_lateraux" || e.structure === "limon_central")) {
    const poteau = new THREE.Mesh(new THREE.CylinderGeometry(calc.poteau.rayon, calc.poteau.rayon, calc.finRiser.zHaut, 24), matStruct);
    poteau.position.set(calc.poteau.centre.x, calc.finRiser.zHaut / 2, calc.poteau.centre.y);
    poteau.castShadow = true; poteau.receiveShadow = true;
    groupe.add(poteau);
  }

  // Garde-corps : suit le nez de marche du côté choisi. Chaque marche contribue ses côtés libres ; la hauteur monte d'une
  // contremarche sur la longueur de la marche (le palier reste à plat), si bien que la rampe arrive au plancher supérieur.
  const cotes: ("g" | "d")[] = e.rampe === "deux_cotes" ? ["g", "d"] : e.rampe === "gauche" ? ["g"] : e.rampe === "droite" ? ["d"] : [];
  cotes.forEach(cote => {
    const pts: THREE.Vector3[] = [];
    calc.marches.forEach((m, mi) => {
      const bords = m.bords.filter(b => b.cote === cote);
      if (bords.length === 0) return;
      const longueurs = bords.map(b => Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y)), total = longueurs.reduce((s, l) => s + l, 0) || 1;
      let cumul = 0;
      bords.forEach((b, k) => {
        const z = m.type === "palier" ? m.z : m.z + hM * (cumul / total);
        pts.push(new THREE.Vector3(b.a.x, z, b.a.y));
        cumul += longueurs[k];
        if (k === bords.length - 1 && (m.type === "palier" || mi === calc.marches.length - 1)) {
          pts.push(new THREE.Vector3(b.b.x, m.type === "palier" ? m.z : calc.finRiser.zHaut, b.b.y));
        }
      });
    });
    garde(pts, groupe, matMain, matBalustre);
  });

  return groupe;
}

// Garde-corps autour d'une trémie, sur l'étage desservi : toutes les arêtes sauf celle(s) où l'escalier débouche.
// Les arêtes longeant un mur sont retirées par l'appelant (voir Vue3D).
export function creerGardeCorpsTremie(aretes: [Point, Point][], e: Escalier): THREE.Group {
  const g = new THREE.Group();
  const matMain = new THREE.MeshStandardMaterial({ color: e.materiau === "bois" ? 0x7a5230 : 0x374151, roughness: 0.5, metalness: e.materiau === "bois" ? 0 : 0.6 });
  const matBalustre = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.4, metalness: 0.6 });
  aretes.forEach(([a, b]) => garde([new THREE.Vector3(a.x, 0, a.y), new THREE.Vector3(b.x, 0, b.y)], g, matMain, matBalustre, 1.0));
  return g;
}

// Arêtes de la trémie qui demandent un garde-corps : on écarte celle où l'escalier débouche (contre la dernière
// contremarche) et celles qui longent un mur (distance du milieu à un côté du contour d'une pièce ≤ tolerance).
export function aretesGardeCorpsTremie(calc: CalculEscalier, e: Escalier, contoursPieces: Point[][], tolerance = 0.45): [Point, Point][] {
  const t = calc.tremie, fin = calc.finRiser;
  const dist = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const k = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k));
  };
  const seuilSortie = e.type === "helicoidal" ? Math.max(0.3, (e.largeur || 90) / 200) : 0.06;
  const res: [Point, Point][] = [];
  t.forEach((a, i) => {
    const b = t[(i + 1) % t.length], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (dist(mid, fin.a, fin.b) < seuilSortie) return;
    if (contoursPieces.some(c => c.some((p, k) => dist(mid, p, c[(k + 1) % c.length]) <= tolerance))) return;
    res.push([a, b]);
  });
  return res;
}
