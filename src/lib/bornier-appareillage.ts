// src/lib/bornier-appareillage.ts
//
// BRANCHEMENTS D'UN APPAREIL, BORNE PAR BORNE. À partir des câbles qui arrivent (amont) et repartent (aval) d'un appareil dans le
// schéma technique, détermine quel fil se raccorde sur quelle borne du mécanisme — et quels fils sont seulement reliés entre eux
// dans la boîte (neutre, terre, retour qui traverse…). La composition de chaque câble vient de conducteursSegment() : le schéma
// technique, le plan et ce bornier ne peuvent donc pas se contredire.
//
// Règles (câblage français, appareillage 2 fils de commande) :
//  · MARQUAGE = gamme Schneider Odace (les autres gammes sont voisines) : bornes « L » (commune), « 1 » et « 2 » — vérifié sur la doc Odace
//    pour le simple, le va-et-vient et le poussoir ; double et détecteur : repères à contrôler sur le mécanisme.
//  · FACE ARRIÈRE Odace simple / va-et-vient / poussoir (photo Schneider, réf. S9-204) : 3 bornes automatiques à 2 entrées (2 câbles par pôle) — « 1 » haut-gauche, « L » haut-droite, « 2 » bas-gauche ; bas-droite : 2 emplacements sans borne.
//  · interrupteur / bouton-poussoir : phase → L ; retour → 1 (sortie). Neutre et terre ne touchent jamais le mécanisme.
//  · va-et-vient : COM = phase (premier) ou retour (dernier) ; L1 / L2 = les deux navettes. Entre deux : permutateur (E1 E2 / S1 S2).
//  · plaque double : deux mécanismes indépendants (voie A / voie B), chacun avec sa lampe.
//  · détecteur : L = phase, N = neutre, S = sortie vers la lampe.
//  · lampe (DCL) : L = retour (ou phase si alimentée directement), N, PE.
import type { AppareillagePlace, SegmentCircuit } from "@/lib/maison-types";
import { baseCommande, estCommande, estCommandeDouble, estLumiere } from "@/lib/maison-types";
import { conducteursSegment, libelleLiaison, type RoleConducteur } from "@/lib/couleurs-fils";
import type { NoeudSchema } from "@/lib/schema-technique";

export interface Cond { role: RoleConducteur; libelle: string; voie?: 0 | 1; cable: string; couleur?: string; rayure?: string }
export interface CableVue { cle: string; cote: "amont" | "aval"; autre: string; description: string; conducteurs: Cond[] }
export interface Borne { id: string; libelle: string; aide?: string }
// modele « odace-inter » : mécanisme Odace simple / va-et-vient / poussoir (S9-204) — vue arrière dessinée d'après le produit (voir VueAppareilBranchement).
export interface Mecanisme { id: string; titre: string; bornes: Borne[]; modele?: "odace-inter" | "odace-perm" | "odace-prise" }
export interface Raccord { mecanisme: string; borne: string; conducteur: Cond }
export interface Epissure { titre: string; aide: string; conducteurs: Cond[] }
export interface VueAppareil {
  id: string; titre: string; sous?: string; genre: NoeudSchema["genre"];
  cables: CableVue[]; mecanismes: Mecanisme[]; raccords: Raccord[]; epissures: Epissure[]; notes: string[];
}

export interface EntreeBornier {
  id: string;
  segments: SegmentCircuit[];
  noeuds: Record<string, NoeudSchema>;
  appareil: (id: string) => AppareillagePlace | undefined;
  section: string;
  /** Voie (A=0 / B=1) de la commande qui alimente le circuit étranger représenté par un repère « ext-aval-… » (clé « aId->bId »). */
  voieExterne?: Record<string, 0 | 1>;
}

