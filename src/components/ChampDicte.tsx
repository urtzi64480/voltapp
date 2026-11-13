"use client";
import { useRef, type TextareaHTMLAttributes } from "react";
import BoutonMicro from "./BoutonMicro";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (valeur: string) => void;
};

/**
 * Zone de texte avec bouton micro : dictée vocale du navigateur, sur PC comme sur téléphone, ajoutée en direct à la suite du texte déjà écrit
 * (Firefox : le bouton ouvre la zone et renvoie vers la dictée du clavier / de Windows + H).
 */
export default function ChampDicte({ value, onChange, className, ...reste }: Props) {
  const zone = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="relative">
      <textarea
        ref={zone}
        lang="fr"
        autoCapitalize="sentences"
        {...reste}
        className={`${className ?? "input"} pr-12`}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <BoutonMicro valeur={value} onTexte={onChange} zone={zone} taille={16}
        className="absolute top-2 right-2 w-9 h-9 rounded-full grid place-items-center bg-volt-500 text-ink-900 shadow-sm active:scale-95 transition-transform" />
    </div>
  );
}
