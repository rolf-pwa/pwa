import { describe, it, expect } from "vitest";
import { buildPortfolioPack, type ModelPortfolio, type PackAccount } from "../../supabase/functions/_shared/portfolio-review";
import { buildClientView, portfolioReviewReadyEmail, shortAccountName, ALL_INCLUDED } from "../../supabase/functions/_shared/portfolio-review-client";

const balanced: ModelPortfolio = { asOf: "2026-05-31", key: "balanced", label: "Balanced", incomeMin: 35, incomeMax: 55, equityMin: 45, equityMax: 65, incomeTarget: 40, funds: [{ name: "Fixed income managed portfolio (iA)", weight: 40 }, { name: "Fidelity Insights", weight: 60 }] };
const acct = (over: Partial<PackAccount> = {}): PackAccount => ({
  id: "a1", name: "iA RRSP", number: "1818710719", type: "RRSP", custodian: "iA Financial Group", owner: "Doreen", value: 100_000, boyValue: 90_000, asOf: "2026-09-30",
  returns: { ytd: 8, sixMonth: null, oneYear: 9, threeYear: 11, fiveYear: null, sinceInception: null }, priorValue: 98_000, priorAsOf: "2026-08-31",
  statement: { statementDate: "2026-09-30", funds: [{ name: "3603H-NSC-Fixed Income Managed Portfolio (iA)", category: "Income Funds", value: 34_000 }, { name: "3233H-NSC-Thematic Innovation (iA)", category: "U.S. & International Equity Funds", value: 66_000 }] },
  guarantee: { series: "Series 75/100", maturityDate: "2046-12-31", guaranteedAtMaturity: 1, guaranteedAtDeath: 92_000, lastQuarterFee: 1, valueOfFunds: 100_000 }, ownerDob: "1946-03-01", ...over,
});
const pack = () => buildPortfolioPack({ accounts: [acct()], profiles: [{ accountNumber: null, label: null, incomePct: 40, equityPct: 60, bandPct: 0, profileKey: "balanced" }], today: "2026-10-14", models: [balanced] });

describe("the client's Portfolio Review", () => {
  it("is built from the pack with plain figures, the note and the disclosures", () => {
    const v = buildClientView(pack(), ALL_INCLUDED, "  Good year.  ", "Parent Household");
    expect(v.note).toBe("Good year.");
    expect(v.summary.value).toBe(100_000);
    expect(v.accounts![0]).toMatchObject({ name: "iA RRSP", label: "iA RRSP …0719", last4: "0719", ytdPct: 8, oneYearPct: 9, threeYearPct: 11 });
    expect(v.mix!.classes.map((c) => c.key)).toEqual(["income", "global"]);
    expect(shortAccountName("iA Financial Group - IAG Savings and Retirement Plan - RRIF", "1818710719")).toBe("RRIF …0719");
    expect(v.mix).toMatchObject({ profileLabel: "Balanced", status: "below", rangeMin: 35, rangeMax: 55 });
    expect(v.reset!.rows[0]).toMatchObject({ currentGuarantee: 92_000, newGuarantee: 100_000, lift: 8_000 });
    expect(v.reset).toMatchObject({ totalNow: 92_000, totalAfter: 100_000, totalLift: 8_000 });
    expect(v.disclosures.length).toBeGreaterThan(1);
  });
  it("shows how much is in the model's funds, without staff language", () => {
    const v = buildClientView(pack(), ALL_INCLUDED, "", "H");
    expect(v.funds!.heldInModelPct).toBe(34);
    expect(v.funds!.rows.find((r) => !r.inModel)!.name).toBe("Thematic Innovation (iA)");
  });
  it("leaves out any section Rolf did not include", () => {
    const v = buildClientView(pack(), { returns: false, mix: false, funds: false, reset: false, rebalancing: false }, "", "H");
    expect([v.accounts, v.mix, v.funds, v.reset, v.rebalance]).toEqual([null, null, null, null, null]);
  });
  it("never includes a reset for an account that cannot be reset", () => {
    const p = buildPortfolioPack({ accounts: [acct({ ownerDob: "1930-01-01" })], profiles: [], today: "2026-10-14", models: [] });
    expect(buildClientView(p, ALL_INCLUDED, "", "H").reset).toBeNull();
  });
  it("sends a ready email that carries no figures", () => {
    const e = portfolioReviewReadyEmail("<b>x</b>", "https://app.prosperwise.ca/portal", "reply and I will make sure Rolf gets it");
    expect(e.subject).toBe("Your Portfolio Review is ready");
    expect(e.html).not.toContain("<b>x</b>");
    expect(e.html).not.toMatch(/\$\d/);
  });
});

