// src/lib/soleil.ts
//
// Soleil de MIDI pour la vue 3D des plans : à midi solaire le soleil est plein Sud, à une hauteur qui ne
// dépend que de la latitude et de la date. L'orientation du bâtiment (Niveau.orientationNord) donne la
// direction du Sud dans le repère du plan.
//
// Repère du plan : x vers la droite, y vers le BAS (écran) ; en 3D x → x, y → z, hauteur → y.
// orientationNord = angle, en degrés et sens horaire, entre le haut du plan et le Nord géographique
// (0 = Nord en haut ; 90 = Nord à droite ; 180 = Nord en bas).

export type SaisonSoleil = "aujourdhui" | "ete" | "equinoxe" | "hiver";

export const LABEL_SAISON_SOLEIL: Record<SaisonSoleil, string> = {
  aujourdhui: "Aujourd'hui", ete: "Été (21 juin)", equinoxe: "Équinoxe", hiver: "Hiver (21 déc.)",
};

// Pays Basque (Bayonne ≈ 43,5° N) — utilisée tant qu'aucune latitude propre au chantier n'est enregistrée.
export const LATITUDE_DEFAUT = 43.3;
const INCLINAISON_TERRE = 23.44;

// Déclinaison solaire (degrés) à une date donnée (formule de Cooper, précision suffisante ici).
export function declinaisonSolaire(date: Date): number {
  const debutAnnee = Date.UTC(date.getFullYear(), 0, 0);
  const jour = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - debutAnnee) / 86400000);
  return INCLINAISON_TERRE * Math.sin((2 * Math.PI / 365) * (284 + jour));
}

// Hauteur du soleil au-dessus de l'horizon (degrés) à midi solaire.
export function elevationMidi(saison: SaisonSoleil, latitude: number = LATITUDE_DEFAUT, date: Date = new Date()): number {
  const decl = saison === "ete" ? INCLINAISON_TERRE
    : saison === "hiver" ? -INCLINAISON_TERRE
    : saison === "equinoxe" ? 0
    : declinaisonSolaire(date);
  return Math.min(89, Math.max(5, 90 - latitude + decl));
}

// Vecteur unitaire (repère 3D de la scène) allant de la scène VERS le soleil à midi.
export function directionSoleilMidi(orientationNordDeg: number, elevationDeg: number): { x: number; y: number; z: number } {
  const t = (orientationNordDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  // Nord dans le plan = (sin t, -cos t) ; Sud = l'opposé = (-sin t, cos t).
  const sudX = -Math.sin(t), sudY = Math.cos(t);
  return { x: sudX * Math.cos(el), y: Math.sin(el), z: sudY * Math.cos(el) };
}

// Ramène un angle saisi dans [0, 360[.
export const normaliserAngle = (deg: number): number => ((Math.round(deg) % 360) + 360) % 360;
