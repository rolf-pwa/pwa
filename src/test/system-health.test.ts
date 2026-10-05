// Pure, DB-free checks of the Sentinel's decision logic and log scrubbing,
// same convention as service-tiering.test.ts.
import { describe, expect, it } from "vitest";
import {
  buildHealthLogRow,
  decideAction,
  isTransientError,
  retryDueAt,
  scrubForLog,
  type HealthLogRow,
} from "../../supabase/functions/_shared/system-health";

const T0 = "2026-10-04T12:00:00.000Z";
const row = (o: Partial<HealthLogRow> = {}): HealthLogRow => ({
  id: "1", created_at: T0, function_name: "f", household_id: null, severity: "ERROR",
  error_code: "503", error_message: "unavailable", input_payload: {}, retry_count: 0,
  max_retries: 3, status: "PENDING", ...o,
});
const at = (min: number) => new Date(new Date(T0).getTime() + min * 60_000);

describe("retryDueAt", () => {
  it("backs off exponentially: +2m, +6m, +14m after creation", () => {
    expect(retryDueAt(T0, 0)).toEqual(at(2));
    expect(retryDueAt(T0, 1)).toEqual(at(6));
    expect(retryDueAt(T0, 2)).toEqual(at(14));
  });
});

describe("isTransientError", () => {
  it("recognises transient codes and messages", () => {
    expect(isTransientError("429", null)).toBe(true);
    expect(isTransientError("resource_exhausted", null)).toBe(true);
    expect(isTransientError(null, "Request timed out")).toBe(true);
    expect(isTransientError("400", "Missing householdId")).toBe(false);
    expect(isTransientError(null, null)).toBe(false);
  });
});

describe("decideAction", () => {
  it("ignores resolved, escalated, INFO and WARN rows", () => {
    expect(decideAction(row({ status: "RESOLVED" }), at(60), true)).toBe("ignore");
    expect(decideAction(row({ status: "ESCALATED" }), at(60), true)).toBe("ignore");
    expect(decideAction(row({ severity: "WARN" }), at(60), true)).toBe("ignore");
  });
  it("escalates FATAL immediately", () => {
    expect(decideAction(row({ severity: "FATAL" }), at(0), true)).toBe("escalate");
  });
  it("escalates when the function is not replay-enabled or the error is not transient", () => {
    expect(decideAction(row(), at(60), false)).toBe("escalate");
    expect(decideAction(row({ error_code: "400", error_message: "bad input" }), at(60), true)).toBe("escalate");
  });
  it("waits until the backoff elapses, then retries", () => {
    expect(decideAction(row(), at(1), true)).toBe("wait");
    expect(decideAction(row(), at(2), true)).toBe("retry");
    expect(decideAction(row({ retry_count: 1, status: "RETRIED" }), at(5), true)).toBe("wait");
    expect(decideAction(row({ retry_count: 1, status: "RETRIED" }), at(6), true)).toBe("retry");
  });
  it("escalates once retries are exhausted", () => {
    expect(decideAction(row({ retry_count: 3 }), at(60), true)).toBe("escalate");
  });
});

describe("scrubForLog / buildHealthLogRow", () => {
  it("redacts sensitive keys and PII patterns but keeps uuids", () => {
    const id = "5b1f0c0e-1111-4222-8333-944455556666";
    const out = scrubForLog({
      householdId: id, apiKey: "abc", nested: { Authorization: "Bearer x", note: "SIN 123-456-789 jo@x.ca acct 123456789012" },
    }) as { householdId: string; apiKey: string; nested: { Authorization: string; note: string } };
    expect(out.householdId).toBe(id);
    expect(out.apiKey).toBe("[redacted]");
    expect(out.nested.Authorization).toBe("[redacted]");
    expect(out.nested.note).not.toMatch(/123-456-789|jo@x\.ca|123456789012/);
  });
  it("truncates long strings and bounds depth", () => {
    expect((scrubForLog("a".repeat(900)) as string).length).toBeLessThan(520);
    let deep: unknown = { v: 1 }; for (let i = 0; i < 10; i++) deep = { d: deep };
    expect(JSON.stringify(scrubForLog(deep))).toContain("[depth-limit]");
  });
  it("only ERROR/FATAL rows start PENDING; INFO/WARN are record-only", () => {
    expect(buildHealthLogRow({ function_name: "f", severity: "ERROR" }).status).toBe("PENDING");
    expect(buildHealthLogRow({ function_name: "f", severity: "FATAL" }).status).toBe("PENDING");
    expect(buildHealthLogRow({ function_name: "f", severity: "WARN" }).status).toBe("RESOLVED");
  });
});
