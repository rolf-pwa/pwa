import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { alternativesText, compare, groupKey, groupLabel, unitFor, costPerUnit, type Quote } from "@/shared/lib/quotes";
import { costPerUnit as sCostPerUnit, needLineFor, quoteBlocks, unitFor as sUnitFor, type QuoteRow } from "../../supabase/functions/_shared/quote-rules";
import { ILLUSTRATION_PROMPT, draftsFromIllustration } from "../../supabase/functions/_shared/illustration-rules";

const q = (o: Partial<Quote>): Quote => ({ id: "1", policy_type: "disability", carrier: "iA", product: "Acci-Jet illness", coverage_amount: 4100, term_years: null, premium_amount: 82.41, premium_frequency: "monthly", underwriting: null, riders: null, guarantees: null, quote_date: null, valid_until: null, illustration_url: null, notes: null, status: "considered", reason: null, ...o });
const f = (coverage: number, key: string, value: string, quote = "") => ({ coverage, key, value, quote });

// What the model should return for the two iA illustrations in Rolf's samples (a made-up insured; the figures are the ones printed).
const DISABILITY = [
  f(0, "carrier", "iA Financial Group", "iA Financial Group"), f(0, "insured_name", "Doreen Example", "Insured: Doreen Example, Female, Age = 39"), f(0, "quote_date", "2026-10-23", "October 23, 2026"), f(0, "policy_type", "disability", "Disability insurance in the event of an illness"),
  f(1, "product", "Acci-Jet disability, accident or soft tissue injury", "Disability insurance in the event of an accident or soft tissue injury"), f(1, "coverage_amount", "4100", "$4,100 $72.98"), f(1, "premium_minimum", "72.98", "$4,100 $72.98"), f(1, "premium_frequency", "monthly", "Monthly premium"),
  f(1, "waiting_days", "0", "Waiting period of 0 days"), f(1, "benefit_period", "2 years", "benefit period of 2 years"), f(1, "occupation", "regular occupation 2 years", "regular occupation 2 years"), f(1, "benefit_kind", "income", "Disability insurance"),
  f(1, "riders", "Partial disability $13.53 a month; return of premiums $25.01 a month", "Partial disability $13.53"),
  f(2, "product", "Acci-Jet disability, illness", "Disability insurance in the event of an illness"), f(2, "coverage_amount", "4100", "$4,100 $82.41"), f(2, "premium_minimum", "82.41", "$4,100 $82.41"), f(2, "premium_frequency", "monthly", "Monthly premium"),
  f(2, "waiting_days", "30 days", "Waiting period of 30 days"), f(2, "benefit_period", "2 years", "benefit period of 2 years"), f(2, "occupation", "regular occupation 2 years", "regular occupation 2 years"), f(2, "benefit_kind", "income", "Disability insurance"),
  f(3, "product", "Acci-Jet overhead expense, accident or soft tissue injury", "Overhead expense insurance in the event of an accident"), f(3, "coverage_amount", "2000", "Waiting period of 30 days $2,000 $10.40"), f(3, "premium_minimum", "10.40", "$2,000 $10.40"), f(3, "premium_frequency", "monthly", "Monthly premium"),
  f(3, "waiting_days", "30", "Waiting period of 30 days"), f(3, "benefit_kind", "overhead", "Overhead expense insurance"), f(3, "notes", "Policy fee $2.50 and extended medical care $2.50 a month are separate.", "Policy fee $2.50"),
];
const CI = [
  f(1, "carrier", "iA Financial Group", "iA Financial Group"), f(1, "product", "Term Critical Illness, Transition (25 illnesses), to age 75", "Transition (25 illnesses) - T75"), f(1, "policy_type", "critical_illness", "Critical Illness Insurance"), f(1, "insured_name", "CLIENT 1", "CLIENT 1 - Male"),
  f(1, "coverage_amount", "100000", "$100,000.00 $104.13"), f(1, "premium_minimum", "104.13", "Total monthly premium $104.13"), f(1, "premium_frequency", "monthly", "Total monthly premium"), f(1, "guarantees", "25 illnesses; Prevention + benefit of 15% of cover up to $50,000", "Prevention + benefit, equal to 15%"),
  f(1, "notes", "Policy fee $5.40 a month is extra.", "Policy fees   $5.40"),
];

