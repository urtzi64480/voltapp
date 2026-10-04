// Portes ouvrables de la vue 3D : porte battante (intérieure, d'entrée ou de service) et porte
// coulissante. Chaque porte est un groupe three.js « mobile » dont on pilote l'ouverture de
// 0 (fermée) à 100 (ouverte) sans reconstruire la scène — voir appliquerOuverturePorte().
//
// Repère local d'une porte (celui du mur qui la porte, voir construireMurAvecOuvertures dans
// Vue3D.tsx) : x = le long du mur (du 1er vers le 2e sommet du segment), y = vertical,
// z = normale gauche du mur dans le plan (= y du plan 2D).

import * as THREE from "three";
import type { UsagePorte } from "@/lib/maison-types";

// Ouverture maximale d'une porte battante (100 °) : franchement ouverte sans être à plat contre le mur.
export const ANGLE_PORTE_MAX = (100 * Math.PI) / 180;

export interface PorteRegistre {
  id: number;                          // id de l'ouverture (clé de l'état ouvert/fermé)
  genre: "battante" | "coulissante" | "basculante";
  mobile: THREE.Group;                 // battante : pivote (rotation.y) autour de la charnière ; coulissante : glisse (position.x) ; basculante : bascule (rotation.x) autour de son bord haut
  signe: number;                       // battante / basculante : sens de rotation ; coulissante : côté vers lequel le panneau se gare (+1 / −1)
  course: number;                      // coulissante : course du panneau en mètres (= largeur de l'ouverture)
  defaut: number;                      // ouverture initiale : 0 fermée … 100 ouverte
}

// Applique une ouverture (0..100) à une porte déjà construite.
export function appliquerOuverturePorte(p: PorteRegistre, pct: number): void {
  const f = Math.max(0, Math.min(100, pct)) / 100;
  if (p.genre === "battante") p.mobile.rotation.y = p.signe * ANGLE_PORTE_MAX * f;
  else if (p.genre === "basculante") p.mobile.rotation.x = p.signe * ANGLE_GARAGE_MAX * f;
  else p.mobile.position.x = p.signe * p.course * f;
}

// Porte de garage basculante : le tablier pivote autour de son bord HAUT et finit presque à l'horizontale sous le plafond.
export const ANGLE_GARAGE_MAX = (88 * Math.PI) / 180;

const EPAISSEUR_VANTAIL: Record<UsagePorte, number> = { interieure: 0.04, entree: 0.058, service: 0.045 };
const COULEUR_VANTAIL: Record<UsagePorte, number> = { interieure: 0xf3eee4, entree: 0x3f4a57, service: 0xa9b4bf };
const COULEUR_CADRE: Record<UsagePorte, number> = { interieure: 0xe7e0d2, entree: 0x2b333c, service: 0x8e99a5 };
const COULEUR_PANNEAU: Record<UsagePorte, number> = { interieure: 0xe3dccd, entree: 0x38424e, service: 0x98a3ae };

