// opportunity-run.ts: the weekly book-of-business run. Reads every household, applies the rulebook, and stores what it finds.
// Called by the Monday cron (through daily-briefing-generate) and by staff pressing "Run again" (book-of-business-run).

import { buildSnapshot } from "./opportunity-snapshot.ts";
import { assignAnchors, evaluateHousehold, summarizeBook, RULE_VERSION, type Evaluation, type HouseholdSnapshot } from "./opportunity-rules.ts";
import { reconcile, type StoredOpportunity } from "./opportunity-reconcile.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;
const CONCURRENCY = 4;

interface Result { householdId: string; label: string; tier: string | null; groupedAum: number; householdAum: number; pooled: boolean; familyName: string | null; familyAum: number | null; evaluation: Evaluation | null; error?: string }

export async function runBookOfBusiness(db: SupabaseClient): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: run, error: runErr } = await db.from("opportunity_runs").insert({ rule_version: RULE_VERSION }).select("id").single();
  if (runErr) throw new Error(`Could not start a run: ${runErr.message}`);

  try {
    // A household whose advisory relationship has ended owes nothing, so it is not read.
    const { data: households, error } = await db.from("households").select("id, label").is("relationship_ended_at", null).order("label");
    if (error) throw new Error(error.message);
    const rows = (households ?? []) as { id: string; label: string }[];
    const { data: endedRows } = await db.from("households").select("id").not("relationship_ended_at", "is", null);
    const retired = new Set(((endedRows ?? []) as { id: string }[]).map((h) => h.id));

    // Read every household first: which one anchors a pooled family's findings depends on all of them.
    const snaps: HouseholdSnapshot[] = [];
    const failed: Result[] = [];
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      await Promise.all(rows.slice(i, i + CONCURRENCY).map(async (h) => {
        try {
          snaps.push(await buildSnapshot(db, h.id));
        } catch (e) {
          // One household's bad data must not sink the run, nor resolve its stored opportunities.
          failed.push({ householdId: h.id, label: h.label, tier: null, groupedAum: 0, householdAum: 0, pooled: false, familyName: null, familyAum: null, evaluation: null, error: e instanceof Error ? e.message : String(e) });
        }
      }));
    }
    assignAnchors(snaps);
    const results: Result[] = [
      ...snaps.map((s) => ({ householdId: s.householdId, label: s.label, tier: s.tier, groupedAum: s.groupedAum, householdAum: s.householdAum, pooled: s.pooled, familyName: s.familyName, familyAum: s.familyAum, evaluation: evaluateHousehold(s, today) })),
      ...failed,
    ].sort((a, b) => a.label.localeCompare(b.label));

    const evaluated = results.filter((r) => r.evaluation) as (Result & { evaluation: Evaluation })[];
    const findings = evaluated.flatMap((r) => r.evaluation.findings);
    const { data: stored, error: storedErr } = await db.from("opportunities").select("id, household_id, type, key, status, snoozed_until");
    if (storedErr) throw new Error(storedErr.message);
    const plan = reconcile((stored ?? []) as StoredOpportunity[], findings, new Set(evaluated.map((r) => r.householdId)), today, RULE_VERSION, retired);

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
    const perHousehold = results.map((r) => ({ householdId: r.householdId, label: r.label, tier: r.tier, groupedAum: r.groupedAum, householdAum: r.householdAum, pooled: r.pooled, familyName: r.familyName, familyAum: r.familyAum, completeness: r.evaluation?.completeness ?? null, gaps: r.evaluation?.gaps ?? [], error: r.error ?? null }));
    await db.from("opportunity_runs").update({ finished_at: new Date().toISOString(), ok: true, summary, households: perHousehold }).eq("id", run.id);
    return `${results.length} households, ${findings.length} findings (${plan.inserts.length} new, ${plan.resolves.length} resolved)${summary.unreadable ? `, ${summary.unreadable} unreadable` : ""}`;
  } catch (e) {
    await db.from("opportunity_runs").update({ finished_at: new Date().toISOString(), ok: false, summary: { error: e instanceof Error ? e.message : String(e) } }).eq("id", run.id);
    throw e;
  }
}
