import { supabase } from "@/shared/integrations/supabase/client";

const URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/daily-briefing-generate`;

export type SweepBucket = "needs_you" | "fyi" | "archivable" | "client";
export interface SweepItem {
  id: string; message_id: string; from_addr: string; address: string; subject: string; snippet: string; received_at: string | null;
  bucket: SweepBucket; proposed_bucket?: SweepBucket | null; correct_bucket?: SweepBucket | null; reason: string; decided_by: "rule" | "model" | "learned"; feedback: "right" | "wrong" | null; link: string; archived_at?: string | null;
}
export interface Rate { rated: number; right: number }
export interface SweepSender { sender: string; bucket: Exclude<SweepBucket, "client"> }
export interface SweepOverview { items: SweepItem[]; accuracy: { overall: Rate | null; archivable: Rate | null }; senders: SweepSender[]; /** Whether the sweep runs by itself every morning. */ auto?: boolean; /** Whether Google has been told Georgia may archive. */ canArchive?: boolean; /** How many messages the latest archive moved (what Undo would put back). */ lastBatch?: number }

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token ?? ""}`, "x-region": "ca-central-1" },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

export const getSweep = () => call<SweepOverview>("ea_sweep_list");
export const runSweep = () => call<{ ok: true; sorted: number; remaining: number; modelFailed?: boolean }>("ea_sweep_run");
/** Marks a sort right, or wrong with the bucket it belonged in (which moves it and teaches Georgia about the sender), or clears the mark. */
export const rateSweepItem = (id: string, value: "right" | "wrong" | null, correctBucket?: Exclude<SweepBucket, "client">) =>
  call<{ ok: true; moved?: number; remembered?: string | null }>("ea_sweep_feedback", { id, value, ...(correctBucket ? { correct_bucket: correctBucket } : {}) });
export const forgetSweepSender = (sender: string) => call<{ ok: true }>("ea_sweep_forget", { sender });
export const setSweepAuto = (on: boolean) => call<{ ok: true; auto: boolean }>("ea_sweep_auto", { on });
export const archiveSweep = (scope: "rated" | "all") => call<{ ok: true; archived: number; skippedStarred: number; alreadyGone: number }>("ea_sweep_archive", { scope });
export const undoSweepArchive = () => call<{ ok: true; restored: number }>("ea_sweep_undo");
