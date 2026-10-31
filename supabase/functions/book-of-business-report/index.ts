// Book-of-business diagnostic, stage 1: runs the opportunity rulebook over every household and returns the findings,
// the data gaps that block rules, and a completeness score per household. Staff only; reads only; stores nothing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildSnapshot } from "../_shared/opportunity-snapshot.ts";
import { evaluateHousehold, summarizeBook } from "../_shared/opportunity-rules.ts";

const ALLOWED_ORIGINS = ["https://prosperwise-portal.web.app", "https://prosperwise.lovable.app", "https://app.prosperwise.ca", "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app"];
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CONCURRENCY = 4;

async function requireStaff(req: Request): Promise<{ ok: true } | { error: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return { error: "Missing authorization header" };
  const { data, error } = await createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }).auth.getUser();
  if (error || !data?.user) return { error: "Not authenticated" };
  if (!data.user.email?.endsWith("@prosperwise.ca")) return { error: "Not authorized" };
  return { ok: true };
}

// deno-lint-ignore no-explicit-any
async function run(db: any, onlyHouseholdId: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: households, error } = await (onlyHouseholdId
    ? db.from("households").select("id, label").eq("id", onlyHouseholdId)
    : db.from("households").select("id, label").order("label"));
  if (error) throw new Error(error.message);
  const rows = (households ?? []) as { id: string; label: string }[];

  const results: { householdId: string; label: string; tier: string | null; groupedAum: number; evaluation: ReturnType<typeof evaluateHousehold>; error?: string }[] = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = await Promise.all(rows.slice(i, i + CONCURRENCY).map(async (h) => {
      try {
        const snap = await buildSnapshot(db, h.id);
        return { householdId: h.id, label: h.label, tier: snap.tier, groupedAum: snap.groupedAum, evaluation: evaluateHousehold(snap, today) };
      } catch (e) {
        // One household's bad data must not sink the report.
        return { householdId: h.id, label: h.label, tier: null, groupedAum: 0, evaluation: evaluateHousehold({ householdId: h.id, label: h.label, members: [], groupedAum: 0, totalAum: 0, tier: null, hasRatifiedCharter: false, accounts: [], policies: [], lifeCoverage: 0, needs: [], debts: [], corporations: [], corporatePassiveIncome: null, sbdClawback: null, holdingTank: 0, liquidityReserve: 0, liquidityTarget: 0, professionals: { lawyer: false, executor: false, poa: false } }, today), error: e instanceof Error ? e.message : String(e) };
      }
    }));
    results.push(...batch);
  }
  return { generatedAt: new Date().toISOString(), summary: summarizeBook(results), households: results };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const cors = { "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region" };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  const auth = await requireStaff(req);
  if ("error" in auth) return json({ error: auth.error }, 401);
  const body = await req.json().catch(() => ({}));
  try {
    return json(await run(createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }), body?.household_id ? String(body.household_id) : null));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
