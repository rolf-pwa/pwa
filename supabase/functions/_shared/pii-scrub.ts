// pii-scrub.ts — de-identification for AI training data. pii-shield.ts only
// DETECTS and blocks outbound text; training data has to be REDACTED and then
// proven clean. scrubText/scrubValue redact; residualPii() re-runs pii-shield
// over the result as an independent safety net, and anything it still flags
// is quarantined by the caller rather than exported.
//
// Names can't be found by pattern, so callers pass the known names for the
// household (contacts, corporations, insureds). This is best-effort
// de-identification, not a guarantee of anonymity -- free text can always
// contain something a pattern or a name list doesn't know. Pure.

import { checkOutboundPii } from "./pii-shield.ts";

export interface ScrubContext {
  /** Full names, first names, last names, household/company names known to the household. */
  names?: string[];
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SIN = /\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/g;
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const POSTAL_CA = /\b[A-Za-z]\d[A-Za-z][\s-]?\d[A-Za-z]\d\b/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const LONG_DIGITS = /\b\d{6,}\b/g;
const DOLLARS = /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|mm|million|thousand))?/gi;
const ISO_DATE = /\b(\d{4})-\d{2}-\d{2}\b/g;
const MIN_NAME_LEN = 3;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Order-of-magnitude placeholder: keeps "this was a six-figure error" without the figure. */
export function bucketAmount(n: number): string {
  const abs = Math.abs(n);
  if (abs === 0) return "[AMOUNT:0]";
  return `[AMOUNT~1e${Math.floor(Math.log10(abs))}]`;
}

/** Longest names first so "Maria Scillato" is replaced as one unit before "Scillato". */
function nameReplacer(names: string[]) {
  const unique = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= MIN_NAME_LEN))].sort((a, b) => b.length - a.length);
  const ids = new Map<string, number>();
  return (text: string) => {
    let out = text;
    for (const name of unique) {
      const key = name.toLowerCase();
      if (!ids.has(key)) ids.set(key, ids.size + 1);
      out = out.replace(new RegExp(`\\b${escapeRe(name)}\\b`, "gi"), `[PERSON_${ids.get(key)}]`);
    }
    return out;
  };
}

export function scrubText(text: string, ctx: ScrubContext = {}): string {
  const names = nameReplacer(ctx.names ?? []);
  return names(text)
    .replace(EMAIL, "[EMAIL]")
    .replace(DOLLARS, (m) => {
      const n = Number(m.replace(/[^\d.]/g, ""));
      return Number.isFinite(n) ? bucketAmount(n) : "[AMOUNT]";
    })
    .replace(SIN, "[SIN]")
    .replace(PHONE, "[PHONE]")
    .replace(POSTAL_CA, "[POSTAL]")
    .replace(CARD, "[NUMBER]")
    .replace(LONG_DIGITS, "[NUMBER]")
    .replace(ISO_DATE, "$1-XX-XX");
}

const IDENTIFIER_KEYS = /account_?number|policy_?number|\bsin\b|drive_?id|file_?name|source_?file|email|phone|address|postal|token/i;
const PERSON_KEYS = /(^|_)(owner|insured|holder|name|first_name|last_name|full_name|subject)(_|$)/i;
const AMOUNT_KEYS = /value|harvest|amount|premium|coverage|balance|cost|income|burn|capital/i;

/** Deep scrub of structured data: identifier keys are masked outright, amounts bucketed, everything else text-scrubbed. */
export function scrubValue(value: unknown, ctx: ScrubContext = {}, key = ""): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "number") return AMOUNT_KEYS.test(key) ? bucketAmount(value) : value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (IDENTIFIER_KEYS.test(key)) return "[REDACTED]";
    if (PERSON_KEYS.test(key) && value.trim()) return scrubText(value, { names: [...(ctx.names ?? []), value] });
    return scrubText(value, ctx);
  }
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, ctx, key));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubValue(v, ctx, k);
    return out;
  }
  return String(value);
}

/** Independent check: returns the reason pii-shield would still block this text, or null if clean. */
export function residualPii(text: string): string | null {
  const r = checkOutboundPii(text);
  return r.blocked ? (r.reason ?? "PII detected") : null;
}
