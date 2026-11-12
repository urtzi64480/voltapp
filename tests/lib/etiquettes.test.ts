import { describe, expect, it } from "vitest";
import {
  CLE_BROUILLON_ETIQUETTES, FORMATS, LIMITES, composerPlanches, couperLignes, estImprimable, etiquettesDepuisRangees, exemplaires, formatChoisi,
  composerEtiquette, grille, lireBrouillon, mettreEnPage, nettoyerTexte, nouvelleEtiquette, quantiteValide, serialiserBrouillon, brouillonVide, type FormatPlanche, type Mesure,
} from "@/lib/etiquettes";
import type { BreakerRow } from "@/lib/electrical-constants";

// Police fictive : 0,5 em par caractère (Helvetica ≈ 0,5 à 0,55 em).
const mesure: Mesure = (t, pt, gras) => t.length * pt * (25.4 / 72) * (gras ? 0.55 : 0.5);
const fmt = (o: Partial<FormatPlanche> = {}): FormatPlanche => ({ id: "x", nom: "x", largeur: 17.5, hauteur: 12, marge: 10, ecart: 1, ...o });
const et = (texte: string, quantite = 1, ligne2 = "") => ({ ...nouvelleEtiquette(texte, ligne2, quantite) });

describe("nettoyerTexte", () => {
  it("remplace les caractères hors Latin-1 courants et garde les accents", () => {
    expect(nettoyerTexte("Prises « salon » – 2 000 W… œuf")).toBe('Prises " salon " - 2 000 W... oeuf'.replace('" salon "', '" salon "'));
    expect(nettoyerTexte("Éclairage cuisine à côté")).toBe("Éclairage cuisine à côté");
  });
  it("retire emojis et symboles illisibles, espaces multiples, bornes la longueur", () => {
    expect(nettoyerTexte("Four 🔥   20A")).toBe("Four 20A");
    expect(nettoyerTexte("a".repeat(200))).toHaveLength(LIMITES.texte);
    expect(nettoyerTexte("   ")).toBe("");
  });
  it("valeurs non texte → chaîne vide", () => { for (const v of [null, undefined, 12, {}]) expect(nettoyerTexte(v)).toBe(""); });
  it("les espaces insécables sont conservés et ne sont jamais des points de coupure", () => {
    expect(nettoyerTexte("30\u00A0mA")).toBe("30\u00A0mA");
    const l = couperLignes("40\u00A0A - 30\u00A0mA - type\u00A0A", 17, 8, false, mesure);
    expect(l.every(x => !/30$/.test(x) && !/^mA/.test(x) && !/type$/.test(x))).toBe(true);
    expect(l.join(" ")).toBe("40\u00A0A - 30\u00A0mA - type\u00A0A");
  });
  it("conserve les retours à la ligne (max 1 ligne vide)", () => { expect(nettoyerTexte("a\r\n\n\n\nb")).toBe("a\n\nb"); });
});

describe("quantiteValide", () => {
  it("borne 1..100, arrondit, texte invalide → 1", () => {
    expect(quantiteValide(0)).toBe(1); expect(quantiteValide(-4)).toBe(1); expect(quantiteValide(3.6)).toBe(4);
    expect(quantiteValide(5000)).toBe(LIMITES.quantiteMax); expect(quantiteValide("abc")).toBe(1); expect(quantiteValide("7")).toBe(7); expect(quantiteValide(NaN)).toBe(1);
  });
});

describe("grille", () => {
  it("1 module sur A4 marge 10 : 10 colonnes × 21 lignes", () => { expect(grille(fmt())).toEqual({ colonnes: 10, lignes: 21, parPage: 210 }); });
  it("planche adhésive classique 38 × 21,2 sans écart, marge 5 : 5 × 13", () => {
    expect(grille(fmt({ largeur: 38, hauteur: 21.2, marge: 5, ecart: 0 }))).toEqual({ colonnes: 5, lignes: 13, parPage: 65 });
  });
  it("une étiquette qui remplit exactement la largeur utile compte (pas d'erreur de flottant)", () => { expect(grille(fmt({ largeur: 190, hauteur: 50, ecart: 0 }))).toMatchObject({ colonnes: 1, lignes: 5 }); });
  it("format trop grand ou invalide → null", () => {
    expect(grille(fmt({ largeur: 190, marge: 20 }))).toBeNull();
    for (const bad of [{ largeur: NaN }, { hauteur: 0 }, { largeur: -3 }, { marge: -1 }, { ecart: 99 }, { largeur: 500 }]) expect(grille(fmt(bad))).toBeNull();
  });
  it("tous les formats prédéfinis tiennent sur la page", () => { for (const f of FORMATS) expect(grille(f), f.id).not.toBeNull(); });
});

