"use client";
// Zone de signature au doigt / à la souris. Renvoie une image PNG réduite (data URL), ou null si la zone est vide.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface SignaturePadRef { effacer: () => void; exporter: () => string | null }

const SignaturePad = forwardRef<SignaturePadRef, { hauteur?: number }>(function SignaturePad({ hauteur = 180 }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dessin = useRef({ actif: false, x: 0, y: 0, trace: false });

  useEffect(() => {
    const c = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * dpr; c.height = c.offsetHeight * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#1C1917"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
  }, []);

  const pos = (e: React.MouseEvent | React.TouchEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const p = "touches" in e ? e.touches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  };
  const debut = (e: React.MouseEvent | React.TouchEvent) => { dessin.current = { ...dessin.current, actif: true, ...pos(e) }; };
  const trait = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dessin.current.actif) return;
    const ctx = canvasRef.current!.getContext("2d")!, p = pos(e), d = dessin.current;
    ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    d.x = p.x; d.y = p.y; d.trace = true;
  };
  const fin = () => { dessin.current.actif = false; };

  useImperativeHandle(ref, () => ({
    effacer: () => { const c = canvasRef.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); dessin.current.trace = false; },
    exporter: () => {
      if (!dessin.current.trace) return null;
      const c = canvasRef.current!;
      const e = Math.min(1, 480 / c.width);
      const t = document.createElement("canvas");
      t.width = Math.round(c.width * e); t.height = Math.round(c.height * e);
      t.getContext("2d")!.drawImage(c, 0, 0, t.width, t.height);
      return t.toDataURL("image/png");
    },
  }));

  return (
    <canvas ref={canvasRef} style={{ height: hauteur, touchAction: "none" }}
      className="w-full border-2 border-dashed border-ink-200 rounded-2xl bg-ink-50 cursor-crosshair" aria-label="Zone de signature"
      onMouseDown={debut} onMouseMove={trait} onMouseUp={fin} onMouseLeave={fin}
      onTouchStart={debut} onTouchMove={trait} onTouchEnd={fin} />
  );
});
export default SignaturePad;
