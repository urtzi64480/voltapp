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
    // Un double va-et-vient rangé dans un AUTRE circuit parce qu'il y commande des lampes (son autre voie) reste valable : pour ce circuit-ci,
    // c'est une commande d'un autre circuit (source externe), pas un oubli.
    const sertAutreCircuit = (c: AppareillagePlace) => c.circuitManuelId != null && appareils.some(l => estLumiere(l.type) && l.circuitManuelId === c.circuitManuelId && !membreIds.has(l.id) && commandeCetteLumiere(c, l.id));
    const absentes = filaires.filter(c => !membreIds.has(c.id) && c.circuitManuelId != null && !sertAutreCircuit(c));
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
    // Par VOIE : un double va-et-vient peut alimenter deux circuits (une voie chacun). Seules les voies qui touchent une lampe de CE circuit
    // comptent ; les lampes de l'autre voie restent sur leur circuit.
    const voies = [cmd.commandePourIds ?? [], cmd.commandePourIds2 ?? []].map(v => v.map(id => parId.get(id)).filter((l): l is AppareillagePlace => !!l && estLumiere(l.type)));
    const concernees = voies.filter(v => v.some(l => membreIds.has(l.id)));
    const cibles = (concernees.length > 0 ? concernees : voies).flat();
    if (concernees.length === 0 && voies.every(v => v.length === 0)) {
      bloquants.push({ code: "commande_sans_lampe", appareilIds: [cmd.id], ajouter: [],
        message: `${nomDe(cmd)} : ne commande aucun point lumineux, donc aucun retour. Relie-la à sa lampe ou retire-la du circuit.` });
      return;
    }
    if (concernees.length === 0) return;   // aucune de ses voies ne touche ce circuit : commande d'un autre circuit, rien à exiger ici
    const absentes = cibles.filter(l => !membreIds.has(l.id));
    if (absentes.length > 0) {
      bloquants.push({ code: "lampe_commandee_hors_circuit", appareilIds: [cmd.id, ...absentes.map(l => l.id)], ajouter: absentes.map(l => l.id),
        message: `${nomDe(cmd)} : commande ${absentes.map(nomDe).join(", ")} qui ${absentes.length > 1 ? "ne sont pas" : "n'est pas"} dans le circuit : son retour ne serait pas tracé.` });
    }
  });

  const aAjouter = Array.from(new Set(bloquants.flatMap(p => p.ajouter)));
  return { bloquants, aAjouter };
}

/**
 * Circuit d'éclairage « par les lampes » : à partir des points lumineux choisis, retrouve TOUT ce qui doit être sur le circuit pour que le câblage
 * soit complet — les commandes (interrupteurs, va-et-vient, télérupteurs…) qui les pilotent, puis les autres lampes que ces commandes pilotent
 * (un va-et-vient double commande deux lampes), jusqu'à ce que plus rien ne manque. Les commandes domotiques (sans fil) sont incluses pour mémoire
 * mais n'ajoutent pas de lampe.
 */
export function fermetureCircuitLumiere(appareils: AppareillagePlace[], lampeIds: Iterable<number>): { lampes: number[]; commandes: number[] } {
  const parId = new Map(appareils.map(a => [a.id, a]));
  const lampes = new Set<number>(Array.from(lampeIds).filter(id => { const a = parId.get(id); return !!a && estLumiere(a.type); }));
  const commandes = new Set<number>();
  const toutesCommandes = appareils.filter(a => estCommande(a.type));
  // PAR VOIE : une commande qui pilote une lampe choisie rejoint le circuit, ainsi que les lampes de CETTE voie seulement (elles sont câblées
  // sur le même retour). L'autre voie d'un double va-et-vient peut alimenter un autre circuit : ses lampes ne sont JAMAIS ajoutées.
  for (let change = true; change;) {
    change = false;
    toutesCommandes.forEach(c => {
      [c.commandePourIds ?? [], c.commandePourIds2 ?? []].forEach(voie => {
        const cibles = voie.filter(id => { const l = parId.get(id); return !!l && estLumiere(l.type); });
        if (!cibles.some(id => lampes.has(id))) return;
        if (!commandes.has(c.id)) { commandes.add(c.id); change = true; }
        cibles.forEach(id => { if (!lampes.has(id)) { lampes.add(id); change = true; } });
      });
    });
  }
  return { lampes: Array.from(lampes), commandes: Array.from(commandes) };
}

/** Commandes trouvées par fermetureCircuitLumiere qui servent DÉJÀ un autre circuit manuel (une voie y alimente des lampes) : elles y restent. */
export function commandesPartagees(appareils: AppareillagePlace[], commandeIds: number[], lampeIds: Set<number>): Map<number, number> {
  const res = new Map<number, number>();
  commandeIds.forEach(id => {
    const c = appareils.find(a => a.id === id);
    if (!c || c.circuitManuelId == null) return;
    if (appareils.some(l => estLumiere(l.type) && l.circuitManuelId === c.circuitManuelId && !lampeIds.has(l.id) && commandeCetteLumiere(c, l.id))) res.set(id, c.circuitManuelId);
  });
  return res;
}
