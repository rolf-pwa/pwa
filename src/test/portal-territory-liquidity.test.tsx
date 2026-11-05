// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
import { PortalTerritory } from "@/modules/portal/components/PortalTerritory";

const account = (id: string, o: Record<string, unknown> = {}) => ({ id, account_name: `iA RRSP ${id}`, account_number: `18200000${id}`, account_type: "RRSP", current_value: 100000, book_value: 90000, income_funds_value: 30000, income_funds_as_of: "2026-10-30", visibility_scope: "family_shared", ...o });
const render_ = (accounts: unknown[], storehouses: unknown[] = [], showLiquidityDetail = true) =>
  render(<PortalTerritory vineyardAccounts={accounts as never} storehouses={storehouses as never} contact={{} as never} family={{} as never} household={{} as never} scopeLabel="My Territory" section="all" showLiquidityDetail={showLiquidityDetail} />);

describe("the Liquidity Reserve on the VFO territory card", () => {
  it("shows the reserve from the income funds, where it comes from and the accounts holding it", () => {
    render_([account("11"), account("12", { income_funds_value: 12000, current_value: 115000 })]);
    expect(screen.getByTestId("storehouse-total-1").textContent).toBe("$42,000");
    const detail = screen.getByTestId("liquidity-detail");
    expect(detail.textContent).toContain("$42,000 of income funds held in your Vineyard accounts, as of Oct 30, 2026");
    expect(detail.textContent).toContain("not in addition to it");
    expect(within(detail).getAllByTestId("liquidity-line")).toHaveLength(2);
    // What could be drawn this year is not shown until its rule is settled: a wrong figure to a client is worse than none.
    expect(screen.queryByTestId("liquidity-available")).toBeNull();
    expect(detail.textContent).not.toContain("Available to draw");
    // The other three reserves still say so; the Liquidity Reserve no longer does.
    expect(screen.getAllByText("No accounts configured")).toHaveLength(3);
  });
  it("leaves a note on the Vineyard card so the two reconcile, and does not change the Vineyard total", () => {
    render_([account("11")]);
    expect(screen.getByTestId("vineyard-liquidity-line").textContent).toBe("$30,000 of this is income funds, counted in your Liquidity Reserve.");
    expect(screen.getAllByText("$100,000").length).toBeGreaterThan(0);
  });
  it("says how many accounts it covers when some have not been read", () => {
    render_([account("11"), account("12", { income_funds_value: null })]);
    expect(screen.getByTestId("liquidity-coverage").textContent).toBe("Based on 1 of your 2 accounts: the rest are still being read.");
  });
  it("shows nothing new without the flag, and nothing when the household's own Liquidity Reserve stands", () => {
    render_([account("11")], [], false);
    expect(screen.queryByTestId("liquidity-detail")).toBeNull();
    expect(screen.getByTestId("storehouse-total-1").textContent).toBe("$0");
  });
  it("keeps the household's own Liquidity Reserve when one is set up", () => {
    render_([account("11")], [{ id: "s1", storehouse_number: 1, label: "Reserve", current_value: 80000, target_value: 150000, visibility_scope: "family_shared" }]);
    expect(screen.queryByTestId("liquidity-detail")).toBeNull();
    expect(screen.getByTestId("storehouse-total-1").textContent).toBe("$80,000");
  });
  it("is on for the VFO portal only", () => {
    expect(readFileSync("src/modules/portal/pages/VfoPortal.tsx", "utf8")).toContain("showLiquidityDetail");
    expect(readFileSync("src/modules/portal/pages/Portal.tsx", "utf8")).not.toContain("showLiquidityDetail");
  });
});
