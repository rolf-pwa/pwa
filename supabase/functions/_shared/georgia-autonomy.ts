// georgia-autonomy.ts: the shadow record. When Georgia's portal autonomy is switched on, each submitted request is triaged and what she WOULD have done
// is recorded, while the request is handled exactly as before (a task for Rolf). Nothing here changes what the client sees or what Rolf gets.
// Never throws into the caller: a failure to record leaves the request as it was.

import { decide, triageRequest, TRIAGE_VERSION, wouldHandle, type AutonomyConfig, type Category, type Mode } from "./georgia-triage.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export async function loadAutonomyConfig(db: Db): Promise<AutonomyConfig> {
  const [{ data: master }, { data: rows }] = await Promise.all([
    db.from("georgia_autonomy_master").select("enabled").eq("id", true).maybeSingle(),
    db.from("georgia_autonomy_config").select("category, mode"),
  ]);
  const modes: Partial<Record<Category, Mode>> = {};
  // deno-lint-ignore no-explicit-any
  for (const r of (rows ?? []) as any[]) modes[r.category as Category] = r.mode as Mode;
  return { enabled: !!master?.enabled, modes };
}

export interface ShadowRecord {
  version: string;
  at: string;
  category: Category | null;
  blocked: string[];
  ambiguous: boolean;
  /** What actually happened to the request. Always handed_over in stage 2. */
  actual: "handed_over";
  /** What the settings say would happen once the category is live. */
  decision: { outcome: string; mode: Mode | null; reason: string; shadow: boolean };
  /** What Georgia would do if the category were automatic. */
  wouldBe: string;
}

export function buildShadowRecord(text: string, requestType: string, cfg: AutonomyConfig, now: Date = new Date()): ShadowRecord {
  const t = triageRequest(text, requestType);
  const d = decide(t, cfg);
  return { version: TRIAGE_VERSION, at: now.toISOString(), category: t.category, blocked: t.blocked, ambiguous: t.ambiguous, actual: "handed_over", decision: { outcome: d.outcome, mode: d.mode, reason: d.reason, shadow: d.shadow }, wouldBe: wouldHandle(t) };
}

/** Records the triage of one request. Returns the record, or null when the master switch is off or recording failed. */
export async function recordShadowTriage(db: Db, o: { requestId: string; contactId: string | null; text: string; requestType: string }): Promise<ShadowRecord | null> {
  try {
    const cfg = await loadAutonomyConfig(db);
    if (!cfg.enabled) return null;
    const rec = buildShadowRecord(o.text, o.requestType, cfg);
    await db.from("portal_requests").update({ category: rec.category, handled_by: "rolf", outcome: "handed_over", triage: rec }).eq("id", o.requestId);
    // The audit row never copies the client's words: the category and what she would have done.
    const summary = rec.blocked.length ? `Shadow: Rolf's by rule (${rec.blocked.join(", ")})` : rec.category ? `Shadow: ${rec.category} would be ${rec.wouldBe}` : `Shadow: not a kind she handles${rec.ambiguous ? " (mixed)" : ""}`;
    await db.from("georgia_actions").insert({ contact_id: o.contactId, request_id: o.requestId, category: rec.category ?? "none", kind: "handed_over", summary, detail: rec });
    return rec;
  } catch (e) {
    console.error("[georgia-autonomy] shadow record failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
