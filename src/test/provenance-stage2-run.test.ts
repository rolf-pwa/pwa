/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { sanitizeSource, withSanitizedSources } from "../../supabase/functions/_shared/provenance";
import { runStage2 } from "../../supabase/functions/_shared/stage2-run";

describe("sanitizeSource", () => {
  it("keeps a valid page, box and quote", () => {
    expect(sanitizeSource({ page_number: 2, bounding_box: [100.4, 50, 140, 400], quote: "  $112,500.00 " }))
      .toEqual({ page_number: 2, bounding_box: [100, 50, 140, 400], quote: "$112,500.00" });
  });
  it("drops malformed boxes instead of guessing", () => {
    const bad = (bounding_box: unknown) => sanitizeSource({ page_number: 1, bounding_box, quote: "x" })?.bounding_box;
    expect(bad([10, 10, 5, 20])).toBeNull();          // ymin >= ymax
    expect(bad([0, 0, 1200, 10])).toBeNull();          // out of 0-1000
    expect(bad([1, 2, 3])).toBeNull();                 // wrong length
    expect(bad(["a", 1, 2, 3])).toBeNull();            // non-numeric
  });
  it("drops a box that has no page, and rejects junk entirely", () => {
    expect(sanitizeSource({ page_number: null, bounding_box: [1, 1, 2, 2], quote: null })).toBeNull();
    expect(sanitizeSource({ page_number: 0, bounding_box: null, quote: null })).toBeNull();
    expect(sanitizeSource("nope")).toBeNull();
    expect(sanitizeSource(null)).toBeNull();
  });
  it("truncates long quotes", () => {
    expect(sanitizeSource({ page_number: 1, quote: "a".repeat(500) })?.quote?.length).toBe(120);
  });
  it("withSanitizedSources nulls missing sources", () => {
    expect(withSanitizedSources([{}])[0].source).toBeNull();
  });
});

// Minimal fake of the Supabase client: records which tables are touched and how.
function fakeAdmin(ontology: unknown = null) {
  const calls: Array<{ table: string; op: string; row?: unknown }> = [];
  const admin = {
    from(table: string) {
      const chain = {
        select() { calls.push({ table, op: "select" }); return chain; },
        eq() { return chain; }, order() { return chain; }, limit() { return chain; },
        maybeSingle: async () => ({ data: ontology, error: null }),
        single: async () => ({ data: { id: "audit-1" }, error: null }),
        insert(row: unknown) { calls.push({ table, op: "insert", row }); return chain; },
      };
      return chain;
    },
  };
  return { admin, calls };
}

describe("runStage2", () => {
  const extraction = {
    statement_date: new Date().toISOString().slice(0, 10),
    accounts: [{ account_number: "A1", book_value: 100, current_harvest: 10, current_value: 110,
      source: { page_number: 1, bounding_box: [1, 2, 3, 4], quote: "110.00" } }, { account_number: "A2", current_value: 5, source: { page_number: -3 } }],
  };

  it("writes exactly one audit row and touches no live-data table", async () => {
    const { admin, calls } = fakeAdmin();
    const out = await runStage2(admin, { householdId: "h1", kind: "investment", extraction, source: { drive_id: "d1", file_name: "s.pdf" } });
    const writes = calls.filter((c) => c.op === "insert");
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe("stage2_verification_audit");
    expect(new Set(calls.map((c) => c.table))).toEqual(new Set(["household_ontology_assessments", "stage2_verification_audit"]));
    expect(out.audit_id).toBe("audit-1");
  });
  it("stores sanitised provenance and the file source, and flags unverified results for an advisor", async () => {
    const { admin, calls } = fakeAdmin();
    const out = await runStage2(admin, { householdId: "h1", kind: "investment", extraction, source: { drive_id: "d1", file_name: "s.pdf" } });
    const row = calls.find((c) => c.op === "insert")!.row as { extracted_entities: any; advisor_override_required: boolean };
    expect(row.extracted_entities.source).toEqual({ drive_id: "d1", file_name: "s.pdf" });
    expect(row.extracted_entities.extraction.accounts[0].source.bounding_box).toEqual([1, 2, 3, 4]);
    expect(row.extracted_entities.extraction.accounts[1].source).toBeNull(); // page -3 rejected
    expect(out.overall_status).not.toBe("VERIFIED"); // A2's gain can't be re-derived
    expect(row.advisor_override_required).toBe(true);
  });
  it("surfaces a failed audit insert as an error", async () => {
    const admin = { from: () => { const c: any = { select: () => c, eq: () => c, order: () => c, limit: () => c, maybeSingle: async () => ({ data: null }), insert: () => c, single: async () => ({ data: null, error: { message: "boom" } }) }; return c; } };
    await expect(runStage2(admin, { householdId: "h1", kind: "investment", extraction })).rejects.toThrow("boom");
  });
});
