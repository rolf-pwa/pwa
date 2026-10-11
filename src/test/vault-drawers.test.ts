import { describe, it, expect } from "vitest";
import { drawerCapability, familyRoleCap, hasPersonalDrawerRole, mayShareFromDrawer, clampSelfShareExpiry, clampSelfSharePermission, type Drawer } from "../../supabase/functions/_shared/vault-drawers";

const now = new Date("2026-10-11T12:00:00Z");
const family: Drawer = { kind: "family", rootId: "fv", familyId: "f1" };
const personal: Drawer = { kind: "personal", rootId: "pd", ownerContactId: "herman" };
const args = (o: any = {}) => ({ drawer: family, actorContactId: "herman", familyRole: "head_of_family", isMinor: false, shoeboxOnly: false, grants: [], chain: ["file", "cat", "fv"], now, ...o });

describe("Family Vault access by family role", () => {
  it("applies the default role mapping", () => {
    expect(familyRoleCap("head_of_family")).toBe("manage");
    expect(familyRoleCap("head_of_household")).toBe("upload");
    expect(familyRoleCap("spouse")).toBe("view");
    expect(familyRoleCap("beneficiary")).toBe("view");
    expect(familyRoleCap("minor")).toBeNull();
    expect(familyRoleCap(null)).toBeNull();
  });
  it("gives each role its default and nothing to minors or limited clients", () => {
    expect(drawerCapability(args()).cap).toBe("manage");
    expect(drawerCapability(args({ familyRole: "spouse" })).cap).toBe("view");
    expect(drawerCapability(args({ familyRole: "minor", isMinor: true }))).toEqual({ cap: null, reason: "family_vault_no_role" });
    expect(drawerCapability(args({ shoeboxOnly: true }))).toEqual({ cap: null, reason: "shoebox_only" });
  });
  it("lets a named grant open the Vault to a minor and raise a viewer, but never lower anyone", () => {
    const grant = (permission: string, drive_id = "cat") => ({ drive_id, permission, expires_at: null, revoked_at: null });
    expect(drawerCapability(args({ familyRole: "minor", isMinor: true, grants: [grant("view")] })).cap).toBe("view");
    expect(drawerCapability(args({ familyRole: "spouse", grants: [grant("upload")] })).cap).toBe("upload");
    expect(drawerCapability(args({ familyRole: "head_of_family", grants: [grant("view", "file")] })).cap).toBe("manage");
  });
  it("ignores revoked, expired and out-of-chain grants", () => {
    const base = { drive_id: "cat", permission: "manage", expires_at: null, revoked_at: null };
    const a = (g: any) => drawerCapability(args({ familyRole: "spouse", grants: [g] })).cap;
    expect(a({ ...base, revoked_at: "2026-10-01T00:00:00Z" })).toBe("view");
    expect(a({ ...base, expires_at: "2026-10-01T00:00:00Z" })).toBe("view");
    expect(a({ ...base, drive_id: "elsewhere" })).toBe("view");
  });
});

describe("personal drawers", () => {
  it("are open to their owner only, whatever the family role", () => {
    expect(drawerCapability(args({ drawer: personal })).cap).toBe("manage");
    expect(drawerCapability(args({ drawer: personal, actorContactId: "sage", familyRole: "head_of_family" }))).toEqual({ cap: null, reason: "personal_drawer_private" });
  });
  it("are for adults", () => {
    expect(hasPersonalDrawerRole("spouse")).toBe(true);
    expect(hasPersonalDrawerRole("minor")).toBe(false);
    expect(hasPersonalDrawerRole("beneficiary", true)).toBe(false);
  });
});

describe("self-service sharing", () => {
  it("only from a drawer where the client can manage, never the household Vault", () => {
    expect(mayShareFromDrawer("family", "manage")).toBe(true);
    expect(mayShareFromDrawer("personal", "manage")).toBe(true);
    expect(mayShareFromDrawer("family", "upload")).toBe(false);
    expect(mayShareFromDrawer("household", "manage")).toBe(false);
  });
  it("always expires: default 30 days, capped at a year", () => {
    const day = 86_400_000;
    expect(Date.parse(clampSelfShareExpiry(null, now)) - now.getTime()).toBe(30 * day);
    expect(Date.parse(clampSelfShareExpiry("2030-01-01T00:00:00Z", now)) - now.getTime()).toBe(365 * day);
    expect(Date.parse(clampSelfShareExpiry("2026-10-11T12:00:01Z", now)) - now.getTime()).toBe(3_600_000);
    expect(Date.parse(clampSelfShareExpiry("not a date", now)) - now.getTime()).toBe(30 * day);
  });
  it("never lets a client grant manage", () => {
    expect(clampSelfSharePermission("manage")).toBe("view");
    expect(clampSelfSharePermission("upload")).toBe("upload");
    expect(clampSelfSharePermission(undefined)).toBe("view");
  });
});

import { pickDrawer } from "../../supabase/functions/_shared/vault-drawers";
describe("pickDrawer: a Family Vault root that sits above household folders", () => {
  const household: Drawer = { kind: "household", rootId: "hdocs" };
  const fam: Drawer = { kind: "family", rootId: "top", familyId: "f1" };
  const mine: Drawer = { kind: "personal", rootId: "me", ownerContactId: "herman" };
  const drawers = [household, fam, mine];
  const protectedRoots = ["hdocs", "me", "other-household", "someone-elses-drawer"];
  it("judges household files as household files, even though the family root is above them", () => {
    expect(pickDrawer(drawers, ["file", "hdocs", "hvault", "top"], protectedRoots)).toBe(household);
  });
  it("judges my personal drawer as mine", () => {
    expect(pickDrawer(drawers, ["file", "me", "pdocs", "hvault", "top"], protectedRoots)).toBe(mine);
  });
  it("gives the family drawer nothing inside another household or someone else's personal drawer", () => {
    expect(pickDrawer(drawers, ["file", "other-household", "hvault2", "top"], protectedRoots)).toBeNull();
    expect(pickDrawer(drawers, ["file", "someone-elses-drawer", "pdocs", "hvault", "top"], protectedRoots)).toBeNull();
  });
  it("still serves real Family Docs content, and the family root itself", () => {
    expect(pickDrawer(drawers, ["file", "cat", "top"], protectedRoots)).toBe(fam);
    expect(pickDrawer(drawers, ["top"], protectedRoots)).toBe(fam);
  });
  it("is null for items outside every drawer", () => {
    expect(pickDrawer(drawers, ["x", "y"], protectedRoots)).toBeNull();
  });
});
