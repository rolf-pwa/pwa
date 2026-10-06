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
 * Account/policy number as printed -> the last 4 letters/digits, for the filename
 * (enough to tell two accounts apart without putting a full number in a file name).
 * Returns null when there are fewer than 4 usable characters.
 */
export function accountSuffix(accountNumber: string | null | undefined): string | null {
  const cleaned = (accountNumber ?? "").replace(/[^a-zA-Z0-9]/g, "");
  return cleaned.length >= 4 ? cleaned.slice(-4).toUpperCase() : null;
}

/**
 * True when the ORIGINAL filename marks a signed copy ("... - signed.pdf", "Will signed 2023").
 * "unsigned" does not count. Only the uploader's own filename is trusted for this, never the model.
 */
export function isSignedCopy(originalName: string | null | undefined): boolean {
  return /(^|[^a-z])signed($|[^a-z])/i.test(originalName ?? "");
}

/**
 * Builds the YY-MM-DD_LastName_FirstInitial-DocumentType[_Last4][_Signed].ext filename string in
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
  accountNumber?: string | null; // account/policy number as printed; only its last 4 go in the name
  signed?: boolean;            // original filename marked it as the signed copy
}): string {
  const d = opts.documentDate ? new Date(`${opts.documentDate}T00:00:00Z`) : opts.uploadedAt;
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "");
  const lastName = sanitize(opts.lastName) || "Client";
  const firstInitial = sanitize(opts.firstInitial).slice(0, 1).toUpperCase() || "X";
  const docType = sanitize(opts.documentTypeLabel) || "Document";
  const acct = accountSuffix(opts.accountNumber);
  return `${yy}-${mm}-${dd}_${lastName}_${firstInitial}-${docType}${acct ? `_${acct}` : ""}${opts.signed ? "_Signed" : ""}${opts.originalExt}`;
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

/** Document types that may be filed without review, and whether they must carry an account/policy number. */
const AUTO_FILE_TYPES: Record<string, { needsAccountNumber: boolean }> = {
  InvestmentStatement: { needsAccountNumber: true },
  AccountStatement: { needsAccountNumber: true },
  BankStatement: { needsAccountNumber: true },
  MortgageStatement: { needsAccountNumber: true },
  InsuranceStatement: { needsAccountNumber: true },
  InsurancePolicy: { needsAccountNumber: true },
  T4: { needsAccountNumber: false },
  T5: { needsAccountNumber: false },
  TaxReturn: { needsAccountNumber: false },
  NoticeOfAssessment: { needsAccountNumber: false },
};

/**
 * Whether a classified Shoebox file is certain enough to be renamed and filed with no human
 * review. Deliberately strict: every fact must have been read off the document (no fallback
 * date or name), the category must be valid, and identity/legal/estate/correspondence/"Other"
 * documents always go to a person. Returns null when eligible, otherwise the reason it isn't.
 */
export function autoFileBlocker(c: {
  documentType: string;
  documentDate: string | null;       // as read from the document
  subjectFirstName: string | null;   // as read from the document (not a fallback)
  subjectLastName: string | null;
  accountNumber: string | null;
  categorySlug: string | null;       // already validated against live templates
}): string | null {
  const rule = AUTO_FILE_TYPES[c.documentType];
  if (!rule) return `${c.documentType} is always reviewed by staff`;
  if (!c.categorySlug) return "no confident category";
  if (!c.documentDate) return "no date printed on the document";
  if (!c.subjectFirstName || !c.subjectLastName) return "name not printed on the document";
  if (rule.needsAccountNumber && !accountSuffix(c.accountNumber)) return "no account number found";
  return null;
}

/**
 * Makes `name` unique against `taken` (case-insensitive) by adding _2, _3... before the extension.
 * Returns the name unchanged when it is free.
 */
export function uniqueFilename(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}_${Date.now()}${ext}`;
}
