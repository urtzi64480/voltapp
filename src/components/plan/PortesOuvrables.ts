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
  mobile2?: THREE.Group;               // battante à DEUX vantaux (fenêtre double battant) : second vantail, piloté avec le premier
  signe2?: number;                     // sens de rotation du second vantail
}

// Applique une ouverture (0..100) à une porte déjà construite.
export function appliquerOuverturePorte(p: PorteRegistre, pct: number): void {
  const f = Math.max(0, Math.min(100, pct)) / 100;
  if (p.genre === "battante") {
    p.mobile.rotation.y = p.signe * ANGLE_PORTE_MAX * f;
    if (p.mobile2) p.mobile2.rotation.y = (p.signe2 ?? p.signe) * ANGLE_PORTE_MAX * f;
  }
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

// Porte coulissante : un vantail plein qui, fermé, remplit l'ouverture et, ouvert, glisse du côté choisi (cote = +1 « droite »,
// −1 « gauche »). Deux montages :
//  • « en applique » (défaut) : vantail suspendu à un rail, sur la face INTÉRIEURE du mur voisin — il reste visible ouvert ;
//  • « galandage » : le vantail coulisse DANS l'épaisseur du mur voisin (cassette) et disparaît entièrement à l'ouverture ;
//    il est donc posé au milieu du mur, sans rail apparent.
//  larg / haut : dimensions de l'ouverture (m) ; epMur : épaisseur totale du mur (m) ; faceInt : signe de z côté intérieur.
// « cadre » : encadrement fixe (+ rail en applique) ; « mobile » : vantail à animer (position.x = signe × course × ouverture,
// course = larg — voir appliquerOuverturePorte).
export function creerPorteCoulissante(p: { larg: number; haut: number; epMur: number; cote: number; faceInt: number; galandage?: boolean }): { cadre: THREE.Group; mobile: THREE.Group } {
  const { larg, haut, epMur, cote, faceInt, galandage = false } = p;
  const cadre = new THREE.Group();
  const mobile = new THREE.Group();
  const matCadre = new THREE.MeshStandardMaterial({ color: 0xe7e0d2, roughness: 0.6 });
  const matRail = new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.6, roughness: 0.4 });
  const matVantail = new THREE.MeshStandardMaterial({ color: 0xf3eee4, roughness: 0.55 });
  const matPanneau = new THREE.MeshStandardMaterial({ color: 0xe3dccd, roughness: 0.6 });
  const matInox = new THREE.MeshStandardMaterial({ color: 0xc7cdd3, metalness: 0.7, roughness: 0.3 });

  // Encadrement (chambranle de 2 cm) sur toute l'épaisseur du mur.
  const prof = epMur + 0.02, ep = 0.02;
  const ajouterCadre = (w: number, h: number, x: number, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, prof), matCadre);
    m.position.set(x, y, 0);
    m.castShadow = true; m.receiveShadow = true;
    cadre.add(m);
  };
  ajouterCadre(ep, haut, -(larg / 2 - ep / 2), haut / 2);
  ajouterCadre(ep, haut, larg / 2 - ep / 2, haut / 2);
  ajouterCadre(larg, ep, 0, haut - ep / 2);

  // Axe du vantail : au MILIEU du mur en galandage (il glisse dans l'épaisseur) ; devant la face intérieure en applique.
  const t = galandage ? Math.min(0.04, Math.max(0.02, epMur * 0.5)) : 0.04;
  const zFace = galandage ? 0 : faceInt * (epMur / 2 + 0.03);
  if (!galandage) {
    // Rail apparent au-dessus de l'ouverture, côté intérieur : de l'ouverture jusqu'au bout de la zone de parking.
    const longRail = larg * 2 + 0.1;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(longRail, 0.04, 0.05), matRail);
    rail.position.set(cote * (larg / 2), haut + 0.04, zFace);
    rail.castShadow = true; rail.receiveShadow = true;
    cadre.add(rail);
  }

  // Vantail : plein, avec deux panneaux moulurés et une poignée cuvette ; origine du groupe = centre de l'ouverture.
  // En galandage il remplit l'entre-chambranles (il ne recouvre pas l'encadrement, puisqu'il rentre dans le mur).
  const lw = galandage ? larg - 2 * ep - 0.004 : larg + 0.04;
  const lh = Math.max(0.5, galandage ? haut - ep - 0.01 : haut - 0.01);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(lw, lh, t), matVantail);
  leaf.position.set(0, 0.01 + lh / 2, zFace);
  leaf.castShadow = true; leaf.receiveShadow = true;
  mobile.add(leaf);
  [[0.72, 0.34], [0.28, 0.30]].forEach(([yf, hf]) => {
    for (const face of [1, -1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(lw * 0.7, lh * hf, 0.006), matPanneau);
      m.position.set(0, 0.01 + lh * yf, zFace + face * (t / 2));
      mobile.add(m);
    }
  });
  // Poignée cuvette inox, côté bord de fermeture (opposé au parking), à ~1 m : sur la face intérieure en applique,
  // sur les DEUX faces en galandage (on le manœuvre des deux côtés).
  const faces = galandage ? [1, -1] : [faceInt];
  faces.forEach(face => {
    const cuvette = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.012), matInox);
    cuvette.position.set(-cote * (lw / 2 - 0.07), Math.min(1.0, lh * 0.5), zFace + face * (t / 2 + 0.006));
    mobile.add(cuvette);
  });
  if (!galandage) {
    // Taquet de suspension sur le rail.
    const chariot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.03), matInox);
    chariot.position.set(0, haut + 0.01, zFace);
    mobile.add(chariot);
  }
  return { cadre, mobile };
}

