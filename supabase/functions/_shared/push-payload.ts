// push-payload.ts — what a client's lock screen is allowed to show. Pure.
//
// Deliberately GENERIC: the text of a notification (which can name accounts,
// amounts or people) never goes into a push. Push services (FCM/APNs) are
// US-hosted and a lock screen is visible to anyone nearby; ProsperWise's own
// compliance posture keeps financial PII off US-resident services. The
// notification title/body stay inside the portal, behind the client's login.

export interface PushPayload {
  title: string;
  body: string;
  /** Collapses repeats of the same kind into one lock-screen entry. */
  tag: string;
  /** Where tapping it opens. Never contains a portal token. */
  url: string;
}

const COPY: Record<string, { title: string; body: string }> = {
  task: { title: "A task is waiting for you", body: "Open your portal to see what your Personal CFO needs." },
  request: { title: "An update on your request", body: "Open your portal to read the latest." },
  message: { title: "New message from your Personal CFO", body: "Open your portal to read it." },
  document: { title: "A document is ready", body: "Open your portal to review it." },
};
const FALLBACK = { title: "You have an update", body: "Open your portal to see what's new." };

export function buildPushPayload(notification: { source_type?: string | null }): PushPayload {
  const kind = notification.source_type ?? "";
  const c = COPY[kind] ?? FALLBACK;
  return { ...c, tag: `pw-${COPY[kind] ? kind : "update"}`, url: "/portal" };
}

export type PushOutcome = "ok" | "gone" | "retry" | "fail";

/** 404/410 mean the subscription is dead and must be deleted; 429/5xx are worth another try. */
export function classifyPushStatus(status: number): PushOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 404 || status === 410) return "gone";
  if (status === 429 || status >= 500) return "retry";
  return "fail";
}

/** Subscriptions failing this many consecutive sends are dropped. */
export const MAX_PUSH_FAILURES = 5;

/** Only notifications this recent are pushed, so first enabling the drain doesn't replay history. */
export const PUSH_WINDOW_HOURS = 24;
