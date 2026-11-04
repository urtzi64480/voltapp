# VoltApp — Gestion Électricien Indépendant

Application complète : devis terrain + catalogue vierge + clients + CRM.  
Stack 100 % gratuite : **Next.js 14** + **Supabase** + **Vercel**

---

## Déploiement en 3 étapes (20 minutes)

### 1. GitHub
```bash
git init && git add . && git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/VOTRE_PSEUDO/voltapp.git
git push -u origin main
```

### 2. Supabase
- Créer un projet sur supabase.com (région West EU)
- SQL Editor → coller tout le contenu de `supabase/migrations/001_schema.sql` → Run
- Settings → API → copier **Project URL** et **anon public key**

### 3. Vercel
- vercel.com → New Project → importer voltapp depuis GitHub
- Ajouter les 2 variables d'environnement :
  - `NEXT_PUBLIC_SUPABASE_URL` = https://xxxxx.supabase.co
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = eyJ…
- Deploy

---

## Modules

| Module | Description |
|--------|-------------|
| **Dashboard** | KPIs, CA mensuel, plafonds AE, accès rapides |
| **Clients** | Fiche complète, logement, code d'accès, photos, notes, historique devis |
| **Devis** | Éditeur terrain : catalogue cliquable, lignes libres, aperçu PDF, signature tactile |
| **Devis par dictée** | Bouton 🎤 de la liste des devis : on dicte (ou tape) « pour M. Dupont, 5 prises 16 A, 3 spots, 2 heures de main d'œuvre » ; le client est reconnu, chaque ligne est rapprochée du catalogue (prix du catalogue, jamais inventés ; sans article : « À compléter » à 0 €), puis devis brouillon. Gratuit : dictée du navigateur, aucune API. |
| **Factures** | Suivi statuts, marquer payée, PDF |
| **Catalogue** | Vierge — à alimenter : nom, description, prix, unité, catégorie, branche AE |
| **CRM** | CA par branche, graphique mensuel, taux de conversion, top clients, impayés |
| **Paramètres** | Profil artisan, SIRET, numérotation, mentions légales |
| **Tableau — Photos IA** | Bouton ✨ du module Tableau : photos du tableau existant → lecture par Claude (réponse collée) → relevé corrigeable → tableau refait à la NF C 15-100 (avant / après, écarts, contrôles) → pré-devis catalogue → devis brouillon. Rien n'est appliqué sans clic, et l'application est annulable. |

---

## Catalogue — structure

Chaque prestation contient :
- **Nom** — désignation affichée sur le devis
- **Description** — détail optionnel
- **Prix unitaire** — votre tarif
- **Unité** — forfait / heure / u / ml / m²
- **Branche AE** — Service (main d'œuvre) ou Matériau (achat/revente)
- **Catégorie** — libre (ex : Pose, Dépose, Tableau, Câblage, Matériaux…)

---

## Mise à jour après correction de bug

```bash
git add . && git commit -m "Fix: description du correctif" && git push
```
Vercel redéploie automatiquement.


---

## Tableau — Photos IA (aucune configuration, aucun coût en plus)

Bouton ✨ du module Tableau : VoltApp fournit une consigne à copier ; l'électricien l'envoie à Claude (appli ou claude.ai, PC ou téléphone) avec les photos du tableau — ce qui est compris dans son abonnement — puis colle la réponse dans VoltApp. Aucune clé API, aucune variable Vercel, aucune migration.

L'IA ne fait que lire les photos ; calibres, sections, différentiels, parafoudre et contrôles viennent des règles de l'application (`normes-nfc`, `tableau-reel`).
