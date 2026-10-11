// src/lib/schema-technique.ts
//
// MODÈLE DU SCHÉMA TECHNIQUE D'UN CIRCUIT. Part des segments du plan (segmentsPourCircuit — la même topologie que le tracé, les longueurs
// et le pré-devis) et y ajoute ce qui sort du circuit : les lampes d'un AUTRE circuit pilotées par une commande de celui-ci, et les
// commandes d'un autre circuit qui pilotent une lampe de celui-ci (seul le NOM de l'autre circuit est indiqué).
import type { AppareillagePlace, BoiteDerivation, Point, SegmentCircuit } from "@/lib/maison-types";
import { estCommande, estCommandeDouble, estLumiere } from "@/lib/maison-types";

export type GenreNoeud = "tableau" | "boite" | "lampe" | "commande" | "externe" | "autre";
export interface NoeudSchema { titre: string; sous?: string; lignes?: string[]; genre: GenreNoeud }

export interface AppareilNiveau { a: AppareillagePlace; piece: string }

export interface EntreeSchema {
  circuitId: number;
  libelleTableau: string;               // « 10 A · Lumière RDC »
  points: AppareillagePlace[];          // appareillages DU circuit
  tous: AppareilNiveau[];               // tous les appareillages du niveau (pour retrouver les lampes / commandes d'autres circuits)
  segments: SegmentCircuit[];
  boites: BoiteDerivation[];
  libelle: (a: AppareillagePlace) => string;
  nomCircuit: (circuitId: number | undefined) => string;
}

export interface SchemaTechnique { noeuds: Record<string, NoeudSchema>; segments: SegmentCircuit[]; avertissements: string[]; voieExterne: Record<string, 0 | 1> }

const ORIGINE: Point = { x: 0, y: 0 };
const LETTRES = ["A", "B"];