// Identifiant (clé de l'état ouvert / fermé) du vantail k d'une baie vitrée : le 1er garde l'id de l'ouverture, les suivants
// s'en déduisent — chaque vantail s'ouvre et se ferme indépendamment (clic en 3D, ou onglet « Ouvrants »).
export const idVantailBaie = (idOuverture: number, k: number): number => (k === 0 ? idOuverture : idOuverture + k * 10_000_000);

// Baie vitrée coulissante à N vantaux (1 à 4), TOUS de même largeur et TOUS mobiles, chacun sur son propre rail (rails décalés
// en profondeur : les vantaux se croisent sans se toucher). Fermée, les vantaux se recouvrent de 3 cm ; chacun glisse vers le
// côté « cote » (+1 droite / −1 gauche) jusqu'à se ranger sur la pile de l'autre extrémité de la baie — sauf celui qui est déjà de
// ce côté, qui part dans l'autre sens. Une baie à 1 vantail glisse devant le mur voisin.
// « cadre » : dormant fixe ; chaque entrée de « vantaux » : { groupe, signe, course } à animer avec appliquerOuverturePorte
// (position.x = signe × course × ouverture). Le vitrage ne projette pas d'ombre : le soleil passe à travers.
export function creerBaieVitree(p: { larg: number; haut: number; epMur: number; cote: number; nb: number; faceInt?: number }): {
  cadre: THREE.Group; vantaux: { groupe: THREE.Group; signe: number; course: number }[];
} {
  const { larg, haut, epMur, cote } = p;
  const nb = Math.max(1, Math.min(4, Math.round(p.nb)));
  const cadre = new THREE.Group();
  const matAlu = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.4, metalness: 0.5 });
  const matVitre = new THREE.MeshStandardMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.28, roughness: 0.05, depthWrite: false });
  const matPoignee = new THREE.MeshStandardMaterial({ color: 0xc7cdd3, metalness: 0.7, roughness: 0.3 });
  const d = 0.03, pas = 0.034;                                   // épaisseur d'un vantail ; écart entre deux rails
  const prof = Math.max(Math.min(0.12, epMur + 0.02), (nb - 1) * pas + d + 0.01);

  const barre = (cible: THREE.Group, w: number, h: number, dp: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dp), matAlu);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    cible.add(m);
  };
  // Dormant : 4 profilés sur le pourtour de l'ouverture + seuil.
  const ep = 0.05;
  barre(cadre, ep, haut, prof, -(larg / 2 - ep / 2), haut / 2, 0);
  barre(cadre, ep, haut, prof, larg / 2 - ep / 2, haut / 2, 0);
  barre(cadre, larg, ep, prof, 0, haut - ep / 2, 0);
  barre(cadre, larg, 0.03, prof, 0, 0.015, 0);

  const ov = 0.03;                                               // recouvrement entre vantaux voisins
  const w = (larg + (nb - 1) * ov) / nb;                         // largeur de chaque vantail (identique pour tous)
  const h = haut - ep - 0.035, y0 = 0.03, e = 0.04;
  const iFin = cote > 0 ? nb - 1 : 0;                            // vantail déjà rangé du côté « glisse vers »
  const vantaux: { groupe: THREE.Group; signe: number; course: number }[] = [];
  for (let i = 0; i < nb; i++) {
    const groupe = new THREE.Group();
    const cx = -larg / 2 + w / 2 + i * (w - ov);
    // Un seul vantail : posé devant la face intérieure du mur (il se range le long du mur voisin, visible) ; sinon, un rail par vantail.
    const z = nb === 1 ? (p.faceInt ?? 0) * (epMur / 2 + d / 2 + 0.01) : (i - (nb - 1) / 2) * pas;
    // Cadre alu du vantail (4 profilés fins) + vitre.
    barre(groupe, e, h, d, cx - w / 2 + e / 2, y0 + h / 2, z);
    barre(groupe, e, h, d, cx + w / 2 - e / 2, y0 + h / 2, z);
    barre(groupe, w, e, d, cx, y0 + h - e / 2, z);
    barre(groupe, w, e, d, cx, y0 + e / 2, z);
    const vitre = new THREE.Mesh(new THREE.BoxGeometry(w - 2 * e, h - 2 * e, 0.008), matVitre);
    vitre.position.set(cx, y0 + h / 2, z);
    groupe.add(vitre);

    // Sens d'ouverture : vers « cote », sauf pour le vantail déjà de ce côté qui part dans l'autre sens.
    const dir = nb === 1 ? cote : i === iFin ? -cote : cote;
    const cible = nb === 1 ? cote * larg : dir * (larg / 2 - w / 2);   // 1 vantail : il se range devant le mur voisin
    // Poignée côté opposé au sens d'ouverture (bord de fermeture), face intérieure.
    const poignee = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.03), matPoignee);
    poignee.position.set(cx - dir * (w / 2 - 0.06), 1.05, z + d / 2 + 0.012);
    groupe.add(poignee);
    vantaux.push({ groupe, signe: Math.sign(cible - cx) || dir, course: Math.abs(cible - cx) });
  }
  return { cadre, vantaux };
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

