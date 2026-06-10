"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Zap, Mail, Lock, Eye, EyeOff, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError("Veuillez remplir tous les champs.");
      return;
    }
    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError("Email ou mot de passe incorrect.");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleLogin();
  }

  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center p-4">
      {/* Fond décoratif */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-volt-500/10 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-volt-500/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-volt-500 flex items-center justify-center mb-4 shadow-lg shadow-volt-500/30">
            <Zap size={28} className="text-ink-900" />
          </div>
          <h1 className="font-display text-3xl text-white">VoltApp</h1>
          <p className="text-ink-400 text-sm mt-1">Gestion pour électriciens</p>
        </div>

        {/* Card */}
        <div className="bg-ink-900 border border-ink-700 rounded-2xl p-6 shadow-2xl">
          <h2 className="font-semibold text-white text-lg mb-5">Connexion</h2>

          {/* Erreur */}
          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-3 py-2.5 mb-4 text-sm">
              <AlertCircle size={15} className="shrink-0" />
              {error}
            </div>
          )}

          {/* Email */}
          <div className="mb-3">
            <label className="block text-ink-400 text-xs font-medium mb-1.5">Email</label>
            <div className="relative">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
              <input
                type="email"
                className="w-full bg-ink-800 border border-ink-600 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-ink-500 focus:outline-none focus:border-volt-500 focus:ring-1 focus:ring-volt-500 transition-colors"
                placeholder="vous@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="email"
              />
            </div>
          </div>

          {/* Mot de passe */}
          <div className="mb-5">
            <label className="block text-ink-400 text-xs font-medium mb-1.5">Mot de passe</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
              <input
                type={showPassword ? "text" : "password"}
                className="w-full bg-ink-800 border border-ink-600 rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder-ink-500 focus:outline-none focus:border-volt-500 focus:ring-1 focus:ring-volt-500 transition-colors"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="current-password"
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

          {/* Bouton */}
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-volt-500 hover:bg-volt-400 disabled:opacity-60 disabled:cursor-not-allowed text-ink-900 font-semibold rounded-xl py-2.5 text-sm transition-colors"
          >
            <Zap size={15} />
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </div>

        <p className="text-center text-ink-600 text-xs mt-6">
          Accès réservé · Données sécurisées RGPD
        </p>
      </div>
    </div>
  );
}
