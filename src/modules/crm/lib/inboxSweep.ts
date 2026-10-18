import { supabase } from "@/shared/integrations/supabase/client";

const URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/daily-briefing-generate`;

export type SweepBucket = "needs_you" | "fyi" | "archivable" | "client";
export interface SweepItem {
  id: string; message_id: string; from_addr: string; address: string; subject: string; snippet: string; received_at: string | null;
  bucket: SweepBucket; reason: string; decided_by: "rule" | "model"; feedback: "right" | "wrong" | null; link: string;
}
export interface Rate { rated: number; right: number }
export interface SweepOverview { items: SweepItem[]; accuracy: { overall: Rate | null; archivable: Rate | null } }

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
export const rateSweepItem = (id: string, value: "right" | "wrong" | null) => call<{ ok: true }>("ea_sweep_feedback", { id, value });
