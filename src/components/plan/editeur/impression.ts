// Extrait mécaniquement de src/app/plan/[clientId]/page.tsx (aucun changement de comportement).
import { X } from "lucide-react";
import { Point, Piece, Niveau, AppareillagePlace, ouverturesEffectivesMur, NIVEAU_TYPES, origineCircuits, PIECE_TYPES, aireDuPolygone, centroide, distance, pointDansPolygone, cleSegmentLiaison, pointBoiteImplicite, Zone, estLumiere, USAGE_DEDIE_DEFAUT, Escalier } from "@/lib/maison-types";
import { calculerEscalier, hauteurTotaleEscalierCm } from "@/lib/escaliers";
import { appareillageSymbolSvgString, PALETTE, labelAppareillagePlace, initialesAppareillage } from "@/components/plan/AppareillageSymbols";
import { cotesOuvertures, cotesExterieures, coteHorsTout } from "@/lib/cotes-archi";
import { posesTroncons } from "@/lib/pose-circuits";
import { creerContexteLongueurs, hauteurAncreFn, tracerLiaison, longueurCircuit } from "@/lib/longueurs-circuits";
import { preparerMurs, geometrieMurs, decoupeOuverture, surfaceUtile, longueurUtileCm, murDe, normaleInterieure } from "@/lib/murs";
import { ancrageMural, surfaceZone, centreEtiquetteZone, cloisonsDeZone, quadCloison, decoupeOuvertureZone, segmentsZone } from "@/lib/zones";
import { placerEtiquettePiece, carreAutour, RectPx } from "@/lib/etiquette-piece";
import { infosPlaques, droiteFaceAuMur, estMural, cotesAppareillage, filtrerCotesLisibles, Cote } from "@/lib/appareillage-mur";
import { genererGainesNiveaux, construireColorMap, breakersDuNiveau, segmentsPourCircuit, ResultatGeneration, TronconGaine } from "@/lib/maison-engine";
import { CIRCUITS } from "@/lib/electrical-constants";
import { coudesSegment } from "@/lib/routage-circuits";
import { natureLiaison, conducteursSegment, geometrieCable, couleurDominante, COULEUR_FIL, LEGENDE_FILS } from "@/lib/couleurs-fils";
import { repereCotes, COULEUR_COTE, coteSvgString, escapeXml } from "./outils-ui";

// ─── IMPRESSION ─────────────────────────────────────────────────────────────────

