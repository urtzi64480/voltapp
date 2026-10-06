"use client";

// Vue 3D de TOUTE la maison : tous les niveaux empilés à leur altitude réelle (voir lib/altitudes-niveaux.ts) — sols, murs
// (3 couches, percés de leurs portes et fenêtres), cloisons de zones et escaliers, ceux-ci traversant les planchers par leur
// trémie. Lecture seule : ni appareillage ni circuit (ils se voient dans la vue 3D d'un seul niveau). Chaque niveau peut être
// masqué / affiché pour regarder à l'intérieur. Même caméra orbitale manuelle que la vue d'un niveau : glisser = tourner,
// clic droit (ou Maj + glisser) = déplacer, molette = zoom.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Niveau, PIECE_TYPES, NIVEAU_TYPES, ouverturesEffectivesMur } from "@/lib/maison-types";
import { construireMurAvecOuvertures } from "@/components/plan/Vue3D";
import { appliquerOuverturePorte, PorteRegistre } from "@/components/plan/PortesOuvrables";
import { creerEscalier3D, geometrieSolPercee, aretesGardeCorpsTremie, creerGardeCorpsTremie } from "@/components/plan/Escalier3D";
import { calculerEscalier, hauteurTotaleEscalierCm, escaliersEntrants } from "@/lib/escaliers";
import { cloisonsDeZone, ouverturesEffectivesZone } from "@/lib/zones";
import { parametresMur3D, geometrieMurs, preparerMurs } from "@/lib/murs";
import { altitudesNiveaux } from "@/lib/altitudes-niveaux";

const nomNiveau = (n: Niveau) => n.nom || NIVEAU_TYPES[n.type];