describe("comparing disability quotes", () => {
  it("compares per $100 of monthly benefit, and everything else per $1,000", () => {
    expect(unitFor("disability")).toBe(100);
    expect(unitFor("critical_illness")).toBe(1000);
    expect(costPerUnit(q({}))).toBeCloseTo((82.41 * 12) / 41, 5);
    expect(costPerUnit(q({ policy_type: "critical_illness", coverage_amount: 100000, premium_amount: 104.13 }))).toBeCloseTo((104.13 * 12) / 100, 5);
  });
  it("marks the cheapest of two disability options by cost per $100 of benefit, not by premium", () => {
    const rows = compare([q({ id: "a", premium_amount: 82.41, coverage_amount: 4100 }), q({ id: "b", product: "Other", premium_amount: 60, coverage_amount: 2000 })]);
    expect(rows.find((r) => r.quote.id === "a")?.cheapest).toBe(true);
    expect(rows[0].unit).toBe(100);
  });
  it("keeps business overhead cover apart from income cover", () => {
    expect(groupKey(q({}))).toBe("disability");
    expect(groupKey(q({ benefit_kind: "income" }))).toBe("disability");
    expect(groupKey(q({ benefit_kind: "overhead" }))).toBe("disability:overhead");
    expect(groupKey(q({ policy_type: "term", benefit_kind: "overhead" }))).toBe("term");
    expect(groupLabel("disability:overhead")).toContain("BOE");
  });
  it("words the alternatives as a monthly benefit", () => { expect(alternativesText([q({ status: "recommended", reason: "it is the cheapest" }), q({ id: "2", carrier: "Other", product: "Plan B" })])).toContain("for $4,100 a month"); });
  it("is computed the same way on the server", () => {
    expect(sUnitFor("disability")).toBe(100);
    for (const o of [{}, { coverage_amount: 2000, premium_amount: 10.4 }, { policy_type: "term", coverage_amount: 500000, premium_amount: 50 }, { premium_frequency: "single" }]) expect(sCostPerUnit(q(o) as QuoteRow)).toBe(costPerUnit(q(o)));
  });
});

describe("the comparison report", () => {
  it("states the monthly benefit, waiting period, benefit period and cost per $100", () => {
    const rows = [q({ waiting_days: 30, benefit_period: "2 years", occupation: "regular occupation 2 years", status: "recommended", reason: "best terms" }) as QuoteRow];
    const text = JSON.stringify(quoteBlocks({ person: "Doreen", typeLabel: "Disability", quotes: rows, needLine: null, preparedOn: "2026-10-23" }));
    expect(text).toContain("Monthly benefit: $4,100, 30-day waiting period, benefits for 2 years, regular occupation 2 years");
    expect(text).toContain("Cost per $100 of monthly benefit");
  });
  it("ties each kind to its own needs analysis", () => {
    expect(needLineFor("disability", false, { target: 7000, gap: 3500 }, "2026-10-23")).toContain("$3,500");
    expect(needLineFor("disability", true, { boe: { need: 8000, gap: 6000 } }, "2026-10-23")).toContain("fixed business expenses of $8,000 a month");
    expect(needLineFor("disability", true, { boe: null }, "2026-10-23")).toContain("no business overhead need");
    expect(needLineFor("critical_illness", false, { need: 145000, shortfall: 95000 }, "2026-10-23")).toContain("$95,000");
    expect(needLineFor("dime", false, { need: 800000, shortfall: 0 }, "2026-10-23")).toContain("life insurance need of $800,000");
  });
});