export function rendreSVGImprimable(n: Niveau, resultat: ResultatGeneration | null, showCircuits: boolean, showHauteurs: boolean, showLongueurs: boolean, piecesSelectionnees: Set<number> | null, showCotes: boolean, showCotesPieces: boolean, showCotesExt: boolean, showCotesOuv: boolean): string {
  const pieces = piecesSelectionnees ? n.pieces.filter(p => piecesSelectionnees.has(p.id)) : n.pieces;
  const allPts = [
    ...pieces.flatMap(p => p.contour),
    ...(n.zones ?? []).flatMap(z => z.contour),
    ...(n.tableauPos ? [n.tableauPos] : []),
    ...(n.escaliers ?? []).flatMap(esc => { const c = calculerEscalier(esc, hauteurTotaleEscalierCm(esc, n)); return [{ x: c.emprise.minX, y: c.emprise.minY }, { x: c.emprise.maxX, y: c.emprise.maxY }]; }),
  ];
  if (allPts.length === 0) {
    return `<svg width="500" height="100"><text x="10" y="30" font-size="12" font-family="monospace">Aucune pièce dessinée</text></svg>`;
  }
  const xs = allPts.map(p => p.x), ys = allPts.map(p => p.y);
  const minX = Math.min(...xs) - 0.5, maxX = Math.max(...xs) + 0.5;
  const minY = Math.min(...ys) - 0.5, maxY = Math.max(...ys) + 0.5;
  const wM = Math.max(maxX - minX, 1), hM = Math.max(maxY - minY, 1);
  const scale = Math.min(700 / wM, 480 / hM, 50);
  const W = wM * scale, H = hM * scale;
  const toPx = (p: Point) => ({ x: (p.x - minX) * scale, y: (p.y - minY) * scale });

  const niveauResultatComplet = n;   // le niveau courant porte déjà les circuitId : la copie du résultat peut être plus ancienne que le plan
  const niveauResultat: Niveau = {
    ...niveauResultatComplet,
    pieces: piecesSelectionnees ? niveauResultatComplet.pieces.filter(p => piecesSelectionnees.has(p.id)) : niveauResultatComplet.pieces,
  };
  const colorMap = resultat ? construireColorMap(resultat, [n]) : new Map<number, string>();
  // Murs extérieurs / mitoyens : déduits de l'ensemble des pièces (résultat figé ET plan vivant).
  preparerMurs(niveauResultat.pieces);
  preparerMurs(n.pieces);

  let s = `<svg width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg">`;
  s += `<rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="#fff"/>`;

  const ptsPx = (poly: Point[]) => poly.map(toPx).map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
  // 1) fonds de pièces, 2) murs en vraie épaisseur (structure + doublage), 3) ouvertures qui percent
  // toutes les épaisseurs — dans cet ordre pour que les murs ne soient jamais recouverts par le fond d'une voisine.
  niveauResultat.pieces.forEach(p => {
    s += `<polygon points="${ptsPx(p.contour)}" fill="${p.couleurFond ?? PIECE_TYPES[p.type].color}" stroke="none"/>`;
  });
  {
    const quads = niveauResultat.pieces.flatMap(p => geometrieMurs(p).quads);
    const struct = (q: (typeof quads)[number]) => {
      if (q.structureNulle) return;   // mur à 0 cm : rien à dessiner
      const col = q.type === "exterieur" ? "#44403c" : "#78716c";
      s += `<polygon points="${ptsPx(q.structure)}" fill="${col}" stroke="${col}" stroke-width="0.4"/>`;
    };
    quads.filter(q => q.type !== "exterieur").forEach(struct);   // cloisons d'abord,
    quads.filter(q => q.type === "exterieur").forEach(struct);   // murs extérieurs par-dessus (jonctions propres)
    quads.forEach(q => { if (q.doublage) s += `<polygon points="${ptsPx(q.doublage)}" fill="#d9dee4" stroke="#94a3b8" stroke-width="0.5"/>`; });
    quads.forEach(q => { if (q.finition) s += `<polygon points="${ptsPx(q.finition)}" fill="#fafaf9" stroke="#a8a29e" stroke-width="0.5"/>`; });
  }
  niveauResultat.pieces.forEach(p => {
    p.contour.forEach((_, i) => {
      ouverturesEffectivesMur(niveauResultat.pieces, p, i).forEach(e => {
        s += `<polygon points="${ptsPx(decoupeOuverture(p, i, e.position, e.largeur))}" fill="#fff" stroke="none"/>`;
        if (e.proprietaire) {
          const a = p.contour[i], b = p.contour[(i + 1) % p.contour.length];
          const u = { x: (b.x - a.x), y: (b.y - a.y) }, L = Math.hypot(u.x, u.y) || 1;
          const c0 = { x: a.x + u.x * e.position - u.x / L * e.largeur / 200, y: a.y + u.y * e.position - u.y / L * e.largeur / 200 };
          const c1 = { x: a.x + u.x * e.position + u.x / L * e.largeur / 200, y: a.y + u.y * e.position + u.y / L * e.largeur / 200 };
          const col = e.type === "porte" || e.type === "porte_coulissante" || e.type === "porte_garage" ? "#92400E" : e.type === "fenetre" || e.type === "baie_vitree" ? "#0369A1" : "#78716c";
          s += `<line x1="${toPx(c0).x.toFixed(1)}" y1="${toPx(c0).y.toFixed(1)}" x2="${toPx(c1).x.toFixed(1)}" y2="${toPx(c1).y.toFixed(1)}" stroke="${col}" stroke-width="1.2"/>`;
        }
      });
    });
  });
  // Escaliers de ce niveau : marches, flèche de montée, contour de la trémie (pointillés) à l'étage desservi.
  (n.escaliers ?? []).forEach(esc => {
    const c = calculerEscalier(esc, hauteurTotaleEscalierCm(esc, n));
    c.marches.forEach(m => { s += `<polygon points="${ptsPx(m.poly)}" fill="${m.type === "palier" ? "#e7e5e4" : "#fff"}" stroke="#57534e" stroke-width="0.5"/>`; });
    if (esc.niveauDestId != null) s += `<polygon points="${ptsPx(c.tremie)}" fill="none" stroke="#a16207" stroke-width="0.6" stroke-dasharray="3,2"/>`;
    const centres = c.marches.map(m => toPx(centroide(m.poly)));
    if (centres.length >= 2) {
      s += `<polyline points="${centres.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ")}" fill="none" stroke="#44403c" stroke-width="0.7"/>`;
      const fin = centres[centres.length - 1], av = centres[centres.length - 2], ang = Math.atan2(fin.y - av.y, fin.x - av.x);
      s += `<polygon points="${[0, 2.4, -2.4].map((d, k) => `${(fin.x + (k === 0 ? 5 : 3) * Math.cos(ang + d)).toFixed(1)},${(fin.y + (k === 0 ? 5 : 3) * Math.sin(ang + d)).toFixed(1)}`).join(" ")}" fill="#44403c"/>`;
      s += `<text x="${centres[0].x.toFixed(1)}" y="${(centres[0].y + 8).toFixed(1)}" font-size="6" font-family="monospace" fill="#292524" text-anchor="middle">${escapeXml(esc.nom || "Escalier")} · ${c.nbMarches} marches</text>`;
    }
  });
  // Zones : fond léger + limites virtuelles en pointillés, cloisons en épaisseur (percées de leurs portes), nom + surface.
  (n.zones ?? []).forEach(z => {
    if (z.ferme && z.contour.length >= 3) s += `<polygon points="${ptsPx(z.contour)}" fill="#a78bfa" fill-opacity="0.13" stroke="none"/>`;
    segmentsZone(z).forEach(sg => {
      if (z.cotes[sg.i] === "ouvert") s += `<line x1="${toPx(sg.a).x.toFixed(1)}" y1="${toPx(sg.a).y.toFixed(1)}" x2="${toPx(sg.b).x.toFixed(1)}" y2="${toPx(sg.b).y.toFixed(1)}" stroke="#7c3aed" stroke-width="0.9" stroke-dasharray="4,3"/>`;
    });
    cloisonsDeZone(z).forEach(c => {
      s += `<polygon points="${ptsPx(quadCloison(c))}" fill="#78716c" stroke="#78716c" stroke-width="0.4"/>`;
      (z.ouvertures ?? []).filter(o => o.segIndex === c.i).forEach(o => {
        s += `<polygon points="${ptsPx(decoupeOuvertureZone(c, o.position, o.largeur))}" fill="#fff" stroke="none"/>`;
        const L = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) || 1, ux = (c.b.x - c.a.x) / L, uy = (c.b.y - c.a.y) / L;
        const p0 = toPx({ x: c.a.x + ux * (o.position * L - o.largeur / 200), y: c.a.y + uy * (o.position * L - o.largeur / 200) });
        const p1 = toPx({ x: c.a.x + ux * (o.position * L + o.largeur / 200), y: c.a.y + uy * (o.position * L + o.largeur / 200) });
        s += `<line x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" stroke="#92400E" stroke-width="1.2"${o.type === "ouverture" ? ' stroke-dasharray="2,2"' : ""}/>`;
      });
    });
    const surfZ = surfaceZone(z), cz = toPx(centreEtiquetteZone(z));
    const nomZ = z.nom || (z.ferme ? "Zone" : "Cloison");
    s += `<g text-anchor="middle" font-family="monospace">`
      + `<text x="${cz.x.toFixed(1)}" y="${(cz.y - 2).toFixed(1)}" font-size="9" font-weight="bold" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round">${escapeXml(nomZ)}</text>`
      + `<text x="${cz.x.toFixed(1)}" y="${(cz.y - 2).toFixed(1)}" font-size="9" font-weight="bold" fill="#5b21b6">${escapeXml(nomZ)}</text>`
      + (surfZ ? `<text x="${cz.x.toFixed(1)}" y="${(cz.y + 8).toFixed(1)}" font-size="8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round">${surfZ.utile.toFixed(1)} m²</text>`
        + `<text x="${cz.x.toFixed(1)}" y="${(cz.y + 8).toFixed(1)}" font-size="8" fill="#5b21b6">${surfZ.utile.toFixed(1)} m²</text>` : "")
      + `</g>`;
  });
  niveauResultat.pieces.forEach(p => {
    const gU = geometrieMurs(p), utileP = gU.utile;
    p.contour.forEach((_, i) => {
      // Longueur INTÉRIEURE (face finie à face finie), posée côté pièce contre le mur.
      const aU = toPx(utileP[i]), bU = toPx(gU.utileFin[i]);
      const nIn = normaleInterieure(p.contour, i);
      const lx = (aU.x + bU.x) / 2 + nIn.x * 7, ly = (aU.y + bU.y) / 2 + nIn.y * 7;
      s += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="6" text-anchor="middle" font-family="monospace" fill="#444">${(longueurUtileCm(p, i) / 100).toFixed(2)}m</text>`;
    });
  });

  if ((showCircuits || showHauteurs) && resultat && origineCircuits(n)) {
    const tousAppareils = niveauResultat.pieces.flatMap(p => p.appareillages);
    const parCircuit = new Map<number, AppareillagePlace[]>();
    tousAppareils.forEach(a => {
      if (a.circuitId == null) return;
      const arr = parCircuit.get(a.circuitId) ?? [];
      arr.push(a);
      parCircuit.set(a.circuitId, arr);
    });
    parCircuit.forEach((points, circuitId) => {
      const breaker = resultat.breakers.find(b => b.id === circuitId);
      if (!breaker) return;
      const color = colorMap.get(circuitId) ?? "#666";
      const segments = segmentsPourCircuit(breaker, points, n, origineCircuits(n)!);
      // Longueurs RÉELLES (horizontales + montées / descentes) — même tracé et mêmes hauteurs que la vue 3D.
      const ctxL = creerContexteLongueurs(n);
      const hAncreL = hauteurAncreFn(ctxL);
      segments.forEach(seg => {
        const coudesAuto = coudesSegment(n, seg);
        const cheminM = [seg.aPoint, ...coudesAuto.map(w => w.point), seg.bPoint];
        const chemin = cheminM.map(toPx);
        // Fils aux couleurs normalisées (lib/couleurs-fils.ts) ; la couleur du circuit ne sert qu'au liseré sous les fils.
        const nature = natureLiaison(seg);
        const couleurSegment = couleurDominante(nature);
        if (showCircuits) {
          // Sections apparentes : bande grise (moulure) sous le tracé — repérables à l'impression.
          const cleImp = cleSegmentLiaison(seg.aId, seg.bId);
          const posesImp = posesTroncons(n, cleImp, coudesAuto);
          for (let j = 0; j < chemin.length - 1; j++) {
            if (posesImp[j] !== "apparent") continue;
            s += `<line x1="${chemin[j].x.toFixed(1)}" y1="${chemin[j].y.toFixed(1)}" x2="${chemin[j + 1].x.toFixed(1)}" y2="${chemin[j + 1].y.toFixed(1)}" stroke="#d6d3d1" stroke-width="4" stroke-linecap="round"/>`;
          }
          const d = chemin.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
          s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>`;
          if (seg.type !== "domotique") {
            for (let j = 0; j < chemin.length - 1; j++) {
              geometrieCable(chemin[j], chemin[j + 1], conducteursSegment(seg), 1.9).forEach(t => {
                s += `<line x1="${t.x1.toFixed(1)}" y1="${t.y1.toFixed(1)}" x2="${t.x2.toFixed(1)}" y2="${t.y2.toFixed(1)}" stroke="${t.couleur}" stroke-width="1.5" stroke-linecap="round"/>`;
                if (t.couleur2) s += `<line x1="${t.x1.toFixed(1)}" y1="${t.y1.toFixed(1)}" x2="${t.x2.toFixed(1)}" y2="${t.y2.toFixed(1)}" stroke="${t.couleur2}" stroke-width="1.5" stroke-dasharray="3 3"/>`;
              });
            }
            if (nature !== "alimentation") {
              let mj = 0, lmax = -1;
              for (let j = 0; j < chemin.length - 1; j++) { const l = Math.hypot(chemin[j + 1].x - chemin[j].x, chemin[j + 1].y - chemin[j].y); if (l > lmax) { lmax = l; mj = j; } }
              const dxp = chemin[mj + 1].x - chemin[mj].x, dyp = chemin[mj + 1].y - chemin[mj].y, lp = Math.hypot(dxp, dyp) || 1;
              const px = chemin[mj].x + dxp * 0.42 - (dyp / lp) * 8, py = chemin[mj].y + dyp * 0.42 + (dxp / lp) * 8;
              const txt = nature === "retour" ? "retour" : nature === "commande" ? "commande" : "navette", wP = txt.length * 4.2 + 7;
              s += `<rect x="${(px - wP / 2).toFixed(1)}" y="${(py - 5).toFixed(1)}" width="${wP.toFixed(1)}" height="10" rx="5" fill="${couleurSegment}" stroke="#fff" stroke-width="0.8"/>`
                + `<text x="${px.toFixed(1)}" y="${(py + 2.8).toFixed(1)}" font-size="7" font-weight="bold" text-anchor="middle" font-family="monospace" fill="#fff">${txt}</text>`;
            }
          }
          if (showLongueurs && seg.type !== "domotique") {
            const sectionsL = tracerLiaison(ctxL, breaker, segments, seg, hAncreL).sections;
            for (let j = 0; j < cheminM.length - 1; j++) {
              const distM = sectionsL[j] ?? distance(cheminM[j], cheminM[j + 1]);
              const aPx = chemin[j], bPx = chemin[j + 1];
              const mx = (aPx.x + bPx.x) / 2, my = (aPx.y + bPx.y) / 2;
              // Longueur toujours en noir, quelle que soit la couleur du circuit — lisible sur
              // n'importe quelle teinte de tracé, contrairement au trait lui-même (couleurSegment).
              const vertM = distM - distance(cheminM[j], cheminM[j + 1]);
              const txtLg = `${distM.toFixed(2)}m${vertM >= 0.1 ? ` ↕${vertM.toFixed(2)}` : ""}`;   // part verticale (montée/descente) si notable
              s += `<rect x="${(mx - (txtLg.length + 1) * 1.8).toFixed(1)}" y="${(my - 8).toFixed(1)}" width="${((txtLg.length + 1) * 3.6).toFixed(1)}" height="7" fill="#fff" opacity="0.85"/>`;
              s += `<text x="${mx.toFixed(1)}" y="${(my - 3).toFixed(1)}" font-size="6" text-anchor="middle" font-family="monospace" fill="#111">${txtLg}</text>`;
            }
          }
        }
        // Hauteur/pose de chaque coude (passage de gaine dans le mur, ou en apparent) —
        // indépendant de l'inclusion des circuits : le libellé de la case à cocher promet
        // "hauteurs d'implantation (appareillages + gaines)" quel que soit l'état de
        // "Inclure les circuits", donc ces annotations s'affichent dès que showHauteurs est
        // coché, même si showCircuits est décoché (dans ce cas, sans le tracé coloré).
        if (showHauteurs) {
          const coudes = coudesAuto;
          coudes.forEach(c => {
            if (c.hauteur == null && !c.poseType) return;
            const pC = toPx(c.point);
            const pose = c.poseType === "apparent" ? "apparent" : "encastré";
            const txt = c.hauteur != null ? `${c.hauteur}cm (${pose})` : `(${pose})`;
            const couleurPoint = showCircuits ? couleurSegment : "#78716c";
            s += `<circle cx="${pC.x.toFixed(1)}" cy="${pC.y.toFixed(1)}" r="2" fill="${couleurPoint}"/>`;
            s += `<text x="${(pC.x + 4).toFixed(1)}" y="${(pC.y - 4).toFixed(1)}" font-size="6" font-family="monospace" fill="#333">${escapeXml(txt)}</text>`;
          });
        }
      });
      if (showCircuits) {
        const lumieres = breaker.circuit === "lumiere" ? points.filter(a => estLumiere(a.type)) : [];
        const boitesExistantes = n.boitesDerivation?.[breaker.label] ?? [];
        const dessinerBoiteImprimee = (pt: Point, nom?: string) => {
          const pos = toPx(pt);
          const X = pos.x, Y = pos.y;
          s += `<rect x="${(X - 8).toFixed(1)}" y="${(Y - 8).toFixed(1)}" width="16" height="16" rx="2" fill="#fff" stroke="#111" stroke-width="1.6"/>`;
          s += `<rect x="${(X - 8).toFixed(1)}" y="${(Y - 8).toFixed(1)}" width="16" height="4" rx="1.5" fill="${color}"/>`;
          [-4.5, 0, 4.5].forEach(dx => { s += `<rect x="${(X + dx - 1.8).toFixed(1)}" y="${(Y - 2).toFixed(1)}" width="3.6" height="6.5" rx="0.8" fill="#e7e5e4" stroke="#57534e" stroke-width="0.6"/><rect x="${(X + dx - 1.8).toFixed(1)}" y="${(Y - 3.2).toFixed(1)}" width="3.6" height="2" rx="0.8" fill="#f97316"/>`; });
          s += `<text x="${X.toFixed(1)}" y="${(Y - 11).toFixed(1)}" font-size="7.5" font-weight="700" text-anchor="middle" font-family="monospace" fill="#111">${escapeXml(nom || "Boîte")}</text>`;
        };
        boitesExistantes.forEach(b => dessinerBoiteImprimee(b.point, b.nom));
        if (!boitesExistantes.some(x => !x.surSegment) && lumieres.length > 1) {
          dessinerBoiteImprimee(pointBoiteImplicite(lumieres.map(l => ({ x: l.x, y: l.y })), n.pieces, origineCircuits(n)));
        }
      }
    });
  }

  niveauResultat.pieces.forEach(p => {
    const plaquesP = infosPlaques(p.appareillages);
    p.appareillages.forEach(a => {
      const infoPl = a.groupeId != null ? plaquesP.get(a.groupeId) : undefined;
      const ptAncreP = infoPl ? { x: infoPl.gx, y: infoPl.gy } : { x: a.x, y: a.y };
      const pos = toPx(ptAncreP);
      const color = showCircuits && a.circuitId != null ? (colorMap.get(a.circuitId) ?? "#1c1917") : "#1c1917";
      // Même logique qu'à l'écran : carré tangent au mur, symbole tourné vers l'intérieur.
      const TAILLE_SYM = 10;
      let cxP = pos.x, cyP = pos.y, rotP = 0;
      const ancP = estMural(a.type) ? ancrageMural(ptAncreP, p, niveauResultat.zones ?? []) : null;
      if (ancP) {
        const pf = toPx(ancP.pied);
        const pn = toPx({ x: ancP.pied.x + ancP.normale.x * 0.1, y: ancP.pied.y + ancP.normale.y * 0.1 });
        const ln = Math.hypot(pn.x - pf.x, pn.y - pf.y) || 1;
        const nxp = (pn.x - pf.x) / ln, nyp = (pn.y - pf.y) / ln;
        const demiP = TAILLE_SYM * 0.75 + Math.max(0.8, ancP.faceM * scale);
        cxP = pf.x + nxp * demiP; cyP = pf.y + nyp * demiP;
        rotP = Math.atan2(nxp, -nyp) * 180 / Math.PI;
      }
      if (infoPl) {
        // Plaque multiple : un carré par poste, contigus le long du mur, + contour commun (dessiné avec le rang 0).
        const pas = TAILLE_SYM * 1.5 + 0.6;
        const dr = ancP ? droiteFaceAuMur(ancP.normale) : { x: 1, y: 0 };
        const off = ((a.rangPlaque ?? 0) - (infoPl.n - 1) / 2) * pas;
        if ((a.rangPlaque ?? 0) === 0) {
          const larg = infoPl.n * pas - 0.6 + 3;
          s += `<g transform="translate(${cxP.toFixed(2)} ${cyP.toFixed(2)}) rotate(${rotP.toFixed(2)})"><rect x="${(-larg / 2).toFixed(2)}" y="${(-TAILLE_SYM * 0.75 - 1.5).toFixed(2)}" width="${larg.toFixed(2)}" height="${(TAILLE_SYM * 1.5 + 3).toFixed(2)}" rx="3" fill="none" stroke="#78716c" stroke-width="0.8" stroke-dasharray="2,1.5"/></g>`;
        }
        cxP += dr.x * off; cyP += dr.y * off;
      }
      s += appareillageSymbolSvgString(a.type, cxP, cyP, TAILLE_SYM, color, rotP, true);
      if (a.type === "prise_dediee") {
        const ini = escapeXml(initialesAppareillage(a.type, a.usageDedie));
        s += `<text x="${cxP.toFixed(1)}" y="${(cyP + TAILLE_SYM * 1.5).toFixed(1)}" font-size="5.5" font-weight="bold" text-anchor="middle" font-family="monospace" fill="${color}">${ini}</text>`;
      }
      if (showHauteurs && a.hauteur != null) {
        s += `<text x="${(cxP + 9).toFixed(1)}" y="${(cyP + 3).toFixed(1)}" font-size="6" font-family="monospace" fill="#555">${a.hauteur}cm</text>`;
      }
    });
  });

  if (n.tableauPos) {
    const pos = toPx(n.tableauPos);
    s += `<rect x="${(pos.x - 6).toFixed(1)}" y="${(pos.y - 6).toFixed(1)}" width="12" height="12" rx="2" fill="#1c1917"/>`;
    s += `<text x="${pos.x.toFixed(1)}" y="${(pos.y + 3).toFixed(1)}" font-size="8" text-anchor="middle" fill="#FBBF24">⚡</text>`;
    if (showHauteurs && n.tableauHauteur != null) {
      s += `<text x="${pos.x.toFixed(1)}" y="${(pos.y + 16).toFixed(1)}" font-size="6" text-anchor="middle" font-family="monospace" fill="#555">${n.tableauHauteur}cm</text>`;
    }
  }

  if (n.pointArriveeGaines) {
    const pos = toPx(n.pointArriveeGaines);
    s += `<circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="6" fill="#0EA5E9" stroke="#fff" stroke-width="1.2"/>`;
    s += `<text x="${pos.x.toFixed(1)}" y="${(pos.y + 3).toFixed(1)}" font-size="7" text-anchor="middle" fill="#fff">⬇</text>`;
    if (n.distanceArriveeGainesTableau != null) {
      s += `<text x="${pos.x.toFixed(1)}" y="${(pos.y + 16).toFixed(1)}" font-size="6" text-anchor="middle" font-family="monospace" fill="#0369A1">${n.distanceArriveeGainesTableau}m → tableau</text>`;
    }
    {
      const candidats = n.pieces.flatMap(pc => pc.appareillages).filter(a => {
        if (a.dejaExistant) return false;
        const manuel = a.circuitManuelId != null ? (n.circuitsManuels ?? []).find(m => m.id === a.circuitManuelId) : undefined;
        return !manuel?.nonRelieTableau;
      });
      if (candidats.length > 0) {
        let dMin = Infinity;
        candidats.forEach(a => { const d = distance(n.pointArriveeGaines!, { x: a.x, y: a.y }); if (d < dMin) dMin = d; });
        const yDist = pos.y + (n.distanceArriveeGainesTableau != null ? 23 : 16);
        s += `<text x="${pos.x.toFixed(1)}" y="${yDist.toFixed(1)}" font-size="6" text-anchor="middle" font-family="monospace" fill="#0369A1">${dMin.toFixed(2)}m → 1er appareillage</text>`;
      }
    }
  }

  // Étiquettes des pièces (nom + surface), au-dessus de tout, avec halo blanc : position déplacée
  // à la main (Piece.nomDecalage) si elle existe, sinon placement automatique à l'endroit le plus
  // libre — même logique que sur le plan. Lue sur les pièces VIVANTES (pas sur le résultat figé).
  pieces.forEach(p => {
    const spec = PIECE_TYPES[p.type];
    const nom = p.nom || spec.label;
    const surf = `${(surfaceUtile(p) ?? aireDuPolygone(p.contour)).toFixed(1)} m²`;
    const w = Math.max(nom.length * 6, surf.length * 4.9) + 8, h = 22;
    const cW = centroide(p.contour), cPx = toPx(cW);
    let pos: Point;
    if (p.nomDecalage) {
      pos = toPx({ x: cW.x + p.nomDecalage.x, y: cW.y + p.nomDecalage.y });
    } else {
      const obstacles: RectPx[] = p.appareillages.map(a => carreAutour(toPx({ x: a.x, y: a.y }), 13));
      (p.ouvertures ?? []).forEach(o => {
        const a0 = p.contour[o.segIndex], b0 = p.contour[(o.segIndex + 1) % p.contour.length];
        if (!a0 || !b0) return;
        obstacles.push(carreAutour(toPx({ x: a0.x + (b0.x - a0.x) * o.position, y: a0.y + (b0.y - a0.y) * o.position }), (o.largeur / 100) * scale * (o.type === "fenetre" ? 0.5 : 0.75) + 3));
      });
      if (n.tableauPos && pointDansPolygone(n.tableauPos, p.contour)) obstacles.push(carreAutour(toPx(n.tableauPos), 12));
      pos = placerEtiquettePiece(p.contour.map(toPx), cPx, { w, h }, obstacles);
    }
    const tf = `text-anchor="middle" font-family="monospace"`;
    s += `<g ${tf}>`
      + (p.masquerNom ? "" : `<text x="${pos.x.toFixed(1)}" y="${(pos.y - 2).toFixed(1)}" font-size="10" font-weight="bold" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round">${escapeXml(nom)}</text>`
      + `<text x="${pos.x.toFixed(1)}" y="${(pos.y - 2).toFixed(1)}" font-size="10" font-weight="bold" fill="#111">${escapeXml(nom)}</text>`)
      + (p.masquerDimensions ? "" : `<text x="${pos.x.toFixed(1)}" y="${(pos.y + 9).toFixed(1)}" font-size="8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round">${surf}</text>`
      + `<text x="${pos.x.toFixed(1)}" y="${(pos.y + 9).toFixed(1)}" font-size="8" fill="#555">${surf}</text>`) + `</g>`;
  });

  // Cotes d'implantation (option d'impression) : une cote par appareillage mural — sa distance
  // au coin le plus proche — en écartant celles qui se chevaucheraient, pour rester lisible.
  if (showCotes) {
    const cotes = niveauResultat.pieces.flatMap(pc => pc.appareillages
      .filter(a => estMural(a.type))
      .flatMap(a => cotesAppareillage({ x: a.x, y: a.y }, pc.contour, a.type, false, repereCotes(pc))));
    filtrerCotesLisibles(cotes, toPx, [], 12, 22).forEach(c => { s += coteSvgString(c, toPx); });
    s += `<text x="4" y="10" font-size="6" font-family="monospace" fill="${COULEUR_COTE}">Cotes en cm — distance de l'appareillage au coin intérieur le plus proche</text>`;
  }
  // Cotes des pièces : dimension intérieure de chaque mur (face finie à face finie) + épaisseurs.
  if (showCotesPieces) {
    const cotesP: Cote[] = niveauResultat.pieces.filter(pc => !pc.masquerDimensions).flatMap(pc => {
      const { utile, utileFin } = geometrieMurs(pc);
      return pc.contour.map((_, i): Cote => {
        const a = utile[i], b = utileFin[i];
        return { kind: "mur", a, b, valeurCm: Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 100), normale: normaleInterieure(pc.contour, i), interieur: true, decalageM: 0 };
      });
    });
    filtrerCotesLisibles(cotesP, toPx, [], 12, 22).forEach(c => { s += coteSvgString(c, toPx); });
    niveauResultat.pieces.filter(pc => !pc.masquerDimensions).forEach(pc => pc.contour.forEach((_, i) => {
      const sp = murDe(pc, i);
      // Centre et direction de la bande de structure : là où l'épaisseur se lit sur le mur.
      const qs = geometrieMurs(pc).quads[i].structure.map(toPx);
      const cx = (qs[0].x + qs[1].x + qs[2].x + qs[3].x) / 4, cy = (qs[0].y + qs[1].y + qs[2].y + qs[3].y) / 4;
      const dx = (qs[1].x + qs[2].x) / 2 - (qs[0].x + qs[3].x) / 2, dy = (qs[1].y + qs[2].y) / 2 - (qs[0].y + qs[3].y) / 2;
      const A = { x: cx - dx / 2, y: cy - dy / 2 }, B = { x: cx + dx / 2, y: cy + dy / 2 };
      if (((sp.epaisseur + sp.doublage + (sp.finition ?? 0)) / 100) * scale < 7 || Math.hypot(B.x - A.x, B.y - A.y) < 30) return;
      let ang = Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI; if (ang > 90 || ang < -90) ang += 180;
      const txt = [sp.finition ?? 0, sp.doublage, sp.epaisseur].filter(v => v > 0).join("+");
      s += `<text transform="translate(${((A.x + B.x) / 2).toFixed(1)} ${((A.y + B.y) / 2).toFixed(1)}) rotate(${ang.toFixed(1)})" text-anchor="middle" dominant-baseline="central" font-size="5" font-weight="bold" font-family="monospace" fill="#fff" stroke="${sp.type === "exterieur" ? "#44403c" : "#78716c"}" stroke-width="1.6" paint-order="stroke">${txt}</text>`;
    }));
    s += `<text x="4" y="${showCotes ? 18 : 10}" font-size="6" font-family="monospace" fill="${COULEUR_COTE}">Cotes des pièces en cm — dimensions intérieures (faces finies) · épaisseurs : structure+doublage</text>`;
  }
  // Cotes d'ouvertures (chaîne le long de la face intérieure) et cotes extérieures / hors-tout.
  if (showCotesOuv || showCotesExt) {
    const cotesA: Cote[] = [
      ...(showCotesOuv ? niveauResultat.pieces.filter(pc => !pc.masquerDimensions).flatMap(pc => cotesOuvertures(pc, niveauResultat.pieces)) : []),
      ...(showCotesExt ? [...cotesExterieures(niveauResultat.pieces), ...coteHorsTout(niveauResultat.pieces)] : []),
    ];
    filtrerCotesLisibles(cotesA, toPx, [], 10, 20).forEach(c => { s += coteSvgString(c, toPx); });
  }
  s += `</svg>`;
  return s;
}

