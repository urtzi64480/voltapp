// src/lib/maison-types.ts
//
// Types partagés entre l'éditeur de plan (/plan/[clientId]) et le moteur de
// génération de circuits (maison-engine.ts). Source unique — ne pas dupliquer
// ces interfaces ailleurs.

export type NiveauType = "sous_sol" | "rdc" | "etage" | "combles" | "garage";
export type PieceType = "sejour" | "chambre" | "cuisine" | "sdb" | "wc" | "circulation" | "exterieur" | "garage" | "autre";

export type AppareillageType =
  | "prise" | "prise_commandee"
  | "point_lumineux" | "applique"
  | "interrupteur" | "va_et_vient" | "telerupteur"
  | "four" | "plaque" | "lave_linge" | "lave_vaisselle" | "seche_linge"
  | "chauffe_eau" | "chauffage" | "clim" | "seche_serviette" | "congelateur"
  | "irve" | "piscine" | "vmc" | "alarme";

export interface Point { x: number; y: number; }

export interface AppareillagePlace {
  id: number;
  type: AppareillageType;
  x: number; // mètres
  y: number; // mètres
  nom?: string;      // libellé (ex: nom du point lumineux)
  hauteur?: number;  // hauteur d'installation en cm depuis le sol
  // Puissance en watts — uniquement pour type "chauffage". Sert au regroupement des
  // circuits de chauffage par puissance cumulée (NF C 15-100, amendement A5) : voir
  // genererBreakersChauffage (maison-engine.ts). Valeur par défaut à la création :
  // PUISSANCE_CHAUFFAGE_DEFAUT_W (electrical-constants.ts).
  puissanceW?: number;
  // Pour interrupteur / va_et_vient / telerupteur : ids des point_lumineux (ou applique)
  // commandés — un interrupteur peut commander plusieurs points lumineux.
  commandePourIds?: number[];
  // Pour interrupteur / va_et_vient / telerupteur : commande domotique (module radio/wifi),
  // sans câblage physique retour/navette vers le(s) point(s) lumineux commandé(s). Affecte
  // uniquement la visualisation du cheminement (voir SegmentCircuit.type "domotique" et
  // pointsOndulesEntre ci-dessous) — n'affecte pas la composition électrique du circuit.
  domotique?: boolean;
  // Rempli par genererCircuits() — id du Breaker (electrical-constants.ts) qui dessert ce point.
  circuitId?: number;
  // Rattachement manuel à un CircuitManuel (id stable, voir plus bas) — prioritaire sur le
  // clustering automatique de genererCircuits() pour ce point, tant que le CircuitManuel visé
  // existe toujours et correspond à la bonne famille (prises/cuisine/extérieur/éclairage).
  circuitManuelId?: number;
  // Appareillage déjà existant chez le client (ex : la dernière prise d'un circuit
  // existant, servant de point de départ pour en ajouter d'autres) — reste un membre à
  // part entière du circuit pour le tracé et la génération (segmentsPourCircuit,
  // genererCircuits), mais exclu de la facturation du pré-devis (predevis-engine.ts) :
  // ni l'appareillage ni sa boîte d'encastrement ne sont chiffrés. Seul le câblage qui
  // part réellement de lui (vers de nouveaux appareillages) reste facturé normalement.
  dejaExistant?: boolean;
}

// Porte, porte coulissante, fenêtre, ou simple ouverture murale (sans porte, entièrement
// dimensionnée à la main) placée sur un mur (segment du contour) d'une pièce — pas un
// objet libre comme un appareillage : contrainte à glisser le long du mur qui la porte.
export type OuvertureType = "porte" | "porte_coulissante" | "fenetre" | "ouverture";

export interface Ouverture {
  id: number;
  type: OuvertureType;
  segIndex: number;   // quel mur du contour (même indexation que "Mur 1/2/3…" affiché sur le plan)
  position: number;   // 0..1 — position du centre le long de ce mur
  largeur: number;    // cm
  hauteur?: number;   // cm — hauteur de l'ouverture au-dessus de l'allège (0 pour une porte : va jusqu'au sol)
  allege?: number;    // cm — hauteur du bas de l'ouverture depuis le sol (0 = au ras du sol)
  // Porte battante uniquement — sens d'ouverture : "gauche" = charnière du côté du premier
  // sommet du mur (segIndex), "droite" = côté du second sommet. ouvreVersInterieur détermine
  // si le vantail (symbole du plan) bat vers l'intérieur (défaut) ou l'extérieur de la pièce.
  charniere?: "gauche" | "droite";
  ouvreVersInterieur?: boolean;
  // Porte coulissante uniquement — côté du mur vers lequel le panneau coulisse (et se "gare").
  coulisseVers?: "gauche" | "droite";
}

export function nouvelleOuverture(type: OuvertureType, segIndex: number, position: number): Ouverture {
  switch (type) {
    case "porte":
      return { id: uidMaison(), type, segIndex, position, largeur: 90, hauteur: 204, allege: 0, charniere: "gauche", ouvreVersInterieur: true };
    case "porte_coulissante":
      return { id: uidMaison(), type, segIndex, position, largeur: 90, hauteur: 204, allege: 0, coulisseVers: "droite" };
    case "fenetre":
      return { id: uidMaison(), type, segIndex, position, largeur: 100, hauteur: 120, allege: 90 };
    case "ouverture":
    default:
      return { id: uidMaison(), type, segIndex, position, largeur: 100, hauteur: 100, allege: 0 };
  }
}

// ─── PERÇAGE AUTOMATIQUE DES MURS MITOYENS ─────────────────────────────────────
// Deux pièces dessinées côte à côte n'ont, dans ce modèle, aucun mur "partagé" — chacune
// a son propre contour indépendant. Une ouverture posée sur le mur de l'une ne perce donc
// pas, en soi, le mur (géométriquement confondu) de l'autre. Les fonctions ci-dessous
// détectent ces murs mitoyens (même droite, portion commune) et projettent les ouvertures
// de l'un vers l'autre — utilisé en lecture seule par le rendu 2D et par la vue 3D, jamais
// par la donnée elle-même : une ouverture n'a qu'un seul propriétaire, toujours.

function projectionSurDroite(p: Point, origine: Point, dirX: number, dirY: number): number {
  return (p.x - origine.x) * dirX + (p.y - origine.y) * dirY;
}
function distancePerpendiculaire(p: Point, origine: Point, dirX: number, dirY: number): number {
  const t = projectionSurDroite(p, origine, dirX, dirY);
  return distance(p, { x: origine.x + dirX * t, y: origine.y + dirY * t });
}

interface MurJumeau { piece: Piece; segIndex: number; loM: number; hiM: number; }

