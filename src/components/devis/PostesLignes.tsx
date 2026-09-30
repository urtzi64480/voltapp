"use client";
import { useEffect, useState } from "react";
import { Plus, X, Trash2, Layers } from "lucide-react";
import { fmt, cn } from "@/lib/utils";
import { grouperParPoste, memeNomPoste, nettoyerNomPoste, posteDe, totalItems } from "@/lib/postes";
import type { DevisLigne } from "@/types";

type SetLignes = (fn: (prev: any[]) => any[]) => void;
type SetPostes = (fn: (prev: string[]) => string[]) => void;

interface Props {
  lignes: DevisLigne[];
  setLignes: SetLignes;
  postes: string[];
  setPostes: SetPostes;
  posteActif: string | null;
  setPosteActif: (p: string | null) => void;
  showUnite?: boolean;
  texteVide?: string;
}

// Titre de poste éditable : la modification est validée à la sortie du champ / Entrée.
function PosteTitre({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [val, setVal] = useState(value);
  useEffect(() => { setVal(value); }, [value]);
  return (
    <input
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={() => onCommit(val)}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="flex-1 min-w-0 font-semibold text-sm text-ink-900 bg-transparent border-b border-transparent focus:border-ink-300 outline-none"
    />
  );
}

function LigneRow({ l, i, setLignes, showUnite, postes }: {
  l: DevisLigne; i: number; setLignes: SetLignes; showUnite?: boolean; postes: string[];
}) {
  return (
    <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-white border border-ink-100">
      <div className="flex items-start gap-2">
        {l.kit_ratio_service != null ? (
          <span className="inline-flex items-center gap-1 badge text-xs shrink-0 bg-purple-100 text-purple-700">
            <Layers size={10} /> KIT
          </span>
        ) : (
          <span className={cn("badge text-xs shrink-0", l.type_branche === "service" ? "bg-volt-100 text-volt-700" : "bg-emerald-100 text-emerald-700")}>
            {l.type_branche === "service" ? "S" : "M"}
          </span>
        )}
        <span className="text-xs text-ink-800 flex-1 min-w-0 break-words">{l.nom}</span>
        <button onClick={() => setLignes(p => p.filter((_, idx) => idx !== i))}
          className="text-ink-300 hover:text-red-500 transition-colors shrink-0"><X size={14} /></button>
      </div>
      <div className="flex items-center gap-2 pl-7">
        {showUnite && <span className="text-xs text-ink-400 shrink-0">{l.unite}</span>}
        <input type="number" min="1" step="0.5" value={l.quantite}
          onChange={e => setLignes(prev => prev.map((x, idx) => idx === i ? { ...x, quantite: parseFloat(e.target.value) || 1 } : x))}
          className="w-14 shrink-0 text-center text-xs border border-ink-200 rounded-lg py-1 bg-white" />
        <span className="text-xs text-ink-400 shrink-0">×</span>
        <input type="number" min="0" step="0.5" value={l.prix_unitaire}
          onChange={e => setLignes(prev => prev.map((x, idx) => idx === i ? { ...x, prix_unitaire: parseFloat(e.target.value) || 0 } : x))}
          className="w-16 shrink-0 text-right text-xs border border-ink-200 rounded-lg py-1 bg-white" />
        <span className="text-xs font-semibold text-ink-900 ml-auto shrink-0">{fmt(l.prix_unitaire * l.quantite)}</span>
      </div>
      {postes.length > 0 && (
        <div className="flex items-center gap-2 pl-7">
          <span className="text-xs text-ink-400 shrink-0">Poste</span>
          <select
            value={posteDe(l) ?? ""}
            onChange={e => {
              const cible = e.target.value === "" ? null : e.target.value;
              setLignes(prev => prev.map((x, idx) => idx === i ? { ...x, poste: cible } : x));
            }}
            className="flex-1 min-w-0 text-xs border border-ink-200 rounded-lg py-1 px-1.5 bg-white">
            <option value="">Hors poste</option>
            {postes.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      )}
      {l.kit_description && (
        <p className="text-xs text-ink-400 italic pl-7 truncate">{l.kit_description}</p>
      )}
      {l.kit_ratio_service != null && (
        <p className="text-xs text-purple-400 pl-7">
          Ventilation : {fmt(l.prix_unitaire * l.quantite * l.kit_ratio_service)} service · {fmt(l.prix_unitaire * l.quantite * (1 - l.kit_ratio_service))} matériaux
        </p>
      )}
    </div>
  );
}

export default function PostesLignes({
  lignes, setLignes, postes, setPostes, posteActif, setPosteActif, showUnite, texteVide,
}: Props) {
  const [nouveau, setNouveau] = useState("");
  const [erreur, setErreur] = useState("");

  function ajouterPoste() {
    const nom = nettoyerNomPoste(nouveau);
    if (!nom) return;
    if (postes.some(p => memeNomPoste(p, nom))) { setErreur("Ce poste existe déjà."); return; }
    setPostes(prev => [...prev, nom]);
    setPosteActif(nom);
    setNouveau("");
    setErreur("");
  }

  function supprimerPoste(nom: string) {
    setLignes(prev => prev.filter(l => posteDe(l) !== nom));
    setPostes(prev => prev.filter(p => p !== nom));
    if (posteActif === nom) setPosteActif(null);
  }

  function renommerPoste(ancien: string, saisie: string) {
    const nom = nettoyerNomPoste(saisie);
    if (!nom || nom === ancien) return;
    if (postes.some(p => p !== ancien && memeNomPoste(p, nom))) return;
    setPostes(prev => prev.map(p => (p === ancien ? nom : p)));
    setLignes(prev => prev.map(l => (posteDe(l) === ancien ? { ...l, poste: nom } : l)));
    if (posteActif === ancien) setPosteActif(nom);
  }

  const avecPostes = postes.length > 0;
  const blocs = grouperParPoste(lignes, { postes, inclureVides: true });
  const horsPoste = blocs.find(b => b.poste === null)?.items ?? [];

  return (
    <div className="space-y-3">
      <div className="p-2.5 rounded-xl bg-ink-50 border border-ink-100 space-y-1.5">
        <div className="flex gap-2">
          <input
            className="input text-sm flex-1 min-w-0"
            placeholder="Nom du poste (ex : Pose d'une prise)"
            value={nouveau}
            onChange={e => { setNouveau(e.target.value); setErreur(""); }}
            onKeyDown={e => { if (e.key === "Enter") ajouterPoste(); }}
          />
          <button onClick={ajouterPoste} className="btn-volt !px-3 text-sm shrink-0">
            <Plus size={14} /> Poste
          </button>
        </div>
        {erreur && <p className="text-xs text-red-500">{erreur}</p>}
        <p className="text-xs text-ink-400">
          {avecPostes
            ? "Les articles ajoutés depuis le catalogue vont dans le poste actif."
            : "Crée un poste pour regrouper matériel et main d'œuvre, et le supprimer d'un coup."}
        </p>
      </div>

      {lignes.length === 0 && !avecPostes && (
        <p className="text-sm text-ink-400 text-center py-8">{texteVide ?? "Ajoutez des prestations depuis le catalogue"}</p>
      )}

      {!avecPostes && lignes.length > 0 && (
        <div className="space-y-2">
          {lignes.map((l, i) => (
            <LigneRow key={i} l={l} i={i} setLignes={setLignes} showUnite={showUnite} postes={postes} />
          ))}
        </div>
      )}

      {avecPostes && (
        <div className="space-y-3">
          {blocs.filter(b => b.poste !== null).map(b => {
            const nom = b.poste as string;
            const actif = posteActif === nom;
            return (
              <div key={nom} className={cn("rounded-xl border-2 p-2 space-y-2", actif ? "border-volt-400 bg-volt-50/40" : "border-ink-100 bg-ink-50/50")}>
                <div className="flex items-center gap-2">
                  <PosteTitre value={nom} onCommit={v => renommerPoste(nom, v)} />
                  <span className="text-xs font-semibold text-ink-900 shrink-0">{fmt(totalItems(b.items))}</span>
                  <button onClick={() => supprimerPoste(nom)} title="Supprimer le poste et toutes ses lignes"
                    className="text-ink-300 hover:text-red-500 transition-colors shrink-0"><Trash2 size={14} /></button>
                </div>
                <button onClick={() => setPosteActif(nom)}
                  className={cn("w-full text-xs font-medium rounded-lg py-1.5 transition-colors",
                    actif ? "bg-ink-900 text-volt-400" : "bg-white border border-ink-200 text-ink-500 hover:bg-ink-50")}>
                  {actif ? "✓ Poste actif — le catalogue ajoute ici" : "Ajouter dans ce poste"}
                </button>
                {b.items.length === 0 && (
                  <p className="text-xs text-ink-400 italic text-center py-1">Poste vide — ajoutez des articles depuis le catalogue</p>
                )}
                {b.items.map(({ l, i }) => (
                  <LigneRow key={i} l={l} i={i} setLignes={setLignes} showUnite={showUnite} postes={postes} />
                ))}
              </div>
            );
          })}

          <div className={cn("rounded-xl border-2 p-2 space-y-2", posteActif === null ? "border-volt-400 bg-volt-50/40" : "border-ink-100 bg-ink-50/50")}>
            <div className="flex items-center gap-2">
              <span className="flex-1 font-semibold text-sm text-ink-600">Hors poste</span>
              {horsPoste.length > 0 && (
                <span className="text-xs font-semibold text-ink-900 shrink-0">{fmt(totalItems(horsPoste))}</span>
              )}
            </div>
            <button onClick={() => setPosteActif(null)}
              className={cn("w-full text-xs font-medium rounded-lg py-1.5 transition-colors",
                posteActif === null ? "bg-ink-900 text-volt-400" : "bg-white border border-ink-200 text-ink-500 hover:bg-ink-50")}>
              {posteActif === null ? "✓ Actif — le catalogue ajoute ici" : "Ajouter hors poste"}
            </button>
            {horsPoste.map(({ l, i }) => (
              <LigneRow key={i} l={l} i={i} setLignes={setLignes} showUnite={showUnite} postes={postes} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
