"use client";
// Lecture / écriture des contrôles d'un devis (checklist, réception, photos, entretien) avec file hors ligne.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lireSuivi, type SuiviStocke } from "./suivi-persistance";
import { appliquerFile, cleSuiviDevis, ecrireControles, estErreurReseau, nbEnAttente, synchroniser } from "./suivi-hors-ligne";
import { appliquerActionControles, controlesVides, copierControles, estVide, type ActionControles, type Controles } from "./checklist-fin-chantier";

export function useControles(devisId: string, suiviBrut: string | null | undefined) {
  const cle = cleSuiviDevis(devisId);
  const initial = useMemo(() => appliquerFile(lireSuivi(suiviBrut), cle), [suiviBrut, cle]);
  const [controles, setControles] = useState<Controles | undefined>(initial.controles);
  const [valideLe, setValideLe] = useState<string | undefined>(initial.chantier.valide_le);
  const [erreur, setErreur] = useState<string | null>(null);
  const [absente, setAbsente] = useState(false);
  const [attente, setAttente] = useState(() => nbEnAttente(cle));
  const pending = useRef(0);
  const file = useRef<Promise<void>>(Promise.resolve());

  const appliquer = useCallback((s: SuiviStocke) => { const r = appliquerFile(s, cle); setControles(r.controles); setValideLe(r.chantier.valide_le); }, [cle]);

  const agir = useCallback((a: ActionControles) => {
    setControles(prev => { const c = copierControles(prev) ?? controlesVides(); appliquerActionControles(c, a); return estVide(c) ? undefined : c; });
    pending.current += 1;
    file.current = file.current.then(async () => {
      const res = await ecrireControles(cle, a);
      pending.current -= 1;
      if (res.ok && "enAttente" in res) { setErreur(null); setAttente(res.nbEnAttente); }
      else if (res.ok) { setErreur(null); setAttente(nbEnAttente(cle)); if (pending.current === 0) appliquer(res.suivi); }
      else if (res.colonneAbsente) setAbsente(true);
      else setErreur(`Enregistrement impossible : ${res.message}`);
    });
  }, [cle, appliquer]);

  useEffect(() => {
    const envoyer = async () => {
      if (pending.current > 0 || nbEnAttente(cle) === 0) return;
      const res = await synchroniser(cle);
      if (res?.ok && pending.current === 0) appliquer(res.suivi);
      else if (res && !res.ok && !estErreurReseau(res.message)) setErreur(res.message);
      setAttente(nbEnAttente(cle));
    };
    void envoyer();
    window.addEventListener("online", envoyer);
    return () => window.removeEventListener("online", envoyer);
  }, [cle, appliquer]);

  return { controles, valideLe, agir, erreur, absente, attente, setAbsente };
}
