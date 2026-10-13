// review-windows.ts: Georgia's review-window rules. Pure (no I/O) so they can be unit-tested.
//
// Each family has meetings it is owed each year, by tier. Each meeting has a window in which it can happen (a quarter, or a
// half-year for Tier 2B). On the first day of the window Georgia invites both adults to book it in the portal, reminds them every
// three weeks, and hands the family to a person if nothing is booked with three weeks to go. She never writes back to a reply.

export type ReviewKind = "annual_review" | "sovereignty_review" | "governance_review";
export type Tier = "tier_0" | "tier_1" | "tier_2a" | "tier_2b" | "tier_3" | "tier_4";

export const KIND_LABEL: Record<ReviewKind, string> = {
  annual_review: "Annual Review",
  sovereignty_review: "Sovereignty Review",
  governance_review: "Governance Review",
};

/** Words in a calendar event title that mean each kind of meeting ("System Review" is the older name for the Sovereignty Review, "Charter Review" for the Governance Review). */
const ALIASES: Record<ReviewKind, string[]> = {
  annual_review: ["annual review", "annual stewardship review"],
  sovereignty_review: ["sovereignty review", "system review"],
  governance_review: ["governance review", "charter review"],
};

export interface RequiredMeeting { kind: ReviewKind; key: string; windowStart: string; windowEnd: string }

const Q = (y: number, q: 1 | 2 | 3 | 4) => ({
  1: [`${y}-01-01`, `${y}-03-31`], 2: [`${y}-04-01`, `${y}-06-30`], 3: [`${y}-07-01`, `${y}-09-30`], 4: [`${y}-10-01`, `${y}-12-31`],
}[q]);

/**
 * The meetings a family is owed in a year, by tier (Rolf's cadence, 2026-10-13):
 *  Tier 0: none. Tier 1 and 2A: one Annual Review in Q1. Tier 2B: a Sovereignty Review in Jan to Jun and another in Jul to Dec.
 *  Tier 3 (and 4, the same for now): Sovereignty Reviews in Q1, Q2 and Q3, and a Governance Review in Q4.
 */
export function requiredMeetings(tier: Tier | null, year: number): RequiredMeeting[] {
  switch (tier) {
    case "tier_1":
    case "tier_2a": { const [s, e] = Q(year, 1); return [{ kind: "annual_review", key: `${year}-Q1-annual_review`, windowStart: s, windowEnd: e }]; }
    case "tier_2b":
      return [
        { kind: "sovereignty_review", key: `${year}-H1-sovereignty_review`, windowStart: `${year}-01-01`, windowEnd: `${year}-06-30` },
        { kind: "sovereignty_review", key: `${year}-H2-sovereignty_review`, windowStart: `${year}-07-01`, windowEnd: `${year}-12-31` },
      ];
    case "tier_3":
    case "tier_4":
      return ([1, 2, 3, 4] as const).map((q) => {
        const [s, e] = Q(year, q);
        const kind: ReviewKind = q === 4 ? "governance_review" : "sovereignty_review";
        return { kind, key: `${year}-Q${q}-${kind}`, windowStart: s, windowEnd: e };
      });
    default:
      return [];
  }
}

/** Which kind of review a calendar event is, from its title. Null when it is some other meeting. */
export function kindFromTitle(summary: string | null | undefined): ReviewKind | null {
  const t = String(summary ?? "").toLowerCase();
  for (const kind of Object.keys(ALIASES) as ReviewKind[]) if (ALIASES[kind].some((a) => t.includes(a))) return kind;
  return null;
}

/** Today's date in Pacific time as YYYY-MM-DD. */
export function pacificDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

export const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);

export interface ReviewConfig {
  remindEveryDays: number;
  handoffDaysBeforeEnd: number;
  maxNudges: number;
  sendStartHour: number;
  sendEndHour: number;
  weekdaysOnly: boolean;
}
export const DEFAULT_REVIEW_CONFIG: ReviewConfig = { remindEveryDays: 21, handoffDaysBeforeEnd: 21, maxNudges: 4, sendStartHour: 9, sendEndHour: 17, weekdaysOnly: true };

export type ReviewStatus = "open" | "booked" | "held" | "escalated" | "paused" | "cancelled";
export interface ReviewFacts {
  now: number;
  status: ReviewStatus;
  windowStart: string;
  windowEnd: string;
  /** A matching meeting is on the calendar, with its start time. */
  bookedStart: number | null;
  recipients: number;
  nudgeCount: number;
  lastNudgeAt: number | null;
  snoozedUntil: number | null;
}

export type ReviewDecision =
  | { kind: "wait"; reason: string }
  | { kind: "booked" }
  | { kind: "held" }
  | { kind: "nudge"; reminder: boolean }
  | { kind: "escalate"; reason: "no_email" | "not_booked_near_end" | "window_closed" | "no_response"; detail: string };

function inSendWindow(ms: number, cfg: ReviewConfig): boolean {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", hour: "numeric", hour12: false, weekday: "short" }).formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  if (cfg.weekdaysOnly && (weekday === "Sat" || weekday === "Sun")) return false;
  return hour >= cfg.sendStartHour && hour < cfg.sendEndHour;
}

