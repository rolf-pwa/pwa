import { supabase } from "@/shared/integrations/supabase/client";

const URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/review-agent-admin`;

export type ReviewMode = "off" | "shadow" | "live";
export type ReviewKind = "annual_review" | "sovereignty_review" | "governance_review";
export interface ReviewObligation {
  id: string; family_id: string; family_name: string | null; kind: ReviewKind; window_key: string; window_start: string; window_end: string; tier: string | null;
  invite?: boolean; mode: "shadow" | "live"; status: "open" | "booked" | "held" | "escalated" | "paused" | "cancelled"; booked_start: string | null; nudge_count: number; escalation_reason: string | null;
}
export interface ReviewEvent { id: string; family_id: string | null; family_name: string | null; mode: string; kind: string; detail: Record<string, any>; created_at: string }
export interface ReviewOverview {
  config: { mode: ReviewMode; since: string; remind_every_days: number; handoff_days_before_end: number; max_nudges: number; send_start_hour: number; send_end_hour: number; weekdays_only: boolean } | null;
  obligations: ReviewObligation[]; events: ReviewEvent[];
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

export interface ReminderOverview {
  config: { mode: ReviewMode; send_start_hour: number; send_end_hour: number; last_unmatched?: string[] } | null;
  recent: { id: string; name: string | null; kind: "7d" | "1d"; start_time: string; mode: "shadow" | "live"; meeting_name: string; email_ok: boolean | null; note?: string | null; created_at: string }[];
}
export const getReminderOverview = () => call<ReminderOverview>("reminderOverview");
export const setReminderMode = (mode: ReviewMode, confirm = false) => call<{ ok: true; mode: ReviewMode }>("setReminderMode", { mode, confirm });

export const getReviewOverview = () => call<ReviewOverview>("overview");
export const setReviewMode = (mode: ReviewMode, confirm = false) => call<{ ok: true; mode: ReviewMode }>("setMode", { mode, confirm });
export const setReviewPaused = (obligationId: string, paused: boolean) => call<{ ok: true }>("setPaused", { obligationId, paused });

export const KIND_LABEL: Record<ReviewKind, string> = { annual_review: "Annual Review", sovereignty_review: "Sovereignty Review", governance_review: "Governance Review" };
export const STATUS_LABEL: Record<ReviewObligation["status"], string> = { open: "Open", booked: "Booked", held: "Held", escalated: "With a person", paused: "Paused", cancelled: "Cancelled" };
const REASON: Record<string, string> = {
  no_email: "no email on file", not_booked_near_end: "not booked with time running out", window_closed: "the window closed with no meeting",
  no_response: "no response to the invitations", client_replied: "the family replied", asked_to_stop: "the family asked us to stop emailing",
};
const monthDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric" });

/** A sentence for an event in the log. */
export function describeReviewEvent(e: Pick<ReviewEvent, "kind" | "detail">): string {
  const d = e.detail ?? {};
  switch (e.kind) {
    case "obligation_opened": return `Tracking a ${KIND_LABEL[d.kind as ReviewKind] ?? "review"} (${d.window ?? ""})${d.trackingOnly ? ", already open: watching for a booking, no invitations" : ""}`;
    case "obligation_cancelled": return "Stopped tracking this meeting: the family's tier changed";
    case "booking_detected": return `Meeting found on the calendar${d.start ? ` for ${monthDay(String(d.start).slice(0, 10))}` : ""}`;
    case "booking_removed": return "The booked meeting is no longer on the calendar";
    case "held": return "The meeting took place";
    case "invitation_sent": return `${d.reminder ? "Sent a reminder" : "Sent the invitation"} to ${d.to} adult${d.to === 1 ? "" : "s"}`;
    case "invitation_would_send": return `Would ${d.reminder ? "send a reminder" : "send the invitation"} to ${d.to} adult${d.to === 1 ? "" : "s"}`;
    case "nudge_failed": return "The invitation email failed and will be retried";
    case "escalated": return `Handed to a person: ${REASON[d.reason] ?? d.reason}`;
    case "would_escalate": return `Would hand to a person: ${REASON[d.reason] ?? d.reason}`;
    case "reply_received": return d.summary ? `Family replied: ${d.summary}` : "The family replied to an invitation";
    case "reply_snoozed": return `Family acknowledged: Georgia will wait ${d.waitDays ?? 14} days`;
    case "staff_replied": return `A person replied to the family: Georgia will wait ${d.waitDays ?? 7} days`;
    case "paused": return `Paused by ${d.by ?? "staff"}`;
    case "resumed": return `Resumed by ${d.by ?? "staff"}`;
    case "reminder_mode_changed": return `Meeting reminders changed from ${d.from ?? "?"} to ${d.to} by ${d.by ?? "staff"}`;
    case "mode_changed": return `Mode changed from ${d.from ?? "?"} to ${d.to} by ${d.by ?? "staff"}`;
    default: return e.kind.replace(/_/g, " ");
  }
}
