// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { coverageSummary, coverageText } from "@/shared/lib/insuranceSummary";
import { PortalCoverageCard, PortalInsurance } from "../modules/portal/components/PortalInsurance";

const pol = (o: Record<string, unknown>) => ({ id: String(Math.random()), carrier: "iA", policy_number: null, cash_value: null, ...o }) as any;
const POLICIES = [
  pol({ policy_type: "universal_life", coverage_amount: 500000, policy_number: "UL1", renewal_date: "2027-03-01" }),
  pol({ policy_type: "term", coverage_amount: 250000, policy_number: "UL1" }), // a term rider on the same policy
  pol({ policy_type: "critical_illness", coverage_amount: 100000 }),
  pol({ policy_type: "disability", coverage_amount: 4100 }),
];

describe("coverage by kind", () => {
  it("never adds a monthly disability benefit to life and critical illness amounts", () => {
    const s = coverageSummary(POLICIES);
    expect(s.map((l) => [l.category, l.text])).toEqual([["life", "$750,000"], ["critical_illness", "$100,000"], ["disability", "$4,100 a month"]]);
    expect(s[0].policies).toBe(1); // base and rider are one policy
  });
  it("leaves out kinds the person does not have, and says nothing for an empty list", () => {
    expect(coverageSummary([pol({ policy_type: "term", coverage_amount: 1 })]).map((l) => l.category)).toEqual(["life"]);
    expect(coverageSummary([])).toEqual([]);
    expect(coverageText("disability", 2000)).toBe("$2,000 a month");
    expect(coverageText("life", 2000)).toBe("$2,000");
  });
});

describe("the client's coverage in the portal", () => {
  it("shows each kind of cover in its own terms on The Shield, with no single total", () => {
    render(<PortalInsurance policies={POLICIES} defaultCollapsed />);
    const box = screen.getByTestId("coverage-summary").textContent ?? "";
    expect(box).toContain("Life$750,000");
    expect(box).toContain("Critical illness$100,000");
    expect(box).toContain("Disability$4,100 a month");
    expect(screen.queryByText("Asset Protection")).toBeNull();
    expect(box).not.toContain("$854,100");
  });
  it("lists the policies with disability as a monthly benefit once opened", () => {
    render(<PortalInsurance policies={POLICIES} />);
    expect(screen.getAllByText("$4,100 a month").length).toBeGreaterThan(1);
  });
  it("has a dashboard card that opens the full list, and shows nothing without policies", () => {
    const open = vi.fn();
    const { unmount } = render(<PortalCoverageCard policies={POLICIES} onOpen={open} />);
    expect(screen.getByTestId("coverage-card").textContent).toContain("$4,100 a month");
    fireEvent.click(screen.getByText("See your policies"));
    expect(open).toHaveBeenCalled();
    unmount();
    const { container } = render(<PortalCoverageCard policies={[]} onOpen={open} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("wiring", () => {
  it("puts the card on both portals' dashboards, and stops the main portal's Insurance row summing different kinds", () => {
    const main = readFileSync("src/modules/portal/pages/Portal.tsx", "utf8");
    expect(main).toContain("<PortalCoverageCard");
    expect(main).toContain('total: totalsFor(visibleInsurance).coverage.life, suffix: "life coverage"');
    expect(main).not.toContain("n + (p.coverage_amount || 0), 0), suffix");
    const vfo = readFileSync("src/modules/portal/pages/VfoPortal.tsx", "utf8");
    expect(vfo).toContain("<PortalCoverageCard");
  });
});
