// src/lib/projets.ts
//
// Projets par client (un client peut avoir plusieurs logements/chantiers).
// Chaque projet a son plan de circuits, son tableau et son brouillon de pré-devis.
//
// Reprise automatique : si un client n'a encore aucun projet, on crée "Logement principal"
// à partir des colonnes historiques clients.maison_config / tableau_config / predevis_config
// (qui restent en place). Seul le tableau du PREMIER projet est encore recopié dans
// clients.tableau_config (voir sauverTableau) pour que les anciens consommateurs — fonction
// publique get_tableau_public, anciens QR codes — restent cohérents.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Projet } from "@/types";
import type { BreakerRow } from "@/lib/electrical-constants";

const NOM_DEFAUT = "Logement principal";

export async function listerProjets(clientId: string): Promise<Projet[]> {
  const { data, error } = await supabase
    .from("projets").select("*").eq("client_id", clientId).order("created_at", { ascending: true });
  if (error) { console.error("projets: lecture impossible", error); return []; }
  if (data && data.length > 0) return data as Projet[];

  // Aucun projet : reprise des données historiques du client.
  const { data: c } = await supabase
    .from("clients").select("maison_config, tableau_config, predevis_config, adresse, ville").eq("id", clientId).single();
  const { data: { session } } = await supabase.auth.getSession();
  const cc = c as any;
  const { data: cree, error: errIns } = await supabase.from("projets").insert({
    ...(session?.user ? { user_id: session.user.id } : {}),
    client_id: clientId,
    nom: NOM_DEFAUT,
    maison_config: cc?.maison_config || null,
    tableau_config: cc?.tableau_config || null,
    predevis_config: cc?.predevis_config || null,
  }).select().single();
  if (errIns || !cree) {
    // Deux onglets peuvent créer en même temps : on relit avant d'abandonner.
    const { data: relu } = await supabase
      .from("projets").select("*").eq("client_id", clientId).order("created_at", { ascending: true });
    if (relu && relu.length > 0) return relu as Projet[];
    console.error("projets: création du projet par défaut impossible", errIns);
    return [];
  }
  return [cree as Projet];
}

export async function creerProjet(clientId: string, nom: string, adresse?: string): Promise<Projet | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.from("projets").insert({
    ...(session?.user ? { user_id: session.user.id } : {}),
    client_id: clientId,
    nom: nom.trim() || "Nouveau projet",
    adresse: adresse?.trim() || null,
  }).select().single();
  if (error || !data) { console.error("projets: création impossible", error); return null; }
  return data as Projet;
}

export async function modifierProjet(id: string, patch: Partial<Pick<Projet, "nom" | "adresse" | "maison_config" | "tableau_config" | "predevis_config" | "tableaux_annexes">>) {
  const { error } = await supabase.from("projets").update({ ...patch, updated_at: new Date().toISOString() } as any).eq("id", id);
  if (error) console.error("projets: mise à jour impossible", error);
  return !error;
}

// ─── Tableaux annexes (pool house, garage…) ─────────────────────────────────────
// Le tableau PRINCIPAL vit dans projets.tableau_config ; les annexes sont listées dans
// projets.tableaux_annexes. Un niveau du plan choisit son tableau via Niveau.tableauId
// (absent ou "principal" = tableau principal).

export const TABLEAU_PRINCIPAL = "principal";

export interface TableauAnnexe { id: string; nom: string; rows: BreakerRow[]; }

export function lireAnnexes(raw: string | null | undefined): TableauAnnexe[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t: any) => t && typeof t.id === "string")
      .map((t: any) => ({ id: t.id as string, nom: typeof t.nom === "string" && t.nom ? t.nom : "Tableau annexe", rows: Array.isArray(t.rows) ? t.rows : [] }));
  } catch { return []; }
}