export function couleurTaux(tauxPct: number): string {
  return tauxPct <= 20 ? "#059669" : tauxPct <= 33 ? "#D97706" : "#DC2626";
}

export function gaineNiveauHtml(troncon: TronconGaine | undefined, niveau: Niveau): string {
  const lignes: string[] = [];
  if (troncon) {
    lignes.push(`<span>🔀 Gaine principale : <strong>${troncon.nbGaines > 1 ? `${troncon.nbGaines} × ` : ""}${escapeXml(troncon.gaine)}</strong></span>` +
      `<span style="color:${couleurTaux(troncon.tauxPct)};font-weight:bold;">${troncon.tauxPct}% de remplissage</span>` +
      `<span style="color:#888;">(${troncon.circuits.length} circuit${troncon.circuits.length > 1 ? "s" : ""} regroupés Tableau → niveau)</span>`);
  }
  if (niveau.pointArriveeGaines && niveau.distanceArriveeGainesTableau != null) {
    lignes.push(`<span>⬇ Point d'arrivée des gaines — distance au tableau électrique : <strong>${niveau.distanceArriveeGainesTableau}m</strong> (liaison verticale non représentée sur le plan)</span>`);
  }
  if (lignes.length === 0) return "";
  return `<div style="margin:0 6mm 6mm;font-size:8pt;font-family:monospace;color:#333;display:flex;flex-wrap:wrap;align-items:center;gap:6px;">${lignes.join("")}</div>`;
}

