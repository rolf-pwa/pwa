// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/integrations/supabase/client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { VaultAccessSheet } from "../modules/crm/components/vault/VaultAccessSheet";

const access = {
  summary: "Open to ProsperWise staff, 1 household member, 1 invited person, 1 link.",
  members: [
    { contactId: "m1", name: "Herman Peters", role: "viewer", capability: "view", reason: null },
    { contactId: "m2", name: "Michelle Peters", role: "viewer", capability: null, reason: "Shoebox-only access" },
  ],
  invited: [{ grantId: "g1", kind: "professional", name: "Lee Lawyer", email: "lee@firm.ca", permission: "view", expiresAt: "2026-12-01T00:00:00Z", status: "active", expiringSoon: false, inheritedFrom: "03 Estate" }],
  contactGrants: [],
  links: [{ linkId: "l1", type: "guest", permission: "view", expiresAt: null, status: "active", uses: 2, maxUses: null, inheritedFrom: null, name: null }],
};

describe("VaultAccessSheet", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows who can open the item, what is inherited, and offers to invite", async () => {
    const calls: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: any) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ access }), { status: 200 }); }));
    const onInvite = vi.fn();
    render(<VaultAccessSheet open onOpenChange={() => {}} householdId="h1" target={{ driveId: "d1", name: "Will.pdf", isFolder: false }} onInvite={onInvite} />);
    await waitFor(() => expect(screen.getByText(/Open to ProsperWise staff/)).toBeTruthy());
    expect(calls[0]).toEqual({ action: "getItemAccess", householdId: "h1", driveId: "d1" });
    expect(screen.getByText("Herman Peters")).toBeTruthy();
    expect(screen.getByText("Shoebox-only access")).toBeTruthy();
    expect(screen.getByText("Lee Lawyer")).toBeTruthy();
    expect(screen.getByText(/From folder “03 Estate”/)).toBeTruthy();
    expect(screen.getByText("Guest link (unlock code)")).toBeTruthy();
    fireEvent.click(screen.getByText(/Invite someone to this file/));
    expect(onInvite).toHaveBeenCalledWith({ driveId: "d1", name: "Will.pdf", isFolder: false });
  });

  it("extends a grant by 30 days and reloads", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify(bodies.at(-1).action === "getItemAccess" ? { access } : { ok: true }), { status: 200 }); }));
    render(<VaultAccessSheet open onOpenChange={() => {}} householdId="h1" target={{ driveId: "d1", name: "Will.pdf", isFolder: false }} onInvite={() => {}} />);
    await waitFor(() => screen.getByText("Lee Lawyer"));
    fireEvent.click(screen.getByText("Extend 30 days"));
    await waitFor(() => expect(bodies.filter((b) => b.action === "getItemAccess")).toHaveLength(2));
    const upd = bodies.find((b) => b.action === "updateGrant");
    expect(upd.grantId).toBe("g1");
    expect(Date.parse(upd.expires_at)).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });
});
