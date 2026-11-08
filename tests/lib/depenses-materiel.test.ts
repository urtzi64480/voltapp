import { describe, expect, it } from "vitest";
import { ecartPct, estAAcheter, grouperParMois, libelleMois, lireDate, lireMontant, moisDe, type EntreeAchat } from "@/lib/depenses-materiel";
import { coutAchatLignes } from "@/lib/rentabilite";

const e = (o: Partial<EntreeAchat>): EntreeAchat => ({ devisId: "x", numero: "D-1", objet: "", client: "", statut: "signe", prevu: 0, reel: null, date: null, dateRef: "2026-11-03", ...o });

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
  it("le mois vient de la date d'achat, sinon de la date de repli", () => {
    expect(moisDe({ date: "2026-10-31", dateRef: "2026-11-03" })).toBe("2026-10");
    expect(moisDe({ date: null, dateRef: "2026-11-03" })).toBe("2026-11");
    expect(moisDe({ date: null, dateRef: "" })).toBe("inconnu");
  });
  it("libellés en français", () => {
    expect(libelleMois("2026-02")).toBe("février 2026");
    expect(libelleMois("2026-12")).toBe("décembre 2026");
    expect(libelleMois("inconnu")).toBe("Date inconnue");
    expect(libelleMois("2026-13")).toBe("Date inconnue");
  });
});

describe("grouperParMois", () => {
  const liste = [
    e({ devisId: "a", numero: "D-2026-010", reel: 120, prevu: 100, date: "2026-10-05" }),
    e({ devisId: "b", numero: "D-2026-009", reel: null, prevu: 50, date: null, dateRef: "2026-10-20" }),
    e({ devisId: "c", numero: "D-2026-011", reel: 80.5, prevu: 90, dateRef: "2026-11-02" }),
    e({ devisId: "d", numero: "D-2025-001", reel: 10, prevu: 10, dateRef: "2025-12-31" }),
    e({ devisId: "z", numero: "D-0", dateRef: "" }),
  ];
  const g = grouperParMois(liste, "2026-11");
  it("du plus récent au plus ancien, « date inconnue » en dernier", () => {
    expect(g.map(x => x.cle)).toEqual(["2026-11", "2026-10", "2025-12", "inconnu"]);
  });
  it("totaux : réel saisi, prévu comparable (devis saisis) et prévu total, devis à saisir", () => {
    const oct = g.find(x => x.cle === "2026-10")!;
    expect(oct.totalReel).toBe(120);
    expect(oct.prevuSaisis).toBe(100);
    expect(oct.totalPrevu).toBe(150);
    expect(oct.nbDevis).toBe(2);
    expect(oct.nbASaisir).toBe(1);
    expect(oct.entrees.map(x => x.devisId)).toEqual(["a", "b"]);        // triés par date d'achat puis numéro
  });
  it("un mois terminé (avant le mois courant) est replié ; le mois courant et la date inconnue ne le sont pas", () => {
    expect(g.map(x => [x.cle, x.termine])).toEqual([["2026-11", false], ["2026-10", true], ["2025-12", true], ["inconnu", false]]);
  });
  it("un achat daté d'un autre mois que la signature va dans son mois d'achat", () => {
    const r = grouperParMois([e({ reel: 5, date: "2026-12-01", dateRef: "2026-11-30" })], "2026-11");
    expect(r[0].cle).toBe("2026-12");
    expect(r[0].termine).toBe(false);                                    // mois futur : ouvert
  });
  it("liste vide : aucun groupe", () => expect(grouperParMois([], "2026-11")).toEqual([]));
  it("somme au centime près", () => {
    const r = grouperParMois([e({ reel: 0.1 }), e({ reel: 0.2 })], "2026-11");
    expect(r[0].totalReel).toBe(0.3);
  });
});

describe("ecartPct / estAAcheter", () => {
  it("écart en %, null si rien de prévu", () => {
    expect(ecartPct(120, 100)).toBe(20);
    expect(ecartPct(90, 100)).toBe(-10);
    expect(ecartPct(10, 0)).toBeNull();
  });
  it("devis signé avec matériel, ou déjà saisi ; jamais un brouillon sans saisie", () => {
    expect(estAAcheter({ statut: "signe", total_materiau: 100 })).toBe(true);
    expect(estAAcheter({ statut: "signe", total_materiau: 0, aLigneMateriau: true })).toBe(true);
    expect(estAAcheter({ statut: "signe", total_materiau: 0 })).toBe(false);
    expect(estAAcheter({ statut: "brouillon", total_materiau: 100 })).toBe(false);
    expect(estAAcheter({ statut: "refuse", total_materiau: 100, reel: 0 })).toBe(true);   // un 0 saisi est une saisie : rien ne disparaît
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
