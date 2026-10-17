import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: any[]) => invoke(...a) } } }));
vi.mock("@/shared/components/AppLayout", () => ({ AppLayout: ({ children }: any) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import BulkImporters from "@/modules/intake/pages/BulkImporters";

const runs = [
  { id: "r1", file_name: "Tracking_Performance_20261030_1.xlsx", snapshot_date: "2026-10-30", source: "georgia", status: "ready", checks: [], summary: { total_rows: 100, routine: 96, exceptions: 2, new_accounts: 1, missing: 1 }, created_at: "2026-11-02T16:00:00Z" },
  { id: "r2", file_name: "Tracking_Performance_20260930_1.xlsx", snapshot_date: "2026-09-30", source: "manual", status: "committed", checks: [], summary: { total_rows: 98 }, created_at: "2026-10-01T16:00:00Z" },
  { id: "r3", file_name: "bad.xlsx", snapshot_date: "2026-10-12", source: "georgia", status: "held", checks: ["The file's date (2026-10-12) is not near a month-end."], summary: { total_rows: 40 }, created_at: "2026-10-12T16:00:00Z" },
];

describe("Georgia's monthly imports on the Importers page", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (_fn: string, opts: any) => {
      if (opts.body.action === "runs") return { data: { runs, config: { mode: "prepare", drive_folder_id: "folder1" } }, error: null };
      if (opts.body.action === "undo") return { data: { result: { accounts_restored: 90, snapshots_removed: 95 } }, error: null };
      return { data: {}, error: null };
    });
  });
  it("lists each import with its status, what needs attention, and why a file was held", async () => {
    render(<BulkImporters />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Monthly Performance/ }), { button: 0, ctrlKey: false });
    expect(await screen.findByText("Ready for you")).toBeTruthy();
    expect(screen.getByText(/96 routine · 2 large moves · 1 new · 1 missing/)).toBeTruthy();
    expect(screen.getByText("Held: needs a look")).toBeTruthy();
    expect(screen.getByText(/not near a month-end/)).toBeTruthy();
    expect(screen.getByText(/she prepares it and you commit/)).toBeTruthy();
  });
  it("offers to load a prepared file, and undo only for a committed one", async () => {
    render(<BulkImporters />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Monthly Performance/ }), { button: 0, ctrlKey: false });
    await screen.findByText("Ready for you");
    expect(screen.getAllByRole("button", { name: "Load into the importer" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  });
  it("undoes after a confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<BulkImporters />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Monthly Performance/ }), { button: 0, ctrlKey: false });
    await screen.findByText("Ready for you");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("bulk-import-performance", { body: { action: "undo", runId: "r2" } }));
  });
});
