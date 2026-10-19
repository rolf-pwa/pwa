// meeting-record-service.ts: files the standard meeting record (a Google Doc) in the household's Advisor Files > Meeting Notes when a
// meeting follow-up task is completed. Additive: it never deletes or moves anything in Drive. Closing the task again updates the same Doc.

// deno-lint-ignore-file no-explicit-any
import { getServiceGoogleAccessToken } from "./google-token.ts";
import { buildMeetingRecordHtml, recordTitle, pacificYmd, splitRecap, type RecordComment, type RecordEvent, type RecordTask } from "./meeting-record.ts";
import { namedAttendees, pickEvent, type CalEventLite, type Known } from "./meeting-event.ts";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const CAL = "https://www.googleapis.com/calendar/v3";
const STAFF_DOMAIN = "prosperwise.ca";
const ADVISOR_FILES = "Advisor Files";
const MEETING_NOTES = "Meeting Notes";
const DAY = 86_400_000;

const sig = () => AbortSignal.timeout(25_000);

async function driveFindFolder(parentId: string, name: string, token: string): Promise<string | null> {
  const q = `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const res = await fetch(`${DRIVE}/files?${new URLSearchParams({ q, fields: "files(id,name)", supportsAllDrives: "true", includeItemsFromAllDrives: "true" })}`, { headers: { Authorization: `Bearer ${token}` }, signal: sig() });
  if (!res.ok) throw new Error(`Drive search failed [${res.status}]`);
  return ((await res.json()).files ?? [])[0]?.id ?? null;
}

async function driveEnsureFolder(parentId: string, name: string, token: string): Promise<string> {
  const found = await driveFindFolder(parentId, name, token);
  if (found) return found;
  const res = await fetch(`${DRIVE}/files?supportsAllDrives=true&fields=id`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }), signal: sig(),
  });
  if (!res.ok) throw new Error(`Could not create the ${name} folder [${res.status}]`);
  return (await res.json()).id;
}

async function driveCreateDoc(name: string, parentId: string, html: string, token: string): Promise<{ id: string; url: string }> {
  const boundary = `pwrec${crypto.randomUUID().replace(/-/g, "")}`;
  const meta = JSON.stringify({ name, mimeType: "application/vnd.google-apps.document", parents: [parentId] });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${boundary}--`;
  const res = await fetch(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body, signal: sig(),
  });
  if (!res.ok) throw new Error(`Could not create the record [${res.status}] ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return { id: j.id, url: j.webViewLink || `https://docs.google.com/document/d/${j.id}/edit` };
}

async function driveUpdateDoc(id: string, html: string, token: string): Promise<boolean> {
  const res = await fetch(`${UPLOAD}/files/${id}?uploadType=media&supportsAllDrives=true`, {
    method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/html; charset=UTF-8" }, body: html, signal: sig(),
  });
  return res.ok;
}

async function calendarAround(token: string, anchor: string): Promise<CalEventLite[]> {
  const a = Date.parse(anchor);
  const qs = new URLSearchParams({ timeMin: new Date(a - 7 * DAY).toISOString(), timeMax: new Date(a + DAY).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "100", fields: "items(id,summary,start,end,attendees(email,displayName,self))" });
  const res = await fetch(`${CAL}/calendars/primary/events?${qs}`, { headers: { Authorization: `Bearer ${token}` }, signal: sig() });
  if (!res.ok) throw new Error(`Calendar read failed [${res.status}]`);
  return ((await res.json()).items ?? []).map((e: any) => ({
    id: e.id, summary: e.summary ?? "", start: e.start?.dateTime ?? e.start?.date ?? "", end: e.end?.dateTime ?? e.end?.date ?? "", allDay: !e.start?.dateTime,
    attendees: (e.attendees ?? []).filter((x: any) => x.email).map((x: any) => ({ email: x.email, displayName: x.displayName ?? null, self: !!x.self })),
  }));
}

export type RecordResult = { ok: boolean; status: "created" | "updated" | "skipped" | "failed"; reason?: string; url?: string };

async function tell(db: any, title: string, body: string, contactId: string | null) {
  await db.from("staff_notifications").insert({ title: title.slice(0, 200), body: body.slice(0, 200), link: contactId ? `/contacts/${contactId}` : null, contact_id: contactId, source_type: "meeting_record" });
}

