"use client";
// src/components/plan/SchemaCommande.tsx
//
// Schéma de câblage d'une commande d'éclairage, généré selon le nombre de mécanismes du guide (suivi-realisation.ts) :
// interrupteur simple, détecteur, va-et-vient (2 points), 3 points et plus (avec permutateurs), télérupteur.
// Sous-composants définis hors du composant principal (pas de remontage à chaque rendu).
import type { TypeSchema } from "@/lib/suivi-realisation";

const COUL = { phase: "#dc2626", n1: "#111827", n2: "#ea580c", retour: "#7c3aed", neutre: "#2563eb", terre: "#16a34a", trait: "#44403c", fond: "#ffffff" };
const L_BOITE = 96;
const PAS = 150;

type TypeMeca = "simple" | "detecteur" | "vv_entree" | "perm" | "vv_sortie";
interface Borne { y: number; txt: string }
const BORNES: Record<TypeMeca, { g: Borne[]; d: Borne[]; nom: string }> = {
  simple:    { g: [{ y: 75, txt: "COM" }],                      d: [{ y: 75, txt: "S" }],                          nom: "Interrupteur" },
  detecteur: { g: [{ y: 58, txt: "L" }, { y: 92, txt: "N" }],  d: [{ y: 75, txt: "Sortie" }],                     nom: "Détecteur" },
  vv_entree: { g: [{ y: 75, txt: "COM" }],                      d: [{ y: 58, txt: "L1" }, { y: 92, txt: "L2" }],  nom: "Va-et-vient" },
  perm:      { g: [{ y: 58, txt: "E1" }, { y: 92, txt: "E2" }], d: [{ y: 58, txt: "S1" }, { y: 92, txt: "S2" }],  nom: "Permutateur" },
  vv_sortie: { g: [{ y: 58, txt: "L1" }, { y: 92, txt: "L2" }], d: [{ y: 75, txt: "COM" }],                      nom: "Va-et-vient" },
};

function Fil({ pts, couleur, pointille }: { pts: [number, number][]; couleur: string; pointille?: boolean }) {
  return <polyline points={pts.map(p => p.join(",")).join(" ")} fill="none" stroke={couleur} strokeWidth={2.4} strokeLinejoin="round" strokeDasharray={pointille ? "6 4" : undefined} />;
}

function Etiquette({ x, y, children, couleur, ancre = "middle" }: { x: number; y: number; children: string; couleur: string; ancre?: "start" | "middle" | "end" }) {
  return <text x={x} y={y} fontSize={9.5} fontWeight={600} fill={couleur} textAnchor={ancre}>{children}</text>;
}

function Boite({ x, type, rang, total }: { x: number; type: TypeMeca; rang: number; total: number }) {
  const b = BORNES[type];
  return (
    <g>
      <rect x={x} y={33} width={L_BOITE} height={84} rx={8} fill={COUL.fond} stroke={COUL.trait} strokeWidth={1.6} />
      <text x={x + L_BOITE / 2} y={46} fontSize={10} fontWeight={700} fill="#1c1917" textAnchor="middle">
        {total > 1 ? `${rang} · ${b.nom}` : b.nom}
      </text>
      {type === "perm" && (
        <g stroke="#a8a29e" strokeWidth={1.4}>
          <line x1={x + 26} y1={58} x2={x + L_BOITE - 26} y2={92} />
          <line x1={x + 26} y1={92} x2={x + L_BOITE - 26} y2={58} />
        </g>
      )}
      {b.g.map(t => (
        <g key={`g${t.y}`}>
          <circle cx={x} cy={t.y} r={4.5} fill="#1c1917" />
          <text x={x + 9} y={t.y + 3.5} fontSize={9.5} fontWeight={700} fill="#1c1917">{t.txt}</text>
        </g>
      ))}
      {b.d.map(t => (
        <g key={`d${t.y}`}>
          <circle cx={x + L_BOITE} cy={t.y} r={4.5} fill="#1c1917" />
          <text x={x + L_BOITE - 9} y={t.y + 3.5} fontSize={9.5} fontWeight={700} fill="#1c1917" textAnchor="end">{t.txt}</text>
        </g>
      ))}
    </g>
  );
}

