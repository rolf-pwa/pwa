import type { FreeformResult } from "./state";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export type AnalyzeOutcome =
  | { kind: "ok"; result: FreeformResult }
  | { kind: "pii" }
  // The screening service was unreachable or rate-limited: carry on without it.
  | { kind: "unavailable" };

/**
 * Sends the optional free-text answer to georgia2-analyze, which screens it
 * for safety and extracts fixed categories. The visitor's flow never depends
 * on it succeeding.
 */
export async function analyzeFreeform(sessionKey: string, text: string): Promise<AnalyzeOutcome> {
  try {
    const res = await fetch(`${FUNCTIONS_URL}/georgia2-analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_key: sessionKey, text }),
    });
    if (!res.ok) return { kind: "unavailable" };
    const body = await res.json();
    if (body?.pii) return { kind: "pii" };
    if (!body?.ok) return { kind: "unavailable" };
    return {
      kind: "ok",
      result: {
        text,
        threat_detected: body.threat_detected === true,
        threat_source: body.threat_source ?? null,
        emotional_state: body.extraction?.emotional_state ?? null,
        primary_friction: body.extraction?.primary_friction ?? null,
      },
    };
  } catch {
    return { kind: "unavailable" };
  }
}