// Cherche, parmi les AUTRES pièces, tous les murs géométriquement confondus (même droite,
// à toleranceM près) avec le mur (a,b) donné, et qui recouvrent au moins 10cm de sa longueur.
function trouverMursJumeaux(pieces: Piece[], pieceCourante: Piece, segIndex: number, toleranceM = 0.15): MurJumeau[] {
  const a = pieceCourante.contour[segIndex], b = pieceCourante.contour[(segIndex + 1) % pieceCourante.contour.length];
  const dx = b.x - a.x, dy = b.y - a.y;
  const longueur = Math.hypot(dx, dy);
  if (longueur < 0.01) return [];
  const dirX = dx / longueur, dirY = dy / longueur;
  const resultats: MurJumeau[] = [];
  pieces.forEach(piece => {
    if (piece.id === pieceCourante.id) return;
    piece.contour.forEach((c, i) => {
      const d = piece.contour[(i + 1) % piece.contour.length];
      if (distancePerpendiculaire(c, a, dirX, dirY) > toleranceM || distancePerpendiculaire(d, a, dirX, dirY) > toleranceM) return;
      const tC = projectionSurDroite(c, a, dirX, dirY), tD = projectionSurDroite(d, a, dirX, dirY);
      const lo = Math.max(0, Math.min(tC, tD)), hi = Math.min(longueur, Math.max(tC, tD));
      if (hi - lo > 0.1) resultats.push({ piece, segIndex: i, loM: lo, hiM: hi });
    });
  });
  return resultats;
}

// Une ouverture "effective" pour le rendu d'un mur donné — soit une ouverture posée
// directement sur ce mur (proprietaire: true), soit une ouverture posée sur le mur
// mitoyen d'une autre pièce et projetée ici (proprietaire: false, pour percer la vue
// des deux côtés sans dupliquer la donnée).
export interface OuvertureEffective {
  type: OuvertureType;
  position: number; // 0..1 sur CE segment
  largeur: number;
  hauteur?: number;
  allege?: number;
  coulisseVers?: "gauche" | "droite";
  proprietaire: boolean;
}

export function ouverturesEffectivesMur(pieces: Piece[], piece: Piece, segIndex: number): OuvertureEffective[] {
  const a = piece.contour[segIndex], b = piece.contour[(segIndex + 1) % piece.contour.length];
  const longueur = distance(a, b) || 1;
  const propres: OuvertureEffective[] = (piece.ouvertures ?? [])
    .filter(o => o.segIndex === segIndex)
    .map(o => ({ type: o.type, position: o.position, largeur: o.largeur, hauteur: o.hauteur, allege: o.allege, coulisseVers: o.coulisseVers, proprietaire: true }));

  const projetees: OuvertureEffective[] = [];
  trouverMursJumeaux(pieces, piece, segIndex).forEach(j => {
    const aJ = j.piece.contour[j.segIndex], bJ = j.piece.contour[(j.segIndex + 1) % j.piece.contour.length];
    (j.piece.ouvertures ?? []).filter(o => o.segIndex === j.segIndex).forEach(o => {
      const centreM = { x: aJ.x + (bJ.x - aJ.x) * o.position, y: aJ.y + (bJ.y - aJ.y) * o.position };
      const t = positionSurSegment(centreM, a, b);
      const tM = t * longueur;
      if (tM < j.loM - 0.01 || tM > j.hiM + 0.01) return; // hors du recouvrement réel — pas vraiment mitoyen ici
      projetees.push({ type: o.type, position: t, largeur: o.largeur, hauteur: o.hauteur, allege: o.allege, coulisseVers: o.coulisseVers, proprietaire: false });
    });
  });
  return [...propres, ...projetees];
}

export interface Piece {
  id: number;
  nom: string;
  type: PieceType;
  contour: Point[]; // polygone fermé, mètres
  appareillages: AppareillagePlace[];
  ouvertures?: Ouverture[];
  hauteurPlafond?: number; // mètres — remplace la hauteur du niveau pour cette pièce si définie (vue 3D)
  // Mobilier simple (vue 3D uniquement) — voir MeubleSimple ci-dessous.
  meubles?: MeubleSimple[];
}

// Élément cubique simple (table, armoire, plan de travail…) placé dans une pièce, sans
// aucune portée électrique — sert uniquement à mieux juger l'éclairage en vue 3D (un meuble
// bloque/façonne la lumière) et, accessoirement, à visualiser l'encombrement au sol. N'entre
// dans aucun circuit, aucun calcul NF C 15-100, aucun pré-devis.
export interface MeubleSimple {
  id: number;
  nom?: string;
  x: number; y: number;       // centre, mètres (repère du niveau, comme un appareillage)
  largeur: number;             // mètres, le long de x avant rotation
  profondeur: number;          // mètres, le long de y avant rotation
  hauteur: number;             // mètres
  rotation?: number;           // degrés, sens horaire vu de dessus — 0 par défaut
  couleur?: string;            // hex — couleur du cube en vue 3D, gris bois par défaut si absent
}

// Points de coude manuels sur le tracé d'un circuit (pour le faire passer dans un mur,
// par ex.) — clé stable indépendante du circuitId (qui change à chaque génération),
// construite à partir des ids des deux ancres reliées ("tableau" ou id d'appareillage).
// Un segment peut avoir plusieurs coudes, dans l'ordre, pour contourner un obstacle
// (une pièce, par exemple) — pas seulement un simple détour à un point.
export interface LiaisonWaypoint {
  id: number;
  point: Point;
  hauteur?: number; // cm — hauteur d'implantation du câble à ce point (plinthe, gaine technique, plafond…)
  // Mode de pose de la gaine/câble à ce point : encastrée dans le mur/la cloison (défaut si
  // non renseigné) ou posée en apparent (goulotte, moulure) sur la surface du mur. Affiché
  // sur l'impression technique quand "Afficher les hauteurs d'implantation" est coché.
  poseType?: "encastre" | "apparent";
}
export type LiaisonWaypoints = Record<string, LiaisonWaypoint[]>;

// Boîte de dérivation d'un circuit d'éclairage — nommée, positionnée et déplaçable
// indépendamment (voir Niveau.boitesDerivation ci-dessus et construireBranchesCircuitEclairage).
export interface BoiteDerivation {
  id: number;
  nom: string;
  point: Point;
}

