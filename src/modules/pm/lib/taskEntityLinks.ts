import { supabase } from "@/shared/integrations/supabase/client";
import { familyTitle } from "@/shared/lib/utils";
import type { PmTask } from "@/shared/lib/agents";

export interface TaskEntityLink {
  label: string;
  to: string;
}

/** One link per task, preferring contact over household over family — same
 *  precedence TaskDetailPanel's pickers already use for task scope. */
export async function resolveTaskEntityLinks(tasks: PmTask[]): Promise<Record<string, TaskEntityLink>> {
  const contactIds = Array.from(new Set(tasks.map((t) => t.contact_id).filter((id): id is string => !!id)));
  const householdIds = Array.from(
    new Set(tasks.filter((t) => !t.contact_id).map((t) => t.household_id).filter((id): id is string => !!id)),
  );
  const familyIds = Array.from(
    new Set(
      tasks
        .filter((t) => !t.contact_id && !t.household_id)
        .map((t) => t.family_id)
        .filter((id): id is string => !!id),
    ),
  );

  const [contactsRes, householdsRes, familiesRes] = await Promise.all([
    contactIds.length ? supabase.from("contacts").select("id, first_name, last_name").in("id", contactIds) : Promise.resolve({ data: [] }),
    householdIds.length ? supabase.from("households").select("id, label").in("id", householdIds) : Promise.resolve({ data: [] }),
    familyIds.length ? supabase.from("families").select("id, name").in("id", familyIds) : Promise.resolve({ data: [] }),
  ]);

  const contactLabel = new Map(
    (contactsRes.data || []).map((c: any) => [c.id, `${c.first_name} ${c.last_name || ""}`.trim()]),
  );
  const householdLabel = new Map((householdsRes.data || []).map((h: any) => [h.id, h.label]));
  const familyLabel = new Map((familiesRes.data || []).map((f: any) => [f.id, f.name]));

  const links: Record<string, TaskEntityLink> = {};
  for (const t of tasks) {
    if (t.contact_id && contactLabel.has(t.contact_id)) {
      links[t.id] = { label: contactLabel.get(t.contact_id)!, to: `/contacts/${t.contact_id}` };
    } else if (t.household_id && householdLabel.has(t.household_id)) {
      links[t.id] = { label: householdLabel.get(t.household_id)!, to: `/households/${t.household_id}` };
    } else if (t.family_id && familyLabel.has(t.family_id)) {
      links[t.id] = { label: familyTitle(familyLabel.get(t.family_id)), to: `/families/${t.family_id}` };
    }
  }
  return links;
}
