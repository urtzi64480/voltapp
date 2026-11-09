// src/lib/suivi-normes.ts
//
// ÉTAPES DÉTAILLÉES NF C 15-100 DU SUIVI DE CHANTIER : pour chaque action du suivi (poser un disjoncteur, une boîte, un point lumineux, une
// commande, une prise, tirer un câble…), la liste des opérations à faire et à contrôler pour que l'installation soit conforme, chacune avec
// la règle qui la justifie. Module PUR (aucun accès réseau, aucune dépendance React) : suivi-realisation.ts l'appelle et fabrique les clés de coche.
//
// Règles du projet (voir normes-nfc.ts et checklist-fin-chantier.ts) :
//   · La NF C 15-100 ALERTE, elle ne bloque jamais : ces étapes se cochent librement, aucune n'est obligatoire pour avancer.
//   · Chaque valeur chiffrée affichée vient de la table vérifiée du projet (infographie Legrand « Les points clés de la NF C 15-100 », eduscol)
//     ou du plan lui-même (calibre, section, hauteur saisis). Une règle dont la valeur n'est PAS vérifiée est écrite sans chiffre et marquée
//     `aVerifier` : l'interface l'affiche « à vérifier dans la norme ». Aucun seuil de mesure (isolement, terre) n'est affirmé ici.
//   · Les clés de coche des étapes principales (posé / raccordé / câble tiré) ne changent pas : les chantiers déjà commencés gardent leurs coches.
//     Les étapes détaillées ont leur propre clé `<clé principale>|n:<slug>` (stable : un slug ne change jamais de sens).

import { NORME_GTL, NORME_TABLEAU } from "@/lib/normes-nfc";

export type GroupeEtape = "preparation" | "pose" | "raccordement" | "controle";
export const ORDRE_GROUPES: GroupeEtape[] = ["preparation", "pose", "raccordement", "controle"];
export const TITRE_GROUPE: Record<GroupeEtape, string> = {
  preparation: "Avant la pose", pose: "Pose", raccordement: "Raccordement", controle: "Contrôles NF C 15-100",
};

export interface EtapeNorme {
  /** Identifiant stable de l'étape (jamais réutilisé pour une autre signification). */
  slug: string;
  groupe: GroupeEtape;
  /** Ce qu'il faut faire ou vérifier. */
  libelle: string;
  /** La règle qui le justifie (valeur issue de la table vérifiée, ou principe sans chiffre). */
  norme?: string;
  /** Valeur ou règle non vérifiée dans le projet : l'interface invite à la confirmer dans le texte de la norme. */
  aVerifier?: boolean;
}

export type DescripteurNorme =
  | { kind: "disjoncteur"; amperes: number | null; sectionMm2: string | null; nom: string; diffType?: string; maxPar?: number; nbPoints: number; eclairage: boolean }
  | { kind: "boite"; eclairage: boolean }
  | { kind: "lampe"; type: string; sdb: boolean; plafond: boolean; hauteurCm: number | null; commandee: boolean }
  | { kind: "commande"; type: string; hauteurCm: number | null; domotique: boolean; double: boolean; detecteur: boolean; interieur: boolean }
  | { kind: "commande_service"; type: "inter_volet" | "inter_vmc"; hauteurCm: number | null }
  | { kind: "prise"; type: string; hauteurCm: number | null; amperes: number | null; sectionMm2: string | null; sdb: boolean }
  | { kind: "communication"; type: "rj45" | "prise_tv"; hauteurCm: number | null }
  | { kind: "volet_roulant" }
  | { kind: "chauffage"; puissanceW: number | null }
  | { kind: "autre"; amperes: number | null; sectionMm2: string | null; hauteurCm: number | null }
  | { kind: "liaison"; communication: boolean; cable: string; gaine: string; pose: string; sectionMm2: string | null; amperes: number | null }
  | { kind: "controle"; communication: boolean; eclairage: boolean; aPrises: boolean; sdb: boolean; irve: boolean };

const e = (slug: string, groupe: GroupeEtape, libelle: string, norme?: string, aVerifier = false): EtapeNorme =>
  aVerifier ? { slug, groupe, libelle, norme, aVerifier } : { slug, groupe, libelle, norme };

const DISCRET = "NF C 15-100";

