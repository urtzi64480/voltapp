// Accès sécurisé à localStorage / sessionStorage.
// Sur les pages publiques (clients qui scannent un QR code), certains navigateurs lèvent une
// exception dès qu'on touche au stockage (Safari « bloquer tous les cookies », navigateurs
// intégrés, mode privé strict). Une exception dans un useEffect fait planter toute la page :
// ces helpers l'avalent et dégradent simplement le comportement (pas de mémorisation).

type Zone = "local" | "session";

function zone(z: Zone): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return z === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function lireStockage(z: Zone, cle: string): string | null {
  try { return zone(z)?.getItem(cle) ?? null; } catch { return null; }
}

export function ecrireStockage(z: Zone, cle: string, valeur: string): void {
  try { zone(z)?.setItem(cle, valeur); } catch { /* stockage indisponible : on ignore */ }
}
