// ─────────────────────────────────────────────────────────────────
// FICHIER : components/devis/DevisRemiseLigne.tsx
// Ligne remise à afficher dans l'aperçu/PDF du devis
// ─────────────────────────────────────────────────────────────────

'use client'

import { RemiseState } from './RemiseServices'

interface Props {
  remise: RemiseState
  totalServicesHT: number
}

export function DevisRemiseLigne({ remise, totalServicesHT }: Props) {
  if (!remise.valeur || remise.valeur === 0) return null

  const montantRemise =
    remise.type === 'percent'
      ? (totalServicesHT * remise.valeur) / 100
      : Math.min(remise.valeur, totalServicesHT)

  const libelle =
    remise.type === 'percent'
      ? `Remise services (${remise.valeur}%)`
      : `Remise services`

  return (
    <tr className="text-amber-700">
      <td colSpan={3} className="py-1 pr-4 text-right text-sm italic">
        {libelle}
      </td>
      <td className="py-1 text-right text-sm font-medium">
        − {montantRemise.toFixed(2)} €
      </td>
    </tr>
  )
}
