// src/lib/fusion-circuits.ts
//
// FUSION DE DEUX CIRCUITS du plan en un seul (« fusionner les circuits »).
//
// Un circuit automatique n'a pas d'existence propre : il est recalculé à chaque génération. Pour que la fusion tienne, le circuit résultant
// est donc un circuit MANUEL (Niveau.circuitsManuels) auquel on rattache tous les points des deux circuits (AppareillagePlace.circuitManuelId).
// Les données indexées par le LABEL du circuit (boîtes de dérivation, ordre de câblage, couleur, nom, verrou, photos de chantier, liaisons
// directes entre lampes) sont reportées sur le label du circuit résultant. Fonctions pures : aucune dépendance à React.
import { Breaker, CIRCUITS, estCircuitSansDisjoncteur } from "./electrical-constants";
import { AppareillagePlace, BoiteDerivation, CircuitManuel, Niveau, estCommande } from "./maison-types";
import { messageDepassement } from "./maison-engine";

export type VerdictFusion =
  | { ok: true; famille: string; nom: string; avertissements: string[] }
  | { ok: false; raison: string };

// Familles dont deux circuits peuvent être réunis (dans la limite des maxima de la NF C 15-100 : voir messageDepassement).
// Le chauffage (regroupé par puissance, label porteur de la puissance) et les circuits spécialisés (un appareil par circuit) sont exclus.
const FAMILLES_FUSIONNABLES = new Set(["lumiere", "prise_16", "prise_20", "exterieur", "garage", "volets_roulants"]);

/** Prises 16 A / 1,5 mm² : mêmes règles (8 socles max). Un circuit « extérieur » ou « garage » est une prise 16 A classée par pièce — le type de
 *  pose (saillie…) n'y change rien — donc il peut se fusionner avec un circuit de prises 16 A. Le circuit conservé garde sa famille. */
const GROUPE_16A = new Set(["prise_16", "exterieur", "garage"]);

/** Famille du circuit fusionné, ou null si les deux familles ne peuvent pas se réunir. 16 A + 20 A (prises) → 20 A / 2,5 mm². */
export function familleFusionnee(a: string, b: string): string | null {
  if (a === b) return FAMILLES_FUSIONNABLES.has(a) ? a : null;
  if (GROUPE_16A.has(a) && GROUPE_16A.has(b)) return a;
  const paire = new Set([a, b]);
  if (paire.has("prise_20") && (GROUPE_16A.has(a) || GROUPE_16A.has(b))) return "prise_20";
  return null;
}

/**
 * Peut-on fusionner `absorbe` dans `garde` ? `appareils` = tous les appareillages du niveau (le circuit d'un point est lu dans circuitId).
 * `labelsExistants` : labels de tous les circuits du niveau (pour choisir un nom libre quand le circuit conservé est automatique).
 */
