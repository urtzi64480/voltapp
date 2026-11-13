"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { MESSAGE_SANS_DICTEE, creerDictee, reconnaissanceDisponible } from "@/lib/dictee";

interface Props {
  /** Texte actuel de la zone. */
  valeur: string;
  onTexte: (texte: string) => void;
  /** Zone de saisie : prend le focus (curseur à la fin) quand le navigateur n'a pas de dictée intégrée. */
  zone: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  className?: string;
  taille?: number;
}

/**
 * Bouton micro : dictée vocale du navigateur sur PC (Chrome, Edge, Safari) comme sur téléphone, texte ajouté en direct à la suite.
 * Sans dictée intégrée (Firefox), il ouvre la zone et indique d'utiliser la dictée du clavier ou du système.
 */
export default function BoutonMicro({ valeur, onTexte, zone, className, taille = 16 }: Props) {
  const [ecoute, setEcoute] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const valeurRef = useRef(valeur); valeurRef.current = valeur;
  const onTexteRef = useRef(onTexte); onTexteRef.current = onTexte;
  const moteur = useRef<ReturnType<typeof creerDictee> | null>(null);

  useEffect(() => () => { moteur.current?.abandonner(); moteur.current = null; }, []);

  function appuyer() {
    if (ecoute) { moteur.current?.arreter(); return; }
    const z = zone.current;
    const Reco = reconnaissanceDisponible();
    if (!Reco) {
      setErreur(MESSAGE_SANS_DICTEE);
      if (z) { z.focus(); z.setSelectionRange(z.value.length, z.value.length); }
      return;
    }
    setErreur(null);
    moteur.current ??= creerDictee({
      Reconnaissance: Reco,
      lire: () => valeurRef.current,
      ecrire: t => onTexteRef.current(t),
      surEtat: e => { setEcoute(e.ecoute); setErreur(e.erreur); },
    });
    moteur.current.demarrer();
  }

  return (
    <>
      <button type="button" onClick={appuyer} aria-pressed={ecoute} aria-label={ecoute ? "Arrêter la dictée" : "Dicter"} title={ecoute ? "Arrêter la dictée" : "Dicter (micro)"}
        className={`${className ?? ""} ${ecoute ? "!bg-red-500 !text-white animate-pulse" : ""}`}>
        {ecoute ? <Square size={taille - 2} fill="currentColor" /> : <Mic size={taille} />}
      </button>
      {erreur && <p role="alert" className="absolute right-0 top-full z-10 mt-1 max-w-xs rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 shadow-sm">{erreur}</p>}
    </>
  );
}