// Valeurs facultatives (devis sans plan : calibre, section, hauteur non connus) → libellés sans chiffre inventé.
const cm = (h: number | null): string => (h == null ? "" : ` : ${h} cm`);
const calibreSection = (a: number | null, s: string | null): string =>
  a != null && s ? `disjoncteur ${a} A pour une section de ${s} mm²` : a != null ? `disjoncteur ${a} A (section du câble à confirmer)` : s ? `section ${s} mm² (calibre du disjoncteur à confirmer)` : "calibre du disjoncteur et section du câble cohérents entre eux";

// Étapes communes de raccordement d'un appareillage (prise, commande, lampe…)
const serrage = (): EtapeNorme => e("serrage", "raccordement", "Serrer chaque borne puis tirer légèrement sur chaque fil pour vérifier la connexion",
  "Une connexion mal serrée chauffe : serrage au tournevis ou connexion automatique correctement enclenchée.");
const couleurs = (): EtapeNorme => e("couleurs", "raccordement", "Respecter les couleurs : bleu = neutre, vert/jaune = terre, une autre couleur = phase",
  `Repérage des conducteurs (${DISCRET}) : le vert/jaune ne sert qu'à la terre, le bleu qu'au neutre.`);
const terre = (libelle: string): EtapeNorme => e("terre", "raccordement", libelle, `Terre obligatoire sur les prises de courant et les luminaires de classe I (${DISCRET}).`);

