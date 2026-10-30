// opportunity-snapshot.ts: builds the HouseholdSnapshot the opportunity rules read. Reads only.
// The rules (opportunity-rules.ts) stay pure; every query for the book-of-business diagnostic lives here.

import { computeSbdClawback, computeStorehouseFundedPct, gatherHouseholdFinancials } from "./sovereignty-diagnostics.ts";
import { classifyTier, computeGroupedAum, computeHouseholdAum, hasFamilyRatifiedCharter } from "./service-tiering.ts";
import type { HouseholdSnapshot } from "./opportunity-rules.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const named = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export async function buildSnapshot(db: SupabaseClient, householdId: string): Promise<HouseholdSnapshot> {
  const fin = await gatherHouseholdFinancials(db, householdId);
  const memberIds = fin.members.map((m) => m.id);

  const { data: contactRows } = memberIds.length
    ? await db.from("contacts").select("id, family_id, is_minor, lawyer_name, executor_name, poa_name").in("id", memberIds)
    : { data: [] };
  // deno-lint-ignore no-explicit-any
  const contacts = (contactRows ?? []) as any[];
  const familyId: string | null = contacts.find((c) => c.family_id)?.family_id ?? null;
  const minorById = new Map(contacts.map((c) => [c.id, c.is_minor === true]));

  const [groupedAum, { data: needsRows }, { data: charterRows }] = await Promise.all([
    familyId ? computeGroupedAum(db, familyId) : computeHouseholdAum(db, householdId),
    memberIds.length
      ? db.from("insurance_needs_analyses").select("contact_id, results, created_at").in("contact_id", memberIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    db.from("household_charters").select("corporate_passive_income_annual, updated_at").eq("household_id", householdId).order("updated_at", { ascending: false }).limit(1),
  ]);

  let hasRatifiedCharter = false;
  if (familyId) hasRatifiedCharter = await hasFamilyRatifiedCharter(db, familyId);
  else if (memberIds.length) {
    const { data } = await db.from("sovereignty_charters").select("draft_status, esign_status").in("contact_id", memberIds);
    // deno-lint-ignore no-explicit-any
    hasRatifiedCharter = ((data ?? []) as any[]).some((c) => c.draft_status === "ratified" || c.esign_status === "ratified");
  }

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
    groupedAum,
    totalAum: fin.totalAum,
    tier: classifyTier({ groupedAum, hasRatifiedCharter, hasInsurancePolicy: fin.insurancePolicies.length > 0 }),
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
      lawyer: contacts.some((c) => named(c.lawyer_name)),
      executor: contacts.some((c) => named(c.executor_name)),
      poa: contacts.some((c) => named(c.poa_name)),
    },
  };
}
