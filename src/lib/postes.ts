// Regroupement des lignes de devis en « postes » (ex. « Pose d'une prise »).
// Un poste = un simple nom porté par les lignes (devis_lignes.poste). Aucun lien avec le
// catalogue ni les kits. Une ligne sans poste (null) est « hors poste ».

export interface LigneAvecPoste {
  poste?: string | null;
  quantite: number;
  prix_unitaire: number;
  ordre?: number | null;
}

export interface BlocPoste<T> {
  poste: string | null;
  items: { l: T; i: number }[];
}

export function nettoyerNomPoste(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

export function memeNomPoste(a: string, b: string): boolean {
  return nettoyerNomPoste(a).toLowerCase() === nettoyerNomPoste(b).toLowerCase();
}

export function posteDe(l: { poste?: string | null }): string | null {
  const p = (l.poste ?? "").trim();
  return p === "" ? null : p;
}

// Noms de postes distincts, dans l'ordre d'apparition des lignes.
export function extrairePostes(lignes: { poste?: string | null }[]): string[] {
  const out: string[] = [];
  for (const l of lignes) {
    const p = posteDe(l);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

// Tri par `ordre` (les lignes chargées depuis Supabase n'ont pas d'ordre garanti).
// Si une ligne n'a pas d'ordre (aperçu en mémoire), on garde l'ordre d'origine.
export function trierParOrdre<T extends { ordre?: number | null }>(lignes: T[]): T[] {
  if (lignes.some(l => l.ordre == null)) return lignes;
  return lignes
    .map((l, idx) => ({ l, idx }))
    .sort((a, b) => (a.l.ordre as number) - (b.l.ordre as number) || a.idx - b.idx)
    .map(x => x.l);
}

// Blocs dans l'ordre : postes (ordre de `postes` si fourni, puis ordre d'apparition),
// puis les lignes hors poste à la fin. `i` = index dans le tableau d'origine.
export function grouperParPoste<T extends { poste?: string | null }>(
  lignes: T[],
  opts: { postes?: string[]; inclureVides?: boolean } = {},
): BlocPoste<T>[] {
  const noms: string[] = [...(opts.postes ?? [])];
  for (const l of lignes) {
    const p = posteDe(l);
    if (p && !noms.includes(p)) noms.push(p);
  }
  const blocs: BlocPoste<T>[] = [];
  for (const nom of noms) {
    const items: { l: T; i: number }[] = [];
    lignes.forEach((l, i) => { if (posteDe(l) === nom) items.push({ l, i }); });
    if (items.length > 0 || opts.inclureVides) blocs.push({ poste: nom, items });
  }
  const horsPoste: { l: T; i: number }[] = [];
  lignes.forEach((l, i) => { if (posteDe(l) === null) horsPoste.push({ l, i }); });
  if (horsPoste.length > 0) blocs.push({ poste: null, items: horsPoste });
  return blocs;
}

// Lignes remises à plat dans l'ordre d'affichage (postes puis hors poste) — à utiliser
// avant l'enregistrement pour que `ordre` reflète le regroupement.
export function ordonnerLignes<T extends { poste?: string | null }>(lignes: T[], postes: string[]): T[] {
  return grouperParPoste(lignes, { postes }).flatMap(b => b.items.map(x => x.l));
}

export function totalItems(items: { l: LigneAvecPoste }[]): number {
  return items.reduce((a, x) => a + x.l.prix_unitaire * x.l.quantite, 0);
}
