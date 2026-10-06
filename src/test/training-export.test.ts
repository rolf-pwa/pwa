import { describe, expect, it } from "vitest";
import { bucketAmount, residualPii, scrubText, scrubValue } from "../../supabase/functions/_shared/pii-scrub";
import { buildTrajectory, toJsonl, type ActionEventRow } from "../../supabase/functions/_shared/trajectory";

describe("scrubText", () => {
  it("redacts the common identifiers", () => {
    const out = scrubText("Call 416-555-0199 or jo@x.ca. SIN 123-456-789, postal M5V 2T6, acct 123456789012, $112,500.00 on 2026-09-30.");
    expect(out).not.toMatch(/416-555|jo@x|123-456-789|M5V|123456789012|112,500/);
    expect(out).toContain("[EMAIL]"); expect(out).toContain("[SIN]"); expect(out).toContain("[PHONE]"); expect(out).toContain("[POSTAL]");
    expect(out).toContain("2026-XX-XX");
  });
  it("replaces known names consistently, longest first", () => {
    const out = scrubText("Maria Scillato met Adrian Scillato. Maria agreed.", { names: ["Scillato", "Maria Scillato", "Adrian Scillato", "Maria"] });
    expect(out).not.toMatch(/Scillato|Maria|Adrian/);
    expect(out.match(/\[PERSON_1\]/g)?.length).toBe(1); // "Maria Scillato" as one unit
  });
  it("ignores very short names to avoid mangling ordinary words", () => {
    expect(scrubText("an ox is here", { names: ["An", "Ox"] })).toBe("an ox is here");
  });
  it("buckets amounts by order of magnitude", () => {
    expect(bucketAmount(112500)).toBe("[AMOUNT~1e5]");
    expect(bucketAmount(0)).toBe("[AMOUNT:0]");
  });
});

describe("scrubValue", () => {
  it("masks identifier keys, buckets money fields and scrubs people", () => {
    const out = scrubValue({ account_number: "RR-123", account_owner: "Maria E Scillato", current_value: 112500, custodian: "iA", file_name: "maria-statement.pdf", ok: true }, { names: ["Maria"] }) as Record<string, unknown>;
    expect(out.account_number).toBe("[REDACTED]");
    expect(out.file_name).toBe("[REDACTED]");
    expect(out.current_value).toBe("[AMOUNT~1e5]");
    expect(String(out.account_owner)).not.toMatch(/Maria|Scillato/);
    expect(out.custodian).toBe("iA");
    expect(out.ok).toBe(true);
  });
});

describe("buildTrajectory", () => {
  const ev = (o: Partial<ActionEventRow> = {}): ActionEventRow => ({
    id: "e1", action_type: "stage2_approve", workflow_module: "vault_statement_scan",
    input_context_snapshot: { kind: "investment", file_name: "scillato.pdf" },
    system_proposed_payload: { accounts: [{ account_owner: "Maria Scillato", current_value: 112500, book_value: 100000, current_harvest: 20000 }] },
    human_final_payload: { accounts: [{ account_owner: "Maria Scillato", current_value: 112500, book_value: 100000, current_harvest: 12500 }] },
    delta_score: 0.25, metadata: { rejected: false }, ...o,
  });
  it("produces a clean, scrubbed pair", () => {
    const r = buildTrajectory(ev(), { names: ["Maria Scillato", "Scillato"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const all = JSON.stringify(r.row);
    expect(all).not.toMatch(/Maria|Scillato|112500|112,500|scillato\.pdf/i);
    expect(r.row.feedback_signal).toBe("MAJOR_OVERRIDE");
    expect(residualPii(r.row.scrubbed_ai_response)).toBeNull();
  });
  it("skips events with no AI proposal", () => {
    expect(buildTrajectory(ev({ system_proposed_payload: null }), {})).toEqual({ ok: false, reason: "no AI proposal" });
  });
  it("quarantines anything pii-shield still flags (e.g. health terms)", () => {
    const r = buildTrajectory(ev({ human_final_payload: { note: "client has cancer, handle gently" } }), {});
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/human response still flagged/);
  });
  it("marks a rejection as REJECT", () => {
    const r = buildTrajectory(ev({ metadata: { rejected: true }, human_final_payload: { decision: "rejected" }, delta_score: 1 }), {});
    expect(r.ok && r.row.feedback_signal).toBe("REJECT");
  });
});

describe("toJsonl", () => {
  const base = { source_event_id: "e", workflow_type: "w", scrubbed_input_prompt: "p", scrubbed_ai_response: "ai", scrubbed_human_response: "human" };
  const rows = (["ACCEPT", "MINOR_EDIT", "MAJOR_OVERRIDE", "REJECT"] as const).map((s) => ({ ...base, feedback_signal: s }));
  it("sft keeps everything except rejections, targeting the human answer", () => {
    const lines = toJsonl(rows, "sft").split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.completion === "human")).toBe(true);
  });
  it("dpo keeps only real disagreements, human as chosen and AI as rejected", () => {
    const lines = toJsonl(rows, "dpo").split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.signal)).toEqual(["MINOR_EDIT", "MAJOR_OVERRIDE"]);
    expect(lines[0]).toMatchObject({ chosen: "human", rejected: "ai" });
  });
  it("is empty when nothing qualifies", () => {
    expect(toJsonl([], "sft")).toBe("");
  });
});
