// sovereignty-diagnostics.ts
// Deterministic (non-AI) financial/document diagnostics for the household-track
// Sovereignty Survey Stabilization Map. Pure functions + Supabase queries only —
// no HTTP/CORS handling — so this stays independently testable and reusable.
//
// Numbers here are computed in code, never by the AI: the generation edge
// function hands these figures to Vertex as read-only facts and only asks it
// to draft narrative text around them (situation summary, action plan prose).

import { getServiceGoogleAccessToken } from "./google-token.ts";
import { driveListChildren, matchVaultCategoryFolder } from "./vault-provisioning.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type TrackType = "personal" | "corporate";

export interface DiagnosticInputs {
  assumed_return_rate_pct?: number;
  advisor_fee_rate_pct?: number;
  benchmark_fee_rate_pct?: number;
  corporate_passive_income_annual?: number;
  active_operational_assets_value?: number;
  usa_last_reviewed_date?: string | null;
  usa_funded?: boolean | null;
  will_status?: "missing" | "outdated" | "current" | null;
  poa_status?: "missing" | "current" | null;
  beneficiary_coordination_status?: "uncoordinated" | "coordinated" | null;
}

export interface FeeDragResult {
  year5: number;
  year10: number;
  year20: number;
  fee_drag_pct: number;
}

/** True when the household has any active shareholder — i.e. owns a corporation. */
export function inferTrackType(shareholders: { corporation_id: string }[]): TrackType {
  return shareholders.length > 0 ? "corporate" : "personal";
}

/** Compounded Fee Drag = AUM × [(1+r)^t − (1+r−feeDrag)^t] */
export function computeFeeDrag(aum: number, inputs: DiagnosticInputs): FeeDragResult {
  const r = (inputs.assumed_return_rate_pct ?? 6) / 100;
  const advisorFee = (inputs.advisor_fee_rate_pct ?? 0) / 100;
  const benchmarkFee = (inputs.benchmark_fee_rate_pct ?? 0) / 100;
  const feeDrag = Math.max(0, advisorFee - benchmarkFee);
  const at = (t: number) => aum * (Math.pow(1 + r, t) - Math.pow(1 + r - feeDrag, t));
  return {
    year5: Math.round(at(5)),
    year10: Math.round(at(10)),
    year20: Math.round(at(20)),
    fee_drag_pct: Math.round(feeDrag * 10000) / 100,
  };
}

/** SBD Clawback = min($500,000, 5 × max(0, passiveIncome − $50,000)) */
export function computeSbdClawback(passiveIncomeAnnual: number): number {
  return Math.min(500_000, Math.max(0, 5 * (passiveIncomeAnnual - 50_000)));
}

/** Active Asset Ratio = activeAssets / totalCorpAssets — must be ≥90% for LCGE eligibility. */
export function computeActiveAssetRatio(
  activeAssets: number,
  totalCorpAssets: number,
): { ratio: number; belowLcgeThreshold: boolean } {
  const ratio = totalCorpAssets > 0 ? activeAssets / totalCorpAssets : 0;
  return { ratio: Math.round(ratio * 10000) / 10000, belowLcgeThreshold: ratio < 0.9 };
}

