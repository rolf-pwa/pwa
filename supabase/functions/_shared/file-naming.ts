// file-naming.ts: the file naming convention for documents the system saves: yy-mm-dd_lastname_init_docname, for example 26-10-23_Issler_RL_Advisor Disclosure.pdf.
// The date is the day the document was signed or made (Pacific); the last name is the client's (two last names are joined with a hyphen); the initials are
// the first letters of each person's first name; the document name is the plain name of the document. Pure.

export interface Person { first_name?: string | null; last_name?: string | null; full_name?: string | null }

/** The plain name of each kind of document, as it appears in a file name. */
export const DOC_FILE_NAME: Record<string, string> = {
  disclosure_privacy: "Advisor Disclosure",
  reason_why: "Reason Why",
  fact_find: "Fact Find",
  replacement_declaration: "Replacement Declaration",
  replacement_explanation: "Replacement Explanation",
  delivery_letter: "Policy Delivery",
  needs_analysis: "Needs Analysis",
  needs_analysis_disability: "Disability Needs Analysis",
  needs_analysis_critical_illness: "Critical Illness Needs Analysis",
  alternatives: "Alternatives Considered",
};

const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
const split = (p: Person): { first: string; last: string } => {
  const first = (p.first_name ?? "").trim(), last = (p.last_name ?? "").trim();
  if (first || last) return { first, last };
  const parts = (p.full_name ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.length > 1 ? parts[parts.length - 1] : "" };
};

/** yy-mm-dd from a YYYY-MM-DD date. */
export const shortDate = (ymd: string): string => String(ymd).slice(2, 10);

/** The name without the extension, for example "26-10-23_Issler_RL_Advisor Disclosure". */
export function conventionName(ymd: string, people: Person[], docName: string): string {
  const ps = people.map(split).filter((p) => p.first || p.last);
  const lasts = [...new Set(ps.map((p) => p.last).filter(Boolean))];
  const initials = ps.map((p) => (p.first[0] ?? "").toUpperCase()).join("");
  return [shortDate(ymd), clean(lasts.join("-")) || "Client", initials || "X", clean(docName)].join("_");
}
export const conventionFile = (ymd: string, people: Person[], docName: string) => `${conventionName(ymd, people, docName)}.pdf`;