/** Étapes détaillées d'une action du suivi. L'ordre du tableau est l'ordre d'affichage dans chaque groupe. */
export function etapesNormatives(d: DescripteurNorme): EtapeNorme[] {
  switch (d.kind) {
    case "disjoncteur": {
      const liste: EtapeNorme[] = [
        e("calibre", "preparation", `Vérifier le calibre : ${calibreSection(d.amperes, d.sectionMm2)}`,
          "Le calibre protège le câble : 16 A ↔ 1,5 mm², 20 A ↔ 2,5 mm², 32 A ↔ 6 mm² (NF C 15-100). Un calibre trop fort laisse le câble chauffer."),
      ];
      if (d.maxPar != null) {
        liste.push(e("nb-points", "preparation", `Compter ${d.eclairage ? "les points lumineux" : "les appareils"} du circuit : ${d.nbPoints} / ${d.maxPar} maximum`,
          "Nombre maximum par circuit : 8 points lumineux ; prises 1,5 mm² / 16 A : 8 ; prises 2,5 mm² / 20 A : 12 ; prises de cuisine : 6 (infographie Legrand)."));
      }
      liste.push(
        e("circuit-unique", "pose", "Un seul circuit sur ce disjoncteur, et ce circuit sur ce seul disjoncteur",
          "1 disjoncteur par circuit, 1 circuit par disjoncteur (infographie Legrand). Disjoncteur obligatoire : fusible interdit en neuf ou rénovation complète."),
        e("sous-differentiel", "pose",
          d.diffType ? `Placer le disjoncteur sous un interrupteur différentiel 30 mA de type ${d.diffType} (ou supérieur)` : "Placer le disjoncteur sous un interrupteur différentiel 30 mA",
          `Au moins ${NORME_TABLEAU.idMiniParLogement.valeur} différentiels 30 mA par logement, ${NORME_TABLEAU.circuitsMaxParId.valeur} circuits maximum par différentiel, dont au moins ${NORME_TABLEAU.idTypeAMini.valeur} de type A.`),
        e("rangee-reserve", "pose", "Aligner sur le rail sans laisser de rangée vide et en gardant la réserve prévue",
          `Ne pas laisser de rangée vide ; réserve de ${NORME_GTL.reservePctMaison.valeur} % de modules libres dans le tableau (maison individuelle).`),
        e("phase-neutre", "raccordement", "Raccorder la phase et le neutre du circuit à ce disjoncteur, la terre sur le bornier de terre",
          "Un conducteur de terre par circuit, relié au bornier de terre du tableau (lui-même relié à la prise de terre)."),
        couleurs(), serrage(),
        e("reperage-circuit", "controle", `Étiqueter le circuit « ${d.nom} » au tableau (nom lisible, durable)`,
          `Chaque protection doit être repérée (${DISCRET}) : on doit savoir quoi couper sans ouvrir les murs.`),
        e("test-differentiel", "controle", "Après mise sous tension : bouton test du différentiel, puis vérifier qu'il ne déclenche pas en charge",
          "Le différentiel 30 mA protège les personnes : l'essai se fait à chaque mise en service."),
      );
      return liste;
    }

    case "boite":
      return [
        e("accessible", "preparation", "Choisir un emplacement accessible : boîte jamais noyée dans le plâtre ni le béton",
          "Toute connexion se fait dans une boîte accessible et démontable (NF C 15-100) : pas d'épissure cachée dans un mur."),
        e("fixation", "pose", "Boîte fixée solidement, entrées de gaines propres et au bon diamètre",
          "Boîte et gaines fixées : un câble ne doit supporter aucun effort sur ses connexions."),
        e("etanche-air", "pose", "Membranes souples sur les entrées de gaines (boîte hermétique à l'air en volume chauffé)",
          "Boîte hermétique à l'air : membranes souples sur les entrées de gaines (infographie Legrand)."),
        e("bornes", "raccordement", `Un conducteur par entrée de borne à levier : phase, neutre et terre sur des bornes séparées${d.eclairage ? " (retours à part)" : ""}`,
          "Aucune épissure en dehors d'une boîte ; bornes de raccordement rapide adaptées à la section."),
        couleurs(),
        e("tirage", "raccordement", "Tirer légèrement chaque fil pour vérifier la connexion avant de refermer",
          "Un fil mal engagé dans une borne à levier ne tient pas : contrôle mécanique de chaque conducteur."),
        e("couvercle", "controle", "Couvercle posé, boîte restée accessible et repérée sur le plan",
          "La boîte doit pouvoir être rouverte plus tard sans dégrader la finition."),
      ];

    case "lampe": {
      const liste: EtapeNorme[] = [];
      if (d.plafond) liste.push(e("position", "preparation", "Repérer l'emplacement du point de centre dans la pièce",
        "1 point d'éclairage au plafond au centre de chaque pièce (séjour, chambre, cuisine, autres pièces) — infographie Legrand."));
      liste.push(
        e("fixation", "pose", d.plafond ? "Boîte DCL accrochée à la structure du bâtiment (tige filetée, câble…), tenue d'au moins 25 kg" : "Boîte d'encastrement ou DCL fixée au mur, au bon niveau",
          d.plafond ? "Boîtes de point de centre accrochées à la structure, charge d'au moins 25 kg (infographie Legrand)." : "Le luminaire ne doit jamais être porté par les conducteurs."),
        e("etanche-air", "pose", "Membranes souples sur les entrées de gaines de la boîte",
          "Boîte hermétique à l'air : membranes souples sur les entrées de gaines (infographie Legrand)."),
        e("terre", "raccordement", "Luminaire de classe I : terre raccordée. Classe II : ne pas relier à la terre, isoler le conducteur de terre en attente",
          "Classe I : appareils obligatoirement reliés à la terre. Classe II : double isolation, ne doivent pas être reliés à la terre (infographie Legrand)."),
        e("phase-retour", "raccordement", "Retour (phase commutée) et neutre sur les bornes du luminaire, jamais la phase permanente sur la borne de commande",
          "La commande coupe la phase : le luminaire ne doit rester sous tension en aucune position."),
        couleurs(), serrage(),
      );
      if (d.sdb) liste.push(e("ip-volume", "controle", "Salle de bains : vérifier le volume où se trouve le luminaire et son indice de protection",
        "Volume 0 : IPX7 · volume 1 : IPX5 · volume 2 : IPX4 (infographie Legrand) ; hors volume : selon les règles de la pièce."));
      liste.push(
        d.commandee
          ? e("commande-ok", "controle", "Vérifier que ce point est allumé et éteint par sa commande (essai depuis chaque commande)", "Au moins un point d'allumage près de chaque accès de chaque pièce (infographie Legrand).")
          : e("commande-ok", "controle", "Aucune commande liée à ce point lumineux dans le plan : à corriger avant de câbler", "Au moins un point d'allumage près de chaque accès de chaque pièce (infographie Legrand)."),
      );
      return liste;
    }

    case "commande": {
      const liste: EtapeNorme[] = [
        e("emplacement", "preparation", "Contrôler l'emplacement : près de l'accès de la pièce, dans la zone libre du mur",
          "Dans chaque pièce, au moins un point d'allumage près de chaque accès (infographie Legrand)."),
      ];
      if (d.interieur) liste.push(e("hauteur", "preparation", `Contrôler la hauteur de pose${cm(d.hauteurCm)} (entre 90 cm et 1,30 m)`,
        "Points d'allumage entre 0,90 m et 1,30 m du sol (hauteur préconisée par la réglementation sur l'accessibilité — infographie Legrand)."));
      liste.push(
        e("boite", "pose", "Boîte d'encastrement d'aplomb, profondeur adaptée au doublage, scellée sans abîmer les gaines"),
        e("plaque", "pose", d.double ? "Mécanisme à deux voies fixé, plaque de finition alignée sur le niveau" : "Mécanisme fixé et plaque de finition alignée sur le niveau"),
      );
      if (!d.domotique) liste.push(
        e("coupe-phase", "raccordement", "La commande coupe la PHASE (jamais le neutre) : vérifier la borne d'arrivée sur le mécanisme",
          "Un luminaire éteint ne doit jamais rester sous tension : l'appareil de commande se place sur la phase."),
      );
      liste.push(
        e("guide", "raccordement", d.domotique ? "Module domotique alimenté et appairé selon la notice (pas de fil de retour vers la lampe)" : "Câbler les bornes selon le guide de câblage de cette commande"),
        e("terre-continuite", "raccordement", "Terre : conducteur de terre non coupé, continuité assurée vers le luminaire",
          `Le conducteur de terre doit rester continu jusqu'au luminaire (${DISCRET}).`),
        couleurs(), serrage(),
        e("essai", "controle", d.detecteur ? "Essai du détecteur : détection, temporisation et réglage de luminosité" : "Essai : chaque position allume et éteint le bon point lumineux"),
      );
      return liste;
    }

    case "commande_service":
      return [
        e("hauteur", "preparation", `Contrôler la hauteur de pose${cm(d.hauteurCm)} (entre 90 cm et 1,30 m)`,
          "Commandes entre 0,90 m et 1,30 m du sol (accessibilité — infographie Legrand)."),
        e("boite", "pose", "Boîte d'encastrement d'aplomb, mécanisme et plaque de finition alignés"),
        e("alimentation", "raccordement", d.type === "inter_volet"
          ? "Phase montée, phase descente, neutre et terre vers le moteur ; jamais les deux sens alimentés ensemble"
          : "Petite vitesse, grande vitesse, neutre et terre vers la VMC selon la notice"),
        couleurs(), serrage(),
        e("essai", "controle", d.type === "inter_volet" ? "Essai montée / descente et arrêt du volet" : "Essai des deux vitesses de la VMC"),
      ];

    case "prise": {
      const liste: EtapeNorme[] = [
        e("hauteur", "preparation", `Contrôler la hauteur de pose du socle${cm(d.hauteurCm)}`,
          "Hauteur saisie dans le plan : vérifier dans la norme la hauteur minimale du socle au sol fini et la hauteur à respecter dans un logement accessible.", true),
        e("boite", "pose", "Boîte d'encastrement d'aplomb, profondeur adaptée au doublage"),
        e("socle", "pose", "Socle 2P+T fixé, plaque de finition alignée sur le niveau",
          "Prises de courant avec terre obligatoire (infographie Legrand)."),
        e("section-circuit", "raccordement", `Vérifier la section du câble : ${calibreSection(d.amperes, d.sectionMm2)}`,
          "Prises : 1,5 mm² / 16 A (8 prises maxi) ou 2,5 mm² / 20 A (12 prises maxi) ; cuisine : 2,5 mm² / 20 A (6 prises maxi) ; plaques de cuisson : 6 mm² / 32 A (infographie Legrand)."),
        terre("Raccorder la terre sur la borne du socle (obligatoire)"),
        e("derivation", "raccordement", "Raccorder en dérivation (jamais en série dans les bornes du socle)",
          "Si un socle est retiré ou défaillant, les prises suivantes doivent rester alimentées."),
        couleurs(), serrage(),
        e("test-prise", "controle", "Tester la prise avec un testeur : tension, polarité, terre",
          "Chaque prise est contrôlée avant remise au client."),
      ];
      if (d.type === "prise_exterieure") liste.push(e("exterieur", "controle", "Prise extérieure : socle étanche et circuit sous différentiel 30 mA",
        "Protection contre l'eau adaptée à l'extérieur (IP44 minimum, valeur du projet) et différentiel 30 mA."));
      if (d.type === "prise_irve") liste.push(
        e("irve-circuit", "controle", "Prise renforcée recharge : circuit dédié, un seul point de recharge par circuit",
          "1 point de recharge par circuit dédié (infographie Legrand)."),
        e("irve-protection", "controle", "Protection amont : différentiel 30 mA de type A ou F, avec protection contre le courant continu de défaut",
          "Protections minimales en mode 2 monophasé : différentiel 30 mA type A ou F (infographie Legrand)."),
      );
      if (d.type === "prise_dediee") liste.push(e("dedie", "controle", "Circuit dédié à cet appareil uniquement (un circuit par appareil)",
        "Lave-linge, lave-vaisselle, sèche-linge, four, congélateur… : 1 circuit dédié par appareil (infographie Legrand)."));
      if (d.sdb) liste.push(e("volume", "controle", "Salle de bains : vérifier le volume (0, 1, 2 ou hors volume) où se trouve la prise avant de la poser",
        "Les volumes 0, 1 et 2 limitent les appareils autorisés (infographie Legrand « volumes de protection ») : confirmer dans la norme où une prise est admise.", true));
      return liste;
    }

    case "communication": {
      const rj = d.type === "rj45";
      return [
        e("hauteur", "preparation", `Contrôler la hauteur de pose${cm(d.hauteurCm)}`, "Hauteur saisie dans le plan, à confirmer dans la norme.", true),
        e("proximite", "preparation", rj ? "Placer la prise RJ45 à proximité d'une prise de courant" : "Prévoir une prise de courant à proximité de la prise TV",
          "Prises de communication placées à proximité d'une prise de courant (infographie Legrand)."),
        e("boite", "pose", rj ? "Boîte d'encastrement d'aplomb, prise RJ45 catégorie 6 blindée (STP) fixée" : "Boîte d'encastrement d'aplomb, prise TV fixée",
          rj ? "Prises RJ45 catégorie 6 blindées (STP) au minimum (infographie Legrand)." : undefined),
        e("etoile", "pose", "Un câble par prise, tiré d'un seul tenant jusqu'au coffret de communication (aucune dérivation)",
          "Câblage OBLIGATOIREMENT en étoile (infographie Legrand)."),
        e("reperage", "raccordement", rj ? "Repérer le câble aux deux extrémités : numéro de prise et numéro de socle du bandeau de brassage" : "Repérer le câble aux deux extrémités (prise ↔ répartiteur TV)",
          "Un repérage lisible évite de tout rebrancher à l'aveugle lors d'un dépannage."),
        e("blindage", "raccordement", rj ? "Reprendre le blindage (STP) sur le connecteur, sans l'écraser ni le couper" : "Reprendre la tresse du câble coaxial sur la fiche, sans court-circuit avec l'âme",
          rj ? "Câble cuivre 4 paires torsadées, avec écran ; grade 2 TV au minimum (infographie Legrand)." : undefined),
        e("separation", "controle", "Respecter l'écartement avec les câbles de courants forts (pas de cheminement côte à côte)",
          "Séparation entre courants forts et courants faibles : distance à confirmer dans le texte de la norme.", true),
        e("test", "controle", rj ? "Tester le câble (testeur RJ45 : 8 fils, blindage, absence d'inversion de paire)" : "Tester la liaison (signal TV présent, pas de court-circuit)"),
      ];
    }

    case "volet_roulant":
      return [
        e("circuit", "preparation", "Vérifier que le moteur est sur le circuit volets : 16 A / 1,5 mm², un circuit dédié à l'ensemble des volets",
          "Volets roulants : 1,5 mm² / 16 A, 1 circuit dédié (idéalement réparti sur 2 circuits) — infographie Legrand."),
        e("pose-moteur", "pose", "Moteur fixé selon la notice, câble sans tension sur la sortie du moteur"),
        e("raccord", "raccordement", "Phase montée, phase descente, neutre et terre selon la notice du moteur",
          "Respecter le repérage des conducteurs et la notice du fabricant."),
        couleurs(), serrage(),
        e("essai", "controle", "Régler les fins de course puis tester montée, descente et arrêt"),
      ];

    case "chauffage":
      return [
        e("puissance", "preparation", d.puissanceW != null ? `Vérifier la puissance : ${d.puissanceW} W, avec les autres radiateurs du circuit (4 500 W maximum par circuit)` : "Renseigner la puissance du radiateur dans le plan avant de câbler",
          "Chauffage électrique : 2,5 mm² / 20 A, 1 circuit dédié par tranche de 4 500 W (infographie Legrand)."),
        e("pose", "pose", "Radiateur fixé selon la notice, à la distance prévue du sol et des parois"),
        e("raccord", "raccordement", "Raccorder phase, neutre, terre (et fil pilote si le modèle l'exige)",
          "Radiateur de classe I : terre obligatoire (infographie Legrand)."),
        couleurs(), serrage(),
        e("essai", "controle", "Mise en chauffe : vérifier l'absence d'échauffement des connexions et le fonctionnement de la régulation"),
      ];

    case "autre":
      return [
        e("circuit", "preparation", `Vérifier le circuit dédié : ${d.amperes != null && d.sectionMm2 ? `${d.amperes} A / ${d.sectionMm2} mm²` : "calibre et section adaptés à l'appareil"}, un seul appareil par circuit`,
          "Lave-vaisselle, lave-linge, sèche-linge, four, congélateur… : 2,5 mm² / 20 A, 1 circuit dédié par appareil (infographie Legrand)."),
        e("sortie", "pose", `Sortie de câble (ou prise spécialisée)${d.hauteurCm != null ? ` à ${d.hauteurCm} cm du sol` : ""}, bien fixée`),
        terre("Raccorder la terre à l'appareil (classe I : obligatoire)"),
        e("raccord", "raccordement", "Raccorder phase et neutre selon la notice de l'appareil"),
        couleurs(), serrage(),
        e("essai", "controle", "Essai de l'appareil sous tension : fonctionnement et absence de déclenchement"),
      ];

    case "liaison": {
      if (d.communication) {
        return [
          e("type-cable", "preparation", `Vérifier le type de câble : ${d.cable}`, "Câble cuivre 4 paires torsadées avec écran ; grade 2 TV au minimum (infographie Legrand)."),
          e("gaine", "pose", `Tirer le câble sous gaine ${d.gaine}, sans coude brusque ni pincement`),
          e("etoile", "pose", "Câble tiré d'un seul tenant, sans dérivation ni raccord intermédiaire", "Câblage OBLIGATOIREMENT en étoile (infographie Legrand)."),
          e("separation", "pose", "Maintenir l'écartement avec les câbles de courants forts", "Distance entre courants forts et faibles à confirmer dans le texte de la norme.", true),
          e("reperage", "raccordement", "Repérer le câble à chaque extrémité (numéro de prise ↔ numéro de socle)"),
        ];
      }
      return [
        e("section", "preparation", `Vérifier la section : ${d.cable}${d.amperes != null ? ` pour un disjoncteur de ${d.amperes} A` : ""}${d.sectionMm2 ? ` (${d.sectionMm2} mm²)` : ""}`,
          "Le calibre du disjoncteur est limité par la section du câble : 16 A ↔ 1,5 mm², 20 A ↔ 2,5 mm², 32 A ↔ 6 mm² (NF C 15-100)."),
        e("gaine", "pose", d.pose.startsWith("apparent") ? `Câble sous gaine ${d.gaine} (IRL), fixé aux colliers` : `Câble sous gaine ${d.gaine} (pose encastrée), jamais directement dans le mur ni le plâtre`,
          "Les conducteurs ne sont pas posés nus dans la paroi : gaine ICTA (encastré) ou IRL (apparent)."),
        e("cheminement", "pose", "Cheminement horizontal ou vertical uniquement, jamais en diagonale ; pas d'angle vif ni de pincement",
          "Les câbles suivent les zones d'installation (horizontales et verticales) pour rester repérables avant de percer ; distances aux angles, plafond et sol à confirmer dans la norme.", true),
        e("reserve", "pose", "Laisser une réserve de câble dans chaque boîte pour raccorder sans tendre les conducteurs"),
        e("repere", "raccordement", "Repérer le câble à chaque extrémité (circuit et destination)"),
        e("tirage-ok", "controle", "Câble intact après tirage : isolant non entaillé ni écrasé, gaine continue d'une boîte à l'autre"),
      ];
    }

    case "controle": {
      if (d.communication) {
        return [
          e("etoile", "controle", "Chaque prise relie le coffret de communication par son propre câble (étoile, aucune dérivation)", "Câblage OBLIGATOIREMENT en étoile (infographie Legrand)."),
          e("test-liaisons", "controle", "Tester chaque câble RJ45 : 8 fils, blindage, absence d'inversion de paire"),
          e("reperage", "controle", "Chaque câble repéré aux deux extrémités (prise ↔ bandeau de brassage)"),
          e("grade", "controle", "Grade TV du coffret conforme au logement (grade 2 TV au minimum)", "Grade 2 TV au minimum ; grade 3 TV pour les débits les plus élevés (infographie Legrand)."),
          e("separation", "controle", "Courants faibles séparés des courants forts sur tout le trajet", "Distance à confirmer dans le texte de la norme.", true),
        ];
      }
      const liste: EtapeNorme[] = [
        e("serrage-final", "controle", "Resserrer toutes les connexions du circuit (tableau, boîtes, appareillages) avant la mise sous tension",
          "Une connexion lâche est la première cause d'échauffement."),
        e("continuite-pe", "controle", "Mesurer la continuité du conducteur de protection (terre) jusqu'à chaque point du circuit",
          "Vérification initiale avant mise sous tension (NF C 15-100) : la valeur se consigne dans les contrôles de fin de chantier ; seuil non affirmé ici."),
        e("isolement", "controle", "Mesurer l'isolement du circuit, appareils électroniques débranchés",
          "Vérification initiale avant mise sous tension (NF C 15-100) : valeur à consigner, seuil à lire dans la norme (non affirmé ici).", true),
        e("polarite", "controle", "Vérifier la polarité : phase côté disjoncteur, neutre au neutre, jamais inversés"),
        e("mise-sous-tension", "controle", "Mise sous tension : disjoncteur puis différentiel, vérifier l'absence de déclenchement",
          "Le différentiel 30 mA et le disjoncteur doivent tenir la charge normale du circuit."),
      ];
      if (d.eclairage) liste.push(e("essai-eclairage", "controle", "Tester chaque point lumineux depuis chacune de ses commandes",
        "Un point d'allumage près de chaque accès de chaque pièce (infographie Legrand)."));
      if (d.aPrises) liste.push(e("essai-prises", "controle", "Tester chaque prise : tension, polarité, terre"));
      if (d.irve) liste.push(e("irve", "controle", "Circuit de recharge : dédié, protégé par différentiel 30 mA de type A ou F avec protection contre le courant continu de défaut",
        "Protection minimale en mode 2 monophasé (infographie Legrand) ; 1 point de recharge par circuit."));
      if (d.sdb) liste.push(
        e("sdb-30ma", "controle", "Tous les circuits de la salle de bains sont protégés par un différentiel 30 mA",
          "Interrupteur différentiel 30 mA pour tous les circuits de la salle de bains (infographie Legrand)."),
        e("sdb-equipotentielle", "controle", "Liaison équipotentielle locale : canalisations métalliques, masses métalliques et luminaires reliés à la terre",
          "Liaison équipotentielle locale en salle de bains (infographie Legrand)."),
        e("sdb-volumes", "controle", "Volumes 0, 1 et 2 respectés : appareils et indices de protection conformes (IPX7 / IPX5 / IPX4)",
          "Volume 0 : IPX7 · volume 1 : IPX5 · volume 2 : IPX4 ; aucun appareil électrique dans le volume caché (infographie Legrand)."),
      );
      return liste;
    }
  }
}

/** Clé de coche d'une étape détaillée : clé principale de l'élément + slug (stable). */
export const cleEtapeNorme = (cleBase: string, slug: string): string => `${cleBase}|n:${slug}`;

/** Étapes regroupées dans l'ordre d'affichage (préparation → pose → raccordement → contrôle). */
export function grouperEtapes<T extends { groupe?: GroupeEtape }>(etapes: T[]): { groupe: GroupeEtape; etapes: T[] }[] {
  return ORDRE_GROUPES
    .map(g => ({ groupe: g, etapes: etapes.filter(x => x.groupe === g) }))
    .filter(g => g.etapes.length > 0);
}