export function verifierFusion(
  garde: Breaker, absorbe: Breaker, appareils: AppareillagePlace[], nomGarde: string,
  labelsExistants: string[], verrouilles: string[] = [],
): VerdictFusion {
  if (garde.id === absorbe.id) return { ok: false, raison: "Choisis deux circuits différents." };
  if (estCircuitSansDisjoncteur(garde) || estCircuitSansDisjoncteur(absorbe))
    return { ok: false, raison: "Les circuits de courant faible (RJ45 / TV) n'ont pas de disjoncteur : rien à fusionner." };
  if (garde.niveauId != null && absorbe.niveauId != null && garde.niveauId !== absorbe.niveauId)
    return { ok: false, raison: "Les deux circuits ne sont pas sur le même niveau." };
  if (verrouilles.includes(garde.label) || verrouilles.includes(absorbe.label))
    return { ok: false, raison: "Un des deux circuits est verrouillé — déverrouille-le d'abord." };
  const ailleurs = (b: Breaker) => Object.keys(b.lampesAilleurs ?? {}).length > 0 || (b.commandesAilleurs ?? []).length > 0;
  if (ailleurs(garde) || ailleurs(absorbe))
    return { ok: false, raison: "Un des circuits d'éclairage est réparti sur plusieurs étages (va-et-vient entre niveaux) : fusion non prise en charge." };
  const famille = familleFusionnee(garde.circuit, absorbe.circuit);
  if (!famille) {
    const lib = (c: string) => CIRCUITS[c]?.label ?? c;
    const spe = CIRCUITS[garde.circuit]?.dedié || CIRCUITS[absorbe.circuit]?.dedié;
    return { ok: false, raison: spe
      ? "Un circuit spécialisé (four, lave-linge, plaque…) alimente un seul appareil : il ne se fusionne pas (NF C 15-100)."
      : garde.circuit === absorbe.circuit
        ? `Les circuits « ${lib(garde.circuit)} » ne se fusionnent pas (regroupés par puissance ou famille non groupable).`
        : `Familles incompatibles : ${lib(garde.circuit)} et ${lib(absorbe.circuit)}.` };
  }
  const membres = appareils.filter(a => a.circuitId === garde.id || a.circuitId === absorbe.id);
  if (membres.length === 0) return { ok: false, raison: "Aucun point sur ces circuits." };
  const depassement = messageDepassement(famille, membres, `« ${nomGarde} » + « ${absorbe.label} » : `);
  if (depassement) return { ok: false, raison: depassement };

  // Nom du circuit résultant : celui du circuit conservé, libre de toute collision (un circuit automatique devient manuel sous ce nom).
  const nom = garde.manuelId != null ? garde.label : nomLibre(nomGarde, labelsExistants.filter(l => l !== garde.label && l !== absorbe.label));
  const avertissements: string[] = [];
  if (famille !== garde.circuit) avertissements.push(`Le circuit passe en ${CIRCUITS[famille]?.label ?? famille} (${CIRCUITS[famille]?.ampMax} A, ${CIRCUITS[famille]?.section} mm²).`);
  const spec = CIRCUITS[famille];
  if (spec && (absorbe.amperes > spec.ampMax || Number(absorbe.customSection ?? spec.section) > Number(spec.section)))
    avertissements.push(`« ${absorbe.label} » avait un calibre / une section plus fort(e) que le défaut : vérifie ${spec.ampMax} A / ${spec.section} mm² dans le tableau.`);
  return { ok: true, famille, nom, avertissements };
}

function nomLibre(nom: string, pris: string[]): string {
  if (!pris.includes(nom)) return nom;
  let i = 2;
  while (pris.includes(`${nom} (${i})`)) i++;
  return `${nom} (${i})`;
}

export interface FusionAppliquee { niveau: Niveau; manuelId: number; label: string }

/**
 * Applique la fusion (après verifierFusion) : retourne le niveau modifié. `garde` est le circuit dont on conserve le nom, la couleur, les
 * boîtes ; `absorbe` disparaît. L'ordre de câblage manuel (ordresCircuits) des deux circuits est effacé — il n'a plus de sens — et le
 * tracé est recalculé (plus proche voisin) ; les boîtes des deux circuits sont réunies sur le circuit résultant.
 */
