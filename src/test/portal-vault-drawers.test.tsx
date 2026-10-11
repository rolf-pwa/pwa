// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortalVault } from "../modules/portal/components/PortalVault";

type Call = { action: string; folderId?: string; driveId?: string };

function stubVault(drawers: unknown[]) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: any) => {
    const body = JSON.parse(init.body) as Call;
    calls.push(body);
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    switch (body.action) {
      case "getRoot": return json({ rootFolderId: "hdocs", rootName: "Household Docs" });
      case "getDrawers": return json({ drawers });
      case "ensureShoebox": return json({ folderId: "shoebox" });
      case "getEffectivePermission": return json({ cap: "manage" });
      case "listFolder":
        return json(body.folderId === "fdocs" ? { folders: [{ id: "c1", name: "01 Family Charter" }], files: [] }
          : body.folderId === "pdrawer" ? { folders: [], files: [] }
          : { folders: [{ id: "tax", name: "03 Tax" }], files: [] });
      default: return json({});
    }
  }));
  return calls;
}

const all = [
  { kind: "household", rootId: "hdocs", label: "Household Docs", capability: "view" },
  { kind: "family", rootId: "fdocs", label: "Family Docs", capability: "view" },
  { kind: "personal", rootId: "pdrawer", label: "Personal Docs", capability: "manage" },
];

describe("PortalVault drawer picker", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows a picker with the three spaces and what each one means, and switches roots", async () => {
    const calls = stubVault(all);
    render(<PortalVault portalToken="t" householdId="h1" />);
    await waitFor(() => expect(screen.getByText("03 Tax")).toBeTruthy());
    // Buttons run broadest to most private, whatever order the server returns them in.
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Family Docs", "Household Docs", "Personal Docs"]);
    expect(screen.getByRole("tab", { name: "Household Docs" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Shared with your household")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Family Docs" }));
    await waitFor(() => expect(screen.getByText("01 Family Charter")).toBeTruthy());
    expect(screen.getByText("Shared with your family, by role")).toBeTruthy();
    expect(calls.filter((c) => c.action === "listFolder").map((c) => c.folderId)).toEqual(["hdocs", "fdocs"]);

    fireEvent.click(screen.getByRole("tab", { name: "Personal Docs" }));
    await waitFor(() => expect(screen.getByText(/Anything you add here stays private to you/)).toBeTruthy());
    expect(screen.getByText(/Private to you/)).toBeTruthy();
  });

  it("is unchanged for a household with no other spaces: no picker", async () => {
    stubVault([{ kind: "household", rootId: "hdocs", label: "Household Docs", capability: "view" }]);
    render(<PortalVault portalToken="t" householdId="h1" />);
    await waitFor(() => expect(screen.getByText("03 Tax")).toBeTruthy());
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("still opens the household Vault if the drawer lookup fails", async () => {
    const orig = stubVault([]);
    (globalThis.fetch as any).mockImplementation(async (_u: string, init: any) => {
      const b = JSON.parse(init.body);
      if (b.action === "getDrawers") throw new Error("boom");
      if (b.action === "getRoot") return new Response(JSON.stringify({ rootFolderId: "hdocs", rootName: "Household Docs" }), { status: 200 });
      if (b.action === "listFolder") return new Response(JSON.stringify({ folders: [{ id: "tax", name: "03 Tax" }], files: [] }), { status: 200 });
      return new Response(JSON.stringify({ cap: "view", folderId: "shoebox" }), { status: 200 });
    });
    void orig;
    render(<PortalVault portalToken="t" householdId="h1" />);
    await waitFor(() => expect(screen.getByText("03 Tax")).toBeTruthy());
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
