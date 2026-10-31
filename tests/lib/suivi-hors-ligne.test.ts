import { beforeEach, describe, expect, it, vi } from "vitest";

const base = vi.hoisted(() => ({
  projets: {} as Record<string, { suivi_realisation: string | null }>,
  erreurLecture: null as string | null, erreurEcriture: null as string | null, nbEcritures: 0,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: (_c: string, id: string) => ({ single: async () => base.erreurLecture ? { data: null, error: { message: base.erreurLecture } } : { data: base.projets[id] ?? null, error: base.projets[id] ? null : { message: "introuvable" } } }) }),
      update: (patch: { suivi_realisation: string | null }) => ({ eq: async (_c: string, id: string) => {
        if (base.erreurEcriture) return { error: { message: base.erreurEcriture } };
        base.nbEcritures++; base.projets[id] = { suivi_realisation: patch.suivi_realisation }; return { error: null };
      } }),
    }),
  },
}));

import {
  appliquerFile, appliquerOperation, ecrireChantier, ecrireCoches, ecrireTemps, estErreurReseau, lireFile, lireProjetsMemorises, memoriserProjets,
  nbEnAttente, synchroniser, type OperationSuivi,
} from "@/lib/suivi-hors-ligne";
import { lireSuivi, modifierSuivi } from "@/lib/suivi-persistance";
import type { Projet } from "@/types";

// localStorage factice (l'environnement de test est Node)
const memoire = new Map<string, string>();
const stockage = { getItem: (k: string) => memoire.get(k) ?? null, setItem: (k: string, v: string) => { memoire.set(k, v); }, removeItem: (k: string) => { memoire.delete(k); } };
vi.stubGlobal("window", { localStorage: stockage });

const lire = (id = "p1") => lireSuivi(base.projets[id]?.suivi_realisation);
const COUPURE = "TypeError: Failed to fetch";

beforeEach(() => {
  memoire.clear();
  base.projets = { p1: { suivi_realisation: null } };
  base.erreurLecture = null; base.erreurEcriture = null; base.nbEcritures = 0;
});

describe("détection réseau", () => {
  it("coupure réseau ≠ erreur serveur", () => {
    for (const m of ["Failed to fetch", "TypeError: NetworkError when attempting to fetch resource.", "Load failed", "fetch failed"]) expect(estErreurReseau(m), m).toBe(true);
    for (const m of ["column projets.suivi_realisation does not exist", "permission denied for table projets", "JWT expired"]) expect(estErreurReseau(m), m).toBe(false);
  });
});

describe("appliquerOperation = mêmes effets que suivi-persistance", () => {
  it("coches : date d'origine conservée, décochage", () => {
    const s = lireSuivi(null);
    appliquerOperation(s, { type: "coches", cles: ["a"], fait: true, dateIso: "D1" });
    appliquerOperation(s, { type: "coches", cles: ["a", "b"], fait: true, dateIso: "D2" });
    expect(s.coches).toEqual({ a: "D1", b: "D2" });
    appliquerOperation(s, { type: "coches", cles: ["a"], fait: false, dateIso: "" });
    expect(s.coches).toEqual({ b: "D2" });
  });
  it("temps (valeur absolue, 0 efface) et chantier (fusion, vide retiré)", () => {
    const s = lireSuivi(null);
    appliquerOperation(s, { type: "temps", cible: "temps", cle: "c1", minutes: 90.4 });
    appliquerOperation(s, { type: "temps", cible: "tempsPostes", cle: "Salon", minutes: 20 });
    appliquerOperation(s, { type: "temps", cible: "temps", cle: "c1", minutes: 0 });
    appliquerOperation(s, { type: "chantier", patch: { valide_le: "2026-10-05", devis_id: "d1" } });
    appliquerOperation(s, { type: "chantier", patch: { valide_le: "" } });
    expect(s).toMatchObject({ temps: {}, tempsPostes: { Salon: 20 }, chantier: { devis_id: "d1" } });
  });
});

