import { describe, expect, it } from "vitest";
import {
  CLE_BROUILLON_ETIQUETTES, DIMS_STANDARD, LIMITES, colonnesMini, composerGroupes, composerPicto, etiquettesDuGenre, formatDe, genresDuMode, modeValide, composerPlanches, couperLignes, estImprimable, etiquettesDepuisRangees, exemplaires,
  composerEtiquette, grille, lireBrouillon, maxParRangee, mettreEnPage, nomsRaccourcis, pageDe, nettoyerTexte, nouvelleEtiquette, quantiteValide, serialiserBrouillon, brouillonVide,
  type FormatPlanche, type Mesure,
} from "@/lib/etiquettes";
/** Carré de test : la mise en page générique (côte à côte, rangées, pages) ne dépend pas des zones standard. */
const FORMAT_STANDARD: FormatPlanche = { id: "c", nom: "c", largeur: 17.5, hauteur: 17.5, marge: 8, ecart: 0 };
import type { BreakerRow } from "@/lib/electrical-constants";

// Police fictive : 0,5 em par caractère (Helvetica ≈ 0,5 à 0,55 em).
const mesure: Mesure = (t, pt, gras) => t.length * pt * (25.4 / 72) * (gras ? 0.55 : 0.5);
const fmt = (o: Partial<FormatPlanche> = {}): FormatPlanche => ({ id: "x", nom: "x", largeur: 17.5, hauteur: 12, marge: 10, ecart: 1, ...o });
const et = (texte: string, quantite = 1, ligne2 = "") => ({ ...nouvelleEtiquette(texte, ligne2, quantite) });

describe("nettoyerTexte", () => {
  it("remplace les caractères hors Latin-1 courants et garde les accents", () => {
    expect(nettoyerTexte("« salon » – 2 000 W… œuf", 100)).toBe('" salon " - 2 000 W... oeuf');
    expect(nettoyerTexte("Éclairage cuisine à côté", 100)).toBe("Éclairage cuisine à côté");
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
  it("le format standard tient sur la page, en portrait comme en paysage", () => { expect(grille(FORMAT_STANDARD)).not.toBeNull(); expect(grille({ ...FORMAT_STANDARD, paysage: true })).not.toBeNull(); });
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
    const m = mettreEnPage("Chauffe-eau cumulus salle de bains étage parents", "", 10, 3, mesure);
    expect(m.length).toBeGreaterThan(0);
    expect(m[m.length - 1].texte.endsWith("...")).toBe(true);
    for (const x of m) { expect(mesure(x.texte, x.pt, x.gras)).toBeLessThanOrEqual(10 - 2.4 + 1e-6); expect(x.y).toBeLessThanOrEqual(3 + 0.5); }
  });
  it("vide → aucune ligne", () => { expect(mettreEnPage("  ", "", 20, 10, mesure)).toEqual([]); });
});

