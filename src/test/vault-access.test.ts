import { describe, it, expect } from "vitest";
import { buildItemAccess, type AccessInput } from "../../supabase/functions/_shared/vault-access";

const now = new Date("2026-10-11T12:00:00Z");
const base = (o: Partial<AccessInput> = {}): AccessInput => ({
  itemId: "file", chain: ["file", "folder", "root"], chainNames: { folder: "03 Estate", root: "Vault" }, isFolder: false, clientVisible: true, shoeboxFolderId: "shoebox", now,
  members: [
    { id: "m1", first_name: "Herman", last_name: "Peters", family_role: "head_of_family", vault_shoebox_only: false },
    { id: "m2", first_name: "Michelle", last_name: "Peters", family_role: "spouse", vault_shoebox_only: true },
  ],
  roles: [], contactGrants: [], collaboratorGrants: [], links: [], ...o,
});
const grant = (o: any = {}) => ({ id: "g1", drive_id: "file", permission: "view", expires_at: null, revoked_at: null, collaborator: { id: "c1", email: "lawyer@firm.ca", full_name: "Lee Lawyer", professional_id: "p1", revoked_at: null }, ...o });

describe("buildItemAccess", () => {
  it("says who is on the list even when nobody was invited", () => {
    const a = buildItemAccess(base());
    expect(a.invited).toEqual([]);
    expect(a.summary).toBe("Open to ProsperWise staff, 1 household member, 0 invited people, 0 links.");
  });
  it("hides files marked not client-visible from members, unless a grant names them", () => {
    const hidden = buildItemAccess(base({ clientVisible: false }));
    expect(hidden.members.map((m) => [m.name, m.capability, m.reason])).toEqual([["Herman Peters", null, "Hidden from clients"], ["Michelle Peters", null, "Hidden from clients"]]);
    const named = buildItemAccess(base({ clientVisible: false, contactGrants: [{ id: "x", contact_id: "m1", drive_id: "folder", permission: "view", expires_at: null, revoked_at: null }] }));
    expect(named.members[0].capability).toBe("view");
  });
  it("limits shoebox-only members to the Shoebox", () => {
    expect(buildItemAccess(base()).members[1]).toMatchObject({ capability: null, reason: "Shoebox-only access" });
    expect(buildItemAccess(base({ chain: ["file", "shoebox", "root"] })).members[1].capability).toBe("view");
  });
  it("raises, never lowers, a member's baseline with a grant on a parent folder", () => {
    const up = buildItemAccess(base({ roles: [{ contact_id: "m1", role: "viewer" }], contactGrants: [{ id: "x", contact_id: "m1", drive_id: "folder", permission: "manage", expires_at: null, revoked_at: null }] }));
    expect(up.members[0].capability).toBe("manage");
    const down = buildItemAccess(base({ roles: [{ contact_id: "m1", role: "manager" }], contactGrants: [{ id: "x", contact_id: "m1", drive_id: "file", permission: "view", expires_at: null, revoked_at: null }] }));
    expect(down.members[0].capability).toBe("manage");
  });
  it("lists invited people, marks inherited, expired and expiring grants, and skips revoked ones", () => {
    const a = buildItemAccess(base({ collaboratorGrants: [
      grant({ id: "a" }),
      grant({ id: "b", drive_id: "folder", expires_at: "2026-10-15T00:00:00Z", collaborator: { id: "c2", email: "acct@firm.ca", full_name: null, professional_id: null, revoked_at: null } }),
      grant({ id: "c", expires_at: "2026-10-01T00:00:00Z" }),
      grant({ id: "d", revoked_at: "2026-10-02T00:00:00Z" }),
      grant({ id: "e", drive_id: "elsewhere" }),
    ] }));
    expect(a.invited.map((g) => g.grantId).sort()).toEqual(["a", "b", "c"]);
    const b = a.invited.find((g) => g.grantId === "b")!;
    expect(b).toMatchObject({ kind: "collaborator", name: "acct@firm.ca", inheritedFrom: "03 Estate", expiringSoon: true, status: "active" });
    expect(a.invited.find((g) => g.grantId === "c")!.status).toBe("expired");
    expect(a.invited.find((g) => g.grantId === "a")!.kind).toBe("professional");
  });
  it("lists share links on the item or its parents with their state", () => {
    const a = buildItemAccess(base({ links: [
      { id: "l1", link_type: "guest", permission: "view", drive_id: "file", expires_at: null, max_uses: 1, use_count: 1, revoked_at: null, name: null },
      { id: "l2", link_type: "guest", permission: "view_upload", drive_id: "root", expires_at: null, max_uses: null, use_count: 3, revoked_at: null, name: "Tax pack" },
      { id: "l3", link_type: "guest", permission: "view", drive_id: "file", expires_at: null, max_uses: null, use_count: 0, revoked_at: "2026-10-01T00:00:00Z", name: null },
    ] }));
    expect(a.links.map((l) => [l.linkId, l.status, l.inheritedFrom])).toEqual([["l1", "used_up", null], ["l2", "active", "Vault"]]);
  });
});
