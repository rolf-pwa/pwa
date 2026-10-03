// Pure naming helpers for the Shoebox classifier. Kept free of any Deno/env
// or Vertex imports so they can be unit-tested directly (src/test).

/**
 * Document text is often ALL CAPS (licences, statements) and the model tends
 * to copy it verbatim, which would put "LIVELYLAMBERT" in a filename. Title-
 * case a value only when it is entirely upper-case; mixed-case input
 * ("McDonald", "de la Cruz") is left exactly as the model returned it.
 */
export function normalizePersonName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed !== trimmed.toUpperCase() || trimmed === trimmed.toLowerCase()) return trimmed;
  return trimmed
    .toLowerCase()
    .replace(/(^|[\s\-'\u2019.])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/\bMc([a-z])/g, (_m, ch: string) => "Mc" + ch.toUpperCase());
}

/**
 * Builds the YY-MM-DD_LastName_FirstInitial-DocumentType filename string in
 * code -- the model only ever supplies facts (date/type/name), never
 * formats the filename itself.
 */
export function buildProposedFilename(opts: {
  documentDate: string | null; // ISO YYYY-MM-DD
  uploadedAt: Date;            // fallback when documentDate is null
  lastName: string;
  firstInitial: string;
  documentTypeLabel: string;   // already resolved: other_label when document_type === "Other", else document_type
  originalExt: string;         // including the leading dot, e.g. ".pdf"
}): string {
  const d = opts.documentDate ? new Date(`${opts.documentDate}T00:00:00Z`) : opts.uploadedAt;
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "");
  const lastName = sanitize(opts.lastName) || "Client";
  const firstInitial = sanitize(opts.firstInitial).slice(0, 1).toUpperCase() || "X";
  const docType = sanitize(opts.documentTypeLabel) || "Document";
  return `${yy}-${mm}-${dd}_${lastName}_${firstInitial}-${docType}${opts.originalExt}`;
}

/**
 * Household-primary-adult fallback for the filename's subject name, used
 * when the AI couldn't read one off the document and the uploader's own
 * identity isn't known either. Duplicated from vault-provisioning.ts's
 * private ADULT_ROLE_PRIORITY logic (not exported there), matching this
 * codebase's established per-file small-helper duplication convention.
 */
export function resolvePrimaryAdultName(
  contacts: { first_name: string; last_name: string; family_role: string | null }[],
): { firstName: string; lastName: string } | null {
  const PRIORITY: Record<string, number> = { head_of_family: 0, spouse: 1 };
  const adults = contacts
    .filter((c) => c.family_role && c.family_role in PRIORITY)
    .sort((a, b) => PRIORITY[a.family_role!] - PRIORITY[b.family_role!]);
  const pick = adults[0] ?? contacts[0];
  return pick ? { firstName: pick.first_name, lastName: pick.last_name } : null;
}
