import { describe, expect, it } from "vitest";
import { MESSAGE_SANS_DICTEE, assemblerDictee, creerDictee, messageErreurDictee, reconnaissanceDisponible, type EtatDictee, type EvenementReco, type Reconnaissance } from "@/lib/dictee";

describe("assemblerDictee", () => {
  it("espace unique, base vide, base finissant par un espace ou un saut de ligne, texte vide", () => {
    expect(assemblerDictee("", "bonjour")).toBe("bonjour");
    expect(assemblerDictee("5 prises", "  3 spots \n")).toBe("5 prises 3 spots");
    expect(assemblerDictee("5 prises ", "3 spots")).toBe("5 prises 3 spots");
    expect(assemblerDictee("ligne\n", "suite")).toBe("ligne\nsuite");
    expect(assemblerDictee("abc", "   ")).toBe("abc"); expect(assemblerDictee("abc", "")).toBe("abc");
  });
});

describe("reconnaissanceDisponible", () => {
  it("standard, préfixée webkit (Chrome, Safari), ou rien (Firefox, serveur)", () => {
    class A {} 
    expect(reconnaissanceDisponible({ SpeechRecognition: A })).toBe(A);
    expect(reconnaissanceDisponible({ webkitSpeechRecognition: A })).toBe(A);
    expect(reconnaissanceDisponible({})).toBeNull(); expect(reconnaissanceDisponible(undefined)).toBeNull(); expect(reconnaissanceDisponible(null)).toBeNull();
  });
});

describe("messageErreurDictee", () => {
  it("silence ignoré, micro refusé / absent / réseau explicites, inconnu générique", () => {
    expect(messageErreurDictee("no-speech")).toBeNull(); expect(messageErreurDictee("aborted")).toBeNull();
    expect(messageErreurDictee("not-allowed")).toMatch(/Micro refusé/); expect(messageErreurDictee("service-not-allowed")).toMatch(/Micro refusé/);
    expect(messageErreurDictee("audio-capture")).toMatch(/Aucun micro/); expect(messageErreurDictee("network")).toMatch(/Internet/);
    expect(messageErreurDictee("???")).toMatch(/arrêtée/); expect(MESSAGE_SANS_DICTEE).toMatch(/Windows \+ H/);
  });
});

/** Fausse reconnaissance vocale pilotable depuis le test. */
function banc() {
  const instances: Fausse[] = [];
  class Fausse implements Reconnaissance {
    lang = ""; continuous = false; interimResults = false; maxAlternatives = 0;
    onresult: Reconnaissance["onresult"] = null; onerror: Reconnaissance["onerror"] = null; onend: Reconnaissance["onend"] = null;
    demarre = 0; arrete = 0; abandonne = 0;
    constructor() { instances.push(this); }
    start() { this.demarre++; } stop() { this.arrete++; } abort() { this.abandonne++; }
    dire(...parts: [string, boolean][]) { this.onresult?.({ results: parts.map(([t, f]) => ({ isFinal: f, 0: { transcript: t } })) } as EvenementReco); }
  }
  let texte = ""; let etat: EtatDictee = { ecoute: false, erreur: null }; let t = 0;
  const d = creerDictee({ Reconnaissance: Fausse, lire: () => texte, ecrire: s => { texte = s; }, surEtat: e => { etat = e; }, maintenant: () => t });
  return { d, instances, get texte() { return texte; }, set texte(v: string) { texte = v; }, get etat() { return etat; }, avancer: (ms: number) => { t += ms; } };
}