// ─── CIRCUITS MANUELS ────────────────────────────────────────────────────────
// Un circuit créé et composé à la main par l'utilisateur — nom, type électrique ET
// membres explicitement choisis (voir CircuitManuelForm, page.tsx) — plutôt que par le
// clustering automatique de genererCircuits(). Id stable (uidMaison), donc résiste aux
// régénérations, contrairement au Breaker.id, réattribué à chaque clic sur "Générer les
// circuits". Scope : par niveau (un circuit ne traverse jamais deux niveaux).
//
// "famille" est la clé du type électrique choisi dans CIRCUITS (electrical-constants.ts —
// "prise_16", "lumiere", "chauffage_16", "four", "autre", etc.) : N'IMPORTE laquelle des
// clés CIRCUITS convient, pas seulement les 4 familles "groupables" d'origine — un circuit
// manuel peut représenter n'importe quel type de circuit, avec exactement les appareillages
// que l'utilisateur y a mis (voir genererBreakersChauffage… non, voir breakerFromClusterManuel
// dans maison-engine.ts, qui construit un unique Breaker par circuit manuel, jamais scindé
// automatiquement). Le type reste `string` (plutôt qu'un littéral union) pour ne jamais avoir
// à modifier ce fichier quand une nouvelle entrée CIRCUITS apparaît, et parce que les valeurs
// déjà enregistrées ("prise_16", "cuisine_prises", "exterieur", "lumiere") restent valides
// telles quelles — aucune migration de données nécessaire.
export type FamilleCircuitManuel = string;

// Historique : label des 4 familles d'origine (prises/cuisine/extérieur/éclairage), du temps
// où un circuit manuel ne pouvait être que l'une d'elles. Remplacé dans l'UI par les labels de
// CIRCUITS (electrical-constants.ts), qui couvrent maintenant tout type de circuit — conservé
// ici uniquement pour compatibilité d'éventuels autres appelants.
export const FAMILLES_CIRCUIT_MANUEL: Record<"prise_16" | "cuisine_prises" | "exterieur" | "lumiere", string> = {
  prise_16: "Prises",
  cuisine_prises: "Prises cuisine",
  exterieur: "Prises extérieur / garage",
  lumiere: "Éclairage",
};

export interface CircuitManuel {
  id: number;
  nom: string;
  famille: FamilleCircuitManuel; // clé CIRCUITS — voir commentaire du type ci-dessus
  couleur?: string; // couleur imposée sur le plan/l'impression/la vue 3D — sinon couleur procédurale
  // Circuit déjà existant sur l'installation en place (piquage sur une prise/un point déjà
  // câblé), jamais relié au tableau sur ce plan : aucun segment n'est tracé vers le tableau
  // (voir sequenceAncresCircuit / construireBranchesCircuitEclairage, paramètre
  // relieAuTableau) et le circuit n'est jamais poussé vers le module Tableau (voir
  // handlePousserVersTableau, page.tsx) — il reste protégé par le disjoncteur déjà en place.
  nonRelieTableau?: boolean;
}

// Classe un appareillage (dans une pièce donnée) dans l'une des 4 familles "groupables"
// automatiquement par genererCircuits() (prises/cuisine/extérieur/éclairage), ou null s'il
// suit une autre logique : interrupteurs (rattachés au circuit de leur(s) point(s) lumineux
// commandé(s)), chauffage (regroupé par puissance, voir genererBreakersChauffage) et appareils
// dédiés (four, chauffe-eau… un circuit par instance). Sert UNIQUEMENT à la classification
// automatique — un circuit MANUEL, lui, accepte n'importe quel appareillage quel que soit son
// type (voir CircuitManuelForm, page.tsx) : cette fonction n'intervient plus dans son éligibilité.
export function familleCircuitManuelAppareillage(type: AppareillageType, pieceType: PieceType): FamilleCircuitManuel | null {
  if (type === "prise" || type === "prise_commandee") {
    if (pieceType === "cuisine") return "cuisine_prises";
    if (pieceType === "exterieur" || pieceType === "garage") return "exterieur";
    return "prise_16";
  }
  if (type === "point_lumineux" || type === "applique") return "lumiere";
  return null;
}

export interface Niveau {
  id: number;
  nom: string;
  type: NiveauType;
  ordre: number;
  pieces: Piece[];
  tableauPos?: Point; // position du tableau électrique / GTL sur ce niveau
  tableauHauteur?: number; // cm — hauteur d'installation du tableau (vue 3D), 150 par défaut
  tableauRotation?: number; // degrés — orientation du tableau (aligné sur le mur porteur), 0 par défaut
  // Boîte(s) de dérivation d'un circuit d'éclairage — indexé par le label du disjoncteur
  // (stable tant que la composition du plan ne change pas, comme couleursCircuits). Une
  // liste plutôt qu'un point unique : plusieurs boîtes nommées peuvent être ajoutées,
  // déplacées et renommées indépendamment (voir ajouterBoiteDerivation, page.tsx) — le
  // câble les chaîne dans l'ordre de la liste (tableau -> boîte 1 -> boîte 2 -> …), et
  // chaque lampe se raccorde à la boîte la plus proche d'elle (voir
  // construireBranchesCircuitEclairage). Liste vide ou absente : comportement historique
  // (une boîte implicite non nommée, positionnée au centroïde des lampes).
  boitesDerivation?: Record<string, BoiteDerivation[]>;
  // Paires de points lumineux (ids AppareillagePlace) reliés DIRECTEMENT entre eux, sans
  // passer par une boîte de dérivation — indexé par le label du disjoncteur, même convention
  // de clé que boitesDerivation. Posé via clic sur un point lumineux puis un second (voir
  // demarrerLiaisonDirecteLumiere, page.tsx). Un point lumineux impliqué dans au moins une
  // paire sort de la topologie en étoile "boîte" habituelle : voir construireBranchesCircuitEclairage.
  liaisonsDirectesLumiere?: Record<string, [number, number][]>;
  hauteurPlafond?: number; // mètres — pour la vue 3D (2.5 par défaut)
  liaisonWaypoints?: LiaisonWaypoints;
  circuitsManuels?: CircuitManuel[];
  // Couleur imposée par circuit AUTOMATIQUE (non manuel), indexée par le label généré
  // (déterministe tant que la composition du plan ne change pas) — les circuits manuels
  // utilisent CircuitManuel.couleur à la place (voir construireColorMap, maison-engine.ts).
  couleursCircuits?: Record<string, string>;
  // Ordre de câblage choisi à la main pour un circuit (tableau -> appareillage 1 ->
  // appareillage 2 -> …), indexé par le label du disjoncteur — même convention de clé que
  // couleursCircuits/boitesDerivation (stable tant que la composition du plan ne change pas).
  // Remplace, pour ce circuit, le chemin plus-proche-voisin calculé automatiquement (voir
  // segmentsPourCircuit, maison-engine.ts) — uniquement pertinent pour les circuits en
  // chaîne (prises, chauffage, dédiés, manuels non-éclairage) ; l'éclairage garde toujours
  // sa topologie en étoile depuis la boîte de dérivation. Un appareillage du circuit absent
  // de cette liste (ajouté après coup) est simplement ajouté à la suite, par proximité.
  ordresCircuits?: Record<string, number[]>;
  // Nom personnalisé d'un circuit AUTOMATIQUE (non manuel), indexé par le label généré —
  // même convention de clé que couleursCircuits/ordresCircuits/boitesDerivation. Un circuit
  // MANUEL se renomme directement via CircuitManuel.nom (CircuitManuelForm, page.tsx) ; cette
  // liste ne concerne que les circuits que genererCircuits() compose lui-même.
  nomsCircuits?: Record<string, string>;
  // Ids d'appareillages explicitement exclus de la génération automatique de circuits.
  // Posé quand un cheminement dessiné à la main pour un circuit AUTOMATIQUE (voir
  // terminerDessinCheminement, page.tsx) ne clique pas tous ses membres d'origine : plutôt
  // que de réinjecter silencieusement les oubliés dans le même circuit, ils restent
  // explicitement non raccordés (signalé par une alerte) tant que l'utilisateur ne les
  // réinclut pas ou ne les assigne pas lui-même à un circuit (manuel, ou en les recliquant
  // dans un cheminement). Sans effet sur un appareillage déjà rattaché à un circuit manuel
  // (circuitManuelId prioritaire — voir genererCircuits, maison-engine.ts).
  appareillagesExclus?: number[];
  // Point d'arrivée des gaines sur ce niveau (ex: percement de dalle depuis le niveau où
  // se trouve le tableau) — purement informatif, ne participe à aucun calcul de circuit :
  // sert à noter où la gaine technique remonte sur cet étage, distinct de tableauPos qui
  // n'existe que sur le niveau où le tableau est physiquement posé.
  pointArriveeGaines?: Point;
  // Distance (mètres) entre pointArriveeGaines et le tableau électrique, le long de la
  // liaison verticale (gaine technique, autre niveau…) qui n'est pas dessinée sur le plan —
  // paramétrable indépendamment sur chaque étage.
  distanceArriveeGainesTableau?: number;
}

