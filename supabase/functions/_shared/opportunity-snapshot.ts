// opportunity-snapshot.ts: builds the HouseholdSnapshot the opportunity rules read. Reads only.
// The rules (opportunity-rules.ts) stay pure; every query for the book-of-business diagnostic lives here.

import { computeSbdClawback, computeStorehouseFundedPct, gatherHouseholdFinancials } from "./sovereignty-diagnostics.ts";
import { classifyTier, computeGroupedAum, computeHouseholdAum, hasFamilyInsurancePolicy, hasFamilyRatifiedCharter, hasHouseholdInsurancePolicy } from "./service-tiering.ts";
import { isPooledFamily } from "./review-units.ts";
import type { HouseholdSnapshot } from "./opportunity-rules.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const named = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export async function buildSnapshot(db: SupabaseClient, householdId: string): Promise<HouseholdSnapshot> {
  const fin = await gatherHouseholdFinancials(db, householdId);
  const memberIds = fin.members.map((m) => m.id);

  const { data: hhRow } = await db.from("households").select("family_id, service_tier").eq("id", householdId).maybeSingle();
  const { data: contactRows } = memberIds.length
    ? await db.from("contacts").select("id, family_id, is_minor, lawyer_name, executor_name, poa_name").in("id", memberIds)
    : { data: [] };
  // deno-lint-ignore no-explicit-any
  const contacts = (contactRows ?? []) as any[];
  const familyId: string | null = hhRow?.family_id ?? contacts.find((c) => c.family_id)?.family_id ?? null;
  const minorById = new Map(contacts.map((c) => [c.id, c.is_minor === true]));
  const { data: family } = familyId ? await db.from("families").select("name, service_tier, service_tier_source, vfo_enabled").eq("id", familyId).maybeSingle() : { data: null };

  let hasRatifiedCharter = false;
  if (familyId) hasRatifiedCharter = await hasFamilyRatifiedCharter(db, familyId);
  else if (memberIds.length) {
    const { data } = await db.from("sovereignty_charters").select("draft_status, esign_status").in("contact_id", memberIds);
    // deno-lint-ignore no-explicit-any
    hasRatifiedCharter = ((data ?? []) as any[]).some((c) => c.draft_status === "ratified" || c.esign_status === "ratified");
  }
  // The tier engine's rule: a family is tiered as a whole only when something binds it (a ratified Charter, a VFO, or a tier set by hand);
  // otherwise each household stands alone and is tiered on its own assets.
  const pooled = !!familyId && isPooledFamily({ has_ratified_charter: hasRatifiedCharter, vfo_enabled: family?.vfo_enabled, service_tier_source: family?.service_tier_source });

  const [householdAum, familyAum, insured, { data: needsRows }, { data: charterRows }, { data: engagements }] = await Promise.all([
    computeHouseholdAum(db, householdId),
    pooled ? computeGroupedAum(db, familyId!) : Promise.resolve(null),
    pooled ? hasFamilyInsurancePolicy(db, familyId!) : hasHouseholdInsurancePolicy(db, householdId),
    memberIds.length
      ? db.from("insurance_needs_analyses").select("contact_id, results, created_at").in("contact_id", memberIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    db.from("household_charters").select("corporate_passive_income_annual, updated_at").eq("household_id", householdId).order("updated_at", { ascending: false }).limit(1),
    // A lawyer recorded as an engagement (legal or estate pillar) counts as much as one named on a contact.
    db.from("professional_engagements").select("id").in("pillar", ["legal", "estate"]).or(
      [`and(scope_type.eq.household,scope_id.eq.${householdId})`, ...(memberIds.length ? [`and(scope_type.eq.contact,scope_id.in.(${memberIds.join(",")}))`] : []), ...(familyId ? [`and(scope_type.eq.family,scope_id.eq.${familyId})`] : [])].join(","),
    ).limit(1),
  ]);
  const groupedAum = pooled ? (familyAum ?? 0) : householdAum;
  // What staff see is the recorded tier (it honours a tier set by hand); only when none is recorded is it worked out here.
  const storedTier: string | null = (pooled ? family?.service_tier : hhRow?.service_tier) ?? null;
  const computedTier = pooled
    ? classifyTier({ groupedAum, hasRatifiedCharter, hasInsurancePolicy: insured })
    : householdAum <= 0 && !insured ? null : classifyTier({ groupedAum, hasRatifiedCharter: false, hasInsurancePolicy: insured });
  const tier = storedTier ?? computedTier;
  const hasLegalEngagement = (engagements ?? []).length > 0;

  const nameOf = new Map(fin.members.map((m) => [m.id, [m.first_name, m.last_name].filter(Boolean).join(" ")]));
  const passive = charterRows?.[0]?.corporate_passive_income_annual;
  const corporatePassiveIncome = passive === null || passive === undefined ? null : Number(passive);
  const reserveTargets = computeStorehouseFundedPct(fin.storehouses, fin.storehouseReserves).targets;

  return {
    householdId,
    label: fin.householdLabel,
    members: fin.members.map((m) => ({
      id: m.id,
      name: nameOf.get(m.id) ?? "",
      role: m.family_role,
      isMinor: minorById.get(m.id) === true || m.family_role === "minor",
    })),
    familyId,
    familyName: family?.name ?? null,
    pooled,
    familyAum: pooled ? familyAum : null,
    householdAum,
    groupedAum,
    // Set by assignAnchors once every household in the run is known.
    isFamilyAnchor: true,
    totalAum: fin.totalAum,
    tier,
    tierOnRecord: storedTier !== null,
    hasRatifiedCharter,
    // deno-lint-ignore no-explicit-any
    accounts: fin.vineyardAccounts.map((a: any) => ({
      id: a.id, name: a.account_name, type: a.account_type ?? null, value: Number(a.current_value) || 0,
      custodian: a.custodian ?? null, beneficiary: a.beneficiary_designation ?? null, owner: nameOf.get(a.contact_id) ?? "",
    })),
    // deno-lint-ignore no-explicit-any
    policies: fin.insurancePolicies.map((p: any) => ({
      id: p.id, type: p.policy_type, coverage: Number(p.coverage_amount) || 0, cashValue: Number(p.cash_value) || 0,
      renewalDate: p.renewal_date ?? null, insuredContactId: p.contact_id ?? null, corporate: !!p.corporation_id,
    })),
    lifeCoverage: fin.insuranceCoverageByKind.life,
    // deno-lint-ignore no-explicit-any
    needs: ((needsRows ?? []) as any[]).map((n) => ({
      contactId: n.contact_id, need: Number(n.results?.need) || 0, available: Number(n.results?.available) || 0,
      shortfall: Number(n.results?.shortfall) || 0, createdAt: n.created_at,
    })),
    // deno-lint-ignore no-explicit-any
    debts: fin.liabilities.map((l: any) => ({ id: l.id, type: l.liability_type, balance: Number(l.current_balance) || 0, corporate: l.holder_type === "corporation" })),
    // deno-lint-ignore no-explicit-any
    corporations: fin.corporations.map((c: any) => ({ id: c.id, name: c.name, totalAssets: c.total_assets })),
    corporatePassiveIncome,
    sbdClawback: corporatePassiveIncome === null ? null : computeSbdClawback(corporatePassiveIncome),
    holdingTank: fin.totalHoldingTank,
    liquidityReserve: fin.storehouseReserves.liquidity,
    liquidityTarget: reserveTargets.liquidity,
    professionals: {
      lawyer: hasLegalEngagement || contacts.some((c) => named(c.lawyer_name)),
      executor: contacts.some((c) => named(c.executor_name)),
      poa: contacts.some((c) => named(c.poa_name)),
    },
  };
}