function SchemaChaine({ type, nbPermutateurs }: { type: "simple" | "detecteur" | "va_et_vient"; nbPermutateurs: number }) {
  const meca: TypeMeca[] = type === "simple" ? ["simple"]
    : type === "detecteur" ? ["detecteur"]
      : ["vv_entree", ...Array.from({ length: nbPermutateurs }, () => "perm" as TypeMeca), "vv_sortie"];
  const n = meca.length;
  const x0 = 10, lSource = 92;
  const xm = (i: number) => 134 + i * PAS;
  const xLampe = xm(n - 1) + L_BOITE + 62;
  const largeur = xLampe + 52;
  const detecteur = type === "detecteur";

  return (
    <svg viewBox={`0 0 ${largeur} 176`} width={largeur} height={176} role="img" aria-label="Schéma de câblage" style={{ maxWidth: "none" }}>
      {/* neutre + terre : relayés sous les mécanismes */}
      <Fil pts={[[x0 + lSource / 2, 95], [x0 + lSource / 2, 140], [xLampe, 140], [xLampe, 99]]} couleur={COUL.neutre} pointille />
      <Etiquette x={(x0 + xLampe) / 2} y={156} couleur={COUL.neutre}>
        {detecteur ? "Neutre (bleu) : aussi sur le détecteur · terre (vert/jaune) : relayée vers la lampe" : "Neutre (bleu) + terre (vert/jaune) : relayés dans les boîtes, jamais sur les mécanismes"}
      </Etiquette>

      {/* phase : source → première borne(s) */}
      {BORNES[meca[0]].g.map((t, i) => {
        const cible = xm(0);
        const milieu = x0 + lSource + (cible - x0 - lSource) / 2 + (i === 0 ? -6 : 6);
        const couleur = detecteur && t.txt === "N" ? COUL.neutre : COUL.phase;
        return <Fil key={`ph${i}`} pts={[[x0 + lSource, 75], [milieu, 75], [milieu, t.y], [cible, t.y]]} couleur={couleur} />;
      })}
      <Etiquette x={x0 + lSource + 18} y={68} couleur={COUL.phase}>Phase</Etiquette>

      {/* navettes entre mécanismes */}
      {meca.slice(0, -1).map((_, i) => {
        const xa = xm(i) + L_BOITE, xb = xm(i + 1);
        return (
          <g key={`nv${i}`}>
            <Fil pts={[[xa, 58], [xb, 58]]} couleur={COUL.n1} />
            <Fil pts={[[xa, 92], [xb, 92]]} couleur={COUL.n2} />
            <Etiquette x={(xa + xb) / 2} y={52} couleur={COUL.n1}>Navette 1</Etiquette>
            <Etiquette x={(xa + xb) / 2} y={106} couleur={COUL.n2}>Navette 2</Etiquette>
          </g>
        );
      })}

      {/* retour vers la lampe */}
      <Fil pts={[[xm(n - 1) + L_BOITE, 75], [xLampe - 22, 75]]} couleur={COUL.retour} />
      <Etiquette x={(xm(n - 1) + L_BOITE + xLampe - 22) / 2} y={68} couleur={COUL.retour}>Retour</Etiquette>

      {/* source */}
      <rect x={x0} y={55} width={lSource} height={40} rx={8} fill="#fef3c7" stroke="#d97706" strokeWidth={1.4} />
      <text x={x0 + lSource / 2} y={72} fontSize={9.5} fontWeight={700} fill="#1c1917" textAnchor="middle">Arrivée</text>
      <text x={x0 + lSource / 2} y={85} fontSize={9.5} fontWeight={700} fill="#1c1917" textAnchor="middle">du circuit</text>

      {meca.map((t, i) => <Boite key={i} x={xm(i)} type={t} rang={i + 1} total={n} />)}

      {/* lampe */}
      <circle cx={xLampe} cy={75} r={22} fill="#fffbeb" stroke="#d97706" strokeWidth={1.6} />
      <text x={xLampe} y={79} fontSize={10} fontWeight={700} fill="#1c1917" textAnchor="middle">Lampe</text>
    </svg>
  );
}

