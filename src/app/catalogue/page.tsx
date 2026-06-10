"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Prestation } from "@/types";
import { fmt, UNITES, cn } from "@/lib/utils";
import Shell from "@/components/layout/Shell";
import { Plus, Trash2, Save, Pencil, X, ChevronDown, ChevronUp, Link, Wrench, Package } from "lucide-react";

function getFavicon(url: string) {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  } catch { return null; }
}

function getLinkLabel(url: string) {
  try { return new URL(url).hostname.replace("www.", ""); }
  catch { return url; }
}

function FournisseurLogo({ url }: { url: string }) {
  const favicon = getFavicon(url);
  const label = getLinkLabel(url);
  if (!favicon) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      title={`Vérifier le prix sur ${label}`}
      className="flex items-center justify-center w-8 h-8 rounded-lg border border-ink-100 bg-white hover:border-volt-400 hover:shadow-sm transition-all overflow-hidden shrink-0">
      <img src={favicon} alt={label} className="w-5 h-5 object-contain" />
    </a>
  );
}

function ProduitThumb({ imageUrl }: { imageUrl: string | null }) {
  if (!imageUrl) return (
    <div className="w-10 h-10 rounded-lg bg-ink-50 border border-ink-100 flex items-center justify-center shrink-0">
      <Package size={14} className="text-ink-300" />
    </div>
  );
  return (
    <div className="w-10 h-10 rounded-lg border border-ink-100 overflow-hidden shrink-0 bg-white">
      <img src={imageUrl} alt="" className="w-full h-full object-contain p-0.5"
        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
    </div>
  );
}

