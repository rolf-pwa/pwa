// system-health.ts — shared helpers for the V2 Sentinel SRE agent and for any
// edge function that wants its failures visible in system_health_logs.
// Everything above `logSystemHealth` is pure (no Deno/env/DB) so it can be
// unit-tested from src/test, same convention as service-tiering.ts.

export type HealthSeverity = "INFO" | "WARN" | "ERROR" | "FATAL";
export type HealthStatus = "PENDING" | "RETRIED" | "RESOLVED" | "ESCALATED";

export interface HealthLogRow {
  id: string;
  created_at: string;
  function_name: string;
  household_id: string | null;
  severity: HealthSeverity;
  error_code: string | null;
  error_message: string | null;
  input_payload: unknown;
  retry_count: number;
  max_retries: number;
  status: HealthStatus;
}

// ---- Scrubbing ---------------------------------------------------------
// input_payload and error text land in a staff-readable table, so they are
// scrubbed before insert. Replay payloads are expected to be id-shaped
// (uuids), which none of these rules touch.

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|api[-_]?key|cookie|\bsin\b|credential/i;
const SIN = /\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/g;
const LONG_DIGITS = /\b\d{8,}\b/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MAX_STRING = 500;
const MAX_DEPTH = 6;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function scrubString(s: string): string {
  // Split around uuids first: their trailing 12-digit group would otherwise
  // look like an account number and corrupt id-shaped replay payloads.
  const cleaned = s
    .split(new RegExp(`(${UUID.source})`, "gi"))
    .map((part, i) =>
      i % 2 === 1 ? part : part.replace(EMAIL, "[email]").replace(SIN, "[sin]").replace(LONG_DIGITS, "[number]"),
    )
    .join("");
  return cleaned.length > MAX_STRING ? cleaned.slice(0, MAX_STRING) + "…[truncated]" : cleaned;
}

export function scrubForLog(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return scrubString(value);
  if (depth >= MAX_DEPTH) return "[depth-limit]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubForLog(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : scrubForLog(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

// ---- Transient-failure classification ----------------------------------

const TRANSIENT_CODES = new Set(["429", "500", "502", "503", "504", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "DEADLINE_EXCEEDED", "TIMEOUT", "ECONNRESET"]);
const TRANSIENT_MESSAGE = /timed? ?out|temporar|rate.?limit|resource.?exhausted|unavailable|econnreset|network|fetch failed/i;

export function isTransientError(code: string | null | undefined, message: string | null | undefined): boolean {
  if (code && TRANSIENT_CODES.has(String(code).toUpperCase())) return true;
  return !!message && TRANSIENT_MESSAGE.test(message);
}

// ---- Backoff & decision --------------------------------------------------

export const SENTINEL_TICK_MS = 2 * 60 * 1000;

/**
 * Stateless exponential backoff (only created_at is stored): attempt n
 * (0-based) is due 2m * (2^(n+1) - 1) after creation => +2m, +6m, +14m.
 * The table has no last-attempt column, so cumulative-from-creation keeps
 * the schedule deterministic without a schema change.
 */
export function retryDueAt(createdAt: string | Date, retryCount: number): Date {
  const base = new Date(createdAt).getTime();
  return new Date(base + SENTINEL_TICK_MS * (Math.pow(2, retryCount + 1) - 1));
}

export type SentinelAction = "ignore" | "wait" | "retry" | "escalate";

export function decideAction(row: HealthLogRow, now: Date, isReplayable: boolean): SentinelAction {
  if (row.status === "RESOLVED" || row.status === "ESCALATED") return "ignore";
  if (row.severity === "INFO" || row.severity === "WARN") return "ignore";
  if (row.severity === "FATAL") return "escalate";
  if (!isReplayable || !isTransientError(row.error_code, row.error_message)) return "escalate";
  if (row.retry_count >= row.max_retries) return "escalate";
  return now >= retryDueAt(row.created_at, row.retry_count) ? "retry" : "wait";
}

// ---- Row building + best-effort logger -----------------------------------

export interface HealthLogInput {
  function_name: string;
  severity: HealthSeverity;
  error_code?: string | null;
  error_message?: string | null;
  stack_trace?: string | null;
  execution_id?: string | null;
  household_id?: string | null;
  input_payload?: unknown;
  max_retries?: number;
}

export function buildHealthLogRow(input: HealthLogInput) {
  const actionable = input.severity === "ERROR" || input.severity === "FATAL";
  return {
    function_name: input.function_name,
    severity: input.severity,
    error_code: input.error_code ?? null,
    error_message: input.error_message ? scrubString(input.error_message) : null,
    stack_trace: input.stack_trace ? input.stack_trace.slice(0, 4000) : null,
    execution_id: input.execution_id ?? null,
    household_id: input.household_id ?? null,
    input_payload: input.input_payload === undefined ? null : scrubForLog(input.input_payload),
    max_retries: input.max_retries ?? 3,
    // INFO/WARN are record-only; the Sentinel only works ERROR/FATAL rows.
    status: actionable ? "PENDING" : "RESOLVED",
  };
}

/** Never throws: observability must not turn a handled failure into a new one. */
export async function logSystemHealth(
  db: { from: (t: string) => { insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> } },
  input: HealthLogInput,
): Promise<void> {
  try {
    const { error } = await db.from("system_health_logs").insert(buildHealthLogRow(input));
    if (error) console.error("[system-health] insert failed:", error.message);
  } catch (e) {
    console.error("[system-health] insert threw:", e instanceof Error ? e.message : String(e));
  }
}
