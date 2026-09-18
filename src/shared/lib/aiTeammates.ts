// AI Teammate persona registry (PM system). One persona ships today --
// with zero real tool-routing differentiation between personas yet, more
// than one would just be cosmetically different prompts wrapping the same
// single Vertex call. Add more here later (plus a matching branch in
// supabase/functions/pm-ai-teammate-run/index.ts's prompt builder) once
// there's a real capability split to justify it -- no migration needed,
// pm_tasks.assigned_agent_key is free text.

export type AiTeammateKey = "pm_teammate";

export const AI_TEAMMATE_ORDER: AiTeammateKey[] = ["pm_teammate"];

export const AI_TEAMMATE_LABEL: Record<AiTeammateKey, string> = {
  pm_teammate: "PM Teammate",
};

export const AI_TEAMMATE_DESCRIPTION: Record<AiTeammateKey, string> = {
  pm_teammate:
    "Drafts research, a plan, or first-pass content for a task. Every output lands as a subtask for staff review — nothing is ever auto-approved or sent to a client.",
};

export function isAiTeammateKey(key: string): key is AiTeammateKey {
  return (AI_TEAMMATE_ORDER as string[]).includes(key);
}
