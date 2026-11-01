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
  /** Proposé quel que soit le devis. */
  universel?: boolean;
  /** Proposé quand le devis (désignations, postes, objet) contient un de ces mots (sans accents, minuscules, début de mot). */
  motsCles?: string[];
  /** Repli : proposé par défaut quand AUCUN contrôle ne ressort du devis (devis très court ou atypique). */
  parDefaut?: boolean;
  /** Si présent : valeur mesurée à consigner (ex. « Ω », « mA »). */
  mesure?: string;
}

export const CATALOGUE_CONTROLES: ControleDef[] = [
  { id: "visuel-general", categorie: "Inspection", libelle: "Contrôle visuel de l'installation", aide: "Matériel fixé, sans dommage, conforme au devis", universel: true },
  { id: "serrage-bornes", categorie: "Inspection", libelle: "Serrage des connexions et bornes", aide: "Tableau, appareillages, luminaires", parDefaut: true,
    motsCles: ["tableau", "coffret", "disjoncteur", "differentiel", "prise", "interrupteur", "luminaire", "eclairage", "spot", "appareillage", "circuit", "ligne", "cable", "raccord"] },
  { id: "reperage-circuits", categorie: "Inspection", libelle: "Repérage des circuits au tableau", aide: "Étiquetage lisible de chaque protection", parDefaut: true,
    motsCles: ["tableau", "coffret", "disjoncteur", "differentiel", "circuit", "ligne", "gtl"] },
  { id: "continuite-pe", categorie: "Mesures", libelle: "Continuité du conducteur de protection (terre)", parDefaut: true,
    motsCles: ["prise", "terre", "circuit", "tableau", "luminaire", "chauffe eau", "cumulus", "borne", "four", "plaque", "lave", "radiateur"] },
  { id: "resistance-terre", categorie: "Mesures", libelle: "Résistance de la prise de terre", parDefaut: true, mesure: "Ω",
    motsCles: ["terre", "tableau", "coffret", "piquet", "borne", "mise a la terre"] },
  { id: "isolement", categorie: "Mesures", libelle: "Résistance d'isolement des circuits", mesure: "MΩ",
    motsCles: ["tirage", "cable", "renovation", "installation", "circuit", "ligne", "neuf"] },
  { id: "essai-dd", categorie: "Essais", libelle: "Essai de déclenchement des interrupteurs différentiels", aide: "Bouton test + essai en charge", parDefaut: true,
    motsCles: ["differentiel", "tableau", "coffret", "30 ma", "30ma"] },
  { id: "essai-disjoncteurs", categorie: "Essais", libelle: "Fonctionnement des disjoncteurs et circuits", parDefaut: true,
    motsCles: ["disjoncteur", "tableau", "coffret", "circuit", "ligne"] },
  { id: "essai-prises", categorie: "Essais", libelle: "Test de chaque prise", aide: "Présence tension, polarité, terre", parDefaut: true,
    motsCles: ["prise", "pc16", "pc 16"] },
  { id: "essai-luminaires", categorie: "Essais", libelle: "Fonctionnement de l'éclairage et des commandes",
    motsCles: ["luminaire", "eclairage", "spot", "applique", "plafonnier", "interrupteur", "va et vient", "variateur", "led", "bandeau", "suspension", "detecteur de presence"] },
  { id: "detecteur-fumee", categorie: "Sécurité", libelle: "Détecteur de fumée (présence et test)", motsCles: ["fumee", "daaf"] },
  { id: "liaison-equipotentielle", categorie: "Sécurité", libelle: "Liaison équipotentielle (salle d'eau)",
    motsCles: ["salle de bain", "salle d eau", "douche", "baignoire", "sdb", "equipotentiel"] },
  { id: "parafoudre", categorie: "Sécurité", libelle: "Vérification du parafoudre", motsCles: ["parafoudre"] },
  { id: "vmc", categorie: "Équipements", libelle: "Ventilation (VMC / extracteur) : alimentation et fonctionnement", motsCles: ["vmc", "ventilation", "extracteur", "aeration"] },
  { id: "borne-irve", categorie: "Équipements", libelle: "Borne de recharge : protection dédiée et mise en service", motsCles: ["borne", "irve", "recharge", "wallbox", "vehicule electrique"] },
  { id: "chauffage", categorie: "Équipements", libelle: "Chauffage / eau chaude : alimentation et protection dédiées", aide: "Radiateurs, chauffe-eau, plancher chauffant",
    motsCles: ["radiateur", "convecteur", "chauffage", "plancher chauffant", "seche serviette", "chauffe eau", "cumulus", "ballon"] },
  { id: "gros-electro", categorie: "Équipements", libelle: "Appareils de cuisine (plaque, four…) : alimentation dédiée et fonctionnement", motsCles: ["plaque", "four", "lave", "cuisiniere", "hotte", "cuisine"] },
  { id: "communication", categorie: "Équipements", libelle: "Réseau / TV / interphone : test des prises et liaisons", motsCles: ["rj45", "ethernet", "tv", "antenne", "interphone", "visiophone", "portier", "fibre", "baie", "reseau"] },
  { id: "motorisations", categorie: "Équipements", libelle: "Volets / portail / motorisations : fin de course et sécurités", motsCles: ["volet", "portail", "motorisation", "store", "porte de garage"] },
  { id: "explications-client", categorie: "Remise", libelle: "Explications données au client (tableau, coupure, différentiels)", universel: true },
  { id: "nettoyage", categorie: "Remise", libelle: "Chantier nettoyé, déchets évacués", universel: true },
];

