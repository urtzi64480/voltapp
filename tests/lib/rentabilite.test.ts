import { describe, expect, it } from "vitest";
import {
  analyserDevis, construirePrixAchatMap, grouperParType, heuresEstimees, minutesReelles, TAUX_PAR_DEFAUT, tauxDepuisProfil, TYPE_AUTRE, typeChantier,
  type InfoPrestation, type LigneRentab,
} from "@/lib/rentabilite";

const prest: Record<string, InfoPrestation> = {
  prise: { categorie: "Appareillage" }, tableau: { categorie: "Tableau" }, vide: { categorie: "  " },
};
const suivi = (devis_id: string, temps: Record<string, number>, tempsPostes: Record<string, number> = {}) =>
  ({ suivi_realisation: JSON.stringify({ v: 1, chantier: { devis_id }, temps, tempsPostes }) });

describe("taux", () => {
  it("valeurs du profil, sinon 21,2 % / 12,3 % / 0 %", () => {
    expect(tauxDepuisProfil(null)).toEqual(TAUX_PAR_DEFAUT);
    expect(tauxDepuisProfil({ taux_cotisations_service: 20, taux_ir_materiau: 1 })).toEqual({ cotisService: 20, cotisMateriau: 12.3, irService: 0, irMateriau: 1 });
    expect(tauxDepuisProfil({ taux_cotisations_service: 0 }).cotisService).toBe(0); // 0 est une vraie valeur
  });
});

describe("construirePrixAchatMap", () => {
  it("article = prix d'achat ; kit = Σ composants × quantité ; valeurs absentes = 0", () => {
    const map = construirePrixAchatMap(
      [{ id: "a", prix_achat: 4 }, { id: "b", prix_achat: null }, { id: "k", est_kit: true }, { id: "c", prix_achat: 3 }],
      [{ kit_id: "k", composant_id: "a", quantite: 2 }, { kit_id: "k", composant_id: "c", quantite: 1 }, { kit_id: "k", composant_id: "zzz", quantite: 5 }],
    );
    expect(map).toEqual({ a: 4, b: 0, c: 3, k: 11 });
  });
  it("un composant rattaché à un non-kit est ignoré", () => {
    expect(construirePrixAchatMap([{ id: "a", prix_achat: 4 }], [{ kit_id: "a", composant_id: "a", quantite: 9 }])).toEqual({ a: 4 });
  });
});

describe("heures", () => {
  it("heures vendues = lignes de service à l'heure uniquement", () => {
    const l: LigneRentab[] = [
      { type_branche: "service", unite: "heure", quantite: 2.5 }, { type_branche: "service", unite: "h", quantite: 1 },
      { type_branche: "service", unite: "forfait", quantite: 3 }, { type_branche: "materiau", unite: "heure", quantite: 9 },
    ];
    expect(heuresEstimees(l)).toBe(3.5);
    expect(heuresEstimees([])).toBe(0);
  });
  it("minutes réelles : projets rattachés à CE devis, circuits + postes", () => {
    const projets = [suivi("d1", { c1: 60, c2: 30 }, { Salon: 15 }), suivi("d2", { c1: 600 }), { suivi_realisation: null }, suivi("d1", { c9: 5 })];
    expect(minutesReelles("d1", projets)).toBe(110);
    expect(minutesReelles("d3", projets)).toBe(0);
  });
});

describe("typeChantier", () => {
  it("catégorie la plus lourde en euros ; ex æquo → ordre alphabétique stable", () => {
    expect(typeChantier([{ prestation_id: "prise", prix_unitaire: 10, quantite: 5 }, { prestation_id: "tableau", prix_unitaire: 100, quantite: 1 }], prest)).toBe("Tableau");
    expect(typeChantier([{ prestation_id: "prise", prix_unitaire: 10, quantite: 1 }, { prestation_id: "tableau", prix_unitaire: 10, quantite: 1 }], prest)).toBe("Appareillage");
  });
  it("lignes libres, catégorie vide ou inconnue → « Autre »", () => {
    expect(typeChantier([{ prix_unitaire: 50, quantite: 1 }, { prestation_id: "vide", prix_unitaire: 5, quantite: 1 }, { prestation_id: "?", prix_unitaire: 5, quantite: 1 }], prest)).toBe(TYPE_AUTRE);
    expect(typeChantier([], prest)).toBe(TYPE_AUTRE);
  });
});