export function construireSchemaTechnique(e: EntreeSchema): SchemaTechnique {
  const parId = new Map(e.tous.map(t => [t.a.id, t] as const));
  const noeuds: Record<string, NoeudSchema> = {
    tableau: { titre: "Tableau", sous: e.libelleTableau, genre: "tableau" },
    boite: { titre: "Boîte de dérivation", sous: "Bornes Wago 221", genre: "boite" },
  };
  e.boites.forEach(b => { noeuds[`boite-${b.id}`] = { titre: b.nom || "Boîte de dérivation", sous: "Bornes Wago 221", genre: "boite" }; });
  const segments = e.segments.map(sg => ({ ...sg }));
  const avertissements: string[] = [];
  const voieExterne: Record<string, 0 | 1> = {};
  const nomsLampes = (ids: number[] | undefined) => (ids ?? []).map(id => parId.get(id)).filter((t): t is AppareilNiveau => !!t)
    .map(t => t.piece).filter((v, i, tab) => tab.indexOf(v) === i).join(" + ");

  e.points.forEach(a => {
    const piece = parId.get(a.id)?.piece;
    if (estLumiere(a.type)) { noeuds[String(a.id)] = { titre: e.libelle(a), sous: piece, genre: "lampe" }; return; }
    if (estCommande(a.type)) {
      const lignes: string[] = [];
      if (estCommandeDouble(a.type)) {
        lignes.push(`Voie A → ${nomsLampes(a.commandePourIds) || "—"}`);
        lignes.push(`Voie B → ${nomsLampes(a.commandePourIds2) || "—"}`);
      } else {
        const cibles = nomsLampes([...(a.commandePourIds ?? []), ...(a.commandePourIds2 ?? [])]);
        if (a.type === "detecteur_mouvement" || a.type === "detecteur_mouvement_exterieur") {
          lignes.push("L phase permanente · N neutre");
          if (cibles) lignes.push(`Sortie L' → ${cibles}`);
          // Autres commandes sur les mêmes lampes : montées en parallèle (l'interrupteur force l'allumage, le détecteur reste actif).
          const mes = new Set([...(a.commandePourIds ?? []), ...(a.commandePourIds2 ?? [])]);
          const autres = e.tous.filter(t => t.a.id !== a.id && estCommande(t.a.type) && !t.a.domotique
            && [...(t.a.commandePourIds ?? []), ...(t.a.commandePourIds2 ?? [])].some(id => mes.has(id)));
          if (autres.length > 0) lignes.push(`// ${autres.map(t => e.libelle(t.a)).join(", ")} (marche forcée)`);
        } else if (cibles) lignes.push(`→ ${cibles}`);
      }
      noeuds[String(a.id)] = { titre: e.libelle(a), sous: [piece, a.domotique ? "domotique" : ""].filter(Boolean).join(" · "), lignes, genre: "commande" };
      return;
    }
    noeuds[String(a.id)] = { titre: e.libelle(a), sous: piece, genre: "autre" };
  });

  // Navettes entre deux commandes : le plan ne connaît que les lampes de CE circuit. Si une voie de la commande pilote une lampe d'un autre
  // circuit, ses fils de navette traversent quand même ce câble : on compte les voies à partir de TOUTES les lampes.
  const lampesVoie = (c: AppareillagePlace, v: 0 | 1) => (v === 0 ? c.commandePourIds : c.commandePourIds2) ?? [];
  segments.forEach(sg => {
    if (sg.type !== "navette") return;
    const c1 = parId.get(Number(sg.aId))?.a, c2 = parId.get(Number(sg.bId))?.a;
    if (!c1 || !c2) return;
    let n = 0;
    ([0, 1] as const).forEach(v => {
      const l1 = lampesVoie(c1, v);
      if (l1.length > 0 && (lampesVoie(c2, 0).some(x => l1.includes(x)) || lampesVoie(c2, 1).some(x => l1.includes(x)))) n++;
    });
    if (n > (sg.voies ?? 1)) sg.voies = n;
  });

  // Commandes de CE circuit qui pilotent une lampe d'un AUTRE circuit : on affiche le circuit alimenté (son nom seulement).
  // Pour chaque lampe étrangère, seule la DERNIÈRE commande de la chaîne (celle qui n'envoie pas de navette à une autre commande
  // de la même lampe) porte le retour vers la lampe.
  const commandesCircuit = e.points.filter(a => estCommande(a.type));
  const lampesEtrangeres = new Map<number, AppareilNiveau>();
  commandesCircuit.forEach(c => [...(c.commandePourIds ?? []), ...(c.commandePourIds2 ?? [])].forEach(id => {
    const t = parId.get(id);
    if (t && estLumiere(t.a.type) && t.a.circuitId !== e.circuitId) lampesEtrangeres.set(id, t);
  }));
  const sortants = new Set<string>();
  lampesEtrangeres.forEach((t, lampeId) => {
    const K = commandesCircuit.filter(c => (c.commandePourIds ?? []).includes(lampeId) || (c.commandePourIds2 ?? []).includes(lampeId));
    const idsK = new Set(K.map(c => String(c.id)));
    const dernieres = K.filter(c => !segments.some(sg => sg.aId === String(c.id) && idsK.has(sg.bId) && sg.type === "navette"));
    const nom = e.nomCircuit(t.a.circuitId);
    const cle = `ext-aval-${t.a.circuitId ?? "aucun"}`;
    noeuds[cle] = { titre: `Circuit « ${nom} »`, sous: "alimenté par cette commande", genre: "externe" };
    (dernieres.length > 0 ? dernieres : K).forEach(c => {
      const lien = `${c.id}->${cle}`;
      if (sortants.has(lien)) return;
      sortants.add(lien);
      segments.push({ aId: String(c.id), aPoint: ORIGINE, bId: cle, bPoint: ORIGINE, type: "retour" });
      voieExterne[lien] = c.commandePourIds?.includes(lampeId) ? 0 : 1;
    });
  });

  // Lampes de CE circuit pilotées par une commande d'un AUTRE circuit (un repère par circuit d'origine et par lampe).
  e.points.filter(a => estLumiere(a.type)).forEach(l => {
    const dejaVu = new Set<string>();
    e.tous.filter(t => estCommande(t.a.type) && t.a.circuitId !== e.circuitId
      && ((t.a.commandePourIds ?? []).includes(l.id) || (t.a.commandePourIds2 ?? []).includes(l.id))).forEach(t => {
      const origine = String(t.a.circuitId ?? "aucun");
      if (dejaVu.has(origine)) return;
      dejaVu.add(origine);
      const nom = e.nomCircuit(t.a.circuitId);
      const cle = `ext-amont-${origine}-${l.id}`;
      const voie = t.a.commandePourIds?.includes(l.id) ? 0 : 1;
      noeuds[cle] = { titre: `Circuit « ${nom} »`, sous: `commande ${e.libelle(t.a).toLowerCase()}${estCommandeDouble(t.a.type) ? ` · voie ${LETTRES[voie]}` : ""}`, genre: "externe" };
      segments.push({ aId: cle, aPoint: ORIGINE, bId: String(l.id), bPoint: ORIGINE, type: "retour" });
      avertissements.push(`${e.libelle(l)} (${parId.get(l.id)?.piece ?? "?"}) est commandé depuis le circuit « ${nom} » : sa phase vient de cet autre circuit — à vérifier (un point lumineux ne devrait dépendre que d'un seul circuit).`);
    });
  });

  return { noeuds, segments, avertissements, voieExterne };
}