import { mixCommentary, fundsCommentary } from "../../supabase/functions/_shared/portfolio-review-client";
import { compareToModel } from "../../supabase/functions/_shared/portfolio-review";

describe("the commentary under the charts", () => {
  const inc = (income: number, equity: number) => [{ name: "I", category: "Income Funds", value: income * 1000 }, { name: "E", category: "Canadian Equity funds", value: equity * 1000 }];
  const prof = [{ accountNumber: null, label: null, incomePct: 40, equityPct: 60, bandPct: 0, profileKey: "balanced" }];
  const mk = (accounts: PackAccount[], ytd = 5) => buildPortfolioPack({ accounts: accounts.map((a) => ({ ...a, returns: { ...a.returns, ytd } })), profiles: prof, today: "2026-10-14", models: [balanced] });

  it("says the mix is inside the profile, toward the lower end, and recommends rebalancing the accounts that drifted", () => {
    const p = mk([acct({ id: "a", number: "1111", value: 150_000, statement: { statementDate: "2026-09-30", funds: inc(36, 64) } }), acct({ id: "b", number: "2222", name: "iA TFSA", value: 100_000, statement: { statementDate: "2026-09-30", funds: inc(34, 66) } })]);
    const c = mixCommentary(p);
    expect(c[0]).toMatch(/falls within your Balanced risk profile, which holds 35–55% in income funds\. Your income allocation is toward the lower end/);
    expect(c.join(" ")).toMatch(/1 of your 2 accounts hold more in equities than your profile calls for \(iA TFSA …2222\)/);
    expect(c.join(" ")).toMatch(/Equity funds grow faster than income funds when markets rise/);
    expect(c[c.length - 1]).toMatch(/I recommend rebalancing this account back to your Balanced profile/);
  });
  it("needs no change when everything is inside, and does not blame the market in a flat year", () => {
    const p = mk([acct({ statement: { statementDate: "2026-09-30", funds: inc(45, 55) } })], 1);
    expect(mixCommentary(p).join(" ")).toMatch(/No change is needed/);
    expect(mixCommentary(p).join(" ")).not.toMatch(/markets rise/);
  });
  it("says so when the household itself is outside the range", () => {
    const p = mk([acct({ statement: { statementDate: "2026-09-30", funds: inc(30, 70) } })]);
    expect(mixCommentary(p)[0]).toMatch(/outside your Balanced risk profile: income is 30% against a range of 35–55%, so you hold more in equities/);
  });
  it("recommends rebalancing to the model when funds fall outside it, and says when they line up", () => {
    const off = compareToModel([{ name: "3603H-NSC-Fixed Income Managed Portfolio (iA)", category: "Income Funds", value: 40_000 }, { name: "3233H-NSC-Thematic Innovation (iA)", category: "U.S. & International Equity Funds", value: 60_000 }], balanced)!;
    const c = fundsCommentary(off);
    expect(c[0]).toMatch(/60% of your portfolio is held in funds outside our Balanced model portfolio, including Thematic Innovation \(iA\)/);
    expect(c[1]).toMatch(/I recommend rebalancing the portfolio to the model\. Matching it would move about \$\d/);
    const on = compareToModel([{ name: "Fixed income managed portfolio (iA)", category: "Income Funds", value: 40_000 }, { name: "Fidelity Insights", category: "U.S. & International Equity Funds", value: 60_000 }], balanced)!;
    expect(fundsCommentary(on)).toEqual(["Your funds line up closely with our Balanced model portfolio."]);
  });
});

