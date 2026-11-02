"use client";
import { useEffect, useState } from "react";
import { Star, X } from "lucide-react";

export const LIEN_AVIS_GOOGLE = "https://share.google/FuJxuTpwZXDPQBU9g";

/** QR code vers l'avis Google, à montrer au client (plein écran en un clic). */
export default function QrAvis() {
  const [img, setImg] = useState<string | null>(null);
  const [grand, setGrand] = useState(false);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    let vivant = true;
    import("qrcode")
      .then(Q => Q.toDataURL(LIEN_AVIS_GOOGLE, { width: 640, margin: 2, errorCorrectionLevel: "M" }))
      .then(u => { if (vivant) setImg(u); })
      .catch(() => { if (vivant) setErreur(true); });
    return () => { vivant = false; };
  }, []);

  return (
    <>
      <button type="button" onClick={() => img && setGrand(true)} disabled={!img}
        className="card w-full flex items-center gap-4 p-4 text-left hover:border-volt-500/50 transition-colors disabled:opacity-60">
        <div className="w-20 h-20 shrink-0 rounded-lg bg-white flex items-center justify-center overflow-hidden">
          {img ? <img src={img} alt="QR code avis Google" className="w-full h-full" /> : <span className="text-xs text-ink-500">{erreur ? "Erreur" : "…"}</span>}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-semibold"><Star size={16} className="text-volt-500" /> Avis Google</div>
          <p className="text-sm text-ink-400">Touche pour afficher le QR code en grand et le montrer au client.</p>
        </div>
      </button>

      {grand && img && (
        <div className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center p-6" onClick={() => setGrand(false)}>
          <button type="button" aria-label="Fermer" className="absolute top-4 right-4 p-2 text-black"><X size={28} /></button>
          <p className="text-black text-xl font-bold mb-4 text-center">Votre avis nous aide !</p>
          <img src={img} alt="QR code avis Google" className="w-full max-w-sm aspect-square" />
          <p className="text-black/70 mt-4 text-center">Scannez avec l'appareil photo de votre téléphone</p>
        </div>
      )}
    </>
  );
}
