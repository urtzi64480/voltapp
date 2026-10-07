export interface CourseItem {
  key: string;
  nom: string;
  qty: number;
  unite?: string;
  image?: string;
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
      const key = l.nom.toLowerCase();
      const qty = l.quantite || 1;
      const image = l.image_url ? String(l.image_url) : undefined;
      if (map.has(key)) {
        const ex = map.get(key)!;
        ex.qty += qty;
        if (!ex.image && image) ex.image = image;
      } else {
        map.set(key, { key, nom: l.nom, qty, unite: l.unite, image });
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
}

// piecesParOffre : pièces à acheter par offre fournisseur (id d'offre -> pièces). Une ligne matériau dont
// l'offre retenue est en plusieurs pièces est remplacée, dans la liste d'achat, par ces pièces (quantité
// de la ligne × quantité de la pièce) : c'est ce qu'on achète réellement chez ce fournisseur.
function eclaterEnPieces(l: any, piecesParOffre?: Record<string, { nom: string; quantite: number }[]>): any[] {
  const pieces = l.fournisseur_id && piecesParOffre ? piecesParOffre[String(l.fournisseur_id)] : undefined;
  if (!pieces || pieces.length === 0 || l.type_branche !== "materiau" || l.kit_description) return [l];
  return pieces.map(pc => ({
    nom: `${pc.nom} — ${l.nom}`,
    quantite: (pc.quantite > 0 ? pc.quantite : 1) * (l.quantite || 1),
    type_branche: "materiau", unite: l.unite, fournisseur_nom: l.fournisseur_nom, fournisseur_id: l.fournisseur_id,
  }));
}

export function buildCourseItemsParFournisseur(lignes: any[], piecesParOffre?: Record<string, { nom: string; quantite: number }[]>): GroupeFournisseur[] {
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
    groupes.push({ fournisseur: nom || null, items, achat });
  });
  return groupes.sort((a, b) => {
    if (a.fournisseur === null) return 1;
    if (b.fournisseur === null) return -1;
    return a.fournisseur.localeCompare(b.fournisseur, "fr");
  });
}
