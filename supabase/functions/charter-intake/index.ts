// charter-intake — staff-only CRUD for the v2.0 Sovereignty Charter's
// "Foundational Bedrock" (Family Vision, Core Values, System Grounding
// Principles). Household-scoped, entirely separate from the v1
// contact-scoped sovereignty_charters table, which this function only
// ever reads from (for pre-fill), never writes to.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeStorehouseFundedPct, gatherHouseholdFinancials } from "../_shared/sovereignty-diagnostics.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed =
    ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".lovable.app") || origin.endsWith(".lovableproject.com")
      ? origin
      : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function requireStaff(req: Request): Promise<{ userId: string; error?: undefined } | { error: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return { error: "Missing authorization header" };
  const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await supabaseUser.auth.getUser();
  if (error || !data?.user) return { error: "Not authenticated" };
  if (!data.user.email?.endsWith("@prosperwise.ca")) return { error: "Not authorized" };
  return { userId: data.user.id };
}

interface NamedItem {
  key: string;
  title: string;
  description: string;
}

const CORE_VALUES_DEFAULTS: NamedItem[] = [
  { key: "autonomy_respect", title: "Individual Autonomy and Mutual Respect", description: "" },
  { key: "radical_transparency", title: "Radical Transparency and Honest Communication", description: "" },
  { key: "contribution_before_consumption", title: "Contribution Before Consumption", description: "" },
  { key: "community_stewardship", title: "Community and Enduring Stewardship", description: "" },
];

const GROUNDING_PRINCIPLES_DEFAULTS: NamedItem[] = [
  { key: "separation", title: "Principle of Separation (Assets Serve the Mission)", description: "" },
  { key: "deceleration", title: "Principle of Deceleration (Equilibrium Over Impulse)", description: "" },
  { key: "fiduciary_alignment", title: "Principle of Fiduciary Alignment", description: "" },
  { key: "preparedness", title: "Principle of Preparedness", description: "" },
];

const CHARTER_FIELDS =
  "id, household_id, status, step, vision_text, core_values, grounding_principles, " +
  "treasury_snapshot, treasury_snapshot_computed_at, vineyard_replenishment_policy, river_boundary_note, " +
  "completed_at, completed_by, created_by, created_at, updated_at";

function isNamedItemArray(value: unknown): value is NamedItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        v && typeof v === "object" && typeof (v as Record<string, unknown>).title === "string" && typeof (v as Record<string, unknown>).description === "string",
    )
  );
}

