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

// ───── The "Meetings owed" page, by quarter ─────
export interface QuarterSection {
  key: string;            // "2027-Q1"
  label: string;          // "Q1 2027"
  range: string;          // "Jan 1 to Mar 31"
  isCurrent: boolean;
  isPast: boolean;
  items: ReviewObligation[];
  counts: { notBooked: number; booked: number; held: number; withPerson: number };
}

const quarterOf = (iso: string) => ({ y: Number(iso.slice(0, 4)), q: Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1 });
const QUARTER_RANGE: Record<number, [string, string]> = { 1: ["Jan 1", "Mar 31"], 2: ["Apr 1", "Jun 30"], 3: ["Jul 1", "Sep 30"], 4: ["Oct 1", "Dec 31"] };
const STATUS_ORDER: Record<ReviewObligation["status"], number> = { escalated: 0, open: 1, paused: 2, booked: 3, held: 4, cancelled: 5 };

/**
 * Groups meetings owed into quarters, by the quarter each is due in (its window's end). A half-year window (Tier 2B) is due in
 * the second quarter it covers. Sections run in date order; inside one, the ones needing attention come first.
 */
export function groupByQuarter(obligations: ReviewObligation[], today: string): QuarterSection[] {
  const now = quarterOf(today);
  const sections = new Map<string, QuarterSection>();
  for (const o of obligations) {
    if (o.status === "cancelled") continue;
    const { y, q } = quarterOf(o.window_end);
    const key = `${y}-Q${q}`;
    if (!sections.has(key)) {
      const [from, to] = QUARTER_RANGE[q];
      sections.set(key, {
        key, label: `Q${q} ${y}`, range: `${from} to ${to}`, isCurrent: y === now.y && q === now.q, isPast: y < now.y || (y === now.y && q < now.q),
        items: [], counts: { notBooked: 0, booked: 0, held: 0, withPerson: 0 },
      });
    }
    const sec = sections.get(key)!;
    sec.items.push(o);
    if (o.status === "escalated") sec.counts.withPerson++;
    else if (o.status === "booked") sec.counts.booked++;
    else if (o.status === "held") sec.counts.held++;
    else sec.counts.notBooked++;
  }
  for (const sec of sections.values()) {
    sec.items.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.family_name ?? "").localeCompare(b.family_name ?? ""));
  }
  return [...sections.values()].sort((a, b) => a.key.localeCompare(b.key));
}