// Porte battante : encadrement fixe (« cadre ») + vantail (« swing ») pivotant autour de sa charnière.
//  larg / haut : dimensions de l'ouverture dans le mur (m) ; epMur : épaisseur de la couche porteuse (m) ;
//  hs : côté de la charnière dans le repère du mur (−1 = côté du 1er sommet = « gauche », +1 = « droite ») ;
//  faceInt : signe de z côté intérieur de la pièce (la quincaillerie d'une porte d'entrée est différente dedans / dehors).
// Le groupe « swing » est à animer avec rotation.y (voir appliquerOuverturePorte, signe = sensBattement × hs).
export function creerPorteBattante(p: {
  larg: number; haut: number; epMur: number; usage: UsagePorte; hs: number; faceInt: number;
}): { cadre: THREE.Group; swing: THREE.Group } {
  const { larg, haut, epMur, usage, hs, faceInt } = p;
  const cadre = new THREE.Group();
  const swing = new THREE.Group();

  const matCadre = new THREE.MeshStandardMaterial({ color: COULEUR_CADRE[usage], roughness: 0.6 });
  const prof = epMur + 0.02;
  const ep = 0.02; // chambranle : 2 cm
  const ajouterCadre = (w: number, h: number, x: number, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, prof), matCadre);
    m.position.set(x, y, 0);
    m.castShadow = true; m.receiveShadow = true;
    cadre.add(m);
  };
  ajouterCadre(ep, haut, -(larg / 2 - ep / 2), haut / 2);
  ajouterCadre(ep, haut, larg / 2 - ep / 2, haut / 2);
  ajouterCadre(larg, ep, 0, haut - ep / 2);
  const bas = usage === "interieure" ? 0.01 : 0.025;
  if (usage !== "interieure") {
    // Seuil des portes donnant sur l'extérieur.
    const seuil = new THREE.Mesh(new THREE.BoxGeometry(larg, 0.02, prof), new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.5, metalness: 0.3 }));
    seuil.position.set(0, 0.01, 0);
    seuil.receiveShadow = true;
    cadre.add(seuil);
  }

  const t = EPAISSEUR_VANTAIL[usage];
  const lw = Math.max(0.2, larg - 2 * ep - 0.008);
  const lh = Math.max(0.5, haut - ep - 0.004 - bas);
  swing.position.set(hs * (larg / 2 - ep - 0.004), 0, 0);
  // Position le long du vantail, à partir de la charnière (0) jusqu'au bord libre (1).
  const dx = (frac: number) => -hs * lw * frac;

  const leaf = new THREE.Mesh(new THREE.BoxGeometry(lw, lh, t), new THREE.MeshStandardMaterial({ color: COULEUR_VANTAIL[usage], roughness: 0.55 }));
  leaf.position.set(dx(0.5), bas + lh / 2, 0);
  leaf.castShadow = true; leaf.receiveShadow = true;
  swing.add(leaf);

  const matPanneau = new THREE.MeshStandardMaterial({ color: COULEUR_PANNEAU[usage], roughness: 0.6 });
  const matVitre = new THREE.MeshStandardMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.5, roughness: 0.1 });
  const panneau = (frac: number, wFrac: number, hFrac: number, yFrac: number) => {
    for (const face of [1, -1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(lw * wFrac, lh * hFrac, 0.006), matPanneau);
      m.position.set(dx(frac), bas + lh * yFrac, face * (t / 2));
      swing.add(m);
    }
  };
  if (usage === "interieure") {
    // Deux panneaux moulurés (haut / bas) sur chaque face.
    panneau(0.5, 0.62, 0.34, 0.72);
    panneau(0.5, 0.62, 0.30, 0.28);
  } else if (usage === "service") {
    // Partie haute vitrée, partie basse pleine à panneau.
    const vitre = new THREE.Mesh(new THREE.BoxGeometry(lw * 0.62, lh * 0.34, t + 0.004), matVitre);
    vitre.position.set(dx(0.5), bas + lh * 0.72, 0);
    swing.add(vitre);
    panneau(0.5, 0.62, 0.30, 0.28);
  } else {
    // Porte d'entrée pleine, avec une fente vitrée verticale côté bord libre.
    const fente = new THREE.Mesh(new THREE.BoxGeometry(0.1, lh * 0.5, t + 0.004), matVitre);
    fente.position.set(dx(0.3), bas + lh * 0.62, 0);
    swing.add(fente);
  }

  // Quincaillerie (inox).
  const matInox = new THREE.MeshStandardMaterial({ color: 0xc7cdd3, metalness: 0.7, roughness: 0.3 });
  const yPoignee = Math.min(1.05, bas + lh * 0.5);
  const xPoignee = dx(0.9);
  const levier = (face: number) => {
    const rosace = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.008, 16), matInox);
    rosace.rotation.x = Math.PI / 2;
    rosace.position.set(xPoignee, yPoignee, face * (t / 2 + 0.004));
    // Le bras du levier pointe vers la charnière (côté +hs depuis le bord libre).
    const bras = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.018, 0.018), matInox);
    bras.position.set(xPoignee + hs * 0.045, yPoignee, face * (t / 2 + 0.02));
    swing.add(rosace, bras);
  };
  if (usage === "entree") {
    const faceExt = -faceInt;
    levier(faceInt);
    // Côté extérieur : poignée de tirage verticale, cylindre de serrure et judas.
    const barre = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.5, 12), matInox);
    barre.position.set(xPoignee, bas + lh * 0.55, faceExt * (t / 2 + 0.045));
    swing.add(barre);
    [-0.2, 0.2].forEach(dy => {
      const patte = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.045, 8), matInox);
      patte.rotation.x = Math.PI / 2;
      patte.position.set(xPoignee, bas + lh * 0.55 + dy, faceExt * (t / 2 + 0.0225));
      swing.add(patte);
    });
    const cylindre = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 12), matInox);
    cylindre.rotation.x = Math.PI / 2;
    cylindre.position.set(dx(0.78), 1.0, faceExt * (t / 2 + 0.006));
    swing.add(cylindre);
    const judas = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.01, 10), new THREE.MeshStandardMaterial({ color: 0x111827 }));
    judas.rotation.x = Math.PI / 2;
    judas.position.set(dx(0.5), Math.min(1.55, bas + lh * 0.75), faceExt * (t / 2 + 0.005));
    swing.add(judas);
  } else {
    levier(1);
    levier(-1);
  }

  return { cadre, swing };
}

