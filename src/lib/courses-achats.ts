// src/lib/courses-achats.ts
//
// BILAN EN DIRECT de la liste de courses d'un devis : ce que j'ai dépensé (montants réels saisis, ou prix prévu d'un article coché sans
// modification) contre le prix d'achat PRÉVU, en TTC et en HT, pour voir tout de suite si je fais des économies. Pur : la page lui donne
// l'état courant (articles, cases cochées, achats) et affiche le résultat, rien n'est stocké ici.
//
// Montants stockés en TTC (franchise en base de TVA : la TVA des fournisseurs n'est pas récupérable) ; le HT s'en déduit (÷ 1,2).
import { htDepuisTtc } from "./depenses-materiel";

const arrondi = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ArticleListe {
  key: string;
  /** Prix d'achat prévu TTC de l'article (quantité comprise) ; null = pas de prix d'achat renseigné dans le catalogue. */
  prevuTtc: number | null;
  coche: boolean;
}
/** Un achat réel : `article` vide = achat global du devis (« j'ai tout acheté »). */
export interface AchatBilan { article: string; montant: number }

export interface Bilan {
  reelTtc: number; reelHt: number;
  /** Prévu des articles achetés (cochés, ou avec un prix, ou tous si achat global) — de quoi comparer à armes égales. */
  prevuTtc: number; prevuHt: number;
  /** Réel − prévu : négatif = économie. Calculé sur les articles dont le prévu est connu. */
  ecartTtc: number; ecartHt: number; ecartPct: number | null;
  /** Prévu des articles pas encore achetés. */
  resteTtc: number; resteHt: number;
  nbArticles: number; nbAchetes: number;
  /** Articles achetés sans prix prévu : leur prix payé compte dans le dépensé mais pas dans l'écart. */
  nbSansPrevu: number;
}

export function bilanAchats(articles: ArticleListe[], achats: AchatBilan[]): Bilan {
  const globalExiste = achats.some(a => a.article === "");
  const parArticle = new Map<string, number>();
  achats.forEach(a => { if (a.article !== "") parArticle.set(a.article.toLowerCase(), (parArticle.get(a.article.toLowerCase()) ?? 0) + a.montant); });
  const reelTtc = arrondi(achats.reduce((t, a) => t + a.montant, 0));

  let prevu = 0, reste = 0, nbAchetes = 0, nbSansPrevu = 0, reelSansPrevu = 0;
  const vus = new Set<string>();
  for (const art of articles) {
    if (vus.has(art.key)) continue;           // même article affiché deux fois : compté une fois
    vus.add(art.key);
    const achete = globalExiste || art.coche || parArticle.has(art.key);
    if (!achete) { reste += art.prevuTtc ?? 0; continue; }
    nbAchetes++;
    if (art.prevuTtc == null) { nbSansPrevu++; reelSansPrevu += parArticle.get(art.key) ?? 0; }
    else prevu += art.prevuTtc;
  }
  const prevuTtc = arrondi(prevu);
  const reelComparable = arrondi(reelTtc - reelSansPrevu);
  const ecartTtc = arrondi(reelComparable - prevuTtc);
  const ecartHt = arrondi(htDepuisTtc(reelComparable) - htDepuisTtc(prevuTtc));
  return {
    reelTtc, reelHt: htDepuisTtc(reelTtc),
    prevuTtc, prevuHt: htDepuisTtc(prevuTtc),
    ecartTtc, ecartHt, ecartPct: prevuTtc > 0 ? Math.round((ecartTtc / prevuTtc) * 1000) / 10 : null,
    resteTtc: arrondi(reste), resteHt: htDepuisTtc(arrondi(reste)),
    nbArticles: vus.size, nbAchetes, nbSansPrevu,
  };
}

/** Écart d'un article : payé − prévu, en TTC et en HT (négatif = économie). */
export function ecartArticle(payeTtc: number, prevuTtc: number): { ttc: number; ht: number } {
  return { ttc: arrondi(payeTtc - prevuTtc), ht: arrondi(htDepuisTtc(payeTtc) - htDepuisTtc(prevuTtc)) };
}

/** Ton d'un écart : économie, surcoût ou conforme (écart < 1 centime). */
export const tonEcart = (ecartTtc: number): "economie" | "surcout" | "neutre" => (ecartTtc <= -0.005 ? "economie" : ecartTtc >= 0.005 ? "surcout" : "neutre");
