// src/components/plan/Modeles3D.ts
//
// Modèles three.js "ressemblants" des appareillages pour la vue 3D (Vue3D.tsx).
// Repère LOCAL de chaque modèle : x = le long du mur, y = vers le haut, z = vers
// l'INTÉRIEUR de la pièce (le dos de l'appareil est dans le plan z = 0, plaqué contre le
// mur). Vue3D se charge de placer/orienter le groupe sur la face du mur, ou au plafond.
// Dimensions en mètres, proches des produits réels (entraxe 71 mm → plaque 80 × 80 mm).

import * as THREE from "three";
import { AppareillageType, ENTRAXE_POSTE_M } from "@/lib/maison-types";

export type Montage = "mur" | "plafond" | "sol_mur";

export interface ModeleAppareillage {
  groupe: THREE.Group;
  // "mur" : centré sur la hauteur d'installation · "sol_mur" : posé au sol contre le mur
  // (électroménager) · "plafond" : suspendu au plafond (local y vers le bas = -y).
  montage: Montage;
  // Matériau de l'ampoule/du verre pour les luminaires (piloté par la simulation d'éclairage).
  ampoule?: THREE.MeshStandardMaterial;
  demiHauteur: number;   // pour ne pas enfoncer dans le sol un appareil mural posé bas
  hauteurSommet: number; // y local du haut du modèle (placement de la pastille de circuit)
}

// BLANC = blanc pur, volontairement différent de la teinte des murs (Vue3D.tsx) pour que
// l'appareillage ressorte. Un léger émissif l'empêche de tirer vers le gris sous l'éclairage.
const BLANC = 0xffffff;
const m = (color: number | string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({
    color, roughness: 0.55, metalness: 0.05,
    ...(color === BLANC ? { emissive: 0xffffff, emissiveIntensity: 0.22 } : {}),
    ...extra,
  });

const GRIS_CLAIR = 0xd6d3d1, INOX = 0xb8bcc2, NOIR = 0x1c1917, VERRE = 0x0f172a;

function boite(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}
// Cylindre dont l'axe est dirigé selon z (perpendiculaire au mur).
function cylZ(r: number, l: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 24), mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}
function cylY(r: number, l: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 24), mat);
  mesh.position.set(x, y, z);
  return mesh;
}
function cylX(r: number, l: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 16), mat);
  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}
function tore(r: number, tube: number, mat: THREE.Material, x = 0, y = 0, z = 0, versZ = true): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 12, 32), mat);
  if (!versZ) mesh.rotation.x = Math.PI / 2; // tore à plat (hors face avant)
  mesh.position.set(x, y, z);
  return mesh;
}

const T_PLAQUE = 0.011; // épaisseur de plaque saillante (mm → m)

// Teinte d'une prise/commande : plaque + face dans la couleur choisie (blanc pur par défaut),
// accessoires un peu plus sombres, et alvéoles/fente en noir ou en clair selon la luminance
// de la teinte (un noir sur anthracite ne se verrait pas).
function teinte(hex?: string) {
  const blanc = !hex || hex.toLowerCase() === "#ffffff";
  const col = blanc ? new THREE.Color(BLANC) : new THREE.Color(hex);
  const lum = 0.299 * col.r + 0.587 * col.g + 0.114 * col.b;
  return {
    plaque: blanc ? m(BLANC) : m(col.getHex(), { roughness: 0.5 }),
    accent: blanc ? m(GRIS_CLAIR) : m(col.clone().multiplyScalar(0.8).getHex(), { roughness: 0.5 }),
    contraste: lum > 0.4 ? NOIR : 0xe5e7eb,
  };
}

// Largeur de la plaque en cours de construction : 80 mm pour un appareillage simple ; pour un
// POSTE d'une plaque multiple, un tronçon de plaque de 71 mm (= l'entraxe) — les tronçons des
// postes voisins se touchent et forment une seule plaque continue (double, triple, quadruple).
let LARGEUR_PLAQUE = 0.08;
function plaque(g: THREE.Group, mat: THREE.Material): void {
  g.add(boite(LARGEUR_PLAQUE, 0.08, T_PLAQUE, mat, 0, 0, T_PLAQUE / 2));
}

