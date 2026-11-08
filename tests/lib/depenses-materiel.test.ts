import { describe, expect, it } from "vitest";
import { estAAcheter, grouperAchatsParMois, libelleMois, lireAchat, lireDate, lireMontant, moisDe, totalParDevis, type AchatDuMois } from "@/lib/depenses-materiel";
import { coutAchatLignes } from "@/lib/rentabilite";

let n = 0;
const a = (o: Partial<AchatDuMois>): AchatDuMois => ({ id: `a${++n}`, devisId: "x", numero: "D-1", client: "", objet: "", montant: 10, date: "2026-11-03", fournisseur: "", article: "", ...o });

describe("lireMontant", () => {
  it("accepte virgule, point, espaces et €", () => {
    expect(lireMontant("123,45")).toBe(123.45);
    expect(lireMontant("12.5")).toBe(12.5);
    expect(lireMontant(" 1 234,50 € ")).toBe(1234.5);
    expect(lireMontant("0")).toBe(0);
    expect(lireMontant(7.456)).toBe(7.46);
  });
  it("refuse vide, négatif, texte, NaN", () => {
    for (const v of ["", "  ", "-5", "abc", "1,2,3", "1e3", null, undefined, NaN, -1, {}]) expect(lireMontant(v)).toBeNull();
  });
});

describe("lireDate / moisDe / libelleMois", () => {
  it("lit une date ou un horodatage, refuse les dates impossibles", () => {
    expect(lireDate("2026-11-08")).toBe("2026-11-08");
    expect(lireDate("2026-11-08T10:00:00+01:00")).toBe("2026-11-08");
    expect(lireDate("2026-02-30")).toBeNull();
    expect(lireDate("n'importe quoi")).toBeNull();
    expect(lireDate(null)).toBeNull();
  });
  it("le mois vient du jour payé ; date illisible → inconnu", () => {
    expect(moisDe("2026-10-31")).toBe("2026-10");
    expect(moisDe("2026-11-03")).toBe("2026-11");
    expect(moisDe("")).toBe("inconnu");
    expect(moisDe(null)).toBe("inconnu");
  });
  it("libellés en français", () => {
    expect(libelleMois("2026-02")).toBe("février 2026");
    expect(libelleMois("2026-12")).toBe("décembre 2026");
    expect(libelleMois("inconnu")).toBe("Date inconnue");
    expect(libelleMois("2026-13")).toBe("Date inconnue");
  });
});

describe("grouperAchatsParMois : le mois est celui du jour payé", () => {
  const liste = [
    a({ devisId: "a", numero: "D-2026-010", montant: 120, date: "2026-10-05" }),
    a({ devisId: "a", numero: "D-2026-010", montant: 30, date: "2026-11-02", fournisseur: "Rexel" }),   // même devis, autre mois
    a({ devisId: "c", numero: "D-2026-011", montant: 80.5, date: "2026-11-02" }),
    a({ devisId: "d", numero: "D-2025-001", montant: 10, date: "2025-12-31" }),
    a({ devisId: "z", numero: "D-0", montant: 1, date: "" }),
  ];
  const g = grouperAchatsParMois(liste, "2026-11");
  it("du plus récent au plus ancien, « date inconnue » en dernier", () => {
    expect(g.map(x => x.cle)).toEqual(["2026-11", "2026-10", "2025-12", "inconnu"]);
  });
  it("un devis acheté en deux fois est réparti sur les deux mois, chaque mois totalise ses achats", () => {
    const oct = g.find(x => x.cle === "2026-10")!;
    const nov = g.find(x => x.cle === "2026-11")!;
    expect(oct.total).toBe(120);
    expect(nov.total).toBe(110.5);
    expect(nov.nbAchats).toBe(2);
    expect(nov.nbDevis).toBe(2);
    expect(nov.achats.map(x => x.devisId)).toEqual(["a", "c"]);          // même jour : triés par numéro de devis
  });
  it("un mois terminé (avant le mois courant) est replié ; le mois courant et la date inconnue ne le sont pas", () => {
    expect(g.map(x => [x.cle, x.termine])).toEqual([["2026-11", false], ["2026-10", true], ["2025-12", true], ["inconnu", false]]);
  });
  it("mois futur : ouvert", () => expect(grouperAchatsParMois([a({ date: "2026-12-01" })], "2026-11")[0].termine).toBe(false));
  it("liste vide : aucun groupe", () => expect(grouperAchatsParMois([], "2026-11")).toEqual([]));
  it("somme au centime près", () => expect(grouperAchatsParMois([a({ montant: 0.1 }), a({ montant: 0.2 })], "2026-11")[0].total).toBe(0.3));
});

