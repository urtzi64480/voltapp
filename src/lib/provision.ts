// src/lib/provision.ts
// « À mettre de côté » : part d'un encaissement qui part en cotisations sociales et en impôt (versement libératoire),
// d'après les taux du profil. Réutilise la répartition services / marchandises du livre des recettes (remise comprise).
import { arrondi2 } from "./utils";
import { repartir, type FactureExport } from "./export-comptable";
import type { TauxRentabilite } from "./rentabilite";

export interface ResultatProvision { encaisse: number; cotisations: number; impots: number; provision: number; disponible: number }

export function provisionFactures(factures: Pick<FactureExport, "total_service" | "total_materiau" | "total_ttc">[], taux: TauxRentabilite): ResultatProvision {
  let encaisse = 0, cotisations = 0, impots = 0;
  factures.forEach(f => {
    const r = repartir(f);
    encaisse += r.total;
    cotisations += r.service * taux.cotisService / 100 + r.materiau * taux.cotisMateriau / 100;
    impots += r.service * taux.irService / 100 + r.materiau * taux.irMateriau / 100;
  });
  const c = arrondi2(cotisations), i = arrondi2(impots), e = arrondi2(encaisse);
  const provision = arrondi2(c + i);
  return { encaisse: e, cotisations: c, impots: i, provision, disponible: arrondi2(e - provision) };
}