describe("etiquettesDepuisRangees", () => {
  const b = (o: Record<string, unknown>) => ({ id: 1, label: "", circuit: "lumiere", amperes: 10, type: "1P", pieces: [], ...o });
  it("une étiquette par appareil, nom du circuit par défaut, calibre en 2e ligne, différentiel détaillé", () => {
    const rows = [{ id: 1, name: "R1", slots: [b({ type: "diff-A", label: "", circuit: "x", amperes: 40 }), b({ label: "Salon" }), null, b({ circuit: "four", amperes: 20 })] }] as unknown as BreakerRow[];
    const e = etiquettesDepuisRangees(rows);
    expect(e.map(x => [x.texte, x.ligne2])).toEqual([["ID A", "40\u00A0A - 30\u00A0mA"], ["Salon", "10\u00A0A"], ["Four", "20\u00A0A"]]);
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
    const y0 = { ...brouillonVide(), etiquettes: [et("Four", 2, "20 A")], debut: 4, guides: false, paysage: true, ligneParRangee: false };
    const y = lireBrouillon(serialiserBrouillon(y0));
    expect(y.etiquettes[0]).toMatchObject({ texte: "Four", ligne2: "20 A", quantite: 2 }); expect(y).toMatchObject({ debut: 4, guides: false, paysage: true, ligneParRangee: false });
    expect(y).toMatchObject({ mode: "les-deux", dims: DIMS_STANDARD });
  });
  it("mode et zones personnalisées conservés ; valeurs hors bornes → standard de la sorte", () => {
    const y0 = { ...brouillonVide(), mode: "picto" as const, dims: { picto: { largeur: 14, hauteur: 11, marge: 5, ecart: 1 }, texte: { largeur: 30, hauteur: 9.5, marge: 6, ecart: 0.5 } } };
    expect(lireBrouillon(serialiserBrouillon(y0))).toMatchObject({ mode: "picto", dims: y0.dims });
    const z = lireBrouillon(JSON.stringify({ v: 1, mode: "nimporte", dims: { picto: { largeur: -3, hauteur: "x", marge: 999, ecart: null }, texte: 5 } }));
    expect(z.mode).toBe("les-deux"); expect(z.dims).toEqual(DIMS_STANDARD);
  });
  it("illisible, version inconnue ou champs invalides → valeurs par défaut", () => {
    for (const brut of [null, "", "{", "[]", '{"v":2}', "null"]) expect(lireBrouillon(brut).etiquettes).toHaveLength(1);
    const y = lireBrouillon(JSON.stringify({ v: 1, etiquettes: [null, { texte: 5, quantite: "zz" }, { texte: "OK", quantite: 9999 }], debut: -3 }));
    expect(y.debut).toBe(0); expect(y.etiquettes.map(e => e.quantite)).toEqual([1, LIMITES.quantiteMax]);
  });
  it("un ancien brouillon (formatId, perso, modules, pictos) est repris avec les zones standard", () => {
    const y = lireBrouillon(JSON.stringify({ v: 1, etiquettes: [{ texte: "A", modules: 3 }], formatId: "perso", perso: { largeur: 50, hauteur: 30, marge: 7, ecart: 2 }, pictos: false }));
    expect(y.dims).toEqual(DIMS_STANDARD); expect(y.etiquettes[0]).not.toHaveProperty("modules"); expect(y).not.toHaveProperty("pictos");
  });
  it("noms et 2e lignes d'un ancien brouillon ramenés aux limites", () => {
    const y = lireBrouillon(JSON.stringify({ v: 1, etiquettes: [{ texte: "Prises cuisine plan de travail et îlot", ligne2: "20 A - 30 mA - type A - différentiel" }] }));
    expect(y.etiquettes[0].texte.length).toBeLessThanOrEqual(LIMITES.texte); expect(y.etiquettes[0].ligne2.length).toBeLessThanOrEqual(LIMITES.ligne2);
  });
  it("clé de stockage stable", () => { expect(CLE_BROUILLON_ETIQUETTES).toBe("voltapp:etiquettes"); expect(estImprimable({ texte: "", ligne2: "" })).toBe(false); });
});

