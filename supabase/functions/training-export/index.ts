// training-export — staff-triggered export of de-identified alignment pairs.
//   status:       counts, and whether the pipeline is switched on.
//   export:       builds any missing trajectories from action_brain_events
//                 (scrubbed; anything not provably clean is quarantined, not
//                 stored) and returns the not-yet-exported ones as JSONL.
//   markExported: flags the ids the caller has safely received.
//
// KILL SWITCH: export/markExported refuse unless the secret
// AI_TRAINING_EXPORT_ENABLED is exactly "true". It ships OFF. Client-derived
// data must not be used to train or tune a model until the privacy policy
// covers that use; flipping the secret is the deliberate, auditable act.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildTrajectory, toJsonl, type ActionEventRow, type ExportFormat } from "../_shared/trajectory.ts";
import { logSystemHealth } from "../_shared/system-health.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUILD_BATCH = 500;
const EXPORT_LIMIT = 1000;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const cors = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin: any = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const enabled = Deno.env.get("AI_TRAINING_EXPORT_ENABLED") === "true";

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    if (!user.email?.toLowerCase().endsWith("@prosperwise.ca")) return json({ error: "Access denied: unauthorized domain" }, 403);

    const body = await req.json().catch(() => null);
    const action = body?.action;

    if (action === "status") {
      const [{ count: events }, { count: pairs }, { count: pending }] = await Promise.all([
        admin.from("action_brain_events").select("id", { count: "exact", head: true }).not("system_proposed_payload", "is", null),
        admin.from("ai_training_trajectories").select("id", { count: "exact", head: true }),
        admin.from("ai_training_trajectories").select("id", { count: "exact", head: true }).eq("is_exported_for_training", false),
      ]);
      return json({ enabled, events_with_proposals: events ?? 0, trajectories: pairs ?? 0, awaiting_export: pending ?? 0 });
    }

    if (!enabled) return json({ error: "AI training export is switched off (AI_TRAINING_EXPORT_ENABLED)." }, 403);

    if (action === "markExported") {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      if (!ids.length || !ids.every((i: unknown) => typeof i === "string" && UUID.test(i))) return json({ error: "ids must be a non-empty list of uuids" }, 400);
      const { error } = await admin.from("ai_training_trajectories").update({ is_exported_for_training: true }).in("id", ids);
      if (error) throw new Error(error.message);
      return json({ marked: ids.length });
    }

    if (action !== "export") return json({ error: "Unknown action" }, 400);
    const format: ExportFormat = body.format === "dpo" ? "dpo" : "sft";

    // 1. Build trajectories for events that don't have one yet.
    const { data: events } = await admin
      .from("action_brain_events")
      .select("id, household_id, action_type, workflow_module, input_context_snapshot, system_proposed_payload, human_final_payload, delta_score, metadata")
      .not("system_proposed_payload", "is", null).order("created_at", { ascending: true }).limit(BUILD_BATCH * 2);
    const { data: have } = (events?.length
      ? await admin.from("ai_training_trajectories").select("source_event_id").in("source_event_id", events.map((e: any) => e.id))
      : { data: [] });
    const built = new Set((have ?? []).map((h: any) => h.source_event_id));
    const todo = (events ?? []).filter((e: any) => !built.has(e.id)).slice(0, BUILD_BATCH);

    const householdIds = [...new Set(todo.map((e: any) => e.household_id).filter(Boolean))];
    const names = new Map<string, string[]>();
    if (householdIds.length) {
      const [{ data: contacts }, { data: households }] = await Promise.all([
        admin.from("contacts").select("household_id, first_name, last_name").in("household_id", householdIds),
        admin.from("households").select("id, label").in("id", householdIds),
      ]);
      for (const c of contacts ?? []) {
        const list = names.get(c.household_id) ?? [];
        list.push(c.first_name, c.last_name, `${c.first_name} ${c.last_name}`);
        names.set(c.household_id, list);
      }
      for (const h of households ?? []) names.set(h.id, [...(names.get(h.id) ?? []), h.label].filter(Boolean));
    }

    let quarantined = 0;
    const toInsert = [];
    for (const e of todo) {
      const r = buildTrajectory(e as ActionEventRow, { names: names.get(e.household_id) ?? [] });
      if (r.ok) toInsert.push(r.row); else if (r.reason !== "no AI proposal") quarantined++;
    }
    if (toInsert.length) {
      const { error } = await admin.from("ai_training_trajectories").upsert(toInsert, { onConflict: "source_event_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }

    // 2. Hand back the not-yet-exported pairs. The caller confirms receipt with markExported.
    const { data: rows } = await admin
      .from("ai_training_trajectories")
      .select("id, source_event_id, workflow_type, scrubbed_input_prompt, scrubbed_ai_response, scrubbed_human_response, feedback_signal")
      .eq("is_exported_for_training", false).order("created_at", { ascending: true }).limit(EXPORT_LIMIT);
    return json({ format, built: toInsert.length, quarantined, ids: (rows ?? []).map((r: any) => r.id), count: (rows ?? []).length, jsonl: toJsonl(rows ?? [], format) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[training-export] error:", message);
    await logSystemHealth(admin, { function_name: "training-export", severity: "ERROR", error_message: message, stack_trace: e instanceof Error ? e.stack : null });
    return json({ error: "Internal error", details: message }, 500);
  }
});