describe("creerDictee", () => {
  it("démarre en français, continu, avec texte provisoire ; écrit à la suite du texte existant", () => {
    const b = banc(); b.texte = "Pour Dupont,"; b.d.demarrer();
    const r = b.instances[0];
    expect([r.lang, r.continuous, r.interimResults, r.demarre]).toEqual(["fr-FR", true, true, 1]); expect(b.etat).toEqual({ ecoute: true, erreur: null });
    r.dire(["5 prises", false]); expect(b.texte).toBe("Pour Dupont, 5 prises");
    r.dire(["5 prises 16 ampères", true], ["3 spots", false]); expect(b.texte).toBe("Pour Dupont, 5 prises 16 ampères 3 spots");
    r.dire(["5 prises 16 ampères", true], ["3 spots", true]); expect(b.texte).toBe("Pour Dupont, 5 prises 16 ampères 3 spots");   // idempotent : jamais de doublon
  });
  it("démarrer deux fois ne crée qu'une écoute", () => { const b = banc(); b.d.demarrer(); b.d.demarrer(); expect(b.instances).toHaveLength(1); });
  it("coupure du navigateur après un silence : relance automatique, la suite s'ajoute au texte déjà obtenu", () => {
    const b = banc(); b.d.demarrer(); b.instances[0].dire(["un", true]); b.avancer(5000); b.instances[0].onend?.();
    expect(b.instances).toHaveLength(2); expect(b.etat.ecoute).toBe(true);
    b.instances[1].dire(["deux", false]); expect(b.texte).toBe("un deux");
  });
  it("arrêt demandé : plus de relance, état coupé, texte conservé", () => {
    const b = banc(); b.d.demarrer(); b.instances[0].dire(["un", true]); b.d.arreter(); expect(b.instances[0].arrete).toBe(1);
    b.instances[0].onend?.(); expect(b.instances).toHaveLength(1); expect(b.etat).toEqual({ ecoute: false, erreur: null }); expect(b.texte).toBe("un"); expect(b.d.ecoute).toBe(false);
  });
  it("arrêter sans écoute en cours ne plante pas", () => { const b = banc(); b.d.arreter(); expect(b.etat.ecoute).toBe(false); });
  it("micro refusé : erreur lisible, écoute coupée, pas de relance", () => {
    const b = banc(); b.d.demarrer(); b.instances[0].onerror?.({ error: "not-allowed" }); expect(b.etat.ecoute).toBe(false); expect(b.etat.erreur).toMatch(/Micro refusé/);
    b.instances[0].onend?.(); expect(b.instances).toHaveLength(1);
  });
  it("silence (no-speech) : ignoré, l'écoute continue", () => { const b = banc(); b.d.demarrer(); b.instances[0].onerror?.({ error: "no-speech" }); expect(b.etat.ecoute).toBe(true); expect(b.etat.erreur).toBeNull(); });
  it("arrêts immédiats répétés (micro bloqué) : s'arrête avec un message, jamais de boucle infinie", () => {
    const b = banc(); b.d.demarrer();
    for (let i = 0; i < 10 && b.etat.ecoute; i++) { b.avancer(100); b.instances[b.instances.length - 1].onend?.(); }
    expect(b.etat.ecoute).toBe(false); expect(b.etat.erreur).toMatch(/aussitôt/); expect(b.instances.length).toBeLessThanOrEqual(3);
  });
  it("une écoute longue remet le compteur d'arrêts rapides à zéro", () => {
    const b = banc(); b.d.demarrer();
    for (let i = 0; i < 6; i++) { b.avancer(5000); b.instances[b.instances.length - 1].onend?.(); }
    expect(b.etat.ecoute).toBe(true); expect(b.instances).toHaveLength(7);
  });
  it("abandonner (démontage) : coupe sans rien écrire ni relancer", () => {
    const b = banc(); b.d.demarrer(); const r = b.instances[0]; b.d.abandonner();
    expect(r.abandonne).toBe(1); expect(r.onresult).toBeNull(); expect(b.d.ecoute).toBe(false); r.onend?.(); expect(b.instances).toHaveLength(1);
  });
  it("démarrage qui échoue (start lève) : erreur lisible, pas d'exception", () => {
    const etats: EtatDictee[] = [];
    class Casse { lang = ""; continuous = false; interimResults = false; onresult = null; onerror = null; onend = null; start() { throw new Error("déjà démarré"); } stop() {} abort() {} }
    const d = creerDictee({ Reconnaissance: Casse as never, lire: () => "", ecrire: () => {}, surEtat: e => etats.push(e) });
    expect(() => d.demarrer()).not.toThrow(); expect(etats.at(-1)?.erreur).toMatch(/Impossible/); expect(etats.at(-1)?.ecoute).toBe(false);
  });
});
