import { describe, expect, it } from "vitest";
import { buildPushPayload, classifyPushStatus } from "../../supabase/functions/_shared/push-payload";

describe("buildPushPayload", () => {
  it("uses generic copy per kind and never includes a token in the url", () => {
    const p = buildPushPayload({ source_type: "message" });
    expect(p.title).toMatch(/message/i);
    expect(p.url).toBe("/portal");
    expect(p.tag).toBe("pw-message");
  });
  it("falls back for unknown kinds", () => {
    expect(buildPushPayload({ source_type: "weird" })).toMatchObject({ tag: "pw-update", title: "You have an update" });
    expect(buildPushPayload({})).toMatchObject({ tag: "pw-update" });
  });
  it("takes no client text, so nothing sensitive can reach a lock screen", () => {
    const n = { source_type: "task", title: "Transfer $250,000 from RRSP-123456789", body: "SIN 123-456-789" };
    expect(JSON.stringify(buildPushPayload(n))).not.toMatch(/250,000|RRSP|123-456-789/);
  });
});

describe("classifyPushStatus", () => {
  it("maps push-service statuses", () => {
    expect([201, 200, 404, 410, 429, 500, 503, 400, 401, 413].map(classifyPushStatus))
      .toEqual(["ok", "ok", "gone", "gone", "retry", "retry", "retry", "fail", "fail", "fail"]);
  });
});