const LETTRES = ["A", "B"] as const;
const fmt = (s: string) => s.replace(".", ",");
const lampesVoie = (a: AppareillagePlace, v: 0 | 1) => (v === 0 ? a.commandePourIds : a.commandePourIds2) ?? [];
const toutesLampes = (a: AppareillagePlace) => [...(a.commandePourIds ?? []), ...(a.commandePourIds2 ?? [])];

export function construireVueAppareil(e: EntreeBornier): VueAppareil | null {
  const noeud = e.noeuds[e.id];
  if (!noeud || noeud.genre === "externe") return null;
  const app = e.appareil(e.id);
  const double = !!app && estCommandeDouble(app.type);
  const cle = (s: SegmentCircuit) => `${s.aId}->${s.bId}`;
  const nomNoeud = (id: string) => { const n = e.noeuds[id]; return n ? [n.titre, n.sous].filter(Boolean).join(" · ") : id; };

  // ── Câbles qui touchent l'appareil ───────────────────────────────────────────────────────────────
  const voieDuCable = (s: SegmentCircuit, cote: "amont" | "aval"): 0 | 1 | undefined => {
    if (!double || !app) return undefined;
    const autreId = cote === "amont" ? s.aId : s.bId;
    if (s.type === "retour") {
      const lampe = e.appareil(autreId);
      if (lampe) return lampesVoie(app, 0).includes(lampe.id) ? 0 : lampesVoie(app, 1).includes(lampe.id) ? 1 : undefined;
      return e.voieExterne?.[cle(s)];
    }
    const autre = e.appareil(autreId);
    if (autre) {
      const l = toutesLampes(autre);
      return lampesVoie(app, 0).some(x => l.includes(x)) ? 0 : lampesVoie(app, 1).some(x => l.includes(x)) ? 1 : undefined;
    }
    return 0;
  };
  const sansFil = e.segments.filter(s => (s.aId === e.id || s.bId === e.id) && s.type === "domotique");
  const cables: CableVue[] = e.segments.filter(s => (s.aId === e.id || s.bId === e.id) && s.type !== "domotique" && !s.aId.startsWith("ext-amont")).map(s => {
    const cote = s.bId === e.id ? "amont" : "aval";
    const k = cle(s);
    const v1 = voieDuCable(s, cote);
    const conducteurs: Cond[] = conducteursSegment(s).map(c => {
      const m = c.libelle.match(/voie ([AB])/);
      const voie = m ? (m[1] === "A" ? 0 : 1) : (c.role === "navette" || c.role === "retour") ? v1 : undefined;
      return { role: c.role, libelle: c.libelle, ...(voie !== undefined ? { voie: voie as 0 | 1 } : {}), cable: k, ...(c.couleur ? { couleur: c.couleur } : {}), ...(c.rayure ? { rayure: c.rayure } : {}) };
    });
    const sect = s.type || s.avecRetour ? "1.5" : e.section;
    const descr = s.communication ? libelleLiaison(s) : `${conducteurs.length}G${fmt(sect)} · ${libelleLiaison(s)}`;
    return { cle: k, cote, autre: nomNoeud(cote === "amont" ? s.aId : s.bId), description: descr, conducteurs };
  });
  // Câbles qui arrivent de l'AMONT d'abord.
  cables.sort((a, b) => (a.cote === b.cote ? 0 : a.cote === "amont" ? -1 : 1));
  const tous = cables.flatMap(c => c.conducteurs);
  const role = (r: RoleConducteur, f: (c: Cond) => boolean = () => true) => tous.filter(c => c.role === r && f(c));
  const ofVoie = (v: 0 | 1 | undefined) => (c: Cond) => c.voie === undefined || v === undefined || c.voie === v;
  const raccords: Raccord[] = [];
  const epissures: Epissure[] = [];
  const notes: string[] = [];
  const mecanismes: Mecanisme[] = [];
  const lier = (mecanisme: string, borne: string, cs: Cond[]) => cs.forEach(c => raccords.push({ mecanisme, borne, conducteur: c }));
  const episser = (titre: string, aide: string, cs: Cond[]) => { if (cs.length > 0) epissures.push({ titre, aide, conducteurs: cs }); };
  const TERRE_NEUTRE_BOITE = "Reliés entre eux dans la boîte d'encastrement (borne à levier Wago 221) — ne se raccordent jamais au mécanisme.";

  const vue = (genre: NoeudSchema["genre"]): VueAppareil => ({ id: e.id, titre: noeud.titre, sous: noeud.sous, genre, cables, mecanismes, raccords, epissures, notes });

  // ── Tableau ──────────────────────────────────────────────────────────────────────────────────────
  if (noeud.genre === "tableau" && e.segments.some(s => s.communication)) {
    const coax = e.segments.some(s => s.communication === "coax");
    mecanismes.push({ id: "t", titre: coax ? "Distribution antenne TV" : "Coffret de communication", bornes: coax
      ? [{ id: "ant", libelle: "Sortie", aide: "répartiteur / amplificateur TV" }]
      : [{ id: "port", libelle: "Port RJ45", aide: "un port du panneau de brassage par prise" }] });
    notes.push(coax
      ? "Câble coaxial 75 Ω tiré jusqu'au répartiteur TV du coffret de communication (fiche F). Aucun disjoncteur, aucun fil de puissance."
      : "Le câble RJ45 arrive sur UN port du panneau de brassage du coffret de communication (un port par prise), 8 fils dans l'ordre T568B. Même ordre à l'autre bout, sur la prise. Aucun disjoncteur, aucun fil de puissance.");
    return vue("tableau");
  }
  if (noeud.genre === "tableau") {
    mecanismes.push({ id: "t", titre: "Départ du circuit", bornes: [
      { id: "DJ", libelle: "Disjoncteur", aide: "sortie phase" }, { id: "N", libelle: "Barrette neutre" }, { id: "PE", libelle: "Barrette de terre" }] });
    lier("t", "DJ", role("phase")); lier("t", "N", role("neutre")); lier("t", "PE", role("terre"));
    notes.push("Phase sur la borne de sortie du disjoncteur du circuit (après le différentiel), neutre sur la barrette neutre, terre sur la barrette de terre — un fil par borne, serrage au couple.");
    return vue("tableau");
  }
  // ── Boîte de dérivation ──────────────────────────────────────────────────────────────────────────
  if (noeud.genre === "boite") {
    episser("Phase", "Tous les fils de phase reliés ensemble (Wago 221).", role("phase"));
    episser("Neutre", "Tous les neutres reliés ensemble (Wago 221).", role("neutre"));
    episser("Terre", "Toutes les terres reliées ensemble (Wago 221).", role("terre"));
    notes.push("Aucun mécanisme : uniquement des bornes à levier Wago 221 (une pour la phase, une pour le neutre, une pour la terre). Chaque départ vers une lampe ou une commande reprend phase + neutre + terre.");
    return vue("boite");
  }
  if (!app) {
    episser("Fils", "Raccordements de ce point.", tous);
    return vue(noeud.genre);
  }

  // ── Lampe (boîte DCL) ────────────────────────────────────────────────────────────────────────────
  if (estLumiere(app.type)) {
    mecanismes.push({ id: "l", titre: "Luminaire (boîte DCL)", bornes: [{ id: "L", libelle: "L", aide: "phase du luminaire" }, { id: "N", libelle: "N" }, { id: "PE", libelle: "PE" }] });
    const retours = role("retour");
    // Le luminaire reçoit le RETOUR (phase commutée) s'il est commandé, sinon la phase du circuit.
    if (retours.length > 0) {
      lier("l", "L", retours);
      const phases = role("phase");
      if (phases.length > 0) episser("Phase permanente (traverse)", "Phase d'alimentation qui repart vers la commande : reliée aux autres phases, PAS sur le luminaire.", phases);
      notes.push("Le luminaire est commandé : sa borne L reçoit le fil de RETOUR (violet), jamais la phase permanente.");
    } else lier("l", "L", role("phase"));
    lier("l", "N", role("neutre")); lier("l", "PE", role("terre"));
    if (role("neutre").length > 1) notes.push("Le neutre continue vers d'autres appareils : relier les neutres entre eux dans la Wago avec celui du luminaire.");
    if (sansFil.length > 0) notes.push("Une commande domotique (sans fil) agit sur ce luminaire : aucun fil de retour ni de navette.");
    return vue("lampe");
  }

  if (!estCommande(app.type)) {
    const t = app.type;
    // Prise RJ45 : 8 fils d'un câble cat.6 sur le connecteur, ordre T568B (norme TIA/EIA-568-B) — repères exacts sur le connecteur (voir sa notice).
    if (t === "rj45") {
      const fils = ["blanc-orange", "orange", "blanc-vert", "bleu", "blanc-bleu", "vert", "blanc-marron", "marron"];
      mecanismes.push({ id: "r", titre: "Prise RJ45 (T568B)", bornes: fils.map((c, i) => ({ id: `p${i + 1}`, libelle: String(i + 1), aide: c })) });
      role("rj45").forEach((c, i) => { if (i < fils.length) lier("r", `p${i + 1}`, [c]); });
      notes.push("Câble de communication (pas de phase / neutre / terre) : les 8 fils vont sur les 8 contacts du connecteur dans l'ordre T568B ci-contre. Même ordre aux DEUX extrémités du câble.");
      return vue("autre");
    }
    // Prise TV : câble coaxial, pas de fils de puissance.
    if (t === "prise_tv") {
      mecanismes.push({ id: "tv", titre: "Prise TV (coaxial)", bornes: [{ id: "ame", libelle: "Âme", aide: "fil central" }, { id: "tresse", libelle: "Tresse", aide: "blindage, sous le collier" }] });
      lier("tv", "ame", role("coax")); lier("tv", "tresse", role("coax"));
      notes.push("Coaxial : l'âme centrale sur la borne centrale, la tresse (blindage) serrée sous le collier de masse — ne jamais les mettre en contact.");
      return vue("autre");
    }
    // Moteur de volet roulant : alimenté PAR l'interrupteur de volet (3 positions ou poussoir double : 3 bornes sans vis, d'après les fiches Odace S520207 / S520208).
    if (t === "volet_roulant") {
      mecanismes.push({ id: "v", titre: "Moteur de volet roulant", bornes: [{ id: "L", libelle: "Montée / descente", aide: "phases venant de l'interrupteur de volet" }, { id: "N", libelle: "N" }, { id: "PE", libelle: "PE" }] });
      lier("v", "L", role("phase")); lier("v", "N", role("neutre")); lier("v", "PE", role("terre"));
      notes.push("Le moteur a deux phases (montée et descente) qui passent par l'interrupteur de volet roulant (commun + montée + descente) ; neutre et terre vont directement au moteur. Repères des fils : voir la notice du moteur.");
      return vue("autre");
    }
    // Interrupteur de volet roulant (montée / descente) et interrupteur de puissance VMC : mécanisme à 3 bornes, la phase arrive sur le commun,
    // les deux sorties (montée / descente, ou petite / grande vitesse) repartent vers le moteur dans le câble 4 conducteurs.
    if (t === "inter_volet" || t === "inter_vmc") {
      const volet = t === "inter_volet";
      mecanismes.push({ id: "s", titre: volet ? "Interrupteur de volet roulant" : "Interrupteur VMC (vitesses)", bornes: [
        { id: "COM", libelle: "Commun", aide: "phase d'arrivée" },
        { id: "S1", libelle: volet ? "Montée" : "Petite vitesse", aide: volet ? "vers le moteur (phase montée)" : "vers la VMC" },
        { id: "S2", libelle: volet ? "Descente" : "Grande vitesse", aide: volet ? "vers le moteur (phase descente)" : "vers la VMC" },
      ] });
      const phases = role("phase"), retours = role("retour");
      lier("s", "COM", phases.slice(0, 1));
      lier("s", "S1", phases.slice(1)); lier("s", "S2", retours);
      episser("Neutre", TERRE_NEUTRE_BOITE, role("neutre"));
      episser("Terre", TERRE_NEUTRE_BOITE, role("terre"));
      notes.push(volet
        ? "Un seul sens à la fois : ne jamais alimenter montée et descente ensemble. Phase d'arrivée sur le commun, fils montée et descente vers le moteur du volet ; neutre et terre passent directement jusqu'au moteur. Repères exacts sur le mécanisme (voir sa notice)."
        : "Interrupteur à deux vitesses : phase d'arrivée sur le commun, petite et grande vitesse vers la VMC ; neutre et terre passent directement. Repères exacts sur le mécanisme et la notice de la VMC.");
      return vue("autre");
    }
    // Prise renforcée IRVE : socle renforcé de recharge de véhicule, sur son circuit dédié (32 A / 6 mm²) — pas une prise 2P+T ordinaire.
    if (t === "prise_irve") {
      mecanismes.push({ id: "a", titre: "Prise renforcée IRVE", bornes: [{ id: "L", libelle: "L", aide: "phase" }, { id: "N", libelle: "N", aide: "neutre" }, { id: "PE", libelle: "PE", aide: "terre" }] });
      lier("a", "L", role("phase")); lier("a", "N", role("neutre")); lier("a", "PE", role("terre"));
      notes.push("Prise renforcée IRVE (recharge de véhicule électrique) : phase, neutre et terre sur les bornes du socle renforcé (repères L / N / ⏚, voir la notice du fabricant). Circuit dédié, câble 6 mm², aucune autre prise sur ce circuit.");
      return vue("autre");
    }
    const estPrise = t === "prise" || t === "prise_commandee" || t === "prise_dediee" || t === "prise_exterieure";
    mecanismes.push({
      id: "a", titre: estPrise ? "Prise 2P+T" : "Raccordement de l'appareil",
      bornes: [{ id: "L", libelle: "L", aide: estPrise ? "phase" : undefined }, { id: "N", libelle: "N", aide: estPrise ? "neutre" : undefined }, { id: "PE", libelle: "PE", aide: "terre" }],
      ...(estPrise ? { modele: "odace-prise" as const } : {}),
    });
    lier("a", "L", role("phase")); lier("a", "N", role("neutre")); lier("a", "PE", role("terre"));
    if (estPrise) notes.push("Prise 2P+T Odace (S9-052) : de gauche à droite L (levier rouge), terre (levier vert), N (levier bleu) — 2 connexions rapides PAR PÔLE — le câble d'arrivée et celui de départ se raccordent chacun sur la borne L, sur la borne N, et la terre au contact de terre de la prise. Pas de pontage nécessaire.");
    else notes.push("Appareil à alimentation directe : phase, neutre et terre sur son bornier (repères L / N / ⏚ de l'appareil, voir sa notice) ; sortie de câble ou prise spécialisée selon l'appareil.");
    return vue("autre");
  }

  // ── Commandes ────────────────────────────────────────────────────────────────────────────────────
  const base = baseCommande(app.type);
  const voies: (0 | 1 | undefined)[] = double ? [0, 1] : [undefined];
  const titreVoie = (v: 0 | 1 | undefined, t: string) => (v === undefined ? t : `${t} — voie ${LETTRES[v]}`);
  const idM = (v: 0 | 1 | undefined) => (v === undefined ? "m" : `m${v}`);

  if (app.domotique && cables.length === 0) {
    notes.push("Commande domotique (radio / Wi-Fi) : aucun fil de retour ni de navette. Alimentation du module (phase + neutre) selon la notice du fabricant.");
    return vue("commande");
  }

  if (base === "va_et_vient") {
    voies.forEach(v => {
      const conc = ofVoie(v);
      const navAmont = cables.filter(c => c.cote === "amont" && c.conducteurs.some(x => x.role === "navette" && conc(x)));
      const navAval = cables.filter(c => c.cote === "aval" && c.conducteurs.some(x => x.role === "navette" && conc(x)));
      const nav = (cs: CableVue[], n: 1 | 2) => cs.flatMap(c => c.conducteurs.filter(x => x.role === "navette" && conc(x) && x.libelle.startsWith(`Navette ${n}`)));
      const retours = role("retour", conc);
      const phases = role("phase");
      if (navAmont.length > 0 && navAval.length > 0) {
        mecanismes.push({ id: idM(v), titre: titreVoie(v, "Permutateur"), bornes: [
          { id: "E1", libelle: "L1", aide: "navette 1 (côté alimentation)" }, { id: "E2", libelle: "L2", aide: "navette 2 (côté alimentation)" },
          { id: "S1", libelle: "1", aide: "navette 1 (côté lampe)" }, { id: "S2", libelle: "2", aide: "navette 2 (côté lampe)" }], modele: "odace-perm" });
        notes.push("Permutateur Odace (S9-205) : L1 / L2 d'un côté (leviers rouges), 1 / 2 de l'autre. Le mécanisme est symétrique : les deux navettes venant de l'alimentation vont sur L1 et L2, celles qui repartent vers la lampe sur 1 et 2 (ou l'inverse, c'est équivalent) — sans croiser une navette avec l'autre.");
        lier(idM(v), "E1", nav(navAmont, 1)); lier(idM(v), "E2", nav(navAmont, 2));
        lier(idM(v), "S1", nav(navAval, 1)); lier(idM(v), "S2", nav(navAval, 2));
        episser(titreVoie(v, "Retour (traverse)"), "Le fil de retour passe dans cette boîte sans se raccorder : relier les deux bouts entre eux.", retours);
      } else {
        const com = { id: "COM", libelle: "L", aide: "borne commune" };
        mecanismes.push({ id: idM(v), titre: titreVoie(v, "Va-et-vient"), bornes: [com, { id: "L1", libelle: "1", aide: "navette" }, { id: "L2", libelle: "2", aide: "navette" }], modele: "odace-inter" as const });
        if (navAval.length > 0) {                   // PREMIER (côté alimentation) : navettes vers l'aval
          lier(idM(v), "L1", nav(navAval, 1)); lier(idM(v), "L2", nav(navAval, 2));
          lier(idM(v), "COM", phases);
          if (retours.length > 1) episser(titreVoie(v, "Retour (traverse)"), "Le fil de retour de la lampe passe par cette boîte vers le dernier va-et-vient : relier les deux bouts entre eux, hors mécanisme.", retours);
        } else if (navAmont.length > 0) {           // DERNIER (côté lampe) : navettes de l'amont, COM = retour
          lier(idM(v), "L1", nav(navAmont, 1)); lier(idM(v), "L2", nav(navAmont, 2));
          lier(idM(v), "COM", retours);
        } else {                                    // seul : phase sur COM, retour sur L1
          lier(idM(v), "COM", phases); lier(idM(v), "L1", retours);
          notes.push(`${titreVoie(v, "Va-et-vient")} sans autre commande dans le circuit : câblé en simple allumage (phase sur L, retour sur 1, borne 2 inutilisée). Il manque l'autre va-et-vient.`);
        }
      }
    });
    if (double) notes.push("Plaque double : deux mécanismes INDÉPENDANTS (voie A et voie B), chacun commande sa lampe. Ne pas croiser les fils d'une voie sur l'autre.");
    if (role("phase").length > 0 && double && voies.every(v => raccords.some(r => r.mecanisme === idM(v) && r.borne === "COM" && r.conducteur.role === "phase"))) {
      notes.push("La même phase alimente les deux bornes L : relier les deux par un petit cavalier de fil (chaque borne L a 2 entrées), puis un seul fil de phase.");
    }
    episser("Neutre", TERRE_NEUTRE_BOITE, role("neutre"));
    episser("Terre", TERRE_NEUTRE_BOITE, role("terre"));
    return vue("commande");
  }

  if (base === "telerupteur") {
    voies.forEach(v => {
      const conc = ofVoie(v);
      mecanismes.push({ id: idM(v), titre: titreVoie(v, "Bouton-poussoir"), bornes: [{ id: "COM", libelle: "L", aide: "phase" }, { id: "S", libelle: "1", aide: "retour vers A1" }], modele: "odace-inter" as const });
      lier(idM(v), "COM", role("phase"));
      lier(idM(v), "S", role("retour", conc));
    });
    notes.push("Bouton-poussoir (jamais un interrupteur à accrochage) : L = phase, 1 = fil de retour qui rejoint la borne A1 du télérupteur au tableau. Les boutons sont en PARALLÈLE : le câble d'arrivée et celui de départ se raccordent sur les mêmes bornes.");
    if (double) notes.push("Plaque double : chaque bouton a son propre retour vers SON télérupteur (voie A → télérupteur A, voie B → télérupteur B).");
    notes.push("Bouton lumineux : prévoir en plus le neutre (borne N du bouton) — le neutre est présent dans la boîte.");
    episser("Terre", TERRE_NEUTRE_BOITE, role("terre"));
    return vue("commande");
  }

  // interrupteur simple / double / détecteur
  const detecteur = app.type === "detecteur_mouvement" || app.type === "detecteur_mouvement_exterieur";
  if (detecteur) {
    mecanismes.push({ id: "m", titre: "Détecteur de mouvement", bornes: [{ id: "L", libelle: "L", aide: "phase" }, { id: "N", libelle: "N", aide: "neutre" }, { id: "S", libelle: "S", aide: "sortie vers la lampe" }] });
    lier("m", "L", role("phase")); lier("m", "N", role("neutre")); lier("m", "S", role("retour"));
    notes.push("Le détecteur est alimenté en permanence (L + N) et commute lui-même la sortie S vers la lampe : le neutre se raccorde donc AUSSI sur le détecteur.");
    episser("Terre", TERRE_NEUTRE_BOITE, role("terre"));
    return vue("commande");
  }
  if (double) {
    // Plaque double : DEUX mécanismes indépendants côte à côte (photo S9-214), chacun avec sa borne L, sa borne 1 et sa lampe.
    ([0, 1] as const).forEach(v => {
      mecanismes.push({ id: `m${v}`, titre: `Voie ${LETTRES[v]}`, bornes: [{ id: "COM", libelle: "L", aide: "phase" }, { id: "S", libelle: "1", aide: "retour" }], modele: "odace-inter" });
      lier(`m${v}`, "COM", role("phase"));
      lier(`m${v}`, "S", role("retour", ofVoie(v)));
    });
    notes.push("Double interrupteur : deux mécanismes indépendants, chacun avec sa borne L. Une seule phase alimente les deux : la 2e entrée de chaque borne L permet de les relier par un petit cavalier de fil. Chaque borne « 1 » part vers SA lampe (voie A / voie B).");
  } else {
    mecanismes.push({ id: "m", titre: "Interrupteur", bornes: [{ id: "COM", libelle: "L", aide: "phase" }, { id: "S", libelle: "1", aide: "retour" }], modele: "odace-inter" });
    lier("m", "COM", role("phase")); lier("m", "S", role("retour"));
    if (cables.filter(c => c.cote === "aval" && c.conducteurs.some(x => x.role === "retour")).length > 1) notes.push("Plusieurs lampes commandées : tous les retours partent de la MÊME borne 1.");
  }
  episser("Neutre", TERRE_NEUTRE_BOITE, role("neutre"));
  episser("Terre", TERRE_NEUTRE_BOITE, role("terre"));
  return vue("commande");
}
