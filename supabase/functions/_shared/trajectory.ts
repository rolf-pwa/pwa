// trajectory.ts — turns an action_brain_events row into a de-identified
// alignment pair for ai_training_trajectories, and serialises pairs for
// export. Pure. A row that can't be proven clean is quarantined, never emitted.

import { feedbackSignal, type FeedbackSignal } from "./action-brain.ts";
import { residualPii, scrubText, scrubValue, type ScrubContext } from "./pii-scrub.ts";

export interface ActionEventRow {
  id: string;
  action_type: string;
  workflow_module: string;
  input_context_snapshot: unknown;
  system_proposed_payload: unknown;
  human_final_payload: unknown;
  delta_score: number | null;
  metadata: { rejected?: boolean } | null;
}

export interface TrajectoryRow {
  source_event_id: string;
  workflow_type: string;
  scrubbed_input_prompt: string;
  scrubbed_ai_response: string;
  scrubbed_human_response: string;
  feedback_signal: FeedbackSignal;
}

export type TrajectoryResult = { ok: true; row: TrajectoryRow } | { ok: false; reason: string };

export function buildTrajectory(event: ActionEventRow, ctx: ScrubContext): TrajectoryResult {
  // Without an AI proposal there is no pair to learn from.
  if (event.system_proposed_payload === null || event.system_proposed_payload === undefined) return { ok: false, reason: "no AI proposal" };

  const rejected = event.metadata?.rejected === true;
  const prompt = scrubText(
    `Workflow: ${event.workflow_module} / ${event.action_type}\nContext: ${JSON.stringify(scrubValue(event.input_context_snapshot, ctx))}`,
    ctx,
  );
  const ai = JSON.stringify(scrubValue(event.system_proposed_payload, ctx));
  const human = JSON.stringify(scrubValue(event.human_final_payload, ctx));

  for (const [label, text] of [["prompt", prompt], ["ai response", ai], ["human response", human]] as const) {
    const reason = residualPii(text);
    if (reason) return { ok: false, reason: `${label} still flagged: ${reason}` };
  }
  return {
    ok: true,
    row: {
      source_event_id: event.id, workflow_type: event.workflow_module,
      scrubbed_input_prompt: prompt, scrubbed_ai_response: ai, scrubbed_human_response: human,
      feedback_signal: feedbackSignal(event.delta_score ?? 0, rejected),
    },
  };
}

export type ExportFormat = "sft" | "dpo";

/**
 * sft: the human's final answer is the target (every signal except REJECT,
 *      which has no usable target).
 * dpo: chosen = human, rejected = AI; only where the human actually
 *      disagreed (MINOR_EDIT / MAJOR_OVERRIDE), since ACCEPT has no contrast.
 */
export function toJsonl(rows: TrajectoryRow[], format: ExportFormat): string {
  const lines: string[] = [];
  for (const r of rows) {
    if (format === "sft") {
      if (r.feedback_signal === "REJECT") continue;
      lines.push(JSON.stringify({ prompt: r.scrubbed_input_prompt, completion: r.scrubbed_human_response, signal: r.feedback_signal, workflow: r.workflow_type }));
    } else {
      if (r.feedback_signal === "ACCEPT" || r.feedback_signal === "REJECT") continue;
      lines.push(JSON.stringify({ prompt: r.scrubbed_input_prompt, chosen: r.scrubbed_human_response, rejected: r.scrubbed_ai_response, signal: r.feedback_signal, workflow: r.workflow_type }));
    }
  }
  return lines.join("\n");
}