// Porte coulissante : un panneau plein qui, fermé, remplit l'ouverture et, ouvert, se « gare » contre le mur
// voisin du côté choisi (cote = +1 « droite », −1 « gauche »). Le groupe « mobile » glisse le long du mur.
export function creerPorteCoulissante(p: { larg: number; haut: number; epMur: number }): THREE.Group {
  const mobile = new THREE.Group();
  const panneau = new THREE.Mesh(
    new THREE.BoxGeometry(p.larg, p.haut, p.epMur * 0.4),
    new THREE.MeshStandardMaterial({ color: 0xd6c7a1 }),
  );
  panneau.position.set(0, p.haut / 2, 0);
  panneau.castShadow = true; panneau.receiveShadow = true;
  mobile.add(panneau);
  return mobile;
}

// Baie vitrée coulissante à 2 vantaux : un vantail FIXE et un vantail MOBILE qui glisse, devant le fixe (rail avant),
// de la moitié de la largeur. cote = +1 « droite » / −1 « gauche » : sens dans lequel le vantail mobile coulisse.
// Fermée, le mobile occupe la moitié opposée ; ouverte, il recouvre le fixe et libère la moitié de la baie.
// « cadre » : dormant fixe (+ vantail fixe) ; « mobile » : vantail à animer (position.x, voir appliquerOuverturePorte,
// course = larg / 2). Le vitrage ne projette pas d'ombre : le soleil passe à travers.
export function creerBaieVitree(p: { larg: number; haut: number; epMur: number; cote: number }): { cadre: THREE.Group; mobile: THREE.Group } {
  const { larg, haut, epMur, cote } = p;
  const cadre = new THREE.Group();
  const mobile = new THREE.Group();
  const matAlu = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.4, metalness: 0.5 });
  const matVitre = new THREE.MeshStandardMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.28, roughness: 0.05, depthWrite: false });
  const prof = Math.min(0.12, epMur + 0.02);

  // Dormant : 4 profilés sur le pourtour de l'ouverture + seuil.
  const ep = 0.05;
  const barre = (cible: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matAlu);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    cible.add(m);
  };
  barre(cadre, ep, haut, prof, -(larg / 2 - ep / 2), haut / 2, 0);
  barre(cadre, ep, haut, prof, larg / 2 - ep / 2, haut / 2, 0);
  barre(cadre, larg, ep, prof, 0, haut - ep / 2, 0);
  barre(cadre, larg, 0.03, prof, 0, 0.015, 0);

  // Un vantail = cadre alu (4 profilés fins) + vitre. cx : centre du vantail ; z : rail (avant / arrière).
  const vantail = (cible: THREE.Group, cx: number, z: number) => {
    const w = larg / 2 + 0.03;           // léger recouvrement central
    const h = haut - ep - 0.035;
    const y0 = 0.03;
    const e = 0.04, d = 0.035;
    barre(cible, e, h, d, cx - w / 2 + e / 2, y0 + h / 2, z);
    barre(cible, e, h, d, cx + w / 2 - e / 2, y0 + h / 2, z);
    barre(cible, w, e, d, cx, y0 + h - e / 2, z);
    barre(cible, w, e, d, cx, y0 + e / 2, z);
    const vitre = new THREE.Mesh(new THREE.BoxGeometry(w - 2 * e, h - 2 * e, 0.008), matVitre);
    vitre.position.set(cx, y0 + h / 2, z);
    cible.add(vitre);
  };
  const xFixe = cote * (larg / 4);        // le fixe est du côté vers lequel le mobile glisse
  vantail(cadre, xFixe, -0.022);
  vantail(mobile, -xFixe, 0.022);          // le mobile démarre sur l'autre moitié
  // Poignée du vantail mobile, côté bord de fermeture (milieu de la baie).
  const poignee = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.03), new THREE.MeshStandardMaterial({ color: 0xc7cdd3, metalness: 0.7, roughness: 0.3 }));
  poignee.position.set(-xFixe + cote * (larg / 4 - 0.06), 1.05, 0.048);
  mobile.add(poignee);
  return { cadre, mobile };
}