describe("reading a disability illustration", () => {
  const drafts = draftsFromIllustration(DISABILITY, "Doreen Example", "https://drive/x");
  it("gives one form per coverage, with the shared facts on each", () => {
    expect(drafts).toHaveLength(3);
    expect(drafts.map((d) => d.draft.product)).toEqual(["Acci-Jet disability, accident or soft tissue injury", "Acci-Jet disability, illness", "Acci-Jet overhead expense, accident or soft tissue injury"]);
    for (const d of drafts) expect(d.draft).toMatchObject({ carrier: "iA Financial Group", policy_type: "disability", quote_date: "2026-10-23", premium_frequency: "monthly" });
  });
  it("takes the monthly benefit, waiting period, benefit period and occupation, and sorts BOE from income", () => {
    expect(drafts[1].draft).toMatchObject({ coverage_amount: "4100", premium_amount: "82.41", waiting_days: "30", benefit_period: "2 years", occupation: "regular occupation 2 years", benefit_kind: "income" });
    expect(drafts[0].draft.waiting_days).toBe("0");
    expect(drafts[2].draft).toMatchObject({ coverage_amount: "2000", premium_amount: "10.4", benefit_kind: "overhead" });
    expect(drafts[0].draft.riders).toContain("return of premiums");
    expect(drafts[2].draft.notes).toContain("Policy fee");
  });
  it("keeps the quote behind each field and has no warnings for a complete coverage", () => {
    expect(drafts[1].sources.waiting_days).toBe("Waiting period of 30 days");
    expect(drafts[1].warnings).toEqual([]);
  });
  it("warns when the waiting period or benefit period is missing, and when it is for someone else", () => {
    const w = draftsFromIllustration(DISABILITY.filter((x) => !(x.coverage === 3 && ["waiting_days"].includes(x.key))).filter((x) => x.coverage === 3 || x.coverage === 0), "Someone Else", "u")[0].warnings.join(" ");
    expect(w).toContain("waiting period");
    expect(w).toContain("benefit period");
    expect(w).toContain("is for Doreen Example");
  });
});

describe("reading a critical illness illustration", () => {
  const [d] = draftsFromIllustration(CI, "Client 1", "https://drive/y");
  it("reads the lump sum, base premium without the policy fee, and the conditions covered", () => {
    expect(d.draft).toMatchObject({ policy_type: "critical_illness", coverage_amount: "100000", premium_amount: "104.13", benefit_kind: "", waiting_days: "" });
    expect(d.draft.guarantees).toContain("25 illnesses");
    expect(d.draft.notes).toContain("$5.40");
  });
  it("still reads a single-coverage illustration with no coverage numbers as one form", () => {
    expect(draftsFromIllustration(CI.map(({ key, value, quote }) => ({ key, value, quote })), "Client 1", "u")).toHaveLength(1);
  });
  it("tells the model about disability, critical illness and several coverages", () => {
    expect(ILLUSTRATION_PROMPT).toContain("MONTHLY benefit");
    expect(ILLUSTRATION_PROMPT).toContain("overhead");
    expect(ILLUSTRATION_PROMPT).toContain("coverage 0");
  });
});

describe("wiring", () => {
  it("lets a person have one recommended quote of each kind, and stores the disability fields", () => {
    const m = readFileSync("supabase/migrations/20261227120000_quotes_disability_fields.sql", "utf8");
    for (const c of ["benefit_kind", "waiting_days", "benefit_period", "occupation", "COALESCE(benefit_kind, 'income')"]) expect(m).toContain(c);
  });
  it("lets the life needs readers see only life (DIME) analyses", () => {
    expect(readFileSync("src/modules/crm/components/NeedsAnalysis.tsx", "utf8")).toContain('.eq("method", "dime")');
    expect(readFileSync("supabase/functions/_shared/insurance-doc-service.ts", "utf8")).toContain('.eq("method", "dime").in("contact_id"');
    expect(readFileSync("supabase/functions/_shared/quote-service.ts", "utf8")).toContain('.eq("method", method)');
  });
  it("shows each coverage read from one illustration one after another", () => {
    const ui = readFileSync("src/modules/insurance/QuotingWorkspace.tsx", "utf8");
    expect(ui).toContain("Skip this coverage");
    expect(ui).toContain("r.drafts");
  });
});