describe("composerPlanches", () => {
  it("une seule étiquette = une planche avec une case", () => {
    const r = composerPlanches([et("Four")], fmt());
    expect(r).not.toHaveProperty("erreur");
    if ("erreur" in r) return;
    expect(r.total).toBe(1); expect(r.planches).toHaveLength(1); expect(r.planches[0]).toHaveLength(1);
    expect(r.planches[0][0]).toMatchObject({ x: 10, y: 10 });
  });
  it("quantités, ordre de la liste et positions", () => {
    const r = composerPlanches([et("A", 2), et("B", 1)], fmt());
    if ("erreur" in r) throw new Error(r.erreur);
    expect(r.planches[0].map(c => c.etiquette?.texte)).toEqual(["A", "A", "B"]);
    expect(r.planches[0][1].x).toBeCloseTo(10 + 18.5); expect(r.planches[0][2].x).toBeCloseTo(10 + 37);
  });
  it("passe à la ligne puis à la page suivante", () => {
    const r = composerPlanches([et("X", 100), et("Y", 100), et("Z", 30)], fmt());   // 230 > 210 par page
    if ("erreur" in r) throw new Error(r.erreur);
    expect(r.planches).toHaveLength(2); expect(r.planches[0]).toHaveLength(210); expect(r.planches[1]).toHaveLength(20);
    expect(r.planches[0][10].x).toBe(10); expect(r.planches[0][10].y).toBeCloseTo(10 + 13);
    expect(r.planches[1][0]).toMatchObject({ x: 10, y: 10 });
  });
  it("planche entamée : les premières cases restent vides", () => {
    const r = composerPlanches([et("A", 2)], fmt(), 3);
    if ("erreur" in r) throw new Error(r.erreur);
    expect(r.planches[0].map(c => c.etiquette?.texte ?? null)).toEqual([null, null, null, "A", "A"]);
  });
  it("décalage borné à la planche : jamais de planche entièrement vide, valeurs absurdes ignorées", () => {
    const g = grille(fmt())!;
    const r = composerPlanches([et("A")], fmt(), 99999);
    if ("erreur" in r) throw new Error(r.erreur);
    expect(r.planches[0].filter(c => c.etiquette)).toHaveLength(1); expect(r.planches[0]).toHaveLength(g.parPage);
    for (const d of [-5, NaN]) { const q = composerPlanches([et("A")], fmt(), d); if ("erreur" in q) throw new Error(q.erreur); expect(q.planches[0]).toHaveLength(1); }
  });
  it("le décalage repousse sur une 2e page quand la liste ne tient plus", () => {
    const r = composerPlanches([et("A", 5)], fmt({ largeur: 90, hauteur: 130, ecart: 0, marge: 10 }), 3);   // 2 × 2 = 4 par page : 3 cases vides + 5 = 8 → 2 pages
    if ("erreur" in r) throw new Error(r.erreur);
    expect(r.grille.parPage).toBe(4); expect(r.planches).toHaveLength(2);
  });
  it("étiquettes vides ignorées ; rien à imprimer → erreur", () => {
    expect(composerPlanches([et(""), et("   ", 5, "  ")], fmt())).toEqual({ erreur: expect.stringContaining("Aucune étiquette") });
    expect(exemplaires([et(""), et("", 3, "16 A")])).toHaveLength(3);
  });
  it("plafond de 1000 exemplaires", () => {
    const r = composerPlanches(Array.from({ length: 11 }, () => et("A", 100)), fmt());
    expect(r).toEqual({ erreur: expect.stringContaining("1000") });
  });
  it("format invalide / trop grand → messages distincts", () => {
    expect(composerPlanches([et("A")], fmt({ largeur: NaN }))).toEqual({ erreur: expect.stringContaining("invalides") });
    expect(composerPlanches([et("A")], fmt({ largeur: 190, marge: 20 }))).toEqual({ erreur: expect.stringContaining("trop grand") });
  });
});

