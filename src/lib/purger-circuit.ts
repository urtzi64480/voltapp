// src/lib/purger-circuit.ts
//
// Un circuit effacé ne doit laisser AUCUNE trace : ni ses boîtes de dérivation classiques, ni son ordre de câblage, ni les coudes posés à la main
// sur ses liaisons. Sinon un circuit retracé à la main (même du même nom) hériterait de l'ancien modèle — y compris en gaines optimisées.
import type { Niveau } from "./maison-types";

export function purgerTracesCircuits(n: Niveau, labels: Iterable<string>, appareillageIds: Iterable<number>, tout = false): Niveau {
  // Les gaines en attente ne sont pas des circuits : leurs coudes (clé « tableau->attente-… ») survivent à la purge.
  const gardeAttentes = (m?: Record<string, unknown[]>) => m ? Object.fromEntries(Object.entries(m).filter(([cle]) => cle.startsWith("tableau->attente-"))) : undefined;
  if (tout) {
    const coudesAttente = gardeAttentes(n.liaisonWaypoints as Record<string, unknown[]> | undefined);
    return { ...n, boitesDerivation: undefined, ordresCircuits: undefined, liaisonWaypoints: coudesAttente && Object.keys(coudesAttente).length > 0 ? coudesAttente as Niveau["liaisonWaypoints"] : undefined };
  }
  const L = new Set(labels), A = new Set([...appareillageIds].map(String));
  const boites = n.boitesDerivation, ordres = n.ordresCircuits, coudes = n.liaisonWaypoints;
  const idsBoites = new Set<string>();
  const boitesNet = boites ? Object.fromEntries(Object.entries(boites).filter(([label, liste]) => {
    if (!L.has(label)) return true;
    liste.forEach(b => idsBoites.add(`boite-${b.id}`));
    return false;
  })) : undefined;
  const ordresNet = ordres ? Object.fromEntries(Object.entries(ordres).filter(([label]) => !L.has(label))) : undefined;
  const coudesNet = coudes ? Object.fromEntries(Object.entries(coudes).filter(([cle]) => {
    const [a, b] = cle.split("->");
    return !(A.has(a) || A.has(b) || idsBoites.has(a) || idsBoites.has(b));
  })) : undefined;
  return {
    ...n,
    ...(boites ? { boitesDerivation: boitesNet } : {}),
    ...(ordres ? { ordresCircuits: ordresNet } : {}),
    ...(coudes ? { liaisonWaypoints: coudesNet } : {}),
  };
}
