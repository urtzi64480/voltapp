import { Ruler } from "lucide-react";
import { conditionnementLabel } from "@/lib/utils";

// Pastille « bobine 100 m » / « rouleau 50 m » : la longueur contenue dans l'unité vendue, à afficher partout
// où l'on choisit un produit (une quantité en « u » ne dit pas combien de mètres on achète).
export default function BadgeConditionnement({ longueur, sousCategorie }: { longueur?: number | null; sousCategorie?: string | null }) {
  const l = conditionnementLabel(longueur, sousCategorie);
  if (!l) return null;
  return (
    <span className="inline-flex items-center gap-1 badge text-xs shrink-0 bg-amber-100 text-amber-800 whitespace-nowrap" title="Longueur contenue dans une unité">
      <Ruler size={10} /> {l}
    </span>
  );
}