describe("couperLignes / mettreEnPage", () => {
  it("coupe aux espaces et respecte la largeur", () => {
    const l = couperLignes("Prises cuisine plan de travail", 20, 8, true, mesure);
    expect(l.length).toBeGreaterThan(1); for (const x of l) expect(mesure(x, 8, true)).toBeLessThanOrEqual(20);
    expect(l.join(" ")).toBe("Prises cuisine plan de travail");
  });
  it("coupe un mot plus large que l'étiquette au lieu de déborder", () => {
    const l = couperLignes("Anticonstitutionnellement", 15, 8, true, mesure);
    expect(l.length).toBeGreaterThan(1); expect(l.join("")).toBe("Anticonstitutionnellement"); for (const x of l) expect(mesure(x, 8, true)).toBeLessThanOrEqual(15);
  });
  it("coupe aux traits d'union plutôt qu'au milieu d'un mot", () => {
    const l = couperLignes("Lave-vaisselle", 16, 8, true, mesure);
    expect(l).toEqual(["Lave-", "vaisselle"]);
  });
  it("mot trop large sans autorisation de couper : garde sa ligne (l'appelant réduit la police)", () => {
    expect(couperLignes("Anticonstitutionnellement", 15, 8, true, mesure, false)).toEqual(["Anticonstitutionnellement"]);
  });
  it("ne casse jamais un mot qui peut tenir en réduisant la police", () => {
    for (const mot of ["Lave-linge", "Éclairage", "Prises", "Chauffe-eau", "Congélateur"]) {
      const m = mettreEnPage(mot, "20 A", 17.5, 12, mesure);
      expect(m.filter(x => x.gras).map(x => x.texte).join("").replace(/\s/g, ""), mot).toBe(mot);
      for (const l of m.filter(x => x.gras)) expect(["Lave-", "linge", "Chauffe-", "eau"].includes(l.texte) || l.texte === mot, `${mot} → ${l.texte}`).toBe(true);
    }
  });
  it("texte court : grande taille, centré verticalement", () => {
    const m = mettreEnPage("Four", "", 35, 12, mesure);
    expect(m).toHaveLength(1); expect(m[0].pt).toBeGreaterThanOrEqual(10); expect(m[0].gras).toBe(true);
    expect(m[0].y).toBeGreaterThan(0); expect(m[0].y).toBeLessThan(12);
  });
  it("texte long : la taille diminue, tout tient dans l'étiquette", () => {
    const court = mettreEnPage("Four", "", 17.5, 12, mesure)[0].pt;
    const long = mettreEnPage("Lave-vaisselle", "", 17.5, 12, mesure);
    expect(Math.min(...long.map(x => x.pt))).toBeLessThan(court);
    for (const x of long) { expect(mesure(x.texte, x.pt, x.gras)).toBeLessThanOrEqual(17.5 - 2.4 + 1e-6); expect(x.y).toBeLessThanOrEqual(12); }
  });
  it("2e ligne (calibre) plus petite, en dessous, sans sortir de l'étiquette", () => {
    const m = mettreEnPage("Four", "20 A", 35, 12, mesure);
    expect(m).toHaveLength(2); expect(m[1].pt).toBeLessThan(m[0].pt); expect(m[1].y).toBeGreaterThan(m[0].y); expect(m[1].gras).toBe(false); expect(m[1].y).toBeLessThanOrEqual(12);
  });
  it("2e ligne seule : taille normale", () => { const m = mettreEnPage("", "16 A", 35, 12, mesure); expect(m).toHaveLength(1); expect(m[0].gras).toBe(false); });
  it("texte impossible à placer : tronqué avec « ... », jamais de débordement", () => {
    const m = mettreEnPage("Chauffe-eau cumulus salle de bains étage parents", "", 17.5, 4, mesure);
    expect(m.length).toBeGreaterThan(0);
    expect(m[m.length - 1].texte.endsWith("...")).toBe(true);
    for (const x of m) { expect(mesure(x.texte, x.pt, x.gras)).toBeLessThanOrEqual(17.5 - 2.4 + 1e-6); expect(x.y).toBeLessThanOrEqual(4 + 0.5); }
  });
  it("vide → aucune ligne", () => { expect(mettreEnPage("  ", "", 20, 10, mesure)).toEqual([]); });
});

