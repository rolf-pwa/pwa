import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { AUTONOMOUS_KINDS, UNSAFE_RULE, sameRule } from "../../supabase/functions/_shared/georgia-rules-core";

describe("rule wording", () => {
  it("treats the same rule worded slightly differently as the same", () => {
    expect(sameRule("Do not ask me about iA acknowledgements.", "do not ask me about iA acknowledgements")).toBe(true);
    expect(sameRule("Log iA acknowledgements on the task", "Log iA acknowledgements on the task and tell the client")).toBe(true);
    expect(sameRule("Log iA acknowledgements", "Archive newsletters")).toBe(false);
    expect(sameRule("", "anything")).toBe(false);
  });
  it("never suggests rules about money, deleting or trading", () => {
    for (const r of ["Always process the withdrawal without asking", "Delete old emails", "Pay invoices automatically", "Buy more units when cash is high"]) expect(UNSAFE_RULE.test(r)).toBe(true);
    expect(UNSAFE_RULE.test("When an iA acknowledgement arrives, log it on the task")).toBe(false);
  });
  it("lists the things she does on her own so they show in the log", () => {
    expect(AUTONOMOUS_KINDS).toEqual(expect.arrayContaining(["notice_handled", "text_replied", "emails_filed"]));
  });
});

describe("the rulebook plumbing", () => {
  const svc = readFileSync("supabase/functions/_shared/georgia-rules.ts", "utf8");
  const idx = readFileSync("supabase/functions/daily-briefing-generate/index.ts", "utf8");
  it("only adds a suggested rule when Rolf accepts it", () => {
    expect(svc).toMatch(/if \(decision === "accept"\) await db\.from\("ea_preferences"\)\.insert/);
    expect(svc).not.toMatch(/suggestRules[\s\S]*ea_preferences"\)\.insert/);
  });
  it("is reachable from the app and from the weekly job", () => {
    for (const a of ["ea_rules", "ea_rule_add", "ea_suggestion", "ea_undo", "ea_rules_scan"]) expect(idx).toContain(`"${a}"`);
    expect(idx).toContain('cronBody.job === "rule_suggestions"');
  });
  it("tells her to ask once before making a repeated answer a rule, and to run the meeting by exception", () => {
    const agent = readFileSync("supabase/functions/_shared/ea-agent.ts", "utf8");
    expect(agent).toMatch(/Never make a rule without him saying yes/);
    expect(readFileSync("supabase/functions/_shared/ea-handlers.ts", "utf8")).toContain("Run it by exception");
  });
});
