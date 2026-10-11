// src/lib/controle-eclairage.ts
//
// CONTRÔLE BLOQUANT d'un circuit d'ÉCLAIRAGE saisi à la main : chaque lampe doit avoir sa commande (c'est elle qui crée le RETOUR),
// chaque commande doit commander au moins une lampe du circuit, et une lampe commandée par UN SEUL va-et-vient est incomplète
// (il manque l'autre va-et-vient, donc la NAVETTE). Un circuit automatique est déjà câblé d'après les liens commande ↔ lampe ;
// seul le circuit manuel peut laisser des commandes de côté, d'où ce contrôle.
//
// Une commande qui n'appartient à aucun circuit manuel est rattachée automatiquement au circuit de sa lampe (voir maison-engine,
// rattacherRetoursLampe) : elle n'est donc exigée dans le circuit que si elle est rangée dans un autre circuit manuel.
//
// Module pur (ne dépend que des types du plan). Les commandes domotiques (sans fil) n'ont ni retour ni navette : elles comptent comme
// commande mais ne sont jamais exigées dans le circuit.
import { AppareillagePlace, baseCommande, commandeCetteLumiere, estCommande, estLumiere, lumieresCommandees } from "@/lib/maison-types";

export type CodeEclairage = "retour_manquant" | "commande_hors_circuit" | "commande_sans_lampe" | "lampe_commandee_hors_circuit" | "navette_manquante";

export interface ProblemeEclairage {
  code: CodeEclairage;
  message: string;
  appareilIds: number[];
  /** Appareillages à ajouter au circuit pour corriger (vide = à corriger sur le plan). */
  ajouter: number[];
}

export interface BilanEclairage { bloquants: ProblemeEclairage[]; aAjouter: number[] }

/** Vérifie un ensemble de membres (ids) d'un circuit d'éclairage manuel parmi les appareillages du niveau. */
export function verifierEclairageManuel(
  appareils: AppareillagePlace[], membreIds: Set<number>, nomDe: (a: AppareillagePlace) => string,
): BilanEclairage {
  const parId = new Map(appareils.map(a => [a.id, a]));
  const bloquants: ProblemeEclairage[] = [];
  const commandes = appareils.filter(a => estCommande(a.type));

  appareils.filter(a => membreIds.has(a.id) && estLumiere(a.type) && !a.dejaExistant).forEach(lampe => {
    const cmds = commandes.filter(c => commandeCetteLumiere(c, lampe.id));
    if (cmds.length === 0) {
      bloquants.push({ code: "retour_manquant", appareilIds: [lampe.id], ajouter: [],
        message: `${nomDe(lampe)} : aucune commande reliée, donc aucun retour. Place un interrupteur / va-et-vient et relie-le à cette lampe.` });
      return;
    }
    const filaires = cmds.filter(c => !c.domotique);
    // Une commande SANS circuit manuel est rattachée d'office au circuit de sa lampe à la génération (rattacherRetoursLampe) ; seule une
    // commande rangée dans UN AUTRE circuit manuel reste à l'écart — c'est elle qui fait disparaître le retour et les navettes du tracé.
    const absentes = filaires.filter(c => !membreIds.has(c.id) && c.circuitManuelId != null);
    if (absentes.length > 0) {
      bloquants.push({ code: "commande_hors_circuit", appareilIds: [lampe.id, ...absentes.map(c => c.id)], ajouter: absentes.map(c => c.id),
        message: `${nomDe(lampe)} : ${absentes.map(nomDe).join(", ")} ${absentes.length > 1 ? "la commandent" : "la commande"} mais ${absentes.length > 1 ? "ne sont pas" : "n'est pas"} dans le circuit : le retour${absentes.length > 1 ? " et les navettes ne seraient pas tracés" : " ne serait pas tracé"}.` });
    }
    const nbVaEtVient = filaires.filter(c => baseCommande(c.type) === "va_et_vient").length;
    if (nbVaEtVient === 1) {
      bloquants.push({ code: "navette_manquante", appareilIds: [lampe.id, ...filaires.map(c => c.id)], ajouter: [],
        message: `${nomDe(lampe)} : un seul va-et-vient, donc pas de navette. Ajoute le second va-et-vient (navette entre les deux), ou remplace-le par un interrupteur simple.` });
    }
  });

  appareils.filter(a => membreIds.has(a.id) && estCommande(a.type) && !a.domotique).forEach(cmd => {
    const cibles = lumieresCommandees(cmd).map(id => parId.get(id)).filter((l): l is AppareillagePlace => !!l && estLumiere(l.type));
    if (cibles.length === 0) {
      bloquants.push({ code: "commande_sans_lampe", appareilIds: [cmd.id], ajouter: [],
        message: `${nomDe(cmd)} : ne commande aucun point lumineux, donc aucun retour. Relie-la à sa lampe ou retire-la du circuit.` });
      return;
    }
    const absentes = cibles.filter(l => !membreIds.has(l.id));
    if (absentes.length > 0) {
      bloquants.push({ code: "lampe_commandee_hors_circuit", appareilIds: [cmd.id, ...absentes.map(l => l.id)], ajouter: absentes.map(l => l.id),
        message: `${nomDe(cmd)} : commande ${absentes.map(nomDe).join(", ")} qui ${absentes.length > 1 ? "ne sont pas" : "n'est pas"} dans le circuit : son retour ne serait pas tracé.` });
    }
  });

  const aAjouter = Array.from(new Set(bloquants.flatMap(p => p.ajouter)));
  return { bloquants, aAjouter };
}