describe("composerEtiquette (pictogramme + texte)", () => {
  const dansLEtiquette = (r: ReturnType<typeof composerEtiquette>, w: number, h: number) => {
    if (r.picto) { expect(r.picto.x).toBeGreaterThanOrEqual(0); expect(r.picto.y).toBeGreaterThanOrEqual(0); expect(r.picto.x + r.picto.taille).toBeLessThanOrEqual(w + 1e-9); expect(r.picto.y + r.picto.taille).toBeLessThanOrEqual(h + 1e-9); }
    for (const l of r.lignes) { expect(l.y).toBeGreaterThan(0); expect(l.y).toBeLessThanOrEqual(h + 1e-9); }
  };
  it("le pictogramme est TOUJOURS au-dessus et centré, jamais à côté, quelle que soit la forme de l'étiquette", () => {
    for (const [w, h] of [[12.7, 9.5], [25, 9], [47, 9], [35, 12], [60, 25], [90, 40], [105, 8]]) {
      const r = composerEtiquette("Lave-linge", "20 A", w, h, "lave_linge", mesure);
      expect(r.picto, `${w}×${h}`).not.toBeNull(); dansLEtiquette(r, w, h);
      expect(r.picto!.x + r.picto!.taille / 2, `${w}×${h} centré`).toBeCloseTo(w / 2);
      expect(r.lignes.length).toBeGreaterThan(0);
      for (const l of r.lignes) { expect(l.x).toBe(w / 2); expect(l.y, `${w}×${h} texte sous l'icône`).toBeGreaterThan(r.picto!.y + r.picto!.taille); }
    }
  });
  it("1 module Legrand (12,7 × 9,5 mm) : icône au-dessus, texte en dessous, tout dans l'étiquette", () => {
    const r = composerEtiquette("Four", "20 A", 12.7, 9.5, "four", mesure);
    expect(r.picto).not.toBeNull(); dansLEtiquette(r, 12.7, 9.5);
    expect(r.picto!.taille).toBeGreaterThanOrEqual(3.5);
    for (const l of r.lignes) { expect(mesure(l.texte, l.pt, l.gras)).toBeLessThanOrEqual(12.7 - 2.4 + 1e-6); expect(l.pt).toBeGreaterThanOrEqual(4); }
  });
  it("sans pictogramme demandé ou identifiant inconnu : texte seul", () => {
    expect(composerEtiquette("Four", "", 35, 12, null, mesure).picto).toBeNull();
    expect(composerEtiquette("Four", "", 35, 12, "constructor", mesure).picto).toBeNull();
    expect(composerEtiquette("Four", "", 35, 12, "inconnu", mesure).picto).toBeNull();
  });
  it("taille du pictogramme plafonnée à 18 mm, omis seulement si l'étiquette est trop basse (< 3,5 mm)", () => {
    expect(composerEtiquette("Grande", "", 90, 40, "four", mesure).picto!.taille).toBe(18);
    expect(composerEtiquette("Bandeau", "", 105, 8, "four", mesure).picto!.taille).toBeGreaterThanOrEqual(3.5);
    expect(composerEtiquette("Trop bas", "", 105, 5, "four", mesure).picto).toBeNull();   // 5 × 0,45 = 2,25 < 3,5
    expect(composerEtiquette("Trop bas", "", 105, 5, "four", mesure).lignes.length).toBeGreaterThan(0);
  });
  it("2 modules (25 × 9 mm) : nom ET calibre tiennent sous l'icône, le nom n'est jamais tronqué à la place du calibre", () => {
    for (const nom of ["Lave-linge", "Lave-vaisselle", "Chauffe-eau", "Plaque", "Four", "Éclairage", "Volets"]) {
      const r = composerEtiquette(nom, "20 A", 25, 9, "four", mesure);
      expect(r.picto, nom).not.toBeNull();
      expect(r.lignes.map(l => l.texte).join(" "), nom).toBe(`${nom} 20 A`);
    }
  });
  it("quand nom + calibre ne peuvent vraiment pas tenir, le nom reste entier et le calibre saute", () => {
    const r = mettreEnPage("Lave-vaisselle", "20 A", 12.7, 4.2, mesure);
    expect(r.map(l => l.texte).join("")).toBe("Lave-vaisselle");   // coupé après le tiret, nom complet, pas de « 20 A »
  });
  it("texte long sur 1 module : jamais de débordement, tronqué si besoin", () => {
    const r = composerEtiquette("Lave-vaisselle cuisine", "20 A", 12.7, 9.5, "lave_vaisselle", mesure);
    for (const l of r.lignes) expect(mesure(l.texte, l.pt, l.gras)).toBeLessThanOrEqual(12.7 - 2.4 + 1e-6);
  });
  it("format standard : mise en page cohérente avec un pictogramme", () => {
    const f = FORMAT_STANDARD; const r = composerEtiquette("Lave-vaisselle", "20 A", f.largeur, f.hauteur, "lave_vaisselle", mesure); dansLEtiquette(r, f.largeur, f.hauteur); expect(r.lignes.length).toBeGreaterThan(0);
  });
});

