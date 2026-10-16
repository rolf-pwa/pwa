// stage2-apply.ts: turns an approved (or auto-approved) Stage 2 extraction into the writes that update live records.
// Shared by stage2-review (an advisor approves) and the automatic approval after a Vault scan, so both write the same way.

// deno-lint-ignore-file no-explicit-any
import { planEstateApply, planInsuranceApply, planInvestmentApply, type PlannedWrite } from "./vault-apply.ts";

export interface ApprovalInput {
  kind: "investment" | "insurance" | "estate";
  /** The extraction's accounts / policies / documents, after any corrections. */
  items: Record<string, any>[];
  statementDate: string | null;
  householdId: string;
  source: { drive_id?: string; file_name?: string };
  auditId: string;
  approvedBy: string | null;
}

/** The latest value date held for each account (`table:id`), so an older statement never overwrites a newer monthly value. */
async function latestValueDates(admin: any, memberIds: string[]): Promise<Record<string, string>> {
  if (!memberIds.length) return {};
  const { data } = await admin.from("account_harvest_snapshots").select("holding_tank_id, vineyard_account_id, storehouse_id, snapshot_date").in("contact_id", memberIds);
  const out: Record<string, string> = {};
  for (const s of data ?? []) {
    const key = s.holding_tank_id ? `holding_tank:${s.holding_tank_id}` : s.vineyard_account_id ? `vineyard_accounts:${s.vineyard_account_id}` : s.storehouse_id ? `storehouses:${s.storehouse_id}` : null;
    if (key && (!out[key] || s.snapshot_date > out[key])) out[key] = s.snapshot_date;
  }
  return out;
}

export async function buildApprovalPlan(admin: any, i: ApprovalInput): Promise<PlannedWrite[]> {
  const { data: members } = await admin.from("contacts").select("id, first_name, last_name, family_role").eq("household_id", i.householdId);
  const memberIds = (members ?? []).map((m: any) => m.id);
  if (i.kind === "estate") {
    return planEstateApply(i.items, { householdId: i.householdId, members: members ?? [], driveId: i.source.drive_id ?? null, fileName: i.source.file_name ?? null, auditId: i.auditId, approvedBy: i.approvedBy as string });
  }
  if (i.kind === "investment") {
    const [{ data: vineyard }, { data: storehouses }, { data: tank }, valueDates, { data: moved }] = await Promise.all([
      memberIds.length ? admin.from("vineyard_accounts").select("id, contact_id, account_name, account_number").in("contact_id", memberIds) : { data: [] },
      memberIds.length ? admin.from("storehouses").select("id, contact_id, label, asset_type").in("contact_id", memberIds) : { data: [] },
      memberIds.length ? admin.from("holding_tank").select("id, contact_id, account_name, account_number").in("contact_id", memberIds).neq("status", "moved") : { data: [] },
      latestValueDates(admin, memberIds),
      memberIds.length ? admin.from("holding_tank").select("account_number").in("contact_id", memberIds).eq("status", "moved") : { data: [] },
    ]);
    return planInvestmentApply(i.items, {
      householdId: i.householdId, members: members ?? [], vineyard: vineyard ?? [], storehouses: storehouses ?? [], holdingTank: tank ?? [],
      sourceFile: i.source.drive_id ? `vault:${i.source.drive_id}:${i.source.file_name ?? ""}` : null,
      statementDate: i.statementDate, valueDates, movedNumbers: (moved ?? []).map((m: any) => m.account_number).filter(Boolean),
    });
  }
  const { data: shareholders } = memberIds.length ? await admin.from("shareholders").select("corporation_id").in("contact_id", memberIds).eq("is_active", true) : { data: [] };
  const corpIds = [...new Set((shareholders ?? []).map((s: any) => s.corporation_id))];
  const { data: corporations } = corpIds.length ? await admin.from("corporations").select("id, name").in("id", corpIds) : { data: [] };
  const { data: policies } = await admin.from("insurance_policies").select("id, carrier, policy_number, insured_name, policy_type, renewal_date")
    .or(`contact_id.in.(${memberIds.length ? memberIds.join(",") : "00000000-0000-0000-0000-000000000000"})${corpIds.length ? `,corporation_id.in.(${corpIds.join(",")})` : ""}`);
  return planInsuranceApply(i.items, { members: members ?? [], corporations: corporations ?? [], policies: policies ?? [], vaultFolderId: null, fileName: i.source.file_name ?? null });
}
