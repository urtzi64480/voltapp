// src/lib/garanties.ts — échéances de garantie à compter de la réception des travaux (durées légales usuelles du bâtiment).
export interface Garantie { nom: string; annees: number; fin: string; detail: string }

/** Ajoute des années à une date AAAA-MM-JJ ; le 29 février devient le 28 février les années non bissextiles. */
export function ajouterAnnees(iso: string, annees: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const an = y + annees;
  const dernier = new Date(an, m, 0).getDate();
  return `${an}-${String(m).padStart(2, "0")}-${String(Math.min(d, dernier)).padStart(2, "0")}`;
}

export function garanties(receptionIso: string): Garantie[] {
  return [
    { nom: "Parfait achèvement", annees: 1, fin: ajouterAnnees(receptionIso, 1), detail: "Désordres signalés à la réception ou dans l'année" },
    { nom: "Bon fonctionnement", annees: 2, fin: ajouterAnnees(receptionIso, 2), detail: "Équipements dissociables de l'installation" },
    { nom: "Décennale", annees: 10, fin: ajouterAnnees(receptionIso, 10), detail: "Dommages compromettant la solidité ou rendant l'ouvrage impropre à sa destination" },
  ];
}
