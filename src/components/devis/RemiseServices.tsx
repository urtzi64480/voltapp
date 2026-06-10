// ─────────────────────────────────────────────────────────────────
// FICHIER : components/devis/RemiseServices.tsx
// Remise globale (€ ou %) appliquée uniquement sur le total services
// ─────────────────────────────────────────────────────────────────

'use client'

import { useState } from 'react'

export type RemiseType = 'percent' | 'euro'

export interface RemiseState {
  type: RemiseType
  valeur: number
}

interface Props {
  totalServices: number          // total HT des lignes de type "service"
  remise: RemiseState
  onChange: (r: RemiseState) => void
}

export function RemiseServices({ totalServices, remise, onChange }: Props) {
  const montantRemise =
    remise.type === 'percent'
      ? (totalServices * remise.valeur) / 100
      : Math.min(remise.valeur, totalServices)

  const totalApresRemise = totalServices - montantRemise

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-amber-50 space-y-3">
      <p className="text-sm font-medium text-gray-700">Remise sur services</p>

      {/* Sélecteur type + valeur */}
      <div className="flex items-center gap-2">
        <select
          value={remise.type}
          onChange={(e) =>
            onChange({ ...remise, type: e.target.value as RemiseType, valeur: 0 })
          }
          className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
        >
          <option value="percent">%</option>
          <option value="euro">€</option>
        </select>

        <input
          type="number"
          min={0}
          max={remise.type === 'percent' ? 100 : totalServices}
          step={remise.type === 'percent' ? 0.5 : 1}
          value={remise.valeur === 0 ? '' : remise.valeur}
          onChange={(e) =>
            onChange({ ...remise, valeur: parseFloat(e.target.value) || 0 })
          }
          placeholder={remise.type === 'percent' ? 'ex: 10' : 'ex: 50'}
          className="w-28 border border-gray-300 rounded px-2 py-1 text-sm"
        />

        {remise.valeur > 0 && (
          <span className="text-sm text-amber-700 font-medium">
            − {montantRemise.toFixed(2)} €
          </span>
        )}
      </div>

      {/* Résumé */}
      {remise.valeur > 0 && (
        <div className="text-xs text-gray-500 space-y-0.5">
          <div className="flex justify-between">
            <span>Total services HT</span>
            <span>{totalServices.toFixed(2)} €</span>
          </div>
          <div className="flex justify-between text-amber-700">
            <span>
              Remise ({remise.type === 'percent' ? `${remise.valeur}%` : `${remise.valeur} €`})
            </span>
            <span>− {montantRemise.toFixed(2)} €</span>
          </div>
          <div className="flex justify-between font-medium text-gray-700 border-t pt-1">
            <span>Services après remise</span>
            <span>{totalApresRemise.toFixed(2)} €</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// UTILITAIRE : calcul du total devis avec remise
// À utiliser dans ton composant parent de devis
// ─────────────────────────────────────────────────────────────────

export function calculerTotauxDevis(
  lignes: { type: 'service' | 'materiel'; prixHT: number; quantite: number }[],
  remise: RemiseState,
  tauxTVA: number = 0.2
) {
  const totalMateriel = lignes
    .filter((l) => l.type === 'materiel')
    .reduce((sum, l) => sum + l.prixHT * l.quantite, 0)

  const totalServicesAvantRemise = lignes
    .filter((l) => l.type === 'service')
    .reduce((sum, l) => sum + l.prixHT * l.quantite, 0)

  const montantRemise =
    remise.type === 'percent'
      ? (totalServicesAvantRemise * remise.valeur) / 100
      : Math.min(remise.valeur, totalServicesAvantRemise)

  const totalServicesApresRemise = totalServicesAvantRemise - montantRemise

  const totalHT = totalMateriel + totalServicesApresRemise
  const totalTVA = totalHT * tauxTVA
  const totalTTC = totalHT + totalTVA

  return {
    totalMateriel,
    totalServicesAvantRemise,
    montantRemise,
    totalServicesApresRemise,
    totalHT,
    totalTVA,
    totalTTC,
  }
}