/** Files (or refreshes) the meeting record for one completed meeting follow-up task. */
export async function createMeetingRecord(db: any, taskId: string): Promise<RecordResult> {
  const { data: task } = await db.from("pm_tasks").select("id, title, description, status, created_at, completed_at, parent_task_id, meeting_followup, meeting_event, household_id, contact_id").eq("id", taskId).maybeSingle();
  if (!task) return { ok: false, status: "failed", reason: "task_not_found" };
  if (task.parent_task_id || !task.meeting_followup || task.status !== "done") return { ok: true, status: "skipped", reason: "not_a_completed_meeting_followup" };

  const [{ data: household }, { data: contact }] = await Promise.all([
    task.household_id ? db.from("households").select("id, label, vault_folder_id").eq("id", task.household_id).maybeSingle() : Promise.resolve({ data: null }),
    task.contact_id ? db.from("contacts").select("id, full_name").eq("id", task.contact_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const clientName: string = contact?.full_name || household?.label || "Client";
  try {
    if (!household?.vault_folder_id) throw new Error("the household has no Vault folder yet");
    const token = await getServiceGoogleAccessToken(db);

    // The people around the meeting.
    const { data: members } = await db.from("contacts").select("full_name, first_name, last_name, email").eq("household_id", household.id);
    const { data: proRows } = await db.from("pm_task_collaborators").select("professional_id").eq("task_id", task.id).not("professional_id", "is", null);
    const proIds = [...new Set((proRows ?? []).map((r: any) => r.professional_id))];
    const { data: pros } = proIds.length ? await db.from("professionals").select("id, full_name, email, professional_type").in("id", proIds) : { data: [] as any[] };
    const known: Known = {
      staffDomain: STAFF_DOMAIN,
      contacts: (members ?? []).map((m: any) => ({ email: m.email, name: m.full_name })),
      pros: (pros ?? []).map((p: any) => ({ email: p.email, name: p.full_name, type: p.professional_type })),
    };

    // The meeting event: the one the task is linked to, or the best match on the calendar.
    let event: RecordEvent | null = null;
    const linked = task.meeting_event as { title?: string; start?: string; end?: string; attendees?: { email: string; name?: string }[] } | null;
    if (linked?.title) {
      event = { title: linked.title, start: linked.start ?? null, end: linked.end ?? null, attendees: namedAttendees((linked.attendees ?? []).map((a) => ({ email: a.email, displayName: a.name ?? null })), known), source: "linked" };
    } else {
      try {
        const events = await calendarAround(token, task.created_at);
        const clientEmails = new Set<string>((members ?? []).map((m: any) => String(m.email ?? "").toLowerCase()).filter(Boolean));
        const clientNames = (members ?? []).flatMap((m: any) => [m.full_name, m.last_name]).filter(Boolean);
        const hit = pickEvent(events, { clientEmails, clientNames, anchor: task.created_at });
        if (hit) event = { title: hit.summary, start: hit.start, end: hit.end, attendees: namedAttendees(hit.attendees, known), source: "matched" };
      } catch (e) {
        console.error("[meeting-record] calendar lookup failed", e instanceof Error ? e.message : e);
      }
    }

    // Tasks and the thread.
    const { data: subs } = await db.from("pm_tasks").select("title, status, due_date, assignee_id, completed_at").eq("parent_task_id", task.id).order("created_at", { ascending: true });
    const { data: cms } = await db.from("pm_task_comments").select("author_id, author_contact_id, author_professional_id, author_agent_key, body, body_format, created_at").eq("task_id", task.id).order("created_at", { ascending: true });
    const staffIds = [...new Set([...(subs ?? []).map((s: any) => s.assignee_id), ...(cms ?? []).map((c: any) => c.author_id)].filter(Boolean))];
    const contactIds = [...new Set((cms ?? []).map((c: any) => c.author_contact_id).filter(Boolean))];
    const authorProIds = [...new Set((cms ?? []).map((c: any) => c.author_professional_id).filter(Boolean))];
    const [{ data: staff }, { data: cs }, { data: aps }] = await Promise.all([
      staffIds.length ? db.from("profiles").select("user_id, full_name").in("user_id", staffIds) : Promise.resolve({ data: [] as any[] }),
      contactIds.length ? db.from("contacts").select("id, full_name").in("id", contactIds) : Promise.resolve({ data: [] as any[] }),
      authorProIds.length ? db.from("professionals").select("id, full_name, professional_type").in("id", authorProIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const staffName = new Map((staff ?? []).map((s: any) => [s.user_id, s.full_name]));
    const contactName = new Map((cs ?? []).map((c: any) => [c.id, c.full_name]));
    const proInfo = new Map((aps ?? []).map((p: any) => [p.id, p]));

    const tasks: RecordTask[] = (subs ?? []).map((s: any) => ({ title: s.title, owner: s.assignee_id ? staffName.get(s.assignee_id) ?? null : null, due: s.due_date ?? null, status: s.status, completedAt: s.completed_at ?? null }));
    const all: RecordComment[] = (cms ?? []).map((c: any) => {
      const base = { at: c.created_at, body: c.body, format: (c.body_format === "html" ? "html" : "text") as "text" | "html" };
      if (c.author_id) return { ...base, author: staffName.get(c.author_id) || "Advisor", role: "Advisor" };
      if (c.author_contact_id) return { ...base, author: contactName.get(c.author_contact_id) || "Client", role: "Client" };
      if (c.author_professional_id) { const p: any = proInfo.get(c.author_professional_id); return { ...base, author: p?.full_name || "Professional", role: `Professional${p?.professional_type ? `, ${String(p.professional_type).replace(/_/g, " ")}` : ""}` }; }
      if (c.author_agent_key) return { ...base, author: "Georgia", role: "Georgia" };
      return { ...base, author: "Imported comment", role: "Record" };
    });
    const { recap, thread } = splitRecap(all, task.description);

    const html = buildMeetingRecordHtml({
      clientName, taskTitle: task.title, taskCreatedAt: task.created_at, taskCompletedAt: task.completed_at, event, recap, tasks, thread, generatedAt: new Date().toISOString(),
    });
    const name = recordTitle(clientName, event?.title ?? null, pacificYmd(event?.start ?? task.completed_at ?? task.created_at));

    // Advisor Files > Meeting Notes in the household's folder.
    const advisor = await driveFindFolder(household.vault_folder_id, ADVISOR_FILES, token);
    if (!advisor) throw new Error("the household has no Advisor Files folder");
    const notes = await driveEnsureFolder(advisor, MEETING_NOTES, token);

    const { data: existing } = await db.from("meeting_records").select("doc_id, doc_url").eq("task_id", task.id).maybeSingle();
    let docId = existing?.doc_id as string | undefined;
    let url = existing?.doc_url as string | undefined;
    let status: "created" | "updated" = "created";
    if (docId && (await driveUpdateDoc(docId, html, token))) status = "updated";
    else { const made = await driveCreateDoc(name, notes, html, token); docId = made.id; url = made.url; }

    await db.from("meeting_records").upsert({
      task_id: task.id, household_id: household.id, doc_id: docId, doc_url: url, doc_name: name, event_source: event?.source ?? "none",
      filed_for_completion: task.completed_at, updated_at: new Date().toISOString(),
    }, { onConflict: "task_id" });

    await tell(db, `Meeting record ${status === "updated" ? "updated" : "filed"}: ${clientName}`,
      `${event?.title ?? "Meeting event to be confirmed"}${event?.source === "matched" ? " (matched from your calendar, please confirm)" : ""}. In Advisor Files > Meeting Notes.`, task.contact_id ?? null);
    return { ok: true, status, url };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[meeting-record] failed", reason);
    try { await tell(db, `Meeting record not filed: ${clientName}`, `${reason}.`, task.contact_id ?? null); } catch { /* noop */ }
    return { ok: false, status: "failed", reason };
  }
}

/** Called after any task is saved as done, or ticked as a meeting follow-up; does nothing unless it is a completed one. */
export async function maybeCreateMeetingRecord(db: any, taskId: string): Promise<void> {
  try { await createMeetingRecord(db, taskId); } catch (e) { console.error("[meeting-record] unexpected", e); }
}

export interface Candidate { id: string; title: string; client: string | null; completed_at: string | null; subtasks: number; comments: number; meeting_followup: boolean; has_record: boolean; suggested: boolean }

const LOOKS_LIKE_FOLLOWUP = /follow-?up|recap|review|session|meeting|consult|call|clarity|charter|strategy/i;

/** Completed top-level tasks since a date, for choosing which to file records for. */
export async function meetingRecordCandidates(db: any, sinceYmd: string): Promise<Candidate[]> {
  const { data: tasks } = await db.from("pm_tasks").select("id, title, contact_id, completed_at, meeting_followup").is("parent_task_id", null).eq("status", "done").gte("completed_at", `${sinceYmd}T00:00:00Z`).order("completed_at", { ascending: false }).limit(300);
  const ids = (tasks ?? []).map((t: any) => t.id);
  if (!ids.length) return [];
  const [{ data: subs }, { data: cms }, { data: recs }, { data: cts }] = await Promise.all([
    db.from("pm_tasks").select("parent_task_id").in("parent_task_id", ids),
    db.from("pm_task_comments").select("task_id").in("task_id", ids),
    db.from("meeting_records").select("task_id").in("task_id", ids),
    db.from("contacts").select("id, full_name").in("id", [...new Set((tasks ?? []).map((t: any) => t.contact_id).filter(Boolean))]),
  ]);
  const count = (rows: any[] | null, key: string) => { const m = new Map<string, number>(); for (const r of rows ?? []) m.set(r[key], (m.get(r[key]) ?? 0) + 1); return m; };
  const subN = count(subs, "parent_task_id"); const cmN = count(cms, "task_id");
  const hasRec = new Set((recs ?? []).map((r: any) => r.task_id));
  const nameOf = new Map((cts ?? []).map((c: any) => [c.id, c.full_name]));
  return (tasks ?? []).map((t: any) => ({
    id: t.id, title: t.title, client: nameOf.get(t.contact_id) ?? null, completed_at: t.completed_at, subtasks: subN.get(t.id) ?? 0, comments: cmN.get(t.id) ?? 0,
    meeting_followup: !!t.meeting_followup, has_record: hasRec.has(t.id),
    suggested: (subN.get(t.id) ?? 0) > 0 && (cmN.get(t.id) ?? 0) > 0 && LOOKS_LIKE_FOLLOWUP.test(t.title),
  }));
}
