// Which files in a Tax folder look like last year's T1 return or Notice of Assessment, and whose return a name belongs to.
// Pure: no I/O.

interface FileLike { id: string; name: string; modifiedTime?: string }

/** Candidate return files for the tax year, best first: a name showing another year is out; return-like names come first. Capped at 8. */
export function pickReturnFiles<T extends FileLike>(files: T[], taxYear: number): T[] {
  const otherYear = (n: string) => { const y = n.match(/\b(20\d{2})\b/g); return !!y && !y.includes(String(taxYear)); };
  const score = (n: string) => (/t1|return|noa|assessment|tax\s*summary|filed/i.test(n) ? 0 : /t3|t5|t4|slip|receipt/i.test(n) ? 2 : 1);
  return files.filter((f) => !otherYear(f.name)).sort((a, b) => score(a.name) - score(b.name) || (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? "")).slice(0, 8);
}

const tokens = (s: string) => s.toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter((t) => t.length > 1);

/** The household member a printed name belongs to: every name part of exactly one member appears in it. */
export function matchContactByName(recipient: string | null, people: { id: string; name: string }[]): { id: string; name: string } | null {
  if (!recipient) return null;
  const printed = new Set(tokens(recipient));
  const hits = people.filter((p) => { const t = tokens(p.name); return t.length > 0 && t.every((x) => printed.has(x)); });
  return hits.length === 1 ? hits[0] : null;
}
