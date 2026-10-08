// Vineyard dashboard data: the Review's balance sheet worked out live (same allocation rules as the Sovereignty Review)
// plus each account's start-of-year (BOY) and current value and its withdrawals so far this year. Staff only; reads only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { gatherHouseholdFinancials } from "../_shared/sovereignty-diagnostics.ts";
import { allocateForHousehold, REAL_ESTATE_ASSET_TYPE } from "../_shared/review-allocation.ts";
import { dashRow, dashTotals, latestSnapshots, type DashRow } from "../_shared/dashboard-rows.ts";

const ALLOWED_ORIGINS = ["https://prosperwise-portal.web.app", "https://prosperwise.lovable.app", "https://app.prosperwise.ca", "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app"];
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

async function requireStaff(req: Request): Promise<{ ok: true } | { error: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return { error: "Missing authorization header" };
  const { data, error } = await createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }).auth.getUser();
  if (error || !data?.user) return { error: "Not authenticated" };
  if (!data.user.email?.endsWith("@prosperwise.ca")) return { error: "Not authorized" };
  return { ok: true };
}

// deno-lint-ignore no-explicit-any
async function build(db: any, householdId: string) {
  const year = new Date().getFullYear();
  const fin = await gatherHouseholdFinancials(db, householdId);
  const memberIds = fin.members.map((m) => m.id);
  const nameOf = new Map(fin.members.map((m) => [m.id, [m.first_name, m.last_name].filter(Boolean).join(" ")]));

  const { data: tank } = memberIds.length
    ? await db.from("holding_tank").select("id, contact_id, account_name, account_type, account_number, current_value, withdrawals_ytd, withdrawals_as_of, income_funds_as_of").in("contact_id", memberIds).neq("status", "moved")
    : { data: [] };
  const { data: snaps } = memberIds.length
    ? await db.from("account_harvest_snapshots").select("vineyard_account_id, holding_tank_id, storehouse_id, boy_value, boy_source, snapshot_date").eq("reporting_year", year).in("contact_id", memberIds)
    : { data: [] };
  // deno-lint-ignore no-explicit-any
  // The newest snapshot with a real start-of-year value (zero means the sync had none, not that the account started empty).
  const bySnap = (key: string) => latestSnapshots(((snaps ?? []) as any[]).filter((r) => Number(r.boy_value) > 0), (r) => r[key] ?? null);
  const vSnap = bySnap("vineyard_account_id"), hSnap = bySnap("holding_tank_id"), sSnap = bySnap("storehouse_id");

  const rows: DashRow[] = [
    // deno-lint-ignore no-explicit-any
    ...(tank ?? []).map((a: any) => dashRow({ id: a.id, group: "holding_tank", owner: nameOf.get(a.contact_id) ?? "", name: a.account_name, accountType: a.account_type, accountNumber: a.account_number, boy: hSnap.get(a.id)?.boy_value, boySource: hSnap.get(a.id)?.boy_source, current: a.current_value, withdrawalsYtd: a.withdrawals_ytd, asOf: a.withdrawals_as_of ?? a.income_funds_as_of })),
    // deno-lint-ignore no-explicit-any
    ...fin.vineyardAccounts.map((a: any) => dashRow({ id: a.id, group: "vineyard", owner: nameOf.get(a.contact_id) ?? "", name: a.account_name, accountType: a.account_type, accountNumber: a.account_number, boy: vSnap.get(a.id)?.boy_value, boySource: vSnap.get(a.id)?.boy_source, current: a.current_value, withdrawalsYtd: a.withdrawals_ytd, asOf: a.withdrawals_as_of ?? a.income_funds_as_of })),
    // deno-lint-ignore no-explicit-any
    ...fin.storehouses.filter((s: any) => s.asset_type !== REAL_ESTATE_ASSET_TYPE).map((s: any) => dashRow({ id: s.id, group: "storehouse", owner: nameOf.get(s.contact_id) ?? "", name: s.label || s.asset_type || "Reserve", accountType: s.asset_type, boy: sSnap.get(s.id)?.boy_value, boySource: sSnap.get(s.id)?.boy_source, current: s.current_value })),
  ];

  const { allocation } = await allocateForHousehold(db, fin, {
    aum: fin.totalAum, net_worth: fin.netWorth, holding_tank_total: fin.totalHoldingTank, vineyard_total: fin.totalVineyard, storehouse_reserves: fin.storehouseReserves,
  });
  const liabilities = fin.totalPersonalLiabilities + fin.totalCorpLiabilities;
  const group = (g: DashRow["group"]) => { const r = rows.filter((x) => x.group === g); return { rows: r, totals: dashTotals(r) }; };
  return {
    year,
    asOf: rows.map((r) => r.asOf).filter(Boolean).sort().pop() ?? null,
    balance: {
      holdingTank: allocation.holdingTank, vineyard: allocation.vineyard, liquidity: allocation.reserves.liquidity, strategic: allocation.reserves.strategic,
      philanthropic: allocation.reserves.philanthropic, legacy: allocation.reserves.legacy, totalAssets: allocation.aum, liabilities, netWorth: allocation.netWorth,
      harvest: allocation.harvest, notes: allocation.notes,
    },
    groups: { holding_tank: group("holding_tank"), vineyard: group("vineyard"), storehouse: group("storehouse") },
    all: dashTotals(rows.filter((r) => r.group !== "storehouse")),
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const cors = { "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  const auth = await requireStaff(req);
  if ("error" in auth) return json({ error: auth.error }, 401);
  const body = await req.json().catch(() => ({}));
  const householdId = String(body?.household_id || "");
  if (!householdId) return json({ error: "household_id is required" }, 400);
  try {
    return json(await build(createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }), householdId));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