describe("brouillon : pictogrammes", () => {
  it("choix par étiquette conservés", () => {
    const x = { ...brouillonVide(), etiquettes: [{ ...et("Four"), icone: "prise" }, { ...et("Cave"), icone: "aucune" }, et("Salon")] };
    const y = lireBrouillon(serialiserBrouillon(x));
    expect(y.etiquettes.map(e => e.icone)).toEqual(["prise", "aucune", undefined]);
  });
  it("identifiant inconnu ou piégé ignoré, pictogrammes actifs par défaut", () => {
    const y = lireBrouillon(JSON.stringify({ v: 1, etiquettes: [{ texte: "A", icone: "constructor" }, { texte: "B", icone: 12 }, { texte: "C", icone: "__proto__" }] }));
    expect(y.etiquettes.map(e => e.icone)).toEqual([undefined, undefined, undefined]);
  });
});

describe("deux sortes d'étiquettes, deux zones d'impression", () => {
  const dims = DIMS_STANDARD;
  it("zones standard : pictogramme 12,7 × 9,5 mm (fenêtre Legrand), texte 17,5 × 8 mm (un module, repère Logicab2)", () => {
    expect(dims.picto).toMatchObject({ largeur: 12.7, hauteur: 9.5, ecart: 0 });
    expect(dims.texte).toMatchObject({ largeur: 17.5, hauteur: 8, ecart: 0 });
    expect(formatDe("texte", dims.texte, true)).toMatchObject({ id: "texte", largeur: 17.5, hauteur: 8, paysage: true });
  });
  it("modes : pictos seuls, textes seuls ou les deux ; valeur inconnue refusée", () => {
    expect(genresDuMode("picto")).toEqual(["picto"]); expect(genresDuMode("texte")).toEqual(["texte"]); expect(genresDuMode("les-deux")).toEqual(["picto", "texte"]);
    expect(["picto", "texte", "les-deux"].every(modeValide)).toBe(true); expect(modeValide("tout")).toBe(false); expect(modeValide(undefined)).toBe(false);
  });
  it("colonnes par ligne : A4 portrait 15 (12,7 mm) et 11 (17,5 mm) ; paysage 20 et 16 ; en mode « les deux » on prend le plus petit", () => {
    expect(grille(formatDe("picto", dims.picto, false))?.colonnes).toBe(15);
    expect(grille(formatDe("texte", dims.texte, false))?.colonnes).toBe(11);
    expect(colonnesMini("les-deux", dims, false)).toBe(11); expect(colonnesMini("picto", dims, false)).toBe(15); expect(colonnesMini("les-deux", dims, true)).toBe(16);
    expect(colonnesMini("texte", { ...dims, texte: { ...dims.texte, largeur: 500 } }, false)).toBe(0);
  });
  it("plafonds de caractères : 16 pour le nom, 14 pour la 2e ligne", () => {
    expect([LIMITES.texte, LIMITES.ligne2]).toEqual([16, 14]);
    expect(nettoyerTexte("Prises cuisine plan de travail")).toHaveLength(16);
    expect(nettoyerTexte("125\u00A0A - 30\u00A0mA", LIMITES.ligne2)).toBe("125\u00A0A - 30\u00A0mA");
  });
  const liste = [{ ...et("Lave-linge"), rangee: 0 }, { ...et("Four"), rangee: 0 }, { ...et("Salon"), rangee: 1 }, { ...et("Cave"), icone: "aucune", rangee: 1 }];
  const o = { mode: "les-deux" as const, dims, paysage: false, debut: 0, ligneParRangee: true };
  it("pictos : seules les étiquettes avec un pictogramme (reconnu ou choisi) ; textes : toutes", () => {
    expect(etiquettesDuGenre(liste, "picto").map(e => e.texte)).toEqual(["Lave-linge", "Four"]);
    expect(etiquettesDuGenre(liste, "texte")).toHaveLength(4);
  });
  it("« les deux » : une planche de pictogrammes puis une planche de textes, aux dimensions de chaque sorte", () => {
    const r = composerGroupes(liste, o); if ("erreur" in r) throw new Error(r.erreur);
    expect(r.groupes.map(g => g.genre)).toEqual(["picto", "texte"]);
    expect(r.groupes[0].total).toBe(2); expect(r.groupes[1].total).toBe(4); expect(r.sansPicto).toBe(2);
    expect(r.groupes[0].planches[0].every(c => c.largeur === 12.7 && c.hauteur === 9.5)).toBe(true);
    expect(r.groupes[1].planches[0].every(c => c.largeur === 17.5 && c.hauteur === 8)).toBe(true);
  });
  it("un seul mode : un seul groupe ; « textes seuls » ne compte aucune étiquette sans picto", () => {
    for (const mode of ["picto", "texte"] as const) { const r = composerGroupes(liste, { ...o, mode }); if ("erreur" in r) throw new Error(r.erreur); expect(r.groupes).toHaveLength(1); expect(r.groupes[0].genre).toBe(mode); }
    const t = composerGroupes(liste, { ...o, mode: "texte" }); if ("erreur" in t) throw new Error(t.erreur); expect(t.sansPicto).toBe(0);
  });
  it("zone personnalisée (vieux tableau) utilisée telle quelle", () => {
    const perso = { ...dims, texte: { largeur: 24, hauteur: 12, marge: 5, ecart: 1 } };
    const r = composerGroupes(liste, { ...o, mode: "texte", dims: perso }); if ("erreur" in r) throw new Error(r.erreur);
    expect(r.groupes[0].planches[0][1]).toMatchObject({ x: 5 + 25, y: 5, largeur: 24, hauteur: 12 });
  });
  it("erreurs lisibles : aucun pictogramme, dimensions invalides (nommant la planche), rien à imprimer", () => {
    expect((composerGroupes([et("Salon")], { ...o, mode: "picto" }) as { erreur: string }).erreur).toMatch(/pictogramme/);
    expect((composerGroupes(liste, { ...o, dims: { ...dims, texte: { ...dims.texte, largeur: NaN } } }) as { erreur: string }).erreur).toMatch(/Textes/);
    expect((composerGroupes([et("")], o) as { erreur: string }).erreur).toMatch(/Aucune étiquette/);
  });
  it("la case de début s'applique à chaque planche", () => {
    const r = composerGroupes(liste, { ...o, debut: 2 }); if ("erreur" in r) throw new Error(r.erreur);
    for (const g of r.groupes) expect(g.planches[0].slice(0, 2).every(c => c.etiquette === null)).toBe(true);
  });
  it("composerPicto : centré, le plus grand possible ; null si inconnu ou trop petit", () => {
    const p = composerPicto(12.7, 9.5, "lave_linge")!;
    expect(p.taille).toBeCloseTo(9.5 - 2 * 0.95, 5); expect(p.x).toBeCloseTo((12.7 - p.taille) / 2, 5); expect(p.y).toBeCloseTo((9.5 - p.taille) / 2, 5);
    expect(composerPicto(12.7, 9.5, null)).toBeNull(); expect(composerPicto(12.7, 9.5, "constructor")).toBeNull(); expect(composerPicto(3, 3, "four")).toBeNull();
  });
});

