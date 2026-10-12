// onboarding-checklist.ts: the visible checklist of Georgia's onboarding work, kept as PM tasks (parent + subtasks)
// assigned to the "onboarding_concierge" agent. Pure, so it can be unit-tested.

export const CONCIERGE_KEY = "onboarding_concierge";

export type ChecklistKey = "vault" | "survey" | "documents";

export const CHECKLIST: { key: ChecklistKey; title: string }[] = [
  { key: "vault", title: "Vault ready" },
  { key: "survey", title: "Survey Session booked" },
  { key: "documents", title: "Documents received" },
];

export const parentTitle = (label: string) => `Onboarding: ${label}`;

export const progressFrom = (f: { vaultProvisioned: boolean; surveyBooked: boolean; docsReceived: boolean }): Record<ChecklistKey, boolean> => ({
  vault: f.vaultProvisioned,
  survey: f.surveyBooked,
  documents: f.docsReceived,
});

/** Which checklist items just became done: done now, not yet recorded as done. */
export function newlyDone(progress: Record<ChecklistKey, boolean>, alreadyDone: ChecklistKey[]): ChecklistKey[] {
  return CHECKLIST.map((c) => c.key).filter((k) => progress[k] && !alreadyDone.includes(k));
}

export const NUDGE_COMMENT = (n: number, step: "survey" | "documents") =>
  `Georgia sent reminder ${n} by email (next step: ${step === "survey" ? "book the Survey Session" : "add documents"}).`;
export const COMPLETE_COMMENT = "Onboarding is complete: the Survey Session is booked and documents have been received.";
export const ESCALATED_COMMENT = (detail: string) => `Georgia has handed this to a person and stopped contacting the client. ${detail}`;
export const PAUSED_COMMENT = (paused: boolean) => (paused ? "Georgia was paused by staff and will not contact the client." : "Georgia was resumed by staff.");
