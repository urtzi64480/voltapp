// src/lib/checklist-fin-chantier.ts
//
// Contrôles de fin de chantier : une proposition PAR DÉFAUT, mais c'est l'électricien qui choisit, chantier par chantier,
// lesquels il réalise (et donc lesquels figurent dans le PDF remis au client).
// Module pur (aucun accès réseau) : stocké dans la même colonne suivi_realisation que le reste du suivi.
//
// Règle du projet : les normes alertent, elles ne bloquent jamais — et les seuils chiffrés NF C 15-100 sont « à vérifier ».
// Le catalogue n'affirme donc AUCUN seuil : on consigne seulement les valeurs réellement mesurées.

export interface ControleDef {
  id: string;
  categorie: string;
  libelle: string;
  aide?: string;
  parDefaut: boolean;
  /** Si présent : valeur mesurée à consigner (ex. « Ω », « mA »). */
  mesure?: string;
}

export const CATALOGUE_CONTROLES: ControleDef[] = [
  { id: "visuel-general", categorie: "Inspection", libelle: "Contrôle visuel de l'installation", aide: "Matériel fixé, sans dommage, conforme au devis", parDefaut: true },
  { id: "serrage-bornes", categorie: "Inspection", libelle: "Serrage des connexions et bornes", aide: "Tableau, appareillages, luminaires", parDefaut: true },
  { id: "reperage-circuits", categorie: "Inspection", libelle: "Repérage des circuits au tableau", aide: "Étiquetage lisible de chaque protection", parDefaut: true },
  { id: "continuite-pe", categorie: "Mesures", libelle: "Continuité du conducteur de protection (terre)", parDefaut: true },
  { id: "resistance-terre", categorie: "Mesures", libelle: "Résistance de la prise de terre", parDefaut: true, mesure: "Ω" },
  { id: "isolement", categorie: "Mesures", libelle: "Résistance d'isolement des circuits", parDefaut: false, mesure: "MΩ" },
  { id: "essai-dd", categorie: "Essais", libelle: "Essai de déclenchement des interrupteurs différentiels", aide: "Bouton test + essai en charge", parDefaut: true },
  { id: "essai-disjoncteurs", categorie: "Essais", libelle: "Fonctionnement des disjoncteurs et circuits", parDefaut: true },
  { id: "essai-prises", categorie: "Essais", libelle: "Test de chaque prise et point lumineux", aide: "Présence tension, polarité, terre", parDefaut: true },
  { id: "essai-luminaires", categorie: "Essais", libelle: "Fonctionnement de l'éclairage et des commandes", parDefaut: false },
  { id: "detecteur-fumee", categorie: "Sécurité", libelle: "Détecteur de fumée (présence et test)", parDefaut: false },
  { id: "liaison-equipotentielle", categorie: "Sécurité", libelle: "Liaison équipotentielle (salle d'eau)", parDefaut: false },
  { id: "parafoudre", categorie: "Sécurité", libelle: "Vérification du parafoudre (si installé)", parDefaut: false },
  { id: "explications-client", categorie: "Remise", libelle: "Explications données au client (tableau, coupure, différentiels)", parDefaut: true },
  { id: "nettoyage", categorie: "Remise", libelle: "Chantier nettoyé, déchets évacués", parDefaut: true },
];

export interface ControleFait { le: string; valeur?: string }
export interface ControlePerso { id: string; libelle: string }

export interface Controles {
  /** undefined = propositions par défaut ; sinon la sélection explicite de l'électricien. */
  retenus?: string[];
  faits: Record<string, ControleFait>;
  perso: ControlePerso[];
}

export const controlesVides = (): Controles => ({ faits: {}, perso: [] });
export const estVide = (c: Controles | undefined): boolean =>
  !c || (c.retenus === undefined && Object.keys(c.faits).length === 0 && c.perso.length === 0);

export type ActionControles =
  | { action: "retenir"; id: string; retenu: boolean }
  | { action: "fait"; id: string; fait: boolean; dateIso: string }
  | { action: "valeur"; id: string; valeur: string }
  | { action: "perso+"; id: string; libelle: string }
  | { action: "perso-"; id: string };

const idsDefaut = () => CATALOGUE_CONTROLES.filter(c => c.parDefaut).map(c => c.id);
const tousLesIds = (c: Controles) => [...CATALOGUE_CONTROLES.map(x => x.id), ...c.perso.map(p => p.id)];

