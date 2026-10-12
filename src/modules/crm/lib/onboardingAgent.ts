import { supabase } from "@/shared/integrations/supabase/client";

const URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/onboarding-agent-admin`;

export type AgentMode = "off" | "shadow" | "live";
export interface AgentCase {
  id: string; household_id: string; household_label?: string | null; mode: "shadow" | "live"; status: "active" | "complete" | "escalated" | "paused";
  opened_at: string; nudge_count: number; last_nudge_at: string | null; escalation_reason: string | null; checklist: Record<string, string>;
}
export interface AgentEvent { id: string; household_id?: string | null; household_label?: string | null; mode: string; kind: string; detail: Record<string, any>; created_at: string }
export interface AgentOverview {
  config: { mode: AgentMode; since: string; max_nudges: number; first_nudge_hours: number; min_gap_hours: number; send_start_hour: number; send_end_hour: number; weekdays_only: boolean } | null;
  cases: AgentCase[]; events: AgentEvent[];
}

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

export const getOverview = () => call<AgentOverview>("overview");
export const getHouseholdCase = (householdId: string) => call<{ mode: AgentMode; cases: AgentCase[]; events: AgentEvent[] }>("getCase", { householdId });
export const setMode = (mode: AgentMode, confirm = false) => call<{ ok: true; mode: AgentMode }>("setMode", { mode, confirm });
export const setCasePaused = (caseId: string, paused: boolean) => call<{ ok: true }>("setCasePaused", { caseId, paused });

const STEP = (s: string) => (s === "survey" ? "book the Survey Session" : "add documents");
const REASON: Record<string, string> = { no_response: "no response to reminders", vault_failed: "the Vault could not be built", no_email: "no email address on file", client_replied: "the client replied", asked_to_stop: "the client asked us to stop emailing" };

/** A sentence for an event in the log. */
export function describeEvent(e: Pick<AgentEvent, "kind" | "detail">): string {
  const d = e.detail ?? {};
  switch (e.kind) {
    case "case_opened": return "Started managing this onboarding";
    case "nudge_sent": return `Sent a reminder email (next step: ${STEP(d.step)})`;
    case "nudge_would_send": return `Would send a reminder email (next step: ${STEP(d.step)})`;
    case "nudge_failed": return "A reminder email failed to send and will be retried";
    case "vault_retry_ok": return "Retried building the Vault: it worked";
    case "vault_retry_failed": return "Retried building the Vault: it failed";
    case "vault_retry_would_run": return "Would retry building the Vault";
    case "escalated": return `Handed to a person: ${REASON[d.reason] ?? d.reason}`;
    case "would_escalate": return `Would hand to a person: ${REASON[d.reason] ?? d.reason}`;
    case "complete": return "Onboarding complete: Survey Session booked and documents received";
    case "reply_received": return d.summary ? `Client replied: ${d.summary}` : "Client replied to a reminder";
    case "reply_snoozed": return `Client acknowledged the reminder: Georgia will wait ${d.waitDays ?? 3} days`;
    case "staff_replied": return `A person replied to the client: Georgia will wait ${d.waitDays ?? 7} days`;
    case "paused": return `Paused by ${d.by ?? "staff"}`;
    case "resumed": return `Resumed by ${d.by ?? "staff"}`;
    case "mode_changed": return `Mode changed from ${d.from ?? "?"} to ${d.to} by ${d.by ?? "staff"}`;
    default: return e.kind.replace(/_/g, " ");
  }
}

export const CASE_STATUS_LABEL: Record<AgentCase["status"], string> = { active: "Active", complete: "Complete", escalated: "With a person", paused: "Paused" };
