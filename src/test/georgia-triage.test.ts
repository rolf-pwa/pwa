import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decide, gateReasons, maskContract, redactContracts, triageRequest, type AutonomyConfig, type Category, type Mode } from "../../supabase/functions/_shared/georgia-triage";

const cfg = (modes: Partial<Record<Category, Mode>>, enabled = true): AutonomyConfig => ({ enabled, modes });

describe("the gate: what always goes to Rolf", () => {
  it.each([
    ["I want to withdraw $5,000 from my TFSA", "money_movement"],
    ["Please transfer money to my chequing account", "money_movement"],
    ["Can you rebalance my portfolio", "money_movement"],
    ["I need to change the banking details on my RRSP", "banking_details"],
    ["Here is a void cheque for my account", "banking_details"],
    ["I want to change my beneficiary", "beneficiary"],
    ["Please add my husband to the account as a joint owner", "ownership"],
    ["Should I sell my fund before the market drops", "advice"],
    ["My father passed away last week", "urgent"],
    ["I think my account was hacked", "urgent"],
    ["The money I sent never arrived", "urgent"],
    ["Please delete all my personal information", "data_rights"],
    ["I need a statement for my wife's account", "other_person"],
    ["I changed my last name after the wedding", "name_change"],
  ])("%s -> %s", (text, reason) => {
    expect(gateReasons(text, "general_inquiry")).toContain(reason);
  });
  it("blocks a data access request by its type, whatever the words", () => {
    expect(gateReasons("Hello", "data_access")).toEqual(["data_rights"]);
  });
  it("lets the ordinary, simple requests through", () => {
    for (const text of ["Where is my tax slip", "When is my next meeting with Rolf", "I moved, my new address is 12 Oak St", "How do I make a deposit", "Can I change my premium payment date"]) {
      expect(gateReasons(text, "general_inquiry"), text).toEqual([]);
    }
  });
  it("treats banking words about an insurance premium as self-serve, not as banking details on an investment account", () => {
    expect(gateReasons("I want to change the bank account my insurance premium comes from", "general_inquiry")).toEqual([]);
    expect(gateReasons("I want to change my bank account", "general_inquiry")).toEqual(["banking_details"]);
  });
});

describe("the category", () => {
  it.each([
    ["How do I make a deposit into my TFSA", "ia_self_serve"],
    ["Can I move my premium payment date", "ia_self_serve"],
    ["My phone number has changed, the new one is 250 555 0100", "contact_details"],
    ["Please update my email address", "contact_details"],
    ["I'd like to book a meeting with Rolf", "meetings"],
    ["Can we reschedule our appointment", "meetings"],
    ["Where can I find my 2025 tax slip", "documents"],
    ["I need a copy of my last statement", "documents"],
    ["Any update on my request", "status"],
  ])("%s -> %s", (text, category) => {
    const t = triageRequest(text, "general_inquiry");
    expect(t.blocked).toEqual([]);
    expect(t.category).toBe(category);
  });
  it("names no category when none or several match, which hands it to Rolf", () => {
    expect(triageRequest("Hello there", "general_inquiry")).toMatchObject({ category: null, ambiguous: false });
    expect(triageRequest("Can I book a meeting and get my statement", "general_inquiry")).toMatchObject({ category: null, ambiguous: true });
  });
  it("names no category for a gated request, even one that also mentions a simple thing", () => {
    expect(triageRequest("Please withdraw money and book a meeting", "general_inquiry")).toMatchObject({ category: null, blocked: ["money_movement"] });
  });
});

describe("what happens to a request", () => {
  const meeting = triageRequest("Can I book a meeting with Rolf", "general_inquiry");
  const phone = triageRequest("Please update my phone number", "personal_info");
  const gated = triageRequest("I want to withdraw $500", "banking_withdrawal");

  it("is handed to Rolf while the master switch is off, whatever the categories say", () => {
    expect(decide(meeting, cfg({ meetings: "auto" }, false))).toMatchObject({ outcome: "handed_over", reason: "Georgia's portal autonomy is switched off" });
  });
  it("is handed to Rolf when the category is off, and for a category that has no setting", () => {
    expect(decide(meeting, cfg({ meetings: "off" })).outcome).toBe("handed_over");
    expect(decide(meeting, cfg({})).outcome).toBe("handed_over");
  });
  it("is recorded but still Rolf's in shadow", () => {
    expect(decide(meeting, cfg({ meetings: "shadow" }))).toMatchObject({ outcome: "handed_over", mode: "shadow", shadow: true, category: "meetings" });
  });
  it("is drafted for approval in draft, and finished by Georgia only in auto", () => {
    expect(decide(meeting, cfg({ meetings: "draft" })).outcome).toBe("drafted");
    expect(decide(meeting, cfg({ meetings: "auto" })).outcome).toBe("answered");
    expect(decide(phone, cfg({ contact_details: "auto" })).outcome).toBe("done");
  });
  it("is never taken from Rolf when the gate stops it, in any mode", () => {
    for (const mode of ["off", "shadow", "draft", "auto"] as Mode[]) {
      const d = decide(gated, cfg({ status: mode, documents: mode, meetings: mode, ia_self_serve: mode, contact_details: mode }));
      expect(d.outcome, mode).toBe("handed_over");
      expect(d.reason).toContain("money_movement");
    }
  });
  it("is handed to Rolf when it is unclear or mixed", () => {
    expect(decide(triageRequest("Hello", "general_inquiry"), cfg({ status: "auto" })).reason).toBe("Not a kind Georgia handles");
    expect(decide(triageRequest("book a meeting and get my statement", "general_inquiry"), cfg({ meetings: "auto", documents: "auto" })).reason).toBe("More than one kind of request in it");
  });
});

describe("keeping a contract number out of the stored conversation", () => {
  it("masks all but the last four digits", () => {
    expect(maskContract("1819-479-981")).toBe("ending 9981");
    expect(maskContract("12")).toBe("a contract number");
  });
  it("replaces the number wherever it appears, however it was written", () => {
    expect(redactContracts("My number is 1819479981 or 1819 479 981 or 1819-479-981.", ["1819479981"])).toBe("My number is ending 9981 or ending 9981 or ending 9981.");
    expect(redactContracts("Nothing to hide", ["1819479981"])).toBe("Nothing to hide");
    expect(redactContracts("123", ["12"])).toBe("123");
  });
});

describe("the foundations migration", () => {
  const sql = readFileSync("supabase/migrations/20270112120000_georgia_autonomy_foundations.sql", "utf8");
  it("starts everything off and keeps the new columns optional", () => {
    expect(sql).toContain("enabled boolean NOT NULL DEFAULT false");
    expect(sql).toContain("mode text NOT NULL DEFAULT 'off'");
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS (outcome|handed_by|handled_by|category|triage) [a-z]+ NOT NULL/);
  });
  it("gives each new table explicit grants and staff-only policies", () => {
    for (const t of ["georgia_autonomy_master", "georgia_autonomy_config", "georgia_actions"]) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY "Staff read ${t}"`);
    }
    expect(sql).toContain("GRANT ALL ON public.georgia_autonomy_master, public.georgia_autonomy_config, public.georgia_actions TO service_role");
    expect(sql).toContain("LIKE '%@prosperwise.ca'");
  });
});