/** Identifiants retenus pour ce chantier (défauts si aucune sélection, contrôles perso inclus et déjà retenus). */
export function idsRetenus(c: Controles | undefined): string[] {
  const base = c ?? controlesVides();
  const valides = new Set(tousLesIds(base));
  const liste = base.retenus === undefined ? [...idsDefaut(), ...base.perso.map(p => p.id)] : base.retenus;
  return liste.filter((id, i) => valides.has(id) && liste.indexOf(id) === i);
}

export interface ControleAffiche extends ControleDef { retenu: boolean; fait?: ControleFait }

/** Catalogue + contrôles perso, avec l'état retenu / fait. */
export function controlesAffiches(c: Controles | undefined): ControleAffiche[] {
  const base = c ?? controlesVides();
  const retenus = new Set(idsRetenus(base));
  const perso: ControleDef[] = base.perso.map(p => ({ id: p.id, categorie: "Personnalisé", libelle: p.libelle, parDefaut: true }));
  return [...CATALOGUE_CONTROLES, ...perso].map(d => ({ ...d, retenu: retenus.has(d.id), fait: base.faits[d.id] }));
}

/** Contrôles à remettre au client : retenus ET réalisés. */
export const controlesRemis = (c: Controles | undefined): ControleAffiche[] =>
  controlesAffiches(c).filter(x => x.retenu && x.fait);
export const controlesRestants = (c: Controles | undefined): ControleAffiche[] =>
  controlesAffiches(c).filter(x => x.retenu && !x.fait);

/** Applique une action (mutation de `c`). Utilisé en ligne comme pour rejouer la file hors ligne. */
export function appliquerActionControles(c: Controles, a: ActionControles): void {
  if (a.action === "retenir") {
    const courant = idsRetenus(c);
    c.retenus = a.retenu ? (courant.includes(a.id) ? courant : [...courant, a.id]) : courant.filter(i => i !== a.id);
  } else if (a.action === "fait") {
    if (a.fait) { if (!c.faits[a.id]) c.faits[a.id] = { le: a.dateIso }; }
    else delete c.faits[a.id];
  } else if (a.action === "valeur") {
    const f = c.faits[a.id];
    if (!f) return;
    const v = a.valeur.trim().slice(0, 40);
    if (v) f.valeur = v; else delete f.valeur;
  } else if (a.action === "perso+") {
    const libelle = a.libelle.trim().slice(0, 120);
    if (!libelle || c.perso.some(p => p.id === a.id)) return;
    const etaitDefaut = c.retenus === undefined;
    c.perso.push({ id: a.id, libelle });
    if (!etaitDefaut) c.retenus = [...(c.retenus ?? []), a.id];
  } else {
    c.perso = c.perso.filter(p => p.id !== a.id);
    delete c.faits[a.id];
    if (c.retenus) c.retenus = c.retenus.filter(i => i !== a.id);
  }
}

/** Lecture tolérante du JSON stocké. */
export function lireControles(brut: unknown): Controles | undefined {
  if (!brut || typeof brut !== "object") return undefined;
  const b = brut as Record<string, unknown>;
  const c = controlesVides();
  if (Array.isArray(b.retenus)) c.retenus = b.retenus.filter((x): x is string => typeof x === "string");
  if (b.faits && typeof b.faits === "object") {
    Object.entries(b.faits as Record<string, unknown>).forEach(([id, f]) => {
      if (f && typeof f === "object" && typeof (f as ControleFait).le === "string") {
        const v = (f as ControleFait).valeur;
        c.faits[id] = typeof v === "string" && v ? { le: (f as ControleFait).le, valeur: v } : { le: (f as ControleFait).le };
      }
    });
  }
  if (Array.isArray(b.perso)) {
    b.perso.forEach(p => {
      const x = p as Partial<ControlePerso>;
      if (x && typeof x.id === "string" && typeof x.libelle === "string" && x.libelle) c.perso.push({ id: x.id, libelle: x.libelle });
    });
  }
  return estVide(c) ? undefined : c;
}

export const copierControles = (c: Controles | undefined): Controles | undefined =>
  c ? { retenus: c.retenus ? [...c.retenus] : undefined, faits: Object.fromEntries(Object.entries(c.faits).map(([k, v]) => [k, { ...v }])), perso: c.perso.map(p => ({ ...p })) } : undefined;

export const nouvelIdPerso = (): string => `perso-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