describe("écriture avec file d'attente", () => {
  it("en ligne : écriture directe, file vide", async () => {
    const r = await ecrireCoches("p1", ["a"], true, "D1");
    expect(r).toMatchObject({ ok: true });
    expect("enAttente" in r).toBe(false);
    expect(lire().coches).toEqual({ a: "D1" });
    expect(nbEnAttente("p1")).toBe(0);
  });

  it("hors ligne : la modification est gardée en file, la base n'est pas touchée", async () => {
    base.erreurLecture = COUPURE;
    const r = await ecrireCoches("p1", ["a"], true, "D1");
    expect(r).toEqual({ ok: true, enAttente: true, nbEnAttente: 1 });
    expect(base.nbEcritures).toBe(0);
    expect(lireFile("p1")).toHaveLength(1);
  });

  it("coupure à l'écriture (lecture OK) : mise en file aussi", async () => {
    base.erreurEcriture = COUPURE;
    expect(await ecrireTemps("p1", "temps", "c1", 30)).toMatchObject({ ok: true, enAttente: true });
    expect(base.projets.p1.suivi_realisation).toBeNull();
  });

  it("erreur serveur (colonne absente) : remontée, rien mis en file", async () => {
    base.erreurLecture = "column projets.suivi_realisation does not exist";
    const r = await ecrireCoches("p1", ["a"], true, "D1");
    expect(r).toMatchObject({ ok: false, colonneAbsente: true });
    expect(nbEnAttente("p1")).toBe(0);
  });

  it("reconnexion : toute la file est rejouée en UNE écriture, dans l'ordre, puis vidée", async () => {
    base.erreurLecture = COUPURE;
    await ecrireCoches("p1", ["a", "b"], true, "D1");
    await ecrireTemps("p1", "temps", "c1", 45);
    await ecrireCoches("p1", ["a"], false, "");          // décoche après coche : l'ordre compte
    await ecrireChantier("p1", { devis_id: "d9" });
    expect(nbEnAttente("p1")).toBe(4);

    base.erreurLecture = null;
    const res = await synchroniser("p1");
    expect(res?.ok).toBe(true);
    expect(base.nbEcritures).toBe(1);
    expect(lire()).toMatchObject({ coches: { b: "D1" }, temps: { c1: 45 }, chantier: { devis_id: "d9" } });
    expect(nbEnAttente("p1")).toBe(0);
  });

  it("la synchronisation ne perd pas ce qui a été coché entre-temps sur un autre appareil", async () => {
    base.erreurLecture = COUPURE;
    await ecrireCoches("p1", ["a"], true, "D1");
    base.erreurLecture = null;
    await modifierSuivi("p1", s => { s.coches.autre = "D0"; });   // « l'autre appareil »
    await synchroniser("p1");
    expect(lire().coches).toEqual({ autre: "D0", a: "D1" });
  });

  it("échec de synchronisation : la file est conservée intacte, réessai possible", async () => {
    base.erreurLecture = COUPURE;
    await ecrireCoches("p1", ["a"], true, "D1");
    const res = await synchroniser("p1");
    expect(res?.ok).toBe(false);
    expect(nbEnAttente("p1")).toBe(1);
    base.erreurLecture = null;
    expect((await synchroniser("p1"))?.ok).toBe(true);
    expect(nbEnAttente("p1")).toBe(0);
  });

  it("rejouer deux fois donne le même résultat (idempotence)", async () => {
    const ops: OperationSuivi[] = [{ type: "coches", cles: ["a"], fait: true, dateIso: "D1" }, { type: "temps", cible: "temps", cle: "c", minutes: 10 }];
    const s1 = lireSuivi(null); ops.forEach(o => appliquerOperation(s1, o));
    const s2 = lireSuivi(null); [...ops, ...ops].forEach(o => appliquerOperation(s2, o));
    expect(s2).toEqual(s1);
  });

  it("file non vide + nouvelle modification : elle passe derrière les autres, puis tout est synchronisé si le réseau est revenu", async () => {
    base.erreurLecture = COUPURE;
    await ecrireCoches("p1", ["a"], true, "D1");
    base.erreurLecture = null;
    const r = await ecrireCoches("p1", ["b"], true, "D2");
    expect(r).toMatchObject({ ok: true });
    expect("enAttente" in r).toBe(false);
    expect(lire().coches).toEqual({ a: "D1", b: "D2" });
    expect(nbEnAttente("p1")).toBe(0);
  });

  it("file non vide + réseau toujours coupé : on empile, sans perdre l'ordre", async () => {
    base.erreurLecture = COUPURE;
    await ecrireCoches("p1", ["a"], true, "D1");
    const r = await ecrireCoches("p1", ["b"], true, "D2");
    expect(r).toEqual({ ok: true, enAttente: true, nbEnAttente: 2 });
    expect(lireFile("p1").map(o => (o as { cles: string[] }).cles[0])).toEqual(["a", "b"]);
  });

  it("deux projets ont des files séparées ; file vide → synchroniser ne fait rien", async () => {
    base.projets.p2 = { suivi_realisation: null };
    base.erreurLecture = COUPURE;
    await ecrireCoches("p1", ["a"], true, "D1");
    expect(nbEnAttente("p2")).toBe(0);
    expect(await synchroniser("p2")).toBeNull();
  });

  it("file corrompue ou entrées invalides : ignorées sans planter", () => {
    memoire.set("voltapp:suivi-file:p1", "{pas du json");
    expect(lireFile("p1")).toEqual([]);
    memoire.set("voltapp:suivi-file:p1", JSON.stringify([{ type: "inconnu" }, { type: "temps", cible: "temps", cle: "c", minutes: 5 }, null, 3]));
    expect(lireFile("p1")).toEqual([{ type: "temps", cible: "temps", cle: "c", minutes: 5 }]);
  });

  it("appliquerFile : affichage = état relu + opérations en attente", async () => {
    base.erreurLecture = COUPURE;
    await ecrireCoches("p1", ["a"], true, "D1");
    expect(appliquerFile(lireSuivi(JSON.stringify({ v: 1, coches: { z: "D0" } })), "p1").coches).toEqual({ z: "D0", a: "D1" });
  });
});

describe("copie locale des projets", () => {
  const projet = { id: "p1", client_id: "c1", nom: "Maison", suivi_realisation: "{}" } as unknown as Projet;
  it("aller-retour, liste vide non mémorisée, contenu invalide ignoré", () => {
    expect(lireProjetsMemorises("c1")).toBeNull();
    memoriserProjets("c1", []);
    expect(lireProjetsMemorises("c1")).toBeNull();
    memoriserProjets("c1", [projet]);
    expect(lireProjetsMemorises("c1")?.projets[0].id).toBe("p1");
    memoire.set("voltapp:suivi-projets:c1", "n'importe quoi");
    expect(lireProjetsMemorises("c1")).toBeNull();
  });
});
