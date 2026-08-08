export interface CourseItem {
  key: string;
  nom: string;
  qty: number;
  unite?: string;
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
        if (map.has(key)) {
          map.get(key)!.qty += qty;
        } else {
          map.set(key, { key, nom, qty });
        }
      }
    } else if (l.type_branche === "materiau") {
      const key = l.nom.toLowerCase();
      const qty = l.quantite || 1;
      if (map.has(key)) {
        map.get(key)!.qty += qty;
      } else {
        map.set(key, { key, nom: l.nom, qty, unite: l.unite });
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.nom.localeCompare(b.nom));
}
