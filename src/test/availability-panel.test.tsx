import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AvailabilityPanel } from "@/modules/audit/components/stage2/AvailabilityPanel";

const page2 = [
  { name: "Fixed Income Managed Portfolio", category: "Income Funds", value: 23.52 },
  { name: "Dividend Growth", category: "Canadian Equity funds", value: 3_430.94 },
  { name: "Global Opportunities", category: "U.S. & International Equity Funds", value: 45_193.72 },
];
const account = { account_name: "iA Financial - Non-registered", account_number: "1819479981", book_value: 51_295.72, current_value: 53_143.02 };

describe("AvailabilityPanel", () => {
  it("shows surplus, income funds and the lesser of the two, with the limiting reason", () => {
    const rest = { name: "Other", category: "Balanced Funds", value: 4_494.84 };
    render(<AvailabilityPanel items={[{ ...account, funds: [...page2, rest] }]} />);
    const panel = screen.getByLabelText("Available for withdrawal this year");
    expect(within(panel).getByText("$1,847.30")).toBeTruthy();                 // surplus
    expect(within(panel).getAllByText("$23.52").length).toBeGreaterThanOrEqual(2); // income funds + available
    expect(within(panel).getByText("Limited by income funds")).toBeTruthy();
    expect(within(panel).queryByText("Unconfirmed")).toBeNull();
  });
  it("flags an unconfirmed result when the funds don't add up to the statement value", () => {
    render(<AvailabilityPanel items={[{ ...account, funds: page2 }]} />);
    expect(screen.getByText("Unconfirmed")).toBeTruthy();
    expect(screen.getByText(/not accounted for/)).toBeTruthy();
  });
  it("shows 'Not enough data' and no availability when no funds were extracted", () => {
    render(<AvailabilityPanel items={[{ ...account, funds: null }]} />);
    expect(screen.getByText("Not enough data")).toBeTruthy();
    expect(screen.getByText(/No fund holdings were extracted/)).toBeTruthy();
  });
  it("renders nothing for an item with no figures at all", () => {
    const { container } = render(<AvailabilityPanel items={[{ account_name: "empty" }]} />);
    expect(container.firstChild).toBeNull();
  });
});
