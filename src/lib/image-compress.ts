// Réduit une photo (appareil photo du téléphone, souvent > 5 Mo) en JPEG léger avant envoi. Navigateur uniquement.
export async function compresserPhoto(fichier: File, cote = 1280, qualite = 0.75): Promise<Blob> {
  const bitmap = await createImageBitmap(fichier);
  const e = Math.min(1, cote / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * e)); canvas.height = Math.max(1, Math.round(bitmap.height * e));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return await new Promise<Blob>((ok, ko) => canvas.toBlob(b => (b ? ok(b) : ko(new Error("Photo illisible"))), "image/jpeg", qualite));
}