export function nouvelIdAnnexe(): string {
  return `annexe-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function sauverAnnexes(projetId: string, annexes: TableauAnnexe[]) {
  return modifierProjet(projetId, { tableaux_annexes: annexes.length > 0 ? JSON.stringify(annexes) : null });
}

/**
 * Aligne la liste des tableaux annexes sur les annexes voulues (une par niveau « Annexe » du
 * plan) : les rangées déjà en base sont conservées, les nouvelles annexes démarrent vides,
 * celles qui ne sont plus voulues sont supprimées avec leurs rangées. Relit la base avant
 * d'écrire, pour ne jamais écraser des rangées modifiées depuis l'éditeur de tableau.
 */
export async function synchroniserAnnexes(projetId: string, voulues: { id: string; nom: string }[]): Promise<TableauAnnexe[]> {
  const { data } = await supabase.from("projets").select("tableaux_annexes").eq("id", projetId).single();
  const enBase = lireAnnexes((data as any)?.tableaux_annexes);
  const liste: TableauAnnexe[] = voulues.map(v => ({
    id: v.id, nom: v.nom, rows: enBase.find(a => a.id === v.id)?.rows ?? [],
  }));
  await sauverAnnexes(projetId, liste);
  return liste;
}

/** Enregistre le tableau d'un projet ; recopie aussi dans clients.tableau_config si c'est le premier projet. */
export async function sauverTableau(clientId: string, projetId: string, json: string | null) {
  const ok = await modifierProjet(projetId, { tableau_config: json });
  const { data } = await supabase.from("projets").select("id").eq("client_id", clientId).order("created_at", { ascending: true }).limit(1);
  if (data?.[0]?.id === projetId) {
    await supabase.from("clients").update({ tableau_config: json } as any).eq("id", clientId);
  }
  return ok;
}

/**
 * Supprime un projet (plan, tableau principal, annexes et brouillon de pré-devis compris).
 * Les colonnes historiques du client (clients.maison_config / tableau_config /
 * predevis_config) sont ensuite réalignées : sans ça, la reprise automatique de
 * listerProjets() ressusciterait le projet supprimé à partir de l'ancienne copie.
 * Les devis déjà créés ne sont pas touchés. Un client n'est jamais laissé sans projet :
 * supprimer son dernier projet le remet à zéro (un projet vierge est recréé à l'ouverture).
 */
export async function supprimerProjet(clientId: string, id: string) {
  const { error } = await supabase.from("projets").delete().eq("id", id);
  if (error) { console.error("projets: suppression impossible", error); return false; }
  const { data: restants } = await supabase
    .from("projets").select("tableau_config").eq("client_id", clientId).order("created_at", { ascending: true });
  if (restants && restants.length > 0) {
    await supabase.from("clients").update({ tableau_config: (restants[0] as any).tableau_config ?? null } as any).eq("id", clientId);
  } else {
    await supabase.from("clients").update({ maison_config: null, tableau_config: null, predevis_config: null } as any).eq("id", clientId);
  }
  return true;
}

/** Client sans projet (ancien plan jamais ouvert depuis l'ajout des projets) : vide ses données historiques. */
export async function viderDonneesHistoriques(clientId: string) {
  const { error } = await supabase.from("clients")
    .update({ maison_config: null, tableau_config: null, predevis_config: null } as any).eq("id", clientId);
  if (error) console.error("projets: nettoyage impossible", error);
  return !error;
}

/** Suffixe d'URL à ajouter aux liens entre pages du même projet. */
export function qsProjet(projetId?: string | null): string {
  return projetId ? `?projet=${projetId}` : "";
}

/**
 * Résout le projet courant d'un client à partir de ?projet=<id> (lu côté navigateur, sans
 * useSearchParams pour éviter d'imposer <Suspense>). Sans paramètre ou paramètre inconnu :
 * le premier projet (le plus ancien).
 */
export function useProjets(clientId: string) {
  const [projets, setProjets] = useState<Projet[]>([]);
  const [projetId, setProjetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const charger = useCallback(async (idSouhaite?: string | null) => {
    const liste = await listerProjets(clientId);
    const voulu = idSouhaite ?? (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("projet") : null);
    const choisi = liste.find(p => p.id === voulu) ?? liste[0] ?? null;
    setProjets(liste);
    setProjetId(choisi?.id ?? null);
    setLoading(false);
    // Garde l'URL cohérente (un ?projet= pointant sur un projet supprimé est corrigé).
    if (choisi && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("projet") !== choisi.id) {
      const url = new URL(window.location.href);
      url.searchParams.set("projet", choisi.id);
      window.history.replaceState(null, "", url.toString());
    }
  }, [clientId]);

  useEffect(() => { setLoading(true); charger(); }, [charger]);

  const changerProjet = useCallback((id: string) => {
    setProjetId(id);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("projet", id);
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  const projet = projets.find(p => p.id === projetId) ?? null;
  return { projets, projet, loading, changerProjet, recharger: charger };
}
