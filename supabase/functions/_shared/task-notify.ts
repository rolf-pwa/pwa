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

export const PRO_PORTAL_SIGN_IN = "https://app.prosperwise.ca/pro-portal/login";
const PRO_QUIET_MS = 30 * 60 * 1000;

/** The words of a content-free email to a professional: a comment is waiting, and where to sign in. Nothing about the task. */
export function proCommentEmail(name: string): { subject: string; text: string } {
  return {
    subject: "A task you are tagged on has a new comment",
    text: `Hello ${name || "there"},\n\nThere is a new comment on a task you are tagged on in the ProsperWise Pro Portal.\n\nSign in to read it:\n${PRO_PORTAL_SIGN_IN}\n\nThank you,\nProsperWise Team`,
  };
}

/**
 * Tells the professionals tagged on a task (or on its parent) that staff commented: one short email with no details, and not again
 * within 30 minutes of the previous staff comment on the same task. Professionals whose Pro Portal is off are not emailed.
 */
export async function notifyProsOfComment(db: any, task: { id: string; parent_task_id?: string | null }, supabaseUrl: string, serviceKey: string, internalSecret: string): Promise<number> {
  const { data: recent } = await db.from("pm_task_comments").select("created_at").eq("task_id", task.id).not("author_id", "is", null).order("created_at", { ascending: false }).limit(2);
  const previous = (recent ?? [])[1]?.created_at;
  if (previous && Date.now() - Date.parse(previous) < PRO_QUIET_MS) return 0;

  const ids = [task.id, ...(task.parent_task_id ? [task.parent_task_id] : [])];
  const { data: tags } = await db.from("pm_task_collaborators").select("professional_id").in("task_id", ids).not("professional_id", "is", null);
  const proIds = [...new Set((tags ?? []).map((t: any) => t.professional_id))];
  if (!proIds.length) return 0;
  const { data: pros } = await db.from("professionals").select("id, email, full_name, pro_portal_enabled").in("id", proIds);
  let sent = 0;
  for (const pro of (pros ?? []).filter((p: any) => p.pro_portal_enabled && p.email)) {
    try {
      const { subject, text } = proCommentEmail(pro.full_name);
      const res = await fetch(`${supabaseUrl}/functions/v1/send-admin-email`, {
        method: "POST",
        headers: { "x-region": "ca-central-1", "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, "x-internal-secret": internalSecret },
        body: JSON.stringify({ to: pro.email, subject, text }),
      });
      if (res.ok) sent++;
      else console.error(`[task-notify] pro email failed ${res.status}`);
    } catch (e) {
      console.error("[task-notify] pro email error", e);
    }
  }
  return sent;
}

const TYPE_LABEL = (t: string) => String(t || "").replace(/_/g, " ").trim();

/** The title of the in-app alert when a professional comments: who they are and what they do, so it cannot be mistaken for a client. */
export function proCommentAlertTitle(pro: { full_name: string; professional_type?: string | null; firm?: string | null }, taskTitle: string): string {
  const role = [TYPE_LABEL(pro.professional_type ?? ""), pro.firm?.trim()].filter(Boolean).join(", ");
  return `${pro.full_name}${role ? ` (${role})` : ""} commented on "${taskTitle}"`.slice(0, 200);
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
