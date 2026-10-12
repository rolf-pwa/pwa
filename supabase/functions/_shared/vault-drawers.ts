// Drawers: the three kinds of Vault space a client can have.
//   household  the existing household Vault (role + grants; handled by vault-service as before)
//   family     the Family Vault, shared by a VFO family; access by family role, plus named grants
//   personal   one adult's private drawer; only its owner (and staff) can open it, unless the owner invites someone
//   entity     a corporation's vault ("Corporate Docs"); only people named in entity_vault_access (and staff) can open it
// Pure (no I/O) so it can be unit-tested.

export type Capability = "view" | "upload" | "manage";
export type DrawerKind = "household" | "family" | "personal" | "entity";

export interface Drawer {
  kind: DrawerKind;
  rootId: string;
  ownerContactId?: string | null;
  familyId?: string | null;
  /** The corporation, for an entity drawer. */
  entityId?: string | null;
  /** For an entity drawer: this person's explicit access to it (from entity_vault_access). */
  entityCap?: Capability | null;
}

const RANK: Record<Capability, number> = { view: 0, upload: 1, manage: 2 };

/** Folders created inside a new Family Vault. */
export const FAMILY_VAULT_CATEGORIES = [
  "01 Family Charter & Governance",
  "02 Estate & Trusts",
  "03 Corporate & Holdings",
  "04 Insurance",
  "05 Family Meetings",
  "06 Education & Legacy",
];

// Default access to the Family Vault by family role. Minors see nothing unless named in a grant.
const FAMILY_ROLE_CAP: Record<string, Capability> = {
  head_of_family: "manage",
  head_of_household: "upload",
  spouse: "view",
  beneficiary: "view",
};
export const familyRoleCap = (role: string | null | undefined): Capability | null => FAMILY_ROLE_CAP[role ?? ""] ?? null;

/** Who gets a personal drawer: adults in a family. */
export const hasPersonalDrawerRole = (role: string | null | undefined, isMinor?: boolean | null) =>
  !isMinor && ["head_of_family", "head_of_household", "spouse", "beneficiary"].includes(role ?? "");

export interface DrawerGrant { drive_id: string; permission: string; expires_at: string | null; revoked_at: string | null }

export function drawerCapability(a: {
  drawer: Drawer;
  actorContactId: string;
  familyRole: string | null;
  isMinor: boolean;
  shoeboxOnly: boolean;
  grants: DrawerGrant[];
  chain: string[];
  now: Date;
}): { cap: Capability | null; reason: string | null } {
  if (a.drawer.kind === "personal") {
    return a.drawer.ownerContactId === a.actorContactId ? { cap: "manage", reason: null } : { cap: null, reason: "personal_drawer_private" };
  }
  if (a.drawer.kind === "entity") {
    // Explicit access only: no role in the family or household opens an entity vault. A named grant on a folder can still open it.
    const liveGrants = a.grants.filter((g) => g.revoked_at === null && (!g.expires_at || new Date(g.expires_at) > a.now) && a.chain.includes(g.drive_id));
    let ecap: Capability | null = a.shoeboxOnly || a.isMinor ? null : a.drawer.entityCap ?? null;
    for (const id of a.chain) {
      const hit = liveGrants.find((g) => g.drive_id === id);
      if (hit) {
        const p = hit.permission as Capability;
        if (ecap === null || RANK[p] > RANK[ecap]) ecap = p;
        break;
      }
    }
    return ecap ? { cap: ecap, reason: null } : { cap: null, reason: "entity_vault_not_named" };
  }
  if (a.drawer.kind !== "family") return { cap: null, reason: "not_a_drawer" };
  // A limited ("Shoebox only") client does not get the Family Vault.
  if (a.shoeboxOnly) return { cap: null, reason: "shoebox_only" };
  const live = a.grants.filter((g) => g.revoked_at === null && (!g.expires_at || new Date(g.expires_at) > a.now) && a.chain.includes(g.drive_id));
  let cap: Capability | null = a.isMinor ? null : familyRoleCap(a.familyRole);
  // The nearest grant in the chain can open the Vault to someone with no role and can raise anyone's access, never lower it.
  for (const id of a.chain) {
    const hit = live.find((g) => g.drive_id === id);
    if (hit) {
      const p = hit.permission as Capability;
      if (cap === null || RANK[p] > RANK[cap]) cap = p;
      break;
    }
  }
  return cap ? { cap, reason: null } : { cap: null, reason: "family_vault_no_role" };
}

/** Clients may invite outsiders only into a drawer where they can manage, and never into the household Vault. */
export const mayShareFromDrawer = (kind: DrawerKind, cap: Capability | null) => kind !== "household" && cap === "manage";

export const SELF_SHARE_DEFAULT_DAYS = 30;
export const SELF_SHARE_MAX_DAYS = 365;

/** Self-service access always expires: the requested date, capped at a year; 30 days if none is given. */
export function clampSelfShareExpiry(requested: string | null | undefined, now: Date): string {
  const max = now.getTime() + SELF_SHARE_MAX_DAYS * 86_400_000;
  const asked = requested ? Date.parse(requested) : NaN;
  const t = Number.isFinite(asked) ? asked : now.getTime() + SELF_SHARE_DEFAULT_DAYS * 86_400_000;
  return new Date(Math.min(Math.max(t, now.getTime() + 3_600_000), max)).toISOString();
}

/** Outsiders invited by a client can view or upload, never manage. */
export const clampSelfSharePermission = (p: string | null | undefined): "view" | "upload" => (p === "upload" ? "upload" : "view");

/**
 * Which drawer owns an item? The nearest root above it wins (so a household Vault inside a bigger folder is
 * judged as the household Vault), and the Family Vault never reaches into a household Vault or a personal drawer
 * even if its root folder happens to sit above them in Drive: those roots are protected. Returns null when none applies.
 */
export function pickDrawer(drawers: Drawer[], chain: string[], protectedRoots: string[]): Drawer | null {
  const passesProtected = chain.some((id) => protectedRoots.includes(id));
  const candidates = drawers.filter((d) => chain.includes(d.rootId) && !(d.kind === "family" && passesProtected));
  if (candidates.length === 0) return null;
  return candidates.reduce((best, d) => (chain.indexOf(d.rootId) < chain.indexOf(best.rootId) ? d : best));
}