describe("what the client sees of the rebalancing proposal", () => {
  const inc = (income: number, equity: number) => [{ name: "I", category: "Income Funds", value: income * 1000 }, { name: "E", category: "Canadian Equity funds", value: equity * 1000 }];
  const prof = [{ accountNumber: null, label: null, incomePct: 40, equityPct: 60, bandPct: 0, profileKey: "balanced" }];
  it("lists only the accounts outside their profile's range, by asset class, rounded, with a note on taxable accounts", () => {
    const p = buildPortfolioPack({ accounts: [
      acct({ id: "a", name: "iA Financial Group - SRP - TFSA", number: "1111", type: "TFSA", value: 100_000, statement: { statementDate: "2026-09-30", funds: inc(34, 66) } }),
      acct({ id: "b", name: "iA Financial Group - SRP - Non-registered", number: "2222", type: "Non-registered", value: 50_000, statement: { statementDate: "2026-09-30", funds: inc(30, 70) } }),
      acct({ id: "c", number: "3333", value: 80_000, statement: { statementDate: "2026-09-30", funds: inc(36, 64) } }),
    ], profiles: prof, today: "2026-10-14", models: [balanced] });
    const r = buildClientView(p, ALL_INCLUDED, "", "H").rebalance!;
    expect(r.rows.map((x) => [x.label, x.direction, x.amount])).toEqual([["TFSA …1111", "to_income", 6_000], ["Non-registered …2222", "to_income", 5_000]]);
    expect(r.hasTaxable).toBe(true);
  });
  it("is left out when nothing is outside the range", () => {
    const p = buildPortfolioPack({ accounts: [acct({ statement: { statementDate: "2026-09-30", funds: inc(42, 58) } })], profiles: prof, today: "2026-10-14", models: [balanced] });
    expect(buildClientView(p, ALL_INCLUDED, "", "H").rebalance).toBeNull();
  });
});

import { buildClientProposal, checkAllAcknowledged, describeProposalItem, proposalItems } from "../../supabase/functions/_shared/portfolio-review-client";
describe("the Tier 1 rebalancing proposal", () => {
  const inc = (income: number, equity: number) => [{ name: "I", category: "Income Funds", value: income * 1000 }, { name: "E", category: "Canadian Equity funds", value: equity * 1000 }];
  const prof = [{ accountNumber: null, label: null, incomePct: 40, equityPct: 60, bandPct: 0, profileKey: "balanced" }];
  const gtee = { series: "Series 75/100", maturityDate: null, guaranteedAtMaturity: 1, guaranteedAtDeath: 90_000, lastQuarterFee: 1, valueOfFunds: 100_000 };
  const pack = () => buildPortfolioPack({ accounts: [
    acct({ id: "a", name: "iA Financial Group - SRP - TFSA", number: "1111", type: "TFSA", value: 100_000, ownerDob: "1955-06-01", guarantee: gtee, statement: { statementDate: "2026-09-30", funds: inc(34, 66) } }),
    acct({ id: "b", number: "2222", value: 80_000, statement: { statementDate: "2026-09-30", funds: inc(36, 64) } }),
  ], profiles: prof, today: "2026-10-14", models: [balanced] });

  it("holds the switches for accounts outside the range and the death benefit resets, each with an id", () => {
    const p = buildClientProposal(pack())!;
    expect(p.switches.map((s) => [s.id, s.amount])).toEqual([["switch:a", 6_000]]);
    expect(p.resets.map((r) => [r.id, r.lift])).toEqual([["reset:a", 10_000]]);
    expect(p).toMatchObject({ totalLift: 10_000, totalNow: 90_000, totalAfter: 100_000 });
    expect(proposalItems(p).map((i) => i.id)).toEqual(["switch:a", "reset:a"]);
  });
  it("is null when there is nothing to propose", () => {
    const none = buildPortfolioPack({ accounts: [acct({ guarantee: null, statement: { statementDate: "2026-09-30", funds: inc(42, 58) } })], profiles: prof, today: "2026-10-14", models: [balanced] });
    expect(buildClientProposal(none)).toBeNull();
  });
  it("is authorized as a whole: every item ticked, and nothing that is not in it", () => {
    const p = buildClientProposal(pack())!;
    expect(checkAllAcknowledged(p, ["switch:a", "reset:a"]).ok).toBe(true);
    expect(checkAllAcknowledged(p, ["switch:a"])).toEqual({ ok: false, error: "Tick every change you have reviewed before authorizing, or ask to talk it through." });
    expect(checkAllAcknowledged(p, ["switch:a", "reset:a", "switch:zzz"])).toEqual({ ok: false, error: "That item is not part of this rebalancing." });
    expect(checkAllAcknowledged(null, []).ok).toBe(true);
  });
  it("describes each item for Rolf's task", () => {
    const items = proposalItems(buildClientProposal(pack())!);
    expect(describeProposalItem(items[0])).toMatch(/TFSA …1111 \(Doreen\): switch about \$6,000 from equity into income funds/);
    expect(describeProposalItem(items[1])).toMatch(/reset the death benefit guarantee from \$90,000 to about \$100,000/);
  });
});