export interface Maison {
  niveaux: Niveau[];
}

export const NIVEAU_TYPES: Record<NiveauType, string> = {
  sous_sol: "Sous-sol", rdc: "RDC", etage: "Étage", combles: "Combles", garage: "Garage",
};

export const PIECE_TYPES: Record<PieceType, { label: string; color: string; stroke: string }> = {
  sejour:      { label: "Séjour",        color: "#DBEAFE", stroke: "#60A5FA" },
  chambre:     { label: "Chambre",       color: "#FCE7F3", stroke: "#F472B6" },
  cuisine:     { label: "Cuisine",       color: "#FEF3C7", stroke: "#FBBF24" },
  sdb:         { label: "Salle de bain", color: "#CFFAFE", stroke: "#22D3EE" },
  wc:          { label: "WC",            color: "#E0E7FF", stroke: "#818CF8" },
  circulation: { label: "Circulation",   color: "#F3F4F6", stroke: "#9CA3AF" },
  exterieur:   { label: "Extérieur",     color: "#D1FAE5", stroke: "#34D399" },
  garage:      { label: "Garage",        color: "#E5E7EB", stroke: "#9CA3AF" },
  autre:       { label: "Autre",         color: "#EDE9FE", stroke: "#A78BFA" },
};

let _uidM = 0;
export const uidMaison = (): number => ++_uidM;

// Ré-amorce le compteur d'id global (partagé entre niveaux, pièces, appareillages,
// coudes de liaison et circuits manuels) après le chargement d'un plan existant.
// Sans ça, uidMaison() redémarre à 1 à chaque rechargement de page et rentre en
// collision avec des id déjà présents dans les données sauvegardées : deux objets
// différents finissent avec le même id, et supprimer/déplacer l'un affecte l'autre
// de façon imprévisible (React les traite comme un seul et même élément).
export function reamorcerCompteurId(niveaux: Niveau[]): void {
  let max = 0;
  niveaux.forEach(n => {
    max = Math.max(max, n.id);
    n.pieces.forEach(p => {
      max = Math.max(max, p.id);
      p.appareillages.forEach(a => { max = Math.max(max, a.id); });
      (p.ouvertures ?? []).forEach(o => { max = Math.max(max, o.id); });
      (p.meubles ?? []).forEach(m => { max = Math.max(max, m.id); });
    });
    (n.circuitsManuels ?? []).forEach(m => { max = Math.max(max, m.id); });
    Object.values(n.liaisonWaypoints ?? {}).forEach(liste => liste.forEach(w => { max = Math.max(max, w.id); }));
    Object.values(n.boitesDerivation ?? {}).forEach(liste => liste.forEach(b => { max = Math.max(max, b.id); }));
  });
  if (max >= _uidM) _uidM = max;
}

// Corrige les id en double (voir reamorcerCompteurId ci-dessus pour la cause) déjà
// présents dans un plan sauvegardé : réattribue un id neuf à chaque doublon rencontré
// (le premier exemplaire garde le sien) et met à jour les références qui pointent
// dessus (commandePourIds, circuitManuelId). N'y touche pas si tout est déjà propre.
export function dedupliquerIds(niveaux: Niveau[]): { niveaux: Niveau[]; corrections: number } {
  const vus = new Set<number>();
  const remapApp = new Map<number, number>();
  const remapManuel = new Map<number, number>();
  let corrections = 0;

  const prendre = (id: number): number => {
    if (!vus.has(id)) { vus.add(id); return id; }
    let nouveau = uidMaison();
    while (vus.has(nouveau)) nouveau = uidMaison();
    vus.add(nouveau);
    corrections++;
    return nouveau;
  };

  // Passe 1 : id définitifs pour chaque objet + table de correspondance ancien -> nouveau.
  const niveauxV1 = niveaux.map(n => {
    const nouvId = prendre(n.id);
    const pieces = n.pieces.map(p => {
      const nouvPId = prendre(p.id);
      const appareillages = p.appareillages.map(a => {
        const nouvAId = prendre(a.id);
        if (nouvAId !== a.id) remapApp.set(a.id, nouvAId);
        return { ...a, id: nouvAId };
      });
      const ouvertures = (p.ouvertures ?? []).map(o => ({ ...o, id: prendre(o.id) }));
      const meubles = (p.meubles ?? []).map(m => ({ ...m, id: prendre(m.id) }));
      return { ...p, id: nouvPId, appareillages, ouvertures: p.ouvertures ? ouvertures : p.ouvertures, meubles: p.meubles ? meubles : p.meubles };
    });
    const circuitsManuels = (n.circuitsManuels ?? []).map(m => {
      const nouvMId = prendre(m.id);
      if (nouvMId !== m.id) remapManuel.set(m.id, nouvMId);
      return { ...m, id: nouvMId };
    });
    return { ...n, id: nouvId, pieces, circuitsManuels: n.circuitsManuels ? circuitsManuels : n.circuitsManuels };
  });

  if (corrections === 0) return { niveaux, corrections: 0 };

  // Passe 2 : réécrit les références vers les id qui ont changé.
  const niveauxV2 = niveauxV1.map(n => ({
    ...n,
    pieces: n.pieces.map(p => ({
      ...p,
      appareillages: p.appareillages.map(a => ({
        ...a,
        commandePourIds: a.commandePourIds?.map(id => remapApp.get(id) ?? id),
        circuitManuelId: a.circuitManuelId != null ? (remapManuel.get(a.circuitManuelId) ?? a.circuitManuelId) : a.circuitManuelId,
      })),
    })),
  }));

  return { niveaux: niveauxV2, corrections };
}