export function legendeCircuitsHtml(resultat: ResultatGeneration | null, niveau: Niveau, showLongueurs: boolean, niveauVivant: Niveau): string {
  if (!resultat) return "";
  const colorMap = construireColorMap(resultat, [niveauVivant]);
  const utilises = breakersDuNiveau(resultat.breakers, niveau)
    .map(b => ({ b, color: colorMap.get(b.id) ?? "#666" }));
  if (utilises.length === 0) return "";
  const legendeFils = `<div style="display:flex;flex-wrap:wrap;gap:10px;margin:0 6mm 3mm;font-size:8pt;font-family:monospace;align-items:center;"><b>Fils :</b>` +
    LEGENDE_FILS.map(f => `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:16px;height:4px;border-radius:2px;display:inline-block;background:${f.terre ? `repeating-linear-gradient(90deg,${COULEUR_FIL.terreVert} 0 4px,${COULEUR_FIL.terreJaune} 4px 8px)` : f.couleur};"></span>${f.libelle}${f.terre ? " (jaune/vert)" : ""}</span>`).join("") + `<span style="color:#666;">· la gaine autour des fils et les appareillages = couleur du circuit</span></div>`;
  return legendeFils + `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:0 6mm 6mm;font-size:8pt;font-family:monospace;">` +
    utilises.map(({ b, color }) => {
      let lgTxt = "";
      // Longueur calculée sur le niveau VIVANT (tableau/coudes/ordre de câblage actuels) plutôt
      // que sur l'instantané figé au moment de la génération — sinon un cheminement redessiné
      // ou un coude déplacé après coup ne se répercuterait pas sur la longueur imprimée.
      if (showLongueurs && origineCircuits(niveauVivant)) {
        const pts = niveauVivant.pieces.flatMap(p => p.appareillages).filter(a => a.circuitId === b.id);
        if (pts.length > 0) {
          const lg = longueurCircuit(creerContexteLongueurs(niveauVivant), b, pts, origineCircuits(niveauVivant)!);
          lgTxt = ` — ${lg.totale.toFixed(1)}m${lg.verticale > 0.05 ? ` (dont ${lg.verticale.toFixed(1)}m vertical)` : ""}`;
        }
      }
      const nomCircuit = niveauVivant.nomsCircuits?.[b.label] ?? b.label;
      return `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;"></span>${escapeXml(nomCircuit || CIRCUITS[b.circuit]?.label || b.circuit)}${lgTxt}</span>`;
    }).join("") + `</div>`;
}

