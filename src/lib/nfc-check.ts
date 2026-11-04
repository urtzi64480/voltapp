// src/lib/nfc-check.ts
//
// CONTRÔLE NF C 15-100 DU TABLEAU (erreurs / avertissements / infos + score /100). Source UNIQUE : le tableau ouvert, la fiche client et la liste
// des tableaux affichent tous le même score. Le contrôle alerte, il ne bloque jamais.

import {
  AMPERES_DIFFERENTIEL, BREAKER_TYPES, CIRCUITS, DIFF_HIERARCHY, EMPLACEMENTS_PAR_RANGEE, effectiveSection, emplacementsOccupes, estAccessoireTableau,
  premierEmplacementLibre, uid, type Breaker, type BreakerRow,
} from "./electrical-constants";

export function safeBreakers(slots: (Breaker | null)[] | undefined): Breaker[] {
  if (!Array.isArray(slots)) return [];
  return slots.filter((b): b is Breaker =>
    b != null && typeof b === "object" && typeof b.type === "string" && b.type.length > 0
  );
}

// ─── NFC 15-100 CHECKER ───────────────────────────────────────────────────────

// Chaque message du contrôle propose SA correction : un texte (`fix`) et, quand elle est sans ambiguïté, un bouton « Appliquer » (`action`)
// qui transforme les rangées. Les corrections qui demandent un choix de l'électricien (répartir des circuits…) restent des conseils.
export type CorrectionNFC = { fix: string; action?: { label: string; run: (rs: BreakerRow[]) => BreakerRow[] } };
export type MessageNFC = { id: string; msg: string; rule: string } & CorrectionNFC;

const sectionMiniPourCalibre = (a: number): string => (a <= 16 ? "1.5" : a <= 20 ? "2.5" : a <= 25 ? "4.0" : a <= 32 ? "6.0" : "10.0");
const majAppareil = (id: number, patch: (b: Breaker) => Breaker) => (rs: BreakerRow[]): BreakerRow[] =>
  rs.map(r => ({ ...r, slots: r.slots.map(b => (b && b.id === id ? patch(b) : b)) }));