// Construit tous les niveaux dans la scène : un groupe par niveau, posé à son altitude. Renvoie les groupes (pour masquer /
// afficher un niveau) et l'emprise de l'ensemble (plan en x / z, altitudes en m) pour le cadrage de la caméra.
export function peuplerScene(scene: THREE.Object3D, niveaux: Niveau[], altitudes: Map<number, number>): {
  groupes: Map<number, THREE.Group>;
  bornes: { minX: number; maxX: number; minZ: number; maxZ: number; altMin: number; altMax: number };
} {
  const groupes = new Map<number, THREE.Group>();
  const murMat = new THREE.MeshStandardMaterial({ color: 0xe3dccf });
  const murExtMat = new THREE.MeshStandardMaterial({ color: 0xcdc4b3 });
  const doublageMat = new THREE.MeshStandardMaterial({ color: 0xe4e0d5 });
  const finitionMat = new THREE.MeshStandardMaterial({ color: 0xf1eee6 });
  const solMats = new Map<string, THREE.MeshStandardMaterial>();
  const matSol = (couleur: string) => {
    let m = solMats.get(couleur);
    if (!m) { m = new THREE.MeshStandardMaterial({ color: couleur, side: THREE.DoubleSide }); solMats.set(couleur, m); }
    return m;
  };
  // Une porte construite est posée dans son état initial (comme dans la vue d'un niveau).
  const enregistrerPorte = (reg: PorteRegistre) => appliquerOuverturePorte(reg, reg.defaut);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, altMin = Infinity, altMax = -Infinity;

  niveaux.forEach(n => {
    const g = new THREE.Group();
    const alt = altitudes.get(n.id) ?? 0;
    g.position.y = alt;
    scene.add(g);
    groupes.set(n.id, g);

    const hPlafond = n.hauteurPlafond ?? 2.5;
    altMin = Math.min(altMin, alt);
    altMax = Math.max(altMax, alt + hPlafond);
    preparerMurs(n.pieces);

    // Planchers percés de la trémie des escaliers qui arrivent sur ce niveau.
    const entrants = escaliersEntrants(niveaux, n.id);
    const tremies = entrants.map(en => en.calcul.tremie);

    n.pieces.forEach(piece => {
      if (piece.contour.length < 3) return;
      piece.contour.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.y); maxZ = Math.max(maxZ, p.y); });

      // Sol : rotation −90° autour de x, d'où −y (voir la vue d'un niveau).
      const shape = new THREE.Shape(piece.contour.map(p => new THREE.Vector2(p.x, -p.y)));
      const solPercee = tremies.length > 0 ? geometrieSolPercee(piece.contour, tremies) : null;
      const sol = new THREE.Mesh(solPercee ?? new THREE.ShapeGeometry(shape), matSol(PIECE_TYPES[piece.type].color));
      if (!solPercee) sol.rotation.x = -Math.PI / 2;
      g.add(sol);

      // Murs : les 3 couches (structure, doublage, finition), mêmes ouvertures dans chacune.
      const hauteurMurs = piece.hauteurPlafond ?? hPlafond;
      const geoMurs = geometrieMurs(piece);
      piece.contour.forEach((a, i) => {
        const b = piece.contour[(i + 1) % piece.contour.length];
        const ouvertures = ouverturesEffectivesMur(n.pieces, piece, i);
        const cx = piece.contour.reduce((s, p) => s + p.x, 0) / piece.contour.length, cy = piece.contour.reduce((s, p) => s + p.y, 0) / piece.contour.length;
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const sensInterieur: 1 | -1 = (-(b.y - a.y) / l * (cx - a.x) + (b.x - a.x) / l * (cy - a.y)) >= 0 ? 1 : -1;
        const m = parametresMur3D(piece, i);
        const quads = geoMurs.quads[i];
        const epTotale = m.e + m.d + m.f;
        m.couches.forEach(c => {
          const mat = c.nom === "structure" ? (m.type === "exterieur" ? murExtMat : murMat) : c.nom === "doublage" ? doublageMat : finitionMat;
          const quad = c.nom === "structure" ? quads.structure : c.nom === "doublage" ? quads.doublage : quads.finition;
          if (!quad) return;
          const contenu = c.nom === "structure";
          construireMurAvecOuvertures(a, b, hauteurMurs - c.reduction, ouvertures, contenu ? Math.max(epTotale, 0.02) : c.epaisseur, mat, g,
            { decalage: contenu ? m.signeInterieur * (epTotale / 2) : c.decalage, avecContenu: contenu, sensInterieur, enregistrerPorte, quad });
        });
      });
    });

    // Cloisons des zones (une zone n'est pas une pièce : seules ses cloisons sont bâties).
    (n.zones ?? []).forEach(z => {
      cloisonsDeZone(z).forEach(c => {
        construireMurAvecOuvertures(c.a, c.b, hPlafond, ouverturesEffectivesZone(z, c.i), c.epaisseurM, murMat, g,
          { decalage: 0, extDebut: c.extA, extFin: c.extB, avecContenu: true, enregistrerPorte });
      });
    });

    // Escaliers qui PARTENT de ce niveau (entiers, posés sur son sol) + garde-corps des trémies qui y ARRIVENT.
    (n.escaliers ?? []).forEach(esc => g.add(creerEscalier3D(calculerEscalier(esc, hauteurTotaleEscalierCm(esc, n)), esc)));
    entrants.forEach(en => g.add(creerGardeCorpsTremie(aretesGardeCorpsTremie(en.calcul, en.escalier, n.pieces.map(p => p.contour)), en.escalier)));
  });
  return { groupes, bornes: { minX, maxX, minZ, maxZ, altMin, altMax } };
}


