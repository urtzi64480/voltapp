"use client";

// Extrait mécaniquement de src/app/plan/[clientId]/page.tsx (aucun changement de comportement).
import type { ReactNode } from "react";
import { useState, useRef, useEffect } from "react";
import { Save, Printer, Trash2, X, GripHorizontal, ChevronUp, ChevronDown } from "lucide-react";
import { Point, Piece, Niveau, PieceType, NiveauType, AppareillagePlace, AppareillageType, MurSpec, Ouverture, OuvertureType, UsagePorte, NIVEAU_TYPES, origineCircuits, PIECE_TYPES, distance, CircuitManuel, FamilleCircuitManuel, Zone, TypeCoteZone, estCommande, estCommandeDouble, estCommandeService, estLumiere, estCourantFaible, TYPES_POSTE_PLAQUE, TYPES_USAGE_DEDIE, LIBELLE_USAGE_DEDIE, MIN_POSTES_PLAQUE, USAGE_DEDIE_DEFAUT, PosteSpec, nbVantauxBaie } from "@/lib/maison-types";
import { AppareillageSymbol, PALETTE, labelAppareillage, labelAppareillagePlace } from "@/components/plan/AppareillageSymbols";
import { preparerMurs, definirMitoyens, longueursUtilesCm, surfaceUtile } from "@/lib/murs";
import { appliquerCloison, OptionsCloison } from "@/lib/cloisons";
import type { CloisonZone } from "@/lib/zones";
import { cotesParDefaut, surfaceZone, segmentsZone } from "@/lib/zones";
import { enCm, estRectangle, redimensionnerMurUtile } from "@/lib/dimensions-piece";
import { messageDepassement, cleCircuitDedie } from "@/lib/maison-engine";
import { CIRCUITS } from "@/lib/electrical-constants";
import { verifierEclairageManuel, fermetureCircuitLumiere, commandesPartagees } from "@/lib/controle-eclairage";
import { fondModal } from "@/lib/fond-modal";
import { PX_PER_M, CIRCUIT_KEYS_MANUELS } from "./constantes";
import { Outil } from "./outils-ui";

// ─── DRAG STATE ───────────────────────────────────────────────────────────────

// Boussole du plan : l'aiguille rouge indique le NORD. Glisser pour la tourner (ou saisir l'angle dans la barre) —
// 0° = Nord en haut du plan, 90° = Nord à droite. Réglage commun au bâtiment, repris par le soleil de midi en 3D.
export function BoussoleOrientation({ angle, onChange }: { angle: number; onChange: (deg: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [glisse, setGlisse] = useState(false);
  const depuisPointeur = (e: { clientX: number; clientY: number }) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < 4) return;
    // Angle horaire depuis le haut : atan2(dx, -dy).
    onChange((Math.atan2(dx, -dy) * 180) / Math.PI);
  };
  return (
    <div ref={ref}
      className="absolute top-3 right-3 z-10 w-16 h-16 rounded-full bg-white/90 border border-ink-200 shadow select-none"
      style={{ touchAction: "none", cursor: glisse ? "grabbing" : "grab" }}
      title="Orientation du bâtiment : glisser pour placer le Nord"
      onPointerDown={e => { e.stopPropagation(); (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); setGlisse(true); depuisPointeur(e); }}
      onPointerMove={e => { if (glisse) depuisPointeur(e); }}
      onPointerUp={e => { setGlisse(false); (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); }}>
      <svg viewBox="-32 -32 64 64" className="w-full h-full pointer-events-none">
        <circle r={29} fill="none" stroke="#d6d3d1" strokeWidth={1} />
        <g transform={`rotate(${angle})`}>
          <polygon points="0,-24 6,0 -6,0" fill="#dc2626" />
          <polygon points="0,24 6,0 -6,0" fill="#a8a29e" />
          <text y={-26} x={0} textAnchor="middle" fontSize="9" fontWeight="700" fill="#dc2626" transform="translate(0,-2)">N</text>
        </g>
        <circle r={2.5} fill="#1c1917" />
      </svg>
      <span className="absolute -bottom-4 inset-x-0 text-center text-[10px] font-mono text-ink-500">{Math.round(angle)}°</span>
    </div>
  );
}

export type DragMode =
  | { kind: "none" }
  | { kind: "pan"; startX: number; startY: number; startPan: Point }
  | { kind: "vertex"; pieceId: number; vertexIndex: number }
  | { kind: "piece"; pieceId: number; startX: number; startY: number; startContour: Point[] }
  | { kind: "nomPiece"; pieceId: number; startX: number; startY: number; startOffset: Point }
  | { kind: "appareillage"; pieceId: number; appareillageId: number }
  | { kind: "meuble"; pieceId: number; meubleId: number }
  | { kind: "escalier"; escalierId: number; offX: number; offY: number }
  | { kind: "niveau"; startX: number; startY: number; dx0: number; dy0: number }
  | { kind: "personne"; pieceId: number }
  | { kind: "voiture"; pieceId: number }
  | { kind: "ouverture"; pieceId: number; ouvertureId: number }
  | { kind: "zone"; zoneId: number; startX: number; startY: number; startContour: Point[] }
  | { kind: "zoneSommet"; zoneId: number; index: number }
  | { kind: "tableau" }
  | { kind: "pointArrivee" }
  | { kind: "boite"; label: string; boiteId: number }
  | { kind: "liaison"; cle: string; waypointId: number };

// ─── FORMULAIRES ────────────────────────────────────────────────────────────────