// Migration : Niveau.boitesDerivation stockait autrefois un point unique par circuit
// (Record<label, Point>). Il stocke maintenant une LISTE de boîtes nommées, déplaçables
// indépendamment (Record<label, BoiteDerivation[]>) — pour permettre plusieurs boîtes de
// dérivation sur un même circuit d'éclairage. Convertit en place un plan déjà sauvegardé
// (ancien format) au chargement : sans cette conversion, une boîte déjà positionnée sur un
// plan existant ferait planter la génération (un Point brut là où un tableau est attendu).
export function migrerBoitesDerivation(niveaux: Niveau[]): void {
  niveaux.forEach(n => {
    const brut = n.boitesDerivation as unknown as Record<string, Point | BoiteDerivation[]> | undefined;
    if (!brut) return;
    const migre: Record<string, BoiteDerivation[]> = {};
    Object.entries(brut).forEach(([label, valeur]) => {
      if (Array.isArray(valeur)) {
        migre[label] = valeur;
      } else if (valeur && typeof valeur === "object" && "x" in valeur && "y" in valeur) {
        migre[label] = [{ id: uidMaison(), nom: "Boîte 1", point: valeur as Point }];
      }
    });
    n.boitesDerivation = migre;
  });
}

export const nouveauNiveau = (type: NiveauType = "rdc", ordre = 0): Niveau => ({
  id: uidMaison(), nom: "", type, ordre, pieces: [],
});
export const nouvellePiece = (contour: Point[], nom = "", type: PieceType = "autre"): Piece => ({
  id: uidMaison(), nom, type, contour, appareillages: [],
});
// Puissance par défaut appliquée à la création d'un chauffage — modifiable ensuite depuis
// le panneau de l'appareillage sélectionné (voir PUISSANCE_CHAUFFAGE_DEFAUT_W, electrical-constants.ts).
const PUISSANCE_CHAUFFAGE_DEFAUT_W = 1000;
export const nouvelAppareillage = (type: AppareillageType, x: number, y: number): AppareillagePlace => ({
  id: uidMaison(), type, x, y,
  ...(type === "chauffage" ? { puissanceW: PUISSANCE_CHAUFFAGE_DEFAUT_W } : {}),
});
// Dimensions de départ raisonnables (une petite table/desserte) — modifiables ensuite
// depuis le panneau du meuble sélectionné.
export const nouveauMeuble = (x: number, y: number): MeubleSimple => ({
  id: uidMaison(), x, y, largeur: 0.6, profondeur: 0.4, hauteur: 0.75,
});

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Déplace le point d'arrivée d'un segment (contour[segIndex+1]) le long de sa direction
// actuelle pour lui donner la longueur voulue, en gardant contour[segIndex] fixe.
export function ajusterLongueurContour(contour: Point[], segIndex: number, nouvelleLongueur: number): Point[] {
  const n = contour.length;
  const a = contour[segIndex];
  const b = contour[(segIndex + 1) % n];
  if (!a || !b) return contour;
  const dx = b.x - a.x, dy = b.y - a.y;
  const longueurActuelle = Math.hypot(dx, dy);
  if (longueurActuelle < 0.001) return contour;
  const ratio = nouvelleLongueur / longueurActuelle;
  const nouveauB: Point = { x: a.x + dx * ratio, y: a.y + dy * ratio };
  return contour.map((pt, i) => (i === (segIndex + 1) % n ? nouveauB : pt));
}

export function aireDuPolygone(points: Point[]): number {
  if (points.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i], p2 = points[(i + 1) % points.length];
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(a / 2);
}

export function centroide(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const s = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / points.length, y: s.y / points.length };
}

export function pointDansPolygone(pt: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function trouverPiece(pt: Point, pieces: Piece[]): Piece | null {
  for (const p of pieces) {
    if (pointDansPolygone(pt, p.contour)) return p;
  }
  return null;
}

export function distanceAuSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

// Distance (mètres) au mur le plus proche du contour — dérivée de la position,
// pas saisie manuellement : bouge l'appareillage et elle se recalcule seule.
export function distanceAuMurLePlusProche(point: Point, contour: Point[]): number {
  let min = Infinity;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length];
    min = Math.min(min, distanceAuSegment(point, a, b));
  }
  return min;
}

// Distance (mètres) de point à CHAQUE mur du contour, dans l'ordre des segments —
// utilisé pour permettre de caler un appareillage par rapport à n'importe quel mur
// de la pièce (pas seulement le plus proche).
export function distancesTousLesMurs(point: Point, contour: Point[]): number[] {
  return contour.map((a, i) => distanceAuSegment(point, a, contour[(i + 1) % contour.length]));
}

function segmentLePlusProche(point: Point, contour: Point[]): number {
  let bestIdx = 0, bestD = Infinity;
  for (let i = 0; i < contour.length; i++) {
    const d = distanceAuSegment(point, contour[i], contour[(i + 1) % contour.length]);
    if (d < bestD) { bestD = d; bestIdx = i; }
  }
  return bestIdx;
}

// Point le plus proche de p sur le segment [a, b] (projection bornée au segment).
function pointLePlusProcheSurSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return a;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// Position (0..1) du point le plus proche de p sur le segment [a, b] — utilisé pour
// glisser une porte/fenêtre le long du mur qui la porte (placement et drag).
export function positionSurSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  return Math.max(0, Math.min(1, t));
}