export default function Vue3DMaison({ niveaux, niveauActifId }: { niveaux: Niveau[]; niveauActifId: number | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const groupesRef = useRef<Map<number, THREE.Group>>(new Map());
  const [visibles, setVisibles] = useState<Record<number, boolean>>({});

  const altitudes = useMemo(() => altitudesNiveaux(niveaux), [niveaux]);
  // Du plus haut au plus bas : l'ordre dans lequel on lit la maison de haut en bas.
  const liste = useMemo(
    () => [...niveaux].sort((a, b) => (altitudes.get(b.id) ?? 0) - (altitudes.get(a.id) ?? 0) || b.ordre - a.ordre),
    [niveaux, altitudes],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e7e5e4");
    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / Math.max(1, container.clientHeight), 0.05, 400);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb5aea3, 0.9));
    const soleil = new THREE.DirectionalLight(0xffffff, 0.75);
    soleil.position.set(8, 16, 6);
    scene.add(soleil);

    const { groupes, bornes } = peuplerScene(scene, niveaux, altitudes);
    groupesRef.current = groupes;
    let { minX, maxX, minZ, maxZ, altMin, altMax } = bornes;

    // Cadrage sur l'ensemble de la maison.
    const vide = !isFinite(minX);
    const cx = vide ? 0 : (minX + maxX) / 2, cz = vide ? 0 : (minZ + maxZ) / 2;
    const etendue = Math.max(vide ? 8 : Math.hypot(maxX - minX, maxZ - minZ), 4);
    if (!isFinite(altMin)) { altMin = 0; altMax = 2.5; }

    // Sol de repère sous la maison.
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(etendue * 3, etendue * 3), new THREE.MeshStandardMaterial({ color: 0xd6d3d1 }));
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.set(cx, altMin - 0.03, cz);
    scene.add(terrain);

    // Caméra orbitale manuelle (coordonnées sphériques autour d'une cible déplaçable).
    const cible = new THREE.Vector3(cx, (altMin + altMax) / 2, cz);
    let rayon = etendue * 1.15;
    let azimut = Math.PI / 4;
    let polaire = Math.PI / 3.2;
    const appliquerCamera = () => {
      camera.position.set(
        cible.x + rayon * Math.sin(polaire) * Math.sin(azimut),
        cible.y + rayon * Math.cos(polaire),
        cible.z + rayon * Math.sin(polaire) * Math.cos(azimut),
      );
      camera.lookAt(cible);
    };
    appliquerCamera();

    let interaction: "rotation" | "deplacement" | null = null;
    let dernierX = 0, dernierY = 0;
    const axeDroite = new THREE.Vector3(), axeHaut = new THREE.Vector3();
    const onPointerDown = (e: PointerEvent) => {
      interaction = (e.button === 2 || e.shiftKey) ? "deplacement" : "rotation";
      dernierX = e.clientX; dernierY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!interaction) return;
      const dx = e.clientX - dernierX, dy = e.clientY - dernierY;
      dernierX = e.clientX; dernierY = e.clientY;
      if (interaction === "rotation") {
        azimut -= dx * 0.006;
        polaire = Math.min(Math.PI - 0.05, Math.max(0.05, polaire - dy * 0.006));
      } else {
        camera.updateMatrixWorld();
        axeDroite.setFromMatrixColumn(camera.matrixWorld, 0);
        axeHaut.setFromMatrixColumn(camera.matrixWorld, 1);
        const facteur = rayon * 0.0016;
        cible.addScaledVector(axeDroite, -dx * facteur);
        cible.addScaledVector(axeHaut, dy * facteur);
      }
      appliquerCamera();
    };
    const onPointerUp = () => { interaction = null; };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      rayon = Math.min(etendue * 6, Math.max(etendue * 0.15, rayon * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
      appliquerCamera();
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    let frameId = 0;
    const animer = () => { frameId = requestAnimationFrame(animer); renderer.render(scene, camera); };
    animer();

    const onResize = () => {
      camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      renderer.domElement.removeEventListener("wheel", onWheel);
      scene.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      groupesRef.current = new Map();
    };
  }, [niveaux, altitudes]);

  // Niveaux masqués / affichés : sans reconstruire la scène (et réappliqué juste après une reconstruction).
  useEffect(() => {
    groupesRef.current.forEach((g, id) => { g.visible = visibles[id] !== false; });
  }, [visibles, niveaux, altitudes]);

  const nbVisibles = liste.filter(n => visibles[n.id] !== false).length;

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" style={{ touchAction: "none", cursor: "grab" }} />
      <div className="absolute top-3 left-3 z-20 card !p-2.5 flex flex-col gap-1.5 shadow-lg max-w-[16rem]">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Tous les étages · {liste.length} niveau{liste.length > 1 ? "x" : ""}</p>
        {liste.map(n => (
          <label key={n.id} className="flex items-center gap-2 text-xs text-ink-700 cursor-pointer">
            <input type="checkbox" checked={visibles[n.id] !== false} onChange={e => setVisibles(v => ({ ...v, [n.id]: e.target.checked }))} />
            <span className={n.id === niveauActifId ? "font-semibold text-ink-900" : ""}>{nomNiveau(n)}</span>
            <span className="ml-auto text-[10px] text-ink-400 font-mono">{(altitudes.get(n.id) ?? 0).toFixed(2)} m</span>
          </label>
        ))}
        <div className="flex gap-1 pt-1">
          <button onClick={() => setVisibles({})} disabled={nbVisibles === liste.length} className="btn-ghost !text-[11px] !px-2 !py-1 disabled:opacity-40">Tout afficher</button>
          <button onClick={() => setVisibles(Object.fromEntries(liste.map(n => [n.id, n.id === niveauActifId])))} className="btn-ghost !text-[11px] !px-2 !py-1">Niveau actif seul</button>
        </div>
        <p className="text-[10px] text-ink-400">Glisser = tourner · clic droit = déplacer · molette = zoom. Appareillages et circuits : vue 3D d&apos;un seul niveau.</p>
      </div>
    </div>
  );
}