export function PieceForm({ initialNom, initialType, initialHauteurPlafond, initialContour, initialMurs, mitoyens, verrouillee, onValidate, onCancel, onDelete }: {
  initialNom: string; initialType: PieceType; initialHauteurPlafond?: number;
  initialContour: Point[]; initialMurs: MurSpec[]; mitoyens: boolean[]; verrouillee?: boolean;
  onValidate: (nom: string, type: PieceType, hauteurPlafond: number | undefined, contour: Point[], murs: MurSpec[]) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [nom, setNom] = useState(initialNom);
  const [type, setType] = useState<PieceType>(initialType);
  const [hauteurPlafond, setHauteurPlafond] = useState(initialHauteurPlafond != null ? String(initialHauteurPlafond) : "");

  // Murs : épaisseur de la structure et du doublage, par côté. (Mur extérieur ou mitoyen : déduit du plan.)
  const [saisiesMurs, setSaisiesMurs] = useState<SaisieMur[]>(initialMurs.map(saisieDepuisMur));
  const mursApercu = saisiesMurs.map((sm, i) => murDepuisSaisie(sm) ?? initialMurs[i]);
  const mursValides = saisiesMurs.every(sm => murDepuisSaisie(sm) != null);

  // Dimensions = dimensions UTILES (de face intérieure finie à face intérieure finie), celles que l'on
  // relève sur place. Rectangle → largeur et longueur ; autre forme → un champ par mur. Seuls les champs
  // modifiés sont appliqués ; les autres affichent la valeur courante.
  const rectangle = estRectangle(initialContour);
  const indices = rectangle ? [0, 1] : initialContour.map((_, i) => i);
  const etiquette = (i: number) => rectangle ? (i === 0 ? "Largeur" : "Longueur") : `Mur ${i + 1}`;
  const [saisies, setSaisies] = useState<Record<number, string>>({});
  const pieceAvec = (contour: Point[]): Piece => {
    const pc = { contour, murs: mursApercu } as Piece;
    definirMitoyens(pc, mitoyens);
    return pc;
  };
  const valeurValide = (i: number) => { const v = parseFloat((saisies[i] ?? "").replace(",", ".")); return v >= 1 ? Math.round(v) : null; };
  const contourApercu = indices.reduce((c, i) => {
    if (saisies[i] === undefined) return c;
    const v = valeurValide(i);
    return v != null ? redimensionnerMurUtile(pieceAvec(c), i, v) : c;
  }, initialContour);
  const pieceApercu = pieceAvec(contourApercu);
  const utiles = longueursUtilesCm(pieceApercu);
  const dimensionsValides = indices.every(i => saisies[i] === undefined || valeurValide(i) != null);
  const aireUtile = surfaceUtile(pieceApercu);
  const modifie = contourApercu !== initialContour;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" {...fondModal(onCancel)}>
      <div className="card w-full max-w-sm max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200 shrink-0">
          <p className="font-semibold text-ink-900">Pièce</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          <div>
            <label className="label">Nom</label>
            <input autoFocus className="input" placeholder="Ex: Chambre 1, Séjour…" value={nom} onChange={e => setNom(e.target.value)} />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={type} onChange={e => setType(e.target.value as PieceType)}>
              {Object.entries(PIECE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Hauteur sous plafond (m) — vide = hauteur du niveau</label>
            <input className="input" inputMode="decimal" placeholder="Ex: 2.50" value={hauteurPlafond} onChange={e => setHauteurPlafond(e.target.value)} />
          </div>
          <div className="border-t border-ink-100 pt-3">
            <label className="label">Dimensions intérieures (cm){rectangle ? "" : " — par mur"}</label>
            {verrouillee ? (
              <p className="text-xs text-amber-600">🔒 Pièce verrouillée : déverrouille-la pour modifier ses dimensions.</p>
            ) : (
              <>
                <div className="grid gap-2 grid-cols-2">
                  {indices.map(i => {
                    const ok = saisies[i] === undefined || valeurValide(i) != null;
                    return (
                      <label key={i} className="flex items-center gap-2 text-xs text-ink-500">
                        <span className="w-16 shrink-0">{etiquette(i)}</span>
                        <input className={`input !py-1 !text-xs ${ok ? "" : "!border-red-400"}`} inputMode="numeric"
                          value={saisies[i] ?? String(utiles[i])}
                          onChange={e => setSaisies(sv => ({ ...sv, [i]: e.target.value }))} />
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-ink-500 mt-2">
                  Surface : <span className="font-semibold text-ink-900">{aireUtile != null ? `${aireUtile.toFixed(2)} m²` : "—"}</span>
                  {modifie && <span className="text-volt-600"> (modifiée)</span>}
                </p>
                <p className="text-[11px] text-ink-400 mt-1">
                  Dimensions intérieures, de face finie à face finie. Le tracé de la pièce est son contour hors-tout : les épaisseurs de murs s&apos;ajoutent à l&apos;intérieur et réduisent ces dimensions.
                </p>
              </>
            )}
          </div>
          <div className="border-t border-ink-100 pt-3">
            <label className="label">Murs : 3 couches (cm), de l&apos;intérieur vers l&apos;extérieur</label>
            {verrouillee ? (
              <p className="text-xs text-amber-600">🔒 Pièce verrouillée : déverrouille-la pour modifier ses murs.</p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  {saisiesMurs.map((sm, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[11px] text-ink-500 w-10 shrink-0">Mur {i + 1}</span>
                      <ChampsMur compact valeur={sm} onChange={v => setSaisiesMurs(arr => arr.map((x, k) => k === i ? v : x))} />
                    </div>
                  ))}
                </div>
                {saisiesMurs.length > 1 && (
                  <button type="button" className="text-[11px] text-volt-600 underline mt-1.5"
                    onClick={() => setSaisiesMurs(arr => arr.map(() => ({ ...arr[0] })))}>
                    Appliquer les couches du mur 1 à tous les murs
                  </button>
                )}
                <p className="text-[11px] text-ink-400 mt-1.5">
                  1 = finition (côté pièce), 2 = doublage (les circuits y passent par défaut), 3 = structure (0 = pas de mur de ce côté, utile pour une cloison commune à deux pièces). Les couches s&apos;ajoutent à l&apos;intérieur du tracé : les dimensions intérieures sont recalculées. Les ouvertures percent les 3 couches.
                </p>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200 shrink-0">
          <button disabled={!verrouillee && (!dimensionsValides || !mursValides)}
            onClick={() => onValidate(nom, type, hauteurPlafond.trim() === "" ? undefined : (parseFloat(hauteurPlafond.replace(",", ".")) || undefined), verrouillee ? initialContour : contourApercu, verrouillee ? initialMurs : mursApercu)}
            className="btn-volt flex-1 disabled:opacity-40"><Save size={14} /> Valider</button>
          {onDelete && <button onClick={onDelete} className="btn-danger !px-3"><Trash2 size={14} /></button>}
        </div>
      </div>
    </div>
  );
}


// ─── CLOISON : formulaire de validation ─────────────────────────────────────────────────────────
// Après le tracé (mur → angles → mur) : noms et types des deux pièces obtenues, épaisseur de la cloison,
// porte éventuelle. Le résultat est calculé en direct (surfaces utiles, erreurs) par appliquerCloison.
export const IDEES_SOUS_PIECE: { nom: string; type: PieceType }[] = [
  { nom: "Dressing", type: "autre" }, { nom: "Placard", type: "autre" }, { nom: "Bureau", type: "autre" },
  { nom: "Buanderie", type: "autre" }, { nom: "Salle d'eau", type: "sdb" }, { nom: "WC", type: "wc" },
];
export function CloisonForm({ piece, pieces, chemin, onValidate, onCancel }: {
  piece: Piece; pieces: Piece[]; chemin: Point[];
  onValidate: (opts: OptionsCloison) => void; onCancel: () => void;
}) {
  const [nomOrigine, setNomOrigine] = useState(piece.nom);
  const [typeOrigine, setTypeOrigine] = useState<PieceType>(piece.type);
  const [nomNouvelle, setNomNouvelle] = useState("Dressing");
  const [typeNouvelle, setTypeNouvelle] = useState<PieceType>("autre");
  const [epaisseur, setEpaisseur] = useState("10");
  const [porte, setPorte] = useState<OptionsCloison["porte"]>("porte");

  const ep = parseFloat(epaisseur.replace(",", "."));
  const epaisseurValide = ep >= 5 && ep <= 50;
  const opts: OptionsCloison = { nomOrigine, typeOrigine, nomNouvelle, typeNouvelle, epaisseurCm: epaisseurValide ? ep : 10, porte };
  const essai = appliquerCloison(pieces, piece.id, chemin, opts);
  let aireOrigine: number | null = null, aireNouvelle: number | null = null;
  if (!("erreur" in essai)) {
    preparerMurs(essai.pieces);
    const po = essai.pieces.find(x => x.id === essai.idOrigine), pn = essai.pieces.find(x => x.id === essai.idNouvelle);
    aireOrigine = (po ? surfaceUtile(po) : null) ?? essai.aireOrigine;
    aireNouvelle = (pn ? surfaceUtile(pn) : null) ?? essai.aireNouvelle;
  }
  const longueurTotale = chemin.slice(1).reduce((t, pt, i) => t + distance(chemin[i], pt), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" {...fondModal(onCancel)}>
      <div className="card w-full max-w-sm max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200 shrink-0">
          <p className="font-semibold text-ink-900">Cloison — {chemin.length - 1} tronçon{chemin.length > 2 ? "s" : ""}, {longueurTotale.toFixed(2)} m</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          <div>
            <label className="label">Nouvelle pièce (petite partie)</label>
            <input autoFocus className="input" placeholder="Ex: Dressing" value={nomNouvelle} onChange={e => setNomNouvelle(e.target.value)} />
            <div className="flex flex-wrap gap-1 mt-1.5">
              {IDEES_SOUS_PIECE.map(i => (
                <button key={i.nom} type="button" onClick={() => { setNomNouvelle(i.nom); setTypeNouvelle(i.type); }}
                  className={`!text-[11px] px-2 py-0.5 rounded-md border transition-colors ${nomNouvelle === i.nom ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"}`}>
                  {i.nom}
                </button>
              ))}
            </div>
            <select className="input mt-1.5" value={typeNouvelle} onChange={e => setTypeNouvelle(e.target.value as PieceType)}>
              {Object.entries(PIECE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <p className="text-xs text-ink-500 mt-1">Surface utile : <span className="font-semibold text-ink-900">{aireNouvelle != null ? `${aireNouvelle.toFixed(2)} m²` : "—"}</span></p>
          </div>
          <div className="border-t border-ink-100 pt-3">
            <label className="label">Pièce d&apos;origine (grande partie)</label>
            <input className="input" value={nomOrigine} onChange={e => setNomOrigine(e.target.value)} />
            <select className="input mt-1.5" value={typeOrigine} onChange={e => setTypeOrigine(e.target.value as PieceType)}>
              {Object.entries(PIECE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <p className="text-xs text-ink-500 mt-1">Surface utile : <span className="font-semibold text-ink-900">{aireOrigine != null ? `${aireOrigine.toFixed(2)} m²` : "—"}</span></p>
          </div>
          <div className="border-t border-ink-100 pt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="label">Épaisseur cloison (cm)</label>
              <input className="input" inputMode="decimal" value={epaisseur} onChange={e => setEpaisseur(e.target.value)} />
            </div>
            <div>
              <label className="label">Porte dans la cloison</label>
              <select className="input" value={porte ?? ""} onChange={e => setPorte((e.target.value || null) as OptionsCloison["porte"])}>
                <option value="">Aucune</option>
                <option value="porte">Porte battante</option>
                <option value="porte_coulissante">Porte coulissante (sur rail)</option>
                <option value="porte_galandage">Porte à galandage (dans la cloison)</option>
                <option value="ouverture">Passage sans porte</option>
              </select>
            </div>
          </div>
          {!epaisseurValide && <p className="text-xs text-red-500">Épaisseur : entre 5 et 50 cm.</p>}
          {"erreur" in essai && <p className="text-xs text-red-500">{essai.erreur}</p>}
          {!("erreur" in essai) && essai.avertissement && <p className="text-xs text-amber-600">{essai.avertissement}</p>}
          <p className="text-[11px] text-ink-400">
            La cloison devient un mur mitoyen des deux pièces (même épaisseur des deux côtés). Les appareillages, meubles, portes et fenêtres passent dans la pièce qui les contient ;
            les circuits sont à regénérer. Une porte se déplace ensuite en la glissant sur la cloison.
          </p>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200 shrink-0">
          <button disabled={"erreur" in essai || !epaisseurValide || nomNouvelle.trim() === ""} onClick={() => onValidate(opts)}
            className="btn-volt flex-1 disabled:opacity-40"><Save size={14} /> Créer les deux pièces</button>
        </div>
      </div>
    </div>
  );
}

// ─── ZONE : symbole d'une porte posée dans une cloison de zone (plan 2D) ──────────────────────
// Calculé en mètres puis projeté point par point (indépendant de l'orientation de la cloison).
export function OuvertureZoneSymbole({ c, o, toScreen, zoom, selectionnee, actif, onDown }: {
  c: CloisonZone; o: Ouverture; toScreen: (p: Point) => Point; zoom: number; selectionnee: boolean; actif: boolean;
  onDown: (e: React.PointerEvent) => void;
}) {
  const couleur = o.type === "fenetre" || o.type === "baie_vitree" ? "#0369A1" : o.type === "ouverture" ? "#78716c" : "#92400E";
  const L = distance(c.a, c.b) || 1, ux = (c.b.x - c.a.x) / L, uy = (c.b.y - c.a.y) / L, nx = -uy, ny = ux;
  const w = o.largeur / 100, s = o.position * L;
  const pt = (along: number, perp: number): Point => ({ x: c.a.x + ux * along + nx * perp, y: c.a.y + uy * along + ny * perp });
  const J0 = pt(s - w / 2, 0), J1 = pt(s + w / 2, 0), centre = pt(s, 0);
  const sg = o.ouvreVersInterieur === false ? -1 : 1;
  const P = (q: Point) => { const e = toScreen(q); return `${e.x},${e.y}`; };
  const e0 = toScreen(J0), e1 = toScreen(J1), ec = toScreen(centre);
  let corps: ReactNode = null;
  if (o.type === "porte") {
    const hingeAlong = o.charniere === "droite" ? s + w / 2 : s - w / 2, autreAlong = o.charniere === "droite" ? s - w / 2 : s + w / 2;
    const hinge = pt(hingeAlong, 0), bout = pt(hingeAlong, sg * w);
    const a1 = Math.atan2(bout.y - hinge.y, bout.x - hinge.x), a2 = Math.atan2(pt(autreAlong, 0).y - hinge.y, pt(autreAlong, 0).x - hinge.x);
    let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const arc = Array.from({ length: 11 }, (_, k) => ({ x: hinge.x + w * Math.cos(a1 + d * (k / 10)), y: hinge.y + w * Math.sin(a1 + d * (k / 10)) }));
    corps = (<>
      <line x1={toScreen(hinge).x} y1={toScreen(hinge).y} x2={toScreen(bout).x} y2={toScreen(bout).y} stroke={couleur} strokeWidth={1.6} />
      <polyline points={arc.map(P).join(" ")} fill="none" stroke={couleur} strokeWidth={1} strokeDasharray="3,2" />
    </>);
  } else if (o.type === "porte_coulissante") {
    const cote = o.coulisseVers === "gauche" ? -1 : 1;
    const q0 = pt(cote > 0 ? s + w / 2 : s - w / 2 - w, 0), q1 = pt(cote > 0 ? s + w / 2 + w : s - w / 2, 0);
    const poche = [q0, q1, { x: q1.x + nx * 0.03, y: q1.y + ny * 0.03 }, { x: q0.x + nx * 0.03, y: q0.y + ny * 0.03 }].map(P).join(" ");
    corps = o.montage === "galandage"
      ? (<>
          <polygon points={poche} fill="none" stroke={couleur} strokeWidth={1} strokeDasharray="3,2" />
          <line x1={e0.x} y1={e0.y} x2={e1.x} y2={e1.y} stroke={couleur} strokeWidth={2} />
        </>)
      : <polygon points={poche} fill={couleur} opacity={0.45} />;
  } else if (o.type === "fenetre" || o.type === "baie_vitree") {
    const nbV = o.type === "baie_vitree" ? nbVantauxBaie(o) : 1;
    corps = (<>
      {Array.from({ length: nbV - 1 }, (_, k) => {
        const sx = s - w / 2 + ((k + 1) * w) / nbV, a0 = toScreen(pt(sx, -0.03)), a1 = toScreen(pt(sx, 0.03));
        return <line key={`vant-${k}`} x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke={couleur} strokeWidth={1} />;
      })}
      <line x1={toScreen(pt(s - w / 2, 0.03)).x} y1={toScreen(pt(s - w / 2, 0.03)).y} x2={toScreen(pt(s + w / 2, 0.03)).x} y2={toScreen(pt(s + w / 2, 0.03)).y} stroke={couleur} strokeWidth={1.5} />
      <line x1={toScreen(pt(s - w / 2, -0.03)).x} y1={toScreen(pt(s - w / 2, -0.03)).y} x2={toScreen(pt(s + w / 2, -0.03)).x} y2={toScreen(pt(s + w / 2, -0.03)).y} stroke={couleur} strokeWidth={1.5} />
    </>);
  } else if (o.type === "porte_garage") {
    corps = <line x1={e0.x} y1={e0.y} x2={e1.x} y2={e1.y} stroke={couleur} strokeWidth={2.5} />;
  } else {
    corps = <line x1={e0.x} y1={e0.y} x2={e1.x} y2={e1.y} stroke={couleur} strokeWidth={1} strokeDasharray="2,2" />;
  }
  const rayon = Math.max(10, (w * PX_PER_M * zoom) / 2 + 4);
  return (
    <g onPointerDown={onDown} style={{ cursor: actif ? "pointer" : "default" }}>
      {corps}
      <circle cx={ec.x} cy={ec.y} r={rayon} fill="transparent" style={{ pointerEvents: actif ? "all" : "none" }} />
      {selectionnee && <circle cx={ec.x} cy={ec.y} r={rayon} fill="none" stroke="#F59E0B" strokeWidth={1.5} style={{ pointerEvents: "none" }} />}
    </g>
  );
}

// ─── ZONE : formulaire de création ────────────────────────────────────────────────────────────
// Nom, épaisseur des cloisons et nature de chaque côté (cloison à monter / limite ouverte). Un côté posé sur un
// mur existant est proposé « ouvert » : le mur est déjà là. La surface se recalcule en direct.
export function ZoneForm({ contour, ferme, pieces, onValidate, onCancel }: {
  contour: Point[]; ferme: boolean; pieces: Piece[];
  onValidate: (nom: string, cotes: TypeCoteZone[], epaisseurCm: number) => void; onCancel: () => void;
}) {
  const [nom, setNom] = useState(ferme ? "Dressing" : "Cloison");
  const [epaisseur, setEpaisseur] = useState("10");
  const [cotes, setCotes] = useState<TypeCoteZone[]>(() => cotesParDefaut(contour, ferme, pieces));
  const ep = parseFloat(epaisseur.replace(",", "."));
  const epaisseurValide = ep >= 1 && ep <= 50;
  const apercu: Zone = { id: 0, nom, contour, ferme, cotes, epaisseurCm: epaisseurValide ? ep : 10 };
  const surf = surfaceZone(apercu);
  const longueurTotale = segmentsZone(apercu).reduce((t, sg) => t + distance(sg.a, sg.b), 0);
  const nbCloisons = cotes.filter(c => c === "cloison").length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" {...fondModal(onCancel)}>
      <div className="card w-full max-w-sm max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200 shrink-0">
          <p className="font-semibold text-ink-900">{ferme ? "Zone" : "Cloison libre"}</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          <div>
            <label className="label">Nom</label>
            <input autoFocus className="input" placeholder={ferme ? "Ex: Dressing, Coin bureau…" : "Ex: Cloison dressing"} value={nom} onChange={e => setNom(e.target.value)} />
            {ferme && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {["Dressing", "Placard", "Bureau", "Buanderie", "Coin repas", "Entrée"].map(n => (
                  <button key={n} type="button" onClick={() => setNom(n)}
                    className={`!text-[11px] px-2 py-0.5 rounded-md border transition-colors ${nom === n ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"}`}>{n}</button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-ink-500">
            {surf
              ? <>Surface utile : <span className="font-semibold text-ink-900">{surf.utile.toFixed(2)} m²</span> <span className="text-ink-400">(tracé à l&apos;axe {surf.brute.toFixed(2)} m²)</span></>
              : <>Longueur : <span className="font-semibold text-ink-900">{longueurTotale.toFixed(2)} m</span> · une cloison libre n&apos;a pas de surface</>}
          </p>
          <div className="border-t border-ink-100 pt-3">
            <label className="label">Épaisseur des cloisons (cm)</label>
            <input className="input !w-24" inputMode="decimal" value={epaisseur} onChange={e => setEpaisseur(e.target.value)} />
            {!epaisseurValide && <p className="text-xs text-red-500 mt-1">Épaisseur : entre 5 et 50 cm.</p>}
          </div>
          {ferme && (
            <div className="border-t border-ink-100 pt-3 flex flex-col gap-1.5">
              <label className="label">Côtés</label>
              {cotes.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="shrink-0 w-28">Côté {i + 1} · {distance(contour[i], contour[(i + 1) % contour.length]).toFixed(2)} m</span>
                  <div className="flex gap-1 flex-1">
                    {(["cloison", "ouvert"] as const).map(t => (
                      <button key={t} type="button" onClick={() => setCotes(arr => arr.map((x, k) => (k === i ? t : x)))}
                        className={`flex-1 !text-xs px-2 py-1 rounded-md border transition-colors ${c === t ? "bg-ink-900 border-ink-900 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-600 hover:border-ink-400"}`}>
                        {t === "cloison" ? "Cloison" : "Ouvert"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-ink-400">
                « Cloison » = mur à monter, dessiné en épaisseur au plan et en 3D. « Ouvert » = limite virtuelle ou mur déjà existant (proposé automatiquement quand le côté longe un mur).
                {nbCloisons === 0 && " Sans aucune cloison, la zone ne sert qu'à nommer et mesurer un espace."}
              </p>
            </div>
          )}
          <p className="text-[11px] text-ink-400">Les portes se posent ensuite avec l&apos;outil « Porte / fenêtre », en cliquant sur une cloison. Une zone n&apos;est pas une pièce : pas d&apos;appareillage ni de circuit.</p>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200 shrink-0">
          <button disabled={!epaisseurValide || nom.trim() === ""} onClick={() => onValidate(nom, cotes, apercu.epaisseurCm)}
            className="btn-volt flex-1 disabled:opacity-40"><Save size={14} /> Créer</button>
        </div>
      </div>
    </div>
  );
}

// Enveloppe déplaçable pour les panneaux flottants (info pièce/appareillage/tableau/
// ouverture/coude, circuits manuels, légende des circuits, dessin de cheminement) — une
// poignée fine en haut (grip) permet de les glisser n'importe où sur l'écran pour ne plus
// gêner la vue du plan. Position de départ = son coin d'origine (corner) ; le déplacement
// est un simple offset (translate) appliqué par-dessus, remis à zéro à chaque réouverture
// du panneau (le composant est démonté/remonté avec la sélection qu'il représente).
// dark : bandeau à fond sombre (ex. dessin de cheminement) — adapte la couleur de la poignée.
export function DraggablePanel({ corner, className, dark, children }: {
  corner: "bl" | "br" | "tr" | "tc";
  className: string;
  dark?: boolean;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });
  // Fenêtre réduite : seule la barre du haut reste visible (le contenu est masqué, pas détruit — saisies et défilement conservés).
  const [reduit, setReduit] = useState(false);
  // minDy calculé UNE SEULE FOIS au moment où on attrape la poignée (pas à chaque
  // pointermove — relire le DOM et ré-enregistrer les écouteurs à chaque pixel déplacé
  // rendait le glisser-déposer saccadé, voire bloqué).
  const dragRef = useRef<{ x: number; y: number; dx: number; dy: number; minDy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = dragRef.current.dx + (e.clientX - dragRef.current.x);
      const dy = Math.max(dragRef.current.minDy, dragRef.current.dy + (e.clientY - dragRef.current.y));
      setOffset({ dx, dy });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);   // geste tactile interrompu : sans ça le glissement restait « collé » au doigt
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const cornerClass = corner === "bl" ? "bottom-4 left-4" : corner === "br" ? "bottom-4 right-4" : corner === "tr" ? "top-4 right-4" : "top-4 left-1/2";
  // "tc" (top-center) a besoin d'un -50% de centrage en plus de l'offset de glisser-déposer —
  // les deux se composent dans un seul transform (translations pures : l'ordre n'a pas d'importance).
  const transform = `${corner === "tc" ? "translateX(-50%) " : ""}translate(${offset.dx}px, ${offset.dy}px)`;
  // Un panneau ancré en bas ("bl"/"br") grandit VERS LE HAUT avec son contenu — sur un
  // écran bas ou un panneau chargé (beaucoup de champs), sa poignée du haut peut se
  // retrouver nativement derrière la barre d'outils, SANS même avoir été déplacée. On
  // plafonne sa hauteur et on force un défilement interne pour que ça n'arrive jamais —
  // en dur ici, plutôt que de compter sur chaque appelant pour le faire dans className
  // (la plupart ne le faisaient pas).
  const maxHeightStyle = (corner === "bl" || corner === "br")
    ? { maxHeight: "calc(100dvh - 88px)", overflowY: "auto" as const }
    : undefined;

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    // On peut attraper le panneau n'importe où — sauf sur un champ, bouton, lien ou
    // élément marqué data-no-drag, qui doivent garder leur comportement de clic normal.
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, button, a, label, [data-no-drag]")) return;
    e.stopPropagation();
    const rect = panelRef.current?.getBoundingClientRect();
    const margeHaut = 72; // hauteur approx. de la barre d'outils du haut
    // Le plus petit dy permis tel que le haut du panneau ne passe jamais sous margeHaut :
    // top_base + dy >= margeHaut, avec top_base = rect.top - offset.dy (position actuelle
    // moins l'offset déjà appliqué) => dy >= margeHaut - top_base.
    const minDy = rect ? margeHaut - (rect.top - offset.dy) : -Infinity;
    dragRef.current = { x: e.clientX, y: e.clientY, dx: offset.dx, dy: offset.dy, minDy };
  };

  return (
    <div ref={panelRef} className={`absolute ${cornerClass} z-30`} style={{ transform }}>
      <div className={className} style={{ ...maxHeightStyle, cursor: "grab", touchAction: "none" }}
        onPointerDown={startDrag}>
        <div className={`relative flex items-center justify-center h-5 -mx-3 -mt-3 ${reduit ? "" : "mb-2"} rounded-t-xl ${reduit ? "rounded-b-xl" : ""} ${dark ? "bg-white/10 hover:bg-white/20" : "bg-ink-100 hover:bg-ink-200"}`}>
          <GripHorizontal size={12} className={dark ? "text-white/50" : "text-ink-400"} />
          <button type="button" onClick={e => { e.stopPropagation(); setReduit(r => !r); }}
            title={reduit ? "Agrandir la fenêtre" : "Réduire la fenêtre"}
            className={`absolute right-1 top-0 h-5 px-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold ${dark ? "text-white/70 hover:text-white" : "text-ink-500 hover:text-ink-800"}`}>
            {reduit ? <><ChevronDown size={12} /> Agrandir</> : <><ChevronUp size={12} /> Réduire</>}
          </button>
        </div>
        <div style={reduit ? { display: "none" } : undefined}>{children}</div>
      </div>
    </div>
  );
}

export function EtiquetteLongueur({ aPx, bPx, texte, onClick, actif, normale }: {
  aPx: Point; bPx: Point; texte: string; onClick?: () => void; actif?: boolean; normale?: Point;
}) {
  const mx = (aPx.x + bPx.x) / 2, my = (aPx.y + bPx.y) / 2;
  const dx = bPx.x - aPx.x, dy = bPx.y - aPx.y;
  const len = Math.hypot(dx, dy) || 1;
  // normale (écran, unitaire) imposée = vers l'intérieur de la pièce ; sinon, normale gauche du segment.
  const nx = normale ? normale.x : -dy / len, ny = normale ? normale.y : dx / len;
  const lx = mx + nx * 9, ly = my + ny * 9;
  const w = Math.max(28, texte.length * 6 + 6);
  return (
    <g transform={`translate(${lx}, ${ly})`}
      onPointerDown={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      style={{ cursor: onClick ? "pointer" : "default" }}>
      <rect x={-w / 2} y={-7} width={w} height={14} rx={3}
        fill={actif ? "#F59E0B" : "white"} stroke={actif ? "#F59E0B" : "#d6d3d1"} strokeWidth={1} opacity={0.95} />
      <text x={0} y={4} textAnchor="middle" fontSize={9} fontFamily="monospace" fontWeight={600}
        fill={actif ? "#1c1917" : "#57534e"} style={{ pointerEvents: "none" }}>{texte}</text>
    </g>
  );
}

// Hauteur (cm) d'une section de circuit : vide = non réglée ; validée à la sortie du champ (Entrée / clic ailleurs).
export function ChampHauteurTroncon({ valeur, onChange, cle }: { valeur: number | undefined; onChange: (cm: number | undefined) => void; cle: string }) {
  return (
    <input key={`${cle}-${valeur ?? "auto"}`} className="input !py-1 !text-xs !w-16" inputMode="numeric" placeholder="auto" defaultValue={valeur ?? ""}
      onBlur={e => { const t = e.target.value.trim().replace(",", "."); const v = t === "" ? undefined : parseFloat(t); onChange(v != null && v >= 0 && v <= 400 ? Math.round(v) : undefined); }}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

// Champs d'édition d'UN mur : les 3 couches, de l'intérieur de la pièce vers l'extérieur (cm).
// 1 = finition, 2 = doublage (les circuits y passent par défaut), 3 = structure. 0 = couche absente.
export type SaisieMur = { finition: string; doublage: string; epaisseur: string };
export const saisieDepuisMur = (m: MurSpec): SaisieMur => ({ finition: String(m.finition ?? 0), doublage: String(m.doublage), epaisseur: String(m.epaisseur) });
export function murDepuisSaisie(s: SaisieMur): MurSpec | null {
  const num = (t: string) => t.trim() === "" ? 0 : parseFloat(t.replace(",", "."));
  const f = num(s.finition), d = num(s.doublage), e = num(s.epaisseur);
  if (!(e >= 0 && e <= 200) || !(d >= 0 && d <= 100) || !(f >= 0 && f <= 50)) return null;
  return { epaisseur: Math.round(e * 10) / 10, doublage: Math.round(d * 10) / 10, finition: Math.round(f * 10) / 10 };
}
export function ChampsMur({ valeur, onChange, disabled }: {
  valeur: SaisieMur; onChange: (v: SaisieMur) => void; disabled?: boolean; compact?: boolean;
}) {
  const ok = murDepuisSaisie(valeur) != null;
  const cls = `input !py-1 !text-xs !w-14 ${ok ? "" : "!border-red-400"}`;
  const champs: [keyof SaisieMur, string, string][] = [
    ["finition", "1 · Finition", "Couche 1, côté pièce : plaque de plâtre, enduit, parement…"],
    ["doublage", "2 · Doublage", "Couche 2 : isolant / vide technique — les circuits y passent par défaut"],
    ["epaisseur", "3 · Structure", "Couche 3, contre le tracé : maçonnerie, ossature, cloison (0 = aucun mur de ce côté)"],
  ];
  return (
    <div className="flex items-end gap-2 flex-wrap">
      {champs.map(([k, lib, aide]) => (
        <label key={k} className="flex flex-col gap-0.5 text-[10px] text-ink-500" title={aide}>
          {lib}
          <input className={cls} inputMode="decimal" disabled={disabled} value={valeur[k]} onChange={e => onChange({ ...valeur, [k]: e.target.value })} />
        </label>
      ))}
    </div>
  );
}

export function SegmentLengthForm({ longueurActuelle, murActuel, onValidate, onCancel }: {
  longueurActuelle: number; murActuel: MurSpec;
  onValidate: (nouvelleLongueurCm: number, mur: MurSpec) => void; onCancel: () => void;
}) {
  // Longueur INTÉRIEURE (face finie à face finie) en centimètres entiers, renvoyée en cm ; + épaisseurs du mur.
  const [valeur, setValeur] = useState(String(enCm(longueurActuelle)));
  const [saisieMur, setSaisieMur] = useState<SaisieMur>(saisieDepuisMur(murActuel));
  const cm = parseFloat(valeur.replace(",", "."));
  const mur = murDepuisSaisie(saisieMur);
  const valide = !isNaN(cm) && cm >= 1 && mur != null;
  const num = Math.round(cm);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" {...fondModal(onCancel)}>
      <div className="card w-full max-w-xs" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">Mur</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div>
            <label className="label">Longueur intérieure (cm)</label>
            <input autoFocus className="input" inputMode="numeric" value={valeur}
              onChange={e => setValeur(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && valide && mur) onValidate(num, mur); }} />
          </div>
          <div>
            <label className="label">Les 3 couches du mur (cm), de l&apos;intérieur vers l&apos;extérieur</label>
            <ChampsMur valeur={saisieMur} onChange={setSaisieMur} />
            <p className="text-[11px] text-ink-400 mt-1.5">Longueur mesurée de face finie à face finie. Les couches s&apos;ajoutent à l&apos;intérieur du tracé (0 = aucune) ; les circuits passent par défaut dans la couche 2.</p>
          </div>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button disabled={!valide} onClick={() => mur && onValidate(num, mur)} className="btn-volt flex-1 disabled:opacity-40">Valider</button>
        </div>
      </div>
    </div>
  );
}

export function NiveauForm({ onValidate, onCancel }: { onValidate: (nom: string, type: NiveauType, hauteurPlafond: number) => void; onCancel: () => void }) {
  const [nom, setNom] = useState("");
  const [type, setType] = useState<NiveauType>("etage");
  const [hauteurPlafond, setHauteurPlafond] = useState("2.50");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" {...fondModal(onCancel)}>
      <div className="card w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">Nouveau niveau</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div>
            <label className="label">Nom</label>
            <input autoFocus className="input" placeholder={type === "annexe" ? "Ex: Pool house, Garage indépendant…" : "Ex: R+1, Combles…"} value={nom} onChange={e => setNom(e.target.value)} />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={type} onChange={e => setType(e.target.value as NiveauType)}>
              {Object.entries(NIVEAU_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <p className="text-[11px] text-ink-400 mt-1">
              {type === "annexe"
                ? "Une annexe (pool house, dépendance…) a son propre tableau électrique, à positionner sur son plan."
                : "Les niveaux de la maison partagent un seul tableau : pour chacun, tu renseignes sa distance au tableau."}
            </p>
          </div>
          <div>
            <label className="label">Hauteur sous plafond (m) — pour la vue 3D</label>
            <input className="input" inputMode="decimal" value={hauteurPlafond} onChange={e => setHauteurPlafond(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button onClick={() => onValidate(nom, type, parseFloat(hauteurPlafond.replace(",", ".")) || 2.5)} className="btn-volt flex-1"><Save size={14} /> Ajouter</button>
        </div>
      </div>
    </div>
  );
}

export function CommandeLinkForm({ niveau, niveaux, item, onValidate, onCancel }: {
  niveau: Niveau; niveaux: Niveau[]; item: AppareillagePlace;
  onValidate: (pointLumineuxIds: number[], pointLumineuxIds2: number[]) => void; onCancel: () => void;
}) {
  // Points lumineux de tous les niveaux (niveau courant d'abord) : une commande peut piloter une lampe d'un autre étage.
  const points = [niveau, ...niveaux.filter(n => n.id !== niveau.id)].flatMap(n => n.pieces.flatMap(p =>
    p.appareillages.filter(a => estLumiere(a.type)).map(a => ({ a, pieceNom: n.id === niveau.id ? p.nom : `${n.nom} · ${p.nom}` }))));
  const double = estCommandeDouble(item.type);
  // Double : chaque lampe va sur la voie 1, la voie 2 ou aucune (jamais les deux). Par défaut, voie 1 = 1re lampe, voie 2 = 2e.
  const [choix, setChoix] = useState<number[]>(item.commandePourIds ?? (points[0] ? [points[0].a.id] : []));
  const [choix2, setChoix2] = useState<number[]>(item.commandePourIds2 ?? (double && !item.commandePourIds && points[1] ? [points[1].a.id] : []));
  const toggle = (id: number) => setChoix(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id]);
  const setVoie = (id: number, voie: 1 | 2) => {
    const dansVoie = (voie === 1 ? choix : choix2).includes(id);
    setChoix(c => c.filter(x => x !== id).concat(voie === 1 && !dansVoie ? [id] : []));
    setChoix2(c => c.filter(x => x !== id).concat(voie === 2 && !dansVoie ? [id] : []));
  };
  const total = choix.length + (double ? choix2.length : 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" {...fondModal(onCancel)}>
      <div className="card w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">{labelAppareillage(item.type)} — quel(s) point(s) lumineux ?</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-1 max-h-64 overflow-y-auto">
          {double && points.length > 0 && <p className="text-[11px] text-ink-400 mb-1">Un double a deux voies : chaque lampe se règle sur la voie 1 ou la voie 2.</p>}
          {points.length === 0 ? (
            <p className="text-sm text-ink-400">Aucun point lumineux placé dans la maison. Place d'abord un ou plusieurs points lumineux, puis leur commande.</p>
          ) : points.map(({ a, pieceNom }) => double ? (
            <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-ink-50">
              <span className="text-sm text-ink-700 flex-1 min-w-0 truncate">{pieceNom || "Pièce"} — {a.nom || `point lumineux #${a.id}`}</span>
              {([1, 2] as const).map(v => (
                <button key={v} onClick={() => setVoie(a.id, v)}
                  className={`${(v === 1 ? choix : choix2).includes(a.id) ? "btn-volt" : "btn-ghost"} !text-xs !px-2 !py-0.5 shrink-0`}>Voie {v}</button>
              ))}
            </div>
          ) : (
            <label key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-ink-50 cursor-pointer">
              <input type="checkbox" checked={choix.includes(a.id)} onChange={() => toggle(a.id)} />
              <span className="text-sm text-ink-700">{pieceNom || "Pièce"} — {a.nom || `point lumineux #${a.id}`}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button disabled={total === 0} onClick={() => onValidate(choix, double ? choix2 : [])} className="btn-volt flex-1 disabled:opacity-40">
            {double ? `Lier (voie 1 : ${choix.length} · voie 2 : ${choix2.length})` : `Lier (${choix.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

// Filtre d'affichage du plan : ne montrer que certaines familles d'appareillages (et leurs circuits).
export type FiltreAffichage = "tout" | "prises" | "lumieres" | "specialises" | "faibles";
export const FILTRES_AFFICHAGE: { id: FiltreAffichage; label: string }[] = [
  { id: "tout", label: "Tout" }, { id: "prises", label: "Prises" }, { id: "lumieres", label: "Lumières + interrupteurs" },
  { id: "specialises", label: "Circuits spécialisés" }, { id: "faibles", label: "Courants faibles" },
];
export function estDansFiltre(a: Pick<AppareillagePlace, "type" | "usageDedie">, f: FiltreAffichage): boolean {
  switch (f) {
    case "tout": return true;
    case "prises": return a.type === "prise" || a.type === "prise_commandee" || a.type === "prise_exterieure";
    case "lumieres": return estLumiere(a.type) || estCommande(a.type);
    case "faibles": return estCourantFaible(a.type);
    case "specialises": return !!cleCircuitDedie(a) || a.type === "chauffage" || a.type === "volet_roulant" || estCommandeService(a.type);
  }
}

// Outil « Générer un circuit de lumière » : on coche les POINTS LUMINEUX voulus ; les commandes qui les pilotent (interrupteurs, va-et-vient,
// télérupteurs…) et les autres lampes qu'elles commandent sont ajoutées d'office, et tout le câblage (alimentation, retours, navettes) est
// généré d'après ces liens commande ↔ lampe — sans rien relier à la main.
// Boîte de dérivation sur le plan : bien visible quel que soit le zoom — pastille 22 px, halo blanc, bornes Wago (3 leviers), nom en étiquette.
// Boîte de dérivation : volontairement GROSSE et cerclée de la couleur du circuit — c'est le point où le câble du tableau se divise
// en plusieurs départs (nbDeparts), et c'est elle qui structure tout le cheminement du circuit.
export function symboleBoitePlan(p: Point, color: string, nom: string, selectionnee: boolean, nbDeparts?: number): JSX.Element {
  const etiquette = nbDeparts && nbDeparts > 0 ? `${nom} · ${nbDeparts} départ${nbDeparts > 1 ? "s" : ""}` : nom;
  const largeur = Math.max(54, etiquette.length * 6.4 + 14);
  return (
    <g>
      <circle cx={p.x} cy={p.y} r={30} fill={selectionnee ? "#FEF3C7" : "#ffffff"} fillOpacity={0.92} stroke={color} strokeWidth={3.5} strokeDasharray="5 3" />
      <rect x={p.x - 16} y={p.y - 16} width={32} height={32} rx={4} fill="#ffffff" stroke="#1c1917" strokeWidth={2.8} />
      <rect x={p.x - 16} y={p.y - 16} width={32} height={8} rx={3} fill={color} />
      {[-9, 0, 9].map(dx => (<g key={dx}><rect x={p.x + dx - 3.6} y={p.y - 5} width={7.2} height={13} rx={1.3} fill="#e7e5e4" stroke="#57534e" strokeWidth={1} /><rect x={p.x + dx - 3.6} y={p.y - 7} width={7.2} height={4} rx={1.3} fill="#a8a29e" /></g>))}
      <rect x={p.x - largeur / 2} y={p.y - 52} width={largeur} height={18} rx={9} fill="#1c1917" stroke={color} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
      <text x={p.x} y={p.y - 39.5} textAnchor="middle" fontSize="11" fontWeight="700" fill="#ffffff" style={{ pointerEvents: "none" }}>{etiquette}</text>
      {selectionnee && <circle cx={p.x} cy={p.y} r={34} fill="none" stroke="#F59E0B" strokeWidth={2.5} />}
    </g>
  );
}

export function CircuitLumiereForm({ niveaux, niveauActifId, onValidate, onCancel }: {
  niveaux: Niveau[];
  niveauActifId: number;
  onValidate: (nom: string, couleur: string | undefined, membreIds: number[], creerBoite: boolean) => void;
  onCancel: () => void;
}) {
  const [nom, setNom] = useState("");
  const [couleur, setCouleur] = useState("");
  const [creerBoite, setCreerBoite] = useState(false);
  const [choisies, setChoisies] = useState<Set<number>>(new Set());
  // Tous les étages : un va-et-vient peut être à un autre niveau que sa lampe (la liaison passe par la gaine technique).
  const plusieursNiveaux = niveaux.length > 1;
  const tous = niveaux.flatMap(n => n.pieces.flatMap(p => p.appareillages));
  const pieceDe = new Map<number, string>();
  const niveauDe = new Map<number, Niveau>();
  niveaux.forEach(n => n.pieces.forEach(p => p.appareillages.forEach(a => { pieceDe.set(a.id, `${plusieursNiveaux ? `${n.nom || n.type} · ` : ""}${p.nom || "Pièce"}`); niveauDe.set(a.id, n); })));
  const lampesParPiece = [...niveaux].sort((a, b) => (a.id === niveauActifId ? -1 : b.id === niveauActifId ? 1 : 0))
    .flatMap(n => n.pieces.map(p => ({ nom: `${plusieursNiveaux ? `${n.nom || n.type} · ` : ""}${p.nom || "Pièce"}`, lampes: p.appareillages.filter(a => estLumiere(a.type)) })))
    .filter(g => g.lampes.length > 0);
  const { lampes, commandes } = fermetureCircuitLumiere(tous, choisies);
  const ajoutees = lampes.filter(id => !choisies.has(id));
  const parId = new Map(tous.map(a => [a.id, a]));
  const nomDe = (a: AppareillagePlace) => `${labelAppareillagePlace(a)} (${pieceDe.get(a.id) ?? "?"})`;
  const partagees = commandesPartagees(tous, commandes, new Set(lampes));   // double va-et-vient dont l'autre voie sert un autre circuit : il y reste
  const membres = new Set<number>([...lampes, ...commandes.filter(id => !partagees.has(id))]);
  const bilan = lampes.length > 0 ? verifierEclairageManuel(tous, membres, nomDe) : null;
  const circuitsManuelsTous = niveaux.flatMap(n => n.circuitsManuels ?? []);
  const autreCircuit = (id: number) => { const m = parId.get(id)?.circuitManuelId; return m != null ? circuitsManuelsTous.find(c => c.id === m && c.nom) : undefined; };
  // Niveaux traversés par le circuit : chacun doit avoir son point d'arrivée des gaines (ou son tableau) pour que la liaison se trace.
  const niveauxConcernes = niveaux.filter(n => [...membres].some(id => niveauDe.get(id)?.id === n.id));
  const sansGaine = niveauxConcernes.length > 1 ? niveauxConcernes.filter(n => !origineCircuits(n)) : [];
  const bascule = (ids: number[], on: boolean) => setChoisies(s => { const n = new Set(s); ids.forEach(id => (on ? n.add(id) : n.delete(id))); return n; });
  const valide = nom.trim() !== "" && lampes.length > 0 && !(bilan && bilan.bloquants.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" {...fondModal(onCancel)}>
      <div className="card w-full max-w-lg max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">Générer un circuit de lumière</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1">
          <p className="text-xs text-ink-500">Coche les points lumineux de ce circuit. Les interrupteurs / va-et-vient qui les commandent sont ajoutés automatiquement, et le câblage (alimentation, retours, navettes) est tracé d'après eux.</p>
          <div className="flex items-center gap-2">
            <input autoFocus className="input flex-1" placeholder="Nom du circuit (ex : Lumière RDC)" value={nom} onChange={e => setNom(e.target.value)} />
            <input type="color" title="Couleur du circuit" className="w-10 h-9 rounded-lg border border-ink-200 cursor-pointer p-0" value={couleur || "#78716c"} onChange={e => setCouleur(e.target.value)} />
          </div>
          <div>
            <label className="label">Points lumineux ({choisies.size} choisi{choisies.size > 1 ? "s" : ""}{ajoutees.length > 0 ? ` + ${ajoutees.length} ajouté${ajoutees.length > 1 ? "s" : ""} (même voie de commande)` : ""})</label>
            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto border border-ink-100 rounded-lg p-1.5">
              {lampesParPiece.length === 0 && <p className="text-xs text-ink-400 px-1 py-1">Aucun point lumineux sur ce niveau.</p>}
              {lampesParPiece.map(g => {
                const ids = g.lampes.map(l => l.id);
                const toutes = ids.every(id => choisies.has(id));
                return (
                  <div key={g.nom}>
                    <div className="flex items-center justify-between px-1.5">
                      <span className="text-[11px] font-semibold text-ink-600">{g.nom}</span>
                      <button type="button" className="text-[10px] text-volt-600 underline" onClick={() => bascule(ids, !toutes)}>{toutes ? "Tout décocher" : "Tout cocher"}</button>
                    </div>
                    {g.lampes.map(l => (
                      <label key={l.id} className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-ink-50 cursor-pointer text-xs">
                        <input type="checkbox" checked={choisies.has(l.id) || ajoutees.includes(l.id)} disabled={ajoutees.includes(l.id)} onChange={() => bascule([l.id], !choisies.has(l.id))} />
                        <AppareillageSymbol type={l.type} size={14} />
                        <span className="text-ink-700 truncate flex-1">{l.nom || labelAppareillagePlace(l)}</span>
                        {ajoutees.includes(l.id) && <span className="text-[10px] text-sky-600 shrink-0">ajouté (même voie)</span>}
                        {autreCircuit(l.id) && <span className="text-[10px] text-amber-600 shrink-0 whitespace-nowrap">sur « {autreCircuit(l.id)!.nom} »</span>}
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          {lampes.length > 0 && (
            <div>
              <label className="label">Commandes qui pilotent ces lampes ({commandes.length})</label>
              <div className="flex flex-col gap-0.5 border border-ink-100 rounded-lg p-1.5">
                {commandes.length === 0 && <p className="text-xs text-red-600 px-1 py-1">Aucune commande reliée à ces lampes.</p>}
                {commandes.map(id => { const c = parId.get(id)!; return (
                  <div key={id} className="flex items-center gap-2 px-1.5 py-0.5 text-xs">
                    <AppareillageSymbol type={c.type} size={14} />
                    <span className="text-ink-700 truncate flex-1">{nomDe(c)} → {[c.commandePourIds ?? [], c.commandePourIds2 ?? []].map((voie, v) => { const ls = voie.filter(i => lampes.includes(i)).map(i => parId.get(i)).filter((l): l is AppareillagePlace => !!l).map(l => l.nom || labelAppareillagePlace(l)); return ls.length ? `${estCommandeDouble(c.type) ? `voie ${v === 0 ? "A" : "B"} : ` : ""}${ls.join(", ")}` : ""; }).filter(Boolean).join(" · ") || "—"}</span>
                    {partagees.has(id) ? <span className="text-[10px] text-sky-600 shrink-0 whitespace-nowrap">reste sur « {circuitsManuelsTous.find(m => m.id === partagees.get(id))?.nom ?? "autre circuit"} » (son autre voie)</span>
                      : autreCircuit(id) && <span className="text-[10px] text-amber-600 shrink-0 whitespace-nowrap">déplacé depuis « {autreCircuit(id)!.nom} »</span>}
                  </div>
                ); })}
              </div>
            </div>
          )}
          {bilan && bilan.bloquants.length > 0 && (
            <div className="rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2.5" role="alert">
              <p className="text-xs font-bold text-red-800 mb-1.5">⛔ Câblage impossible tant que ces points ne sont pas réglés sur le plan</p>
              <ul className="space-y-1">{bilan.bloquants.map((pb, i) => <li key={i} className="text-xs text-red-800 leading-snug">• {pb.message}</li>)}</ul>
            </div>
          )}
          {niveauxConcernes.length > 1 && (
            <p className="text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-2">
              Circuit sur {niveauxConcernes.length} étages ({niveauxConcernes.map(n => n.nom || n.type).join(", ")}) : les commandes d'un autre étage sont reliées à leur lampe par la gaine technique (point d'arrivée des gaines de chaque niveau).
              {sansGaine.length > 0 && <span className="block font-semibold text-amber-700 mt-1">⚠ Place d'abord le point d'arrivée des gaines sur : {sansGaine.map(n => n.nom || n.type).join(", ")} — sinon la liaison n'est pas tracée sur ce niveau.</span>}
            </p>
          )}
          {bilan && bilan.bloquants.length === 0 && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-2">✓ Chaque lampe a sa commande (retour) et chaque va-et-vient son second (navette) : le câblage sera généré complet.</p>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={creerBoite} onChange={e => setCreerBoite(e.target.checked)} />
            <span className="text-sm text-ink-700">Créer une boîte de dérivation pour ce circuit</span>
          </label>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200 shrink-0">
          <button disabled={!valide} onClick={() => onValidate(nom.trim(), couleur || undefined, Array.from(membres), creerBoite)}
            className="btn-volt flex-1 disabled:opacity-40"><Save size={14} /> Générer le circuit et son câblage</button>
        </div>
      </div>
    </div>
  );
}

export function CircuitManuelForm({ niveau, existing, onValidate, onCancel, onDelete }: {
  niveau: Niveau;
  existing: CircuitManuel | null; // null = création, sinon édition de ce circuit
  onValidate: (nom: string, famille: FamilleCircuitManuel, couleur: string | undefined, membreIds: number[], creerBoite: boolean, nonRelieTableau: boolean, relier: boolean) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [nom, setNom] = useState(existing?.nom ?? "");
  const [famille, setFamille] = useState<FamilleCircuitManuel>(existing?.famille ?? "prise_16");
  const [couleur, setCouleur] = useState(existing?.couleur ?? "");
  const [creerBoite, setCreerBoite] = useState(false);
  const [relier, setRelier] = useState(!existing);
  const [nonRelieTableau, setNonRelieTableau] = useState(existing?.nonRelieTableau ?? false);
  const tousAppareils = niveau.pieces.flatMap(p => p.appareillages.filter(a => !estCourantFaible(a.type)).map(a => ({ a, pieceNom: p.nom }))); // RJ45 / TV : courant faible, pas de circuit de puissance
  const [membres, setMembres] = useState<Set<number>>(
    () => new Set(existing ? tousAppareils.filter(({ a }) => a.circuitManuelId === existing.id).map(({ a }) => a.id) : []),
  );
  const toggleMembre = (id: number) => setMembres(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  // Éclairage manuel : chaque lampe a sa commande (= son retour), chaque va-et-vient son second (= sa navette). BLOQUANT : tant que
  // retours et navettes ne sont pas tous dans le circuit, il ne peut pas être enregistré.
  const verifEclairage = (() => {
    if (famille !== "lumiere" || membres.size === 0) return null;
    const pieceDe = new Map<number, string>();
    niveau.pieces.forEach(p => p.appareillages.forEach(a => pieceDe.set(a.id, p.nom || "Pièce")));
    return verifierEclairageManuel(niveau.pieces.flatMap(p => p.appareillages), membres,
      a => `${labelAppareillagePlace(a)} (${pieceDe.get(a.id) ?? "?"})`);
  })();
  const eclairageBloque = !!verifEclairage && verifEclairage.bloquants.length > 0;
  const nomValide = nom.trim() !== "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" {...fondModal(onCancel)}>
      <div className="card w-full max-w-md max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">{existing ? "Modifier le circuit manuel" : "Nouveau circuit manuel"}</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1">
          <div>
            <label className="label">Nom</label>
            <input autoFocus className="input" placeholder="Ex: Prises salon nord" value={nom} onChange={e => setNom(e.target.value)} />
          </div>
          <div>
            <label className="label">Type de circuit</label>
            <select className="input" value={famille} onChange={e => setFamille(e.target.value)}>
              {CIRCUIT_KEYS_MANUELS.map(k => <option key={k} value={k}>{CIRCUITS[k].icon} {CIRCUITS[k].label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Couleur — vide = couleur automatique</label>
            <div className="flex items-center gap-2">
              <input type="color" className="w-10 h-8 rounded-lg border border-ink-200 cursor-pointer p-0"
                value={couleur || "#78716c"} onChange={e => setCouleur(e.target.value)} />
              {couleur && <button onClick={() => setCouleur("")} className="text-xs text-ink-400 underline">Réinitialiser</button>}
            </div>
          </div>
          {!existing && famille === "lumiere" && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={creerBoite} onChange={e => setCreerBoite(e.target.checked)} />
              <span className="text-sm text-ink-700">Créer une boîte de dérivation pour ce circuit</span>
            </label>
          )}
          <label className="flex items-start gap-2 cursor-pointer border-t border-ink-100 pt-2">
            <input type="checkbox" className="mt-0.5" checked={relier} onChange={e => setRelier(e.target.checked)} />
            <span className="text-sm text-ink-700">Relier les points sur le plan maintenant<span className="block text-xs text-ink-400">Le circuit existe tout de suite (pas besoin de générer) : clique ensuite ses appareillages dans l&apos;ordre du câble — ceux qui ne sont pas encore dans la liste ci-dessous s&apos;ajoutent au circuit au clic.</span></span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer border-t border-ink-100 pt-2">
            <input type="checkbox" checked={nonRelieTableau} onChange={e => setNonRelieTableau(e.target.checked)} />
            <span className="text-sm text-ink-700">Circuit déjà existant — non relié au tableau (piquage sur une installation en place)</span>
          </label>
          {nonRelieTableau && (
            <p className="text-xs text-ink-400 -mt-1.5">Aucun disjoncteur n'est ajouté au tableau pour ce circuit, et le câblage n'est tracé qu'entre ses appareillages — jamais jusqu'au tableau.</p>
          )}
          {(() => {
            const msg = messageDepassement(famille, tousAppareils.filter(({ a }) => membres.has(a.id)).map(({ a }) => a), nom.trim() || undefined);
            return msg ? <p className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">⚠ {msg}</p> : null;
          })()}
          {verifEclairage && verifEclairage.bloquants.length > 0 && (
            <div className="rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2.5" role="alert">
              <p className="text-xs font-bold text-red-800 mb-1.5">⛔ Retours / navettes manquants : impossible d&apos;enregistrer ce circuit d&apos;éclairage</p>
              <ul className="space-y-1">
                {verifEclairage.bloquants.map((pb, i) => <li key={i} className="text-xs text-red-800 leading-snug">• {pb.message}</li>)}
              </ul>
              {verifEclairage.aAjouter.length > 0 && (
                <button type="button" className="btn-volt !text-xs !py-1.5 mt-2.5"
                  onClick={() => setMembres(s => new Set([...s, ...verifEclairage.aAjouter]))}>
                  Ajouter au circuit les {verifEclairage.aAjouter.length} élément{verifEclairage.aAjouter.length > 1 ? "s" : ""} manquant{verifEclairage.aAjouter.length > 1 ? "s" : ""}
                </button>
              )}
            </div>
          )}
          {verifEclairage && verifEclairage.bloquants.length === 0 && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-2">✓ Chaque lampe a sa commande (retour) et chaque va-et-vient son second (navette).</p>
          )}
          <div>
            <label className="label">Appareillages sur ce circuit ({membres.size})</label>
            <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto border border-ink-100 rounded-lg p-1.5">
              {tousAppareils.length === 0 ? (
                <p className="text-xs text-ink-400 px-1 py-1">Aucun appareillage sur ce niveau.</p>
              ) : tousAppareils.map(({ a, pieceNom }) => (
                <label key={a.id} className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-ink-50 cursor-pointer text-xs">
                  <input type="checkbox" checked={membres.has(a.id)} onChange={() => toggleMembre(a.id)} />
                  <AppareillageSymbol type={a.type} size={14} />
                  <span className="text-ink-700 truncate flex-1">{pieceNom || "Pièce"} — {a.nom || labelAppareillagePlace(a)}</span>
                  {a.circuitManuelId != null && a.circuitManuelId !== existing?.id && (
                    <span className="text-[10px] text-amber-600 shrink-0 whitespace-nowrap">déjà sur un autre circuit</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200 shrink-0">
          <button disabled={!nomValide || eclairageBloque} onClick={() => onValidate(nom.trim(), famille, couleur || undefined, Array.from(membres), creerBoite, nonRelieTableau, relier)}
            title={eclairageBloque ? "Ajoute les commandes (retours) et va-et-vient (navettes) manquants pour pouvoir enregistrer" : undefined}
            className="btn-volt flex-1 disabled:opacity-40"><Save size={14} /> {existing ? "Enregistrer" : "Créer"}</button>
          {onDelete && <button onClick={onDelete} className="btn-danger !px-3"><Trash2 size={14} /></button>}
        </div>
      </div>
    </div>
  );
}

// ─── PALETTE ────────────────────────────────────────────────────────────────────

// Icône simple porte/fenêtre — pas de symbole normalisé dédié, juste de quoi
// distinguer les deux boutons et l'ouverture posée sur le plan.
// Aide courte affichée sous le choix du type de porte.
export function u_aide(u: UsagePorte): string {
  return u === "entree" ? "Porte principale (pleine, seuil, serrure) — s'ouvre en 3D en cliquant dessus."
    : u === "service" ? "Porte secondaire sur l'extérieur (vitrée en partie haute, seuil) — s'ouvre en 3D."
    : "Porte entre deux pièces — s'ouvre en 3D en cliquant dessus.";
}

export const LABEL_OUVERTURE: Record<OuvertureType, string> = {
  porte: "Porte", porte_coulissante: "Porte coulissante", porte_garage: "Porte de garage basculante", baie_vitree: "Baie vitrée coulissante", fenetre: "Fenêtre (1 ou 2 battants)", ouverture: "Ouverture murale",
};

export function OuvertureIcon({ type, size = 16, color = "currentColor" }: { type: OuvertureType; size?: number; color?: string }) {
  switch (type) {
    case "porte":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path d="M3 14V2l9 2v10" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
          <path d="M3 14 A9 9 0 0 0 12 5" stroke={color} strokeWidth={1} strokeDasharray="1.5,1.3" />
        </svg>
      );
    case "porte_coulissante":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <rect x={1} y={3} width={6} height={10} stroke={color} strokeWidth={1.3} />
          <rect x={7} y={3} width={6} height={10} stroke={color} strokeWidth={1.3} strokeDasharray="1.4,1.2" />
          <path d="M9 1 h3 M12 1 l-1.6 -1.2 M12 1 l-1.6 1.2" stroke={color} strokeWidth={0.9} />
        </svg>
      );
    case "porte_garage":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <rect x={2} y={4} width={12} height={10} stroke={color} strokeWidth={1.4} />
          <path d="M2 7h12M2 10h12" stroke={color} strokeWidth={1} />
          <path d="M5 2.5 L8 1 L11 2.5" stroke={color} strokeWidth={0.9} />
        </svg>
      );
    case "baie_vitree":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <rect x={1.5} y={2.5} width={13} height={11} stroke={color} strokeWidth={1.4} />
          <path d="M8 2.5v11" stroke={color} strokeWidth={1.2} />
          <path d="M3.5 8h3M5.3 6.6L6.7 8l-1.4 1.4" stroke={color} strokeWidth={0.9} />
        </svg>
      );
    case "fenetre":
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <rect x={2} y={4} width={12} height={8} stroke={color} strokeWidth={1.4} />
          <path d="M8 4v8M2 8h12" stroke={color} strokeWidth={1.2} />
        </svg>
      );
    case "ouverture":
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <rect x={2} y={3} width={12} height={10} stroke={color} strokeWidth={1.2} strokeDasharray="2,1.5" />
        </svg>
      );
  }
}


// Configurateur d'appareillage multiple : nombre de postes (2 à 4) puis, pour chaque poste, ce qu'il porte
// (prise, prise commandée, interrupteur, va-et-vient, bouton poussoir, RJ45, prise dédiée + appareil alimenté).
export function PlaqueForm({ initial, onValider, onCancel }: {
  initial: PosteSpec[]; onValider: (postes: PosteSpec[]) => void; onCancel: () => void;
}) {
  const [postes, setPostes] = useState<PosteSpec[]>(initial.length >= MIN_POSTES_PLAQUE ? initial : [{ type: "prise" }, { type: "prise" }]);
  const nomPlaque = (n: number) => n === 2 ? "double" : n === 3 ? "triple" : "quadruple";
  const changerNombre = (n: number) => setPostes(ps => n <= ps.length ? ps.slice(0, n) : [...ps, ...Array.from({ length: n - ps.length }, (): PosteSpec => ({ type: "prise" }))]);
  const majPoste = (i: number, patch: Partial<PosteSpec>) => setPostes(ps => ps.map((po, k) => {
    if (k !== i) return po;
    const type = patch.type ?? po.type;
    return { type, ...(type === "prise_dediee" ? { usageDedie: patch.usageDedie ?? po.usageDedie ?? USAGE_DEDIE_DEFAUT } : {}) };
  }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" {...fondModal(onCancel)}>
      <div className="card w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">Appareillage {nomPlaque(postes.length)} ({postes.length} postes)</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs text-ink-500">
            <span className="shrink-0">Nombre de postes</span>
            {[2, 3, 4].map(n => (
              <button key={n} onClick={() => changerNombre(n)}
                className={`${postes.length === n ? "btn-volt" : "btn-ghost"} !text-xs !py-1 flex-1 justify-center`}>
                {n === 2 ? "Double" : n === 3 ? "Triple" : "Quadruple"}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-center gap-1 py-2 bg-ink-50 rounded-lg border border-ink-200">
            {postes.map((po, i) => (
              <div key={i} className="w-12 h-12 bg-white border border-ink-300 rounded flex items-center justify-center">
                <AppareillageSymbol type={po.type} size={24} />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
            {postes.map((po, i) => (
              <div key={i} className="flex flex-col gap-1 p-2 rounded-lg border border-ink-200">
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="shrink-0 w-14">Poste {i + 1}</span>
                  <select className="input !py-1 !text-xs flex-1" value={po.type}
                    onChange={e => majPoste(i, { type: e.target.value as AppareillageType })}>
                    {TYPES_POSTE_PLAQUE.map(t => <option key={t} value={t}>{labelAppareillage(t)}</option>)}
                  </select>
                </div>
                {po.type === "prise_dediee" && (
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="shrink-0 w-14">Appareil</span>
                    <select className="input !py-1 !text-xs flex-1" value={po.usageDedie ?? USAGE_DEDIE_DEFAUT}
                      onChange={e => majPoste(i, { usageDedie: e.target.value as AppareillageType })}>
                      {TYPES_USAGE_DEDIE.map(t => <option key={t} value={t}>{LIBELLE_USAGE_DEDIE[t]}</option>)}
                    </select>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-ink-400">Les postes sont placés côte à côte (entraxe 71 mm), même hauteur, une seule boîte d'encastrement et une seule plaque. Chaque poste garde son propre circuit.</p>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button onClick={() => onValider(postes)} className="btn-volt flex-1">Placer sur un mur</button>
        </div>
      </div>
    </div>
  );
}

export function PaletteBoutons({ placementType, onSelect, plaquePostes, onPlaque }: {
  placementType: AppareillageType | null; onSelect: (t: AppareillageType | null) => void;
  plaquePostes: PosteSpec[] | null; onPlaque: () => void;
}) {
  const categories = Array.from(new Set(PALETTE.map(p => p.categorie)));
  const plaqueActive = !!placementType && !!plaquePostes;
  return (
    <>
      <div className="mb-3">
        <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Appareillage multiple</p>
        <button onClick={onPlaque}
          className={`w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
            plaqueActive ? "bg-ink-900 border-ink-700 text-volt-400" : "bg-ink-50 border-ink-200 text-ink-700 hover:border-ink-400"}`}>
          <span className="flex items-center gap-0.5">
            {(plaqueActive ? plaquePostes! : [{ type: "prise" as AppareillageType }, { type: "interrupteur" as AppareillageType }]).map((po, i) => (
              <AppareillageSymbol key={i} type={po.type} size={14} color={plaqueActive ? "#FBBF24" : "#44403c"} />
            ))}
          </span>
          {plaqueActive ? `Plaque ${plaquePostes!.length} postes — modifier` : "Double · triple · quadruple…"}
        </button>
      </div>
      {categories.map(cat => (
        <div key={cat} className="mb-3">
          <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">{cat}</p>
          <div className="grid grid-cols-5 md:grid-cols-4 gap-1.5">
            {PALETTE.filter(p => p.categorie === cat).map(p => (
              <button key={p.type} title={p.label}
                onClick={() => onSelect(placementType === p.type ? null : p.type)}
                className={`flex items-center justify-center p-1.5 rounded-lg border transition-colors shrink-0 ${
                  placementType === p.type ? "bg-ink-900 border-ink-700" : "bg-ink-50 border-ink-200 hover:border-ink-400"
                }`}>
                <AppareillageSymbol type={p.type} size={18} color={placementType === p.type ? "#FBBF24" : "#44403c"} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export function PrintForm({ niveaux, resultatDisponible, onValider, onCancel }: {
  niveaux: Niveau[]; resultatDisponible: boolean;
  onValider: (piecesSelectionnees: Set<number> | null, avecCircuits: boolean, avecLongueurs: boolean, avecHauteurs: boolean, avecCotes: boolean, avecCotesPieces: boolean, avecCotesExt: boolean, avecCotesOuv: boolean) => void;
  onCancel: () => void;
}) {
  const toutesPieces = niveaux.flatMap(n => n.pieces.map(p => p.id));
  const [selection, setSelection] = useState<Set<number>>(new Set(toutesPieces));
  const [avecCircuits, setAvecCircuits] = useState(resultatDisponible);
  const [avecLongueurs, setAvecLongueurs] = useState(false);
  const [avecHauteurs, setAvecHauteurs] = useState(false);
  const [avecCotes, setAvecCotes] = useState(false);
  const [avecCotesPieces, setAvecCotesPieces] = useState(false);
  const [avecCotesExt, setAvecCotesExt] = useState(false);
  const [avecCotesOuv, setAvecCotesOuv] = useState(false);
  const toutSelectionne = selection.size === toutesPieces.length;

  const toggle = (id: number) => setSelection(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" {...fondModal(onCancel)}>
      <div className="card w-full max-w-sm max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">Imprimer le plan</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1">
          <div className="flex items-center justify-between">
            <label className="label mb-0">Pièces à inclure</label>
            <button className="text-xs text-volt-600 font-semibold"
              onClick={() => setSelection(toutSelectionne ? new Set() : new Set(toutesPieces))}>
              {toutSelectionne ? "Tout désélectionner" : "Tout sélectionner"}
            </button>
          </div>
          {[...niveaux].sort((a, b) => a.ordre - b.ordre).map(n => (
            <div key={n.id} className="border border-ink-200 rounded-xl overflow-hidden">
              <div className="px-3 py-1.5 bg-ink-100 text-xs font-bold text-ink-700 font-mono">{n.nom || NIVEAU_TYPES[n.type]}</div>
              <div className="p-2 flex flex-col gap-0.5">
                {n.pieces.length === 0 ? (
                  <p className="text-xs text-ink-400 px-2 py-1">Aucune pièce</p>
                ) : n.pieces.map(p => (
                  <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-ink-50 cursor-pointer">
                    <input type="checkbox" checked={selection.has(p.id)} onChange={() => toggle(p.id)} />
                    <span className="text-sm text-ink-700">{p.nom || PIECE_TYPES[p.type].label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-1.5 pt-2 border-t border-ink-100">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={avecHauteurs} onChange={e => setAvecHauteurs(e.target.checked)} />
              <span className="text-sm text-ink-700">Afficher les hauteurs d'implantation (appareillages + gaines)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={avecCotes} onChange={e => setAvecCotes(e.target.checked)} />
              <span className="text-sm text-ink-700">Afficher les cotes des appareillages (cm, depuis le coin intérieur le plus proche)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={avecCotesPieces} onChange={e => setAvecCotesPieces(e.target.checked)} />
              <span className="text-sm text-ink-700">Afficher les cotes des pièces (dimensions intérieures + épaisseurs de murs)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={avecCotesOuv} onChange={e => setAvecCotesOuv(e.target.checked)} />
              <span className="text-sm text-ink-700">Afficher les cotes des ouvertures (chaîne coin → baie → coin)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={avecCotesExt} onChange={e => setAvecCotesExt(e.target.checked)} />
              <span className="text-sm text-ink-700">Afficher les cotes extérieures (murs extérieurs + hors-tout)</span>
            </label>
            {resultatDisponible && (
              <>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={avecCircuits}
                    onChange={e => { const v = e.target.checked; setAvecCircuits(v); if (!v) setAvecLongueurs(false); }} />
                  <span className="text-sm text-ink-700">Inclure les circuits (couleurs + gaines)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={avecLongueurs} disabled={!avecCircuits} onChange={e => setAvecLongueurs(e.target.checked)} />
                  <span className={`text-sm ${avecCircuits ? "text-ink-700" : "text-ink-300"}`}>Afficher la longueur de chaque segment de circuit</span>
                </label>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200 shrink-0">
          <button disabled={selection.size === 0}
            onClick={() => onValider(toutSelectionne ? null : selection, avecCircuits, avecLongueurs, avecHauteurs, avecCotes, avecCotesPieces, avecCotesExt, avecCotesOuv)}
            className="btn-volt flex-1 disabled:opacity-40">
            <Printer size={14} /> Imprimer ({selection.size} pièce{selection.size > 1 ? "s" : ""})
          </button>
        </div>
      </div>
    </div>
  );
}

export function Print3DForm({ niveaux, niveauActifId, onValider, onCancel }: {
  niveaux: Niveau[]; niveauActifId: number | null;
  onValider: (niveauId: number) => void; onCancel: () => void;
}) {
  const [choix, setChoix] = useState<number>(niveauActifId ?? niveaux[0]?.id);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4" {...fondModal(onCancel)}>
      <div className="card w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-ink-200">
          <p className="font-semibold text-ink-900">Imprimer la vue 3D</p>
          <button onClick={onCancel} className="btn-ghost !px-2 !py-1 text-ink-400"><X size={16} /></button>
        </div>
        <div className="p-4">
          <label className="label">Niveau à imprimer</label>
          <select className="input" value={choix} onChange={e => setChoix(Number(e.target.value))}>
            {[...niveaux].sort((a, b) => a.ordre - b.ordre).map(n => (
              <option key={n.id} value={n.id}>{n.nom || NIVEAU_TYPES[n.type]}</option>
            ))}
          </select>
          <p className="text-xs text-ink-400 mt-2">L'impression 3D capture la vue actuelle (circuits inclus si affichés) d'un niveau à la fois.</p>
        </div>
        <div className="flex gap-2 p-4 border-t border-ink-200">
          <button onClick={() => onValider(choix)} className="btn-volt flex-1"><Printer size={14} /> Imprimer</button>
        </div>
      </div>
    </div>
  );
}