export function checkNFC(rows: BreakerRow[]) {
  const errors:   MessageNFC[] = [];
  const warnings: MessageNFC[] = [];
  const infos:    MessageNFC[] = [];

  if (!Array.isArray(rows) || rows.length === 0) {
    infos.push({ id: "empty", msg: "Tableau vide — ajoutez des rangées pour commencer.", rule: "—", fix: "Clique sur « Ajouter une rangée », ou génère les circuits dans le plan puis « Pousser vers le tableau »." });
    return { errors, warnings, infos, score: 100 };
  }

  // Coffret de communication et appareils modulaires (coupure générale, prises 16 A, ports RJ45) : hors contrôle des circuits.
  const allBreakers = rows.filter(r => r.kind !== "multimedia").flatMap(r => safeBreakers(r.slots)).filter(b => !estAccessoireTableau(b));
  const diffs = allBreakers.filter(b => !!BREAKER_TYPES[b.type]?.isDiff);

  // ── ERREURS : sécurité électrique ──

  if (diffs.length === 0) {
    errors.push({ id: "no-diff", msg: "Aucun différentiel 30mA détecté. Minimum 2 obligatoires.", rule: "Art. 531.2",
      fix: "Mets un interrupteur différentiel 30 mA (type AC ou A) dans la première case de chaque rangée, et prévois-en au moins deux.",
      action: { label: "Ajouter un différentiel type A 40 A en case 1 de chaque rangée", run: rs => rs.map(r => (r.kind !== "multimedia" && !r.slots[0]
        ? { ...r, slots: r.slots.map((b, i) => (i === 0 ? { id: uid(), label: "", circuit: "general", amperes: 40, type: "diff-A", customSection: "10.0", pieces: [] } as Breaker : b)) } : r)) } });
  } else if (diffs.length === 1) {
    errors.push({ id: "one-diff", msg: "Un seul différentiel détecté. Minimum 2 ID 30mA requis.", rule: "Art. 531.2",
      fix: "Ajoute un second différentiel 30 mA : crée une nouvelle rangée (« Ajouter une rangée ») et déplace-y une partie des circuits, ou pose-le en case 1 d'une rangée qui n'en a pas.",
      action: { label: "Ajouter une rangée avec un différentiel type A 40 A", run: rs => [...rs, { id: uid(), name: `Rangée ${rs.filter(x => x.kind !== "multimedia").length + 1}`, slots: [{ id: uid(), label: "", circuit: "general", amperes: 40, type: "diff-A", customSection: "10.0", pieces: [] } as Breaker, ...Array(8).fill(null)] }] } });
  }

  rows.forEach(row => {
    if (row.kind === "multimedia") return;
    const rawDiff = Array.isArray(row.slots) ? row.slots[0] : null;
    const diff = (rawDiff != null && typeof rawDiff === "object" && typeof (rawDiff as any).type === "string")
      ? rawDiff as Breaker : null;
    const breakers = safeBreakers(Array.isArray(row.slots) ? row.slots.slice(1) : []).filter(b => !estAccessoireTableau(b));

    if (breakers.length > 8) {
      errors.push({ id: `max8-${row.id}`, msg: `Rangée "${row.name}" : plus de 8 circuits sous le différentiel.`, rule: "Art. 531.2.4",
        fix: "Glisse les circuits en trop dans une nouvelle rangée, sous son propre différentiel 30 mA." });
    }

    // Calibre du différentiel vs charge réelle de la rangée — un ID doit couvrir la
    // charge de ce qu'il protège, pas une valeur arbitraire. Foisonnement 0,5 sur tout
    // sauf le chauffage électrique (compté à 100%, peu diversifié). Avertissement plutôt
    // qu'erreur : c'est une règle de dimensionnement pratique, pas un article NFC unique
    // et strict comme le sont les autres contrôles de cette liste.
    if (diff && breakers.length > 0) {
      const charge = breakers.reduce((somme, b) => {
        const estChauffage = CIRCUITS[b.circuit]?.category === "chauffage";
        return somme + (estChauffage ? b.amperes : b.amperes * 0.5);
      }, 0);
      if (diff.amperes < charge) {
        warnings.push({
          id: `diffamp-${row.id}`,
          msg: `Rangée "${row.name}" : différentiel ${diff.amperes}A potentiellement sous-dimensionné pour les circuits protégés (charge estimée ≈ ${Math.ceil(charge)}A — chauffage compté à 100%, reste à 50%).`,
          rule: "Dimensionnement amont/aval",
          fix: `Passe le différentiel à ${AMPERES_DIFFERENTIEL.find(a => a >= charge) ?? AMPERES_DIFFERENTIEL[AMPERES_DIFFERENTIEL.length - 1]} A, ou répartis les circuits de cette rangée sous deux différentiels.`,
          action: { label: `Passer le différentiel à ${AMPERES_DIFFERENTIEL.find(a => a >= charge) ?? AMPERES_DIFFERENTIEL[AMPERES_DIFFERENTIEL.length - 1]} A`, run: majAppareil(diff.id, b => ({ ...b, amperes: AMPERES_DIFFERENTIEL.find(a => a >= charge) ?? AMPERES_DIFFERENTIEL[AMPERES_DIFFERENTIEL.length - 1] })) },
        });
      }
    }

    breakers.forEach(b => {
      const spec = CIRCUITS[b.circuit];
      if (!spec) return;
      const lbl = b.label || spec.label;
      const section = effectiveSection(b);

      // Calibre > max du circuit → ERREUR (éclairage : 10 A ou 16 A admis avec du 1,5 mm² — la table CIRCUITS garde 10 A comme calibre par défaut).
      const ampMaxAutorise = b.circuit === "lumiere" ? 16 : spec.ampMax;
      if (ampMaxAutorise && b.amperes > ampMaxAutorise) {
        errors.push({ id: `amp-${b.id}`, msg: `"${lbl}" : ${b.amperes}A dépasse le max autorisé (${ampMaxAutorise}A).`, rule: "NFC §533",
          fix: `Ramène le disjoncteur à ${ampMaxAutorise} A au maximum, ou répartis ce circuit en deux.`,
          action: { label: `Passer le calibre à ${ampMaxAutorise} A`, run: majAppareil(b.id, x => ({ ...x, amperes: ampMaxAutorise })) } });
      }

      // Absence différentiel → ERREUR
      if (!diff) {
        errors.push({ id: `nodiff-${b.id}`, msg: `"${lbl}" : aucun différentiel en amont.`, rule: "Art. 531.2",
          fix: "Place un différentiel 30 mA dans la première case de cette rangée (case de gauche).",
          action: row.slots[0] ? undefined : { label: "Ajouter un différentiel type A 40 A en case 1", run: rs => rs.map(x => (x.id === row.id ? { ...x, slots: x.slots.map((c, i) => (i === 0 ? { id: uid(), label: "", circuit: "general", amperes: 40, type: "diff-A", customSection: "10.0", pieces: [] } as Breaker : c)) } : x)) } });
      } else if (spec.diffType) {
        const covType = BREAKER_TYPES[diff.type]?.diffType;
        if (covType && (DIFF_HIERARCHY[covType] ?? -1) < (DIFF_HIERARCHY[spec.diffType] ?? -1)) {
          errors.push({ id: `difftype-${b.id}`, msg: `"${lbl}" : nécessite diff. Type ${spec.diffType}, protégé par Type ${covType}.`, rule: "NFC §531.2",
            fix: `Remplace le différentiel de cette rangée par un type ${spec.diffType} (ou supérieur), ou déplace ce circuit sous un différentiel adapté.`,
            action: diff ? { label: `Passer le différentiel en type ${spec.diffType}`, run: majAppareil(diff.id, x => ({ ...x, type: `diff-${spec.diffType}` })) } : undefined });
        }
      }

      // ── AVERTISSEMENTS uniquement ──

      // Section câble insuffisante pour le calibre
      const sectionNum = parseFloat(section);
      const maxAmpSection =
        sectionNum <= 1.5 ? 16 :
        sectionNum <= 2.5 ? 20 :
        sectionNum <= 4.0 ? 25 :
        sectionNum <= 6.0 ? 32 : 63;
      if (b.amperes > maxAmpSection) {
        warnings.push({
          id: `section-${b.id}`,
          msg: `"${lbl}" : section ${section}mm² insuffisante pour ${b.amperes}A (max recommandé ${maxAmpSection}A sur cette section).`,
          rule: "NFC §523",
          fix: `Passe le câble de ce circuit en ${sectionMiniPourCalibre(b.amperes)} mm² (ou réduis le calibre à ${maxAmpSection} A).`,
          action: { label: `Passer la section à ${sectionMiniPourCalibre(b.amperes)} mm²`, run: majAppareil(b.id, x => ({ ...x, customSection: sectionMiniPourCalibre(x.amperes) })) },
        });
      }

      // Calibre trop faible pour le type de circuit
      const calibreMin: Record<string, number> = {
        prise_16: 16, prise_20: 20, cuisine_prises: 20,
        plaque: 32, four: 20, lave_linge: 20, lave_vaisselle: 20,
        seche_linge: 20, chauffe_eau: 20, chauffage: 20,
        chauffage_16: 16, chauffage_20: 20,
        clim: 20, seche_serviette: 16, congelateur: 20,
        irve: 32, piscine: 20, vmc: 10, alarme: 6,
        exterieur: 16, garage: 16, volets_roulants: 16,
      };
      const minReq = calibreMin[b.circuit];
      if (minReq && b.amperes < minReq) {
        warnings.push({
          id: `calibremin-${b.id}`,
          msg: `"${lbl}" : calibre ${b.amperes}A insuffisant pour ce circuit (min recommandé ${minReq}A).`,
          rule: "NFC §533",
          fix: `Monte le disjoncteur à ${minReq} A et vérifie la section du câble (${sectionMiniPourCalibre(minReq)} mm² minimum).`,
          action: { label: `Passer le calibre à ${minReq} A`, run: majAppareil(b.id, x => ({ ...x, amperes: minReq, customSection: parseFloat(effectiveSection(x)) >= parseFloat(sectionMiniPourCalibre(minReq)) ? x.customSection : sectionMiniPourCalibre(minReq) })) },
        });
      }

      // Nombre de socles max par circuit
      const totalPrises = b.pieces.reduce((s, p) => s + (p.nbPrises ?? 0), 0);
      if (totalPrises > 0) {
        if ((b.circuit === "prise_16" || b.circuit === "exterieur" || b.circuit === "garage") && totalPrises > 8) {
          warnings.push({
            id: `socles16-${b.id}`,
            msg: `"${lbl}" : ${totalPrises} socles détectés — max 8 par circuit 16A.`,
            rule: "Art. 771.314",
            fix: "Crée un second circuit prises 16 A et répartis les socles, ou passe ce circuit en 20 A / 2,5 mm² (12 socles maximum).",
          });
        }
        const max20 = b.circuit === "cuisine_prises" ? 6 : 12;
        if ((b.circuit === "cuisine_prises" || b.circuit === "prise_20") && totalPrises > max20) {
          warnings.push({
            id: `socles20-${b.id}`,
            msg: `"${lbl}" : ${totalPrises} socles détectés — max ${max20} par circuit 20A${b.circuit === "cuisine_prises" ? " cuisine" : ""}.`,
            rule: "Art. 771.314.2",
            fix: `Crée un second circuit ${b.circuit === "cuisine_prises" ? "prises cuisine" : "20 A"} et répartis les socles (${max20} maximum par circuit).`,
          });
        }
      }

      // Circuit dédié sur plusieurs pièces
      if (spec.dedié && b.pieces.length > 1) {
        warnings.push({
          id: `dedie-${b.id}`,
          msg: `"${lbl}" : circuit dédié configuré sur ${b.pieces.length} pièces — vérifier si réellement dédié.`,
          rule: "Art. 771.314",
          fix: "Un circuit spécialisé alimente un seul appareil : retire les pièces en trop de ce circuit et crée un circuit dédié pour chaque autre appareil.",
        });
      }

      // Points lumineux trop nombreux
      if (b.circuit === "lumiere") {
        const totalPoints = b.pieces.flatMap(p => p.groupes).reduce((s, g) => s + g.nbPoints, 0);
        if (totalPoints > 8 && b.amperes <= 10) {
          warnings.push({
            id: `lumpts-${b.id}`,
            msg: `"${lbl}" : ${totalPoints} points lumineux sur un seul circuit 10A — envisager un second circuit.`,
            rule: "Art. 771.312",
            fix: "Crée un second circuit lumière et répartis-y les points lumineux (8 maximum par circuit).",
          });
        }
      }
    });
  });

  // ── Réserve et rangées vides (NF C 15-100 : 20 % d'emplacements libres, jamais de rangée vide) ──
  const rangees = rows.filter(r => r.kind !== "multimedia");
  const nbRangeesVides = rangees.filter(r => safeBreakers(r.slots.slice(1)).length === 0).length;
  if (nbRangeesVides > 0) {
    warnings.push({ id: "rangee-vide", msg: `${nbRangeesVides} rangée${nbRangeesVides > 1 ? "s" : ""} sans aucun circuit — ne pas laisser de rangée vide.`, rule: "Guide NF C 15-100",
      fix: "Équipe la rangée (disjoncteurs de réserve) ou supprime-la.",
      action: { label: "Supprimer les rangées vides", run: rs => rs.filter(x => x.kind === "multimedia" || safeBreakers(x.slots.slice(1)).length > 0) } });
  }
  if (rangees.length > 0) {
    // Réserve en EMPLACEMENTS (modules), pas en appareils : la coupure générale et la prise modulaire en occupent 2.
    // Comparaison en entiers (libres / capacité < 20 % ⇔ 5 × libres < capacité) : pas d'arrondi flottant à la limite exacte de 20 %.
    const capacite = rangees.length * EMPLACEMENTS_PAR_RANGEE;
    const utilises = rangees.reduce((n, r) => n + emplacementsOccupes(r.slots, false), 0);
    const libres = Math.max(0, capacite - utilises);
    if (libres * 5 < capacite && nbRangeesVides === 0) {
      warnings.push({ id: "reserve", msg: `Réserve insuffisante : ${libres} emplacement(s) libre(s) sur ${capacite} (moins de 20 %). La coupure générale et les prises modulaires comptent pour 2 emplacements.`, rule: "Réserve 20 % du tableau",
        fix: "Ajoute une rangée équipée de son différentiel pour garder 20 % d'emplacements libres (évolutions futures).",
        action: { label: "Ajouter une rangée avec un différentiel type A 40 A", run: rs => [...rs, { id: uid(), name: `Rangée ${rs.filter(x => x.kind !== "multimedia").length + 1}`, slots: [{ id: uid(), label: "", circuit: "general", amperes: 40, type: "diff-A", customSection: "10.0", pieces: [] } as Breaker, ...Array(8).fill(null)] }] } });
    }
  }

  // ── INFOS : recommandations générales ──

  if (!allBreakers.some(b => b.circuit === "parafoudre")) {
    infos.push({ id: "parafoudre", msg: "Parafoudre non détecté. Obligatoire NFC 15-100 (2024).", rule: "§443",
      fix: "Ajoute un parafoudre type 2 dans une case libre de la 1re rangée (circuit « Parafoudre »), protégé par son disjoncteur de déconnexion.",
      action: { label: "Ajouter un parafoudre dans la première case libre", run: rs => { let fait = false; return rs.map(r => { if (fait || r.kind === "multimedia") return r; const i = premierEmplacementLibre(r.slots, 1, false); if (i < 0) return r; fait = true; return { ...r, slots: r.slots.map((c, k) => (k === i ? { id: uid(), label: "Parafoudre", circuit: "parafoudre", amperes: 20, type: "2P", customSection: "4.0", pieces: [] } as Breaker : c)) }; }); } } });
  }

  const specialTypes = ["plaque", "four", "lave_linge", "lave_vaisselle", "chauffe_eau"];
  const found = specialTypes.filter(t => allBreakers.some(b => b.circuit === t)).length;
  if (found < 4) {
    infos.push({ id: "spec", msg: `${found} circuit(s) spécialisé(s) sur 5 recommandés.`, rule: "Art. 771.314.2",
      fix: `Ajoute un circuit dédié 20 A / 2,5 mm² (32 A / 6 mm² pour la plaque) pour : ${specialTypes.filter(t => !allBreakers.some(b => b.circuit === t)).map(t => CIRCUITS[t]?.label ?? t).join(", ")}.` });
  }

  if (!allBreakers.some(b => b.circuit === "lumiere")) {
    infos.push({ id: "no-lumiere", msg: "Aucun circuit lumière détecté.", rule: "Art. 771.312", fix: "Ajoute au moins un circuit lumière 10 A / 1,5 mm² (deux circuits si le logement dépasse 35 m²)." });
  }

  const hasPrises = allBreakers.some(b => ["prise_16","prise_20","cuisine_prises"].includes(b.circuit));
  if (!hasPrises) {
    infos.push({ id: "no-prises", msg: "Aucun circuit prises détecté.", rule: "Art. 771.314", fix: "Ajoute un circuit prises 16 A / 1,5 mm² (ou 20 A / 2,5 mm²) avec son différentiel." });
  }

  const score = Math.max(0, Math.round(100 - errors.length * 15 - warnings.length * 5 - infos.length * 2));
  return { errors, warnings, infos, score };
}

/**
 * Score /100 d'un tableau lu tel qu'enregistré (données anciennes ou incomplètes comprises) : même calcul que le tableau ouvert.
 * Les rangées illisibles sont ignorées, les appareils sans `pieces` reçoivent une liste vide.
 */
export function scoreNFC(rows: unknown): number {
  if (!Array.isArray(rows)) return 100;
  const propres: BreakerRow[] = rows
    .filter((r): r is BreakerRow => !!r && typeof r === "object" && Array.isArray((r as BreakerRow).slots))
    .map(r => ({
      ...r,
      slots: r.slots.map(b => (b && typeof b === "object" && typeof b.type === "string" && b.type.length > 0 ? { ...b, pieces: Array.isArray(b.pieces) ? b.pieces : [] } : null)),
    }));
  return checkNFC(propres).score;
}
