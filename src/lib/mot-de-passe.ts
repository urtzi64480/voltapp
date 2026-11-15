// src/lib/mot-de-passe.ts
//
// Contrôles du formulaire « Changer mon mot de passe » (Paramètres). Même longueur minimale que la page d'activation /auth/confirm.
export const LONGUEUR_MIN_MOT_DE_PASSE = 8;

/** Renvoie le message d'erreur à afficher, ou null si le formulaire est valide. */
export function verifierNouveauMotDePasse(actuel: string, nouveau: string, confirmation: string): string | null {
  if (!actuel) return "Renseignez votre mot de passe actuel.";
  if (nouveau.length < LONGUEUR_MIN_MOT_DE_PASSE) return `Le nouveau mot de passe doit faire au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères.`;
  if (nouveau !== confirmation) return "Les deux nouveaux mots de passe ne correspondent pas.";
  if (nouveau === actuel) return "Le nouveau mot de passe doit être différent de l'actuel.";
  return null;
}