function modelePrise(commandee: boolean, couleur?: string): THREE.Group {
  const g = new THREE.Group();
  const t = teinte(couleur);
  plaque(g, t.plaque);
  const z = T_PLAQUE;
  g.add(cylZ(0.031, 0.004, t.accent, 0, 0, z + 0.002));                // collerette
  g.add(cylZ(0.026, 0.006, t.plaque, 0, 0, z + 0.004));                // face de la prise
  const alveole = m(t.contraste);
  g.add(cylZ(0.0045, 0.003, alveole, -0.011, 0, z + 0.0075));          // alvéole phase
  g.add(cylZ(0.0045, 0.003, alveole, 0.011, 0, z + 0.0075));           // alvéole neutre
  g.add(cylZ(0.0035, 0.012, m(INOX, { metalness: 0.7 }), 0, 0.019, z + 0.008)); // broche de terre
  if (commandee) g.add(cylZ(0.004, 0.004, m(0xf97316, { emissive: 0xf97316, emissiveIntensity: 0.5 }), 0.03, -0.03, z + 0.002));
  return g;
}

// Prise dédiée : prise 2P+T avec collerette orange (repère « circuit spécialisé »).
function modelePriseDediee(couleur?: string): THREE.Group {
  const g = modelePrise(false, couleur);
  g.add(tore(0.0335, 0.0022, m(0xf97316, { emissive: 0xf97316, emissiveIntensity: 0.35 }), 0, 0, T_PLAQUE + 0.003));
  return g;
}

// Prise extérieure : boîtier étanche IP44 gris en saillie, prise 2P+T et clapet de protection
// (repère bleu d'étanchéité).
function modelePriseExterieure(): THREE.Group {
  const g = new THREE.Group();
  const gris = m(0x6b7280);
  g.add(boite(0.09, 0.09, 0.03, gris, 0, 0, 0.015));                       // boîtier en saillie
  const z = 0.03;
  g.add(cylZ(0.03, 0.006, m(0x9ca3af), 0, 0, z + 0.003));                  // collerette
  g.add(cylZ(0.024, 0.006, m(0xd1d5db), 0, 0, z + 0.008));                 // face de la prise
  const alveole = m(0x111827);
  g.add(cylZ(0.0045, 0.003, alveole, -0.01, 0, z + 0.0115));
  g.add(cylZ(0.0045, 0.003, alveole, 0.01, 0, z + 0.0115));
  g.add(cylZ(0.0035, 0.012, m(INOX, { metalness: 0.7 }), 0, 0.017, z + 0.012));
  g.add(boite(0.07, 0.02, 0.008, m(0x2563eb), 0, 0.034, z + 0.004));       // clapet / repère IP44
  return g;
}

// Prise RJ45 (communication) : plaque + embase rectangulaire avec volet anti-poussière, voyant
// de repère bleu (câblage VDI, cat. 6 STP).
function modeleRj45(couleur?: string): THREE.Group {
  const g = new THREE.Group();
  const t = teinte(couleur);
  plaque(g, t.plaque);
  const z = T_PLAQUE;
  g.add(boite(0.03, 0.034, 0.005, t.accent, 0, 0, z + 0.0025));                 // embase
  g.add(boite(0.02, 0.014, 0.004, m(t.contraste), 0, 0.002, z + 0.0055));       // alvéole RJ45
  g.add(boite(0.022, 0.006, 0.003, t.plaque, 0, -0.011, z + 0.0065));           // volet
  g.add(cylZ(0.0035, 0.002, m(0x2563eb, { emissive: 0x2563eb, emissiveIntensity: 0.4 }), 0, 0.024, z + 0.001)); // repère communication
  return g;
}

function modeleInterrupteur(type: "interrupteur" | "va_et_vient" | "telerupteur", couleur?: string): THREE.Group {
  const g = new THREE.Group();
  const t = teinte(couleur);
  plaque(g, t.plaque);
  const z = T_PLAQUE;
  if (type === "telerupteur") {
    g.add(cylZ(0.019, 0.004, t.accent, 0, 0, z + 0.002));
    g.add(cylZ(0.015, 0.008, t.plaque, 0, 0, z + 0.006));            // bouton poussoir rond
    g.add(cylZ(0.0035, 0.002, m(0xfbbf24, { emissive: 0xfbbf24, emissiveIntensity: 0.5 }), 0, 0.027, z + 0.001));
  } else {
    const bascule = boite(0.036, 0.054, 0.007, t.plaque, 0, 0, z + 0.0035);
    bascule.rotation.x = -0.12;                                      // bascule légèrement inclinée
    g.add(bascule);
    g.add(boite(0.038, 0.002, 0.008, t.accent, 0, 0, z + 0.004));    // fente centrale
    if (type === "va_et_vient") g.add(cylZ(0.0035, 0.002, m(t.contraste), 0, 0.037, z + 0.001)); // repère va-et-vient
  }
  return g;
}

