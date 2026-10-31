import { describe, expect, it } from "vitest";
import { avancement, bilanDevis, cleLigne, groupesDevis, minutesDuSuivi, POSTE_HORS, type LigneDevisSuivi } from "@/lib/suivi-devis";
import { minutesReelles } from "@/lib/rentabilite";

const lignes: LigneDevisSuivi[] = [
  { id: "a", nom: "Prises salon", poste: "Salon", ordre: 1, type_branche: "materiau", quantite: 5, prix_unitaire: 10, unite: "u" },
  { id: "b", nom: "Pose salon", poste: "Salon", ordre: 2, type_branche: "service", quantite: 3, prix_unitaire: 50, unite: "heure" },
  { id: "c", nom: "Tableau", poste: "Tableau", ordre: 0, type_branche: "materiau", quantite: 1, prix_unitaire: 200, unite: "u" },
  { id: "d", nom: "Déplacement", poste: null, ordre: 3, type_branche: "service", quantite: 1, prix_unitaire: 30, unite: "forfait" },
  { id: "e", nom: "Main d'œuvre libre", poste: "", ordre: 4, type_branche: "service", quantite: 2, prix_unitaire: 55, unite: "h" },
];

describe("groupesDevis", () => {
  it("regroupe par poste dans l'ordre du devis, « Hors poste » en dernier, sans perdre de ligne", () => {
    const g = groupesDevis(lignes);
    expect(g.map(x => x.poste)).toEqual(["Tableau", "Salon", POSTE_HORS]);
    expect(g.flatMap(x => x.etapes)).toHaveLength(lignes.length);
    expect(g[2].etapes.map(e => e.ligne.id)).toEqual(["d", "e"]);
  });
  it("clés stables : id en base, sinon position dans le devis d'origine", () => {
    expect(cleLigne({ id: "x", nom: "" }, 3)).toBe("ligne:x");
    expect(cleLigne({ nom: "" }, 3)).toBe("ligne#3");
    const g = groupesDevis([{ nom: "A", poste: "P", ordre: 1 }, { nom: "B", poste: "P", ordre: 0 }]);
    expect(g[0].etapes.map(e => e.cle)).toEqual(["ligne#1", "ligne#0"]);
  });
  it("devis vide", () => { expect(groupesDevis([])).toEqual([]); });
});

describe("avancement", () => {
  const etapes = groupesDevis(lignes).flatMap(g => g.etapes);
  it("compte les étapes cochées, ignore les coches de lignes supprimées", () => {
    expect(avancement(etapes, { "ligne:a": "D", "ligne:zzz": "D" })).toEqual({ fait: 1, total: 5, pct: 20 });
    expect(avancement(etapes, {})).toEqual({ fait: 0, total: 5, pct: 0 });
    expect(avancement([], {})).toEqual({ fait: 0, total: 0, pct: 0 });
  });
});

describe("bilanDevis", () => {
  it("heures chiffrées par poste (lignes en heures), « Hors poste » compris", () => {
    const b = bilanDevis(lignes, {});
    expect(b.postes.find(p => p.poste === "Salon")?.chiffreMin).toBe(180);
    expect(b.postes.find(p => p.poste === POSTE_HORS)?.chiffreMin).toBe(120);
    expect(b.postes.find(p => p.poste === "Tableau")?.chiffreMin).toBe(0);
    expect(b.totalChiffreMin).toBe(300);
    expect(b.montantMO).toBe(260);
    expect(b.tauxReel).toBeNull();
    expect(b.ecartPct).toBeNull();
  });
  it("temps passé : écart, taux horaire réel, total", () => {
    const b = bilanDevis(lignes, { Salon: 240, [POSTE_HORS]: 120 });
    expect(b.totalPasseMin).toBe(360);
    expect(b.ecartPct).toBe(20);           // 360 passées pour 300 chiffrées
    expect(b.tauxReel).toBe(43.33);        // 260 € / 6 h
  });
  it("le temps d'un poste qui n'existe plus reste compté", () => {
    const b = bilanDevis(lignes, { Disparu: 30 });
    expect(b.postes.at(-1)).toEqual({ poste: "Disparu", chiffreMin: 0, passeMin: 30 });
    expect(b.totalPasseMin).toBe(30);
  });
  it("sans aucune heure chiffrée : pas d'écart, pas de taux", () => {
    const b = bilanDevis([lignes[0]], { Salon: 60 });
    expect(b).toMatchObject({ totalChiffreMin: 0, totalPasseMin: 60, ecartPct: null, tauxReel: null });
  });
});

describe("minutes et rentabilité", () => {
  const suivi = (o: object) => JSON.stringify({ v: 1, ...o });
  it("minutesDuSuivi : circuits + postes ; vide ou invalide = 0", () => {
    expect(minutesDuSuivi(suivi({ temps: { c: 30 }, tempsPostes: { Salon: 90 } }))).toBe(120);
    expect(minutesDuSuivi(null)).toBe(0);
    expect(minutesDuSuivi("n'importe quoi")).toBe(0);
  });
  it("minutesReelles = suivi du devis + suivi des projets rattachés", () => {
    const projets = [{ suivi_realisation: suivi({ chantier: { devis_id: "d1" }, tempsPostes: { A: 60 } }) }, { suivi_realisation: suivi({ chantier: { devis_id: "d2" }, tempsPostes: { A: 999 } }) }];
    expect(minutesReelles("d1", projets, suivi({ tempsPostes: { Salon: 30 } }))).toBe(90);
    expect(minutesReelles("d1", projets)).toBe(60);
    expect(minutesReelles("d3", [], suivi({ tempsPostes: { X: 15 } }))).toBe(15);
  });
});