describe("étiquettes côte à côte, toutes identiques", () => {
  const carre = FORMAT_STANDARD;
  const e1 = (texte: string, rangee?: number) => ({ ...nouvelleEtiquette(texte), ...(rangee === undefined ? {} : { rangee }) });
  const poser = (liste: ReturnType<typeof e1>[], f: FormatPlanche = carre, debut = 0, opt = {}) => { const r = composerPlanches(liste, f, debut, opt); if ("erreur" in r) throw new Error(r.erreur); return r; };

  it("disjoncteur, différentiel, quel que soit le texte : TOUTES les cases font exactement 17,5 × 17,5 mm", () => {
    const cases = poser([e1("A"), e1("ID A"), e1("Prises cuisine plan de travail"), e1("W"), { ...e1("X"), ligne2: "125 A - 30 mA" }]).planches[0];
    expect(cases.every(c => c.largeur === 17.5 && c.hauteur === 17.5)).toBe(true);
  });
  it("les étiquettes sont posées côte à côte sur la même ligne, jamais en bandeau", () => {
    const cases = poser(Array.from({ length: 8 }, (_, i) => e1(`D${i}`))).planches[0];
    expect(new Set(cases.map(c => c.y)).size).toBe(1);
    expect(cases.map(c => c.x)).toEqual(Array.from({ length: 8 }, (_, i) => 8 + i * 17.5));
  });
  it("passe à la ligne en fin de ligne (11 par ligne en portrait)", () => {
    const cases = poser(Array.from({ length: 12 }, (_, i) => e1(`D${i}`))).planches[0];
    expect(cases[10]).toMatchObject({ x: 8 + 10 * 17.5, y: 8 }); expect(cases[11]).toMatchObject({ x: 8, y: 25.5 });
  });
  it("une rangée du tableau par ligne : nouvelle ligne à chaque rangée, sinon tout s'enchaîne", () => {
    const liste = [e1("A", 0), e1("B", 0), e1("C", 0), e1("D", 1), e1("E", 1)];
    const avec = poser(liste, carre, 0, { ligneParRangee: true }).planches[0];
    expect(avec.map(c => c.y)).toEqual([8, 8, 8, 25.5, 25.5]); expect(avec[3].x).toBe(8);
    expect(new Set(poser(liste, carre, 0, { ligneParRangee: false }).planches[0].map(c => c.y)).size).toBe(1);
  });
  it("étiquettes sans rangée (saisies à la main) : jamais de saut de ligne forcé", () => {
    expect(new Set(poser([e1("A"), e1("B"), e1("C")], carre, 0, { ligneParRangee: true }).planches[0].map(c => c.y)).size).toBe(1);
  });
  it("rangée de 13 appareils : 2 lignes en portrait (11 par ligne), 1 seule en paysage (16)", () => {
    const rangee = Array.from({ length: 13 }, (_, i) => e1(`D${i}`, 0));
    expect(new Set(poser(rangee, carre, 0, { ligneParRangee: true }).planches[0].map(c => c.y)).size).toBe(2);
    expect(new Set(poser(rangee, { ...carre, paysage: true }, 0, { ligneParRangee: true }).planches[0].map(c => c.y)).size).toBe(1);
    expect(maxParRangee(rangee)).toBe(13);
  });
  it("maxParRangee : quantités comptées, étiquettes sans rangée ignorées, 0 si aucune", () => {
    expect(maxParRangee([e1("A", 0), { ...e1("B", 0), quantite: 3 }, e1("C", 1)])).toBe(4);
    expect(maxParRangee([e1("A")])).toBe(0); expect(maxParRangee([])).toBe(0);
  });
  it("planche entamée : chaque case sautée reste vide, les suivantes se placent après", () => {
    const cases = poser([e1("A")], carre, 3).planches[0];
    expect(cases.map(c => c.etiquette?.texte ?? null)).toEqual([null, null, null, "A"]); expect(cases[3]).toMatchObject({ x: 8 + 3 * 17.5, largeur: 17.5 });
  });
  it("changement de page quand la page est pleine, en conservant l'ordre", () => {
    const r = poser(Array.from({ length: 200 }, (_, i) => e1(`E${i}`)));
    expect(r.planches).toHaveLength(2); expect(r.planches[0]).toHaveLength(176); expect(r.planches[1]).toHaveLength(24);
    expect(r.planches[1][0]).toMatchObject({ x: 8, y: 8 });
  });
});