describe("etiquettesDepuisRangees", () => {
  const b = (o: Record<string, unknown>) => ({ id: 1, label: "", circuit: "lumiere", amperes: 10, type: "1P", pieces: [], ...o });
  it("une étiquette par appareil, nom du circuit par défaut, calibre en 2e ligne, différentiel détaillé", () => {
    const rows = [{ id: 1, name: "R1", slots: [b({ type: "diff-A", label: "", circuit: "x", amperes: 40 }), b({ label: "Salon" }), null, b({ circuit: "four", amperes: 20 })] }] as unknown as BreakerRow[];
    const e = etiquettesDepuisRangees(rows);
    expect(e.map(x => [x.texte, x.ligne2])).toEqual([["ID A", "40\u00A0A - 30\u00A0mA - type\u00A0A"], ["Salon", "10\u00A0A"], ["Four", "20\u00A0A"]]);
    expect(e.every(x => x.quantite === 1)).toBe(true);
    expect(new Set(e.map(x => x.id)).size).toBe(3);
  });
  it("données absentes ou abîmées → aucune exception", () => {
    expect(etiquettesDepuisRangees(undefined as never)).toEqual([]);
    expect(etiquettesDepuisRangees([null, { slots: "x" }, { slots: [{ label: "", circuit: "?", type: "?" }] }] as never)).toEqual([]);
    expect(etiquettesDepuisRangees([{ id: 1, name: "", slots: [b({ label: "Cave", amperes: 0 })] }] as never)[0]).toMatchObject({ texte: "Cave", ligne2: "" });
  });
});

describe("brouillon", () => {
  it("aller-retour complet", () => {
    const x = { ...brouillonVide(), etiquettes: [et("Four", 2, "20 A")], formatId: "modules-2", debut: 4, guides: false };
    const y = lireBrouillon(serialiserBrouillon(x));
    expect(y.etiquettes[0]).toMatchObject({ texte: "Four", ligne2: "20 A", quantite: 2 }); expect(y).toMatchObject({ formatId: "modules-2", debut: 4, guides: false });
    expect(formatChoisi(y).id).toBe("modules-2");
  });
  it("illisible, version inconnue ou champs invalides → valeurs par défaut", () => {
    for (const brut of [null, "", "{", "[]", '{"v":2}', "null"]) expect(lireBrouillon(brut).etiquettes).toHaveLength(1);
    const y = lireBrouillon(JSON.stringify({ v: 1, etiquettes: [null, { texte: 5, quantite: "zz" }, { texte: "OK", quantite: 9999 }], formatId: "inconnu", perso: { largeur: "x" }, debut: -3 }));
    expect(y.formatId).toBe("modules-1"); expect(y.debut).toBe(0); expect(y.etiquettes.map(e => e.quantite)).toEqual([1, LIMITES.quantiteMax]); expect(y.perso.largeur).toBe(38);
  });
  it("format personnalisé repris tel quel", () => {
    const f = formatChoisi({ formatId: "perso", perso: { id: "perso", nom: "x", largeur: 50, hauteur: 30, marge: 7, ecart: 2 } });
    expect(f).toMatchObject({ largeur: 50, hauteur: 30, marge: 7, ecart: 2 });
  });
  it("clé de stockage stable", () => { expect(CLE_BROUILLON_ETIQUETTES).toBe("voltapp:etiquettes"); expect(estImprimable({ texte: "", ligne2: "" })).toBe(false); });
});