// deno-lint-ignore no-explicit-any
async function loadV1Prefill(db: any, householdId: string): Promise<{ available: boolean; suggestedVisionText: string }> {
  const { data: contacts } = await db.from("contacts").select("id").eq("household_id", householdId);
  const contactIds = (contacts || []).map((c: { id: string }) => c.id);
  if (contactIds.length === 0) return { available: false, suggestedVisionText: "" };

  const { data: charters } = await db
    .from("sovereignty_charters")
    .select("contact_id, mission_of_capital, vision_20_year, draft_status, esign_status, ratified_at")
    .in("contact_id", contactIds);

  const qualifying = (charters || []).filter(
    (c: { draft_status: string | null; esign_status: string | null }) =>
      c.draft_status === "ratified" || c.draft_status === "generated" || c.esign_status === "ratified",
  );
  if (qualifying.length === 0) return { available: false, suggestedVisionText: "" };

  // Prefer a ratified charter over a merely-generated one; among ties, the
  // most recently ratified. Neither field is required to be non-null.
  qualifying.sort((a: { draft_status: string | null; esign_status: string | null; ratified_at: string | null }, b: typeof a) => {
    const aRatified = a.draft_status === "ratified" || a.esign_status === "ratified" ? 1 : 0;
    const bRatified = b.draft_status === "ratified" || b.esign_status === "ratified" ? 1 : 0;
    if (aRatified !== bRatified) return bRatified - aRatified;
    return (b.ratified_at || "").localeCompare(a.ratified_at || "");
  });
  const chosen = qualifying[0] as { mission_of_capital: string | null; vision_20_year: string | null };
  const parts = [chosen.mission_of_capital, chosen.vision_20_year].filter((t) => t && t.trim());
  if (parts.length === 0) return { available: false, suggestedVisionText: "" };
  return { available: true, suggestedVisionText: parts.join("\n\n") };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const auth = await requireStaff(req);
    if (auth.error) return json({ ok: false, error: auth.error }, 401);
    const userId = auth.userId;

    const db = admin();
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const householdId = String(body?.household_id || "");
    if (!householdId) return json({ ok: false, error: "household_id is required" }, 400);

    if (action === "load") {
      let { data: charter, error } = await db
        .from("household_charters")
        .select(CHARTER_FIELDS)
        .eq("household_id", householdId)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);

      if (!charter) {
        const { data: created, error: insertErr } = await db
          .from("household_charters")
          .insert({
            household_id: householdId,
            core_values: CORE_VALUES_DEFAULTS,
            grounding_principles: GROUNDING_PRINCIPLES_DEFAULTS,
            created_by: userId,
          })
          .select(CHARTER_FIELDS)
          .maybeSingle();
        if (insertErr) return json({ ok: false, error: insertErr.message }, 500);
        charter = created;
      }

      const prefill = await loadV1Prefill(db, householdId);
      return json({ ok: true, charter, prefill });
    }

    if (action === "save") {
      const { field, value, advance_to } = body;
      const columnByField: Record<string, string> = {
        vision: "vision_text",
        core_values: "core_values",
        grounding_principles: "grounding_principles",
        vineyard_replenishment: "vineyard_replenishment_policy",
        river_boundary: "river_boundary_note",
      };
      const column = columnByField[String(field || "")];
      if (!column) return json({ ok: false, error: "Unknown field" }, 400);

      const TEXT_COLUMNS = new Set(["vision_text", "vineyard_replenishment_policy", "river_boundary_note"]);
      if (TEXT_COLUMNS.has(column)) {
        if (typeof value !== "string") return json({ ok: false, error: "Expected a text value" }, 400);
      } else if (!isNamedItemArray(value)) {
        return json({ ok: false, error: "Expected an array of {key, title, description}" }, 400);
      }

      const { data: current, error: currentErr } = await db
        .from("household_charters")
        .select("step")
        .eq("household_id", householdId)
        .maybeSingle();
      if (currentErr) return json({ ok: false, error: currentErr.message }, 500);
      if (!current) return json({ ok: false, error: "No charter record for this household — call load first" }, 404);

      const nextStep = Math.max(current.step, Number(advance_to) || current.step);
      const { data, error } = await db
        .from("household_charters")
        .update({ [column]: value, step: nextStep })
        .eq("household_id", householdId)
        .select(CHARTER_FIELDS)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, charter: data });
    }

    if (action === "recompute_treasury") {
      const financials = await gatherHouseholdFinancials(db, householdId);
      const { targets, fundedPct } = computeStorehouseFundedPct(financials.storehouses, financials.storehouseReserves);

      const snapshot = {
        aum: financials.totalAum,
        net_worth: financials.netWorth,
        vineyard_total: financials.totalVineyard,
        holding_tank_total: financials.totalHoldingTank,
        personal_liabilities_total: financials.totalPersonalLiabilities,
        corp_liabilities_total: financials.totalCorpLiabilities,
        storehouse_reserves: financials.storehouseReserves,
        storehouse_targets: targets,
        storehouse_funded_pct: fundedPct,
        // deno-lint-ignore no-explicit-any
        holding_tank_rows: financials.holdingTank.map((h: any) => ({
          id: h.id,
          account_name: h.account_name,
          current_value: Number(h.current_value) || 0,
          days_since_added: Math.floor((Date.now() - new Date(h.created_at).getTime()) / 86_400_000),
        })),
      };

      const { data, error } = await db
        .from("household_charters")
        .update({ treasury_snapshot: snapshot, treasury_snapshot_computed_at: new Date().toISOString() })
        .eq("household_id", householdId)
        .select(CHARTER_FIELDS)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      if (!data) return json({ ok: false, error: "No charter record for this household — call load first" }, 404);
      return json({ ok: true, charter: data });
    }

    if (action === "complete") {
      const { data, error } = await db
        .from("household_charters")
        .update({ status: "complete", completed_at: new Date().toISOString(), completed_by: userId })
        .eq("household_id", householdId)
        .select(CHARTER_FIELDS)
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      if (!data) return json({ ok: false, error: "No charter record for this household — call load first" }, 404);
      return json({ ok: true, charter: data });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("charter-intake error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
