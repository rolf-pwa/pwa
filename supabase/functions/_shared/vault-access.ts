// "Who can open this?" for one file or folder in a Vault. Pure (no I/O) so it can be unit-tested; the
// vault-service getItemAccess action gathers the rows and calls buildItemAccess.
//
// Rules mirrored from vault-service's enforcement: a grant on a folder covers everything inside it; a
// household member's baseline role (default viewer) can be raised, never lowered, by a grant; files hidden
// from clients (client_visible = false) are not open to household members unless a grant names them;
// "Shoebox only" members can only open the Shoebox and what is inside it.

export type Capability = "view" | "upload" | "manage";
const ROLE_CAP: Record<string, Capability> = { viewer: "view", contributor: "upload", manager: "manage" };
const RANK: Record<Capability, number> = { view: 0, upload: 1, manage: 2 };

export interface AccessInput {
  itemId: string;
  /** The item first, then each parent up to and including the household's Vault root. */
  chain: string[];
  chainNames: Record<string, string>;
  isFolder: boolean;
  /** vault_files.client_visible for this item; null when we have no record (treated as visible). */
  clientVisible: boolean | null;
  shoeboxFolderId: string | null;
  now: Date;
  members: Array<{ id: string; first_name: string | null; last_name: string | null; family_role: string | null; vault_shoebox_only: boolean | null }>;
  roles: Array<{ contact_id: string; role: string }>;
  contactGrants: Array<{ id: string; contact_id: string; drive_id: string; permission: string; expires_at: string | null; revoked_at: string | null }>;
  collaboratorGrants: Array<{
    id: string; drive_id: string; permission: string; expires_at: string | null; revoked_at: string | null;
    collaborator: { id: string; email: string; full_name: string | null; professional_id: string | null; revoked_at: string | null } | null;
  }>;
  links: Array<{ id: string; link_type: string; permission: string; drive_id: string; expires_at: string | null; max_uses: number | null; use_count: number; revoked_at: string | null; name: string | null }>;
}

export interface MemberAccess {
  contactId: string; name: string; role: string; capability: Capability | null; reason: string | null;
}
export interface GrantAccess {
  grantId: string; kind: "collaborator" | "professional"; name: string; email: string; permission: string;
  expiresAt: string | null; status: "active" | "expired"; expiringSoon: boolean;
  /** Set when the grant is on a parent folder rather than on this item. */
  inheritedFrom: string | null;
}
export interface ContactGrantAccess { grantId: string; contactId: string; name: string; permission: string; expiresAt: string | null; inheritedFrom: string | null }
export interface LinkAccess {
  linkId: string; type: string; permission: string; expiresAt: string | null; status: "active" | "expired" | "used_up";
  uses: number; maxUses: number | null; inheritedFrom: string | null; name: string | null;
}
export interface ItemAccess {
  staff: { note: string };
  members: MemberAccess[];
  invited: GrantAccess[];
  links: LinkAccess[];
  contactGrants: ContactGrantAccess[];
  /** One line for the top of the panel. */
  summary: string;
}

const personName = (p: { first_name: string | null; last_name: string | null }) => `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unnamed";
const live = (g: { expires_at: string | null; revoked_at: string | null }, now: Date) => !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > now);

export function buildItemAccess(i: AccessInput): ItemAccess {
  const from = (driveId: string) => (driveId === i.itemId ? null : i.chainNames[driveId] ?? "a parent folder");
  const inChain = (driveId: string) => i.chain.includes(driveId);
  const soon = (exp: string | null) => !!exp && new Date(exp).getTime() - i.now.getTime() <= 7 * 86_400_000 && new Date(exp) > i.now;

  const members: MemberAccess[] = i.members.map((m) => {
    const role = i.roles.find((r) => r.contact_id === m.id)?.role ?? "viewer";
    let cap: Capability = ROLE_CAP[role] ?? "view";
    // The nearest live grant in the chain can raise (never lower) the baseline.
    const own = i.contactGrants.filter((g) => g.contact_id === m.id && inChain(g.drive_id) && live(g, i.now));
    for (const id of i.chain) {
      const hit = own.find((g) => g.drive_id === id);
      if (hit) { if (RANK[hit.permission as Capability] > RANK[cap]) cap = hit.permission as Capability; break; }
    }
    const named = own.length > 0;
    let reason: string | null = null;
    let open = true;
    if (i.clientVisible === false && !named) { open = false; reason = "Hidden from clients"; }
    else if (m.vault_shoebox_only && i.shoeboxFolderId && !i.chain.includes(i.shoeboxFolderId) && i.itemId !== i.shoeboxFolderId) { open = false; reason = "Shoebox-only access"; }
    return { contactId: m.id, name: personName(m), role, capability: open ? cap : null, reason };
  });

  const invited: GrantAccess[] = i.collaboratorGrants
    .filter((g) => inChain(g.drive_id) && !g.revoked_at && g.collaborator && !g.collaborator.revoked_at)
    .map((g) => ({
      grantId: g.id,
      kind: g.collaborator!.professional_id ? "professional" as const : "collaborator" as const,
      name: g.collaborator!.full_name || g.collaborator!.email, email: g.collaborator!.email, permission: g.permission,
      expiresAt: g.expires_at, status: live(g, i.now) ? "active" as const : "expired" as const, expiringSoon: soon(g.expires_at), inheritedFrom: from(g.drive_id),
    }))
    .sort((a, b) => Number(!!a.inheritedFrom) - Number(!!b.inheritedFrom) || a.name.localeCompare(b.name));

  const contactGrants: ContactGrantAccess[] = i.contactGrants
    .filter((g) => inChain(g.drive_id) && live(g, i.now))
    .map((g) => ({ grantId: g.id, contactId: g.contact_id, name: personName(i.members.find((m) => m.id === g.contact_id) ?? { first_name: null, last_name: null }), permission: g.permission, expiresAt: g.expires_at, inheritedFrom: from(g.drive_id) }));

  const links: LinkAccess[] = i.links
    .filter((l) => inChain(l.drive_id) && !l.revoked_at)
    .map((l) => ({
      linkId: l.id, type: l.link_type, permission: l.permission, expiresAt: l.expires_at, uses: l.use_count, maxUses: l.max_uses, name: l.name, inheritedFrom: from(l.drive_id),
      status: l.expires_at && new Date(l.expires_at) <= i.now ? "expired" as const : l.max_uses != null && l.use_count >= l.max_uses ? "used_up" as const : "active" as const,
    }));

  const peopleOpen = members.filter((m) => m.capability).length;
  const invitedActive = invited.filter((g) => g.status === "active").length;
  const linksActive = links.filter((l) => l.status === "active").length;
  const parts = [
    `${peopleOpen} household member${peopleOpen === 1 ? "" : "s"}`,
    `${invitedActive} invited ${invitedActive === 1 ? "person" : "people"}`,
    `${linksActive} link${linksActive === 1 ? "" : "s"}`,
  ];
  return { staff: { note: "All ProsperWise staff" }, members, invited, links, contactGrants, summary: `Open to ProsperWise staff, ${parts.join(", ")}.` };
}
