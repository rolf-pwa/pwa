// action-brain.ts — the Action Brain's episodic memory: one action_brain_events
// row each time a human accepts, edits or rejects something the system
// proposed. Pure helpers plus a best-effort logger. The point is the DELTA
// between what the AI proposed and what the human finally decided.

export type FeedbackSignal = "ACCEPT" | "MINOR_EDIT" | "MAJOR_OVERRIDE" | "REJECT";

/** Provenance is metadata about the document, not part of what the human decided. */
const IGNORED_KEYS = new Set(["source"]);

function leaves(value: unknown, path: string, out: Map<string, string>) {
  if (value === null || typeof value !== "object") { out.set(path, JSON.stringify(value ?? null)); return; }
  if (Array.isArray(value)) {
    if (value.length === 0) out.set(path, "[]");
    value.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([k]) => !IGNORED_KEYS.has(k));
  if (entries.length === 0) out.set(path, "{}");
  for (const [k, v] of entries) leaves(v, path ? `${path}.${k}` : k, out);
}

export function flattenLeaves(value: unknown): Map<string, string> {
  const out = new Map<string, string>();
  leaves(value, "", out);
  return out;
}

/**
 * Fraction (0..1) of decided fields the human changed relative to the AI's
 * proposal: changed or added or removed leaves over all leaves seen. 0 means
 * the human accepted it exactly.
 */
export function computeDelta(proposed: unknown, final: unknown): number {
  const a = flattenLeaves(proposed);
  const b = flattenLeaves(final);
  const paths = new Set([...a.keys(), ...b.keys()]);
  if (paths.size === 0) return 0;
  let changed = 0;
  for (const p of paths) if (a.get(p) !== b.get(p)) changed++;
  return Math.round((changed / paths.size) * 1000) / 1000;
}

export const MINOR_EDIT_MAX_DELTA = 0.2;

export function feedbackSignal(delta: number, rejected: boolean): FeedbackSignal {
  if (rejected) return "REJECT";
  if (delta === 0) return "ACCEPT";
  return delta <= MINOR_EDIT_MAX_DELTA ? "MINOR_EDIT" : "MAJOR_OVERRIDE";
}

export interface ActionEventInput {
  household_id?: string | null;
  actor_id?: string | null;
  actor_role: "CLIENT" | "ADVISOR" | "EXTERNAL_PRO" | "SYSTEM_AGENT";
  action_type: string;
  workflow_module: string;
  input_context_snapshot: unknown;
  system_proposed_payload?: unknown;
  human_final_payload: unknown;
  rejected?: boolean;
  metadata?: Record<string, unknown>;
}

export function buildActionEvent(i: ActionEventInput) {
  const hasProposal = i.system_proposed_payload !== undefined && i.system_proposed_payload !== null;
  const rejected = i.rejected === true;
  // A rejection is a full override of the proposal; with no proposal there's nothing to diff.
  const delta = !hasProposal ? null : rejected ? 1 : computeDelta(i.system_proposed_payload, i.human_final_payload);
  return {
    household_id: i.household_id ?? null,
    actor_id: i.actor_id ?? null,
    actor_role: i.actor_role,
    action_type: i.action_type,
    workflow_module: i.workflow_module,
    input_context_snapshot: i.input_context_snapshot ?? {},
    system_proposed_payload: hasProposal ? i.system_proposed_payload : null,
    human_final_payload: i.human_final_payload ?? {},
    delta_score: delta,
    metadata: { ...(i.metadata ?? {}), rejected, signal: hasProposal ? feedbackSignal(delta ?? 0, rejected) : null },
  };
}

/** Never throws: logging a decision must not undo or fail the decision itself. */
export async function logActionEvent(
  db: { from: (t: string) => { insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> } },
  input: ActionEventInput,
): Promise<void> {
  try {
    const { error } = await db.from("action_brain_events").insert(buildActionEvent(input));
    if (error) console.error("[action-brain] insert failed:", error.message);
  } catch (e) {
    console.error("[action-brain] insert threw:", e instanceof Error ? e.message : String(e));
  }
}
