# Base de données VoltApp

## Ordre d'exécution (base neuve)

`001` → `002` → `003` → `004` → `006` → `007` → `008` → `009` → `010` → `011` → `012` → `013` → `014` → `015` (ordre alphabétique des fichiers de `migrations/`).
Les migrations d'origine `003` (colonnes fournisseur de `devis_lignes`) et `005` (`image_url` des lignes) n'ont jamais été versionnées ; elles sont absorbées par le nouveau `003_reconstruction_schema.sql`, qui reconstruit le schéma réellement utilisé par le code.

> **Base de production existante** : ne rien relancer à l'aveugle. Lancer d'abord l'audit ci-dessous. `003` et `012` sont de toute façon sans effet sur ce qui existe déjà (voir `tests/migrations.test.ts`).

## Auditer la base réelle (lecture seule)

1. Supabase → SQL Editor → coller `audit/audit_schema.sql` → Run.
2. Lire le résultat, trié par gravité :
   - **CRITIQUE** — table ouverte (RLS désactivée : lisible/modifiable avec la clé anon, qui est publique), ou fonction publique non `SECURITY DEFINER`.
   - **ATTENTION** — table/colonne/fonction attendue absente, RLS active sans policy, table inconnue du code.
3. Ce fichier est généré : après toute nouvelle migration, `MAJ_AUDIT=1 npm test` le régénère (et `npm test` échoue s'il est obsolète).

## Fermer les tables ouvertes (optionnel, à la main)

`optionnel/rls_proprietaire_securisee.sql` — **simulation par défaut** (`v_appliquer := false`), liste dans l'onglet *Messages* ce qu'il ferait. Garde-fous : ignore les tables qui ont déjà une policy ou des lignes sans `user_id`, exclut `profil` et `realisations` (lues par les pages publiques avec la clé anon), et abandonne tout si une fonction publique n'est pas `SECURITY DEFINER`.

## Tests

`npm test` rejoue toutes les migrations sur un vrai Postgres (PGlite, en mémoire, sans toucher à Supabase) et vérifie notamment que chaque table lue par le code existe.

## Mode hors-ligne du suivi de chantier

Aucune migration. `public/sw.js` (service worker, production uniquement) met en cache la coquille de la page `/plan/<client>/suivi` ;
les modifications faites sans réseau (coches, temps, validation) sont gardées dans le navigateur (`localStorage`) puis rejouées en une
écriture lecture-modification-écriture à la reconnexion (`src/lib/suivi-hors-ligne.ts`). Il faut avoir ouvert le suivi une fois avec du réseau.

## Suivi de chantier d'un devis (migration 013)

`013_devis_suivi_realisation.sql` ajoute `devis.suivi_realisation` : le suivi (étapes cochées, temps par poste, validation) est rattaché
directement au devis, avec ou sans plan (`/devis/<id>/suivi`). Même format que `projets.suivi_realisation`. La page Rentabilité additionne
le temps du devis et celui des plans qui lui sont rattachés.
