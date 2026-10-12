// onboarding-agent.ts: the decision logic for Georgia's onboarding concierge. Pure (no I/O) so it can be unit-tested.
//
// The agent owns a household from the moment it enrols until onboarding is complete: the Survey Session is booked and
// documents have been received. A fixed policy decides what happens next; the model never chooses actions. It can only
// nudge by email, retry a failed Vault build, or escalate to a person. It never sends details of what is missing and never
// gives advice.

export type CaseStatus = "active" | "complete" | "escalated" | "paused";
export type NudgeStep = "survey" | "documents";

export interface AgentConfig {
  maxNudges: number;
  firstNudgeHours: number;
  minGapHours: number;
  sendStartHour: number; // inclusive, America/Vancouver
  sendEndHour: number; // exclusive
  weekdaysOnly: boolean;
  vaultGraceMinutes: number;
  vaultRetryLimit: number;
}

export const DEFAULT_CONFIG: AgentConfig = {
  maxNudges: 4,
  firstNudgeHours: 24,
  minGapHours: 48,
  sendStartHour: 9,
  sendEndHour: 17,
  weekdaysOnly: true,
  vaultGraceMinutes: 30,
  vaultRetryLimit: 2,
};

export interface CaseFacts {
  now: number;
  status: CaseStatus;
  enrolledAt: number;
  openedAt: number;
  surveyBooked: boolean;
  docsReceived: boolean;
  vaultProvisioned: boolean;
  vaultRetries: number;
  hasEmail: boolean;
  /** An open message from the client in the portal: a person is already handling it, so the agent stays quiet. */
  openPortalRequest: boolean;
  /** The latest sign the client did something (uploaded, booked, completed a step). */
  lastClientActivityAt: number | null;
  nudgeCount: number;
  lastNudgeAt: number | null;
  /** Georgia is waiting until then (the client acknowledged, or a person replied to them). */
  snoozedUntil?: number | null;
}

export type Decision =
  | { kind: "wait"; reason: string }
  | { kind: "complete" }
  | { kind: "retry_vault" }
  | { kind: "nudge"; step: NudgeStep }
  | { kind: "escalate"; reason: EscalationReason; detail: string };

export type EscalationReason = "no_response" | "vault_failed" | "no_email" | "client_replied" | "asked_to_stop";

const HOUR = 3_600_000;

/** Nudges sent since the client last did something: activity after the last nudge starts the count over. */
export function nudgesSinceActivity(f: Pick<CaseFacts, "nudgeCount" | "lastNudgeAt" | "lastClientActivityAt">): number {
  return f.lastClientActivityAt !== null && f.lastNudgeAt !== null && f.lastClientActivityAt > f.lastNudgeAt ? 0 : f.nudgeCount;
}

/** The count to store after sending a nudge. */
export const nextNudgeCount = (f: Pick<CaseFacts, "nudgeCount" | "lastNudgeAt" | "lastClientActivityAt">) => nudgesSinceActivity(f) + 1;

/** Is `ms` inside the window the agent may contact people (weekday business hours, Pacific time)? */
export function withinSendWindow(ms: number, cfg: Pick<AgentConfig, "sendStartHour" | "sendEndHour" | "weekdaysOnly">): boolean {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", hour: "numeric", hour12: false, weekday: "short" }).formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  if (cfg.weekdaysOnly && (weekday === "Sat" || weekday === "Sun")) return false;
  return hour >= cfg.sendStartHour && hour < cfg.sendEndHour;
}

