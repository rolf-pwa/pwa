import { describe, it, expect } from "vitest";
import { buildPortfolioPack, type ModelPortfolio, type PackAccount } from "../../supabase/functions/_shared/portfolio-review";
import { buildClientView, portfolioReviewReadyEmail, ALL_INCLUDED } from "../../supabase/functions/_shared/portfolio-review-client";

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
    expect(v.accounts![0]).toMatchObject({ name: "iA RRSP", last4: "0719", ytdPct: 8, oneYearPct: 9, threeYearPct: 11 });
    expect(v.mix).toMatchObject({ profileLabel: "Balanced", status: "below", rangeMin: 35, rangeMax: 55 });
    expect(v.reset!.rows[0]).toMatchObject({ currentGuarantee: 92_000, newGuarantee: 100_000, lift: 8_000 });
    expect(v.disclosures.length).toBeGreaterThan(1);
  });
  it("shows how much is in the model's funds, without staff language", () => {
    const v = buildClientView(pack(), ALL_INCLUDED, "", "H");
    expect(v.funds!.heldInModelPct).toBe(34);
    expect(v.funds!.rows.find((r) => !r.inModel)!.name).toBe("Thematic Innovation (iA)");
  });
  it("leaves out any section Rolf did not include", () => {
    const v = buildClientView(pack(), { returns: false, mix: false, funds: false, reset: false }, "", "H");
    expect([v.accounts, v.mix, v.funds, v.reset]).toEqual([null, null, null, null]);
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
