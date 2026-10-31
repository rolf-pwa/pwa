// opportunity-accept.ts: accepting a book-of-business opportunity creates one task for the person who accepted it.
// The task is built from the stored finding (its evidence and suggested next step), never reworded by a model.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const DUE_IN_DAYS = 7;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export interface OpportunityForTask { title: string; confidence: string; evidence: { label: string; value: string }[]; next_step: string | null }

export function taskFor(o: OpportunityForTask, householdLabel: string, today: Date = new Date()) {
  const lines = [
    "Why it came up:",
    ...o.evidence.map((e) => `- ${e.label}: ${e.value}`),
    ...(o.next_step ? ["", `Suggested next step: ${o.next_step}`] : []),
    "",
    `Confidence: ${o.confidence}. This is a prompt for a conversation, not a recommendation to the client; check the facts first.`,
  ];
  return {
    title: `Book of Business: ${householdLabel}: ${o.title}`.slice(0, 200),
    description: lines.join("\n"),
    due_date: ymd(new Date(today.getTime() + DUE_IN_DAYS * 86_400_000)),
  };
}

export type AcceptResult = { ok: true; taskId: string; already: boolean } | { ok: false; error: string };

export async function acceptOpportunity(db: SupabaseClient, opportunityId: string, userId: string, userEmail: string | null): Promise<AcceptResult> {
  const { data: o, error } = await db.from("opportunities").select("id, household_id, title, confidence, evidence, next_step, status, task_id").eq("id", opportunityId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!o) return { ok: false, error: "That opportunity no longer exists." };
  if (o.task_id) return { ok: true, taskId: o.task_id, already: true };
  if (o.status !== "open" && o.status !== "snoozed") return { ok: false, error: `It is already ${o.status}.` };

  const { data: hh } = await db.from("households").select("label, family_id").eq("id", o.household_id).maybeSingle();
  const t = taskFor(o, hh?.label ?? "Household");
  const { data: task, error: taskErr } = await db.from("pm_tasks").insert({
    title: t.title, description: t.description, status: "open", client_visible: false,
    assignee_id: userId, created_by: userId, household_id: o.household_id, family_id: hh?.family_id ?? null, due_date: t.due_date,
  }).select("id").single();
  if (taskErr || !task) return { ok: false, error: taskErr?.message ?? "The task could not be created." };

  // Only an open or snoozed opportunity with no task yet becomes accepted; if another click got there first, take this task back.
  const { data: updated, error: upErr } = await db.from("opportunities")
    .update({ status: "accepted", task_id: task.id, snoozed_until: null, decided_by: userEmail, decided_at: new Date().toISOString() })
    .eq("id", opportunityId).in("status", ["open", "snoozed"]).is("task_id", null).select("id");
  if (upErr || !updated?.length) {
    await db.from("pm_tasks").delete().eq("id", task.id);
    if (upErr) return { ok: false, error: upErr.message };
    const { data: now } = await db.from("opportunities").select("task_id").eq("id", opportunityId).maybeSingle();
    return now?.task_id ? { ok: true, taskId: now.task_id, already: true } : { ok: false, error: "It changed while you were accepting it. Reload and try again." };
  }
  return { ok: true, taskId: task.id, already: false };
}
