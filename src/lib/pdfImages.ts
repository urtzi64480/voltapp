// Images produit pour les PDF (devis, facture). Navigateur uniquement.
// Chaque image est récupérée via le relais /api/public/image (voir la route : seules les images
// enregistrées par l'artisan sont servies), puis redessinée en JPEG réduit (≤ 220 px, fond blanc) :
// format garanti accepté par jsPDF, PDF léger. Toute image qui échoue est simplement ignorée —
// un problème d'image ne doit JAMAIS empêcher de générer le document.

export interface ImagePdf { data: string; w: number; h: number }
export type ImagesPdf = Map<string, ImagePdf>;

const TAILLE_MAX = 220;
const MAX_IMAGES = 40;
const DELAI_MS = 9000;

function chargerUne(url: string): Promise<ImagePdf | null> {
  return new Promise(resolve => {
    const minuteur = setTimeout(() => resolve(null), DELAI_MS);
    const fin = (v: ImagePdf | null) => { clearTimeout(minuteur); resolve(v); };
    fetch(`/api/public/image?u=${encodeURIComponent(url)}`)
      .then(r => (r.ok ? r.blob() : null))
      .then(blob => {
        if (!blob) return fin(null);
        const obj = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          try {
            const ratio = Math.min(1, TAILLE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
            const w = Math.max(1, Math.round(img.naturalWidth * ratio));
            const h = Math.max(1, Math.round(img.naturalHeight * ratio));
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) return fin(null);
            ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            fin({ data: canvas.toDataURL("image/jpeg", 0.82), w, h });
          } catch { fin(null); }
          finally { URL.revokeObjectURL(obj); }
        };
        img.onerror = () => { URL.revokeObjectURL(obj); fin(null); };
        img.src = obj;
      })
      .catch(() => fin(null));
  });
}

export async function chargerImagesPdf(urls: (string | null | undefined)[]): Promise<ImagesPdf> {
  const map: ImagesPdf = new Map();
  if (typeof document === "undefined") return map;
  const uniques = Array.from(new Set(urls.filter((u): u is string => !!u && /^https:\/\//i.test(u)))).slice(0, MAX_IMAGES);
  const res = await Promise.all(uniques.map(async u => [u, await chargerUne(u)] as const));
  res.forEach(([u, img]) => { if (img) map.set(u, img); });
  return map;
}