function SchemaTelerupteur({ nbBoutons }: { nbBoutons: number }) {
  const n = Math.max(1, Math.min(nbBoutons, 6));
  const pasY = 58;
  const hauteur = 46 + n * pasY + 40;
  const yBp = (i: number) => 34 + i * pasY;          // haut de chaque bouton
  const yMilieu = yBp(0) + ((n - 1) * pasY) / 2 + 22;  // milieu du groupe de boutons
  const xBus1 = 96, xBp = 130, lBp = 92, xBus2 = 262, xTele = 318, lTele = 128;
  const hTele = 110, yTele = yMilieu - hTele / 2;
  const largeur = xTele + lTele + 150;

  return (
    <svg viewBox={`0 0 ${largeur} ${hauteur}`} width={largeur} height={hauteur} role="img" aria-label="Schéma de câblage télérupteur" style={{ maxWidth: "none" }}>
      {/* bus phase */}
      <Fil pts={[[12, yBp(0) + 22], [xBus1, yBp(0) + 22]]} couleur={COUL.phase} />
      <Fil pts={[[xBus1, yBp(0) + 22], [xBus1, yBp(n - 1) + 22]]} couleur={COUL.phase} />
      <Etiquette x={14} y={yBp(0) + 14} couleur={COUL.phase} ancre="start">Phase</Etiquette>
      {/* bus de commande */}
      <Fil pts={[[xBus2, yBp(0) + 22], [xBus2, yBp(n - 1) + 22]]} couleur={COUL.n1} />
      <Fil pts={[[xBus2, yMilieu - 22], [xTele, yMilieu - 22]]} couleur={COUL.n1} />

      {Array.from({ length: n }, (_, i) => {
        const y = yBp(i) + 22;
        return (
          <g key={i}>
            <Fil pts={[[xBus1, y], [xBp, y]]} couleur={COUL.phase} />
            <Fil pts={[[xBp + lBp, y], [xBus2, y]]} couleur={COUL.n1} />
            <rect x={xBp} y={yBp(i)} width={lBp} height={44} rx={8} fill={COUL.fond} stroke={COUL.trait} strokeWidth={1.6} />
            <text x={xBp + lBp / 2} y={yBp(i) + 17} fontSize={10} fontWeight={700} fill="#1c1917" textAnchor="middle">{`Bouton ${i + 1}`}</text>
            <circle cx={xBp} cy={y} r={4.5} fill="#1c1917" />
            <text x={xBp + 9} y={y + 15} fontSize={9.5} fontWeight={700} fill="#1c1917">COM</text>
            <circle cx={xBp + lBp} cy={y} r={4.5} fill="#1c1917" />
            <text x={xBp + lBp - 9} y={y + 15} fontSize={9.5} fontWeight={700} fill="#1c1917" textAnchor="end">S</text>
          </g>
        );
      })}
      <Etiquette x={(xBp + lBp + xBus2) / 2} y={yBp(0) + 10} couleur={COUL.n1}>boutons en parallèle</Etiquette>

      {/* télérupteur */}
      <rect x={xTele} y={yTele} width={lTele} height={hTele} rx={8} fill="#f5f5f4" stroke={COUL.trait} strokeWidth={1.6} />
      <text x={xTele + lTele / 2} y={yTele + 16} fontSize={10} fontWeight={700} fill="#1c1917" textAnchor="middle">Télérupteur (tableau)</text>
      {[{ y: yMilieu - 22, t: "A1", g: true, c: COUL.n1, l: "commande (boutons)" }, { y: yMilieu + 22, t: "A2", g: true, c: COUL.neutre, l: "neutre" }].map(b => (
        <g key={b.t}>
          <circle cx={xTele} cy={b.y} r={4.5} fill="#1c1917" />
          <text x={xTele + 9} y={b.y + 3.5} fontSize={9.5} fontWeight={700} fill="#1c1917">{b.t}</text>
        </g>
      ))}
      <Fil pts={[[xTele - 40, yMilieu + 22], [xTele, yMilieu + 22]]} couleur={COUL.neutre} />
      <Etiquette x={xTele - 42} y={yMilieu + 18} couleur={COUL.neutre} ancre="end">Neutre</Etiquette>
      {[{ y: yMilieu - 22, t: "1", c: COUL.phase, l: "Phase du circuit" }, { y: yMilieu + 22, t: "2", c: COUL.retour, l: "vers les lampes" }].map(b => (
        <g key={b.t}>
          <circle cx={xTele + lTele} cy={b.y} r={4.5} fill="#1c1917" />
          <text x={xTele + lTele - 9} y={b.y + 3.5} fontSize={9.5} fontWeight={700} fill="#1c1917" textAnchor="end">{b.t}</text>
          <Fil pts={[[xTele + lTele, b.y], [xTele + lTele + 40, b.y]]} couleur={b.c} />
          <Etiquette x={xTele + lTele + 46} y={b.y + 3.5} couleur={b.c} ancre="start">{b.l}</Etiquette>
        </g>
      ))}
    </svg>
  );
}

export function LegendeSchema({ type }: { type: TypeSchema }) {
  const items = type === "telerupteur"
    ? [["Phase", COUL.phase], ["Commande (boutons → A1)", COUL.n1], ["Neutre", COUL.neutre], ["Phase commutée", COUL.retour]]
    : [["Phase", COUL.phase], ["Navette 1", COUL.n1], ["Navette 2", COUL.n2], ["Retour", COUL.retour], ["Neutre / terre", COUL.neutre]];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-ink-600">
      {items.map(([t, c]) => (
        <span key={t} className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-1.5 rounded-sm" style={{ background: c }} />{t}</span>
      ))}
    </div>
  );
}

export default function SchemaCommande({ schema }: { schema: { type: TypeSchema; nbPermutateurs: number; nbBoutons: number } }) {
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white p-2">
        {schema.type === "telerupteur"
          ? <SchemaTelerupteur nbBoutons={schema.nbBoutons} />
          : <SchemaChaine type={schema.type} nbPermutateurs={schema.nbPermutateurs} />}
      </div>
      <LegendeSchema type={schema.type} />
    </div>
  );
}
