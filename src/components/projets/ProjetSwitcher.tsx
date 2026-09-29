"use client";
import { useState } from "react";
import { Home, Plus, Pencil, Trash2, X } from "lucide-react";
import { Projet } from "@/types";
import { creerProjet, modifierProjet, supprimerProjet } from "@/lib/projets";
import ConfirmDialog from "@/components/ConfirmDialog";

interface Props {
  clientId: string;
  projets: Projet[];
  projetId: string | null;
  /** Appelé avant de quitter le projet courant (ex. sauvegarde automatique). */
  avantChangement?: () => Promise<void> | void;
  /** Changement de projet (déjà sauvegardé via avantChangement). */
  onSelect: (id: string) => void;
  /** Liste modifiée (création / renommage / suppression) : recharger puis sélectionner nextId
   *  (null = aucun projet restant : la page en recrée un vierge). */
  onChanged: (nextId: string | null) => Promise<void> | void;
  compact?: boolean;
}

export default function ProjetSwitcher({ clientId, projets, projetId, avantChangement, onSelect, onChanged, compact }: Props) {
  const [modal, setModal] = useState<null | { mode: "new" | "edit" }>(null);
  const [nom, setNom] = useState("");
  const [adresse, setAdresse] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const courant = projets.find(p => p.id === projetId) ?? null;

  const ouvrir = (mode: "new" | "edit") => {
    setNom(mode === "edit" ? (courant?.nom ?? "") : "");
    setAdresse(mode === "edit" ? (courant?.adresse ?? "") : "");
    setModal({ mode });
  };

  const changer = async (id: string) => {
    if (id === projetId) return;
    if (avantChangement) await avantChangement();
    onSelect(id);
  };

  const valider = async () => {
    if (!nom.trim()) return;
    setBusy(true);
    try {
      if (modal?.mode === "new") {
        if (avantChangement) await avantChangement();
        const p = await creerProjet(clientId, nom, adresse);
        if (p) await onChanged(p.id);
      } else if (courant) {
        await modifierProjet(courant.id, { nom: nom.trim(), adresse: adresse.trim() || null });
        await onChanged(courant.id);
      }
      setModal(null);
    } finally { setBusy(false); }
  };

  const supprimer = async () => {
    if (!courant) return;
    setBusy(true);
    try {
      const restant = projets.find(p => p.id !== courant.id);
      const ok = await supprimerProjet(clientId, courant.id);
      if (!ok) { alert("La suppression du projet a échoué."); return; }
      await onChanged(restant?.id ?? null);
      setConfirmDel(false);
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="flex items-center gap-1.5 min-w-0">
        <Home size={14} className="text-ink-400 shrink-0" />
        <select
          className={`input !py-1.5 text-sm min-w-0 ${compact ? "max-w-[9rem]" : "max-w-[14rem]"}`}
          value={projetId ?? ""}
          onChange={e => changer(e.target.value)}
          title="Projet (logement / chantier)"
        >
          {projets.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
        </select>
        <button type="button" onClick={() => ouvrir("new")} className="btn-ghost !px-2 !py-1.5" title="Nouveau projet pour ce client"><Plus size={14} /></button>
        <button type="button" onClick={() => ouvrir("edit")} className="btn-ghost !px-2 !py-1.5" title="Renommer le projet"><Pencil size={13} /></button>
        <button type="button" onClick={() => setConfirmDel(true)} className="btn-ghost !px-2 !py-1.5 text-red-500"
          title={projets.length > 1 ? "Supprimer ce projet (logement)" : "Supprimer le plan de ce client (remise à zéro)"}><Trash2 size={13} /></button>
      </div>

      {modal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" onClick={() => !busy && setModal(null)}>
          <div className="card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-ink-900">{modal.mode === "new" ? "Nouveau projet" : "Renommer le projet"}</p>
              <button onClick={() => setModal(null)} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
            </div>
            <p className="text-xs text-ink-400 mb-3">
              {modal.mode === "new"
                ? "Un projet = un logement ou chantier du client, avec son propre plan de circuits, tableau et pré-devis."
                : "Le nom s'affiche dans le sélecteur de projet."}
            </p>
            <label className="text-xs font-medium text-ink-600">Nom</label>
            <input autoFocus className="input mb-3" placeholder="Résidence secondaire, Appartement Bayonne…"
              value={nom} onChange={e => setNom(e.target.value)} onKeyDown={e => e.key === "Enter" && valider()} />
            <label className="text-xs font-medium text-ink-600">Adresse (facultatif)</label>
            <input className="input mb-4" value={adresse} onChange={e => setAdresse(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} disabled={busy} className="btn-ghost">Annuler</button>
              <button onClick={valider} disabled={busy || !nom.trim()} className="btn-volt">{busy ? "…" : modal.mode === "new" ? "Créer" : "Enregistrer"}</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDel}
        title={projets.length > 1 ? "Supprimer ce projet ?" : "Supprimer le plan de ce client ?"}
        message={projets.length > 1
          ? `« ${courant?.nom ?? ""} » sera supprimé avec son plan de circuits, son tableau (annexes comprises) et son brouillon de pré-devis. Les devis déjà créés ne sont pas touchés. Cette action est définitive.`
          : `C'est le seul projet de ce client : le supprimer efface son plan de circuits, son tableau (annexes comprises) et son brouillon de pré-devis, et repart d'un projet vierge. Les devis déjà créés ne sont pas touchés. Cette action est définitive.`}
        onConfirm={supprimer}
        onCancel={() => setConfirmDel(false)}
        loading={busy}
      />
    </>
  );
}
