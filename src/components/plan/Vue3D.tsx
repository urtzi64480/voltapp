"use client";

// Vue 3D d'un niveau du plan — murs extrudés depuis le contour des pièces, sol,
// appareillages positionnés à leur hauteur d'installation réelle. Caméra orbitale
// écrite à la main (glisser = tourner, molette = zoom) pour n'avoir aucune
// dépendance sur les sous-chemins d'import de three (examples/jsm, addons…) qui
// posent problème selon les versions/bundlers. Nécessite uniquement le paquet
// npm "three" lui-même (voir note de livraison — à ajouter dans package.json).
//
// Ce composant remplace le canvas 2D quand la vue 3D est activée dans la page plan ;
// il ne gère ni le dessin des pièces ni le placement des appareillages (lecture seule).

import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import { Niveau, PIECE_TYPES, centroide, AppareillageType, sequenceAncresCircuit, cleSegmentLiaison } from "@/lib/maison-types";
import { ResultatGeneration } from "@/lib/maison-engine";
import { couleurCircuit } from "@/lib/maison-types";

const EPAISSEUR_MUR = 0.1; // mètres

// Hauteur d'installation par défaut (mètres) quand l'appareillage n'a pas de hauteur saisie.
const HAUTEUR_DEFAUT: Partial<Record<AppareillageType, number>> = {
  prise: 0.3, prise_commandee: 0.3,
  interrupteur: 1.1, va_et_vient: 1.1, telerupteur: 1.1,
  applique: 1.8,
  four: 0.6, plaque: 0.9, lave_linge: 0.85, lave_vaisselle: 0.85, seche_linge: 0.85,
  chauffe_eau: 1.8, chauffage: 0.3, clim: 2.0, seche_serviette: 1.2, congelateur: 0.85,
  irve: 1.0, piscine: 0.3, vmc: 2.2, alarme: 2.0,
};

export interface Vue3DHandle {
  capturerImage: () => string | null;
}