// Double commande (1 poste, 2 voies) : deux bascules côte à côte (interrupteur / va-et-vient) ou deux
// boutons ronds l'un sous l'autre (poussoir). Un point repère par voie pour le va-et-vient.
function modeleInterrupteurDouble(base: "interrupteur" | "va_et_vient" | "telerupteur", couleur?: string): THREE.Group {
  const g = new THREE.Group();
  const t = teinte(couleur);
  plaque(g, t.plaque);
  const z = T_PLAQUE;
  if (base === "telerupteur") {
    [0.018, -0.018].forEach(y => {
      g.add(cylZ(0.0135, 0.004, t.accent, 0, y, z + 0.002));
      g.add(cylZ(0.0105, 0.008, t.plaque, 0, y, z + 0.006));
      g.add(cylZ(0.0028, 0.002, m(0xfbbf24, { emissive: 0xfbbf24, emissiveIntensity: 0.5 }), 0.017, y, z + 0.001));
    });
  } else {
    [-0.0175, 0.0175].forEach(x => {
      const bascule = boite(0.028, 0.054, 0.007, t.plaque, x, 0, z + 0.0035);
      bascule.rotation.x = -0.12;
      g.add(bascule);
      g.add(boite(0.03, 0.002, 0.008, t.accent, x, 0, z + 0.004));
      if (base === "va_et_vient") g.add(cylZ(0.003, 0.002, m(t.contraste), x, 0.037, z + 0.001));
    });
  }
  return g;
}

function modeleApplique(): { g: THREE.Group; verre: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  g.add(cylZ(0.05, 0.012, m(INOX, { metalness: 0.6 }), 0, 0, 0.006));  // platine de fixation
  g.add(cylZ(0.009, 0.05, m(INOX, { metalness: 0.6 }), 0, 0, 0.035));  // bras
  const verre = m(0xfff3d6, { emissive: 0xffe0ab, emissiveIntensity: 0.15, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
  const demi = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), verre);
  demi.rotation.x = Math.PI / 2; // pôle vers l'intérieur de la pièce
  demi.position.set(0, 0, 0.045);
  g.add(demi);
  return { g, verre };
}

function modelePlafonnier(): { g: THREE.Group; verre: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  g.add(cylY(0.07, 0.02, m(BLANC), 0, -0.01, 0));                      // rosace
  const verre = m(0xfff3d6, { emissive: 0xffe0ab, emissiveIntensity: 0.15, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), verre);
  dome.rotation.x = Math.PI; // dôme opale ouvert vers le plafond
  dome.position.set(0, -0.02, 0);
  g.add(dome);
  return { g, verre };
}