describe("import d'un tableau : un appareil = une étiquette de même taille", () => {
  const b = (o: Record<string, unknown>) => ({ id: 1, label: "", circuit: "lumiere", amperes: 10, type: "1P", pieces: [], ...o });
  it("disjoncteur, bipolaire et différentiel donnent chacun UNE étiquette, rangée d'origine mémorisée", () => {
    const rows = [
      { id: 1, name: "R1", slots: [b({ type: "diff-A", amperes: 40, label: "ID A" }), b({ label: "Salon" }), b({ type: "2P", label: "Four", amperes: 20 })] },
      { id: 2, name: "R2", slots: [b({ label: "Cave" })] },
    ] as unknown as BreakerRow[];
    const e = etiquettesDepuisRangees(rows);
    expect(e.map(x => [x.texte, x.rangee])).toEqual([["ID A", 0], ["Salon", 0], ["Four", 0], ["Cave", 1]]);
    expect(e[0].ligne2).toBe("40\u00A0A - 30\u00A0mA");
  });
  it("noms trop longs raccourcis à la limite et comptés ; la 2e ligne ne dépasse jamais sa limite", () => {
    const rows = [{ id: 1, name: "R1", slots: [b({ label: "Prises cuisine plan de travail" }), b({ label: "Salon" }), b({ type: "diff-A", amperes: 125, label: "Différentiel général du tableau principal" })] }] as unknown as BreakerRow[];
    const e = etiquettesDepuisRangees(rows);
    expect(e.every(x => x.texte.length <= LIMITES.texte && x.ligne2.length <= LIMITES.ligne2)).toBe(true);
    expect(e[0].texte).toBe("Prises cuisine p"); expect(nomsRaccourcis(rows)).toBe(2);
    expect(nomsRaccourcis([])).toBe(0); expect(nomsRaccourcis(undefined as never)).toBe(0);
  });
  it("8 rangées de disjoncteurs = 8 lignes de carrés identiques côte à côte (paysage)", () => {
    const rows = Array.from({ length: 8 }, (_, r) => ({ id: r, name: `R${r}`, slots: [b({ type: "diff-A", amperes: 40, label: "ID A" }), ...Array.from({ length: 8 }, (_, k) => b({ label: `C${r}-${k}` }))] })) as unknown as BreakerRow[];
    const res = composerPlanches(etiquettesDepuisRangees(rows), { ...FORMAT_STANDARD, paysage: true }, 0, { ligneParRangee: true });
    if ("erreur" in res) throw new Error(res.erreur);
    expect(res.planches).toHaveLength(1);
    expect(new Set(res.planches[0].map(c => c.y)).size).toBe(8);
    expect(res.planches[0].every(c => c.largeur === 17.5 && c.hauteur === 17.5)).toBe(true);
  });
});

