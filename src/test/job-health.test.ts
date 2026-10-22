import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { JOBS, alertPlan, evaluateJob, type Heartbeat } from "../../supabase/functions/_shared/job-health";

const NOW = Date.parse("2026-10-22T20:00:00Z");
const min = (m: number) => new Date(NOW - m * 60_000).toISOString();
const job = JOBS.find((j) => j.key === "notice_processor")!; // every 30 min, grace 45
const hb = (over: Partial<Heartbeat> = {}): Heartbeat => ({ job: job.key, last_finished: min(10), last_ok: true, last_error: null, last_summary: null, created_at: min(1000), alerted_at: null, ...over });

describe("is a job running?", () => {
  it("is ok when it finished within its schedule", () => expect(evaluateJob(job, hb(), NOW).status).toBe("ok"));
  it("is late once nothing has finished for its schedule plus the grace", () => {
    expect(evaluateJob(job, hb({ last_finished: min(70) }), NOW).status).toBe("ok");
    expect(evaluateJob(job, hb({ last_finished: min(80) }), NOW).status).toBe("late");
  });
  it("is failing when the last run raised an error, whatever the time", () => {
    const s = evaluateJob(job, hb({ last_ok: false, last_error: "Gmail 401" }), NOW);
    expect(s.status).toBe("failing");
    expect(s.detail).toBe("Gmail 401");
  });
  it("waits for a job that has never run until its first window has passed", () => {
    expect(evaluateJob(job, hb({ last_finished: null, created_at: min(20) }), NOW).status).toBe("waiting");
    expect(evaluateJob(job, hb({ last_finished: null, created_at: min(200) }), NOW).status).toBe("late");
    expect(evaluateJob(job, null, NOW).status).toBe("waiting");
  });
  it("gives a daily job a day plus its grace", () => {
    const daily = JOBS.find((j) => j.key === "briefing")!;
    expect(evaluateJob(daily, hb({ job: "briefing", last_finished: min(25 * 60) }), NOW).status).toBe("ok");
    expect(evaluateJob(daily, hb({ job: "briefing", last_finished: min(28 * 60) }), NOW).status).toBe("late");
  });
});

describe("when to alert", () => {
  const state = (hbx: Heartbeat) => evaluateJob(job, hbx, NOW);
  it("alerts once a day for a bad job, and not for a good one", () => {
    const bad = hb({ last_finished: min(200) });
    expect(alertPlan([state(bad)], new Map([[job.key, bad]]), NOW).alert).toHaveLength(1);
    const already = hb({ last_finished: min(200), alerted_at: min(60) });
    expect(alertPlan([state(already)], new Map([[job.key, already]]), NOW).alert).toHaveLength(0);
    const old = hb({ last_finished: min(200), alerted_at: min(25 * 60) });
    expect(alertPlan([state(old)], new Map([[job.key, old]]), NOW).alert).toHaveLength(1);
    expect(alertPlan([state(hb())], new Map([[job.key, hb()]]), NOW).alert).toHaveLength(0);
  });
  it("clears the alert flag when a job recovers", () => {
    const recovered = hb({ alerted_at: min(120) });
    expect(alertPlan([state(recovered)], new Map([[job.key, recovered]]), NOW).clear).toEqual([job.key]);
  });
});

describe("the plumbing", () => {
  const idx = readFileSync("supabase/functions/daily-briefing-generate/index.ts", "utf8");
  it("tracks every background job and runs the watchdog", () => {
    for (const k of ["meeting_notes_scan", "inbox_sweep_morning", "notice_processor", "calendar_invites", "georgia_tasks", "rule_suggestions"]) expect(idx).toContain(`trackJob(db, "${k}"`);
    expect(idx).toContain('cronBody.job === "health_watchdog"');
    expect(idx).toContain('recordHeartbeat(db, "briefing"');
    expect(readFileSync("supabase/functions/review-agent-tick/index.ts", "utf8")).toContain('recordHeartbeat(db as any, "review_agent_tick"');
  });
  it("watches every job it tracks", () => {
    for (const k of ["meeting_notes_scan", "inbox_sweep_morning", "notice_processor", "calendar_invites", "georgia_tasks", "rule_suggestions", "briefing", "review_agent_tick"]) expect(JOBS.map((j) => j.key)).toContain(k);
  });
});
