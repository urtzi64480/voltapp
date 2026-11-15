"use client";
import { useEffect, useState } from "react";
import { CheckCircle, AlertCircle, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { verifierNouveauMotDePasse } from "@/lib/mot-de-passe";

/** Changement de mot de passe depuis l'application, sans lien e-mail : l'ancien mot de passe est revérifié, puis le nouveau est enregistré
 *  sur le compte connecté. Chaque électricien change le sien (le compte et ses données restent séparés). */
export default function ChangerMotDePasse() {
  const [actuel, setActuel] = useState("");
  const [nouveau, setNouveau] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState("");
  const [ok, setOk] = useState(false);
  const [emailCompte, setEmailCompte] = useState("");
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setEmailCompte(session?.user.email ?? "")).catch(() => {});
  }, []);

  async function changer() {
    setOk(false);
    const invalide = verifierNouveauMotDePasse(actuel, nouveau, confirmation);
    if (invalide) { setErreur(invalide); return; }
    setOccupe(true); setErreur("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user.email;
      if (!email) { setErreur("Session expirée : reconnectez-vous puis réessayez."); return; }
      // Revérifie l'ancien mot de passe (appareil resté ouvert) ; la session reste celle du même utilisateur.
      const { error: errActuel } = await supabase.auth.signInWithPassword({ email, password: actuel });
      if (errActuel) { setErreur("Mot de passe actuel incorrect."); return; }
      const { error } = await supabase.auth.updateUser({ password: nouveau });
      if (error) {
        setErreur(/different/i.test(error.message) ? "Le nouveau mot de passe doit être différent de l'actuel." : `Changement impossible : ${error.message}`);
        return;
      }
      setActuel(""); setNouveau(""); setConfirmation(""); setOk(true);
    } catch {
      setErreur("Changement impossible (connexion). Réessayez.");
    } finally {
      setOccupe(false);
    }
  }

  return (
    <div className="card card-inner">
      <h2 className="font-semibold text-ink-800 mb-1 flex items-center gap-2"><Lock size={16} /> Changer mon mot de passe</h2>
      <p className="text-xs text-ink-400 mb-4">Il s'applique à votre compte uniquement. Minimum 8 caractères.</p>
      {/* Pas d'autoremplissage : un navigateur qui a enregistré les identifiants d'un autre compte (ou de celui-ci) écrivait l'e-mail dans le champ
          précédent de la page (ex. « Couverture géographique ») et préremplissait le mot de passe, qui serait ensuite enregistré avec le profil. */}
      <form className="grid grid-cols-1 gap-3 max-w-sm" autoComplete="off" onSubmit={e => { e.preventDefault(); changer(); }}>
        <input type="text" name="identifiant-compte" autoComplete="username" value={emailCompte} readOnly tabIndex={-1} aria-hidden="true"
          className="sr-only" data-lpignore="true" data-1p-ignore="true" />
        <div>
          <label className="label">Mot de passe actuel</label>
          <input className="input" type="password" name="mdp-actuel" autoComplete="new-password" data-lpignore="true" data-1p-ignore="true"
            value={actuel} onChange={e => setActuel(e.target.value)} />
        </div>
        <div>
          <label className="label">Nouveau mot de passe</label>
          <input className="input" type="password" name="mdp-nouveau" autoComplete="new-password" data-lpignore="true" data-1p-ignore="true"
            value={nouveau} onChange={e => setNouveau(e.target.value)} />
        </div>
        <div>
          <label className="label">Confirmer le nouveau mot de passe</label>
          <input className="input" type="password" name="mdp-confirmation" autoComplete="new-password" data-lpignore="true" data-1p-ignore="true"
            value={confirmation} onChange={e => setConfirmation(e.target.value)} />
        </div>
        {erreur && <p className="text-xs text-red-500 flex items-center gap-1.5"><AlertCircle size={13} /> {erreur}</p>}
        {ok && <p className="text-xs text-green-600 flex items-center gap-1.5"><CheckCircle size={13} /> Mot de passe modifié.</p>}
        <button type="submit" disabled={occupe} className="btn-volt justify-center text-sm w-fit">
          {occupe ? "Modification…" : "Changer le mot de passe"}
        </button>
      </form>
    </div>
  );
}
