// src/lib/suivi-devis-normes.ts
//
// ÉTAPES DÉTAILLÉES NF C 15-100 POUR UN DEVIS SANS PLAN : une ligne du devis n'a ni pièce, ni circuit, ni hauteur. On reconnaît donc le type d'action
// d'après le NOM de la ligne (« Prise 2P+T », « Disjoncteur 20 A », « Câble 2,5 mm² »…) et on réutilise les mêmes étapes que le suivi d'un plan
// (suivi-normes.ts). Une valeur absente du nom n'est jamais inventée : le libellé reste sans chiffre. Une ligne non reconnue (main d'œuvre,
// déplacement, service, fourniture diverse) n'a pas d'étapes détaillées : elle garde sa case unique. Module PUR.
import { cleEtapeNorme, etapesNormatives, type DescripteurNorme, type EtapeNorme } from "@/lib/suivi-normes";

export interface LigneReconnaissable { nom: string; unite?: string | null; type_branche?: string | null }
export interface EtapeDetailDevis extends EtapeNorme { cle: string }

const norm = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/œ/g, "oe").replace(/\s+/g, " ").trim();
const nombre = (re: RegExp, t: string): number | null => { const m = t.match(re); if (!m) return null; const n = Number(m[1].replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : null; };

/** Type d'action déduit du nom de la ligne ; null = pas d'étapes détaillées. */
export function descripteurDepuisLigne(l: LigneReconnaissable): DescripteurNorme | null {
  if ((l.type_branche ?? "") === "service") return null; // la pose se suit sur la ligne de fourniture correspondante
  if (/^(h|heure|heures)$/i.test((l.unite ?? "").trim())) return null;
  const t = norm(l.nom);
  if (!t || /main d.?oeuvre|deplacement|forfait|remise|location|evacuation|nettoyage|mise en service|consuel/.test(t)) return null;

  const amperes = nombre(/(\d{1,3})\s*a\b/, t);
  const section = nombre(/(\d{1,2}(?:[.,]\d)?)\s*mm/, t);
  const sectionTxt = section != null ? String(section).replace(".", ",") : null;
  const exterieur = /exterieur|jardin|terrasse/.test(t);
  const sdb = /salle de bain|sdb|douche/.test(t);

  if (/^(cable|gaine|fil|tube|conduit)\b/.test(t) || /\b(icta|irl|goulotte|moulure)\b/.test(t)) {
    const communication = /\b(cat ?[5-7]|rj ?45|coax|reseau|ethernet)\b/.test(t);
    return {
      kind: "liaison", communication, cable: l.nom.trim(), gaine: /icta/.test(t) ? "ICTA" : /irl/.test(t) ? "IRL" : "adaptée",
      pose: /apparent|goulotte|moulure|irl/.test(t) ? "apparent" : "encastre", sectionMm2: sectionTxt, amperes,
    };
  }
  if (/disjoncteur|differentiel|\bid\b|parafoudre/.test(t)) {
    return { kind: "disjoncteur", amperes, sectionMm2: null, nom: l.nom.trim(), nbPoints: 0, eclairage: false };
  }
  if (/borne de recharge|wallbox|irve|recharge vehicule/.test(t)) return { kind: "prise", type: "prise_irve", hauteurCm: null, amperes, sectionMm2: sectionTxt, sdb: false };
  if (/rj ?45|prise (de )?(communication|reseau|informatique)/.test(t)) return { kind: "communication", type: "rj45", hauteurCm: null };
  if (/prise (tv|tele|antenne|satellite)|\bcoax/.test(t)) return { kind: "communication", type: "prise_tv", hauteurCm: null };
  if (/volet roulant|moteur de volet/.test(t) && !/interrupteur|commande|inter /.test(t)) return { kind: "volet_roulant" };
  if (/(interrupteur|commande|inter ).*volet|volet.*(interrupteur|commande)/.test(t)) return { kind: "commande_service", type: "inter_volet", hauteurCm: null };
  if (/(interrupteur|commande).*vmc|vmc.*(interrupteur|commande)/.test(t)) return { kind: "commande_service", type: "inter_vmc", hauteurCm: null };
  if (/interrupteur|poussoir|detecteur|variateur|va[- ]et[- ]vient|telerupteur|bouton/.test(t)) {
    return {
      kind: "commande", type: "interrupteur", hauteurCm: null, domotique: /connecte|domotique|zigbee|wifi|radio|sans fil/.test(t),
      double: /double|2 (voies|touches|boutons)/.test(t), detecteur: /detecteur/.test(t), interieur: !exterieur,
    };
  }
  if (/boite/.test(t) && !/dcl/.test(t)) return { kind: "boite", eclairage: /eclairage|luminaire|lumiere/.test(t) };
  if (/spot|luminaire|applique|plafonnier|\bdcl\b|suspension|lampe|reglette|point lumineux|eclairage|hublot|ruban led/.test(t)) {
    return { kind: "lampe", type: "lumiere", sdb, plafond: /plafond|plafonnier|spot|dcl|suspension|point lumineux/.test(t), hauteurCm: null, commandee: true };
  }
  if (/\bprise/.test(t)) {
    const type = exterieur ? "prise_exterieure" : /dediee|lave|four|plaque|sech|congel|cuisson/.test(t) ? "prise_dediee" : "prise";
    return { kind: "prise", type, hauteurCm: null, amperes, sectionMm2: sectionTxt, sdb };
  }
  if (/radiateur|convecteur|chauffage|seche[- ]serviette|plancher chauffant/.test(t)) return { kind: "chauffage", puissanceW: nombre(/(\d[\d ]{1,6})\s*w\b/, t) };
  return null;
}

/** Étapes détaillées d'une ligne de devis (clés `<clé de la ligne>|n:<slug>`), vide si la ligne n'est pas reconnue. */
export function etapesDetailDevis(l: LigneReconnaissable, cleLigne: string): EtapeDetailDevis[] {
  const d = descripteurDepuisLigne(l);
  if (!d) return [];
  return etapesNormatives(d).map(x => ({ ...x, cle: cleEtapeNorme(cleLigne, x.slug) }));
}
