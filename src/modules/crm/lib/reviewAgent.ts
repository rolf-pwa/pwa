import { supabase } from "@/shared/integrations/supabase/client";

const URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/review-agent-admin`;

export type ReviewMode = "off" | "shadow" | "live";
export type ReviewKind = "annual_review" | "sovereignty_review" | "governance_review" | "rebalancing";
export interface ReviewObligation {
  id: string; family_id: string; household_id?: string | null; family_name: string | null; kind: ReviewKind; window_key: string; window_start: string; window_end: string; tier: string | null;
  invite?: boolean; mode: "shadow" | "live"; status: "open" | "booked" | "held" | "escalated" | "paused" | "cancelled"; booked_start: string | null; acknowledged_at?: string | null; published_at?: string | null; completed_at?: string | null; proposal_summary?: string | null; nudge_count: number; escalation_reason: string | null;
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

import type { ModelPortfolio, Pack } from "../../../../supabase/functions/_shared/portfolio-review";
export type { Pack as PortfolioPack, ModelPortfolio };
export interface PortfolioPackResponse {
  household: { id: string; label: string | null; family_id: string; family_name: string | null; service_tier: string | null };
  pack: Pack;
  profiles: { id: string; account_number: string | null; label: string | null; income_pct: number | null; equity_pct: number | null; band_pct: number; as_of: string | null; updated_by: string | null; profile_key: string | null }[];
  models: ModelPortfolio[];
  rebalancePublication: { id: string; published_at: string; published_by: string; note: string | null; includes: { returns: boolean; mix: boolean; funds: boolean; reset: boolean; rebalancing?: boolean } } | null;
  rebalancingObligation: { id: string; window_start: string; window_end: string; status: string; published_at: string | null; acknowledged_at: string | null; completed_at: string | null } | null;
  publication: { id: string; published_at: string; published_by: string; note: string | null; includes: { returns: boolean; mix: boolean; funds: boolean; reset: boolean; rebalancing?: boolean } } | null;
}
export const getPortfolioPack = (householdId: string) => call<PortfolioPackResponse>("portfolioPack", { householdId });
export const saveInvestorProfile = (p: { householdId: string; accountNumber?: string | null; profileKey?: string; label?: string; incomePct?: number; bandPct?: number }) => call<{ ok: true }>("saveInvestorProfile", p);
export const saveGuaranteeReset = (householdId: string, accountNumber: string, lastResetDate: string | null) => call<{ ok: true }>("saveGuaranteeReset", { householdId, accountNumber, lastResetDate });
import type { ModelValidation, ParsedModel } from "../../../../supabase/functions/_shared/ia-model-parse";
export type { ModelValidation, ParsedModel };
export const readModelPdf = (pdfBase64: string) => call<{ validation: ModelValidation }>("readModelPdf", { pdfBase64 });
export const saveModels = (asOf: string, models: ParsedModel[], sourceFile: string) => call<{ ok: true; asOf: string }>("saveModels", { asOf, models, sourceFile });
export const publishPortfolioReview = (householdId: string, note: string, includes: { returns: boolean; mix: boolean; funds: boolean; reset: boolean; rebalancing: boolean }, kind: "review" | "rebalance" = "review") => call<{ ok: true; emailed: number; updated: boolean }>("publishPortfolioReview", { householdId, note, includes, kind });
export const unpublishPortfolioReview = (householdId: string, kind: "review" | "rebalance" = "review") => call<{ ok: true }>("unpublishPortfolioReview", { householdId, kind });
export const getWorkbenchFacts = (householdId: string) => call<import("./workbenchSteps").WorkbenchFacts>("workbenchFacts", { householdId });
import type { ClientProposal } from "../../../../supabase/functions/_shared/portfolio-review-client";
export type { ClientProposal };
export const getRebalancingProposal = (obligationId: string) => call<{ proposal: ClientProposal | null; householdId: string | null; frozen?: boolean; reason?: string | null }>("rebalancingProposal", { obligationId });
export const deleteInvestorProfile = (householdId: string, accountNumber: string | null) => call<{ ok: true }>("deleteInvestorProfile", { householdId, accountNumber });
export const setReviewMode = (mode: ReviewMode, confirm = false) => call<{ ok: true; mode: ReviewMode }>("setMode", { mode, confirm });
export const setReviewPaused = (obligationId: string, paused: boolean) => call<{ ok: true }>("setPaused", { obligationId, paused });
export const publishRebalancing = (obligationId: string, summary: string) => call<{ ok: true }>("publishRebalancing", { obligationId, summary });
export const unpublishRebalancing = (obligationId: string) => call<{ ok: true }>("unpublishRebalancing", { obligationId });
export const completeRebalancing = (obligationId: string) => call<{ ok: true }>("completeRebalancing", { obligationId });

export const KIND_LABEL: Record<ReviewKind, string> = { annual_review: "Portfolio Review", sovereignty_review: "Sovereignty Review", governance_review: "Governance Review", rebalancing: "Portfolio Rebalancing" };
/**
 * Where a portfolio rebalancing is, for Rolf: still being prepared, published and waiting for the client to review it, acknowledged
 * and waiting for him to carry it out, or done. Meetings have no such stages.
 */
export type RebalancingStage = "preparing" | "waiting" | "toExecute" | "done";
export function rebalancingStage(o: Pick<ReviewObligation, "published_at" | "acknowledged_at" | "completed_at">): RebalancingStage {
  if (o.completed_at) return "done";
  if (o.acknowledged_at) return "toExecute";
  return o.published_at ? "waiting" : "preparing";
}
const STAGE_LABEL: Record<RebalancingStage, string> = { preparing: "Preparing", waiting: "Waiting for the client", toExecute: "To carry out", done: "Done" };
/** "Held" means a meeting took place; a rebalancing has its own stages. */
export const statusLabel = (o: Pick<ReviewObligation, "status" | "kind" | "published_at" | "acknowledged_at" | "completed_at">) =>
  o.kind === "rebalancing" && (o.status === "open" || o.status === "held") ? STAGE_LABEL[rebalancingStage(o)] : STATUS_LABEL[o.status];
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
    case "held": return d.kind === "rebalancing" ? "The client acknowledged the rebalancing" : "The meeting took place";
    case "rebalancing_published": return "Rebalancing published to the portal: Georgia will invite the family to review it";
    case "rebalancing_republished": return "The published rebalancing was updated";
    case "rebalancing_unpublished": return "The rebalancing was taken back from the portal";
    case "rebalancing_completed": return "Rebalancing carried out: the family was told in the portal";
    case "rebalancing_acknowledged": return `${d.by ?? "A client"} reviewed and acknowledged the ${d.label ?? ""} rebalancing`.replace(/\s+/g, " ");
    case "rebalancing_talk_first": return `${d.by ?? "A client"} wants to talk before the ${d.label ?? ""} rebalancing`.replace(/\s+/g, " ");
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
    case "portfolio_review_published": return d.updated ? `Portfolio Review updated on the portal by ${d.by ?? "staff"}` : `Portfolio Review published to the portal by ${d.by ?? "staff"} (${d.emailed ?? 0} emailed)`;
    case "portfolio_review_unpublished": return `Portfolio Review taken back from the portal by ${d.by ?? "staff"}`;
    case "ia_models_saved": return `iA model portfolios as at ${d.as_of ?? "?"} saved by ${d.by ?? "staff"}`;
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
  counts: { notBooked: number; booked: number; held: number; withPerson: number; toExecute: number };
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
        items: [], counts: { notBooked: 0, booked: 0, held: 0, withPerson: 0, toExecute: 0 },
      });
    }
    const sec = sections.get(key)!;
    sec.items.push(o);
    if (o.kind === "rebalancing" && o.status !== "escalated" && rebalancingStage(o) === "toExecute") sec.counts.toExecute++;
    else if (o.kind === "rebalancing" && o.status !== "escalated" && rebalancingStage(o) === "done") sec.counts.held++;
    else if (o.status === "escalated") sec.counts.withPerson++;
    else if (o.status === "booked") sec.counts.booked++;
    else if (o.status === "held") sec.counts.held++;
    else sec.counts.notBooked++;
  }
  for (const sec of sections.values()) {
    sec.items.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.family_name ?? "").localeCompare(b.family_name ?? ""));
  }
  return [...sections.values()].sort((a, b) => a.key.localeCompare(b.key));
}
