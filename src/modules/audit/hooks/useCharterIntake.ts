import { supabase } from "@/shared/integrations/supabase/client";

export interface NamedItem {
  key: string;
  title: string;
  description: string;
}

export interface StorehouseReserves {
  liquidity: number;
  strategic: number;
  philanthropic: number;
  legacy: number;
}

export interface TreasurySnapshot {
  aum: number;
  net_worth: number;
  vineyard_total: number;
  holding_tank_total: number;
  personal_liabilities_total: number;
  corp_liabilities_total: number;
  storehouse_reserves: StorehouseReserves;
  storehouse_targets: StorehouseReserves;
  storehouse_funded_pct: {
    liquidity: number | null;
    strategic: number | null;
    philanthropic: number | null;
    legacy: number | null;
  };
  holding_tank_rows: { id: string; account_name: string; current_value: number; days_since_added: number }[];
}

export interface MeetingTranscript {
  id: string;
  title: string;
  content_text: string;
  added_at: string;
  external_file_id: string | null;
  external_modified_at: string | null;
}

export interface Perspective2Draft {
  discretionary_trust_guidelines: string;
  poa_incapacity_protocol: string;
  shareholder_voting_philosophy: string;
  boundary_protocol_note: string;
  capital_request_framework_note: string;
  matrimonial_ringfencing_note: string;
}

export interface LegalDocument {
  id: string;
  title: string;
  source_category: "estate" | "business";
  document_type: string;
  summary: string;
  extracted_facts: {
    testator_or_grantor_name: string | null;
    date_executed: string | null;
    jurisdiction: string | null;
    parties: { name: string; role: string; relationship: string | null }[];
    beneficiary_designations: { beneficiary_name: string; asset_or_share_description: string }[];
    key_clauses: { clause_ref: string | null; summary: string }[];
    notes: string | null;
  };
  external_file_id: string;
  external_modified_at: string | null;
  added_at: string;
}

export interface GovernanceSnapshot {
  track_type: "personal" | "corporate";
  vault_protocol_readiness: {
    percent: number;
    criticalTotal: number;
    criticalSatisfied: number;
    missingCritical: string[];
    missingRecommended: string[];
  };
  tax_shields: {
    sbd_clawback: number;
    active_asset_ratio: { ratio: number; belowLcgeThreshold: boolean };
    total_corp_assets: number;
    cda_balance: number | null;
  } | null;
}

export interface Perspective3Draft {
  hub_spoke_cadence_note: string;
  tri_party_mou_note: string;
  pure_fiduciary_standard_note: string;
  tax_friction_shields_note: string;
}

export interface NextGenMilestone {
  id: string;
  member_name: string;
  milestone_title: string;
  status: "not_started" | "in_progress" | "complete";
  target_date: string | null;
  notes: string | null;
}

export interface Perspective4Draft {
  identity_transition_note: string;
  philanthropic_stewardship_note: string;
}

export interface HouseholdCharter {
  id: string;
  household_id: string;
  status: "draft" | "complete";
  step: number;
  vision_text: string | null;
  core_values: NamedItem[];
  grounding_principles: NamedItem[];
  treasury_snapshot: TreasurySnapshot | null;
  treasury_snapshot_computed_at: string | null;
  vineyard_replenishment_policy: string | null;
  river_boundary_note: string | null;
  meeting_transcripts: MeetingTranscript[];
  discretionary_trust_guidelines: string | null;
  poa_incapacity_protocol: string | null;
  shareholder_voting_philosophy: string | null;
  boundary_protocol_note: string | null;
  capital_request_framework_note: string | null;
  matrimonial_ringfencing_note: string | null;
  legal_documents: LegalDocument[];
  governance_snapshot: GovernanceSnapshot | null;
  governance_snapshot_computed_at: string | null;
  corporate_passive_income_annual: number | null;
  active_operational_assets_value: number | null;
  cda_balance: number | null;
  tax_friction_shields_note: string | null;
  hub_spoke_cadence_note: string | null;
  tri_party_mou_note: string | null;
  pure_fiduciary_standard_note: string | null;
  identity_transition_note: string | null;
  next_gen_milestones: NextGenMilestone[];
  philanthropic_stewardship_note: string | null;
  family_values_addendum_signed_at: string | null;
  family_values_addendum_reaffirmed_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CharterPrefill {
  available: boolean;
  suggestedVisionText: string;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("charter-intake", { body });
  if (error) {
    let details = error.message;
    try {
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.text === "function") {
        const text = await ctx.text();
        const parsed = JSON.parse(text);
        details = parsed?.error || text || details;
      }
    } catch {
      /* keep original message */
    }
    throw new Error(details);
  }
  const res = data as { ok: boolean; error?: string } & Record<string, unknown>;
  if (!res?.ok) throw new Error(res?.error || "The Charter Intake service could not complete this request.");
  return res as T;
}

