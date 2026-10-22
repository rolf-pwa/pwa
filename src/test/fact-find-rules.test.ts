import { describe, expect, it } from "vitest";
import { FIELDS, assemble, askList, evidencePrompt, factFindMarkdown, missingFacts, validateModelFacts, type Evidence, type Fact } from "../../supabase/functions/_shared/fact-find-rules";

const ev: Evidence[] = [
  { id: "E1", type: "meeting", label: "Interim Strategy Consultation", date: "2026-10-13", text: "Thomas said: I work as a dentist and I own my practice, Wolfe Dental. We make about $320,000 a year before tax.\nHe quit smoking in 2019." },
  { id: "E2", type: "call", label: "Call", date: "2026-10-15", text: "We would like enough cover to pay off the mortgage if something happened." },
];
const fileFact = (key: string, value: string): Fact => { const d = FIELDS.find((f) => f.key === key)!; return { key, label: d.label, section: d.section, value, source: { type: "file", label: "On file" }, status: "proposed" }; };

describe("model facts must quote their source", () => {
  it("keeps a fact whose quote is in the source, word for word", () => {
    const r = validateModelFacts([{ key: "occupation", value: "Dentist", evidence_id: "E1", quote: "I work as a dentist and I own my practice" }], ev);
    expect(r.dropped).toBe(0);
    expect(r.facts[0]).toMatchObject({ key: "occupation", value: "Dentist", status: "proposed", source: { type: "meeting", date: "2026-10-13" } });
  });
  it("ignores case, spacing and curly quotes when matching", () => {
    expect(validateModelFacts([{ key: "annual_income", value: "$320,000", evidence_id: "E1", quote: "WE MAKE ABOUT  $320,000 a year before tax" }], ev).facts).toHaveLength(1);
  });
  it("drops a fabricated quote, an unknown key, an unknown source, a short quote and a repeat", () => {
    const r = validateModelFacts([
      { key: "health_notes", value: "Diabetic", evidence_id: "E1", quote: "He has had type 2 diabetes for years" },
      { key: "favourite_colour", value: "Blue", evidence_id: "E1", quote: "I work as a dentist" },
      { key: "occupation", value: "Dentist", evidence_id: "E9", quote: "I work as a dentist and I own" },
      { key: "occupation", value: "Dentist", evidence_id: "E1", quote: "dentist" },
      { key: "occupation", value: "Dentist", evidence_id: "E1", quote: "I work as a dentist and I own my practice" },
      { key: "occupation", value: "Dentist again", evidence_id: "E1", quote: "I work as a dentist and I own my practice" },
    ], ev);
    expect(r.facts.map((f) => f.value)).toEqual(["Dentist"]);
    expect(r.dropped).toBe(5);
  });
  it("will not take a file-only field from the model", () => {
    expect(validateModelFacts([{ key: "legal_name", value: "X", evidence_id: "E1", quote: "I work as a dentist and I own" }], ev).facts).toHaveLength(0);
  });
  it("ignores something that is not a list", () => { expect(validateModelFacts("nope", ev)).toEqual({ facts: [], dropped: 0 }); });
});

describe("assembling the form", () => {
  const model = validateModelFacts([{ key: "occupation", value: "Dentist", evidence_id: "E1", quote: "I work as a dentist and I own my practice" }], ev).facts;
  const facts = assemble([fileFact("legal_name", "Thomas Wolfe"), fileFact("liabilities", "")], model);
  it("has every field in order, with file facts first and the model's where the file has none", () => {
    expect(facts.map((f) => f.key)).toEqual(FIELDS.map((f) => f.key));
    expect(facts.find((f) => f.key === "legal_name")!.value).toBe("Thomas Wolfe");
    expect(facts.find((f) => f.key === "occupation")!.value).toBe("Dentist");
  });
  it("marks what is missing, with the question to ask", () => {
    const m = missingFacts(facts);
    expect(m.find((f) => f.key === "health_notes")!.status).toBe("missing");
    expect(m.some((f) => f.key === "liabilities")).toBe(true);
    expect(askList(facts)).toContain("Health conditions, treatments or medications");
  });
});

