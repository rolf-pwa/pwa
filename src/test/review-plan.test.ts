import { describe, expect, it } from "vitest";
import { phaseOf, planFromCards } from "../../supabase/functions/_shared/review-plan";

describe("phaseOf", () => {
  it("money moves and structure are Days 31-60", () => {
    for (const a of ["Rebalance $71,024 from the Liquidity Reserve to the Vineyard.", "Receive $71,024 from the Liquidity Reserve.", "Move $5,000 from the Vineyard to top up the Strategic Reserve.", "Add $10,000 to reach the $100,000 target.", "Put a Unanimous Shareholder Agreement in place."]) expect(phaseOf(a)).toBe(2);
  });
  it("records, documents and scans are Days 1-30", () => {
    for (const a of ["Locate or draft Colleen's Power of Attorney.", "Record the beneficiary on 1 policy.", "Run a Vault scan to read 2 more statements.", "File the insurance documents in the Vault.", "Review 1 policy renewal due within 90 days."]) expect(phaseOf(a)).toBe(1);
  });
  it("ratifying the Charter is Days 61-90", () => {
    expect(phaseOf("Draft and ratify the Charter.")).toBe(3);
    expect(phaseOf("Ratify the Charter.")).toBe(3);
  });
});

describe("planFromCards", () => {
  const cards = [
    { label: "Liquidity Reserve", actions: ["Rebalance $71,024 from the Liquidity Reserve to the Vineyard."] },
    { label: "Vineyard", actions: ["Receive $71,024 from the Liquidity Reserve.", "Run a Vault scan to read 1 more statement."] },
    { label: "Legacy Trust", actions: ["Locate or draft Colleen's Power of Attorney."] },
    { label: "Philanthropic Trust", actions: ["No action required."] },
    { label: "Charter", actions: [] },
  ];
  it("turns each action into one plan item titled by its area, in the right phase", () => {
    const p = planFromCards(cards);
    expect(p.phase_1).toEqual([
      { title: "Vineyard", detail: "Run a Vault scan to read 1 more statement." },
      { title: "Legacy Trust", detail: "Locate or draft Colleen's Power of Attorney." },
    ]);
    expect(p.phase_2.map((i) => i.title)).toEqual(["Liquidity Reserve", "Vineyard"]);
  });
  it("skips 'No action required' and always ends with the review cadence", () => {
    const p = planFromCards(cards);
    expect([...p.phase_1, ...p.phase_2, ...p.phase_3].some((i) => /no action/i.test(i.detail))).toBe(false);
    expect(p.phase_3.at(-1)?.title).toBe("Next quarterly review");
    expect(planFromCards([], "survey").phase_3).toEqual([{ title: "Review cadence", detail: expect.stringContaining("ratified") }]);
  });
  it("updates when an action is edited (the same function the page calls)", () => {
    const edited = cards.map((c) => (c.label === "Liquidity Reserve" ? { ...c, actions: ["Rebalance $50,000 from the Liquidity Reserve to the Vineyard."] } : c));
    expect(planFromCards(edited).phase_2[0].detail).toContain("$50,000");
  });
});
