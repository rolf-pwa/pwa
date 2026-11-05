// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: { payload: unknown; id: unknown }[] = [];
vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { from: () => ({ update: (payload: unknown) => ({ eq: async (_c: string, id: unknown) => { updates.push({ payload, id }); return { error: null }; } }) }) } }));
import { LiquidityReserveCharterAmount } from "@/modules/crm/components/LiquidityReserveCharterAmount";

beforeEach(() => { document.body.innerHTML = ""; updates.length = 0; });

describe("the Liquidity Reserve from the Charter, on the household", () => {
  it("starts from the saved amount, and Save is off until it changes", () => {
    render(<LiquidityReserveCharterAmount householdId="h1" value="150000" />);
    expect((screen.getByTestId("liquidity-charter-input") as HTMLInputElement).value).toBe("150000");
    expect((screen.getByTestId("liquidity-charter-save") as HTMLButtonElement).disabled).toBe(true);
  });
  it("saves a typed amount on the household, ignoring dollar signs and commas", async () => {
    const onSaved = vi.fn();
    render(<LiquidityReserveCharterAmount householdId="h1" value={null} onSaved={onSaved} />);
    fireEvent.change(screen.getByTestId("liquidity-charter-input"), { target: { value: "$150,000" } });
    fireEvent.click(screen.getByTestId("liquidity-charter-save"));
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toEqual({ payload: { liquidity_reserve_amount: 150000 }, id: "h1" });
    expect(onSaved).toHaveBeenCalledWith(150000);
  });
  it("clears it when emptied", async () => {
    render(<LiquidityReserveCharterAmount householdId="h1" value={150000} />);
    fireEvent.change(screen.getByTestId("liquidity-charter-input"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("liquidity-charter-save"));
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0].payload).toEqual({ liquidity_reserve_amount: null });
  });
  it("will not save a negative or unreadable amount", () => {
    render(<LiquidityReserveCharterAmount householdId="h1" value={null} />);
    for (const bad of ["-5", "abc"]) {
      fireEvent.change(screen.getByTestId("liquidity-charter-input"), { target: { value: bad } });
      expect((screen.getByTestId("liquidity-charter-save") as HTMLButtonElement).disabled).toBe(true);
    }
    expect(updates).toHaveLength(0);
  });
  it("is on the household's Financials tab, the VFO data carries it, and it is a separate field from a storehouse target", () => {
    expect(readFileSync("src/modules/crm/pages/HouseholdDetail.tsx", "utf8")).toContain("<LiquidityReserveCharterAmount householdId={id!}");
    const pv = readFileSync("supabase/functions/portal-validate/index.ts", "utf8");
    expect(pv.match(/liquidity_reserve_amount/g)!.length).toBe(2);
    const sql = readFileSync("supabase/migrations/20270115120000_household_liquidity_reserve_amount.sql", "utf8");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS liquidity_reserve_amount numeric");
    expect(sql).toContain(">= 0");
  });
});