/** Texte du devis mis en forme pour la recherche : minuscules, sans accents, ponctuation → espaces. */
export function contexteDevis(textes: (string | null | undefined)[]): string {
  return " " + textes.filter(Boolean).join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim() + " ";
}

const correspond = (d: ControleDef, ctx: string): boolean => !!d.motsCles?.some(m => ctx.includes(` ${m}`));

/** Contrôles proposés pour CE devis : les universels + ceux dont un mot clé figure dans le devis (repli sur les classiques si rien ne ressort). */
export function idsProposes(ctx: string): string[] {
  const lies = CATALOGUE_CONTROLES.filter(d => !d.universel && correspond(d, ctx));
  const base = lies.length > 0 ? lies : CATALOGUE_CONTROLES.filter(d => d.parDefaut);
  const choisis = new Set([...CATALOGUE_CONTROLES.filter(d => d.universel), ...base].map(d => d.id));
  return CATALOGUE_CONTROLES.filter(d => choisis.has(d.id)).map(d => d.id);
}

export interface ControleFait { le: string; valeur?: string }
export interface ControlePerso { id: string; libelle: string }

/** Procès-verbal de réception signé par le client sur place. */
export interface Reception { le: string; nom: string; reserves?: string; signature: string }
export interface PhotoChantier { url: string; legende?: string }

export interface Controles {
  /** undefined = propositions par défaut ; sinon la sélection explicite de l'électricien. */
  retenus?: string[];
  faits: Record<string, ControleFait>;
  perso: ControlePerso[];
  /** Commentaire libre par contrôle (affiché sur le rapport client). */
  commentaires?: Record<string, string>;
  reception?: Reception;
  photos?: PhotoChantier[];
  /** Date d'envoi du rappel d'entretien annuel au client (ISO). */
  entretienEnvoyeLe?: string;
}

export const controlesVides = (): Controles => ({ faits: {}, perso: [] });
export const estVide = (c: Controles | undefined): boolean =>
  !c || (c.retenus === undefined && Object.keys(c.faits).length === 0 && c.perso.length === 0 && Object.keys(c.commentaires ?? {}).length === 0 && !c.reception && !(c.photos?.length) && !c.entretienEnvoyeLe);

export type ActionControles =
  /** `ids` = la sélection COMPLÈTE après le clic (absolue : rejouable hors ligne sans connaître le devis). */
  | { action: "retenir"; id: string; retenu: boolean; ids: string[] }
  | { action: "fait"; id: string; fait: boolean; dateIso: string }
  | { action: "valeur"; id: string; valeur: string }
  | { action: "commentaire"; id: string; texte: string }
  | { action: "reception"; id: string; reception: Reception | null }
  | { action: "photo+"; id: string; photo: PhotoChantier }
  | { action: "photo-"; id: string }
  | { action: "entretien"; id: string; le: string | null }
  | { action: "perso+"; id: string; libelle: string }
  | { action: "perso-"; id: string };

const tousLesIds = (c: Controles) => [...CATALOGUE_CONTROLES.map(x => x.id), ...c.perso.map(p => p.id)];

/** Identifiants retenus pour ce chantier (défauts si aucune sélection, contrôles perso inclus et déjà retenus). */
export function idsRetenus(c: Controles | undefined, ctx = ""): string[] {
  const base = c ?? controlesVides();
  const valides = new Set(tousLesIds(base));
  const liste = base.retenus === undefined ? [...idsProposes(ctx), ...base.perso.map(p => p.id)] : base.retenus;
  return liste.filter((id, i) => valides.has(id) && liste.indexOf(id) === i);
}

export interface ControleAffiche extends ControleDef { commentaire?: string; retenu: boolean; fait?: ControleFait; /** Proposé à cause d'un élément du devis. */ lieAuDevis: boolean }

/** Catalogue + contrôles perso, avec l'état retenu / fait. */
export function controlesAffiches(c: Controles | undefined, ctx = ""): ControleAffiche[] {
  const base = c ?? controlesVides();
  const retenus = new Set(idsRetenus(base, ctx));
  const perso: ControleDef[] = base.perso.map(p => ({ id: p.id, categorie: "Personnalisé", libelle: p.libelle, universel: true }));
  return [...CATALOGUE_CONTROLES, ...perso].map(d => ({ ...d, retenu: retenus.has(d.id), fait: base.faits[d.id], commentaire: base.commentaires?.[d.id], lieAuDevis: !d.universel && correspond(d, ctx) }));
}

/** Contrôles à remettre au client : retenus ET réalisés. */
export const controlesRemis = (c: Controles | undefined, ctx = ""): ControleAffiche[] =>
  controlesAffiches(c, ctx).filter(x => x.retenu && x.fait);
