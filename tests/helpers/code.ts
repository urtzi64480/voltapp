// Analyse statique du code source : tables Supabase et fonctions RPC réellement appelées par l'application.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function listerFichiersSource(dossier = join(process.cwd(), "src")): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const p = join(dossier, nom);
    if (statSync(p).isDirectory()) out.push(...listerFichiersSource(p));
    else if (/\.(ts|tsx)$/.test(nom)) out.push(p);
  }
  return out;
}

/** Noms de tables passés à supabase.from("…") — les appels storage.from("…") (buckets) sont exclus. */
export function tablesUtiliseesParLeCode(): string[] {
  const tables = new Set<string>();
  for (const f of listerFichiersSource()) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?<!storage\s*)\.from\(\s*["']([a-z_]+)["']\s*\)/g)) tables.add(m[1]);
  }
  return [...tables].sort();
}

export function rpcUtilisesParLeCode(): string[] {
  const fns = new Set<string>();
  for (const f of listerFichiersSource()) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\.rpc\(\s*["']([a-z_]+)["']/g)) fns.add(m[1]);
  }
  return [...fns].sort();
}