// Repositionne un appareillage pour qu'il soit exactement à distanceCible (mètres) du
// mur donné (segIndex du contour), en gardant sa position "le long de ce mur" (le pied
// de la perpendiculaire) inchangée — seul l'écart à CE mur change. Si le point est
// confondu avec le mur (distance nulle), utilise la normale du segment orientée vers
// l'intérieur de la pièce (côté du centroïde).
export function positionnerADistanceDuSegment(point: Point, contour: Point[], segIndex: number, distanceCible: number): Point {
  const a = contour[segIndex], b = contour[(segIndex + 1) % contour.length];
  if (!a || !b) return point;
  const pied = pointLePlusProcheSurSegment(point, a, b);
  let dx = point.x - pied.x, dy = point.y - pied.y;
  let norme = Math.hypot(dx, dy);
  if (norme < 0.001) {
    const segDx = b.x - a.x, segDy = b.y - a.y;
    const segLen = Math.hypot(segDx, segDy) || 1;
    let nx = -segDy / segLen, ny = segDx / segLen;
    const c = centroide(contour);
    const versCentre = { x: c.x - pied.x, y: c.y - pied.y };
    if (nx * versCentre.x + ny * versCentre.y < 0) { nx = -nx; ny = -ny; }
    dx = nx; dy = ny; norme = 1;
  }
  const ux = dx / norme, uy = dy / norme;
  return { x: pied.x + ux * distanceCible, y: pied.y + uy * distanceCible };
}

// Même chose mais vis-à-vis du mur le plus proche (raccourci pratique).
export function positionnerADistanceDuMur(point: Point, contour: Point[], distanceCible: number): Point {
  return positionnerADistanceDuSegment(point, contour, segmentLePlusProche(point, contour), distanceCible);
}

// Ordonne une liste de points par plus-proche-voisin à partir d'un point de départ
// ─── TRACÉ DES CIRCUITS AVEC POINTS DE COUDE MANUELS ───────────────────────────
// Une ancre est soit le tableau ("tableau"), soit un appareillage (son id en texte).
// La clé de segment est stable d'une génération de circuits à l'autre (contrairement
// au circuitId, qui change à chaque clic sur "Générer") — les coudes posés à la main
// survivent donc à une regénération.

export interface AncrePoint { id: string; point: Point; }

export function ordonnerAncresParProximite(depart: Point, items: AncrePoint[]): AncrePoint[] {
  const remaining = [...items];
  const ordered: AncrePoint[] = [];
  let last = depart;
  while (remaining.length > 0) {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = (remaining[i].point.x - last.x) ** 2 + (remaining[i].point.y - last.y) ** 2;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    last = next.point;
  }
  return ordered;
}

export function cleSegmentLiaison(idA: string, idB: string): string {
  return `${idA}->${idB}`;
}

// Suite ordonnée des ancres d'un circuit : tableau puis chaque appareillage, par proximité.
// relieAuTableau=false (circuit manuel "déjà existant", voir CircuitManuel.nonRelieTableau) :
// aucune ancre "tableau" n'est ajoutée — la chaîne part directement du premier membre (le
// plus proche de `depart`, simple repère pour un point de départ cohérent), sans segment
// tracé vers l'extérieur pour l'atteindre.
export function sequenceAncresCircuit(depart: Point, points: AppareillagePlace[], relieAuTableau: boolean = true): AncrePoint[] {
  const ancres: AncrePoint[] = points.map(a => ({ id: String(a.id), point: { x: a.x, y: a.y } }));
  if (!relieAuTableau) return ordonnerAncresParProximite(depart, ancres);
  return [{ id: "tableau", point: depart }, ...ordonnerAncresParProximite(depart, ancres)];
}

// Même suite d'ancres que sequenceAncresCircuit, mais suivant un ordre choisi à la main
// (liste d'ids d'appareillages, voir Niveau.ordresCircuits) plutôt que le plus-proche-voisin
// automatique — pour un cheminement de câble plus logique (moins d'allers-retours, contourne
// un obstacle…) sur un circuit en chaîne. Tout appareillage du circuit absent de `ordre`
// (ajouté au plan après l'enregistrement de l'ordre) est ajouté à la suite, par proximité à
// partir du dernier point ordonné — jamais perdu du tracé. relieAuTableau : voir
// sequenceAncresCircuit ci-dessus.
export function sequenceAncresCircuitOrdonnee(depart: Point, points: AppareillagePlace[], ordre: number[], relieAuTableau: boolean = true): AncrePoint[] {
  const parId = new Map(points.map(a => [a.id, a]));
  const vus = new Set<number>();
  const ancres: AncrePoint[] = [];
  ordre.forEach(id => {
    const a = parId.get(id);
    if (a && !vus.has(id)) {
      ancres.push({ id: String(a.id), point: { x: a.x, y: a.y } });
      vus.add(id);
    }
  });
  const restants = points.filter(a => !vus.has(a.id)).map(a => ({ id: String(a.id), point: { x: a.x, y: a.y } }));
  const dernierPoint = ancres.length > 0 ? ancres[ancres.length - 1].point : depart;
  const suite = [...ancres, ...ordonnerAncresParProximite(dernierPoint, restants)];
  return relieAuTableau ? [{ id: "tableau", point: depart }, ...suite] : suite;
}

// Chemin complet (mètres) en insérant les points de coude manuels présents dans waypoints.
export function construireCheminCircuit(depart: Point, points: AppareillagePlace[], waypoints: LiaisonWaypoints | undefined): Point[] {
  const sequence = sequenceAncresCircuit(depart, points);
  const chemin: Point[] = [sequence[0].point];
  for (let i = 0; i < sequence.length - 1; i++) {
    const cle = cleSegmentLiaison(sequence[i].id, sequence[i + 1].id);
    const wps = waypoints?.[cle] ?? [];
    wps.forEach(w => chemin.push(w.point));
    chemin.push(sequence[i + 1].point);
  }
  return chemin;
}

function longueurChemin(chemin: Point[]): number {
  let total = 0;
  for (let i = 0; i < chemin.length - 1; i++) total += distance(chemin[i], chemin[i + 1]);
  return total;
}

export function longueurCircuitAvecWaypoints(depart: Point, points: AppareillagePlace[], waypoints: LiaisonWaypoints | undefined): number {
  return longueurChemin(construireCheminCircuit(depart, points, waypoints));
}

// ─── ONDULATION D'UN SEGMENT (visualisation "sans fil") ────────────────────────
// Génère une suite de points en mètres formant une onde sinusoïdale entre a et b —
// utilisée pour représenter visuellement une liaison "particulière" (domotique/sans fil,
// voir AppareillagePlace.domotique et SegmentCircuit.type "domotique" ci-dessous) par un
// symbole d'onde plutôt qu'un trait plein, sur le rendu 2D, l'impression et la vue 3D
// (chacun mappe ensuite ces points meters vers son propre repère d'affichage).
export function pointsOndulesEntre(a: Point, b: Point, amplitude = 0.06, longueurOnde = 0.25): Point[] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const longueur = Math.hypot(dx, dy);
  if (longueur < 0.001) return [a, b];
  const ux = dx / longueur, uy = dy / longueur;
  const nx = -uy, ny = ux;
  const nbPeriodes = Math.max(1, Math.round(longueur / longueurOnde));
  const nbPoints = nbPeriodes * 8;
  const pts: Point[] = [];
  for (let i = 0; i <= nbPoints; i++) {
    const t = i / nbPoints;
    const d = t * longueur;
    const phase = (d / longueurOnde) * Math.PI * 2;
    const off = Math.sin(phase) * amplitude;
    pts.push({ x: a.x + ux * d + nx * off, y: a.y + uy * d + ny * off });
  }
  return pts;
}

