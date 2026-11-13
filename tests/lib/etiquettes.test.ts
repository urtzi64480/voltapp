import { describe, expect, it } from "vitest";
import {
  CLE_BROUILLON_ETIQUETTES, FORMATS, FORMAT_PERSO_DEFAUT, LIMITES, composerPlanches, couperLignes, estImprimable, etiquettesDepuisRangees, exemplaires, formatChoisi,
  composerEtiquette, grille, lireBrouillon, mettreEnPage, modulesMaxParRangee, modulesValide, pageDe, nettoyerTexte, nouvelleEtiquette, quantiteValide, serialiserBrouillon, brouillonVide, type FormatPlanche, type Mesure,
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
    const x = { ...brouillonVide(), etiquettes: [et("Four", 2, "20 A")], formatId: "carre-22", debut: 4, guides: false, paysage: true, ligneParRangee: false };
    const y = lireBrouillon(serialiserBrouillon(x));
    expect(y.etiquettes[0]).toMatchObject({ texte: "Four", ligne2: "20 A", quantite: 2 }); expect(y).toMatchObject({ formatId: "carre-22", debut: 4, guides: false, paysage: true, ligneParRangee: false });
    expect(formatChoisi(y)).toMatchObject({ id: "carre-22", largeur: 22, hauteur: 22, paysage: true });
  });
  it("illisible, version inconnue ou champs invalides → valeurs par défaut", () => {
    for (const brut of [null, "", "{", "[]", '{"v":2}', "null"]) expect(lireBrouillon(brut).etiquettes).toHaveLength(1);
    const y = lireBrouillon(JSON.stringify({ v: 1, etiquettes: [null, { texte: 5, quantite: "zz" }, { texte: "OK", quantite: 9999 }], formatId: "inconnu", perso: { largeur: "x" }, debut: -3 }));
    expect(y.formatId).toBe("carre-17-5"); expect(y.debut).toBe(0); expect(y.etiquettes.map(e => e.quantite)).toEqual([1, LIMITES.quantiteMax]); expect(y.perso.largeur).toBe(17.5);
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

describe("formats prédéfinis : carrés alignés sur le module", () => {
  it("tous les formats sont des carrés ; le standard fait 17,5 mm (largeur d'un module) et est le format par défaut", () => {
    for (const f of FORMATS) expect(f.largeur, f.id).toBe(f.hauteur);
    expect(FORMATS[0]).toMatchObject({ id: "carre-17-5", largeur: 17.5, hauteur: 17.5 });
    expect(brouillonVide().formatId).toBe("carre-17-5");
    expect(formatChoisi(brouillonVide())).toMatchObject({ largeur: 17.5, hauteur: 17.5, paysage: false });
    expect(FORMAT_PERSO_DEFAUT.largeur).toBe(FORMAT_PERSO_DEFAUT.hauteur);
  });
  it("A4 portrait : 11 modules par ligne ; paysage : 16 — une rangée de 13 modules ne tient qu'en paysage", () => {
    expect(grille(FORMATS[0])).toMatchObject({ colonnes: 11, lignes: 16, parPage: 176 });
    expect(grille({ ...FORMATS[0], paysage: true })).toMatchObject({ colonnes: 16, lignes: 11, parPage: 176 });
    expect(pageDe({ paysage: true })).toEqual({ largeur: 297, hauteur: 210 });
    expect(pageDe({})).toEqual({ largeur: 210, hauteur: 297 });
  });
  it("un ancien brouillon (anciens formats en bandelettes) retombe sur le carré par défaut", () => {
    for (const id of ["modules-1", "modules-2", "modules-3", "modules-4", "bandeau", "plastron", "grande"]) expect(lireBrouillon(JSON.stringify({ v: 1, etiquettes: [{ texte: "A" }], formatId: id })).formatId, id).toBe("carre-17-5");
  });
  it("chaque pictogramme tient dans chaque format prédéfini (icône au-dessus, texte sous l'icône)", async () => {
    const { LISTE_PICTOS } = await import("@/lib/pictogrammes");
    for (const fo of FORMATS) for (const p of LISTE_PICTOS) {
      const r = composerEtiquette(p.nom, "20 A", fo.largeur, fo.hauteur, p.id, mesure);
      expect(r.picto, `${fo.id}/${p.id}`).not.toBeNull();
      for (const l of r.lignes) { expect(l.y).toBeGreaterThan(r.picto!.y + r.picto!.taille); expect(l.y).toBeLessThanOrEqual(fo.hauteur + 1e-9); expect(mesure(l.texte, l.pt, l.gras)).toBeLessThanOrEqual(fo.largeur - 2.4 + 1e-6); }
    }
  });
});

describe("étiquettes côte à côte, un carré par module", () => {
  const carre = fmt({ largeur: 17.5, hauteur: 17.5, marge: 8, ecart: 0 });   // 11 modules par ligne en portrait
  const m = (texte: string, modules = 1, rangee?: number) => ({ ...nouvelleEtiquette(texte), modules, ...(rangee === undefined ? {} : { rangee }) });
  const poser = (liste: ReturnType<typeof m>[], f = carre, debut = 0, opt = {}) => { const r = composerPlanches(liste, f, debut, opt); if ("erreur" in r) throw new Error(r.erreur); return r; };

  it("une étiquette de 2 modules fait 2 carrés de large et se place juste à côté de la précédente", () => {
    const [a, b, c] = poser([m("A"), m("ID", 2), m("C")]).planches[0];
    expect([a.x, a.largeur, a.hauteur]).toEqual([8, 17.5, 17.5]);
    expect([b.x, b.largeur, b.hauteur]).toEqual([25.5, 35, 17.5]);
    expect([c.x, c.y]).toEqual([60.5, 8]);
  });
  it("les étiquettes sont posées l'une à côté de l'autre sur la même ligne, jamais en bandeau (8 étiquettes = 8 carrés d'une ligne)", () => {
    const cases = poser(Array.from({ length: 8 }, (_, i) => m(`D${i}`))).planches[0];
    expect(new Set(cases.map(c => c.y)).size).toBe(1);
    expect(cases.every(c => c.largeur === 17.5 && c.hauteur === 17.5)).toBe(true);
    expect(cases.map(c => c.x)).toEqual(Array.from({ length: 8 }, (_, i) => 8 + i * 17.5));
  });
  it("passe à la ligne quand une étiquette ne tient plus (10 carrés + une étiquette de 2 modules sur 11 colonnes)", () => {
    const cases = poser([...Array.from({ length: 10 }, (_, i) => m(`D${i}`)), m("ID", 2)]).planches[0];
    expect(cases[10]).toMatchObject({ x: 8, y: 25.5 });
  });
  it("une étiquette plus large que la ligne est ramenée à la largeur de la ligne", () => {
    const [c] = poser([m("Large", 6)], fmt({ largeur: 60, hauteur: 17.5, marge: 8, ecart: 0 })).planches[0];   // 3 colonnes seulement
    expect(c.largeur).toBe(180);
  });
  it("une rangée du tableau par ligne : nouvelle ligne à chaque rangée, sinon tout s'enchaîne", () => {
    const liste = [m("A", 1, 0), m("B", 1, 0), m("C", 1, 0), m("D", 1, 1), m("E", 2, 1)];
    const avec = poser(liste, carre, 0, { ligneParRangee: true }).planches[0];
    expect(avec.map(c => c.y)).toEqual([8, 8, 8, 25.5, 25.5]); expect(avec[3].x).toBe(8);
    const sans = poser(liste, carre, 0, { ligneParRangee: false }).planches[0];
    expect(new Set(sans.map(c => c.y)).size).toBe(1);
  });
  it("étiquettes sans rangée (saisies à la main) : jamais de saut de ligne forcé", () => {
    const cases = poser([m("A"), m("B"), m("C")], carre, 0, { ligneParRangee: true }).planches[0];
    expect(new Set(cases.map(c => c.y)).size).toBe(1);
  });
  it("rangée de 13 modules : 2 lignes en portrait (11 colonnes), 1 seule ligne en paysage (16 colonnes)", () => {
    const rangee = [m("ID", 2, 0), ...Array.from({ length: 11 }, (_, i) => m(`D${i}`, 1, 0))];
    expect(new Set(poser(rangee, carre, 0, { ligneParRangee: true }).planches[0].map(c => c.y)).size).toBe(2);
    expect(new Set(poser(rangee, { ...carre, paysage: true }, 0, { ligneParRangee: true }).planches[0].map(c => c.y)).size).toBe(1);
    expect(modulesMaxParRangee(rangee)).toBe(13);
  });
  it("modulesMaxParRangee : quantités comptées, étiquettes sans rangée ignorées, 0 si aucune", () => {
    expect(modulesMaxParRangee([m("A", 2, 0), { ...m("B", 1, 0), quantite: 3 }, m("C", 4, 1)])).toBe(5);
    expect(modulesMaxParRangee([m("A", 3)])).toBe(0); expect(modulesMaxParRangee([])).toBe(0);
  });
  it("planche entamée : chaque case sautée est 1 module, les suivantes se placent après", () => {
    const cases = poser([m("A", 2)], carre, 3).planches[0];
    expect(cases.map(c => c.etiquette?.texte ?? null)).toEqual([null, null, null, "A"]);
    expect(cases[3]).toMatchObject({ x: 8 + 3 * 17.5, largeur: 35 });
  });
  it("changement de page quand les lignes sont pleines, en conservant l'ordre", () => {
    const r = poser(Array.from({ length: 200 }, (_, i) => m(`E${i}`)));   // 176 par page
    expect(r.planches).toHaveLength(2); expect(r.planches[0]).toHaveLength(176); expect(r.planches[1]).toHaveLength(24);
    expect(r.planches[1][0]).toMatchObject({ x: 8, y: 8 });
  });
  it("modulesValide borne de 1 à 6", () => { expect([0, -2, NaN, "x", 1.4, 2, 9].map(modulesValide)).toEqual([1, 1, 1, 1, 1, 2, 6]); });
});

describe("import d'un tableau : largeur en modules et rangées", () => {
  const b = (o: Record<string, unknown>) => ({ id: 1, label: "", circuit: "lumiere", amperes: 10, type: "1P", pieces: [], ...o });
  it("1P = 1 module, 2P / différentiel = 2 modules, rangée d'origine mémorisée", () => {
    const rows = [
      { id: 1, name: "R1", slots: [b({ type: "diff-A", amperes: 40, label: "ID A" }), b({ label: "Salon" }), b({ type: "2P", label: "Four", amperes: 20 })] },
      { id: 2, name: "R2", slots: [b({ label: "Cave" })] },
    ] as unknown as BreakerRow[];
    const e = etiquettesDepuisRangees(rows);
    expect(e.map(x => [x.texte, x.modules, x.rangee])).toEqual([["ID A", 2, 0], ["Salon", 1, 0], ["Four", 2, 0], ["Cave", 1, 1]]);
  });
  it("posé sur la planche : 8 rangées de disjoncteurs = 8 lignes de carrés côte à côte", () => {
    const rows = Array.from({ length: 8 }, (_, r) => ({ id: r, name: `R${r}`, slots: [b({ type: "diff-A", amperes: 40 }), ...Array.from({ length: 8 }, (_, k) => b({ label: `C${r}-${k}` }))] })) as unknown as BreakerRow[];
    const cases = composerPlanches(etiquettesDepuisRangees(rows), { ...FORMATS[0], paysage: true }, 0, { ligneParRangee: true });
    if ("erreur" in cases) throw new Error(cases.erreur);
    expect(cases.planches).toHaveLength(1);
    expect(new Set(cases.planches[0].map(c => c.y)).size).toBe(8);                 // une ligne par rangée
    expect(cases.planches[0].every(c => c.hauteur === 17.5 && (c.largeur === 17.5 || c.largeur === 35))).toBe(true);   // jamais de bandeau
  });
});

describe("brouillon : modules et rangée", () => {
  it("conservés ; valeurs piégées ignorées ; 1 module n'est pas stocké", () => {
    const y = lireBrouillon(JSON.stringify({ v: 1, etiquettes: [{ texte: "A", modules: 2, rangee: 3 }, { texte: "B", modules: 1 }, { texte: "C", modules: "x", rangee: -1 }, { texte: "D", modules: 99, rangee: 1.5 }] }));
    expect(y.etiquettes.map(e => e.modules)).toEqual([2, undefined, undefined, 6]);
    expect(y.etiquettes.map(e => e.rangee)).toEqual([3, undefined, undefined, undefined]);
    expect(y.paysage).toBe(false); expect(y.ligneParRangee).toBe(true);
  });
});