/** A USA is stale if no review date is on file, or it was last reviewed >2 years ago. */
export function computeUsaStaleness(
  usaLastReviewedDate: string | null | undefined,
): { onFile: boolean; isStale: boolean; ageYears: number | null } {
  if (!usaLastReviewedDate) return { onFile: false, isStale: true, ageYears: null };
  const reviewed = new Date(usaLastReviewedDate);
  if (Number.isNaN(reviewed.getTime())) return { onFile: false, isStale: true, ageYears: null };
  const ageYears = (Date.now() - reviewed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return { onFile: true, isStale: ageYears > 2, ageYears: Math.round(ageYears * 10) / 10 };
}

/** A family values addendum is stale if never signed, or its most recent
 *  affirmation (reaffirmed_at if present, else signed_at) is >3 years old —
 *  mirrors computeUsaStaleness's >2-year pattern for the doc's own cadence. */
export function computeValuesAddendumStaleness(
  signedAt: string | null | undefined,
  reaffirmedAt: string | null | undefined,
): { onFile: boolean; isStale: boolean; ageYears: number | null } {
  const lastAffirmed = reaffirmedAt || signedAt;
  if (!lastAffirmed) return { onFile: false, isStale: true, ageYears: null };
  const affirmed = new Date(lastAffirmed);
  if (Number.isNaN(affirmed.getTime())) return { onFile: false, isStale: true, ageYears: null };
  const ageYears = (Date.now() - affirmed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return { onFile: true, isStale: ageYears > 3, ageYears: Math.round(ageYears * 10) / 10 };
}

export interface DocumentReadiness {
  percent: number;
  criticalTotal: number;
  criticalSatisfied: number;
  missingCritical: string[];
  missingRecommended: string[];
}

/**
 * Mirrors the readiness calculation in intake-portal/index.ts's handleInhouseManifest
 * (intake_checklist_templates matched against intake_classifications by household).
 */
export async function computeDocumentReadiness(
  admin: SupabaseClient,
  householdId: string,
): Promise<DocumentReadiness> {
  const [{ data: templates }, { data: classifications }] = await Promise.all([
    admin
      .from("intake_checklist_templates")
      .select("id, name, category, requirement")
      .eq("is_active", true)
      .order("sort_order"),
    admin
      .from("intake_classifications")
      .select("id, file_name, predicted_category, status, matched_checklist_template_id")
      .eq("household_id", householdId),
  ]);

  const activeTemplates = (templates ?? []) as any[];
  const classRows = (classifications ?? []) as any[];

  const matchedByTemplate = new Map<string, any[]>();
  for (const cls of classRows) {
    const lowerFile = String(cls.file_name || "").toLowerCase();
    let best: any = null;
    let bestScore = 0;
    for (const t of activeTemplates) {
      const nameTokens = String(t.name).toLowerCase().split(/\s+/);
      let score = 0;
      for (const token of nameTokens) {
        if (token.length > 2 && lowerFile.includes(token)) score += 1;
      }
      if (String(cls.predicted_category).toLowerCase() === String(t.name).toLowerCase()) score += 5;
      if (cls.matched_checklist_template_id === t.id) score += 10;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best) {
      const list = matchedByTemplate.get(best.id) ?? [];
      list.push(cls);
      matchedByTemplate.set(best.id, list);
    }
  }

  const checklist = activeTemplates.map((t) => {
    const matches = matchedByTemplate.get(t.id) ?? [];
    const filed = matches.some((c) => c.status === "filed");
    return {
      name: t.name as string,
      requirement: t.requirement === "required" ? "required" : "optional",
      filed,
    };
  });

  const requiredItems = checklist.filter((i) => i.requirement === "required");
  const requiredSatisfied = requiredItems.filter((i) => i.filed).length;
  const totalItems = checklist.length;
  const satisfiedTotal = checklist.filter((i) => i.filed).length;
  const percent = totalItems > 0 ? Math.round((satisfiedTotal / totalItems) * 100) : 0;

  return {
    percent,
    criticalTotal: requiredItems.length,
    criticalSatisfied: requiredSatisfied,
    missingCritical: requiredItems.filter((i) => !i.filed).map((i) => i.name),
    missingRecommended: checklist.filter((i) => i.requirement !== "required" && !i.filed).map((i) => i.name),
  };
}

/** Vault folder categories that count toward readiness for legacy/existing clients. */
export const VAULT_READINESS_SLUGS = ["identity-legal", "estate", "tax", "insurance", "investments"];

/**
 * Document readiness for legacy/existing clients, sourced live from the household's
 * Vault (Drive) folder tree instead of the intake-portal pipeline used by
 * computeDocumentReadiness above (which only the newer onboarding funnel populates,
 * and is structurally empty — always 0% — for any client who predates it).
 *
 * Checks the same folder categories staff already see in the CRM's Vault tab
 * (vault_folder_templates), so this can never drift stale the way a cached or
 * advisor-re-typed signal would. `slugs` defaults to VAULT_READINESS_SLUGS but
 * callers (e.g. the Charter's Vault Protocol check) can pass an extended list —
 * e.g. adding "business" for corporate-track households.
 */
export async function computeVaultReadiness(
  admin: SupabaseClient,
  vaultRootFolderId: string | null,
  slugs: string[] = VAULT_READINESS_SLUGS,
): Promise<DocumentReadiness> {
  const unavailable = (categories: { display_name: string }[]): DocumentReadiness => ({
    percent: 0,
    criticalTotal: categories.length,
    criticalSatisfied: 0,
    missingCritical: categories.map((c) => `${c.display_name} (Vault not yet assessed — advisor to confirm)`),
    missingRecommended: [],
  });

  if (!vaultRootFolderId) {
    return {
      percent: 0,
      criticalTotal: 0,
      criticalSatisfied: 0,
      missingCritical: ["Vault not yet provisioned — advisor to confirm manually"],
      missingRecommended: [],
    };
  }

  const { data: templates } = await admin
    .from("vault_folder_templates")
    .select("display_name, slug")
    .eq("is_active", true)
    .in("slug", slugs);
  const categories = (templates ?? []) as { display_name: string; slug: string }[];
  if (categories.length === 0) {
    return { percent: 0, criticalTotal: 0, criticalSatisfied: 0, missingCritical: [], missingRecommended: [] };
  }

  let accessToken: string;
  let rootChildren: { id: string; name: string; mimeType: string }[];
  try {
    accessToken = await getServiceGoogleAccessToken(admin);
    rootChildren = await driveListChildren(vaultRootFolderId, accessToken);
  } catch {
    return unavailable(categories);
  }

  const satisfied: string[] = [];
  const missing: string[] = [];

  for (const cat of categories) {
    const folder = matchVaultCategoryFolder(rootChildren, cat.display_name);

    if (!folder) {
      missing.push(cat.display_name);
      continue;
    }

    try {
      const contents = await driveListChildren(folder.id, accessToken);
      if (contents.length > 0) satisfied.push(cat.display_name);
      else missing.push(cat.display_name);
    } catch {
      missing.push(`${cat.display_name} (Vault check unavailable — advisor to confirm manually)`);
    }
  }

  const criticalTotal = categories.length;
  const criticalSatisfied = satisfied.length;
  const percent = criticalTotal > 0 ? Math.round((criticalSatisfied / criticalTotal) * 100) : 0;

  return { percent, criticalTotal, criticalSatisfied, missingCritical: missing, missingRecommended: [] };
}

export interface StorehouseReserves {
  liquidity: number;
  strategic: number;
  philanthropic: number;
  legacy: number;
}

export interface LoanFlag {
  id: string;
  description: string;
  liability_type: string;
  current_balance: number;
  due_date: string | null;
  isOverdue: boolean;
  isDueSoon: boolean;
}

/**
 * Flags intercompany/shareholder loans approaching or past their due date —
 * the classic CRA s.15(2) trap (a loan from a corp to a shareholder must be
 * repaid within one year after the corp's fiscal year-end or it's deemed
 * income). Deliberately generic over any liabilities array, not tied to the
 * household-track Stabilization Map, so the Quarterly VFO Audit Agent can
 * reuse this same helper later instead of reimplementing the check.
 */
export function computeIntercompanyLoanFlags(liabilities: any[], asOf: Date = new Date()): LoanFlag[] {
  const DUE_SOON_DAYS = 60;
  return liabilities
    .filter((l: any) => l.liability_type === "intercompany_loan" || l.liability_type === "shareholder_loan")
    .map((l: any) => {
      const dueDate = l.due_date ? new Date(l.due_date) : null;
      const isOverdue = dueDate !== null && dueDate.getTime() < asOf.getTime();
      const isDueSoon =
        dueDate !== null &&
        !isOverdue &&
        (dueDate.getTime() - asOf.getTime()) / (24 * 60 * 60 * 1000) <= DUE_SOON_DAYS;
      return {
        id: l.id,
        description: l.description,
        liability_type: l.liability_type,
        current_balance: Number(l.current_balance) || 0,
        due_date: l.due_date ?? null,
        isOverdue,
        isDueSoon,
      };
    })
    .filter((f) => f.isOverdue || f.isDueSoon);
}

const REAL_ESTATE_ASSET_TYPE = "Primary Residence & Protected Legacy Accounts";
const RESERVE_KEY_BY_STOREHOUSE_NUMBER: Record<number, keyof StorehouseReserves> = {
  1: "liquidity",
  2: "strategic",
  3: "philanthropic",
  4: "legacy",
};

/**
 * Per-pillar funding target (summed from storehouses.target_value, the
 * existing field HouseholdDetail.tsx's own "% funded" progress bars already
 * use) against the same live reserve totals gatherHouseholdFinancials
 * computes. Zero extra queries -- reuses the storehouses rows already
 * fetched for `reserves`. A pillar with no target_value set anywhere
 * returns null funded-% (nothing to show), not a misleading 0%.
 */
export function computeStorehouseFundedPct(
  storehouses: any[],
  reserves: StorehouseReserves,
): { targets: StorehouseReserves; fundedPct: Record<keyof StorehouseReserves, number | null> } {
  const targets: StorehouseReserves = { liquidity: 0, strategic: 0, philanthropic: 0, legacy: 0 };
  for (const s of storehouses) {
    if (s.asset_type === REAL_ESTATE_ASSET_TYPE) continue;
    const key = RESERVE_KEY_BY_STOREHOUSE_NUMBER[s.storehouse_number];
    if (!key) continue;
    targets[key] += Number(s.target_value) || 0;
  }
  const fundedPct = {} as Record<keyof StorehouseReserves, number | null>;
  (Object.keys(targets) as (keyof StorehouseReserves)[]).forEach((key) => {
    fundedPct[key] = targets[key] > 0 ? Math.min((reserves[key] / targets[key]) * 100, 100) : null;
  });
  return { targets, fundedPct };
}

export interface HouseholdFinancials {
  householdLabel: string;
  familyName: string;
  members: { id: string; first_name: string; last_name: string; family_role: string | null }[];
  totalAum: number;
  vineyardAccounts: any[];
  totalVineyard: number;
  storehouses: any[];
  corporations: any[];
  shareholders: any[];
  insurancePolicies: any[];
  totalCorpAssets: number;
  holdingTank: any[];
  totalHoldingTank: number;
  onboardingEnabled: boolean;
  /** True for a never-onboarded legacy household, OR one staff enrolled via
   *  "Enroll in Guided Intake" (legacy_intake_upgrade) — flips onboardingEnabled
   *  true but the household is still fundamentally a legacy client whose real
   *  document trail lives in the Vault, not the newer intake pipeline. */
  isLegacyClient: boolean;
  vaultRootFolderId: string | null;
  storehouseReserves: StorehouseReserves;
  totalInsuranceCoverage: number;
  liabilities: any[];
  totalPersonalLiabilities: number;
  totalCorpLiabilities: number;
  netWorth: number;
}

/** Mirrors the financial-data gathering in HouseholdDetail.tsx's fetchData(). */
export async function gatherHouseholdFinancials(
  admin: SupabaseClient,
  householdId: string,
): Promise<HouseholdFinancials> {
  const { data: household } = await admin
    .from("households")
    .select("id, label, family_id, onboarding_enabled, legacy_intake_upgrade, vault_root_folder_id")
    .eq("id", householdId)
    .maybeSingle();
  const isLegacyClient = household?.legacy_intake_upgrade === true || household?.onboarding_enabled === false;

  const { data: family } = household?.family_id
    ? await admin.from("families").select("name").eq("id", household.family_id).maybeSingle()
    : { data: null };

  const { data: contacts } = await admin
    .from("contacts")
    .select("id, first_name, last_name, family_role")
    .eq("household_id", householdId);

  const members = (contacts ?? []) as HouseholdFinancials["members"];
  const memberIds = members.map((c) => c.id);

  if (memberIds.length === 0) {
    return {
      householdLabel: household?.label ?? "Household",
      familyName: family?.name ?? "Family",
      members: [],
      totalAum: 0,
      vineyardAccounts: [],
      totalVineyard: 0,
      storehouses: [],
      corporations: [],
      shareholders: [],
      insurancePolicies: [],
      totalCorpAssets: 0,
      holdingTank: [],
      totalHoldingTank: 0,
      onboardingEnabled: household?.onboarding_enabled !== false,
      isLegacyClient,
      vaultRootFolderId: household?.vault_root_folder_id ?? null,
      storehouseReserves: { liquidity: 0, strategic: 0, philanthropic: 0, legacy: 0 },
      totalInsuranceCoverage: 0,
      liabilities: [],
      totalPersonalLiabilities: 0,
      totalCorpLiabilities: 0,
      netWorth: 0,
    };
  }

  const [{ data: vine }, { data: store }, { data: shareholders }, { data: tank }, { data: personalLiab }] =
    await Promise.all([
      admin.from("vineyard_accounts").select("*").in("contact_id", memberIds),
      admin.from("storehouses").select("*").in("contact_id", memberIds),
      admin
        .from("shareholders")
        .select("contact_id, corporation_id, ownership_percentage, share_class, role_title")
        .in("contact_id", memberIds)
        .eq("is_active", true),
      admin
        .from("holding_tank")
        .select("id, contact_id, account_name, current_value, created_at")
        .in("contact_id", memberIds)
        .neq("status", "moved"),
      admin.from("liabilities").select("*").eq("holder_type", "contact").in("contact_id", memberIds),
    ]);

  const vineyardAccounts = vine ?? [];
  const storehouses = store ?? [];
  const shareholderRows = shareholders ?? [];
  const holdingTank = tank ?? [];
  const personalLiabilities = personalLiab ?? [];

  let corporations: any[] = [];
  let totalCorpAssets = 0;
  let totalCorpLiabilities = 0;
  let corpLiabilities: any[] = [];
  let corpIds: string[] = [];
  if (shareholderRows.length > 0) {
    corpIds = [...new Set(shareholderRows.map((s: any) => s.corporation_id))];
    const [{ data: corps }, { data: corpVineyard }, { data: corpLiab }] = await Promise.all([
      admin.from("corporations").select("id, name, corporation_type, jurisdiction").in("id", corpIds),
      admin.from("corporate_vineyard_accounts").select("*").in("corporation_id", corpIds),
      admin.from("liabilities").select("*").eq("holder_type", "corporation").in("corporation_id", corpIds),
    ]);
    corpLiabilities = corpLiab ?? [];
    corporations = (corps ?? []).map((corp: any) => {
      const accounts = (corpVineyard ?? []).filter((v: any) => v.corporation_id === corp.id);
      const liabs = corpLiabilities.filter((l: any) => l.corporation_id === corp.id);
      const total_assets = accounts.reduce((sum: number, v: any) => sum + (Number(v.current_value) || 0), 0);
      const total_liabilities = liabs.reduce((sum: number, l: any) => sum + (Number(l.current_balance) || 0), 0);
      return {
        ...corp,
        shareholders: shareholderRows.filter((s: any) => s.corporation_id === corp.id),
        vineyard_accounts: accounts,
        liabilities: liabs,
        total_assets,
        total_liabilities,
        net_assets: total_assets - total_liabilities,
      };
    });
    totalCorpAssets = corporations.reduce((sum, c) => sum + c.total_assets, 0);
    totalCorpLiabilities = corporations.reduce((sum, c) => sum + c.total_liabilities, 0);
  }

  const liabilities = [...personalLiabilities, ...corpLiabilities];
  const totalPersonalLiabilities = personalLiabilities.reduce(
    (sum: number, l: any) => sum + (Number(l.current_balance) || 0),
    0,
  );

  const { data: ins } = await admin
    .from("insurance_policies")
    .select("*")
    .or(`contact_id.in.(${memberIds.join(",")})${corpIds.length ? `,corporation_id.in.(${corpIds.join(",")})` : ""}`);
  const insurancePolicies = ins ?? [];

  const totalHoldingTank = holdingTank.reduce((sum: number, h: any) => sum + (Number(h.current_value) || 0), 0);

  // Mirrors HouseholdDetail.tsx's totalStorehouses exactly: excludes real-estate
  // placeholder rows and folds in insurance cash values booked against a storehouse,
  // grouped by the household's 4 canonical reserves (storehouse_number 1-4).
  const insuranceCashForStorehouse = (storehouseId: string) =>
    insurancePolicies.reduce(
      (sum: number, p: any) => sum + (p.cash_value_storehouse_id === storehouseId ? Number(p.cash_value) || 0 : 0),
      0,
    );
  const storehouseReserves: StorehouseReserves = { liquidity: 0, strategic: 0, philanthropic: 0, legacy: 0 };
  for (const s of storehouses) {
    if (s.asset_type === REAL_ESTATE_ASSET_TYPE) continue;
    const key = RESERVE_KEY_BY_STOREHOUSE_NUMBER[s.storehouse_number];
    if (!key) continue;
    storehouseReserves[key] += (Number(s.current_value) || 0) + insuranceCashForStorehouse(s.id);
  }
  const totalStorehouses =
    storehouseReserves.liquidity + storehouseReserves.strategic + storehouseReserves.philanthropic + storehouseReserves.legacy;

  const totalInsuranceCoverage = insurancePolicies.reduce(
    (sum: number, p: any) => sum + (Number(p.coverage_amount) || 0),
    0,
  );

  const totalVineyard = vineyardAccounts.reduce((sum: number, a: any) => sum + (Number(a.current_value) || 0), 0);

  const totalAum = totalVineyard + totalStorehouses + totalCorpAssets + totalHoldingTank;
  const netWorth = totalAum - totalPersonalLiabilities - totalCorpLiabilities;

  return {
    householdLabel: household?.label ?? "Household",
    familyName: family?.name ?? "Family",
    members,
    totalAum,
    vineyardAccounts,
    totalVineyard,
    storehouses,
    corporations,
    shareholders: shareholderRows,
    insurancePolicies,
    totalCorpAssets,
    holdingTank,
    totalHoldingTank,
    onboardingEnabled: household?.onboarding_enabled !== false,
    isLegacyClient,
    vaultRootFolderId: household?.vault_root_folder_id ?? null,
    storehouseReserves,
    totalInsuranceCoverage,
    liabilities,
    totalPersonalLiabilities,
    totalCorpLiabilities,
    netWorth,
  };
}

export interface SovereigntyDiagnostics {
  track_type: TrackType;
  document_readiness: DocumentReadiness;
  fee_drag?: FeeDragResult;
  sbd_clawback?: number;
  active_asset_ratio?: { ratio: number; belowLcgeThreshold: boolean };
  usa_staleness?: { onFile: boolean; isStale: boolean; ageYears: number | null };
  estate_hygiene?: {
    will_status: DiagnosticInputs["will_status"];
    poa_status: DiagnosticInputs["poa_status"];
    beneficiary_coordination_status: DiagnosticInputs["beneficiary_coordination_status"];
  };
  aum: number;
  household_label: string;
  family_name: string;
  storehouse_reserves: StorehouseReserves;
  insurance_coverage_total: number;
  vineyard_total: number;
  holding_tank_total: number;
  net_worth: number;
  personal_liabilities_total: number;
  corp_liabilities_total: number;
  corporations: { id: string; name: string; total_assets: number; total_liabilities: number; net_assets: number }[];
  intercompany_loan_flags?: LoanFlag[];
}

/** Orchestrator: gathers real data, infers track type, computes the applicable formulas. */
export async function computeSovereigntyDiagnostics(
  admin: SupabaseClient,
  householdId: string,
  inputs: DiagnosticInputs,
): Promise<{ track_type: TrackType; diagnostics: SovereigntyDiagnostics; financials: HouseholdFinancials }> {
  const financials = await gatherHouseholdFinancials(admin, householdId);
  const documentReadiness = financials.isLegacyClient
    ? await computeVaultReadiness(admin, financials.vaultRootFolderId)
    : await computeDocumentReadiness(admin, householdId);

  const trackType = inferTrackType(financials.shareholders);

  const diagnostics: SovereigntyDiagnostics = {
    track_type: trackType,
    document_readiness: documentReadiness,
    aum: financials.totalAum,
    household_label: financials.householdLabel,
    family_name: financials.familyName,
    storehouse_reserves: financials.storehouseReserves,
    insurance_coverage_total: financials.totalInsuranceCoverage,
    vineyard_total: financials.totalVineyard,
    holding_tank_total: financials.totalHoldingTank,
    net_worth: financials.netWorth,
    personal_liabilities_total: financials.totalPersonalLiabilities,
    corp_liabilities_total: financials.totalCorpLiabilities,
    corporations: financials.corporations.map((c: any) => ({
      id: c.id,
      name: c.name,
      total_assets: c.total_assets,
      total_liabilities: c.total_liabilities,
      net_assets: c.net_assets,
    })),
  };

  // Fee drag is paused (not just hidden) until CRM3's fee-disclosure data feeds
  // advisor_fee_rate_pct/benchmark_fee_rate_pct — without it computeFeeDrag always
  // returns a meaningless 0%/$0, not a real diagnostic. computeFeeDrag itself stays
  // defined and ready to re-enable once that data exists.
  if (trackType === "corporate") {
    diagnostics.sbd_clawback = computeSbdClawback(inputs.corporate_passive_income_annual ?? 0);
    diagnostics.active_asset_ratio = computeActiveAssetRatio(
      inputs.active_operational_assets_value ?? 0,
      financials.totalCorpAssets,
    );
    diagnostics.usa_staleness = computeUsaStaleness(inputs.usa_last_reviewed_date);
    diagnostics.intercompany_loan_flags = computeIntercompanyLoanFlags(financials.liabilities);
  } else {
    diagnostics.estate_hygiene = {
      will_status: inputs.will_status ?? null,
      poa_status: inputs.poa_status ?? null,
      beneficiary_coordination_status: inputs.beneficiary_coordination_status ?? null,
    };
  }

  return { track_type: trackType, diagnostics, financials };
}
