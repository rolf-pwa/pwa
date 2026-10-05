// push-send-drain — pushes recent portal_client_notifications to the
// recipient's subscribed devices. Called every minute by pg_cron with a
// shared secret. Only households with v2_ai_engine_enabled are pushed for.
// Payloads are generic by design (see _shared/push-payload.ts).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPushPayload, MAX_PUSH_FAILURES, PUSH_WINDOW_HOURS } from "../_shared/push-payload.ts";
import { sendWebPush, vapidFromEnv } from "../_shared/web-push.ts";
import { logSystemHealth } from "../_shared/system-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET");
const BATCH = 100;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function run() {
  const vapid = vapidFromEnv();
  if (!vapid) return { skipped: "VAPID keys not configured" };
  const admin: any = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const since = new Date(Date.now() - PUSH_WINDOW_HOURS * 3600_000).toISOString();
  const { data: recent, error } = await admin
    .from("portal_client_notifications").select("id, contact_id, source_type")
    .gte("created_at", since).order("created_at", { ascending: true }).limit(BATCH * 3);
  if (error) throw error;
  if (!recent?.length) return { notifications: 0, sent: 0, failed: 0, removed: 0 };

  const { data: done } = await admin.from("push_deliveries").select("notification_id").in("notification_id", recent.map((n: any) => n.id));
  const doneIds = new Set((done ?? []).map((d: any) => d.notification_id));
  const todo = recent.filter((n: any) => !doneIds.has(n.id)).slice(0, BATCH);
  if (!todo.length) return { notifications: 0, sent: 0, failed: 0, removed: 0 };

  const contactIds = [...new Set(todo.map((n: any) => n.contact_id))];
  const { data: subs } = await admin.from("pwa_push_subscriptions")
    .select("id, endpoint, p256dh, auth, contact_id, household_id, failure_count").in("contact_id", contactIds);
  const hhIds = [...new Set((subs ?? []).map((s: any) => s.household_id).filter(Boolean))];
  const { data: enabledHh } = hhIds.length
    ? await admin.from("households").select("id").in("id", hhIds).eq("v2_ai_engine_enabled", true) : { data: [] };
  const enabled = new Set((enabledHh ?? []).map((h: any) => h.id));

  const tally = { notifications: 0, sent: 0, failed: 0, removed: 0 };
  for (const n of todo) {
    // Claim first: the PK makes a concurrent run's insert fail, so only one run sends this notification.
    const { error: claimErr } = await admin.from("push_deliveries").insert({ notification_id: n.id });
    if (claimErr) continue;
    tally.notifications++;

    const targets = (subs ?? []).filter((s: any) => s.contact_id === n.contact_id && s.household_id && enabled.has(s.household_id));
    const payload = buildPushPayload(n);
    let sent = 0, failed = 0;
    for (const s of targets) {
      const outcome = await sendWebPush(s, payload, vapid);
      if (outcome === "ok") {
        sent++;
        await admin.from("pwa_push_subscriptions").update({ failure_count: 0, last_success_at: new Date().toISOString() }).eq("id", s.id);
      } else if (outcome === "gone") {
        await admin.from("pwa_push_subscriptions").delete().eq("id", s.id);
        tally.removed++;
      } else {
        failed++;
        const failures = (s.failure_count ?? 0) + 1;
        if (failures >= MAX_PUSH_FAILURES) { await admin.from("pwa_push_subscriptions").delete().eq("id", s.id); tally.removed++; }
        else await admin.from("pwa_push_subscriptions").update({ failure_count: failures }).eq("id", s.id);
      }
    }
    await admin.from("push_deliveries").update({ sent_count: sent, failed_count: failed, completed_at: new Date().toISOString() }).eq("notification_id", n.id);
    tally.sent += sent; tally.failed += failed;
  }
  return tally;
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-push-cron-secret") !== CRON_SECRET) return json({ error: "Unauthorized" }, 401);
  try {
    return json(await run());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[push-send-drain] error:", message);
    await logSystemHealth(createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }), {
      function_name: "push-send-drain", severity: "ERROR", error_message: message, stack_trace: e instanceof Error ? e.stack : null,
    });
    return json({ error: "Internal error", details: message }, 500);
  }
});