describe("analyserDevis (mêmes formules que la page de rentabilité d'un devis)", () => {
  const devis = { id: "d1", numero: "DEV-1", total_service: 200, total_materiau: 100, total_ttc: 300 };
  const lignes: LigneRentab[] = [
    { prestation_id: "prise", type_branche: "materiau", quantite: 10, prix_unitaire: 10, prix_achat: undefined },
    { type_branche: "service", unite: "heure", quantite: 4, prix_unitaire: 50 },
  ];
  it("net = CA − cotisations − impôt − achats ; marge sur le TTC", () => {
    const r = analyserDevis(devis, lignes, { prise: 6 }, prest, { cotisService: 20, cotisMateriau: 10, irService: 1, irMateriau: 0 }, 0);
    // cotisations 40 + 10 ; impôt 2 ; achat 60 → 300 − 50 − 2 − 60 = 188
    expect(r).toMatchObject({ coutAchat: 60, cotisations: 50, impots: 2, net: 188, margePct: 62.7, ca: 300, heuresEstimees: 4, heuresReelles: null, lignesSansCout: 0, type: "Appareillage" });
  });
  it("le prix d'achat de la ligne (fournisseur) prime sur le catalogue ; sans fournisseur, catalogue", () => {
    const l: LigneRentab[] = [{ prestation_id: "prise", type_branche: "materiau", quantite: 10, prix_unitaire: 10, fournisseur_id: "o1", prix_achat: 5 }];
    expect(analyserDevis(devis, l, { prise: 6 }, prest, TAUX_PAR_DEFAUT, 0).coutAchat).toBe(50);
  });
  it("fournisseur retenu SANS prix d'achat : coût inconnu (jamais emprunté au catalogue) et ligne signalée", () => {
    const l: LigneRentab[] = [{ prestation_id: "prise", type_branche: "materiau", quantite: 10, prix_unitaire: 10, fournisseur_id: "o1", prix_achat: null }];
    expect(analyserDevis(devis, l, { prise: 6 }, prest, TAUX_PAR_DEFAUT, 0)).toMatchObject({ coutAchat: 0, lignesSansCout: 1 });
  });
  it("temps réel converti en heures ; devis à 0 € → marge non calculable", () => {
    expect(analyserDevis(devis, lignes, {}, prest, TAUX_PAR_DEFAUT, 150).heuresReelles).toBe(2.5);
    expect(analyserDevis({ id: "x", total_ttc: 0 }, [], {}, prest, TAUX_PAR_DEFAUT, 0).margePct).toBeNull();
  });
  it("valeurs nulles ou invalides tolérées", () => {
    const r = analyserDevis({ id: "x", total_service: null, total_materiau: undefined, total_ttc: NaN }, [{ quantite: null, prix_unitaire: null }], {}, prest, TAUX_PAR_DEFAUT, 0);
    expect(r).toMatchObject({ ca: 0, net: 0, margePct: null });
  });
});

describe("grouperParType", () => {
  const base = { numero: "", objet: "", cotisations: 0, impots: 0, coutAchat: 0, lignesSansCout: 0 };
  const rs = [
    { ...base, id: "1", type: "Tableau", ca: 1000, net: 600, margePct: 60, heuresEstimees: 10, heuresReelles: 12 },
    { ...base, id: "2", type: "Tableau", ca: 500, net: 100, margePct: 20, heuresEstimees: 5, heuresReelles: null },
    { ...base, id: "3", type: "Appareillage", ca: 200, net: 150, margePct: 75, heuresEstimees: 2, heuresReelles: 1, lignesSansCout: 2 },
  ];
  it("agrège CA, net, marge pondérée ; trié par net décroissant", () => {
    const g = grouperParType(rs);
    expect(g.map(x => x.type)).toEqual(["Tableau", "Appareillage"]);
    expect(g[0]).toMatchObject({ nbDevis: 2, ca: 1500, net: 700, margePct: 46.7, heuresEstimees: 15 });
  });
  it("écart d'heures et net/heure calculés sur les SEULS devis chronométrés", () => {
    const t = grouperParType(rs)[0];
    expect(t).toMatchObject({ nbAvecTempsReel: 1, heuresReelles: 12, ecartHeuresPct: 20, netParHeure: 50 });
  });
  it("aucun temps saisi → pas d'écart ni de net/heure ; « incomplet » si un coût d'achat manque", () => {
    const sans = grouperParType([rs[1]])[0];
    expect(sans).toMatchObject({ ecartHeuresPct: null, netParHeure: null, incomplet: false });
    expect(grouperParType([rs[2]])[0].incomplet).toBe(true);
  });
  it("liste vide → []", () => { expect(grouperParType([])).toEqual([]); });
});

import { partCouverte, proratiser } from "@/lib/rentabilite";
describe("source de l'analyse (devis / factures émises / payées)", () => {
  const fac = (statut: string, ttc: number) => ({ devis_id: "d", statut, total_ttc: ttc });
  it("devis : seulement les signés", () => {
    expect(partCouverte("devis", "signe", 100, [])).toBe(1);
    expect(partCouverte("devis", "envoye", 100, [fac("payee", 100)])).toBeNull();
  });
  it("émises : exclut « à envoyer », compte payée/relance/impayée", () => {
    expect(partCouverte("emises", "signe", 100, [fac("a_envoyer", 100)])).toBeNull();
    expect(partCouverte("emises", "signe", 100, [fac("envoyee", 30), fac("payee", 20)])).toBe(0.5);
    expect(partCouverte("emises", "signe", 100, [fac("impayee", 100)])).toBe(1);
  });
  it("payées : seulement le statut payee, plafonné à 100 %", () => {
    expect(partCouverte("payees", "signe", 100, [fac("envoyee", 100)])).toBeNull();
    expect(partCouverte("payees", "signe", 100, [fac("payee", 40)])).toBe(0.4);
    expect(partCouverte("payees", "signe", 100, [fac("payee", 150)])).toBe(1);
    expect(partCouverte("payees", "signe", 0, [fac("payee", 10)])).toBe(1);
  });
  it("proratiser ramène CA, achats, charges et net ; garde les heures", () => {
    const r = { id: "d", numero: "N", objet: "", type: "T", ca: 100, coutAchat: 20, cotisations: 10, impots: 0, net: 70, margePct: 70, lignesSansCout: 0, heuresEstimees: 5, heuresReelles: 6 };
    const p = proratiser(r, 0.5);
    expect([p.ca, p.coutAchat, p.cotisations, p.net, p.heuresEstimees, p.heuresReelles, p.margePct]).toEqual([50, 10, 5, 35, 5, 6, 70]);
    expect(proratiser(r, 1)).toBe(r);
  });
});