// ─── TOPOLOGIE EN ÉTOILE DES CIRCUITS D'ÉCLAIRAGE (boîte de dérivation) ────────
// Une chaîne série (tableau → lampe1 → lampe2 → …) n'a aucun sens électriquement :
// en pratique, le câble arrive du tableau à UNE boîte de dérivation, d'où repart une
// ligne indépendante vers chaque point lumineux du circuit — et chaque interrupteur
// ne se raccorde qu'au(x) point(s) lumineux qu'il commande, jamais en série avec le
// reste du circuit. Ces fonctions construisent cette topologie (utilisées par le
// rendu 2D et la vue 3D) au lieu de la simple chaîne par plus-proche-voisin.

export interface SegmentCircuit { aId: string; aPoint: Point; bId: string; bPoint: Point; type?: "navette" | "domotique"; }

export function centroidePoints(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
}

// tableau -> boîte(s) de dérivation, chaînées dans l'ordre où elles ont été créées
// (tableau -> boîte 1 -> boîte 2 -> …) ; sans boîte nommée, comportement historique — une
// boîte implicite unique (si ≥ 2 lampes) ou lien direct (1 seule lampe).
// boîte -> chaque lampe qui lui est la plus proche (étoile depuis CETTE boîte, jamais
// toutes les lampes reliées à toutes les boîtes ni en série entre elles).
// Un point lumineux impliqué dans au moins une liaison directe (liaisonsDirectes, voir
// Niveau.liaisonsDirectesLumiere) sort de cette topologie en étoile : les lampes reliées
// entre elles forment leurs propres composantes connexes, chacune raccordée UNE SEULE FOIS
// (à sa lampe d'entrée la plus proche) à la boîte la plus proche du groupe — ou au tableau
// s'il n'y a aucune boîte — puis chaînées de lampe en lampe selon les liaisons posées.
// point lumineux -> commande(s) : un interrupteur simple ou un télérupteur (par bouton
// poussoir) se raccorde indépendamment à la lampe, comme avant. Un groupe de va-et-vient
// commandant la MÊME lampe, en revanche, ne se câble PAS chacun indépendamment vers la
// lampe : électriquement, seul le premier (le plus proche) reçoit le retour lampe — les
// suivants sont câblés EN CHAÎNE avec leur voisin précédent via les fils navette. Ces
// segments navette sont marqués (type: "navette") pour être distingués visuellement
// (couleur plus sombre) du reste du tracé, voir assombrirCouleur ci-dessous. Une commande
// domotique (AppareillagePlace.domotique) — quel que soit son type (simple, va-et-vient,
// télérupteur) — n'a pas de câblage physique retour/navette vers sa lampe : le segment est
// marqué (type: "domotique") pour être tracé sous forme d'onde plutôt qu'un trait plein.
export function construireBranchesCircuitEclairage(
  depart: Point, boites: BoiteDerivation[], lumieres: AppareillagePlace[], commandes: AppareillagePlace[],
  liaisonsDirectes: [number, number][] = [], relieAuTableau: boolean = true,
): SegmentCircuit[] {
  const segments: SegmentCircuit[] = [];
  const idsLumieres = new Set(lumieres.map(l => l.id));
  const liaisonsValides = liaisonsDirectes.filter(([a, b]) => idsLumieres.has(a) && idsLumieres.has(b));
  const lumiereParId = new Map(lumieres.map(l => [l.id, l]));

  // Composantes connexes de lampes reliées directement entre elles (sans boîte).
  const adjacence = new Map<number, number[]>();
  liaisonsValides.forEach(([a, b]) => {
    if (!adjacence.has(a)) adjacence.set(a, []);
    if (!adjacence.has(b)) adjacence.set(b, []);
    adjacence.get(a)!.push(b);
    adjacence.get(b)!.push(a);
  });
  const visites = new Set<number>();
  const composantes: number[][] = [];
  adjacence.forEach((_voisins, id) => {
    if (visites.has(id)) return;
    const composante: number[] = [];
    const pile = [id];
    while (pile.length > 0) {
      const cur = pile.pop()!;
      if (visites.has(cur)) continue;
      visites.add(cur);
      composante.push(cur);
      (adjacence.get(cur) ?? []).forEach(v => { if (!visites.has(v)) pile.push(v); });
    }
    composantes.push(composante);
  });
  const idsDansComposante = new Set(composantes.flat());
  const lumieresLibres = lumieres.filter(l => !idsDansComposante.has(l.id));

  // Ancre (boîte la plus proche si des boîtes existent, sinon le tableau directement) vers
  // laquelle raccorder l'entrée d'un groupe de lampes chaînées. null = aucune ancre externe
  // à tracer — cas d'un circuit "déjà existant" (relieAuTableau=false, voir
  // CircuitManuel.nonRelieTableau) sans boîte : rien ne part vers l'extérieur.
  const ancrerVersBoiteOuTableau = (cible: Point): { id: string; point: Point } | null => {
    if (boites.length === 0) return relieAuTableau ? { id: "tableau", point: depart } : null;
    let plusProche = boites[0];
    let meilleureDistance = distance(boites[0].point, cible);
    boites.forEach(b => { const d = distance(b.point, cible); if (d < meilleureDistance) { meilleureDistance = d; plusProche = b; } });
    return { id: `boite-${plusProche.id}`, point: plusProche.point };
  };

  if (boites.length === 0) {
    if (relieAuTableau) {
      if (lumieresLibres.length <= 1) {
        lumieresLibres.forEach(l => segments.push({ aId: "tableau", aPoint: depart, bId: String(l.id), bPoint: { x: l.x, y: l.y } }));
      } else {
        const centre = centroidePoints(lumieresLibres.map(l => ({ x: l.x, y: l.y })));
        segments.push({ aId: "tableau", aPoint: depart, bId: "boite", bPoint: centre });
        lumieresLibres.forEach(l => segments.push({ aId: "boite", aPoint: centre, bId: String(l.id), bPoint: { x: l.x, y: l.y } }));
      }
    } else if (lumieresLibres.length > 1) {
      // Non relié au tableau : les lampes libres se maillent quand même entre elles via
      // une boîte implicite, mais aucun segment ne part vers l'extérieur (déjà alimenté
      // par l'installation existante). Avec 0 ou 1 lampe libre : rien à tracer.
      const centre = centroidePoints(lumieresLibres.map(l => ({ x: l.x, y: l.y })));
      lumieresLibres.forEach(l => segments.push({ aId: "boite", aPoint: centre, bId: String(l.id), bPoint: { x: l.x, y: l.y } }));
    }
  } else {
    // Relié : chaîne complète tableau -> boîte 1 -> boîte 2 -> …
    // Non relié : la première boîte devient elle-même l'origine, aucun segment vers
    // l'extérieur pour l'atteindre — seul le chaînage boîte à boîte suivant reste tracé.
    let precedentId = relieAuTableau ? "tableau" : `boite-${boites[0].id}`;
    let precedentPoint = relieAuTableau ? depart : boites[0].point;
    const boitesAChainer = relieAuTableau ? boites : boites.slice(1);
    boitesAChainer.forEach(boite => {
      const id = `boite-${boite.id}`;
      segments.push({ aId: precedentId, aPoint: precedentPoint, bId: id, bPoint: boite.point });
      precedentId = id;
      precedentPoint = boite.point;
    });
    lumieresLibres.forEach(l => {
      let plusProche = boites[0];
      let meilleureDistance = distance(boites[0].point, l);
      boites.forEach(boite => {
        const d = distance(boite.point, l);
        if (d < meilleureDistance) { meilleureDistance = d; plusProche = boite; }
      });
      segments.push({ aId: `boite-${plusProche.id}`, aPoint: plusProche.point, bId: String(l.id), bPoint: { x: l.x, y: l.y } });
    });
  }

  // Composantes de lampes chaînées directement entre elles : une seule entrée depuis la
  // boîte la plus proche (ou le tableau, si relié) vers la lampe d'entrée du groupe, puis
  // chaînage point à point entre les lampes reliées — aucune boîte de dérivation nécessaire
  // ici. Si aucune ancre externe n'existe (non relié, sans boîte), seul le chaînage interne
  // est tracé, sans entrée.
  composantes.forEach(idsGroupe => {
    const lampesGroupe = idsGroupe.map(id => lumiereParId.get(id)).filter((l): l is AppareillagePlace => !!l);
    if (lampesGroupe.length === 0) return;
    const centreGroupe = centroidePoints(lampesGroupe.map(l => ({ x: l.x, y: l.y })));
    const ancre = ancrerVersBoiteOuTableau(centreGroupe);
    if (ancre) {
      let entree = lampesGroupe[0];
      let meilleureDistance = distance(ancre.point, entree);
      lampesGroupe.forEach(l => { const d = distance(ancre.point, l); if (d < meilleureDistance) { meilleureDistance = d; entree = l; } });
      segments.push({ aId: ancre.id, aPoint: ancre.point, bId: String(entree.id), bPoint: { x: entree.x, y: entree.y } });
    }
    liaisonsValides
      .filter(([a, b]) => idsGroupe.includes(a) && idsGroupe.includes(b))
      .forEach(([a, b]) => {
        const la = lumiereParId.get(a), lb = lumiereParId.get(b);
        if (la && lb) segments.push({ aId: String(a), aPoint: { x: la.x, y: la.y }, bId: String(b), bPoint: { x: lb.x, y: lb.y } });
      });
  });

  lumieres.forEach(l => {
    const commandesDeCetteLampe = commandes.filter(c => c.commandePourIds?.includes(l.id));
    const vaEtVient = commandesDeCetteLampe
      .filter(c => c.type === "va_et_vient")
      .sort((c1, c2) => distance({ x: c1.x, y: c1.y }, l) - distance({ x: c2.x, y: c2.y }, l));
    const autres = commandesDeCetteLampe.filter(c => c.type !== "va_et_vient");

    vaEtVient.forEach((c, i) => {
      if (i === 0) {
        segments.push({
          aId: String(l.id), aPoint: { x: l.x, y: l.y }, bId: String(c.id), bPoint: { x: c.x, y: c.y },
          type: c.domotique ? "domotique" : undefined,
        });
      } else {
        const precedent = vaEtVient[i - 1];
        segments.push({
          aId: String(precedent.id), aPoint: { x: precedent.x, y: precedent.y },
          bId: String(c.id), bPoint: { x: c.x, y: c.y }, type: c.domotique ? "domotique" : "navette",
        });
      }
    });

    autres.forEach(c => {
      segments.push({
        aId: String(l.id), aPoint: { x: l.x, y: l.y }, bId: String(c.id), bPoint: { x: c.x, y: c.y },
        type: c.domotique ? "domotique" : undefined,
      });
    });
  });
  return segments;
}

