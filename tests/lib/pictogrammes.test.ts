import { describe, expect, it } from "vitest";
import { BOITE_PICTO, LISTE_PICTOS, PICTOS, PICTO_AUCUN, detecterPicto, pictoPour, pictoValide } from "@/lib/pictogrammes";

describe("detecterPicto", () => {
  it.each([
    ["Lave-linge", "lave_linge"], ["lave linge", "lave_linge"], ["LAVE-LINGE 20 A", "lave_linge"], ["Machine à laver", "lave_linge"],
    ["Lave-vaisselle", "lave_vaisselle"], ["Sèche-linge", "seche_linge"], ["Seche linge", "seche_linge"], ["Sèche-serviette SDB", "seche_serviette"],
    ["Chauffe-eau", "chauffe_eau"], ["Cumulus", "chauffe_eau"], ["Ballon d'eau chaude", "chauffe_eau"],
    ["Four", "four"], ["Four encastrable", "four"], ["Micro-ondes", "micro_ondes"], ["Plaque cuisson", "plaque"], ["Plaque induction", "plaque"],
    ["Hotte", "hotte"], ["Congélateur", "frigo"], ["Réfrigérateur", "frigo"], ["Climatisation salon", "clim"], ["Clim", "clim"], ["PAC", "clim"], ["Pompe à chaleur", "clim"],
    ["Radiateurs chambre", "chauffage"], ["Chauffage électrique", "chauffage"], ["VMC", "vmc"], ["Ventilation", "vmc"],
    ["Volets roulants", "volet"], ["Store banne", "volet"], ["Portail", "portail"], ["Porte de garage", "portail"], ["Borne IRVE", "borne"], ["Sonnette", "sonnette"],
    ["Alarme", "detecteur"], ["Détecteur de fumée", "detecteur"], ["Piscine", "piscine"], ["Parafoudre", "terre"], ["Coupure générale", "coupure"],
    ["ID A", "disjoncteur"], ["Différentiel 30 mA", "disjoncteur"], ["Tableau divisionnaire", "tableau"], ["Rangée 1", "tableau"],
    ["TV salon", "tv"], ["RJ45 bureau", "reseau"], ["Box internet", "reseau"], ["Wi-Fi", "reseau"], ["Interrupteur", "interrupteur"], ["Va-et-vient", "interrupteur"],
    ["Prises", "prise"], ["Prises cuisine plan de travail", "prise"], ["Prise 16 A", "prise"], ["Éclairage", "ampoule"], ["Lumière salon", "ampoule"], ["Spots cuisine", "ampoule"],
  ])("« %s » → %s", (texte, attendu) => { expect(detecterPicto(texte)).toBe(attendu); });

  it("l'appareil précis l'emporte sur le mot générique, la pièce n'est pas un appareil", () => {
    expect(detecterPicto("Prise lave-linge")).toBe("lave_linge");
    expect(detecterPicto("Prise four")).toBe("four");
    expect(detecterPicto("Éclairage garage")).toBe("ampoule");
    expect(detecterPicto("Prise garage")).toBe("prise");
  });
  it("pas de faux positif sur des mots qui contiennent un mot-clé", () => {
    for (const t of ["Pourtour", "Cuisine", "Salon", "Chambre 1", "Dispositif", "Spatule", "Bidon", "Terrasse", "Terreau", "Boxe", ""]) expect(detecterPicto(t), t).toBeNull();
  });
  it("entrées non texte → null", () => { for (const v of [null, undefined, 3, {}, ["Four"]]) expect(detecterPicto(v)).toBeNull(); });
});

describe("pictoPour / pictoValide", () => {
  it("auto par défaut, choix explicite prioritaire, « aucune » et désactivation global respectés", () => {
    expect(pictoPour({ texte: "Four" })).toBe("four");
    expect(pictoPour({ texte: "Four", icone: "prise" })).toBe("prise");
    expect(pictoPour({ texte: "Salon", icone: "prise" })).toBe("prise");
    expect(pictoPour({ texte: "Four", icone: PICTO_AUCUN })).toBeNull();
    expect(pictoPour({ texte: "Four" }, false)).toBeNull();
    expect(pictoPour({ texte: "Four", icone: "n'importe quoi" })).toBe("four");
    expect(pictoPour({ texte: "Salon" })).toBeNull();
  });
  it("les clés héritées de Object ne sont pas des pictogrammes", () => {
    for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty", ""]) { expect(pictoValide(k), k).toBe(false); expect(pictoPour({ texte: "Salon", icone: k })).toBeNull(); }
    expect(pictoValide("four")).toBe(true);
  });
});

describe("dessins", () => {
  it("chaque pictogramme a un nom, des mots-clés et des primitives valides dans la boîte 24 × 24", () => {
    expect(LISTE_PICTOS.length).toBeGreaterThanOrEqual(25);
    const ids = new Set<string>();
    for (const p of LISTE_PICTOS) {
      expect(ids.has(p.id), `doublon ${p.id}`).toBe(false); ids.add(p.id);
      expect(PICTOS[p.id]).toBe(p); expect(p.nom.length).toBeGreaterThan(2); expect(p.motsCles.length).toBeGreaterThan(0); expect(p.prims.length).toBeGreaterThan(0);
      for (const pr of p.prims) {
        expect(pr.v.every(Number.isFinite), `${p.id} nombres`).toBe(true);
        const taille = { l: 4, r: 5, c: 3, d: 3 }[pr.t as "l" | "r" | "c" | "d"];
        if (taille) expect(pr.v.length, `${p.id}/${pr.t}`).toBe(taille); else { expect(pr.v.length % 2, `${p.id} paires`).toBe(0); expect(pr.v.length).toBeGreaterThanOrEqual(4); }
        // tout reste dans la boîte (rectangles et cercles : bords compris)
        const bornes: number[] = pr.t === "r" ? [pr.v[0], pr.v[1], pr.v[0] + pr.v[2], pr.v[1] + pr.v[3]]
          : pr.t === "c" || pr.t === "d" ? [pr.v[0] - pr.v[2], pr.v[1] - pr.v[2], pr.v[0] + pr.v[2], pr.v[1] + pr.v[2]] : pr.v;
        for (const n of bornes) { expect(n, `${p.id}/${pr.t} hors boîte`).toBeGreaterThanOrEqual(0); expect(n, `${p.id}/${pr.t} hors boîte`).toBeLessThanOrEqual(BOITE_PICTO); }
      }
    }
  });
  it("chaque mot-clé retrouve son propre pictogramme ou un pictogramme plus prioritaire (jamais aucun)", () => {
    for (const p of LISTE_PICTOS) for (const m of p.motsCles) {
      const exemple = m.replace("*", "");
      const id = detecterPicto(exemple);
      expect(id, `${p.id}: « ${exemple} »`).not.toBeNull();
      expect(LISTE_PICTOS.findIndex(x => x.id === id), `${p.id}: « ${exemple} » → ${id}`).toBeLessThanOrEqual(LISTE_PICTOS.findIndex(x => x.id === p.id));
    }
  });
});
