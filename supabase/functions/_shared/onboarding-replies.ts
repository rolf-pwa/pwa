// onboarding-replies.ts: how Georgia handles a client's reply to a reminder. Pure (no I/O) so it can be unit-tested.
// Georgia never writes back. A reply either pauses her (a short, plain acknowledgement) or goes to a person with the
// reply attached. When in any doubt, it goes to a person.

import type { ThreadMessage } from "./gmail-read.ts";

export type ReplyIntent = "acknowledged" | "question" | "concern" | "wants_person" | "stop" | "other";
export type ReplyAction = { kind: "snooze"; days: number } | { kind: "escalate"; reason: "client_replied" | "asked_to_stop" };

export const SNOOZE_DAYS_ACK = 3;
export const SNOOZE_DAYS_STAFF = 7;
const MAX_ACK_CHARS = 300;

/** The new text of a reply: quoted history, signatures and mobile footers removed, capped in length. */
export function cleanReply(text: string, max = 1200): string {
  const lines: string[] = [];
  for (const raw of String(text ?? "").replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (/^on .{5,200}wrote:?$/i.test(line) || /^-{2,}\s*(original message|forwarded message)/i.test(line) || /^from:\s.+@/i.test(line) && lines.length > 0) break;
    if (line.startsWith(">")) continue;
    if (/^sent from my /i.test(line) || /^get outlook for /i.test(line)) break;
    lines.push(line);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

/** Out-of-office replies, bounces and other machine mail: not a person talking to us. */
export function isAutomatic(m: Pick<ThreadMessage, "headers" | "subject" | "from">): boolean {
  const h = m.headers;
  if ((h["auto-submitted"] ?? "no").toLowerCase() !== "no") return true;
  if (/bulk|auto_reply|junk|list/i.test(h["precedence"] ?? "")) return true;
  if (h["x-autoreply"] || h["x-autorespond"] || h["x-auto-response-suppress"]) return true;
  if (/mailer-daemon|postmaster|no-?reply/i.test(m.from)) return true;
  return /^(automatic reply|auto(matic)?[-: ]|out of (the )?office|undeliverable|delivery status)/i.test(m.subject.trim());
}

const RISK = /\b(lawyer|legal|attorney|sue|lawsuit|complain|complaint|fraud|scam|refund|cancel|chargeback|privacy commissioner|unsubscribe|stop (emailing|contacting|messaging)|remove me|do not (email|contact)|harass|passed away|died|death|hospital|divorce|separat)/i;

export function hasRisk(text: string): boolean { return RISK.test(text); }

export function classifierPrompt(scrubbedReply: string): string {
  return `You triage a client's reply to an automated onboarding reminder from a financial advisory firm. The reminder only said their next step is waiting in their portal. Classify the reply.

intent must be exactly one of:
- acknowledged: they simply say thanks, will do, or that they will get to it. No question, no problem, no request.
- question: they ask something.
- concern: they report a problem, are upset, confused, or mention anything sensitive (money trouble, health, family changes, legal, fees).
- wants_person: they ask to talk, call or meet with someone.
- stop: they ask us to stop emailing them.
- other: anything else.

Also write "summary": one neutral sentence describing the reply (no names, numbers or contact details).
Return only JSON: {"intent": "...", "summary": "..."}

Reply:
"""
${scrubbedReply}
"""`;
}

const INTENTS: ReplyIntent[] = ["acknowledged", "question", "concern", "wants_person", "stop", "other"];

export function parseClassification(obj: unknown): { intent: ReplyIntent; summary: string } {
  const o = (obj ?? {}) as Record<string, unknown>;
  const intent = INTENTS.includes(o.intent as ReplyIntent) ? (o.intent as ReplyIntent) : "other";
  const summary = typeof o.summary === "string" ? o.summary.trim().slice(0, 240) : "";
  return { intent, summary };
}

/** What to do with a classified reply. Only a short, plain acknowledgement that raises no risk keyword is allowed to pause Georgia on her own. */
export function replyAction(intent: ReplyIntent, replyText: string): ReplyAction {
  if (intent === "stop" || /\b(unsubscribe|stop (emailing|contacting|messaging)|remove me|do not (email|contact))/i.test(replyText)) {
    return { kind: "escalate", reason: "asked_to_stop" };
  }
  if (intent === "acknowledged" && replyText.length <= MAX_ACK_CHARS && !replyText.includes("?") && !hasRisk(replyText)) {
    return { kind: "snooze", days: SNOOZE_DAYS_ACK };
  }
  return { kind: "escalate", reason: "client_replied" };
}

/** The messages in a thread that are replies from outside: not ones we sent, and not machine mail. A person at the firm replying from the shared mailbox is reported separately. */
export function inboundReplies(messages: ThreadMessage[], opts: { sentIds: string[]; handledIds: string[] }): { client: ThreadMessage[]; staff: ThreadMessage[] } {
  const skip = new Set([...opts.sentIds, ...opts.handledIds]);
  const client: ThreadMessage[] = [];
  const staff: ThreadMessage[] = [];
  for (const m of [...messages].sort((a, b) => a.internalDate - b.internalDate)) {
    if (skip.has(m.id) || isAutomatic(m)) continue;
    (m.labelIds.includes("SENT") ? staff : client).push(m);
  }
  return { client, staff };
}