export const controlesRestants = (c: Controles | undefined, ctx = ""): ControleAffiche[] =>
  controlesAffiches(c, ctx).filter(x => x.retenu && !x.fait);

/** Applique une action (mutation de `c`). Utilisé en ligne comme pour rejouer la file hors ligne. */
export function appliquerActionControles(c: Controles, a: ActionControles): void {
  if (a.action === "retenir") {
    c.retenus = a.ids.filter((id, i) => a.ids.indexOf(id) === i);
  } else if (a.action === "fait") {
    if (a.fait) { if (!c.faits[a.id]) c.faits[a.id] = { le: a.dateIso }; }
    else delete c.faits[a.id];
  } else if (a.action === "valeur") {
    const f = c.faits[a.id];
    if (!f) return;
    const v = a.valeur.trim().slice(0, 40);
    if (v) f.valeur = v; else delete f.valeur;
  } else if (a.action === "commentaire") {
    const t = a.texte.trim().slice(0, 300);
    if (t) c.commentaires = { ...c.commentaires, [a.id]: t };
    else if (c.commentaires) { delete c.commentaires[a.id]; if (Object.keys(c.commentaires).length === 0) delete c.commentaires; }
  } else if (a.action === "reception") {
    if (a.reception) c.reception = { ...a.reception, nom: a.reception.nom.trim().slice(0, 120), ...(a.reception.reserves?.trim() ? { reserves: a.reception.reserves.trim().slice(0, 1000) } : {}) };
    else delete c.reception;
  } else if (a.action === "photo+") {
    const photos = c.photos ?? [];
    if (!photos.some(p => p.url === a.photo.url) && photos.length < 12) c.photos = [...photos, { url: a.photo.url, ...(a.photo.legende?.trim() ? { legende: a.photo.legende.trim().slice(0, 120) } : {}) }];
  } else if (a.action === "photo-") {
    c.photos = (c.photos ?? []).filter(p => p.url !== a.id);
    if (c.photos.length === 0) delete c.photos;
  } else if (a.action === "entretien") {
    if (a.le) c.entretienEnvoyeLe = a.le; else delete c.entretienEnvoyeLe;
  } else if (a.action === "perso+") {
    const libelle = a.libelle.trim().slice(0, 120);
    if (!libelle || c.perso.some(p => p.id === a.id)) return;
    const etaitDefaut = c.retenus === undefined;
    c.perso.push({ id: a.id, libelle });
    if (!etaitDefaut) c.retenus = [...(c.retenus ?? []), a.id];
  } else {
    c.perso = c.perso.filter(p => p.id !== a.id);
    delete c.faits[a.id];
    if (c.commentaires) { delete c.commentaires[a.id]; if (Object.keys(c.commentaires).length === 0) delete c.commentaires; }
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
  if (b.commentaires && typeof b.commentaires === "object") {
    Object.entries(b.commentaires as Record<string, unknown>).forEach(([id, t]) => {
      if (typeof t === "string" && t.trim()) c.commentaires = { ...c.commentaires, [id]: t.slice(0, 300) };
    });
  }
  const r = b.reception as Partial<Reception> | undefined;
  if (r && typeof r === "object" && typeof r.le === "string" && typeof r.nom === "string" && typeof r.signature === "string" && r.signature.startsWith("data:image/")) {
    c.reception = { le: r.le, nom: r.nom, signature: r.signature, ...(typeof r.reserves === "string" && r.reserves ? { reserves: r.reserves } : {}) };
  }
  if (Array.isArray(b.photos)) {
    const ph = b.photos.filter((p): p is PhotoChantier => !!p && typeof (p as PhotoChantier).url === "string" && /^https?:\/\//.test((p as PhotoChantier).url))
      .map(p => ({ url: p.url, ...(typeof p.legende === "string" && p.legende ? { legende: p.legende } : {}) }));
    if (ph.length > 0) c.photos = ph;
  }
  if (typeof b.entretienEnvoyeLe === "string" && b.entretienEnvoyeLe) c.entretienEnvoyeLe = b.entretienEnvoyeLe;
  if (Array.isArray(b.perso)) {
    b.perso.forEach(p => {
      const x = p as Partial<ControlePerso>;
      if (x && typeof x.id === "string" && typeof x.libelle === "string" && x.libelle) c.perso.push({ id: x.id, libelle: x.libelle });
    });
  }
  return estVide(c) ? undefined : c;
}

export const copierControles = (c: Controles | undefined): Controles | undefined =>
  c ? { retenus: c.retenus ? [...c.retenus] : undefined, faits: Object.fromEntries(Object.entries(c.faits).map(([k, v]) => [k, { ...v }])), perso: c.perso.map(p => ({ ...p })), ...(c.commentaires ? { commentaires: { ...c.commentaires } } : {}), ...(c.reception ? { reception: { ...c.reception } } : {}), ...(c.photos ? { photos: c.photos.map(p => ({ ...p })) } : {}), ...(c.entretienEnvoyeLe ? { entretienEnvoyeLe: c.entretienEnvoyeLe } : {}) } : undefined;

export const nouvelIdPerso = (): string => `perso-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
