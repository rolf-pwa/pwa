// service-tiering.ts
// Deterministic (non-AI) Client Service Tier classification. Pure functions +
// Supabase queries only -- no HTTP/CORS handling -- so this stays
// independently testable and reusable, matching sovereignty-diagnostics.ts's
// convention.
//
// Source: "Legacy Client Service Tier & Review Cadence Matrix" (Google Doc,
// id 1uE1h4OYRVZKRzZD3k4PLh_O1BluWZV3iwTZrFPOk9P0). Tier pools across a
// whole family grouping (family_id), not a single household -- reuses the
// pooling pattern already established in FamilyRollup.tsx (households +
// contacts by family_id, sum accounts across every contact id), extended
// with a custodian filter and corporate/holding-tank accounts, neither of
// which FamilyRollup.tsx's existing "Total Family Assets" figure includes.
// grouped_aum_cad is therefore a different, narrower number than
// families.total_family_assets -- don't conflate the two in the UI.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type ServiceTier = "tier_0" | "tier_1" | "tier_2a" | "tier_2b" | "tier_3" | "tier_4";

const MANAGED_CUSTODIANS = ["iA Financial Group", "JustWealth"];

/**
 * Six-tier classification, purely from grouped AUM + charter status.
 * 2A vs 2B is not a separate AUM band -- both are $250k-$750k; ratified
 * Charter status is the only differentiator (confirmed against the source
 * doc directly, not the lossy roadmap-artifact summary that implied an
 * "AUM crosses $250k" auto-upgrade trigger for 2B->2A).
 *
 * Tier 0 detection is inferred, not stated as a formula in the source doc:
 * nil grouped AUM with at least one insurance policy on file. Tier 4's "or
 * Track 2/3" carve-out (pre-exit founders regardless of AUM) has no
 * corresponding field anywhere in the schema -- not detected here, left to
 * manual override.
 */
export function classifyTier(input: { groupedAum: number; hasRatifiedCharter: boolean; hasInsurancePolicy: boolean }): ServiceTier {
  const { groupedAum, hasRatifiedCharter, hasInsurancePolicy } = input;
  if (groupedAum <= 0 && hasInsurancePolicy) return "tier_0";
  if (groupedAum < 250_000) return "tier_1";
  if (groupedAum < 750_000) return hasRatifiedCharter ? "tier_2a" : "tier_2b";
  if (groupedAum < 2_000_000) return "tier_3";
  return "tier_4";
}

interface FamilyMember {
  contactId: string;
}

/** Every contact under a family grouping -- the pooling unit for grouped AUM and charter checks alike. */
async function fetchFamilyMembers(db: SupabaseClient, familyId: string): Promise<FamilyMember[]> {
  const { data, error } = await db.from("contacts").select("id").eq("family_id", familyId);
  if (error) throw new Error(`Failed to load family members: ${error.message}`);
  return (data || []).map((c: { id: string }) => ({ contactId: c.id }));
}

/** Corporation ids owned (via any active shareholder link) by any member of this family. */
async function fetchFamilyCorporationIds(db: SupabaseClient, contactIds: string[]): Promise<string[]> {
  if (contactIds.length === 0) return [];
  const { data, error } = await db
    .from("shareholders")
    .select("corporation_id")
    .in("contact_id", contactIds)
    .eq("is_active", true);
  if (error) throw new Error(`Failed to load family corporations: ${error.message}`);
  return [...new Set<string>((data || []).map((s: { corporation_id: string }) => s.corporation_id))];
}

/**
 * Grouped AUM, pooled across the whole family and filtered to accounts
 * directly under ProsperWise management (custodian = iA Financial Group or
 * JustWealth) -- pensions and other assets tracked for visibility only
 * don't count, per the source doc.
 */
export async function computeGroupedAum(db: SupabaseClient, familyId: string): Promise<number> {
  const members = await fetchFamilyMembers(db, familyId);
  const contactIds = members.map((m) => m.contactId);
  if (contactIds.length === 0) return 0;

  const corporationIds = await fetchFamilyCorporationIds(db, contactIds);

  const [vineyardRes, storehouseRes, holdingTankRes, corpVineyardRes] = await Promise.all([
    db.from("vineyard_accounts").select("current_value, custodian").in("contact_id", contactIds),
    db.from("storehouses").select("current_value, custodian").in("contact_id", contactIds),
    db.from("holding_tank").select("current_value, custodian").in("contact_id", contactIds).neq("status", "moved"),
    corporationIds.length
      ? db.from("corporate_vineyard_accounts").select("current_value, custodian").in("corporation_id", corporationIds)
      : Promise.resolve({ data: [] as { current_value: number; custodian: string | null }[] }),
  ]);

  const sumManaged = (rows: { current_value: number; custodian: string | null }[] | null) =>
    (rows || [])
      .filter((r) => r.custodian && MANAGED_CUSTODIANS.includes(r.custodian))
      .reduce((sum, r) => sum + (Number(r.current_value) || 0), 0);

  return (
    sumManaged(vineyardRes.data) +
    sumManaged(storehouseRes.data) +
    sumManaged(holdingTankRes.data) +
    sumManaged(corpVineyardRes.data)
  );
}

/**
 * True if any contact in the family has a ratified Sovereignty Charter.
 * Same "ratified" condition governance-audit-generate/index.ts uses
 * (draft_status/esign_status), but checked across every family member's
 * own charter row, not just the first one found -- governance-audit-
 * generate's .limit(1) only ever inspects one household's members, which
 * for this family-wide check would miss a ratified charter held by a
 * different contact than whichever row sorts first.
 */
export async function hasFamilyRatifiedCharter(db: SupabaseClient, familyId: string): Promise<boolean> {
  const members = await fetchFamilyMembers(db, familyId);
  const contactIds = members.map((m) => m.contactId);
  if (contactIds.length === 0) return false;

  const { data, error } = await db
    .from("sovereignty_charters")
    .select("draft_status, esign_status")
    .in("contact_id", contactIds);
  if (error) throw new Error(`Failed to load charters: ${error.message}`);

  return (data || []).some(
    (c: { draft_status: string | null; esign_status: string | null }) =>
      c.draft_status === "ratified" || c.esign_status === "ratified",
  );
}

/** True if any contact in the family has an insurance policy on file -- the Tier 0 signal. */
export async function hasFamilyInsurancePolicy(db: SupabaseClient, familyId: string): Promise<boolean> {
  const members = await fetchFamilyMembers(db, familyId);
  const contactIds = members.map((m) => m.contactId);
  if (contactIds.length === 0) return false;

  const { count, error } = await db
    .from("insurance_policies")
    .select("id", { count: "exact", head: true })
    .in("contact_id", contactIds);
  if (error) throw new Error(`Failed to check insurance policies: ${error.message}`);
  return (count || 0) > 0;
}