describe("the client's document", () => {
  const facts = assemble([fileFact("legal_name", "Thomas Wolfe")], validateModelFacts([{ key: "occupation", value: "Dentist", evidence_id: "E1", quote: "I work as a dentist and I own my practice" }], ev).facts);
  const md = factFindMarkdown("Thomas Wolfe", facts);
  it("greets by first name, lists values with their source, and says what is not provided", () => {
    expect(md).toContain("Hi Thomas,");
    expect(md).toContain("**Legal name:** Thomas Wolfe");
    expect(md).toContain("**Occupation:** Dentist (from our meeting on 2026-10-13)");
    expect(md).toContain("**Health:** Not yet provided");
    expect(md).toContain("## Work and income");
  });
  it("never shows the raw quotes", () => { expect(md).not.toContain("I work as a dentist and I own my practice"); });
  it("lays the sources out for the model with ids", () => {
    const p = evidencePrompt("Thomas Wolfe", ev);
    expect(p).toContain("=== SOURCE E1: Interim Strategy Consultation ===");
    expect(p).toContain("word for word");
    expect(p).toContain("occupation");
  });
});

import { ageOn, buildFileFacts } from "../../supabase/functions/_shared/fact-find-rules";
describe("facts from the file", () => {
  const facts = buildFileFacts({
    contact: { full_name: "Thomas Wolfe", email: "t@x.ca", phone: "250-555-0100", address: "1 Lake Rd", date_of_birth: "1970-10-14", lawyer_name: "A. Counsel", executor_name: "Sarah Wolfe" },
    household: { vision_notes: "Time with the kids", pressure_types: ["tax_bill", "family_pressure"], pressure_note: "Selling the practice" },
    minors: [{ name: "Ava", date_of_birth: "2015-03-01" }, { name: "Ben" }],
    liabilities: [{ liability_type: "mortgage", current_balance: 400000 }, { liability_type: "credit_card", current_balance: "2500" }, { liability_type: "line_of_credit", current_balance: 0 }],
    storehouses: [{ asset_type: "rrsp", current_value: 200000 }, { asset_type: "tfsa", current_value: 50000 }, { asset_type: "cash", current_value: 0 }],
    policies: [{ carrier: "iA Financial", policy_type: "term", coverage_amount: 500000 }],
    today: "2026-10-22",
  });
  const get = (k: string) => facts.find((f) => f.key === k)!.value;
  it("works out ages", () => { expect(ageOn("1970-10-14", "2026-10-22")).toBe(56); expect(ageOn("1970-10-23", "2026-10-22")).toBe(55); expect(ageOn(null, "2026-10-22")).toBeNull(); });
  it("states identity, family, money and estate facts from the records", () => {
    expect(get("legal_name")).toBe("Thomas Wolfe");
    expect(get("date_of_birth")).toBe("1970-10-14 (age 56)");
    expect(get("contact")).toContain("Phone 250-555-0100");
    expect(get("dependants")).toBe("Ava (11); Ben");
    expect(get("liabilities")).toBe("mortgage $400,000; credit card $2,500; total $402,500");
    expect(get("assets")).toBe("2 accounts on file, current value $250,000");
    expect(get("existing_coverage")).toBe("term, iA Financial, $500,000");
    expect(get("estate")).toBe("Lawyer A. Counsel; Executor Sarah Wolfe");
    expect(get("vision")).toBe("Vision: Time with the kids");
    expect(get("pressures")).toBe("tax bill, family pressure: Selling the practice");
  });
  it("leaves out what the records do not have, so it shows as missing", () => {
    const a = assemble(buildFileFacts({ contact: {}, household: {}, minors: [], liabilities: [], storehouses: [], policies: [], today: "2026-10-22" }), []);
    expect(a.every((f) => f.status === "missing")).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { SECTIONS as CLIENT_SECTIONS } from "@/shared/lib/factFind";
import { SECTIONS as SERVER_SECTIONS } from "../../supabase/functions/_shared/fact-find-rules";
describe("wiring", () => {
  it("keeps the client's section list in step with the server's", () => { expect(CLIENT_SECTIONS).toEqual(SERVER_SECTIONS); });
  it("has a migration with grants that allows the new document kind", () => {
    const m = readFileSync("supabase/migrations/20261218120000_insurance_fact_finds.sql", "utf8");
    expect(m).toMatch(/GRANT ALL ON public\.insurance_fact_finds TO service_role;/);
    expect(m).toContain("'fact_find'");
  });
  it("is offered on the Compliance page and reachable from the staff function", () => {
    expect(readFileSync("src/modules/insurance/InsuranceHouseholdPages.tsx", "utf8")).toContain("ComplianceFactFind");
    expect(readFileSync("supabase/functions/review-agent-admin/index.ts", "utf8")).toMatch(/ffCompile/);
  });
});
