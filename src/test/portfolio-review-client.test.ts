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

  it("holds the switches that bring accounts to the model (needed ones and in-range top-ups) and the death benefit resets, each with an id", () => {
    const p = buildClientProposal(pack())!;
    expect(p.switches.map((s) => [s.id, s.amount, s.toModel])).toEqual([["switch:a", 6_000, false], ["switch:b", 3_200, true]]);
    expect(p.resets.map((r) => [r.id, r.lift])).toEqual([["reset:a", 10_000]]);
    expect(p).toMatchObject({ totalLift: 10_000, totalNow: 90_000, totalAfter: 100_000 });
    expect(proposalItems(p).map((i) => i.id)).toEqual(["switch:a", "switch:b", "reset:a"]);
  });
  it("is null when there is nothing to propose", () => {
    const none = buildPortfolioPack({ accounts: [acct({ guarantee: null, statement: { statementDate: "2026-09-30", funds: inc(40, 60) } })], profiles: prof, today: "2026-10-14", models: [balanced] });
    expect(buildClientProposal(none)).toBeNull();
  });
  it("brings an account that is inside its range but off the model back to the model, and skips a trivial switch", () => {
    const off = buildPortfolioPack({ accounts: [acct({ guarantee: null, value: 24_912, statement: { statementDate: "2026-09-30", funds: inc(42, 58) } })], profiles: prof, today: "2026-10-14", models: [balanced] });
    const p = buildClientProposal(off)!;
    expect(p.switches).toHaveLength(1);
    expect(p.switches[0]).toMatchObject({ direction: "to_equity", toModel: true });
    const tiny = buildPortfolioPack({ accounts: [acct({ guarantee: null, value: 4_000, statement: { statementDate: "2026-09-30", funds: inc(41, 59) } })], profiles: prof, today: "2026-10-14", models: [balanced] });
    expect(buildClientProposal(tiny)).toBeNull(); // $40: under $100 once rounded
  });
  it("is authorized as a whole: every item ticked, and nothing that is not in it", () => {
    const p = buildClientProposal(pack())!;
    expect(checkAllAcknowledged(p, ["switch:a", "switch:b", "reset:a"]).ok).toBe(true);
    expect(checkAllAcknowledged(p, ["switch:a"])).toEqual({ ok: false, error: "Tick every change you have reviewed before authorizing, or ask to talk it through." });
    expect(checkAllAcknowledged(p, ["switch:a", "switch:b", "reset:a", "switch:zzz"])).toEqual({ ok: false, error: "That item is not part of this rebalancing." });
    expect(checkAllAcknowledged(null, []).ok).toBe(true);
  });
  it("describes each item for Rolf's task", () => {
    const items = proposalItems(buildClientProposal(pack())!);
    expect(describeProposalItem(items[0])).toMatch(/TFSA …1111 \(Doreen\): switch about \$6,000 from equity into income funds/);
    expect(describeProposalItem(items[2])).toMatch(/reset the death benefit guarantee from \$90,000 to about \$100,000/);
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

import { rebalanceTaskPlan } from "../../supabase/functions/_shared/portfolio-review-client";
describe("Rolf's task to carry out an authorized rebalancing", () => {
  const items = proposalItems({
    switches: [{ id: "switch:a", label: "TFSA …3190", owner: "Albert Parent", direction: "to_income", amount: 9_400, exactAmount: 9_366, taxable: false }, { id: "switch:b", label: "Non-registered …6067", owner: "Albert Parent", direction: "to_income", amount: 7_500, exactAmount: 7_512, taxable: true }],
    resets: [{ id: "reset:a", label: "TFSA …3190", owner: "Albert Parent", currentGuarantee: 136_018, newGuarantee: 145_261, lift: 9_243 }], totalLift: 9_243, totalNow: 136_018, totalAfter: 145_261, hasTaxable: true });
  const plan = rebalanceTaskPlan(items, { clientName: "Albert Parent", label: "Q3 2027", today: "2027-08-12", packUrl: "https://app.prosperwise.ca/households/h1/portfolio-review" });

  it("links the pack, and groups each account's switch and reset together with the exact figures", () => {
    expect(plan.description).toContain("Exactly what they authorized, by whom and when: https://app.prosperwise.ca/households/h1/portfolio-review");
    expect(plan.description).toMatch(/TFSA …3190 \(Albert\)\n  - Switch \$9,366 from equity into income funds\n  - Reset the death benefit guarantee from \$136,018 to \$145,261 \(up \$9,243\)/);
    expect(plan.description).toMatch(/Non-registered …6067 \(Albert\)  \[TAXABLE: check the gain first\]\n  - Switch \$7,512/);
    expect(plan.description).not.toContain("$9,400");
    expect(plan.description).toContain("check off each subtask");
  });
  it("makes one subtask per authorized item, with the taxable caution where it applies", () => {
    expect(plan.subtasks.map((s) => s.title)).toEqual([
      "TFSA …3190 (Albert): switch $9,366 from equity into income funds",
      "Non-registered …6067 (Albert): switch $7,512 from equity into income funds",
      "TFSA …3190 (Albert): reset the death benefit guarantee from $136,018 to $145,261 (up $9,243)",
    ]);
    expect(plan.subtasks[1].description).toMatch(/Taxable account/);
    expect(plan.subtasks[0].description).toMatch(/Check this off/);
  });
  it("falls back to the rounded amount for a proposal frozen before the exact figures were kept", () => {
    const old = proposalItems({ switches: [{ id: "switch:z", label: "TFSA", owner: null, direction: "to_equity", amount: 2_000, taxable: false }], resets: [], totalLift: 0, totalNow: 0, totalAfter: 0, hasTaxable: false });
    expect(rebalanceTaskPlan(old, { clientName: "A", label: "Q3", today: "2027-01-01", packUrl: null }).subtasks[0].title).toBe("TFSA: switch $2,000 from income into equity funds");
  });
});

import { checkOwnAcknowledged, proposalFullyAuthorized, type ClientProposal } from "../../supabase/functions/_shared/portfolio-review-client";
describe("each account holder authorizes their own changes", () => {
  const p: ClientProposal = {
    switches: [
      { id: "switch:a", label: "TFSA …1111", owner: "Albert", ownerId: "alb", direction: "to_income", amount: 6000, taxable: false },
      { id: "switch:b", label: "RRSP …2222", owner: "Doreen", ownerId: "dor", direction: "to_equity", amount: 3000, taxable: false },
    ],
    resets: [{ id: "reset:b", label: "RRSP …2222", owner: "Doreen", ownerId: "dor", currentGuarantee: 90_000, newGuarantee: 100_000, lift: 10_000 }],
    totalLift: 10_000, totalNow: 90_000, totalAfter: 100_000, hasTaxable: false,
  };
  it("lets a person authorize only their own items, all of them", () => {
    const ok = checkOwnAcknowledged(p, "alb", [], ["switch:a"]);
    expect(ok.ok && ok.items.map((i) => i.id)).toEqual(["switch:a"]);
    expect(checkOwnAcknowledged(p, "dor", [], ["switch:b"]).ok).toBe(false);
    expect(checkOwnAcknowledged(p, "dor", [], ["switch:b", "reset:b"]).ok).toBe(true);
  });
  it("refuses someone else's items, double authorization and strangers", () => {
    expect(checkOwnAcknowledged(p, "alb", [], ["switch:a", "switch:b"])).toMatchObject({ ok: false, error: expect.stringMatching(/own accounts/) });
    expect(checkOwnAcknowledged(p, "alb", ["switch:a"], ["switch:a"])).toMatchObject({ ok: false, error: expect.stringMatching(/already authorized/) });
    expect(checkOwnAcknowledged(p, "nobody", [], [])).toMatchObject({ ok: false });
  });
  it("is fully authorized only when every owner has authorized", () => {
    expect(proposalFullyAuthorized(p, ["switch:a"])).toBe(false);
    expect(proposalFullyAuthorized(p, ["switch:a", "switch:b", "reset:b"])).toBe(true);
  });
});

import { suggestedRebalanceNote } from "../../supabase/functions/_shared/portfolio-review-client";
describe("the suggested rebalancing note", () => {
  const sw = (over: object) => ({ id: "switch:a", label: "Non-reg …7017", owner: "Annette Isbester", direction: "to_income" as const, amount: 6000, taxable: true, estGain: 2_340, ...over });
  const prop = (switches: any[]): ClientProposal => ({ switches, resets: [], totalLift: 0, totalNow: 0, totalAfter: 0, hasTaxable: true });
  it("states the estimated gain for each taxable switch, for Rolf to edit", () => {
    const n = suggestedRebalanceNote(prop([sw({})]));
    expect(n).toContain("Non-reg …7017 (Annette): an estimated capital gain of about $2,300");
    expect(n).toMatch(/I will go over this with you/);
  });
  it("says loss when negative, and is empty with nothing taxable", () => {
    expect(suggestedRebalanceNote(prop([sw({ estGain: -800 })]))).toContain("an estimated loss of about $800");
    expect(suggestedRebalanceNote(prop([sw({ taxable: false, estGain: null })]))).toBe("");
    expect(suggestedRebalanceNote(null)).toBe("");
  });
});

import { normalizeFundName } from "../../supabase/functions/_shared/portfolio-review";
describe("accounts on different profiles", () => {
  const growth: ModelPortfolio = { asOf: "2026-05-31", key: "growth", label: "Growth", incomeMin: 15, incomeMax: 35, equityMin: 65, equityMax: 85, incomeTarget: 25, funds: [{ name: "Fixed income managed portfolio (iA)", weight: 25 }, { name: "Fidelity Insights", weight: 75 }] };
  const aggressive: ModelPortfolio = { asOf: "2026-05-31", key: "aggressive", label: "Aggressive", incomeMin: 0, incomeMax: 10, equityMin: 90, equityMax: 100, incomeTarget: 0, funds: [{ name: "Fidelity Insights", weight: 100 }] };
  const fundsOf = (income: number, equity: number) => [{ name: "46035-F-Fixed Income Managed Portfolio (iA)", category: "Income Funds", value: income * 1000 }, { name: "41068-F-Fidelity Insights", category: "U.S. & International Equity Funds", value: equity * 1000 }];
  const mixed = () => buildPortfolioPack({
    accounts: [
      acct({ id: "g", number: "1111", name: "iA RRSP", value: 100_000, guarantee: null, statement: { statementDate: "2026-08-10", funds: fundsOf(25, 75) } }),
      acct({ id: "a", number: "2222", name: "iA TFSA", value: 50_000, guarantee: null, statement: { statementDate: "2026-08-10", funds: fundsOf(5, 45) } }),
    ],
    profiles: [{ accountNumber: "1111", label: null, incomePct: 25, equityPct: 75, bandPct: 0, profileKey: "growth" }, { accountNumber: "2222", label: null, incomePct: 0, equityPct: 100, bandPct: 0, profileKey: "aggressive" }],
    today: "2026-10-16", models: [growth, aggressive],
  });

  it("strips the F-series code so those funds match the model", () => {
    expect(normalizeFundName("41068-F-Fidelity Insights")).toBe(normalizeFundName("Fidelity Insights"));
    expect(normalizeFundName("46035-FEL-Fixed Income Managed Portfolio (iA)")).toBe(normalizeFundName("Fixed income managed portfolio (iA)"));
    expect(normalizeFundName("40193-NSC-Global Opportunities (Loomis Sayles)")).toBe(normalizeFundName("Global Opportunities (Loomis Sayles)"));
  });
  it("has no single household target, and one funds comparison per model", () => {
    const p = mixed();
    expect(p.household.drift.status).toBe("by_account");
    expect(p.household.modelComparison).toBeNull();
    expect(p.household.modelComparisons.map((m) => m.modelLabel).sort()).toEqual(["Aggressive", "Growth"]);
    expect(p.household.modelComparisons.find((m) => m.modelLabel === "Growth")!.offModelPct).toBe(0); // F-series funds are the model's funds
  });
  it("tells the client each account is measured against its own profile, with a funds set per model", () => {
    const v = buildClientView(mixed(), ALL_INCLUDED, "n", "Smith", "review");
    expect(v.mix!.commentary[0]).toMatch(/different risk profiles.*2 of your 2 accounts are inside/);
    expect(v.mix!.commentary.join(" ")).not.toMatch(/profile profile|target of/);
    expect(v.mix!.targetIncomePct).toBeNull(); // no single household target
    expect(v.funds).toBeNull();
    expect(v.fundsSets!.map((f) => f.modelLabel).sort()).toEqual(["Aggressive", "Growth"]);
    expect(v.fundsSets!.find((f) => f.modelLabel === "Growth")!.accounts).toEqual(["iA RRSP …1111"]);
  });
});
