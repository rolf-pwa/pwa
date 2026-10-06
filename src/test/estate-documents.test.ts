import { describe, expect, it } from "vitest";
import { checkEstate, verdictFor } from "../../supabase/functions/_shared/stage2-checks";
import { applyCorrections, planEstateApply } from "../../supabase/functions/_shared/vault-apply";

const members = [{ first_name: "Colleen", last_name: "Jerczynski" }, { first_name: "Keith", last_name: "Jerczynski" }];
const will = { document_type: "will", subject_name: "Keith Andrew Jerczynski", document_date: "2023-01-17", signed: true, executor: "Colleen Jerczynski", beneficiaries: "spouse" };
const NOW = new Date("2026-10-08T00:00:00Z");
const ids = (r: ReturnType<typeof checkEstate>) => Object.fromEntries(r.map((c) => [c.id, c.status]));

describe("checkEstate", () => {
  it("verifies a complete signed will for a household member", () => {
    const r = checkEstate({ documents: [will] }, members, NOW);
    expect(ids(r)).toMatchObject({ document_type_known: "pass", date_plausible: "pass", signed: "pass", subject_in_household: "pass", executor_named: "pass" });
    expect(verdictFor(r).overall_status).toBe("VERIFIED");
  });
  it("fails when nothing was recognised, when the date is in the future, or the signature lines are blank", () => {
    expect(ids(checkEstate({ documents: [] }, members, NOW)).documents_present).toBe("fail");
    expect(ids(checkEstate({ documents: [{ ...will, document_date: "2027-01-01" }] }, members, NOW)).date_plausible).toBe("fail");
    expect(ids(checkEstate({ documents: [{ ...will, signed: false }] }, members, NOW)).signed).toBe("fail");
  });
  it("skips (never silently passes) what the document doesn't show", () => {
    const r = ids(checkEstate({ documents: [{ document_type: "will", subject_name: "Someone Else", document_date: null, signed: null, executor: null }] }, members, NOW));
    expect(r).toMatchObject({ date_plausible: "skipped", signed: "skipped", subject_in_household: "skipped", executor_named: "skipped" });
    expect(verdictFor(checkEstate({ documents: [{ ...will, signed: null }] }, members, NOW)).overall_status).toBe("INCOMPLETE");
  });
  it("an unrecognised type is skipped, and no executor is asked of a trust", () => {
    expect(ids(checkEstate({ documents: [{ document_type: "other", subject_name: "Colleen Jerczynski", signed: true, document_date: "2024-01-01" }] }, members, NOW)).document_type_known).toBe("skipped");
    expect("executor_named" in ids(checkEstate({ documents: [{ ...will, document_type: "trust" }] }, members, NOW))).toBe(false);
  });
});

describe("estate corrections and apply plan", () => {
  it("allows correcting estate fields (including signed as true/false) and records the override", () => {
    const r = applyCorrections("estate", { documents: [{ ...will, signed: null }] }, [
      { index: 0, field: "signed", value: true }, { index: 0, field: "document_date", value: "2023-01-18" },
    ]);
    expect(r.extraction.documents[0]).toMatchObject({ signed: true, document_date: "2023-01-18" });
    expect(r.overrides.map((o) => o.field_name)).toEqual(["documents[0].signed", "documents[0].document_date"]);
    expect(() => applyCorrections("estate", { documents: [will] }, [{ index: 0, field: "current_value", value: 1 }])).toThrow();
    expect(() => applyCorrections("estate", { documents: [will] }, [{ index: 0, field: "signed", value: "yes" }])).toThrow();
  });
  const ctx = { householdId: "h1", members: [{ id: "c1", first_name: "Colleen", last_name: "Jerczynski", family_role: "head_of_family" }, { id: "c2", first_name: "Keith", last_name: "Jerczynski", family_role: "spouse" }], driveId: "d1", fileName: "23-01-17_Jerczynski_K-Will.pdf", auditId: "a1", approvedBy: "u1" };
  it("upserts one row per file and type, owned by the matching member", () => {
    const [w] = planEstateApply([will], ctx) as any[];
    expect(w).toMatchObject({ op: "upsert", table: "estate_documents", onConflict: "drive_id,document_type" });
    expect(w.values).toMatchObject({ household_id: "h1", contact_id: "c2", document_type: "will", document_date: "2023-01-17", signed: true, drive_id: "d1", approved_by: "u1", source_audit_id: "a1" });
  });
  it("keeps the first of two documents of the same type, drops bad dates, and does nothing without a Drive file", () => {
    expect(planEstateApply([will, { ...will, document_date: "2024-01-01" }], ctx)).toHaveLength(1);
    expect((planEstateApply([{ ...will, document_date: "Jan 2023" }], ctx)[0] as any).values.document_date).toBeNull();
    expect(planEstateApply([will], { ...ctx, driveId: null })).toEqual([]);
  });
});
