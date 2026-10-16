// vault-catchup.ts: the one-time catch-up that brings existing households into the Drive Vault structure. Pure (no I/O).
//   provision  an active, tiered household with no Vault at all: build its whole tree
//   drawers    an active household that has a Vault but whose adults lack a personal drawer
// Untiered households (prospects, VFO families tiered as a whole, nothing under management) are left for Rolf to decide.
import { hasPersonalDrawerRole } from "./vault-drawers.ts";

export interface CatchUpHousehold { id: string; label: string | null; familyName: string | null; serviceTier: string | null; relationshipEnded: boolean; vaultRoot: string | null }
export interface CatchUpPerson { householdId: string | null; role: string | null; isMinor: boolean | null; personalDrawer: string | null }
export interface CatchUpPlan {
  provision: { id: string; name: string; tier: string | null }[];
  drawers: { id: string; name: string; missing: number }[];
}

const nameOf = (h: CatchUpHousehold) => (h.familyName && h.label && h.label !== h.familyName ? `${h.familyName}: ${h.label}` : h.familyName ?? h.label ?? "Household");

export function planVaultCatchUp(households: CatchUpHousehold[], people: CatchUpPerson[]): CatchUpPlan {
  const plan: CatchUpPlan = { provision: [], drawers: [] };
  for (const h of households) {
    if (h.relationshipEnded) continue;
    if (!h.vaultRoot) {
      if (h.serviceTier) plan.provision.push({ id: h.id, name: nameOf(h), tier: h.serviceTier });
      continue;
    }
    const missing = people.filter((p) => p.householdId === h.id && !p.personalDrawer && hasPersonalDrawerRole(p.role, p.isMinor)).length;
    if (missing) plan.drawers.push({ id: h.id, name: nameOf(h), missing });
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  plan.provision.sort(byName); plan.drawers.sort(byName);
  return plan;
}
