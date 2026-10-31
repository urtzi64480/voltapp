// Contrôle minimal de bonne formation XML (balises appariées, une seule racine, pas de « & » ou « < » brut) — sans dépendance.
export function verifierXmlBienForme(xml: string): string[] {
  const erreurs: string[] = [];
  const corps = xml.replace(/^<\?xml[^>]*\?>\s*/, "");
  const pile: string[] = [];
  let racines = 0;
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  let fin = 0;
  while ((m = re.exec(corps))) {
    if (m.index !== fin) { erreurs.push(`contenu inattendu près de « ${corps.slice(fin, fin + 30)} »`); break; }
    fin = re.lastIndex;
    if (m[5] !== undefined) {
      if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(m[5])) erreurs.push(`« & » non échappé : ${m[5].slice(0, 40)}`);
      continue;
    }
    const [, fermante, nom, , autoFermante] = m;
    if (autoFermante) { if (!pile.length) racines++; continue; }
    if (fermante) {
      if (pile.pop() !== nom) { erreurs.push(`balise fermante inattendue </${nom}>`); break; }
    } else {
      if (!pile.length) racines++;
      pile.push(nom);
    }
  }
  if (fin !== corps.length) erreurs.push("fin de document invalide");
  if (pile.length) erreurs.push(`balises non fermées : ${pile.join(", ")}`);
  if (racines !== 1) erreurs.push(`${racines} élément(s) racine`);
  return erreurs;
}
