import type { Catalyst } from "./derive";

// URL parameters an external page can use to link into the Sudden Wealth
// diagnostic:
//   ?event=<slug>    open with that transition already chosen (skips question 1)
//   ?source=<label>  record where the visitor came from (falls back to utm_source)
// Both are optional and harmless if unrecognized.

export const EVENT_SLUGS: Record<string, Catalyst> = {
  "business-exit": "founder_exit",
  "pre-exit-growth": "growth_stage_founder",
  inheritance: "inheritance",
  divorce: "divorce_restructuring",
  "executive-retirement": "executive_exit",
  windfall: "sudden_windfall",
  // Internal catalyst ids are accepted too, for convenience.
  founder_exit: "founder_exit",
  growth_stage_founder: "growth_stage_founder",
  divorce_restructuring: "divorce_restructuring",
  executive_exit: "executive_exit",
  sudden_windfall: "sudden_windfall",
};

/** Lowercase letters, digits, dot, dash, underscore; up to 64 characters. */
export function sanitizeSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  return /^[a-z0-9._-]{1,64}$/.test(cleaned) ? cleaned : null;
}

export function parseEntryParams(search: string): { catalyst: Catalyst | null; source: string | null } {
  const params = new URLSearchParams(search);
  const eventValue = params.get("event")?.trim().toLowerCase() ?? "";
  return {
    catalyst: EVENT_SLUGS[eventValue] ?? null,
    source: sanitizeSource(params.get("source")) ?? sanitizeSource(params.get("utm_source")),
  };
}
