// opportunity-reconcile.ts: how a run's findings meet the rows already stored. Pure; no I/O.
// A finding keeps its row (household, type, key). What staff decided is respected: a dismissed or converted opportunity is not reopened,
// a snoozed one comes back when its date passes, and one that stops firing is marked resolved rather than deleted.

import type { Finding } from "./opportunity-rules.ts";

export type OpportunityStatus = "open" | "snoozed" | "dismissed" | "converted" | "resolved";

export interface StoredOpportunity {
  id: string;
  household_id: string;
  type: string;
  key: string;
  status: OpportunityStatus;
  snoozed_until: string | null;
}

export interface Plan {
  inserts: { household_id: string; type: string; key: string; title: string; evidence: Finding["evidence"]; confidence: Finding["confidence"]; next_step: string; est_value: number | null; rule_version: string; first_seen: string; last_seen: string }[];
  /** Fresh content for a row that stays; reopen clears a lapsed snooze or a resolution. */
  updates: { id: string; title: string; evidence: Finding["evidence"]; confidence: Finding["confidence"]; next_step: string; est_value: number | null; rule_version: string; last_seen: string; reopen: boolean }[];
  /** Rows whose finding no longer fires. */
  resolves: string[];
}

const idOf = (h: string, type: string, key: string) => `${h}\u0000${type}\u0000${key}`;

/**
 * `findings` are everything that fired this run; `evaluatedHouseholds` are the households that were read successfully.
 * A household that could not be read is left alone, so a failed read never resolves its opportunities.
 */
export function reconcile(existing: StoredOpportunity[], findings: Finding[], evaluatedHouseholds: Set<string>, today: string, ruleVersion: string): Plan {
  const plan: Plan = { inserts: [], updates: [], resolves: [] };
  const byId = new Map(existing.map((r) => [idOf(r.household_id, r.type, r.key), r]));
  const firing = new Set<string>();

  for (const f of findings) {
    const id = idOf(f.householdId, f.type, f.key);
    firing.add(id);
    const row = byId.get(id);
    const content = { title: f.title, evidence: f.evidence, confidence: f.confidence, next_step: f.nextStep, est_value: f.estValue, rule_version: ruleVersion, last_seen: today };
    if (!row) {
      plan.inserts.push({ household_id: f.householdId, type: f.type, key: f.key, first_seen: today, ...content });
      continue;
    }
    const lapsedSnooze = row.status === "snoozed" && (!row.snoozed_until || row.snoozed_until <= today);
    plan.updates.push({ id: row.id, ...content, reopen: row.status === "resolved" || lapsedSnooze });
  }

  for (const row of existing) {
    if (firing.has(idOf(row.household_id, row.type, row.key))) continue;
    if (!evaluatedHouseholds.has(row.household_id)) continue;
    // Only live opportunities resolve; a dismissed or converted one keeps what staff decided.
    if (row.status === "open" || row.status === "snoozed") plan.resolves.push(row.id);
  }
  return plan;
}