describe("composerEtiquette (pictogramme + texte)", () => {
  const dansLEtiquette = (r: ReturnType<typeof composerEtiquette>, w: number, h: number) => {
    if (r.picto) { expect(r.picto.x).toBeGreaterThanOrEqual(0); expect(r.picto.y).toBeGreaterThanOrEqual(0); expect(r.picto.x + r.picto.taille).toBeLessThanOrEqual(w + 1e-9); expect(r.picto.y + r.picto.taille).toBeLessThanOrEqual(h + 1e-9); }
    for (const l of r.lignes) { expect(l.y).toBeGreaterThan(0); expect(l.y).toBeLessThanOrEqual(h + 1e-9); }
  };
  it("étiquette large : pictogramme à gauche, texte centré dans le reste sans le chevaucher", () => {
    const r = composerEtiquette("Lave-linge", "20 A", 35, 12, "lave_linge", mesure);
    expect(r.picto).not.toBeNull(); dansLEtiquette(r, 35, 12);
    expect(r.picto!.x).toBeLessThan(3); expect(r.picto!.taille).toBeCloseTo(12 - 2.4);
    for (const l of r.lignes) {
      const demi = mesure(l.texte, l.pt, l.gras) / 2;
      expect(l.x - demi).toBeGreaterThanOrEqual(r.picto!.x + r.picto!.taille - 1e-6);   // le texte commence après le pictogramme
      expect(l.x + demi).toBeLessThanOrEqual(35 + 1e-6);
    }
  });
  it("étiquette haute : pictogramme au-dessus, texte en dessous", () => {
    const r = composerEtiquette("Four", "", 30, 25, "four", mesure);
    expect(r.picto).not.toBeNull(); dansLEtiquette(r, 30, 25);
    expect(r.picto!.x).toBeCloseTo((30 - r.picto!.taille) / 2);
    for (const l of r.lignes) expect(l.y).toBeGreaterThan(r.picto!.y + r.picto!.taille);
  });
  it("1 module (17,5 × 12 mm) : pictogramme au-dessus, texte en dessous, le tout dans l'étiquette", () => {
    const r = composerEtiquette("Four", "20 A", 17.5, 12, "four", mesure);
    expect(r.picto).not.toBeNull(); dansLEtiquette(r, 17.5, 12);
    expect(r.picto!.taille).toBeGreaterThanOrEqual(5); expect(r.lignes.length).toBeGreaterThan(0);
    for (const l of r.lignes) { expect(l.y).toBeGreaterThan(r.picto!.y + r.picto!.taille); expect(l.x).toBe(17.5 / 2); expect(mesure(l.texte, l.pt, l.gras)).toBeLessThanOrEqual(17.5 - 2.4 + 1e-6); }
  });
  it("sans pictogramme demandé ou identifiant inconnu : texte seul", () => {
    expect(composerEtiquette("Four", "", 35, 12, null, mesure).picto).toBeNull();
    expect(composerEtiquette("Four", "", 35, 12, "constructor", mesure).picto).toBeNull();
    expect(composerEtiquette("Four", "", 35, 12, "inconnu", mesure).picto).toBeNull();
  });
  it("taille du pictogramme plafonnée et jamais sous 4 mm", () => {
    expect(composerEtiquette("Grande", "", 90, 40, "four", mesure).picto!.taille).toBe(18);
    expect(composerEtiquette("Bandeau", "", 105, 8, "four", mesure).picto!.taille).toBeCloseTo(5.6);   // 8 − 2,4 ≥ 4 → présent
    expect(composerEtiquette("Bandeau bas", "", 105, 6, "four", mesure).picto).toBeNull();            // 6 − 2,4 < 4 → omis
  });
  it("tous les formats prédéfinis donnent une mise en page cohérente avec un pictogramme", () => {
    for (const f of FORMATS) { const r = composerEtiquette("Lave-vaisselle", "20 A", f.largeur, f.hauteur, "lave_vaisselle", mesure); dansLEtiquette(r, f.largeur, f.hauteur); expect(r.lignes.length, f.id).toBeGreaterThan(0); }
  });
});

describe("brouillon : pictogrammes", () => {
  it("choix par étiquette et réglage global conservés", () => {
    const x = { ...brouillonVide(), etiquettes: [{ ...et("Four"), icone: "prise" }, { ...et("Cave"), icone: "aucune" }, et("Salon")], pictos: false };
    const y = lireBrouillon(serialiserBrouillon(x));
    expect(y.etiquettes.map(e => e.icone)).toEqual(["prise", "aucune", undefined]); expect(y.pictos).toBe(false);
  });
  it("identifiant inconnu ou piégé ignoré, pictogrammes actifs par défaut", () => {
    const y = lireBrouillon(JSON.stringify({ v: 1, etiquettes: [{ texte: "A", icone: "constructor" }, { texte: "B", icone: 12 }, { texte: "C", icone: "__proto__" }] }));
    expect(y.etiquettes.map(e => e.icone)).toEqual([undefined, undefined, undefined]); expect(y.pictos).toBe(true);
  });
});