// Nomenclature des symboles d'un niveau : pour chaque type d'appareillage réellement présent, son symbole
// normalisé (le même que sur le plan), son libellé et sa quantité ; une prise dédiée est comptée par appareil
// alimenté. Termine par le décompte des appareillages multiples (plaques double / triple / quadruple).
export function nomenclatureHtml(pieces: Piece[]): string {
  const ordre = new Map(PALETTE.map((pa, i) => [pa.type, i] as const));
  const lignes = new Map<string, { a: AppareillagePlace; nb: number }>();
  const postesParPlaque = new Map<number, number>();
  pieces.forEach(pc => pc.appareillages.forEach(a => {
    const cle = a.type === "prise_dediee" ? `prise_dediee:${a.usageDedie ?? USAGE_DEDIE_DEFAUT}` : a.type;
    const l = lignes.get(cle);
    if (l) l.nb++; else lignes.set(cle, { a, nb: 1 });
    if (a.groupeId != null) postesParPlaque.set(a.groupeId, (postesParPlaque.get(a.groupeId) ?? 0) + 1);
  }));
  if (lignes.size === 0) return "";
  const tri = [...lignes.entries()].sort((x, y) => (ordre.get(x[1].a.type) ?? 99) - (ordre.get(y[1].a.type) ?? 99) || x[0].localeCompare(y[0]));
  const lignesHtml = tri.map(([, { a, nb }]) =>
    `<tr><td style="padding:2px 8px;"><svg width="22" height="22" viewBox="0 0 22 22">${appareillageSymbolSvgString(a.type, 11, 11, 18, "#1c1917", 0, false)}</svg></td>` +
    `<td style="padding:2px 8px;">${escapeXml(labelAppareillagePlace(a))}</td><td style="padding:2px 8px;text-align:right;font-weight:bold;">${nb}</td></tr>`).join("");
  const plaques = new Map<number, number>();
  postesParPlaque.forEach(nb => { if (nb >= 2) plaques.set(nb, (plaques.get(nb) ?? 0) + 1); });
  const nomP = (n: number) => n === 2 ? "double" : n === 3 ? "triple" : "quadruple";
  const plaquesHtml = plaques.size === 0 ? "" :
    `<tr><td colspan="3" style="padding:4px 8px 0;border-top:1px solid #ccc;">Appareillages multiples : ${[...plaques.entries()].sort((x, y) => x[0] - y[0]).map(([n, nb]) => `${nb} ${nomP(n)}${nb > 1 ? "s" : ""}`).join(", ")}</td></tr>`;
  return `<div style="margin:0 6mm 6mm;font-size:8pt;font-family:monospace;break-inside:avoid;"><p style="margin:0 0 2mm;font-weight:bold;">Nomenclature des symboles</p>` +
    `<table style="border-collapse:collapse;border:1px solid #999;">${lignesHtml}${plaquesHtml}</table></div>`;
}