describe("totalParDevis / lireAchat", () => {
  it("somme par devis au centime", () => {
    const t = totalParDevis([{ devisId: "a", montant: 0.1 }, { devisId: "a", montant: 0.2 }, { devisId: "b", montant: 5 }]);
    expect(t.get("a")).toBe(0.3);
    expect(t.get("b")).toBe(5);
    expect(t.get("c")).toBeUndefined();
  });
  it("ligne Supabase (montant numérique en texte, date, fournisseur) → achat ; ligne inutilisable → null", () => {
    expect(lireAchat({ id: "1", devis_id: "d", montant: "12.50", date_achat: "2026-11-03", fournisseur: " Rexel " }))
      .toEqual({ id: "1", devisId: "d", montant: 12.5, date: "2026-11-03", fournisseur: "Rexel", article: "" });
    expect(lireAchat({ id: "2", devis_id: "d", montant: 3, date_achat: "2026-11-03", article: " Disjoncteur 20A " })!.article).toBe("Disjoncteur 20A");
    expect(lireAchat({ id: "1", devis_id: "d", montant: 0, date_achat: null, fournisseur: null })).toEqual({ id: "1", devisId: "d", montant: 0, date: "", fournisseur: "", article: "" });
    for (const v of [null, undefined, "x", {}, { id: "1", devis_id: "d", montant: -2 }, { id: "1", devis_id: "d", montant: "abc" }, { devis_id: "d", montant: 1 }]) expect(lireAchat(v)).toBeNull();
  });
});

describe("estAAcheter", () => {
  it("devis signé avec matériel, ou déjà saisi ; jamais un brouillon sans achat", () => {
    expect(estAAcheter({ statut: "signe", total_materiau: 100 })).toBe(true);
    expect(estAAcheter({ statut: "signe", total_materiau: 0, aLigneMateriau: true })).toBe(true);
    expect(estAAcheter({ statut: "signe", total_materiau: 0 })).toBe(false);
    expect(estAAcheter({ statut: "brouillon", total_materiau: 100 })).toBe(false);
    expect(estAAcheter({ statut: "refuse", total_materiau: 100, nbAchats: 1 })).toBe(true);   // un achat saisi : rien ne disparaît
  });
});

describe("coutAchatLignes (partagé avec la rentabilité)", () => {
  it("prix d'achat de la ligne, sinon catalogue ; compte les lignes matériau sans prix", () => {
    const r = coutAchatLignes([
      { prestation_id: "p1", quantite: 2, type_branche: "materiau" },
      { prestation_id: "p2", quantite: 1, type_branche: "materiau" },
      { quantite: 3, prix_achat: 4, fournisseur_id: "f", type_branche: "materiau" },
      { prestation_id: "p1", quantite: 1, type_branche: "service" },
    ], { p1: 10 });
    expect(r.coutAchat).toBe(10 * 2 + 12 + 10);
    expect(r.lignesSansCout).toBe(1);
  });
});

import { htDepuisTtc, lireMontantTtc, ttcDepuisHt } from "@/lib/depenses-materiel";
import { analyserDevis, comparerAchat, proratiser, TAUX_PAR_DEFAUT } from "@/lib/rentabilite";

