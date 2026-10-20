// briefing-refresh.ts: keeps the morning briefing current as the day goes on. Items Rolf has dealt with (a task done or rescheduled, an email
// answered or archived, a request answered, a notification read) come off the priorities and the lists and move to "handled". The briefing
// itself is not rewritten and nothing is invented: items only ever leave it.

// deno-lint-ignore-file no-explicit-any
import { applyOpen, type OpenState } from "./briefing-open.ts";
import { getValidGoogleAccessToken } from "./google-token.ts";

const keysOf = (items: { key?: string }[], prefix: string) => items.map((i) => i.key).filter((k): k is string => !!k && k.startsWith(prefix)).map((k) => k.split(":").slice(-1)[0]);

async function gmailState(db: any, userId: string, ids: string[]): Promise<OpenState["emails"]> {
  if (!ids.length) return new Map();
  try {
    const token = await getValidGoogleAccessToken(db, userId);
    const out = new Map<string, { inInbox: boolean; lastFromMe: boolean }>();
    await Promise.all(ids.slice(0, 40).map(async (id) => {
      const m = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=minimal`, { headers: { Authorization: `Bearer ${token}` } });
      if (m.status === 404) { out.set(id, { inInbox: false, lastFromMe: false }); return; } // deleted
      if (!m.ok) throw new Error(`Gmail ${m.status}`);
      const msg = await m.json();
      const t = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${msg.threadId}?format=minimal`, { headers: { Authorization: `Bearer ${token}` } });
      const thread = t.ok ? await t.json() : null;
      const last = (thread?.messages ?? []).slice(-1)[0];
      out.set(id, { inInbox: (msg.labelIds ?? []).includes("INBOX"), lastFromMe: (last?.labelIds ?? []).includes("SENT") });
    }));
    return out;
  } catch {
    return null; // could not read Gmail: leave the email items where they are
  }
}

/** Sorts still to deal with: not yet rated, or Would archive and rated right but still in the Inbox. Mail from clients is shown, never sorted by hand. */
export function sweepPending(rows: { bucket: string; feedback: string | null; archived_at: string | null }[]): number {
  return rows.filter((r) => r.bucket !== "client" && !r.archived_at && (r.feedback === null || (r.bucket === "archivable" && r.feedback === "right"))).length;
}

export async function refreshBriefing(db: any, userId: string, todayStr: string) {
  const { data: b } = await db.from("daily_briefings").select("priority_items, sections, generation_status").eq("staff_user_id", userId).eq("briefing_date", todayStr).maybeSingle();
  if (!b || b.generation_status !== "complete") return { refreshed: false };
  const priorities: any[] = b.priority_items ?? [];
  const s: any = b.sections ?? {};
  const all = [...priorities, ...(s.replies ?? []), ...(s.ia ?? []), ...(s.texts ?? []), ...(s.firm ?? [])];
  const taskIds = keysOf(all, "task:"), reqIds = keysOf(all, "request:"), emailIds = keysOf(all, "email:");
  const escIds = keysOf(all, "esc:"), importIds = keysOf(all, "import:"), noteIds = keysOf(all, "note:");
  const quoMsg = all.map((i) => i.key).filter((k: string) => k?.startsWith("quo:msg:")).map((k: string) => k.slice(8));
  const quoCall = all.map((i) => i.key).filter((k: string) => k?.startsWith("quo:call:")).map((k: string) => k.slice(9));

  const hasSweep = all.some((i) => i.key === "sweep");
  const [tasks, reqs, escs, imports, notes, msgs, calls, scans, emails, sweepRows] = await Promise.all([
    taskIds.length ? db.from("pm_tasks").select("id, status, due_date").in("id", taskIds) : { data: [] },
    reqIds.length ? db.from("portal_requests").select("id, status, portal_request_messages(sender_type, created_at)").in("id", reqIds) : { data: [] },
    escIds.length ? db.from("review_obligations").select("id, status").in("id", escIds) : { data: [] },
    importIds.length ? db.from("monthly_import_runs").select("id, status").in("id", importIds) : { data: [] },
    noteIds.length ? db.from("staff_notifications").select("id, read").in("id", noteIds) : { data: [] },
    quoMsg.length ? db.from("quo_messages").select("id, read_at").in("id", quoMsg) : { data: [] },
    quoCall.length ? db.from("quo_calls").select("id, read_at").in("id", quoCall) : { data: [] },
    db.from("stage2_verification_audit").select("id", { count: "exact", head: true }).eq("review_status", "pending"),
    gmailState(db, userId, emailIds),
    hasSweep ? db.from("inbox_sweep_items").select("bucket, feedback, archived_at").eq("user_id", userId).gte("swept_at", new Date(Date.now() - 26 * 3_600_000).toISOString()).limit(500) : { data: null },
  ]);

  const state: OpenState = {
    today: todayStr,
    tasks: new Map((tasks.data ?? []).map((t: any) => [t.id, { status: t.status, due: t.due_date }])),
    requests: new Map((reqs.data ?? []).map((r: any) => {
      const last = [...(r.portal_request_messages ?? [])].sort((x: any, y: any) => +new Date(y.created_at) - +new Date(x.created_at))[0];
      return [r.id, { status: r.status, awaitingStaff: !last || last.sender_type === "client" }];
    })),
    emails,
    quo: new Map([...(msgs.data ?? []).map((m: any) => [`msg:${m.id}`, { read: !!m.read_at }]), ...(calls.data ?? []).map((c: any) => [`call:${c.id}`, { read: !!c.read_at }])] as any),
    escalations: new Map((escs.data ?? []).map((e: any) => [e.id, { status: e.status }])),
    imports: new Map((imports.data ?? []).map((i: any) => [i.id, { status: i.status }])),
    pendingScans: scans.count ?? 0,
    sweepPending: sweepRows.data ? sweepPending(sweepRows.data) : undefined,
    notes: new Map((notes.data ?? []).map((n: any) => [n.id, { read: !!n.read }])),
  };

  const handled: { label: string; link: string | null }[] = [...(s.handled ?? [])];
  const split = <T extends { key?: string; link?: string | null }>(items: T[]): T[] => {
    const r = applyOpen(items, state);
    for (const h of r.handled as any[]) {
      const label = h.label ?? h.subject ?? "";
      if (label && !handled.some((x) => x.label === label)) handled.push({ label, link: h.link ?? null });
    }
    return r.open;
  };
  const priorities2 = split(priorities);
  const sections = { ...s, replies: split(s.replies ?? []), ia: split(s.ia ?? []), texts: split(s.texts ?? []), firm: split(s.firm ?? []), handled };
  const changed = priorities2.length !== priorities.length || handled.length !== (s.handled ?? []).length || JSON.stringify(sections.firm) !== JSON.stringify(s.firm ?? []);
  if (changed) await db.from("daily_briefings").update({ priority_items: priorities2, sections }).eq("staff_user_id", userId).eq("briefing_date", todayStr);
  return { refreshed: true, changed, open: priorities2.length, handled: handled.length };
}
