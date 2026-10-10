// retention-review — flags households past the 7-year post-relationship
// data retention floor for staff review. Never deletes anything. Called
// daily by the retention-review cron job (see the migration scheduling
// it) with a shared secret; no interactive/staff-auth'd path is needed
// since this has no useful browser-facing action.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-retention-cron-secret, x-region",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("RETENTION_CRON_SECRET");
const RETENTION_YEARS = 7;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

function isCronCaller(req: Request): boolean {
  if (!CRON_SECRET) return false;
  return req.headers.get("x-retention-cron-secret") === CRON_SECRET;
}

async function scan(): Promise<{ flagged: number; householdIds: string[] }> {
  const db = admin();
  const floor = new Date();
  floor.setFullYear(floor.getFullYear() - RETENTION_YEARS);

  const { data: households, error } = await db
    .from("households")
    .select("id, label, family:families(name)")
    .not("relationship_ended_at", "is", null)
    .lte("relationship_ended_at", floor.toISOString())
    .is("retention_flagged_at", null);

  if (error) throw error;
  if (!households || households.length === 0) return { flagged: 0, householdIds: [] };

  const now = new Date().toISOString();
  const notifications = households.map((h: any) => ({
    title: `${h.family?.name ?? "Household"} (${h.label}) crossed the 7-year retention floor`,
    body: "This household's advisory relationship ended 7+ years ago. Review for retention/deletion per policy.",
    source_type: "retention_review",
    link: `/households/${h.id}`,
    contact_id: null,
  }));

  const { error: notifyError } = await db.from("staff_notifications").insert(notifications);
  if (notifyError) throw notifyError;

  const householdIds = households.map((h: any) => h.id);
  const { error: flagError } = await db
    .from("households")
    .update({ retention_flagged_at: now })
    .in("id", householdIds);
  if (flagError) throw flagError;

  return { flagged: householdIds.length, householdIds };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!isCronCaller(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const result = await scan();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[retention-review] error:", msg);
    return new Response(JSON.stringify({ error: "Internal error", details: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
