"use client";
import { useRef, type TextareaHTMLAttributes } from "react";
import { Mic } from "lucide-react";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (valeur: string) => void;
};

/**
 * Zone de texte avec bouton micro. La dictée est celle du clavier (Android, iPhone) ou du système (Windows + H, macOS) :
 * le bouton ouvre la zone, curseur à la fin, et la dictée s'ajoute à la suite du texte déjà écrit.
 */
export default function ChampDicte({ value, onChange, className, ...reste }: Props) {
  const zone = useRef<HTMLTextAreaElement>(null);
  function dicter() {
    const z = zone.current;
    if (!z) return;
    z.focus();
    z.setSelectionRange(z.value.length, z.value.length);
  }
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
      <button
        type="button"
        onClick={dicter}
        className="absolute top-2 right-2 w-9 h-9 rounded-full grid place-items-center bg-volt-500 text-ink-900 shadow-sm active:scale-95 transition-transform"
        aria-label="Dicter"
        title="Dicter : touche ensuite le micro du clavier (Windows + H sur PC)"
      >
        <Mic size={16} />
      </button>
    </div>
  );
}