export function fusionnerCircuits(
  niveau: Niveau, garde: Breaker, absorbe: Breaker, verdict: Extract<VerdictFusion, { ok: true }>, nouvelId: () => number,
): FusionAppliquee {
  const { famille, nom } = verdict;
  const manuelId = garde.manuelId ?? nouvelId();
  const labelsSources = [garde.label, absorbe.label];
  const apparts = niveau.pieces.flatMap(p => p.appareillages);
  const idsSources = new Set([garde.id, absorbe.id]);
  const manuelsSources = new Set([garde.manuelId, absorbe.manuelId].filter((x): x is number => x != null));

  // Membres du circuit fusionné : tout point des deux circuits, sauf les commandes d'éclairage sans circuit manuel propre (elles suivent
  // la lampe qu'elles commandent, comme pour tout circuit d'éclairage — voir rattacherRetoursLampe).
  const estMembre = (a: AppareillagePlace) =>
    (a.circuitId != null && idsSources.has(a.circuitId) && !(estCommande(a.type) && a.circuitManuelId == null))
    || (a.circuitManuelId != null && manuelsSources.has(a.circuitManuelId));

  const ancienManuel = garde.manuelId != null ? (niveau.circuitsManuels ?? []).find(m => m.id === garde.manuelId) : undefined;
  const absorbeManuel = absorbe.manuelId != null ? (niveau.circuitsManuels ?? []).find(m => m.id === absorbe.manuelId) : undefined;
  const couleur = niveau.couleursCircuits?.[garde.label] ?? ancienManuel?.couleur ?? niveau.couleursCircuits?.[absorbe.label] ?? absorbeManuel?.couleur;
  const manuelResultat: CircuitManuel = {
    id: manuelId, nom, famille, ...(couleur ? { couleur } : {}),
    ...(ancienManuel?.nonRelieTableau ? { nonRelieTableau: true } : {}),
  };

  const boites: BoiteDerivation[] = [...(niveau.boitesDerivation?.[garde.label] ?? []), ...(niveau.boitesDerivation?.[absorbe.label] ?? [])];
  const boitesDerivation = { ...(niveau.boitesDerivation ?? {}) };
  labelsSources.forEach(l => { delete boitesDerivation[l]; });
  if (boites.length > 0) boitesDerivation[nom] = boites;

  const liaisons = [...(niveau.liaisonsDirectesLumiere?.[garde.label] ?? []), ...(niveau.liaisonsDirectesLumiere?.[absorbe.label] ?? [])];
  const liaisonsDirectesLumiere = { ...(niveau.liaisonsDirectesLumiere ?? {}) };
  labelsSources.forEach(l => { delete liaisonsDirectesLumiere[l]; });
  if (liaisons.length > 0) liaisonsDirectesLumiere[nom] = liaisons;

  const couleursCircuits = { ...(niveau.couleursCircuits ?? {}) };
  labelsSources.forEach(l => { delete couleursCircuits[l]; });
  if (couleur) couleursCircuits[nom] = couleur;

  const ordresCircuits = { ...(niveau.ordresCircuits ?? {}) };
  labelsSources.forEach(l => { delete ordresCircuits[l]; });
  delete ordresCircuits[nom];

  const nomsCircuits = { ...(niveau.nomsCircuits ?? {}) };
  labelsSources.forEach(l => { delete nomsCircuits[l]; });

  const res: Niveau = {
    ...niveau,
    circuitsManuels: [...(niveau.circuitsManuels ?? []).filter(m => !manuelsSources.has(m.id)), manuelResultat],
    boitesDerivation, liaisonsDirectesLumiere, couleursCircuits, ordresCircuits, nomsCircuits,
    circuitsVerrouilles: niveau.circuitsVerrouilles ? niveau.circuitsVerrouilles.filter(l => !labelsSources.includes(l)) : niveau.circuitsVerrouilles,
    photosChantier: niveau.photosChantier?.map(ph => (labelsSources.includes(ph.circuit) ? { ...ph, circuit: nom } : ph)),
    appareillagesExclus: (niveau.appareillagesExclus ?? []).filter(id => !apparts.some(a => a.id === id && estMembre(a))),
    pieces: niveau.pieces.map(p => ({
      ...p,
      appareillages: p.appareillages.map(a => estMembre(a) ? { ...a, circuitManuelId: manuelId }
        : (a.circuitManuelId != null && manuelsSources.has(a.circuitManuelId) ? { ...a, circuitManuelId: manuelId } : a)),
    })),
  };
  return { niveau: res, manuelId, label: nom };
}
