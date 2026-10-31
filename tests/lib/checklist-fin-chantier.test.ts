import { describe, it, expect } from "vitest";
import {
  CATALOGUE_CONTROLES, appliquerActionControles, controlesAffiches, controlesRemis, controlesRestants, controlesVides, estVide, idsRetenus, lireControles,
} from "@/lib/checklist-fin-chantier";
import { lireSuivi } from "@/lib/suivi-persistance";
import { appliquerOperation } from "@/lib/suivi-hors-ligne";
import type { SuiviStocke } from "@/lib/suivi-persistance";

const vide = (): SuiviStocke => ({ coches: {}, chantier: {}, temps: {}, tempsPostes: {} });

describe("checklist fin de chantier", () => {
  it("catalogue : ids uniques, aucun seuil chiffré de norme", () => {
    const ids = CATALOGUE_CONTROLES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    CATALOGUE_CONTROLES.forEach(c => expect(`${c.libelle} ${c.aide ?? ""}`).not.toMatch(/\d+\s*(Ω|ohm|mA|MΩ)/i));
  });
  it("sans sélection : propositions par défaut", () => {
    expect(idsRetenus(undefined)).toEqual(CATALOGUE_CONTROLES.filter(c => c.parDefaut).map(c => c.id));
  });
  it("retenir / écarter part des défauts", () => {
    const c = controlesVides();
    appliquerActionControles(c, { action: "retenir", id: "isolement", retenu: true });
    appliquerActionControles(c, { action: "retenir", id: "nettoyage", retenu: false });
    const r = idsRetenus(c);
    expect(r).toContain("isolement"); expect(r).not.toContain("nettoyage"); expect(r).toContain("visuel-general");
  });
  it("seuls les contrôles retenus ET faits sont remis", () => {
    const c = controlesVides();
    appliquerActionControles(c, { action: "fait", id: "visuel-general", fait: true, dateIso: "2026-10-01T10:00:00Z" });
    appliquerActionControles(c, { action: "fait", id: "isolement", fait: true, dateIso: "2026-10-01T10:00:00Z" }); // fait mais non retenu
    expect(controlesRemis(c).map(x => x.id)).toEqual(["visuel-general"]);
    expect(controlesRestants(c).length).toBe(idsRetenus(c).length - 1);
  });
  it("valeur mesurée : seulement sur un contrôle fait, effaçable", () => {
    const c = controlesVides();
    appliquerActionControles(c, { action: "valeur", id: "resistance-terre", valeur: "35" });
    expect(c.faits["resistance-terre"]).toBeUndefined();
    appliquerActionControles(c, { action: "fait", id: "resistance-terre", fait: true, dateIso: "d" });
    appliquerActionControles(c, { action: "valeur", id: "resistance-terre", valeur: " 35 " });
    expect(c.faits["resistance-terre"].valeur).toBe("35");
    appliquerActionControles(c, { action: "valeur", id: "resistance-terre", valeur: "" });
    expect(c.faits["resistance-terre"].valeur).toBeUndefined();
  });
  it("contrôle perso : ajout retenu, suppression nettoie tout", () => {
    const c = controlesVides();
    appliquerActionControles(c, { action: "perso+", id: "p1", libelle: "  Test VMC " });
    expect(idsRetenus(c)).toContain("p1");
    appliquerActionControles(c, { action: "fait", id: "p1", fait: true, dateIso: "d" });
    expect(controlesAffiches(c).find(x => x.id === "p1")?.libelle).toBe("Test VMC");
    appliquerActionControles(c, { action: "perso-", id: "p1" });
    expect(c.perso).toEqual([]); expect(c.faits.p1).toBeUndefined(); expect(idsRetenus(c)).not.toContain("p1");
  });
  it("perso ajouté après une sélection explicite reste retenu", () => {
    const c = controlesVides();
    appliquerActionControles(c, { action: "retenir", id: "isolement", retenu: true });
    appliquerActionControles(c, { action: "perso+", id: "p2", libelle: "X" });
    expect(idsRetenus(c)).toContain("p2");
  });
  it("aller-retour JSON dans le suivi, sans casser les autres clés", () => {
    const s = vide(); s.coches = { a: "d" };
    appliquerOperation(s, { type: "controles", action: { action: "fait", id: "nettoyage", fait: true, dateIso: "2026-10-02T00:00:00Z" } });
    expect(s.controles).toBeDefined();
    const relu = lireControles(JSON.parse(JSON.stringify(s.controles)));
    expect(relu?.faits.nettoyage.le).toBe("2026-10-02T00:00:00Z");
    appliquerOperation(s, { type: "controles", action: { action: "fait", id: "nettoyage", fait: false, dateIso: "" } });
    expect(s.controles).toBeUndefined();
    expect(s.coches).toEqual({ a: "d" });
  });
  it("lecture tolérante", () => {
    expect(lireControles(null)).toBeUndefined();
    expect(lireControles({ retenus: "x", faits: { a: { le: 3 } }, perso: [{ id: 1 }] })).toBeUndefined();
    expect(estVide(lireControles({ faits: {}, perso: [] }))).toBe(true);
    expect(lireSuivi("{\"v\":1,\"controles\":{\"faits\":{\"nettoyage\":{\"le\":\"d\"}}}}").controles?.faits.nettoyage.le).toBe("d");
    expect(lireSuivi("{\"v\":1,\"controles\":42}").controles).toBeUndefined();
  });
});