describe("conversion TTC / HT (TVA 20 % non récupérable en franchise : tout est stocké en TTC)", () => {
  it("HT → TTC et TTC → HT, arrondis au centime", () => {
    expect(ttcDepuisHt(100)).toBe(120);
    expect(ttcDepuisHt(833.33)).toBe(1000);   // 999,996 arrondi au centime
    expect(htDepuisTtc(120)).toBe(100);
    expect(htDepuisTtc(1000)).toBe(833.33);
    expect(ttcDepuisHt(0)).toBe(0);
  });
  it("lireMontantTtc : la saisie HT est convertie, la saisie TTC reste telle quelle, le reste est refusé", () => {
    expect(lireMontantTtc("100", "ht")).toBe(120);
    expect(lireMontantTtc("100,50", "ht")).toBe(120.6);
    expect(lireMontantTtc("120", "ttc")).toBe(120);
    expect(lireMontantTtc("", "ht")).toBeNull();
    expect(lireMontantTtc("abc", "ttc")).toBeNull();
    expect(lireMontantTtc("-3", "ht")).toBeNull();
  });
  it("aller-retour stable à un centime près", () => {
    for (const ttc of [0.01, 9.99, 123.45, 1999.9]) expect(Math.abs(ttcDepuisHt(htDepuisTtc(ttc)) - ttc)).toBeLessThanOrEqual(0.01);
  });
});

describe("rentabilité : achat réel vs estimé", () => {
  const lignes = [{ prestation_id: "p1", quantite: 10, prix_unitaire: 50, type_branche: "materiau" }, { quantite: 2, prix_unitaire: 100, type_branche: "service", unite: "h" }];
  const devis = { id: "d", numero: "D-1", total_service: 200, total_materiau: 500, total_ttc: 700 };
  const prixAchat = { p1: 30 };                                   // estimé : 10 × 30 = 300 TTC
  const sans = analyserDevis(devis, lignes, prixAchat, {}, TAUX_PAR_DEFAUT, 0);
  const avec = analyserDevis(devis, lignes, prixAchat, {}, TAUX_PAR_DEFAUT, 0, 360);

  it("sans montant saisi : comportement d'avant (estimation)", () => {
    expect(sans.coutAchat).toBe(300);
    expect(sans.coutAchatEstime).toBe(300);
    expect(sans.coutAchatReel).toBeNull();
  });
  it("avec un montant réel : il remplace l'estimation dans le net et la marge, l'estimation reste disponible", () => {
    expect(avec.coutAchat).toBe(360);
    expect(avec.coutAchatEstime).toBe(300);
    expect(avec.coutAchatReel).toBe(360);
    expect(avec.net).toBeCloseTo(sans.net - 60, 2);
    expect(avec.margePct!).toBeLessThan(sans.margePct!);
  });
  it("un réel à 0 est une saisie (achat gratuit / stock), pas une absence", () => {
    const zero = analyserDevis(devis, lignes, prixAchat, {}, TAUX_PAR_DEFAUT, 0, 0);
    expect(zero.coutAchat).toBe(0);
    expect(zero.coutAchatReel).toBe(0);
  });
  it("le réel comble l'absence de prix d'achat : plus de marge « ≈ »", () => {
    const sansPrix = analyserDevis(devis, lignes, {}, {}, TAUX_PAR_DEFAUT, 0);
    expect(sansPrix.lignesSansCout).toBe(1);
    expect(analyserDevis(devis, lignes, {}, {}, TAUX_PAR_DEFAUT, 0, 250).lignesSansCout).toBe(0);
  });
  it("valeur réelle invalide : ignorée", () => {
    expect(analyserDevis(devis, lignes, prixAchat, {}, TAUX_PAR_DEFAUT, 0, NaN).coutAchat).toBe(300);
    expect(analyserDevis(devis, lignes, prixAchat, {}, TAUX_PAR_DEFAUT, 0, -5).coutAchat).toBe(300);
  });
  it("facturation partielle : estimé et réel suivent la même part", () => {
    const p = proratiser(avec, 0.5);
    expect(p.coutAchat).toBe(180);
    expect(p.coutAchatEstime).toBe(150);
    expect(p.coutAchatReel).toBe(180);
  });
  it("comparerAchat : écart, % et effet sur la marge", () => {
    const c = comparerAchat(300, 360, 700);
    expect(c).toEqual({ estimeTtc: 300, reelTtc: 360, ecart: 60, ecartPct: 20, effetMarge: -60, effetMargePts: -8.6 });
    const eco = comparerAchat(300, 240, 700);
    expect(eco.ecart).toBe(-60);
    expect(eco.effetMarge).toBe(60);
    expect(comparerAchat(0, 100, 700).ecartPct).toBeNull();
    expect(comparerAchat(100, 100, 0).effetMargePts).toBeNull();
  });
});
