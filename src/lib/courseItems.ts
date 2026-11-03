export interface CourseItem {
  key: string;
  nom: string;
  qty: number;
  unite?: string;
  image?: string;
  // Référence du produit chez le fournisseur retenu (offre du catalogue) — affichée sous le nom, vue privée comme liste du client.
  reference?: string;
}

// Termes désignant une prestation (main d'œuvre, déplacement, étude...) à exclure de la liste d'achat
const SERVICE_REGEX = /main\s*d.?[oœ]uvre|heure(s)?(\s*suppl(émentaire)?)?|d[ée]placement|mise\s+en\s+service|intervention|diagnostic|[ée]tude|forfait\s*d[ée]placement|conseil/i;

// Retire le préfixe "Contient :" (ou variantes) placé avant la liste des composants
function stripKitPrefix(text: string): string {
  return text.replace(/^\s*contient\s*:?\s*/i, "").trim();
}

function parseKitPart(part: string): { qty: number; nom: string } {
  const m = part.trim().match(/^(\d+)\s*×\s*(.+)$/);
  if (m) return { qty: parseInt(m[1], 10), nom: m[2].trim() };
  return { qty: 1, nom: part.trim() };
}

export function buildCourseItems(lignes: any[]): CourseItem[] {
  const map = new Map<string, CourseItem>();

  for (const l of lignes ?? []) {
    if (l.kit_description) {
      const cleaned = stripKitPrefix(String(l.kit_description));
      const parts = cleaned.split(",").map((s: string) => s.trim()).filter(Boolean);
      for (const part of parts) {
        const { qty: qtyUnit, nom } = parseKitPart(part);
        if (SERVICE_REGEX.test(nom)) continue;
        const qty = qtyUnit * (l.quantite || 1);
        const key = nom.toLowerCase();
        // Image : seulement pour une ligne « article » (pas un vrai kit, dont les composants n'ont pas d'image).
        const image = l.kit_ratio_service == null && l.image_url ? String(l.image_url) : undefined;
        if (map.has(key)) {
          const ex = map.get(key)!;
          ex.qty += qty;
          if (!ex.image && image) ex.image = image;
        } else {
          map.set(key, { key, nom, qty, image });
        }
      }
    } else if (l.type_branche === "materiau") {
      const nomLigne = String(l.nom ?? "");
      const key = nomLigne.toLowerCase();
      const qty = l.quantite || 1;
      const image = l.image_url ? String(l.image_url) : undefined;
      const reference = String(l.reference_fournisseur ?? "").trim() || undefined;
      if (map.has(key)) {
        const ex = map.get(key)!;
        ex.qty += qty;
        if (!ex.image && image) ex.image = image;
        if (!ex.reference && reference) ex.reference = reference;
      } else {
        map.set(key, { key, nom: nomLigne, qty, unite: l.unite, image, reference });
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.nom.localeCompare(b.nom));
}

// ─── Vue PRIVÉE par fournisseur (page artisan uniquement) ───────────────────
// N'est utilisée que par /devis/[id]/courses (connecté). La liste publique envoyée au client et
// les exports restent sur buildCourseItems : le client choisit lui-même où acheter.

export interface GroupeFournisseur {
  fournisseur: string | null;   // null = fournisseur non précisé (kits, anciennes lignes…)
  items: CourseItem[];
  // Coût d'achat total du groupe (TTC) — null si une ligne matériau n'a pas de prix d'achat.
  achat: number | null;
  // Achat MAXIMUM du groupe pour ne pas vendre à perte (vue privée) — null si le calcul n'est pas demandé (voir OptionsAchatMax).
  achatMax: number | null;
}

// Calcul du prix d'achat maximum acceptable pour un prix de vente unitaire (fourni par la page privée, voir rentabilite.prixAchatMax) :
// injecté ici pour que ce module — que la liste publique du client importe aussi — ne contienne aucune formule de marge.
export interface OptionsAchatMax {
  achatMax: (venteUnitaire: number) => number;
}

// piecesParOffre : pièces à acheter par offre fournisseur (id d'offre -> pièces). Une ligne matériau dont
// l'offre retenue est en plusieurs pièces est remplacée, dans la liste d'achat, par ces pièces (quantité
// de la ligne × quantité de la pièce) : c'est ce qu'on achète réellement chez ce fournisseur.
function eclaterEnPieces(l: any, piecesParOffre?: Record<string, { nom: string; quantite: number; reference?: string | null }[]>): any[] {
  const pieces = l.fournisseur_id && piecesParOffre ? piecesParOffre[String(l.fournisseur_id)] : undefined;
  if (!pieces || pieces.length === 0 || l.type_branche !== "materiau" || l.kit_description) return [l];
  return pieces.map(pc => ({
    nom: `${pc.nom} — ${l.nom}`,
    quantite: (pc.quantite > 0 ? pc.quantite : 1) * (l.quantite || 1),
    type_branche: "materiau", unite: l.unite, fournisseur_nom: l.fournisseur_nom, fournisseur_id: l.fournisseur_id,
    reference_fournisseur: pc.reference ?? undefined,
  }));
}

export function buildCourseItemsParFournisseur(lignes: any[], piecesParOffre?: Record<string, { nom: string; quantite: number; reference?: string | null }[]>, opts?: OptionsAchatMax): GroupeFournisseur[] {
  const parNom = new Map<string, any[]>();
  for (const l of lignes ?? []) {
    const nom = String(l.fournisseur_nom ?? "").trim();
    const liste = parNom.get(nom) ?? [];
    liste.push(l);
    parNom.set(nom, liste);
  }
  const groupes: GroupeFournisseur[] = [];
  parNom.forEach((ls, nom) => {
    const items = buildCourseItems(ls.flatMap(l => eclaterEnPieces(l, piecesParOffre)));
    if (items.length === 0) return;
    const matieres = ls.filter(l => l.type_branche === "materiau" && l.kit_ratio_service == null);
    const complet = matieres.length > 0 && matieres.every(l => l.prix_achat != null);
    const achat = complet ? matieres.reduce((a, l) => a + (l.prix_achat as number) * (l.quantite || 1), 0) : null;
    // Même périmètre que l'achat (matériaux hors kits) : somme des plafonds unitaires × quantité, ligne par ligne.
    const achatMax = opts && matieres.length > 0
      ? arrondi2(matieres.reduce((a, l) => a + opts.achatMax(Number(l.prix_unitaire) || 0) * (l.quantite || 1), 0))
      : null;
    groupes.push({ fournisseur: nom || null, items, achat, achatMax });
  });
  return groupes.sort((a, b) => {
    if (a.fournisseur === null) return 1;
    if (b.fournisseur === null) return -1;
    return a.fournisseur.localeCompare(b.fournisseur, "fr");
  });
}

// ─── COMPARATIF « courses faites par le client » vs « avec ma marge » (page artisan uniquement) ───────────
// Pour chaque matériau du devis : ce que le client paierait EN ACHETANT LUI-MÊME chez le fournisseur retenu
// (prix d'achat TTC unitaire de la ligne, sans marge) contre ce qu'il paie sur le devis (prix de vente, avec ma marge).
// Franchise en base de TVA (art. 293 B) : le prix du devis est un prix TTC, les deux colonnes sont donc comparables.
// Même périmètre que le coût d'achat des groupes ci-dessus : lignes matériau hors kits (un kit n'a pas de prix d'achat
// par composant). Une ligne sans prix d'achat est listée mais exclue des totaux, et comptée à part.
//
// CONFIDENTIALITÉ : ces chiffres révèlent la marge. Ils ne sont JAMAIS lus par la liste publique /liste/[token] ;
// seuls les exports déclenchés à la main par l'artisan (copier / PDF) peuvent sortir de la page.

export interface LigneComparatif {
  cle: string;
  nom: string;
  qty: number;
  unite?: string;
  reference?: string;           // référence chez le fournisseur retenu
  achatUnitaire: number | null; // TTC fournisseur, sans marge — null = non renseigné
  achatTotal: number | null;
  venteUnitaire: number;        // prix du devis (avec ma marge)
  venteTotal: number;
  // Prix d'achat unitaire MAXIMUM pour ne pas vendre à perte (cotisations déduites) — null si le calcul n'est pas demandé.
  achatMaxUnitaire: number | null;
  // true si le prix d'achat renseigné dépasse ce maximum : la ligne est vendue à perte.
  aPerte: boolean;
}

export interface GroupeComparatif {
  fournisseur: string | null;
  lignes: LigneComparatif[];
  achat: number;  // total fournisseur TTC des lignes qui ont un prix d'achat
  vente: number;  // total devis de ces mêmes lignes (comparaison à périmètre égal)
  achatMax: number | null; // plafond d'achat de ces mêmes lignes (périmètre égal) — null si non demandé
  sansPrix: number; // lignes sans prix d'achat, exclues des deux totaux ci-dessus
}

export interface ComparatifAchat {
  groupes: GroupeComparatif[];
  totalAchat: number;
  totalVente: number;
  totalAchatMax: number | null; // plafond d'achat total des lignes qui ont un prix d'achat (périmètre de totalAchat) — null si non demandé
  nbAPerte: number;         // lignes dont le prix d'achat dépasse le plafond
  ecart: number;            // totalVente − totalAchat : ce que la prestation (marge) ajoute
  economiePct: number | null; // part du prix devis économisée en achetant soi-même
  nbSansPrix: number;
  nbKitsIgnores: number;    // lignes kit : pas de prix d'achat par composant, non comparables
}

const arrondi2 = (n: number) => Math.round(n * 100) / 100;

export function buildComparatifAchat(lignes: any[], opts?: OptionsAchatMax): ComparatifAchat {
  const parFournisseur = new Map<string, Map<string, LigneComparatif>>();
  let nbKitsIgnores = 0;
  for (const l of lignes ?? []) {
    if (l.type_branche !== "materiau") continue;
    if (l.kit_ratio_service != null) { nbKitsIgnores++; continue; }
    const fournisseur = String(l.fournisseur_nom ?? "").trim();
    const qty = l.quantite || 1;
    const achatUnitaire: number | null = l.prix_achat != null ? Number(l.prix_achat) : null;
    const venteUnitaire = Number(l.prix_unitaire) || 0;
    const cle = `${String(l.nom).toLowerCase()}|${achatUnitaire ?? "?"}|${venteUnitaire}`;
    const groupe = parFournisseur.get(fournisseur) ?? new Map<string, LigneComparatif>();
    const existante = groupe.get(cle);
    if (existante) {
      existante.qty += qty;
    } else {
      const achatMaxUnitaire = opts ? opts.achatMax(venteUnitaire) : null;
      groupe.set(cle, {
        cle, nom: l.nom, qty, unite: l.unite, reference: String(l.reference_fournisseur ?? "").trim() || undefined, achatUnitaire, achatTotal: null,
        venteUnitaire, venteTotal: 0, achatMaxUnitaire, aPerte: achatMaxUnitaire != null && achatUnitaire != null && achatUnitaire > achatMaxUnitaire + 1e-9,
      });
    }
    parFournisseur.set(fournisseur, groupe);
  }

  const groupes: GroupeComparatif[] = [];
  let totalAchat = 0, totalVente = 0, nbSansPrix = 0, totalAchatMax = 0, nbAPerte = 0;
  parFournisseur.forEach((map, nom) => {
    const lignesGroupe = Array.from(map.values()).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    let achat = 0, vente = 0, sansPrix = 0, achatMax = 0;
    lignesGroupe.forEach(l => {
      l.venteTotal = arrondi2(l.venteUnitaire * l.qty);
      if (l.achatUnitaire == null) { sansPrix++; return; }
      l.achatTotal = arrondi2(l.achatUnitaire * l.qty);
      achat += l.achatTotal;
      vente += l.venteTotal;
      if (l.achatMaxUnitaire != null) achatMax += arrondi2(l.achatMaxUnitaire * l.qty);
      if (l.aPerte) nbAPerte++;
    });
    totalAchat += achat; totalVente += vente; nbSansPrix += sansPrix; totalAchatMax += achatMax;
    groupes.push({ fournisseur: nom || null, lignes: lignesGroupe, achat: arrondi2(achat), vente: arrondi2(vente), achatMax: opts ? arrondi2(achatMax) : null, sansPrix });
  });
  groupes.sort((a, b) => {
    if (a.fournisseur === null) return 1;
    if (b.fournisseur === null) return -1;
    return a.fournisseur.localeCompare(b.fournisseur, "fr");
  });
  totalAchat = arrondi2(totalAchat); totalVente = arrondi2(totalVente);
  return {
    groupes, totalAchat, totalVente, totalAchatMax: opts ? arrondi2(totalAchatMax) : null, nbAPerte, ecart: arrondi2(totalVente - totalAchat),
    economiePct: totalVente > 0 ? Math.round(((totalVente - totalAchat) / totalVente) * 1000) / 10 : null,
    nbSansPrix, nbKitsIgnores,
  };
}
