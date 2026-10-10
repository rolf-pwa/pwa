// sentinel-sre-agent — V2 SRE agent. Called every 2 minutes by pg_cron (see
// the schedule migration) with a shared secret. Works the ERROR/FATAL rows in
// system_health_logs:
//   - transient failure in a replay-opted-in function  -> replay with
//     exponential backoff, up to max_retries (default 3)
//   - everything else (non-transient, FATAL, not opted in, retries
//     exhausted)                                       -> ESCALATED + one
//     staff_notifications alert (Tier-3)
// Replay is opt-in per function via REPLAYABLE_FUNCTIONS: a function may only
// be listed once it (a) accepts a service-role Bearer call and (b) is
// idempotent for its id-shaped input_payload. No function is opted in yet,
// so today every actionable row is escalated -- visible, never silently
// replayed. Gated by households.v2_ai_engine_enabled: rows tied to a V1
// household are left alone.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decideAction, type HealthLogRow } from "../_shared/system-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("SENTINEL_CRON_SECRET");

const REPLAYABLE_FUNCTIONS = new Set<string>([]);
const BATCH = 50;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function isCronCaller(req: Request): boolean {
  return !!CRON_SECRET && req.headers.get("x-sentinel-cron-secret") === CRON_SECRET;
}

async function run() {
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: rows, error } = await db
    .from("system_health_logs")
    .select("id, created_at, function_name, household_id, severity, error_code, error_message, input_payload, retry_count, max_retries, status")
    .in("status", ["PENDING", "RETRIED"])
    .in("severity", ["ERROR", "FATAL"])
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) throw error;

  // V1 households opt out of every V2 behaviour.
  const hhIds = [...new Set((rows ?? []).map((r: any) => r.household_id).filter(Boolean))];
  const enabled = new Set<string>();
  if (hhIds.length) {
    const { data: hh } = await db.from("households").select("id").in("id", hhIds).eq("v2_ai_engine_enabled", true);
    (hh ?? []).forEach((h: any) => enabled.add(h.id));
  }

  const tally = { ignored: 0, waiting: 0, retried: 0, resolved: 0, escalated: 0 };
  const now = new Date();

  for (const row of (rows ?? []) as HealthLogRow[]) {
    if (row.household_id && !enabled.has(row.household_id)) { tally.ignored++; continue; }
    const action = decideAction(row, now, REPLAYABLE_FUNCTIONS.has(row.function_name));
    if (action === "ignore") { tally.ignored++; continue; }
    if (action === "wait") { tally.waiting++; continue; }
    if (action === "escalate") { await escalate(db, row) && tally.escalated++; continue; }

    // retry: claim this attempt (optimistic lock on retry_count) so
    // overlapping cron runs can't double-replay.
    const attempt = row.retry_count + 1;
    const { data: claimed } = await db
      .from("system_health_logs")
      .update({ retry_count: attempt, status: "RETRIED" })
      .eq("id", row.id).eq("retry_count", row.retry_count).in("status", ["PENDING", "RETRIED"])
      .select("id");
    if (!claimed?.length) continue;
    tally.retried++;

    const ok = await replay(row);
    if (ok) {
      await db.from("system_health_logs").update({ status: "RESOLVED" }).eq("id", row.id);
      tally.resolved++;
    } else if (attempt >= row.max_retries) {
      await escalate(db, { ...row, retry_count: attempt }) && tally.escalated++;
    }
  }
  return { scanned: rows?.length ?? 0, ...tally };
}

async function replay(row: HealthLogRow): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${row.function_name}`, {
      method: "POST",
      headers: { "x-region": "ca-central-1", "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify(row.input_payload ?? {}),
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

// deno-lint-ignore no-explicit-any
async function escalate(db: any, row: HealthLogRow): Promise<boolean> {
  // Claim first; only the run that flips the status raises the alert.
  const { data: claimed } = await db
    .from("system_health_logs")
    .update({ status: "ESCALATED" })
    .eq("id", row.id).in("status", ["PENDING", "RETRIED"])
    .select("id");
  if (!claimed?.length) return false;
  const { error } = await db.from("staff_notifications").insert({
    title: `${row.severity === "FATAL" ? "FATAL" : "Needs attention"}: ${row.function_name} failed`,
    body: `${row.error_code ? `[${row.error_code}] ` : ""}${row.error_message ?? "No message"}${row.retry_count ? ` (after ${row.retry_count} retries)` : ""}`,
    source_type: "system_health",
    link: row.household_id ? `/households/${row.household_id}` : null,
    contact_id: null,
  });
  if (error) console.error("[sentinel-sre-agent] notify failed:", error.message);
  return true;
}

Deno.serve(async (req) => {
  if (!isCronCaller(req)) return json({ error: "Unauthorized" }, 401);
  try {
    return json(await run());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sentinel-sre-agent] error:", msg);
    return json({ error: "Internal error", details: msg }, 500);
  }
});