export async function loadCharterIntake(householdId: string) {
  return invoke<{ charter: HouseholdCharter; prefill: CharterPrefill; track_type: "personal" | "corporate" }>({
    action: "load",
    household_id: householdId,
  });
}

export async function saveCharterIntakeField(
  householdId: string,
  field:
    | "vision"
    | "core_values"
    | "grounding_principles"
    | "vineyard_replenishment"
    | "river_boundary"
    | "meeting_transcripts"
    | "discretionary_trust_guidelines"
    | "poa_incapacity_protocol"
    | "shareholder_voting_philosophy"
    | "boundary_protocol_note"
    | "capital_request_framework_note"
    | "matrimonial_ringfencing_note"
    | "legal_documents"
    | "corporate_passive_income_annual"
    | "active_operational_assets_value"
    | "cda_balance"
    | "tax_friction_shields_note"
    | "hub_spoke_cadence_note"
    | "tri_party_mou_note"
    | "pure_fiduciary_standard_note"
    | "identity_transition_note"
    | "next_gen_milestones"
    | "philanthropic_stewardship_note",
  value: string | number | null | NamedItem[] | MeetingTranscript[] | LegalDocument[] | NextGenMilestone[],
  advanceTo: number,
) {
  const data = await invoke<{ charter: HouseholdCharter }>({
    action: "save",
    household_id: householdId,
    field,
    value,
    advance_to: advanceTo,
  });
  return data.charter;
}

export async function recomputeTreasurySnapshot(householdId: string) {
  const data = await invoke<{ charter: HouseholdCharter }>({ action: "recompute_treasury", household_id: householdId });
  return data.charter;
}

export async function syncMeetingTranscripts(householdId: string) {
  return invoke<{ charter: HouseholdCharter; synced: number; folder_missing?: boolean; errors?: { title: string; message: string }[] }>({
    action: "sync_meeting_transcripts",
    household_id: householdId,
  });
}

export async function draftPerspective2(householdId: string) {
  const data = await invoke<{ draft: Perspective2Draft }>({ action: "draft_perspective_2", household_id: householdId });
  return data.draft;
}

export async function syncLegalDocuments(householdId: string) {
  return invoke<{ charter: HouseholdCharter; synced: number; vault_missing?: boolean; errors?: { title: string; message: string }[] }>({
    action: "sync_legal_documents",
    household_id: householdId,
  });
}

export async function recomputeGovernanceSnapshot(householdId: string) {
  const data = await invoke<{ charter: HouseholdCharter }>({ action: "recompute_governance_snapshot", household_id: householdId });
  return data.charter;
}

export async function draftPerspective3(householdId: string) {
  const data = await invoke<{ draft: Perspective3Draft }>({ action: "draft_perspective_3", household_id: householdId });
  return data.draft;
}

export async function draftPerspective4(householdId: string) {
  const data = await invoke<{ draft: Perspective4Draft }>({ action: "draft_perspective_4", household_id: householdId });
  return data.draft;
}

export async function markValuesAddendumSigned(householdId: string) {
  const data = await invoke<{ charter: HouseholdCharter }>({ action: "mark_values_addendum_signed", household_id: householdId });
  return data.charter;
}

export async function markValuesAddendumReaffirmed(householdId: string) {
  const data = await invoke<{ charter: HouseholdCharter }>({ action: "mark_values_addendum_reaffirmed", household_id: householdId });
  return data.charter;
}

export async function completeCharterIntake(householdId: string) {
  const data = await invoke<{ charter: HouseholdCharter }>({ action: "complete", household_id: householdId });
  return data.charter;
}