describe("vraie police (jsPDF) : le pire cas tient dans chaque zone standard", () => {
  it("texte : 16 + 14 caractères larges dans 17,5 × 8 mm, sans « ... », le nom jamais perdu", async () => {
    const { default: JsPdf } = await import("jspdf");
    const doc = new JsPdf({ unit: "mm" });
    const m: Mesure = (t, pt, g) => { doc.setFont("helvetica", g ? "bold" : "normal"); doc.setFontSize(pt); return doc.getTextWidth(t); };
    const { largeur: L, hauteur: H } = DIMS_STANDARD.texte;
    const cas: [string, string][] = [["MMMMMMMMMMMMMMMM", "MMMMMMMMMMMMMM"], ["WWWWWWWW WWWWWWWW", "125\u00A0A - 30\u00A0mA"], ["Lave-vaisselle", "20\u00A0A"], ["Prises cuisine p", "40\u00A0A - 30\u00A0mA"], ["Chauffe-eau cumu", "32\u00A0A"], ["ID A", "40\u00A0A - 30\u00A0mA"]];
    for (const [t, l2] of cas) {
      const r = composerEtiquette(t, l2, L, H, null, m);
      expect(r.picto, t).toBeNull(); expect(r.lignes.length, t).toBeGreaterThan(0);
      for (const l of r.lignes) { expect(l.texte.includes("..."), `${t}/${l.texte}`).toBe(false); expect(m(l.texte, l.pt, l.gras)).toBeLessThanOrEqual(L - 2.4 + 1e-6); expect(l.y).toBeLessThanOrEqual(H); }
      expect(r.lignes.map(l => l.texte).join("").replace(/\s|-/g, "").includes(t.replace(/\s|-/g, "").slice(0, 6)), t).toBe(true);
    }
  });
});