// Porte de garage basculante : tablier plein à 3 rainures + poignée, suspendu à son bord haut. Le groupe « mobile » a son
// ORIGINE au bas du profilé haut de l'ouverture, soit haut − 4 cm (le tablier pend vers le bas) : on le fait pivoter avec rotation.x
// (voir appliquerOuverturePorte, genre « basculante »).
export function creerPorteGarage(p: { larg: number; haut: number; epMur: number }): { cadre: THREE.Group; mobile: THREE.Group } {
  const { larg, haut, epMur } = p;
  const cadre = new THREE.Group();
  const mobile = new THREE.Group();
  const matCadre = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.5 });
  const prof = Math.min(0.14, epMur + 0.02);
  const ep = 0.04;
  const barre = (w: number, h: number, x: number, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, prof), matCadre);
    m.position.set(x, y, 0);
    m.castShadow = true; m.receiveShadow = true;
    cadre.add(m);
  };
  barre(ep, haut, -(larg / 2 - ep / 2), haut / 2);
  barre(ep, haut, larg / 2 - ep / 2, haut / 2);
  barre(larg, ep, 0, haut - ep / 2);

  const lw = larg - 2 * ep - 0.01;
  const lh = haut - ep - 0.01;
  const tablier = new THREE.Mesh(new THREE.BoxGeometry(lw, lh, 0.04), new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.6 }));
  tablier.position.set(0, -lh / 2, 0);   // pend sous le dormant haut (origine du groupe = bas du profilé haut)
  tablier.castShadow = true; tablier.receiveShadow = true;
  mobile.add(tablier);
  const matRainure = new THREE.MeshStandardMaterial({ color: 0x9ca3af });
  [0.25, 0.5, 0.75].forEach(f => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(lw, 0.012, 0.046), matRainure);
    r.position.set(0, -lh * f, 0);
    mobile.add(r);
  });
  const poignee = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.06), new THREE.MeshStandardMaterial({ color: 0x374151 }));
  poignee.position.set(0, -lh * 0.55, 0);
  mobile.add(poignee);
  return { cadre, mobile };
}
