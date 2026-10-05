import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WithdrawalAvailableLine } from "@/shared/components/WithdrawalAvailableLine";

describe("WithdrawalAvailableLine", () => {
  it("shows the real iA example: $23.52 available, with surplus, income funds, as-of date and the limit", () => {
    render(<WithdrawalAvailableLine bookValue={51295.72} currentValue={53143.02} incomeFundsValue={23.52} incomeFundsAsOf="2026-08-12" />);
    const el = screen.getByTestId("withdrawal-available");
    expect(el.textContent).toContain("Available to withdraw this year");
    expect(el.textContent).toContain("$23.52");
    expect(el.textContent).toContain("Surplus $1,847.30");
    expect(el.textContent).toContain("income funds $23.52 as of Aug 12, 2026");
    expect(el.textContent).toContain("limited by income funds");
  });
  it("renders nothing when income funds were never recorded (V1 accounts look exactly as before)", () => {
    const { container, rerender } = render(<WithdrawalAvailableLine bookValue={100} currentValue={150} incomeFundsValue={null} />);
    expect(container.firstChild).toBeNull();
    rerender(<WithdrawalAvailableLine bookValue={100} currentValue={150} />);
    expect(container.firstChild).toBeNull();
  });
  it("renders nothing when a value needed for the surplus is missing", () => {
    const { container } = render(<WithdrawalAvailableLine bookValue={null} currentValue={150} incomeFundsValue={20} />);
    expect(container.firstChild).toBeNull();
  });
  it("tracks the live balance: a newer current value changes the surplus and the available amount", () => {
    const { rerender } = render(<WithdrawalAvailableLine bookValue={100} currentValue={150} incomeFundsValue={500} />);
    expect(screen.getByTestId("withdrawal-available").textContent).toContain("$50.00");
    rerender(<WithdrawalAvailableLine bookValue={100} currentValue={130} incomeFundsValue={500} />);
    expect(screen.getByTestId("withdrawal-available").textContent).toContain("$30.00");
  });
  it("says there is no surplus (and shows $0.00) when current is at or below the opening value", () => {
    render(<WithdrawalAvailableLine bookValue={200} currentValue={150} incomeFundsValue={150} />);
    const el = screen.getByTestId("withdrawal-available");
    expect(el.textContent).toContain("$0.00");
    expect(el.textContent).toContain("no surplus this year");
  });
  it("tolerates a missing or malformed as-of date", () => {
    render(<WithdrawalAvailableLine bookValue={100} currentValue={150} incomeFundsValue={20} incomeFundsAsOf="not-a-date" />);
    expect(screen.getByTestId("withdrawal-available").textContent).not.toContain("as of");
  });
});