// Fenêtre à battant(s) : dormant fixe (« cadre ») + 1 ou 2 vantaux vitrés pivotant autour de leur charnière.
//  larg / haut : dimensions de l'ouverture dans le mur (m) ; epMur : épaisseur de la couche porteuse (m) ;
//  battants : 1 = simple battant (charnière du côté hs : −1 = côté du 1er sommet = « gauche », +1 = « droite »),
//             2 = double battant (charnières aux deux jambages, hs ignoré) ;
//  faceInt : signe de z côté intérieur de la pièce (la poignée est posée sur la face intérieure).
// « swing » = vantail de la charnière gauche (ou unique) ; « swing2 » = vantail de la charnière droite (double battant).
// Chaque vantail s'anime avec rotation.y (voir appliquerOuverturePorte : signe = sensBattement × hs du vantail).
// Le vitrage ne projette pas d'ombre : le soleil passe à travers.
export function creerFenetreBattante(p: {
  larg: number; haut: number; epMur: number; battants: 1 | 2; hs: number; faceInt: number;
}): { cadre: THREE.Group; swing: THREE.Group; swing2?: THREE.Group } {
  const { larg, haut, epMur, battants, faceInt } = p;
  const cadre = new THREE.Group();
  const matBlanc = new THREE.MeshStandardMaterial({ color: 0xf5f5f4, roughness: 0.45 });
  const matVitre = new THREE.MeshStandardMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.3, roughness: 0.05, depthWrite: false });
  const matPoignee = new THREE.MeshStandardMaterial({ color: 0xc7cdd3, metalness: 0.7, roughness: 0.3 });
  const prof = Math.min(0.12, epMur + 0.02);
  const epD = 0.05;   // dormant : 5 cm
  const eV = 0.045;   // profilé de vantail : 4,5 cm
  const dV = 0.04;    // épaisseur du vantail

  const barre = (cible: THREE.Group, w: number, h: number, d: number, x: number, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matBlanc);
    m.position.set(x, y, 0);
    m.castShadow = true; m.receiveShadow = true;
    cible.add(m);
  };
  // Dormant : 4 profilés sur le pourtour de l'ouverture.
  barre(cadre, epD, haut, prof, -(larg / 2 - epD / 2), haut / 2);
  barre(cadre, epD, haut, prof, larg / 2 - epD / 2, haut / 2);
  barre(cadre, larg, epD, prof, 0, haut - epD / 2);
  barre(cadre, larg, epD, prof, 0, epD / 2);

  const jeu = 0.003;
  const lh = Math.max(0.2, haut - 2 * epD - 2 * jeu);
  const yBas = epD + jeu;
  // Un vantail : charnière à l'origine du groupe (posé sur le jambage hsV), bord libre à −hsV × lw.
  const vantail = (hsV: number, lw: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(hsV * (larg / 2 - epD - jeu), yBas, 0);
    const dx = (frac: number) => -hsV * lw * frac;
    const part = (w: number, h: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dV), matBlanc);
      m.position.set(x, y, 0);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    };
    part(eV, lh, -hsV * eV / 2, lh / 2);                 // montant côté charnière
    part(eV, lh, -hsV * (lw - eV / 2), lh / 2);          // montant côté bord libre
    part(lw, eV, dx(0.5), lh - eV / 2);                  // traverse haute
    part(lw, eV, dx(0.5), eV / 2);                       // traverse basse
    const vitre = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.05, lw - 2 * eV), Math.max(0.05, lh - 2 * eV), 0.008), matVitre);
    vitre.position.set(dx(0.5), lh / 2, 0);
    g.add(vitre);
    // Poignée sur la face intérieure, côté bord libre, à mi-hauteur du vantail.
    const hy = lh * 0.5;
    const xP = dx(1) + hsV * (eV / 2);
    const rosace = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.01), matPoignee);
    rosace.position.set(xP, hy, faceInt * (dV / 2 + 0.005));
    const bras = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.1, 0.014), matPoignee);
    bras.position.set(xP, hy - 0.04, faceInt * (dV / 2 + 0.017));
    g.add(rosace, bras);
    return g;
  };

  if (battants === 2) {
    const lw = Math.max(0.1, larg / 2 - epD - jeu - 0.002);
    return { cadre, swing: vantail(-1, lw), swing2: vantail(1, lw) };
  }
  const lw = Math.max(0.15, larg - 2 * epD - 2 * jeu);
  return { cadre, swing: vantail(p.hs, lw) };
}
