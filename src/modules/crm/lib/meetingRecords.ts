import { supabase } from "@/shared/integrations/supabase/client";

export interface RecordCandidate {
  id: string; title: string; client: string | null; completed_at: string | null; subtasks: number; comments: number;
  meeting_followup: boolean; has_record: boolean; suggested: boolean;
}
export interface RecordResult { id: string; status: "created" | "updated" | "skipped" | "failed"; reason?: string; url?: string }

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("pm-service", { body });
  if (error) {
    let details = error.message;
    try { const ctx = (error as unknown as { context?: Response }).context; if (ctx) details = JSON.parse(await ctx.text())?.error || details; } catch { /* keep */ }
    throw new Error(details);
  }
  const res = data as { ok: boolean; error?: string } & Record<string, unknown>;
  if (!res?.ok) throw new Error(res?.error || "That did not work.");
  return res as T;
}

export const BACKFILL_SINCE = "2026-09-01";
export const getRecordCandidates = (since = BACKFILL_SINCE) => call<{ candidates: RecordCandidate[] }>({ action: "meetingRecordCandidates", since }).then((r) => r.candidates);
/** Files records for up to three tasks per call. */
export const createRecords = (taskIds: string[]) => call<{ results: RecordResult[] }>({ action: "meetingRecordCreate", task_ids: taskIds }).then((r) => r.results);