export function decideReview(f: ReviewFacts, cfg: ReviewConfig = DEFAULT_REVIEW_CONFIG): ReviewDecision {
  if (f.status === "held" || f.status === "cancelled") return { kind: "wait", reason: f.status };
  if (f.status === "escalated") return { kind: "wait", reason: "with_a_person" };
  if (f.status === "paused") return { kind: "wait", reason: "paused" };

  const today = pacificDate(f.now);
  if (f.bookedStart !== null) return f.bookedStart < f.now ? { kind: "held" } : { kind: "booked" };

  if (today < f.windowStart) return { kind: "wait", reason: "window_not_open" };
  if (today > f.windowEnd) return { kind: "escalate", reason: "window_closed", detail: `The window closed on ${f.windowEnd} with no meeting booked.` };
  if (f.recipients === 0) return { kind: "escalate", reason: "no_email", detail: "Neither adult in this family has an email address on file, so nobody can be invited." };
  if (f.snoozedUntil && f.now < f.snoozedUntil) return { kind: "wait", reason: "snoozed" };

  const daysLeft = daysBetween(today, f.windowEnd);
  if (daysLeft <= cfg.handoffDaysBeforeEnd) {
    return { kind: "escalate", reason: "not_booked_near_end", detail: `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in the window and no meeting is booked (${f.nudgeCount} invitation${f.nudgeCount === 1 ? "" : "s"} sent).` };
  }
  if (f.nudgeCount >= cfg.maxNudges) return { kind: "escalate", reason: "no_response", detail: `${f.nudgeCount} invitations sent with no meeting booked.` };

  const due = f.nudgeCount === 0 || (f.lastNudgeAt !== null && f.now - f.lastNudgeAt >= cfg.remindEveryDays * 86_400_000);
  if (!due) return { kind: "wait", reason: "not_due" };
  if (!inSendWindow(f.now, cfg)) return { kind: "wait", reason: "outside_send_window" };
  return { kind: "nudge", reminder: f.nudgeCount > 0 };
}

// ───── Who is invited ─────
export interface FamilyContact { id: string; firstName: string | null; lastName: string | null; email: string | null; role: string | null; isMinor: boolean | null }
/** Both adults: the head of family and their spouse, with an email, once each. */
export function inviteesOf(contacts: FamilyContact[]): { contactId: string; firstName: string; email: string }[] {
  const seen = new Set<string>();
  const out: { contactId: string; firstName: string; email: string }[] = [];
  for (const c of contacts) {
    if (c.isMinor || !["head_of_family", "spouse"].includes(c.role ?? "")) continue;
    const email = (c.email ?? "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ contactId: c.id, firstName: c.firstName ?? "", email });
  }
  return out;
}

// ───── The message ─────
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dateLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });

export function windowEmail(i: { firstName: string; kind: ReviewKind; windowEnd: string; reminder: boolean; portalUrl: string; fromLine: string }): { subject: string; html: string } {
  const label = KIND_LABEL[i.kind];
  const lead = i.reminder
    ? `A quick reminder to book your ${label}. You can pick any time that suits you before ${dateLabel(i.windowEnd)}.`
    : `It's time to book your ${label}. You can pick any time that suits you before ${dateLabel(i.windowEnd)}.`;
  return {
    subject: i.reminder ? `Reminder: book your ${label}` : `Time to book your ${label}`,
    html: `
    <div style="font-family:'DM Sans',sans-serif;color:#334155;max-width:520px;margin:0 auto;">
      <p style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;">Sovereignty Operating System™</p>
      <p style="font-size:14px;line-height:1.6;">Hi ${escape(i.firstName || "there")},</p>
      <p style="font-size:14px;line-height:1.6;">${lead}</p>
      <p style="font-size:14px;line-height:1.6;">Sign in to your portal and open <strong>Meetings</strong> to choose a time.</p>
      <p style="margin:20px 0;"><a href="${i.portalUrl}" style="background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:14px;">Open your portal</a></p>
      <p style="font-size:13px;line-height:1.6;color:#64748b;">This is an automated email from ${i.fromLine}. If you need to get in touch with Rolf, just reply to this email, and I'll make sure he gets it.</p>
      <p style="font-size:14px;line-height:1.6;margin-top:24px;">Georgia<br/><span style="font-size:12px;color:#94a3b8;">AI Assistant, ProsperWise</span></p>
    </div>`.trim(),
  };
}

export const REVIEW_TASK_TITLE = (family: string, kind: ReviewKind) => `${KIND_LABEL[kind]} needs a person: ${family}`;
export function reviewTaskBody(i: { reason: string; detail: string; family: string; kind: ReviewKind; windowStart: string; windowEnd: string; nudges: number; replyPreview?: string }): string {
  return [
    i.detail,
    ...(i.replyPreview ? ["", "What the client wrote:", `"${i.replyPreview}"`] : []),
    "",
    `Family: ${i.family}. ${KIND_LABEL[i.kind]} window: ${dateLabel(i.windowStart)} to ${dateLabel(i.windowEnd)}. Invitations sent: ${i.nudges}.`,
    "",
    "Suggested next step: call or write to the family and book the meeting with them directly.",
    "",
    "Georgia has stopped contacting this family about this meeting. Mark this task done once it is resolved.",
  ].join("\n");
}
