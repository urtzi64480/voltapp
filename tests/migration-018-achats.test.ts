import { describe, it, expect } from "vitest";
import { nouvelleBase, appliquerMigrations, enTantQue, lireMigration, fichiersMigrations } from "./helpers/pg";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("018 — devis_achats (plusieurs achats par devis)", () => {
  it("reprend les saisies de la 017, vide les anciennes colonnes, est rejouable, plusieurs achats par devis, RLS propriétaire", async () => {
    const db = await nouvelleBase();
    const avant018 = fichiersMigrations().filter(f => f < "018");
    await appliquerMigrations(db, avant018);
    await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@t.fr'), ('${B}', 'b@t.fr')`);
    await db.exec(`insert into devis (id, user_id, numero, achat_materiel_reel, achat_materiel_date) values
      ('aaaaaaaa-0000-0000-0000-000000000001', '${A}', 'D-1', 250.40, '2026-10-12'),
      ('aaaaaaaa-0000-0000-0000-000000000002', '${A}', 'D-2', null, null)`);

    await db.exec(lireMigration("018_devis_achats.sql"));
    const repris = (await db.query<{ devis_id: string; montant: string; date_achat: string }>(`select devis_id, montant::text, date_achat::text from devis_achats`)).rows;
    expect(repris).toEqual([{ devis_id: "aaaaaaaa-0000-0000-0000-000000000001", montant: "250.40", date_achat: "2026-10-12" }]);
    const colonnes = (await db.query<{ n: number }>(`select count(*)::int as n from devis where achat_materiel_reel is not null`)).rows[0].n;
    expect(colonnes).toBe(0);

    await db.exec(lireMigration("018_devis_achats.sql"));          // rejouable : rien en double
    expect((await db.query<{ n: number }>(`select count(*)::int as n from devis_achats`)).rows[0].n).toBe(1);

    await db.exec(`grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated`);
    await enTantQue(db, A, async () => {                           // user_id vient d'auth.uid() ; un devis, plusieurs achats
      await db.exec(`insert into devis_achats (devis_id, montant, date_achat, fournisseur) values
        ('aaaaaaaa-0000-0000-0000-000000000002', 40, '2026-10-30', 'Rexel'), ('aaaaaaaa-0000-0000-0000-000000000002', 15.5, '2026-11-02', null)`);
      const r = await db.query<{ n: number }>(`select count(*)::int as n from devis_achats where devis_id = 'aaaaaaaa-0000-0000-0000-000000000002' and user_id = '${A}'`);
      expect(r.rows[0].n).toBe(2);
    });
    await enTantQue(db, B, async () => {                           // un autre utilisateur ne voit rien et ne peut rien écrire chez A
      expect((await db.query<{ n: number }>(`select count(*)::int as n from devis_achats`)).rows[0].n).toBe(0);
      await expect(db.exec(`insert into devis_achats (user_id, devis_id, montant) values ('${A}', 'aaaaaaaa-0000-0000-0000-000000000002', 1)`)).rejects.toThrow();
    });
    await expect(db.exec(`insert into devis_achats (user_id, devis_id, montant) values ('${A}', 'aaaaaaaa-0000-0000-0000-000000000002', -1)`)).rejects.toThrow();   // montant ≥ 0
  });

  it("019 : colonne article facultative (achats existants = globaux), rejouable", async () => {
    const db = await nouvelleBase();
    await appliquerMigrations(db);
    await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@t.fr')`);
    await db.exec(`insert into devis (id, user_id, numero) values ('aaaaaaaa-0000-0000-0000-000000000009', '${A}', 'D-9')`);
    await db.exec(`insert into devis_achats (user_id, devis_id, montant) values ('${A}', 'aaaaaaaa-0000-0000-0000-000000000009', 10)`);
    await db.exec(`insert into devis_achats (user_id, devis_id, montant, article) values ('${A}', 'aaaaaaaa-0000-0000-0000-000000000009', 5, 'Disjoncteur 20A')`);
    await db.exec(lireMigration("019_devis_achats_article.sql"));   // rejouable
    const r = await db.query<{ article: string | null }>(`select article from devis_achats order by montant desc`);
    expect(r.rows.map(x => x.article)).toEqual([null, "Disjoncteur 20A"]);
  });
});
