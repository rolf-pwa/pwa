// task-notify.ts: telling a client that staff commented on one of their tasks, and telling staff that a client replied.
// Moving forward only: nothing is sent for earlier comments.

// deno-lint-ignore-file no-explicit-any

export interface TaskRef {
  id: string;
  title: string;
  client_visible: boolean | null;
  contact_id: string | null;
  household_id: string | null;
}

/** Who is told: the task's own contact, or every adult in its household when it has none. Nothing for a task clients cannot see. */
export function commentRecipientIds(task: TaskRef, householdContacts: { id: string; is_minor?: boolean | null }[]): string[] {
  if (!task.client_visible) return [];
  if (task.contact_id) return [task.contact_id];
  return householdContacts.filter((c) => !c.is_minor).map((c) => c.id);
}

/** One notification per recipient: a bell entry in the portal, and (through the existing digest) at most one short email with no task details. */
export async function notifyClientsOfComment(db: any, task: TaskRef, supabaseUrl: string, serviceKey: string): Promise<number> {
  if (!task.client_visible) return 0;
  let household: { id: string; is_minor?: boolean | null }[] = [];
  if (!task.contact_id && task.household_id) {
    const { data } = await db.from("contacts").select("id, is_minor").eq("household_id", task.household_id);
    household = data ?? [];
  }
  const ids = commentRecipientIds(task, household);
  let sent = 0;
  for (const contact_id of ids) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/notify-portal-request`, {
        method: "POST",
        headers: { "x-region": "ca-central-1", "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ notify_type: "task", contact_id, task_name: task.title, task_event: "comment" }),
      });
      if (res.ok) sent++;
      else console.error(`[task-notify] notify failed ${res.status}`);
    } catch (e) {
      console.error("[task-notify] notify error", e);
    }
  }
  return sent;
}

/** An in-app note for Rolf when a client replies on a task. */
export async function notifyStaffOfClientReply(db: any, task: TaskRef, clientName: string, body: string, contactId: string): Promise<void> {
  await db.from("staff_notifications").insert({
    title: `${clientName || "A client"} replied on: ${task.title}`.slice(0, 200),
    body: body.length > 140 ? `${body.slice(0, 140)}…` : body,
    link: `/contacts/${contactId}`,
    contact_id: contactId,
    source_type: "task_client_reply",
  });
}
