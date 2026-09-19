import { supabase } from "@/shared/integrations/supabase/client";

export interface NamedItem {
  key: string;
  title: string;
  description: string;
}

export interface HouseholdCharter {
  id: string;
  household_id: string;
  status: "draft" | "complete";
  step: number;
  vision_text: string | null;
  core_values: NamedItem[];
  grounding_principles: NamedItem[];
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
  field: "vision" | "core_values" | "grounding_principles",
  value: string | NamedItem[],
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

export async function completeCharterIntake(householdId: string) {
  const data = await invoke<{ charter: HouseholdCharter }>({ action: "complete", household_id: householdId });
  return data.charter;
}
