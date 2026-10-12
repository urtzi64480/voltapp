// src/lib/fond-modal.ts
//
// FOND DE MODALE : ne ferme la fenêtre que si le clic COMMENCE et FINIT sur le fond. Sans ça, sélectionner du texte dans un champ puis relâcher la souris
// en dehors du cadre produit un « click » dont la cible est le fond (ancêtre commun) → la fenêtre se fermait en perdant la saisie.
import type { MouseEvent } from "react";

let origine: EventTarget | null = null;

export function fondModal(fermer: () => void) {
  return {
    onMouseDown: (e: MouseEvent) => { origine = e.target; },
    onClick: (e: MouseEvent) => {
      const debut = origine; origine = null;
      if (debut !== null && debut !== e.target) return;   // l'appui a démarré ailleurs (dans le cadre) : glissement, pas un clic sur le fond
      fermer();
    },
  };
}
