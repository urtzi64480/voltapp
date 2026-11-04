// src/lib/predevis-depuis-devis.ts
//
// Retrouver un pré-devis à partir du devis qu'il a généré : mode (pièce / circuit), articles choisis, heures de main d'œuvre par poste,
// frais généraux et déplacement. Sert quand le brouillon d'origine a été écrasé. Reconstitution fidèle de ce qui est écrit dans le devis ;
// ce qui n'y figure pas (ex. quantités modifiées à la main après coup) ne peut pas être deviné. Fonctions pures.

import { POSTE_CABLAGE, POSTE_MAIN_OEUVRE, PREFIXE_CIRCUIT, articleAuMetre, type BesoinApparie, type Conditionnement } from "./predevis-engine";
import { PREFIXE_A_COMPLETER } from "./devis-lignes";
import type { Prestation } from "@/types";

export interface LigneDevisLue {
  nom: string; quantite: number; prix_unitaire: number; unite: string;
  type_branche: "service" | "materiau"; prestation_id?: string | null; poste?: string | null;
}

/** Même forme que l'état de choix de la page du pré-devis. */
export interface EtatChoixReconstruit {
  mode: "option" | "autre" | "libre" | "exclu" | "adefinir";
  optionIndex: number;
  autrePrestationId: string;
  libreNom: string;
  librePrix: string;
  libreUnite: string;
  libreBranche: "service" | "materiau";
  fournisseurId: string;
  conditionnement?: Conditionnement;
}

export interface PreDevisReconstruit {
  mode: "piece" | "circuit" | null;
  choix: Record<string, EtatChoixReconstruit>;
  choixAgrege: Record<string, EtatChoixReconstruit>;
  hCablage: Record<string, string>;
  hAppareils: Record<string, string>;
  mainOeuvreHeures: string | null;
  fraisGenerauxPct: string | null;
  deplacementEur: string | null;
  avertissements: string[];
}

const arrondi = (n: number) => Math.round(n * 100) / 100;
const txt = (n: number) => String(arrondi(n));

/** Mode d'après les noms de postes : « Circuit · … » = par circuit ; d'autres postes (hors câbles / main d'œuvre) = par pièce ; aucun poste = inconnu. */
export function detecterMode(lignes: Pick<LigneDevisLue, "poste">[]): "piece" | "circuit" | null {
  const postes = lignes.map(l => l.poste).filter((p): p is string => !!p && p !== POSTE_CABLAGE && p !== POSTE_MAIN_OEUVRE);
  if (postes.length === 0) return null;
  return postes.some(p => p.startsWith(PREFIXE_CIRCUIT)) ? "circuit" : "piece";
}

const PAR_DEFAUT = (b: BesoinApparie): EtatChoixReconstruit => ({
  mode: b.options.length > 0 ? "option" : "libre", optionIndex: 0, autrePrestationId: "", libreNom: b.label, librePrix: "", libreUnite: "u", libreBranche: "materiau", fournisseurId: "",
});

