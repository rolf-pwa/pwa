import { describe, expect, it } from "vitest";
import { emptyYear, equity, incomeUse, netRentalIncome, ownerShares, ownershipTotal, totalExpenses } from "@/modules/crm/lib/rentalProperty";

describe("rental property maths", () => {
  const y = { ...emptyYear(), rent_collected: 36000, property_tax: 4200, insurance: 1500, repairs_maintenance: 2800, management_fees: 2880, mortgage_interest: 9000 };
  it("nets rent against every expense, and a loss stays negative", () => {
    expect(totalExpenses(y)).toBe(20380);
    expect(netRentalIncome(y)).toBe(15620);
    expect(netRentalIncome({ ...emptyYear(), property_tax: 3000 })).toBe(-3000);
  });
  it("splits income by ownership percentage and reports a partial holding as given", () => {
    const owners = [{ contact_id: "a", ownership_pct: 60 }, { contact_id: "b", ownership_pct: 40 }];
    expect(ownerShares(15620, owners)).toEqual([{ contact_id: "a", amount: 9372 }, { contact_id: "b", amount: 6248 }]);
    expect(ownershipTotal(owners)).toBe(100);
    expect(ownershipTotal([{ contact_id: "a", ownership_pct: 50 }])).toBe(50);
  });
  it("works out equity with or without a mortgage and a value", () => {
    expect(equity(652500, 300000)).toBe(352500);
    expect(equity(652500, null)).toBe(652500);
    expect(equity(null, 1)).toBeNull();
  });
  it("sends net income to the household or to a linked loan, never paying out a loss", () => {
    expect(incomeUse(15620, "household", false)).toEqual({ toHousehold: 15620, toPaydown: 0 });
    expect(incomeUse(15620, "debt_paydown", true)).toEqual({ toHousehold: 0, toPaydown: 15620 });
    expect(incomeUse(15620, "debt_paydown", false)).toEqual({ toHousehold: 15620, toPaydown: 0 });
    expect(incomeUse(-500, "debt_paydown", true)).toEqual({ toHousehold: 0, toPaydown: 0 });
  });
});
