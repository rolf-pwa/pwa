// job-health.ts: is each scheduled job running? Every job records a heartbeat when it finishes; a watchdog compares them with how often each should run
// and tells Rolf in the app when one is late or failing. Pure rules first, then the small amount of database work.

// deno-lint-ignore-file no-explicit-any
export interface JobDef { key: string; label: string; everyMinutes: number; graceMinutes: number }

/** The jobs worth watching, how often each should finish, and how late is too late. */
export const JOBS: JobDef[] = [
  { key: "notice_processor", label: "iA and Adobe Sign notices", everyMinutes: 30, graceMinutes: 45 },
  { key: "calendar_invites", label: "Calendar invitations", everyMinutes: 30, graceMinutes: 45 },
  { key: "georgia_tasks", label: "Tasks assigned to Georgia", everyMinutes: 15, graceMinutes: 30 },
  { key: "meeting_notes_scan", label: "Meeting notes drafting", everyMinutes: 15, graceMinutes: 30 },
  { key: "review_agent_tick", label: "Review and rebalancing reminders", everyMinutes: 30, graceMinutes: 45 },
  { key: "inbox_sweep_morning", label: "Morning inbox sweep", everyMinutes: 24 * 60, graceMinutes: 180 },
  { key: "briefing", label: "Morning briefing", everyMinutes: 24 * 60, graceMinutes: 180 },
  { key: "call_archive", label: "Call recordings copied to Drive and transcribed", everyMinutes: 24 * 60, graceMinutes: 240 },
  { key: "insurance_file_check", label: "Insurance file checks", everyMinutes: 24 * 60, graceMinutes: 180 },
  { key: "book_of_business", label: "Weekly book-of-business diagnostic", everyMinutes: 7 * 24 * 60, graceMinutes: 24 * 60 },
  { key: "rule_suggestions", label: "Weekly rule suggestions", everyMinutes: 7 * 24 * 60, graceMinutes: 24 * 60 },
];

export interface Heartbeat { job: string; last_finished: string | null; last_ok: boolean | null; last_error: string | null; last_summary: string | null; created_at: string; alerted_at: string | null }
export type JobStatus = "ok" | "late" | "failing" | "waiting";
export interface JobState { key: string; label: string; status: JobStatus; lastFinished: string | null; minutesAgo: number | null; detail: string | null }

/** ok; failing (the last run raised an error); late (nothing finished within its schedule plus grace); waiting (never run yet, still inside its first window). */
export function evaluateJob(def: JobDef, hb: Heartbeat | null | undefined, nowMs: number): JobState {
  const limit = (def.everyMinutes + def.graceMinutes) * 60_000;
  const finished = hb?.last_finished ? Date.parse(hb.last_finished) : null;
  const base = { key: def.key, label: def.label, lastFinished: hb?.last_finished ?? null, minutesAgo: finished ? Math.round((nowMs - finished) / 60_000) : null };
  if (hb && hb.last_ok === false) return { ...base, status: "failing", detail: hb.last_error ?? "The last run failed." };
  if (finished === null) {
    const born = hb ? Date.parse(hb.created_at) : nowMs;
    return nowMs - born > limit ? { ...base, status: "late", detail: "It has never finished a run." } : { ...base, status: "waiting", detail: null };
  }
  if (nowMs - finished > limit) return { ...base, status: "late", detail: `Nothing has finished for ${Math.round((nowMs - finished) / 3_600_000 * 10) / 10} hours.` };
  return { ...base, status: "ok", detail: hb?.last_summary ?? null };
}

const REALERT_MS = 24 * 3_600_000;
/** Which problems should raise an alert now: bad jobs not alerted in the last day. Recovered jobs are listed so their alert flag can be cleared. */
export function alertPlan(states: JobState[], heartbeats: Map<string, Heartbeat>, nowMs: number): { alert: JobState[]; clear: string[] } {
  const alert: JobState[] = [], clear: string[] = [];
  for (const s of states) {
    const hb = heartbeats.get(s.key);
    if (s.status === "late" || s.status === "failing") {
      if (!hb?.alerted_at || nowMs - Date.parse(hb.alerted_at) > REALERT_MS) alert.push(s);
    } else if (hb?.alerted_at) clear.push(s.key);
  }
  return { alert, clear };
}

/** Records that a job finished, ok or not. Never throws: a failure to record must not break the job. */
export async function recordHeartbeat(db: any, job: string, ok: boolean, summary?: string | null, error?: string | null): Promise<void> {
  try {
    const now = new Date().toISOString();
    await db.from("job_heartbeats").upsert({ job, last_finished: now, last_ok: ok, last_error: ok ? null : String(error ?? "").slice(0, 300), last_summary: summary ? String(summary).slice(0, 300) : null }, { onConflict: "job" });
  } catch (e) { console.error("[job-health] could not record", job, e); }
}

/** Runs a job and records how it went. A thrown error is recorded and logged, not rethrown (the jobs run in the background). */
export async function trackJob(db: any, job: string, fn: () => Promise<string | string[] | void>): Promise<void> {
  try {
    const r = await fn();
    await recordHeartbeat(db, job, true, Array.isArray(r) ? r.join("; ") : typeof r === "string" ? r : null);
  } catch (e) {
    console.error(`[${job}]`, e);
    await recordHeartbeat(db, job, false, null, e instanceof Error ? e.message : String(e));
  }
}

/** Makes sure every watched job has a row (so "never ran" can be noticed), reads them, and alerts Rolf in the app about any that are late or failing. */
export async function runWatchdog(db: any, now = Date.now()): Promise<string[]> {
  await db.from("job_heartbeats").upsert(JOBS.map((j) => ({ job: j.key })), { onConflict: "job", ignoreDuplicates: true });
  const { data } = await db.from("job_heartbeats").select("job, last_finished, last_ok, last_error, last_summary, created_at, alerted_at");
  const map = new Map<string, Heartbeat>(((data ?? []) as Heartbeat[]).map((h) => [h.job, h]));
  const states = JOBS.map((j) => evaluateJob(j, map.get(j.key), now));
  const { alert, clear } = alertPlan(states, map, now);
  for (const s of alert) {
    await db.from("staff_notifications").insert({ title: s.status === "failing" ? `Georgia's "${s.label}" job is failing` : `Georgia's "${s.label}" job has stopped running`, body: (s.detail ?? "").slice(0, 240), link: "/ask-georgia", source_type: "system_health" });
    await db.from("job_heartbeats").update({ alerted_at: new Date(now).toISOString() }).eq("job", s.key);
  }
  if (clear.length) await db.from("job_heartbeats").update({ alerted_at: null }).in("job", clear);
  return alert.map((s) => `${s.key}: ${s.status}`);
}
