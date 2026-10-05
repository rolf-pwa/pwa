// provenance.ts — Glass-Box source locations for Stage 1 extractions. The
// model is asked (V2 only) to say which page and region each figure came
// from. That is best-effort: models are not reliable at bounding boxes on
// PDFs, so everything it returns is validated here and anything malformed
// becomes null rather than a wrong highlight. Pure: no I/O.

export interface SourceRef {
  /** 1-based page number. */
  page_number: number | null;
  /** [ymin, xmin, ymax, xmax], integers normalised to 0-1000 of the page. */
  bounding_box: [number, number, number, number] | null;
  /** Short exact text the figure was read from. */
  quote: string | null;
}

/** Appended to the Stage 1 system prompt for V2 households only. */
export const V2_PROVENANCE_PROMPT_SUFFIX = `

Provenance: add to EVERY account/policy object a "source" field:
"source": { "page_number": 1-based integer or null, "bounding_box": [ymin, xmin, ymax, xmax] integers normalised 0-1000 around the text you read the current value (or coverage amount) from, or null, "quote": the exact short text (max 80 characters) you read that figure from, or null }
Never guess a location: use null for any part you are not certain of.`;

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function sanitizeSource(raw: unknown): SourceRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const page = isInt(r.page_number) && Number.isInteger(r.page_number) && r.page_number >= 1 && r.page_number <= 10000
    ? r.page_number : null;

  let box: SourceRef["bounding_box"] = null;
  if (Array.isArray(r.bounding_box) && r.bounding_box.length === 4 && r.bounding_box.every(isInt)) {
    const [ymin, xmin, ymax, xmax] = (r.bounding_box as number[]).map((n) => Math.round(n));
    const inRange = [ymin, xmin, ymax, xmax].every((n) => n >= 0 && n <= 1000);
    if (inRange && ymin < ymax && xmin < xmax) box = [ymin, xmin, ymax, xmax];
  }

  const quote = typeof r.quote === "string" && r.quote.trim() ? r.quote.trim().slice(0, 120) : null;
  // A box with no page can't be drawn anywhere, so drop it.
  if (page === null) box = null;
  return page === null && box === null && quote === null ? null : { page_number: page, bounding_box: box, quote };
}

/** Returns a copy of `items` with each item's `source` sanitised (missing/invalid -> null). */
export function withSanitizedSources<T extends { source?: unknown }>(items: T[] | undefined): Array<T & { source: SourceRef | null }> {
  return (items ?? []).map((i) => ({ ...i, source: sanitizeSource(i.source) }));
}
