// Verification Layer for Monthly Governance Reviews.
// Deterministic post-commit checks on account_harvest_snapshots + live balances.
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STALE_DAYS = 35;
const VARIANCE_THRESHOLD = 0.10; // ±10% MoM

const BodySchema = z.object({
  scope_type: z.enum(["household", "contact"]),
  scope_id: z.string().uuid(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

type AccountRef = {
  table: "vineyard_accounts" | "holding_tank" | "storehouses";
  id: string;
  contact_id: string;
  label: string;
  current_value: number | null;
  account_number?: string | null;
};

type Finding = {
  severity: "info" | "warn" | "critical";
  code: string;
  message: string;
  account_ref: Record<string, unknown>;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { scope_type, scope_id, period_end } = parsed.data;

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: au } = await authClient.auth.getUser();
    if (!au?.user) return json({ error: "Unauthorized" }, 401);
    const userId = au.user.id;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Resolve contact ids in scope
    let contactIds: string[] = [];
    if (scope_type === "contact") {
      contactIds = [scope_id];
    } else {
      const { data: members } = await supabase
        .from("contacts").select("id").eq("household_id", scope_id);
      contactIds = (members ?? []).map((m) => m.id);
    }
    if (contactIds.length === 0) return json({ error: "No contacts in scope" }, 404);

    // 2. Pull accounts across all 3 tables
    const [{ data: vy }, { data: ht }, { data: sh }] = await Promise.all([
      supabase.from("vineyard_accounts")
        .select("id, contact_id, label, account_number, current_value")
        .in("contact_id", contactIds),
      supabase.from("holding_tank")
        .select("id, contact_id, label, account_number, current_value")
        .in("contact_id", contactIds),
      supabase.from("storehouses")
        .select("id, contact_id, label, current_value")
        .in("contact_id", contactIds),
    ]);

    const accounts: AccountRef[] = [
      ...(vy ?? []).map((r) => ({ table: "vineyard_accounts" as const, ...r })),
      ...(ht ?? []).map((r) => ({ table: "holding_tank" as const, ...r })),
      ...(sh ?? []).map((r) => ({ table: "storehouses" as const, ...r, account_number: null })),
    ];

    // 3. Pull snapshots for this period and the previous period
    const periodDate = new Date(period_end + "T00:00:00Z");
    const prevDate = new Date(periodDate);
    prevDate.setUTCMonth(prevDate.getUTCMonth() - 1);
    const prevEnd = prevDate.toISOString().slice(0, 10);
    const windowStart = new Date(periodDate);
    windowStart.setUTCDate(windowStart.getUTCDate() - STALE_DAYS);

    const { data: snaps } = await supabase
      .from("account_harvest_snapshots")
      .select("id, snapshot_date, vineyard_account_id, holding_tank_id, storehouse_id, contact_id, current_value")
      .in("contact_id", contactIds)
      .gte("snapshot_date", new Date(prevDate.getFullYear() - 1, 0, 1).toISOString().slice(0, 10))
      .lte("snapshot_date", period_end);

    const latestFor = (ref: AccountRef) => {
      const key = ref.table === "vineyard_accounts"
        ? "vineyard_account_id"
        : ref.table === "holding_tank"
        ? "holding_tank_id"
        : "storehouse_id";
      return (snaps ?? [])
        .filter((s) => (s as any)[key] === ref.id && s.snapshot_date <= period_end)
        .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0];
    };
    const priorFor = (ref: AccountRef) => {
      const key = ref.table === "vineyard_accounts"
        ? "vineyard_account_id"
        : ref.table === "holding_tank"
        ? "holding_tank_id"
        : "storehouse_id";
      return (snaps ?? [])
        .filter((s) => (s as any)[key] === ref.id && s.snapshot_date < period_end && s.snapshot_date >= prevEnd.slice(0, 7) + "-01")
        .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0];
    };

    const findings: Finding[] = [];

    for (const ref of accounts) {
      const latest = latestFor(ref);
      const baseRef = {
        table: ref.table, id: ref.id, contact_id: ref.contact_id,
        label: ref.label, account_number: ref.account_number ?? null,
      };
      if (!latest) {
        findings.push({
          severity: "warn",
          code: "missing_snapshot",
          message: `No snapshot on or before ${period_end} for ${ref.label}.`,
          account_ref: baseRef,
        });
        continue;
      }
      const ageDays = Math.floor(
        (periodDate.getTime() - new Date(latest.snapshot_date + "T00:00:00Z").getTime()) / 86400000,
      );
      if (ageDays > STALE_DAYS) {
        findings.push({
          severity: "warn",
          code: "stale_snapshot",
          message: `Latest snapshot is ${ageDays} days old (${latest.snapshot_date}) for ${ref.label}.`,
          account_ref: { ...baseRef, latest_date: latest.snapshot_date, age_days: ageDays },
        });
      }
      if (latest.current_value == null) {
        findings.push({
          severity: "critical",
          code: "null_value",
          message: `Snapshot value missing for ${ref.label}.`,
          account_ref: baseRef,
        });
      }

      const prior = priorFor(ref);
      if (prior && prior.current_value && latest.current_value != null) {
        const delta = (Number(latest.current_value) - Number(prior.current_value)) / Number(prior.current_value);
        if (Math.abs(delta) >= VARIANCE_THRESHOLD) {
          findings.push({
            severity: Math.abs(delta) >= 0.25 ? "critical" : "warn",
            code: "material_variance",
            message: `${ref.label} moved ${(delta * 100).toFixed(1)}% vs prior period.`,
            account_ref: { ...baseRef, prior_date: prior.snapshot_date, prior_value: prior.current_value, latest_value: latest.current_value, delta },
          });
        }
      }
    }

    // 4. Unresolved holding tank rows (any HT with NULL current_value)
    const unresolvedHt = (ht ?? []).filter((r) => r.current_value == null);
    for (const r of unresolvedHt) {
      findings.push({
        severity: "info",
        code: "unresolved_holding_tank",
        message: `Holding Tank entry "${r.label}" has no balance.`,
        account_ref: { table: "holding_tank", id: r.id, contact_id: r.contact_id, label: r.label, account_number: r.account_number },
      });
    }

    // 4b. Charter presence — referral opportunity if missing
    const { data: hohRow } = await supabase
      .from("contacts").select("id, first_name, last_name, family_role")
      .in("id", contactIds);
    const hoh = (hohRow ?? []).find((c: any) => c.family_role === "Head of Household") ?? (hohRow ?? [])[0];
    let charterMissing = false;
    if (hoh) {
      const { data: charter } = await supabase
        .from("sovereignty_charters")
        .select("id, mission_of_capital, vision_20_year, growth_principles, liquidity_principles, esign_status")
        .eq("contact_id", hoh.id)
        .order("updated_at", { ascending: false })
        .limit(1).maybeSingle();
      const hasContent = !!charter && [
        charter.mission_of_capital, charter.vision_20_year,
        charter.growth_principles, charter.liquidity_principles,
      ].some((v) => typeof v === "string" && v.trim().length > 0);
      if (!hasContent) {
        charterMissing = true;
        findings.push({
          severity: "info",
          code: "charter_missing",
          message: `No ratified Sovereignty Charter on file for ${hoh.first_name ?? ""} ${hoh.last_name ?? ""}. Refer the family to the Sovereignty Operating System to draft one before the next review.`,
          account_ref: { contact_id: hoh.id, referral: "sovereignty_operating_system", esign_status: charter?.esign_status ?? null },
        });
      }
    }

    const { data: review, error: rErr } = await supabase
      .from("monthly_governance_reviews")
      .upsert({
        scope_type,
        scope_id,
        period_end,
        status: "verified",
        verified_at: new Date().toISOString(),
        created_by: userId,
        counts: {
          accounts: accounts.length,
          findings: findings.length,
          critical: findings.filter((f) => f.severity === "critical").length,
          warn: findings.filter((f) => f.severity === "warn").length,
          charter_missing: charterMissing ? 1 : 0,
        },
        generation_error: null,
      }, { onConflict: "scope_type,scope_id,period_end" })
      .select("id")
      .single();
    if (rErr || !review) throw new Error(rErr?.message || "Failed to upsert review");

    // Clear prior findings then insert fresh ones
    await supabase.from("governance_review_findings").delete().eq("review_id", review.id);
    if (findings.length) {
      const { error: fErr } = await supabase.from("governance_review_findings").insert(
        findings.map((f) => ({ ...f, review_id: review.id })),
      );
      if (fErr) throw fErr;
    }

    return json({ review_id: review.id, accounts: accounts.length, findings, charter_missing: charterMissing });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
