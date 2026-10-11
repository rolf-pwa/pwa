// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortalVault } from "../modules/portal/components/PortalVault";
import { PortalShoeboxUpload } from "../modules/portal/components/PortalShoeboxUpload";
import { shoeboxNoticeText } from "../modules/portal/components/ShoeboxNotice";

const house = { kind: "household", rootId: "hdocs", label: "Household Docs", capability: "view" };
const personal = { kind: "personal", rootId: "pdrawer", label: "Personal Docs", capability: "manage" };

function stub(drawers: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: any) => {
    const b = JSON.parse(init.body);
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    switch (b.action) {
      case "getRoot": return json({ rootFolderId: "hdocs", rootName: "Household Docs" });
      case "getDrawers": return json({ drawers });
      case "ensureShoebox": return json({ folderId: "shoebox" });
      case "getEffectivePermission": return json({ cap: "upload" });
      case "listFolder":
        return json(b.folderId === "hdocs" ? { folders: [{ id: "shoebox", name: "00 Shoebox (Client Uploads)" }], files: [] } : { folders: [], files: [] });
      default: return json({});
    }
  }));
}

describe("household Shoebox privacy notice", () => {
  afterEach(() => vi.restoreAllMocks());

  it("says the files are shared with the whole household, and points to Personal Docs only when there is one", () => {
    expect(shoeboxNoticeText(false)).toBe("Files you add here are shared with everyone in your household.");
    expect(shoeboxNoticeText(true)).toContain("For private files, upload to Personal Docs");
  });

  it("is shown on the uploader, with the pointer to Personal Docs when the person has a personal drawer", async () => {
    stub([house, personal]);
    render(<PortalShoeboxUpload portalToken="t" householdId="h1" />);
    await waitFor(() => expect(screen.getByRole("note").textContent).toContain("For private files, upload to Personal Docs"));
    expect(screen.getByRole("note").textContent).toContain("shared with everyone in your household");
  });

  it("is shown without the pointer when there is no personal drawer", async () => {
    stub([house]);
    render(<PortalShoeboxUpload portalToken="t" householdId="h1" row />);
    await waitFor(() => expect(screen.getByRole("note")).toBeTruthy());
    expect(screen.getByRole("note").textContent).not.toContain("Personal Docs");
  });

  it("is a banner inside the Shoebox folder, and its button goes to Personal Docs", async () => {
    stub([house, personal]);
    render(<PortalVault portalToken="t" householdId="h1" />);
    await waitFor(() => expect(screen.getByText(/00 Shoebox/)).toBeTruthy());
    // The Shoebox row itself is labelled before anyone opens it.
    expect(screen.getAllByText("Shared with your household").length).toBeGreaterThan(1);
    fireEvent.click(screen.getByText(/00 Shoebox/));
    await waitFor(() => expect(screen.getByRole("note")).toBeTruthy());
    fireEvent.click(screen.getByText("Go to Personal Docs"));
    await waitFor(() => expect(screen.getByText(/Anything you add here stays private to you/)).toBeTruthy());
    expect(screen.queryByRole("note")).toBeNull();
  });
});
