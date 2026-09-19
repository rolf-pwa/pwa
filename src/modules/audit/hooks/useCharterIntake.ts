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
  return invoke<{ charter: HouseholdCharter; prefill: CharterPrefill }>({ action: "load", household_id: householdId });
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
    | "matrimonial_ringfencing_note",
  value: string | NamedItem[] | MeetingTranscript[],
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

export async function completeCharterIntake(householdId: string) {
  const data = await invoke<{ charter: HouseholdCharter }>({ action: "complete", household_id: householdId });
  return data.charter;
}
