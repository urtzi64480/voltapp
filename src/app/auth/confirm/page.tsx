"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Zap, Lock, Eye, EyeOff, AlertCircle, CheckCircle } from "lucide-react";

export default function ConfirmPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSetPassword() {
    if (!password.trim() || !confirm.trim()) {
      setError("Veuillez remplir tous les champs.");
      return;
    }
    if (password !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    if (password.length < 8) {
      setError("Le mot de passe doit faire au moins 8 caractères.");
      return;
    }
    setLoading(true);
    setError("");

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError("Erreur lors de la définition du mot de passe.");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-volt-500/10 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-volt-500/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-volt-500 flex items-center justify-center mb-4 shadow-lg shadow-volt-500/30">
            <Zap size={28} className="text-ink-900" />
          </div>
          <h1 className="font-display text-3xl text-white">VoltApp</h1>
          <p className="text-ink-400 text-sm mt-1">Bienvenue ! Créez votre mot de passe</p>
        </div>

        <div className="bg-ink-900 border border-ink-700 rounded-2xl p-6 shadow-2xl">
          <h2 className="font-semibold text-white text-lg mb-1">Définir mon mot de passe</h2>
          <p className="text-ink-400 text-xs mb-5">Choisissez un mot de passe sécurisé pour accéder à votre espace.</p>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-3 py-2.5 mb-4 text-sm">
              <AlertCircle size={15} className="shrink-0" />
              {error}
            </div>
          )}

          {!ready && (
            <div className="text-center text-ink-400 text-sm mb-4">
              Vérification du lien en cours…
            </div>
          )}

          <div className="mb-3">
            <label className="block text-ink-400 text-xs font-medium mb-1.5">Mot de passe</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
              <input
                type={showPassword ? "text" : "password"}
                className="w-full bg-ink-800 border border-ink-600 rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder-ink-500 focus:outline-none focus:border-volt-500 focus:ring-1 focus:ring-volt-500 transition-colors"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-300 transition-colors"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div className="mb-5">
            <label className="block text-ink-400 text-xs font-medium mb-1.5">Confirmer le mot de passe</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
              <input
                type={showPassword ? "text" : "password"}
                className="w-full bg-ink-800 border border-ink-600 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-ink-500 focus:outline-none focus:border-volt-500 focus:ring-1 focus:ring-volt-500 transition-colors"
                placeholder="••••••••"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
              />
            </div>
          </div>

          <button
            onClick={handleSetPassword}
            disabled={loading || !ready}
            className="w-full flex items-center justify-center gap-2 bg-volt-500 hover:bg-volt-400 disabled:opacity-60 disabled:cursor-not-allowed text-ink-900 font-semibold rounded-xl py-2.5 text-sm transition-colors"
          >
            <CheckCircle size={15} />
            {loading ? "Enregistrement…" : "Accéder à VoltApp"}
          </button>
        </div>

        <p className="text-center text-ink-600 text-xs mt-6">
          Accès réservé · Données sécurisées RGPD
        </p>
      </div>
    </div>
  );
}