export function imprimerPlan(
  niveaux: Niveau[], clientName: string, resultat: ResultatGeneration | null,
  showCircuits: boolean, showLongueurs: boolean, showHauteurs: boolean, piecesSelectionnees: Set<number> | null, showCotes: boolean, showCotesPieces: boolean, showCotesExt: boolean, showCotesOuv: boolean,
) {
  const w = window.open("", "_blank");
  if (!w) return;
  let html = `<html><head><title>Plan — ${escapeXml(clientName)}</title><style>
    @page { margin: 10mm; }
    body { margin: 0; font-family: 'Courier New', monospace; }
    h2 { font-size: 14pt; margin: 6mm 6mm 1mm; }
    .meta { font-size: 9pt; color: #555; margin: 0 6mm 4mm; }
    svg { display: block; margin: 0 auto 4mm; }
  </style></head><body>`;
  const gainesNiveaux = resultat ? genererGainesNiveaux(resultat) : [];
  [...niveaux].sort((a, b) => a.ordre - b.ordre).forEach(n => {
    const piecesFiltrees = piecesSelectionnees ? n.pieces.filter(p => piecesSelectionnees.has(p.id)) : n.pieces;
    if (piecesFiltrees.length === 0) return;
    const niveauResultatComplet = n;
    const niveauResultat: Niveau = { ...niveauResultatComplet, pieces: niveauResultatComplet.pieces.filter(p => piecesFiltrees.some(pf => pf.id === p.id)) };
    html += `<h2>${escapeXml(n.nom || NIVEAU_TYPES[n.type])}</h2><div class="meta">${piecesFiltrees.length} pièce${piecesFiltrees.length > 1 ? "s" : ""}</div>`;
    html += rendreSVGImprimable(n, resultat, showCircuits, showHauteurs, showLongueurs, piecesSelectionnees, showCotes, showCotesPieces, showCotesExt, showCotesOuv);
    if (showCircuits) {
      html += legendeCircuitsHtml(resultat, niveauResultat, showLongueurs, n);
    }
    html += nomenclatureHtml(piecesFiltrees);
    const troncon = gainesNiveaux.find(g => g.niveau === (n.nom || n.type));
    if (showCircuits || (n.pointArriveeGaines && n.distanceArriveeGainesTableau != null)) {
      html += gaineNiveauHtml(undefined, n);   // chaque circuit part du tableau dans SA gaine : pas de gaine « principale » commune à afficher
    }
  });
  html += `</body></html>`;
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.print(); w.close(); }, 400);
}