function LiensFournisseurs({ liens, setLiens }: { liens: string[]; setLiens: (l: string[]) => void }) {
  const [newLien, setNewLien] = useState("");
  function addLien() {
    if (!newLien.trim()) return;
    let url = newLien.trim();
    if (!url.startsWith("http")) url = "https://" + url;
    setLiens([...liens, url]);
    setNewLien("");
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {liens.map((url, i) => {
          const favicon = getFavicon(url);
          const label = getLinkLabel(url);
          return (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-ink-50 border border-ink-200 rounded-lg">
              {favicon && <img src={favicon} alt={label} className="w-4 h-4 object-contain" />}
              <span className="text-xs text-ink-600">{label}</span>
              <button onClick={() => setLiens(liens.filter((_, idx) => idx !== i))}
                className="text-ink-300 hover:text-red-500 transition-colors ml-1">
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input className="input text-sm flex-1" placeholder="https://www.leroymerlin.fr/…"
          value={newLien} onChange={e => setNewLien(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addLien()} />
        <button onClick={addLien} className="btn-ghost !px-3 text-xs shrink-0">
          <Plus size={13} /> Ajouter
        </button>
      </div>
    </div>
  );
}

function FormMarque({ value, onChange, marques }: { value: string; onChange: (v: string) => void; marques: string[] }) {
  const [mode, setMode] = useState<"select" | "new">(marques.length === 0 ? "new" : "select");
  return (
    <div>
      {mode === "select" ? (
        <div className="flex gap-2">
          <select className="input flex-1" value={value} onChange={e => onChange(e.target.value)}>
            <option value="">— Choisir —</option>
            {marques.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={() => { setMode("new"); onChange(""); }} className="btn-ghost !px-3 text-xs shrink-0">Nouvelle</button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Ex : Schneider, Legrand…"
            value={value} onChange={e => onChange(e.target.value)} autoFocus />
          {marques.length > 0 && (
            <button onClick={() => setMode("select")} className="btn-ghost !px-3 text-xs shrink-0">Existante</button>
          )}
        </div>
      )}
    </div>
  );
}

function CategorieBlock({
  cat, items, branche, editId, editData, editNewCat, editCatMode, editLiens,
  categories, marques, collapsed, toggleCollapse, delCategorie, startEdit, saveEdit, del,
  setEditId, setEditData, setEditNewCat, setEditCatMode, setEditLiens,
}: any) {
  const isOpen = !collapsed;
  const [collapsedMarques, setCollapsedMarques] = useState<Record<string, boolean>>({});

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-ink-900">
        <button onClick={toggleCollapse} className="flex items-center gap-3 flex-1 text-left">
          <span className="font-semibold text-white text-sm">{cat}</span>
          <span className="text-ink-400 text-xs">{items.length} prestation{items.length > 1 ? "s" : ""}</span>
        </button>
        <div className="flex items-center gap-2">
          {items.length === 0 && (
            <button onClick={() => delCategorie(cat)}
              className="p-1.5 rounded-lg text-ink-400 hover:text-red-400 hover:bg-white/10 transition-colors">
              <Trash2 size={14} />
            </button>
          )}
          {isOpen ? <ChevronUp size={16} className="text-ink-400" /> : <ChevronDown size={16} className="text-ink-400" />}
        </div>
      </div>

      {isOpen && (
        <div className="divide-y divide-ink-100">
          <div className={cn("hidden md:grid gap-4 px-5 py-2 text-xs font-semibold text-ink-400 uppercase tracking-wide bg-ink-50",
            branche === "materiau" ? "grid-cols-[40px_2fr_90px_90px_minmax(80px,auto)_80px]" : "grid-cols-[2fr_90px_90px_80px]")}>
            {branche === "materiau" && <span></span>}
            <span>Nom</span><span>Unité</span><span className="text-right">Prix</span>
            {branche === "materiau" && <span>Liens</span>}
            <span></span>
          </div>

          {items.length === 0 && (
            <div className="px-5 py-4 text-sm text-ink-400 italic">Aucune prestation — catégorie vide.</div>
          )}

          {branche === "materiau" && (() => {
            const mqs = [...new Set(items.map((p: any) => p.marque || "__sans__"))].sort() as string[];
            return mqs.map((mq: string) => {
              const itemsMq = items.filter((p: any) => (p.marque || "__sans__") === mq);
              return (
                <div key={mq}>
                  {mq !== "__sans__" && (
                    <button
                      onClick={() => setCollapsedMarques(c => ({ ...c, [mq]: !c[mq] }))}
                      className="w-full px-5 py-1.5 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2 hover:bg-emerald-100 transition-colors text-left">
                      <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide flex-1">{mq}</span>
                      <span className="text-xs text-emerald-400">{itemsMq.length} article{itemsMq.length > 1 ? "s" : ""}</span>
                      {collapsedMarques[mq] ? <ChevronDown size={13} className="text-emerald-500" /> : <ChevronUp size={13} className="text-emerald-500" />}
                    </button>
                  )}
                  {(mq === "__sans__" || !collapsedMarques[mq]) && itemsMq.map((p: any) => {
                    const liens: string[] = p.liens_fournisseurs ?? [];
                    const marque: string = p.marque ?? "";
                    const sousCat: string = p.sous_categorie ?? "";
                    return (
                      <div key={p.id} className="px-4 py-3">
                        {editId === p.id ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="label">Nom</label>
                                <input className="input text-sm" value={(editData as any).nom ?? p.nom}
                                  onChange={e => setEditData((d: any) => ({ ...d, nom: e.target.value }))} />
                              </div>
                              <div>
                                <label className="label">Description</label>
                                <input className="input text-sm" value={(editData as any).description ?? p.description ?? ""}
                                  onChange={e => setEditData((d: any) => ({ ...d, description: e.target.value }))} />
                              </div>
                              {((editData as any).type_branche ?? p.type_branche) === "materiau" && (
                                <div>
                                  <label className="label">Marque</label>
                                  <FormMarque
                                    value={(editData as any).marque ?? marque}
                                    onChange={v => setEditData((d: any) => ({ ...d, marque: v }))}
                                    marques={marques}
                                  />
                                </div>
                              )}
                              <div>
                                <label className="label">Prix unitaire (€)</label>
                                <input className="input text-sm text-right" type="number" step="0.5"
                                  value={(editData as any).prix_unitaire ?? p.prix_unitaire}
                                  onChange={e => setEditData((d: any) => ({ ...d, prix_unitaire: parseFloat(e.target.value) }))} />
                              </div>
                              <div>
                                <label className="label">Branche</label>
                                <select className="input text-sm" value={(editData as any).type_branche ?? p.type_branche}
                                  onChange={e => setEditData((d: any) => ({ ...d, type_branche: e.target.value }))}>
                                  <option value="service">Service</option>
                                  <option value="materiau">Matériau</option>
                                </select>
                              </div>
                              <div>
                                <label className="label">Unité</label>
                                <select className="input text-sm" value={(editData as any).unite ?? p.unite}
                                  onChange={e => setEditData((d: any) => ({ ...d, unite: e.target.value }))}>
                                  {UNITES.map((u: string) => <option key={u}>{u}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="label">Catégorie</label>
                                {editCatMode === "select" ? (
                                  <div className="flex gap-2">
                                    <select className="input text-sm flex-1" value={(editData as any).categorie ?? p.categorie}
                                      onChange={e => setEditData((d: any) => ({ ...d, categorie: e.target.value }))}>
                                      {categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <button onClick={() => setEditCatMode("new")} className="btn-ghost !px-3 text-xs shrink-0">Nouvelle</button>
                                  </div>
                                ) : (
                                  <div className="flex gap-2">
                                    <input className="input text-sm flex-1" placeholder="Nouvelle catégorie"
                                      value={editNewCat} onChange={e => setEditNewCat(e.target.value)} autoFocus />
                                    <button onClick={() => setEditCatMode("select")} className="btn-ghost !px-3 text-xs shrink-0">Existante</button>
                                  </div>
                                )}
                              </div>
                              <div>
                                <label className="label">Sous-catégorie</label>
                                <input className="input text-sm" placeholder="Ex : Prises, Câblage…"
                                  value={(editData as any).sous_categorie ?? sousCat}
                                  onChange={e => setEditData((d: any) => ({ ...d, sous_categorie: e.target.value }))} />
                              </div>
                            </div>
                            {((editData as any).type_branche ?? p.type_branche) === "materiau" && (
                              <div className="space-y-3">
                                <div>
                                  <label className="label">Liens fournisseurs</label>
                                  <LiensFournisseurs liens={editLiens} setLiens={setEditLiens} />
                                </div>
                                <div>
                                  <label className="label">Image du produit (URL)</label>
                                  <input className="input text-sm" placeholder="https://…/image-produit.jpg"
                                    value={(editData as any).image_url ?? p.image_url ?? ""}
                                    onChange={e => setEditData((d: any) => ({ ...d, image_url: e.target.value }))} />
                                  {((editData as any).image_url ?? p.image_url) && (
                                    <img src={(editData as any).image_url ?? p.image_url} alt=""
                                      className="mt-2 h-16 object-contain rounded-lg border border-ink-100 p-1 bg-white" />
                                  )}
                                </div>
                              </div>
                            )}
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => saveEdit(p.id)} className="btn-volt text-xs"><Save size={13} /> Sauvegarder</button>
                              <button onClick={() => setEditId(null)} className="btn-ghost text-xs"><X size={13} /> Annuler</button>
                            </div>
                          </div>
                        ) : (
                          <div className={cn("flex items-center gap-3",
                            "md:grid md:grid-cols-[40px_2fr_90px_90px_minmax(80px,auto)_80px]")}>
                            {/* Miniature desktop */}
                            <div className="hidden md:block">
                              <ProduitThumb imageUrl={p.image_url ?? null} />
                            </div>
                            <div className="flex-1 min-w-0">
                              {/* Mobile : miniature + nom */}
                              <div className="flex items-center gap-2 md:block">
                                <div className="md:hidden shrink-0">
                                  <ProduitThumb imageUrl={p.image_url ?? null} />
                                </div>
                                <div className="min-w-0">
                                  <p className="font-medium text-ink-900 text-sm truncate">{p.nom}</p>
                                  <p className="text-xs text-ink-400 truncate">
                                    {[marque, sousCat, p.description].filter(Boolean).join(" · ")}
                                  </p>
                                </div>
                              </div>
                              {/* Liens fournisseurs visibles sur mobile */}
                              {liens.length > 0 && (
                                <div className="flex items-center gap-1.5 flex-wrap mt-1.5 md:hidden">
                                  {liens.map((url: string, i: number) => <FournisseurLogo key={i} url={url} />)}
                                </div>
                              )}
                            </div>
                            <span className="text-xs text-ink-500 hidden md:block">{p.unite}</span>
                            <span className="font-semibold text-ink-900 text-sm ml-auto md:ml-0 md:text-right">{fmt(p.prix_unitaire)}</span>
                            {/* Liens desktop */}
                            <div className="hidden md:flex items-center gap-1.5 flex-wrap">
                              {liens.length > 0
                                ? liens.map((url: string, i: number) => <FournisseurLogo key={i} url={url} />)
                                : <span className="text-ink-200"><Link size={14} /></span>}
                            </div>
                            <div className="flex gap-1 shrink-0 justify-end">
                              <button onClick={() => startEdit(p)}
                                className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700"><Pencil size={13} /></button>
                              <button onClick={() => del(p.id)}
                                className="p-1.5 rounded-lg text-ink-300 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}

          {branche === "service" && items.map((p: any) => {
            const sousCat: string = p.sous_categorie ?? "";
            return (
              <div key={p.id} className="px-4 py-3">
                {editId === p.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="label">Nom</label>
                        <input className="input text-sm" value={(editData as any).nom ?? p.nom}
                          onChange={e => setEditData((d: any) => ({ ...d, nom: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Description</label>
                        <input className="input text-sm" value={(editData as any).description ?? p.description ?? ""}
                          onChange={e => setEditData((d: any) => ({ ...d, description: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Prix unitaire (€)</label>
                        <input className="input text-sm text-right" type="number" step="0.5"
                          value={(editData as any).prix_unitaire ?? p.prix_unitaire}
                          onChange={e => setEditData((d: any) => ({ ...d, prix_unitaire: parseFloat(e.target.value) }))} />
                      </div>
                      <div>
                        <label className="label">Branche</label>
                        <select className="input text-sm" value={(editData as any).type_branche ?? p.type_branche}
                          onChange={e => setEditData((d: any) => ({ ...d, type_branche: e.target.value }))}>
                          <option value="service">Service</option>
                          <option value="materiau">Matériau</option>
                        </select>
                      </div>
                      <div>
                        <label className="label">Unité</label>
                        <select className="input text-sm" value={(editData as any).unite ?? p.unite}
                          onChange={e => setEditData((d: any) => ({ ...d, unite: e.target.value }))}>
                          {UNITES.map((u: string) => <option key={u}>{u}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">Catégorie</label>
                        {editCatMode === "select" ? (
                          <div className="flex gap-2">
                            <select className="input text-sm flex-1" value={(editData as any).categorie ?? p.categorie}
                              onChange={e => setEditData((d: any) => ({ ...d, categorie: e.target.value }))}>
                              {categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <button onClick={() => setEditCatMode("new")} className="btn-ghost !px-3 text-xs shrink-0">Nouvelle</button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <input className="input text-sm flex-1" placeholder="Nouvelle catégorie"
                              value={editNewCat} onChange={e => setEditNewCat(e.target.value)} autoFocus />
                            <button onClick={() => setEditCatMode("select")} className="btn-ghost !px-3 text-xs shrink-0">Existante</button>
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="label">Sous-catégorie</label>
                        <input className="input text-sm" placeholder="Ex : Prises, Câblage…"
                          value={(editData as any).sous_categorie ?? sousCat}
                          onChange={e => setEditData((d: any) => ({ ...d, sous_categorie: e.target.value }))} />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => saveEdit(p.id)} className="btn-volt text-xs"><Save size={13} /> Sauvegarder</button>
                      <button onClick={() => setEditId(null)} className="btn-ghost text-xs"><X size={13} /> Annuler</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 md:grid md:grid-cols-[2fr_90px_90px_80px]">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink-900 text-sm truncate">{p.nom}</p>
                      <p className="text-xs text-ink-400 truncate">{[sousCat, p.description].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className="text-xs text-ink-500 hidden md:block">{p.unite}</span>
                    <span className="font-semibold text-ink-900 text-sm ml-auto md:ml-0 md:text-right">{fmt(p.prix_unitaire)}</span>
                    <div className="flex gap-1 shrink-0 justify-end">
                      <button onClick={() => startEdit(p)}
                        className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700"><Pencil size={13} /></button>
                      <button onClick={() => del(p.id)}
                        className="p-1.5 rounded-lg text-ink-300 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CataloguePage() {
  const [prestations, setPrestations] = useState<Prestation[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Prestation>>({});
  const [editNewCat, setEditNewCat] = useState("");
  const [editCatMode, setEditCatMode] = useState<"select" | "new">("select");
  const [editLiens, setEditLiens] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [formLiens, setFormLiens] = useState<string[]>([]);
  const [form, setForm] = useState({
    nom: "", description: "", prix_unitaire: "",
    unite: "forfait", type_branche: "service", categorie: "",
    sous_categorie: "", marque: "", image_url: "",
  });
  const [collapsedServices, setCollapsedServices] = useState<Record<string, boolean>>({});
  const [collapsedMateriaux, setCollapsedMateriaux] = useState<Record<string, boolean>>({});
  const [marques, setMarques] = useState<string[]>([]);

  async function load() {
    const { data } = await supabase.from("prestations").select("*").eq("actif", true).order("categorie").order("nom");
    const prests = data ?? [];
    setPrestations(prests);
    const cats = [...new Set(prests.map(p => p.categorie))].sort();
    setCategories(cats);
    const initCollapsed = cats.reduce((acc, c) => ({ ...acc, [c]: true }), {} as Record<string, boolean>);
    setCollapsedServices(initCollapsed);
    setCollapsedMateriaux(initCollapsed);
    const mqs = [...new Set(prests.map((p: any) => p.marque).filter(Boolean))].sort() as string[];
    setMarques(mqs);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.nom.trim() || !form.prix_unitaire) return;
    const cat = newCat.trim() || form.categorie || "Divers";
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("prestations").insert({
      user_id: user.id,
      nom: form.nom, description: form.description,
      prix_unitaire: parseFloat(form.prix_unitaire),
      unite: form.unite, type_branche: form.type_branche,
      categorie: cat, actif: true,
      sous_categorie: form.sous_categorie || null,
      marque: form.marque || null,
      liens_fournisseurs: formLiens.filter(l => l.trim()),
      image_url: form.image_url || null,
    }).select().single();
    if (data) {
      setPrestations(p => [...p, data].sort((a, b) => a.categorie.localeCompare(b.categorie) || a.nom.localeCompare(b.nom)));
      if (!categories.includes(cat)) setCategories(c => [...c, cat].sort());
    }
    setForm({ nom: "", description: "", prix_unitaire: "", unite: "forfait", type_branche: "service", categorie: "", sous_categorie: "", marque: "", image_url: "" });
    if (form.marque && !marques.includes(form.marque)) setMarques(m => [...m, form.marque].sort());
    setNewCat(""); setFormLiens([]); setShowForm(false);
  }

  async function del(id: string) {
    if (!confirm("Supprimer cette prestation ?")) return;
    await supabase.from("prestations").update({ actif: false }).eq("id", id);
    setPrestations(p => p.filter(x => x.id !== id));
  }

  async function delCategorie(cat: string) {
    if (!confirm(`Supprimer la catégorie "${cat}" ?`)) return;
    setCategories(c => c.filter(x => x !== cat));
  }

  async function saveEdit(id: string) {
    const finalCat = (editCatMode === "new" && editNewCat.trim() ? editNewCat.trim() : editData.categorie) ?? "Divers";
    const dataToSave = { ...editData, categorie: finalCat, liens_fournisseurs: editLiens.filter(l => l.trim()) };
    await supabase.from("prestations").update(dataToSave).eq("id", id);
    setPrestations(p => p.map(x => x.id === id ? { ...x, ...dataToSave } as Prestation : x));
    if (finalCat && !categories.includes(finalCat)) setCategories(c => [...c, finalCat].sort());
    setEditId(null); setEditNewCat(""); setEditCatMode("select"); setEditLiens([]);
    const savedMarque = (dataToSave as any).marque as string | undefined;
    if (savedMarque && !marques.includes(savedMarque)) setMarques(m => [...m, savedMarque].sort());
  }

  function startEdit(p: Prestation) {
    setEditId(p.id);
    setEditData({
      nom: p.nom, description: p.description, prix_unitaire: p.prix_unitaire,
      unite: p.unite, type_branche: p.type_branche, categorie: p.categorie,
      ...((p as any).sous_categorie ? { sous_categorie: (p as any).sous_categorie } : {}),
      ...((p as any).marque ? { marque: (p as any).marque } : {}),
      ...((p as any).image_url ? { image_url: (p as any).image_url } : {}),
    });
    setEditCatMode("select"); setEditNewCat("");
    setEditLiens((p as any).liens_fournisseurs ?? []);
  }

  const servicesPrests = prestations.filter(p => p.type_branche === "service");
  const materiauxPrests = prestations.filter(p => p.type_branche === "materiau");
  const catServices = [...new Set(servicesPrests.map(p => p.categorie))].sort();
  const catMateriaux = [...new Set(materiauxPrests.map(p => p.categorie))].sort();
  const byCatServices = catServices.reduce((acc, cat) => { acc[cat] = servicesPrests.filter(p => p.categorie === cat); return acc; }, {} as Record<string, Prestation[]>);
  const byCatMateriaux = catMateriaux.reduce((acc, cat) => { acc[cat] = materiauxPrests.filter(p => p.categorie === cat); return acc; }, {} as Record<string, Prestation[]>);

  const sharedProps = {
    editId, editData, editNewCat, editCatMode, editLiens, categories, marques,
    delCategorie, startEdit, saveEdit, del,
    setEditId, setEditData, setEditNewCat, setEditCatMode, setEditLiens,
  };

  return (
    <Shell>
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-3xl text-ink-900">Catalogue</h1>
            <p className="text-ink-500 text-sm mt-1">{prestations.length} prestation{prestations.length > 1 ? "s" : ""}</p>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="btn-volt">
            <Plus size={16} /> Ajouter
          </button>
        </div>

        {showForm && (
          <div className="card card-inner mb-6 border-volt-400">
            <h2 className="font-semibold text-ink-800 mb-4">Nouvelle prestation</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="label">Nom *</label>
                <input className="input" placeholder="Ex : Pose prise de courant 16A"
                  value={form.nom} onChange={e => setForm(f => ({ ...f, nom: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
                <label className="label">Description (optionnel)</label>
                <input className="input" placeholder="Détail de la prestation…"
                  value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <label className="label">Prix unitaire (€) *</label>
                <input className="input" type="number" step="0.5" placeholder="0.00"
                  value={form.prix_unitaire} onChange={e => setForm(f => ({ ...f, prix_unitaire: e.target.value }))} />
              </div>
              <div>
                <label className="label">Unité</label>
                <select className="input" value={form.unite} onChange={e => setForm(f => ({ ...f, unite: e.target.value }))}>
                  {UNITES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Branche AE</label>
                <select className="input" value={form.type_branche} onChange={e => setForm(f => ({ ...f, type_branche: e.target.value }))}>
                  <option value="service">Service (main d'œuvre)</option>
                  <option value="materiau">Matériau (achat/revente)</option>
                </select>
              </div>
              {form.type_branche === "materiau" && (
                <div>
                  <label className="label">Marque</label>
                  <FormMarque value={form.marque} onChange={v => setForm(f => ({ ...f, marque: v }))} marques={marques} />
                </div>
              )}
              <div>
                <label className="label">Catégorie</label>
                {categories.length > 0 && !newCat ? (
                  <div className="flex gap-2">
                    <select className="input flex-1" value={form.categorie} onChange={e => setForm(f => ({ ...f, categorie: e.target.value }))}>
                      <option value="">— Choisir —</option>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button onClick={() => setNewCat(" ")} className="btn-ghost !px-3 text-xs">Nouvelle</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input className="input flex-1" placeholder="Nom de la catégorie"
                      value={newCat.trim()} onChange={e => setNewCat(e.target.value)} />
                    {categories.length > 0 && <button onClick={() => setNewCat("")} className="btn-ghost !px-3 text-xs">Existante</button>}
                  </div>
                )}
              </div>
              <div>
                <label className="label">Sous-catégorie</label>
                <input className="input" placeholder="Ex : Prises, Câblage, Éclairage…"
                  value={form.sous_categorie} onChange={e => setForm(f => ({ ...f, sous_categorie: e.target.value }))} />
              </div>
              {form.type_branche === "materiau" && (
                <>
                  <div className="md:col-span-2">
                    <label className="label">Liens fournisseurs</label>
                    <LiensFournisseurs liens={formLiens} setLiens={setFormLiens} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="label">Image du produit (URL)</label>
                    <input className="input" placeholder="https://…/image-produit.jpg"
                      value={form.image_url ?? ""} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} />
                    {form.image_url && (
                      <img src={form.image_url} alt="" className="mt-2 h-16 object-contain rounded-lg border border-ink-100 p-1 bg-white" />
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => { setShowForm(false); setFormLiens([]); }} className="btn-ghost flex-1 justify-center">Annuler</button>
              <button onClick={add} className="btn-volt flex-1 justify-center"><Save size={15} /> Enregistrer</button>
            </div>
          </div>
        )}

        {!loading && prestations.length === 0 && !showForm && (
          <div className="card card-inner text-center py-16">
            <p className="text-ink-400 mb-2">Catalogue vide</p>
            <p className="text-ink-300 text-sm mb-6">Ajoutez vos prestations et matériaux avec leurs prix, unités et catégories.</p>
            <button onClick={() => setShowForm(true)} className="btn-volt inline-flex"><Plus size={15} /> Ajouter la première prestation</button>
          </div>
        )}

        {loading && <div className="text-center py-10 text-ink-400">Chargement…</div>}

        {!loading && servicesPrests.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-volt-100 flex items-center justify-center">
                <Wrench size={16} className="text-volt-700" />
              </div>
              <div>
                <h2 className="font-bold text-ink-900">Services</h2>
                <p className="text-xs text-ink-400">{servicesPrests.length} prestation{servicesPrests.length > 1 ? "s" : ""} · Main d'œuvre</p>
              </div>
            </div>
            <div className="space-y-3">
              {Object.entries(byCatServices).map(([cat, items]) => (
                <CategorieBlock key={`s-${cat}`} cat={cat} items={items} branche="service"
                  collapsed={collapsedServices[cat] ?? true}
                  toggleCollapse={() => setCollapsedServices(c => ({ ...c, [cat]: !c[cat] }))}
                  {...sharedProps} />
              ))}
            </div>
          </div>
        )}

        {!loading && materiauxPrests.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Package size={16} className="text-emerald-700" />
              </div>
              <div>
                <h2 className="font-bold text-ink-900">Matériaux</h2>
                <p className="text-xs text-ink-400">{materiauxPrests.length} article{materiauxPrests.length > 1 ? "s" : ""} · Achat / revente</p>
              </div>
            </div>
            <div className="space-y-3">
              {Object.entries(byCatMateriaux).map(([cat, items]) => (
                <CategorieBlock key={`m-${cat}`} cat={cat} items={items} branche="materiau"
                  collapsed={collapsedMateriaux[cat] ?? true}
                  toggleCollapse={() => setCollapsedMateriaux(c => ({ ...c, [cat]: !c[cat] }))}
                  {...sharedProps} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}