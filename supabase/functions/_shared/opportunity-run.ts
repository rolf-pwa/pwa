// opportunity-run.ts: the weekly book-of-business run. Reads every household, applies the rulebook, and stores what it finds.
// Called by the Monday cron (through daily-briefing-generate) and by staff pressing "Run again" (book-of-business-run).

import { buildSnapshot } from "./opportunity-snapshot.ts";
import { evaluateHousehold, summarizeBook, RULE_VERSION, type Evaluation } from "./opportunity-rules.ts";
import { reconcile, type StoredOpportunity } from "./opportunity-reconcile.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;
const CONCURRENCY = 4;

interface Result { householdId: string; label: string; tier: string | null; groupedAum: number; evaluation: Evaluation | null; error?: string }

export async function runBookOfBusiness(db: SupabaseClient): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: run, error: runErr } = await db.from("opportunity_runs").insert({ rule_version: RULE_VERSION }).select("id").single();
  if (runErr) throw new Error(`Could not start a run: ${runErr.message}`);

  try {
    const { data: households, error } = await db.from("households").select("id, label").order("label");
    if (error) throw new Error(error.message);
    const rows = (households ?? []) as { id: string; label: string }[];

    const results: Result[] = [];
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      results.push(...await Promise.all(rows.slice(i, i + CONCURRENCY).map(async (h): Promise<Result> => {
        try {
          const snap = await buildSnapshot(db, h.id);
          return { householdId: h.id, label: h.label, tier: snap.tier, groupedAum: snap.groupedAum, evaluation: evaluateHousehold(snap, today) };
        } catch (e) {
          // One household's bad data must not sink the run, nor resolve its stored opportunities.
          return { householdId: h.id, label: h.label, tier: null, groupedAum: 0, evaluation: null, error: e instanceof Error ? e.message : String(e) };
        }
      })));
    }

    const evaluated = results.filter((r) => r.evaluation) as (Result & { evaluation: Evaluation })[];
    const findings = evaluated.flatMap((r) => r.evaluation.findings);
    const { data: stored, error: storedErr } = await db.from("opportunities").select("id, household_id, type, key, status, snoozed_until");
    if (storedErr) throw new Error(storedErr.message);
    const plan = reconcile((stored ?? []) as StoredOpportunity[], findings, new Set(evaluated.map((r) => r.householdId)), today, RULE_VERSION);

    if (plan.inserts.length) {
      const { error: e } = await db.from("opportunities").insert(plan.inserts);
      if (e) throw new Error(`Could not save new opportunities: ${e.message}`);
    }
    for (const u of plan.updates) {
      const { id, reopen, ...content } = u;
      const { error: e } = await db.from("opportunities").update(reopen ? { ...content, status: "open", snoozed_until: null, resolved_at: null } : content).eq("id", id);
      if (e) throw new Error(`Could not update an opportunity: ${e.message}`);
    }
    if (plan.resolves.length) {
      const { error: e } = await db.from("opportunities").update({ status: "resolved", resolved_at: new Date().toISOString() }).in("id", plan.resolves);
      if (e) throw new Error(`Could not resolve opportunities: ${e.message}`);
    }

    const summary = { ...summarizeBook(evaluated.map((r) => ({ householdId: r.householdId, evaluation: r.evaluation }))), inserted: plan.inserts.length, resolved: plan.resolves.length, unreadable: results.length - evaluated.length };
    const perHousehold = results.map((r) => ({ householdId: r.householdId, label: r.label, tier: r.tier, groupedAum: r.groupedAum, completeness: r.evaluation?.completeness ?? null, gaps: r.evaluation?.gaps ?? [], error: r.error ?? null }));
    await db.from("opportunity_runs").update({ finished_at: new Date().toISOString(), ok: true, summary, households: perHousehold }).eq("id", run.id);
    return `${results.length} households, ${findings.length} findings (${plan.inserts.length} new, ${plan.resolves.length} resolved)${summary.unreadable ? `, ${summary.unreadable} unreadable` : ""}`;
  } catch (e) {
    await db.from("opportunity_runs").update({ finished_at: new Date().toISOString(), ok: false, summary: { error: e instanceof Error ? e.message : String(e) } }).eq("id", run.id);
    throw e;
  }
}