export function decideNext(f: CaseFacts, cfg: AgentConfig = DEFAULT_CONFIG): Decision {
  if (f.status === "complete") return { kind: "wait", reason: "already_complete" };
  if (f.status === "escalated") return { kind: "wait", reason: "escalated_to_person" };
  if (f.status === "paused") return { kind: "wait", reason: "paused" };

  if (f.surveyBooked && f.docsReceived) return { kind: "complete" };

  if (!f.vaultProvisioned) {
    if (f.now - f.enrolledAt < cfg.vaultGraceMinutes * 60_000) return { kind: "wait", reason: "vault_building" };
    if (f.vaultRetries < cfg.vaultRetryLimit) return { kind: "retry_vault" };
    return { kind: "escalate", reason: "vault_failed", detail: `The client's Vault could not be built after ${f.vaultRetries} retries.` };
  }

  if (!f.hasEmail) return { kind: "escalate", reason: "no_email", detail: "The head of household has no email address on file, so no one can be reached." };

  if (f.openPortalRequest) return { kind: "wait", reason: "client_message_open" };
  if (f.snoozedUntil && f.now < f.snoozedUntil) return { kind: "wait", reason: "snoozed" };

  const sent = nudgesSinceActivity(f);
  const lastTouch = Math.max(f.openedAt, f.lastNudgeAt ?? 0, f.lastClientActivityAt ?? 0);
  const dueAfter = (sent === 0 && f.lastNudgeAt === null ? cfg.firstNudgeHours : cfg.minGapHours) * HOUR;
  if (f.now - lastTouch < dueAfter) return { kind: "wait", reason: "not_due" };

  if (sent >= cfg.maxNudges) {
    return { kind: "escalate", reason: "no_response", detail: `${sent} reminders sent over several days with no response from the client.` };
  }
  if (!withinSendWindow(f.now, cfg)) return { kind: "wait", reason: "outside_send_window" };
  return { kind: "nudge", step: f.surveyBooked ? "documents" : "survey" };
}

// ───── The message ─────
// Deliberately generic: it names the next step only, never what is missing, and carries no personal details or links
// with tokens. The client signs in to the portal as usual.

export const AGENT_NAME = "Georgia, AI Assistant";
export const AGENT_SENDER = "Georgia, AI Assistant · ProsperWise <rolf@prosperwise.ca>";
export const PORTAL_URL = "https://app.prosperwise.ca/portal";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function nudgeEmail(firstName: string, step: NudgeStep): { subject: string; html: string } {
  const lead = step === "survey" ? "Your next step is to book your Survey Session." : "Your next step is waiting for you in your portal.";
  return {
    subject: step === "survey" ? "Your next step with ProsperWise" : "A quick next step in your ProsperWise portal",
    html: `
    <div style="font-family:'DM Sans',sans-serif;color:#334155;max-width:520px;margin:0 auto;">
      <p style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;">Sovereignty Operating System™</p>
      <p style="font-size:14px;line-height:1.6;">Hi ${escape(firstName)},</p>
      <p style="font-size:14px;line-height:1.6;">${lead} It only takes a few minutes.</p>
      <p style="font-size:14px;line-height:1.6;">To continue, sign in to your portal with this email address:</p>
      <p style="margin:20px 0;"><a href="${PORTAL_URL}" style="background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:14px;">Open your portal</a></p>
      <p style="font-size:13px;line-height:1.6;color:#64748b;">This is an automated email from Georgia, Rolf's AI Assistant. If you need to get in touch with Rolf, just reply to this email, and I'll make sure he gets it.</p>
      <p style="font-size:14px;line-height:1.6;margin-top:24px;">Georgia<br/><span style="font-size:12px;color:#94a3b8;">AI Assistant, ProsperWise</span></p>
    </div>`.trim(),
  };
}

export const ESCALATION_TITLE = (label: string) => `Onboarding needs a person: ${label}`;

export function escalationBody(i: { reason: EscalationReason; detail: string; label: string; surveyBooked: boolean; docsReceived: boolean; nudges: number; enrolledAt: number; now: number; replyPreview?: string }): string {
  const days = Math.max(0, Math.floor((i.now - i.enrolledAt) / 86_400_000));
  const next: Record<EscalationReason, string> = {
    no_response: "Call or text the client. The reminders have not worked.",
    vault_failed: "Open the household's Vault page and use Provision structure, then check the Vault is reachable.",
    no_email: "Find a way to reach the client and add their email to the contact record.",
    client_replied: "Read the client's reply (it is in your inbox) and answer them.",
    asked_to_stop: "The client asked us to stop emailing. Honour that, and check with them how they would like to continue.",
  };
  return [
    i.detail,
    ...(i.replyPreview ? ["", "What the client wrote:", `"${i.replyPreview}"`] : []),
    "",
    `Household: ${i.label} (enrolled ${days} day${days === 1 ? "" : "s"} ago)`,
    `Survey Session booked: ${i.surveyBooked ? "yes" : "no"}. Documents received: ${i.docsReceived ? "yes" : "no"}. Reminders sent: ${i.nudges}.`,
    "",
    `Suggested next step: ${next[i.reason]}`,
    "",
    "Georgia has stopped contacting this client. Mark this task done once it is resolved.",
  ].join("\n");
}