const Vue3D = forwardRef<Vue3DHandle, {
  niveau: Niveau; resultat: ResultatGeneration | null; showCircuits: boolean;
}>(function Vue3D({ niveau, resultat, showCircuits }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  useImperativeHandle(ref, () => ({
    capturerImage: () => rendererRef.current?.domElement.toDataURL("image/png") ?? null,
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const hauteurPlafond = niveau.hauteurPlafond ?? 2.5;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e7e5e4");

    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.05, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);

    // ── Repère : x du plan → x 3D, y du plan → z 3D (profondeur), hauteur → y 3D (vertical) ──

    const niveauResultat = resultat?.maison.niveaux.find(n => n.id === niveau.id) ?? niveau;
    const colorMap = new Map<number, string>();
    if (resultat) resultat.breakers.forEach((b, i) => colorMap.set(b.id, couleurCircuit(i)));

    // Sol + murs par pièce
    niveauResultat.pieces.forEach(piece => {
      if (piece.contour.length < 3) return;
      const spec = PIECE_TYPES[piece.type];

      // Sol
      const shape = new THREE.Shape(piece.contour.map(p => new THREE.Vector2(p.x, p.y)));
      const solGeo = new THREE.ShapeGeometry(shape);
      const solMat = new THREE.MeshStandardMaterial({ color: spec.color, side: THREE.DoubleSide });
      const sol = new THREE.Mesh(solGeo, solMat);
      sol.rotation.x = -Math.PI / 2;
      scene.add(sol);

      // Murs (un segment de boîte par arête du contour) — hauteur propre à la pièce si définie
      const hauteurMurs = piece.hauteurPlafond ?? hauteurPlafond;
      const murMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f4 });
      piece.contour.forEach((a, i) => {
        const b = piece.contour[(i + 1) % piece.contour.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const longueur = Math.hypot(dx, dy);
        if (longueur < 0.01) return;
        const angle = Math.atan2(dy, dx);
        const murGeo = new THREE.BoxGeometry(longueur, hauteurMurs, EPAISSEUR_MUR);
        const mur = new THREE.Mesh(murGeo, murMat);
        mur.position.set((a.x + b.x) / 2, hauteurMurs / 2, (a.y + b.y) / 2);
        mur.rotation.y = -angle;
        scene.add(mur);
      });

      // Appareillages
      piece.appareillages.forEach(app => {
        const h = app.hauteur != null ? app.hauteur / 100 : (HAUTEUR_DEFAUT[app.type] ?? 1.0);
        const couleur = showCircuits && app.circuitId != null ? (colorMap.get(app.circuitId) ?? "#1c1917") : "#292524";
        const geo = new THREE.SphereGeometry(0.04, 12, 12);
        const mat = new THREE.MeshStandardMaterial({ color: couleur });
        const marker = new THREE.Mesh(geo, mat);
        marker.position.set(app.x, h, app.y);
        scene.add(marker);
      });
    });

    // Tableau électrique
    if (niveau.tableauPos) {
      const geo = new THREE.BoxGeometry(0.4, 0.5, 0.1);
      const mat = new THREE.MeshStandardMaterial({ color: 0x1c1917 });
      const tableau = new THREE.Mesh(geo, mat);
      tableau.position.set(niveau.tableauPos.x, 1.5, niveau.tableauPos.y);
      scene.add(tableau);
    }

    // Circuits — tracé 3D en tenant compte des coudes manuels et de leur hauteur
    if (showCircuits && resultat && niveau.tableauPos) {
      const tableauPos = niveau.tableauPos;
      const hauteurCoudeParDefaut = hauteurPlafond - 0.1;
      const tousAppareils = niveauResultat.pieces.flatMap(p => p.appareillages);
      const parCircuit = new Map<number, typeof tousAppareils>();
      tousAppareils.forEach(a => {
        if (a.circuitId == null) return;
        const arr = parCircuit.get(a.circuitId) ?? [];
        arr.push(a);
        parCircuit.set(a.circuitId, arr);
      });
      parCircuit.forEach((points, circuitId) => {
        const color = colorMap.get(circuitId) ?? "#666666";
        const sequence = sequenceAncresCircuit(tableauPos, points);
        const pts3D: THREE.Vector3[] = [];
        const hauteurAncre = (id: string): number => {
          if (id === "tableau") return 1.5;
          const app = tousAppareils.find(a => String(a.id) === id);
          if (!app) return 1.0;
          return app.hauteur != null ? app.hauteur / 100 : (HAUTEUR_DEFAUT[app.type] ?? 1.0);
        };
        pts3D.push(new THREE.Vector3(sequence[0].point.x, hauteurAncre(sequence[0].id), sequence[0].point.y));
        for (let i = 0; i < sequence.length - 1; i++) {
          const cle = cleSegmentLiaison(sequence[i].id, sequence[i + 1].id);
          const coudes = niveau.liaisonWaypoints?.[cle] ?? [];
          coudes.forEach(c => {
            const h = c.hauteur != null ? c.hauteur / 100 : hauteurCoudeParDefaut;
            pts3D.push(new THREE.Vector3(c.point.x, h, c.point.y));
          });
          const hFin = hauteurAncre(sequence[i + 1].id);
          pts3D.push(new THREE.Vector3(sequence[i + 1].point.x, hFin, sequence[i + 1].point.y));
        }
        if (pts3D.length < 2) return;
        const geo = new THREE.BufferGeometry().setFromPoints(pts3D);
        const mat = new THREE.LineBasicMaterial({ color });
        scene.add(new THREE.Line(geo, mat));
      });
    }

    // Cadrage caméra sur l'ensemble du niveau
    const tousPts = niveauResultat.pieces.flatMap(p => p.contour);
    let cx = 0, cy = 0;
    if (tousPts.length > 0) {
      const c = centroide(tousPts);
      cx = c.x; cy = c.y;
    }
    const xs = tousPts.map(p => p.x), ys = tousPts.map(p => p.y);
    const etendue = tousPts.length > 0
      ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 4)
      : 8;

    // ── Caméra orbitale manuelle (coordonnées sphériques autour de la cible) ──
    const cible = new THREE.Vector3(cx, hauteurPlafond / 2, cy);
    let rayon = etendue * 1.1;
    let azimut = Math.PI / 4;
    let polaire = Math.PI / 3; // 0 = vue du dessus, PI/2 = vue de côté

    const appliquerCamera = () => {
      const x = cible.x + rayon * Math.sin(polaire) * Math.sin(azimut);
      const y = cible.y + rayon * Math.cos(polaire);
      const z = cible.z + rayon * Math.sin(polaire) * Math.cos(azimut);
      camera.position.set(x, y, z);
      camera.lookAt(cible);
    };
    appliquerCamera();

    let enRotation = false;
    let dernierX = 0, dernierY = 0;
    const onPointerDown = (e: PointerEvent) => { enRotation = true; dernierX = e.clientX; dernierY = e.clientY; };
    const onPointerMove = (e: PointerEvent) => {
      if (!enRotation) return;
      const dx = e.clientX - dernierX, dy = e.clientY - dernierY;
      dernierX = e.clientX; dernierY = e.clientY;
      azimut -= dx * 0.006;
      polaire = Math.min(Math.PI - 0.05, Math.max(0.05, polaire - dy * 0.006));
      appliquerCamera();
    };
    const onPointerUp = () => { enRotation = false; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      rayon = Math.min(etendue * 6, Math.max(etendue * 0.15, rayon * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
      appliquerCamera();
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
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
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.dispose();
      scene.traverse(obj => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      rendererRef.current = null;
    };
  }, [niveau, resultat, showCircuits]);

  return <div ref={containerRef} className="w-full h-full" style={{ touchAction: "none", cursor: "grab" }} />;
});

export default Vue3D;
