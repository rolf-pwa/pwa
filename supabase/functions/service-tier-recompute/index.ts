// Client Service Tiering engine (Phase A, staff-only): recomputes every
// family's tier from grouped AUM + Charter status, nightly via cron or
// on-demand via the CRM's "Recompute Now" button. Dual-mode, mirroring
// quarterly-vfo-audit-generate/index.ts's exact isCronCaller/staff-JWT
// structure.
//
// A family with service_tier_source = 'manual_override' still gets its
// grouped_aum_cad/has_ratified_charter figures refreshed (so the displayed
// numbers never go stale) but its service_tier itself is left untouched --
// staff explicitly pinned it, and this recompute isn't authoritative there.
// No client-facing email or Portal-visible change of any kind -- Phase A is
// staff-only by design (client rollout targeted January 2027).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyTier, computeGroupedAum, hasFamilyRatifiedCharter, hasFamilyInsurancePolicy, type ServiceTier } from "../_shared/service-tiering.ts";

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
      "authorization, x-client-info, apikey, content-type, x-service-tier-cron-secret",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("SERVICE_TIER_CRON_SECRET");

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

function isCronCaller(req: Request): boolean {
  if (!CRON_SECRET) return false;
  return req.headers.get("x-service-tier-cron-secret") === CRON_SECRET;
}

async function requireStaffUser(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data } = await supabaseUser.auth.getUser();
  return data?.user?.id ?? null;
}

// deno-lint-ignore no-explicit-any
type Db = ReturnType<typeof createClient<any>>;

interface FamilyRow {
  id: string;
  name: string;
  service_tier: ServiceTier | null;
  service_tier_source: string;
}

interface Transition {
  familyId: string;
  familyName: string;
  oldTier: ServiceTier | null;
  newTier: ServiceTier;
}

async function recomputeOne(db: Db, family: FamilyRow): Promise<Transition | null> {
  const [groupedAum, hasCharter, hasInsurance] = await Promise.all([
    computeGroupedAum(db, family.id),
    hasFamilyRatifiedCharter(db, family.id),
    hasFamilyInsurancePolicy(db, family.id),
  ]);
  const newTier = classifyTier({ groupedAum, hasRatifiedCharter: hasCharter, hasInsurancePolicy: hasInsurance });
  const isOverridden = family.service_tier_source === "manual_override";

  const patch: Record<string, unknown> = {
    grouped_aum_cad: groupedAum,
    has_ratified_charter: hasCharter,
    service_tier_computed_at: new Date().toISOString(),
  };
  if (!isOverridden) patch.service_tier = newTier;

  const { error } = await db.from("families").update(patch).eq("id", family.id);
  if (error) throw new Error(`Failed to update family ${family.id}: ${error.message}`);

  if (isOverridden || family.service_tier === newTier) return null;

  // No staff notification on the very first-ever classification (oldTier
  // null) -- that's initial backfill, not a change staff need to react to.
  // Still return the transition itself so the manual "Recompute Now"
  // button's toast can show the freshly-computed tier for a never-before-
  // classified family, rather than a misleading "no change" message.
  const isFirstClassification = family.service_tier === null;
  if (!isFirstClassification) {
    await db.from("staff_notifications").insert({
      source_type: "service_tier_change",
      title: `${family.name}'s service tier changed`,
      body: `${TIER_LABEL[family.service_tier as ServiceTier]} -> ${TIER_LABEL[newTier]} (grouped AUM ${groupedAum.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 })}${hasCharter ? ", ratified Charter on file" : ""}).`,
      link: `/families/${family.id}`,
    });
  }

  return { familyId: family.id, familyName: family.name, oldTier: family.service_tier, newTier };
}

const TIER_LABEL: Record<ServiceTier, string> = {
  tier_0: "Tier 0 (Insurance Only)",
  tier_1: "Tier 1 (Foundational)",
  tier_2a: "Tier 2A (Chartered Legacy)",
  tier_2b: "Tier 2B (Traditional Legacy)",
  tier_3: "Tier 3 (Virtual Family Office)",
  tier_4: "Tier 4 (Sovereign Enterprise)",
};

async function runRecompute(db: Db, familyId?: string): Promise<{ familiesProcessed: number; transitions: Transition[] }> {
  let query = db.from("families").select("id, name, service_tier, service_tier_source");
  if (familyId) query = query.eq("id", familyId);
  const { data: families, error } = await query;
  if (error) throw new Error(`Failed to load families: ${error.message}`);

  const transitions: Transition[] = [];
  for (const family of (families || []) as FamilyRow[]) {
    try {
      const t = await recomputeOne(db, family);
      if (t) transitions.push(t);
    } catch (e) {
      // One bad family must never abort the rest of a firm-wide sweep.
      console.error(`service-tier-recompute failed for family ${family.id}`, e);
    }
  }

  return { familiesProcessed: (families || []).length, transitions };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const db = admin();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let familyId: string | undefined;
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    familyId = body?.familyId;
  } catch {
    // no body -- full sweep
  }

  if (isCronCaller(req)) {
    try {
      const result = await runRecompute(db);
      return json(result);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  const userId = await requireStaffUser(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  try {
    const result = await runRecompute(db, familyId);
    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