// Spot encastré (plafond) : collerette blanche affleurante (Ø 9 cm, trou de perçage ~ 7 cm) et face lumineuse
// légèrement en retrait. Le « verre » est le matériau piloté par la simulation d'éclairage (allumé / éteint).
function modeleSpot(): { g: THREE.Group; verre: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  g.add(cylY(0.045, 0.006, m(BLANC), 0, -0.003, 0));                   // collerette affleurante au plafond
  g.add(cylY(0.036, 0.004, m(GRIS_CLAIR), 0, -0.006, 0));              // réflecteur
  const verre = m(0xfff3d6, { emissive: 0xffe0ab, emissiveIntensity: 0.15, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
  g.add(cylY(0.029, 0.003, verre, 0, -0.0075, 0));                     // face lumineuse (LED)
  return { g, verre };
}

// Spot encastré étanche (IP65) : collerette plus large en inox, joint noir et verre bombé.
function modeleSpotEtanche(): { g: THREE.Group; verre: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  g.add(cylY(0.052, 0.008, m(INOX, { metalness: 0.6 }), 0, -0.004, 0));    // collerette inox
  g.add(tore(0.037, 0.0035, m(NOIR), 0, -0.0095, 0, false));               // joint d'étanchéité
  const verre = m(0xfff3d6, { emissive: 0xffe0ab, emissiveIntensity: 0.15, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const bombe = new THREE.Mesh(new THREE.SphereGeometry(0.034, 20, 10, 0, Math.PI * 2, 0, Math.PI / 3), verre);
  bombe.rotation.x = Math.PI;                                              // calotte bombée vers le bas
  bombe.position.set(0, -0.0095, 0);
  g.add(bombe);
  return { g, verre };
}

function hublot(g: THREE.Group, x: number, y: number, z: number, r: number): void {
  g.add(tore(r, 0.018, m(INOX, { metalness: 0.6 }), x, y, z));
  g.add(cylZ(r - 0.01, 0.01, m(VERRE, { transparent: true, opacity: 0.85, metalness: 0.2, roughness: 0.15 }), x, y, z - 0.004));
}

function modeleLaveLinge(couleur: number): THREE.Group {
  const g = new THREE.Group();
  g.add(boite(0.6, 0.85, 0.6, m(couleur), 0, 0.425, 0.3));
  hublot(g, 0, 0.4, 0.6, 0.17);
  g.add(boite(0.52, 0.07, 0.01, m(GRIS_CLAIR), 0, 0.79, 0.6));           // bandeau de commande
  g.add(cylZ(0.022, 0.012, m(INOX, { metalness: 0.6 }), -0.18, 0.79, 0.608));
  g.add(boite(0.1, 0.03, 0.004, m(0x0ea5e9, { emissive: 0x0ea5e9, emissiveIntensity: 0.4 }), 0.12, 0.79, 0.607));
  return g;
}

function modeleLaveVaisselle(): THREE.Group {
  const g = new THREE.Group();
  g.add(boite(0.6, 0.82, 0.58, m(INOX, { metalness: 0.5, roughness: 0.35 }), 0, 0.41, 0.29));
  g.add(boite(0.58, 0.07, 0.01, m(NOIR), 0, 0.77, 0.585));              // bandeau
  g.add(boite(0.4, 0.022, 0.03, m(0x6b7280, { metalness: 0.7 }), 0, 0.7, 0.605)); // poignée
  return g;
}

function modeleCongelateur(): THREE.Group {
  const g = new THREE.Group();
  g.add(boite(0.6, 0.85, 0.65, m(BLANC), 0, 0.425, 0.325));
  g.add(boite(0.58, 0.004, 0.005, m(GRIS_CLAIR), 0, 0.56, 0.652));      // jonction des portes
  g.add(boite(0.02, 0.3, 0.03, m(INOX, { metalness: 0.7 }), 0.24, 0.7, 0.67));
  g.add(boite(0.02, 0.18, 0.03, m(INOX, { metalness: 0.7 }), 0.24, 0.34, 0.67));
  return g;
}

function modeleFour(): THREE.Group {
  const g = new THREE.Group();
  g.add(boite(0.6, 0.6, 0.58, m(0xb08968), 0, 0.3, 0.29));              // caisson bas
  g.add(boite(0.6, 0.6, 0.55, m(INOX, { metalness: 0.6, roughness: 0.35 }), 0, 0.9, 0.275)); // four encastré
  g.add(boite(0.46, 0.3, 0.01, m(VERRE, { metalness: 0.3, roughness: 0.15 }), 0, 0.86, 0.555)); // vitre
  g.add(boite(0.5, 0.02, 0.03, m(0x6b7280, { metalness: 0.7 }), 0, 1.1, 0.585)); // poignée
  g.add(cylZ(0.016, 0.014, m(NOIR), -0.17, 1.16, 0.56));
  g.add(cylZ(0.016, 0.014, m(NOIR), 0.17, 1.16, 0.56));
  return g;
}

function modelePlaque(): THREE.Group {
  const g = new THREE.Group();
  g.add(boite(0.6, 0.84, 0.6, m(0xe7e5e4), 0, 0.42, 0.3));              // meuble bas
  g.add(boite(0.62, 0.04, 0.62, m(0x78716c), 0, 0.86, 0.31));           // plan de travail
  g.add(boite(0.58, 0.008, 0.52, m(NOIR, { metalness: 0.3, roughness: 0.2 }), 0, 0.884, 0.3)); // vitrocéramique
  [[-0.14, 0.18], [0.14, 0.18], [-0.14, 0.42], [0.14, 0.42]].forEach(([x, z]) =>
    g.add(tore(0.065, 0.004, m(0xef4444, { emissive: 0xef4444, emissiveIntensity: 0.1 }), x, 0.89, z, false)));
  return g;
}

function modeleChauffeEau(): THREE.Group {
  const g = new THREE.Group();
  g.add(cylY(0.25, 0.9, m(BLANC), 0, 0, 0.27));                         // cuve verticale
  g.add(cylY(0.255, 0.04, m(GRIS_CLAIR), 0, -0.43, 0.27));              // fond
  g.add(cylY(0.012, 0.1, m(0x3b82f6), -0.07, -0.52, 0.27));             // arrivée eau froide
  g.add(cylY(0.012, 0.1, m(0xef4444), 0.07, -0.52, 0.27));              // départ eau chaude
  return g;
}

function modeleConvecteur(): THREE.Group {
  const g = new THREE.Group();
  g.add(boite(0.8, 0.45, 0.09, m(BLANC), 0, 0, 0.055));
  for (let i = 0; i < 8; i++) g.add(boite(0.62, 0.008, 0.01, m(GRIS_CLAIR), -0.06, 0.17 - i * 0.012, 0.1));
  g.add(cylZ(0.016, 0.012, m(NOIR), 0.33, -0.13, 0.1));
  return g;
}

function modeleClim(): THREE.Group {
  const g = new THREE.Group();
  g.add(boite(0.9, 0.28, 0.2, m(BLANC), 0, 0, 0.11));
  g.add(boite(0.8, 0.03, 0.03, m(GRIS_CLAIR), 0, -0.115, 0.21));
  g.add(cylZ(0.004, 0.004, m(0x22c55e, { emissive: 0x22c55e, emissiveIntensity: 0.8 }), 0.38, 0.08, 0.21));
  return g;
}

function modeleSecheServiette(): THREE.Group {
  const g = new THREE.Group();
  const tube = m(BLANC);
  g.add(cylY(0.016, 1.2, tube, -0.22, 0, 0.07));
  g.add(cylY(0.016, 1.2, tube, 0.22, 0, 0.07));
  for (let i = 0; i < 9; i++) g.add(cylX(0.011, 0.44, tube, 0, -0.5 + i * 0.125, 0.07));
  return g;
}

function modeleIrve(): THREE.Group {
  const g = new THREE.Group();
  g.add(boite(0.22, 0.36, 0.12, m(0x1f2937), 0, 0, 0.06));
  g.add(boite(0.2, 0.2, 0.004, m(0x374151), 0, 0.05, 0.122));
  g.add(tore(0.03, 0.004, m(0x22c55e, { emissive: 0x22c55e, emissiveIntensity: 0.8 }), 0, 0.09, 0.126));
  g.add(cylZ(0.03, 0.05, m(NOIR), 0, -0.12, 0.145));                    // support de pistolet
  return g;
}

function modelePac(): THREE.Group {
  const g = new THREE.Group();
  g.add(boite(0.9, 0.7, 0.35, m(GRIS_CLAIR), 0, 0.35, 0.175));
  g.add(cylZ(0.28, 0.01, m(0x4b5563), 0, 0.37, 0.355));                 // grille de ventilateur
  g.add(tore(0.28, 0.01, m(INOX, { metalness: 0.6 }), 0, 0.37, 0.358));
  g.add(tore(0.14, 0.006, m(INOX, { metalness: 0.6 }), 0, 0.37, 0.358));
  return g;
}

function modeleVmc(): THREE.Group {
  const g = new THREE.Group();
  g.add(cylZ(0.08, 0.03, m(BLANC), 0, 0, 0.015));
  g.add(cylZ(0.06, 0.012, m(GRIS_CLAIR), 0, 0, 0.032));
  g.add(cylZ(0.015, 0.014, m(NOIR), 0, 0, 0.04));
  return g;
}

function modeleAlarme(): THREE.Group {
  const g = new THREE.Group();
  g.add(boite(0.22, 0.22, 0.08, m(BLANC), 0, -0.03, 0.04));
  g.add(boite(0.22, 0.07, 0.085, m(0xdc2626, { emissive: 0xdc2626, emissiveIntensity: 0.25 }), 0, 0.12, 0.0425)); // flash
  return g;
}

// ─── VOLET ROULANT PARAMÉTRIQUE ─────────────────────────────────────────────────
// Contrairement aux autres modèles, celui-ci est construit EN COORDONNÉES MONDE verticales
// (y = hauteur absolue depuis le sol) pour coller à la fenêtre : largeur/hauteur/allège
// viennent de l'ouverture du mur (baieDuVolet). x = le long du mur, z = vers l'intérieur de
// la pièce, z = 0 = face intérieure du mur. Le coffre (18 cm) est posé au-dessus du linteau,
// soit dans la pièce (caisson intérieur), soit contre la face extérieure (caisson extérieur).
export interface OptsVolet {
  largeur: number; hauteur: number; allege: number;   // mètres — dimensions de la baie
  caisson: "interieur" | "exterieur";
  epaisseurMur: number; plafond: number;               // mètres
  ouvertPct: number;                                    // 0 fermé … 100 ouvert
  couleur?: string;                                     // hex du volet — blanc par défaut
  couleurCircuit?: string;
}
export interface ModeleVolet {
  groupe: THREE.Group;
  setOuverture: (pct: number) => void;
  hautMoteur: number; // y du moteur (point de raccordement du câble)
}

export function creerVoletRoulant(o: OptsVolet): ModeleVolet {
  const g = new THREE.Group();
  const W = Math.max(0.3, o.largeur), H = Math.max(0.2, o.hauteur);
  const yHaut = o.allege + H;                                       // dessus de la baie = bas du coffre
  const coffreH = Math.max(0.1, Math.min(0.18, o.plafond - yHaut - 0.005));
  const prof = 0.18;
  const ext = o.caisson === "exterieur";
  const s = ext ? -1 : 1;                                           // sens de saillie du volet
  const z0 = ext ? -(o.epaisseurMur + 0.004) : 0;                   // plan du mur côté volet

  // Blanc = matériau blanc pur du reste de l'appareillage ; autre teinte = matériau mat sans
  // émissif (qui éclaircirait une couleur foncée). Les accessoires (trappe, coulisses, lame
  // finale) sont la même teinte, légèrement assombrie, comme sur un volet réel.
  const estBlanc = !o.couleur || o.couleur.toLowerCase() === "#ffffff";
  const base = estBlanc ? m(BLANC) : m(o.couleur!, { roughness: 0.6 });
  const accessoire = estBlanc ? m(GRIS_CLAIR) : m(new THREE.Color(o.couleur!).multiplyScalar(0.82).getHex(), { roughness: 0.6 });
  g.add(boite(W + 0.12, coffreH, prof, base, 0, yHaut + coffreH / 2, z0 + s * prof / 2));            // coffre
  g.add(boite(W + 0.12, 0.012, prof + 0.002, accessoire, 0, yHaut + 0.006, z0 + s * prof / 2));     // trappe / sous-face
  const rail = accessoire;
  g.add(boite(0.03, H, 0.04, rail, -(W / 2 + 0.04), o.allege + H / 2, z0 + s * 0.02));            // coulisses
  g.add(boite(0.03, H, 0.04, rail, W / 2 + 0.04, o.allege + H / 2, z0 + s * 0.02));

  const nb = Math.max(1, Math.round(H / 0.045));
  const pas = H / nb;                                               // pas de lame (≈ 4,5 cm), tablier fermé = H exactement
  const lameGeo = new THREE.BoxGeometry(W + 0.04, pas - 0.004, 0.012);
  const lameMat = base;
  const lames: THREE.Mesh[] = [];
  for (let i = 0; i < nb; i++) {
    const lame = new THREE.Mesh(lameGeo, lameMat);
    lame.position.set(0, yHaut - (i + 0.5) * pas, z0 + s * 0.03);
    g.add(lame); lames.push(lame);
  }
  const finale = boite(W + 0.04, 0.04, 0.02, accessoire, 0, 0, z0 + s * 0.03);                  // lame finale
  g.add(finale);

  // Le volet BLOQUE le soleil : coffre, coulisses et lames projettent une ombre. Une lame masquée (volet
  // partiellement ou totalement ouvert, voir setOuverture : visible = false) ne projette plus d'ombre, donc la
  // lumière du soleil entre par la fenêtre à proportion exacte de l'ouverture du volet.
  g.traverse(x => { if (x instanceof THREE.Mesh) x.castShadow = true; });

  if (o.couleurCircuit) {
    const pastille = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 12),
      m(o.couleurCircuit, { emissive: o.couleurCircuit, emissiveIntensity: 0.35 }));
    pastille.position.set(0, yHaut + coffreH / 2, z0 + s * (prof + 0.012));
    g.add(pastille);
  }

  const setOuverture = (pct: number) => {
    const fermeture = 1 - Math.max(0, Math.min(100, pct)) / 100;     // 1 = fermé
    const visibles = fermeture < 0.001 ? 0 : Math.max(1, Math.round(nb * fermeture));
    lames.forEach((l, i) => { l.visible = i < visibles; });
    finale.visible = visibles > 0;
    finale.position.y = yHaut - visibles * pas + 0.02;               // la lame finale ferme le bas du tablier
  };
  setOuverture(o.ouvertPct);
  return { groupe: g, setOuverture, hautMoteur: yHaut + coffreH / 2 };
}

const MONTAGE: Record<AppareillageType, Montage> = {
  prise: "mur", prise_commandee: "mur", interrupteur: "mur", va_et_vient: "mur", telerupteur: "mur",
  interrupteur_double: "mur", va_et_vient_double: "mur", telerupteur_double: "mur",
  rj45: "mur", prise_dediee: "mur", prise_exterieure: "mur",
  applique: "mur", point_lumineux: "plafond", spot: "plafond", spot_etanche: "plafond",
  four: "sol_mur", plaque: "sol_mur", lave_linge: "sol_mur", lave_vaisselle: "sol_mur", seche_linge: "sol_mur",
  congelateur: "sol_mur", piscine: "sol_mur",
  chauffe_eau: "mur", chauffage: "mur", clim: "mur", seche_serviette: "mur", irve: "mur", vmc: "mur", alarme: "mur",
  volet_roulant: "mur",
};
const DEMI_HAUTEUR: Partial<Record<AppareillageType, number>> = {
  prise: 0.04, prise_commandee: 0.04, interrupteur: 0.04, va_et_vient: 0.04, telerupteur: 0.04, interrupteur_double: 0.04, va_et_vient_double: 0.04, telerupteur_double: 0.04, rj45: 0.04, prise_dediee: 0.04, prise_exterieure: 0.05,
  applique: 0.075, chauffe_eau: 0.5, chauffage: 0.225, clim: 0.14, seche_serviette: 0.6, irve: 0.18, vmc: 0.08, alarme: 0.14, volet_roulant: 0.12,
};
const SOMMET: Partial<Record<AppareillageType, number>> = {
  prise: 0.045, prise_commandee: 0.045, interrupteur: 0.045, va_et_vient: 0.045, telerupteur: 0.045, interrupteur_double: 0.045, va_et_vient_double: 0.045, telerupteur_double: 0.045, rj45: 0.045, prise_dediee: 0.045, prise_exterieure: 0.055,
  applique: 0.08, point_lumineux: 0, spot: 0, spot_etanche: 0, four: 1.2, plaque: 0.9, lave_linge: 0.85, lave_vaisselle: 0.82, seche_linge: 0.85,
  congelateur: 0.85, piscine: 0.7, chauffe_eau: 0.45, chauffage: 0.23, clim: 0.14, seche_serviette: 0.6,
  irve: 0.18, vmc: 0.08, alarme: 0.2, volet_roulant: 0.1,
};

// poste = true : le modèle est un POSTE d'une plaque multiple (tronçon de plaque de 71 mm, voir
// LARGEUR_PLAQUE) ; les tronçons voisins forment une plaque continue.
export function creerModeleAppareillage(type: AppareillageType, couleurCircuit?: string, couleur?: string, poste = false): ModeleAppareillage {
  let groupe: THREE.Group;
  let ampoule: THREE.MeshStandardMaterial | undefined;
  LARGEUR_PLAQUE = poste ? ENTRAXE_POSTE_M : 0.08;
  try {
  switch (type) {
    case "prise": groupe = modelePrise(false, couleur); break;
    case "prise_commandee": groupe = modelePrise(true, couleur); break;
    case "prise_dediee": groupe = modelePriseDediee(couleur); break;
    case "prise_exterieure": groupe = modelePriseExterieure(); break;
    case "rj45": groupe = modeleRj45(couleur); break;
    case "interrupteur": case "va_et_vient": case "telerupteur": groupe = modeleInterrupteur(type, couleur); break;
    case "interrupteur_double": groupe = modeleInterrupteurDouble("interrupteur", couleur); break;
    case "va_et_vient_double": groupe = modeleInterrupteurDouble("va_et_vient", couleur); break;
    case "telerupteur_double": groupe = modeleInterrupteurDouble("telerupteur", couleur); break;
    case "applique": { const r = modeleApplique(); groupe = r.g; ampoule = r.verre; break; }
    case "point_lumineux": { const r = modelePlafonnier(); groupe = r.g; ampoule = r.verre; break; }
    case "spot": { const r = modeleSpot(); groupe = r.g; ampoule = r.verre; break; }
    case "spot_etanche": { const r = modeleSpotEtanche(); groupe = r.g; ampoule = r.verre; break; }
    case "lave_linge": groupe = modeleLaveLinge(BLANC); break;
    case "seche_linge": groupe = modeleLaveLinge(BLANC); break;
    case "lave_vaisselle": groupe = modeleLaveVaisselle(); break;
    case "congelateur": groupe = modeleCongelateur(); break;
    case "four": groupe = modeleFour(); break;
    case "plaque": groupe = modelePlaque(); break;
    case "chauffe_eau": groupe = modeleChauffeEau(); break;
    case "chauffage": groupe = modeleConvecteur(); break;
    case "clim": groupe = modeleClim(); break;
    case "seche_serviette": groupe = modeleSecheServiette(); break;
    case "irve": groupe = modeleIrve(); break;
    case "piscine": groupe = modelePac(); break;
    case "vmc": groupe = modeleVmc(); break;
    case "volet_roulant": groupe = creerVoletRoulant({ largeur: 1, hauteur: 1.2, allege: 0.9, caisson: "interieur", epaisseurMur: 0.1, plafond: 2.5, ouvertPct: 50 }).groupe; break;
    case "alarme": default: groupe = modeleAlarme(); break;
  }
  } finally { LARGEUR_PLAQUE = 0.08; }
  const montage = MONTAGE[type] ?? "mur";
  const hauteurSommet = SOMMET[type] ?? 0.1;
  // Électroménager : porte ombre (bloque réellement la lumière des points lumineux) ;
  // luminaires, plaques et petit appareillage : pas d'ombre (éviter l'auto-ombrage du dôme
  // autour de sa propre source, et le coût des ombres sur des objets de quelques cm).
  groupe.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = montage === "sol_mur"; o.receiveShadow = montage === "sol_mur"; } });
  // Pastille de couleur du circuit (mode "Circuits") pour retrouver le circuit d'un coup d'œil.
  if (couleurCircuit && montage === "plafond") {
    // Les spots sont petits et nombreux : un anneau proportionné (sinon la bague de circuit les engloutit).
    const spot = type === "spot" || type === "spot_etanche";
    const anneau = new THREE.Mesh(new THREE.TorusGeometry(spot ? (type === "spot" ? 0.056 : 0.063) : 0.095, spot ? 0.004 : 0.007, 8, 32), m(couleurCircuit, { emissive: couleurCircuit, emissiveIntensity: 0.4 }));
    anneau.rotation.x = Math.PI / 2;
    anneau.position.set(0, spot ? -0.005 : -0.02, 0);
    groupe.add(anneau);
  }
  if (couleurCircuit && montage !== "plafond") {
    const pastille = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 12), m(couleurCircuit, { emissive: couleurCircuit, emissiveIntensity: 0.35 }));
    pastille.position.set(0, hauteurSommet + 0.04, 0.03);
    groupe.add(pastille);
  }
  return { groupe, montage, ampoule, demiHauteur: DEMI_HAUTEUR[type] ?? 0, hauteurSommet };
}

