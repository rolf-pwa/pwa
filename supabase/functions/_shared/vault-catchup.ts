// vault-catchup.ts: the one-time catch-up that brings existing households into the Drive Vault structure. Pure (no I/O).
//   provision  an active, tiered household with no Vault at all: build its whole tree
//   legacy     an active household on the older Vault layout (a root but no Household Vault folder): a new structure is built beside it
//   drawers    an active household that has a Vault but whose adults lack a personal drawer
// Untiered households (prospects, VFO families tiered as a whole, nothing under management) are left for Rolf to decide.
import { hasPersonalDrawerRole } from "./vault-drawers.ts";

export interface CatchUpHousehold { familyId?: string | null; id: string; label: string | null; familyName: string | null; serviceTier: string | null; /** The household belongs to a Virtual Family Office family (tiered as a whole, so it has no tier of its own). */ vfo?: boolean; relationshipEnded: boolean; vaultRoot: string | null; /** The Household Vault folder that holds the Vault root, Personal Docs and Advisor Files. Null on an older Vault. */ vaultFolder?: string | null }
export interface CatchUpPerson { householdId: string | null; role: string | null; isMinor: boolean | null; personalDrawer: string | null }
export interface CatchUpFamily { id: string; name: string | null; vfo: boolean; vaultRoot: string | null }
export interface CatchUpPlan {
  /** VFO families with no Family Vault (Family Docs) yet. */
  familyVaults: { id: string; name: string }[];
  provision: { id: string; name: string; tier: string | null }[];
  /** Households on the older Vault layout: brought to the same structure as every other household. */
  legacy: { id: string; name: string }[];
  drawers: { id: string; name: string; missing: number }[];
}

const nameOf = (h: CatchUpHousehold) => (h.familyName && h.label && h.label !== h.familyName ? `${h.familyName}: ${h.label}` : h.familyName ?? h.label ?? "Household");

export function planVaultCatchUp(households: CatchUpHousehold[], people: CatchUpPerson[], families: CatchUpFamily[] = []): CatchUpPlan {
  const plan: CatchUpPlan = { familyVaults: [], provision: [], legacy: [], drawers: [] };
  for (const h of households) {
    if (h.relationshipEnded) continue;
    if (!h.vaultRoot) {
      if (h.serviceTier || h.vfo) plan.provision.push({ id: h.id, name: nameOf(h), tier: h.serviceTier });
      continue;
    }
    if (!h.vaultFolder) { plan.legacy.push({ id: h.id, name: nameOf(h) }); continue; }
    const missing = people.filter((p) => p.householdId === h.id && !p.personalDrawer && hasPersonalDrawerRole(p.role, p.isMinor)).length;
    if (missing) plan.drawers.push({ id: h.id, name: nameOf(h), missing });
  }
  // A VFO family shares a Family Vault; it needs at least one household Vault to hang from.
  for (const f of families) {
    if (f.vfo && !f.vaultRoot && households.some((h) => h.familyId === f.id && !h.relationshipEnded && h.vaultRoot)) plan.familyVaults.push({ id: f.id, name: f.name ?? "Family" });
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  plan.familyVaults.sort(byName);
  plan.provision.sort(byName); plan.legacy.sort(byName); plan.drawers.sort(byName);
  return plan;
}
