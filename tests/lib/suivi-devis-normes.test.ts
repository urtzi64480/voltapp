import { describe, expect, it } from "vitest";
import { descripteurDepuisLigne, etapesDetailDevis } from "@/lib/suivi-devis-normes";

const kind = (nom: string, extra: object = {}) => descripteurDepuisLigne({ nom, type_branche: "materiau", ...extra })?.kind ?? null;

describe("descripteurDepuisLigne", () => {
  it.each([
    ["Prise 2P+T 16A", "prise"], ["Prise extérieure étanche", "prise"], ["Prise lave-linge", "prise"],
    ["Prise RJ45 Cat 6", "communication"], ["Prise TV", "communication"],
    ["Disjoncteur 20 A", "disjoncteur"], ["Interrupteur différentiel 40A type A", "disjoncteur"],
    ["Interrupteur va-et-vient", "commande"], ["Détecteur de présence", "commande"],
    ["Interrupteur de volet roulant", "commande_service"], ["Moteur de volet roulant", "volet_roulant"],
    ["Spot LED encastré", "lampe"], ["Applique salle de bain", "lampe"],
    ["Boîte de dérivation", "boite"], ["Radiateur 1500 W", "chauffage"],
    ["Câble 3G2,5 mm²", "liaison"], ["Gaine ICTA 20", "liaison"], ["Câble RJ45 Cat 6", "liaison"],
    ["Borne de recharge Wallbox", "prise"],
  ])("« %s » → %s", (nom, attendu) => { expect(kind(nom)).toBe(attendu); });

  it("lignes non reconnues, services et heures → aucune étape détaillée", () => {
    for (const nom of ["Main d'œuvre", "Déplacement", "Remise commerciale", "Visserie", "Tableau 3 rangées", ""]) expect(kind(nom)).toBeNull();
    expect(descripteurDepuisLigne({ nom: "Pose des prises", type_branche: "service" })).toBeNull();
    expect(descripteurDepuisLigne({ nom: "Prise 16A", unite: "h" })).toBeNull();
  });
  it("ne déduit que ce que le nom contient", () => {
    expect(descripteurDepuisLigne({ nom: "Disjoncteur 20 A" })).toMatchObject({ amperes: 20, sectionMm2: null });
    expect(descripteurDepuisLigne({ nom: "Disjoncteur" })).toMatchObject({ amperes: null });
    expect(descripteurDepuisLigne({ nom: "Câble 3G2,5 mm²" })).toMatchObject({ sectionMm2: "2,5", communication: false });
    expect(descripteurDepuisLigne({ nom: "Radiateur" })).toMatchObject({ puissanceW: null });
  });
});

describe("etapesDetailDevis", () => {
  it("clés `<ligne>|n:<slug>` uniques, sans valeur inventée", () => {
    const e = etapesDetailDevis({ nom: "Prise 2P+T" }, "ligne:abc");
    expect(e.length).toBeGreaterThan(3);
    expect(new Set(e.map(x => x.cle)).size).toBe(e.length);
    expect(e.every(x => x.cle.startsWith("ligne:abc|n:"))).toBe(true);
    const txt = e.map(x => x.libelle).join(" ");
    expect(txt).not.toMatch(/undefined|null|NaN/);
  });
  it("tous les types produisent des libellés propres même sans aucune donnée", () => {
    for (const nom of ["Prise", "Disjoncteur", "Interrupteur", "Spot", "Boîte de dérivation", "Radiateur", "Câble", "Câble RJ45", "Prise RJ45", "Prise TV", "Moteur de volet roulant", "Interrupteur de volet roulant", "Prise lave-linge"]) {
      const e = etapesDetailDevis({ nom }, "ligne#0");
      expect(e.length, nom).toBeGreaterThan(0);
      for (const x of e) expect(x.libelle, nom).not.toMatch(/undefined|null|NaN|\bnull\b| cm cm/);
    }
  });
  it("ligne non reconnue → []", () => { expect(etapesDetailDevis({ nom: "Main d'œuvre" }, "ligne:x")).toEqual([]); });
});