// Pose APPARENTE : l'appareillage se monte sur un boîtier en saillie (3 cm) vissé sur la face du
// mur, et le câble descend du plafond sous une goulotte (PVC blanc 20 × 14 mm). Renvoie un groupe
// racine dans le MÊME repère local (z = vers l'intérieur de la pièce, y = vers le haut) à la place
// du groupe du modèle. hauteurAppareil : y monde du centre de l'appareil ; plafond : hauteur du mur.
export const TYPES_POSE_APPARENTE: AppareillageType[] = ["prise", "prise_commandee", "interrupteur", "va_et_vient", "telerupteur", "interrupteur_double", "va_et_vient_double", "telerupteur_double", "applique", "rj45", "prise_dediee"];
// hauteurMontee = hauteur (m) jusqu'où monte la goulotte : celle à laquelle le câble court à plat.
export function habillerEnSaillie(modele: ModeleAppareillage, hauteurAppareil: number, hauteurMontee: number): THREE.Group {
  const racine = new THREE.Group();
  const SAILLIE = 0.03;
  modele.groupe.position.z += SAILLIE;                                       // l'appareil recule d'autant
  racine.add(modele.groupe);
  const pvc = m(BLANC);
  racine.add(boite(0.086, 0.086, SAILLIE, pvc, 0, 0, SAILLIE / 2));            // boîtier en saillie
  const haut = 0.043;                                                        // bas de la goulotte = haut du boîtier
  const longueur = Math.max(0, hauteurMontee - hauteurAppareil - haut);
  if (longueur > 0.02) racine.add(boite(0.02, longueur, 0.014, pvc, 0, haut + longueur / 2, 0.007)); // goulotte
  racine.traverse(o => { if (o instanceof THREE.Mesh && o !== undefined) { o.castShadow = false; } });
  return racine;
}
