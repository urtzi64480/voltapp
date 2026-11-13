// src/lib/dictee.ts — dictée vocale du navigateur (Web Speech API), identique sur PC et téléphone.
// Chrome, Edge et Safari (Windows, macOS, Android, iPhone) la proposent ; Firefox non : on retombe alors sur la dictée du clavier / du système.
// Logique pure + moteur sans dépendance au DOM (la classe de reconnaissance est injectée), donc testable.

/** Ajoute le texte dicté à la suite du texte existant, avec un seul espace de séparation et sans toucher au reste. */
export function assemblerDictee(base: string, dicte: string): string {
  const d = dicte.replace(/\s+/g, " ").trim();
  if (!d) return base;
  if (!base || /\s$/.test(base)) return base + d;
  return `${base} ${d}`;
}

export interface ResultatReco { isFinal: boolean; 0: { transcript: string } }
export interface EvenementReco { results: ArrayLike<ResultatReco> }
export interface ErreurReco { error: string }
export interface Reconnaissance {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives?: number;
  onresult: ((e: EvenementReco) => void) | null; onerror: ((e: ErreurReco) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
export type ClasseReconnaissance = new () => Reconnaissance;

/** La classe de reconnaissance du navigateur, ou null s'il n'en a pas (Firefox, anciens navigateurs, rendu serveur). */
export function reconnaissanceDisponible(fenetre: unknown = typeof window === "undefined" ? undefined : window): ClasseReconnaissance | null {
  const w = fenetre as { SpeechRecognition?: ClasseReconnaissance; webkitSpeechRecognition?: ClasseReconnaissance } | undefined;
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
}

/** Message lisible pour une erreur du moteur ; null = erreur sans importance (silence). */
export function messageErreurDictee(code: string): string | null {
  switch (code) {
    case "no-speech": case "aborted": return null;
    case "not-allowed": case "service-not-allowed": return "Micro refusé : autorise le micro pour ce site dans le navigateur, puis réessaie.";
    case "audio-capture": return "Aucun micro détecté : branche un micro ou vérifie ses réglages.";
    case "network": return "Dictée indisponible : le service de reconnaissance vocale du navigateur demande une connexion Internet.";
    case "language-not-supported": return "Le français n'est pas pris en charge par la dictée de ce navigateur.";
    default: return "La dictée s'est arrêtée (erreur du navigateur). Réessaie.";
  }
}

export const MESSAGE_SANS_DICTEE = "Ce navigateur n'a pas de dictée intégrée : utilise Chrome ou Edge, la dictée du clavier (téléphone) ou Windows + H (PC).";

export interface EtatDictee { ecoute: boolean; erreur: string | null }
export interface OptionsDictee {
  Reconnaissance: ClasseReconnaissance;
  /** Texte actuel de la zone (lu au démarrage et à chaque relance). */
  lire: () => string;
  /** Écrit le texte complet (base + dictée) dans la zone. */
  ecrire: (texte: string) => void;
  surEtat: (e: EtatDictee) => void;
  maintenant?: () => number;
}

/**
 * Moteur de dictée : écoute en continu, affiche le texte provisoire en direct, ajoute à la suite de ce qui est déjà écrit.
 * Le navigateur coupe l'écoute après un silence : on relance tant que l'utilisateur n'a pas arrêté, sauf si l'écoute s'arrête
 * aussitôt à répétition (micro bloqué), pour ne jamais boucler.
 */
export function creerDictee(o: OptionsDictee) {
  const maintenant = o.maintenant ?? (() => Date.now());
  let reco: Reconnaissance | null = null;
  let voulue = false;
  let base = "";
  let debut = 0;
  let coursCourts = 0;

  const fin = (erreur: string | null) => { voulue = false; reco = null; o.surEtat({ ecoute: false, erreur }); };

  function lancer() {
    const r = new o.Reconnaissance();
    r.lang = "fr-FR"; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    base = o.lire(); debut = maintenant();
    r.onresult = e => {
      let texte = "";
      for (let i = 0; i < e.results.length; i++) texte += `${e.results[i][0]?.transcript ?? ""} `;
      o.ecrire(assemblerDictee(base, texte));
    };
    r.onerror = e => {
      const m = messageErreurDictee(e.error);
      if (m !== null) fin(m);
    };
    r.onend = () => {
      if (reco !== r) return;
      if (!voulue) { fin(null); return; }
      coursCourts = maintenant() - debut < 700 ? coursCourts + 1 : 0;
      if (coursCourts >= 3) { fin("La dictée s'arrête aussitôt : vérifie que le micro est autorisé et disponible."); return; }
      try { lancer(); } catch { fin("Impossible de relancer la dictée. Réessaie."); }
    };
    reco = r;
    r.start();
  }

  return {
    demarrer() {
      if (reco) return;
      voulue = true; coursCourts = 0;
      o.surEtat({ ecoute: true, erreur: null });
      try { lancer(); } catch { fin("Impossible de démarrer la dictée. Réessaie."); }
    },
    arreter() {
      voulue = false;
      const r = reco;
      if (!r) { o.surEtat({ ecoute: false, erreur: null }); return; }
      try { r.stop(); } catch { fin(null); }
    },
    /** Démontage du composant : coupe tout sans rien écrire ni notifier. */
    abandonner() {
      voulue = false;
      const r = reco; reco = null;
      if (r) { r.onresult = null; r.onerror = null; r.onend = null; try { r.abort(); } catch { /* déjà arrêté */ } }
    },
    get ecoute() { return reco !== null; },
  };
}