// Chemin d'UN segment de la topologie en étoile, coudes manuels compris (même clé stable
// aId->bId que pour une chaîne classique — les coudes posés à la main restent valides).
export function cheminSegment(seg: SegmentCircuit, waypoints: LiaisonWaypoints | undefined): Point[] {
  const cle = cleSegmentLiaison(seg.aId, seg.bId);
  const wps = waypoints?.[cle] ?? [];
  return [seg.aPoint, ...wps.map(w => w.point), seg.bPoint];
}

export function longueurBranchesEclairage(segments: SegmentCircuit[], waypoints: LiaisonWaypoints | undefined): number {
  return segments.reduce((total, seg) => total + longueurChemin(cheminSegment(seg, waypoints)), 0);
}

// Palette de couleurs procédurale pour distinguer les circuits sur le plan/l'impression.
const TEINTES = [0, 210, 140, 280, 40, 320, 170, 60, 250, 10, 190, 95];
export function couleurCircuit(index: number): string {
  return `hsl(${TEINTES[index % TEINTES.length]}, 70%, 42%)`;
}

// Assombrit une couleur de circuit (hex "#RRGGBB" choisi au sélecteur, ou hsl(...)
// procédurale de couleurCircuit()) — utilisé pour distinguer visuellement la liaison
// (navette) entre deux va-et-vient du reste du tracé, tout en restant clairement
// rattachée à la couleur de son circuit (même teinte, plus foncée). Formats inconnus
// renvoyés inchangés plutôt que de produire une couleur incorrecte.
export function assombrirCouleur(couleur: string, facteur = 0.55): string {
  const matchHsl = couleur.match(/^hsl\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%\)$/);
  if (matchHsl) {
    const [, h, s, l] = matchHsl;
    return `hsl(${h}, ${s}%, ${Math.max(0, parseFloat(l) * facteur).toFixed(1)}%)`;
  }
  const matchHex = couleur.match(/^#([0-9a-fA-F]{6})$/);
  if (matchHex) {
    const n = parseInt(matchHex[1], 16);
    const r = Math.round(((n >> 16) & 255) * facteur);
    const g = Math.round(((n >> 8) & 255) * facteur);
    const b = Math.round((n & 255) * facteur);
    const clamp = (v: number) => Math.max(0, Math.min(255, v));
    return `#${[r, g, b].map(v => clamp(v).toString(16).padStart(2, "0")).join("")}`;
  }
  return couleur;
}