export function reconstruireDepuisDevis(lignes: LigneDevisLue[], besoins: BesoinApparie[], prestations: Prestation[]): PreDevisReconstruit {
  const avertissements: string[] = [];
  const mode = detecterMode(lignes);
  const heures = lignes.filter(l => l.unite === "heure");
  const matieres = lignes.filter(l => l.unite !== "heure" && l.nom !== "Frais généraux" && l.nom !== "Déplacement");
  const aDesPostes = lignes.some(l => !!l.poste);

  // ─── Heures de main d'œuvre ─────────────────────────────────────────────────────────────────────────────────
  const hCablage: Record<string, string> = {}, hAppareils: Record<string, string> = {};
  let generales = 0;
  heures.forEach(l => {
    const q = Number(l.quantite) || 0;
    if (!aDesPostes || !l.poste || l.poste === POSTE_MAIN_OEUVRE) { generales += q; return; }
    const cible = /—\s*appareillage\s*$/i.test(l.nom) ? hAppareils : hCablage;
    cible[l.poste] = txt((Number(cible[l.poste]) || 0) + q);
  });
  if (!aDesPostes && heures.length > 0) avertissements.push("Ce devis n'a pas de postes (présentation regroupée par produits) : les heures par poste ne sont pas reconstituables, le total est repris en main d'œuvre générale.");

  // ─── Frais généraux et déplacement ──────────────────────────────────────────────────────────────────────────
  const montant = (l: LigneDevisLue) => (Number(l.quantite) || 0) * (Number(l.prix_unitaire) || 0);
  const sousTotal = lignes.filter(l => l.nom !== "Frais généraux" && l.nom !== "Déplacement").reduce((s, l) => s + montant(l), 0);
  const frais = lignes.find(l => l.nom === "Frais généraux");
  const depl = lignes.find(l => l.nom === "Déplacement");

  // ─── Articles ───────────────────────────────────────────────────────────────────────────────────────────────
  const choix: Record<string, EtatChoixReconstruit> = {}, choixAgrege: Record<string, EtatChoixReconstruit> = {};
  const postesDuDevis = new Set(matieres.map(l => l.poste).filter(Boolean) as string[]);
  let nonRetrouves = 0;
  besoins.forEach(b => {
    const base = PAR_DEFAUT(b);
    if (b.cle.startsWith("AGREGE_")) {
      const dansPoste = matieres.filter(l => l.poste === POSTE_CABLAGE || !aDesPostes);
      const ids = new Set(dansPoste.map(l => l.prestation_id).filter(Boolean) as string[]);
      let trouve = false;
      b.options.forEach((o, i) => {
        if (trouve) return;
        if (ids.has(o.prestation_id)) { choixAgrege[b.cle] = { ...base, mode: "option", optionIndex: i, conditionnement: "auto" }; trouve = true; return; }
        const aid = o.longueur_unitaire ? articleAuMetre(o.sousCategorieArticle ?? b.sousCategorie, o.gamme, prestations)?.id : undefined;
        if (aid && ids.has(aid)) { choixAgrege[b.cle] = { ...base, mode: "option", optionIndex: i, conditionnement: "metre" }; trouve = true; }
      });
      if (!trouve && b.options.length > 0) nonRetrouves++;
      return;
    }
    const duPoste = aDesPostes ? matieres.filter(l => l.poste === b.piece) : matieres;
    const idx = b.options.findIndex(o => duPoste.some(l => l.prestation_id === o.prestation_id));
    if (idx >= 0) { choix[b.cle] = { ...base, mode: "option", optionIndex: idx }; return; }
    const libre = duPoste.find(l => !l.prestation_id && !l.nom.startsWith(PREFIXE_A_COMPLETER) && l.nom === b.label);
    if (libre) { choix[b.cle] = { ...base, mode: "libre", libreNom: libre.nom, librePrix: String(libre.prix_unitaire), libreUnite: libre.unite, libreBranche: libre.type_branche }; return; }
    // Poste présent dans le devis mais sans ligne pour ce besoin : il avait été exclu (ou remplacé par un article hors liste, non identifiable).
    if (aDesPostes && postesDuDevis.has(b.piece) && b.options.length > 0) { choix[b.cle] = { ...base, mode: "exclu" }; return; }
    if (b.options.length > 0) nonRetrouves++;
  });
  if (nonRetrouves > 0) avertissements.push(`${nonRetrouves} ligne(s) du pré-devis n'ont pas d'équivalent dans le devis (poste absent ou article hors liste) : elles reprennent le choix par défaut.`);

  return {
    mode,
    choix, choixAgrege, hCablage, hAppareils,
    mainOeuvreHeures: generales > 0 ? txt(generales) : null,
    fraisGenerauxPct: frais && sousTotal > 0 ? txt(montant(frais) / sousTotal * 100) : null,
    deplacementEur: depl ? txt(montant(depl)) : null,
    avertissements,
  };
}

// ─── Versions du brouillon (instantanés pris à la génération d'un devis ou avant un rechargement) ─────────────────

export interface VersionPredevis { id: string; date: string; label: string; devisId?: string; contenu: string }

export function ajouterVersion(versions: VersionPredevis[], v: VersionPredevis, max = 6): VersionPredevis[] {
  // Un devis n'a qu'un instantané : le plus récent remplace l'ancien.
  const sans = v.devisId ? versions.filter(x => x.devisId !== v.devisId) : versions;
  return [...sans, v].slice(-max);
}