describe("the rebalance: the same page as the review, three sections", () => {
  const inc = (income: number, equity: number) => [{ name: "I", category: "Income Funds", value: income * 1000 }, { name: "E", category: "Canadian Equity funds", value: equity * 1000 }];
  const prof = [{ accountNumber: null, label: null, incomePct: 40, equityPct: 60, bandPct: 0, profileKey: "balanced" }];
  const gtee = { series: "Series 75/100", maturityDate: null, guaranteedAtMaturity: 1, guaranteedAtDeath: 90_000, lastQuarterFee: 1, valueOfFunds: 100_000 };
  const pk = () => buildPortfolioPack({ accounts: [acct({ id: "a", number: "1111", type: "TFSA", value: 100_000, ownerDob: "1955-06-01", guarantee: gtee, statement: { statementDate: "2026-09-30", funds: inc(34, 66) } })], profiles: prof, today: "2026-10-14", models: [balanced] });

  it("shows only the funds against the model, the death benefit reset and the proposal, whatever else is asked for", () => {
    const v = buildClientView(pk(), ALL_INCLUDED, "Moving back to the Balanced mix.", "H", "rebalance");
    expect(v.kind).toBe("rebalance");
    expect([v.accounts, v.mix]).toEqual([null, null]);
    expect(v.funds).not.toBeNull();
    expect(v.proposal!.resets.length).toBe(1);
    expect(v.proposal!.switches.map((s) => s.id)).toEqual(["switch:a"]);
    expect(v.rebalance).toBeNull();
  });
  it("lets the three sections be switched off one by one", () => {
    const v = buildClientView(pk(), { ...ALL_INCLUDED, funds: false, reset: false }, "x", "H", "rebalance");
    expect([v.funds, v.reset]).toEqual([null, null]);
    expect(v.proposal).not.toBeNull();
  });
  it("leaves the Portfolio Review as it was: everything on offer, the proposal for discussion only", () => {
    const v = buildClientView(pk(), ALL_INCLUDED, "", "H");
    expect(v.kind).toBe("review");
    expect(v.proposal).toBeNull();
    expect(v.accounts).not.toBeNull();
    expect(v.rebalance).not.toBeNull();
  });
});

import { narrativeParagraphs, MAX_NARRATIVE } from "../../supabase/functions/_shared/portfolio-review-client";
describe("the advisor's own wording for the commentary boxes", () => {
  const inc = (income: number, equity: number) => [{ name: "I", category: "Income Funds", value: income * 1000 }, { name: "E", category: "Canadian Equity funds", value: equity * 1000 }];
  const pk = () => buildPortfolioPack({ accounts: [acct({ value: 100_000, statement: { statementDate: "2026-09-30", funds: inc(34, 66) } })], profiles: [{ accountNumber: null, label: null, incomePct: 40, equityPct: 60, bandPct: 0, profileKey: "balanced" }], today: "2026-10-14", models: [balanced] });
  it("splits the text into paragraphs, and treats an empty box as the suggested wording", () => {
    expect(narrativeParagraphs("One.\n\n  Two.  \n\n\n")).toEqual(["One.", "Two."]);
    expect(narrativeParagraphs("   ")).toBeNull();
    expect(narrativeParagraphs(null)).toBeNull();
    expect(narrativeParagraphs("x".repeat(MAX_NARRATIVE + 500))![0].length).toBe(MAX_NARRATIVE);
  });
  it("uses the advisor's wording in the view, and the suggested wording otherwise", () => {
    const suggested = buildClientView(pk(), ALL_INCLUDED, "", "H");
    const edited = buildClientView(pk(), ALL_INCLUDED, "", "H", "review", { mix: "I am happy with this mix.\n\nLet's talk in March.", funds: "" });
    expect(edited.mix!.commentary).toEqual(["I am happy with this mix.", "Let's talk in March."]);
    expect(edited.funds!.commentary).toEqual(suggested.funds!.commentary);
    expect(suggested.mix!.commentary[0]).toMatch(/risk profile/);
  });
});
